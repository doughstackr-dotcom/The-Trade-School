// Technical indicators. Series functions return arrays aligned with the input (same length)
// with null during warm-up. Pure module (no DOM).

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const closes = (candles) => candles.map((c) => c.c);
export const highs = (candles) => candles.map((c) => c.h);
export const lows = (candles) => candles.map((c) => c.l);
export const opens = (candles) => candles.map((c) => c.o);
export const volumes = (candles) => candles.map((c) => c.v ?? 0);

/** Simple moving average; a window containing null yields null. */
export function sma(values, period) {
  const n = values.length;
  const out = new Array(n).fill(null);
  const p = Math.max(1, Math.floor(period));
  let sum = 0;
  let valid = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (isNum(v)) {
      sum += v;
      valid++;
    }
    if (i >= p) {
      const old = values[i - p];
      if (isNum(old)) {
        sum -= old;
        valid--;
      }
    }
    if (i >= p - 1 && valid === p) out[i] = sum / p;
  }
  return out;
}

/**
 * Exponential moving average, k = 2 / (period + 1), seeded with the SMA of the first `period`
 * values. Leading nulls are skipped (so EMA of a warm-up series such as the MACD line works).
 */
export function ema(values, period) {
  const n = values.length;
  const out = new Array(n).fill(null);
  const p = Math.max(1, Math.floor(period));
  const k = 2 / (p + 1);
  let first = 0;
  while (first < n && !isNum(values[first])) first++;
  if (first + p > n) return out;
  let sum = 0;
  for (let i = first; i < first + p; i++) {
    if (!isNum(values[i])) return out;
    sum += values[i];
  }
  let prev = sum / p;
  out[first + p - 1] = prev;
  for (let i = first + p; i < n; i++) {
    const v = values[i];
    if (!isNum(v)) {
      out[i] = prev;
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothed moving average (RMA), seeded with the SMA of the first `period` values. */
export function rma(values, period) {
  const n = values.length;
  const out = new Array(n).fill(null);
  const p = Math.max(1, Math.floor(period));
  let first = 0;
  while (first < n && !isNum(values[first])) first++;
  if (first + p > n) return out;
  let sum = 0;
  for (let i = first; i < first + p; i++) {
    if (!isNum(values[i])) return out;
    sum += values[i];
  }
  let prev = sum / p;
  out[first + p - 1] = prev;
  for (let i = first + p; i < n; i++) {
    prev = (prev * (p - 1) + (isNum(values[i]) ? values[i] : prev)) / p;
    out[i] = prev;
  }
  return out;
}

/**
 * RSI with Wilder smoothing. The first value (index `period`) uses the simple average of the
 * first `period` gains and losses; later values use avg = (prev * (n - 1) + current) / n.
 */
export function rsi(closeValues, period = 14) {
  const n = closeValues.length;
  const out = new Array(n).fill(null);
  const p = Math.max(1, Math.floor(period));
  if (n <= p) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= p; i++) {
    const d = closeValues[i] - closeValues[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / p;
  let avgL = loss / p;
  const value = () => (avgL === 0 ? (avgG === 0 ? 50 : 100) : 100 - 100 / (1 + avgG / avgL));
  out[p] = value();
  for (let i = p + 1; i < n; i++) {
    const d = closeValues[i] - closeValues[i - 1];
    avgG = (avgG * (p - 1) + (d > 0 ? d : 0)) / p;
    avgL = (avgL * (p - 1) + (d < 0 ? -d : 0)) / p;
    out[i] = value();
  }
  return out;
}

/** MACD line = EMA(fast) − EMA(slow); signal = EMA(signal) of the MACD line; hist = macd − signal. */
export function macd(closeValues, fast = 12, slow = 26, signal = 9) {
  const ef = ema(closeValues, fast);
  const es = ema(closeValues, slow);
  const line = closeValues.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const sig = ema(line, signal);
  const hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null));
  return { macd: line, signal: sig, hist };
}

/** Bollinger Bands: SMA ± mult × population standard deviation; width = (upper − lower) / mid. */
export function bollinger(closeValues, period = 20, mult = 2) {
  const n = closeValues.length;
  const mid = sma(closeValues, period);
  const upper = new Array(n).fill(null);
  const lower = new Array(n).fill(null);
  const width = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (mid[i] == null) continue;
    let ss = 0;
    for (let j = i - period + 1; j <= i; j++) ss += (closeValues[j] - mid[i]) ** 2;
    const sd = Math.sqrt(ss / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
    width[i] = mid[i] !== 0 ? (upper[i] - lower[i]) / mid[i] : null;
  }
  return { mid, upper, lower, width };
}

/** True range series (first bar: high − low). */
export function trueRange(candles) {
  return candles.map((c, i) => {
    if (i === 0) return c.h - c.l;
    const pc = candles[i - 1].c;
    return Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
  });
}

/** Average True Range, Wilder smoothing; first value at index period − 1 = mean of first TRs. */
export function atr(candles, period = 14) {
  return rma(trueRange(candles), period);
}

/**
 * Pivot swings. A swing high at i has a high strictly above the `left` previous highs and at
 * least as high as the `right` following highs (lows symmetric). Ordered by idx.
 * { alternate: true } merges consecutive same-type swings (keeps the more extreme one).
 */
export function swings(candles, { left = 3, right = 3, alternate = false } = {}) {
  const out = [];
  const n = candles.length;
  for (let i = left; i < n - right; i++) {
    const h = candles[i].h;
    const l = candles[i].l;
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j < i && (isHigh || isLow); j++) {
      if (candles[j].h >= h) isHigh = false;
      if (candles[j].l <= l) isLow = false;
    }
    for (let j = i + 1; j <= i + right && (isHigh || isLow); j++) {
      if (candles[j].h > h) isHigh = false;
      if (candles[j].l < l) isLow = false;
    }
    if (isHigh) out.push({ idx: i, price: h, type: 'high' });
    if (isLow) out.push({ idx: i, price: l, type: 'low' });
  }
  if (!alternate) return out;
  const alt = [];
  for (const s of out) {
    const last = alt[alt.length - 1];
    if (last && last.type === s.type) {
      if ((s.type === 'high' && s.price > last.price) || (s.type === 'low' && s.price < last.price)) alt[alt.length - 1] = s;
    } else alt.push(s);
  }
  return alt;
}

/** Label swings HH/LH (highs vs previous high) and HL/LL (lows vs previous low); first: H / L. */
export function labelStructure(swingList) {
  let lastH = null;
  let lastL = null;
  return swingList.map((s) => {
    let label;
    if (s.type === 'high') {
      label = lastH == null ? 'H' : s.price > lastH ? 'HH' : 'LH';
      lastH = s.price;
    } else {
      label = lastL == null ? 'L' : s.price < lastL ? 'LL' : 'HL';
      lastL = s.price;
    }
    return { ...s, label };
  });
}

/**
 * linearRegression(points) → { slope, intercept, r2 }
 * points: [[x, y]] or [{ x, y }] or [{ idx, price }]; a plain number array uses x = index.
 */
export function linearRegression(points) {
  const xs = [];
  const ys = [];
  points.forEach((p, i) => {
    let x;
    let y;
    if (Array.isArray(p)) [x, y] = p;
    else if (typeof p === 'number') [x, y] = [i, p];
    else if (p) {
      x = p.x ?? p.idx;
      y = p.y ?? p.price;
    }
    if (isNum(x) && isNum(y)) {
      xs.push(x);
      ys.push(y);
    }
  });
  const n = xs.length;
  if (n === 0) return { slope: 0, intercept: 0, r2: 0 };
  if (n === 1) return { slope: 0, intercept: ys[0], r2: 0 };
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

/**
 * trendOf(candles) → 'up' | 'down' | 'range'
 * Combines swing structure (last two highs and lows) with the regression slope of closes
 * measured in ATRs over the window.
 */
export function trendOf(candles) {
  const n = candles.length;
  if (n < 5) {
    if (n < 2) return 'range';
    const d = candles[n - 1].c - candles[0].c;
    const r = candles.reduce((s, c) => s + (c.h - c.l), 0) / n || 1;
    return d > r ? 'up' : d < -r ? 'down' : 'range';
  }
  const cl = closes(candles);
  const { slope } = linearRegression(cl);
  const avgRange = candles.reduce((s, c) => s + (c.h - c.l), 0) / n || 1;
  const drift = (slope * (n - 1)) / avgRange; // total regression move in average candle ranges
  const lr = Math.max(1, Math.min(3, Math.floor(n / 12)));
  const sw = labelStructure(swings(candles, { left: lr, right: lr, alternate: true }));
  const hs = sw.filter((s) => s.type === 'high').slice(-2);
  const ls = sw.filter((s) => s.type === 'low').slice(-2);
  let score = 0;
  if (hs.length === 2) score += hs[1].price > hs[0].price ? 1 : -1;
  if (ls.length === 2) score += ls[1].price > ls[0].price ? 1 : -1;
  if (drift > 2.5 && score >= 0) return 'up';
  if (drift < -2.5 && score <= 0) return 'down';
  if (score === 2 && drift > 1) return 'up';
  if (score === -2 && drift < -1) return 'down';
  if (drift > 5) return 'up';
  if (drift < -5) return 'down';
  return 'range';
}

/**
 * supportResistance(candles, { tolerance = 0.006, minTouches = 2, left = 2, right = 2 })
 * → [{ price, touches, type: 'support'|'resistance'|'both', firstIdx, lastIdx, score }] strongest first.
 * Swing highs and lows are clustered when within `tolerance` (fraction of price) of the cluster
 * average. Levels made only of swing highs are resistance, only lows support, mixed 'both'
 * (role reversal). Ranked by touches, with a bonus for recent touches.
 */
export function supportResistance(candles, { tolerance = 0.006, minTouches = 2, left = 2, right = 2 } = {}) {
  const n = candles.length;
  if (!n) return [];
  const pts = swings(candles, { left, right }).sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const s of pts) {
    const cl = clusters[clusters.length - 1];
    if (cl && Math.abs(s.price - cl.sum / cl.members.length) / (cl.sum / cl.members.length) <= tolerance) {
      cl.members.push(s);
      cl.sum += s.price;
    } else clusters.push({ members: [s], sum: s.price });
  }
  const out = [];
  for (const cl of clusters) {
    const touches = cl.members.length;
    if (touches < minTouches) continue;
    const price = cl.sum / touches;
    const hasHigh = cl.members.some((m) => m.type === 'high');
    const hasLow = cl.members.some((m) => m.type === 'low');
    const idxs = cl.members.map((m) => m.idx);
    const firstIdx = Math.min(...idxs);
    const lastIdx = Math.max(...idxs);
    const score = touches + (lastIdx / Math.max(1, n - 1)) * 1.5 + (hasHigh && hasLow ? 0.5 : 0);
    out.push({ price, touches, type: hasHigh && hasLow ? 'both' : hasHigh ? 'resistance' : 'support', firstIdx, lastIdx, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * fibLevels(from, to, ratios) → [{ ratio, price }]
 * from = swing start price, to = swing end price. Retracement ratio r → price = to − (to − from) × r
 * (0 = the swing end, 1 = back at the swing start).
 */
export function fibLevels(from, to, ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]) {
  return ratios.map((ratio) => ({ ratio, price: to - (to - from) * ratio }));
}

/**
 * fibExtensions(from, to, ratios) → [{ ratio, price }]
 * Projects the swing beyond its end: price = from + (to − from) × ratio (1.618 = 161.8% of the swing).
 */
export function fibExtensions(from, to, ratios = [1.272, 1.618, 2.618]) {
  return ratios.map((ratio) => ({ ratio, price: from + (to - from) * ratio }));
}

/**
 * fibProjection(a, b, c, ratios) → [{ ratio, price }]
 * Three-point extension (A→B swing projected from the C pullback): price = c + (b − a) × ratio.
 */
export function fibProjection(a, b, c, ratios = [0.618, 1, 1.618]) {
  return ratios.map((ratio) => ({ ratio, price: c + (b - a) * ratio }));
}

/**
 * crosses(fast, slow) → [{ idx, type: 'golden'|'death' }]
 * golden: fast closes above slow after being at/below it; death: the reverse. Touches that do
 * not change side are ignored.
 */
export function crosses(fast, slow) {
  const out = [];
  let side = 0;
  for (let i = 0; i < Math.min(fast.length, slow.length); i++) {
    const f = fast[i];
    const s = slow[i];
    if (!isNum(f) || !isNum(s)) continue;
    const d = f - s;
    const now = d > 0 ? 1 : d < 0 ? -1 : 0;
    if (now === 0) continue;
    if (side !== 0 && now !== side) out.push({ idx: i, type: now > 0 ? 'golden' : 'death' });
    side = now;
  }
  return out;
}

/**
 * divergence(candles, oscillator, { lookback = 40, left = 3, right = 3, minDiff })
 * Compares consecutive swing lows (and highs) of price with the oscillator at the same bars
 * (the oscillator extreme within ±2 bars). Pairs further apart than `lookback` bars are skipped.
 *   bullish:        price lower low,  oscillator higher low
 *   hidden-bullish: price higher low, oscillator lower low
 *   bearish:        price higher high, oscillator lower high
 *   hidden-bearish: price lower high, oscillator higher high
 * → [{ type, a: { idx, price, value }, b: { idx, price, value } }] ordered by b.idx
 */
export function divergence(candles, oscillator, { lookback = 40, left = 3, right = 3, minDiff } = {}) {
  const sw = swings(candles, { left, right });
  const vals = oscillator.filter(isNum);
  const oscRange = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
  const eps = minDiff ?? oscRange * 0.02;
  const oscAt = (idx, type) => {
    let best = null;
    for (let j = Math.max(0, idx - 2); j <= Math.min(oscillator.length - 1, idx + 2); j++) {
      const v = oscillator[j];
      if (!isNum(v)) continue;
      if (best == null || (type === 'low' ? v < best : v > best)) best = v;
    }
    return best;
  };
  const out = [];
  for (const type of ['low', 'high']) {
    const list = sw.filter((s) => s.type === type);
    for (let i = 1; i < list.length; i++) {
      const A = list[i - 1];
      const B = list[i];
      if (B.idx - A.idx > lookback) continue;
      const va = oscAt(A.idx, type);
      const vb = oscAt(B.idx, type);
      if (va == null || vb == null || Math.abs(vb - va) <= eps) continue;
      const priceUp = B.price > A.price;
      const oscUp = vb > va;
      if (B.price === A.price || priceUp === oscUp) continue;
      let kind;
      if (type === 'low') kind = !priceUp && oscUp ? 'bullish' : 'hidden-bullish';
      else kind = priceUp && !oscUp ? 'bearish' : 'hidden-bearish';
      out.push({ type: kind, a: { idx: A.idx, price: A.price, value: va }, b: { idx: B.idx, price: B.price, value: vb } });
    }
  }
  return out.sort((x, y) => x.b.idx - y.b.idx);
}

/** Highest value over the last `period` values (aligned, null during warm-up; nulls ignored). */
export function highest(values, period) {
  return rolling(values, period, Math.max);
}

/** Lowest value over the last `period` values. */
export function lowest(values, period) {
  return rolling(values, period, Math.min);
}

function rolling(values, period, pick) {
  const p = Math.max(1, Math.floor(period));
  return values.map((_, i) => {
    if (i < p - 1) return null;
    const w = values.slice(i - p + 1, i + 1).filter(isNum);
    return w.length ? pick(...w) : null;
  });
}
