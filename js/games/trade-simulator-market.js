// Trade Simulator — market builder (private helper of js/games/trade-simulator.js).
// Generates the ~400-bar replay market for a preset (Trending / Choppy / Mixed, or a surprise):
// realisticMarket() stretches with regimes forced per segment, trend legs that pull back to the
// moving averages, and chartScenario() patterns stitched in. Every market is generate-and-test
// validated (its character, price range, candle sanity and the setups a trader can find); after
// 30 failed tries a hand-tuned market is used. Also turns a real-market round into a replay
// market (prices rebased to 100). Pure module (no DOM) so node can import it.

import { makeRng } from '../core/rng.js';
import { realisticMarket, fromPath, roundPrice } from '../core/data.js';
import { chartScenario } from '../core/patterns.js';
import { atr, ema, sma } from '../core/indicators.js';
import { findSetups } from '../core/scanner.js';

export const BARS = 400;
export const START_VISIBLE = 80;
const MAX_TRIES = 30;

export const PRESETS = [
  { id: 'mixed', label: 'Mixed', blurb: 'Trends, ranges and a couple of chart patterns, like a year of real prices.' },
  { id: 'trending', label: 'Trending', blurb: 'Long trend legs that pull back to the moving averages, plus a continuation pattern.' },
  { id: 'choppy', label: 'Choppy', blurb: 'Sideways ranges, false breakouts and sharp swings. Patience pays here.' },
  { id: 'surprise', label: 'Surprise me', blurb: 'A random market character, revealed on your report card.' },
];
export const PRESET_IDS = PRESETS.map((p) => p.id);
export const presetLabel = (id) => PRESETS.find((p) => p.id === id)?.label || 'Mixed';

/** Setup kinds that count as a tradeable opportunity when validating a market. */
const TRADEABLE = [
  'support-bounce', 'resistance-reject', 'breakout-up', 'breakout-down', 'fakeout-up', 'fakeout-down',
  'fib-pullback', 'bull-flag', 'bear-flag', 'double-top', 'double-bottom', 'head-and-shoulders',
  'inverse-head-and-shoulders', 'trend-up', 'trend-down', 'range',
];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const median = (arr) => {
  const s = arr.filter(isNum).slice().sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ------------------------------------------------------------------------------ measurements

/** Mean ATR(14) as a fraction of price over a candle list. */
export function atrPct(candles) {
  if (candles.length < 16) {
    const r = candles.map((c) => (c.h - c.l) / c.c);
    return r.reduce((a, b) => a + b, 0) / Math.max(1, r.length);
  }
  const a = atr(candles, 14);
  let s = 0;
  let n = 0;
  for (let i = 14; i < candles.length; i++) {
    if (isNum(a[i]) && candles[i].c > 0) {
      s += a[i] / candles[i].c;
      n++;
    }
  }
  return n ? s / n : 0.01;
}

/** Kaufman efficiency ratio of closes [from, to]: |net move| / path length (0 = chop, 1 = straight line). */
export function efficiency(candles, from, to) {
  let path = 0;
  for (let i = from + 1; i <= to; i++) path += Math.abs(candles[i].c - candles[i - 1].c);
  return path > 0 ? Math.abs(candles[to].c - candles[from].c) / path : 0;
}

/** Efficiency of 50-bar windows every 10 bars across the playable part (bar START_VISIBLE on). */
export function windowEfficiencies(candles, w = 50, from = START_VISIBLE - 30) {
  const out = [];
  for (let i = Math.max(0, from); i + w < candles.length; i += 10) out.push(efficiency(candles, i, i + w));
  return out;
}

/** Uptrend / downtrend pullbacks that tag the 20 EMA (low/high reaches it, close holds its side). */
export function emaPullbacks(candles, from = START_VISIBLE) {
  const cl = candles.map((c) => c.c);
  const e20 = ema(cl, 20);
  const s50 = sma(cl, 50);
  let n = 0;
  let last = -99;
  for (let i = Math.max(from, 55); i < candles.length; i++) {
    const k = candles[i];
    const e = e20[i];
    const s = s50[i];
    const s5 = s50[i - 5];
    if (!isNum(e) || !isNum(s) || !isNum(s5)) continue;
    const up = e > s && s > s5 && k.l <= e && k.c > e;
    const dn = e < s && s < s5 && k.h >= e && k.c < e;
    if ((up || dn) && i - last > 6) {
      n++;
      last = i;
    }
  }
  return n;
}

// ------------------------------------------------------------------------------ stitching

/** Rescale a chunk so its first open equals `price` (percent moves unchanged); power α stretches its volatility. */
function fitChunk(chunk, price, alpha = 1) {
  const p0 = chunk[0].o;
  const tf = (p) => price * Math.pow(p / p0, alpha);
  return chunk.map((k) => {
    const o = tf(k.o);
    const c = tf(k.c);
    return { o, h: Math.max(tf(k.h), o, c), l: Math.min(tf(k.l), o, c), c, v: k.v || 0 };
  });
}

/** Scale a chunk's volume so its median matches the recent median of the market (continuity). */
function fitVolume(prefix, chunk, rng) {
  const ref = median(prefix.slice(-40).map((k) => k.v));
  const own = median(chunk.map((k) => k.v));
  if (!(ref > 0) || !(own > 0)) return;
  const f = (ref / own) * rng.float(0.9, 1.1);
  for (const k of chunk) k.v = Math.max(1, Math.round(k.v * f));
}

const seedOf = (rng) => rng.int(1, 2 ** 31 - 1);
/** Volatility of each segment type relative to the market's target ATR. */
const TYPE_VOL = { leg: 1, range: 0.85, volatile: 1.45, sim: 1 };

// ------------------------------------------------------------------------------ segments

/** A realisticMarket stretch whose regime is forced (trend legs in one direction, ranges, volatile spells). */
function simSegment(rng, prefix, seg, ctx) {
  const { bars, type } = seg;
  const price = prefix.length ? prefix[prefix.length - 1].c : 100;
  const vol = ctx.vol;
  let best = null;
  let bestScore = -Infinity;
  for (let t = 0; t < 14; t++) {
    let cs;
    if (type === 'leg') {
      cs = realisticMarket({ seed: seedOf(rng), count: bars, regime: 'trend', vol, drift: seg.dir * vol * rng.float(0.24, 0.34), gaps: ctx.gaps });
    } else if (type === 'range') {
      cs = realisticMarket({ seed: seedOf(rng), count: bars, regime: 'range', vol: vol * 1.05, gaps: ctx.gaps });
    } else if (type === 'volatile') {
      cs = realisticMarket({ seed: seedOf(rng), count: bars, regime: 'volatile', vol: vol * 0.8, gaps: ctx.gaps });
    } else {
      cs = realisticMarket({ seed: seedOf(rng), count: bars, regime: seg.regime || 'mixed', vol, gaps: ctx.gaps });
    }
    // Match the market's volatility (a power transform scales log-returns, keeping the shape).
    const want = ctx.targetAtr * (TYPE_VOL[type] || 1) * rng.float(0.88, 1.12);
    cs = fitChunk(cs, price, clamp(want / Math.max(1e-4, atrPct(cs)), 0.6, 1.8));
    const a = atrPct(cs) * price;
    const net = cs[cs.length - 1].c - cs[0].o;
    const er = efficiency(cs, 0, cs.length - 1);
    let score;
    if (type === 'leg') {
      // Moves the planned way by ≥ 4 ATR, reasonably efficient, and pulls back to the 20 EMA.
      const pb = emaPullbacks([...prefix, ...cs], prefix.length);
      score = (Math.sign(net) === seg.dir ? 1 : -5) + Math.min(2, Math.abs(net) / (4 * a)) + er * 2 + Math.min(2, pb) * 0.8;
      if (Math.sign(net) === seg.dir && Math.abs(net) >= 4 * a && pb >= 1 && er >= 0.18) return cs;
    } else if (type === 'range') {
      // Sideways (low efficiency) but wide enough to trade its edges.
      const hi = Math.max(...cs.map((k) => k.h));
      const lo = Math.min(...cs.map((k) => k.l));
      const height = (hi - lo) / a;
      score = -er * 4 + Math.min(2, height / 5);
      if (er <= 0.16 && height >= 4.5 && height <= 14) return cs;
    } else {
      score = 1 - er;
      if (Math.abs(net) / a < 8) return cs;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cs;
    }
  }
  return best;
}

/** A chart pattern (chartScenario) scaled onto the current price and volatility. */
function patternSegment(rng, prefix, seg, ctx) {
  const price = prefix.length ? prefix[prefix.length - 1].c : 100;
  const id = rng.pick(seg.ids);
  const sc = chartScenario(id, { seed: seedOf(rng), count: seg.bars, after: seg.after, outcome: seg.outcome });
  const target = ctx.targetAtr * rng.float(0.9, 1.1);
  const own = atrPct(sc.candles);
  const alpha = clamp(target / Math.max(1e-4, own), 0.75, 1.7);
  const cs = fitChunk(sc.candles, price, alpha);
  const p0 = sc.candles[0].o;
  const tf = (p) => price * Math.pow(p / p0, alpha);
  return {
    candles: cs,
    event: {
      kind: 'pattern', id: sc.id, name: sc.name, outcome: sc.outcome, bias: sc.bias, direction: sc.direction,
      patternStart: sc.patternStart, breakoutIdx: sc.breakoutIdx, level: tf(sc.level), target: tf(sc.target),
    },
  };
}

// ------------------------------------------------------------------------------ plans

const UP_REVERSALS = ['head-and-shoulders', 'double-top', 'triple-top', 'rising-wedge']; // after an up leg
const DOWN_REVERSALS = ['inverse-head-and-shoulders', 'double-bottom', 'triple-bottom', 'falling-wedge'];
const BULL_CONT = ['bull-flag', 'ascending-triangle'];
const BEAR_CONT = ['bear-flag', 'descending-triangle'];

/** Next leg direction: follow `pref`, but lean back towards 100 so prices stay "around 100". */
function legDir(rng, price, pref) {
  if (price > 128) return -1;
  if (price < 78) return 1;
  if (pref) return rng.chance(0.72) ? pref : -pref;
  return rng.sign();
}

const jitter = (rng, n, f = 0.18) => Math.max(14, Math.round(n * rng.float(1 - f, 1 + f)));

function buildPlan(preset, rng, diff) {
  const trapChance = 0.15 + 0.35 * diff; // harder markets set more bull/bear traps
  if (preset === 'trending') {
    return [
      { type: 'leg', bars: jitter(rng, 88, 0.08), dir: 0 },
      { type: 'leg', bars: jitter(rng, 50), dir: 'same' },
      { type: 'pattern', cont: true, bars: 92, after: 24, outcome: rng.chance(trapChance * 0.5) ? 'fail' : 'success' },
      { type: 'leg', bars: jitter(rng, 48), dir: 'same' },
      { type: 'range', bars: jitter(rng, 30) },
      { type: 'leg', bars: jitter(rng, 50), dir: 'any' },
      { type: 'leg', bars: 0, dir: 'same' }, // fills the rest
    ];
  }
  if (preset === 'choppy') {
    return [
      { type: 'range', bars: jitter(rng, 88, 0.08) },
      { type: 'range', bars: jitter(rng, 46) },
      { type: 'pattern', choppy: true, bars: 90, after: 22, outcome: 'fail' },
      { type: 'volatile', bars: jitter(rng, 26) },
      { type: 'range', bars: jitter(rng, 50) },
      { type: 'pattern', choppy: true, bars: 90, after: 22, outcome: rng.chance(0.5 + trapChance * 0.5) ? 'fail' : 'success' },
      { type: 'range', bars: 0 },
    ];
  }
  // mixed
  return [
    { type: 'sim', regime: 'mixed', bars: jitter(rng, 86, 0.08) },
    { type: 'leg', bars: jitter(rng, 44), dir: 'any' },
    { type: 'pattern', reversal: true, bars: 92, after: 24, outcome: rng.chance(trapChance) ? 'fail' : 'success' },
    { type: 'range', bars: jitter(rng, 34) },
    { type: 'leg', bars: jitter(rng, 40), dir: 'after-pattern' },
    { type: 'pattern', cont: true, bars: 90, after: 22, outcome: rng.chance(trapChance) ? 'fail' : 'success' },
    { type: 'leg', bars: 0, dir: 'same' },
  ];
}

function assemble(preset, rng, diff) {
  const ctx = {
    vol: 0.0062 + 0.0034 * diff, // Easy 0.0069 · Normal 0.0079 · Hard 0.0091 (ATR ≈ 1.2–1.6% of price)
    gaps: diff > 0.3,
    targetAtr: 0.011 + 0.006 * diff, // ATR as a fraction of price: Easy 1.2% · Normal 1.4% · Hard 1.6%
  };
  const plan = buildPlan(preset, rng, diff);
  const out = [];
  const events = [];
  const segments = [];
  let lastDir = 0;
  for (let s = 0; s < plan.length; s++) {
    const seg = { ...plan[s] };
    const price = out.length ? out[out.length - 1].c : 100;
    const left = BARS - out.length;
    if (left <= 0) break;
    if (!seg.bars || s === plan.length - 1) seg.bars = left;
    if (seg.type === 'pattern' && seg.bars > left) {
      seg.type = 'leg';
      seg.dir = 'same';
      seg.bars = left;
    }
    seg.bars = Math.min(seg.bars, left);
    if (seg.type === 'leg') {
      const pref = seg.dir === 'same' || seg.dir === 'after-pattern' ? lastDir || 0 : 0;
      seg.dir = legDir(rng, price, pref);
      lastDir = seg.dir;
    }
    if (seg.bars < 12) {
      // A tiny remainder: extend the previous stretch.
      seg.type = 'sim';
      seg.regime = 'mixed';
    }
    let chunk;
    if (seg.type === 'pattern') {
      let ids;
      if (seg.cont) ids = (lastDir || legDir(rng, price, 0)) > 0 ? BULL_CONT : BEAR_CONT;
      else if (seg.reversal) ids = lastDir > 0 ? UP_REVERSALS : lastDir < 0 ? DOWN_REVERSALS : [...UP_REVERSALS, ...DOWN_REVERSALS];
      else ids = ['double-top', 'double-bottom', 'symmetrical-triangle', 'triple-top', 'triple-bottom'];
      // Keep the price roughly around 100: bullish patterns when low, bearish when high.
      if (price > 125) ids = ids.filter((id) => !BULL_CONT.includes(id) && !DOWN_REVERSALS.includes(id) && id !== 'double-bottom' && id !== 'triple-bottom');
      if (price < 80) ids = ids.filter((id) => !BEAR_CONT.includes(id) && !UP_REVERSALS.includes(id) && id !== 'double-top' && id !== 'triple-top');
      if (!ids.length) ids = ['symmetrical-triangle'];
      const p = patternSegment(rng.fork(`pattern-${s}`), out, { ...seg, ids }, ctx);
      chunk = p.candles;
      const off = out.length;
      events.push({ ...p.event, patternStart: p.event.patternStart + off, breakoutIdx: p.event.breakoutIdx + off });
      // After a pattern, the next leg follows the pattern's resolution (the trap reverses it).
      lastDir = p.event.outcome === 'fail' ? -p.event.direction : p.event.direction;
    } else {
      chunk = simSegment(rng.fork(`seg-${s}`), out, seg, ctx);
    }
    if (out.length) fitVolume(out, chunk, rng);
    segments.push({ type: seg.type, from: out.length, to: out.length + chunk.length - 1, dir: seg.dir || 0 });
    out.push(...chunk);
  }
  return { candles: finalize(out.slice(0, BARS)), events, segments };
}

/** Round to cents and repair OHLC so every candle is valid with a non-zero range. */
function finalize(list) {
  return list.map((k, i) => {
    const o = roundPrice(k.o, 2);
    const c = roundPrice(k.c, 2);
    let hi = Math.max(roundPrice(k.h, 2), o, c);
    let lo = Math.min(roundPrice(k.l, 2), o, c);
    if (hi - lo < 0.01) {
      hi = roundPrice(hi + 0.01, 2);
      lo = roundPrice(Math.max(0.01, lo - 0.01), 2);
    }
    return { o, h: hi, l: lo, c, v: Math.max(1, Math.round(k.v || 1)), t: i };
  });
}

// ------------------------------------------------------------------------------ validation

/** → { ok, reasons: [..], metrics } — the checks every generated market must pass. */
export function validateMarket(candles, preset, events = []) {
  const reasons = [];
  const n = candles.length;
  if (n !== BARS) reasons.push(`length ${n}`);
  let minL = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < n; i++) {
    const k = candles[i];
    if (![k.o, k.h, k.l, k.c].every((v) => isNum(v) && v > 0) || k.l > Math.min(k.o, k.c) || k.h < Math.max(k.o, k.c)) {
      reasons.push(`invalid candle ${i}`);
      break;
    }
    minL = Math.min(minL, k.l);
    maxH = Math.max(maxH, k.h);
  }
  if (minL < 45 || maxH > 220) reasons.push(`price range ${minL.toFixed(1)}–${maxH.toFixed(1)}`);
  const ranges = candles.map((k) => k.h - k.l);
  const med = median(ranges);
  const spikes = ranges.filter((r) => r > med * 7.5).length;
  if (spikes > 1) reasons.push(`${spikes} spike candles`);
  let bigGaps = 0;
  for (let i = 1; i < n; i++) if (Math.abs(candles[i].o / candles[i - 1].c - 1) > 0.05) bigGaps++;
  if (bigGaps) reasons.push(`${bigGaps} gaps > 5%`);
  const ap = atrPct(candles);
  if (ap < 0.007 || ap > 0.026) reasons.push(`ATR ${(ap * 100).toFixed(2)}%`);

  const ers = windowEfficiencies(candles);
  const erMean = ers.reduce((a, b) => a + b, 0) / Math.max(1, ers.length);
  const erMax = Math.max(...ers);
  const erMin = Math.min(...ers);
  const pullbacks = emaPullbacks(candles);
  if (preset === 'trending') {
    if (erMean < 0.24) reasons.push(`trend efficiency ${erMean.toFixed(2)}`);
    if (pullbacks < 3) reasons.push(`${pullbacks} EMA pullbacks`);
  } else if (preset === 'choppy') {
    if (erMean > 0.2) reasons.push(`choppy efficiency ${erMean.toFixed(2)}`);
    if (erMax > 0.5) reasons.push(`a clean trend in a choppy market (${erMax.toFixed(2)})`);
  } else {
    if (erMax < 0.4) reasons.push(`no trending stretch (${erMax.toFixed(2)})`);
    if (erMin > 0.14) reasons.push(`no sideways stretch (${erMin.toFixed(2)})`);
    if (pullbacks < 1) reasons.push('no EMA pullback');
  }
  // Patterns must break out inside the playable part with room for the outcome.
  for (const e of events) {
    if (e.breakoutIdx < START_VISIBLE + 25 || e.breakoutIdx > n - 16) reasons.push(`${e.id} breakout at ${e.breakoutIdx}`);
  }
  // Enough genuine setups (by the scanner's own rules) for a patient trader.
  const A = atr(candles, 14);
  const setups = findSetups(candles, { kinds: TRADEABLE, atr: A, from: START_VISIBLE + 5, to: n - 8 });
  if (setups.length < 4) reasons.push(`only ${setups.length} setups`);
  return {
    ok: reasons.length === 0,
    reasons,
    metrics: { erMean, erMax, erMin, pullbacks, atrPct: ap, setups: setups.length, minL, maxH },
  };
}

// ------------------------------------------------------------------------------ fallback

// Hand-tuned waypoint paths (x in [0, 1], price) — used only if 30 generated markets fail.
const FALLBACK_PATHS = {
  trending: [[0, 100], [0.08, 104.5], [0.11, 102.6], [0.2, 109.5], [0.24, 106.8], [0.36, 115.5], [0.4, 112.2], [0.43, 113.6], [0.47, 111.9], [0.56, 120.5], [0.6, 117.4], [0.7, 124.8], [0.74, 121], [0.78, 123.2], [0.84, 115.5], [0.87, 118.2], [0.94, 110.4], [1, 112.8]],
  choppy: [[0, 100], [0.05, 104.4], [0.1, 97.2], [0.16, 103.9], [0.22, 96.8], [0.28, 104.6], [0.31, 106.1], [0.36, 99.5], [0.42, 103.4], [0.48, 95.8], [0.52, 94.4], [0.57, 101.2], [0.63, 97.1], [0.69, 103.8], [0.75, 98.2], [0.81, 104.9], [0.85, 101.1], [0.9, 104.2], [0.95, 97.6], [1, 100.6]],
  mixed: [[0, 100], [0.1, 106.2], [0.13, 104.1], [0.22, 112.4], [0.27, 108.6], [0.31, 111.9], [0.36, 104.2], [0.42, 107.5], [0.48, 103.6], [0.54, 107.2], [0.6, 103.9], [0.68, 97.2], [0.71, 99.4], [0.8, 92.3], [0.84, 94.9], [0.92, 88.6], [1, 90.7]],
};

function fallbackMarket(preset, seed) {
  const pts = FALLBACK_PATHS[preset] || FALLBACK_PATHS.mixed;
  const rng = makeRng(`${seed}:fallback`);
  let best = null;
  for (let t = 0; t < 12; t++) {
    const { candles } = fromPath(pts, { seed: rng.int(1, 2 ** 31 - 1), count: BARS, noise: 0.42, wick: 0.7, exact: false });
    const cs = finalize(candles);
    const v = validateMarket(cs, preset);
    if (v.ok) return { candles: cs, validation: v };
    if (!best || v.reasons.length < best.validation.reasons.length) best = { candles: cs, validation: v };
  }
  return best;
}

// ------------------------------------------------------------------------------ public

/**
 * generateMarket({ seed, preset = 'mixed', difficulty = 0.5 })
 *   → { candles (400, 2 decimals), preset (resolved: 'surprise' becomes the picked one), surprise,
 *       events: [{ kind: 'pattern', id, name, outcome, breakoutIdx, patternStart, … }], segments,
 *       validation: { ok, reasons, metrics }, tries, fallback, seed }
 * Deterministic for a seed. Regenerates with forked seeds until validateMarket() passes (≤ 30 tries).
 */
export function generateMarket({ seed = 1, preset = 'mixed', difficulty = 0.5 } = {}) {
  const root = makeRng(seed);
  const surprise = preset === 'surprise';
  const resolved = surprise ? root.fork('surprise').pick(['trending', 'choppy', 'mixed']) : PRESET_IDS.includes(preset) ? preset : 'mixed';
  const diff = clamp(Number(difficulty) || 0, 0, 1);
  for (let t = 0; t < MAX_TRIES; t++) {
    const rng = root.fork(`market-${t}`);
    const m = assemble(resolved, rng, diff);
    const validation = validateMarket(m.candles, resolved, m.events);
    if (validation.ok) return { ...m, preset: resolved, surprise, validation, tries: t + 1, fallback: false, seed };
  }
  const fb = fallbackMarket(resolved, seed);
  return { candles: fb.candles, events: [], segments: [], preset: resolved, surprise, validation: fb.validation, tries: MAX_TRIES, fallback: true, seed };
}

/**
 * A real-market round (scanner.realRound: candles, lead, symbol, interval, …) as a replay market:
 * prices rebased so the first open is 100.00 (percentage moves are exact), 2 decimals.
 * → { candles, lead, factor, hasVolume } or null when the window is unusable.
 */
export function rebaseReal(round) {
  const raw = round?.candles;
  if (!Array.isArray(raw) || raw.length < START_VISIBLE + 60) return null;
  const f = 100 / raw[0].o;
  if (!isNum(f) || f <= 0) return null;
  const conv = (list) => finalize(list.map((k) => ({ o: k.o * f, h: k.h * f, l: k.l * f, c: k.c * f, v: k.v || 0 })));
  const candles = conv(raw.slice(0, BARS)).map((k, i) => ({ ...k, t: raw[i].t }));
  const lead = conv(round.lead || []);
  // Sanity: no absurd single-bar jumps after rebasing (bad ticks would wreck the replay).
  for (let i = 1; i < candles.length; i++) {
    if (Math.abs(candles[i].c / candles[i - 1].c - 1) > 0.45) return null;
  }
  const hasVolume = raw.some((k) => (k.v || 0) > 0);
  if (!hasVolume) for (const k of candles) k.v = 0;
  return { candles, lead, factor: f, hasVolume };
}
