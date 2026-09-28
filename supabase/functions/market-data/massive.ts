// Massive.com (api.massive.com — Polygon-compatible REST) for Live Lab quotes + daily/weekly bars.
// Server-side only. Free / Basic tier: ~5 req/min, end-of-day aggregates (no realtime snapshot).
// US equities: prefer grouped daily (1–2 upstream calls for the whole board). Crypto/FX: per-ticker
// range. Cache briefly; on failure return last good as stale. Secret: MASSIVE_API_KEY (Edge secret).
// Never expose the key to browsers.
// Every upstream call first takes one unit of a shared daily budget (MASSIVE_DAILY_LIMIT, default
// 2000/day for the whole site, via the gate index.ts installs: public.take_market_quota), so the
// in-memory caches of many short-lived instances can't add up to unbounded upstream traffic.

export type MassiveQuote = {
  symbol: string;
  /** Upstream ticker (e.g. SPY, X:BTCUSD, C:EURUSD). */
  providerSymbol: string;
  /** @deprecated alias of providerSymbol — kept for older clients. */
  yahooSymbol: string;
  name: string;
  price: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  currency: string | null;
  asOf: number | null; // ms
  sparkline: number[]; // recent closes, oldest → newest
  /** Free tier is end-of-day; true when we only have delayed EOD. */
  delayed: boolean;
  /** True only on plans that serve intraday/realtime (not free Basic). */
  live: boolean;
  ok: boolean;
  error?: string;
};

export type MassiveCandle = { t: number; o: number; h: number; l: number; c: number; v: number };

/** Our id → Massive/Polygon ticker. */
export const MASSIVE_SYMBOLS: Record<string, {
  ticker: string;
  name: string;
  currency: string;
  /** US equity — eligible for grouped daily batching. */
  asset: 'stocks' | 'crypto' | 'fx';
}> = {
  SPY: { ticker: 'SPY', name: 'S&P 500 ETF', currency: 'USD', asset: 'stocks' },
  QQQ: { ticker: 'QQQ', name: 'Nasdaq-100 ETF', currency: 'USD', asset: 'stocks' },
  AAPL: { ticker: 'AAPL', name: 'Apple', currency: 'USD', asset: 'stocks' },
  MSFT: { ticker: 'MSFT', name: 'Microsoft', currency: 'USD', asset: 'stocks' },
  NVDA: { ticker: 'NVDA', name: 'NVIDIA', currency: 'USD', asset: 'stocks' },
  TSLA: { ticker: 'TSLA', name: 'Tesla', currency: 'USD', asset: 'stocks' },
  GLD: { ticker: 'GLD', name: 'Gold ETF', currency: 'USD', asset: 'stocks' },
  'BTC-USD': { ticker: 'X:BTCUSD', name: 'Bitcoin', currency: 'USD', asset: 'crypto' },
  'ETH-USD': { ticker: 'X:ETHUSD', name: 'Ethereum', currency: 'USD', asset: 'crypto' },
  'EUR-USD': { ticker: 'C:EURUSD', name: 'Euro / US dollar', currency: 'USD', asset: 'fx' },
};

const BASE = 'https://api.massive.com';
const CACHE_TTL_MS = 55_000;
const GROUPED_TTL_MS = 55_000;
const CANDLE_CACHE_TTL_MS = 120_000;
const FETCH_TIMEOUT_MS = 12_000;
/** Free tier ~5 req/min — leave headroom. */
const MIN_GAP_MS = 12_500;
const RANGE_DAYS_QUOTE = 35;
const RANGE_DAYS_CHART = 120;
const SPARK_MAX = 30;
const ATTRIBUTION =
  'Data: Massive.com. Educational use; not for trading decisions.';

type CacheEntry = { at: number; quote: MassiveQuote };
const quoteCache = new Map<string, CacheEntry>();
/** `limit`: how many candles the entry was fetched for (it can't answer a larger request). */
type CandleCacheEntry = { at: number; candles: MassiveCandle[]; interval: string; limit: number };
const candleCache = new Map<string, CandleCacheEntry>();

/** Grouped daily by YYYY-MM-DD → Map ticker → bar */
type GroupedBar = { o: number; h: number; l: number; c: number; v: number; t: number };
const groupedCache = new Map<string, { at: number; byTicker: Map<string, GroupedBar> }>();

let lastUpstreamAt = 0;
let gate: Promise<void> = Promise.resolve();

/** Takes one unit of `provider`'s shared daily budget; false when it is used up. */
export type MassiveQuotaGate = (provider: string, dailyLimit: number) => Promise<boolean>;
let quotaGate: MassiveQuotaGate | null = null;

/** Install the shared daily budget check (index.ts: public.take_market_quota). */
export function setMassiveQuotaGate(fn: MassiveQuotaGate | null) {
  quotaGate = fn;
}

/** Today's shared Massive budget is spent; it resets at 00:00 UTC. */
export class MassiveQuotaExhausted extends Error {
  constructor() {
    super('Massive daily request budget is used up');
    this.name = 'MassiveQuotaExhausted';
  }
}

function envVar(name: string): string {
  let fromDeno: string | undefined;
  try {
    if (typeof Deno !== 'undefined') fromDeno = Deno.env.get(name) ?? undefined;
  } catch { /* ignore */ }
  let fromProcess: string | undefined;
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    fromProcess = proc?.env?.[name];
  } catch { /* ignore */ }
  return String(fromDeno || fromProcess || '').trim();
}

function apiKey(): string {
  return envVar('MASSIVE_API_KEY');
}

/** Upstream calls per UTC day for the whole site (all instances). */
export const MASSIVE_DAILY_LIMIT = () => Math.max(1, Math.floor(Number(envVar('MASSIVE_DAILY_LIMIT'))) || 2000);

export function isMassiveConfigured(): boolean {
  return apiKey().length > 0;
}

function emptyQuote(id: string, err?: string): MassiveQuote {
  const meta = MASSIVE_SYMBOLS[id];
  const ticker = meta?.ticker || id;
  return {
    symbol: id,
    providerSymbol: ticker,
    yahooSymbol: ticker,
    name: meta?.name || id,
    price: null,
    open: null,
    high: null,
    low: null,
    prevClose: null,
    change: null,
    changePct: null,
    currency: meta?.currency || null,
    asOf: null,
    sparkline: [],
    delayed: true,
    live: false,
    ok: false,
    error: err || 'unavailable',
  };
}

function ymdUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Walk back calendar days looking for a US session with data (weekends/holidays). */
function recentDates(count = 8): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < count + 6 && out.length < count; i++) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - i));
    // Skip pure weekend probes less aggressively — still try Fri–Sun in case of holiday gaps.
    out.push(ymdUTC(x));
  }
  return out;
}

type AggBar = { c?: number; t?: number; o?: number; h?: number; l?: number; v?: number; T?: string };

/** MASSIVE_SPACING_MS overrides the gap between upstream calls (tests set 0). */
function minGapMs(): number {
  const v = envVar('MASSIVE_SPACING_MS');
  const n = v === '' ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : MIN_GAP_MS;
}

/** Forget cached quotes/candles and pacing (tests). */
export function resetMassiveState() {
  quoteCache.clear();
  candleCache.clear();
  groupedCache.clear();
  lastUpstreamAt = 0;
  gate = Promise.resolve();
}

async function pace(): Promise<void> {
  const run = gate.then(async () => {
    const wait = Math.max(0, minGapMs() - (Date.now() - lastUpstreamAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastUpstreamAt = Date.now();
  });
  gate = run.catch(() => {});
  await run;
}

function redact(msg: string): string {
  const key = apiKey();
  return key ? msg.replaceAll(key, '[REDACTED]') : msg;
}

async function massiveGet(pathAndQuery: string): Promise<unknown> {
  const key = apiKey();
  if (!key) throw new Error('MASSIVE_API_KEY is not set');
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const url = `${BASE}${pathAndQuery}${sep}apiKey=${encodeURIComponent(key)}`;
  if (quotaGate && !(await quotaGate('massive', MASSIVE_DAILY_LIMIT()))) throw new MassiveQuotaExhausted();
  await pace();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        'User-Agent': 'TheTradeSchool/1.0 (educational; contact: support)',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Massive HTTP ${res.status}${text ? `: ${redact(text).slice(0, 200)}` : ''}`);
    }
    const json = await res.json();
    if (json?.status === 'ERROR' || json?.error) {
      throw new Error(String(json.error || json.message || 'Massive error'));
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function barsFromResults(results: AggBar[]): MassiveCandle[] {
  const out: MassiveCandle[] = [];
  for (const b of results) {
    const t = Number(b.t);
    const o = Number(b.o);
    const h = Number(b.h);
    const l = Number(b.l);
    const c = Number(b.c);
    const v = Number(b.v);
    if (![t, o, h, l, c].every(Number.isFinite) || o <= 0 || c <= 0) continue;
    out.push({
      t,
      o,
      h: Math.max(h, o, c),
      l: Math.min(l || o, o, c),
      c,
      v: Number.isFinite(v) && v >= 0 ? v : 0,
    });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

async function fetchTickerRange(ticker: string, fromYmd: string, toYmd: string, timespan: 'day' | 'week', limit: number): Promise<MassiveCandle[]> {
  const path =
    `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/${timespan}/${fromYmd}/${toYmd}` +
    `?adjusted=true&sort=asc&limit=${Math.min(50_000, Math.max(1, limit))}`;
  const json = await massiveGet(path) as { results?: AggBar[] };
  return barsFromResults(Array.isArray(json?.results) ? json.results : []);
}

async function fetchGroupedDay(dateYmd: string): Promise<Map<string, GroupedBar>> {
  const hit = groupedCache.get(dateYmd);
  if (hit && Date.now() - hit.at < GROUPED_TTL_MS) return hit.byTicker;

  const path = `/v2/aggs/grouped/locale/us/market/stocks/${dateYmd}?adjusted=true`;
  const json = await massiveGet(path) as { results?: AggBar[]; resultsCount?: number };
  const byTicker = new Map<string, GroupedBar>();
  for (const b of Array.isArray(json?.results) ? json.results : []) {
    const T = String(b.T || '').toUpperCase();
    if (!T) continue;
    const o = Number(b.o);
    const h = Number(b.h);
    const l = Number(b.l);
    const c = Number(b.c);
    const v = Number(b.v);
    const t = Number(b.t);
    if (![o, h, l, c].every(Number.isFinite) || c <= 0) continue;
    byTicker.set(T, {
      o, h: Math.max(h, o, c), l: Math.min(l || o, o, c), c,
      v: Number.isFinite(v) && v >= 0 ? v : 0,
      t: Number.isFinite(t) ? t : Date.parse(`${dateYmd}T20:00:00Z`),
    });
  }
  // Only cache non-empty (empty often means holiday — try another date next time).
  if (byTicker.size) groupedCache.set(dateYmd, { at: Date.now(), byTicker });
  return byTicker;
}

/** Load the two most recent US sessions that have grouped data. */
async function loadRecentStockSessions(): Promise<{ latest: Map<string, GroupedBar>; prev: Map<string, GroupedBar>; latestDate: string | null }> {
  let latest: Map<string, GroupedBar> | null = null;
  let prev: Map<string, GroupedBar> | null = null;
  let latestDate: string | null = null;
  for (const d of recentDates(10)) {
    const map = await fetchGroupedDay(d);
    if (!map.size) continue;
    if (!latest) {
      latest = map;
      latestDate = d;
    } else {
      prev = map;
      break;
    }
  }
  return { latest: latest || new Map(), prev: prev || new Map(), latestDate };
}

function quoteFromBars(
  id: string,
  last: { o: number; h: number; l: number; c: number; t: number },
  prevClose: number | null,
  sparkline: number[],
): MassiveQuote {
  const meta = MASSIVE_SYMBOLS[id]!;
  const price = last.c;
  const change = prevClose != null ? price - prevClose : null;
  const changePct = change != null && prevClose ? (change / prevClose) * 100 : null;
  return {
    symbol: id,
    providerSymbol: meta.ticker,
    yahooSymbol: meta.ticker,
    name: meta.name,
    price,
    open: last.o,
    high: last.h,
    low: last.l,
    prevClose,
    change,
    changePct,
    currency: meta.currency,
    asOf: last.t,
    sparkline,
    delayed: true,
    live: false,
    ok: true,
  };
}

async function fetchNonStockQuote(id: string): Promise<MassiveQuote> {
  const meta = MASSIVE_SYMBOLS[id];
  if (!meta) return emptyQuote(id, 'unknown symbol');
  const to = new Date();
  const from = new Date(to.getTime() - RANGE_DAYS_QUOTE * 86_400_000);
  const bars = await fetchTickerRange(meta.ticker, ymdUTC(from), ymdUTC(to), 'day', 50);
  if (!bars.length) throw new Error('No aggregate bars');
  const last = bars[bars.length - 1];
  const prev = bars.length >= 2 ? bars[bars.length - 2] : null;
  return quoteFromBars(
    id,
    { o: last.o, h: last.h, l: last.l, c: last.c, t: last.t },
    prev?.c ?? null,
    bars.map((b) => b.c).slice(-SPARK_MAX),
  );
}

/** Fetch one quote with short TTL cache; on failure return last good if any. */
export async function getMassiveQuote(id: string): Promise<{
  quote: MassiveQuote;
  stale: boolean;
  attribution: string;
}> {
  const meta = MASSIVE_SYMBOLS[id];
  if (!meta) return { quote: emptyQuote(id, 'unknown symbol'), stale: false, attribution: ATTRIBUTION };

  const hit = quoteCache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS && hit.quote.ok) {
    return { quote: hit.quote, stale: false, attribution: ATTRIBUTION };
  }

  if (!isMassiveConfigured()) {
    if (hit?.quote?.ok) {
      return { quote: { ...hit.quote, error: 'stale' }, stale: true, attribution: ATTRIBUTION };
    }
    return { quote: emptyQuote(id, 'MASSIVE_API_KEY is not set'), stale: false, attribution: ATTRIBUTION };
  }

  try {
    const quote = await fetchNonStockQuote(id);
    quoteCache.set(id, { at: Date.now(), quote });
    return { quote, stale: false, attribution: ATTRIBUTION };
  } catch (err) {
    if (hit?.quote?.ok) {
      return { quote: { ...hit.quote, error: 'stale' }, stale: true, attribution: ATTRIBUTION };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { quote: emptyQuote(id, redact(msg)), stale: false, attribution: ATTRIBUTION };
  }
}

/**
 * Batch quotes for the Live board. US stocks share 1–2 grouped-daily upstream calls;
 * crypto/FX use paced per-ticker ranges. Respects ~5 req/min free tier.
 */
export async function getMassiveQuotes(ids: string[]): Promise<{
  quotes: MassiveQuote[];
  stale: boolean;
  attribution: string;
  fetchedAt: number;
  delayed: boolean;
  live: boolean;
}> {
  const wanted = (ids.length ? ids : Object.keys(MASSIVE_SYMBOLS))
    .map((id) => String(id).toUpperCase())
    .filter((id) => Object.hasOwn(MASSIVE_SYMBOLS, id));

  if (!isMassiveConfigured()) {
    return {
      quotes: wanted.map((id) => emptyQuote(id, 'MASSIVE_API_KEY is not set')),
      stale: false,
      attribution: ATTRIBUTION,
      fetchedAt: Date.now(),
      delayed: true,
      live: false,
    };
  }

  const stocks = wanted.filter((id) => MASSIVE_SYMBOLS[id].asset === 'stocks');
  const others = wanted.filter((id) => MASSIVE_SYMBOLS[id].asset !== 'stocks');

  const byId = new Map<string, MassiveQuote>();
  let anyStale = false;

  // Serve fresh cache hits first (avoid upstream when the board is still warm).
  const needStock: string[] = [];
  for (const id of stocks) {
    const hit = quoteCache.get(id);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS && hit.quote.ok) {
      byId.set(id, hit.quote);
    } else {
      needStock.push(id);
    }
  }

  if (needStock.length) {
    try {
      const { latest, prev } = await loadRecentStockSessions();
      for (const id of needStock) {
        const ticker = MASSIVE_SYMBOLS[id].ticker;
        const bar = latest.get(ticker);
        if (!bar) {
          const prior = quoteCache.get(id);
          if (prior?.quote?.ok) {
            byId.set(id, { ...prior.quote, error: 'stale' });
            anyStale = true;
          } else {
            byId.set(id, emptyQuote(id, 'No daily bar yet for this session'));
          }
          continue;
        }
        const prevClose = prev.get(ticker)?.c ?? null;
        // Sparkline: reuse prior sparkline + new close, or just [prev, last].
        const priorSpark = quoteCache.get(id)?.quote?.sparkline || [];
        const spark = [...priorSpark.filter((n) => Number.isFinite(n)), bar.c].slice(-SPARK_MAX);
        if (prevClose != null && spark.length < 2) spark.unshift(prevClose);
        const quote = quoteFromBars(id, bar, prevClose, spark);
        quoteCache.set(id, { at: Date.now(), quote });
        byId.set(id, quote);
      }
    } catch (err) {
      const msg = redact(err instanceof Error ? err.message : String(err));
      for (const id of needStock) {
        const prior = quoteCache.get(id);
        if (prior?.quote?.ok) {
          byId.set(id, { ...prior.quote, error: 'stale' });
          anyStale = true;
        } else {
          byId.set(id, emptyQuote(id, msg));
        }
      }
    }
  }

  for (const id of others) {
    const { quote, stale } = await getMassiveQuote(id);
    byId.set(id, quote);
    if (stale) anyStale = true;
  }

  const quotes = wanted.map((id) => byId.get(id) || emptyQuote(id, 'unavailable'));
  return {
    quotes,
    stale: anyStale,
    attribution: ATTRIBUTION,
    fetchedAt: Date.now(),
    delayed: true,
    live: false,
  };
}

/**
 * Daily or weekly OHLC history for the Live chart (and any Massive-backed catalog interval).
 * Free tier: day/week aggregates only.
 */
export async function getMassiveCandles(
  id: string,
  interval: '1d' | '1w',
  limit = 90,
): Promise<{ candles: MassiveCandle[]; attribution: string; delayed: boolean; stale: boolean; source: 'massive' }> {
  const meta = MASSIVE_SYMBOLS[id];
  if (!meta) throw new Error(`unknown symbol ${id}`);
  if (!isMassiveConfigured()) throw new Error('MASSIVE_API_KEY is not set');

  const cacheKey = `${id}|${interval}`;
  const hit = candleCache.get(cacheKey);
  // Only an entry fetched for at least this many candles can answer: one fetched for a short
  // chart must not answer a longer one with its short list.
  const fresh = hit && hit.interval === interval && Date.now() - hit.at < CANDLE_CACHE_TTL_MS;
  if (fresh && hit.limit >= limit && hit.candles.length) {
    return {
      candles: hit.candles.slice(-limit),
      attribution: ATTRIBUTION,
      delayed: true,
      stale: false,
      source: 'massive',
    };
  }

  // Refetch for the larger of this request and the (expired) entry it replaces, so alternating
  // short and long charts don't keep evicting each other's coverage.
  const want = Math.max(limit, hit?.interval === interval ? hit.limit : 0);
  const timespan = interval === '1w' ? 'week' : 'day';
  // Calendar days that hold `want` bars: stocks and FX trade ~5 days a week (plus holidays).
  const days = interval === '1w' ? Math.max(want * 7 + 14, 120) : Math.max(Math.ceil(want * 1.5) + 10, RANGE_DAYS_CHART);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  // The date range bounds the result. An upstream `limit` below the bars in the range would cut
  // the NEWEST bars (results are sorted ascending), so ask for the maximum.
  const candles = await fetchTickerRange(meta.ticker, ymdUTC(from), ymdUTC(to), timespan, 50_000);
  if (!candles.length) throw new Error('No aggregate bars');
  candleCache.set(cacheKey, { at: Date.now(), candles, interval, limit: want });
  return {
    candles: candles.slice(-limit),
    attribution: ATTRIBUTION,
    delayed: true,
    stale: false,
    source: 'massive',
  };
}

export { ATTRIBUTION as MASSIVE_ATTRIBUTION, CACHE_TTL_MS as MASSIVE_CACHE_TTL_MS };
