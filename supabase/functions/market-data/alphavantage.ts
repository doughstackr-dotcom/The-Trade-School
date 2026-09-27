// Alpha Vantage adapter for the market-data Edge Function.
//
// Free key (secret ALPHAVANTAGE_API_KEY): 25 requests/day for the whole site, daily candles
// (latest ~100 via outputsize=compact) and full weekly history. Intraday and full daily
// history are premium: set ALPHAVANTAGE_PREMIUM=1 once the key is on a paid plan.
// Every upstream call takes one unit of the daily budget (ALPHAVANTAGE_DAILY_LIMIT,
// default 24) through ctx.takeQuota(); when it is spent the function serves the cache.
// Each series also has a small budget of its own per UTC day (a refresh plus a couple of
// retries), so one series that keeps failing can't use up the site's budget.
//
// The key travels in the query string of every request: it never goes into an error message
// (see redactKey), so it can't reach the logs or a response.
//
// Commercial use: Alpha Vantage asks commercial users to contact premium@alphavantage.co.
// The site owner is responsible for that agreement (see docs/MARKET_DATA.md).

export type AvKind = 'equity' | 'fx' | 'crypto';
export type AvSymbol = { kind: AvKind; symbol?: string; from?: string; to?: string; market?: string };
export type AvInterval = '5m' | '15m' | '1h' | '1d' | '1w';
export type AvCandle = { t: number; o: number; h: number; l: number; c: number; v: number };
export type AvContext = { takeQuota(provider: string, dailyLimit: number): Promise<boolean> };

export class QuotaExhausted extends Error {
  constructor(message = 'Alpha Vantage daily request budget is used up') {
    super(message);
  }
}

const env = (k: string) => Deno.env.get(k) ?? '';
// Trimmed: a key pasted into the secrets form with a trailing space or newline must still work,
// and a blank one means "not configured".
const KEY = () => env('ALPHAVANTAGE_API_KEY').trim();
const PREMIUM = () => env('ALPHAVANTAGE_PREMIUM').trim() === '1';
const DAILY_LIMIT = () => Math.max(1, Number(env('ALPHAVANTAGE_DAILY_LIMIT')) || 24);
/**
 * Units one series may use per UTC day: daily/weekly: a first fill, the refresh after the close and
 * two retries; intraday (premium): hourly refreshes plus retries.
 */
const SERIES_LIMIT = (interval: AvInterval) => (interval === '1d' || interval === '1w' ? 4 : 40);

export const avAvailable = () => KEY().length > 0;
export const avPremium = PREMIUM;

export function avSupports(av: AvSymbol | undefined, interval: string): boolean {
  if (!av) return false;
  if (interval === '1d' || interval === '1w') return true;
  if (!PREMIUM()) return false;
  if (interval === '5m' || interval === '15m' || interval === '1h') return true;
  return false;
}

/**
 * `text` without the API key: Deno's fetch errors carry the full request URL (key included) in
 * their message or cause, and a proxy's error page may echo it.
 */
export function redactKey(text: string): string {
  let out = String(text).replace(/(apikey=)[^&\s)"'<>]*/gi, '$1[redacted]');
  const key = KEY();
  if (key.length >= 4) out = out.split(key).join('[redacted]');
  return out;
}

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** 'YYYY-MM-DD' → ms at 00:00 UTC. */
function dayMs(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Weekly rows are dated by the week's last trading day (any weekday or Sunday); candles are keyed by Monday. */
function mondayOf(ms: number): number {
  const dow = new Date(ms).getUTCDay(); // 0 = Sunday
  return ms - ((dow + 6) % 7) * DAY;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Offset in ms between UTC and `timeZone` at the given instant. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(new Date(utcMs));
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

function buildUrl(av: AvSymbol, interval: AvInterval, adjusted: boolean): string {
  const p = new URLSearchParams({ apikey: KEY() });
  const size = PREMIUM() ? 'full' : 'compact';
  const avInterval = { '5m': '5min', '15m': '15min', '1h': '60min' } as Record<string, string>;
  if (av.kind === 'equity') {
    p.set('symbol', av.symbol!);
    if (interval === '1d') p.set('function', 'TIME_SERIES_DAILY'), p.set('outputsize', size);
    else if (interval === '1w') p.set('function', adjusted ? 'TIME_SERIES_WEEKLY_ADJUSTED' : 'TIME_SERIES_WEEKLY');
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

/** A price-scale change between two weeks bigger than any dividend: a split (5:4 = 0.8, 2:1 = 0.5, …). */
const isSplit = (ratio: number) => ratio < 0.87 || ratio > 1 / 0.87;

/** Parse any Alpha Vantage time-series payload into candles (oldest first, one per t). */
export function parseAlphaVantage(body: unknown, interval: AvInterval): AvCandle[] {
  if (!body || typeof body !== 'object') throw new Error('Alpha Vantage: empty response');
  const obj = body as Record<string, unknown>;
  const problem = obj['Error Message'] ?? obj['Note'] ?? obj['Information'];
  if (problem) throw new Error(`Alpha Vantage: ${redactKey(String(problem).slice(0, 200))}`);
  const seriesKey = Object.keys(obj).find((k) => /time series/i.test(k));
  if (!seriesKey) throw new Error('Alpha Vantage: no time series in response');
  const meta = (obj['Meta Data'] ?? {}) as Record<string, string>;
  const tzKey = Object.keys(meta).find((k) => /time zone/i.test(k));
  const timeZone = (tzKey && meta[tzKey]) || 'UTC';
  const series = obj[seriesKey];
  if (!series || typeof series !== 'object') throw new Error('Alpha Vantage: no time series in response');

  // Raw rows by candle time. Oldest stamp first, so if two stamps ever land on the same candle
  // (two rows in one week) the later, more complete one wins — one row per key, or the whole
  // cache write would fail and be retried (and paid for) again.
  type Raw = { t: number; o: number; h: number; l: number; c: number; v: number; adj: number };
  const byT = new Map<number, Raw>();
  for (const [stamp, row] of Object.entries(series as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, string>;
    let t: number;
    if (interval === '1d') t = dayMs(stamp);
    else if (interval === '1w') t = mondayOf(dayMs(stamp));
    else t = localStampMs(stamp, timeZone);
    const raw: Raw = {
      t,
      o: field(r, 'open'),
      h: field(r, 'high'),
      l: field(r, 'low'),
      c: field(r, 'close', /adjusted/),
      v: field(r, 'volume'),
      adj: field(r, 'adjusted close'),
    };
    if (![t, raw.o, raw.h, raw.l, raw.c].every(Number.isFinite)) continue;
    byT.set(t, raw);
  }
  const rows = [...byT.values()].sort((a, b) => a.t - b.t);

  // Adjusted series (weekly adjusted): scale OHLC by adjusted/raw close, so splits don't look
  // like crashes. A split that takes effect during a week (after its first session, e.g. TSLA's
  // Thursday split in Aug 2022) leaves that week's raw open — and its high (forward split) or low
  // (reverse split) — in pre-split prices: those take the previous week's factor instead.
  const adjusted = (r: Raw | undefined) => Boolean(r && Number.isFinite(r.adj) && r.adj > 0 && r.c > 0);
  return rows.map((r, i) => {
    if (!adjusted(r)) return { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: Number.isFinite(r.v) ? r.v : 0 };
    const k = r.adj / r.c;
    let [ko, kh, kl] = [k, k, k];
    const prev = rows[i - 1];
    if (prev && adjusted(prev)) {
      const kp = prev.adj / prev.c;
      const s = kp / k; // post-split price / pre-split price
      const openPreSplit = Math.abs(Math.log(r.o / prev.c)) < Math.abs(Math.log(r.o / (prev.c * s)));
      if (isSplit(s) && openPreSplit) [ko, kh, kl] = [kp, Math.min(kp, k), Math.max(kp, k)];
    }
    return { t: r.t, o: r.o * ko, h: r.h * kh, l: r.l * kl, c: r.adj, v: Number.isFinite(r.v) ? r.v : 0 };
  });
}

/** This instance has seen TIME_SERIES_WEEKLY_ADJUSTED answer "premium" (until then): use plain weekly. */
let weeklyAdjustedPremiumUntil = -Infinity;

export async function fetchAlphaVantage(
  av: AvSymbol,
  interval: AvInterval,
  startMs: number,
  endMs: number,
  ctx: AvContext,
): Promise<AvCandle[]> {
  if (!avAvailable()) throw new Error('ALPHAVANTAGE_API_KEY is not set');
  const adjusted = interval === '1w' && av.kind === 'equity' && Date.now() >= weeklyAdjustedPremiumUntil;
  let body = await call(buildUrl(av, interval, adjusted), av, interval, ctx);
  // Weekly adjusted may not be on every plan: fall back to plain weekly (one more unit), and
  // remember it for a while so the next weekly refreshes don't pay twice.
  if (adjusted && isPlanError(body)) {
    weeklyAdjustedPremiumUntil = Date.now() + 12 * HOUR;
    body = await call(buildUrl(av, interval, false), av, interval, ctx);
  }
  return parseAlphaVantage(body, interval).filter((c) => c.t >= startMs - 7 * DAY && c.t <= endMs);
}

/** One upstream request: a unit of the series' budget, a unit of the site's, a paced slot. */
async function call(url: string, av: AvSymbol, interval: AvInterval, ctx: AvContext): Promise<unknown> {
  // The series' own budget first: a unit of the site's scarce budget is never taken for a call
  // that then doesn't happen.
  const series = `alphavantage:${av.symbol ?? `${av.from}${av.to}`}:${interval}`;
  if (!(await ctx.takeQuota(series, SERIES_LIMIT(interval)))) {
    throw new QuotaExhausted(`Alpha Vantage budget of ${series.slice(13)} for today is used up`);
  }
  if (!(await ctx.takeQuota('alphavantage', DAILY_LIMIT()))) throw new QuotaExhausted();
  await pace();
  return await getJson(url);
}

function isPlanError(body: unknown): boolean {
  const o = (body ?? {}) as Record<string, unknown>;
  return Boolean(o['Information'] && /premium/i.test(String(o['Information'])));
}

// The free key also allows about one call per second: calls from this instance are spaced out
// (ALPHAVANTAGE_SPACING_MS, default 1100) — including the weekly fallback's second call.
let nextSlot = 0;
async function pace() {
  const spacing = Math.max(0, Number(Deno.env.get('ALPHAVANTAGE_SPACING_MS') ?? '1100') || 0);
  if (!spacing) return;
  const now = performance.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + spacing;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/** Tests only: forget what this instance learned (plan fallback, pacing). */
export function resetAlphaVantageState() {
  weeklyAdjustedPremiumUntil = -Infinity;
  nextSlot = 0;
}

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'TheTradeSchool/1.0 (educational)' }, signal: ctrl.signal });
    } catch (err) {
      // A new error without `cause`: the original carries the URL, key included.
      const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      throw new Error(`Alpha Vantage request failed (${redactKey(text).slice(0, 200)})`);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`Alpha Vantage HTTP ${res.status}`);
    }
    try {
      return await res.json();
    } catch {
      throw new Error('Alpha Vantage: unreadable response'); // not the body: a proxy page may echo the URL
    }
  } finally {
    clearTimeout(timer);
  }
}

const NEW_YORK = 'America/New_York';
/** hh:mm New York time on the UTC calendar day `day` (ms at 00:00 UTC), in UTC ms (DST-aware). */
function newYorkTime(day: number, hh: number, mm: number): number {
  const asUtc = day + hh * HOUR + mm * MIN;
  return asUtc - tzOffsetMs(asUtc, NEW_YORK); // US clocks change at 2 am on Sundays: same offset all afternoon
}

/**
 * The most recent moment a new candle could have completed, so a cache fetched after it is
 * still current. Daily: 90 min after the New York close, which follows US daylight saving
 * (US equities 17:30 New York = 21:30 UTC in summer, 22:30 UTC in winter; FX 18:30 New York =
 * 22:30 / 23:30 UTC; crypto 00:30 UTC for the UTC day before). Weekly: 00:30 UTC after the
 * week is complete — Saturday (crypto: Monday), which keeps the weekly refreshes off Friday,
 * the UTC day that already carries every market's daily refresh.
 */
export function lastBoundaryMs(av: AvSymbol, interval: AvInterval, now = Date.now()): number {
  if (interval !== '1d' && interval !== '1w') return now - HOUR; // intraday (premium): at most hourly refreshes
  for (let day = Math.floor(now / DAY) * DAY; ; day -= DAY) {
    const dow = new Date(day).getUTCDay();
    let b: number;
    if (interval === '1w') {
      if (dow !== (av.kind === 'crypto' ? 1 : 6)) continue;
      b = day + 30 * MIN;
    } else if (av.kind === 'crypto') {
      b = day + 30 * MIN;
    } else {
      if (dow === 0 || dow === 6) continue; // no session on weekends (holidays are not known)
      b = av.kind === 'fx' ? newYorkTime(day, 18, 30) : newYorkTime(day, 17, 30);
    }
    if (b <= now) return b;
  }
}

export const AV_ATTRIBUTION = 'Market data: Alpha Vantage';
