// Divergence scenarios for Divergence Detective and the Indicators lesson. Pure module (no DOM),
// importable from node for tests.
//
// A scenario is built from waypoints with per-leg "chop" so the oscillator produces the intended relationship
// (e.g. a sharp first drop and a slow, grinding lower low give RSI a higher low), then CONFIRMED
// on the computed oscillator the way a trader reads it: the last two significant swing lows and
// the last two significant swing highs before the decision candle are compared with the oscillator
// at those swings. Generate-and-test: a candidate is regenerated (forked seed) until the intended
// pair diverges clearly, the other pair clearly agrees (no second, conflicting signal) and the
// outcome candles do what the scenario promises; after 30 tries a hand-tuned, low-noise path is used.
//
// Kinds: 'bullish' (price lower low, oscillator higher low), 'bearish' (price higher high,
// oscillator lower high), 'hidden-bullish' (price higher low, oscillator lower low),
// 'hidden-bearish' (price lower high, oscillator higher high) and 'none' (swings agree: the
// trend's new extreme is confirmed by momentum).
// Oscillators: RSI 14 for every kind; the MACD histogram for 'bullish', 'bearish' and 'none'
// (histogram "hidden divergence" appears in almost every healthy pullback, so it is not asked).

import { synthesize, addVolume } from '../core/data.js';
import { rsi, macd, atr, zigzag, closes } from '../core/indicators.js';
import { makeRng } from '../core/rng.js';

export const DIV_KINDS = ['bullish', 'bearish', 'hidden-bullish', 'hidden-bearish', 'none'];

export const DIV_INFO = {
  bullish: {
    id: 'bullish', name: 'Bullish divergence', short: 'Bullish', side: 'low', bias: 1, regular: true,
    price: 'Lower low', osc: 'Higher low', meaning: 'selling momentum is fading and a turn up is possible',
  },
  bearish: {
    id: 'bearish', name: 'Bearish divergence', short: 'Bearish', side: 'high', bias: -1, regular: true,
    price: 'Higher high', osc: 'Lower high', meaning: 'buying momentum is fading and a turn down is possible',
  },
  'hidden-bullish': {
    id: 'hidden-bullish', name: 'Hidden bullish divergence', short: 'Hidden bullish', side: 'low', bias: 1, regular: false,
    price: 'Higher low', osc: 'Lower low', meaning: 'the uptrend shrugged off a sharp dip and continuation up is favoured',
  },
  'hidden-bearish': {
    id: 'hidden-bearish', name: 'Hidden bearish divergence', short: 'Hidden bearish', side: 'high', bias: -1, regular: false,
    price: 'Lower high', osc: 'Higher high', meaning: 'the downtrend shrugged off a sharp bounce and continuation down is favoured',
  },
  none: {
    id: 'none', name: 'No divergence', short: 'None', side: null, bias: 0, regular: false,
    price: '', osc: '', meaning: 'price and momentum agree, so the trend is healthy',
  },
};

export const OSC_LABEL = { rsi: 'RSI 14', macd: 'MACD histogram' };

const PRE = 45; // hidden warm-up candles (MACD 12/26/9 needs 34)
const AFTER = 18;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ------------------------------------------------------------------ reading swings

/**
 * Significant swings a trader would mark, known at `decision` (causal): zigzag pivots that
 * reversed by ≥ atrMult × ATR, plus the still-unconfirmed last extreme when at least `settle`
 * candles have closed after it. Only pivots with idx ≥ from are returned.
 */
export function significantSwings(candles, { from = 0, decision = candles.length - 1, atrMult = 2, settle = 3 } = {}) {
  const upTo = candles.slice(0, decision + 1);
  const zz = zigzag(upTo, { atrMult, last: true });
  return zz.filter((p) => p.idx >= from && (p.confirmedIdx != null || p.idx <= decision - settle));
}

/**
 * Oscillator value "at" a price swing. RSI: the extreme within ±2 candles (as indicators.divergence()).
 * MACD histogram: the extreme of the histogram over the leg into the swing (it peaks before price).
 * → { idx, value } | null
 */
export function oscAtSwing(osc, swing, { kind = 'rsi', legFrom = null, limit = osc.length - 1 } = {}) {
  const low = swing.type === 'low';
  let a = swing.idx - 2;
  if (kind === 'macd') a = legFrom != null ? Math.max(legFrom + 1, swing.idx - 16) : swing.idx - 12;
  const b = Math.min(limit, swing.idx + 2);
  let best = null;
  for (let j = Math.max(0, a); j <= b; j++) {
    const v = osc[j];
    if (!isNum(v)) continue;
    if (!best || (low ? v < best.value : v > best.value)) best = { idx: j, value: v };
  }
  return best;
}

/**
 * Classify a pair of same-type swings against the oscillator.
 * → { rel: 'bullish'|'bearish'|'hidden-bullish'|'hidden-bearish'|'agree'|'flat', priceDiff (ATRs), oscDiff }
 * 'flat' = price or oscillator practically unchanged (an ambiguous read).
 */
export function classifyPair(A, B, oa, ob, { atrValue, oscScale = 1, pxMin = 0.35, oscMin = 1.5 } = {}) {
  const priceDiff = (B.price - A.price) / (atrValue || 1);
  const oscDiff = (ob.value - oa.value) / (oscScale || 1);
  if (Math.abs(priceDiff) < pxMin || Math.abs(oscDiff) < oscMin) return { rel: 'flat', priceDiff, oscDiff };
  const pUp = priceDiff > 0;
  const oUp = oscDiff > 0;
  let rel = 'agree';
  if (pUp !== oUp) {
    if (A.type === 'low') rel = pUp ? 'hidden-bullish' : 'bullish';
    else rel = pUp ? 'bearish' : 'hidden-bearish';
  }
  return { rel, priceDiff, oscDiff };
}

/**
 * The read a trader makes at `decision`: the last two significant lows and highs (from `from` on)
 * compared with the oscillator. osc: array aligned with candles. oscKind: 'rsi' | 'macd'.
 * → { swings, lows: { A, B, oa, ob, rel, priceDiff, oscDiff } | null, highs: same | null, atr, oscScale }
 */
export function readDivergence(candles, osc, { from = 0, decision = candles.length - 1, oscKind = 'rsi', atrMult = 2 } = {}) {
  const sw = significantSwings(candles, { from, decision, atrMult });
  const A = atr(candles, 14);
  const atrAt = (i) => A[i] ?? A.find(isNum) ?? 1;
  let oscScale = 1;
  let pxMin = 0.35;
  let oscMin = 1.5;
  if (oscKind === 'macd') {
    let m = 0;
    for (let i = from; i <= decision; i++) if (isNum(osc[i])) m = Math.max(m, Math.abs(osc[i]));
    oscScale = m || 1;
    oscMin = 0.06;
  }
  const pair = (type) => {
    const list = sw.filter((s) => s.type === type);
    if (list.length < 2) return null;
    const pA = list[list.length - 2];
    const pB = list[list.length - 1];
    const prevOpp = (s) => {
      const k = sw.indexOf(s);
      for (let j = k - 1; j >= 0; j--) if (sw[j].type !== type) return sw[j].idx;
      return null;
    };
    const oa = oscAtSwing(osc, pA, { kind: oscKind, legFrom: prevOpp(pA), limit: decision });
    const ob = oscAtSwing(osc, pB, { kind: oscKind, legFrom: prevOpp(pB), limit: decision });
    if (!oa || !ob) return null;
    const c = classifyPair(pA, pB, oa, ob, { atrValue: atrAt(pB.idx), oscScale, pxMin, oscMin });
    return { A: pA, B: pB, oa, ob, ...c };
  };
  return { swings: sw, lows: pair('low'), highs: pair('high'), atr: atrAt(decision), oscScale };
}

// ------------------------------------------------------------------ series builder

/**
 * Candles through waypoints [{ i, p, chop }] (i = candle index, p = close price there; chop 0–1 is
 * how choppy the leg INTO that waypoint is: 0 = every candle moves with the leg, 1 = many sizeable
 * counter-candles). RSI reads the ratio of up-moves to down-moves, so a clean leg drives it to an
 * extreme while a choppy leg of the same size keeps it near the middle — that is the knob that
 * shapes divergence. Interior peaks / troughs of the waypoint path are exact: the candle's high
 * (low) equals the price and no other candle of that swing reaches it.
 */
function buildSeries(wps, rng, { noise = 0.25 } = {}) {
  const n = wps[wps.length - 1].i + 1;
  const cl = new Array(n).fill(0);
  const unit = new Array(n).fill(0);
  cl[0] = wps[0].p;
  // Waypoint kinds (peak / trough / mid).
  const kind = wps.map((w, k) => {
    if (k === 0 || k === wps.length - 1) return 'mid';
    const a = wps[k - 1].p;
    const b = wps[k + 1].p;
    if (w.p > a && w.p > b) return 'high';
    if (w.p < a && w.p < b) return 'low';
    return 'mid';
  });
  // Typical per-candle move of the main legs: small legs (a pause, the outcome tail) still get
  // candles of a normal size, with zero-sum noise so they end exactly on their waypoint.
  const legMoves = [];
  for (let k = 1; k < wps.length; k++) {
    const len = wps[k].i - wps[k - 1].i;
    if (len >= 3) legMoves.push(Math.abs(wps[k].p - wps[k - 1].p) / len);
  }
  legMoves.sort((x, y) => x - y);
  const floorU = 0.62 * (legMoves[Math.floor(legMoves.length * 0.75)] || 1);
  for (let k = 1; k < wps.length; k++) {
    const a = wps[k - 1];
    const b = wps[k];
    const len = b.i - a.i;
    const M = b.p - a.p;
    const sg = Math.sign(M) || 1;
    const chop = clamp(b.chop ?? 0.4, 0, 1);
    const pc = 0.06 + 0.34 * chop;
    const back = 0.45 + 0.55 * chop;
    const seq = [];
    let prevCounter = false;
    for (let j = 0; j < len; j++) {
      const counter = j > 0 && j < len - 1 && !prevCounter && rng.chance(pc);
      prevCounter = counter;
      seq.push(counter ? -back * rng.float(0.6, 1.4) : rng.float(0.55, 1.45));
    }
    // A choppy leg really is choppy: top up the counter-candles to about the expected share.
    const want = chop >= 0.5 ? Math.floor((len - 2) * pc * 0.8) : 0;
    for (let guard = 0; guard < 40 && seq.filter((v) => v < 0).length < want; guard++) {
      const j = rng.int(1, len - 2);
      if (seq[j] > 0 && !(seq[j - 1] < 0) && !(seq[j + 1] < 0)) seq[j] = -back * rng.float(0.6, 1.4);
    }
    let net = seq.reduce((x, v) => x + v, 0);
    const pos = seq.reduce((x, v) => x + (v > 0 ? v : 0), 0);
    if (net < 0.35 * pos) {
      // Too many counter-candles for the leg to get anywhere: soften them.
      const neg = pos - net;
      const f = (pos - 0.35 * pos) / (neg || 1);
      for (let j = 0; j < len; j++) if (seq[j] < 0) seq[j] *= f;
      net = seq.reduce((x, v) => x + v, 0);
    }
    const u = Math.abs(M) / (net || 1);
    const uu = Math.max(u, floorU);
    // Mean-reverting wiggles around the leg (white noise on the closes, damped next to the
    // waypoints): small legs get normal-size candles without wandering into new swings.
    const sdW = noise * 0.3 * uu + Math.max(0, 0.9 * floorU - 0.6 * u);
    // Only a pivot end bounds the leg (the swing extreme must stay the extreme).
    const lo = Math.min(a.p, b.p);
    const hi = Math.max(a.p, b.p);
    const pad = Math.max((hi - lo) * 0.04, floorU * 0.25);
    const kLo = kind[k - 1] === 'low' || kind[k] === 'low';
    const kHi = kind[k - 1] === 'high' || kind[k] === 'high';
    let cum = 0;
    for (let j = 1; j <= len; j++) {
      cum += seq[j - 1];
      const damp = Math.min(1, Math.min(j, len - j) / 2);
      const p = a.p + sg * cum * u + rng.gauss(0, sdW) * damp;
      const i = a.i + j;
      cl[i] = j === len ? b.p : clamp(p, kLo ? lo + pad : -Infinity, kHi ? hi - pad : Infinity);
      unit[i] = Math.max(uu, 1e-6);
    }
  }
  unit[0] = unit[1] || 1;
  // Pivot candles close a little off their extreme.
  const pivots = [];
  wps.forEach((w, k) => {
    if (kind[k] === 'mid') return;
    const rej = unit[w.i] * rng.float(0.12, 0.45);
    cl[w.i] = kind[k] === 'high' ? w.p - rej : w.p + rej;
    pivots.push({ i: w.i, p: w.p, type: kind[k], k });
  });
  const candles = synthesize(cl, { rng: rng.fork('synth'), scale: unit.map((x) => x * 0.9), wick: 0.55, gapChance: 0 });
  // Exact pivots: the extreme of their whole swing (from the previous opposite pivot to the next).
  for (const pv of pivots) {
    const opp = pv.type === 'high' ? 'low' : 'high';
    let a = 0;
    for (let k = pv.k - 1; k >= 0; k--) if (kind[k] === opp) { a = wps[k].i; break; }
    let b = n - 1;
    for (let k = pv.k + 1; k < wps.length; k++) if (kind[k] === opp) { b = wps[k].i; break; }
    for (let j = a; j <= b; j++) {
      if (j === pv.i) continue;
      const c = candles[j];
      const m = unit[pv.i] * 0.06;
      if (pv.type === 'high') {
        if (Math.max(c.o, c.c) >= pv.p - m) {
          c.o = Math.min(c.o, pv.p - m);
          c.c = Math.min(c.c, pv.p - m);
        }
        c.h = Math.min(c.h, pv.p - m * 0.5);
        c.h = Math.max(c.h, c.o, c.c);
        c.l = Math.min(c.l, c.o, c.c);
      } else {
        if (Math.min(c.o, c.c) <= pv.p + m) {
          c.o = Math.max(c.o, pv.p + m);
          c.c = Math.max(c.c, pv.p + m);
        }
        c.l = Math.max(c.l, pv.p + m * 0.5);
        c.l = Math.min(c.l, c.o, c.c);
        c.h = Math.max(c.h, c.o, c.c);
      }
    }
    const c = candles[pv.i];
    if (pv.type === 'high') {
      c.h = pv.p;
      c.o = Math.min(c.o, pv.p);
      c.c = Math.min(c.c, pv.p);
      c.l = Math.min(c.l, c.o, c.c);
    } else {
      c.l = pv.p;
      c.o = Math.max(c.o, pv.p);
      c.c = Math.max(c.c, pv.p);
      c.h = Math.max(c.h, c.o, c.c);
    }
  }
  return addVolume(candles, { seed: rng.int(1, 2 ** 31 - 1) });
}

// ------------------------------------------------------------------ path builders (bull frame)

/**
 * Waypoints for a kind drawn in the "bull frame" (lows matter: price falls into them for
 * 'bullish'; an uptrend for 'hidden-bullish' and 'none'). Bearish kinds mirror these.
 * `contrast` (1 easy → ~0.55 hard) scales how different the two legs' chop is.
 * → { wps: [{ i, p, chop }], A, B, S (swing between them), D (decision idx), count }
 */
function bullFramePath(kind, rng, { outcome = 'expected', tuned = false, contrast = 1, flatBase = false } = {}) {
  const S0 = 100;
  const U = S0 * 0.1;
  const R = (lo, hi) => (tuned ? (lo + hi) / 2 : rng.float(lo, hi));
  const I = (lo, hi) => (tuned ? Math.round((lo + hi) / 2) : rng.int(lo, hi));
  const mix = (clean, choppy) => clean + (choppy - clean) * (0.5 + 0.5 * contrast); // contrast < 1 → legs look more alike
  const mixClean = (clean, choppy) => choppy + (clean - choppy) * (0.5 + 0.5 * contrast);
  const wps = [];
  const W = (i, p, chop) => wps.push({ i, p, chop });
  let A;
  let B;
  let Sx;
  let D;
  if (kind === 'bullish') {
    // A push up into H0, a long clean drop to A (RSI deeply oversold), a solid bounce, then a
    // choppy slide to a slightly lower low B: price lower low, RSI higher low.
    W(0, S0 - 0.1 * U, 0);
    const h0 = PRE + I(4, 7);
    W(h0 - 6, S0 + 0.05 * U, 0.85);
    const H0 = S0 + R(0.4, 0.55) * U;
    W(h0, H0, 0.3);
    const D1 = U * R(1.1, 1.3);
    const a = h0 + I(12, 14);
    A = { idx: a, price: H0 - D1 };
    W(a, A.price, mixClean(0.04, 0.4));
    const h1 = a + I(6, 8);
    Sx = { idx: h1, price: A.price + D1 * R(0.45, 0.58) };
    W(h1, Sx.price, 0.25);
    const b = h1 + I(9, 12);
    B = { idx: b, price: A.price - D1 * R(0.07, 0.15) };
    W(b, B.price, mix(0.35, 0.8));
    D = b + 4;
    W(D, B.price + (Sx.price - B.price) * 0.13, 0.4);
    if (outcome === 'expected') {
      W(D + I(9, 11), Sx.price + (Sx.price - B.price) * R(0.25, 0.45), 0.3);
      W(D + AFTER, Sx.price + (Sx.price - B.price) * R(0.1, 0.25), 0.6);
    } else {
      W(D + 4, B.price + (Sx.price - B.price) * R(0.3, 0.4), 0.4);
      W(D + 13, B.price - D1 * R(0.25, 0.4), 0.2);
      W(D + AFTER, B.price - D1 * R(0.15, 0.3), 0.6);
    }
  } else if (kind === 'hidden-bullish') {
    // Uptrend: a choppy rally, a choppy pullback to A (RSI only dips to the middle), a clean rally
    // to a higher high, then a sharp, clean dip to a higher low B that drags RSI below its A low.
    const l0 = PRE + I(3, 6);
    const U1 = U * R(0.9, 1.1);
    const h1 = l0 + I(12, 14);
    const H1 = S0 + U1;
    W(0, S0 + 0.5 * U, 0);
    W(l0 - 8, S0 + 0.25 * U, 0.7);
    W(l0, S0, 0.2);
    W(h1, H1, 0.55);
    const a = h1 + I(10, 12);
    A = { idx: a, price: H1 - U1 * R(0.3, 0.36) };
    W(a, A.price, mix(0.45, 1));
    const h2 = a + I(7, 9);
    Sx = { idx: h2, price: H1 + U1 * R(0.35, 0.5) };
    W(h2, Sx.price, 0.05);
    const b = h2 + I(7, 9);
    B = { idx: b, price: A.price + (Sx.price - A.price) * R(0.13, 0.22) };
    W(b, B.price, mixClean(0, 0.4));
    D = b + 4;
    W(D, B.price + (Sx.price - B.price) * 0.16, 0.4);
    if (outcome === 'expected') {
      W(D + I(9, 11), Sx.price + (Sx.price - B.price) * R(0.2, 0.35), 0.3);
      W(D + AFTER, Sx.price + (Sx.price - B.price) * R(0.05, 0.2), 0.6);
    } else {
      W(D + 4, B.price + (Sx.price - B.price) * R(0.3, 0.4), 0.4);
      W(D + 13, A.price - U1 * R(0.2, 0.3), 0.2);
      W(D + AFTER, A.price - U1 * R(0.1, 0.2), 0.6);
    }
  } else {
    // 'none': a healthy, accelerating uptrend. A choppy first rally to H1, a mild pullback, then a
    // clean, stronger rally to a higher high: price and momentum both make a higher high (and a
    // higher low before it). The chart stops a few candles after the new high, like a bearish one.
    // MACD histogram: the base low sits just before the visible window (every pullback from a
    // quiet base makes a deeper histogram trough than the base itself, which would read as hidden
    // divergence), so the visible read is the two highs; the first rally is slower than the second.
    const l0 = flatBase ? PRE - I(1, 3) : PRE + I(3, 6);
    const U1 = U * R(0.8, 1.0);
    let h1;
    if (flatBase) {
      W(0, S0 + 0.08 * U, 0);
      W(l0 - 9, S0 + 0.12 * U, 0.95);
      W(l0, S0, 0.6);
      h1 = l0 + I(14, 16);
      W(h1, S0 + U1 * 0.8, 0.7);
    } else {
      W(0, S0 + 0.5 * U, 0);
      W(l0 - 8, S0 + 0.25 * U, 0.6);
      W(l0, S0, 0.15);
      h1 = l0 + I(13, 15);
      W(h1, S0 + U1, mix(0.45, 0.85));
    }
    const H1 = wps[wps.length - 1].p;
    A = { idx: h1, price: H1 };
    const a = h1 + I(6, 8);
    Sx = { idx: a, price: H1 - U1 * (flatBase ? R(0.38, 0.48) : R(0.3, 0.4)) };
    W(a, Sx.price, 0.5);
    const h2 = a + I(8, 10);
    B = { idx: h2, price: H1 + U1 * (flatBase ? R(0.65, 0.85) : R(0.45, 0.65)) };
    W(h2, B.price, mixClean(0.02, 0.4));
    D = h2 + 4;
    W(D, B.price - (B.price - Sx.price) * 0.12, 0.4);
    W(D + I(8, 10), B.price + (B.price - Sx.price) * R(0.2, 0.35), 0.3);
    W(D + AFTER, B.price + (B.price - Sx.price) * R(0.05, 0.2), 0.6);
    return { wps, A, B, S: Sx, D, count: D + AFTER + 1, side: 'high' };
  }
  return { wps, A, B, S: Sx, D, count: D + AFTER + 1, side: 'low' };
}

// ------------------------------------------------------------------ scenario

function oscSeries(candles, kind) {
  const cl = closes(candles);
  const m = macd(cl);
  return { rsi: rsi(cl, 14), macd: m, osc: kind === 'macd' ? m.hist : rsi(cl, 14) };
}

/**
 * Checks a built series against the intended kind. → { ok, read, reason }
 */
function validate(candles, osc, plan, { kind, oscKind, difficulty, outcome, frame }) {
  const from = PRE;
  const D = plan.D;
  const read = readDivergence(candles, osc, { from, decision: D, oscKind });
  const tSide = plan.side; // the side the signal is read on ('none': the new extreme and the one before it)
  const target = tSide === 'low' ? read.lows : read.highs;
  const other = tSide === 'low' ? read.highs : read.lows;
  const near = (p, q) => p && q && Math.abs(p.idx - q.idx) <= 1;
  if (!target || !near(target.A, plan.A) || !near(target.B, plan.B)) return { ok: false, read, reason: 'target swings' };
  // Clear, not subtle: the price step and the oscillator step must both be visible.
  // RSI points (MACD: fraction of the largest histogram bar in view). Regular divergences are
  // clearer than hidden ones by nature, so they get the stricter bar; harder rounds are subtler.
  const pxMin = 0.9 - 0.4 * difficulty;
  const hidden = kind === 'hidden-bullish' || kind === 'hidden-bearish';
  const oscMin = oscKind === 'macd'
    ? (hidden ? 0.2 : 0.26) - 0.1 * difficulty
    : hidden ? 8 - 3 * difficulty : 10 - 4.5 * difficulty;
  const agreeMin = oscKind === 'macd' ? 0.08 : 2.5;
  if (kind === 'none') {
    const noneMin = oscKind === 'macd' ? 0.2 - 0.08 * difficulty : 8 - 4 * difficulty;
    if (target.rel !== 'agree' || Math.abs(target.priceDiff) < pxMin || Math.abs(target.oscDiff) < noneMin) return { ok: false, read, reason: 'none target' };
  } else {
    if (target.rel !== kind) return { ok: false, read, reason: `target rel ${target.rel}` };
    if (Math.abs(target.priceDiff) < pxMin || Math.abs(target.oscDiff) < oscMin) return { ok: false, read, reason: 'target weak' };
  }
  // The other side must not tell a different story (a second, conflicting divergence).
  // It must also have the trend's own structure (a higher low in an uptrend, a lower high in a
  // downtrend), so the chart tells one clean story.
  if (other) {
    if (other.rel !== 'agree' || Math.abs(other.oscDiff) < agreeMin || Math.abs(other.priceDiff) < 0.5) return { ok: false, read, reason: `other ${other.rel}` };
    const trendUp = (kind === 'bullish' || kind === 'bearish' ? -1 : 1) * frame > 0;
    if (trendUp !== other.priceDiff > 0) return { ok: false, read, reason: 'other structure' };
  } else if (kind === 'none' && oscKind !== 'macd') return { ok: false, read, reason: 'none other missing' };
  // Regular divergence is read from an extreme: RSI oversold / overbought at the first swing.
  if (oscKind === 'rsi' && DIV_INFO[kind].regular) {
    const va = target.oa.value;
    if (kind === 'bullish' ? va > 36 : va < 64) return { ok: false, read, reason: 'not extreme' };
  }
  if (oscKind === 'macd' && kind !== 'none') {
    const neg = tSide === 'low';
    if (neg ? target.oa.value >= 0 || target.ob.value >= 0 : target.oa.value <= 0 || target.ob.value <= 0) return { ok: false, read, reason: 'macd side' };
  }
  // No candle after B (before the decision) may take out B: the swing must look finished.
  const dir = tSide === 'low' ? 1 : -1;
  for (let i = plan.B.idx + 1; i <= D; i++) {
    if (dir > 0 ? candles[i].l <= plan.B.price : candles[i].h >= plan.B.price) return { ok: false, read, reason: 'b retest' };
  }
  // Outcome: the expected reaction breaks the structure swing between A and B; a failed one takes
  // out the low / high the signal relied on. 'none': the trend carries on to a new extreme.
  const after = candles.slice(D + 1);
  const beyond = (c, level, up) => (up ? c.c > level : c.c < level);
  if (kind === 'none') {
    const up = dir < 0; // the new extreme was a high → uptrend
    const cont = after.some((c) => beyond(c, plan.B.price, up));
    const broke = after.some((c) => beyond(c, plan.S.price, !up));
    if (!cont || broke) return { ok: false, read, reason: 'outcome none' };
  } else {
    const Sx = plan.S.price;
    const brokeStruct = after.some((c) => beyond(c, Sx, dir > 0));
    const lostLevel = kind === 'hidden-bullish' || kind === 'hidden-bearish' ? plan.A.price : plan.B.price;
    const failed = after.some((c) => (dir > 0 ? c.l < lostLevel : c.h > lostLevel));
    if (outcome === 'expected' && (!brokeStruct || failed)) return { ok: false, read, reason: 'outcome expected' };
    if (outcome === 'failed' && (!failed || brokeStruct)) return { ok: false, read, reason: 'outcome failed' };
  }
  return { ok: true, read, reason: '' };
}

/**
 * divergenceScenario(kind, { seed, difficulty = 0.3, osc = 'rsi', outcome = 'expected', frame })
 *   kind: one of DIV_KINDS. osc: 'rsi' | 'macd' (MACD histogram). outcome: 'expected' | 'failed'
 *   ('none' always continues). frame: 1 (lows / uptrend) or −1 (mirrored); default: bearish kinds
 *   −1, bullish +1, 'none' random.
 * → { kind, osc, frame, candles, decisionIdx, lead, rsi, macd, oscValues, a, b, structure,
 *     other, read, outcome, tuned, tries }
 *   candles = the visible window (decision + AFTER outcome candles); lead = the warm-up before it;
 *   rsi / macd / oscValues are aligned with candles. a / b: the swings that form the signal
 *   ({ idx, price, type, oscIdx, osc }), structure: the swing between them ({ idx, price, type }),
 *   other: the other side's pair (agreeing) or null.
 */
export function divergenceScenario(kind, { seed = 1, difficulty = 0.3, osc = 'rsi', outcome = 'expected', frame = null, maxTries = 30, onTry = null } = {}) {
  const info = DIV_INFO[kind] || DIV_INFO.bullish;
  const k = info.id;
  const base = makeRng(seed);
  const fr = frame === 1 || frame === -1 ? frame : k === 'none' ? (base.chance(0.5) ? 1 : -1) : info.bias < 0 ? -1 : 1;
  const out = k === 'none' ? 'expected' : outcome === 'failed' ? 'failed' : 'expected';
  const d = clamp(Number(difficulty) || 0, 0, 1);
  const bullKind = k === 'bearish' ? 'bullish' : k === 'hidden-bearish' ? 'hidden-bullish' : k;
  const start = Math.round(base.float(60, 140));
  let tries = 0;
  const attempt = (rng, tuned, dv = d) => {
    const plan = bullFramePath(bullKind, rng, { outcome: out, tuned, contrast: tuned ? 1 : 1 - 0.45 * d, flatBase: osc === 'macd' });
    // Mirror for the bearish frame (around the start price), then scale to the chosen price level.
    const m = (p) => (fr > 0 ? p : 200 - p) * (start / 100);
    const wps = plan.wps.map((w) => ({ ...w, p: m(w.p) }));
    const candles = buildSeries(wps, rng.fork('series'), { noise: tuned ? 0.15 : 0.2 + 0.4 * d });
    const mp = (q) => ({ idx: q.idx, price: m(q.price) });
    const flip = (x) => (x === 'low' ? 'high' : 'low');
    const P = { A: mp(plan.A), B: mp(plan.B), S: mp(plan.S), D: plan.D, side: fr > 0 ? plan.side : flip(plan.side) };
    const series = oscSeries(candles, osc);
    const v = validate(candles, series.osc, P, { kind: k, oscKind: osc, difficulty: dv, outcome: out, frame: fr });
    return { v, candles, series, P, tuned };
  };
  let res = null;
  for (let t = 0; t < maxTries && !res; t++) {
    tries++;
    const r = attempt(base.fork(`try-${t}`), false);
    onTry?.(r);
    if (r.v.ok) res = r;
  }
  // Hand-tuned path (mid-range shape, low noise), first at this difficulty's clarity bar, then at
  // the minimum clarity any round accepts (still an unambiguous, textbook read).
  for (let t = 0; t < maxTries && !res; t++) {
    tries++;
    const r = attempt(base.fork(`tuned-${t}`), true);
    onTry?.(r);
    if (r.v.ok) res = r;
  }
  for (let t = 0; t < maxTries && !res; t++) {
    tries++;
    const r = attempt(base.fork(`tuned-min-${t}`), true, 1);
    onTry?.(r);
    if (r.v.ok) res = r;
  }
  if (!res) return null;
  return packScenario(res, { kind: k, osc, frame: fr, outcome: out, tries });
}

function packScenario(res, { kind, osc, frame, outcome, tries }) {
  const { candles, series, P, v, tuned } = res;
  const from = PRE;
  const slice = (arr) => arr.slice(from);
  const rel = (p) => (p ? { ...p, idx: p.idx - from } : null);
  const side = P.side;
  const target = side === 'low' ? v.read.lows : v.read.highs;
  const other = side === 'low' ? v.read.highs : v.read.lows;
  const sw = (s, o) => ({ idx: s.idx - from, price: s.price, type: s.type, oscIdx: o.idx - from, osc: o.value });
  // The swing between A and B (the level a close must break to confirm the signal).
  const between = v.read.swings.filter((s) => s.idx > target.A.idx && s.idx < target.B.idx && s.type !== side);
  const st = between.length
    ? between.reduce((best, s) => ((side === 'low' ? s.price > best.price : s.price < best.price) ? s : best))
    : { idx: P.S.idx, price: P.S.price, type: side === 'low' ? 'high' : 'low' };
  return {
    kind,
    osc,
    frame,
    candles: candles.slice(from),
    lead: candles.slice(0, from),
    decisionIdx: P.D - from,
    rsi: slice(series.rsi),
    macd: { macd: slice(series.macd.macd), signal: slice(series.macd.signal), hist: slice(series.macd.hist) },
    oscValues: slice(series.osc),
    a: sw(target.A, target.oa),
    b: sw(target.B, target.ob),
    structure: rel({ idx: st.idx, price: st.price, type: st.type }),
    other: other ? { a: sw(other.A, other.oa), b: sw(other.B, other.ob), rel: other.rel } : null,
    swings: v.read.swings.map((s) => rel({ idx: s.idx, price: s.price, type: s.type })),
    outcome,
    tuned,
    tries,
  };
}

/**
 * Checks a real (scanner) window: the scanner's divergence must be the pair a trader reads (the
 * last two significant lows / highs) and the other side must not disagree; for trend windows
 * ('none') both pairs must clearly agree. r: realRound result; kind: DIV_KINDS id.
 * → { ok, reason, a, b, structure, other, rsi, swings } (indexes window-relative)
 */
export function checkRealWindow(r, kind) {
  if (!r || !Array.isArray(r.candles) || !r.candles.length) return { ok: false, reason: 'no data' };
  const lead = Array.isArray(r.lead) ? r.lead : [];
  const all = [...lead, ...r.candles];
  const off = lead.length;
  const D = off + r.decisionIdx;
  const R = rsi(closes(all), 14);
  const read = readDivergence(all, R, { from: off, decision: D, oscKind: 'rsi' });
  const agree = (p) => p && p.rel === 'agree' && Math.abs(p.oscDiff) >= 2.5 && Math.abs(p.priceDiff) >= 0.5;
  let target;
  let other;
  if (kind === 'none') {
    const up = r.setup?.direction !== 'bearish';
    target = up ? read.lows : read.highs;
    other = up ? read.highs : read.lows;
    if (!agree(target) || !agree(other)) return { ok: false, reason: 'trend swings do not agree' };
    // The latest swing should be recent enough to matter.
    if (target.B.idx < D - 25) return { ok: false, reason: 'stale' };
  } else {
    const side = DIV_INFO[kind].side;
    target = side === 'low' ? read.lows : read.highs;
    other = side === 'low' ? read.highs : read.lows;
    const m = r.setup?.meta || {};
    const near = (p, q) => p && q && Number.isFinite(q.idx) && Math.abs(p.idx - (q.idx + off)) <= 2;
    if (!target || target.rel !== kind || Math.abs(target.oscDiff) < 4 || Math.abs(target.priceDiff) < 0.3) return { ok: false, reason: 'target' };
    if (!near(target.A, m.a) || !near(target.B, m.b)) return { ok: false, reason: 'not the last two swings' };
    // The other side must agree, or be flat on both counts (nothing to read there).
    if (other && !agree(other)) {
      if (other.rel === 'flat' && Math.abs(other.oscDiff) < 3) other = null;
      else return { ok: false, reason: 'other side disagrees' };
    }
  }
  const side = target.A.type;
  const between = read.swings.filter((s) => s.idx > target.A.idx && s.idx < target.B.idx && s.type !== side);
  const st = between.length ? between.reduce((best, s) => ((side === 'low' ? s.price > best.price : s.price < best.price) ? s : best)) : null;
  const sw = (s, o) => ({ idx: s.idx - off, price: s.price, type: s.type, oscIdx: o.idx - off, osc: o.value });
  return {
    ok: true,
    reason: '',
    a: sw(target.A, target.oa),
    b: sw(target.B, target.ob),
    structure: st ? { idx: st.idx - off, price: st.price, type: st.type } : null,
    other: other ? { a: sw(other.A, other.oa), b: sw(other.B, other.ob), rel: other.rel } : null,
    rsi: R.slice(off),
    swings: read.swings.map((s) => ({ idx: s.idx - off, price: s.price, type: s.type })),
  };
}

export const SCENARIO_CONST = { PRE, AFTER };
