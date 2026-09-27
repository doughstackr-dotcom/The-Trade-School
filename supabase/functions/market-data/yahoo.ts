// Yahoo Finance unofficial chart API — server-side only (browsers hit CORS).
// No API key. Unofficial: rate-limit politely, cache briefly, degrade to stale.
// Docs: https://finance.yahoo.com (terms); chart endpoint is commonly used as
//   https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=5d
// Prefer Alpha Vantage for historical OHLC when configured; Yahoo powers Live Lab quotes.

export type YahooQuote = {
  symbol: string;
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

/** Our id → Yahoo symbol. */
export const YAHOO_SYMBOLS: Record<string, { yahoo: string; name: string }> = {
  SPY: { yahoo: 'SPY', name: 'S&P 500 ETF' },
  QQQ: { yahoo: 'QQQ', name: 'Nasdaq-100 ETF' },
  AAPL: { yahoo: 'AAPL', name: 'Apple' },
  MSFT: { yahoo: 'MSFT', name: 'Microsoft' },
  NVDA: { yahoo: 'NVDA', name: 'NVIDIA' },
  TSLA: { yahoo: 'TSLA', name: 'Tesla' },
  'BTC-USD': { yahoo: 'BTC-USD', name: 'Bitcoin' },
  'ETH-USD': { yahoo: 'ETH-USD', name: 'Ethereum' },
  'EUR-USD': { yahoo: 'EURUSD=X', name: 'Euro / US dollar' },
  GLD: { yahoo: 'GLD', name: 'Gold ETF' },
};

const CACHE_TTL_MS = 45_000;
const FETCH_TIMEOUT_MS = 8_000;
const ATTRIBUTION = 'Quotes: Yahoo Finance (unofficial). Educational use; not for trading decisions. Subject to Yahoo rate limits.';

type CacheEntry = { at: number; quote: YahooQuote };
const cache = new Map<string, CacheEntry>();

function emptyQuote(id: string, err?: string): YahooQuote {
  const meta = YAHOO_SYMBOLS[id];
  return {
    symbol: id,
    yahooSymbol: meta?.yahoo || id,
    name: meta?.name || id,
    price: null,
    prevClose: null,
    change: null,
    changePct: null,
    currency: null,
    asOf: null,
    sparkline: [],
    ok: false,
    error: err || 'unavailable',
  };
}

type ChartBits = {
  price: number;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  currency: string | null;
  asOf: number;
  sparkline: number[];
};

async function fetchChart(yahooSymbol: string): Promise<ChartBits> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1mo&includePrePost=false`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'TheTradeSchool/1.0 (educational; contact: support)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error(json?.chart?.error?.description || 'No chart result');
    const meta = result.meta || {};
    const closes: number[] = (result.indicators?.quote?.[0]?.close || []).filter((n: unknown) => typeof n === 'number' && Number.isFinite(n));
    const price = Number(meta.regularMarketPrice ?? closes[closes.length - 1]);
    const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? closes[closes.length - 2]);
    if (!Number.isFinite(price)) throw new Error('Missing price');
    const change = Number.isFinite(prevClose) ? price - prevClose : null;
    const changePct = change != null && prevClose ? (change / prevClose) * 100 : null;
    const asOf = Number(meta.regularMarketTime) ? Number(meta.regularMarketTime) * 1000 : Date.now();
    return {
      price,
      prevClose: Number.isFinite(prevClose) ? prevClose : null,
      change,
      changePct,
      currency: meta.currency || null,
      asOf,
      sparkline: closes.slice(-30),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch one quote with short TTL cache; on failure return last good if any. */
export async function getYahooQuote(id: string): Promise<{ quote: YahooQuote; stale: boolean; attribution: string }> {
  const meta = YAHOO_SYMBOLS[id];
  if (!meta) return { quote: emptyQuote(id, 'unknown symbol'), stale: false, attribution: ATTRIBUTION };

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS && hit.quote.ok) {
    return { quote: hit.quote, stale: false, attribution: ATTRIBUTION };
  }

  try {
    const raw = await fetchChart(meta.yahoo);
    const quote: YahooQuote = {
      symbol: id,
      yahooSymbol: meta.yahoo,
      name: meta.name,
      price: raw.price,
      prevClose: raw.prevClose,
      change: raw.change,
      changePct: raw.changePct,
      currency: raw.currency,
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
    return { quote: emptyQuote(id, msg), stale: false, attribution: ATTRIBUTION };
  }
}

export async function getYahooQuotes(ids: string[]): Promise<{
  quotes: YahooQuote[];
  stale: boolean;
  attribution: string;
  fetchedAt: number;
}> {
  const list = (ids.length ? ids : Object.keys(YAHOO_SYMBOLS)).filter((id) => YAHOO_SYMBOLS[id]);
  // Sequential with a tiny gap — Yahoo unofficial endpoints dislike bursts.
  const quotes: YahooQuote[] = [];
  let anyStale = false;
  for (const id of list) {
    const { quote, stale } = await getYahooQuote(id);
    quotes.push(quote);
    if (stale) anyStale = true;
    await new Promise((r) => setTimeout(r, 80));
  }
  return { quotes, stale: anyStale, attribution: ATTRIBUTION, fetchedAt: Date.now() };
}

export { ATTRIBUTION as YAHOO_ATTRIBUTION, CACHE_TTL_MS as YAHOO_CACHE_TTL_MS };
