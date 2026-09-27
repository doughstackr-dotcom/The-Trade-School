// Public market candles for The Trade School's games, lessons and Live Lab.
//
// POST (or GET with query params) { symbol, interval, limit?, end? }
//   → { symbol, interval, candles: [{ t, o, h, l, c, v }], source, attribution, delayed, stale? }
//   t = candle open time in ms (UTC), oldest first. `end` (ms or ISO) asks for the `limit`
//   candles ending at that time; without it you get the latest candles.
//
// Candles are cached in public.market_candles. The newest candles are refreshed from the
// provider at most once per interval-dependent TTL (one request "claims" the refresh, the
// rest serve the cache), and historical windows are fetched once and kept. Upstream traffic
// therefore grows with the number of symbols, not with the number of users.
//
// Deployed with verify_jwt = false: this is public market data and callers use the
// publishable key (not a JWT). Every input is validated against a fixed allow-list.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import {
  INTERVAL_MS,
  PROVIDERS,
  SYMBOLS,
  type Candle,
  type Interval,
  type ProviderName,
  type SymbolMeta,
} from './providers.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TTL_MS: Record<Interval, number> = {
  '1m': 15_000,
  '5m': 45_000,
  '15m': 120_000,
  '1h': 300_000,
  '6h': 900_000,
  '1d': 1_800_000,
};
const MAX_LIMIT = 1000;
/** Candles per upstream page (Coinbase's maximum): asking for fewer costs the same request. */
const PAGE = 300;
/** How long a caller waits for another caller's in-flight refresh before serving the cache. */
const WAIT_MS = 3_000;
const POLL_MS = 250;
/** Earlier `end` values are rejected (catches seconds passed where milliseconds are expected). */
const MIN_END = Date.UTC(1980, 0, 1);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CORS = {
  'Access-Control-Allow-Origin': '*', // public, read-only data
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function respond(body: unknown, status = 200, maxAgeMs = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      'Cache-Control': maxAgeMs > 0 ? `public, max-age=${Math.floor(maxAgeMs / 1000)}` : 'no-store',
    },
  });
}

async function readParams(req: Request): Promise<Record<string, unknown>> {
  if (req.method === 'GET') return Object.fromEntries(new URL(req.url).searchParams);
  const body = await req.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {}; // `null` body must not throw
}

function sanitize(c: Candle): Candle | null {
  // Fractional ms would collapse onto the same timestamptz as a real candle and fail the whole upsert.
  if (!Number.isSafeInteger(c.t) || ![c.o, c.h, c.l, c.c].every(Number.isFinite)) return null;
  if (c.o <= 0 || c.c <= 0 || c.h <= 0 || c.l <= 0) return null;
  return {
    t: c.t,
    o: c.o,
    c: c.c,
    h: Math.max(c.h, c.o, c.c),
    l: Math.min(c.l, c.o, c.c),
    v: Number.isFinite(c.v) && c.v >= 0 ? c.v : 0,
  };
}

/**
 * Fill the intervals a sparse provider left out because nothing traded: flat at the previous
 * close with zero volume (what Kraken returns for them), between the candles we got and after
 * the last one up to `until`. Otherwise a quiet market looks like a hole in the cache and is
 * re-fetched on every request. Candles must be sorted and unique.
 */
function fillGaps(candles: Candle[], step: number, until: number): Candle[] {
  const out: Candle[] = [];
  const flat = (t: number, p: number): Candle => ({ t, o: p, h: p, l: p, c: p, v: 0 });
  for (const c of candles) {
    const prev = out[out.length - 1];
    if (prev) for (let t = prev.t + step; t < c.t; t += step) out.push(flat(t, prev.c));
    out.push(c);
  }
  const last = out[out.length - 1];
  if (last) for (let t = last.t + step; t <= until; t += step) out.push(flat(t, last.c));
  return out;
}

/** Store what `source` returned for a range ending at `fetchEnd`. */
async function store(symbol: string, interval: Interval, candles: Candle[], source: ProviderName, fetchEnd: number) {
  const step = INTERVAL_MS[interval];
  let clean = candles.map(sanitize).filter((c): c is Candle => c !== null);
  // Only intervals that have closed, with one interval of slack for candles published late.
  if (PROVIDERS[source].sparse) clean = fillGaps(clean, step, Math.min(fetchEnd - 1, Date.now() - 2 * step));
  const rows = clean.map((c) => ({ symbol, interval, t: new Date(c.t).toISOString(), o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from('market_candles')
      .upsert(rows.slice(i, i + 500), { onConflict: 'symbol,interval,t' });
    if (error) throw error;
  }
}

async function load(symbol: string, interval: Interval, limit: number, endMs: number | null): Promise<Candle[]> {
  let q = admin
    .from('market_candles')
    .select('t, o, h, l, c, v')
    .eq('symbol', symbol)
    .eq('interval', interval)
    .order('t', { ascending: false })
    .limit(limit);
  if (endMs !== null) q = q.lte('t', new Date(endMs).toISOString());
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => ({ t: Date.parse(r.t), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v })).reverse();
}

/** Largest normal distance between consecutive candles before we call it a hole in the cache. */
function maxGap(meta: SymbolMeta, interval: Interval): number {
  const step = INTERVAL_MS[interval];
  if (meta.class === 'crypto') return step * 3; // 24/7 markets
  return Math.max(step * 3, 4 * 86_400_000); // sessions, weekends, holidays
}

/** Wall-clock span of `limit` candles: markets with sessions need more calendar time. */
function spanMs(meta: SymbolMeta, interval: Interval, limit: number): number {
  const step = INTERVAL_MS[interval];
  if (meta.class === 'crypto') return limit * step;
  if (interval === '1d') return Math.ceil(limit * 1.5) * step; // ~252 trading days a year
  return Math.ceil(limit * 5.5) * step; // ~6.5 trading hours a day, 5 days a week
}

function hasHole(candles: Candle[], meta: SymbolMeta, interval: Interval): boolean {
  const gap = maxGap(meta, interval);
  for (let i = 1; i < candles.length; i++) if (candles[i].t - candles[i - 1].t > gap) return true;
  return false;
}

async function fetchUpstream(meta: SymbolMeta, interval: Interval, startMs: number, endMs: number) {
  let lastError: unknown = null;
  for (const name of meta.providers) {
    const provider = PROVIDERS[name];
    if (!provider.available() || !provider.supports(interval)) continue;
    // Kraken only keeps the latest 720 candles: for an older range it would answer "nothing",
    // which would be cached as an empty window (and read as the listing date).
    if (provider.maxBack && endMs < Date.now() - (provider.maxBack - 1) * INTERVAL_MS[interval]) continue;
    try {
      return { candles: await provider.fetch(meta, interval, startMs, endMs), source: name };
    } catch (err) {
      lastError = err;
      console.warn(`${name} failed for ${meta.id} ${interval}: ${(err as Error).message}`);
    }
  }
  throw lastError ?? new Error(`No provider for ${meta.id} ${interval}`);
}

/** True for exactly one caller per TTL window: that caller refreshes the latest candles. */
async function claimRefresh(symbol: string, interval: Interval): Promise<boolean> {
  const now = new Date().toISOString();
  const { data: inserted } = await admin
    .from('market_fetches')
    .upsert({ symbol, interval, fetched_at: now }, { onConflict: 'symbol,interval', ignoreDuplicates: true })
    .select('symbol');
  if (inserted && inserted.length) return true;
  const threshold = new Date(Date.now() - TTL_MS[interval]).toISOString();
  const { data: updated } = await admin
    .from('market_fetches')
    .update({ fetched_at: now })
    .eq('symbol', symbol)
    .eq('interval', interval)
    .lt('fetched_at', threshold)
    .select('symbol');
  return Boolean(updated && updated.length);
}

async function releaseClaim(symbol: string, interval: Interval) {
  // Let the next request retry in ~5 s instead of waiting a full TTL after a failure.
  const retryAt = new Date(Date.now() - TTL_MS[interval] + 5_000).toISOString();
  await admin.from('market_fetches').update({ fetched_at: retryAt }).eq('symbol', symbol).eq('interval', interval);
}

/** Remember that the provider has nothing before `t`. Creates the row when only history was asked for so far. */
async function saveFloor(symbol: string, interval: Interval, t: number) {
  const oldest_complete = new Date(t).toISOString();
  const { data } = await admin
    .from('market_fetches')
    .update({ oldest_complete })
    .eq('symbol', symbol)
    .eq('interval', interval)
    .select('symbol');
  if (data?.length) return;
  // fetched_at in the past, so creating the row doesn't hold back the first refresh of the latest candles.
  await admin
    .from('market_fetches')
    .upsert(
      { symbol, interval, oldest_complete, fetched_at: new Date(0).toISOString() },
      { onConflict: 'symbol,interval', ignoreDuplicates: true },
    );
}

function staleResponse(meta: SymbolMeta, symbol: string, interval: Interval, candles: Candle[]): Response {
  const provider = PROVIDERS[meta.providers[0]];
  return respond({
    symbol, interval, candles, source: 'cache', attribution: provider.attribution, delayed: true, stale: true,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET' && req.method !== 'POST') return respond({ error: 'Use GET or POST.' }, 405);

  const p = await readParams(req);
  const symbol = String(p.symbol ?? '').toUpperCase();
  const interval = String(p.interval ?? '') as Interval;
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(p.limit) || 300)));
  const endRaw = p.end;
  const endMs = endRaw === undefined || endRaw === null || endRaw === ''
    ? null
    : Number.isFinite(Number(endRaw)) ? Number(endRaw) : Date.parse(String(endRaw));

  // hasOwn: `interval in INTERVAL_MS` also accepted "toString", "constructor", "__proto__", …
  const meta = Object.hasOwn(SYMBOLS, symbol) ? SYMBOLS[symbol] : undefined;
  if (!meta) return respond({ error: `Unknown symbol "${symbol}".`, symbols: Object.keys(SYMBOLS) }, 400);
  if (!Object.hasOwn(INTERVAL_MS, interval)) return respond({ error: 'interval must be one of 1m 5m 15m 1h 6h 1d.' }, 400);
  if (endMs !== null && !(Number.isFinite(endMs) && endMs >= MIN_END)) {
    return respond({ error: 'end must be a timestamp in milliseconds or an ISO 8601 date.' }, 400);
  }
  if (!meta.providers.some((n) => PROVIDERS[n].available() && PROVIDERS[n].supports(interval))) {
    return respond({ error: `${symbol} ${interval} is not available yet.`, unconfigured: true }, 503);
  }

  const step = INTERVAL_MS[interval];
  const gap = maxGap(meta, interval);
  const now = Date.now();
  const wantEnd = endMs === null ? now : Math.min(endMs, now);
  const wantStart = wantEnd - spanMs(meta, interval, limit);
  const isLatest = now - wantEnd < step * 2;
  let source: string = meta.providers[0];
  let claimed = false;

  try {
    // 1. Keep the newest candles fresh (one caller per TTL does the upstream request).
    if (isLatest && (await claimRefresh(symbol, interval))) {
      claimed = true;
      try {
        // Start at the newest cached candle: it may have been stored while still forming, and an
        // idle spell would otherwise leave a hole. On a cold cache, cover this request's window.
        const [newest] = await load(symbol, interval, 1, null);
        const from = Math.min(now - 120 * step, newest ? Math.max(newest.t, now - MAX_LIMIT * step) : wantStart);
        const recent = await fetchUpstream(meta, interval, from, now);
        await store(symbol, interval, recent.candles, recent.source, now);
        await admin.from('market_fetches').update({ source: recent.source }).eq('symbol', symbol).eq('interval', interval);
        source = recent.source;
      } catch (err) {
        await releaseClaim(symbol, interval);
        throw err;
      }
    }

    let candles = await load(symbol, interval, limit, endMs);
    const lastT = () => (candles.length ? candles[candles.length - 1].t : -Infinity);

    // 2. Someone else holds the refresh claim. If the cache doesn't reach "now" yet, their refresh
    //    is in flight: wait for it instead of every caller going upstream at once.
    if (isLatest && !claimed && wantEnd - lastT() > gap) {
      for (let waited = 0; waited < WAIT_MS && wantEnd - lastT() > gap; waited += POLL_MS) {
        await sleep(POLL_MS);
        candles = await load(symbol, interval, limit, endMs);
      }
      if (candles.length && wantEnd - lastT() > gap) return staleResponse(meta, symbol, interval, candles);
    }

    // 3. Back-fill history the cache doesn't cover yet (bounded by the provider's listing date).
    const { data: state } = await admin
      .from('market_fetches')
      .select('oldest_complete, source')
      .eq('symbol', symbol)
      .eq('interval', interval)
      .maybeSingle();
    if (state?.source && !claimed) source = state.source;
    const floor = state?.oldest_complete ? Date.parse(state.oldest_complete) : -Infinity;
    // The cache must reach the requested end, have no holes, and go back far enough.
    const tailMissing = wantEnd - lastT() > gap;
    const hole = hasHole(candles, meta, interval);
    const headMissing = candles.length < limit && (candles.length === 0 || candles[0].t - step > Math.max(floor, wantStart));

    if (tailMissing || hole || headMissing) {
      const fetchEnd = tailMissing || hole ? wantEnd : candles[0].t;
      // At least one full page (same cost), never below what is known to be empty.
      const fetchStart = Math.max(floor, Math.min(wantStart, fetchEnd - PAGE * step));
      if (fetchStart < fetchEnd) {
        const hist = await fetchUpstream(meta, interval, fetchStart, fetchEnd);
        await store(symbol, interval, hist.candles, hist.source, fetchEnd);
        // Nothing in [fetchStart, emptyUntil): that is the listing date if the provider keeps full
        // history and either the known floor was the start or the empty stretch is a whole page
        // long (a few quiet minutes in a thin market are not a listing date).
        const emptyUntil = hist.candles.length ? hist.candles[0].t : fetchEnd;
        if (
          !PROVIDERS[hist.source].maxBack && emptyUntil > floor &&
          (fetchStart <= floor || emptyUntil - fetchStart >= PAGE * step)
        ) {
          await saveFloor(symbol, interval, emptyUntil);
        }
        candles = await load(symbol, interval, limit, endMs);
      }
    }

    if (Math.random() < 0.01) await admin.rpc('prune_market_candles');

    const provider = PROVIDERS[(Object.hasOwn(PROVIDERS, source) ? source : meta.providers[0]) as ProviderName];
    return respond(
      { symbol, interval, candles, source, attribution: provider.attribution, delayed: provider.delayed },
      200,
      isLatest ? Math.min(TTL_MS[interval], 60_000) : 3_600_000,
    );
  } catch (err) {
    console.error(`market-data ${symbol} ${interval} failed: ${(err as Error).message}`);
    try {
      const cached = await load(symbol, interval, limit, endMs);
      if (cached.length) return staleResponse(meta, symbol, interval, cached);
    } catch { /* fall through */ }
    return respond({ error: 'Market data is unavailable right now.' }, 502);
  }
});
