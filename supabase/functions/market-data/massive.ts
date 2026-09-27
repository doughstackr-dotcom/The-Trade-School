// Massive.com (api.massive.com — Polygon-compatible REST) for Live Lab quotes.
// Server-side only. Free / Basic tier: ~5 req/min, end-of-day aggregates (no snapshot).
// Prefer one daily range call per symbol (~1 month) so last, prevClose and sparkline
// come from a single upstream request. Cache briefly; on failure return last good as stale.
// Secret: MASSIVE_API_KEY (Supabase Edge Function secret / Deno.env). Never expose to browsers.

export type MassiveQuote = {
  symbol: string;
  /** Upstream ticker (e.g. SPY, X:BTCUSD, C:EURUSD). */
  providerSymbol: string;
  /** @deprecated alias of providerSymbol — kept for older clients. */
  yahooSymbol: string;
  name: string;
  price: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  currency: string | null;
  asOf: number | null; // ms
  sparkline: number[]; // recent closes, oldest → newest
  ok: boolean;
  error?: string;
};

/** Our id → Massive/Polygon ticker. */
export const MASSIVE_SYMBOLS: Record<string, { ticker: string; name: string; currency: string }> = {
  SPY: { ticker: 'SPY', name: 'S&P 500 ETF', currency: 'USD' },
  QQQ: { ticker: 'QQQ', name: 'Nasdaq-100 ETF', currency: 'USD' },
  AAPL: { ticker: 'AAPL', name: 'Apple', currency: 'USD' },
  MSFT: { ticker: 'MSFT', name: 'Microsoft', currency: 'USD' },
  NVDA: { ticker: 'NVDA', name: 'NVIDIA', currency: 'USD' },
  TSLA: { ticker: 'TSLA', name: 'Tesla', currency: 'USD' },
  GLD: { ticker: 'GLD', name: 'Gold ETF', currency: 'USD' },
  'BTC-USD': { ticker: 'X:BTCUSD', name: 'Bitcoin', currency: 'USD' },
  'ETH-USD': { ticker: 'X:ETHUSD', name: 'Ethereum', currency: 'USD' },
  'EUR-USD': { ticker: 'C:EURUSD', name: 'Euro / US dollar', currency: 'USD' },
};

const BASE = 'https://api.massive.com';
const CACHE_TTL_MS = 55_000;
const FETCH_TIMEOUT_MS = 10_000;
/** Free tier ~5 req/min — leave a little headroom. */
const MIN_GAP_MS = 12_500;
const RANGE_DAYS = 35;
const SPARK_MAX = 30;
const ATTRIBUTION =
  'Quotes: Massive.com (end-of-day on free tier). Educational use; not for trading decisions.';

type CacheEntry = { at: number; quote: MassiveQuote };
const cache = new Map<string, CacheEntry>();

let lastUpstreamAt = 0;
let gate: Promise<void> = Promise.resolve();

function apiKey(): string {
  // Deno Edge + optional process.env for local scripts (Node / deno with nodeCompat).
  let fromDeno: string | undefined;
  try {
    if (typeof Deno !== 'undefined') fromDeno = Deno.env.get('MASSIVE_API_KEY') ?? undefined;
  } catch { /* ignore */ }
  let fromProcess: string | undefined;
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    fromProcess = proc?.env?.MASSIVE_API_KEY;
  } catch { /* ignore */ }
  return String(fromDeno || fromProcess || '').trim();
}

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
    prevClose: null,
    change: null,
    changePct: null,
    currency: meta?.currency || null,
    asOf: null,
    sparkline: [],
    ok: false,
    error: err || 'unavailable',
  };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type AggBar = { c?: number; t?: number; o?: number; h?: number; l?: number; v?: number };

type RangeBits = {
  price: number;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  currency: string;
  asOf: number;
  sparkline: number[];
};

async function pace(): Promise<void> {
  // Serialize upstream calls and enforce MIN_GAP_MS between them.
  const run = gate.then(async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastUpstreamAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastUpstreamAt = Date.now();
  });
  gate = run.catch(() => {});
  await run;
}

async function fetchRange(ticker: string): Promise<RangeBits> {
  const key = apiKey();
  if (!key) throw new Error('MASSIVE_API_KEY is not set');

  const to = new Date();
  const from = new Date(to.getTime() - RANGE_DAYS * 86_400_000);
  const path =
    `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${ymd(from)}/${ymd(to)}` +
    `?adjusted=true&sort=asc&limit=50&apiKey=${encodeURIComponent(key)}`;
  const url = `${BASE}${path}`;

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
      // Never echo the key if it somehow appears in an error body/URL.
      const safe = text.replaceAll(key, '[REDACTED]').slice(0, 200);
      throw new Error(`Massive HTTP ${res.status}${safe ? `: ${safe}` : ''}`);
    }
    const json = await res.json();
    if (json?.status === 'ERROR' || json?.error) {
      throw new Error(String(json.error || json.message || 'Massive error'));
    }
    const results: AggBar[] = Array.isArray(json?.results) ? json.results : [];
    const closes = results
      .map((b) => Number(b.c))
      .filter((n) => Number.isFinite(n));
    if (closes.length < 1) throw new Error('No aggregate bars');
    const price = closes[closes.length - 1];
    const prevClose = closes.length >= 2 ? closes[closes.length - 2] : null;
    const change = prevClose != null ? price - prevClose : null;
    const changePct = change != null && prevClose ? (change / prevClose) * 100 : null;
    const lastT = Number(results[results.length - 1]?.t);
    const asOf = Number.isFinite(lastT) ? lastT : Date.now();
    return {
      price,
      prevClose,
      change,
      changePct,
      currency: 'USD',
      asOf,
      sparkline: closes.slice(-SPARK_MAX),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch one quote with short TTL cache; on failure return last good if any. */
export async function getMassiveQuote(id: string): Promise<{
  quote: MassiveQuote;
  stale: boolean;
  attribution: string;
}> {
  const meta = MASSIVE_SYMBOLS[id];
  if (!meta) return { quote: emptyQuote(id, 'unknown symbol'), stale: false, attribution: ATTRIBUTION };

  const hit = cache.get(id);
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
    const raw = await fetchRange(meta.ticker);
    const quote: MassiveQuote = {
      symbol: id,
      providerSymbol: meta.ticker,
      yahooSymbol: meta.ticker,
      name: meta.name,
      price: raw.price,
      prevClose: raw.prevClose,
      change: raw.change,
      changePct: raw.changePct,
      currency: meta.currency || raw.currency,
      asOf: raw.asOf,
      sparkline: raw.sparkline,
      ok: true,
    };
    cache.set(id, { at: Date.now(), quote });
    return { quote, stale: false, attribution: ATTRIBUTION };
  } catch (err) {
    if (hit?.quote?.ok) {
      return { quote: { ...hit.quote, error: 'stale' }, stale: true, attribution: ATTRIBUTION };
    }
    const msg = err instanceof Error ? err.message : String(err);
    const safe = apiKey() ? msg.replaceAll(apiKey(), '[REDACTED]') : msg;
    return { quote: emptyQuote(id, safe), stale: false, attribution: ATTRIBUTION };
  }
}

export async function getMassiveQuotes(ids: string[]): Promise<{
  quotes: MassiveQuote[];
  stale: boolean;
  attribution: string;
  fetchedAt: number;
}> {
  const list = (ids.length ? ids : Object.keys(MASSIVE_SYMBOLS)).filter((id) => MASSIVE_SYMBOLS[id]);
  // Sequential — free tier is ~5 req/min; pace() enforces the gap. Cached ids skip upstream.
  const quotes: MassiveQuote[] = [];
  let anyStale = false;
  for (const id of list) {
    const { quote, stale } = await getMassiveQuote(id);
    quotes.push(quote);
    if (stale) anyStale = true;
  }
  return { quotes, stale: anyStale, attribution: ATTRIBUTION, fetchedAt: Date.now() };
}

export { ATTRIBUTION as MASSIVE_ATTRIBUTION, CACHE_TTL_MS as MASSIVE_CACHE_TTL_MS };
