// Chart patterns (Edwards & Magee / Bulkowski): CHART_PATTERNS definitions and chartScenario().
// Pure module (no DOM). Part of the pattern library; import from js/core/patterns.js.

import { makeRng } from '../rng.js';
import { fromPath, addVolume } from '../data.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------------------------
// Chart patterns. path(rng) builds waypoints (prices around 100) for the prior trend, the
// formation and the breakout. chartScenario() adds the follow-through, generates candles and
// measures everything from the generated candles.
// ---------------------------------------------------------------------------------------------

/** items: [{ w, p, label? }] → x positions from cumulative weights (first item at x = 0). */
function place(items) {
  const total = items.slice(1).reduce((s, it) => s + it.w, 0);
  let acc = 0;
  return items.map((it, i) => {
    if (i > 0) acc += it.w;
    return { ...it, x: acc / total };
  });
}
const lineAt = (a, b, x) => a.p + ((b.p - a.p) * (x - a.x)) / (b.x - a.x || 1);

function finish(items, extra, inverted) {
  const pts = items.map((it) => [it.x, inverted ? 200 - it.p : it.p]);
  const labels = {};
  items.forEach((it, i) => {
    if (it.label) labels[i] = it.label;
  });
  const out = { points: pts, labels, ...extra, direction: inverted ? -extra.direction : extra.direction };
  if (inverted && extra.boundaries) out.boundaries = { upper: extra.boundaries.lower, lower: extra.boundaries.upper };
  return out;
}

function priorTrend(rng, s, target) {
  return [
    { w: 0, p: s },
    { w: 1.0, p: s + (target - s) * rng.float(0.5, 0.62) },
    { w: 0.5, p: s + (target - s) * rng.float(0.26, 0.36) },
  ];
}

function headAndShoulders(rng, inv) {
  const LS = 100;
  const T1 = LS * (1 - rng.float(0.045, 0.06));
  const head = LS * (1 + rng.float(0.05, 0.085));
  const T2 = T1 * (1 + rng.float(-0.01, 0.01));
  const RS = LS * (1 + rng.float(-0.012, 0.01));
  const s = T1 * (1 - rng.float(0.05, 0.075));
  const items = place([
    ...priorTrend(rng, s, LS),
    { w: 1.1, p: LS, label: 'Left shoulder' },
    { w: 0.9, p: T1, label: 'Neckline' },
    { w: 1.0, p: head, label: 'Head' },
    { w: 1.0, p: T2, label: 'Neckline' },
    { w: 0.9, p: RS, label: 'Right shoulder' },
    { w: 0.75, p: 0, label: 'Breakout' },
  ]);
  items[8].p = lineAt({ x: items[4].x, p: T1 }, { x: items[6].x, p: T2 }, items[8].x) - LS * rng.float(0.015, 0.025);
  return finish(items, { breakoutPoint: 8, startPoint: 2, keyStart: 3, neckline: [4, 6], direction: -1, measure: { type: 'neckline', extreme: [5] } }, inv);
}

function doubleTop(rng, inv) {
  const P1 = 100;
  const T = P1 * (1 - rng.float(0.045, 0.075));
  const P2 = P1 * (1 + rng.float(-0.01, 0.008));
  const s = T * (1 - rng.float(0.05, 0.08));
  const items = place([
    ...priorTrend(rng, s, P1),
    { w: 1.1, p: P1, label: inv ? 'Bottom 1' : 'Top 1' },
    { w: 1.3, p: T, label: 'Neckline' },
    { w: 1.3, p: P2, label: inv ? 'Bottom 2' : 'Top 2' },
    { w: 0.9, p: T * (1 - rng.float(0.015, 0.025)), label: 'Breakout' },
  ]);
  return finish(items, { breakoutPoint: 6, startPoint: 2, keyStart: 3, neckline: [4, 4], direction: -1, measure: { type: 'neckline', extreme: [3, 5] } }, inv);
}

function tripleTop(rng, inv) {
  const P1 = 100;
  const T1 = P1 * (1 - rng.float(0.045, 0.065));
  const P2 = P1 * (1 + rng.float(-0.008, 0.008));
  const T2 = T1 * (1 + rng.float(-0.008, 0.008));
  const P3 = P1 * (1 + rng.float(-0.01, 0.006));
  const s = Math.min(T1, T2) * (1 - rng.float(0.05, 0.075));
  const top = inv ? 'Bottom' : 'Top';
  const items = place([
    ...priorTrend(rng, s, P1),
    { w: 1.0, p: P1, label: `${top} 1` },
    { w: 0.9, p: T1, label: 'Neckline' },
    { w: 0.9, p: P2, label: `${top} 2` },
    { w: 0.9, p: T2, label: 'Neckline' },
    { w: 0.9, p: P3, label: `${top} 3` },
    { w: 0.8, p: 0, label: 'Breakout' },
  ]);
  items[8].p = lineAt({ x: items[4].x, p: T1 }, { x: items[6].x, p: T2 }, items[8].x) - P1 * rng.float(0.015, 0.025);
  return finish(items, { breakoutPoint: 8, startPoint: 2, keyStart: 3, neckline: [4, 6], direction: -1, measure: { type: 'neckline', extreme: [3, 5, 7] } }, inv);
}

/** Rising wedge (inv = falling wedge). */
function risingWedge(rng, inv) {
  const W0 = 100 * rng.float(0.055, 0.075);
  const W1 = W0 * rng.float(0.28, 0.38);
  const riseL = 100 * rng.float(0.075, 0.1);
  const L0 = 94;
  const lower = (u) => L0 + riseL * u;
  const upper = (u) => lower(u) + W0 + (W1 - W0) * u;
  const width = (u) => upper(u) - lower(u);
  const Wt = 5.2;
  const us = [0, 0.17, 0.36, 0.55, 0.73, 0.88, 1.0];
  const up = inv ? 'Lower line' : 'Upper line';
  const lo = inv ? 'Upper line' : 'Lower line';
  const s = L0 * (1 - rng.float(0.05, 0.07));
  const items = place([
    { w: 0, p: s },
    { w: 1.3, p: L0 + W0 * rng.float(0.55, 0.8) },
    { w: 0.55, p: lower(0), label: lo },
    { w: (us[1] - us[0]) * Wt, p: upper(us[1]), label: up },
    { w: (us[2] - us[1]) * Wt, p: lower(us[2]) + width(us[2]) * 0.03, label: lo },
    { w: (us[3] - us[2]) * Wt, p: upper(us[3]) - width(us[3]) * 0.03, label: up },
    { w: (us[4] - us[3]) * Wt, p: lower(us[4]), label: lo },
    { w: (us[5] - us[4]) * Wt, p: upper(us[5]), label: up },
    { w: (us[6] - us[5]) * Wt, p: lower(us[6]) - 100 * rng.float(0.013, 0.02), label: 'Breakout' },
  ]);
  return finish(items, { breakoutPoint: 8, startPoint: 2, keyStart: 2, boundaries: { upper: [3, 7], lower: [2, 6] }, direction: -1, measure: { type: 'boundaries' } }, inv);
}

/** Ascending triangle (inv = descending triangle). */
function ascendingTriangle(rng, inv) {
  const R = 100;
  const L1 = R * (1 - rng.float(0.05, 0.065));
  const L3 = R - (R - L1) * rng.float(0.25, 0.35);
  const uL1 = 0.17;
  const uL3 = 0.86;
  const low = (u) => L1 + ((L3 - L1) * (u - uL1)) / (uL3 - uL1);
  const Wt = 5.0;
  const us = [0, uL1, 0.4, 0.57, 0.72, uL3, 1.0];
  const res = inv ? 'Support' : 'Resistance';
  const sup = inv ? 'Falling resistance' : 'Rising support';
  const s = L1 * (1 - rng.float(0.04, 0.06));
  const items = place([
    ...priorTrend(rng, s, R),
    { w: 1.0, p: R, label: res },
    { w: (us[1] - us[0]) * Wt, p: L1, label: sup },
    { w: (us[2] - us[1]) * Wt, p: R * (1 - rng.float(0, 0.0015)), label: res },
    { w: (us[3] - us[2]) * Wt, p: low(us[3]) + (R - low(us[3])) * 0.04, label: sup },
    { w: (us[4] - us[3]) * Wt, p: R, label: res },
    { w: (us[5] - us[4]) * Wt, p: L3, label: sup },
    { w: (us[6] - us[5]) * Wt, p: R * (1 + rng.float(0.016, 0.025)), label: 'Breakout' },
  ]);
  return finish(items, { breakoutPoint: 9, startPoint: 3, keyStart: 3, boundaries: { upper: [3, 7], lower: [4, 8] }, direction: 1, measure: { type: 'boundaries' } }, inv);
}

function symmetricalTriangle(rng) {
  const inv = rng.chance(0.5);
  const C0 = 100;
  const W0 = 100 * rng.float(0.07, 0.09);
  const apex = rng.float(1.25, 1.45);
  const tilt = 100 * rng.float(-0.004, 0.004);
  const width = (u) => W0 * (1 - u / apex);
  const upper = (u) => C0 + width(u) / 2 + tilt * u;
  const lower = (u) => C0 - width(u) / 2 + tilt * u;
  const Wt = 5.0;
  const us = [0, 0.18, 0.4, 0.58, 0.76, 0.9, 1.02];
  const up = inv ? 'Lower line' : 'Upper line';
  const lo = inv ? 'Upper line' : 'Lower line';
  const s = lower(0.18) - 100 * rng.float(0.035, 0.05);
  const items = place([
    ...priorTrend(rng, s, upper(0)),
    { w: 1.0, p: upper(0), label: up },
    { w: (us[1] - us[0]) * Wt, p: lower(us[1]), label: lo },
    { w: (us[2] - us[1]) * Wt, p: upper(us[2]) - width(us[2]) * 0.04, label: up },
    { w: (us[3] - us[2]) * Wt, p: lower(us[3]) + width(us[3]) * 0.04, label: lo },
    { w: (us[4] - us[3]) * Wt, p: upper(us[4]), label: up },
    { w: (us[5] - us[4]) * Wt, p: lower(us[5]), label: lo },
    { w: (us[6] - us[5]) * Wt, p: upper(us[6]) + 100 * rng.float(0.014, 0.022), label: 'Breakout' },
  ]);
  return finish(items, { breakoutPoint: 9, startPoint: 3, keyStart: 3, boundaries: { upper: [3, 7], lower: [4, 8] }, direction: 1, measure: { type: 'boundaries' } }, inv);
}

/** Bull flag (inv = bear flag). */
function bullFlag(rng, inv) {
  const poleStart = 100 * rng.float(0.9, 0.93);
  const Hp = poleStart * rng.float(0.095, 0.13);
  const top = poleStart + Hp;
  const slope = Hp * rng.float(0.12, 0.2);
  const Wc = Hp * rng.float(0.2, 0.27);
  const upper = (u) => top - slope * u;
  const lower = (u) => upper(u) - Wc;
  // Proportions: the flag lasts under twice as long as the pole (a textbook flag is a brief
  // pause); the prior trend gets the room so the pole stands out as the steepest move.
  const Wf = 1.45;
  const us = [0, 0.24, 0.5, 0.76, 1.0];
  const s = poleStart * (1 - rng.float(0.035, 0.055));
  const items = place([
    { w: 0, p: s },
    { w: 1.7, p: poleStart * (1 + rng.float(0.018, 0.03)) },
    { w: 0.75, p: poleStart, label: 'Flagpole start' },
    { w: 0.8, p: top, label: inv ? 'Flagpole bottom' : 'Flagpole top' },
    { w: (us[1] - us[0]) * Wf, p: lower(us[1]), label: 'Flag' },
    { w: (us[2] - us[1]) * Wf, p: upper(us[2]) - Wc * 0.03, label: 'Flag' },
    { w: (us[3] - us[2]) * Wf, p: lower(us[3]), label: 'Flag' },
    { w: (us[4] - us[3]) * Wf, p: upper(us[4]) + Hp * rng.float(0.13, 0.2), label: 'Breakout' },
  ]);
  return finish(items, { breakoutPoint: 7, startPoint: 2, keyStart: 3, boundaries: { upper: [3, 5], lower: [4, 6] }, direction: 1, measure: { type: 'pole', from: 2, to: 3 } }, inv);
}

function cupAndHandle(rng) {
  const R = 100;
  const D = R * rng.float(0.1, 0.15);
  const cup = (u) => R - D * (1 - Math.pow(Math.abs(2 * u - 1), 2.6));
  const s = R * (1 - rng.float(0.08, 0.11));
  const Wc = 4.4;
  const us = [0, 0.1, 0.22, 0.36, 0.5, 0.64, 0.78, 0.9, 1.0];
  const rim2 = R * (1 - rng.float(0, 0.006));
  const items = place([
    ...priorTrend(rng, s, R),
    { w: 0.9, p: R, label: 'Left rim' },
    ...us.slice(1).map((u, i) => ({
      w: (u - us[i]) * Wc,
      p: u === 1 ? rim2 : cup(u),
      label: u === 0.5 ? 'Cup bottom' : u === 1 ? 'Right rim' : undefined,
    })),
    { w: 1.1, p: rim2 - D * rng.float(0.28, 0.4), label: 'Handle' },
    { w: 0.75, p: R * (1 + rng.float(0.016, 0.025)), label: 'Breakout' },
  ]);
  const bo = items.length - 1;
  return finish(items, { breakoutPoint: bo, startPoint: 3, keyStart: 3, neckline: [3, 3], direction: 1, measure: { type: 'neckline', extreme: [7] } }, false);
}

/** Rounding bottom (inv = rounding top). */
function roundingBottom(rng, inv = false) {
  const L = 100;
  const D = L * rng.float(0.1, 0.15);
  const saucer = (u) => L - D * Math.pow(Math.sin(Math.PI * u), 0.65);
  const Ws = 5.0;
  const us = [0, 0.12, 0.26, 0.4, 0.5, 0.6, 0.74, 0.88, 1.0];
  const midLabel = inv ? 'Top' : 'Bottom';
  const items = place([
    { w: 0, p: L * (1 + rng.float(0.08, 0.11)) },
    { w: 1.3, p: L * (1 - rng.float(0.015, 0.025)) },
    { w: 0.45, p: L, label: 'Left lip' },
    ...us.slice(1).map((u, i) => ({
      w: (u - us[i]) * Ws,
      p: u === 1 ? L * (1 - rng.float(0.005, 0.012)) : saucer(u),
      label: u === 0.5 ? midLabel : undefined,
    })),
    { w: 0.6, p: L * (1 + rng.float(0.016, 0.025)), label: 'Breakout' },
  ]);
  const bo = items.length - 1;
  return finish(items, { breakoutPoint: bo, startPoint: 2, keyStart: 2, neckline: [2, 2], direction: 1, measure: { type: 'neckline', extreme: [6] } }, inv);
}

/** Bull pennant (inv = bear pennant): sharp pole, then a short converging triangle. */
function bullPennant(rng, inv) {
  const poleStart = 100 * rng.float(0.9, 0.93);
  const Hp = poleStart * rng.float(0.095, 0.13);
  const top = poleStart + Hp;
  const W0 = Hp * rng.float(0.3, 0.4);
  const W1 = W0 * rng.float(0.2, 0.32);
  const mid0 = top - Hp * rng.float(0.1, 0.18);
  const drift = Hp * rng.float(0.02, 0.07);
  const mid = (u) => mid0 - drift * u;
  const width = (u) => W0 + (W1 - W0) * u;
  const upper = (u) => mid(u) + width(u) / 2;
  const lower = (u) => mid(u) - width(u) / 2;
  const Wf = 1.35;
  const us = [0, 0.28, 0.55, 0.78, 1.0];
  const s = poleStart * (1 - rng.float(0.035, 0.055));
  const items = place([
    { w: 0, p: s },
    { w: 1.7, p: poleStart * (1 + rng.float(0.018, 0.03)) },
    { w: 0.75, p: poleStart, label: 'Flagpole start' },
    { w: 0.8, p: top, label: inv ? 'Flagpole bottom' : 'Flagpole top' },
    { w: (us[1] - us[0]) * Wf, p: lower(us[1]), label: 'Pennant' },
    { w: (us[2] - us[1]) * Wf, p: upper(us[2]) - width(us[2]) * 0.04, label: 'Pennant' },
    { w: (us[3] - us[2]) * Wf, p: lower(us[3]) + width(us[3]) * 0.04, label: 'Pennant' },
    { w: (us[4] - us[3]) * Wf, p: upper(us[4]) + Hp * rng.float(0.13, 0.2), label: 'Breakout' },
  ]);
  return finish(items, {
    breakoutPoint: 7, startPoint: 2, keyStart: 3,
    boundaries: { upper: [3, 5], lower: [4, 6] },
    direction: 1, measure: { type: 'pole', from: 2, to: 3 },
  }, inv);
}

/** Bull rectangle / trading range (inv = bear rectangle): flat support & resistance, break with the trend. */
function rectangle(rng, inv) {
  const R = 100;
  const S = R * (1 - rng.float(0.045, 0.065));
  const Ht = R - S;
  const Wt = 4.6;
  const us = [0, 0.18, 0.36, 0.54, 0.72, 0.88, 1.0];
  const res = inv ? 'Support' : 'Resistance';
  const sup = inv ? 'Resistance' : 'Support';
  const s = S * (1 - rng.float(0.05, 0.07));
  const items = place([
    ...priorTrend(rng, s, R),
    { w: 1.0, p: R, label: res },
    { w: (us[1] - us[0]) * Wt, p: S, label: sup },
    { w: (us[2] - us[1]) * Wt, p: R - Ht * rng.float(0, 0.04), label: res },
    { w: (us[3] - us[2]) * Wt, p: S + Ht * rng.float(0, 0.04), label: sup },
    { w: (us[4] - us[3]) * Wt, p: R, label: res },
    { w: (us[5] - us[4]) * Wt, p: S + Ht * 0.05, label: sup },
    { w: (us[6] - us[5]) * Wt, p: R * (1 + rng.float(0.016, 0.025)), label: 'Breakout' },
  ]);
  return finish(items, {
    breakoutPoint: 9, startPoint: 3, keyStart: 3,
    boundaries: { upper: [3, 7], lower: [4, 8] },
    direction: 1, measure: { type: 'boundaries' },
  }, inv);
}


function cdef(id, name, bias, kind, reliability, text, path) {
  return { id, name, bias, kind, reliability, ...text, path };
}

export const CHART_PATTERNS = {
  'head-and-shoulders': cdef('head-and-shoulders', 'Head and shoulders', 'bearish', 'reversal', 3, {
    summary:
      'Three peaks at the end of an uptrend: a left shoulder, a higher head, and a right shoulder at about the height of the left one. The neckline joins the two lows between them.',
    psychology:
      'Buyers make one more new high with the head, then fail to do it again: the right shoulder stops well below the head. When price closes below the neckline, everyone who bought the shoulders is trapped and selling speeds up.',
    howToTrade:
      'Wait for a candle to close below the neckline. Sell the break or a retest of the neckline from below, with a stop above the right shoulder.',
    target: 'Measure from the top of the head down to the neckline and project that distance down from the breakout point.',
  }, (rng) => headAndShoulders(rng, false)),
  'inverse-head-and-shoulders': cdef('inverse-head-and-shoulders', 'Inverse head and shoulders', 'bullish', 'reversal', 3, {
    summary:
      'Three troughs at the end of a downtrend: a left shoulder, a lower head, and a right shoulder at about the depth of the left one. The neckline joins the two highs between them.',
    psychology:
      'Sellers push to one more new low with the head, then fail to repeat it: the right shoulder holds well above the head. A close above the neckline shows buyers have taken control.',
    howToTrade:
      'Wait for a close above the neckline. Buy the break or a retest of the neckline from above, with a stop below the right shoulder.',
    target: 'Measure from the bottom of the head up to the neckline and project that distance up from the breakout point.',
  }, (rng) => headAndShoulders(rng, true)),
  'double-top': cdef('double-top', 'Double top', 'bearish', 'reversal', 2, {
    summary: "Two peaks at about the same price with a trough between them, shaped like an 'M'. The neckline is the low between the peaks.",
    psychology:
      'Buyers push to a high and are rejected, try again and fail at the same level — sellers are defending it. A break below the trough confirms that control has changed hands.',
    howToTrade:
      'It is only a double top once price closes below the neckline. Sell the break or a retest of the neckline, with a stop above the peaks.',
    target: 'Measure from the peaks down to the neckline and project that height down from the breakout.',
  }, (rng) => doubleTop(rng, false)),
  'double-bottom': cdef('double-bottom', 'Double bottom', 'bullish', 'reversal', 2, {
    summary: "Two troughs at about the same price with a peak between them, shaped like a 'W'. The neckline is the high between the troughs.",
    psychology:
      'Sellers push price down to the same low twice and fail both times — buyers are defending that level. A close above the middle peak confirms buyers are in control.',
    howToTrade:
      'Wait for a close above the neckline. Buy the break or a retest of the neckline, with a stop below the lows.',
    target: 'Measure from the lows up to the neckline and project that height up from the breakout.',
  }, (rng) => doubleTop(rng, true)),
  'triple-top': cdef('triple-top', 'Triple top', 'bearish', 'reversal', 2, {
    summary: 'Three peaks at about the same level with two troughs between them. The neckline (support) runs through the troughs.',
    psychology:
      'Buyers attack the same resistance three times and fail every time. Each failure leaves more trapped buyers, and a break of support releases the selling.',
    howToTrade: 'Wait for a close below the neckline through the troughs. Sell the break or a retest, with a stop above the peaks.',
    target: 'Project the pattern height (peaks to neckline) down from the breakout.',
  }, (rng) => tripleTop(rng, false)),
  'triple-bottom': cdef('triple-bottom', 'Triple bottom', 'bullish', 'reversal', 2, {
    summary: 'Three troughs at about the same level with two peaks between them. The neckline (resistance) runs through the peaks.',
    psychology:
      'Sellers attack the same support three times and fail every time. Buyers keep absorbing the selling, and a break above resistance releases the buying.',
    howToTrade: 'Wait for a close above the neckline through the peaks. Buy the break or a retest, with a stop below the lows.',
    target: 'Project the pattern height (lows to neckline) up from the breakout.',
  }, (rng) => tripleTop(rng, true)),
  'rising-wedge': cdef('rising-wedge', 'Rising wedge', 'bearish', 'reversal', 2, {
    summary:
      'Price climbs between two rising trend lines that converge, with the lower line steeper than the upper one. Textbooks read it as bearish (a breakdown is the classic resolution), but it can break either way.',
    psychology:
      'Each new high is only slightly higher while dips are bought at ever higher prices: buyers are still pushing but gaining less ground each time, a sign the rally is running out of fuel.',
    howToTrade:
      'Wait for a close below the lower trend line. Sell the break or a retest of the line from below, with a stop above the last swing high inside the wedge.',
    target: "Project the wedge's height at its widest point down from the breakout; price often returns to where the wedge began.",
  }, (rng) => risingWedge(rng, false)),
  'falling-wedge': cdef('falling-wedge', 'Falling wedge', 'bullish', 'reversal', 2, {
    summary:
      'Price falls between two descending trend lines that converge, with the upper line steeper than the lower one. Textbooks read it as bullish (an upside break is the classic resolution), but it can break either way.',
    psychology:
      'Each new low is only slightly lower and the drops keep shrinking: sellers are losing momentum even while price drifts down.',
    howToTrade:
      'Wait for a close above the upper trend line. Buy the break or a retest of the line from above, with a stop below the last swing low inside the wedge.',
    target: "Project the wedge's height at its widest point up from the breakout; a return to where the wedge began is common.",
  }, (rng) => risingWedge(rng, true)),
  'ascending-triangle': cdef('ascending-triangle', 'Ascending triangle', 'bullish', 'continuation', 2, {
    summary: 'A flat resistance line on top and rising lows underneath. Textbooks read it as bullish continuation, but a downside break is always possible — wait for the close.',
    psychology:
      'Sellers defend one fixed price, but buyers keep stepping in at higher and higher prices. Eventually the supply at resistance runs out.',
    howToTrade:
      'Wait for a close above the flat resistance, ideally on rising volume. Buy the break or a retest of old resistance as support, with a stop below the last higher low.',
    target: "Take the triangle's height at its widest point (the start) and project it up from the breakout.",
  }, (rng) => ascendingTriangle(rng, false)),
  'descending-triangle': cdef('descending-triangle', 'Descending triangle', 'bearish', 'continuation', 2, {
    summary: 'A flat support line underneath and falling highs above it. Textbooks read it as bearish continuation, but an upside break is always possible — wait for the close.',
    psychology:
      'Buyers defend one fixed price, but sellers get more aggressive, selling at lower and lower highs. Eventually support gives way.',
    howToTrade:
      'Wait for a close below the flat support. Sell the break or a retest of old support from below, with a stop above the last lower high.',
    target: "Take the triangle's height at its widest point (the start) and project it down from the breakout.",
  }, (rng) => ascendingTriangle(rng, true)),
  'symmetrical-triangle': cdef('symmetrical-triangle', 'Symmetrical triangle', 'neutral', 'continuation', 2, {
    summary:
      'Lower highs and higher lows squeeze price between two converging trend lines. Textbooks lean toward a break in the direction of the prior trend, but either side can win.',
    psychology:
      'Buyers and sellers both become less aggressive and the range contracts like a coiled spring. The breakout shows which side has won.',
    howToTrade:
      "Don't guess the direction — wait for a close outside one of the lines. Put the stop just inside the opposite side of the triangle. Breakouts very close to the apex are less reliable.",
    target: "Project the triangle's height at its widest point from the breakout, in the breakout's direction.",
  }, (rng) => symmetricalTriangle(rng)),
  'bull-flag': cdef('bull-flag', 'Bull flag', 'bullish', 'continuation', 2, {
    summary: 'A sharp rally (the flagpole) followed by a small, orderly pullback inside a slightly downward-sloping channel (the flag).',
    psychology:
      'After a burst of buying, some traders take profits, but the selling is light and controlled. When the pause ends, buyers resume the trend.',
    howToTrade:
      "Buy a close above the flag's upper line, with a stop below the flag's low. A good flag is short and retraces less than half of the pole.",
    target: 'Add the length of the flagpole to the breakout point.',
  }, (rng) => bullFlag(rng, false)),
  'bear-flag': cdef('bear-flag', 'Bear flag', 'bearish', 'continuation', 2, {
    summary: 'A sharp drop (the flagpole) followed by a small, orderly bounce inside a slightly upward-sloping channel (the flag).',
    psychology:
      'After a burst of selling, some traders cover and price bounces weakly. When the pause ends, sellers resume the downtrend.',
    howToTrade:
      "Sell a close below the flag's lower line, with a stop above the flag's high. A good flag is short and retraces less than half of the pole.",
    target: 'Subtract the length of the flagpole from the breakout point.',
  }, (rng) => bullFlag(rng, true)),
  'cup-and-handle': cdef('cup-and-handle', 'Cup and handle', 'bullish', 'continuation', 2, {
    summary: "A rounded 'U'-shaped base (the cup) followed by a short, shallow pullback (the handle) just below the cup's rim.",
    psychology:
      'The cup shows selling slowly drying up and buyers gradually returning. The handle is a final shake-out of nervous holders before price clears resistance at the rim.',
    howToTrade:
      'Buy a close above the rim, ideally on strong volume, with a stop below the handle low. Handles should be short and stay in the upper part of the cup.',
    target: "Measure the cup's depth (rim to bottom) and add it to the breakout at the rim.",
  }, (rng) => cupAndHandle(rng)),
  'rounding-bottom': cdef('rounding-bottom', 'Rounding bottom', 'bullish', 'reversal', 2, {
    summary: "A long, gradual 'saucer'-shaped bottom where a downtrend slowly flattens out and turns back up.",
    psychology:
      'Selling pressure fades gradually rather than suddenly. Over many sessions sentiment shifts from bearish, to neutral, to bullish.',
    howToTrade:
      'Wait for a close above the level where the saucer began (its left lip). Buy the break or a retest, with a stop below the right side of the base.',
    target: "Project the saucer's depth up from the breakout level.",
  }, (rng) => roundingBottom(rng, false)),
  'rounding-top': cdef('rounding-top', 'Rounding top', 'bearish', 'reversal', 2, {
    summary: "A long, gradual 'dome'-shaped top where an uptrend slowly flattens out and turns back down.",
    psychology:
      'Buying pressure fades gradually rather than suddenly. Over many sessions sentiment shifts from bullish, to neutral, to bearish.',
    howToTrade:
      'Wait for a close below the level where the dome began (its left lip). Sell the break or a retest, with a stop above the right side of the top.',
    target: "Project the dome's height down from the breakout level.",
  }, (rng) => roundingBottom(rng, true)),
  'bull-pennant': cdef('bull-pennant', 'Bull pennant', 'bullish', 'continuation', 2, {
    summary: 'A sharp rally (the flagpole) followed by a short, converging triangle of lower highs and higher lows (the pennant).',
    psychology:
      'After a burst of buying, price consolidates tightly as both sides lose aggression. The pause is brief; when it ends, buyers resume the trend.',
    howToTrade:
      "Buy a close above the pennant's upper line, with a stop below the pennant's low. A good pennant is short and retraces well under half of the pole.",
    target: 'Add the length of the flagpole to the breakout point.',
  }, (rng) => bullPennant(rng, false)),
  'bear-pennant': cdef('bear-pennant', 'Bear pennant', 'bearish', 'continuation', 2, {
    summary: 'A sharp drop (the flagpole) followed by a short, converging triangle of higher lows and lower highs (the pennant).',
    psychology:
      'After a burst of selling, price consolidates tightly. When the pause ends, sellers resume the downtrend.',
    howToTrade:
      "Sell a close below the pennant's lower line, with a stop above the pennant's high. A good pennant is short and retraces well under half of the pole.",
    target: 'Subtract the length of the flagpole from the breakout point.',
  }, (rng) => bullPennant(rng, true)),
  'bull-rectangle': cdef('bull-rectangle', 'Bull rectangle', 'bullish', 'continuation', 2, {
    summary: 'After an uptrend, price consolidates between flat support and flat resistance (a trading range), then breaks upward.',
    psychology:
      'Buyers and sellers temporarily balance inside a clear range. The textbook read is that the prior uptrend resumes once price clears the top of the box — but ranges can also break the other way.',
    howToTrade:
      'Wait for a close above resistance. Buy the break or a retest of old resistance as support, with a stop below the rectangle low.',
    target: "Project the rectangle's height (resistance minus support) up from the breakout.",
  }, (rng) => rectangle(rng, false)),
  'bear-rectangle': cdef('bear-rectangle', 'Bear rectangle', 'bearish', 'continuation', 2, {
    summary: 'After a downtrend, price consolidates between flat support and flat resistance (a trading range), then breaks downward.',
    psychology:
      'Buyers and sellers temporarily balance inside a clear range. The textbook read is that the prior downtrend resumes once price loses the bottom of the box — but ranges can also break the other way.',
    howToTrade:
      'Wait for a close below support. Sell the break or a retest of old support from below, with a stop above the rectangle high.',
    target: "Project the rectangle's height (resistance minus support) down from the breakout.",
  }, (rng) => rectangle(rng, true))
};

export const CHART_PATTERN_IDS = Object.keys(CHART_PATTERNS);

/**
 * Make a generated chart pattern read the way the textbook draws it:
 *  - before the breakout no candle closes beyond the broken line (that close would BE the
 *    breakout) and, for triangles / wedges / flags, every close stays between the two lines;
 *    wicks may poke through a line, but only a little;
 *  - the breakout candle closes decisively beyond the line;
 *  - a successful breakout holds: later closes stay beyond the broken level (a retest may wick
 *    back to the line).
 * Out-of-bounds opens/closes are reflected back inside (not flattened onto the line), so the
 * adjusted candles still look like ordinary candles. Extremes on the lines are untouched.
 */
function tidyChart(candles, { rng, from, rangeFrom = from, breakoutIdx, dir, level, upperL, lowerL, lvl, height, ok }) {
  const n = candles.length;
  const fix = (c) => {
    c.h = Math.max(c.h, c.o, c.c);
    c.l = Math.min(c.l, c.o, c.c);
  };
  let sr = 0;
  for (let i = rangeFrom; i <= breakoutIdx; i++) sr += candles[i].h - candles[i].l;
  const avgR = sr / Math.max(1, breakoutIdx - rangeFrom + 1) || height * 0.1;
  const m = 0.04 * avgR;
  const poke = Math.max(0.2 * avgR, 0.025 * height);
  const reflect = (v, lo, hi) => {
    if (lo > hi) return (lo + hi) / 2;
    if (v < lo) return Math.min(hi, lo + (lo - v) * 0.6);
    if (v > hi) return Math.max(lo, hi - (v - hi) * 0.6);
    return v;
  };

  // 1. Formation: closes (and opens) inside, wicks poke through a line by at most `poke`.
  for (let i = Math.max(0, from); i < breakoutIdx; i++) {
    const c = candles[i];
    let lo = -Infinity;
    let hi = Infinity;
    let wickLo = -Infinity;
    let wickHi = Infinity;
    if (dir > 0) {
      hi = level(i) - m;
      wickHi = level(i) + poke;
    } else {
      lo = level(i) + m;
      wickLo = level(i) - poke;
    }
    if (upperL) {
      hi = Math.min(hi, upperL(i) - m);
      lo = Math.max(lo, lowerL(i) + m);
      wickHi = Math.min(wickHi, upperL(i) + poke);
      wickLo = Math.max(wickLo, lowerL(i) - poke);
    }
    c.o = reflect(c.o, lo, hi);
    c.c = reflect(c.c, lo, hi);
    c.h = Math.max(Math.max(c.o, c.c), Math.min(c.h, wickHi));
    c.l = Math.min(Math.min(c.o, c.c), Math.max(c.l, wickLo));
  }

  // 2. Decisive breakout close.
  const b = candles[breakoutIdx];
  const minPen = Math.max(0.3 * avgR, 0.05 * height);
  const L = level(breakoutIdx);
  if ((b.c - L) * dir < minPen) {
    b.c = L + dir * minPen * rng.float(1, 1.4);
    if (dir > 0) b.h = Math.max(b.h, b.c + avgR * rng.float(0.03, 0.2));
    else b.l = Math.min(b.l, b.c - avgR * rng.float(0.03, 0.2));
    fix(b);
    const nx = candles[breakoutIdx + 1];
    if (nx) {
      nx.o = b.c;
      fix(nx);
    }
  }

  // 3. A successful breakout holds beyond the broken level (and, for ~10 bars, beyond the
  //    extended line when that is further out).
  if (ok) {
    for (let i = breakoutIdx + 1; i < n; i++) {
      const c = candles[i];
      let ref = lvl;
      if (i <= breakoutIdx + 10) ref = dir > 0 ? Math.max(lvl, level(i)) : Math.min(lvl, level(i));
      const lo = dir > 0 ? ref + m : -Infinity;
      const hi = dir > 0 ? Infinity : ref - m;
      c.o = reflect(c.o, lo, hi);
      c.c = reflect(c.c, lo, hi);
      fix(c);
    }
  }
}

/**
 * chartScenario(patternId, { seed, count = 110, start = 100, after = 20, outcome = 'success' })
 * The prior trend + formation + breakout fill the first count − after candles; `after`
 * follow-through candles show the outcome: 'success' heads for the measured-move target (often
 * with a retest of the broken level first); 'fail' breaks out briefly, then reverses back
 * through the pattern (a failed breakout / trap).
 * → { candles, patternStart, patternEnd, breakoutIdx, keyPoints: [{ idx, price, label }],
 *     neckline: { x1, y1, x2, y2 } | null, boundaries: { upper: {x1,y1,x2,y2}, lower: {…} } | null,
 *     target, height, level, bias, direction, outcome, reachedTarget, id, name }
 * Coordinates are candle idx / price. patternEnd = breakoutIdx − 1. `level` is the broken
 * line's price at the breakout candle.
 */
export function chartScenario(patternId, { seed, count = 110, start = 100, after = 20, outcome = 'success' } = {}) {
  const P = CHART_PATTERNS[patternId];
  if (!P) throw new Error(`Unknown chart pattern: ${patternId}`);
  const rng = makeRng(seed ?? 1);
  const shape = P.path(rng.fork('path'));
  const k = start / 100;
  const n = Math.max(40, Math.floor(count));
  const nAfter = clamp(Math.floor(after), 0, n - 30);
  const xb = (n - nAfter - 1) / (n - 1);
  const ok = outcome !== 'fail';
  const dir = shape.direction;
  const bo = shape.breakoutPoint;
  const pts = shape.points.map(([x, p]) => [x * xb, p * k]);

  // Approximate geometry in x-space to plan the follow-through.
  const lineX = (pair) => {
    const [a, b] = pair;
    const A = pts[a];
    const B = pts[b];
    if (a === b) return () => A[1];
    return (x) => A[1] + ((B[1] - A[1]) * (x - A[0])) / (B[0] - A[0]);
  };
  let levelX;
  let heightX;
  if (shape.neckline) {
    levelX = lineX(shape.neckline);
    const ext = shape.measure.extreme.map((i) => Math.abs(pts[i][1] - levelX(pts[i][0])));
    heightX = Math.max(...ext);
  } else {
    const upperX = lineX(shape.boundaries.upper);
    const lowerX = lineX(shape.boundaries.lower);
    levelX = dir > 0 ? upperX : lowerX;
    if (shape.measure.type === 'pole') heightX = Math.abs(pts[shape.measure.to][1] - pts[shape.measure.from][1]);
    else {
      const x0 = Math.min(pts[shape.boundaries.upper[0]][0], pts[shape.boundaries.lower[0]][0]);
      heightX = upperX(x0) - lowerX(x0);
    }
  }
  const B = pts[bo][1];
  const lvlB = levelX(pts[bo][0]);
  // The real breakout candle can come a little before the breakout waypoint; on a sloping line
  // that moves the measured target, so plan from the most distant level in that window.
  const lvlPrev = levelX(pts[bo - 1][0]);
  const lvlPlan = dir > 0 ? Math.max(lvlB, lvlPrev) : Math.min(lvlB, lvlPrev);
  const targetX = lvlPlan + dir * heightX;
  const afterPts = [];
  const xa = (f) => xb + f * (1 - xb);
  if (nAfter >= 4) {
    if (ok) {
      if (rng.chance(0.55) && nAfter >= 8) {
        // Retest: price comes back to the broken line and holds on the far side of it (the
        // wick touches the line; closes stay beyond — otherwise it would read as a failure).
        const f = rng.float(0.22, 0.32);
        const lineNow = levelX(xa(f));
        const ref = dir > 0 ? Math.max(lvlPlan, lineNow) : Math.min(lvlPlan, lineNow);
        afterPts.push([xa(f), ref + dir * heightX * rng.float(0.0, 0.05)]);
      }
      afterPts.push([xa(rng.float(0.75, 0.88)), targetX + dir * heightX * rng.float(0.06, 0.14)]);
      afterPts.push([1, targetX + dir * heightX * rng.float(-0.18, 0.12)]);
    } else {
      afterPts.push([xa(rng.float(0.1, 0.18)), B + dir * heightX * rng.float(0.08, 0.18)]);
      afterPts.push([xa(rng.float(0.45, 0.55)), levelX(xa(0.5)) - dir * heightX * rng.float(0.3, 0.45)]);
      afterPts.push([1, lvlB - dir * heightX * rng.float(0.8, 1.05)]);
    }
  } else if (nAfter > 0) {
    afterPts.push([1, B + (ok ? dir : -dir) * heightX * 0.25 * nAfter / 4]);
  }
  // The setup (prior trend, formation and breakout) is generated on its own, so both outcomes
  // of a seed share exactly the same candles up to the breakout candle; the follow-through is
  // generated separately and continues from the breakout close.
  const nForm = n - nAfter;
  const form = fromPath(
    pts.map(([x, p]) => [xb > 0 ? x / xb : 0, p]),
    { seed: rng.fork('candles').seed, count: nForm, noise: 0.35, wick: 0.6, exact: true, volume: false },
  );
  let series = form.candles;
  const anchors = form.anchors.slice();
  if (nAfter > 0 && afterPts.length) {
    const B0 = series[nForm - 1].c;
    const local = [[0, B0], ...afterPts.map(([x, p]) => [(x - xb) / (1 - xb), p])];
    const aft = fromPath(local, { seed: rng.fork('after').seed, count: nAfter + 1, noise: 0.35, wick: 0.6, exact: true, volume: false });
    const tail = aft.candles.slice(1);
    tail[0].o = B0;
    tail[0].h = Math.max(tail[0].h, B0);
    tail[0].l = Math.min(tail[0].l, B0);
    series = series.concat(tail);
    aft.anchors.slice(1).forEach((a) => anchors.push({ ...a, idx: a.idx + nForm - 1 }));
  }
  const candles = addVolume(series.map((c, i) => ({ ...c, t: i })), { seed: rng.fork('volume').seed });
  const A = (i) => anchors[i];

  // Real geometry from the generated candles.
  const lineIdx = (pair) => {
    const a = A(pair[0]);
    const b = A(pair[1]);
    if (pair[0] === pair[1]) return () => a.price;
    return (x) => a.price + ((b.price - a.price) * (x - a.idx)) / (b.idx - a.idx);
  };
  let level;
  let upperL = null;
  let lowerL = null;
  if (shape.neckline) level = lineIdx(shape.neckline);
  else {
    upperL = lineIdx(shape.boundaries.upper);
    lowerL = lineIdx(shape.boundaries.lower);
    level = dir > 0 ? upperL : lowerL;
  }
  const lastFormation = A(bo - 1).idx;
  let breakoutIdx = A(bo).idx;
  for (let i = lastFormation + 1; i <= A(bo).idx; i++) {
    const c = candles[i].c;
    if ((dir > 0 && c > level(i)) || (dir < 0 && c < level(i))) {
      breakoutIdx = i;
      break;
    }
  }
  const patternStart = A(shape.startPoint).idx;
  const patternEnd = Math.max(patternStart, breakoutIdx - 1);
  const keyStartIdx = A(shape.keyStart).idx;

  let height;
  if (shape.neckline) height = Math.max(...shape.measure.extreme.map((i) => Math.abs(A(i).price - level(A(i).idx))));
  else if (shape.measure.type === 'pole') height = Math.abs(A(shape.measure.to).price - A(shape.measure.from).price);
  else {
    const x0 = Math.min(A(shape.boundaries.upper[0]).idx, A(shape.boundaries.lower[0]).idx);
    height = upperL(x0) - lowerL(x0);
  }
  const lvl = level(breakoutIdx);
  const target = lvl + dir * height;

  tidyChart(candles, { rng: rng.fork('tidy'), from: keyStartIdx, rangeFrom: patternStart, breakoutIdx, dir, level, upperL, lowerL, lvl, height, ok });

  const seg = (fn, x1, x2) => ({ x1, y1: fn(x1), x2, y2: fn(x2) });
  const neckline = shape.neckline ? seg(level, keyStartIdx, breakoutIdx) : null;
  let boundaries = null;
  if (shape.boundaries) {
    const x0 = Math.min(A(shape.boundaries.upper[0]).idx, A(shape.boundaries.lower[0]).idx);
    boundaries = { upper: seg(upperL, x0, breakoutIdx), lower: seg(lowerL, x0, breakoutIdx) };
  }

  const keyPoints = [];
  Object.entries(shape.labels).forEach(([i, label]) => {
    const a = A(Number(i));
    if (label === 'Breakout') return;
    keyPoints.push({ idx: a.idx, price: a.price, label });
  });
  keyPoints.push({ idx: breakoutIdx, price: candles[breakoutIdx].c, label: 'Breakout' });
  keyPoints.sort((a, b) => a.idx - b.idx);

  // Volume: fades while the pattern forms, expands on a genuine breakout, stays weak on a trap.
  // Rounded bases (cup, saucer) have the textbook U-shaped volume instead: it dries up towards
  // the bottom of the base and picks up again as price climbs back to the rim; a handle is quiet.
  const span = Math.max(1, patternEnd - patternStart);
  const rounded = patternId === 'cup-and-handle' || patternId === 'rounding-bottom' || patternId === 'rounding-top';
  const rim = rounded ? level(patternStart) : 0;
  const bottomIdx = rounded ? A(shape.measure.extreme[0]).idx : 0;
  const depth = rounded ? Math.max(1e-9, Math.abs(rim - A(shape.measure.extreme[0]).price)) : 1;
  const rightRim = Object.keys(shape.labels).find((k) => shape.labels[k] === 'Right rim');
  const handleFrom = rightRim != null ? A(Number(rightRim)).idx : Infinity;
  // A flag's volume is heavy on the pole and fades through the flag itself.
  const poleTop = shape.measure.type === 'pole' ? A(shape.measure.to).idx : null;
  // Each bar's volume is pulled most of the way (geometrically) towards the envelope V0 × f, so
  // the profile is unmistakable while bigger candles still trade a little more.
  const V0 = candles.slice(patternStart, patternEnd + 1).reduce((a, c) => a + c.v, 0) / (patternEnd - patternStart + 1);
  for (let i = patternStart; i <= patternEnd; i++) {
    let f;
    if (poleTop != null) f = i <= poleTop ? 1 : 0.9 - 0.45 * ((i - poleTop) / Math.max(1, patternEnd - poleTop));
    else if (!rounded) f = 1 - 0.5 * ((i - patternStart) / span);
    else if (i > handleFrom) f = 0.55;
    else {
      const d = clamp(Math.abs(rim - candles[i].c) / depth, 0, 1);
      f = (1 - 0.55 * d) * (i > bottomIdx ? 0.95 : 1);
    }
    candles[i].v = Math.max(1, Math.round(poleTop != null && i <= poleTop ? candles[i].v : candles[i].v ** 0.3 * (V0 * f) ** 0.7));
  }
  // Each later test of the same level (Top 2, Top 3, the right shoulder) comes on lighter
  // volume than the first one — the classic warning that buyers (sellers) are tiring.
  const firstTest = keyPoints.find((k) => ['Top 1', 'Bottom 1', 'Left shoulder'].includes(k.label));
  if (firstTest) {
    const around = (idx) => candles.slice(Math.max(0, idx - 2), idx + 3);
    const mean = (cs) => cs.reduce((s2, c) => s2 + c.v, 0) / cs.length;
    const v1 = mean(around(firstTest.idx));
    let cap = 0.8;
    for (const k of keyPoints) {
      if (!['Top 2', 'Top 3', 'Bottom 2', 'Bottom 3', 'Right shoulder'].includes(k.label)) continue;
      const win = around(k.idx);
      const f = Math.min(1, (cap * v1) / mean(win));
      for (const c of win) c.v = Math.max(1, Math.round(c.v * f));
      cap *= 0.85;
    }
  }
  if (shape.measure.type === 'pole') {
    for (let i = A(shape.measure.from).idx + 1; i <= A(shape.measure.to).idx; i++) candles[i].v = Math.round(candles[i].v * 1.6);
  }
  const avgV = (a, b) => {
    const cs = candles.slice(Math.max(0, a), Math.max(a + 1, b));
    return cs.reduce((s, c) => s + c.v, 0) / Math.max(1, cs.length);
  };
  const vRecent = avgV(Math.max(patternStart, breakoutIdx - 10), breakoutIdx);
  const vForm = avgV(keyStartIdx, breakoutIdx); // the formation itself (a flag excludes its pole)
  const vrng = rng.fork('bo-volume');
  // Real breakout: 1.8–2.6× the recent average, still above average for two more bars.
  // Trap: the breakout bar is below the recent average — no conviction behind it.
  const boost = ok ? [vrng.float(1.8, 2.6), vrng.float(1.3, 1.7), vrng.float(1.05, 1.3)] : [vrng.float(0.6, 0.85), vrng.float(0.6, 0.9), vrng.float(0.7, 0.95)];
  boost.forEach((b, j) => {
    const c = candles[breakoutIdx + j];
    if (!c) return;
    const want = ok ? Math.max(vRecent * b, j === 0 ? vForm * 1.4 : 0) : vRecent * b;
    c.v = Math.max(1, Math.round(ok ? Math.max(c.v, want) : Math.min(c.v, want)));
  });

  let reachedTarget = false;
  for (let i = breakoutIdx; i < n; i++) {
    if ((dir > 0 && candles[i].h >= target) || (dir < 0 && candles[i].l <= target)) {
      reachedTarget = true;
      break;
    }
  }

  return {
    id: patternId,
    name: P.name,
    candles,
    patternStart,
    patternEnd,
    breakoutIdx,
    keyPoints,
    neckline,
    boundaries,
    target,
    height,
    level: lvl,
    bias: dir > 0 ? 'bullish' : 'bearish',
    direction: dir,
    outcome: ok ? 'success' : 'fail',
    reachedTarget,
  };
}
