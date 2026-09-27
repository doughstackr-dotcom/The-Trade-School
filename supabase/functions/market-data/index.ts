// Public market candles for The Trade School's games, lessons and Live Lab.
//
// POST (or GET with query params) { symbol, interval, limit?, end? }
//   → { symbol, interval, candles: [{ t, o, h, l, c, v }], source, attribution, delayed, stale? }
//   t = candle open time in ms (UTC), oldest first (weekly candles open on Monday 00:00 UTC).
//   `end` (ms or ISO) asks for the `limit` candles ending at that time; without it you get the
//   latest candles.
// POST { catalog: true } (or GET ?catalog=1)
//   → { symbols: [{ id, name, class, decimals, intervals, live, delayed, attribution }],
//       status: 'ok' | 'unconfigured' }   (intervals: what the configured providers serve)
// Errors: 400 bad input; 503 { unconfigured: true } no provider is set up for that
// symbol/interval; 503 { quota: true } the daily budget of a metered provider is used up and
// nothing is cached yet; 502 provider failure with nothing cached. With a cache, failures
// answer 200 { stale: true } (no-store) instead.
//
// Candles are cached in public.market_candles, so upstream traffic grows with the number of
// symbols, not with the number of users. One request "claims" each refresh of the latest
// candles (single flight, table market_fetches); the rest serve the cache.
//   * Exchange feeds (Coinbase, Kraken): the latest candles are refreshed at most once per
//     interval-dependent TTL, and history is fetched page by page once and kept.
//   * Metered snapshot providers (Alpha Vantage, 25 calls/day on the free key): each call
//     returns the provider's whole series (latest ~100 daily candles, or full weekly history)
//     and takes a unit of the shared daily budget (public.take_market_quota). The series is
//     refreshed at most once per new candle boundary (the next close), everything is served
//     from the cache, and nothing is ever back-filled.
//
// Deployed with verify_jwt = false: this is public market data and callers use the
// publishable key (not a JWT). Every input is validated against a fixed allow-list.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import {
  type Candle,
  type Interval,
  INTERVAL_MS,
  INTERVALS,
  INTRADAY,
  type Provider,
  type ProviderContext,
  type ProviderName,
  PROVIDERS,
  QuotaExhausted,
  redactKey,
  type SymbolMeta,
  SYMBOLS,
} from './providers.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Exchange feeds: how long the latest candles stay fresh. For every provider, a refresh claimed
 * at `fetched_at` blocks the next claim until fetched_at + TTL (metered providers shift
 * fetched_at so that this lands on the next candle boundary, see serveMetered).
 */
const TTL_MS: Record<Interval, number> = {
  '1m': 15_000,
  '5m': 45_000,
  '15m': 120_000,
  '1h': 300_000,
  '6h': 900_000,
  '1d': 1_800_000,
  '1w': 3_600_000,
};
const MAX_LIMIT = 1000;
/** Candles per upstream page (Coinbase's maximum): asking for fewer costs the same request. */
const PAGE = 300;
/** How long a caller waits for another caller's in-flight refresh before serving the cache. */
const WAIT_MS = 3_000;
/** Same, for the very first fill of a metered series (a paced provider call may queue briefly). */
const FIRST_FILL_WAIT_MS = 8_000;
/** A refresh claimed less than this long ago may still be in flight (provider calls time out sooner). */
const IN_FLIGHT_MS = 60_000;
const POLL_MS = 250;
/** Earlier `end` values are rejected (catches seconds passed where milliseconds are expected). */
const MIN_END = Date.UTC(1980, 0, 1);
const CATALOG_MAX_AGE_MS = 300_000;
/** Metered providers: wait before retrying after a failed call (each attempt costs a unit). */
const METERED_RETRY_MS = 3_600_000;
const DAY = 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (ms: number) => new Date(ms).toISOString();
/**
 * Metered rows' market_fetches.fetched_at: a claim writes an odd millisecond, a hold (or a finished
 * refresh) an even one. A hold's reopening time minus the TTL can look exactly like a claim made a
 * few seconds ago; the parity tells a first fill in flight (worth waiting for) from a hold.
 */
const claimStamp = (ms: number) => iso(ms - (ms % 2) + 1);
const holdStamp = (ms: number) => iso(ms - (ms % 2));
const isClaimStamp = (ms: number) => ms % 2 === 1;
/** For logs: an error's message without the Alpha Vantage key (upstream URLs carry it). */
const logText = (err: unknown) => redactKey(err instanceof Error ? err.message : String(err));

const CORS = {
  'Access-Control-Allow-Origin': '*', // public, read-only data
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/** The shared daily request budget of metered providers (public.market_quota, service role only). */
const ctx: ProviderContext = {
  async takeQuota(provider, dailyLimit) {
    const { data, error } = await admin.rpc('take_market_quota', { p_provider: provider, p_daily_limit: dailyLimit });
    if (error) throw new Error(`take_market_quota failed: ${error.message}`);
    return data === true;
  },
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
 * close with zero volume (the usual exchange convention; v = 0 marks them), between the candles
 * we got and after the last one up to `until`. Otherwise a quiet market looks like a hole in the
 * cache and is re-fetched on every request. Candles must be sorted and unique.
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

/**
 * Largest normal distance between consecutive candles before we call it a hole in the cache:
 * markets with sessions skip nights, weekends and holidays (up to 5 calendar days), and every
 * week has trading days.
 */
function maxGap(meta: SymbolMeta, interval: Interval): number {
  const step = INTERVAL_MS[interval];
  if (meta.class === 'crypto' || interval === '1w') return step * 3;
  return Math.max(step * 3, 5 * DAY);
}

/** Wall-clock span of `limit` candles: markets with sessions need more calendar time. */
function spanMs(meta: SymbolMeta, interval: Interval, limit: number): number {
  const step = INTERVAL_MS[interval];
  if (meta.class === 'crypto' || interval === '1w') return limit * step;
  if (interval === '1d') return Math.ceil(limit * 1.5) * step; // ~252 trading days a year
  return Math.ceil(limit * 5.5) * step; // ~6.5 trading hours a day, 5 days a week
}

function hasHole(candles: Candle[], meta: SymbolMeta, interval: Interval): boolean {
  const gap = maxGap(meta, interval);
  for (let i = 1; i < candles.length; i++) if (candles[i].t - candles[i - 1].t > gap) return true;
  return false;
}

/** Try `names` in order; the first provider that answers wins. */
async function fetchUpstream(meta: SymbolMeta, interval: Interval, startMs: number, endMs: number, names: ProviderName[]) {
  let lastError: unknown = null;
  for (const name of names) {
    const provider = PROVIDERS[name];
    // Kraken only keeps the latest 720 candles: for an older range it would answer "nothing",
    // which would be cached as an empty window (and read as the listing date).
    const back = provider.maxBack?.(interval);
    if (back !== undefined && endMs < Date.now() - (back - 1) * INTERVAL_MS[interval]) continue;
    try {
      return { candles: await provider.fetch(meta, interval, startMs, endMs, ctx), source: name };
    } catch (err) {
      lastError = err;
      console.warn(`${name} failed for ${meta.id} ${interval}: ${logText(err)}`);
    }
  }
  throw lastError ?? new Error(`No provider for ${meta.id} ${interval}`);
}

/**
 * True for exactly one caller until fetched_at + ttl: that caller refreshes the latest candles.
 * `key` is the interval, or `<interval>/fallback` for a metered provider behind exchange feeds.
 */
async function claimRow(symbol: string, key: string, ttl: number, stamp = iso): Promise<boolean> {
  const now = stamp(Date.now());
  const { data: inserted } = await admin
    .from('market_fetches')
    .upsert({ symbol, interval: key, fetched_at: now }, { onConflict: 'symbol,interval', ignoreDuplicates: true })
    .select('symbol');
  if (inserted && inserted.length) return true;
  const threshold = new Date(Date.now() - ttl).toISOString();
  const { data: updated } = await admin
    .from('market_fetches')
    .update({ fetched_at: now })
    .eq('symbol', symbol)
    .eq('interval', key)
    .lt('fetched_at', threshold)
    .select('symbol');
  return Boolean(updated && updated.length);
}

const claimRefresh = (symbol: string, interval: Interval, stamp = iso) => claimRow(symbol, interval, TTL_MS[interval], stamp);

async function releaseClaim(symbol: string, interval: Interval) {
  // Let the next request retry in ~5 s instead of waiting a full TTL after a failure.
  const retryAt = new Date(Date.now() - TTL_MS[interval] + 5_000).toISOString();
  await admin.from('market_fetches').update({ fetched_at: retryAt }).eq('symbol', symbol).eq('interval', interval);
}

/** Keep a claim closed until `until` (fetched_at + ttl is when it reopens). */
async function holdRow(symbol: string, key: string, ttl: number, until: number) {
  await admin.from('market_fetches').update({ fetched_at: holdStamp(until - ttl) }).eq('symbol', symbol).eq('interval', key);
}

const holdClaim = (symbol: string, interval: Interval, until: number) => holdRow(symbol, interval, TTL_MS[interval], until);

/**
 * When latest candles fetched at `t` stop being current: the first moment the provider's
 * freshSince() moves past `t` (the next candle boundary). Without the hook: TTL after `t`.
 */
function refreshDueAt(p: Provider, meta: SymbolMeta, interval: Interval, t: number): number {
  if (!p.freshSince) return t + TTL_MS[interval];
  const moved = (x: number) => p.freshSince!(meta, interval, x) > t; // monotone in x
  let lo = t;
  let hi = t + 60_000;
  while (!moved(hi)) {
    lo = hi;
    hi = t + 2 * (hi - t);
    if (hi - t > 60 * DAY) return hi;
  }
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (moved(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

const nextUtcMidnight = (t: number) => (Math.floor(t / DAY) + 1) * DAY;

/**
 * Metered providers: when to try again after a failed refresh. A spent budget holds the claim
 * until exactly 00:00 UTC (when it resets), which is also how other callers recognise it.
 */
function retryAt(p: Provider, meta: SymbolMeta, interval: Interval, err: unknown, now: number): number {
  if (err instanceof QuotaExhausted) return nextUtcMidnight(now);
  const wait = p.retryAfterMs?.(err) ?? METERED_RETRY_MS;
  return Math.min(refreshDueAt(p, meta, interval, now), now + wait);
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

/**
 * An empty stretch before `t` is the listing date only if a coarser look agrees: the provider has
 * no daily candles in the PAGE days before t's day either. A quiet spell, an exchange outage or a
 * one-off empty answer can't empty 300 days, so none of them can hide history for good.
 */
async function confirmFloor(meta: SymbolMeta, source: ProviderName, t: number): Promise<boolean> {
  const provider = PROVIDERS[source];
  if (provider.snapshot || provider.maxBack?.('1d') !== undefined || !provider.supports('1d', meta)) return false;
  const day = INTERVAL_MS['1d'];
  const end = Math.floor(t / day) * day - 1;
  try {
    return (await provider.fetch(meta, '1d', end - PAGE * day, end, ctx)).length === 0;
  } catch {
    return false;
  }
}

async function refreshState(symbol: string, interval: Interval): Promise<{ source: string | null; fetchedAt: number }> {
  const { data } = await admin
    .from('market_fetches')
    .select('source, fetched_at')
    .eq('symbol', symbol)
    .eq('interval', interval)
    .maybeSingle();
  return { source: data?.source ?? null, fetchedAt: data?.fetched_at ? Date.parse(data.fetched_at) : NaN };
}

function staleResponse(symbol: string, interval: Interval, candles: Candle[], provider: ProviderName): Response {
  return respond({
    symbol, interval, candles, source: 'cache', attribution: PROVIDERS[provider].attribution, delayed: true, stale: true,
  });
}

function candleResponse(
  symbol: string, interval: Interval, candles: Candle[], source: string, fallback: ProviderName, maxAgeMs: number,
): Response {
  const provider = PROVIDERS[(Object.hasOwn(PROVIDERS, source) ? source : fallback) as ProviderName];
  return respond({ symbol, interval, candles, source, attribution: provider.attribution, delayed: provider.delayed }, 200, maxAgeMs);
}

/** Which markets and intervals the configured providers serve right now. */
function catalog() {
  const symbols = Object.values(SYMBOLS).map((meta) => {
    const serving = meta.providers
      .map((n) => PROVIDERS[n])
      .filter((p) => p.available() && INTERVALS.some((i) => p.supports(i, meta)));
    const realtime = serving.filter((p) => !p.delayed);
    return {
      id: meta.id,
      name: meta.name,
      class: meta.class,
      decimals: meta.decimals,
      intervals: INTERVALS.filter((i) => serving.some((p) => p.supports(i, meta))),
      live: realtime.some((p) => INTERVALS.some((i) => INTRADAY.has(i) && p.supports(i, meta))),
      delayed: realtime.length === 0,
      attribution: serving[0]?.attribution ?? null,
    };
  });
  return { symbols, status: symbols.some((s) => s.intervals.length > 0) ? 'ok' : 'unconfigured' };
}

const wantsCatalog = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';

/**
 * Every exchange feed failed on an empty cache: a metered snapshot provider behind them may fill
 * it — through a claim of its own (`<interval>/fallback`) that is held after a failure exactly
 * like the metered path's, so the feeds' quick retries (~5 s) never become a stream of paid calls.
 */
async function meteredFallback(
  meta: SymbolMeta, interval: Interval, chain: ProviderName[], now: number, cause: unknown,
): Promise<{ candles: Candle[]; source: ProviderName }> {
  const metered = chain.filter((n) => PROVIDERS[n].snapshot);
  const key = `${interval}/fallback`;
  const ttl = TTL_MS[interval];
  if (!metered.length) throw cause;
  if (!(await claimRow(meta.id, key, ttl))) {
    // Held: a hold that ends exactly at 00:00 UTC means the day's budget is spent (see retryAt).
    const { data } = await admin.from('market_fetches').select('fetched_at').eq('symbol', meta.id).eq('interval', key).maybeSingle();
    if (data && Date.parse(data.fetched_at) + ttl === nextUtcMidnight(now)) throw new QuotaExhausted();
    throw cause;
  }
  try {
    const got = await fetchUpstream(meta, interval, 0, now, metered);
    await holdRow(meta.id, key, ttl, refreshDueAt(PROVIDERS[got.source], meta, interval, now));
    return got;
  } catch (err) {
    await holdRow(meta.id, key, ttl, retryAt(PROVIDERS[metered[0]], meta, interval, err, now));
    throw err;
  }
}

/**
 * Exchange feeds: refresh the latest candles once per TTL, and back-fill history page by page
 * (bounded by the listing date, which is confirmed before it is remembered).
 */
async function serveExchange(
  meta: SymbolMeta, interval: Interval, limit: number, endMs: number | null, chain: ProviderName[],
): Promise<Response> {
  const symbol = meta.id;
  const step = INTERVAL_MS[interval];
  const gap = maxGap(meta, interval);
  const now = Date.now();
  const wantEnd = endMs === null ? now : Math.min(endMs, now);
  const wantStart = wantEnd - spanMs(meta, interval, limit);
  const isLatest = now - wantEnd < step * 2;
  // Metered snapshot providers can't page, and each call spends the shared daily budget: behind
  // an exchange feed they only ever fill an empty cache.
  const pageable = chain.filter((n) => !PROVIDERS[n].snapshot);
  let source: string = chain[0];
  let claimed = false;
  let unconfirmedGap = false;

  // 1. Keep the newest candles fresh (one caller per TTL does the upstream request).
  if (isLatest && (await claimRefresh(symbol, interval))) {
    claimed = true;
    try {
      // Start at the newest cached candle: it may have been stored while still forming, and an
      // idle spell would otherwise leave a hole. On a cold cache, cover this request's window.
      const [newest] = await load(symbol, interval, 1, null);
      const from = Math.min(now - 120 * step, newest ? Math.max(newest.t, now - MAX_LIMIT * step) : wantStart);
      const recent = await fetchUpstream(meta, interval, from, now, pageable).catch((err) =>
        newest ? Promise.reject(err) : meteredFallback(meta, interval, chain, now, err)
      );
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
    if (candles.length && wantEnd - lastT() > gap) return staleResponse(symbol, interval, candles, chain[0]);
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
      const hist = await fetchUpstream(meta, interval, fetchStart, fetchEnd, pageable);
      await store(symbol, interval, hist.candles, hist.source, fetchEnd);
      // Nothing in [fetchStart, emptyUntil): that may be the listing date if the provider keeps
      // full history and either the known floor was the start or the empty stretch is a whole
      // page long (a few quiet minutes in a thin market are not a listing date) — and the daily
      // candles agree. Otherwise the provider has a gap it may fill later: don't remember it.
      const emptyUntil = hist.candles.length ? hist.candles[0].t : fetchEnd;
      if (
        PROVIDERS[hist.source].maxBack?.(interval) === undefined && emptyUntil > floor &&
        (fetchStart <= floor || emptyUntil - fetchStart >= PAGE * step)
      ) {
        if (await confirmFloor(meta, hist.source, emptyUntil)) await saveFloor(symbol, interval, emptyUntil);
        else unconfirmedGap = true;
      }
      candles = await load(symbol, interval, limit, endMs);
    }
  }
  // "Nothing" for a stretch the market was trading is a provider glitch, not an answer to cache.
  if (unconfirmedGap && !candles.length) throw new Error('provider returned no candles for a trading period');

  if (Math.random() < 0.01) await admin.rpc('prune_market_candles');

  return candleResponse(
    symbol, interval, candles, source, chain[0],
    unconfirmedGap ? 0 : isLatest ? Math.min(TTL_MS[interval], 60_000) : 3_600_000,
  );
}

/**
 * Metered snapshot providers (Alpha Vantage): one call returns the whole series the provider
 * serves and spends a unit of the daily budget. So the series is refreshed through the claim at
 * most once per candle boundary, whatever window the request asks for, and every window is then
 * answered from the cache. Nothing is back-filled: older windows than the provider reaches cost
 * nothing, and the gaps of session markets (nights, weekends, holidays) never trigger a call.
 */
async function serveMetered(
  meta: SymbolMeta, interval: Interval, limit: number, endMs: number | null, chain: ProviderName[],
): Promise<Response> {
  const symbol = meta.id;
  const primary = PROVIDERS[chain[0]];
  const step = INTERVAL_MS[interval];
  const now = Date.now();
  const wantEnd = endMs === null ? now : Math.min(endMs, now);
  const isLatest = now - wantEnd < step * 2;
  // A refresh only helps windows the provider still covers (compact: the ~100 latest daily candles).
  const back = primary.maxBack?.(interval);
  const reachable = isLatest || back === undefined || wantEnd >= now - (back - 1) * step;
  let source: string = chain[0];
  let claimed = false;

  // 1. Refresh when a new candle may have closed since the last refresh (one caller does it).
  if (reachable && (await claimRefresh(symbol, interval, claimStamp))) {
    claimed = true;
    try {
      const got = await fetchUpstream(meta, interval, 0, now, chain);
      await store(symbol, interval, got.candles, got.source, now);
      // Not due again before the next candle boundary: the claim reopens at fetched_at + TTL.
      const due = refreshDueAt(PROVIDERS[got.source], meta, interval, now);
      await admin
        .from('market_fetches')
        .update({ source: got.source, fetched_at: holdStamp(due - TTL_MS[interval]) })
        .eq('symbol', symbol)
        .eq('interval', interval);
      source = got.source;
    } catch (err) {
      // No retry loop: the budget resets at 00:00 UTC, other failures wait (each call costs a unit).
      await holdClaim(symbol, interval, retryAt(primary, meta, interval, err, now));
      throw err;
    }
  }

  let candles = await load(symbol, interval, limit, endMs);
  let filled = claimed;
  if (!claimed) {
    let state = await refreshState(symbol, interval);
    // Never filled yet: its first refresh is in flight in another request (wait for it), or it
    // failed and is held back (answer right away).
    for (let waited = 0; !state.source && reachable && !candles.length; waited += POLL_MS) {
      if (state.fetchedAt + TTL_MS[interval] === nextUtcMidnight(now)) throw new QuotaExhausted();
      // In flight: a claim (not a hold), made moments ago — possibly a few ms after this request
      // started, or by an instance whose clock is slightly ahead.
      if (!(isClaimStamp(state.fetchedAt) && Math.abs(Date.now() - state.fetchedAt) < IN_FLIGHT_MS)) {
        throw new Error('the first refresh failed; it is retried later');
      }
      if (waited >= FIRST_FILL_WAIT_MS) throw new Error('the first refresh has not delivered candles');
      await sleep(POLL_MS);
      candles = await load(symbol, interval, limit, endMs);
      state = await refreshState(symbol, interval);
    }
    if (state.source) {
      source = state.source;
      filled = true;
    }
  }
  // The cache stops well before the end of the window: refreshes held back for days (budget used
  // up, provider failing) or the provider's data lags. Say so, and don't let browsers keep it —
  // for an older window too, which then isn't complete yet.
  const last = candles[candles.length - 1];
  if (last && wantEnd - last.t > maxGap(meta, interval)) return staleResponse(symbol, interval, candles, chain[0]);

  if (Math.random() < 0.01) await admin.rpc('prune_market_candles');

  // Browser caching: nothing while the series was never filled (the first refresh may change the
  // answer any moment); an older window that reaches the newest cached candle changes with the
  // next refresh like the latest one; older windows are final.
  const atEdge = !isLatest && last !== undefined && (await load(symbol, interval, 1, null))[0]?.t === last.t;
  const maxAge = !filled ? 0 : isLatest || atEdge ? Math.min(TTL_MS[interval], 60_000) : 3_600_000;
  return candleResponse(symbol, interval, candles, source, chain[0], maxAge);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET' && req.method !== 'POST') return respond({ error: 'Use GET or POST.' }, 405);

  const p = await readParams(req);
  if (wantsCatalog(p.catalog)) return respond(catalog(), 200, CATALOG_MAX_AGE_MS);

  const symbol = String(p.symbol ?? '').toUpperCase();
  const interval = String(p.interval ?? '') as Interval;
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(p.limit) || 300)));
  const endRaw = p.end;
  const endMs = endRaw === undefined || endRaw === null || endRaw === ''
    ? null
    : Number.isFinite(Number(endRaw)) ? Number(endRaw) : Date.parse(String(endRaw));

  // hasOwn: `interval in INTERVAL_MS` also accepted "toString", "constructor", "__proto__", …
  const meta = Object.hasOwn(SYMBOLS, symbol) ? SYMBOLS[symbol] : undefined;
  if (!meta) return respond({ error: `Unknown symbol "${symbol.slice(0, 24)}".`, symbols: Object.keys(SYMBOLS) }, 400);
  if (!Object.hasOwn(INTERVAL_MS, interval)) return respond({ error: `interval must be one of ${INTERVALS.join(' ')}.` }, 400);
  if (endMs !== null && !(Number.isFinite(endMs) && endMs >= MIN_END)) {
    return respond({ error: 'end must be a timestamp in milliseconds or an ISO 8601 date.' }, 400);
  }
  // The providers that can serve this symbol/interval now, in preference order.
  const chain = meta.providers.filter((n) => PROVIDERS[n].available() && PROVIDERS[n].supports(interval, meta));
  if (!chain.length) return respond({ error: `${symbol} ${interval} is not available yet.`, unconfigured: true }, 503);

  try {
    if (PROVIDERS[chain[0]].snapshot) return await serveMetered(meta, interval, limit, endMs, chain);
    return await serveExchange(meta, interval, limit, endMs, chain);
  } catch (err) {
    console.error(`market-data ${symbol} ${interval} failed: ${logText(err)}`);
    try {
      const cached = await load(symbol, interval, limit, endMs);
      if (cached.length) return staleResponse(symbol, interval, cached, chain[0]);
    } catch { /* fall through */ }
    if (err instanceof QuotaExhausted) {
      return respond({ error: 'Today’s market data budget is used up. It resets at 00:00 UTC.', quota: true }, 503);
    }
    return respond({ error: 'Market data is unavailable right now.' }, 502);
  }
});
