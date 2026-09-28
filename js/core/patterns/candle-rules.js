// Real-market candle rules (CANDLE_RULES), typical range / context trend helpers and
// candleConfirm(). Pure module (no DOM).
// Part of the pattern library; import from js/core/patterns.js, the public facade.

import {
  CANDLE_PATTERNS, CANDLE_PATTERN_IDS, CANDLE_THRESHOLDS, CHECKS, CONFIRM, body, span, isBull, isBear,
} from './candles.js';

const T = CANDLE_THRESHOLDS;

// ---------------------------------------------------------------------------------------------
// Rules for real-market candles. CANDLE_RULES[id](candles, i, ctx) is true when pattern `id`
// COMPLETES on candle i (its last candle), judged only from candles 0..i: the textbook geometry
// above (CHECKS, the same thresholds the generators satisfy), a pattern big enough to matter
// next to the typical range of the preceding candles, the right trend context, and — for
// reversals — the pattern printing the extreme of the move. Works at any price scale, with
// gaps, zero volume (volume is never required) and flat, doji-heavy markets.
// ---------------------------------------------------------------------------------------------

const okCandle = (k) => k != null && [k.o, k.h, k.l, k.c].every(Number.isFinite) && k.h >= k.l && k.l <= Math.min(k.o, k.c) && Math.max(k.o, k.c) <= k.h;

/** Average range (high − low) of the `n` candles before index `idx` (0 when there are none). */
export function typicalRange(candles, idx, n = T.sizeLookback) {
  const from = Math.max(0, idx - n);
  let sum = 0;
  let m = 0;
  for (let j = from; j < idx; j++) {
    const k = candles[j];
    if (!okCandle(k)) continue;
    sum += k.h - k.l;
    m++;
  }
  return m ? sum / m : 0;
}

/**
 * contextTrend(candles, i, lookback = 10) → 'up' | 'down' | 'range'
 * Trend of the `lookback` candles BEFORE index i (i itself is excluded): the regression slope of
 * the closes must move ≥ 1.2 typical ranges and the window's net move (first open → last close)
 * ≥ 0.8 typical ranges in the same direction. Fewer than 4 candles → 'range'.
 */
export function contextTrend(candles, i, lookback = T.contextLookback) {
  const to = Math.min(i, candles.length);
  const from = Math.max(0, to - Math.max(1, Math.floor(lookback)));
  const seg = candles.slice(from, to).filter(okCandle);
  const n = seg.length;
  if (n < 4) return 'range';
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  let sr = 0;
  seg.forEach((k, j) => {
    sx += j;
    sy += k.c;
    sxy += j * k.c;
    sxx += j * j;
    sr += k.h - k.l;
  });
  const avgR = sr / n;
  if (!(avgR > 0)) return 'range';
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  const move = (slope * (n - 1)) / avgR;
  const net = (seg[n - 1].c - seg[0].o) / avgR;
  if (move >= T.trendMove && net >= T.trendNet) return 'up';
  if (move <= -T.trendMove && net <= -T.trendNet) return 'down';
  return 'range';
}

/** Minimum size of each pattern next to the typical range R of the candles before it. */
const SIZE = {
  doji: (cs, R) => span(cs[0]) >= 0.6 * R,
  'dragonfly-doji': (cs, R) => span(cs[0]) >= 0.8 * R,
  'gravestone-doji': (cs, R) => span(cs[0]) >= 0.8 * R,
  'spinning-top': (cs, R) => span(cs[0]) >= 0.6 * R,
  'bullish-marubozu': (cs, R) => body(cs[0]) >= 1.0 * R,
  'bearish-marubozu': (cs, R) => body(cs[0]) >= 1.0 * R,
  hammer: (cs, R) => span(cs[0]) >= 1.0 * R,
  'hanging-man': (cs, R) => span(cs[0]) >= 1.0 * R,
  'inverted-hammer': (cs, R) => span(cs[0]) >= 1.0 * R,
  'shooting-star': (cs, R) => span(cs[0]) >= 1.0 * R,
  'bullish-engulfing': ([a, b], R) => body(a) >= 0.25 * R && body(b) >= 0.5 * R,
  'bearish-engulfing': ([a, b], R) => body(a) >= 0.25 * R && body(b) >= 0.5 * R,
  'bullish-harami': ([a], R) => body(a) >= 0.8 * R,
  'bearish-harami': ([a], R) => body(a) >= 0.8 * R,
  'piercing-line': ([a], R) => body(a) >= 0.9 * R,
  'dark-cloud-cover': ([a], R) => body(a) >= 0.9 * R,
  'tweezer-bottom': ([a, b], R) => span(a) >= 0.5 * R && span(b) >= 0.5 * R,
  'tweezer-top': ([a, b], R) => span(a) >= 0.5 * R && span(b) >= 0.5 * R,
  'morning-star': ([a, , c], R) => body(a) >= 0.9 * R && body(c) >= 0.5 * R,
  'evening-star': ([a, , c], R) => body(a) >= 0.9 * R && body(c) >= 0.5 * R,
  'three-white-soldiers': (cs, R) => cs.every((k) => body(k) >= 0.6 * R),
  'three-black-crows': (cs, R) => cs.every((k) => body(k) >= 0.6 * R),
};

/** Geometry used by the rules: CHECKS, except that an engulfing candle may open exactly AT the
 *  prior close (24/7 markets open where the last candle closed, so a strict gap never happens). */
const RULE_GEOMETRY = {
  ...CHECKS,
  'bullish-engulfing': ([a, b]) => isBear(a) && isBull(b) && b.o <= a.c && b.c > a.o && body(b) > body(a),
  'bearish-engulfing': ([a, b]) => isBull(a) && isBear(b) && b.o >= a.c && b.c < a.o && body(b) > body(a),
};

function makeRule(id) {
  const p = CANDLE_PATTERNS[id];
  const n = p.candles;
  const bull = p.bias === 'bullish';
  const soldiers = id.startsWith('three-');
  return (candles, i, ctx = {}) => {
    if (!candles || !Number.isInteger(i) || i >= candles.length) return false;
    const s = i - n + 1;
    if (s < 3) return false; // needs a little history for size and context
    const cs = candles.slice(s, i + 1);
    if (!cs.every(okCandle) || !RULE_GEOMETRY[id](cs)) return false;
    const R = ctx.avgRange > 0 ? ctx.avgRange : typicalRange(candles, s);
    if (!(R > 0) || !SIZE[id](cs, R)) return false;
    if (p.context !== 'any') {
      const trend = ctx.trend ?? contextTrend(candles, s);
      if (trend !== (p.context === 'downtrend' ? 'down' : 'up')) return false;
    }
    if (p.kind === 'reversal') {
      const before = candles.slice(Math.max(0, s - (soldiers ? 10 : T.extremeLookback)), s).filter(okCandle);
      if (!before.length) return false;
      const tol = (soldiers ? 0.5 : T.extremeTol) * R;
      if (bull && Math.min(...cs.map((k) => k.l)) > Math.min(...before.map((k) => k.l)) + tol) return false;
      if (!bull && Math.max(...cs.map((k) => k.h)) < Math.max(...before.map((k) => k.h)) - tol) return false;
    }
    return true;
  };
}

/**
 * CANDLE_RULES[id](candles, i, ctx?) → boolean — pattern `id` completes on candle i.
 * ctx (optional): { trend: 'up'|'down'|'range' — the trend of the candles BEFORE the pattern's
 * first candle (default contextTrend(candles, i − n + 1)), avgRange — typical range before it }.
 */
export const CANDLE_RULES = Object.freeze(Object.fromEntries(CANDLE_PATTERN_IDS.map((id) => [id, makeRule(id)])));

/**
 * candleConfirm(id, patternCandles, dir) → price: the level the next candle must close beyond to
 * confirm the pattern (from its howToTrade text). dir (1 | −1) picks the side for neutral patterns.
 */
export function candleConfirm(id, cs, dir = 1) {
  const fn = CONFIRM[id];
  return fn && cs && cs.length ? fn(cs, dir) : null;
}
