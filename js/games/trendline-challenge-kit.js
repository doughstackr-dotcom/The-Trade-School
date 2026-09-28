// Trendline Challenge kit: trend-line geometry, grading and validated chart generators.
// Shared by js/games/trendline-challenge.js and js/lessons/trendlines.js. Pure module: no DOM,
// importable from node for offline sweeps.
//
// Conventions
// - A line is { a: { idx, price }, b: { idx, price } } in data space (idx may be fractional). It is
//   treated as a ray that starts at its left end and runs on to the right edge of the chart: a trend
//   line is projected forward, so a close through it anywhere after it starts counts.
// - dir 'up': an uptrend line sits UNDER price and joins rising swing lows. dir 'down' mirrors it
//   (above price, falling swing highs). Everything is computed for 'up' and mirrored for 'down'.
// - Touch: a swing low (pivot, 2 bars each side) whose candle the line meets between its low
//   (minus a tolerance) and the bottom of its body — wick-to-wick lines and body lines both count.
// - Violation: a candle CLOSE through the line (beyond a hair of rounding). A wick poking through
//   is not a violation (it is reported as a "wick cut").

import { fromPath, isValidCandle } from '../core/data.js';
import { trendOf } from '../core/indicators.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);

// ------------------------------------------------------------------------------------------ lines

/** Price of the (extended) line at idx. */
export function lineAt(line, idx) {
  const { a, b } = line;
  if (b.idx === a.idx) return a.price;
  return a.price + ((b.price - a.price) * (idx - a.idx)) / (b.idx - a.idx);
}

/** Price change per candle. */
export function slopeOf(line) {
  const d = line.b.idx - line.a.idx;
  return d === 0 ? 0 : (line.b.price - line.a.price) / d;
}

/** Left end of the line (where it starts). */
export const lineStart = (line) => Math.min(line.a.idx, line.b.idx);

/** Same line with its points ordered left → right. */
export function ordered(line) {
  return line.a.idx <= line.b.idx ? { a: { ...line.a }, b: { ...line.b } } : { a: { ...line.b }, b: { ...line.a } };
}

/** The line moved up/down by `d` (a parallel line). */
export function shiftLine(line, d) {
  return { a: { idx: line.a.idx, price: line.a.price + d }, b: { idx: line.b.idx, price: line.b.price + d } };
}

/** The part of the line between idx0 and idx1 (for drawing an extended line as a segment). */
export function span(line, idx0, idx1) {
  return { a: { idx: idx0, price: lineAt(line, idx0) }, b: { idx: idx1, price: lineAt(line, idx1) } };
}

function mirrorCandles(C, K) {
  return C.map((k) => ({ ...k, o: 2 * K - k.o, h: 2 * K - k.l, l: 2 * K - k.h, c: 2 * K - k.c }));
}
function mirrorLine(line, K) {
  return { a: { idx: line.a.idx, price: 2 * K - line.a.price }, b: { idx: line.b.idx, price: 2 * K - line.b.price } };
}
const mirrorPrice = (p, K) => 2 * K - p;

// ------------------------------------------------------------------------------------------ stats

/**
 * Chart statistics for the first n candles: average candle range, visible span and the grading
 * tolerances. tol ≈ a few pixels on a normal chart: the larger of 0.35 average ranges and 2.2% of
 * the price span shown.
 */
export function chartStats(C, n = C.length) {
  const m = Math.max(1, Math.min(n, C.length));
  let sum = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < m; i++) {
    const k = C[i];
    sum += k.h - k.l;
    if (k.l < lo) lo = k.l;
    if (k.h > hi) hi = k.h;
  }
  const avgRange = sum / m || 1e-6;
  const spanP = hi - lo || avgRange;
  return { n: m, avgRange, span: spanP, lo, hi, tol: Math.max(0.35 * avgRange, 0.022 * spanP), closeTol: 0.06 * avgRange };
}

/** Pivot swings in the first n candles (a low strictly below `left` bars before, ≤ `right` after). */
export function pivots(C, n = C.length, { left = 2, right = 2 } = {}) {
  const out = [];
  const m = Math.min(n, C.length);
  for (let i = left; i < m - right; i++) {
    let isH = true;
    let isL = true;
    for (let j = i - left; j < i; j++) {
      if (C[j].h >= C[i].h) isH = false;
      if (C[j].l <= C[i].l) isL = false;
    }
    for (let j = i + 1; j <= i + right; j++) {
      if (C[j].h > C[i].h) isH = false;
      if (C[j].l < C[i].l) isL = false;
    }
    if (isH) out.push({ idx: i, price: C[i].h, type: 'high' });
    if (isL) out.push({ idx: i, price: C[i].l, type: 'low' });
  }
  return out;
}

function mirrorPivots(piv, K) {
  return piv.map((p) => ({ idx: p.idx, price: 2 * K - p.price, type: p.type === 'high' ? 'low' : 'high' }));
}

/** Everything the grading needs about a chart, computed once. */
export function chartContext(C, n = C.length) {
  const st = chartStats(C, n);
  return { C, n: st.n, st, piv: pivots(C, st.n) };
}

// ------------------------------------------------------------------------------------------ evaluate

/** Core evaluation of a line that should sit BELOW price (a support-side line). */
function evalBelow(C, line, st, piv) {
  const n = st.n;
  const s = lineStart(line);
  const i0 = Math.max(0, Math.ceil(s - 0.5));
  const res = { start: s, i0, touches: [], violations: [], wicks: [], above: 0, below: 0 };
  const viol = new Set();
  for (let i = i0; i < n; i++) {
    const k = C[i];
    const L = lineAt(line, i);
    if (k.c >= L) res.above += 1;
    else res.below += 1;
    if (k.c < L - st.closeTol) {
      res.violations.push(i);
      viol.add(i);
    } else if (k.l < L - st.tol) res.wicks.push(i);
  }
  const lows = piv.filter((p) => p.type === 'low' && p.idx >= i0 && p.idx < n).sort((x, y) => x.idx - y.idx);
  for (const p of lows) {
    if (viol.has(p.idx)) continue;
    const k = C[p.idx];
    const L = lineAt(line, p.idx);
    if (L >= k.l - st.tol && L <= Math.max(k.l + st.tol, Math.min(k.o, k.c))) {
      const last = res.touches[res.touches.length - 1];
      if (last != null && p.idx - last < 3) continue;
      res.touches.push(p.idx);
    }
  }
  const tot = res.above + res.below;
  res.aboveFrac = tot ? res.above / tot : 0;
  res.sideOk = tot > 0 && res.aboveFrac >= 0.75;
  return res;
}

/**
 * evaluateSide(C, line, { side: 'below'|'above', st, piv }) → { start, touches, violations, wicks,
 * aboveFrac (share of closes on the correct side), sideOk, slope }. `side` = where the line should
 * sit relative to price.
 */
export function evaluateSide(C, line, { side = 'below', st, piv }) {
  const stats = st || chartStats(C);
  const pv = piv || pivots(C, stats.n);
  let res;
  if (side === 'above') {
    const K = C[0]?.c ?? 0;
    const st2 = { ...stats, lo: mirrorPrice(stats.hi, K), hi: mirrorPrice(stats.lo, K) };
    res = evalBelow(mirrorCandles(C.slice(0, stats.n), K), mirrorLine(line, K), st2, mirrorPivots(pv, K));
  } else res = evalBelow(C, line, stats, pv);
  res.side = side;
  res.slope = slopeOf(ordered(line));
  return res;
}

/**
 * evaluateLine(C, line, { dir: 'up'|'down', st, piv }) → evaluateSide(…) plus dir and slopeOk
 * (an uptrend line must rise, a downtrend line must fall) and length (in candles).
 */
export function evaluateLine(C, line, { dir = 'up', st, piv } = {}) {
  const res = evaluateSide(C, line, { side: dir === 'up' ? 'below' : 'above', st, piv });
  res.dir = dir;
  res.length = Math.abs(line.b.idx - line.a.idx);
  res.slopeOk = res.length >= 2 && (dir === 'up' ? res.slope > 0 : res.slope < 0);
  return res;
}

/**
 * scoreLine(ev, idealTouches) → { score 0–100, pass, verdict, T, V, W }
 *   70 points for touches (relative to the best line's touches), 30 for no closes through (−15 per
 *   close through, down to −40), −4 per extra wick cut (max −12). Wrong direction / wrong side /
 *   cutting through the middle of price caps the score at 15.
 * verdict: 'great' | 'good' | 'weak' | 'few-touches' | 'closes-through' | 'wrong-side' | 'through' |
 *          'direction' | 'short'
 */
export function scoreLine(ev, idealT = 3) {
  const T = ev.touches.length;
  const V = ev.violations.length;
  const W = ev.wicks.length;
  const Ti = Math.max(2, idealT || 2);
  const touchPts = (70 * Math.min(T, Ti)) / Ti;
  const cleanPts = Math.max(-40, 30 - 15 * V);
  const wickPen = Math.min(12, 4 * Math.max(0, W - 1));
  let score = Math.round(clamp(touchPts + cleanPts - wickPen, 0, 100));
  let verdict;
  if (ev.length < 2) verdict = 'short';
  else if (!ev.slopeOk) verdict = 'direction';
  else if (!ev.sideOk) verdict = ev.aboveFrac < 0.35 ? 'wrong-side' : 'through';
  else if (T < 2) verdict = 'few-touches';
  else if (V > 1) verdict = 'closes-through';
  else verdict = score >= 85 ? 'great' : 'good';
  if (['short', 'direction', 'wrong-side', 'through'].includes(verdict)) score = Math.min(score, 15);
  let pass = (verdict === 'great' || verdict === 'good') && score >= 55;
  if (!pass && (verdict === 'great' || verdict === 'good')) verdict = 'weak';
  if (!pass && verdict === 'weak') pass = false;
  return { score, pass, verdict, T, V, W };
}

function better(x, y) {
  // Fewer closes through, more touches, fewer wick cuts, longer line.
  if (!y) return true;
  if (x.violations.length !== y.violations.length) return x.violations.length < y.violations.length;
  if (x.touches.length !== y.touches.length) return x.touches.length > y.touches.length;
  if (x.wicks.length !== y.wicks.length) return x.wicks.length < y.wicks.length;
  return x.start < y.start;
}

/**
 * idealLine(C, { dir, st, piv, minGap = 4 }) → { line, ev, score } | null
 * The best trend line through two swing extremes: no closes through it if at all possible, then
 * the most touches, the fewest wick cuts and the longest reach. Anchored on the wick extremes.
 */
export function idealLine(C, { dir = 'up', st, piv, minGap = 4 } = {}) {
  const stats = st || chartStats(C);
  const pv = piv || pivots(C, stats.n);
  const type = dir === 'up' ? 'low' : 'high';
  const pts = pv.filter((p) => p.type === type && p.idx < stats.n).sort((x, y) => x.idx - y.idx);
  let best = null;
  let bestLine = null;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (pts[j].idx - pts[i].idx < minGap) continue;
      const line = { a: { idx: pts[i].idx, price: pts[i].price }, b: { idx: pts[j].idx, price: pts[j].price } };
      const ev = evaluateLine(C, line, { dir, st: stats, piv: pv });
      if (!ev.slopeOk || !ev.sideOk) continue;
      if (better(ev, best)) {
        best = ev;
        bestLine = line;
      }
    }
  }
  if (!best) return null;
  return { line: bestLine, ev: best, score: scoreLine(best, best.touches.length) };
}

/**
 * channelFor(C, line, { dir, st, piv }) → { line, offset, ev }
 * The channel line: parallel to the trend line through the most extreme opposite swing from the
 * line's start to the right edge (so no candle closes beyond it).
 */
export function channelFor(C, line, { dir = 'up', st, piv } = {}) {
  const stats = st || chartStats(C);
  const pv = piv || pivots(C, stats.n);
  const i0 = Math.max(0, Math.ceil(lineStart(line) - 0.5));
  let D = dir === 'up' ? -Infinity : Infinity;
  for (let i = i0; i < stats.n; i++) {
    const L = lineAt(line, i);
    if (dir === 'up') D = Math.max(D, C[i].h - L);
    else D = Math.min(D, C[i].l - L);
  }
  const ch = shiftLine(line, D);
  const ev = evaluateSide(C, ch, { side: dir === 'up' ? 'above' : 'below', st: stats, piv: pv });
  return { line: ch, offset: D, ev };
}

/**
 * evaluateChannel(C, base, point, { dir, st, piv }) → { line, offset, ev, sideRight, bonus 0–30 }
 * The player's channel line: parallel to THEIR trend line through the point they picked. Bonus:
 * 10 per touch (max 3) with no closes beyond it, 5 per touch with one, else 0.
 */
export function evaluateChannel(C, base, point, { dir = 'up', st, piv } = {}) {
  const D = point.price - lineAt(base, point.idx);
  const ch = shiftLine(base, D);
  const ev = evaluateSide(C, ch, { side: dir === 'up' ? 'above' : 'below', st, piv });
  const sideRight = dir === 'up' ? D > 0 : D < 0;
  const T = ev.touches.length;
  const V = ev.violations.length;
  let bonus = 0;
  if (sideRight && ev.sideOk) bonus = V === 0 ? 10 * Math.min(3, T) : V === 1 ? 5 * Math.min(3, T) : 0;
  return { line: ch, offset: D, ev, sideRight, bonus };
}

// ------------------------------------------------------------------------------------------ tests & outcomes

/**
 * readTells(C, line, t, { dir, st, touches }) — the textbook warning signs when price is back at an
 * established trend line on candle t (all judged from candles ≤ t):
 *   structure: +1 the last rally made a new high (higher high), −1 it failed (lower high), 0 about equal
 *   candle:    +1 the test candle rejected the line (long wick into it, close near the far end),
 *              −1 it closed weak (big body, close near the line end), 0 neither
 *   volume:    +1 volume dried up on the way to the line, −1 it swelled, 0 no difference / no data
 * read: 'hold' (sum > 0), 'break' (sum < 0) or 'mixed'. Signs are for dir 'up' semantics after
 * mirroring, so they mean the same for both directions.
 */
export function readTells(C, line, t, { dir = 'up', st, touches } = {}) {
  const stats = st || chartStats(C, t + 1);
  let cs = C;
  let ln = line;
  if (dir === 'down') {
    const K = C[0].c;
    cs = mirrorCandles(C.slice(0, t + 1), K);
    ln = mirrorLine(line, K);
  }
  const tl = (touches || []).filter((i) => i < t - 1).sort((x, y) => x - y);
  const out = { structure: 0, candle: 0, volume: 0, sum: 0, read: 'mixed', peakLast: null, peakPrev: null, contradict: false };
  if (tl.length < 2) return out;
  const last = tl[tl.length - 1];
  const prev = tl[tl.length - 2];
  const argmax = (a, b) => {
    let best = -1;
    for (let i = a; i <= b; i++) if (best < 0 || cs[i].h > cs[best].h) best = i;
    return best;
  };
  const pL = argmax(last + 1, t - 1);
  const pP = argmax(prev + 1, last - 1);
  if (pL < 0 || pP < 0) return out;
  out.peakLast = pL;
  out.peakPrev = pP;
  const aR = stats.avgRange;
  const diff = cs[pL].h - cs[pP].h;
  out.structure = diff >= 0.5 * aR ? 1 : diff <= -0.5 * aR ? -1 : 0;
  const k = cs[t];
  const r = k.h - k.l;
  if (r > 0) {
    const closePos = (k.c - k.l) / r;
    const lw = Math.min(k.o, k.c) - k.l;
    if (closePos >= 0.6 && lw >= 0.45 * r) out.candle = 1;
    else if (closePos <= 0.3 && k.c < k.o && k.o - k.c >= 0.5 * r) out.candle = -1;
  }
  const vol = (a, b) => {
    const v = [];
    for (let i = a; i <= b; i++) v.push(cs[i].v || 0);
    return mean(v);
  };
  const rally = vol(last + 1, pL);
  const approach = vol(pL + 1, t);
  if (rally > 0 && approach > 0) {
    const ratio = approach / rally;
    out.volume = ratio <= 0.8 ? 1 : ratio >= 1.25 ? -1 : 0;
    out.volumeRatio = ratio;
  }
  const parts = [out.structure, out.candle, out.volume];
  out.sum = parts.reduce((s, v) => s + v, 0);
  out.contradict = parts.includes(1) && parts.includes(-1);
  out.read = out.sum > 0 ? 'hold' : out.sum < 0 ? 'break' : 'mixed';
  out.lastTouch = last;
  out.prevTouch = prev;
  return out;
}

/**
 * outcomeAfter(C, line, t, { dir, st, bars = 12 }) → { broke, breakIdx, retestIdx, retestHeld, end,
 * endMove (in average ranges, positive = away from the line on the trend side) }
 * Break = the first close beyond the line by ≥ max(0.2 average ranges, closeTol). Retest = a later
 * candle that trades back to the line from the other side.
 */
export function outcomeAfter(C, line, t, { dir = 'up', st, bars = 12 } = {}) {
  const stats = st || chartStats(C, t + 1);
  let cs = C;
  let ln = line;
  if (dir === 'down') {
    const K = C[0].c;
    cs = mirrorCandles(C, K);
    ln = mirrorLine(line, K);
  }
  const end = Math.min(cs.length - 1, t + bars);
  const thr = Math.max(0.2 * stats.avgRange, stats.closeTol);
  let breakIdx = null;
  for (let i = t + 1; i <= end; i++) {
    if (cs[i].c < lineAt(ln, i) - thr) {
      breakIdx = i;
      break;
    }
  }
  let retestIdx = null;
  let retestHeld = null;
  if (breakIdx != null) {
    for (let i = breakIdx + 1; i <= end; i++) {
      if (cs[i].h >= lineAt(ln, i) - stats.tol) {
        retestIdx = i;
        break;
      }
    }
    if (retestIdx != null) {
      retestHeld = true;
      for (let i = retestIdx; i <= end; i++) if (cs[i].c > lineAt(ln, i) + stats.closeTol) retestHeld = false;
    }
  }
  return { broke: breakIdx != null, breakIdx, retestIdx, retestHeld, end, endMove: (cs[end].c - lineAt(ln, end)) / stats.avgRange };
}

/**
 * findTest(C, line, { dir, st, from, to }) → idx | null — the first candle in [from, to] that comes
 * back to the line (low within tol for an uptrend line) after at least 3 candles clear of it, and
 * has not closed through it.
 */
export function findTest(C, line, { dir = 'up', st, from, to } = {}) {
  const stats = st || chartStats(C);
  let cs = C;
  let ln = line;
  if (dir === 'down') {
    const K = C[0].c;
    cs = mirrorCandles(C, K);
    ln = mirrorLine(line, K);
  }
  const hi = Math.min(to ?? cs.length - 1, cs.length - 1);
  for (let i = Math.max(3, from ?? 0); i <= hi; i++) {
    const L = lineAt(ln, i);
    if (cs[i].l > L + stats.tol) continue;
    if (cs[i].c < L - stats.closeTol) return null; // it broke straight through: not a test
    let clear = true;
    for (let j = i - 3; j < i; j++) if (cs[j].l <= lineAt(ln, j) + stats.tol) clear = false;
    if (clear) return i;
  }
  return null;
}

// ------------------------------------------------------------------------------------------ generators

function finishCandles(C) {
  for (const k of C) {
    k.h = Math.max(k.h, k.o, k.c);
    k.l = Math.min(k.l, k.o, k.c);
  }
  return C;
}

/**
 * Up-trend path with rising swing lows ON a designed line (and, for channels, swing highs on a
 * parallel line). Returns the up-oriented scenario; makeTrendChart mirrors it for downtrends.
 */
function buildTrendUp(rng, { d, channel, n, K, S }) {
  const N = n;
  const g = S * rng.float(0.1, 0.19);
  const L = (i) => S + (g * i) / (N - 1);
  const A = S * rng.float(0.05, 0.075);
  const tolEst = 0.022 * (g + A * 1.2);
  const first = Math.round(N * rng.float(0.07, 0.12));
  const last = Math.round(N * rng.float(0.72, 0.8));
  const gap = (last - first) / (K - 1);
  const tIdx = [];
  for (let k = 0; k < K; k++) {
    const jit = k === 0 || k === K - 1 ? 0 : rng.float(-0.14, 0.14) * gap;
    tIdx.push(Math.round(first + k * gap + jit));
  }
  const hIdx = [];
  const H = [];
  for (let k = 0; k < K - 1; k++) {
    const g2 = tIdx[k + 1] - tIdx[k];
    hIdx.push(Math.round((tIdx[k] + tIdx[k + 1]) / 2 + rng.float(-0.12, 0.12) * g2));
    const Ak = channel ? A * (1 + rng.float(-0.012, 0.012)) : A * rng.float(0.72, 1.3);
    let hp = L(hIdx[k]) + Ak;
    if (k > 0 && hp < H[k - 1] + 0.2 * A) hp = H[k - 1] + 0.2 * A;
    H.push(hp);
  }
  const jitter = d >= 0.55;
  const tP = tIdx.map((i, k) => L(i) + (jitter && k > 0 ? rng.float(-0.3, 0.3) * tolEst : 0));
  const pts = [[0, L(0) + A * rng.float(0.5, 0.8)]];
  const minor = [];
  for (let k = 0; k < K; k++) {
    pts.push([tIdx[k], tP[k]]);
    // A decisive move away from the line after each touch (a slow drift would let the rising
    // line catch up with price and blur the touch).
    const nextIdx = k < K - 1 ? hIdx[k] : N - 1;
    let lift = null;
    if (nextIdx - (tIdx[k] + 4) >= 4) {
      lift = tIdx[k] + 4;
      pts.push([lift, L(lift) + A * rng.float(0.3, 0.4)]);
    }
    if (k < K - 1) {
      const leg = hIdx[k] - tIdx[k];
      const m1 = Math.max((lift ?? tIdx[k]) + 4, tIdx[k] + Math.round(leg * rng.float(0.4, 0.48)));
      const m2 = m1 + 4;
      if (d >= 0.3 && hIdx[k] - m2 >= 4 && rng.chance(0.35 + 0.4 * d)) {
        const top = L(m1) + A * rng.float(0.55, 0.66);
        const dip = L(m2) + A * rng.float(0.36, 0.44);
        pts.push([m1, top], [m2, dip]);
        minor.push(m2);
      }
      pts.push([hIdx[k], H[k]]);
    }
  }
  pts.push([N - 1, L(N - 1) + A * rng.float(0.5, 0.72)]);
  pts.sort((x, y) => x[0] - y[0]);
  const { candles } = fromPath(pts.map(([i, p]) => [i / (N - 1), p]), {
    seed: rng.int(1, 2 ** 31 - 1), count: N, noise: 0.2 + 0.45 * d, wick: 0.45 + 0.35 * d,
  });
  const line = { a: { idx: tIdx[0], price: L(tIdx[0]) }, b: { idx: tIdx[K - 1], price: L(tIdx[K - 1]) } };
  let spike = null;
  if (d >= 0.65 && K >= 3 && rng.chance(0.5)) {
    const st = chartStats(candles, N);
    const k = rng.int(1, K - 2);
    const i = tIdx[k];
    candles[i].l = Math.min(candles[i].l, L(i) - st.tol * rng.float(1.5, 2.1));
    spike = i;
  }
  return { candles, N, line, touches: tIdx, highs: hIdx, amp: A, spike, minor, S };
}

/**
 * makeTrendChart(rng, { dir = 'up', difficulty = 0.5, channel = false, n, touches })
 *   → { candles, n, dir, line (designed = ideal), ideal, channel?: { line, offset, ev }, st, piv,
 *       touches (idx), spike (idx|null), difficulty, tries }
 * A textbook trending chart for drawing: 3–4 swing lows (highs in a downtrend) on one straight
 * line, validated: trendOf() agrees, the best line found by idealLine() is the designed one with
 * ≥ 3 touches and no closes through, no stray wick cuts (except a deliberate spike at high
 * difficulty) and, for channels, ≥ 2 touches on the parallel line. Generate-and-test with forked
 * seeds (30 tries), then a calm hand-tuned fallback.
 */
export function makeTrendChart(rng, { dir = 'up', difficulty = 0.5, channel = false, n = null, touches = null } = {}) {
  const d = clamp(difficulty, 0, 1);
  const N = n || 58 + Math.round(22 * d);
  let last = null;
  const attempt = (r, dd, calm) => {
    const K = touches || (dd < 0.3 || calm ? 4 : r.chance(0.5) ? 3 : 4);
    const S = Math.round(r.float(70, 135));
    const up = buildTrendUp(r, { d: dd, channel, n: N, K, S });
    let C = finishCandles(up.candles);
    let line = up.line;
    if (dir === 'down') {
      C = mirrorCandles(C, S);
      line = mirrorLine(line, S);
    }
    const sc = { candles: C, n: N, dir, line, touches: up.touches, spike: up.spike, difficulty: d, amp: up.amp };
    last = sc;
    return validateTrend(sc, { channel, K }) ? sc : null;
  };
  for (let t = 0; t < 30; t++) {
    const sc = attempt(rng.fork(`trend-${t}`), d, false);
    if (sc) return { ...sc, tries: t + 1 };
  }
  for (let t = 0; t < 30; t++) {
    const sc = attempt(rng.fork(`calm-${t}`), Math.min(d, 0.2), true);
    if (sc) return { ...sc, tries: 31 + t, calm: true };
  }
  // Should never happen (the calm path validates on every seed tested); keep whatever we have.
  const ctx = chartContext(last.candles, last.n);
  return { ...last, ...ctx, ideal: idealLine(last.candles, { dir, st: ctx.st, piv: ctx.piv }), tries: 61, unvalidated: true };
}

function validateTrend(sc, { channel, K }) {
  const { candles: C, n, dir } = sc;
  if (!C.every(isValidCandle)) return false;
  if (trendOf(C.slice(0, n)) !== dir) return false;
  const ctx = chartContext(C, n);
  const { st, piv } = ctx;
  const ideal = idealLine(C, { dir, st, piv });
  if (!ideal) return false;
  const ev = ideal.ev;
  if (ev.violations.length || ev.touches.length < Math.min(3, K)) return false;
  if (ev.wicks.length > (sc.spike != null ? 1 : 0)) return false;
  // The ideal must be the designed line (within a fraction of the tolerance), starting at touch 1.
  if (Math.abs(ideal.line.a.idx - sc.touches[0]) > 1) return false;
  for (let i = sc.touches[0]; i < n; i++) if (Math.abs(lineAt(ideal.line, i) - lineAt(sc.line, i)) > 0.5 * st.tol) return false;
  // The designed line itself is clean too.
  const dev = evaluateLine(C, sc.line, { dir, st, piv });
  if (dev.violations.length || dev.touches.length < Math.min(3, K)) return false;
  // Price starts on the trend side: the first close is not far through the extended line.
  const ch = channelFor(C, ideal.line, { dir, st, piv });
  if (channel && ch.ev.touches.length < 2) return false;
  if (channel && ch.ev.violations.length) return false;
  sc.ideal = ideal;
  sc.channel = channel ? ch : null;
  sc.st = st;
  sc.piv = piv;
  sc.idealChannel = ch;
  return true;
}

/**
 * Hold-or-break scenario (up-oriented): an established line with three touches, a rally, a
 * return to the line on candle tt (the decision candle, the last one shown), then `after` hidden
 * candles. The tells (structure, test candle, volume) are designed to agree with the outcome;
 * `neutral` names one tell to leave neutral (harder rounds).
 */
function buildHoldBreakUp(rng, { d, outcome, n, after, neutral, S }) {
  const N = n + after;
  const tt = n - 1;
  const g = S * rng.float(0.055, 0.085);
  const L = (i) => S + (g * i) / (n - 1);
  const A = S * rng.float(0.08, 0.1);
  const t1 = Math.round(n * rng.float(0.08, 0.11));
  const t3 = Math.round(n * rng.float(0.54, 0.58));
  const t2 = Math.round((t1 + t3) / 2 + rng.float(-0.06, 0.06) * (t3 - t1));
  const h1 = Math.round((t1 + t2) / 2 + rng.float(1, 2.5));
  const h2 = Math.round((t2 + t3) / 2 + rng.float(1, 2.5));
  const h3 = Math.round(t3 + (tt - t3) * rng.float(0.4, 0.48));
  const H1 = L(h1) + A * rng.float(0.9, 1.08);
  const H2 = Math.max(L(h2) + A * rng.float(0.9, 1.08), H1 + 0.25 * A);
  const hold = outcome === 'hold';
  let H3;
  if (neutral === 'structure') H3 = H2 + A * rng.float(-0.025, 0.025);
  else if (hold) H3 = H2 + A * rng.float(0.2, 0.32);
  else H3 = H2 - A * rng.float(0.15, 0.24);
  const lift = (i) => [i + 4, L(i + 4) + A * rng.float(0.32, 0.42)];
  const pts = [
    [0, L(0) + A * rng.float(0.5, 0.75)],
    [t1, L(t1)], lift(t1), [h1, H1], [t2, L(t2)], lift(t2), [h2, H2], [t3, L(t3)], lift(t3), [h3, H3],
    [tt - 4, L(tt - 4) + A * (hold ? rng.float(0.2, 0.26) : rng.float(0.3, 0.36))],
  ];
  if (hold) {
    pts.push([tt, L(tt)]);
    pts.push([N - 1, L(N - 1) + A * rng.float(0.85, 1.1)]);
  } else {
    pts.push([tt, L(tt) + A * 0.03]);
    pts.push([tt + 2, L(tt + 2) - A * rng.float(0.36, 0.45)]);
    pts.push([tt + 6, L(tt + 6) - A * rng.float(0.02, 0.05)]);
    pts.push([N - 1, L(N - 1) - A * rng.float(0.75, 0.95)]);
  }
  const { candles: C } = fromPath(pts.map(([i, p]) => [i / (N - 1), p]), {
    seed: rng.int(1, 2 ** 31 - 1), count: N, noise: 0.2 + 0.3 * d, wick: 0.45 + 0.25 * d, volume: false,
  });
  finishCandles(C);
  const st0 = chartStats(C, n);
  const aR = st0.avgRange;
  const Lt = L(tt);
  // Candle before the test: approaching from above, clear of the line.
  const p = C[tt - 1];
  const cand = neutral === 'candle' ? 'neutral' : hold ? 'reject' : 'weak';
  if (cand === 'reject') p.c = Lt + aR * rng.float(0.8, 1.05);
  else if (cand === 'weak') p.c = Lt + aR * rng.float(1.0, 1.3);
  else p.c = Lt + aR * rng.float(0.5, 0.7);
  p.h = Math.max(p.h, p.o, p.c);
  p.l = Math.min(p.o, p.c) - aR * rng.float(0.03, 0.12);
  // The test candle.
  const k = C[tt];
  k.o = p.c;
  if (cand === 'reject') {
    k.l = Lt - st0.tol * rng.float(0.05, 0.4);
    k.c = k.o + aR * rng.float(0.06, 0.2);
    k.h = k.c + aR * rng.float(0.04, 0.14);
  } else if (cand === 'weak') {
    k.c = Lt + aR * rng.float(0.05, 0.14);
    k.l = k.c - aR * rng.float(0.02, 0.07);
    k.h = k.o + aR * rng.float(0.02, 0.09);
  } else {
    k.c = k.o - aR * rng.float(0.12, 0.22);
    k.l = Lt + st0.tol * rng.float(0.05, 0.35);
    k.h = k.o + aR * rng.float(0.2, 0.3);
  }
  // Continuity into the hidden candles.
  const q = C[tt + 1];
  q.o = k.c;
  if (hold) q.c = Math.max(q.c, k.h + aR * rng.float(0.1, 0.35));
  finishCandles([p, k, q]);
  // Volume: a clear story on the approach, generic elsewhere.
  const V0 = 1000 * rng.float(0.8, 1.2);
  for (let i = 0; i < N; i++) {
    const body = Math.abs(C[i].c - C[i].o) / aR;
    C[i].v = Math.round(V0 * rng.float(0.8, 1.1) * (0.8 + 0.3 * Math.min(2, body)));
  }
  const approachF = neutral === 'volume' ? rng.float(0.97, 1.03) : hold ? rng.float(0.5, 0.62) : rng.float(1.5, 1.8);
  for (let i = t3 + 1; i <= h3; i++) C[i].v = Math.round(V0 * rng.float(0.95, 1.1));
  for (let i = h3 + 1; i <= tt; i++) C[i].v = Math.round(V0 * approachF * rng.float(0.93, 1.07));
  if (!hold) {
    C[tt + 1].v = Math.round(V0 * rng.float(1.9, 2.3));
    C[tt + 2].v = Math.round(V0 * rng.float(1.4, 1.7));
  } else {
    C[tt + 1].v = Math.round(V0 * rng.float(1.2, 1.4));
  }
  const line = { a: { idx: t1, price: L(t1) }, b: { idx: t3, price: L(t3) } };
  return { candles: C, n, N, tt, line, touches: [t1, t2, t3], peaks: [h1, h2, h3], amp: A, S };
}

/**
 * makeHoldBreak(rng, { dir, outcome: 'hold'|'break', difficulty, after = 12, confirm = false })
 *   → { candles (n + after), n (shown, the test candle is n − 1), t, dir, outcome, line, touches,
 *       tells, result (outcomeAfter), st, piv, neutral }
 * Validated: the established line is the best line on the shown candles (3 touches, no closes
 * through, nothing touching it between the third touch and the test), the tells read exactly as
 * designed (all three agree below difficulty 0.5; above it one is neutral, none contradicts), and
 * the hidden candles do what the outcome says — a hold never closes through and moves away; a
 * break closes through within two candles, retests the line from the other side and continues.
 * confirm: the candle after a hold closes above the test candle's high (for trade walk-throughs).
 */
export function makeHoldBreak(rng, { dir = 'up', outcome = 'hold', difficulty = 0.5, after = 12, confirm = false, n = null } = {}) {
  const d = clamp(difficulty, 0, 1);
  const N0 = n || 60 + Math.round(10 * d);
  let last = null;
  for (let t = 0; t < 60; t++) {
    const r = rng.fork(`hb-${t}`);
    const calm = t >= 30;
    const dd = calm ? Math.min(d, 0.2) : d;
    const neutral = !calm && dd >= 0.5 ? r.pick(['structure', 'candle', 'volume']) : null;
    const S = Math.round(r.float(70, 135));
    const up = buildHoldBreakUp(r, { d: dd, outcome, n: N0, after, neutral, S });
    let C = up.candles;
    let line = up.line;
    if (dir === 'down') {
      C = mirrorCandles(C, S);
      line = mirrorLine(line, S);
    }
    const sc = { candles: C, n: N0, t: up.tt, dir, outcome, line, touches: up.touches, neutral, difficulty: d, amp: up.amp };
    last = sc;
    if (validateHoldBreak(sc, { confirm })) return { ...sc, tries: t + 1 };
  }
  const ctx = chartContext(last.candles, last.n);
  return { ...last, ...ctx, tells: readTells(last.candles, last.line, last.t, { dir, st: ctx.st, touches: last.touches }), result: outcomeAfter(last.candles, last.line, last.t, { dir, st: ctx.st }), unvalidated: true };
}

function validateHoldBreak(sc, { confirm }) {
  const { candles: C, n, t, dir, outcome } = sc;
  if (!C.every(isValidCandle)) return false;
  const { st, piv } = chartContext(C, n);
  const ideal = idealLine(C, { dir, st, piv });
  if (!ideal || ideal.ev.violations.length || ideal.ev.touches.length < 3) return false;
  for (let i = sc.touches[0]; i < n; i++) if (Math.abs(lineAt(ideal.line, i) - lineAt(sc.line, i)) > 0.5 * st.tol) return false;
  const ev = evaluateLine(C, sc.line, { dir, st, piv });
  if (ev.violations.length || ev.touches.length < 3 || ev.wicks.length) return false;
  // Nothing touches the line between the third touch and the test candle.
  const t3 = sc.touches[2];
  const up = dir === 'up';
  for (let i = t3 + 3; i < t; i++) {
    const L = lineAt(sc.line, i);
    if (up ? C[i].l <= L + st.tol : C[i].h >= L - st.tol) return false;
  }
  // The test candle is at the line and has not closed through it.
  const Lt = lineAt(sc.line, t);
  if (up ? C[t].l > Lt + st.tol || C[t].c < Lt : C[t].h < Lt - st.tol || C[t].c > Lt) return false;
  const tells = readTells(C, sc.line, t, { dir, st, touches: sc.touches });
  const want = outcome === 'hold' ? 1 : -1;
  const parts = { structure: tells.structure, candle: tells.candle, volume: tells.volume };
  for (const [key, v] of Object.entries(parts)) {
    if (key === sc.neutral) {
      if (v !== 0) return false;
    } else if (v !== want) return false;
  }
  const result = outcomeAfter(C, sc.line, t, { dir, st, bars: C.length - 1 - t });
  if (outcome === 'hold') {
    if (result.broke || result.endMove < 1.5) return false;
    // The bounce: no close back at the line either.
    for (let i = t + 1; i < C.length; i++) {
      const L = lineAt(sc.line, i);
      if (up ? C[i].c < L + st.closeTol : C[i].c > L - st.closeTol) return false;
    }
    if (confirm && !(up ? C[t + 1].c > C[t].h : C[t + 1].c < C[t].l)) return false;
  } else {
    if (!result.broke || result.breakIdx > t + 2) return false;
    if (result.retestIdx == null || !result.retestHeld) return false;
    if (result.endMove > -1.5) return false;
  }
  sc.tells = tells;
  sc.result = result;
  sc.st = st;
  sc.piv = piv;
  sc.ideal = ideal;
  return true;
}

/**
 * makeSteepChart(rng, { n = 72 }) → { candles, n, steep: line, moderate: line, breakIdx, touches }
 * Lesson helper: an uptrend whose first two lows make a steep line that price soon closes
 * through, while a moderate line from the same first low through the later lows holds.
 */
export function makeSteepChart(rng, { n = 72 } = {}) {
  let last = null;
  for (let t = 0; t < 40; t++) {
    const r = rng.fork(`steep-${t}`);
    const S = Math.round(r.float(80, 120));
    const N = n;
    const g = S * r.float(0.11, 0.15);
    const M = (i) => S + (g * i) / (N - 1);
    const A = S * r.float(0.06, 0.075);
    const t1 = Math.round(N * 0.08);
    const t2 = Math.round(N * r.float(0.27, 0.31));
    const t3 = Math.round(N * r.float(0.55, 0.6));
    const t4 = Math.round(N * r.float(0.8, 0.84));
    const lift = A * r.float(0.55, 0.7); // t2 sits well above the moderate line → a steep line
    const h1 = Math.round((t1 + t2) / 2);
    const h2 = Math.round((t2 + t3) / 2);
    const h3 = Math.round((t3 + t4) / 2);
    const P2 = M(t2) + lift;
    const pts = [
      [0, M(0) + A * 0.6], [t1, M(t1)], [h1, M(h1) + A * 1.15], [t2, P2], [h2, M(h2) + lift + A * 1.1],
      [t3, M(t3)], [h3, M(h3) + A * 1.05], [t4, M(t4)], [N - 1, M(N - 1) + A * 0.7],
    ];
    const { candles } = fromPath(pts.map(([i, p]) => [i / (N - 1), p]), { seed: r.int(1, 2 ** 31 - 1), count: N, noise: 0.25, wick: 0.5 });
    finishCandles(candles);
    const steep = { a: { idx: t1, price: M(t1) }, b: { idx: t2, price: P2 } };
    const moderate = { a: { idx: t1, price: M(t1) }, b: { idx: t4, price: M(t4) } };
    const ctx = chartContext(candles, N);
    const evS = evaluateLine(candles, steep, { dir: 'up', st: ctx.st, piv: ctx.piv });
    const evM = evaluateLine(candles, moderate, { dir: 'up', st: ctx.st, piv: ctx.piv });
    last = { candles, n: N, steep, moderate, breakIdx: evS.violations[0] ?? null, touches: [t1, t2, t3, t4], evS, evM, ...ctx };
    if (!candles.every(isValidCandle)) continue;
    if (evM.violations.length || evM.touches.length < 3 || evM.wicks.length) continue;
    if (!evS.violations.length || evS.touches.length < 2) continue;
    // The steep line holds until after its second touch, then breaks before the third moderate touch.
    if (evS.violations[0] <= t2 + 2 || evS.violations[0] >= t3) continue;
    if (trendOf(candles) !== 'up') continue;
    return last;
  }
  return last;
}

/**
 * realTrend(round) → { candles, n, dir, st, piv, ideal, after } | null
 * Adapter for a scanner trend-up / trend-down round: the chart is shown up to the decision candle
 * (where the trend was confirmed) and the ideal line is computed from the real swings on those
 * candles. null when no usable line exists (fewer than two touches).
 */
export function realTrend(r) {
  if (!r || !Array.isArray(r.candles) || !r.setup) return null;
  const dir = r.setup.kind === 'trend-down' ? 'down' : 'up';
  // Start a few candles before the scanner's trend window, so an earlier move in the other
  // direction does not muddy the picture.
  const off = Math.max(0, Math.min(r.decisionIdx - 30, (r.setup.start ?? 0) - 4));
  const candles = r.candles.slice(off);
  const n = Math.min(candles.length, r.decisionIdx + 1 - off);
  const ctx = chartContext(candles, n);
  const ideal = idealLine(candles, { dir, st: ctx.st, piv: ctx.piv });
  if (!ideal || ideal.ev.touches.length < 2) return null;
  return { candles, n, dir, ...ctx, ideal, after: candles.length - n, offset: off };
}

/**
 * realHoldBreak(round, { bars = 10 }) → { candles, n (shown through the test), t, dir, line, touches,
 *   tells, result, st, piv, real: true } | null
 * From a real trend window: every candle from late in the trend on is a candidate test; for each,
 * the best line is fitted on the candles before it (≥ 2 touches, no closes through), and the
 * candle must come back to that line without closing through it, with ≥ 8 candles left to show
 * what happened. Prefers lines with three or more touches and tests whose tells are not mixed.
 */
export function realHoldBreak(r, { bars = 10 } = {}) {
  const base = realTrend(r);
  if (!base) return null;
  const { candles, dir } = base;
  const last = candles.length - 1 - Math.min(bars, 8);
  let best = null;
  const rank = (c) => (c.tells.read !== 'mixed' && !c.tells.contradict ? 2 : 0) + (c.touches.length >= 3 ? 1 : 0);
  for (let t = Math.max(24, base.n - 12); t <= last; t++) {
    const ctx = chartContext(candles, t - 1);
    const ideal = idealLine(candles, { dir, st: ctx.st, piv: ctx.piv });
    if (!ideal || ideal.ev.violations.length || ideal.ev.touches.length < 2) continue;
    if (findTest(candles, ideal.line, { dir, st: ctx.st, from: t, to: t }) !== t) continue;
    const shown = chartContext(candles, t + 1);
    const ev = evaluateLine(candles, ideal.line, { dir, st: shown.st, piv: shown.piv });
    if (ev.violations.length) continue;
    const touches = ev.touches.filter((i) => i < t - 1);
    if (touches.length < 2) continue;
    const tells = readTells(candles, ideal.line, t, { dir, st: shown.st, touches });
    const result = outcomeAfter(candles, ideal.line, t, { dir, st: shown.st, bars: Math.min(bars, candles.length - 1 - t) });
    const cand = { candles, n: t + 1, t, dir, line: ideal.line, touches, tells, result, st: shown.st, piv: shown.piv, real: true };
    if (!best || rank(cand) > rank(best)) best = cand;
    if (rank(best) === 3) break;
    t += 2; // the next few candles belong to the same test
  }
  return best;
}
