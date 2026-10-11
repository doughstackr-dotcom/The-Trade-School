// Market data providers for the market-data Edge Function.
// Each provider turns (symbol, interval, time range) into candles { t(ms), o, h, l, c, v },
// oldest first, and reports available() = false until the owner configures it:
//   * Alpha Vantage needs the secret ALPHAVANTAGE_API_KEY (see alphavantage.ts).
//   * The exchange feeds (Coinbase, Kraken) are technically public, but their terms don't allow
//     showing the data to paying users without written permission, so each one stays off until
//     the secret MARKET_EXCHANGE_FEEDS lists it (e.g. "kraken,coinbase").
import {
  AV_ATTRIBUTION,
  avAvailable,
  avPremium,
  avSupports,
  type AvInterval,
  type AvSymbol,
  fetchAlphaVantage,
  lastBoundaryMs,
  QuotaExhausted,
  redactKey,
} from './alphavantage.ts';

export { QuotaExhausted, redactKey };

export type Interval = '1m' | '5m' | '15m' | '1h' | '6h' | '1d' | '1w';
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
export type ProviderName = 'coinbase' | 'kraken' | 'alphavantage';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Every interval, shortest first (the order the catalog lists them in). */
export const INTERVALS: Interval[] = ['1m', '5m', '15m', '1h', '6h', '1d', '1w'];
export const INTERVAL_MS: Record<Interval, number> = {
  '1m': MIN,
  '5m': 5 * MIN,
  '15m': 15 * MIN,
  '1h': HOUR,
  '6h': 6 * HOUR,
  '1d': DAY,
  '1w': 7 * DAY, // weekly candles open on Monday 00:00 UTC (not a multiple of 7 days from the epoch)
};
export const INTRADAY: ReadonlySet<Interval> = new Set(['1m', '5m', '15m', '1h', '6h']);

export type SymbolMeta = {
  id: string;
  name: string;
  class: 'crypto' | 'stock' | 'etf' | 'fx' | 'metal';
  /** Price decimals to display. */
  decimals: number;
  /** In order of preference; only the available ones are used. */
  providers: ProviderName[];
  coinbase?: string; // Coinbase Exchange product id
  kraken?: string; // Kraken pair name
  av?: AvSymbol; // Alpha Vantage symbol
};

const crypto = (id: string, name: string, decimals: number, kraken?: string, av?: string): SymbolMeta => ({
  id,
  name,
  class: 'crypto',
  decimals,
  providers: ['coinbase', ...(kraken ? ['kraken' as const] : []), ...(av ? ['alphavantage' as const] : [])],
  coinbase: id,
  kraken,
  av: av ? { kind: 'crypto', symbol: av, market: 'USD' } : undefined,
});

const equity = (id: string, name: string, cls: 'stock' | 'etf'): SymbolMeta => ({
  id,
  name,
  class: cls,
  decimals: 2,
  providers: ['alphavantage'],
  av: { kind: 'equity', symbol: id },
});

const fx = (from: string, to: string, name: string): SymbolMeta => ({
  id: `${from}-${to}`,
  name,
  class: 'fx',
  decimals: to === 'JPY' ? 2 : 4,
  providers: ['alphavantage'],
  av: { kind: 'fx', from, to },
});

export const SYMBOLS: Record<string, SymbolMeta> = {
  SPY: equity('SPY', 'S&P 500 ETF', 'etf'),
  QQQ: equity('QQQ', 'Nasdaq-100 ETF', 'etf'),
  GLD: equity('GLD', 'Gold ETF', 'etf'),
  AAPL: equity('AAPL', 'Apple', 'stock'),
  MSFT: equity('MSFT', 'Microsoft', 'stock'),
  NVDA: equity('NVDA', 'NVIDIA', 'stock'),
  TSLA: equity('TSLA', 'Tesla', 'stock'),
  'EUR-USD': fx('EUR', 'USD', 'Euro / US dollar'),
  'GBP-USD': fx('GBP', 'USD', 'British pound / US dollar'),
  'USD-JPY': fx('USD', 'JPY', 'US dollar / Japanese yen'),
  'BTC-USD': crypto('BTC-USD', 'Bitcoin', 2, 'XBTUSD', 'BTC'),
  'ETH-USD': crypto('ETH-USD', 'Ethereum', 2, 'ETHUSD', 'ETH'),
  'SOL-USD': crypto('SOL-USD', 'Solana', 2, 'SOLUSD'),
  'XRP-USD': crypto('XRP-USD', 'XRP', 4, 'XRPUSD'),
  'DOGE-USD': crypto('DOGE-USD', 'Dogecoin', 5, 'XDGUSD'),
  'LTC-USD': crypto('LTC-USD', 'Litecoin', 2, 'LTCUSD'),
  'ADA-USD': crypto('ADA-USD', 'Cardano', 4, 'ADAUSD'),
  'AVAX-USD': crypto('AVAX-USD', 'Avalanche', 2, 'AVAXUSD'),
  'LINK-USD': crypto('LINK-USD', 'Chainlink', 3, 'LINKUSD'),
};

const UA = { 'User-Agent': 'TheTradeSchool/1.0 (educational)', Accept: 'application/json' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function finish(candles: Candle[], startMs: number, endMs: number): Candle[] {
  const byT = new Map<number, Candle>();
  for (const c of candles) if (c.t >= startMs - 1 && c.t <= endMs) byT.set(c.t, c);
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/** Exchange feeds the owner has written permission for: MARKET_EXCHANGE_FEEDS="kraken,coinbase". */
function feedEnabled(name: ProviderName): boolean {
  return (Deno.env.get('MARKET_EXCHANGE_FEEDS') ?? '').toLowerCase().split(/[\s,;]+/).includes(name);
}

/** What providers may use besides the network: the shared daily request budget. */
export type ProviderContext = {
  /** Takes one unit of `provider`'s budget for today (UTC); false when it is used up. */
  takeQuota(provider: string, dailyLimit: number): Promise<boolean>;
};

export type Provider = {
  attribution: string;
  delayed: boolean;
  available(): boolean;
  supports(interval: Interval, meta: SymbolMeta): boolean;
  fetch(meta: SymbolMeta, interval: Interval, startMs: number, endMs: number, ctx: ProviderContext): Promise<Candle[]>;
  /**
   * Only the latest `maxBack(interval)` candles are served (undefined: full history back to the
   * listing). Without it an empty answer for an older range would be read as the listing date.
   */
  maxBack?(interval: Interval): number | undefined;
  /** Intervals without trades are left out instead of repeated flat (the caller fills them). */
  sparse?: boolean;
  /**
   * Metered snapshot provider: every call takes a unit of a small daily budget and answers with
   * the whole series it serves (its latest maxBack candles, or the full history) whatever range
   * was asked. The handler therefore only calls it through the single-flight refresh claim, at
   * most once per candle boundary (freshSince), and never to page through history.
   */
  snapshot?: boolean;
  /**
   * Latest candles fetched at or after this time are still current: no new candle can have
   * closed since. The refresh claim is not taken again before it moves. Unset: now - TTL.
   */
  freshSince?(meta: SymbolMeta, interval: Interval, now: number): number;
  /** After a failed call (which still cost a unit): wait this long. Infinity: until the next candle boundary. */
  retryAfterMs?(err: unknown): number;
};

// Coinbase Exchange public candles: GET /products/{id}/candles?granularity=&start=&end=
// returns up to 300 rows [time(s), low, high, open, close, volume], newest first.
// Granularities 60, 300, 900, 3600, 21600, 86400 map exactly to our intervals (no weekly).
const COINBASE_GRANULARITY: Partial<Record<Interval, number>> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '6h': 21600,
  '1d': 86400,
};
const coinbase: Provider = {
  attribution: 'Market data: Coinbase Exchange',
  delayed: false,
  sparse: true, // minutes/hours with no trades have no row
  available: () => feedEnabled('coinbase'),
  supports: (interval, meta) => Boolean(meta.coinbase) && interval in COINBASE_GRANULARITY,
  async fetch(meta, interval, startMs, endMs) {
    if (!meta.coinbase) throw new Error('No Coinbase product');
    const step = INTERVAL_MS[interval];
    const out: Candle[] = [];
    let end = endMs;
    for (let page = 0; page < 8 && end > startMs; page++) {
      const start = Math.max(startMs, end - 300 * step);
      const url =
        `https://api.exchange.coinbase.com/products/${encodeURIComponent(meta.coinbase)}/candles` +
        `?granularity=${step / 1000}&start=${new Date(start).toISOString()}&end=${new Date(end).toISOString()}`;
      const rows = await getJson(url);
      if (!Array.isArray(rows)) throw new Error('Unexpected Coinbase response');
      for (const r of rows as number[][]) {
        out.push({ t: r[0] * 1000, l: +r[1], h: +r[2], o: +r[3], c: +r[4], v: +r[5] });
      }
      // An empty page is not the end of history (exchanges have outages); keep going to startMs.
      // The caller works out the listing date and never asks below it again.
      end = start;
      if (end > startMs) await sleep(150); // stay well inside public rate limits
    }
    return finish(out, startMs, endMs);
  },
};

// Kraken public OHLC: GET /0/public/OHLC?pair=&interval=(minutes)&since=
// returns the most recent (up to ~720) rows [time(s), open, high, low, close, vwap, volume, count]
// oldest first, so it only serves recent history. Used as a fallback for the latest candles.
const KRAKEN_MINUTES: Partial<Record<Interval, number>> = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '1d': 1440 };
const kraken: Provider = {
  attribution: 'Market data: Kraken',
  delayed: false,
  maxBack: () => 720,
  sparse: true, // harmless if every interval is present
  available: () => feedEnabled('kraken'),
  supports: (interval, meta) => Boolean(meta.kraken) && interval in KRAKEN_MINUTES,
  async fetch(meta, interval, startMs, endMs) {
    if (!meta.kraken) throw new Error('No Kraken pair');
    const minutes = KRAKEN_MINUTES[interval]!;
    const url = `https://api.kraken.com/0/public/OHLC?pair=${meta.kraken}&interval=${minutes}&since=${Math.floor(startMs / 1000) - 1}`;
    const body = (await getJson(url)) as { error?: string[]; result?: Record<string, unknown> };
    if (body.error?.length) throw new Error(`Kraken: ${body.error.join(', ')}`);
    const key = Object.keys(body.result ?? {}).find((k) => k !== 'last');
    const rows = (key ? body.result![key] : []) as (string | number)[][];
    const out = rows.map((r) => ({ t: +r[0] * 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[6] }));
    return finish(out, startMs, endMs);
  },
};

// Alpha Vantage (free key: 25 calls/day for the whole site, daily + weekly; see alphavantage.ts,
// which also spaces calls out: the free key allows about one call per second).
const alphavantage: Provider = {
  attribution: AV_ATTRIBUTION,
  delayed: true,
  snapshot: true,
  available: avAvailable,
  supports: (interval, meta) => avSupports(meta.av, interval),
  maxBack(interval) {
    if (interval === '1w') return undefined; // full weekly history
    if (interval === '1d') return avPremium() ? undefined : 100; // outputsize=compact: ~100 latest
    return Math.floor((28 * DAY) / INTERVAL_MS[interval]); // premium intraday: about the last month
  },
  async fetch(meta, interval, _startMs, endMs, ctx) {
    if (!meta.av) throw new Error('No Alpha Vantage symbol');
    try {
      // Keep everything the call returned: it costs the same, and older windows are then
      // served from the cache instead of from another call.
      return await fetchAlphaVantage(meta.av, interval as AvInterval, -Infinity, endMs, ctx);
    } catch (err) {
      // The key's own daily limit (e.g. the key is also used elsewhere): same as our budget.
      // ("… rate limit is 25 requests per day." — not "Invalid API call … for TIME_SERIES_DAILY.")
      if (!(err instanceof QuotaExhausted) && /requests? per day|daily (rate )?limit/i.test(errorText(err))) {
        throw new QuotaExhausted();
      }
      throw err;
    }
  },
  freshSince: (meta, interval, now) => lastBoundaryMs(meta.av!, interval as AvInterval, now),
  retryAfterMs(err) {
    const text = errorText(err);
    if (/per second|per minute|spreading out|frequency/i.test(text)) return 2 * MIN; // burst limit
    // Plan, request or key error: not before the next close. Only Alpha Vantage's own wording —
    // not "apikey=" in a (redacted) request URL of a network error, which is worth a retry.
    if (/premium|invalid api call|apikey is invalid|api key is for demo/i.test(text)) return Infinity;
    return HOUR; // network / HTTP / unexpected body (each series has only a few units a day)
  },
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const PROVIDERS: Record<ProviderName, Provider> = { coinbase, kraken, alphavantage };
