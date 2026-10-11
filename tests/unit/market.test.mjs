// js/core/market.js with an injected fetch: mock (fixture) mode, the real function protocol,
// failures that must never throw, session caching, and live / replay subscriptions.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  configureMarket, resetMarketCache, getCatalog, getCandles, getHistory, getQuotes, subscribeLive, marketStatus, marketInfo,
  isMockMode, normalizeCandles, intervalLabel, formatCandleTime, revealLabel, axisLabel, SYMBOLS, INTERVAL_MS, onMarketStatus,
} from '../../js/core/market.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'market');
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** fetch that serves fixture files for fixture://NAME.json and records every call. */
function fixtureFetch(calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith('fixture://')) {
      const file = path.join(FIX, url.slice('fixture://'.length));
      if (!fs.existsSync(file)) return json(404, { error: 'not found' });
      return json(200, JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    throw new Error(`unexpected request ${url}`);
  };
}
const mock = (extra = {}) => configureMarket({ mock: true, fixturesBase: 'fixture://', fetch: fixtureFetch(extra.calls), ...extra, calls: undefined });
const collect = (sub, until, timeout = 3000) =>
  new Promise((resolve, reject) => {
    const got = [];
    let unsub = null;
    const timer = setTimeout(() => {
      unsub?.();
      reject(new Error(`timed out with ${got.length} updates: ${JSON.stringify(got.map((u) => u.status))}`));
    }, timeout);
    unsub = sub((u) => {
      got.push(u);
      if (until(got)) {
        clearTimeout(timer);
        setTimeout(() => {
          unsub();
          resolve(got);
        }, 0);
      }
    });
  });

afterEach(() => {
  for (const k of ['fetch', 'mock', 'fixturesBase', 'url', 'key', 'retryMs', 'timeoutMs', 'mockStepMs', 'pollMs', 'now', 'document', 'storage']) configureMarket({ [k]: undefined });
  resetMarketCache();
});

test('fixtures: labelled test data, valid candles on real interval boundaries ending 25 Sep 2026', () => {
  const files = fs.readdirSync(FIX).filter((f) => f.endsWith('.json'));
  for (const name of ['BTC-USD_1d', 'BTC-USD_1w', 'ETH-USD_1d', 'ETH-USD_1w', 'SPY_1d', 'SPY_1w', 'EUR-USD_1d', 'EUR-USD_1w', 'BTC-USD_1m', 'BTC-USD_5m', 'catalog']) {
    assert.ok(files.includes(`${name}.json`), `missing fixture ${name}`);
  }
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
    assert.match(d._note, /TEST FIXTURE/);
    assert.equal(d.fixture, true);
    if (f === 'catalog.json') continue;
    const cs = d.candles;
    const want = { '1d': 500, '1w': 600, '1m': 300, '5m': 300 }[d.interval];
    assert.equal(cs.length, want, f);
    assert.match(d.attribution, /fixture/i);
    const step = INTERVAL_MS[d.interval];
    cs.forEach((k, i) => {
      assert.ok(k.l <= Math.min(k.o, k.c) && Math.max(k.o, k.c) <= k.h && k.l > 0, `${f} #${i}`);
      assert.equal(k.t % (d.interval === '1w' ? INTERVAL_MS['1d'] : step), 0, `${f} #${i} not on an interval boundary`);
      if (i) assert.ok(k.t > cs[i - 1].t);
      const dow = new Date(k.t).getUTCDay();
      if (d.interval === '1w') assert.equal(dow, 1, `${f}: weekly candles are keyed by Monday`);
      if (d.interval === '1d' && (d.symbol === 'SPY' || d.symbol === 'EUR-USD')) assert.ok(dow >= 1 && dow <= 5, `${f}: weekend candle`);
    });
    const last = new Date(cs[cs.length - 1].t).toISOString().slice(0, 10);
    assert.ok(['2026-09-25', '2026-09-21'].includes(last), `${f} ends ${last}`);
    if (d.symbol === 'EUR-USD') assert.ok(cs.every((k) => k.v === 0), 'FX has no volume (like the real feed)');
  }
});

test('mock mode: catalog, candles and history come from the fixtures', async () => {
  const calls = [];
  mock({ calls });
  assert.equal(isMockMode(), true);
  const cat = await getCatalog();
  assert.equal(cat.status, 'online');
  assert.equal(cat.mock, true);
  assert.deepEqual(cat.symbols.map((s) => s.id).sort(), ['BTC-USD', 'ETH-USD', 'EUR-USD', 'SPY']);
  assert.equal(cat.symbols.find((s) => s.id === 'EUR-USD').decimals, 5);
  const r = await getCandles({ symbol: 'spy', interval: '1d', limit: 120 });
  assert.equal(r.status, 'online');
  assert.equal(r.symbol, 'SPY');
  assert.equal(r.candles.length, 120);
  assert.equal(r.mock, true);
  assert.match(r.attribution, /fixture/i);
  const end = r.candles[50].t;
  const r2 = await getCandles({ symbol: 'SPY', interval: '1d', limit: 10, end });
  assert.equal(r2.candles[r2.candles.length - 1].t, end);
  // Not in the fixture catalog: empty + unconfigured, no throw, and no request (no 404).
  const n0 = calls.length;
  const miss = await getCandles({ symbol: 'QQQ', interval: '1d' });
  assert.deepEqual(miss.candles, []);
  assert.equal(miss.status, 'unconfigured');
  assert.equal((await getCandles({ symbol: 'SPY', interval: '1h' })).status, 'unconfigured');
  assert.equal(calls.length, n0, 'no fixture request for markets the catalog does not list');
  // History: concurrent calls share one fixture request and are cached.
  const before = calls.length;
  const [h1, h2] = await Promise.all([getHistory({ symbol: 'BTC-USD', interval: '1w' }), getHistory({ symbol: 'BTC-USD', interval: '1w' })]);
  assert.equal(h1.candles.length, 600);
  assert.deepEqual(h1.candles, h2.candles);
  const h3 = await getHistory({ symbol: 'BTC-USD', interval: '1w', bars: 100 });
  assert.equal(h3.candles.length, 100);
  assert.equal(calls.length - before, 1, 'one request for three history calls');
  assert.equal(marketStatus(), 'online');
});

test('real mode: POSTs to the market-data function with the publishable key', async () => {
  const calls = [];
  configureMarket({
    url: 'https://example.test/',
    key: 'pk_test',
    fetch: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      const b = JSON.parse(init.body);
      if (b.catalog) return json(200, { symbols: [{ id: 'SPY', name: 'SPDR', class: 'etf', intervals: ['1d', '1w', '1x'] }, { id: 'X', intervals: [] }] });
      return json(200, { symbol: b.symbol, interval: b.interval, candles: [{ t: 2, o: 2, h: 3, l: 1, c: 2.5, v: 5 }, { t: 1, o: 1, h: 2, l: 0.5, c: 2, v: 3 }, { t: 1, o: 9, h: 9, l: 9, c: 9 }, { t: 3, o: 'x' }], source: 'alphavantage', attribution: 'Market data: Alpha Vantage', delayed: true });
    },
  });
  const cat = await getCatalog();
  assert.equal(calls[0].url, 'https://example.test/functions/v1/market-data');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.apikey, 'pk_test');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer pk_test');
  assert.deepEqual(calls[0].body, { catalog: true });
  assert.deepEqual(cat.symbols.map((s) => s.id), ['SPY']);
  assert.deepEqual(cat.symbols[0].intervals, ['1d', '1w']);
  assert.equal(cat.symbols[0].delayed, true);
  const r = await getCandles({ symbol: 'SPY', interval: '1d', limit: 5, end: 1234 });
  assert.deepEqual(calls[1].body, { symbol: 'SPY', interval: '1d', limit: 5, end: 1234 });
  assert.deepEqual(r.candles.map((k) => k.t), [1, 2], 'sorted, de-duplicated, junk dropped');
  assert.equal(r.attribution, 'Market data: Alpha Vantage');
  assert.equal(r.delayed, true);
  assert.equal(r.status, 'online');
  // Unknown interval never reaches the network.
  const bad = await getCandles({ symbol: 'SPY', interval: '2d' });
  assert.equal(bad.status, 'unconfigured');
  assert.equal(calls.length, 2);
});

test('failures never throw: offline catalog fallback, unconfigured, retries, timeouts', async () => {
  let n = 0;
  const statuses = [];
  const off = onMarketStatus((s) => statuses.push(s));
  configureMarket({ url: 'https://x.test', key: 'k', retryMs: [1, 1], fetch: async () => {
    n++;
    throw new TypeError('Failed to fetch');
  } });
  const cat = await getCatalog();
  assert.equal(cat.status, 'offline');
  assert.equal(cat.symbols.length, 12);
  assert.deepEqual(cat.symbols.map((s) => s.id), SYMBOLS.map((s) => s.id));
  assert.ok(cat.symbols.every((s) => s.intervals.join() === '1d,1w' && !s.live));
  assert.equal(marketStatus(), 'offline');
  n = 0;
  const r = await getCandles({ symbol: 'SPY', interval: '1d' });
  assert.deepEqual(r.candles, []);
  assert.equal(r.status, 'offline');
  assert.equal(n, 3, 'two retries after the first attempt');
  // 503 unconfigured: no retry.
  n = 0;
  configureMarket({ fetch: async () => {
    n++;
    return json(503, { error: 'not available yet', unconfigured: true });
  } });
  const u = await getCandles({ symbol: 'SPY', interval: '1w' });
  assert.equal(u.status, 'unconfigured');
  assert.equal(n, 1);
  assert.equal(marketStatus(), 'unconfigured');
  assert.equal(marketInfo().lastError, 'not available yet');
  // 5xx: retried.
  n = 0;
  configureMarket({ fetch: async () => {
    n++;
    return json(500, { error: 'boom' });
  } });
  assert.equal((await getCandles({ symbol: 'SPY', interval: '1d' })).status, 'offline');
  assert.equal(n, 3);
  // Timeout: the request is aborted.
  configureMarket({ timeoutMs: 20, retryMs: [1, 1], fetch: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
  const t = await getCandles({ symbol: 'SPY', interval: '1d' });
  assert.equal(t.status, 'offline');
  assert.equal(t.error, 'timeout');
  // A failed history load is not cached for good, and never throws.
  const h = await getHistory({ symbol: 'SPY', interval: '1d' });
  assert.deepEqual(h.candles, []);
  off();
  assert.ok(statuses.includes('offline') && statuses.includes('unconfigured'));
});

test('replay: a real stretch played forward, candles forming in ticks, stops on unsubscribe', async () => {
  mock();
  const got = await collect((fn) => subscribeLive({ symbol: 'ETH-USD', interval: '1d', bars: 60, stepMs: 40, seed: 7 }, fn), (g) => g.length >= 10);
  assert.ok(got.every((u) => u.status === 'replay'));
  assert.equal(got[0].candles.length, 60);
  assert.equal(got[0].forming, false);
  assert.ok(got.some((u) => u.forming), 'forming ticks');
  const full = got.filter((u) => !u.forming);
  assert.ok(full.length >= 2);
  assert.ok(full[full.length - 1].last.t > full[0].last.t, 'moves forward in time');
  assert.equal(got[0].replay.requested, '1d');
  assert.equal(got[0].interval, '1d');
  assert.match(got[0].attribution, /fixture/i);
  // Unsupported interval: replays the finest available one.
  const alt = await collect((fn) => subscribeLive({ symbol: 'SPY', interval: '1m', bars: 30, stepMs: 20, seed: 1 }, fn), (g) => g.length >= 1);
  assert.equal(alt[0].interval, '1d');
  assert.equal(alt[0].replay.requested, '1m');
});

test('live: polls when the catalog says live (mock clock adds candles)', async () => {
  let clock = 1_000_000;
  mock({ now: () => clock, mockStepMs: 1000, pollMs: 15 });
  const got = await collect((fn) => {
    const unsub = subscribeLive({ symbol: 'BTC-USD', interval: '1m', bars: 50 }, fn);
    const iv = setInterval(() => (clock += 1000), 10);
    return () => {
      clearInterval(iv);
      unsub();
    };
  }, (g) => g.length >= 3);
  assert.ok(got.every((u) => u.status === 'live'));
  assert.equal(got[0].candles.length, 50);
  assert.ok(got[2].last.t > got[0].last.t);
});

test('live/replay: offline without data, pauses while the tab is hidden', async () => {
  configureMarket({ url: 'https://x.test', key: 'k', retryMs: [1, 1], fetch: async () => {
    throw new TypeError('offline');
  } });
  const got = await collect((fn) => subscribeLive({ symbol: 'SPY', interval: '1d' }, fn), (g) => g.length >= 1);
  assert.equal(got[0].status, 'offline');
  assert.deepEqual(got[0].candles, []);
  // Hidden tab: no ticks until visible again.
  const listeners = [];
  const doc = { hidden: true, addEventListener: (t, fn) => listeners.push(fn), removeEventListener: () => {} };
  configureMarket({ fetch: undefined, url: undefined, key: undefined, retryMs: undefined, document: doc });
  mock({ document: doc });
  const seen = [];
  const unsub = subscribeLive({ symbol: 'SPY', interval: '1d', bars: 40, stepMs: 20, seed: 3 }, (u) => seen.push(u));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(seen.length, 1, 'only the initial snapshot while hidden');
  doc.hidden = false;
  listeners.forEach((fn) => fn());
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(seen.length > 2, 'resumes when visible');
  unsub();
  const n = seen.length;
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(seen.length, n, 'no updates after unsubscribe');
});


test('getQuotes: mock mode returns massive-shaped quotes; live path defaults source to massive', async () => {
  mock();
  const mockRes = await getQuotes({ symbols: ['SPY', 'QQQ'] });
  assert.equal(mockRes.source, 'mock');
  assert.equal(mockRes.quotes.length, 2);
  assert.equal(mockRes.quotes[0].ok, true);
  assert.equal(mockRes.quotes[0].providerSymbol, 'SPY');
  assert.ok(Number.isFinite(mockRes.quotes[0].price));

  const calls = [];
  configureMarket({
    mock: false,
    url: 'https://x.test',
    key: 'k',
    retryMs: [1],
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return json(200, {
        quotes: [{
          symbol: 'SPY', providerSymbol: 'SPY', name: 'S&P 500 ETF',
          price: 500, prevClose: 495, change: 5, changePct: 1.01,
          currency: 'USD', asOf: 1, sparkline: [490, 495, 500], ok: true,
        }],
        stale: false,
        attribution: 'Quotes: Massive.com (end-of-day on free tier). Educational use.',
        fetchedAt: 42,
        source: 'massive',
      });
    },
  });
  const live = await getQuotes({ symbols: ['SPY'] });
  assert.equal(live.source, 'massive');
  assert.match(live.attribution, /Massive\.com/);
  assert.equal(live.quotes[0].price, 500);
  assert.equal(calls[0].body.quotes, true);
  assert.deepEqual(calls[0].body.symbols, ['SPY']);

  configureMarket({
    mock: false, url: 'https://x.test', key: 'k', retryMs: [1],
    fetch: async () => json(503, { unconfigured: true, source: 'massive', error: 'no key' }),
  });
  const miss = await getQuotes({ symbols: ['SPY'] });
  assert.equal(miss.source, 'massive');
  assert.equal(miss.unconfigured, true);
  assert.deepEqual(miss.quotes, []);
  assert.ok(miss.error);
  assert.equal(miss.delayed, true);
});

test('labels and candle clean-up helpers', () => {
  assert.equal(intervalLabel('1w'), 'Weekly');
  assert.equal(intervalLabel('1d'), 'Daily');
  const t = Date.UTC(2026, 2, 12, 14, 5);
  assert.equal(formatCandleTime(t, '1d'), '12 Mar 2026');
  assert.equal(formatCandleTime(t, '1h'), '12 Mar 2026 14:05 UTC');
  assert.equal(revealLabel({ symbol: 'BTC-USD', interval: '1w', t }), 'BTC-USD · Weekly · 12 Mar 2026');
  assert.equal(axisLabel(t, '1w'), 'Mar 26');
  assert.equal(axisLabel(t, '5m'), '14:05');
  assert.deepEqual(normalizeCandles([{ t: '5', o: '2', h: '1', l: '3', c: '2' }]), [{ t: 5, o: 2, h: 2, l: 2, c: 2, v: 0 }]);
  assert.deepEqual(normalizeCandles(null), []);
});
