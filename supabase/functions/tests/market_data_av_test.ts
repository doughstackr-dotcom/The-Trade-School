// Tests for supabase/functions/market-data with Alpha Vantage (the free key: 25 calls a day for
// the whole site), the catalog, and the exchange feeds' default-off switch.
//
// Run (from the repo root):
//   DENO_DIR=/tmp/denotest/cache deno test --no-config --node-modules-dir=none \
//     --allow-env --allow-read=supabase --allow-net=127.0.0.1 supabase/functions/tests/market_data_av_test.ts
//
// Nothing leaves the process: Deno.serve is stubbed to capture the handler, and fetch is routed
// to in-memory fakes of PostgREST (with market_quota / take_market_quota), Alpha Vantage,
// Coinbase and Kraken (market_data_fakes.ts). Every test counts upstream calls and budget units.
import { assert, assertEquals, assertExists, assertMatch } from 'jsr:@std/assert@1';
import {
  AV_MESSAGES,
  type AvMarket,
  clock,
  DAY,
  FakeAlphaVantage,
  FakeCoinbase,
  FakeKraken,
  FakePostgrest,
  HOUR,
  installClock,
  installFetch,
  MIN,
  RealDate,
} from './market_data_fakes.ts';
import { lastBoundaryMs, parseAlphaVantage, resetAlphaVantageState } from '../market-data/alphavantage.ts';

// ---------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------

const SUPABASE_URL = 'http://fake.supabase';
Deno.env.set('SUPABASE_URL', SUPABASE_URL);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role');

const Dt = (y: number, m: number, d: number, h = 0, min = 0, s = 0) => RealDate.UTC(y, m - 1, d, h, min, s);
// Wednesday 2026-09-23 15:00 UTC: US markets are open, Tuesday's close is the newest daily candle.
const WED = Dt(2026, 9, 23, 15);
const TUE_D = Dt(2026, 9, 22);
const WED_D = Dt(2026, 9, 23);
const MON_W = Dt(2026, 9, 21); // this week's weekly candle
const WEEK = 7 * DAY;
const A_MONDAY = Dt(1970, 1, 5);
installClock(WED);

const db = new FakePostgrest();
const av = new FakeAlphaVantage();
const cb = new FakeCoinbase();
const kr = new FakeKraken();
installFetch(db, cb, kr, SUPABASE_URL, av);

const HOLIDAYS = [Dt(2026, 7, 3), Dt(2026, 9, 7), Dt(2026, 11, 26)];
function resetMarkets() {
  const eq = (listing: number, base: number, extra: Partial<AvMarket> = {}): AvMarket => ({
    kind: 'equity', listing, base, holidays: HOLIDAYS, ...extra,
  });
  av.avMarkets = {
    SPY: eq(Dt(2000, 1, 3), 400),
    QQQ: eq(Dt(2000, 1, 3), 350),
    GLD: eq(Dt(2004, 11, 18), 180),
    AAPL: eq(Dt(2000, 1, 3), 150, { splits: [{ at: Dt(2020, 8, 31), ratio: 4 }] }), // 4:1 on a Monday
    MSFT: eq(Dt(2000, 1, 3), 300),
    NVDA: eq(Dt(2000, 1, 3), 120, { splits: [{ at: Dt(2024, 6, 10), ratio: 10 }] }),
    TSLA: eq(Dt(2010, 6, 29), 250),
    EURUSD: { kind: 'fx', listing: Dt(2005, 1, 3), base: 1.1 },
    GBPUSD: { kind: 'fx', listing: Dt(2005, 1, 3), base: 1.3 },
    USDJPY: { kind: 'fx', listing: Dt(2005, 1, 3), base: 145 },
    BTC: { kind: 'crypto', listing: Dt(2014, 1, 1), base: 60000 },
    ETH: { kind: 'crypto', listing: Dt(2016, 1, 1), base: 3000 },
  };
  cb.markets = {
    'BTC-USD': { listing: Dt(2015, 1, 20), base: 60000 },
    'ETH-USD': { listing: Dt(2016, 5, 18), base: 3000 },
    'SOL-USD': { listing: Dt(2021, 6, 1), base: 150 },
  };
  kr.markets = cb.markets;
  kr.pairs = { XBTUSD: 'BTC-USD', ETHUSD: 'ETH-USD', SOLUSD: 'SOL-USD' };
}

type Config = { key?: boolean; feeds?: string; premium?: boolean; limit?: number; spacingMs?: number };
function configure(o: Config = {}) {
  const set = (k: string, v: string | undefined) => (v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v));
  set('ALPHAVANTAGE_API_KEY', o.key === false ? undefined : av.apiKey);
  set('ALPHA_VANTAGE_API_KEY', undefined); // the fallback spelling; one test sets it
  set('MARKET_EXCHANGE_FEEDS', o.feeds);
  set('ALPHAVANTAGE_PREMIUM', o.premium ? '1' : undefined);
  set('ALPHAVANTAGE_DAILY_LIMIT', o.limit === undefined ? undefined : String(o.limit));
  set('ALPHAVANTAGE_SPACING_MS', String(o.spacingMs ?? 0)); // tests control pacing explicitly
}

type Handler = (req: Request) => Promise<Response>;
let handler: Handler | null = null;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: Handler) => {
  handler = h;
  return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {}, addr: { hostname: '127.0.0.1', port: 0, transport: 'tcp' } };
};
await import('../market-data/index.ts');
assertExists(handler, 'market-data did not call Deno.serve');

function fresh(now = WED, cfg: Config = {}) {
  db.reset();
  av.reset();
  cb.reset();
  kr.reset();
  resetMarkets();
  clock.now = now;
  Math.random = () => 0.5; // no random prune
  configure(cfg);
  resetAlphaVantageState(); // what the adapter learned in an earlier test (plan fallback, pacing)
}

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
type Result = { status: number; headers: Headers; body: Record<string, unknown> & { candles?: Candle[] } };

async function call(params: Record<string, unknown>, method = 'POST'): Promise<Result> {
  const req = method === 'GET'
    ? new Request(`http://localhost/functions/v1/market-data?${new URLSearchParams(params as Record<string, string>)}`)
    : new Request('http://localhost/functions/v1/market-data', {
      method,
      body: JSON.stringify(params),
      headers: { 'Content-Type': 'application/json' },
    });
  const res = await handler!(req);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : {} };
}

const avQuota = () => db.quotaUsed('alphavantage');
const avRow = (r: { t: number; o: number; h: number; l: number; c: number; v: number }, v = r.v): Candle => ({
  t: r.t, o: +r.o.toFixed(4), h: +r.h.toFixed(4), l: +r.l.toFixed(4), c: +r.c.toFixed(4), v,
});
const quotaRpcs = () => db.rpcCalls.filter((f) => f === 'take_market_quota').length;

/** Oldest first, unique, aligned (daily: 00:00 UTC; weekly: Monday 00:00 UTC), valid OHLC. */
function assertWellFormed(candles: Candle[], interval: '1d' | '1w' | '5m') {
  for (let i = 0; i < candles.length; i++) {
    const k = candles[i];
    assertEquals(Object.keys(k).sort(), ['c', 'h', 'l', 'o', 't', 'v']);
    if (interval === '1w') assertEquals((k.t - A_MONDAY) % WEEK, 0, `weekly candle ${new RealDate(k.t).toISOString()} is not a Monday`);
    else assertEquals(k.t % (interval === '1d' ? DAY : 5 * MIN), 0);
    assert(k.l <= Math.min(k.o, k.c) && Math.max(k.o, k.c) <= k.h && k.l > 0, `bad OHLC ${JSON.stringify(k)}`);
    if (i) assert(k.t > candles[i - 1].t);
  }
}

const AV_IDS = ['SPY', 'QQQ', 'GLD', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'EUR-USD', 'GBP-USD', 'USD-JPY', 'BTC-USD', 'ETH-USD'];
const catalogOf = (r: Result) =>
  Object.fromEntries((r.body.symbols as Record<string, unknown>[]).map((s) => [s.id as string, s]));

// ---------------------------------------------------------------------------------------
// Configuration: nothing set up, catalog
// ---------------------------------------------------------------------------------------

Deno.test('no key and no exchange feeds: every symbol/interval is unconfigured (503) and nothing is called', async () => {
  fresh(WED, { key: false });
  for (const [symbol, interval] of [['SPY', '1d'], ['EUR-USD', '1w'], ['BTC-USD', '1d'], ['BTC-USD', '1m'], ['SOL-USD', '1h']]) {
    const r = await call({ symbol, interval });
    assertEquals(r.status, 503, `${symbol} ${interval}`);
    assertEquals(r.body.unconfigured, true);
    assertMatch(String(r.body.error), /not available yet/);
    assertEquals(r.headers.get('Cache-Control'), 'no-store');
    assertEquals(r.headers.get('Access-Control-Allow-Origin'), '*');
  }
  // With the exchange feeds on but no key, the Alpha Vantage markets are still unconfigured.
  configure({ key: false, feeds: 'coinbase,kraken' });
  assertEquals((await call({ symbol: 'SPY', interval: '1d' })).body.unconfigured, true);
  assertEquals((await call({ symbol: 'BTC-USD', interval: '1w' })).body.unconfigured, true, 'no exchange serves weekly');
  // 1w is a valid interval; the error for a bad one lists it.
  const bad = await call({ symbol: 'SPY', interval: '1mo' });
  assertEquals(bad.status, 400);
  assertMatch(String(bad.body.error), /1m 5m 15m 1h 6h 1d 1w/);
  assertEquals(db.calls.length, 0);
  assertEquals(av.calls.length + cb.calls.length + kr.calls.length, 0);
});

Deno.test('catalog with nothing configured: status unconfigured, every symbol listed with no intervals', async () => {
  fresh(WED, { key: false });
  const r = await call({ catalog: true });
  assertEquals(r.status, 200);
  assertEquals(r.headers.get('Cache-Control'), 'public, max-age=300');
  assertEquals(r.headers.get('Access-Control-Allow-Origin'), '*');
  assertEquals(r.body.status, 'unconfigured');
  const symbols = r.body.symbols as Record<string, unknown>[];
  assertEquals(symbols.map((s) => s.id).slice(0, 12), AV_IDS);
  assertEquals(symbols.length, 19);
  for (const s of symbols) {
    assertEquals(Object.keys(s).sort(), ['attribution', 'class', 'decimals', 'delayed', 'id', 'intervals', 'live', 'name']);
    assertEquals(s.intervals, []);
    assertEquals(s.live, false);
    assertEquals(typeof s.name, 'string');
    assert(Number.isInteger(s.decimals));
  }
  const cat = catalogOf(r);
  assertEquals([cat.SPY.class, cat.AAPL.class, cat.GLD.class, cat['EUR-USD'].class, cat['BTC-USD'].class], ['etf', 'stock', 'etf', 'fx', 'crypto']);
  assertEquals([cat['EUR-USD'].decimals, cat['GBP-USD'].decimals, cat['USD-JPY'].decimals, cat.SPY.decimals, cat['BTC-USD'].decimals], [4, 4, 2, 2, 2]);
  assertEquals(cat.SPY.name, 'S&P 500 ETF');
  // GET ?catalog=1 is the same; no database or provider traffic for either.
  const viaGet = await call({ catalog: '1' }, 'GET');
  assertEquals(viaGet.body, r.body);
  assertEquals(viaGet.headers.get('Cache-Control'), 'public, max-age=300');
  assertEquals(db.calls.length + av.calls.length + cb.calls.length + kr.calls.length, 0);
});

Deno.test('catalog with the Alpha Vantage key only: the 12 markets daily + weekly, delayed, not live', async () => {
  fresh(WED);
  const r = await call({ catalog: true });
  assertEquals(r.body.status, 'ok');
  const cat = catalogOf(r);
  for (const id of AV_IDS) {
    assertEquals(cat[id].intervals, ['1d', '1w'], id);
    assertEquals([cat[id].live, cat[id].delayed, cat[id].attribution], [false, true, 'Market data: Alpha Vantage'], id);
  }
  for (const id of ['SOL-USD', 'XRP-USD', 'DOGE-USD', 'LTC-USD', 'ADA-USD', 'AVAX-USD', 'LINK-USD']) {
    assertEquals([cat[id].intervals, cat[id].live, cat[id].attribution], [[], false, null], id);
  }
  // A premium key adds intraday (still delayed, so not live).
  configure({ premium: true });
  const premium = catalogOf(await call({ catalog: true }));
  assertEquals(premium.SPY.intervals, ['5m', '15m', '1h', '1d', '1w']);
  assertEquals([premium.SPY.live, premium.SPY.delayed], [false, true]);
  assertEquals(db.calls.length + av.calls.length, 0);
});

Deno.test('catalog with the key and exchange feeds: crypto is live and real-time', async () => {
  fresh(WED, { feeds: 'kraken,coinbase' });
  const cat = catalogOf(await call({ catalog: true }));
  assertEquals(cat['BTC-USD'].intervals, ['1m', '5m', '15m', '1h', '6h', '1d', '1w'], '1w comes from Alpha Vantage');
  assertEquals([cat['BTC-USD'].live, cat['BTC-USD'].delayed, cat['BTC-USD'].attribution], [true, false, 'Market data: Coinbase Exchange']);
  assertEquals(cat['SOL-USD'].intervals, ['1m', '5m', '15m', '1h', '6h', '1d']);
  assertEquals(cat['SOL-USD'].live, true);
  assertEquals([cat.SPY.intervals, cat.SPY.live, cat.SPY.delayed], [['1d', '1w'], false, true]);
  // Kraken only, no key: Kraken's intervals (no 6h, no weekly), and the equities drop out.
  configure({ key: false, feeds: 'kraken' });
  const r = await call({ catalog: true });
  const k = catalogOf(r);
  assertEquals(r.body.status, 'ok');
  assertEquals(k['BTC-USD'].intervals, ['1m', '5m', '15m', '1h', '1d']);
  assertEquals(k['BTC-USD'].attribution, 'Market data: Kraken');
  assertEquals(k.SPY.intervals, []);
});

// ---------------------------------------------------------------------------------------
// Daily candles: compact, one refresh per close
// ---------------------------------------------------------------------------------------

Deno.test('daily: the first request spends one unit (compact); repeats before the next close spend none; the close brings one refresh', async () => {
  fresh(WED);
  const r = await call({ symbol: 'SPY', interval: '1d' });
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals(Object.keys(r.body).sort(), ['attribution', 'candles', 'delayed', 'interval', 'source', 'symbol']);
  assertEquals([r.body.source, r.body.attribution, r.body.delayed], ['alphavantage', 'Market data: Alpha Vantage', true]);
  assertEquals(r.headers.get('Cache-Control'), 'public, max-age=60');
  const candles = r.body.candles!;
  assertEquals(candles.length, 100, 'compact = the latest 100 trading days');
  assertWellFormed(candles, '1d');
  assertEquals(candles.at(-1)!.t, TUE_D, "Wednesday's candle is not out before the close");
  assertEquals(candles, av.dailyRows('SPY').slice(-100).map((x) => avRow(x)));
  assertEquals(av.calls.length, 1);
  const u = av.calls[0].url;
  assertEquals(u.pathname, '/query');
  assertEquals(
    [u.searchParams.get('function'), u.searchParams.get('symbol'), u.searchParams.get('outputsize'), u.searchParams.get('apikey')],
    ['TIME_SERIES_DAILY', 'SPY', 'compact', av.apiKey],
  );
  assertEquals(avQuota(), 1);
  assertEquals(db.fetchState('SPY', '1d')!.source, 'alphavantage');
  assertEquals(cb.calls.length + kr.calls.length, 0);

  // Before Wednesday's close (boundary 21:30 UTC): latest, historical and GET requests are all cache hits.
  for (const t of [WED + MIN, WED + 3 * HOUR, Dt(2026, 9, 23, 21, 29)]) {
    clock.now = t;
    const again = await call({ symbol: 'SPY', interval: '1d' });
    assertEquals(again.body.candles, candles);
    assertEquals((await call({ symbol: 'SPY', interval: '1d', end: TUE_D - 20 * DAY, limit: 30 })).body.candles!.length, 30);
    assertEquals((await call({ symbol: 'spy', interval: '1d', limit: '50' }, 'GET')).body.candles!.length, 50);
  }
  assertEquals([av.calls.length, avQuota()], [1, 1]);

  // After the close: one refresh brings Wednesday's candle; the cache keeps the older one too.
  clock.now = Dt(2026, 9, 23, 21, 31);
  const rs = await Promise.all(Array.from({ length: 5 }, () => call({ symbol: 'SPY', interval: '1d' })));
  assertEquals([av.calls.length, avQuota()], [2, 2], 'one refresh for five concurrent requests');
  const after = rs.find((x) => x.body.candles!.at(-1)!.t === WED_D);
  assertExists(after, 'someone saw the new candle');
  const latest = await call({ symbol: 'SPY', interval: '1d' });
  assertEquals(latest.body.candles!.length, 101);
  assertEquals(latest.body.candles!.at(-1)!.t, WED_D);
  assertEquals(db.candles('SPY', '1d').length, 101);

  // Thursday before the close: nothing; after it: one more.
  clock.now = Dt(2026, 9, 24, 9);
  await call({ symbol: 'SPY', interval: '1d' });
  assertEquals(av.calls.length, 2);
  clock.now = Dt(2026, 9, 24, 21, 45);
  await call({ symbol: 'SPY', interval: '1d' });
  assertEquals([av.calls.length, avQuota()], [3, 1], 'the budget is per UTC day');
  assertEquals(db.quotaUsed('alphavantage', WED), 2);
});

Deno.test('weekends and holidays: gaps never trigger a refetch; one call per weekday close', async () => {
  fresh(Dt(2026, 9, 4, 23)); // Friday 23:00 UTC, after the equity (21:30) and FX (22:30) closes
  const spy0 = await call({ symbol: 'SPY', interval: '1d' });
  const eur0 = await call({ symbol: 'EUR-USD', interval: '1d' });
  assertEquals([spy0.status, eur0.status], [200, 200]);
  assertEquals(spy0.body.candles!.at(-1)!.t, Dt(2026, 9, 4));
  assertEquals(eur0.body.candles!.at(-1)!.t, Dt(2026, 9, 4));
  assertEquals(eur0.body.candles![0].v, 0, 'FX has no volume');
  assertEquals(av.count('FX_DAILY'), 1);
  assertEquals(av.calls.find((c) => c.url.searchParams.get('function') === 'FX_DAILY')!.url.searchParams.get('from_symbol'), 'EUR');
  assertEquals(av.calls.length, 2);
  // The cached series skip weekends (and SPY skips the 3 July holiday): no invented candles.
  const days = db.candles('SPY', '1d').map((k) => new RealDate(k.t).getUTCDay());
  assert(!days.includes(0) && !days.includes(6));
  assert(!db.candles('SPY', '1d').some((k) => k.t === Dt(2026, 7, 3)));

  // Saturday, Sunday, Monday (Labor Day, SPY closed) before the close: nothing is fetched, nothing is stale.
  for (const t of [Dt(2026, 9, 5, 12), Dt(2026, 9, 6, 20), Dt(2026, 9, 7, 12)]) {
    clock.now = t;
    for (const symbol of ['SPY', 'EUR-USD']) {
      const r = await call({ symbol, interval: '1d' });
      assertEquals(r.status, 200);
      assertEquals(r.body.stale, undefined);
      assertEquals(r.headers.get('Cache-Control'), 'public, max-age=60');
    }
    await call({ symbol: 'SPY', interval: '1d', end: Dt(2026, 9, 1), limit: 20 });
  }
  assertEquals(av.calls.length, 2);

  // Monday's closes: the function doesn't know the holiday, so SPY spends one (empty) refresh; FX gets Monday.
  clock.now = Dt(2026, 9, 7, 21, 31);
  await call({ symbol: 'SPY', interval: '1d' });
  await call({ symbol: 'EUR-USD', interval: '1d' });
  assertEquals(av.calls.length, 3, 'FX closes at 22:30');
  clock.now = Dt(2026, 9, 7, 22, 31);
  const eur1 = await call({ symbol: 'EUR-USD', interval: '1d' });
  assertEquals(eur1.body.candles!.at(-1)!.t, Dt(2026, 9, 7));
  assertEquals(av.calls.length, 4);

  // Tuesday before the close: SPY's newest candle is Friday's (4 days), not a hole and not stale.
  clock.now = Dt(2026, 9, 8, 20);
  const tue = await call({ symbol: 'SPY', interval: '1d' });
  assertEquals(tue.body.candles!.at(-1)!.t, Dt(2026, 9, 4));
  assertEquals(tue.body.stale, undefined);
  clock.now = Dt(2026, 9, 8, 21, 31);
  await call({ symbol: 'SPY', interval: '1d' });
  assertEquals(av.calls.length, 5);
  // Windows across the long weekend are served from the cache, gap and all.
  clock.now = Dt(2026, 9, 9, 10);
  const across = await call({ symbol: 'SPY', interval: '1d', end: Dt(2026, 9, 8), limit: 3 });
  assertEquals(across.body.candles!.map((k) => k.t), [Dt(2026, 9, 3), Dt(2026, 9, 4), Dt(2026, 9, 8)]);
  await call({ symbol: 'SPY', interval: '1d' });
  assertEquals(av.calls.length, 5);
  assertEquals([Dt(2026, 9, 4), Dt(2026, 9, 5), Dt(2026, 9, 6), Dt(2026, 9, 7), Dt(2026, 9, 8), Dt(2026, 9, 9)].map((d) => db.quotaUsed('alphavantage', d)), [2, 0, 0, 2, 1, 0]);
});

// ---------------------------------------------------------------------------------------
// Weekly candles: full history, split-adjusted, one refresh per week
// ---------------------------------------------------------------------------------------

Deno.test('weekly: full history in one call, split-adjusted OHLC stored, keyed by Monday, one refresh a week', async () => {
  fresh(WED);
  const r = await call({ symbol: 'AAPL', interval: '1w' });
  assertEquals(r.status, 200);
  assertEquals(av.calls.length, 1);
  const u = av.calls[0].url;
  assertEquals([u.searchParams.get('function'), u.searchParams.get('symbol'), u.searchParams.get('outputsize')], ['TIME_SERIES_WEEKLY_ADJUSTED', 'AAPL', null]);
  assertEquals(r.body.candles!.length, 300);
  assertWellFormed(r.body.candles!, '1w');
  assertEquals(r.body.candles!.at(-1)!.t, MON_W, 'the week in progress (Mon + Tue so far)');
  // The whole history is cached: ~26 years.
  const stored = db.candles('AAPL', '1w');
  const expected = av.adjustedWeekly('AAPL');
  assertEquals(stored.length, expected.length);
  assert(stored.length > 1350);
  assertEquals(stored[0].t, Dt(2000, 1, 3));
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 1e-5;
  for (let i = 0; i < stored.length; i++) {
    const [s, e] = [stored[i], expected[i]];
    assertEquals(s.t, e.t);
    assert(close(s.o, e.o) && close(s.h, e.h) && close(s.l, e.l) && close(s.c, e.c), `week ${new RealDate(s.t).toISOString()}: ${JSON.stringify([s, e])}`);
  }
  // The 4:1 split on 31 Aug 2020 is invisible in the stored candles, while the raw prices jump.
  const before = stored.find((k) => k.t === Dt(2020, 8, 24))!;
  const splitWeek = stored.find((k) => k.t === Dt(2020, 8, 31))!;
  assert(splitWeek.o / before.c > 0.9 && splitWeek.o / before.c < 1.1, 'no fake crash at the split');
  const raw = av.weeklyRows('AAPL').find((k) => k.t === Dt(2020, 8, 24))!;
  assert(Math.abs(raw.c / before.c - 4) < 1e-3, 'the raw weekly close was 4× the adjusted one');
  assertEquals(avQuota(), 1);

  // Old windows are served from the cache; before the listing there is nothing (and no call).
  const old = await call({ symbol: 'AAPL', interval: '1w', end: Dt(2011, 6, 1), limit: 100 });
  assertEquals(old.body.candles!.length, 100);
  assertEquals(old.headers.get('Cache-Control'), 'public, max-age=3600');
  const none = await call({ symbol: 'AAPL', interval: '1w', end: Dt(1999, 6, 1), limit: 100 });
  assertEquals([none.status, none.body.candles], [200, []]);
  // Refreshed once a week, once the week is complete: at Saturday 00:30 UTC (Friday's UTC day
  // already carries every market's daily refresh), not on Friday evening.
  for (const t of [Dt(2026, 9, 24, 12), Dt(2026, 9, 25, 21, 31), Dt(2026, 9, 26, 0, 29)]) {
    clock.now = t;
    await call({ symbol: 'AAPL', interval: '1w' });
  }
  assertEquals(av.calls.length, 1);
  clock.now = Dt(2026, 9, 26, 0, 31);
  const sat = await call({ symbol: 'AAPL', interval: '1w' });
  assertEquals(av.calls.length, 2);
  const week = sat.body.candles!.at(-1)!;
  assertEquals(week.t, MON_W);
  assertEquals(week.c, +av.dailyRows('AAPL').at(-1)!.c.toFixed(4), "the week closes at Friday's close");
  for (const t of [Dt(2026, 9, 26, 12), Dt(2026, 9, 28, 12), Dt(2026, 10, 2, 23, 59)]) {
    clock.now = t;
    await call({ symbol: 'AAPL', interval: '1w' });
  }
  assertEquals(av.calls.length, 2);
  assertEquals([db.quotaUsed('alphavantage', WED), db.quotaUsed('alphavantage', Dt(2026, 9, 25)), db.quotaUsed('alphavantage', Dt(2026, 9, 26))], [1, 0, 1]);
});

Deno.test('weekly FX and crypto: FX_WEEKLY / DIGITAL_CURRENCY_WEEKLY, candles on Mondays; crypto refreshes after Monday 00:30', async () => {
  fresh(WED);
  const eur = await call({ symbol: 'EUR-USD', interval: '1w', limit: 1000 });
  const btc = await call({ symbol: 'BTC-USD', interval: '1w', limit: 1000 });
  assertEquals([eur.status, btc.status], [200, 200]);
  assertEquals(av.calls.map((c) => c.url.searchParams.get('function')), ['FX_WEEKLY', 'DIGITAL_CURRENCY_WEEKLY']);
  assertEquals(av.calls[1].url.searchParams.get('symbol'), 'BTC');
  assertEquals(av.calls[1].url.searchParams.get('market'), 'USD');
  assertEquals(eur.body.candles!.length, 1000);
  assertEquals(btc.body.candles!.length, av.weeklyRows('BTC').length, 'every week since 2014');
  assertEquals(btc.body.candles![0].t, Dt(2013, 12, 30), 'the week of 1 Jan 2014 opens on Monday 30 Dec');
  for (const r of [eur, btc]) {
    assertWellFormed(r.body.candles!, '1w');
    assertEquals(r.body.candles!.at(-1)!.t, MON_W);
  }
  // Crypto weeks end on Sunday: the next refresh is due after Monday 00:30 UTC.
  clock.now = Dt(2026, 9, 28, 0, 29);
  await call({ symbol: 'BTC-USD', interval: '1w' });
  assertEquals(av.calls.length, 2);
  clock.now = Dt(2026, 9, 28, 0, 31);
  const next = await call({ symbol: 'BTC-USD', interval: '1w' });
  assertEquals(av.calls.length, 3);
  assertEquals(next.body.candles!.at(-1)!.t, MON_W, 'the completed week (the new one has no finished day yet)');
});

Deno.test('weekly adjusted not on this plan: falls back to plain weekly (two units)', async () => {
  fresh(WED);
  av.premiumWeeklyAdjusted = true;
  const r = await call({ symbol: 'MSFT', interval: '1w' });
  assertEquals(r.status, 200);
  assertEquals(av.calls.map((c) => c.url.searchParams.get('function')), ['TIME_SERIES_WEEKLY_ADJUSTED', 'TIME_SERIES_WEEKLY']);
  assertEquals(avQuota(), 2);
  assertEquals(r.body.candles!.length, 300);
  assertWellFormed(r.body.candles!, '1w');
});

// ---------------------------------------------------------------------------------------
// The daily budget
// ---------------------------------------------------------------------------------------

Deno.test('budget used up mid-day: cached series answer stale, cold ones 503 quota; no retry before 00:00 UTC', async () => {
  fresh(WED, { limit: 3 });
  const spy0 = await call({ symbol: 'SPY', interval: '1d' });
  await call({ symbol: 'QQQ', interval: '1d' });
  assertEquals(avQuota(), 2);
  clock.now = Dt(2026, 9, 23, 21, 31); // after the close: everything is due
  assertEquals((await call({ symbol: 'GLD', interval: '1d' })).status, 200);
  assertEquals([av.calls.length, avQuota()], [3, 3]);

  // SPY's refresh finds the budget spent: its cache is served as stale, not re-fetched.
  const spy = await call({ symbol: 'SPY', interval: '1d' });
  assertEquals(spy.status, 200);
  assertEquals([spy.body.stale, spy.body.source, spy.body.delayed, spy.body.attribution], [true, 'cache', true, 'Market data: Alpha Vantage']);
  assertEquals(spy.headers.get('Cache-Control'), 'no-store');
  assertEquals(spy.body.candles, spy0.body.candles);
  // AAPL has nothing cached: 503 with quota: true (not 502, not unconfigured).
  const aapl = await call({ symbol: 'AAPL', interval: '1d' });
  assertEquals(aapl.status, 503);
  assertEquals(aapl.body.quota, true);
  assertEquals(aapl.body.unconfigured, undefined);
  assertMatch(String(aapl.body.error), /budget/);
  assertEquals(aapl.headers.get('Cache-Control'), 'no-store');
  assertEquals([av.calls.length, avQuota()], [3, 3]);

  // Until midnight UTC nobody claims the refresh again (no tight loop), and answers are immediate.
  const rpcs = quotaRpcs();
  const held = [db.fetchState('SPY', '1d')!.fetched_at, db.fetchState('AAPL', '1d')!.fetched_at];
  for (const t of [Dt(2026, 9, 23, 21, 32), Dt(2026, 9, 23, 22, 40), Dt(2026, 9, 23, 23, 59, 59)]) {
    clock.now = t;
    const t0 = performance.now();
    const s = await call({ symbol: 'SPY', interval: '1d' });
    const a = await call({ symbol: 'AAPL', interval: '1d' });
    assert(performance.now() - t0 < 4000, 'no waiting (8 s) for a refresh that is not happening');
    assertEquals([s.status, s.body.candles!.at(-1)!.t], [200, TUE_D]);
    assertEquals([a.status, a.body.quota], [503, true]);
  }
  assertEquals(quotaRpcs(), rpcs, 'no quota attempts while held');
  assertEquals([db.fetchState('SPY', '1d')!.fetched_at, db.fetchState('AAPL', '1d')!.fetched_at], held);
  assertEquals([av.calls.length, avQuota()], [3, 3]);

  // A new UTC day: fresh budget, both refresh once.
  clock.now = Dt(2026, 9, 24, 0, 0, 1);
  const s = await call({ symbol: 'SPY', interval: '1d' });
  const a = await call({ symbol: 'AAPL', interval: '1d' });
  assertEquals([s.status, s.body.stale, s.body.candles!.at(-1)!.t], [200, undefined, WED_D]);
  assertEquals([a.status, a.body.candles!.length], [200, 100]);
  assertEquals(av.calls.length, 5);
  assertEquals(db.quotaUsed('alphavantage', Dt(2026, 9, 23, 12)), 3, 'yesterday never went over the limit');
  assertEquals(avQuota(), 2);
});

Deno.test('20 concurrent cold requests for different series never spend more than the daily limit', async () => {
  fresh(WED, { limit: 10 });
  av.delayMs = 15; // calls overlap
  const series = AV_IDS.flatMap((id) => [[id, '1d'], [id, '1w']]).slice(0, 20);
  const first = await Promise.all(series.map(([symbol, interval]) => call({ symbol, interval })));
  const ok = first.filter((r) => r.status === 200);
  const quota = first.filter((r) => r.status === 503 && r.body.quota === true);
  assertEquals([ok.length, quota.length], [10, 10], JSON.stringify(first.map((r) => r.status)));
  assertEquals([av.calls.length, avQuota()], [10, 10]);
  for (const r of ok) assert(r.body.candles!.length > 0);
  // Again: the cached ten are served, the other ten answer 503 at once; nothing more is spent.
  const second = await Promise.all(series.map(([symbol, interval]) => call({ symbol, interval })));
  for (let i = 0; i < series.length; i++) assertEquals(second[i].status, first[i].status, series[i].join(' '));
  assertEquals([av.calls.length, avQuota()], [10, 10]);
});

Deno.test('cold series, concurrent requests: one call, everyone gets the candles', async () => {
  fresh(WED);
  av.delayMs = 120;
  const rs = await Promise.all(Array.from({ length: 8 }, () => call({ symbol: 'SPY', interval: '1d' })));
  for (const r of rs) {
    assertEquals(r.status, 200);
    assertEquals(r.body.candles!.length, 100);
    assertEquals(r.body.source, 'alphavantage');
  }
  assertEquals([av.calls.length, avQuota()], [1, 1]);
});

Deno.test("windows older than compact's reach are answered from the cache without spending quota", async () => {
  fresh(WED);
  // Cold, and far older than the ~100 candles compact returns: nothing to fetch, nothing claimed.
  const cold = await call({ symbol: 'SPY', interval: '1d', end: WED - 200 * DAY, limit: 50 });
  assertEquals([cold.status, cold.body.candles], [200, []]);
  assertEquals(cold.headers.get('Cache-Control'), 'no-store', 'never filled: the answer may change with the first refresh');
  assertEquals(av.calls.length, 0);
  assertEquals(db.fetchState('SPY', '1d'), undefined);

  await call({ symbol: 'SPY', interval: '1d' });
  assertEquals(av.calls.length, 1);
  const oldest = db.candles('SPY', '1d')[0].t;
  assert(WED - oldest > 130 * DAY, '100 trading days span ~145 calendar days');
  // Inside what the refresh cached: served. Older: empty. Neither calls Alpha Vantage.
  const inCache = await call({ symbol: 'SPY', interval: '1d', end: WED - 110 * DAY, limit: 20 });
  assertEquals(inCache.body.candles!.length, 20);
  const partly = await call({ symbol: 'SPY', interval: '1d', end: oldest + 5 * DAY, limit: 300 });
  assertEquals(partly.body.candles![0].t, oldest);
  assertEquals(partly.body.stale, undefined);
  const older = await call({ symbol: 'SPY', interval: '1d', end: WED - 300 * DAY, limit: 300 });
  assertEquals(older.body.candles, []);
  const big = await call({ symbol: 'SPY', interval: '1d', limit: 1000 });
  assertEquals([big.status, big.body.candles!.length, big.body.stale], [200, 100, undefined]);
  assertEquals([av.calls.length, avQuota()], [1, 1]);

  // After the close, an unreachable window still costs nothing; a reachable one takes the due refresh.
  clock.now = Dt(2026, 9, 23, 21, 31);
  await call({ symbol: 'SPY', interval: '1d', end: WED - 200 * DAY, limit: 300 });
  assertEquals(av.calls.length, 1);
  const recent = await call({ symbol: 'SPY', interval: '1d', end: WED - 10 * DAY, limit: 20 });
  assertEquals(recent.body.candles!.length, 20);
  assertEquals(av.calls.length, 2);
  await call({ symbol: 'SPY', interval: '1d' });
  assertEquals([av.calls.length, avQuota()], [2, 2]);
});

Deno.test("Alpha Vantage's own daily limit (key used elsewhere) counts as quota: 503 quota, held until 00:00 UTC", async () => {
  fresh(WED);
  av.keyDailyLimit = 1;
  assertEquals((await call({ symbol: 'SPY', interval: '1d' })).status, 200);
  const q = await call({ symbol: 'QQQ', interval: '1d' });
  assertEquals([q.status, q.body.quota], [503, true]);
  assertEquals(av.calls.length, 2);
  for (const t of [WED + HOUR, Dt(2026, 9, 23, 22)]) {
    clock.now = t;
    assertEquals((await call({ symbol: 'QQQ', interval: '1d' })).status, 503);
  }
  assertEquals(av.calls.length, 2, 'not retried before midnight');
  clock.now = Dt(2026, 9, 24, 0, 5);
  assertEquals((await call({ symbol: 'QQQ', interval: '1d' })).status, 200);
  assertEquals(av.calls.length, 3);
});

// ---------------------------------------------------------------------------------------
// Provider failures
// ---------------------------------------------------------------------------------------

Deno.test('Alpha Vantage failures: stale cache and a retry an hour later (not a loop); plan errors wait for the next close', async () => {
  fresh(WED);
  const warm = await call({ symbol: 'SPY', interval: '1d' });
  clock.now = Dt(2026, 9, 23, 21, 31);
  av.always = 500;
  const r = await call({ symbol: 'SPY', interval: '1d' });
  assertEquals([r.status, r.body.stale, r.headers.get('Cache-Control')], [200, true, 'no-store']);
  assertEquals(r.body.candles, warm.body.candles);
  assertEquals(av.calls.length, 2);
  for (const t of [Dt(2026, 9, 23, 21, 40), Dt(2026, 9, 23, 22, 30)]) {
    clock.now = t;
    assertEquals((await call({ symbol: 'SPY', interval: '1d' })).status, 200);
  }
  assertEquals(av.calls.length, 2, 'each failed call cost a unit: no retry for an hour');
  clock.now = Dt(2026, 9, 23, 22, 32);
  await call({ symbol: 'SPY', interval: '1d' });
  assertEquals(av.calls.length, 3);
  av.always = null;
  clock.now = Dt(2026, 9, 23, 23, 33);
  const ok = await call({ symbol: 'SPY', interval: '1d' });
  assertEquals([ok.body.stale, ok.body.candles!.at(-1)!.t], [undefined, WED_D]);
  assertEquals(av.calls.length, 4);

  // A plan error on a cold series: 502 at once, and no new attempt before the next FX close.
  fresh(WED);
  av.always = () => new Response(JSON.stringify({ Information: AV_MESSAGES.premium }), { status: 200 });
  const eur = await call({ symbol: 'EUR-USD', interval: '1d' });
  assertEquals([eur.status, eur.body.quota], [502, undefined]);
  for (const t of [WED + HOUR, Dt(2026, 9, 23, 22, 29)]) {
    clock.now = t;
    const t0 = performance.now();
    assertEquals((await call({ symbol: 'EUR-USD', interval: '1d' })).status, 502);
    assert(performance.now() - t0 < 4000, 'a failed first fill is not waited for (8 s)');
  }
  assertEquals(av.calls.length, 1);
  av.always = null;
  clock.now = Dt(2026, 9, 23, 22, 31);
  const later = await call({ symbol: 'EUR-USD', interval: '1d' });
  assertEquals([later.status, later.body.candles!.at(-1)!.t], [200, WED_D]);
  assertEquals(av.calls.length, 2);

  // "Invalid API call … for TIME_SERIES_DAILY." is a request error, not the daily limit.
  fresh(WED);
  delete av.avMarkets.GLD;
  const gld = await call({ symbol: 'GLD', interval: '1d' });
  assertEquals([gld.status, gld.body.quota], [502, undefined]);
  clock.now = Dt(2026, 9, 23, 21, 29);
  assertEquals((await call({ symbol: 'GLD', interval: '1d' })).status, 502);
  assertEquals(av.calls.length, 1, 'held until the next close');
  assertEquals((await call({ symbol: 'SPY', interval: '1d' })).status, 200, 'other markets are unaffected');
});

Deno.test('burst limit (one call per second on the free key): the rejected series retries two minutes later', async () => {
  fresh(WED);
  av.burstLimit = true;
  const [a, b] = await Promise.all([call({ symbol: 'SPY', interval: '1d' }), call({ symbol: 'QQQ', interval: '1d' })]);
  assertEquals([a.status, b.status].sort(), [200, 502]);
  const failed = a.status === 502 ? 'SPY' : 'QQQ';
  assertEquals(av.calls.length, 2);
  clock.now = WED + MIN;
  assertEquals((await call({ symbol: failed, interval: '1d' })).status, 502);
  assertEquals(av.calls.length, 2);
  clock.now = WED + 3 * MIN;
  assertEquals((await call({ symbol: failed, interval: '1d' })).status, 200);
  assertEquals(av.calls.length, 3);
});

Deno.test('pacing: calls from one instance are spaced out (ALPHAVANTAGE_SPACING_MS)', async () => {
  fresh(WED, { spacingMs: 250 });
  const rs = await Promise.all(['SPY', 'QQQ', 'GLD'].map((symbol) => call({ symbol, interval: '1d' })));
  for (const r of rs) assertEquals(r.status, 200);
  const at = av.calls.map((c) => c.real).sort((x, y) => x - y);
  assertEquals(at.length, 3);
  // Each gap is the spacing give or take the (fake) database latency before the call.
  for (let i = 1; i < at.length; i++) assert(at[i] - at[i - 1] >= 150, `calls ${Math.round(at[i] - at[i - 1])} ms apart`);
});

// ---------------------------------------------------------------------------------------
// Exchange feeds are off by default; crypto
// ---------------------------------------------------------------------------------------

Deno.test('exchange feeds are off by default: BTC-USD 1d comes from Alpha Vantage, Coinbase and Kraken are never called', async () => {
  fresh(WED);
  const r = await call({ symbol: 'BTC-USD', interval: '1d' });
  assertEquals(r.status, 200);
  assertEquals([r.body.source, r.body.delayed, r.body.attribution], ['alphavantage', true, 'Market data: Alpha Vantage']);
  assertEquals(av.calls.map((c) => c.url.searchParams.get('function')), ['DIGITAL_CURRENCY_DAILY']);
  assertEquals([av.calls[0].url.searchParams.get('symbol'), av.calls[0].url.searchParams.get('market')], ['BTC', 'USD']);
  assertEquals(r.body.candles!.length, 300);
  assertWellFormed(r.body.candles!, '1d');
  assertEquals(r.body.candles!.at(-1)!.t, TUE_D, 'the last complete UTC day');
  // Crypto has no weekends: every day is there.
  const cs = r.body.candles!;
  for (let i = 1; i < cs.length; i++) assertEquals(cs[i].t - cs[i - 1].t, DAY);
  for (const [symbol, interval] of [['BTC-USD', '1m'], ['BTC-USD', '1h'], ['SOL-USD', '1d']]) {
    assertEquals((await call({ symbol, interval })).body.unconfigured, true, `${symbol} ${interval}`);
  }
  // The crypto day closes at 00:30 UTC.
  clock.now = Dt(2026, 9, 24, 0, 29);
  await call({ symbol: 'BTC-USD', interval: '1d' });
  assertEquals(av.calls.length, 1);
  clock.now = Dt(2026, 9, 24, 0, 31);
  const next = await call({ symbol: 'BTC-USD', interval: '1d' });
  assertEquals(next.body.candles!.at(-1)!.t, WED_D);
  assertEquals(av.calls.length, 2);
  assertEquals(cb.calls.length + kr.calls.length, 0);
});

Deno.test('MARKET_EXCHANGE_FEEDS turns the exchanges on: kraken alone, then both (Coinbase first; weekly stays Alpha Vantage)', async () => {
  fresh(WED, { feeds: 'kraken' });
  const k = await call({ symbol: 'BTC-USD', interval: '1m' });
  assertEquals([k.status, k.body.source, k.body.delayed], [200, 'kraken', false]);
  assertEquals([cb.calls.length, kr.calls.length], [0, 1]);
  assertEquals((await call({ symbol: 'BTC-USD', interval: '6h' })).body.unconfigured, true, 'Kraken has no 6h');

  fresh(WED, { feeds: ' Coinbase , KRAKEN ' });
  const c = await call({ symbol: 'BTC-USD', interval: '1d' });
  assertEquals([c.status, c.body.source], [200, 'coinbase']);
  assertEquals([cb.calls.length, kr.calls.length, av.calls.length], [1, 0, 0]);
  const w = await call({ symbol: 'BTC-USD', interval: '1w' });
  assertEquals([w.status, w.body.source], [200, 'alphavantage']);
  assertEquals(av.calls.map((x) => x.url.searchParams.get('function')), ['DIGITAL_CURRENCY_WEEKLY']);
  assertEquals(cb.calls.length, 1, 'Coinbase has no weekly candles');
});

Deno.test('feeds on but both exchanges down on a cold cache: Alpha Vantage fills it once, then never again', async () => {
  fresh(WED, { feeds: 'coinbase,kraken' });
  cb.always = 500;
  kr.always = 500;
  const r = await call({ symbol: 'ETH-USD', interval: '1d' });
  assertEquals([r.status, r.body.source, r.body.attribution], [200, 'alphavantage', 'Market data: Alpha Vantage']);
  assertEquals(r.body.candles!.length, 300);
  assertEquals([cb.calls.length, kr.calls.length, av.calls.length], [1, 1, 1]);
  // The exchanges are retried on their own schedule; the budget is not spent again.
  clock.now = WED + 31 * MIN;
  const again = await call({ symbol: 'ETH-USD', interval: '1d' });
  assertEquals([again.status, again.body.stale], [200, true]);
  assertEquals(av.calls.length, 1);
  cb.always = null;
  kr.always = null;
  clock.now = WED + 32 * MIN;
  const back = await call({ symbol: 'ETH-USD', interval: '1d' });
  assertEquals([back.body.source, back.body.stale], ['coinbase', undefined]);
  assertEquals([av.calls.length, avQuota()], [1, 1]);
});

// ---------------------------------------------------------------------------------------
// Premium key
// ---------------------------------------------------------------------------------------

Deno.test('premium key: full daily history and intraday (delayed, refreshed at most hourly)', async () => {
  fresh(WED, { premium: true });
  av.premium = true;
  const d = await call({ symbol: 'NVDA', interval: '1d', limit: 1000 });
  assertEquals(d.status, 200);
  assertEquals(av.calls[0].url.searchParams.get('outputsize'), 'full');
  assertEquals(d.body.candles!.length, 1000);
  assert(db.candles('NVDA', '1d').length > 6000, 'the whole daily history is cached');

  const m = await call({ symbol: 'SPY', interval: '5m' });
  assertEquals([m.status, m.body.delayed, m.body.source], [200, true, 'alphavantage']);
  const u = av.calls[1].url;
  assertEquals([u.searchParams.get('function'), u.searchParams.get('interval')], ['TIME_SERIES_INTRADAY', '5min']);
  assertEquals(m.body.candles!.length, 300);
  assertWellFormed(m.body.candles!, '5m');
  // US/Eastern stamps are converted to UTC: the session is 13:30–20:00 UTC in September.
  for (const k of m.body.candles!) assert(k.t % DAY >= 13.5 * HOUR && k.t % DAY < 20 * HOUR);
  assertEquals(m.body.candles!.at(-1)!.t, WED - 5 * MIN);
  clock.now = WED + 30 * MIN;
  await call({ symbol: 'SPY', interval: '5m' });
  assertEquals(av.calls.length, 2);
  clock.now = WED + 61 * MIN;
  await call({ symbol: 'SPY', interval: '5m' });
  assertEquals(av.calls.length, 3);
});

// ---------------------------------------------------------------------------------------
// Hardening: the budget, close times, splits, the key, browser caching, input
// ---------------------------------------------------------------------------------------

const fnOf = (c: { url: URL }) => c.url.searchParams.get('function');

/** Runs `fn` with every console method captured (arguments stringified, errors with cause and stack). */
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string }> {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  const out: string[] = [];
  const show = (a: unknown) =>
    a instanceof Error ? `${a.message} ${a.stack} ${String(a.cause)}` : typeof a === 'string' ? a : JSON.stringify(a);
  for (const m of methods) console[m] = (...args: unknown[]) => void out.push(args.map(show).join(' '));
  try {
    return { result: await fn(), logs: out.join('\n') };
  } finally {
    methods.forEach((m, i) => (console[m] = saved[i]));
  }
}

Deno.test('close times follow US daylight saving (90 min after the New York close); weekly boundaries on Saturday / Monday 00:30 UTC', () => {
  const spy = { kind: 'equity' as const, symbol: 'SPY' };
  const eur = { kind: 'fx' as const, from: 'EUR', to: 'USD' };
  const btc = { kind: 'crypto' as const, symbol: 'BTC', market: 'USD' };
  // Summer (EDT): stocks 21:30 UTC, FX 22:30 UTC. Winter (EST): 22:30 and 23:30 UTC.
  assertEquals(lastBoundaryMs(spy, '1d', Dt(2026, 9, 23, 23)), Dt(2026, 9, 23, 21, 30));
  assertEquals(lastBoundaryMs(eur, '1d', Dt(2026, 9, 23, 23)), Dt(2026, 9, 23, 22, 30));
  assertEquals(lastBoundaryMs(spy, '1d', Dt(2026, 12, 9, 22, 29)), Dt(2026, 12, 8, 22, 30));
  assertEquals(lastBoundaryMs(spy, '1d', Dt(2026, 12, 9, 22, 30)), Dt(2026, 12, 9, 22, 30));
  assertEquals(lastBoundaryMs(eur, '1d', Dt(2026, 12, 9, 23, 29)), Dt(2026, 12, 8, 23, 30));
  assertEquals(lastBoundaryMs(eur, '1d', Dt(2026, 12, 9, 23, 45)), Dt(2026, 12, 9, 23, 30));
  // DST ends on Sunday 1 Nov 2026: Friday 30 Oct closes at 21:30 UTC, Monday 2 Nov at 22:30 UTC.
  assertEquals(lastBoundaryMs(spy, '1d', Dt(2026, 11, 2, 22, 0)), Dt(2026, 10, 30, 21, 30));
  assertEquals(lastBoundaryMs(spy, '1d', Dt(2026, 11, 2, 22, 31)), Dt(2026, 11, 2, 22, 30));
  // DST starts on Sunday 8 Mar 2026: Friday 6 Mar 22:30 UTC, Monday 9 Mar 21:30 UTC.
  assertEquals(lastBoundaryMs(spy, '1d', Dt(2026, 3, 9, 21, 0)), Dt(2026, 3, 6, 22, 30));
  assertEquals(lastBoundaryMs(spy, '1d', Dt(2026, 3, 9, 21, 31)), Dt(2026, 3, 9, 21, 30));
  // Weekends: nothing new for stocks and FX; crypto every day at 00:30 UTC (the UTC day before).
  assertEquals(lastBoundaryMs(eur, '1d', Dt(2026, 9, 27, 12)), Dt(2026, 9, 25, 22, 30));
  assertEquals(lastBoundaryMs(btc, '1d', Dt(2026, 9, 27, 0, 29)), Dt(2026, 9, 26, 0, 30));
  assertEquals(lastBoundaryMs(btc, '1d', Dt(2026, 9, 27, 12)), Dt(2026, 9, 27, 0, 30));
  // Weekly: Saturday 00:30 UTC for stocks and FX (off Friday, which carries every daily refresh),
  // Monday 00:30 UTC for crypto — whatever the season.
  assertEquals(lastBoundaryMs(spy, '1w', Dt(2026, 9, 25, 23, 59)), Dt(2026, 9, 19, 0, 30));
  assertEquals(lastBoundaryMs(spy, '1w', Dt(2026, 9, 26, 0, 31)), Dt(2026, 9, 26, 0, 30));
  assertEquals(lastBoundaryMs(eur, '1w', Dt(2026, 12, 12, 0, 30)), Dt(2026, 12, 12, 0, 30));
  assertEquals(lastBoundaryMs(btc, '1w', Dt(2026, 9, 27, 23)), Dt(2026, 9, 21, 0, 30));
  // Monotone and never in the future (the refresh scheduler searches it), across both transitions.
  for (const av of [spy, eur, btc]) {
    for (const interval of ['1d', '1w'] as const) {
      for (const [from, to] of [[Dt(2026, 2, 25), Dt(2026, 3, 20)], [Dt(2026, 10, 20), Dt(2026, 11, 12)]]) {
        let prev = -Infinity;
        for (let t = from; t < to; t += 10 * MIN) {
          const b = lastBoundaryMs(av, interval, t);
          assert(b <= t && b >= prev, `${av.kind} ${interval} at ${new RealDate(t).toISOString()}`);
          prev = b;
        }
      }
    }
  }
});

Deno.test('US daylight saving: in winter a stock is refreshed at 22:30 UTC (the close is an hour later), FX at 23:30 UTC', async () => {
  const DEC_WED = Dt(2026, 12, 9, 15);
  fresh(DEC_WED);
  av.publishLagMin = 45; // the day's candle appears 45 min after the 16:00 New York close: 21:45 UTC in winter
  await call({ symbol: 'SPY', interval: '1d' });
  await call({ symbol: 'EUR-USD', interval: '1d' });
  assertEquals(av.calls.length, 2);
  // 21:31 UTC is the summer boundary; in winter the session closed only 31 min ago.
  clock.now = Dt(2026, 12, 9, 21, 31);
  assertEquals((await call({ symbol: 'SPY', interval: '1d' })).body.candles!.at(-1)!.t, Dt(2026, 12, 8));
  assertEquals(av.calls.length, 2, 'no refresh before the winter boundary');
  clock.now = Dt(2026, 12, 9, 22, 31);
  const spy = await call({ symbol: 'SPY', interval: '1d' });
  assertEquals(spy.body.candles!.at(-1)!.t, Dt(2026, 12, 9), "Wednesday's candle, on the first refresh after the close");
  assertEquals((await call({ symbol: 'EUR-USD', interval: '1d' })).body.candles!.at(-1)!.t, Dt(2026, 12, 8));
  assertEquals(av.calls.length, 3, 'FX waits for 23:30 UTC in winter');
  clock.now = Dt(2026, 12, 9, 23, 31);
  assertEquals((await call({ symbol: 'EUR-USD', interval: '1d' })).body.candles!.at(-1)!.t, Dt(2026, 12, 9));
  assertEquals([av.calls.length, db.quotaUsed('alphavantage', DEC_WED)], [4, 4]);

  // Across the change (Friday 30 Oct in EDT, Monday 2 Nov in EST): one refresh each, at the right time.
  fresh(Dt(2026, 10, 30, 21, 35));
  assertEquals((await call({ symbol: 'SPY', interval: '1d' })).body.candles!.at(-1)!.t, Dt(2026, 10, 30));
  for (const t of [Dt(2026, 10, 31, 12), Dt(2026, 11, 1, 23), Dt(2026, 11, 2, 21, 45)]) {
    clock.now = t;
    await call({ symbol: 'SPY', interval: '1d' });
  }
  assertEquals(av.calls.length, 1);
  clock.now = Dt(2026, 11, 2, 22, 31);
  assertEquals((await call({ symbol: 'SPY', interval: '1d' })).body.candles!.at(-1)!.t, Dt(2026, 11, 2));
  assertEquals(av.calls.length, 2);
});

Deno.test('weekly: a week that ends on a holiday Friday (Good Friday) is keyed by its Monday and refreshed once, Saturday 00:30 UTC', async () => {
  fresh(Dt(2026, 4, 1, 12)); // Wednesday
  av.avMarkets.SPY = { ...av.avMarkets.SPY, holidays: [...HOLIDAYS, Dt(2026, 4, 3)] };
  const first = await call({ symbol: 'SPY', interval: '1w' });
  assertEquals(first.body.candles!.at(-1)!.t, Dt(2026, 3, 30), 'the week in progress');
  for (const t of [Dt(2026, 4, 2, 22), Dt(2026, 4, 3, 23), Dt(2026, 4, 4, 0, 29)]) {
    clock.now = t;
    await call({ symbol: 'SPY', interval: '1w' });
  }
  assertEquals(av.calls.length, 1);
  clock.now = Dt(2026, 4, 4, 0, 31);
  const sat = await call({ symbol: 'SPY', interval: '1w' });
  assertEquals(av.calls.length, 2);
  const lastRow = av.weeklyRows('SPY').at(-1)!;
  assertEquals(lastRow.date, '2026-04-02', "Alpha Vantage dates the week by Thursday");
  const week = sat.body.candles!.at(-1)!;
  assertEquals([week.t, week.c], [Dt(2026, 3, 30), +lastRow.adj.toFixed(4)]);
  assertWellFormed(sat.body.candles!, '1w');
});

Deno.test('parse: a split during the week (after its first session) leaves no crash in the weekly candle; Monday splits, dividends, duplicates, Sunday dates', () => {
  const weekly = (rows: Record<string, [number, number, number, number, number]>) => ({
    'Meta Data': { '1. Information': 'Weekly Adjusted Prices and Volumes' },
    'Weekly Adjusted Time Series': Object.fromEntries(Object.entries(rows).map(([d, [o, h, l, c, adj]]) => [d, {
      '1. open': String(o), '2. high': String(h), '3. low': String(l), '4. close': String(c),
      '5. adjusted close': String(adj), '6. volume': '1000', '7. dividend amount': '0.0000',
    }])),
  });
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 1e-9;
  const eq = (got: Candle, want: [number, number, number, number, number]) =>
    assert(want.every((x, i) => near([got.t, got.o, got.h, got.l, got.c][i], x)), `${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);

  // TSLA-like 3:1 split on Thursday 25 Aug 2022: Mon–Wed trade at ~900, Thu–Fri at ~290.
  const fwd = parseAlphaVantage(weekly({
    '2022-08-19': [870, 940, 860, 890, 890 / 3],
    '2022-08-26': [891, 902, 284, 288, 288],
    '2022-09-02': [287, 300, 270, 275, 275],
  }), '1w');
  eq(fwd[0], [Dt(2022, 8, 15), 290, 940 / 3, 860 / 3, 890 / 3]);
  eq(fwd[1], [Dt(2022, 8, 22), 297, 902 / 3, 284, 288]); // open and high were pre-split, the low post-split
  eq(fwd[2], [Dt(2022, 8, 29), 287, 300, 270, 275]);
  // Reverse 1:10 split on a Wednesday: the open and the low are pre-split, the high post-split.
  const rev = parseAlphaVantage(weekly({ '2023-05-12': [2.0, 2.2, 1.9, 2.1, 21], '2023-05-19': [2.1, 23, 1.95, 22, 22] }), '1w');
  eq(rev[1], [Dt(2023, 5, 15), 21, 23, 19.5, 22]);
  // A split before the week's first session (Monday): the whole week is post-split — one factor.
  const mon = parseAlphaVantage(weekly({ '2020-08-28': [480, 500, 470, 499, 124.75], '2020-09-04': [127, 137, 110, 120, 120] }), '1w');
  eq(mon[1], [Dt(2020, 8, 31), 127, 137, 110, 120]);
  // A dividend (factor 0.99 → 1) is not a split.
  const div = parseAlphaVantage(weekly({ '2024-03-15': [100, 104, 99, 102, 100.98], '2024-03-22': [102, 105, 101, 104, 104] }), '1w');
  eq(div[1], [Dt(2024, 3, 18), 102, 105, 101, 104]);
  // Two rows in one week (a partial Thursday and the Friday): one candle, the later row — the
  // cache write would otherwise fail on a duplicate key and be retried (and paid for) again.
  const dup = parseAlphaVantage(weekly({ '2022-09-01': [287, 290, 280, 281, 281], '2022-09-02': [287, 300, 270, 275, 275] }), '1w');
  assertEquals(dup.length, 1);
  eq(dup[0], [Dt(2022, 8, 29), 287, 300, 270, 275]);
  // Crypto / FX weeks dated by Sunday or Saturday belong to the Monday before.
  const sun = parseAlphaVantage({
    'Meta Data': {},
    'Time Series (Digital Currency Weekly)': { '2026-09-27': { '1. open': '1', '2. high': '2', '3. low': '0.5', '4. close': '1.5', '5. volume': '9' }, '2026-09-19': { '1. open': '1', '2. high': '2', '3. low': '0.5', '4. close': '1.5', '5. volume': '9' } },
  }, '1w');
  assertEquals(sun.map((k) => k.t), [Dt(2026, 9, 14), Dt(2026, 9, 21)]);
});

Deno.test('a split in the middle of a week (TSLA 3:1 on Thursday 25 Aug 2022) is stored without a fake crash', async () => {
  fresh(WED);
  av.avMarkets.TSLA = { ...av.avMarkets.TSLA, splits: [{ at: Dt(2022, 8, 25), ratio: 3 }, { at: Dt(2020, 8, 31), ratio: 5 }] };
  assertEquals((await call({ symbol: 'TSLA', interval: '1w' })).status, 200);
  const stored = db.candles('TSLA', '1w');
  const naive = av.adjustedWeekly('TSLA'); // every week scaled by its own adjusted/raw close
  const ideal = av.idealWeekly('TSLA'); // aggregated from split-adjusted daily prices
  const W = Dt(2022, 8, 22);
  const at = <T extends { t: number }>(list: T[], t: number) => list.find((k) => k.t === t)!;
  const [s, n, i] = [at(stored, W), at(naive, W), at(ideal, W)];
  assert(n.o / n.c > 2.5, 'scaling the week by its closing factor alone would open 3× above the close');
  const rel = (a: number, b: number) => Math.abs(a / b - 1);
  assert(rel(s.o, i.o) < 1e-4 && rel(s.c, i.c) < 1e-4, `open/close ${JSON.stringify([s, i])}`);
  assert(s.h >= Math.max(s.o, s.c) && s.h <= i.h * (1 + 1e-4) && s.h >= i.h * 0.95, `high ${s.h} vs ${i.h}`);
  assert(s.l <= Math.min(s.o, s.c) && s.l >= i.l * (1 - 1e-4) && s.l <= i.l * 1.05, `low ${s.l} vs ${i.l}`);
  // Every other week (including the Monday split of Aug 2020) is exactly the adjusted/raw scaling.
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 1e-5;
  for (const e of naive) {
    if (e.t === W) continue;
    const k = at(stored, e.t);
    assert(close(k.o, e.o) && close(k.h, e.h) && close(k.l, e.l) && close(k.c, e.c), `week ${new RealDate(e.t).toISOString()}`);
  }
  const prev = at(stored, W - WEEK);
  assert(s.o / prev.c > 0.9 && s.o / prev.c < 1.1, 'the split week opens where the week before closed');
});

Deno.test('the API key never reaches logs or responses; a network error (URL in its message) is retried in an hour, not at the close', async () => {
  fresh(WED);
  const key = av.apiKey;
  // Deno's fetch errors carry the request URL — key included — in their message or cause.
  av.always = (url) => {
    throw new TypeError(`error sending request for url (${url}): client error (Connect)`, { cause: new Error(`tcp connect error: ${url}`) });
  };
  const { result: spy, logs } = await captureLogs(() => call({ symbol: 'SPY', interval: '1d' }));
  assertEquals(spy.status, 502);
  assertMatch(logs, /alphavantage failed for SPY 1d: Alpha Vantage request failed/);
  assertMatch(logs, /apikey=\[redacted\]/);
  assert(!logs.includes(key), `the key is in the logs: ${logs}`);
  assert(!JSON.stringify(spy.body).includes(key));
  // A proxy page that echoes the URL (not JSON), an HTTP error, and an answer quoting the key.
  const pages: [string, (url: URL) => Response][] = [
    ['QQQ', (url) => new Response(`<html><body>Bad gateway: ${url}</body></html>`, { status: 200, headers: { 'Content-Type': 'text/html' } })],
    ['GLD', (url) => new Response(`upstream ${url} failed`, { status: 502 })],
    ['AAPL', () => new Response(JSON.stringify({ 'Error Message': `Invalid API call for apikey=${key} (key ${key})` }), { status: 200 })],
  ];
  for (const [symbol, answer] of pages) {
    av.always = answer;
    const { result, logs } = await captureLogs(() => call({ symbol, interval: '1d' }));
    assertEquals(result.status, 502, symbol);
    assert(logs.length > 0 && !logs.includes(key), `${symbol}: ${logs}`);
    assert(!JSON.stringify(result.body).includes(key), symbol);
  }
  // With a cache, the failure answers stale — no key there either.
  av.always = null;
  clock.now = WED + 2 * HOUR;
  assertEquals((await call({ symbol: 'SPY', interval: '1d' })).status, 200);
  assertEquals(av.calls.filter((c) => c.url.searchParams.get('symbol') === 'SPY').length, 2, 'retried after an hour, not held to the close');
  clock.now = Dt(2026, 9, 23, 21, 31);
  av.always = (url) => {
    throw new TypeError(`error sending request for url (${url})`);
  };
  const { result: stale, logs: staleLogs } = await captureLogs(() => call({ symbol: 'SPY', interval: '1d' }));
  assertEquals([stale.status, stale.body.stale], [200, true]);
  assert(!staleLogs.includes(key) && !JSON.stringify(stale.body).includes(key));
});

Deno.test('a key pasted with spaces or a newline still works; a blank key is "not configured"', async () => {
  fresh(WED);
  Deno.env.set('ALPHAVANTAGE_API_KEY', `  ${av.apiKey}\n`);
  assertEquals((await call({ symbol: 'SPY', interval: '1d' })).status, 200);
  assertEquals(av.calls[0].url.searchParams.get('apikey'), av.apiKey);
  Deno.env.set('ALPHAVANTAGE_API_KEY', ' \n ');
  assertEquals((await call({ catalog: true })).body.status, 'unconfigured');
  const r = await call({ symbol: 'QQQ', interval: '1d' });
  assertEquals([r.status, r.body.unconfigured], [503, true]);
  assertEquals(av.calls.length, 1);
});

Deno.test('the key also works under ALPHA_VANTAGE_API_KEY; ALPHAVANTAGE_API_KEY wins when both are set', async () => {
  fresh(WED, { key: false });
  Deno.env.set('ALPHA_VANTAGE_API_KEY', ` ${av.apiKey}\n`);
  assertEquals((await call({ catalog: true })).body.status, 'ok');
  assertEquals((await call({ symbol: 'SPY', interval: '1d' })).status, 200);
  assertEquals(av.calls[0].url.searchParams.get('apikey'), av.apiKey);
  // A blank preferred name still falls back; a real one is used instead of the fallback.
  Deno.env.set('ALPHAVANTAGE_API_KEY', ' ');
  assertEquals((await call({ symbol: 'QQQ', interval: '1d' })).status, 200);
  assertEquals(av.calls[1].url.searchParams.get('apikey'), av.apiKey);
  Deno.env.set('ALPHAVANTAGE_API_KEY', av.apiKey);
  Deno.env.set('ALPHA_VANTAGE_API_KEY', 'other-key');
  assertEquals((await call({ symbol: 'GLD', interval: '1d' })).status, 200);
  assertEquals(av.calls[2].url.searchParams.get('apikey'), av.apiKey);
  Deno.env.delete('ALPHA_VANTAGE_API_KEY');
});

Deno.test('one series that keeps failing uses at most 4 units a day, so the other markets keep refreshing', async () => {
  fresh(WED);
  assertEquals((await call({ symbol: 'QQQ', interval: '1d' })).status, 200);
  // SPY: HTTP 500 every time. BTC: the response format changed (no time series). Pages keep asking.
  av.always = (url) => {
    if (url.searchParams.get('symbol') === 'SPY') return new Response('{}', { status: 500 });
    if (fnOf({ url }) === 'DIGITAL_CURRENCY_DAILY') return new Response(JSON.stringify({ 'Meta Data': {}, Data: {} }), { status: 200 });
    return undefined;
  };
  for (let t = WED; t <= Dt(2026, 9, 24, 23, 50); t += 10 * MIN) {
    clock.now = t;
    await call({ symbol: 'SPY', interval: '1d' });
    await call({ symbol: 'BTC-USD', interval: '1d' });
  }
  const perDay = (symbol: string, day: number) =>
    av.calls.filter((c) => c.url.searchParams.get('symbol') === symbol && c.at >= day && c.at < day + DAY).length;
  assertEquals([perDay('SPY', Dt(2026, 9, 23)), perDay('SPY', Dt(2026, 9, 24))], [4, 4]);
  assertEquals([perDay('BTC', Dt(2026, 9, 23)), perDay('BTC', Dt(2026, 9, 24))], [4, 4]);
  assertEquals(db.quotaUsed('alphavantage', Dt(2026, 9, 24)), 8);
  // Held until 00:00 UTC once the series' units are spent: 503 quota at once (no 8 s wait).
  const t0 = performance.now();
  const held = await call({ symbol: 'SPY', interval: '1d' });
  assertEquals([held.status, held.body.quota], [503, true]);
  assert(performance.now() - t0 < 4000);
  // QQQ refreshes normally.
  const qqq = await call({ symbol: 'QQQ', interval: '1d' });
  assertEquals([qqq.status, qqq.body.stale, qqq.body.candles!.at(-1)!.t], [200, undefined, Dt(2026, 9, 24)]);
});

Deno.test('weekly adjusted not on the plan: the fallback call is paced too (burst limit), and later weekly refreshes skip the adjusted attempt', async () => {
  fresh(WED, { spacingMs: 250 });
  av.premiumWeeklyAdjusted = true;
  av.burstRealMs = 200; // the free key's ~1 call per second, scaled down
  const msft = await call({ symbol: 'MSFT', interval: '1w' });
  assertEquals(msft.status, 200, JSON.stringify(msft.body));
  assertEquals(av.calls.map(fnOf), ['TIME_SERIES_WEEKLY_ADJUSTED', 'TIME_SERIES_WEEKLY']);
  assert(av.calls[1].real - av.calls[0].real >= 200, 'the second call waited for its slot');
  const aapl = await call({ symbol: 'AAPL', interval: '1w' });
  assertEquals(aapl.status, 200);
  assertEquals(av.calls.slice(2).map(fnOf), ['TIME_SERIES_WEEKLY'], 'one unit, not two');
  assertEquals(avQuota(), 3);
});

Deno.test('the budget running out between weekly adjusted and its fallback: 503 quota, held until 00:00 UTC (not a week)', async () => {
  fresh(WED, { limit: 1 });
  av.premiumWeeklyAdjusted = true;
  const r = await call({ symbol: 'MSFT', interval: '1w' });
  assertEquals([r.status, r.body.quota], [503, true]);
  assertEquals(av.calls.map(fnOf), ['TIME_SERIES_WEEKLY_ADJUSTED']);
  assertEquals(db.fetchState('MSFT', '1w')!.fetched_at + HOUR, Dt(2026, 9, 24));
  clock.now = Dt(2026, 9, 23, 23);
  assertEquals((await call({ symbol: 'MSFT', interval: '1w' })).body.quota, true);
  clock.now = Dt(2026, 9, 24, 0, 1);
  const next = await call({ symbol: 'MSFT', interval: '1w' });
  assertEquals(next.status, 200);
  assertEquals(av.calls.slice(1).map(fnOf), ['TIME_SERIES_WEEKLY']);
});

Deno.test('feeds on, exchanges down, cold cache and Alpha Vantage failing: the fallback has its own hold — no paid call per exchange retry', async () => {
  fresh(WED, { feeds: 'coinbase,kraken' });
  cb.always = 500;
  kr.always = 500;
  av.always = 500;
  for (let i = 0; i < 12; i++) {
    clock.now = WED + i * 6_000; // the exchange claim reopens after ~5 s
    assertEquals((await call({ symbol: 'ETH-USD', interval: '1d' })).status, 502);
  }
  assert(cb.calls.length >= 10, `the free exchanges are retried quickly (${cb.calls.length})`);
  assertEquals([av.calls.length, avQuota()], [1, 1], 'Alpha Vantage once, then held for an hour');
  clock.now = WED + 61 * MIN;
  av.always = null;
  const r = await call({ symbol: 'ETH-USD', interval: '1d' });
  assertEquals([r.status, r.body.source], [200, 'alphavantage']);
  assertEquals(av.calls.length, 2);

  // The budget is spent: 503 quota, and the fallback is not tried again before 00:00 UTC.
  fresh(WED, { feeds: 'coinbase,kraken', limit: 1 });
  cb.always = 500;
  kr.always = 500;
  assertEquals((await call({ symbol: 'SPY', interval: '1d' })).status, 200); // the day's only unit
  const first = await call({ symbol: 'BTC-USD', interval: '1d' });
  assertEquals([first.status, first.body.quota], [503, true]);
  const rpcs = quotaRpcs();
  for (let i = 1; i < 6; i++) {
    clock.now = WED + i * 6_000;
    const again = await call({ symbol: 'BTC-USD', interval: '1d' });
    assertEquals([again.status, again.body.quota], [503, true]);
  }
  assertEquals(quotaRpcs(), rpcs, 'no budget attempts while held');
  assertEquals(av.calls.length, 1);
});

Deno.test('browser caching: a window the cache does not fully cover yet is never kept for an hour', async () => {
  fresh(WED);
  await call({ symbol: 'SPY', interval: '1d' }); // cached up to Tuesday 22 Sep
  av.always = 500; // every refresh fails from now on
  clock.now = Dt(2026, 9, 28, 12); // Monday: Wed–Fri candles are missing
  assertEquals((await call({ symbol: 'SPY', interval: '1d' })).body.stale, true, 'the refresh claimer answers stale');
  // An older window that reaches the newest cached candle changes with the next refresh.
  const edge = await call({ symbol: 'SPY', interval: '1d', end: Dt(2026, 9, 25, 12), limit: 20 });
  assertEquals([edge.status, edge.body.stale, edge.body.candles!.at(-1)!.t], [200, undefined, Dt(2026, 9, 22)]);
  assertEquals(edge.headers.get('Cache-Control'), 'public, max-age=60');
  // A complete older window is final.
  const old = await call({ symbol: 'SPY', interval: '1d', end: Dt(2026, 9, 10), limit: 20 });
  assertEquals(old.headers.get('Cache-Control'), 'public, max-age=3600');
  // Days later: an older window that ends a week after the newest cached candle is stale.
  clock.now = Dt(2026, 10, 1, 12);
  assertEquals((await call({ symbol: 'SPY', interval: '1d' })).body.stale, true);
  const gap = await call({ symbol: 'SPY', interval: '1d', end: Dt(2026, 9, 29), limit: 20 });
  assertEquals([gap.status, gap.body.stale, gap.headers.get('Cache-Control')], [200, true, 'no-store']);
  assertEquals(av.calls.length, 3);
});

Deno.test('steady state: every market asked for every hour for a week spends 24 calls on the first day, then at most 14 a day', async () => {
  fresh(Dt(2026, 9, 22, 23)); // Tuesday 23:00 UTC, after every close: a cold cache
  const series = AV_IDS.flatMap((id) => [[id, '1d'], [id, '1w']]);
  const perDay: Record<string, number> = {};
  for (let t = clock.now; t < Dt(2026, 9, 30); t += HOUR) {
    clock.now = t;
    for (const [symbol, interval] of series) {
      const r = await call({ symbol, interval });
      assertEquals(r.status, 200, `${symbol} ${interval} at ${new RealDate(t).toISOString()}: ${JSON.stringify(r.body)}`);
      assertEquals(r.body.stale, undefined, `${symbol} ${interval} at ${new RealDate(t).toISOString()}`);
    }
  }
  for (const c of av.calls) {
    const d = new RealDate(c.at).toISOString().slice(0, 10);
    perDay[d] = (perDay[d] ?? 0) + 1;
  }
  // Tue: first fill. Wed–Fri: 7 stocks + 3 FX after their close, 2 crypto after 00:30. Sat: 2 crypto
  // + 10 weekly. Sun: 2 crypto. Mon: 10 + 2 + 2 crypto weekly. (Friday alone used to carry 22.)
  assertEquals(perDay, {
    '2026-09-22': 24, '2026-09-23': 12, '2026-09-24': 12, '2026-09-25': 12,
    '2026-09-26': 12, '2026-09-27': 2, '2026-09-28': 14, '2026-09-29': 12,
  });
});

Deno.test('input: prototype keys as symbol or interval, a smuggled __proto__ body, and a huge symbol are rejected without I/O', async () => {
  fresh(WED);
  for (const symbol of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', '__defineGetter__']) {
    const r = await call({ symbol, interval: '1d' });
    assertEquals(r.status, 400, symbol);
    assertMatch(String(r.body.error), /Unknown symbol/);
  }
  for (const interval of ['__proto__', 'constructor', 'toString', '1d/fallback']) {
    assertEquals((await call({ symbol: 'SPY', interval })).status, 400, interval);
  }
  const smuggled = await handler!(new Request('http://localhost/functions/v1/market-data', {
    method: 'POST',
    body: '{"__proto__": {"symbol": "SPY", "interval": "1d", "catalog": true}}',
    headers: { 'Content-Type': 'application/json' },
  }));
  assertEquals(smuggled.status, 400);
  const huge = await call({ symbol: 'X'.repeat(100_000), interval: '1d' });
  assertEquals(huge.status, 400);
  assert(String(huge.body.error).length < 80, 'the unknown symbol is not echoed in full');
  assertEquals(db.calls.length + av.calls.length, 0);
});

Deno.test('exchange feeds stay off for anything but their exact names in MARKET_EXCHANGE_FEEDS', async () => {
  for (const feeds of ['true', '1', 'yes', 'all', '*', 'on', 'coinbase-off', 'no-kraken', 'kraken=false', 'krakenx', 'coinbase.com', '']) {
    fresh(WED, { feeds });
    const cat = catalogOf(await call({ catalog: true }));
    assertEquals([cat['BTC-USD'].intervals, cat['BTC-USD'].live], [['1d', '1w'], false], `MARKET_EXCHANGE_FEEDS=${feeds}`);
    assertEquals(cat['SOL-USD'].intervals, [], feeds);
    assertEquals((await call({ symbol: 'BTC-USD', interval: '1m' })).body.unconfigured, true, feeds);
    const d = await call({ symbol: 'BTC-USD', interval: '1d' });
    assertEquals(d.body.source, 'alphavantage', feeds);
    assertEquals(cb.calls.length + kr.calls.length, 0, feeds);
  }
});

Deno.test('a failed first fill held for an hour: requests when the hold looks like a fresh claim answer at once (no 8 s wait)', async () => {
  fresh(WED);
  av.always = 500;
  assertEquals((await call({ symbol: 'SPY', interval: '1d' })).status, 502); // retried at 16:00: fetched_at = 15:30
  const held = db.fetchState('SPY', '1d')!.fetched_at;
  assertEquals(held, WED + 30 * MIN);
  for (const t of [held, held + 1, held + 30_000]) {
    clock.now = t;
    const t0 = performance.now();
    assertEquals((await call({ symbol: 'SPY', interval: '1d' })).status, 502);
    assert(performance.now() - t0 < 2000, 'no waiting for a refresh that is not happening');
  }
  assertEquals(av.calls.length, 1);
});

Deno.test('a request that started a moment before another instance claimed the first fill waits for it (no 502)', async () => {
  fresh(WED);
  let injected = false;
  db.intercept = (c) => {
    if (injected || c.table !== 'market_fetches' || c.method !== 'POST') return undefined;
    injected = true;
    // Another instance claims 51 ms after this request started (odd millisecond: a claim) …
    db.seed('market_fetches', [{ symbol: 'SPY', interval: '1d', fetched_at: WED + 51 }]);
    // … and its refresh lands 300 ms later.
    setTimeout(() => {
      db.seed('market_candles', av.dailyRows('SPY').slice(-100).map((r) => ({ symbol: 'SPY', interval: '1d', t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v })));
      db.seed('market_fetches', [{ symbol: 'SPY', interval: '1d', fetched_at: Dt(2026, 9, 23, 21), source: 'alphavantage' }]);
    }, 300);
    return undefined;
  };
  const r = await call({ symbol: 'SPY', interval: '1d' });
  assertEquals([r.status, r.body.candles?.length], [200, 100], JSON.stringify(r.body).slice(0, 200));
  assertEquals(av.calls.length, 0, 'this request never called Alpha Vantage itself');
});
