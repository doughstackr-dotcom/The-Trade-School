// Abuse limits of supabase/functions/market-data: CORS pinned to the site (plus loopback for
// local development), the per-IP rate limit (public.take_rate_limit), Massive's shared daily
// budget (public.take_market_quota) and Massive's in-memory candle cache.
//
// Run (from the repo root):
//   deno test --no-config --node-modules-dir=none --allow-env --allow-read=supabase \
//     --allow-net=127.0.0.1 supabase/functions/tests/market_data_limits_test.ts
//
// Nothing leaves the process: Deno.serve is stubbed to capture the handler, and fetch is routed
// to the in-memory fakes of market_data_fakes.ts (PostgREST, exchanges, Alpha Vantage, Massive).
import { assert, assertEquals, assertExists, assertMatch } from 'jsr:@std/assert@1';
import {
  clock,
  DAY,
  FakeAlphaVantage,
  FakeCoinbase,
  FakeKraken,
  FakeMassive,
  FakePostgrest,
  installClock,
  installFetch,
  RealDate,
} from './market_data_fakes.ts';
import { resetMassiveState } from '../market-data/massive.ts';

// ---------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------

const SUPABASE_URL = 'http://fake.supabase';
const SITE_ORIGIN = 'https://example.github.io';
const PREVIEW_ORIGIN = 'https://preview.example.com';
Deno.env.set('SUPABASE_URL', SUPABASE_URL);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role');
Deno.env.set('SITE_URL', `${SITE_ORIGIN}/The-Trade-School/`);
Deno.env.set('ALLOWED_ORIGINS', `${PREVIEW_ORIGIN}/app/`);

// Wednesday 2026-09-23 15:00:10 UTC (10 s into a rate-limit window).
const WED = RealDate.UTC(2026, 8, 23, 15, 0, 10);
installClock(WED);

const db = new FakePostgrest();
const cb = new FakeCoinbase();
const kr = new FakeKraken();
const av = new FakeAlphaVantage();
const massive = new FakeMassive();
installFetch(db, cb, kr, SUPABASE_URL, av, massive);

type Handler = (req: Request) => Promise<Response>;
let handler: Handler | null = null;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: Handler) => {
  handler = h;
  return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {}, addr: { hostname: '127.0.0.1', port: 0, transport: 'tcp' } };
};
await import('../market-data/index.ts');
assertExists(handler, 'market-data did not call Deno.serve');

const logs: string[] = [];
const realWarn = console.warn;
const realError = console.error;
console.warn = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
console.error = (...a: unknown[]) => void logs.push(a.map(String).join(' '));

function fresh(opts: { limit?: string; massive?: boolean; massiveLimit?: string } = {}) {
  db.reset();
  cb.reset();
  kr.reset();
  av.reset();
  massive.reset();
  massive.massiveMarkets = {
    SPY: { base: 500, weekdaysOnly: true },
    AAPL: { base: 200, weekdaysOnly: true },
    'X:BTCUSD': { base: 60000, weekdaysOnly: false },
  };
  resetMassiveState();
  clock.now = WED;
  logs.length = 0;
  Math.random = () => 0.5;
  const set = (k: string, v: string | undefined) => (v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v));
  set('MARKET_DATA_RATE_LIMIT', opts.limit);
  set('MASSIVE_API_KEY', opts.massive ? massive.apiKey : undefined);
  set('MASSIVE_DAILY_LIMIT', opts.massiveLimit);
  set('MASSIVE_SPACING_MS', '0');
  Deno.env.delete('ALPHAVANTAGE_API_KEY');
  Deno.env.delete('MARKET_EXCHANGE_FEEDS');
}

type Result = { status: number; headers: Headers; body: Record<string, unknown> };
async function call(
  params: Record<string, unknown> | null,
  opts: { origin?: string | null; ip?: string; headers?: Record<string, string>; method?: string } = {},
): Promise<Result> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...opts.headers };
  const origin = opts.origin === undefined ? SITE_ORIGIN : opts.origin;
  if (origin !== null) headers.Origin = origin;
  if (opts.ip) headers['X-Forwarded-For'] = opts.ip;
  const method = opts.method ?? 'POST';
  const req = new Request('http://localhost/functions/v1/market-data', {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(params) : undefined,
  });
  const res = await handler!(req);
  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status, headers: res.headers, body };
}

const ACAO = 'Access-Control-Allow-Origin';
const rateRpcs = () => db.rpcCalls.filter((f) => f === 'take_rate_limit').length;
const massiveRanges = () => massive.calls.filter((c) => c.url.pathname.includes('/range/'));

// ---------------------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------------------

Deno.test('CORS: the site, ALLOWED_ORIGINS and loopback dev origins are echoed (preflight and data)', async () => {
  fresh();
  const allowed = [
    SITE_ORIGIN,
    PREVIEW_ORIGIN,
    'http://localhost:5173', // npm run serve
    'http://localhost:8080',
    'http://localhost',
    'http://127.0.0.1:5500',
    'http://[::1]:3000',
  ];
  for (const origin of allowed) {
    const pre = await call(null, { origin, method: 'OPTIONS' });
    assertEquals(pre.status, 200);
    assertEquals(pre.headers.get(ACAO), origin, origin);
    assertEquals(pre.headers.get('Vary'), 'Origin');
    assertMatch(pre.headers.get('Access-Control-Allow-Methods')!, /GET/);
    assertMatch(pre.headers.get('Access-Control-Allow-Headers')!, /apikey/);
    const cat = await call({ catalog: true }, { origin });
    assertEquals(cat.status, 200);
    assertEquals(cat.headers.get(ACAO), origin, origin);
    assertEquals(cat.headers.get('Vary'), 'Origin', 'cached per origin');
  }
});

Deno.test('CORS: every other origin gets no Access-Control-Allow-Origin at all (never *)', async () => {
  fresh();
  const denied = [
    'https://evil.example',
    'https://example.github.io.evil.example',
    'http://example.github.io', // scheme differs from SITE_URL
    'https://localhost:5173', // loopback is allowed over http only
    'http://localhost.evil.example',
    'http://127.0.0.2:5173',
    'http://192.168.1.10:5173',
    'null', // sandboxed iframes, file://
    '',
  ];
  for (const origin of denied) {
    for (const [params, method] of [[null, 'OPTIONS'], [{ catalog: true }, 'POST'], [{ symbol: 'NOPE', interval: '1d' }, 'POST']] as const) {
      const r = await call(params, { origin, method });
      assertEquals(r.headers.get(ACAO), null, `${method} from ${origin}`);
      assertEquals(r.headers.get('Vary'), 'Origin');
    }
  }
  // No Origin header (server-side callers, curl): no CORS header needed, data still served.
  const plain = await call({ catalog: true }, { origin: null });
  assertEquals([plain.status, plain.headers.get(ACAO)], [200, null]);
});

// ---------------------------------------------------------------------------------------
// Per-IP rate limit
// ---------------------------------------------------------------------------------------

Deno.test('rate limit: the N+1th request from one IP in a minute → 429 with Retry-After; other IPs are unaffected', async () => {
  fresh({ limit: '3' });
  const req = { symbol: 'SPY', interval: '1d' }; // unconfigured (503) but a real candle request
  for (let i = 0; i < 3; i++) assertEquals((await call(req, { ip: '203.0.113.5, 10.0.0.1' })).status, 503);
  const over = await call(req, { ip: '203.0.113.5, 10.0.0.2' });
  assertEquals(over.status, 429);
  assertEquals(over.body.rateLimited, true);
  assertMatch(String(over.body.error), /Too many/);
  assertEquals(over.headers.get('Retry-After'), '50'); // 10 s into the 60 s window
  assertEquals(over.headers.get('Cache-Control'), 'no-store');
  assertEquals(over.headers.get(ACAO), SITE_ORIGIN, 'the browser can read the 429');
  // A different client is not affected.
  assertEquals((await call(req, { ip: '198.51.100.7' })).status, 503);
  // The next window opens again.
  clock.now = WED + 50_000;
  assertEquals((await call(req, { ip: '203.0.113.5' })).status, 503);
});

Deno.test('rate limit: quotes are limited too; catalog, preflight and invalid input are not counted', async () => {
  fresh({ limit: '2', massive: true });
  const ip = '203.0.113.9';
  for (let i = 0; i < 5; i++) {
    await call({ catalog: true }, { ip });
    await call(null, { ip, method: 'OPTIONS' });
    await call({ symbol: 'NOPE', interval: '1d' }, { ip });
  }
  assertEquals(rateRpcs(), 0);
  assertEquals((await call({ quotes: true, symbols: ['SPY'] }, { ip })).status, 200);
  assertEquals((await call({ quotes: true, symbols: ['SPY'] }, { ip })).status, 200);
  const over = await call({ quotes: true, symbols: ['SPY'] }, { ip });
  assertEquals(over.status, 429);
  assertEquals(rateRpcs(), 3);
});

Deno.test('rate limit: keys are hashed (no raw IP stored); cf-connecting-ip wins over X-Forwarded-For', async () => {
  fresh({ limit: '1' });
  const req = { symbol: 'SPY', interval: '1d' };
  assertEquals((await call(req, { headers: { 'CF-Connecting-IP': '192.0.2.1' }, ip: '203.0.113.1' })).status, 503);
  // Same real client behind a different (spoofable) X-Forwarded-For: still the same bucket.
  assertEquals((await call(req, { headers: { 'CF-Connecting-IP': '192.0.2.1' }, ip: '203.0.113.2' })).status, 429);
  const keys = db.rows('api_rate_limits').map((r) => String(r.key));
  assertEquals(keys.length, 1);
  assertMatch(keys[0], /^market-data:ip:[0-9a-f]{32}$/);
  assert(!keys[0].includes('192.0.2.1'));
});

Deno.test('rate limit: default is 120 per minute; 0 turns it off; a limiter failure lets the request through (logged)', async () => {
  fresh();
  const req = { symbol: 'SPY', interval: '1d' };
  for (let i = 0; i < 120; i++) assertEquals((await call(req, { ip: '203.0.113.20' })).status, 503);
  assertEquals((await call(req, { ip: '203.0.113.20' })).status, 429);

  fresh({ limit: '0' });
  for (let i = 0; i < 5; i++) assertEquals((await call(req, { ip: '203.0.113.21' })).status, 503);
  assertEquals(rateRpcs(), 0);

  fresh({ limit: '1' });
  db.intercept = (c) =>
    c.table === 'rpc/take_rate_limit'
      ? new Response(JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.take_rate_limit' }), { status: 404 })
      : undefined;
  for (let i = 0; i < 3; i++) assertEquals((await call(req, { ip: '203.0.113.22' })).status, 503);
  assert(logs.some((l) => /take_rate_limit failed \(request allowed\)/.test(l)));
});

// ---------------------------------------------------------------------------------------
// Massive: shared daily budget and candle cache
// ---------------------------------------------------------------------------------------

Deno.test('Massive: every upstream call takes a unit of the shared daily budget; none once it is spent', async () => {
  fresh({ massive: true, massiveLimit: '2' });
  const a = await call({ symbol: 'SPY', interval: '1d', limit: 30 });
  assertEquals([a.status, a.body.source], [200, 'massive']);
  const b = await call({ symbol: 'AAPL', interval: '1d', limit: 30 });
  assertEquals([b.status, b.body.source], [200, 'massive']);
  assertEquals(db.quotaUsed('massive'), 2);
  assertEquals(massive.calls.length, 2);
  // Budget spent: no upstream call. Massive is skipped and the request falls through to the
  // other providers (none configured here).
  const c = await call({ symbol: 'BTC-USD', interval: '1d', limit: 30 });
  assertEquals(c.status, 503);
  assertEquals(massive.calls.length, 2);
  assertEquals(db.quotaUsed('massive'), 2);
  assert(logs.some((l) => /Massive daily request budget is used up/.test(l)));
  // Cached series still answer without spending anything.
  assertEquals((await call({ symbol: 'SPY', interval: '1d', limit: 30 })).status, 200);
  assertEquals(massive.calls.length, 2);
  // Quotes use the same budget (and degrade to per-symbol errors, not a crash).
  const q = await call({ quotes: true, symbols: ['SPY', 'BTC-USD'] });
  assertEquals(q.status, 200);
  assertEquals(massive.calls.length, 2);
  // The budget is per UTC day.
  clock.now = WED + DAY;
  assertEquals((await call({ symbol: 'BTC-USD', interval: '1d', limit: 30 })).body.source, 'massive');
  assertEquals(db.quotaUsed('massive'), 1);
});

Deno.test('Massive: a short chart cached first does not cut a longer chart short', async () => {
  fresh({ massive: true });
  const short = await call({ symbol: 'SPY', interval: '1d', limit: 30 });
  assertEquals((short.body.candles as unknown[]).length, 30);
  assertEquals(massiveRanges().length, 1);

  const long = await call({ symbol: 'SPY', interval: '1d', limit: 300 });
  assertEquals(long.status, 200);
  assertEquals((long.body.candles as unknown[]).length, 300, 'not the 30 cached candles');
  assertEquals(massiveRanges().length, 2, 'the longer window was fetched');

  // Anything up to the longest fetched window is now served from the cache.
  for (const limit of [30, 90, 300]) {
    const r = await call({ symbol: 'SPY', interval: '1d', limit });
    assertEquals((r.body.candles as unknown[]).length, limit);
  }
  assertEquals(massiveRanges().length, 2);
  // After the cache expires, a short request refetches the longest window it had, so a long
  // chart right after it is still a cache hit.
  clock.now = WED + 121_000;
  await call({ symbol: 'SPY', interval: '1d', limit: 30 });
  await call({ symbol: 'SPY', interval: '1d', limit: 300 });
  assertEquals(massiveRanges().length, 3);
  // Weekly works the same way.
  assertEquals(((await call({ symbol: 'SPY', interval: '1w', limit: 10 })).body.candles as unknown[]).length, 10);
  const weeks = await call({ symbol: 'SPY', interval: '1w', limit: 100 });
  assertEquals((weeks.body.candles as unknown[]).length, 100);
});

Deno.test('Massive: daily candles always end with the newest bar (upstream limit never cuts the recent end)', async () => {
  fresh({ massive: true });
  for (const [symbol, limit] of [['BTC-USD', 90], ['BTC-USD', 5], ['SPY', 90]] as const) {
    resetMassiveState();
    const r = await call({ symbol, interval: '1d', limit });
    const candles = r.body.candles as { t: number }[];
    assertEquals(candles.length, limit, symbol);
    assertEquals(candles.at(-1)!.t, RealDate.UTC(2026, 8, 23), `${symbol} ${limit}: newest bar is today's`);
  }
  for (const c of massiveRanges()) assertEquals(c.url.searchParams.get('limit'), '50000');
});

Deno.test('restore console', () => {
  console.warn = realWarn;
  console.error = realError;
});
