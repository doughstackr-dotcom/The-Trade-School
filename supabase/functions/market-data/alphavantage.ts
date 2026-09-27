// Alpha Vantage adapter for the market-data Edge Function.
//
// Free key (secret ALPHAVANTAGE_API_KEY): 25 requests/day for the whole site, daily candles
// (latest ~100 via outputsize=compact) and full weekly history. Intraday and full daily
// history are premium: set ALPHAVANTAGE_PREMIUM=1 once the key is on a paid plan.
// Every upstream call takes one unit of the daily budget (ALPHAVANTAGE_DAILY_LIMIT,
// default 24) through ctx.takeQuota(); when it is spent the function serves the cache.
//
// Commercial use: Alpha Vantage asks commercial users to contact premium@alphavantage.co.
// The site owner is responsible for that agreement (see docs/MARKET_DATA.md).

export type AvKind = 'equity' | 'fx' | 'crypto';
export type AvSymbol = { kind: AvKind; symbol?: string; from?: string; to?: string; market?: string };
export type AvInterval = '5m' | '15m' | '1h' | '1d' | '1w';
export type AvCandle = { t: number; o: number; h: number; l: number; c: number; v: number };
export type AvContext = { takeQuota(provider: string, dailyLimit: number): Promise<boolean> };

export class QuotaExhausted extends Error {
  constructor() {
    super('Alpha Vantage daily request budget is used up');
  }
}

const env = (k: string) => Deno.env.get(k) ?? '';
const KEY = () => env('ALPHAVANTAGE_API_KEY');
const PREMIUM = () => env('ALPHAVANTAGE_PREMIUM') === '1';
const DAILY_LIMIT = () => Math.max(1, Number(env('ALPHAVANTAGE_DAILY_LIMIT')) || 24);

export const avAvailable = () => KEY().length > 0;

export function avSupports(av: AvSymbol | undefined, interval: string): boolean {
  if (!av) return false;
  if (interval === '1d' || interval === '1w') return true;
  if (!PREMIUM()) return false;
  if (interval === '5m' || interval === '15m' || interval === '1h') return true;
  return false;
}

const DAY = 86_400_000;

/** 'YYYY-MM-DD' → ms at 00:00 UTC. */
function dayMs(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Weekly rows are dated by the week's last trading day; candles are keyed by Monday. */
function mondayOf(ms: number): number {
  const dow = new Date(ms).getUTCDay(); // 0 = Sunday
  return ms - ((dow + 6) % 7) * DAY;
}

/** Offset in ms between UTC and `timeZone` at the given instant (for intraday stamps). */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - utcMs;
}

/** 'YYYY-MM-DD HH:MM:SS' in `timeZone` → UTC ms. */
function localStampMs(stamp: string, timeZone: string): number {
  const [d, t = '00:00:00'] = stamp.split(' ');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm, ss] = t.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, day, hh, mm, ss || 0);
  const offset = tzOffsetMs(guess, timeZone);
  return guess - offset;
}

/** Pick a numeric field by its label ("open", "high", …) regardless of the "1. " / "1a. " prefix. */
function field(row: Record<string, string>, name: string, exclude?: RegExp): number {
  for (const [k, v] of Object.entries(row)) {
    const label = k.replace(/^\d+[a-z]?\.\s*/, '').toLowerCase();
    if (label.startsWith(name) && !(exclude && exclude.test(label))) return Number(v);
  }
  return NaN;
}

function buildUrl(av: AvSymbol, interval: AvInterval): string {
  const p = new URLSearchParams({ apikey: KEY() });
  const size = PREMIUM() ? 'full' : 'compact';
  const avInterval = { '5m': '5min', '15m': '15min', '1h': '60min' } as Record<string, string>;
  if (av.kind === 'equity') {
    p.set('symbol', av.symbol!);
    if (interval === '1d') p.set('function', 'TIME_SERIES_DAILY'), p.set('outputsize', size);
    else if (interval === '1w') p.set('function', 'TIME_SERIES_WEEKLY_ADJUSTED');
    else p.set('function', 'TIME_SERIES_INTRADAY'), p.set('interval', avInterval[interval]), p.set('outputsize', 'full');
  } else if (av.kind === 'fx') {
    p.set('from_symbol', av.from!);
    p.set('to_symbol', av.to!);
    if (interval === '1d') p.set('function', 'FX_DAILY'), p.set('outputsize', size);
    else if (interval === '1w') p.set('function', 'FX_WEEKLY');
    else p.set('function', 'FX_INTRADAY'), p.set('interval', avInterval[interval]), p.set('outputsize', 'full');
  } else {
    p.set('symbol', av.symbol!);
    p.set('market', av.market ?? 'USD');
    if (interval === '1d') p.set('function', 'DIGITAL_CURRENCY_DAILY');
    else if (interval === '1w') p.set('function', 'DIGITAL_CURRENCY_WEEKLY');
    else p.set('function', 'CRYPTO_INTRADAY'), p.set('interval', avInterval[interval]), p.set('outputsize', 'full');
  }
  return `https://www.alphavantage.co/query?${p}`;
}

/** Parse any Alpha Vantage time-series payload into candles (oldest first). */
export function parseAlphaVantage(body: unknown, interval: AvInterval): AvCandle[] {
  if (!body || typeof body !== 'object') throw new Error('Alpha Vantage: empty response');
  const obj = body as Record<string, unknown>;
  const problem = obj['Error Message'] ?? obj['Note'] ?? obj['Information'];
  if (problem) throw new Error(`Alpha Vantage: ${String(problem).slice(0, 200)}`);
  const seriesKey = Object.keys(obj).find((k) => /time series/i.test(k));
  if (!seriesKey) throw new Error('Alpha Vantage: no time series in response');
  const meta = (obj['Meta Data'] ?? {}) as Record<string, string>;
  const tzKey = Object.keys(meta).find((k) => /time zone/i.test(k));
  const timeZone = (tzKey && meta[tzKey]) || 'UTC';
  const series = obj[seriesKey] as Record<string, Record<string, string>>;

  const out: AvCandle[] = [];
  for (const [stamp, row] of Object.entries(series)) {
    let o = field(row, 'open');
    let h = field(row, 'high');
    let l = field(row, 'low');
    const c = field(row, 'close', /adjusted/);
    const adj = field(row, 'adjusted close');
    const v = field(row, 'volume');
    let close = c;
    // Weekly adjusted: scale OHLC by adjusted/raw close so splits don't look like crashes.
    if (Number.isFinite(adj) && Number.isFinite(c) && c > 0 && adj > 0) {
      const k = adj / c;
      o *= k;
      h *= k;
      l *= k;
      close = adj;
    }
    let t: number;
    if (interval === '1d') t = dayMs(stamp);
    else if (interval === '1w') t = mondayOf(dayMs(stamp));
    else t = localStampMs(stamp, timeZone);
    if (![t, o, h, l, close].every(Number.isFinite)) continue;
    out.push({ t, o, h, l, c: close, v: Number.isFinite(v) ? v : 0 });
  }
  return out.sort((a, b) => a.t - b.t);
}

export async function fetchAlphaVantage(
  av: AvSymbol,
  interval: AvInterval,
  startMs: number,
  endMs: number,
  ctx: AvContext,
): Promise<AvCandle[]> {
  if (!avAvailable()) throw new Error('ALPHAVANTAGE_API_KEY is not set');
  if (!(await ctx.takeQuota('alphavantage', DAILY_LIMIT()))) throw new QuotaExhausted();

  let url = buildUrl(av, interval);
  let body = await getJson(url);
  // Weekly adjusted may not be on every plan: fall back to plain weekly (one more call).
  if (interval === '1w' && av.kind === 'equity' && isPlanError(body) && (await ctx.takeQuota('alphavantage', DAILY_LIMIT()))) {
    url = url.replace('TIME_SERIES_WEEKLY_ADJUSTED', 'TIME_SERIES_WEEKLY');
    body = await getJson(url);
  }
  return parseAlphaVantage(body, interval).filter((c) => c.t >= startMs - 7 * DAY && c.t <= endMs);
}

function isPlanError(body: unknown): boolean {
  const o = (body ?? {}) as Record<string, unknown>;
  return Boolean(o['Information'] && /premium/i.test(String(o['Information'])));
}

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'TheTradeSchool/1.0 (educational)' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The most recent moment a new candle could have completed, so a cache fetched after it is
 * still current. Daily: after the session close for the symbol's market (US equities ~21:30
 * UTC to cover DST and data lag, FX 22:30 UTC, crypto 00:30 UTC). Weekly: that boundary on the
 * last Friday (crypto: Monday 00:30 UTC).
 */
export function lastBoundaryMs(av: AvSymbol, interval: AvInterval, now = Date.now()): number {
  const closeUtcMinutes = av.kind === 'crypto' ? 30 : av.kind === 'fx' ? 22 * 60 + 30 : 21 * 60 + 30;
  const today = Math.floor(now / DAY) * DAY;
  let b = today + closeUtcMinutes * 60_000;
  if (b > now) b -= DAY;
  if (interval === '1d') {
    if (av.kind !== 'crypto') while ([0, 6].includes(new Date(b).getUTCDay())) b -= DAY; // skip weekends
    return b;
  }
  if (interval === '1w') {
    const target = av.kind === 'crypto' ? 1 : 5; // Monday for crypto, Friday otherwise
    while (new Date(b).getUTCDay() !== target) b -= DAY;
    return b;
  }
  return now - 60 * 60_000; // intraday (premium): at most hourly refreshes
}

export const AV_ATTRIBUTION = 'Market data: Alpha Vantage';
