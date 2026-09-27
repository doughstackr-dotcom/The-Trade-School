// Market data providers for the market-data Edge Function.
// Each provider turns (symbol, interval, time range) into candles { t(ms), o, h, l, c, v },
// oldest first. Providers that need an API key read it from Supabase secrets and report
// available() = false until the owner sets it.

export type Interval = '1m' | '5m' | '15m' | '1h' | '6h' | '1d';
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
export type ProviderName = 'coinbase' | 'kraken';

export const INTERVAL_MS: Record<Interval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '6h': 21_600_000,
  '1d': 86_400_000,
};

export type SymbolMeta = {
  id: string;
  name: string;
  class: 'crypto' | 'stock' | 'etf' | 'fx' | 'metal';
  providers: ProviderName[];
  coinbase?: string; // Coinbase Exchange product id
  kraken?: string; // Kraken pair name
};

const crypto = (id: string, name: string, kraken?: string): SymbolMeta => ({
  id,
  name,
  class: 'crypto',
  providers: kraken ? ['coinbase', 'kraken'] : ['coinbase'],
  coinbase: id,
  kraken,
});

export const SYMBOLS: Record<string, SymbolMeta> = {
  'BTC-USD': crypto('BTC-USD', 'Bitcoin', 'XBTUSD'),
  'ETH-USD': crypto('ETH-USD', 'Ethereum', 'ETHUSD'),
  'SOL-USD': crypto('SOL-USD', 'Solana', 'SOLUSD'),
  'XRP-USD': crypto('XRP-USD', 'XRP', 'XRPUSD'),
  'DOGE-USD': crypto('DOGE-USD', 'Dogecoin', 'XDGUSD'),
  'LTC-USD': crypto('LTC-USD', 'Litecoin', 'LTCUSD'),
  'ADA-USD': crypto('ADA-USD', 'Cardano', 'ADAUSD'),
  'AVAX-USD': crypto('AVAX-USD', 'Avalanche', 'AVAXUSD'),
  'LINK-USD': crypto('LINK-USD', 'Chainlink', 'LINKUSD'),
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

export type Provider = {
  attribution: string;
  delayed: boolean;
  available(): boolean;
  supports(interval: Interval): boolean;
  fetch(meta: SymbolMeta, interval: Interval, startMs: number, endMs: number): Promise<Candle[]>;
  /** Only the latest `maxBack` candles are served (unset: full history back to the listing). */
  maxBack?: number;
  /** Intervals without trades are left out instead of repeated flat (the caller fills them). */
  sparse?: boolean;
};

// Coinbase Exchange public candles: GET /products/{id}/candles?granularity=&start=&end=
// returns up to 300 rows [time(s), low, high, open, close, volume], newest first.
// Granularities 60, 300, 900, 3600, 21600, 86400 map exactly to our intervals.
const coinbase: Provider = {
  attribution: 'Market data: Coinbase Exchange',
  delayed: false,
  sparse: true, // minutes/hours with no trades have no row
  available: () => true,
  supports: () => true,
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
      if (rows.length === 0) break; // nothing earlier (before listing)
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
  maxBack: 720,
  available: () => true,
  supports: (interval) => interval in KRAKEN_MINUTES,
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

export const PROVIDERS: Record<ProviderName, Provider> = { coinbase, kraken };
