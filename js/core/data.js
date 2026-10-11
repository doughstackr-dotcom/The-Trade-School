// OHLC generators: random walk, path-following, trend structure, timeframe aggregation.
// A candle is { o, h, l, c, v, t }. Every generator guarantees l <= min(o,c) <= max(o,c) <= h
// and positive prices. Pure module (no DOM) so node:test can import it.

import { makeRng } from './rng.js';

const MIN_PRICE = 1e-4;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);

export function roundPrice(p, decimals = 2) {
  const f = 10 ** decimals;
  return Math.round(p * f) / f;
}

/** True when a candle is internally consistent (finite, positive, wicks enclose the body). */
export function isValidCandle(c) {
  return (
    c != null &&
    [c.o, c.h, c.l, c.c].every((v) => Number.isFinite(v) && v > 0) &&
    c.l <= Math.min(c.o, c.c) &&
    Math.max(c.o, c.c) <= c.h
  );
}

/** Skewed wick multiplier: mostly short, occasionally long (truncated exponential, mean ~0.85). */
function wickDraw(rng) {
  const w = -Math.log(1 - rng.next() * 0.955);
  return rng.chance(0.05) ? w * 2.1 : w;
}

function fixCandle(c) {
  const lo = Math.min(c.o, c.c);
  const hi = Math.max(c.o, c.c);
  if (!(c.h >= hi)) c.h = hi;
  if (!(c.l <= lo)) c.l = lo;
  if (c.l < MIN_PRICE) c.l = MIN_PRICE;
  if (c.o < MIN_PRICE) c.o = MIN_PRICE;
  if (c.c < MIN_PRICE) c.c = MIN_PRICE;
  if (c.h < Math.max(c.o, c.c)) c.h = Math.max(c.o, c.c);
  return c;
}

/**
 * synthesize(closes, { seed, open, scale, wick = 0.6, gapChance = 0.02 }) → candles (v = 0)
 * Builds realistic candles around a close sequence: each open sits at (or a hair away from)
 * the previous close, rare small gaps, skewed wick lengths. `scale` is the typical per-candle
 * move in price units (number or per-candle array) and sizes wicks and gaps.
 */
export function synthesize(closes, { seed, rng: rngIn, open, scale, wick = 0.6, gapChance = 0.02 } = {}) {
  const rng = rngIn || makeRng(seed ?? 1);
  const n = closes.length;
  const out = new Array(n);
  const sc = (i) => {
    const s = Array.isArray(scale) || ArrayBuffer.isView(scale) ? scale[i] : scale;
    if (Number.isFinite(s) && s > 0) return s;
    return Math.max(Math.abs(closes[i]) * 0.006, MIN_PRICE);
  };
  for (let i = 0; i < n; i++) {
    const s = sc(i);
    const c = Math.max(closes[i], MIN_PRICE);
    let o;
    if (i === 0) {
      o = open != null ? open : c - (n > 1 ? (closes[1] - closes[0]) * 0.6 : 0) + rng.gauss(0, 0.35 * s);
    } else {
      o = out[i - 1].c + rng.gauss(0, 0.03 * s);
      if (rng.chance(gapChance)) o += Math.sign(c - out[i - 1].c || 1) * rng.float(0.3, 0.9) * s;
    }
    o = Math.max(o, MIN_PRICE);
    const up = s * wick * 0.85 * wickDraw(rng);
    const dn = s * wick * 0.85 * wickDraw(rng);
    out[i] = fixCandle({ o, h: Math.max(o, c) + up, l: Math.max(Math.min(o, c) - dn, MIN_PRICE), c, v: 0, t: i });
  }
  return out;
}

/**
 * randomWalk({ seed, count = 120, start = 100, drift = 0, vol = 0.012, volume = true }) → candles
 * Geometric random walk with volatility clustering and occasional larger candles.
 */
export function randomWalk({ seed, count = 120, start = 100, drift = 0, vol = 0.012, volume = true } = {}) {
  const rng = makeRng(seed ?? 1);
  const n = Math.max(1, Math.floor(count));
  const closes = new Array(n);
  const scales = new Array(n);
  let p = Math.max(start, MIN_PRICE);
  let regime = 1;
  for (let i = 0; i < n; i++) {
    regime = clamp(0.88 * regime + 0.12 * rng.float(0.45, 1.65), 0.5, 1.8);
    let shock = rng.gauss(0, vol * regime);
    if (rng.chance(0.06)) shock *= rng.float(1.8, 2.7);
    const prev = p;
    p = Math.max(p * (1 + drift + shock), MIN_PRICE * 10);
    closes[i] = p;
    scales[i] = Math.max(prev * vol * regime, MIN_PRICE);
  }
  const candles = synthesize(closes, { rng: rng.fork('synth'), open: start, scale: scales, wick: 0.62 });
  return volume ? addVolume(candles, { seed: rng.fork('vol').seed }) : candles;
}

/**
 * fromPath(points, { seed, count = 120, start = 100, noise = 0.35, wick = 0.6, volume = true, exact = true })
 * points: [[x, price], …], x in [0, 1]. Closes follow the piecewise-linear path with noise
 * proportional to the path's own per-candle move (so shapes stay readable at any scale).
 * `start` is the price at x = 0 when the first point is not at x = 0.
 * With exact = true, interior waypoints that are local peaks become a candle whose HIGH equals
 * the waypoint price and no other candle of that swing (from the previous trough waypoint to the
 * next one) reaches it (troughs: LOW, symmetric); other waypoints ('mid') are hit exactly by the
 * candle's CLOSE.
 * → { candles, anchors: [{ idx, price, kind: 'high'|'low'|'mid' }] } (one per input point, input order)
 */
export function fromPath(points, opts = {}) {
  const { seed, count = 120, start = 100, noise = 0.35, wick = 0.6, volume = true, exact = true } = opts;
  const win = Math.max(1, Math.floor(opts.window ?? 3));
  const rng = makeRng(seed ?? 1);

  const input = (points || [])
    .map((p, k) => ({ x: clamp(Number(p[0]), 0, 1), price: Number(p[1]), k }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.price));
  input.sort((a, b) => a.x - b.x || a.k - b.k);
  const pts = input.map((p) => ({ ...p, price: Math.max(p.price, MIN_PRICE * 10) }));
  if (!pts.length) pts.push({ x: 0, price: start, k: -1 });
  if (pts[0].x > 0) pts.unshift({ x: 0, price: start, k: -1 });
  if (pts.length < 2 || pts[pts.length - 1].x < 1) pts.push({ x: 1, price: pts[pts.length - 1].price, k: -1 });

  const m = pts.length;
  const n = Math.max(m, Math.floor(count));

  // x → candle index, strictly increasing.
  for (const p of pts) p.idx = Math.round(p.x * (n - 1));
  pts[0].idx = 0;
  for (let k = 1; k < m; k++) pts[k].idx = Math.max(pts[k].idx, pts[k - 1].idx + 1);
  pts[m - 1].idx = n - 1;
  for (let k = m - 2; k >= 0; k--) pts[k].idx = Math.min(pts[k].idx, pts[k + 1].idx - 1);

  // Waypoint kinds: interior local maxima/minima of the path are 'high'/'low'.
  for (let k = 0; k < m; k++) {
    const p = pts[k];
    p.kind = 'mid';
    if (k === 0 || k === m - 1) continue;
    const a = pts[k - 1].price;
    const b = pts[k + 1].price;
    if (p.price >= a && p.price >= b && (p.price > a || p.price > b)) p.kind = 'high';
    else if (p.price <= a && p.price <= b && (p.price < a || p.price < b)) p.kind = 'low';
  }

  // Piecewise-linear base path and per-segment move.
  const base = new Float64Array(n);
  const seg = new Int32Array(n);
  let totalMove = 0;
  const segMove = [];
  for (let k = 0; k < m - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const len = b.idx - a.idx;
    segMove.push(Math.abs(b.price - a.price) / len);
    totalMove += Math.abs(b.price - a.price);
    for (let i = a.idx; i <= b.idx; i++) {
      base[i] = a.price + ((b.price - a.price) * (i - a.idx)) / len;
      if (i < b.idx || k === m - 2) seg[i] = k;
    }
  }
  const avgMove = totalMove / Math.max(1, n - 1);
  const scale = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sm = segMove[seg[i]];
    if (seg[i] > 0 && pts[seg[i]].idx === i) sm = Math.max(sm, segMove[seg[i] - 1]);
    scale[i] = Math.max(0.55 * sm + 0.45 * avgMove, Math.abs(base[i]) * 0.0012, MIN_PRICE);
  }

  // Noise. With exact = true: a Brownian bridge per segment (random-walk wiggles that return to
  // each waypoint), damped within ~2 bars of a waypoint so peaks and troughs stay clean.
  // Otherwise a persistent AR(1) walk around the path. The gain makes candle-to-candle noise
  // about the size of the path's own per-candle move at noise = 0.35: trends show a realistic
  // share of counter-trend candles and small pullbacks while the shape stays obvious.
  const NOISE_GAIN = 2.5;
  const closes = new Float64Array(n);
  if (exact) {
    for (let k = 0; k < m - 1; k++) {
      const a = pts[k].idx;
      const b = pts[k + 1].idx;
      const len = b - a;
      const W = new Float64Array(len + 1);
      for (let j = 1; j <= len; j++) W[j] = W[j - 1] + rng.gauss(0, noise * NOISE_GAIN * scale[a + j]);
      for (let j = 0; j <= len; j++) {
        const i = a + j;
        const d = Math.min(j, len - j);
        const damp = Math.pow(Math.min(1, d / 2.5), 0.8);
        const bridge = W[j] - (j / len) * W[len];
        const white = rng.gauss(0, noise * 2.2 * scale[i]);
        closes[i] = base[i] + (bridge + white) * damp;
      }
    }
  } else {
    let e = 0;
    for (let i = 0; i < n; i++) {
      e = 0.8 * e + rng.gauss(0, noise * NOISE_GAIN * 0.8 * scale[i]);
      closes[i] = base[i] + e;
    }
  }
  for (let i = 0; i < n; i++) closes[i] = Math.max(closes[i], MIN_PRICE * 10);

  // Exact anchors: bounds for closes near peaks / troughs.
  const hiCap = new Float64Array(n).fill(Infinity);
  const loCap = new Float64Array(n).fill(-Infinity);
  const rej = new Float64Array(n);
  // Each peak is also the highest point of its whole swing — from the previous trough to the
  // next one — and each trough the lowest (so a labelled Head / Top / Cup bottom is the real
  // extreme a trader would mark, not just the extreme within ±win bars).
  const isAnchor = new Uint8Array(n);
  const kindAt = new Array(n);
  for (const p of pts) {
    isAnchor[p.idx] = 1;
    kindAt[p.idx] = p.kind;
  }
  const legs = [];
  if (exact) {
    for (let q = 0; q < m; q++) {
      const p = pts[q];
      if (p.kind === 'mid') continue;
      const opp = p.kind === 'high' ? 'low' : 'high';
      let a = 0;
      for (let r = q - 1; r >= 0; r--) {
        if (pts[r].kind === opp) {
          a = pts[r].idx + 1;
          break;
        }
      }
      let b = n - 1;
      for (let r = q + 1; r < m; r++) {
        if (pts[r].kind === opp) {
          b = pts[r].idx - 1;
          break;
        }
      }
      legs.push({ p, a, b });
    }
    for (const { p, a, b } of legs) {
      const k = p.idx;
      const s = scale[k];
      rej[k] = s * rng.float(0.12, 0.55);
      for (let j = Math.max(0, k - win - 1); j <= Math.min(n - 1, k + win); j++) {
        if (j === k) continue;
        const margin = s * (0.1 + 0.08 * Math.abs(j - k));
        if (p.kind === 'high') hiCap[j] = Math.min(hiCap[j], p.price - margin);
        else loCap[j] = Math.max(loCap[j], p.price + margin);
      }
      for (let j = a; j <= b; j++) {
        if (isAnchor[j] || (j >= k - win - 1 && j <= k + win)) continue;
        if (p.kind === 'high') hiCap[j] = Math.min(hiCap[j], p.price - 0.12 * s);
        else loCap[j] = Math.max(loCap[j], p.price + 0.12 * s);
      }
    }
    for (const p of pts) {
      const k = p.idx;
      if (p.kind === 'high') closes[k] = p.price - rej[k];
      else if (p.kind === 'low') closes[k] = p.price + rej[k];
      else if (p.k >= 0 || k === 0 || k === n - 1) closes[k] = p.price;
    }
    // Closes beyond a cap are redrawn a little inside it (not flattened onto it), so capped
    // stretches still look like ordinary candles.
    const capRng = rng.fork('caps');
    for (let j = 0; j < n; j++) {
      const lo = loCap[j];
      const hi = hiCap[j];
      if (lo > hi) closes[j] = (lo + hi) / 2;
      else if (closes[j] > hi) closes[j] = Math.max(lo, hi - scale[j] * capRng.float(0, 0.35));
      else if (closes[j] < lo) closes[j] = Math.min(hi, lo + scale[j] * capRng.float(0, 0.35));
    }
  }

  const candles = synthesize(Array.from(closes), { rng: rng.fork('synth'), scale: Array.from(scale), wick });

  if (exact) {
    // Keep opens within bounds (tiny gaps could otherwise poke through).
    for (let j = 0; j < n; j++) {
      const c = candles[j];
      if (c.o > hiCap[j]) c.o = Math.max(hiCap[j], loCap[j] > -Infinity ? loCap[j] : -Infinity);
      if (c.o < loCap[j]) c.o = Math.min(loCap[j], hiCap[j] < Infinity ? hiCap[j] : Infinity);
      fixCandle(c);
    }
    // Cap neighbouring wicks (and every wick of the swing), then pin the anchor extremes exactly.
    for (const { p, a, b } of legs) {
      const k = p.idx;
      const s = scale[k];
      // a − 1 / b + 1 are the neighbouring opposite swings: only their far-side wick is capped.
      for (let j = Math.min(a - 1, k - win); j <= Math.max(b + 1, k + win); j++) {
        if (j === k || j < 0 || j >= n) continue;
        if (kindAt[j] === p.kind && Math.abs(j - k) > win) continue;
        const c = candles[j];
        if (p.kind === 'high') c.h = Math.max(Math.max(c.o, c.c), Math.min(c.h, p.price - 0.04 * s));
        else c.l = Math.min(Math.min(c.o, c.c), Math.max(c.l, p.price + 0.04 * s));
      }
    }
    for (const p of pts) {
      if (p.kind === 'mid') continue;
      const c = candles[p.idx];
      if (p.kind === 'high') {
        c.h = p.price;
        if (Math.max(c.o, c.c) > p.price) {
          c.o = Math.min(c.o, p.price);
          c.c = Math.min(c.c, p.price);
        }
        if (c.l > Math.min(c.o, c.c)) c.l = Math.min(c.o, c.c);
      } else {
        c.l = p.price;
        if (Math.min(c.o, c.c) < p.price) {
          c.o = Math.max(c.o, p.price);
          c.c = Math.max(c.c, p.price);
        }
        if (c.h < Math.max(c.o, c.c)) c.h = Math.max(c.o, c.c);
      }
      // Respect the opposite-side bound of a neighbouring anchor (e.g. a low 3 bars away).
      if (loCap[p.idx] > -Infinity && p.kind === 'high') c.l = Math.max(c.l, Math.min(loCap[p.idx], Math.min(c.o, c.c)));
      if (hiCap[p.idx] < Infinity && p.kind === 'low') c.h = Math.min(c.h, Math.max(hiCap[p.idx], Math.max(c.o, c.c)));
    }
  }

  const out = volume ? addVolume(candles, { seed: rng.fork('vol').seed }) : candles;
  const anchors = new Array(input.length);
  for (const p of pts) if (p.k >= 0) anchors[p.k] = { idx: p.idx, price: p.price, kind: p.kind };
  return { candles: out, anchors };
}

/**
 * trendSeries({ seed, count = 80, start = 100, direction = 'up'|'down'|'range', swings = 4, strength = 1 })
 * Zig-zag market structure. 'up' prints higher highs and higher lows, 'down' lower highs and
 * lower lows, 'range' oscillates between a ceiling and a floor. `swings` = swing highs (and lows).
 * Every returned swing is the exact high/low of its candle and the extreme of all candles
 * between its neighbouring swings.
 * → { candles, swings: [{ idx, price, type: 'high'|'low', label: 'HH'|'HL'|'LH'|'LL'|'H'|'L' }] }
 */
export function trendSeries({ seed, count = 80, start = 100, direction = 'up', swings = 4, strength = 1, volume = true } = {}) {
  const rng = makeRng(seed ?? 1);
  const n = Math.max(16, Math.floor(count));
  let nSw = Math.max(2, Math.round(swings) * 2);
  while (nSw > 2 && n / (nSw + 1) < 6) nSw -= 2;
  const str = clamp(Number(strength) || 1, 0.25, 3);
  const dir = direction === 'down' ? 'down' : direction === 'range' ? 'range' : 'up';

  const prices = [];
  const types = [];
  const weights = [];
  let p0 = start;
  let end;
  if (dir === 'range') {
    const half = start * 0.03 * str;
    const firstHigh = rng.chance(0.5);
    for (let s = 0; s < nSw; s++) {
      const isHigh = (s % 2 === 0) === firstHigh;
      types.push(isHigh ? 'high' : 'low');
      prices.push(start + (isHigh ? half : -half) * rng.float(0.86, 1.12));
      weights.push(rng.float(0.85, 1.2));
    }
    const lastHigh = types[nSw - 1] === 'high';
    end = start + (lastHigh ? -half : half) * rng.float(0.2, 0.55);
    p0 = start + (firstHigh ? -half : half) * rng.float(0.2, 0.5);
    weights.push(rng.float(0.6, 0.9));
  } else {
    // Build an up-trend, mirror for down. Sequence ends with a higher low, then a rally.
    const imp = () => start * 0.045 * str * rng.float(0.8, 1.25);
    let last = null;
    for (let s = 0; s < nSw; s++) {
      const isHigh = (nSw - 1 - s) % 2 === 1;
      types.push(isHigh ? 'high' : 'low');
      if (s === 0) {
        if (isHigh) {
          const i0 = imp();
          p0 = start;
          last = start + i0 * rng.float(0.6, 0.85);
        } else {
          p0 = start;
          last = start - imp() * rng.float(0.35, 0.55);
        }
      } else if (isHigh) {
        // Next high: a fresh impulse, and always clearly above the previous high.
        const prevHigh = s >= 2 ? prices[s - 2] : -Infinity;
        last = Math.max(last + imp(), prevHigh + start * 0.012 * str * rng.float(1, 1.6));
      } else {
        // Pullback retraces 38–62% of the impulse and stays clearly above the previous low.
        const i1 = prices[s - 1] - (s >= 2 ? prices[s - 2] : p0);
        const prevLow = s >= 2 ? prices[s - 2] : -Infinity;
        last = last - Math.max(i1, start * 0.02 * str) * rng.float(0.38, 0.62);
        last = Math.min(Math.max(last, prevLow + start * 0.012 * str), prices[s - 1] - start * 0.015 * str);
      }
      prices.push(last);
      weights.push(isHigh ? rng.float(1.1, 1.45) : rng.float(0.7, 0.95));
    }
    end = last + imp() * rng.float(0.5, 0.85);
    weights.push(rng.float(0.8, 1.1));
    if (dir === 'down') {
      for (let s = 0; s < nSw; s++) {
        prices[s] = 2 * start - prices[s];
        types[s] = types[s] === 'high' ? 'low' : 'high';
      }
      end = 2 * start - end;
      p0 = 2 * start - p0;
    }
  }
  // weights[0] is the leg into the first swing; weights has nSw + 1 entries.
  const legW = [rng.float(0.8, 1.1), ...weights.slice(1)];
  const total = legW.reduce((s, w) => s + w, 0);
  const points = [[0, p0]];
  let acc = 0;
  for (let s = 0; s < nSw; s++) {
    acc += legW[s];
    points.push([acc / total, prices[s]]);
  }
  points.push([1, end]);

  const { candles, anchors } = fromPath(points, { seed: rng.fork('path').seed, count: n, noise: 0.35, wick: 0.6, exact: true, window: 3, volume });
  const out = [];
  let lastH = null;
  let lastL = null;
  for (let s = 0; s < nSw; s++) {
    const a = anchors[s + 1];
    const type = types[s];
    let label;
    if (type === 'high') {
      label = lastH == null ? 'H' : a.price > lastH ? 'HH' : 'LH';
      lastH = a.price;
    } else {
      label = lastL == null ? 'L' : a.price < lastL ? 'LL' : 'HL';
      lastL = a.price;
    }
    out.push({ idx: a.idx, price: a.price, type, label });
  }
  return { candles, swings: out };
}

/**
 * aggregate(candles, factor, { partial = true }) — combine every `factor` consecutive candles into
 * one higher-timeframe candle: o = first.o, c = last.c, h = max h, l = min l, v = sum v,
 * t = index in the new series. A trailing incomplete group is kept (still-forming candle)
 * unless partial = false.
 */
export function aggregate(candles, factor, { partial = true } = {}) {
  const f = Math.max(1, Math.floor(factor));
  const out = [];
  for (let i = 0; i < candles.length; i += f) {
    const g = candles.slice(i, i + f);
    if (g.length < f && !partial) break;
    let h = -Infinity;
    let l = Infinity;
    let v = 0;
    for (const c of g) {
      if (c.h > h) h = c.h;
      if (c.l < l) l = c.l;
      v += c.v || 0;
    }
    out.push({ o: g[0].o, h, l, c: g[g.length - 1].c, v, t: out.length });
  }
  return out;
}

/**
 * addVolume(candles, { seed, base = 1000, trendBoost = true }) → new candles with `v`
 * Volume grows with the candle's range (relative to recent ranges), is higher on candles
 * that move with the short-term trend, and spikes on unusually large candles. Causal: bar i's
 * volume only depends on bars 0..max(i, 9).
 */
export function addVolume(candles, { seed, base = 1000, trendBoost = true } = {}) {
  const rng = makeRng(seed ?? 11).fork('volume');
  const ranges = candles.map((c) => Math.max(c.h - c.l, 0));
  // Causal: a bar's volume depends only on bars up to it (after a 10-bar warm-up), so appending
  // candles (a different future) never changes the volume of the bars already shown.
  const warm = Math.min(ranges.length, 10);
  const warmAvg = mean(ranges.slice(0, warm)) || 1;
  let rolling = warmAvg;
  let sum = 0;
  return candles.map((c, i) => {
    sum += ranges[i];
    const expanding = i + 1 > warm ? sum / (i + 1) : warmAvg;
    rolling = rolling * 0.88 + ranges[i] * 0.12;
    const rel = clamp(ranges[i] / (0.5 * rolling + 0.5 * expanding || 1), 0.2, 4);
    let v = base * (0.32 + 0.68 * Math.pow(rel, 1.15));
    if (trendBoost && i >= 5) {
      const trend = Math.sign(c.c - candles[i - 5].c);
      const cd = Math.sign(c.c - c.o);
      if (trend !== 0 && cd === trend) v *= 1.22;
      else if (trend !== 0 && cd === -trend) v *= 0.84;
    }
    v *= Math.exp(rng.gauss(0, 0.2));
    if (rel > 1.7) v *= rng.float(1.1, 1.45);
    return { ...c, v: Math.max(1, Math.round(v)) };
  });
}

/** Multiply every price by `factor` (volume unchanged). */
export function scale(candles, factor) {
  return candles.map((c) => ({ ...c, o: c.o * factor, h: c.h * factor, l: c.l * factor, c: c.c * factor }));
}

/** Add `delta` to every price. */
export function shift(candles, delta) {
  return candles.map((c) => ({ ...c, o: c.o + delta, h: c.h + delta, l: c.l + delta, c: c.c + delta }));
}

/** Copy candles with t renumbered from `start`. */
export function reindex(candles, start = 0) {
  return candles.map((c, i) => ({ ...c, t: start + i }));
}

/** Join series end to end and renumber t. */
export function concat(...series) {
  return reindex(series.flat());
}

// ---------------------------------------------------------------------------------------------
// realisticMarket — a stand-in for real price history (fallback when real data is unavailable,
// and the trade simulator's market).
// ---------------------------------------------------------------------------------------------

const REGIME_KINDS = {
  up: { volMul: 0.9, dur: 55 },
  down: { volMul: 1.12, dur: 45 },
  range: { volMul: 0.75, dur: 45 },
  volatile: { volMul: 1.9, dur: 22 },
};
const REGIME_MIX = {
  mixed: { up: 0.3, down: 0.25, range: 0.3, volatile: 0.15 },
  trend: { up: 0.46, down: 0.4, range: 0.1, volatile: 0.04 },
  range: { up: 0.1, down: 0.1, range: 0.75, volatile: 0.05 },
  volatile: { up: 0.2, down: 0.2, range: 0.1, volatile: 0.5 },
};

/** Standardised Student-t draw (unit variance, ν = 5 → fat tails, excess kurtosis ≈ 6). */
function studentT(rng, nu = 5) {
  let chi = 0;
  for (let k = 0; k < nu; k++) chi += rng.gauss() ** 2;
  return rng.gauss() / Math.sqrt(chi / nu) / Math.sqrt(nu / (nu - 2));
}

/**
 * realisticMarket({ seed, count = 300, start = 100, regime = 'mixed', vol = 0.012, drift = 0,
 *                   volume = true, gaps = true, decimals = null, info = false }) → candles
 * Price history that behaves like a real market rather than a textbook drawing:
 *  - regime switches (Markov chain of up-trend, down-trend, range and volatile spells, each
 *    lasting ~20–90 candles); `regime` biases the mix: 'mixed' | 'trend' | 'range' | 'volatile';
 *  - GARCH(1,1)-style volatility clustering (calm and wild stretches) around `vol` (per-candle
 *    fraction) scaled by the regime; fat-tailed (Student-t) returns and rare jump candles;
 *  - trends drift 0.15–0.3 σ per candle; ranges mean-revert to the level where they began;
 *  - opens sit at the previous close except for occasional gaps (more likely on regime changes);
 *  - volume rises with volatility, range and gaps, and is higher on candles that move with the trend.
 * `drift` adds a constant per-candle log-return (e.g. 0.002 for a long bull market).
 * With `info: true` → { candles, regimes: [{ kind, from, to }] } instead of the bare array.
 * Deterministic for a seed. Every candle satisfies l ≤ min(o, c) ≤ max(o, c) ≤ h, prices > 0.
 */
export function realisticMarket({ seed, count = 300, start = 100, regime = 'mixed', vol = 0.012, drift = 0, volume = true, gaps = true, decimals = null, info = false } = {}) {
  const rng = makeRng(seed ?? 1);
  const n = Math.max(1, Math.floor(count));
  const mix = REGIME_MIX[regime] || REGIME_MIX.mixed;
  const kinds = Object.keys(mix);
  const weights = kinds.map((k) => mix[k]);
  const sigma0 = Math.max(1e-5, Number(vol) || 0.012);
  const A = 0.09;
  const B = 0.88;

  const regimes = [];
  let cur = null;
  let left = 0;
  const nextRegime = (i) => {
    let kind = rng.weighted(kinds, weights);
    // Consecutive spells of the same kind merge into one; prefer a change.
    if (cur && kind === cur.kind) kind = rng.weighted(kinds, weights);
    const R = REGIME_KINDS[kind];
    left = Math.max(8, Math.round(R.dur * rng.float(0.45, 1.7)));
    const dir = kind === 'up' ? 1 : kind === 'down' ? -1 : kind === 'volatile' ? rng.sign() * rng.float(0, 0.6) : 0;
    cur = { kind, from: i, to: i, mu: dir * rng.float(0.15, 0.3), volMul: R.volMul * rng.float(0.85, 1.2), center: null };
    regimes.push(cur);
  };

  let p = Math.max(Number(start) || 100, MIN_PRICE * 10);
  let h = sigma0 * sigma0;
  let eps = 0;
  let volLevel = 0; // slow AR(1) drift of the volume baseline
  const out = new Array(n);
  let prevClose = p;
  let switched = false;
  for (let i = 0; i < n; i++) {
    if (left <= 0) {
      nextRegime(i);
      switched = i > 0;
    }
    left--;
    cur.to = i;
    if (cur.kind === 'range' && cur.center == null) cur.center = Math.log(prevClose);
    const target = sigma0 * cur.volMul;
    h = (1 - A - B) * target * target + A * eps * eps + B * h;
    const sd = clamp(Math.sqrt(h), 0.3 * sigma0, 4.5 * sigma0);

    // Open: at the previous close, or a gap.
    let o = prevClose * (1 + rng.gauss(0, 0.02 * sd));
    let gapped = false;
    if (gaps && i > 0 && rng.chance(switched ? 0.12 : 0.015)) {
      o = prevClose * Math.exp(studentT(rng) * sd * rng.float(0.6, 1.4));
      gapped = true;
    }
    switched = false;

    // Close: drift + mean reversion + fat-tailed shock (+ a rare jump).
    let r = cur.mu * sigma0 + drift;
    if (cur.kind === 'range') r -= 0.07 * (Math.log(o) - cur.center);
    let z = studentT(rng);
    if (rng.chance(0.008)) z += rng.sign() * rng.float(3, 5.5);
    r += sd * z;
    eps = r - cur.mu * sigma0;
    const c = Math.max(o * Math.exp(r), MIN_PRICE * 10);

    // Wicks: exponential lengths scaled by the current volatility.
    const up = o * sd * -Math.log(1 - rng.next() * 0.985) * 0.42;
    const dn = o * sd * -Math.log(1 - rng.next() * 0.985) * 0.42;
    const k = fixCandle({ o, h: Math.max(o, c) + up, l: Math.max(Math.min(o, c) - dn, MIN_PRICE), c, v: 0, t: i });

    if (volume) {
      volLevel = 0.97 * volLevel + rng.gauss(0, 0.05);
      const rel = sd / sigma0;
      const move = Math.abs(Math.log(c / o)) / sd;
      let v = 1000 * Math.exp(volLevel) * Math.pow(rel, 1.1) * (0.7 + 0.45 * Math.min(move, 4)) * Math.exp(rng.gauss(0, 0.28));
      if (gapped) v *= rng.float(1.4, 2.2);
      if (cur.mu !== 0 && Math.sign(c - o) === Math.sign(cur.mu)) v *= 1.15;
      k.v = Math.max(1, Math.round(v));
    }
    out[i] = k;
    prevClose = c;
  }
  if (decimals != null) {
    for (const k of out) {
      k.o = roundPrice(k.o, decimals);
      k.c = roundPrice(k.c, decimals);
      k.h = Math.max(roundPrice(k.h, decimals), k.o, k.c);
      k.l = Math.min(roundPrice(k.l, decimals), k.o, k.c);
      const tick = 10 ** -decimals;
      if (k.l <= 0) k.l = Math.min(tick, k.o, k.c);
    }
  }
  return info ? { candles: out, regimes: regimes.map(({ kind, from, to }) => ({ kind, from, to })) } : out;
}
