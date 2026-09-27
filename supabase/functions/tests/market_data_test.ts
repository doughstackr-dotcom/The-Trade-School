// Adversarial tests for supabase/functions/market-data (index.ts + providers.ts).
//
// Run (from the repo root):
//   DENO_DIR=/tmp/denotest/cache deno test --no-config --node-modules-dir=none \
//     --allow-env --allow-net=127.0.0.1 supabase/functions/tests/market_data_test.ts
//
// Nothing leaves the process: Deno.serve is stubbed to capture the handler, and fetch is
// routed to in-memory fakes of PostgREST, Coinbase Exchange and Kraken (market_data_fakes.ts).
// Every test counts upstream calls exactly.
import { assert, assertEquals, assertExists, assertMatch } from 'jsr:@std/assert@1';
import {
  clock,
  DAY,
  FakeCoinbase,
  FakeKraken,
  FakePostgrest,
  HOUR,
  installClock,
  installFetch,
  MIN,
  RealDate,
  seedOf,
  trueCandle,
} from './market_data_fakes.ts';

// ---------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------

const SUPABASE_URL = 'http://fake.supabase';
Deno.env.set('SUPABASE_URL', SUPABASE_URL);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role');

// 2026-09-27 12:00:30 UTC — 30 s into a minute, so the newest 1m candle is still forming.
const NOW0 = RealDate.UTC(2026, 8, 27, 12, 0, 30);
installClock(NOW0);

const db = new FakePostgrest();
const cb = new FakeCoinbase();
const kr = new FakeKraken();
const LISTINGS: Record<string, number> = {
  'BTC-USD': RealDate.UTC(2015, 0, 20),
  'ETH-USD': RealDate.UTC(2016, 4, 18),
  'SOL-USD': RealDate.UTC(2021, 5, 1),
  'LINK-USD': RealDate.UTC(2019, 5, 27),
  'AVAX-USD': RealDate.UTC(2021, 8, 30),
};
function resetMarkets() {
  cb.markets = {};
  for (const [id, listing] of Object.entries(LISTINGS)) cb.markets[id] = { listing };
  kr.markets = cb.markets; // same underlying market
  kr.pairs = { XBTUSD: 'BTC-USD', ETHUSD: 'ETH-USD', SOLUSD: 'SOL-USD', LINKUSD: 'LINK-USD', AVAXUSD: 'AVAX-USD' };
}
installFetch(db, cb, kr, SUPABASE_URL);

type Handler = (req: Request) => Promise<Response>;
let handler: Handler | null = null;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: Handler) => {
  handler = h;
  return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {}, addr: { hostname: '127.0.0.1', port: 0, transport: 'tcp' } };
};
await import('../market-data/index.ts');
assertExists(handler, 'market-data did not call Deno.serve');

const realRandom = Math.random;
function fresh(now = NOW0) {
  db.reset();
  cb.reset();
  kr.reset();
  resetMarkets();
  clock.now = now;
  Math.random = () => 0.5; // no random prune unless a test asks for it
}

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
type Result = { status: number; headers: Headers; body: Record<string, unknown> & { candles?: Candle[] } };

async function call(params: Record<string, unknown> | string | null, method = 'POST'): Promise<Result> {
  let req: Request;
  if (method === 'GET') {
    const qs = new URLSearchParams(params as Record<string, string>);
    req = new Request(`http://localhost/functions/v1/market-data?${qs}`, { method });
  } else if (method === 'POST') {
    const body = typeof params === 'string' ? params : JSON.stringify(params);
    req = new Request('http://localhost/functions/v1/market-data', { method, body, headers: { 'Content-Type': 'application/json' } });
  } else {
    req = new Request('http://localhost/functions/v1/market-data', { method });
  }
  const res = await handler!(req);
  const text = await res.text();
  let body: Result['body'];
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status, headers: res.headers, body };
}

const STEP: Record<string, number> = { '1m': MIN, '5m': 5 * MIN, '15m': 15 * MIN, '1h': HOUR, '6h': 6 * HOUR, '1d': DAY };

/** Candles are oldest-first, unique, aligned, and satisfy the table's CHECK constraint. */
function assertWellFormed(candles: Candle[], interval: string) {
  const step = STEP[interval];
  for (let i = 0; i < candles.length; i++) {
    const k = candles[i];
    assertEquals(Object.keys(k).sort(), ['c', 'h', 'l', 'o', 't', 'v']);
    for (const x of [k.t, k.o, k.h, k.l, k.c, k.v]) assert(typeof x === 'number' && Number.isFinite(x), `non-number in ${JSON.stringify(k)}`);
    assertEquals(k.t % step, 0, `candle ${k.t} not aligned to ${interval}`);
    assert(k.l <= Math.min(k.o, k.c) && Math.max(k.o, k.c) <= k.h && k.l > 0, `bad OHLC ${JSON.stringify(k)}`);
    assert(k.v >= 0);
    if (i) assert(k.t > candles[i - 1].t, 'candles must be strictly ascending');
  }
}

const cbRanges = () =>
  cb.calls.map((c) => [Date.parse(c.url.searchParams.get('start')!), Date.parse(c.url.searchParams.get('end')!)]);
const loadCalls = () => db.calls.filter((c) => c.method === 'GET' && c.table === 'market_candles');
const slot = (t: number, step: number) => Math.floor(t / step) * step;

// ---------------------------------------------------------------------------------------
// Transport: CORS, methods, response shape
// ---------------------------------------------------------------------------------------

Deno.test('CORS preflight answers without touching the database or providers', async () => {
  fresh();
  const res = await call(null, 'OPTIONS');
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  assertMatch(res.headers.get('Access-Control-Allow-Methods')!, /GET/);
  assertMatch(res.headers.get('Access-Control-Allow-Methods')!, /POST/);
  for (const h of ['authorization', 'x-client-info', 'apikey', 'content-type']) {
    assertMatch(res.headers.get('Access-Control-Allow-Headers')!, new RegExp(h));
  }
  assertEquals(db.calls.length + cb.calls.length + kr.calls.length, 0);
});

Deno.test('other methods get 405 with CORS and no-store', async () => {
  fresh();
  for (const m of ['PUT', 'DELETE', 'PATCH']) {
    const res = await call(null, m);
    assertEquals(res.status, 405);
    assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
    assertEquals(res.headers.get('Cache-Control'), 'no-store');
  }
  assertEquals(db.calls.length + cb.calls.length, 0);
});

// ---------------------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------------------

Deno.test('validation: unknown symbol, bad interval, prototype keys, bad bodies → 400, no I/O', async () => {
  fresh();
  const bad: [unknown, RegExp][] = [
    [{ symbol: 'NOPE-USD', interval: '1h' }, /Unknown symbol "NOPE-USD"/],
    [{ interval: '1h' }, /Unknown symbol ""/],
    [{ symbol: 'BTC-USD', interval: '2m' }, /interval must be one of/],
    [{ symbol: 'BTC-USD' }, /interval must be one of/],
    [{ symbol: 'BTC-USD', interval: '1H' }, /interval must be one of/],
    // Inherited Object.prototype keys must not pass `interval in INTERVAL_MS`.
    [{ symbol: 'BTC-USD', interval: 'toString' }, /interval must be one of/],
    [{ symbol: 'BTC-USD', interval: 'constructor' }, /interval must be one of/],
    [{ symbol: 'BTC-USD', interval: '__proto__' }, /interval must be one of/],
    [{ symbol: 'BTC-USD', interval: 'hasOwnProperty' }, /interval must be one of/],
    [{ symbol: '__proto__', interval: '1h' }, /Unknown symbol/],
    [{ symbol: 'BTC-USD', interval: '1h', end: 'yesterday' }, /end must be/],
    [{ symbol: 'BTC-USD', interval: '1h', end: {} }, /end must be/],
    // Seconds instead of ms (1970) and other pre-crypto timestamps are rejected, not fetched.
    [{ symbol: 'BTC-USD', interval: '1h', end: 1_790_000_000 }, /end must be/],
    [{ symbol: 'BTC-USD', interval: '1h', end: 0 }, /end must be/],
    [{ symbol: 'BTC-USD', interval: '1h', end: true }, /end must be/],
  ];
  for (const [params, re] of bad) {
    const res = await call(params as Record<string, unknown>);
    assertEquals(res.status, 400, `expected 400 for ${JSON.stringify(params)}, got ${res.status} ${JSON.stringify(res.body)}`);
    assertMatch(String(res.body.error), re);
    assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
    assertEquals(res.headers.get('Cache-Control'), 'no-store');
  }
  const unknown = await call({ symbol: 'NOPE-USD', interval: '1h' });
  assertEquals((unknown.body.symbols as string[]).includes('BTC-USD'), true);
  // Bodies that are not a JSON object.
  for (const body of ['null', '[1,2]', '"BTC-USD"', '42', 'not json', '']) {
    const res = await call(body);
    assertEquals(res.status, 400, `body ${body} → ${res.status}`);
    assertMatch(String(res.body.error), /Unknown symbol/);
  }
  // GET with query params validates the same way.
  const viaGet = await call({ symbol: 'BTC-USD', interval: 'constructor' }, 'GET');
  assertEquals(viaGet.status, 400);
  assertEquals(db.calls.length + cb.calls.length + kr.calls.length, 0);
});

Deno.test('validation: lowercase symbol accepted; limit clamped; end as ms and ISO are equivalent', async () => {
  fresh();
  const end = RealDate.UTC(2026, 7, 1); // 2026-08-01T00:00Z, historical
  const first = await call({ symbol: 'btc-usd', interval: '1h', end, limit: 1000 });
  assertEquals(first.status, 200);
  assertEquals(first.body.symbol, 'BTC-USD');
  assertEquals(first.body.candles!.length, 1000);
  assertEquals(cb.calls.length, 4);

  const cases: [unknown, number][] = [[5000, 1000], [1e9, 1000], ['Infinity', 1000], [-3, 1], [2.9, 2], ['abc', 300], [undefined, 300], [0, 300], ['17', 17]];
  for (const [limit, want] of cases) {
    db.calls = [];
    const res = await call({ symbol: 'BTC-USD', interval: '1h', end, ...(limit === undefined ? {} : { limit }) });
    assertEquals(res.status, 200);
    assertEquals(loadCalls()[0].params.get('limit'), String(want), `limit ${limit}`);
    assertEquals(res.body.candles!.length, want, `limit ${limit}`);
  }

  db.calls = [];
  const asMs = await call({ symbol: 'BTC-USD', interval: '1h', end, limit: 50 });
  const asIso = await call({ symbol: 'BTC-USD', interval: '1h', end: new RealDate(end).toISOString(), limit: 50 });
  const asGet = await call({ symbol: 'BTC-USD', interval: '1h', end: String(end), limit: '50' }, 'GET');
  const asOffset = await call({ symbol: 'BTC-USD', interval: '1h', end: '2026-08-01T02:00:00+02:00', limit: 50 });
  for (const r of [asIso, asGet, asOffset]) assertEquals(r.body.candles, asMs.body.candles);
  assertEquals(asMs.body.candles!.at(-1)!.t, end, 'a candle opening exactly at `end` is included');
  const filters = loadCalls().map((c) => c.params.getAll('t'));
  assertEquals(new Set(filters.map((f) => f.join())).size, 1, 'all four spellings produce the same lte filter');
  assertEquals(cb.calls.length, 4, 'every one of these was served from the cache');
});

// ---------------------------------------------------------------------------------------
// Latest candles: fetch, cache, TTL, claim
// ---------------------------------------------------------------------------------------

Deno.test('first latest request fetches upstream once, caches, and returns the documented shape', async () => {
  fresh();
  const res = await call({ symbol: 'BTC-USD', interval: '1m' });
  assertEquals(res.status, 200);
  assertEquals(cb.calls.length, 1, `coinbase ranges ${JSON.stringify(cbRanges())}`);
  assertEquals(kr.calls.length, 0);
  assertEquals(Object.keys(res.body).sort(), ['attribution', 'candles', 'delayed', 'interval', 'source', 'symbol']);
  assertEquals(res.body.symbol, 'BTC-USD');
  assertEquals(res.body.interval, '1m');
  assertEquals(res.body.source, 'coinbase');
  assertEquals(res.body.attribution, 'Market data: Coinbase Exchange');
  assertEquals(res.body.delayed, false);
  const candles = res.body.candles!;
  assertEquals(candles.length, 300);
  assertWellFormed(candles, '1m');
  assertEquals(candles.at(-1)!.t, slot(NOW0, MIN), 'newest candle is the one still forming');
  assertEquals(candles[0].t, slot(NOW0, MIN) - 299 * MIN);
  // Values are exactly what the exchange reported.
  const k = trueCandle(cb.markets['BTC-USD'], seedOf('BTC-USD'), candles[10].t, MIN)!;
  assertEquals(candles[10], k);
  // Headers.
  assertEquals(res.headers.get('Cache-Control'), 'public, max-age=15');
  assertEquals(res.headers.get('Content-Type'), 'application/json');
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  // Cache state.
  assertEquals(db.candles('BTC-USD', '1m').length, 300);
  const state = db.fetchState('BTC-USD', '1m')!;
  assertEquals(state.source, 'coinbase');
  assertEquals(state.fetched_at, NOW0);
  // Coinbase request format.
  const u = cb.calls[0].url;
  assertEquals(u.pathname, '/products/BTC-USD/candles');
  assertEquals(u.searchParams.get('granularity'), '60');
});

Deno.test('requests within the TTL are served from cache with no upstream call', async () => {
  fresh();
  const first = await call({ symbol: 'BTC-USD', interval: '1m' });
  const n0 = cb.calls.length;
  for (const dt of [1_000, 10_000, 14_999]) {
    clock.now = NOW0 + dt;
    const again = await call({ symbol: 'BTC-USD', interval: '1m' }, 'GET');
    assertEquals(again.status, 200);
    assertEquals(again.body.candles, first.body.candles);
    assertEquals(again.body.source, 'coinbase');
    assertEquals(again.headers.get('Cache-Control'), 'public, max-age=15');
  }
  assertEquals(cb.calls.length, n0);
  // Longer intervals cap the browser max-age at 60 s.
  const daily = await call({ symbol: 'BTC-USD', interval: '1d' });
  assertEquals(daily.headers.get('Cache-Control'), 'public, max-age=60');
});

Deno.test('after the TTL exactly one of N concurrent requests refreshes; the rest serve the cache', async () => {
  fresh();
  await call({ symbol: 'BTC-USD', interval: '1m' });
  const n0 = cb.calls.length;
  clock.now = NOW0 + 15_001;
  cb.delayMs = 50; // the refresh is in flight while the others arrive
  const results = await Promise.all(Array.from({ length: 12 }, () => call({ symbol: 'BTC-USD', interval: '1m' })));
  assertEquals(cb.calls.length, n0 + 1, 'one refresh for 12 concurrent requests');
  for (const r of results) {
    assertEquals(r.status, 200);
    assertEquals(r.body.candles!.length, 300);
    assertEquals(r.body.stale, undefined);
  }
  assertEquals(db.fetchState('BTC-USD', '1m')!.fetched_at, NOW0 + 15_001);
  // The refreshed range is the recent window only.
  const [start, end] = cbRanges()[n0];
  assertEquals(end, NOW0 + 15_001);
  assertEquals(start, NOW0 + 15_001 - 120 * MIN);
  // And the next TTL window starts from the refresh.
  clock.now = NOW0 + 25_000;
  await call({ symbol: 'BTC-USD', interval: '1m' });
  assertEquals(cb.calls.length, n0 + 1);
});

Deno.test('a burst after an idle period makes one upstream call, not one per request', async () => {
  fresh();
  await call({ symbol: 'BTC-USD', interval: '1m' });
  const n0 = cb.calls.length;
  clock.now = NOW0 + 30 * MIN; // cache now ends 30 candles ago (> the 3-candle gap tolerance)
  cb.delayMs = 40;
  const results = await Promise.all(Array.from({ length: 6 }, () => call({ symbol: 'BTC-USD', interval: '1m' })));
  assertEquals(cb.calls.length - n0, 1, `burst caused ${cb.calls.length - n0} upstream calls`);
  for (const r of results) {
    assertEquals(r.status, 200);
    assertEquals(r.body.candles!.at(-1)!.t, slot(NOW0 + 30 * MIN, MIN), 'every caller sees the fresh tail');
    assertEquals(r.body.candles!.length, 300);
    assertWellFormed(r.body.candles!, '1m');
  }
});

Deno.test('after an idle period the candle that was still forming is re-fetched (no partial candle kept)', async () => {
  fresh();
  const market = cb.markets['BTC-USD'];
  const forming = slot(NOW0, MIN);
  // At NOW0 the exchange reports the forming 12:00 candle with a provisional close and volume.
  cb.mangle = (rows) => rows.map((r) => (r[0] === forming / 1000 ? [r[0], r[1], r[2], r[3], r[3], 0.1] : r));
  await call({ symbol: 'BTC-USD', interval: '1m' });
  assertEquals(db.candles('BTC-USD', '1m').at(-1)!.v, 0.1);
  cb.mangle = null;
  clock.now = NOW0 + 3 * HOUR; // idle for longer than the 120-candle refresh window
  const latest = await call({ symbol: 'BTC-USD', interval: '1m', limit: 100 });
  assertEquals(latest.status, 200);
  // A game later asks for the window that ends on that candle: it must be the final one.
  const hist = await call({ symbol: 'BTC-USD', interval: '1m', end: forming, limit: 60 });
  const k = hist.body.candles!.at(-1)!;
  assertEquals(k.t, forming);
  assertEquals(k, trueCandle(market, seedOf('BTC-USD'), forming, MIN)!);
  assertEquals(cb.calls.length, 2);
});

// ---------------------------------------------------------------------------------------
// Provider failures
// ---------------------------------------------------------------------------------------

Deno.test('coinbase failure falls back to kraken for the latest candles', async () => {
  fresh();
  await call({ symbol: 'BTC-USD', interval: '1m' });
  const n0 = cb.calls.length;
  clock.now = NOW0 + 20_000;
  cb.faults = [429];
  const res = await call({ symbol: 'BTC-USD', interval: '1m' });
  assertEquals(res.status, 200);
  assertEquals(cb.calls.length, n0 + 1);
  assertEquals(kr.calls.length, 1);
  assertEquals(res.body.source, 'kraken');
  assertEquals(res.body.attribution, 'Market data: Kraken');
  assertEquals(res.body.candles!.length, 300);
  assertWellFormed(res.body.candles!, '1m');
  const u = kr.calls[0].url;
  assertEquals(u.searchParams.get('pair'), 'XBTUSD');
  assertEquals(u.searchParams.get('interval'), '1');
  assertEquals(Number(u.searchParams.get('since')), Math.floor((NOW0 + 20_000 - 120 * MIN) / 1000) - 1);
  // Kraken numbers arrive as strings and are parsed.
  const k = trueCandle(cb.markets['BTC-USD'], seedOf('BTC-USD'), res.body.candles![5].t, MIN)!;
  assertEquals(res.body.candles![5], k);
  assertEquals(db.fetchState('BTC-USD', '1m')!.source, 'kraken');
  // Served from cache within the TTL, still attributed to kraken.
  clock.now = NOW0 + 25_000;
  const again = await call({ symbol: 'BTC-USD', interval: '1m' });
  assertEquals(again.body.source, 'kraken');
  assertEquals([cb.calls.length, kr.calls.length], [n0 + 1, 1]);
});

Deno.test('kraken error bodies (HTTP 200) and unsupported intervals count as failures', async () => {
  fresh();
  cb.always = 500;
  kr.always = () => new Response(JSON.stringify({ error: ['EGeneral:Too many requests'] }), { status: 200 });
  const res = await call({ symbol: 'ETH-USD', interval: '5m' });
  assertEquals(res.status, 502);
  assertEquals([cb.calls.length, kr.calls.length], [1, 1]);
  // 6h: Kraken has no 6h candles, so it is not even asked.
  fresh();
  cb.always = 500;
  const six = await call({ symbol: 'BTC-USD', interval: '6h' });
  assertEquals(six.status, 502);
  assertEquals([cb.calls.length, kr.calls.length], [1, 0]);
});

Deno.test('total provider failure with a cache → stale cached response; claim retried after ~5 s', async () => {
  fresh();
  const warm = await call({ symbol: 'BTC-USD', interval: '1m' });
  const n0 = cb.calls.length;
  clock.now = NOW0 + 20_000;
  cb.always = 429;
  kr.always = 500;
  const res = await call({ symbol: 'BTC-USD', interval: '1m' });
  assertEquals(res.status, 200);
  assertEquals(res.body.stale, true);
  assertEquals(res.body.source, 'cache');
  assertEquals(res.body.delayed, true);
  assertEquals(res.body.candles, warm.body.candles);
  assertEquals(res.headers.get('Cache-Control'), 'no-store');
  assertEquals([cb.calls.length, kr.calls.length], [n0 + 1, 1]);
  // The claim was released so a retry happens ~5 s later, not a full TTL later …
  assertEquals(db.fetchState('BTC-USD', '1m')!.fetched_at, NOW0 + 20_000 - 15_000 + 5_000);
  clock.now = NOW0 + 23_000; // … but not before.
  await call({ symbol: 'BTC-USD', interval: '1m' });
  assertEquals([cb.calls.length, kr.calls.length], [n0 + 1, 1]);
  clock.now = NOW0 + 26_000;
  const retry = await call({ symbol: 'BTC-USD', interval: '1m' });
  assertEquals([cb.calls.length, kr.calls.length], [n0 + 2, 2]);
  assertEquals(retry.body.stale, true);
  // Recovery.
  cb.always = null;
  kr.always = null;
  clock.now = NOW0 + 32_000;
  const ok = await call({ symbol: 'BTC-USD', interval: '1m' });
  assertEquals(ok.body.stale, undefined);
  assertEquals(ok.body.source, 'coinbase');
  assertEquals(cb.calls.length, n0 + 3);
});

Deno.test('total failure with no cache → 502 (and DB outage → 502 without upstream calls)', async () => {
  fresh();
  cb.always = 500;
  kr.always = 503;
  const res = await call({ symbol: 'BTC-USD', interval: '1h' });
  assertEquals(res.status, 502);
  assertEquals(res.body, { error: 'Market data is unavailable right now.' });
  assertEquals(res.headers.get('Cache-Control'), 'no-store');
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  assertEquals([cb.calls.length, kr.calls.length], [1, 1]);

  fresh();
  db.down = 500;
  const down = await call({ symbol: 'BTC-USD', interval: '1h' });
  assertEquals(down.status, 502);
  assertEquals(cb.calls.length + kr.calls.length, 0);
});

Deno.test('a failed cache write releases the claim and does not report success', async () => {
  fresh();
  db.intercept = (c) =>
    c.method === 'POST' && c.table === 'market_candles'
      ? new Response(JSON.stringify({ code: '57014', message: 'canceling statement due to statement timeout' }), { status: 500 })
      : undefined;
  const res = await call({ symbol: 'BTC-USD', interval: '1m' });
  assertEquals(res.status, 502);
  assertEquals(cb.calls.length, 1);
  assertEquals(db.fetchState('BTC-USD', '1m')!.fetched_at, NOW0 - 15_000 + 5_000);
});

Deno.test('slow provider: concurrent callers are not blocked by the refresh; a hung provider times out to kraken', async () => {
  fresh();
  await call({ symbol: 'BTC-USD', interval: '1m' });
  const n0 = cb.calls.length;
  clock.now = NOW0 + 16_000;
  cb.faults = [{ delay: 300 }];
  const order: string[] = [];
  const claimer = call({ symbol: 'BTC-USD', interval: '1m' }).then((r) => (order.push('claimer'), r));
  await new Promise((r) => setTimeout(r, 30));
  const others = await Promise.all(
    Array.from({ length: 4 }, () => call({ symbol: 'BTC-USD', interval: '1m' }).then((r) => (order.push('other'), r))),
  );
  await claimer;
  assertEquals(order.slice(0, 4), ['other', 'other', 'other', 'other']);
  for (const r of others) assertEquals(r.body.candles!.length, 300);
  assertEquals(cb.calls.length, n0 + 1);

  // A provider that never answers: getJson aborts after 8 s (timers scaled 100× here).
  fresh();
  await call({ symbol: 'BTC-USD', interval: '1m' });
  const n1 = cb.calls.length;
  clock.now = NOW0 + 16_000;
  const realSetTimeout = globalThis.setTimeout;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).setTimeout = (fn: () => void, ms = 0) => realSetTimeout(fn, ms >= 1000 ? ms / 100 : ms);
  try {
    cb.faults = ['hang'];
    const t0 = performance.now();
    const res = await call({ symbol: 'BTC-USD', interval: '1m' });
    assert(performance.now() - t0 < 2_000);
    assertEquals(res.status, 200);
    assertEquals(res.body.source, 'kraken');
    assertEquals([cb.calls.length, kr.calls.length], [n1 + 1, 1]);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

// ---------------------------------------------------------------------------------------
// History: back-fill once, tails, holes, listing date, paging
// ---------------------------------------------------------------------------------------

Deno.test('historical window back-fills once, then is served from cache with a long max-age', async () => {
  fresh();
  const end = RealDate.UTC(2026, 6, 4, 12); // 2026-07-04 12:00Z
  const first = await call({ symbol: 'ETH-USD', interval: '1h', end, limit: 300 });
  assertEquals(first.status, 200);
  assertEquals(cb.calls.length, 1);
  assertEquals(cbRanges()[0], [end - 300 * HOUR, end]);
  assertEquals(first.body.candles!.length, 300);
  assertEquals(first.body.candles!.at(-1)!.t, end);
  assertWellFormed(first.body.candles!, '1h');
  assertEquals(first.headers.get('Cache-Control'), 'public, max-age=3600');
  assertEquals(db.fetchState('ETH-USD', '1h'), undefined, 'historical requests do not take the refresh claim');
  for (let i = 0; i < 3; i++) {
    clock.now += HOUR;
    const again = await call({ symbol: 'ETH-USD', interval: '1h', end, limit: 300 });
    assertEquals(again.body.candles, first.body.candles);
  }
  // A smaller window inside the cached one is also served from cache.
  const inner = await call({ symbol: 'ETH-USD', interval: '1h', end: end - 24 * HOUR, limit: 100 });
  assertEquals(inner.body.candles!.length, 100);
  assertEquals(cb.calls.length, 1);
});

// Known limit: the refresh claim only covers the latest candles, so N simultaneous cold requests
// for the same historical window each go upstream once (afterwards the window is cached).
Deno.test('concurrent identical historical requests (cold cache) all succeed; each goes upstream once', async () => {
  fresh();
  const end = RealDate.UTC(2026, 5, 1);
  const rs = await Promise.all(Array.from({ length: 5 }, () => call({ symbol: 'BTC-USD', interval: '1d', end, limit: 200 })));
  for (const r of rs) {
    assertEquals(r.status, 200);
    assertEquals(r.body.candles!.length, 200);
  }
  assertEquals(cb.calls.length, 5);
  await call({ symbol: 'BTC-USD', interval: '1d', end, limit: 200 });
  assertEquals(cb.calls.length, 5);
});

Deno.test('tail missing: a window ending after the cached segment re-fetches exactly that window', async () => {
  fresh();
  const e0 = RealDate.UTC(2026, 6, 1);
  await call({ symbol: 'BTC-USD', interval: '1h', end: e0, limit: 300 });
  assertEquals(cbRanges(), [[e0 - 300 * HOUR, e0]]);
  const e1 = e0 + 80 * HOUR;
  const res = await call({ symbol: 'BTC-USD', interval: '1h', end: e1, limit: 300 });
  assertEquals(cbRanges()[1], [e1 - 300 * HOUR, e1]);
  assertEquals(cb.calls.length, 2);
  assertEquals(res.body.candles!.length, 300);
  assertEquals(res.body.candles!.at(-1)!.t, e1);
  assertWellFormed(res.body.candles!, '1h');
  await call({ symbol: 'BTC-USD', interval: '1h', end: e1, limit: 300 });
  assertEquals(cb.calls.length, 2);
});

Deno.test('hole: older and newer segments cached, the gap between them is re-fetched once', async () => {
  fresh();
  const e0 = RealDate.UTC(2026, 5, 10);
  await call({ symbol: 'BTC-USD', interval: '1h', end: e0, limit: 300 }); // [e0-299h, e0]
  await call({ symbol: 'BTC-USD', interval: '1h', end: e0 + 400 * HOUR, limit: 300 }); // [e0+101h, e0+400h]
  assertEquals(cb.calls.length, 2);
  const e2 = e0 + 250 * HOUR; // window [e0-49h, e0+250h] straddles the hole (e0, e0+101h)
  const res = await call({ symbol: 'BTC-USD', interval: '1h', end: e2, limit: 300 });
  assertEquals(cb.calls.length, 3);
  assertEquals(cbRanges()[2], [e2 - 300 * HOUR, e2]);
  assertEquals(res.body.candles!.length, 300);
  assertWellFormed(res.body.candles!, '1h');
  for (let i = 1; i < 300; i++) assertEquals(res.body.candles![i].t - res.body.candles![i - 1].t, HOUR);
  await call({ symbol: 'BTC-USD', interval: '1h', end: e2, limit: 300 });
  await call({ symbol: 'BTC-USD', interval: '1h', end: e0 + 400 * HOUR, limit: 700 });
  assertEquals(cb.calls.length, 3, 'the whole range is now contiguous in the cache');
});

Deno.test('head missing: only the older part is fetched (one page ending at the oldest cached candle)', async () => {
  fresh();
  const e = RealDate.UTC(2026, 4, 20);
  await call({ symbol: 'ETH-USD', interval: '1h', end: e, limit: 300 });
  assertEquals(cb.calls.length, 1);
  const res = await call({ symbol: 'ETH-USD', interval: '1h', end: e, limit: 500 });
  assertEquals(cb.calls.length, 2);
  const [s, en] = cbRanges()[1];
  assertEquals(en, e - 299 * HOUR, 'the head fetch ends at the oldest cached candle');
  assert(s <= e - 500 * HOUR, 'and reaches the start of the requested window');
  assertEquals(res.body.candles!.length, 500);
  assertWellFormed(res.body.candles!, '1h');
});

Deno.test('limit 1000 pages Coinbase 4 times and returns exactly 1000 sorted unique candles', async () => {
  fresh();
  const res = await call({ symbol: 'BTC-USD', interval: '1m', limit: 1000 });
  assertEquals(res.status, 200);
  assertEquals(cb.calls.length, 4, JSON.stringify(cbRanges()));
  // Every page is within Coinbase's 300-candle limit and together they cover the window.
  const r = cbRanges().sort((a, b) => a[0] - b[0]);
  for (const [s, e] of r) assert(e - s <= 300 * MIN);
  assert(r[0][0] <= NOW0 - 999 * MIN && r.at(-1)![1] >= NOW0);
  for (let i = 1; i < r.length; i++) assert(r[i][0] <= r[i - 1][1] + MIN, 'pages leave no gap');
  const candles = res.body.candles!;
  assertEquals(candles.length, 1000);
  assertEquals(new Set(candles.map((k) => k.t)).size, 1000);
  assertWellFormed(candles, '1m');
  assertEquals(candles.at(-1)!.t, slot(NOW0, MIN));
  assertEquals(candles[0].t, slot(NOW0, MIN) - 999 * MIN);

  fresh();
  const end = RealDate.UTC(2026, 7, 15);
  const hist = await call({ symbol: 'ETH-USD', interval: '1h', end, limit: 1000 });
  assertEquals(cb.calls.length, 4);
  assertEquals(hist.body.candles!.length, 1000);
  assertEquals(new Set(hist.body.candles!.map((k) => k.t)).size, 1000);
  assertWellFormed(hist.body.candles!, '1h');
});

Deno.test('listing date: history before it is asked for once more (plus a daily check), then never again', async () => {
  fresh();
  const L = LISTINGS['SOL-USD'];
  const e = L + 50 * DAY; // window of 300 days straddles the listing
  const first = await call({ symbol: 'SOL-USD', interval: '1d', end: e, limit: 300 });
  assertEquals(first.status, 200);
  assertEquals(first.body.candles!.length, 51);
  assertEquals(first.body.candles![0].t, L);
  for (let i = 0; i < 4; i++) {
    const again = await call({ symbol: 'SOL-USD', interval: '1d', end: e, limit: 300 });
    assertEquals(again.body.candles, first.body.candles);
  }
  // 1: the window; 2: one page before the first candle (empty); 3: the daily candles agree.
  assertEquals(cb.calls.length, 3, `listing floor not remembered: ${cb.calls.length} upstream calls`);
  assertEquals(cb.calls[2].url.searchParams.get('granularity'), '86400');
  assertEquals(db.fetchState('SOL-USD', '1d')?.oldest_complete, L);
  const settled = cb.calls.length;
  // Windows entirely before the listing now cost nothing.
  const before = await call({ symbol: 'SOL-USD', interval: '1d', end: L - 100 * DAY, limit: 50 });
  assertEquals(before.status, 200);
  assertEquals(before.body.candles, []);
  // Other windows that straddle the listing are served from cache too.
  const other = await call({ symbol: 'SOL-USD', interval: '1d', end: L + 20 * DAY, limit: 100 });
  assertEquals(other.body.candles!.length, 21);
  assertEquals(cb.calls.length, settled);
  // The floor never moves down.
  assertEquals(db.fetchState('SOL-USD', '1d')?.oldest_complete, L);
});

Deno.test('listing date: a window wholly before listing (cold) costs one call + one check, then none', async () => {
  fresh();
  const L = LISTINGS['AVAX-USD'];
  for (let i = 0; i < 3; i++) {
    const r = await call({ symbol: 'AVAX-USD', interval: '1h', end: L - 10 * DAY, limit: 100 });
    assertEquals(r.status, 200);
    assertEquals(r.body.candles, []);
  }
  assertEquals(cb.calls.length, 2, 'the empty window + the daily confirmation');
  // The floor row was created for a symbol/interval nobody asked "latest" for, and it does not
  // block the first latest refresh.
  const st = db.fetchState('AVAX-USD', '1h')!;
  assertEquals(st.oldest_complete, L - 10 * DAY);
  const latest = await call({ symbol: 'AVAX-USD', interval: '1h' });
  assertEquals(latest.status, 200);
  assertEquals(latest.body.candles!.length, 300);
  assertEquals(cb.calls.length, 3);
});

Deno.test('kraken cannot serve old history: a coinbase outage must not poison the listing floor', async () => {
  fresh();
  await call({ symbol: 'BTC-USD', interval: '1h' }); // creates the market_fetches row
  const callsBefore = cb.calls.length;
  const end = NOW0 - 60 * DAY; // 1440 candles back: beyond Kraken's 720
  cb.always = 500;
  const during = await call({ symbol: 'BTC-USD', interval: '1h', end, limit: 300 });
  assertEquals(during.status, 502, 'must not answer an empty 200 that browsers cache for an hour');
  assertEquals(kr.calls.length, 0, 'kraken cannot reach that far back, so it is not asked');
  assertEquals(db.fetchState('BTC-USD', '1h')!.oldest_complete, null);
  cb.always = null;
  const after = await call({ symbol: 'BTC-USD', interval: '1h', end, limit: 300 });
  assertEquals(after.status, 200);
  assertEquals(after.body.candles!.length, 300);
  assertEquals(cb.calls.length, callsBefore + 2);
});

Deno.test('kraken partial history (latest window > 720 candles) never sets the listing floor', async () => {
  fresh();
  cb.always = 503;
  const res = await call({ symbol: 'BTC-USD', interval: '1m', limit: 1000 });
  assertEquals(res.status, 200);
  assertEquals(res.body.stale, true, 'the older part could not be fetched');
  assertEquals(res.body.candles!.length, 720);
  // refresh: coinbase fails → kraken (latest 720); head: coinbase fails, kraken can't reach → stale.
  assertEquals([cb.calls.length, kr.calls.length], [2, 1]);
  assertEquals(db.fetchState('BTC-USD', '1m')!.oldest_complete, null);
  // Coinbase is back: the next request completes the window from Coinbase, then it is cached.
  cb.always = null;
  clock.now = NOW0 + 1000;
  const later = await call({ symbol: 'BTC-USD', interval: '1m', limit: 1000 });
  assertEquals(later.body.candles!.length, 1000);
  assertWellFormed(later.body.candles!, '1m');
  assertEquals([cb.calls.length, kr.calls.length], [3, 1]);
  const n = cb.calls.length;
  clock.now = NOW0 + 2000;
  await call({ symbol: 'BTC-USD', interval: '1m', limit: 1000 });
  assertEquals(cb.calls.length, n);
});

Deno.test('thin market: a few leading minutes without trades do not hide older history', async () => {
  fresh();
  await call({ symbol: 'LINK-USD', interval: '1m' }); // row exists, like in production
  const e = slot(NOW0, MIN) - DAY;
  cb.markets['LINK-USD'] = { listing: LISTINGS['LINK-USD'], noTrades: [[e - 300 * MIN, e - 297 * MIN]] };
  kr.markets = cb.markets;
  const r1 = await call({ symbol: 'LINK-USD', interval: '1m', end: e, limit: 300 });
  assertEquals(r1.status, 200);
  assertEquals(db.fetchState('LINK-USD', '1m')!.oldest_complete, null, 'a 3-minute lull is not a listing date');
  const older = await call({ symbol: 'LINK-USD', interval: '1m', end: e - 10 * HOUR, limit: 300 });
  assertEquals(older.status, 200);
  assertEquals(older.body.candles!.length, 300);
  assertEquals(older.body.candles!.at(-1)!.t, e - 10 * HOUR);
  assertEquals(cb.calls.length, 3);
});

Deno.test('thin market: minutes without trades inside the window are not re-fetched on every request', async () => {
  fresh();
  const e = slot(NOW0, MIN) - 2 * DAY;
  cb.markets['LINK-USD'] = { listing: LISTINGS['LINK-USD'], noTrades: [[e - 100 * MIN, e - 94 * MIN]] };
  kr.markets = cb.markets;
  const r1 = await call({ symbol: 'LINK-USD', interval: '1m', end: e, limit: 300 });
  assertEquals(r1.status, 200);
  const n = cb.calls.length;
  assertEquals(n, 1);
  for (let i = 0; i < 3; i++) await call({ symbol: 'LINK-USD', interval: '1m', end: e, limit: 300 });
  assertEquals(cb.calls.length, n, `re-fetched ${cb.calls.length - n} times`);
  assertWellFormed(r1.body.candles!, '1m');
  // The quiet minutes are flat at the previous close with zero volume.
  const quiet = r1.body.candles!.filter((k) => k.t >= e - 100 * MIN && k.t < e - 94 * MIN);
  assertEquals(quiet.length, 6);
  const prev = r1.body.candles!.find((k) => k.t === e - 101 * MIN)!;
  for (const k of quiet) assertEquals([k.o, k.h, k.l, k.c, k.v], [prev.c, prev.c, prev.c, prev.c, 0]);
});

Deno.test('thin market: no trades in the last minutes does not defeat the latest-candle cache', async () => {
  fresh();
  cb.markets['LINK-USD'] = { listing: LISTINGS['LINK-USD'], noTrades: [[slot(NOW0, MIN) - 6 * MIN, Infinity]] };
  kr.markets = cb.markets;
  const first = await call({ symbol: 'LINK-USD', interval: '1m' });
  assertEquals(first.status, 200);
  const n = cb.calls.length;
  assertEquals(n, 1);
  assertEquals(first.body.candles!.at(-1)!.t, slot(NOW0, MIN) - 2 * MIN, 'quiet minutes up to the last closed one are filled');
  for (const dt of [2_000, 5_000, 9_000]) {
    clock.now = NOW0 + dt;
    await call({ symbol: 'LINK-USD', interval: '1m' });
  }
  assertEquals(cb.calls.length, n, 'requests within the TTL must not go upstream');
});

// ---------------------------------------------------------------------------------------
// Data hygiene
// ---------------------------------------------------------------------------------------

Deno.test('sanitize: garbage rows never violate the CHECK constraint and never break the batch', async () => {
  fresh();
  const e = RealDate.UTC(2026, 3, 1);
  const T = (h: number) => (e - h * HOUR) / 1000;
  cb.mangle = (rows) => {
    const byT = new Map(rows.map((r) => [r[0] as number, r]));
    const set = (h: number, row: unknown[]) => byT.set(T(h), [T(h), ...row]);
    set(1, [null, 110, 100, 102, 5]); // NaN low (JSON null)
    set(2, [105, 110, 100, 102, 5]); // low above open/close → clamp
    set(3, [95, 99, 100, 102, 5]); // high below close → clamp
    set(4, [95, 110, 100, -3, 5]); // negative close → drop
    set(5, [0, 110, 100, 102, 5]); // zero low → drop
    set(6, ['abc', 110, 100, 102, 5]); // non-numeric → drop
    set(7, [95, 110, 100, 102, -1]); // negative volume → 0
    set(8, [95, 110, 100, 102, 'x']); // non-numeric volume → 0
    set(9, [95, 110]); // short row → drop
    const out = [...byT.values()];
    out.push([T(10) + 0.0004, 95, 110, 100, 102, 5]); // same ISO millisecond as a real candle
    out.push({ not: 'a row' } as unknown as unknown[]);
    out.push([T(11), 1e308, 1e308, 1e308, 1e308, 1e308]); // huge but valid (overwrites)
    return out.sort((a, b) => ((b as number[])[0] ?? 0) - ((a as number[])[0] ?? 0));
  };
  const res = await call({ symbol: 'BTC-USD', interval: '1h', end: e, limit: 50 });
  assertEquals(res.status, 200, JSON.stringify(res.body));
  assertWellFormed(res.body.candles!, '1h');
  const at = (h: number) => res.body.candles!.find((k) => k.t === e - h * HOUR);
  assertEquals(at(2)!.l, 100);
  assertEquals(at(3)!.h, 102);
  assertEquals(at(7)!.v, 0);
  assertEquals(at(8)!.v, 0);
  assertEquals(at(11)!.h, 1e308);
  for (const r of db.rows('market_candles')) {
    assert((r.l as number) <= Math.min(r.o as number, r.c as number) && Math.max(r.o as number, r.c as number) <= (r.h as number) && (r.l as number) > 0);
    assert(Number.isInteger(r.t));
  }
  assertEquals(cb.calls.length, 1);
});

Deno.test('prune runs through the RPC when the dice say so', async () => {
  fresh();
  db.seed('market_candles', [
    { symbol: 'BTC-USD', interval: '1m', t: NOW0 - 4 * DAY, o: 1, h: 1, l: 1, c: 1, v: 0 },
    { symbol: 'BTC-USD', interval: '1h', t: NOW0 - 400 * DAY, o: 1, h: 1, l: 1, c: 1, v: 0 },
  ]);
  Math.random = () => 0;
  const res = await call({ symbol: 'BTC-USD', interval: '1h', end: RealDate.UTC(2026, 8, 1), limit: 10 });
  assertEquals(res.status, 200);
  assertEquals(db.rpcCalls, ['prune_market_candles']);
  assertEquals(cb.calls.length, 1);
  assertEquals(db.candles('BTC-USD', '1m').length, 0);
  assertEquals(db.candles('BTC-USD', '1h').some((k) => k.t === NOW0 - 400 * DAY), true);
  Math.random = realRandom;
});

// ---------------------------------------------------------------------------------------
// More adversarial cases
// ---------------------------------------------------------------------------------------

Deno.test('occasional empty window: a spurious [] from coinbase must not become the listing date', async () => {
  fresh();
  const e = RealDate.UTC(2026, 2, 1);
  cb.faults = ['empty'];
  const first = await call({ symbol: 'ETH-USD', interval: '1h', end: e, limit: 300 });
  assert(first.status === 502 || first.body.stale === true || first.body.candles!.length === 0, JSON.stringify(first.status));
  assertEquals(first.status, 502, 'nothing to show: the empty answer is treated as a failed fetch');
  assertEquals(cb.calls.length, 2, 'the empty window + the daily check that shows ETH was trading');
  assertEquals(db.fetchState('ETH-USD', '1h')?.oldest_complete ?? null, null, 'floor poisoned by one empty answer');
  assertEquals(first.headers.get('Cache-Control') === 'public, max-age=3600' && first.body.candles?.length === 0, false,
    'an empty answer for a trading period must not be cached by browsers for an hour');
  const second = await call({ symbol: 'ETH-USD', interval: '1h', end: e, limit: 300 });
  assertEquals(second.status, 200);
  assertEquals(second.body.candles!.length, 300);
  // Older history is still reachable.
  const older = await call({ symbol: 'ETH-USD', interval: '1h', end: e - 40 * DAY, limit: 300 });
  assertEquals(older.body.candles!.length, 300);
  assertEquals(cb.calls.length, 4);
});

Deno.test('a 6-hour exchange outage at 1m is not mistaken for the listing date', async () => {
  fresh();
  await call({ symbol: 'LINK-USD', interval: '1m' });
  const e = slot(NOW0, MIN) - DAY;
  const outage: [number, number] = [e - 650 * MIN, e - 290 * MIN]; // 6 h, covers the page [e-600m, e-300m]
  cb.markets['LINK-USD'] = { listing: LISTINGS['LINK-USD'], noTrades: [outage] };
  kr.markets = cb.markets;
  const n0 = cb.calls.length;
  const r = await call({ symbol: 'LINK-USD', interval: '1m', end: e, limit: 1000 });
  assertEquals(r.status, 200);
  assertEquals(cb.calls.length - n0, 4, 'paging continues past the empty page');
  assertEquals(db.fetchState('LINK-USD', '1m')!.oldest_complete, null);
  assertEquals(r.body.candles!.length, 1000);
  assertWellFormed(r.body.candles!, '1m');
  const flat = r.body.candles!.filter((k) => k.t >= outage[0] && k.t < outage[1]);
  assertEquals(flat.length, 360);
  assert(flat.every((k) => k.v === 0 && k.o === k.c && k.h === k.l));
  await call({ symbol: 'LINK-USD', interval: '1m', end: e, limit: 1000 });
  assertEquals(cb.calls.length - n0, 4, 'and the window is complete in the cache');
  const before = await call({ symbol: 'LINK-USD', interval: '1m', end: outage[0] - 60 * MIN, limit: 100 });
  assertEquals(before.body.candles!.length, 100);
});

Deno.test('cold cache: N concurrent latest requests make one upstream call', async () => {
  fresh();
  cb.delayMs = 60;
  const rs = await Promise.all(Array.from({ length: 8 }, () => call({ symbol: 'SOL-USD', interval: '5m' })));
  for (const r of rs) {
    assertEquals(r.status, 200);
    assertEquals(r.body.candles!.length, 300);
    assertWellFormed(r.body.candles!, '5m');
  }
  assertEquals(cb.calls.length, 1);
});

Deno.test('claimer fails while others wait: they serve the stale cache instead of hammering the provider', async () => {
  fresh();
  await call({ symbol: 'BTC-USD', interval: '1m' });
  clock.now = NOW0 + 30 * MIN;
  cb.delayMs = 100;
  cb.always = 500;
  kr.always = 500;
  const t0 = performance.now();
  const rs = await Promise.all(Array.from({ length: 5 }, () => call({ symbol: 'BTC-USD', interval: '1m' })));
  const ms = performance.now() - t0;
  assertEquals([cb.calls.length, kr.calls.length], [2, 1], 'only the claimer went upstream');
  for (const r of rs) {
    assertEquals(r.status, 200);
    assertEquals(r.body.stale, true);
    assertEquals(r.body.candles!.length, 300);
  }
  assert(ms < 4_000, `waited ${ms} ms`);
});

Deno.test('latest-ish ends: end in the future or within 2 candles of now counts as latest', async () => {
  fresh();
  await call({ symbol: 'BTC-USD', interval: '1h' });
  const n0 = cb.calls.length;
  const future = await call({ symbol: 'BTC-USD', interval: '1h', end: NOW0 + 10 * DAY });
  assertEquals(future.status, 200);
  assertEquals(future.headers.get('Cache-Control'), 'public, max-age=60');
  assertEquals(future.body.candles!.at(-1)!.t, slot(NOW0, HOUR));
  const recent = await call({ symbol: 'BTC-USD', interval: '1h', end: NOW0 - HOUR, limit: 200 });
  assertEquals(recent.headers.get('Cache-Control'), 'public, max-age=60');
  assertEquals(recent.body.candles!.at(-1)!.t, slot(NOW0, HOUR) - HOUR);
  assertEquals(cb.calls.length, n0, 'both are "latest" requests served from the fresh cache');
});

Deno.test('kraken reach: used for history it still holds, skipped beyond its 720 candles', async () => {
  fresh();
  cb.always = 500;
  const inside = await call({ symbol: 'BTC-USD', interval: '1h', end: slot(NOW0, HOUR) - 100 * HOUR, limit: 200 });
  assertEquals(inside.status, 200);
  assertEquals(inside.body.candles!.length, 200);
  assertEquals(kr.calls.length, 1);
  const outside = await call({ symbol: 'BTC-USD', interval: '1h', end: slot(NOW0, HOUR) - 730 * HOUR, limit: 200 });
  assertEquals(outside.status, 502);
  assertEquals([cb.calls.length, kr.calls.length], [2, 1]);
});

Deno.test('empty answer on a cold latest refresh: the back-fill fetches again and the caller gets data', async () => {
  fresh();
  cb.faults = ['empty'];
  const r = await call({ symbol: 'ETH-USD', interval: '15m' });
  assertEquals(r.status, 200);
  assertEquals(r.body.candles!.length, 300);
  assertEquals(cb.calls.length, 2);
  assertEquals(db.fetchState('ETH-USD', '15m')!.oldest_complete, null);
});
