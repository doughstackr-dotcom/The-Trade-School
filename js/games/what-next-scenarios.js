// What Happens Next? — the scenario library (pure module: no DOM, importable from node).
//
// Every scenario is a seeded generator that builds a chart frozen at a decision point:
//   { candles, decisionIdx, answer, title, explanation, annotations, tellTale, … }
// and is VALIDATED in code (generate-and-test): the setup must really be on the chart (touches,
// candle-pattern rules, the scanner's own detectors for chart patterns, RSI readings…) and the
// reveal must really go the stated way by a clear margin (in ATRs). A failed draft is regenerated
// with a forked seed (max 30 tries), then a calm hand-tuned path is used.
//
// Bullish / bearish twins are generated once in "bull space" and mirrored (price → 2·P − price,
// RSI → 100 − RSI), so a resistance rejection is an exact mirror of a support bounce.
import { makeRng } from '../core/rng.js';
import { fromPath, addVolume, aggregate } from '../core/data.js';
import { CANDLE_PATTERNS, CANDLE_RULES, chartScenario } from '../core/patterns.js';
import { atr as atrOf, ema, rsi as rsiOf, closes as closesOf } from '../core/indicators.js';
import { findSetups } from '../core/scanner.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r = Math.round;
const SEED = (rng) => rng.int(1, 2 ** 31 - 1);
const MAX_TRIES = 30;

// ------------------------------------------------------------------------------------------
// Answers
// ------------------------------------------------------------------------------------------

export const ANSWERS = {
  beginner: [
    { id: 'up', label: 'Up', short: 'Up', icon: 'trend-up', keys: ['↑', 'U'] },
    { id: 'down', label: 'Down', short: 'Down', icon: 'trend-down', keys: ['↓', 'D'] },
    { id: 'sideways', label: 'Sideways', short: 'Sideways', icon: 'arrow-right', keys: ['→', 'S'] },
  ],
  advanced: [
    { id: 'long', label: 'Long', short: 'Long', icon: 'trend-up', keys: ['↑', 'L'] },
    { id: 'short', label: 'Short', short: 'Short', icon: 'trend-down', keys: ['↓', 'S'] },
    { id: 'wait', label: 'Wait', short: 'Wait (no edge)', icon: 'clock', keys: ['→', 'W'] },
  ],
};

/** 'up' | 'long' → 1, 'down' | 'short' → −1, else 0. */
export function answerDir(a) {
  return a === 'up' || a === 'long' ? 1 : a === 'down' || a === 'short' ? -1 : 0;
}

/** The answer id for a direction in a mode (1 → up / long, −1 → down / short, 0 → sideways / wait). */
export function answerFor(mode, dir) {
  if (mode === 'advanced') return dir > 0 ? 'long' : dir < 0 ? 'short' : 'wait';
  return dir > 0 ? 'up' : dir < 0 ? 'down' : 'sideways';
}

// ------------------------------------------------------------------------------------------
// Candle helpers
// ------------------------------------------------------------------------------------------

function fixK(k) {
  k.h = Math.max(k.h, k.o, k.c);
  k.l = Math.min(k.l, k.o, k.c);
  return k;
}

function basePrice(rng) {
  return Math.round(rng.float(45, 160) * 100) / 100;
}

/** Noise knob for fromPath: calm on easy rounds, messier as difficulty rises. */
function noiseOf(o) {
  return o.handTuned ? 0.14 : 0.2 + 0.36 * clamp(o.difficulty ?? 0.5, 0, 1);
}

/** Candles following waypoints [[idx, price], …] over n candles (idx 0 … n − 1). */
function path(rng, pts, n, noise) {
  return fromPath(pts.map(([i, p]) => [i / (n - 1), p]), { seed: SEED(rng), count: n, noise, wick: 0.6, volume: false, exact: true });
}

/** Appends F candles that follow waypoints [[j (1 … F), price], …] starting from the last close. */
function extend(rng, candles, pts, F, noise) {
  const last = candles[candles.length - 1].c;
  const res = fromPath([[0, last], ...pts.map(([j, p]) => [j / F, p])], { seed: SEED(rng), count: F + 1, noise, wick: 0.6, volume: false, exact: true });
  const tail = res.candles.slice(1).map((k) => ({ ...k }));
  tail[0].o = last;
  fixK(tail[0]);
  return candles.concat(tail);
}

function withVolume(rng, candles) {
  return addVolume(candles.map((k, i) => ({ ...k, t: i })), { seed: SEED(rng) });
}

function avgVol(cs, a, b) {
  const s = cs.slice(Math.max(0, a), Math.max(a + 1, b));
  return s.reduce((t, k) => t + (k.v || 0), 0) / Math.max(1, s.length);
}

/** Replace candle i and make the next candle open where it closed. */
function setCandle(cs, i, k) {
  cs[i] = fixK({ ...cs[i], ...k });
  if (cs[i + 1]) {
    cs[i + 1] = fixK({ ...cs[i + 1], o: cs[i].c });
  }
}

const minLow = (cs, a, b) => {
  let m = Infinity;
  for (let i = Math.max(0, a); i <= Math.min(cs.length - 1, b); i++) m = Math.min(m, cs[i].l);
  return m;
};
const maxHigh = (cs, a, b) => {
  let m = -Infinity;
  for (let i = Math.max(0, a); i <= Math.min(cs.length - 1, b); i++) m = Math.max(m, cs[i].h);
  return m;
};
const argMinLow = (cs, a, b) => {
  let k = a;
  for (let i = a; i <= b; i++) if (cs[i].l < cs[k].l) k = i;
  return k;
};
const argMaxHigh = (cs, a, b) => {
  let k = a;
  for (let i = a; i <= b; i++) if (cs[i].h > cs[k].h) k = i;
  return k;
};

/** What happened after the decision: moves and excursions in ATRs (ATR 14 at the decision). */
export function measure(candles, d, F) {
  const A = atrOf(candles, 14)[d] || (candles[d].h - candles[d].l) || 1;
  const end = Math.min(candles.length - 1, d + F);
  const base = candles[d].c;
  let hi = -Infinity;
  let lo = Infinity;
  let hiC = -Infinity;
  let loC = Infinity;
  for (let j = d + 1; j <= end; j++) {
    hi = Math.max(hi, candles[j].h);
    lo = Math.min(lo, candles[j].l);
    hiC = Math.max(hiC, candles[j].c);
    loC = Math.min(loC, candles[j].c);
  }
  const move = candles[end].c - base;
  return {
    atr: A,
    end,
    bars: end - d,
    move,
    moveAtr: move / A,
    pct: (move / base) * 100,
    maxUp: (hi - base) / A,
    maxDown: (base - lo) / A,
    maxUpClose: (hiC - base) / A,
    maxDownClose: (base - loC) / A,
    hi,
    lo,
  };
}

/** Did the reveal behave as expected ('up' | 'down' | 'flat' | 'whipsaw'), by a clear margin? */
function outcomeOk(m, expect) {
  if (expect === 'up') return m.moveAtr >= 2;
  if (expect === 'down') return m.moveAtr <= -2;
  if (expect === 'fail-up') return m.moveAtr >= 1.5; // a bearish read that failed (bull space mirror)
  if (expect === 'fail-down') return m.moveAtr <= -1.5;
  if (expect === 'flat') return Math.abs(m.moveAtr) <= 1 && m.maxUpClose <= 2.6 && m.maxDownClose <= 2.6;
  if (expect === 'whipsaw') return m.maxUp >= 1 && m.maxDown >= 1 && Math.abs(m.moveAtr) <= 1.5;
  return false;
}

// ------------------------------------------------------------------------------------------
// Mirroring (bull space → bear space)
// ------------------------------------------------------------------------------------------

function mirrorCandles(cs, P0) {
  return cs.map((k) => ({ ...k, o: 2 * P0 - k.o, c: 2 * P0 - k.c, h: 2 * P0 - k.l, l: 2 * P0 - k.h }));
}

function mirrorSpec(s, P0) {
  const f = s.pane === 'rsi' ? (p) => (isNum(p) ? 100 - p : p) : (p) => (isNum(p) ? 2 * P0 - p : p);
  const o = { ...s };
  if ('price' in s) o.price = f(s.price);
  if (s.a) o.a = { ...s.a, price: f(s.a.price) };
  if (s.b) o.b = { ...s.b, price: f(s.b.price) };
  if (s.type === 'zone') {
    o.from = f(s.to);
    o.to = f(s.from);
  }
  if (s.type === 'box' && isNum(s.top) && isNum(s.bottom)) {
    o.top = f(s.bottom);
    o.bottom = f(s.top);
  }
  if (Array.isArray(s.points)) o.points = s.points.map((p) => ({ ...p, price: f(p.price) }));
  if (s.position === 'above') o.position = 'below';
  else if (s.position === 'below') o.position = 'above';
  return o;
}

function mirrorDraft(dr, P0) {
  const flip = { up: 'down', down: 'up', 'fail-up': 'fail-down', 'fail-down': 'fail-up', flat: 'flat', whipsaw: 'whipsaw' };
  return {
    ...dr,
    candles: mirrorCandles(dr.candles, P0),
    aids: (dr.aids || []).map((s) => mirrorSpec(s, P0)),
    annotations: (dr.annotations || []).map((s) => mirrorSpec(s, P0)),
    htf: dr.htf ? { ...dr.htf, candles: mirrorCandles(dr.htf.candles, P0), full: dr.htf.full ? mirrorCandles(dr.htf.full, P0) : null, overlays: (dr.htf.overlays || []).map((s) => mirrorSpec(s, P0)) } : null,
    expect: flip[dr.expect] || dr.expect,
    mirrored: true,
  };
}

// Overlay spec shorthands (data space).
const HL = (price, o = {}) => ({ type: 'hline', price, dashed: true, ...o });
const RING = (idx, price, o = {}) => ({ type: 'marker', idx, price, position: 'at', shape: 'ring', color: 'accent', ...o });
const ARROW = (idx, position, text, o = {}) => ({ type: 'marker', idx, position, shape: 'arrow', text, color: 'accent', ...o });
const SEG = (a, b, o = {}) => ({ type: 'segment', a, b, ...o });
const aidLine = (price, from) => ({ type: 'hline', price, from, color: 'muted', dashed: true, priceTag: false, width: 1.25 });

/** Close-by lows (highs) at a level: indexes among `idxs` within tol of the level. */
function touchesAt(cs, idxs, level, tol, side) {
  return idxs.filter((i) => Math.abs((side === 'low' ? cs[i].l : cs[i].h) - level) <= tol);
}

function draftOk(dr) {
  const failed = Object.entries(dr.checks || {}).filter(([, v]) => !v).map(([k]) => k);
  const m = measure(dr.candles, dr.d, dr.F);
  const out = outcomeOk(m, dr.expect) && (dr.outcomeCheck ? dr.outcomeCheck(m) : true);
  if (!out) failed.push(`outcome:${dr.expect}`);
  dr.failedChecks = failed;
  dr.ok = failed.length === 0;
  return dr;
}

// ------------------------------------------------------------------------------------------
// Beginner generators
// ------------------------------------------------------------------------------------------

/** Support bounce (bull space) → resistance rejection when mirrored. */
function genLevelReact(rng, o, bear) {
  const D = o.difficulty;
  const noise = noiseOf(o);
  const P = basePrice(rng);
  const u = P / 100;
  const S = P;
  const three = o.handTuned || D < 0.5 || rng.chance(0.3);
  const nP = r(52 - 12 * D) + rng.int(0, 6);
  const e = nP - 1;
  const d = nP;
  const F = rng.int(18, 22);
  const h1 = rng.float(4.5, 6.5) * u;
  const h2 = rng.float(3.8, 5.5) * u;
  const pts = three
    ? [[0, S + rng.float(2.5, 4) * u], [r(0.2 * e), S], [r(0.42 * e), S + h1], [r(0.64 * e), S + rng.float(-0.12, 0.15) * u], [r(0.83 * e), S + h2], [e, S + rng.float(0.6, 1.0) * u]]
    : [[0, S + rng.float(1.5, 3) * u], [r(0.16 * e), S + h1 * 1.05], [r(0.46 * e), S + rng.float(-0.1, 0.12) * u], [r(0.74 * e), S + h2], [e, S + rng.float(0.6, 1.0) * u]];
  const { candles: past, anchors } = path(rng, pts, nP, noise);
  const touchIdx = anchors.filter((a) => a.kind === 'low').map((a) => a.idx);
  const A0 = atrOf(past, 14)[e] || u;
  const prev = past[e].c;
  const k = (0.95 - 0.45 * D) * rng.float(0.9, 1.15);
  const c = Math.max(S + k * A0, prev + 0.25 * A0);
  let cs = past.concat([fixK({ o: prev, h: c + rng.float(0.05, 0.25) * A0, l: S - rng.float(0, 0.12) * A0, c, v: 0 })]);
  cs = extend(rng, cs, [[r(0.3 * F), c + rng.float(2.8, 3.6) * u], [r(0.55 * F), c + rng.float(1.6, 2.4) * u], [F, c + rng.float(4.8, 6.5) * u]], F, noise);
  cs = withVolume(rng, cs);
  const A = atrOf(cs, 14)[d];
  const dk = cs[d];
  const touches = touchesAt(cs, touchIdx, S, 0.35 * A, 'low');
  let held = true;
  for (let i = 0; i < d; i++) if (cs[i].c < S - 0.1 * A || cs[i].l < S - 0.4 * A) held = false;
  const top = maxHigh(cs, touchIdx[0] ?? 0, d);
  const m = { minLow: minLow(cs, d + 1, d + F) };
  const n = touches.length;
  const W = (a, b) => (bear ? b : a);
  const dr = {
    P,
    candles: cs,
    d,
    F,
    expect: 'up',
    checks: {
      touches: n >= (three ? 2 : 1),
      held,
      green: dk.c > dk.o,
      closeOff: dk.c - S >= 0.4 * A,
      tagged: dk.l <= S + 0.25 * A,
      nearFloor: dk.c - S <= 0.45 * (top - S),
      lowest: dk.l <= minLow(cs, d - 6, d - 1) + 0.05 * A,
    },
    outcomeCheck: () => m.minLow >= S - 0.3 * A,
    show: {},
    aids: o.difficulty < 0.4 ? [aidLine(S, touchIdx[0])] : [],
    annotations: [
      HL(S, { from: touchIdx[0], color: W('support', 'resistance'), label: W('Support', 'Resistance') }),
      ...touches.map((i) => RING(i, S, { color: W('support', 'resistance') })),
      ARROW(d, 'below', W('Bounce', 'Rejected')),
    ],
    viewFrom: Math.max(0, (touchIdx[0] ?? 0) - 5),
    title: W('Bounce off support', 'Rejection at resistance'),
    explanation: W(
      `Price fell back to a level where buyers had stepped in ${n === 1 ? 'once' : `${n} times`} before. The last candle dipped into that support and closed well above it: buyers defended the floor again. Support tends to hold until price closes clearly below it, so the higher-probability call was <strong>up</strong>.`,
      `Price rallied back to a level where sellers had turned it lower ${n === 1 ? 'once' : `${n} times`} before. The last candle poked into that resistance and closed well below it: sellers defended the ceiling again. Resistance tends to hold until price closes clearly above it, so the higher-probability call was <strong>down</strong>.`,
    ),
    tellTale: W('A floor that held before, tested again, and a candle that closes well off its low.', 'A ceiling that capped price before, tested again, and a candle that closes well off its high.'),
    hint: W('Compare the last candle’s low with the earlier lows. What happened each time price got down there?', 'Compare the last candle’s high with the earlier highs. What happened each time price got up there?'),
  };
  draftOk(dr);
  return bear ? mirrorDraft(dr, P) : dr;
}

/** Uptrend pullback to a higher low (bull space) → downtrend rally to a lower high. */
function genTrendPullback(rng, o, bear) {
  const D = o.difficulty;
  const noise = noiseOf(o);
  const P = basePrice(rng);
  const u = P / 100;
  const nP = r(60 - 12 * D) + rng.int(0, 6);
  const e = nP - 1;
  const d = nP;
  const F = rng.int(18, 22);
  const H1 = P + rng.float(4.6, 5.4) * u;
  const L1 = P + rng.float(1.8, 2.4) * u;
  const H2 = P + rng.float(8.2, 9) * u;
  const L2 = P + rng.float(4.8, 5.4) * u;
  const H3 = P + rng.float(11.6, 12.6) * u;
  const L3 = P + rng.float(7.9, 8.6) * u;
  const pts = [[0, P + 0.4 * u], [r(0.14 * e), H1], [r(0.29 * e), L1], [r(0.47 * e), H2], [r(0.63 * e), L2], [r(0.82 * e), H3], [e, L3 + rng.float(0.3, 0.6) * u]];
  const { candles: past, anchors } = path(rng, pts, nP, noise);
  const A0 = atrOf(past, 14)[e] || u;
  const prev = past[e];
  const o0 = prev.c;
  const c = Math.max(prev.h + rng.float(0.08, 0.25) * A0, o0 + (0.75 - 0.25 * D) * A0);
  let cs = past.concat([fixK({ o: o0, h: c + rng.float(0.05, 0.2) * A0, l: o0 - rng.float(0.2, 0.5) * A0, c, v: 0 })]);
  cs = extend(rng, cs, [[r(0.4 * F), H3 + rng.float(1.3, 1.9) * u], [r(0.6 * F), H3 + rng.float(0.2, 0.6) * u], [F, H3 + rng.float(3.6, 4.6) * u]], F, noise);
  cs = withVolume(rng, cs);
  const A = atrOf(cs, 14)[d];
  const hiIdx = anchors.filter((a) => a.kind === 'high').map((a) => a.idx);
  const loIdx = anchors.filter((a) => a.kind === 'low').map((a) => a.idx);
  const h3i = hiIdx[2];
  const l3i = argMinLow(cs, h3i + 1, d);
  const l3 = cs[l3i].l;
  const hs = hiIdx.map((i) => cs[i].h);
  const ls = loIdx.map((i) => cs[i].l);
  const dk = cs[d];
  const later = { minLow: minLow(cs, d + 1, d + F) };
  const W = (a, b) => (bear ? b : a);
  const dr = {
    P,
    candles: cs,
    d,
    F,
    expect: 'up',
    checks: {
      structure: hiIdx.length === 3 && loIdx.length === 2,
      hh: hs[1] - hs[0] >= A && hs[2] - hs[1] >= A,
      hl: ls[1] - ls[0] >= 0.8 * A && l3 - ls[1] >= 0.8 * A,
      depth: hs[2] - l3 >= 2 * A,
      retrace: (hs[2] - l3) / (hs[2] - ls[1]) >= 0.3 && (hs[2] - l3) / (hs[2] - ls[1]) <= 0.75,
      noBreak: maxHigh(cs, h3i + 1, d) < hs[2] - 0.02 * A,
      turn: dk.c > dk.o && dk.c > cs[d - 1].h,
    },
    outcomeCheck: () => later.minLow >= l3 - 0.2 * A,
    show: {},
    aids: [],
    annotations: [
      { type: 'path', points: [hiIdx[0], loIdx[0], hiIdx[1], loIdx[1], hiIdx[2]].map((i, j) => ({ idx: i, price: j % 2 ? cs[i].l : cs[i].h })).concat([{ idx: l3i, price: l3 }]), color: W('bull', 'bear'), labels: W(['H', 'L', 'HH', 'HL', 'HH', 'HL'], ['L', 'H', 'LL', 'LH', 'LL', 'LH']) },
    ],
    viewFrom: Math.max(0, hiIdx[0] - 6),
    title: W('Uptrend pullback to a higher low', 'Downtrend rally to a lower high'),
    explanation: W(
      'This is an uptrend: each swing high is above the last (higher highs) and each dip stops above the last dip (higher lows). The latest pullback held above the previous low, and the last candle turned back up through the prior candle’s high. Until that pattern breaks, the trend is more likely to continue: <strong>up</strong>.',
      'This is a downtrend: each swing low is below the last (lower lows) and each rally stops below the last rally (lower highs). The latest bounce stalled below the previous high, and the last candle turned back down through the prior candle’s low. Until that pattern breaks, the trend is more likely to continue: <strong>down</strong>.',
    ),
    tellTale: W('Higher highs, higher lows, and a pullback that stopped above the last low.', 'Lower highs, lower lows, and a rally that stopped below the last high.'),
    hint: W('Mark the swing highs and lows. Is each one higher or lower than the one before it?', 'Mark the swing highs and lows. Is each one higher or lower than the one before it?'),
  };
  draftOk(dr);
  return bear ? mirrorDraft(dr, P) : dr;
}

/** Price riding above a rising 20 EMA (bull space) → below a falling one. */
function genEmaRide(rng, o, bear) {
  const D = o.difficulty;
  const noise = noiseOf(o);
  const P = basePrice(rng);
  const u = P / 100;
  const nP = r(66 - 10 * D) + rng.int(0, 6);
  const e = nP - 1;
  const d = nP;
  const F = rng.int(18, 22);
  const pts = [[0, P]];
  let i = 0;
  let p = P;
  while (true) {
    const up = rng.int(7, 9);
    const dn = rng.int(3, 4);
    if (i + up + dn + 6 > e) break;
    i += up;
    p += rng.float(3.2, 4.2) * u;
    pts.push([i, p]);
    i += dn;
    p -= rng.float(0.9, 1.3) * u;
    pts.push([i, p]);
  }
  // Final leg: up, then the last dip toward the average.
  const upLast = Math.max(4, e - i - 5);
  p += rng.float(2.6, 3.4) * u;
  pts.push([i + upLast, p]);
  p -= rng.float(1.3, 1.7) * u;
  pts.push([e, p]);
  const past = path(rng, pts, nP, noise).candles;
  const A0 = atrOf(past, 14)[e] || u;
  const o0 = past[e].c;
  const c = o0 + (0.8 - 0.25 * D) * A0 * rng.float(1, 1.25);
  let cs = past.concat([fixK({ o: o0, h: c + rng.float(0.05, 0.2) * A0, l: o0 - rng.float(0.15, 0.4) * A0, c, v: 0 })]);
  cs = extend(rng, cs, [[r(0.35 * F), c + rng.float(2.6, 3.4) * u], [r(0.55 * F), c + rng.float(1.8, 2.4) * u], [F, c + rng.float(5, 6.5) * u]], F, noise);
  cs = withVolume(rng, cs);
  const A = atrOf(cs, 14)[d];
  const em = ema(closesOf(cs), 20);
  let above = true;
  for (let j = d - 15; j <= d; j++) if (!(cs[j].c >= em[j])) above = false;
  let near = Infinity;
  for (let j = d - 5; j <= d; j++) near = Math.min(near, cs[j].l - em[j]);
  let revealAbove = 0;
  for (let j = d + 1; j <= d + F; j++) if (cs[j].c > em[j]) revealAbove++;
  // Dips that came close to the average (for the rings).
  const dips = [];
  for (let j = d - 30; j <= d; j++) {
    if (j < 22) continue;
    const isMin = cs[j].l <= Math.min(cs[j - 1].l, cs[j - 2].l) && (j === d || cs[j].l <= Math.min(cs[j + 1].l, cs[j + 2]?.l ?? Infinity));
    if (isMin && cs[j].l - em[j] <= 0.9 * A && (!dips.length || j - dips[dips.length - 1] >= 5)) dips.push(j);
  }
  const W = (a, b) => (bear ? b : a);
  const dr = {
    P,
    candles: cs,
    d,
    F,
    expect: 'up',
    checks: {
      above,
      rising: em[d] - em[d - 10] >= 1.2 * A,
      testedEma: near <= 0.8 * A,
      green: cs[d].c > cs[d].o,
    },
    outcomeCheck: () => revealAbove >= 0.8 * F,
    show: { ema20: true },
    aids: [],
    annotations: [
      ...dips.map((j) => RING(j, cs[j].l, { color: W('bull', 'bear') })),
      ARROW(d, 'below', W('Dip bought', 'Rally sold')),
    ],
    viewFrom: Math.max(0, d - 45),
    title: W('Riding above a rising 20 EMA', 'Riding below a falling 20 EMA'),
    explanation: W(
      'The 20 EMA (exponential moving average: an average of the last 20 closes that weights recent ones more) is rising, and price has closed above it for more than 15 candles. Every dip toward the line attracted buyers, and the latest dip just bounced again. A market that respects a rising average is in a healthy uptrend: <strong>up</strong> was the better call.',
      'The 20 EMA (exponential moving average: an average of the last 20 closes that weights recent ones more) is falling, and price has closed below it for more than 15 candles. Every rally toward the line attracted sellers, and the latest rally just turned down again. A market that stays under a falling average is in a healthy downtrend: <strong>down</strong> was the better call.',
    ),
    tellTale: W('Price keeps closing above a rising 20 EMA, and every dip to it gets bought.', 'Price keeps closing below a falling 20 EMA, and every rally to it gets sold.'),
    hint: W('Which way is the line sloping, and where do the dips stop compared with it?', 'Which way is the line sloping, and where do the rallies stop compared with it?'),
  };
  draftOk(dr);
  return bear ? mirrorDraft(dr, P) : dr;
}

/**
 * A reversal candle pattern on a level (bull space): 'bullish-engulfing' → engulfing at support;
 * 'hammer' → mirrored into a shooting star at resistance.
 */
function genCandleAtLevel(rng, o, patternId, bear) {
  const D = o.difficulty;
  const noise = noiseOf(o);
  const P = basePrice(rng);
  const u = P / 100;
  const S = P;
  const pat0 = CANDLE_PATTERNS[patternId];
  const R = u * rng.float(1.15, 1.45);
  let pat = pat0.generate(rng.fork('pattern'), { price: S + 2 * R, range: R }).map((k) => ({ ...k }));
  const shift = S - Math.min(...pat.map((k) => k.l));
  pat = pat.map((k) => ({ ...k, o: k.o + shift, h: k.h + shift, l: k.l + shift, c: k.c + shift }));
  const Q = pat[0].o;
  const two = o.handTuned || D < 0.45;
  const nP = r(50 - 10 * D) + rng.int(0, 5);
  const e = nP - 1;
  const d = nP + pat.length - 1;
  const F = rng.int(18, 22);
  const pts = two
    ? [[0, S + rng.float(2.5, 3.5) * u], [r(0.16 * e), S + rng.float(-0.1, 0.12) * u], [r(0.33 * e), S + rng.float(4.5, 5.5) * u], [r(0.52 * e), S + rng.float(-0.08, 0.15) * u], [r(0.7 * e), S + rng.float(5, 6) * u], [e, Q]]
    : [[0, S + rng.float(1, 2) * u], [r(0.3 * e), S + rng.float(-0.1, 0.12) * u], [r(0.58 * e), S + rng.float(5, 6.5) * u], [e, Q]];
  const { candles: past, anchors } = path(rng, pts, nP, noise);
  const touchIdx = anchors.filter((a) => a.kind === 'low').map((a) => a.idx);
  let cs = past.concat(pat.map((k) => ({ ...k, v: 0 })));
  const last = cs[cs.length - 1].c;
  cs = extend(rng, cs, [[r(0.3 * F), last + rng.float(2.8, 3.6) * u], [r(0.55 * F), last + rng.float(1.8, 2.5) * u], [F, last + rng.float(5, 6.5) * u]], F, noise);
  cs = withVolume(rng, cs);
  // The reversal candle trades on above-average volume.
  const vAvg = avgVol(cs, nP - 10, nP);
  cs[d].v = Math.max(cs[d].v, Math.round(vAvg * rng.float(1.3, 1.7)));
  const A = atrOf(cs, 14)[d];
  const touches = touchesAt(cs, touchIdx, S, 0.35 * A, 'low');
  let held = true;
  for (let i = 0; i < nP; i++) if (cs[i].c < S - 0.1 * A) held = false;
  const patLow = minLow(cs, nP, d);
  const later = { minLow: minLow(cs, d + 1, d + F) };
  const mirrored = bear ? mirrorCandles(cs, P) : null;
  const isEngulf = patternId === 'bullish-engulfing';
  const name = bear ? 'Shooting star' : isEngulf ? 'Bullish engulfing' : 'Hammer';
  const W = (a, b) => (bear ? b : a);
  const dr = {
    P,
    candles: cs,
    d,
    F,
    expect: 'up',
    checks: {
      rule: CANDLE_RULES[patternId](cs, d),
      twinRule: bear ? CANDLE_RULES['shooting-star'](mirrored, d) : true,
      touches: touches.length >= (two ? 2 : 1),
      held,
      atLevel: Math.abs(patLow - S) <= 0.3 * A,
    },
    outcomeCheck: () => later.minLow >= patLow - 0.2 * A,
    show: {},
    aids: o.difficulty < 0.4 ? [aidLine(S, touchIdx[0])] : [],
    annotations: [
      HL(S, { from: touchIdx[0], color: W('support', 'resistance'), label: W('Support', 'Resistance') }),
      ...touches.map((i) => RING(i, S, { color: W('support', 'resistance') })),
      { type: 'box', from: nP, to: d, color: 'accent', label: name },
    ],
    viewFrom: Math.max(0, (touchIdx[0] ?? 0) - 5),
    title: bear ? 'Shooting star at resistance' : isEngulf ? 'Bullish engulfing at support' : 'Hammer at support',
    explanation: bear
      ? 'Price rallied into a level that had already turned it lower. The last candle is a shooting star: buyers pushed it well above the open, then sellers drove it back down to close near the low of the candle, leaving an upper wick at least twice the size of the body. A rejection like that at resistance, after a rally, points <strong>down</strong>.'
      : isEngulf
        ? 'Price fell into a level that had already stopped a decline. There, a red candle was followed by a bigger green candle whose body completely covers ("engulfs") the red body: sellers were in control at the open, buyers by the close. A bullish reversal pattern, at support, after a decline, points <strong>up</strong>.'
        : 'Price fell into a level that had already stopped a decline, and printed a hammer: a long lower wick at least twice the body, closing near the high. Sellers pushed lower and buyers threw them back. A rejection like that at support, after a decline, points <strong>up</strong>.',
    tellTale: bear
      ? 'A long upper wick right into resistance: buyers tried higher prices and were rejected.'
      : isEngulf
        ? 'A green body that swallows the previous red body, right on a floor that held before.'
        : 'A long lower wick right on support: sellers tried lower prices and were rejected.',
    hint: bear ? 'Look at the shape of the last candle, and at where it formed.' : isEngulf ? 'Compare the last two candle bodies, then look at where they formed.' : 'Look at the shape of the last candle, and at where it formed.',
  };
  draftOk(dr);
  return bear ? mirrorDraft(dr, P) : dr;
}

/** Failed breakdown below support on thin volume (bull space) → fakeout above resistance. */
function genFakeout(rng, o, bear) {
  const D = o.difficulty;
  const noise = noiseOf(o);
  const P = basePrice(rng);
  const u = P / 100;
  const S = P;
  const nP = r(54 - 10 * D) + rng.int(0, 5);
  const e = nP - 1;
  const d = nP;
  const F = rng.int(18, 22);
  const pts = [[0, S + rng.float(2, 3) * u], [r(0.18 * e), S], [r(0.38 * e), S + rng.float(4.5, 6) * u], [r(0.6 * e), S + rng.float(-0.08, 0.12) * u], [r(0.8 * e), S + rng.float(4, 5.2) * u], [e, S + rng.float(0.55, 0.85) * u]];
  const { candles: past, anchors } = path(rng, pts, nP, noise);
  const touchIdx = anchors.filter((a) => a.kind === 'low').map((a) => a.idx);
  const A0 = atrOf(past, 14)[e] || u;
  const o0 = past[e].c;
  const lo = S - (0.75 - 0.25 * D) * A0 * rng.float(1, 1.25);
  const c = S + rng.float(0.3, 0.5) * A0;
  let cs = past.concat([fixK({ o: o0, h: Math.max(o0, c) + rng.float(0.05, 0.2) * A0, l: lo, c, v: 0 })]);
  cs = extend(rng, cs, [[r(0.3 * F), c + rng.float(2.6, 3.4) * u], [r(0.55 * F), c + rng.float(1.8, 2.4) * u], [F, c + rng.float(4.8, 6) * u]], F, noise);
  cs = withVolume(rng, cs);
  const vAvg = avgVol(cs, d - 10, d);
  cs[d].v = Math.max(1, Math.round(vAvg * rng.float(0.42, 0.62)));
  const A = atrOf(cs, 14)[d];
  const touches = touchesAt(cs, touchIdx, S, 0.35 * A, 'low');
  let held = true;
  for (let i = 0; i < d; i++) if (cs[i].c < S - 0.05 * A || cs[i].l < S - 0.3 * A) held = false;
  const dk = cs[d];
  const later = [];
  for (let j = d + 1; j <= d + F; j++) later.push(cs[j].c);
  const ratio = cs[d].v / vAvg;
  const W = (a, b) => (bear ? b : a);
  const dr = {
    P,
    candles: cs,
    d,
    F,
    expect: 'up',
    checks: {
      touches: touches.length >= 2,
      held,
      poked: dk.l <= S - 0.35 * A,
      backInside: dk.c >= S + 0.2 * A,
      thin: ratio <= 0.72,
    },
    outcomeCheck: () => later.every((x) => x >= S - 0.1 * A),
    show: { volume: true },
    aids: o.difficulty < 0.4 ? [aidLine(S, touchIdx[0])] : [],
    annotations: [
      HL(S, { from: touchIdx[0], color: W('support', 'resistance'), label: W('Support', 'Resistance') }),
      ...touches.map((i) => RING(i, S, { color: W('support', 'resistance') })),
      { type: 'marker', idx: d, position: 'below', shape: 'dot', text: W('Poke below', 'Poke above'), color: 'accent' },
      ARROW(d, 'above', 'Back inside'),
    ],
    viewFrom: Math.max(0, (touchIdx[0] ?? 0) - 5),
    ratio,
    title: 'Failed breakout (fakeout)',
    explanation: W(
      `Price pushed below support during the candle but could not close there: it closed back above the level, and volume was only about ${ratio.toFixed(1)}× the recent average, so few traders backed the move. Sellers who chased the breakdown are now trapped, and their exits add buying pressure. A failed breakdown often reverses: <strong>up</strong>.`,
      `Price pushed above resistance during the candle but could not close there: it closed back below the level, and volume was only about ${ratio.toFixed(1)}× the recent average, so few traders backed the move. Buyers who chased the breakout are now trapped, and their exits add selling pressure. A failed breakout often reverses: <strong>down</strong>.`,
    ),
    tellTale: W('A wick below support, a close back above it, and thin volume.', 'A wick above resistance, a close back below it, and thin volume.'),
    hint: 'Where did the last candle close compared with the level? Compare its volume bar with the ones before it.',
  };
  draftOk(dr);
  return bear ? mirrorDraft(dr, P) : dr;
}

/** Breakout above a tested resistance on rising volume. */
function genBreakoutVolume(rng, o) {
  const D = o.difficulty;
  const noise = noiseOf(o);
  const P = basePrice(rng);
  const u = P / 100;
  const R = P;
  const nP = r(54 - 10 * D) + rng.int(0, 5);
  const e = nP - 1;
  const d = nP;
  const F = rng.int(18, 22);
  const pts = [[0, R - rng.float(5, 6) * u], [r(0.18 * e), R], [r(0.34 * e), R - rng.float(4.6, 5.4) * u], [r(0.52 * e), R + rng.float(-0.1, 0.08) * u], [r(0.68 * e), R - rng.float(3.2, 3.8) * u], [r(0.85 * e), R - rng.float(0.02, 0.12) * u], [e, R - rng.float(1.3, 1.8) * u]];
  const { candles: past, anchors } = path(rng, pts, nP, noise);
  const topIdx = anchors.filter((a) => a.kind === 'high').map((a) => a.idx);
  const A0 = atrOf(past, 14)[e] || u;
  const o0 = past[e].c;
  const c = R + (0.85 - 0.35 * D) * A0 * rng.float(1, 1.2);
  let cs = past.concat([fixK({ o: o0, h: c + rng.float(0.05, 0.25) * A0, l: o0 - rng.float(0.05, 0.2) * A0, c, v: 0 })]);
  cs = extend(rng, cs, [[r(0.25 * F), c + rng.float(2, 2.6) * u], [r(0.45 * F), R + rng.float(0.8, 1.2) * u], [F, c + rng.float(5.5, 7) * u]], F, noise);
  cs = withVolume(rng, cs);
  const vAvg = avgVol(cs, d - 10, d);
  cs[d].v = Math.round(vAvg * (2.5 - 0.8 * D) * rng.float(0.95, 1.1));
  if (cs[d + 1]) cs[d + 1].v = Math.max(cs[d + 1].v, Math.round(vAvg * 1.3));
  const A = atrOf(cs, 14)[d];
  const touches = touchesAt(cs, topIdx, R, 0.35 * A, 'high');
  let capped = true;
  for (let i = 0; i < d; i++) if (cs[i].c > R || cs[i].h > R + 0.3 * A) capped = false;
  const dk = cs[d];
  let hold = true;
  for (let j = d + 1; j <= d + F; j++) if (cs[j].c < R - 0.3 * A) hold = false;
  const ratio = cs[d].v / vAvg;
  const dr = {
    P,
    candles: cs,
    d,
    F,
    expect: 'up',
    checks: {
      touches: touches.length >= 2,
      capped,
      decisive: dk.c >= R + 0.4 * A,
      body: dk.c - dk.o >= 0.6 * A,
      volume: ratio >= 1.6,
    },
    outcomeCheck: () => hold,
    show: { volume: true },
    aids: o.difficulty < 0.4 ? [aidLine(R, topIdx[0])] : [],
    annotations: [
      HL(R, { from: topIdx[0], color: 'resistance', label: 'Resistance' }),
      ...touches.map((i) => RING(i, R, { color: 'resistance' })),
      ARROW(d, 'above', 'Breakout'),
    ],
    viewFrom: Math.max(0, (topIdx[0] ?? 0) - 6),
    ratio,
    title: 'Breakout on rising volume',
    explanation: `Price had been capped at the same resistance level several times, and each dip was shallower than the last (buyers getting more eager). The last candle closed clearly above that level on volume about ${ratio.toFixed(1)}× the recent average: real buying power behind the move. A decisive close through resistance with strong volume is the classic breakout: <strong>up</strong>.`,
    tellTale: 'A strong close above a well-tested ceiling, with a volume bar that towers over the recent ones.',
    hint: 'Compare the last candle’s close with the earlier highs, and its volume bar with the ten before it.',
  };
  return draftOk(dr);
}

/** Price ranging between a flat ceiling and floor, now in the middle. expect 'flat' or 'whipsaw'. */
function genRange(rng, o, expect) {
  const D = o.difficulty;
  const noise = noiseOf(o);
  const P = basePrice(rng);
  const u = P / 100;
  const H = rng.float(5.2, 7) * u;
  const B = P;
  const T = P + H;
  const nP = r(58 - 10 * D) + rng.int(0, 6);
  const e = nP - 1;
  const d = e;
  const F = rng.int(18, 22);
  const lowFirst = rng.chance(0.5);
  const a = [r(0.12 * e), r(0.3 * e), r(0.49 * e), r(0.67 * e), r(0.84 * e)];
  const isLow = (k) => (lowFirst ? k % 2 === 0 : k % 2 === 1);
  const pts = [[0, B + 0.5 * H], ...a.slice(0, 4).map((i, k) => [i, isLow(k) ? B + rng.float(0, 0.1) * u : T - rng.float(0, 0.1) * u])];
  // After the fourth touch the last swing stays inside the range, then price drifts back to the middle.
  const fourthLow = isLow(3);
  pts.push([a[4], fourthLow ? B + rng.float(0.66, 0.74) * H : B + rng.float(0.26, 0.34) * H]);
  pts.push([e, B + rng.float(0.44, 0.56) * H]);
  const { candles: past, anchors } = path(rng, pts, nP, noise);
  const c0 = past[e].c;
  const futurePts = expect === 'whipsaw'
    ? (rng.chance(0.5)
      ? [[r(0.3 * F), B + rng.float(0.74, 0.8) * H], [r(0.65 * F), B + rng.float(0.2, 0.26) * H], [F, c0 + rng.float(-0.08, 0.08) * H]]
      : [[r(0.3 * F), B + rng.float(0.2, 0.26) * H], [r(0.65 * F), B + rng.float(0.74, 0.8) * H], [F, c0 + rng.float(-0.08, 0.08) * H]])
    : (rng.chance(0.5)
      ? [[r(0.3 * F), B + rng.float(0.7, 0.78) * H], [r(0.65 * F), B + rng.float(0.26, 0.32) * H], [F, c0 + rng.float(-0.06, 0.06) * H]]
      : [[r(0.3 * F), B + rng.float(0.24, 0.3) * H], [r(0.65 * F), B + rng.float(0.68, 0.76) * H], [F, c0 + rng.float(-0.06, 0.06) * H]]);
  let cs = extend(rng, past, futurePts, F, noise);
  cs = withVolume(rng, cs);
  const A = atrOf(cs, 14)[d];
  const hiIdx = anchors.filter((x) => x.kind === 'high').map((x) => x.idx);
  const loIdx = anchors.filter((x) => x.kind === 'low').map((x) => x.idx);
  const tops = touchesAt(cs, hiIdx, T, 0.4 * A, 'high');
  const bottoms = touchesAt(cs, loIdx, B, 0.4 * A, 'low');
  const first = Math.min(tops[0] ?? a[0], bottoms[0] ?? a[0]);
  let inside = true;
  for (let i = first; i <= d; i++) if (cs[i].c > T + 0.1 * A || cs[i].c < B - 0.1 * A) inside = false;
  let staysIn = true;
  for (let j = d + 1; j <= d + F; j++) if (cs[j].c > T - 0.1 * A || cs[j].c < B + 0.1 * A || cs[j].h > T + 0.3 * A || cs[j].l < B - 0.3 * A) staysIn = false;
  const pos = (cs[d].c - B) / H;
  const adv = expect === 'whipsaw';
  const dr = {
    P,
    candles: cs,
    d,
    F,
    expect,
    checks: {
      tops: tops.length >= 2,
      bottoms: bottoms.length >= 2,
      inside,
      middle: pos >= 0.35 && pos <= 0.65,
      height: H / A >= 3.5 && H / A <= 12,
    },
    outcomeCheck: () => staysIn,
    show: {},
    aids: o.difficulty < 0.4 ? [aidLine(T, first), aidLine(B, first)] : [],
    annotations: [
      { type: 'zone', from: B, to: T, x1: first, x2: d + F, color: 'accent', label: 'Range' },
      ...tops.map((i) => RING(i, T, { color: 'resistance' })),
      ...bottoms.map((i) => RING(i, B, { color: 'support' })),
      ARROW(d, 'above', 'Mid-range'),
    ],
    viewFrom: Math.max(0, first - 5),
    title: adv ? 'Price in the middle of a range' : 'Range chop',
    explanation: adv
      ? 'Price is ranging between a flat ceiling and a flat floor, and the last candle sits in the middle. A long has resistance only a few ATR above (ATR, the average true range, is the typical size of a candle here); a short has support the same distance below. The reward is small either way while a sensible stop is just as far: that is no edge. The disciplined move is to <strong>wait</strong> for price to reach an edge of the range, or to break out of it.'
      : 'Price has been bouncing between a flat ceiling and a flat floor: the highs are at about the same price, and so are the lows. That is a trading range, and the last candle sits in the middle of it. Until price breaks out, the most likely path is more of the same: <strong>sideways</strong>.',
    tellTale: adv ? 'In the middle of a range the target is about as far away as a sensible stop: no edge either way.' : 'Flat highs, flat lows and price in the middle: neither buyers nor sellers are in control.',
    hint: 'Draw a line across the highs and another across the lows. Where is price now, compared with those lines?',
  };
  return draftOk(dr);
}

/** Price weaving around a flat 20 EMA: no trend. */
function genFlatEma(rng, o) {
  const D = o.difficulty;
  const noise = noiseOf(o);
  const P = basePrice(rng);
  const u = P / 100;
  const nP = r(62 - 8 * D) + rng.int(0, 6);
  const e = nP - 1;
  const d = e;
  const F = rng.int(18, 22);
  const pts = [[0, P + rng.float(-0.5, 0.5) * u]];
  let i = 0;
  let s = rng.sign();
  while (i + 10 < e) {
    i += rng.int(4, 9);
    pts.push([i, P + s * rng.float(0.6, 2.3) * u]);
    s = -s;
  }
  pts.push([e, P + rng.float(-0.35, 0.35) * u]);
  const past = path(rng, pts, nP, noise).candles;
  const c0 = past[e].c;
  const fp = [];
  let j = 0;
  s = rng.sign();
  while (j + 7 < F) {
    j += rng.int(4, 7);
    fp.push([j, P + s * rng.float(0.6, 1.6) * u]);
    s = -s;
  }
  fp.push([F, c0 + rng.float(-0.12, 0.12) * u]);
  let cs = extend(rng, past, fp, F, noise);
  cs = withVolume(rng, cs);
  const A = atrOf(cs, 14)[d];
  const em = ema(closesOf(cs), 20);
  let crosses = 0;
  for (let k = d - 29; k <= d; k++) if ((cs[k].c - em[k]) * (cs[k - 1].c - em[k - 1]) < 0) crosses++;
  const dr = {
    P,
    candles: cs,
    d,
    F,
    expect: 'flat',
    checks: {
      flat: Math.abs(em[d] - em[d - 20]) <= 0.8 * A,
      crosses: crosses >= 4,
      nearEma: Math.abs(cs[d].c - em[d]) <= 1.2 * A,
    },
    outcomeCheck: (m) => m.maxUpClose <= 2.4 && m.maxDownClose <= 2.4,
    show: { ema20: true },
    aids: [],
    annotations: [
      SEG({ idx: d - 25, price: em[d - 25] }, { idx: d, price: em[d] }, { color: 'accent', dashed: true, width: 2.5, label: 'Flat EMA' }),
      ARROW(d, 'above', 'No trend'),
    ],
    viewFrom: Math.max(0, d - 45),
    title: 'Chop around a flat 20 EMA',
    explanation: `The 20 EMA (exponential moving average) is flat, and price has crossed it ${crosses} times in the last 30 candles, closing above it one moment and below it the next. A moving average only helps when it slopes: a flat one with price weaving through it means there is no trend to follow. Expect more back-and-forth: <strong>sideways</strong>.`,
    tellTale: 'A flat moving average that price crosses again and again.',
    hint: 'Which way is the EMA line pointing, and how often does price cross it?',
  };
  return draftOk(dr);
}

/** An uptrend that stopped making new highs and turned into a range. */
function genStalledTrend(rng, o) {
  const D = o.difficulty;
  const noise = noiseOf(o);
  const P = basePrice(rng);
  const u = P / 100;
  const T = P + rng.float(9.5, 10.5) * u;
  const H = rng.float(4.6, 5.8) * u;
  const B = T - H;
  const nP = r(72 - 10 * D) + rng.int(0, 5);
  const e = nP - 1;
  const d = e;
  const F = rng.int(18, 22);
  const pts = [[0, P], [r(0.1 * e), P + rng.float(4, 4.6) * u], [r(0.17 * e), P + rng.float(2.4, 2.9) * u], [r(0.3 * e), T], [r(0.44 * e), B], [r(0.58 * e), T - rng.float(0, 0.15) * u], [r(0.72 * e), B + rng.float(0, 0.15) * u], [r(0.86 * e), B + rng.float(0.66, 0.74) * H], [e, B + rng.float(0.42, 0.55) * H]];
  const { candles: past, anchors } = path(rng, pts, nP, noise);
  const c0 = past[e].c;
  const fp = rng.chance(0.5)
    ? [[r(0.3 * F), B + rng.float(0.24, 0.3) * H], [r(0.65 * F), B + rng.float(0.7, 0.76) * H], [F, c0 + rng.float(-0.06, 0.06) * H]]
    : [[r(0.3 * F), B + rng.float(0.7, 0.76) * H], [r(0.65 * F), B + rng.float(0.24, 0.3) * H], [F, c0 + rng.float(-0.06, 0.06) * H]];
  let cs = extend(rng, past, fp, F, noise);
  cs = withVolume(rng, cs);
  const A = atrOf(cs, 14)[d];
  const hiIdx = anchors.filter((x) => x.kind === 'high').map((x) => x.idx);
  const loIdx = anchors.filter((x) => x.kind === 'low').map((x) => x.idx);
  const tops = touchesAt(cs, hiIdx, T, 0.4 * A, 'high');
  const bottoms = touchesAt(cs, loIdx, B, 0.4 * A, 'low');
  const topStart = tops[0] ?? r(0.3 * e);
  let noNewHigh = true;
  for (let i = topStart + 1; i <= d; i++) if (cs[i].h > T + 0.3 * A) noNewHigh = false;
  let staysIn = true;
  for (let j = d + 1; j <= d + F; j++) if (cs[j].c > T - 0.1 * A || cs[j].c < B + 0.1 * A || cs[j].h > T + 0.3 * A || cs[j].l < B - 0.3 * A) staysIn = false;
  const pos = (cs[d].c - B) / H;
  const since = d - topStart;
  const dr = {
    P,
    candles: cs,
    d,
    F,
    expect: 'flat',
    checks: {
      tops: tops.length >= 2,
      bottoms: bottoms.length >= 2,
      noNewHigh,
      middle: pos >= 0.33 && pos <= 0.67,
      trendFirst: cs[topStart].h - minLow(cs, 0, 3) >= 5 * A,
    },
    outcomeCheck: () => staysIn,
    show: {},
    aids: o.difficulty < 0.4 ? [aidLine(T, topStart), aidLine(B, topStart)] : [],
    annotations: [
      SEG({ idx: 0, price: cs[0].l }, { idx: topStart, price: T }, { color: 'bull', width: 2, arrow: true, label: 'Old uptrend' }),
      { type: 'zone', from: B, to: T, x1: topStart, x2: d + F, color: 'accent', label: 'Range' },
      ...tops.map((i) => RING(i, T, { color: 'resistance' })),
      ...bottoms.map((i) => RING(i, B, { color: 'support' })),
      ARROW(d, 'above', 'Mid-range'),
    ],
    viewFrom: 0,
    title: 'A trend that stalled into a range',
    explanation: `The chart started in an uptrend, but it has not made a new high for ${since} candles: the highs keep stopping at the same ceiling and the dips at the same floor. A trend that stops making new highs has turned into a range, and the last candle sits in the middle of it. Trade what the chart is doing now, not what it did earlier: <strong>sideways</strong>.`,
    tellTale: 'No new high for a long time, flat highs and flat lows: the old trend has paused.',
    hint: 'When did price last make a new high? What have the highs and lows done since then?',
  };
  return draftOk(dr);
}

// ------------------------------------------------------------------------------------------
// Advanced generators
// ------------------------------------------------------------------------------------------

const CHART_TEXT = {
  'head-and-shoulders': {
    title: 'Head and shoulders breakdown',
    explanation: 'Three peaks: a left shoulder, a higher head and a lower right shoulder, with a neckline drawn under the two dips between them. The right shoulder could not reach the head (buyers tiring, on lighter volume), and the last candle closed below the neckline. That completes a head and shoulders top, a bearish reversal: <strong>short</strong>, with a stop above the right shoulder and a measured-move target one head-height below the neckline.',
    tellTale: 'A lower right shoulder and a close below the neckline.',
    hint: 'Label the three peaks. Which is highest, and where did the last candle close compared with the line under the dips?',
  },
  'inverse-head-and-shoulders': {
    title: 'Inverse head and shoulders breakout',
    explanation: 'Three troughs: a left shoulder, a deeper head and a shallower right shoulder, with a neckline across the two peaks between them. The right shoulder held well above the head (sellers tiring), and the last candle closed above the neckline. That completes an inverse head and shoulders, a bullish reversal: <strong>long</strong>, with a stop below the right shoulder and a measured-move target one head-depth above the neckline.',
    tellTale: 'A higher right shoulder and a close above the neckline.',
    hint: 'Label the three lows. Which is lowest, and where did the last candle close compared with the line across the peaks?',
  },
  'double-bottom': {
    title: 'Double bottom breakout',
    explanation: 'Price fell to a low, bounced, and fell back to about the same low, where buyers held it again: two bottoms. The last candle closed above the peak between them (the neckline), which confirms the double bottom, a bullish reversal: <strong>long</strong>, with a stop below the bottoms and a target the height of the pattern above the neckline.',
    tellTale: 'Two lows at the same level and a close above the peak between them.',
    hint: 'Compare the two lowest points. Then check where the last candle closed compared with the high between them.',
  },
  'bull-flag': {
    title: 'Bull flag breakout',
    explanation: 'A fast, steep rally (the flagpole) was followed by a gentle, orderly drift lower on shrinking volume (the flag): profit-taking, not heavy selling. The last candle broke out above the flag’s upper line with volume picking up. Flags are continuation patterns: <strong>long</strong>, with a stop below the flag and a target the pole’s height above the breakout.',
    tellTale: 'A steep pole, a quiet downward-sloping flag, and a close above the flag.',
    hint: 'What happened before the quiet stretch? Then look at the last candle compared with the stretch’s upper edge.',
  },
  'bear-flag': {
    title: 'Bear flag breakdown',
    explanation: 'A fast, steep sell-off (the flagpole) was followed by a gentle, orderly drift higher on shrinking volume (the flag): short-covering, not real buying. The last candle broke down below the flag’s lower line with volume picking up. Flags are continuation patterns: <strong>short</strong>, with a stop above the flag and a target the pole’s height below the breakdown.',
    tellTale: 'A steep pole, a quiet upward-sloping flag, and a close below the flag.',
    hint: 'What happened before the quiet stretch? Then look at the last candle compared with the stretch’s lower edge.',
  },
  'rising-wedge': {
    title: 'Rising wedge breakdown',
    explanation: 'Price climbed between two rising lines that squeeze together: the lower line rises faster than the upper one, so each push higher gains less ground. That shows buying momentum fading. The last candle closed below the lower line, so the rising wedge broke down. Rising wedges resolve downward more often than not: <strong>short</strong>, with a stop above the last swing high inside the wedge.',
    tellTale: 'Two converging rising lines, shrinking progress on each push, then a close below the lower line.',
    hint: 'Draw a line across the highs and another across the lows. Are they parallel, or closing in? Where did the last candle close?',
  },
};

const SCANNER_KIND = {
  'head-and-shoulders': 'head-and-shoulders',
  'inverse-head-and-shoulders': 'inverse-head-and-shoulders',
  'double-bottom': 'double-bottom',
  'bull-flag': 'bull-flag',
  'bear-flag': 'bear-flag',
};

/** Textbook chart pattern (patterns.chartScenario), frozen on its breakout candle. */
function genChartPattern(rng, o, patternId) {
  const D = o.difficulty;
  const count = r(100 - 8 * D) + rng.int(0, 6);
  const sc = chartScenario(patternId, { seed: SEED(rng), count, after: 20, outcome: o.fail ? 'fail' : 'success' });
  const d = sc.breakoutIdx;
  const F = Math.min(24, sc.candles.length - 1 - d);
  const cs = sc.candles.slice(0, d + 1 + F).map((k) => ({ ...k }));
  // The breakout bar gets the same (healthy) volume whatever happens next, so the chart shown
  // before the answer is identical for a setup that works and one that fails.
  const vRecent = avgVol(cs, d - 10, d);
  cs[d].v = Math.round(vRecent * rng.float(1.5, 2.1));
  const dir = sc.direction;
  const A = atrOf(cs, 14)[d];
  const kind = SCANNER_KIND[patternId];
  const found = kind ? findSetups(cs.slice(0, d + 1), { kinds: [kind], from: d - 3, to: d }).length > 0 : true;
  let geometry = true;
  if (patternId === 'rising-wedge') {
    const b = sc.boundaries;
    const su = (b.upper.y2 - b.upper.y1) / (b.upper.x2 - b.upper.x1);
    const sl = (b.lower.y2 - b.lower.y1) / (b.lower.x2 - b.lower.x1);
    geometry = su > 0 && sl > su;
  }
  const kp = sc.keyPoints.filter((k) => k.label !== 'Breakout');
  const col = dir > 0 ? 'bull' : 'bear';
  const ann = [];
  const flag = /flag$/.test(patternId);
  if (flag) {
    const [p0, p1] = kp;
    ann.push(SEG({ idx: p0.idx, price: p0.price }, { idx: p1.idx, price: p1.price }, { color: col, arrow: true, label: 'Pole' }));
  } else if (patternId !== 'rising-wedge') {
    ann.push({ type: 'path', points: kp.map((k) => ({ idx: k.idx, price: k.price })), color: col, labels: kp.map((k) => (/^neckline$/i.test(k.label) ? '' : k.label)) });
  }
  if (sc.neckline) ann.push(SEG({ idx: sc.neckline.x1, price: sc.neckline.y1 }, { idx: sc.neckline.x2, price: sc.neckline.y2 }, { color: 'accent', dashed: true, extend: 'right', label: 'Neckline' }));
  if (sc.boundaries) {
    for (const side of ['upper', 'lower']) {
      const b = sc.boundaries[side];
      ann.push(SEG({ idx: b.x1, price: b.y1 }, { idx: b.x2, price: b.y2 }, { color: 'accent', dashed: true }));
    }
  }
  // Stops: beyond the structure a trader would use.
  let stop = null;
  if (patternId === 'head-and-shoulders' || patternId === 'inverse-head-and-shoulders') {
    const rs = kp.find((k) => k.label === 'Right shoulder');
    if (rs) stop = rs.price;
  } else if (patternId === 'double-bottom') stop = Math.min(...kp.filter((k) => /^Bottom/.test(k.label)).map((k) => k.price));
  else if (flag) stop = dir > 0 ? minLow(cs, kp[1].idx, d) : maxHigh(cs, kp[1].idx, d);
  else if (patternId === 'rising-wedge') stop = maxHigh(cs, d - 12, d);
  if (isNum(stop)) ann.push(HL(stop - dir * 0.15 * A, { from: d, color: 'bear', label: 'Stop' }));
  ann.push(HL(sc.target, { from: d, color: 'bull', label: 'Target' }));
  ann.push(ARROW(d, dir > 0 ? 'above' : 'below', dir > 0 ? 'Breakout' : 'Breakdown'));
  const aids = [];
  if (D < 0.4) {
    if (sc.neckline) aids.push(SEG({ idx: sc.neckline.x1, price: sc.neckline.y1 }, { idx: sc.neckline.x2, price: sc.neckline.y2 }, { color: 'muted', dashed: true, width: 1.25 }));
    if (sc.boundaries) for (const side of ['upper', 'lower']) {
      const b = sc.boundaries[side];
      aids.push(SEG({ idx: b.x1, price: b.y1 }, { idx: b.x2, price: b.y2 }, { color: 'muted', dashed: true, width: 1.25 }));
    }
  }
  const text = CHART_TEXT[patternId];
  const dr = {
    P: 100,
    candles: cs,
    d,
    F,
    expect: o.fail ? (dir > 0 ? 'fail-down' : 'fail-up') : dir > 0 ? 'up' : 'down',
    checks: {
      scanner: found,
      geometry,
      decisive: (cs[d].c - sc.level) * dir >= 0.2 * A,
    },
    show: { volume: true },
    aids,
    annotations: ann,
    viewFrom: Math.max(0, (kp[0]?.idx ?? sc.patternStart) - 10),
    ...text,
  };
  // A failed pattern must fail clearly (the trade loses): at least 1 ATR against the breakout.
  if (o.fail) dr.outcomeCheck = (m) => m.moveAtr * dir <= -1;
  return draftOk(dr);
}

/** Uptrend pullback to the 61.8% retracement, with a hammer on the level. */
function genFibHammer(rng, o) {
  const D = o.difficulty;
  const noise = noiseOf(o);
  const P = basePrice(rng);
  const u = P / 100;
  const I = rng.float(9.5, 12) * u;
  const Ap = P;
  const Bp = P + I;
  const L618 = Bp - 0.618 * I;
  const L786 = Bp - 0.786 * I;
  const R = u * rng.float(1.15, 1.45);
  let ham = CANDLE_PATTERNS.hammer.generate(rng.fork('hammer'), { price: L618 + 2 * R, range: R }).map((k) => ({ ...k }));
  const sh = L618 + rng.float(-0.12, 0.12) * u - ham[0].l;
  ham = ham.map((k) => ({ ...k, o: k.o + sh, h: k.h + sh, l: k.l + sh, c: k.c + sh }));
  const Q = ham[0].o;
  const nP = r(58 - 8 * D) + rng.int(0, 5);
  const e = nP - 1;
  const d = nP;
  const F = rng.int(18, 22);
  const bIdx = e - rng.int(10, 13);
  const aIdx = r(bIdx * rng.float(0.3, 0.4));
  const pts = [[0, Ap + rng.float(2.5, 4) * u], [aIdx, Ap], [r((aIdx + bIdx) / 2), Ap + rng.float(0.5, 0.6) * I], [bIdx, Bp], [r(bIdx + 0.5 * (e - bIdx)), Bp - rng.float(0.34, 0.42) * I], [e, Q]];
  const { candles: past } = path(rng, pts, nP, noise);
  let cs = past.concat(ham.map((k) => ({ ...k, v: 0 })));
  const c = cs[d].c;
  const fut = o.fail
    ? [[r(0.25 * F), c + rng.float(0.8, 1.2) * u], [r(0.5 * F), L618 - rng.float(1.2, 1.8) * u], [F, L786 - rng.float(1, 2) * u]]
    : [[r(0.35 * F), Bp - rng.float(0.15, 0.25) * I], [r(0.55 * F), Bp - rng.float(0.32, 0.4) * I], [F, Bp + rng.float(0.05, 0.25) * I]];
  cs = extend(rng, cs, fut, F, noise);
  cs = withVolume(rng, cs);
  const vAvg = avgVol(cs, d - 10, d);
  cs[d].v = Math.max(cs[d].v, Math.round(vAvg * rng.float(1.2, 1.6)));
  const A = atrOf(cs, 14)[d];
  let respect = true;
  for (let i = bIdx + 1; i < d; i++) if (cs[i].c < L786 || cs[i].l < L786 - 0.1 * A) respect = false;
  const hamLow = cs[d].l;
  const later = { minLow: minLow(cs, d + 1, d + F) };
  const fibSpec = { type: 'fib', a: { idx: aIdx, price: Ap }, b: { idx: bIdx, price: Bp }, ratios: [0, 0.382, 0.5, 0.618, 0.786, 1] };
  const dr = {
    P,
    candles: cs,
    d,
    F,
    expect: o.fail ? 'fail-down' : 'up',
    checks: {
      hammer: CANDLE_RULES.hammer(cs, d),
      onLevel: Math.abs(hamLow - L618) <= 0.3 * A,
      impulse: I >= 5 * A,
      topIsB: maxHigh(cs, aIdx, d) <= Bp + 1e-9,
      bottomIsA: minLow(cs, 0, bIdx) >= Ap - 1e-9,
      respect,
      pullbackLen: d - bIdx >= 8,
    },
    outcomeCheck: o.fail ? null : () => later.minLow >= hamLow - 0.25 * A,
    show: {},
    aids: D < 0.5 ? [{ ...fibSpec, labels: true, color: 'fib' }] : [],
    annotations: [
      { ...fibSpec, zone: [0.5, 0.618] },
      { type: 'box', from: d, to: d, color: 'accent', label: 'Hammer' },
      RING(d, hamLow, { text: '61.8%', position: 'at' }),
      HL(hamLow - 0.2 * A, { from: d, color: 'bear', label: 'Stop' }),
      HL(Bp, { from: d, color: 'bull', label: 'Target' }),
    ],
    viewFrom: Math.max(0, aIdx - 6),
    title: 'Hammer at the 61.8% retracement',
    explanation: 'A strong rally was followed by an orderly pullback to the 61.8% Fibonacci retracement of that rally (38.2%, 50% and 61.8% are the pullback depths traders watch most). Right on the level a hammer printed: a long lower wick at least twice the body, closing near its high, so buyers rejected lower prices. Trend, level and trigger all agree: <strong>long</strong>, with a stop just below the hammer’s low and a first target at the prior high.',
    tellTale: 'Uptrend + 61.8% pullback + hammer: three independent reasons pointing the same way (confluence).',
    hint: 'How far has price pulled back, as a fraction of the last rally? What does the last candle’s shape tell you?',
  };
  return draftOk(dr);
}

/** Bullish RSI divergence at support in bull space → mirrored into bearish divergence at resistance. */
function genRsiDivergence(rng, o) {
  const D = o.difficulty;
  const noise = noiseOf(o);
  const P = basePrice(rng);
  const u = P / 100;
  const p0 = rng.int(6, 9) + r(8 * (1 - D));
  const l1 = p0 + rng.int(9, 11);
  const h1 = l1 + rng.int(6, 8);
  const m1 = h1 + 5;
  const h2 = m1 + 4;
  const l2 = h2 + rng.int(5, 7);
  const e = l2 + 5;
  const nP = e + 1;
  const d = nP;
  const F = rng.int(18, 22);
  const L1 = P;
  const L2 = P - rng.float(0.5, 1) * u;
  // Leg 1 is a clean, steep capitulation (deeply oversold RSI); leg 2 is a choppier, slower
  // grind to a marginally lower low — the momentum behind it is visibly weaker.
  const legA = path(rng, [[0, P + rng.float(8, 10) * u], [p0, P + rng.float(14.5, 16) * u], [l1, L1], [h1, P + rng.float(7.6, 8.6) * u]], h1 + 1, noise * 0.6).candles;
  const past = extend(rng, legA, [[m1 - h1, P + rng.float(4.4, 5) * u], [h2 - h1, P + rng.float(5.6, 6.3) * u], [l2 - h1, L2], [e - h1, L2 + rng.float(1, 1.4) * u]], e - h1, Math.max(0.5, noise));
  const A0 = atrOf(past, 14)[e] || u;
  const o0 = past[e].c;
  const c = Math.max(maxHigh(past, e - 3, e) + rng.float(0.15, 0.35) * A0, o0 + 0.6 * A0);
  let cs = past.concat([fixK({ o: o0, h: c + rng.float(0.05, 0.2) * A0, l: o0 - rng.float(0.05, 0.25) * A0, c, v: 0 })]);
  const fut = o.fail
    ? [[r(0.3 * F), c + rng.float(0.6, 1) * u], [r(0.6 * F), L2 - rng.float(0.8, 1.2) * u], [F, L2 - rng.float(2, 3) * u]]
    : [[r(0.35 * F), c + rng.float(2.8, 3.4) * u], [r(0.55 * F), c + rng.float(1.8, 2.4) * u], [F, c + rng.float(5, 7) * u]];
  cs = extend(rng, cs, fut, F, noise);
  cs = withVolume(rng, cs);
  const A = atrOf(cs, 14)[d];
  const rs = rsiOf(closesOf(cs), 14);
  const ia = argMinLow(cs, l1 - 2, l1 + 2);
  const ib = argMinLow(cs, l2 - 2, l2 + 2);
  const rsiMin = (a, b) => Math.min(...rs.slice(a, b + 1).filter(isNum));
  const rA = rsiMin(ia - 2, ia + 2);
  const rB = rsiMin(ib - 2, ib + 2);
  const lowA = cs[ia].l;
  const lowB = cs[ib].l;
  const later = { minLow: minLow(cs, d + 1, d + F) };
  const dr = {
    P,
    candles: cs,
    d,
    F,
    expect: o.fail ? 'fail-down' : 'up',
    checks: {
      oversold: rA <= 35,
      divergence: rB >= rA + 5,
      lowerLow: lowB <= lowA - 0.25 * A,
      bounce: maxHigh(cs, ia, ib) - lowA >= 1.5 * A,
      lowHeld: minLow(cs, ib + 1, d) > lowB,
      confirm: cs[d].c > cs[d].o && cs[d].c > maxHigh(cs, d - 4, d - 1),
      lowest: lowB <= minLow(cs, 0, d),
    },
    outcomeCheck: o.fail ? null : () => later.minLow >= lowB - 0.2 * A,
    show: { rsi: true },
    aids: [],
    annotations: [
      HL(lowA, { from: ia, color: 'resistance', label: 'Resistance' }),
      SEG({ idx: ia, price: lowA }, { idx: ib, price: lowB }, { color: 'bear', width: 2, label: 'Higher high' }),
      SEG({ idx: ia, price: rA, }, { idx: ib, price: rB }, { pane: 'rsi', color: 'bear', width: 2, label: 'Lower high' }),
      ARROW(d, 'below', 'Confirmation'),
    ],
    viewFrom: Math.max(0, p0 - 4),
    title: 'Bearish RSI divergence at resistance',
    explanation: 'Price pushed to a new high, a little above the previous peak (resistance), but RSI (the Relative Strength Index, a 0–100 momentum gauge) made a lower high: the second push had less force behind it. That mismatch is a bearish divergence. The last candle then closed below the recent lows, confirming that sellers were stepping in: <strong>short</strong>, with a stop above the new high.',
    tellTale: 'A higher high on price, a lower high on RSI, then a bearish confirmation candle.',
    hint: 'Compare the last two price peaks, then compare the RSI readings under them.',
  };
  draftOk(dr);
  const out = mirrorDraft(dr, P);
  // RSI was built in bull space: mirrored closes give exactly 100 − RSI, which mirrorSpec applies.
  return out;
}

/** Higher-timeframe trend vs a lower-timeframe counter-move: conflicting timeframes → wait. */
function genHtfConflict(rng, o) {
  const D = o.difficulty;
  const noise = noiseOf(o);
  const P = basePrice(rng) * 0.9;
  const u = P / 100;
  const factor = 5;
  const d = 249;
  const F = rng.int(18, 22);
  const W = r(72 - 12 * D) + rng.int(0, 4);
  const w0 = d - W + 1;
  const j = () => rng.float(-0.4, 0.4) * u;
  const H4 = P + rng.float(9.5, 10.5) * u;
  const pts = [
    [0, P + 26 * u + j()], [22, P + 30 * u + j()], [48, P + 20 * u + j()], [80, P + 25 * u + j()], [110, P + 13 * u + j()],
    [140, P + 17.5 * u + j()], [165, P + 5.5 * u + j()], [180, H4], [196, P],
    [207, P + rng.float(3.2, 3.8) * u], [216, P + rng.float(1.6, 2) * u], [228, P + rng.float(5.2, 5.8) * u], [237, P + rng.float(3.5, 4) * u], [d, P + rng.float(6.3, 6.8) * u],
  ];
  const { candles: past, anchors } = path(rng, pts, d + 1, noise * 0.9);
  const c0 = past[d].c;
  const fp = [[r(0.3 * F), c0 + rng.float(1.8, 2.3) * u], [r(0.65 * F), c0 - rng.float(1.6, 2.2) * u], [F, c0 - rng.float(0.2, 0.9) * u]];
  let all = extend(rng, past, fp, F, noise * 0.9);
  all = withVolume(rng, all);
  const cs = all.slice(w0);
  const dd = d - w0;
  const A = atrOf(all, 14)[d];
  const hi = anchors.filter((x) => x.kind === 'high');
  const lo = anchors.filter((x) => x.kind === 'low');
  const htfHighs = hi.filter((x) => x.idx <= 180).map((x) => x.price);
  const htfLows = lo.filter((x) => x.idx <= 196).map((x) => x.price);
  const ltfHi = hi.filter((x) => x.idx > 196).map((x) => x.idx);
  const ltfLo = lo.filter((x) => x.idx >= 196).map((x) => x.idx);
  const dec = (arr) => arr.every((v, i) => i === 0 || v < arr[i - 1]);
  const bounceLow = all[196].l;
  const htfCandles = aggregate(all.slice(0, d + 1), factor);
  const htfFull = aggregate(all, factor);
  const ltfPath = [196, ...[207, 216, 228, 237]].map((i, k) => ({ idx: i - w0, price: k % 2 ? all[i].h : all[i].l }));
  const bullLabels = ['L', 'H', 'HL', 'HH', 'HL'];
  const mirrorIt = rng.chance(0.4);
  const dr = {
    P,
    candles: cs,
    d: dd,
    F,
    expect: 'whipsaw',
    checks: {
      htfDown: dec(htfHighs) && dec(htfLows) && htfHighs.length >= 4,
      ltfUp: ltfHi.length === 2 && ltfLo.length >= 2 && all[228].h > all[207].h + 0.8 * A && all[237].l > all[216].l + 0.8 * A,
      bounceLowest: bounceLow <= minLow(all, w0, d),
      belowHtf: H4 - all[d].c >= 1.5 * A,
      inWindow: w0 <= 190,
    },
    show: {},
    htf: {
      factor,
      candles: htfCandles,
      full: htfFull,
      overlays: [{ type: 'hline', price: H4, color: 'resistance', dashed: true, label: null }],
    },
    aids: D < 0.4 ? [aidLine(H4, 0)] : [],
    annotations: [
      HL(H4, { color: 'resistance', label: 'Higher-timeframe lower high' }),
      { type: 'path', points: ltfPath, color: 'bull', labels: bullLabels },
      ARROW(dd, 'above', 'Conflict'),
    ],
    viewFrom: 0,
    title: 'Higher-timeframe downtrend vs lower-timeframe bounce',
    explanation: 'On this chart price is bouncing: higher highs and higher lows. But the higher-timeframe chart (each candle there covers 5 of these) is in a clear downtrend of lower highs and lower lows, and the bounce is heading into its last lower high. A long fights the bigger trend; a short fights the smaller one. When timeframes disagree there is no edge, so the professional answer is to <strong>wait</strong> until they line up: a rejection at the higher-timeframe level, or a break above it.',
    tellTale: 'The small picture says up, the big picture says down: conflicting timeframes mean no edge.',
    hint: 'Check the higher-timeframe chart as well as the main one. Do they agree?',
  };
  draftOk(dr);
  if (!mirrorIt) return dr;
  const m = mirrorDraft(dr, P);
  m.title = 'Higher-timeframe uptrend vs lower-timeframe dip';
  m.annotations = m.annotations.map((s) => (s.type === 'path' ? { ...s, color: 'bear', labels: ['H', 'L', 'LH', 'LL', 'LH'] } : s.type === 'hline' ? { ...s, color: 'support', label: 'Higher-timeframe higher low' } : s));
  m.htf.overlays = m.htf.overlays.map((s) => ({ ...s, color: 'support' }));
  m.explanation = 'On this chart price is dipping: lower highs and lower lows. But the higher-timeframe chart (each candle there covers 5 of these) is in a clear uptrend of higher highs and higher lows, and the dip is heading into its last higher low. A short fights the bigger trend; a long fights the smaller one. When timeframes disagree there is no edge, so the professional answer is to <strong>wait</strong> until they line up: a bounce from the higher-timeframe level, or a break below it.';
  m.tellTale = 'The small picture says down, the big picture says up: conflicting timeframes mean no edge.';
  return m;
}

/** A range whose top gets a thin-volume breakout (wait), or a thin break that closes back inside (short). */
function genRangeBreak(rng, o, variant) {
  const D = o.difficulty;
  const noise = noiseOf(o);
  const P = basePrice(rng);
  const u = P / 100;
  const H = rng.float(5.5, 7) * u;
  const R = P + H;
  const nP = r(56 - 10 * D) + rng.int(0, 5);
  const e = nP - 1;
  const pts = [[0, P + rng.float(0.3, 0.5) * H], [r(0.15 * e), R], [r(0.33 * e), P + rng.float(0, 0.06) * H], [r(0.52 * e), R - rng.float(0, 0.02) * H], [r(0.7 * e), P + rng.float(0.06, 0.14) * H], [e, R - rng.float(0.1, 0.16) * H]];
  const { candles: past, anchors } = path(rng, pts, nP, noise);
  const topIdx = anchors.filter((a) => a.kind === 'high').map((a) => a.idx);
  const botIdx = anchors.filter((a) => a.kind === 'low').map((a) => a.idx);
  const A0 = atrOf(past, 14)[e] || u;
  const o0 = past[e].c;
  const bc = R + (0.34 - 0.08 * D) * A0 * rng.float(0.9, 1.15);
  let cs = past.concat([fixK({ o: o0, h: bc + rng.float(0.1, 0.35) * A0, l: o0 - rng.float(0.05, 0.2) * A0, c: bc, v: 0 })]);
  const bIdx = nP;
  let d = bIdx;
  const F = rng.int(18, 22);
  if (variant === 'failed') {
    const c = R - (0.55 - 0.1 * D) * A0 * rng.float(1, 1.25);
    cs.push(fixK({ o: bc, h: bc + rng.float(0.02, 0.15) * A0, l: c - rng.float(0.05, 0.2) * A0, c, v: 0 }));
    d = bIdx + 1;
  }
  const c = cs[d].c;
  let fut;
  if (variant === 'lowvol') fut = [[r(0.2 * F), c + rng.float(1.6, 2) * u], [r(0.55 * F), R - rng.float(1.6, 2.1) * u], [F, R - rng.float(0.3, 0.7) * u]];
  else if (o.fail) fut = [[r(0.3 * F), R - rng.float(0.4, 0.7) * u], [r(0.6 * F), R + rng.float(2.2, 2.8) * u], [F, R + rng.float(3.2, 4) * u]];
  else fut = [[r(0.35 * F), R - rng.float(0.42, 0.5) * H], [r(0.55 * F), R - rng.float(0.28, 0.34) * H], [F, P + rng.float(0.06, 0.22) * H]];
  cs = extend(rng, cs, fut, F, noise);
  cs = withVolume(rng, cs);
  const vAvg = avgVol(cs, bIdx - 10, bIdx);
  cs[bIdx].v = Math.max(1, Math.round(vAvg * rng.float(0.42, 0.66)));
  if (variant === 'failed') cs[d].v = Math.round(vAvg * rng.float(1.1, 1.5));
  const A = atrOf(cs, 14)[d];
  const touches = touchesAt(cs, topIdx, R, 0.35 * A, 'high');
  const floors = touchesAt(cs, botIdx, P, 0.6 * A, 'low');
  let capped = true;
  for (let i = 0; i < bIdx; i++) if (cs[i].c > R || cs[i].h > R + 0.3 * A) capped = false;
  const ratio = cs[bIdx].v / vAvg;
  const bk = cs[bIdx];
  const dk = cs[d];
  const later = { maxHigh: maxHigh(cs, d + 1, d + F) };
  const lowvol = variant === 'lowvol';
  const checks = {
    touches: touches.length >= 2,
    capped,
    thin: ratio <= 0.72,
    brokeOut: bk.c >= R + 0.1 * A && bk.c <= R + 0.6 * A,
  };
  if (!lowvol) {
    checks.backInside = dk.c <= R - 0.3 * A;
    checks.red = dk.c < dk.o && dk.o - dk.c >= 0.5 * A;
  }
  const ann = [
    { type: 'zone', from: P, to: R, x1: topIdx[0], x2: bIdx - 1, color: 'accent', label: 'Range' },
    HL(R, { from: topIdx[0], color: 'resistance', label: 'Resistance' }),
    ...touches.map((i) => RING(i, R, { color: 'resistance' })),
  ];
  if (lowvol) ann.push(ARROW(d, 'above', 'Thin-volume break'));
  else {
    ann.push({ type: 'marker', idx: bIdx, position: 'above', shape: 'dot', text: 'Break', color: 'accent' });
    ann.push(ARROW(d, 'below', 'Back inside'));
    ann.push(HL(bk.h + 0.15 * A, { from: bIdx, color: 'bear', label: 'Stop' }));
    ann.push(HL(P + 0.1 * H, { from: d, color: 'bull', label: 'Target' }));
  }
  const dr = {
    P,
    candles: cs,
    d,
    F,
    expect: lowvol ? 'whipsaw' : o.fail ? 'fail-up' : 'down',
    checks,
    outcomeCheck: lowvol || o.fail ? null : () => later.maxHigh <= bk.h + 0.2 * A,
    show: { volume: true },
    aids: D < 0.4 ? [aidLine(R, topIdx[0]), ...(floors.length ? [aidLine(P, topIdx[0])] : [])] : [],
    annotations: ann,
    viewFrom: Math.max(0, topIdx[0] - 6),
    ratio,
    title: lowvol ? 'Low-volume breakout' : 'Failed breakout: back inside the range',
    explanation: lowvol
      ? `Price just closed above resistance, but only barely, on volume about ${ratio.toFixed(1)}× the recent average. Real breakouts usually come with a surge of participation; this one has none, so buying it is a gamble. Shorting it is no better: nothing has failed yet. With no edge either way, the disciplined answer is to <strong>wait</strong> for a strong close with volume, or a close back inside the range.`
      : `Price broke above the top of its range on thin volume (about ${ratio.toFixed(1)}× the recent average: few traders backed it), then the very next candle closed back below the level. The breakout failed: buyers who chased it are trapped, with their stop-loss orders below. Failed breakouts often run toward the other side of the range: <strong>short</strong>, with a stop above the failed high.`,
    tellTale: lowvol ? 'A marginal close above the level on thin volume: no conviction behind the move.' : 'A thin-volume poke above resistance, then a decisive close back below it.',
    hint: lowvol ? 'How far above the level did the last candle close, and how big is its volume bar?' : 'Look at the last two candles: where did each one close compared with the level? Check the breakout candle’s volume.',
  };
  draftOk(dr);
  return lowvol && rng.chance(0.4) ? retitleLowVolDown(mirrorDraft(dr, P)) : dr;
}

function retitleLowVolDown(m) {
  m.title = 'Low-volume breakdown';
  m.explanation = m.explanation.replace('closed above resistance', 'closed below support').replace('buying it is a gamble. Shorting it', 'selling it is a gamble. Buying it');
  m.tellTale = 'A marginal close below the level on thin volume: no conviction behind the move.';
  m.hint = 'How far below the level did the last candle close, and how big is its volume bar?';
  m.annotations = m.annotations.map((s) => (s.type === 'hline' && s.label === 'Resistance' ? { ...s, color: 'support', label: 'Support' } : s.type === 'marker' && s.shape === 'ring' ? { ...s, color: 'support' } : s));
  return m;
}

/** Breakout, then a retest of the old resistance that holds as support. */
function genBreakoutRetest(rng, o) {
  const D = o.difficulty;
  const noise = noiseOf(o);
  const P = basePrice(rng);
  const u = P / 100;
  const R = P;
  const nP = r(58 - 8 * D) + rng.int(0, 5);
  const e = nP - 1; // the retest candle is e + 1, the decision e + 2
  const pts = [[0, R - rng.float(4.5, 5.5) * u], [r(0.15 * e), R], [r(0.3 * e), R - rng.float(4.4, 5.2) * u], [r(0.47 * e), R - rng.float(0, 0.1) * u], [r(0.6 * e), R - rng.float(3.4, 4) * u], [r(0.8 * e), R + rng.float(3, 3.6) * u], [e, R + rng.float(0.9, 1.3) * u]];
  const { candles: past, anchors } = path(rng, pts, nP, noise);
  const topIdx = anchors.filter((a) => a.kind === 'high').map((a) => a.idx).filter((i) => i < r(0.6 * e));
  const A0 = atrOf(past, 14)[e] || u;
  const o1 = past[e].c;
  const c1 = R + rng.float(0.1, 0.3) * A0;
  const retest = fixK({ o: o1, h: o1 + rng.float(0.05, 0.2) * A0, l: R - rng.float(0, 0.2) * A0, c: c1, v: 0 });
  const c2 = R + (0.85 - 0.25 * D) * A0 * rng.float(1, 1.2);
  const dec = fixK({ o: c1, h: c2 + rng.float(0.05, 0.2) * A0, l: c1 - rng.float(0.05, 0.25) * A0, c: c2, v: 0 });
  // The breakout candle: the first close above R becomes a decisive, full-bodied candle.
  let bo0 = -1;
  for (let i = (topIdx[topIdx.length - 1] ?? 0) + 1; i < nP; i++) if (past[i].c > R) {
    bo0 = i;
    break;
  }
  if (bo0 > 0) {
    const pk = past[bo0 - 1].c;
    const bc = Math.max(past[bo0].c, R + rng.float(0.5, 0.8) * A0);
    setCandle(past, bo0, { o: Math.min(pk, bc - 0.6 * A0), c: bc, h: bc + rng.float(0.05, 0.2) * A0, l: Math.min(pk, bc - 0.6 * A0) - rng.float(0, 0.15) * A0 });
  }
  let cs = past.concat([retest, dec]);
  const d = nP + 1;
  const F = rng.int(18, 22);
  const postHigh = maxHigh(past, r(0.6 * e), e);
  const fut = o.fail
    ? [[r(0.2 * F), c2 + rng.float(0.5, 0.8) * u], [r(0.5 * F), R - rng.float(1.8, 2.4) * u], [F, R - rng.float(2.6, 3.4) * u]]
    : [[r(0.35 * F), postHigh + rng.float(0.8, 1.4) * u], [r(0.55 * F), postHigh - rng.float(0.2, 0.6) * u], [F, postHigh + rng.float(3, 4.2) * u]];
  cs = extend(rng, cs, fut, F, noise);
  cs = withVolume(rng, cs);
  // Breakout candle: the first close above R.
  let bo = -1;
  for (let i = topIdx[topIdx.length - 1] + 1; i < nP; i++) if (cs[i].c > R) {
    bo = i;
    break;
  }
  const vAvg = bo > 0 ? avgVol(cs, bo - 10, bo) : 1;
  if (bo > 0) cs[bo].v = Math.round(vAvg * rng.float(1.8, 2.4));
  const A = atrOf(cs, 14)[d];
  const touches = touchesAt(cs, topIdx, R, 0.35 * A, 'high');
  let capped = true;
  for (let i = 0; i < Math.max(0, bo); i++) if (cs[i].c > R || cs[i].h > R + 0.3 * A) capped = false;
  let held = true;
  for (let i = bo + 1; i <= d; i++) if (cs[i].c < R - 0.1 * A) held = false;
  const retestLow = minLow(cs, d - 3, d);
  const later = { minClose: Math.min(...cs.slice(d + 1, d + F + 1).map((k) => k.c)) };
  const dr = {
    P,
    candles: cs,
    d,
    F,
    expect: o.fail ? 'fail-down' : 'up',
    checks: {
      touches: touches.length >= 2,
      capped: bo > 0 && capped,
      breakout: bo > 0 && cs[bo].c >= R + 0.3 * A && cs[bo].c - cs[bo].o >= 0.5 * A && bo <= d - 6,
      ranAway: postHigh - R >= 2 * A,
      held,
      retest: Math.abs(retestLow - R) <= 0.35 * A,
      bounce: cs[d].c > cs[d].o && cs[d].c >= R + 0.5 * A,
    },
    outcomeCheck: o.fail ? null : () => later.minClose >= R - 0.3 * A,
    show: { volume: true },
    aids: D < 0.4 ? [aidLine(R, topIdx[0])] : [],
    annotations: [
      HL(R, { from: topIdx[0], color: 'accent', label: 'Old resistance = new support' }),
      ...touches.map((i) => RING(i, R, { color: 'resistance' })),
      ...(bo > 0 ? [ARROW(bo, 'above', 'Breakout')] : []),
      ARROW(d, 'below', 'Retest held'),
      HL(retestLow - 0.2 * A, { from: d, color: 'bear', label: 'Stop' }),
    ],
    viewFrom: Math.max(0, (topIdx[0] ?? 0) - 6),
    title: 'Breakout and retest',
    explanation: 'Price broke above a well-tested resistance on strong volume, ran higher, then pulled back to the level it broke. Old resistance often turns into new support, and here it did: the retest held and the last candle bounced firmly off the level. Buying the retest gives a better price and a tighter stop than chasing the breakout: <strong>long</strong>, with a stop just below the retest low.',
    tellTale: 'Old resistance became support: the retest held and buyers stepped straight back in.',
    hint: 'Find the level price broke earlier. What did price do when it came back to it?',
  };
  return draftOk(dr);
}

// ------------------------------------------------------------------------------------------
// The library
// ------------------------------------------------------------------------------------------

const T = (id, mode, answer, tier, group, title, gen, extra = {}) => ({ id, mode, answer, tier, group, title, gen, canFail: false, ...extra });

export const SCENARIO_TYPES = Object.freeze({
  // Beginner — up
  'support-bounce': T('support-bounce', 'beginner', 'up', 0, 'Support & resistance', 'Bounce off support', (g, o) => genLevelReact(g, o, false)),
  'breakout-volume': T('breakout-volume', 'beginner', 'up', 1, 'Breakouts & volume', 'Breakout on rising volume', (g, o) => genBreakoutVolume(g, o)),
  'uptrend-pullback': T('uptrend-pullback', 'beginner', 'up', 1, 'Trends', 'Uptrend pullback to a higher low', (g, o) => genTrendPullback(g, o, false)),
  'engulfing-support': T('engulfing-support', 'beginner', 'up', 1, 'Candlestick patterns', 'Bullish engulfing at support', (g, o) => genCandleAtLevel(g, o, 'bullish-engulfing', false)),
  'ema-ride': T('ema-ride', 'beginner', 'up', 0, 'Moving averages', 'Riding above a rising 20 EMA', (g, o) => genEmaRide(g, o, false)),
  // Beginner — down
  'resistance-reject': T('resistance-reject', 'beginner', 'down', 0, 'Support & resistance', 'Rejection at resistance', (g, o) => genLevelReact(g, o, true)),
  'downtrend-rally': T('downtrend-rally', 'beginner', 'down', 1, 'Trends', 'Downtrend rally to a lower high', (g, o) => genTrendPullback(g, o, true)),
  'shooting-star': T('shooting-star', 'beginner', 'down', 1, 'Candlestick patterns', 'Shooting star at resistance', (g, o) => genCandleAtLevel(g, o, 'hammer', true)),
  fakeout: T('fakeout', 'beginner', 'down', 2, 'Breakouts & volume', 'Failed breakout (fakeout)', (g, o) => genFakeout(g, o, true)),
  'ema-below': T('ema-below', 'beginner', 'down', 0, 'Moving averages', 'Riding below a falling 20 EMA', (g, o) => genEmaRide(g, o, true)),
  // Beginner — sideways
  'range-chop': T('range-chop', 'beginner', 'sideways', 0, 'Ranges', 'Range chop', (g, o) => genRange(g, o, 'flat')),
  'flat-ema-chop': T('flat-ema-chop', 'beginner', 'sideways', 1, 'Moving averages', 'Chop around a flat 20 EMA', (g, o) => genFlatEma(g, o)),
  'stalled-trend': T('stalled-trend', 'beginner', 'sideways', 2, 'Ranges', 'A trend that stalled into a range', (g, o) => genStalledTrend(g, o)),

  // Advanced — long
  'double-bottom': T('double-bottom', 'advanced', 'long', 0, 'Chart patterns', 'Double bottom breakout', (g, o) => genChartPattern(g, o, 'double-bottom'), { canFail: true }),
  'bull-flag': T('bull-flag', 'advanced', 'long', 0, 'Chart patterns', 'Bull flag breakout', (g, o) => genChartPattern(g, o, 'bull-flag'), { canFail: true }),
  'inverse-hs': T('inverse-hs', 'advanced', 'long', 1, 'Chart patterns', 'Inverse head and shoulders breakout', (g, o) => genChartPattern(g, o, 'inverse-head-and-shoulders'), { canFail: true }),
  'fib-hammer': T('fib-hammer', 'advanced', 'long', 1, 'Fibonacci & confluence', 'Hammer at the 61.8% retracement', (g, o) => genFibHammer(g, o), { canFail: true }),
  'breakout-retest': T('breakout-retest', 'advanced', 'long', 1, 'Breakouts & volume', 'Breakout and retest', (g, o) => genBreakoutRetest(g, o), { canFail: true }),
  // Advanced — short
  'hs-break': T('hs-break', 'advanced', 'short', 1, 'Chart patterns', 'Head and shoulders breakdown', (g, o) => genChartPattern(g, o, 'head-and-shoulders'), { canFail: true }),
  'bear-flag': T('bear-flag', 'advanced', 'short', 0, 'Chart patterns', 'Bear flag breakdown', (g, o) => genChartPattern(g, o, 'bear-flag'), { canFail: true }),
  'rising-wedge': T('rising-wedge', 'advanced', 'short', 2, 'Chart patterns', 'Rising wedge breakdown', (g, o) => genChartPattern(g, o, 'rising-wedge'), { canFail: true }),
  'rsi-divergence': T('rsi-divergence', 'advanced', 'short', 2, 'Indicators & divergence', 'Bearish RSI divergence at resistance', (g, o) => genRsiDivergence(g, o), { canFail: true }),
  'failed-breakout': T('failed-breakout', 'advanced', 'short', 1, 'Breakouts & volume', 'Failed breakout: back inside the range', (g, o) => genRangeBreak(g, o, 'failed'), { canFail: true }),
  // Advanced — wait
  'mid-range': T('mid-range', 'advanced', 'wait', 0, 'Ranges', 'Price in the middle of a range', (g, o) => genRange(g, o, 'whipsaw')),
  'lowvol-breakout': T('lowvol-breakout', 'advanced', 'wait', 1, 'Breakouts & volume', 'Low-volume breakout', (g, o) => genRangeBreak(g, o, 'lowvol')),
  'htf-conflict': T('htf-conflict', 'advanced', 'wait', 2, 'Multi-timeframe', 'Higher-timeframe trend vs lower-timeframe move', (g, o) => genHtfConflict(g, o)),
});

export const SCENARIO_IDS = Object.freeze(Object.keys(SCENARIO_TYPES));

/** Scenario types for a mode (optionally one answer). */
export function typesFor(mode, answer = null) {
  return SCENARIO_IDS.filter((id) => SCENARIO_TYPES[id].mode === mode && (!answer || SCENARIO_TYPES[id].answer === answer));
}

const FAIL_NOTE = 'This time it failed: price turned against the setup and the trade lost. Your read was the textbook one and the setup still did not work, which happens to every setup some of the time. That is exactly why the conviction choice and the Wait button exist: size each trade so a failure like this is a small, planned loss.';

/**
 * buildScenario(typeId, rng, { difficulty = 0.5, fail = false }) → a validated scenario:
 * { type, mode, answer, group, tier, title, explanation, tellTale, hint, failNote, failed,
 *   candles, decisionIdx, reveal, show: { volume, ema20, rsi }, htf, aids, annotations,
 *   viewFrom, measure, outcome: 'up'|'down'|'flat'|'whipsaw', tries, validated }
 * Generate-and-test: up to 30 seeded drafts (forked seeds), then calm hand-tuned drafts.
 */
export function buildScenario(typeId, rng, { difficulty = 0.5, fail = false } = {}) {
  const def = SCENARIO_TYPES[typeId];
  if (!def) throw new Error(`Unknown what-next scenario: ${typeId}`);
  const failing = !!fail && def.canFail;
  const opts = { difficulty: clamp(difficulty, 0, 1), fail: failing, handTuned: false };
  let draft = null;
  let tries = 0;
  let last = null;
  for (; tries < MAX_TRIES && !draft; tries++) {
    const dr = def.gen(rng.fork(`${typeId}:${tries}`), opts);
    last = dr;
    if (dr && dr.ok) draft = dr;
  }
  for (let k = 0; !draft && k < 24; k++, tries++) {
    const dr = def.gen(rng.fork(`${typeId}:hand:${k}`), { ...opts, difficulty: 0, handTuned: true });
    last = dr;
    if (dr && dr.ok) draft = dr;
  }
  if (!draft) {
    // Never expected (the library is swept in tests); keep the game playable and say so.
    console.warn(`[what-next] ${typeId}: no draft passed validation`, last?.failedChecks);
    draft = last;
  }
  return finalize(def, draft, { failing, tries, difficulty: opts.difficulty });
}

function finalize(def, dr, { failing, tries, difficulty }) {
  const m = measure(dr.candles, dr.d, dr.F);
  const outcome = Math.abs(m.moveAtr) < 1 ? (dr.expect === 'whipsaw' ? 'whipsaw' : 'flat') : dr.expect === 'whipsaw' ? 'whipsaw' : m.moveAtr > 0 ? 'up' : 'down';
  return {
    type: def.id,
    mode: def.mode,
    answer: def.answer,
    group: def.group,
    tier: def.tier,
    title: dr.title || def.title,
    explanation: dr.explanation,
    tellTale: dr.tellTale,
    hint: dr.hint,
    failNote: failing ? FAIL_NOTE : null,
    failed: failing,
    candles: dr.candles,
    decisionIdx: dr.d,
    reveal: dr.F,
    show: dr.show || {},
    htf: dr.htf || null,
    aids: dr.aids || [],
    annotations: dr.annotations || [],
    viewFrom: dr.viewFrom ?? 0,
    measure: m,
    outcome,
    decimals: 2,
    tries,
    difficulty,
    validated: !!dr.ok,
    failedChecks: dr.failedChecks || [],
  };
}

// ------------------------------------------------------------------------------------------
// Round planning: balanced answers, varied scenario types, honest failures
// ------------------------------------------------------------------------------------------

/** A balanced, shuffled answer sequence for a run of `n` rounds (each answer ⌊n/3⌋ times, extras directional). */
export function planAnswers(rng, mode, n) {
  const ids = ANSWERS[mode].map((a) => a.id);
  const out = [];
  for (let k = 0; k < Math.floor(n / 3); k++) out.push(...ids);
  const extras = rng.shuffle(ids.slice(0, 2));
  for (let k = 0; out.length < n; k++) out.push(extras[k % 2]);
  // Shuffle, but avoid three identical answers in a row.
  for (let t = 0; t < 20; t++) {
    const s = rng.shuffle(out);
    if (!s.some((a, i) => i >= 2 && a === s[i - 1] && a === s[i - 2])) return s;
  }
  return rng.shuffle(out);
}

/** A bag of answers for open-ended runs: every 3 rounds contain each answer once. */
export function answerBag(rng, mode) {
  return rng.shuffle(ANSWERS[mode].map((a) => a.id));
}

/**
 * Pick a scenario type for an answer: tiers unlock with difficulty (easy rounds use tier 0–1,
 * hard ones favour tier 2), unused types are preferred and the previous type is never repeated.
 */
export function pickType(rng, { mode, answer, difficulty = 0.5, used = new Set(), last = null }) {
  let pool = typesFor(mode, answer);
  if (pool.length > 1 && last) {
    const rest = pool.filter((id) => id !== last);
    if (rest.length) pool = rest;
  }
  const maxTier = difficulty < 0.3 ? 0 : difficulty < 0.6 ? 1 : 2;
  const target = difficulty < 0.3 ? 0 : difficulty < 0.6 ? 1 : 2;
  const weights = pool.map((id) => {
    const t = SCENARIO_TYPES[id].tier;
    let w = t <= maxTier ? 1 : 0.12;
    if (t === target) w *= 1.8;
    if (!used.has(id)) w *= 3;
    return w;
  });
  return rng.weighted(pool, weights);
}
