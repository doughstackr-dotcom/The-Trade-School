// Candle Builder kit — shared by the Candlestick anatomy lesson (js/lessons/candle-anatomy.js) and the
// Candle Builder game (js/games/candle-builder.js). Private to this unit.
//
//   features(k) / classify(k)          candle geometry as fractions of the range, and a margin-aware
//                                      (colour, wick, close) reading used to validate generated candles
//   ARCHETYPES / makeCandle(id, rng)   textbook single-candle shapes, generated on a tick grid and
//                                      re-generated until classify() agrees with the archetype
//   numericStory(k) / describeCandle(k) plain-English stories ("Opened at 100.00, dipped to 97.50 …")
//   createBuilder(host, opts)          the draggable O / H / L / C price-scale widget (pointer, touch,
//                                      keyboard: Tab, arrows, Shift ×10, O H L C hotkeys, Enter)
//
// Colours come only from CSS tokens. The widget injects one ref-counted <style> (scoped to .cbw).
import { h, icon, sfx } from '../core/ui.js';
import { niceTicks } from '../core/chart.js';
import { tween, reducedMotion } from '../core/anim.js';

export const KEYS = ['o', 'h', 'l', 'c'];
export const KEY_LABEL = { o: 'Open', h: 'High', l: 'Low', c: 'Close' };

// ------------------------------------------------------------------ geometry

const EPS = 1e-9;

/** Candle geometry: body / wicks as fractions of the range, close / open location in the range (0 = low, 1 = high). */
export function features(k) {
  const range = k.h - k.l;
  const top = Math.max(k.o, k.c);
  const bot = Math.min(k.o, k.c);
  const body = top - bot;
  const upper = k.h - top;
  const lower = bot - k.l;
  const r = range > EPS ? range : 0;
  return {
    range,
    body,
    upper,
    lower,
    bodyR: r ? body / r : 0,
    upperR: r ? upper / r : 0,
    lowerR: r ? lower / r : 0,
    closeLoc: r ? (k.c - k.l) / r : 0.5,
    openLoc: r ? (k.o - k.l) / r : 0.5,
    dir: k.c > k.o + EPS ? 1 : k.c < k.o - EPS ? -1 : 0,
  };
}

export function isValidOHLC(k) {
  return [k.o, k.h, k.l, k.c].every(Number.isFinite) && k.l <= Math.min(k.o, k.c) + EPS && k.h >= Math.max(k.o, k.c) - EPS && k.h > k.l;
}

/**
 * Margin-aware reading → { colour: 'bull'|'bear'|'doji'|'unclear', wick: 'none'|'lower'|'upper'|'both'|'mixed',
 * close: 'high'|'mid'|'low'|'unclear' }. "unclear" values sit in the gaps between categories, so a candle
 * that classifies cleanly cannot be mistaken for a neighbouring description.
 */
export function classify(k) {
  const f = features(k);
  if (!(f.range > 0)) return { colour: 'unclear', wick: 'mixed', close: 'unclear' };
  const colour = f.bodyR <= 0.06 ? 'doji' : f.bodyR >= 0.1 ? (f.dir > 0 ? 'bull' : 'bear') : 'unclear';
  const close = f.closeLoc >= 0.7 ? 'high' : f.closeLoc <= 0.3 ? 'low' : f.closeLoc >= 0.38 && f.closeLoc <= 0.62 ? 'mid' : 'unclear';
  let wick = 'mixed';
  if (f.upperR <= 0.06 && f.lowerR <= 0.06) wick = 'none';
  else if (f.lowerR >= 0.45 && f.upperR <= 0.1) wick = 'lower';
  else if (f.upperR >= 0.45 && f.lowerR <= 0.1) wick = 'upper';
  else if (f.upperR >= 0.3 && f.lowerR >= 0.3) wick = 'both';
  return { colour, wick, close };
}

// ------------------------------------------------------------------ archetypes

/**
 * Textbook single-candle shapes in normalised coordinates (low = 0, high = 1): o / c are ranges for the
 * open and close. `dc` = doji close spread. `story` is the qualitative description (options and build
 * briefs), `short` a compact label, `why` the beginner explanation. `nick` names the shape family
 * (context decides the pattern name, so the game never names hammer vs hanging man from one candle).
 */
export const ARCHETYPES = {
  'bull-maru': {
    colour: 'bull', wick: 'none', close: 'high', o: [0, 0.03], c: [0.97, 1], level: 0,
    story: 'Bullish all the way: it opened at the low and closed at the high, with almost no wicks.',
    brief: 'a bullish candle that opened at its low and closed at its high, with almost no wicks',
    why: 'Buyers controlled the whole period: no dip below the open, no pull-back from the high.',
    nick: 'bullish marubozu',
  },
  'bear-maru': {
    colour: 'bear', wick: 'none', close: 'low', o: [0.97, 1], c: [0, 0.03], level: 0,
    story: 'Bearish all the way: it opened at the high and closed at the low, with almost no wicks.',
    brief: 'a bearish candle that opened near its high and closed near its low, with almost no wicks',
    why: 'Sellers controlled the whole period: no rally above the open, no bounce off the low.',
    nick: 'bearish marubozu',
  },
  'bull-lower': {
    ratio2: true, colour: 'bull', wick: 'lower', close: 'high', o: [0.68, 0.76], c: [0.92, 0.98], level: 1,
    story: 'Sellers pushed it far below the open, then buyers drove it back up to close above the open, near the high.',
    brief: 'a bullish candle with a small body near the top and a long lower wick, at least twice the body',
    why: 'The long lower wick shows the lows were rejected: sellers pushed down, buyers pushed back harder.',
    nick: 'hammer shape',
  },
  'bear-lower': {
    ratio2: true, colour: 'bear', wick: 'lower', close: 'high', o: [0.94, 0.99], c: [0.75, 0.8], level: 2,
    story: 'It sank far below the open and recovered most of the way, but closed a little below the open, near the high.',
    brief: 'a bearish candle with a small body near the top and a long lower wick, at least twice the body',
    why: 'Same long lower wick as a hammer shape, but the close finished just below the open, so the body is bearish.',
    nick: 'hanging-man shape',
  },
  'bull-upper': {
    ratio2: true, colour: 'bull', wick: 'upper', close: 'low', o: [0.02, 0.06], c: [0.18, 0.25], level: 2,
    story: 'It rallied far above the open, but sellers pushed it back to close near the low, just above the open.',
    brief: 'a bullish candle with a small body near the bottom and a long upper wick, at least twice the body',
    why: 'The long upper wick shows the highs were rejected, yet the close still finished just above the open.',
    nick: 'inverted-hammer shape',
  },
  'bear-upper': {
    ratio2: true, colour: 'bear', wick: 'upper', close: 'low', o: [0.2, 0.27], c: [0.01, 0.06], level: 1,
    story: 'It rallied far above the open, then sellers drove it back below the open to close near the low.',
    brief: 'a bearish candle with a small body near the bottom and a long upper wick, at least twice the body',
    why: 'The long upper wick shows buyers were rejected at the highs and sellers closed it near the low.',
    nick: 'shooting-star shape',
  },
  'bull-upper-mid': {
    colour: 'bull', wick: 'upper', close: 'mid', o: [0.02, 0.08], c: [0.42, 0.5], level: 2,
    story: 'It opened near the low and rallied far higher, but gave back about half to close mid-range, above the open.',
    brief: 'a bullish candle that opened near its low and closed in the middle of its range, leaving a long upper wick',
    why: 'Bullish (close above open), but the long upper wick shows sellers took back half of the rally.',
    nick: 'bullish candle with a long upper wick',
  },
  'bear-lower-mid': {
    colour: 'bear', wick: 'lower', close: 'mid', o: [0.92, 0.98], c: [0.5, 0.58], level: 2,
    story: 'It opened near the high and fell far lower, but won back about half to close mid-range, below the open.',
    brief: 'a bearish candle that opened near its high and closed in the middle of its range, leaving a long lower wick',
    why: 'Bearish (close below open), but the long lower wick shows buyers won back half of the drop.',
    nick: 'bearish candle with a long lower wick',
  },
  'bull-both': {
    colour: 'bull', wick: 'both', close: 'mid', o: [0.34, 0.4], c: [0.52, 0.6], level: 1,
    story: 'A small body in the middle with long wicks on both sides; it closed slightly above the open.',
    brief: 'a small bullish body in the middle of the range, with wicks on both sides longer than the body (a spinning top)',
    why: 'Both sides pushed and both got pushed back: indecision, with the close only a little above the open.',
    nick: 'spinning top',
  },
  'bear-both': {
    colour: 'bear', wick: 'both', close: 'mid', o: [0.6, 0.66], c: [0.4, 0.48], level: 1,
    story: 'A small body in the middle with long wicks on both sides; it closed slightly below the open.',
    brief: 'a small bearish body in the middle of the range, with wicks on both sides longer than the body (a spinning top)',
    why: 'Both sides pushed and both got pushed back: indecision, with the close only a little below the open.',
    nick: 'spinning top',
  },
  doji: {
    colour: 'doji', wick: 'both', close: 'mid', o: [0.42, 0.58], dc: 0.02, level: 0,
    story: 'It traded well above and below the open, then closed almost exactly where it opened, mid-range.',
    brief: 'a doji: the open and close almost equal in the middle of the range, with wicks above and below',
    why: 'Open and close almost equal: after all the pushing, neither side won the period.',
    nick: 'doji',
  },
  dragonfly: {
    colour: 'doji', wick: 'lower', close: 'high', o: [0.96, 1], dc: 0.02, level: 2,
    story: 'It opened at the high, fell far, then came all the way back to close at the open.',
    brief: 'a dragonfly doji: open, high and close at almost the same price, with one long lower wick',
    why: 'A doji with only a lower wick: sellers pushed hard, buyers erased the whole drop by the close.',
    nick: 'dragonfly doji',
  },
  gravestone: {
    colour: 'doji', wick: 'upper', close: 'low', o: [0, 0.04], dc: 0.02, level: 2,
    story: 'It opened at the low, rallied far, then fell all the way back to close at the open.',
    brief: 'a gravestone doji: open, low and close at almost the same price, with one long upper wick',
    why: 'A doji with only an upper wick: buyers pushed hard, sellers erased the whole rally by the close.',
    nick: 'gravestone doji',
  },
  // Numeric rounds only: an ordinary candle with a healthy body and short wicks on both sides.
  'bull-plain': { colour: 'bull', wick: 'mixed', close: 'high', o: [0.14, 0.28], c: [0.74, 0.86], numeric: true, level: 0 },
  'bear-plain': { colour: 'bear', wick: 'mixed', close: 'low', o: [0.72, 0.86], c: [0.14, 0.26], numeric: true, level: 0 },
};

export const QUAL_IDS = Object.keys(ARCHETYPES).filter((id) => !ARCHETYPES[id].numeric);

export const snap = (p, tick, decimals = 2) => +(Math.round(p / tick) * tick).toFixed(decimals);

/** Does candle k read as archetype `id`? (measured, with margins) */
export function matchesArchetype(k, id) {
  const a = ARCHETYPES[id];
  const c = classify(k);
  if (!a) return false;
  if (a.numeric) return c.colour === a.colour && c.close === a.close && c.wick === 'mixed';
  if (c.colour !== a.colour || c.wick !== a.wick || c.close !== a.close) return false;
  const f = features(k);
  // Shape rules the briefs state: long wick ≥ 2 × body, spinning-top body 10–30 % with both wicks longer.
  if (a.ratio2 && a.wick === 'lower' && f.lower < 2 * f.body) return false;
  if (a.ratio2 && a.wick === 'upper' && f.upper < 2 * f.body) return false;
  if (a.wick === 'both' && a.colour !== 'doji' && !(f.bodyR >= 0.1 && f.bodyR <= 0.3 && f.upper > f.body && f.lower > f.body)) return false;
  return true;
}

/**
 * A candle of archetype `id` on the tick grid inside [lo, hi] (the price scale), range = frac × (hi − lo).
 * Generate-and-test: up to 30 tries until matchesArchetype() and the tick rules hold (body ≥ 3 ticks
 * unless doji; a wick is either absent or ≥ 2 ticks, so a story never hinges on one tick), then a
 * hand-tuned fallback at the middle of each range.
 */
export function makeCandle(id, rng, { lo = 90, hi = 110, tick = 0.1, decimals = 2, frac = [0.4, 0.62], margin = 0.08 } = {}) {
  const a = ARCHETYPES[id];
  const span = hi - lo;
  const build = (R, base, oR, cR) => {
    const l = snap(base, tick, decimals);
    const hh = snap(base + R, tick, decimals);
    const range = hh - l;
    const o = snap(l + oR * range, tick, decimals);
    let c = a.colour === 'doji' ? snap(o + cR * range, tick, decimals) : snap(l + cR * range, tick, decimals);
    c = Math.min(hh, Math.max(l, c));
    return { o: Math.min(hh, Math.max(l, o)), h: hh, l, c };
  };
  const ok = (k) => {
    if (!isValidOHLC(k) || !matchesArchetype(k, id)) return false;
    const f = features(k);
    const t = tick * 0.999;
    if (a.colour !== 'doji' && f.body < 3 * t) return false;
    if (f.upper > EPS && f.upper < 2 * t) return false;
    if (f.lower > EPS && f.lower < 2 * t) return false;
    if (k.l < lo + margin * span - EPS || k.h > hi - margin * span + EPS) return false;
    return true;
  };
  for (let i = 0; i < 30; i++) {
    const R = rng.float(frac[0], frac[1]) * span;
    const room = span * (1 - 2 * margin) - R;
    const base = lo + margin * span + rng.float(0, Math.max(0, room));
    const oR = rng.float(a.o[0], a.o[1]);
    const cR = a.colour === 'doji' ? rng.sign() * rng.float(0, a.dc) : rng.float(a.c[0], a.c[1]);
    const k = build(R, base, oR, cR);
    if (ok(k)) return k;
  }
  // Hand-tuned path: middle of every range, a wide candle centred on the scale.
  const R = Math.max(frac[1], 0.5) * span;
  const mid = (r) => (r[0] + r[1]) / 2;
  const k = build(R, lo + (span - R) / 2, mid(a.o), a.colour === 'doji' ? 0 : mid(a.c));
  return k;
}

// ------------------------------------------------------------------ stories

const fx = (p, d) => Number(p).toFixed(d);

/**
 * Numeric story for a candle, in the conventional path order (bullish: open → low → high → close;
 * bearish: open → high → low → close). → { html, text }
 */
export function numericStory(k, decimals = 2) {
  const f = features(k);
  const tiny = f.range * 1e-6 + EPS;
  const noLow = f.lower <= tiny;
  const noUp = f.upper <= tiny;
  const b = (p) => `<b class="mono">${fx(p, decimals)}</b>`;
  const t = (p) => fx(p, decimals);
  const make = (P) => {
    if (f.dir > 0) {
      if (noLow && noUp) return `Opened at its low of ${P(k.o)} and rallied all the way to close at its high of ${P(k.c)}.`;
      if (noLow) return `Opened at ${P(k.o)}, which was also the low, rallied to ${P(k.h)} and closed at ${P(k.c)}.`;
      if (noUp) return `Opened at ${P(k.o)}, dipped to ${P(k.l)}, then rallied to close at its high of ${P(k.c)}.`;
      return `Opened at ${P(k.o)}, dipped to ${P(k.l)}, rallied to ${P(k.h)} and closed at ${P(k.c)}.`;
    }
    if (f.dir < 0) {
      if (noLow && noUp) return `Opened at its high of ${P(k.o)} and fell all the way to close at its low of ${P(k.c)}.`;
      if (noUp) return `Opened at ${P(k.o)}, which was also the high, fell to ${P(k.l)} and closed at ${P(k.c)}.`;
      if (noLow) return `Opened at ${P(k.o)}, rose to ${P(k.h)}, then sold off to close at its low of ${P(k.c)}.`;
      return `Opened at ${P(k.o)}, rose to ${P(k.h)}, fell to ${P(k.l)} and closed at ${P(k.c)}.`;
    }
    if (noUp && !noLow) return `Opened at its high of ${P(k.o)}, fell to ${P(k.l)} and closed right back at ${P(k.c)}.`;
    if (noLow && !noUp) return `Opened at its low of ${P(k.o)}, rallied to ${P(k.h)} and closed right back at ${P(k.c)}.`;
    return `Opened at ${P(k.o)}, traded up to ${P(k.h)} and down to ${P(k.l)}, and closed right back at ${P(k.c)}.`;
  };
  return { html: make(b), text: make(t) };
}

/**
 * Live narration for the lesson's builder: what happened, then a verdict on the shape.
 * → { html, text, tone: 'bull'|'bear'|'neutral', shape }
 */
export function describeCandle(k, decimals = 2) {
  const f = features(k);
  const P = (p) => `<b class="mono">${fx(p, decimals)}</b>`;
  if (!(f.range > 0)) {
    const html = `All four prices are ${P(k.o)}: the price never moved. Drag the handles apart to make a candle.`;
    return { html, text: html.replace(/<[^>]+>/g, ''), tone: 'neutral', shape: 'flat' };
  }
  let path;
  const nearHigh = f.upperR <= 0.03 ? 'right at the high' : f.upperR <= 0.2 ? 'near the high of' : f.upperR <= 0.45 ? 'below the high of' : 'far below the high of';
  const nearLow = f.lowerR <= 0.03 ? 'right at the low' : f.lowerR <= 0.2 ? 'near the low of' : f.lowerR <= 0.45 ? 'above the low of' : 'far above the low of';
  const withLevel = (phrase, level) => (/right at/.test(phrase) ? phrase : `${phrase} ${P(level)}`);
  if (f.bodyR <= 0.08) {
    const up = f.upperR > 0.03;
    const dn = f.lowerR > 0.03;
    const moves = up && dn ? `traded up to ${P(k.h)} and down to ${P(k.l)}` : up ? `rallied to ${P(k.h)}` : dn ? `fell to ${P(k.l)}` : '';
    path = `Opened at ${P(k.o)}${moves ? `, ${moves},` : ''} and closed at ${P(k.c)}, almost exactly where it opened`;
  } else if (f.dir > 0) {
    path = `Opened at ${P(k.o)}${f.lowerR > 0.03 ? `, sellers pushed it down to ${P(k.l)}` : ' (also the low)'}, buyers drove it up to close at ${P(k.c)}, ${withLevel(nearHigh, k.h)}`;
  } else {
    path = `Opened at ${P(k.o)}${f.upperR > 0.03 ? `, buyers pushed it up to ${P(k.h)}` : ' (also the high)'}, sellers drove it down to close at ${P(k.c)}, ${withLevel(nearLow, k.l)}`;
  }
  const side = f.dir > 0 ? 'bullish' : 'bearish';
  const tone = f.bodyR <= 0.08 ? 'neutral' : f.dir > 0 ? 'bull' : 'bear';
  let verdict;
  let shape;
  if (f.bodyR <= 0.08) {
    shape = 'doji';
    if (f.upperR <= 0.1 && f.lowerR >= 0.6) verdict = 'a <strong>dragonfly doji</strong>: sellers pushed hard and buyers erased the whole drop';
    else if (f.lowerR <= 0.1 && f.upperR >= 0.6) verdict = 'a <strong>gravestone doji</strong>: buyers pushed hard and sellers erased the whole rally';
    else verdict = 'a <strong>doji</strong>: open and close almost equal, so neither side won';
  } else if (f.bodyR >= 0.9) {
    shape = 'marubozu';
    verdict = `a <strong>${side} marubozu</strong>: all body, almost no wicks. ${f.dir > 0 ? 'Buyers' : 'Sellers'} controlled the whole period`;
  } else if (f.lower >= 2 * f.body && f.upperR <= 0.1 && f.bodyR >= 0.1) {
    shape = 'lower-wick';
    verdict = `a small ${side} body at the top with a <strong>long lower wick</strong>: the lows were rejected`;
  } else if (f.upper >= 2 * f.body && f.lowerR <= 0.1 && f.bodyR >= 0.1) {
    shape = 'upper-wick';
    verdict = `a small ${side} body at the bottom with a <strong>long upper wick</strong>: the highs were rejected`;
  } else if (f.bodyR <= 0.3 && f.upper > f.body && f.lower > f.body) {
    shape = 'spinning-top';
    verdict = `a <strong>spinning top</strong>: a small ${side} body with wicks on both sides. Neither side won clearly`;
  } else if (f.bodyR >= 0.6) {
    shape = 'strong';
    const wick = f.upperR <= 0.12 && f.lowerR <= 0.12 ? 'small wicks' : f.upperR > f.lowerR ? 'a small upper wick' : 'a small lower wick';
    verdict = `a <strong>strong ${side} candle</strong> with ${wick}`;
  } else {
    shape = 'moderate';
    const push = f.dir > 0
      ? (f.upperR > f.lowerR ? 'the upper wick shows sellers pushed back from the high' : 'the lower wick shows buyers stepped in below the open')
      : (f.lowerR > f.upperR ? 'the lower wick shows buyers pushed back from the low' : 'the upper wick shows sellers stepped in above the open');
    verdict = `a <strong>moderately ${side} candle</strong>; ${push}`;
  }
  const html = `${path}: ${verdict}.`;
  return { html, text: html.replace(/<[^>]+>/g, ''), tone, shape };
}

// ------------------------------------------------------------------ builder widget

const CSS = `
.cbw { position: relative; min-width: 0; -webkit-user-select: none; user-select: none; }
.cbw__plot { position: relative; }
.cbw__svg { position: absolute; inset: 0; display: block; overflow: visible; }
.cbw__grid { stroke: var(--grid); stroke-width: 1; shape-rendering: crispEdges; }
.cbw__axis { fill: var(--text-3); font: 500 11px/1 var(--font-mono); font-variant-numeric: tabular-nums; }
.cbw__rail { stroke: var(--line); stroke-width: 2; stroke-linecap: round; }
.cbw__guide { stroke: var(--text-3); stroke-width: 1; stroke-dasharray: 2 4; opacity: 0.6; }
.cbw__guide.is-active { stroke: var(--accent); stroke-dasharray: 4 3; opacity: 1; }
.cbw__wick { stroke-width: 2.5; stroke-linecap: round; fill: none; }
.cbw__bull { fill: var(--bull); stroke: var(--bull); }
.cbw__bear { fill: var(--bear); stroke: var(--bear); }
.cbw__flat { fill: var(--text-2); stroke: var(--text-2); }
.cbw__ghost { fill: none; stroke: var(--accent); stroke-width: 2.25; stroke-dasharray: 6 4; }
.cbw__ghost-fill { fill: var(--accent); opacity: 0.1; stroke: none; }
.cbw__ghost-tag rect { fill: var(--accent); }
.cbw__ghost-tag text { fill: var(--accent-ink); font: 700 11px/1 var(--font-body); }
.cbw__gknob { fill: var(--surface); stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 4 3; }
.cbw__gtext { fill: var(--accent-strong); font: 600 11.5px/1 var(--font-mono); font-variant-numeric: tabular-nums; }
.cbw__conn { stroke: var(--accent); stroke-width: 1.5; }
.cbw__new { animation: cbw-in 0.45s var(--ease-out, ease-out) both; transform-box: fill-box; transform-origin: center; }
@keyframes cbw-in { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: none; } }
.cbw__lane { position: absolute; top: 0; touch-action: none; cursor: ns-resize; }
.cbw__head { position: absolute; top: 2px; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: 1px; color: var(--text-2); font: 700 12px/1.1 var(--font-body); text-align: center; pointer-events: none; }
.cbw__res { font: 600 11px/1.1 var(--font-mono); min-height: 12px; }
.cbw__res.is-good { color: var(--bull-strong); }
.cbw__res.is-bad { color: var(--bear-strong); }
.cbw__res.is-mid { color: var(--accent-strong); }
.cbw__knob { position: absolute; left: 3px; right: 3px; height: 30px; margin-top: -15px; display: grid; place-items: center; border: 1.5px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text); box-shadow: var(--shadow); font: 600 12px/1 var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; outline: none; transition: border-color 0.15s, background-color 0.15s; }
.cbw__knob::before { content: ""; position: absolute; inset: -8px -3px; }
.cbw__knob:focus-visible { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--focus); }
.cbw__knob.is-active { border-color: var(--accent); background: var(--accent-soft); }
.cbw.is-dragging .cbw__knob.is-active { cursor: grabbing; }
.cbw.is-locked .cbw__lane { cursor: default; touch-action: auto; }
.cbw.is-locked .cbw__knob { box-shadow: none; opacity: 0.9; }
.cbw__nudge { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px; margin-top: 10px; }
.cbw__nudge .btn { min-width: 44px; min-height: 44px; padding: 0 10px; }
.cbw__nudge .cbw__pick { font-family: var(--font-mono); font-weight: 700; }
.cbw__nudge .cbw__pick[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
.cbw.is-locked .cbw__nudge { opacity: 0.55; pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .cbw__new { animation: none; } }
`;

let styleRefs = 0;
let styleEl = null;
function acquireStyle() {
  styleRefs += 1;
  if (!styleEl || !styleEl.isConnected) {
    styleEl = h('style', { 'data-owner': 'candle-builder-kit' }, CSS);
    document.head.append(styleEl);
  }
}
function releaseStyle() {
  styleRefs = Math.max(0, styleRefs - 1);
  if (!styleRefs && styleEl) {
    styleEl.remove();
    styleEl = null;
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const r1 = (v) => Math.round(v * 10) / 10;

function isTyping(t) {
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

/**
 * Draggable candle builder on a vertical price scale.
 * createBuilder(host, { min, max, tick = 0.1, decimals = 2, values, height, nudge = true, hotkeys = true,
 *                       onChange(values, key), onSubmit(), ariaLabel })
 * → { el, values, set(values, { animate }), setLocked(bool), showTarget(target, { label, diffs }),
 *     clearTarget(), setResult(key, text, tone), focus(key), destroy() }
 * Constraints: moving Open / Close past High / Low pushes them; High never goes below max(O, C) and
 * Low never above min(O, C).
 */
export function createBuilder(host, opts = {}) {
  const o = {
    min: 94, max: 106, tick: 0.1, decimals: 2, height: null, nudge: true, hotkeys: true,
    onChange: null, onSubmit: null, ariaLabel: 'Candle builder: drag Open, High, Low and Close',
    ...opts,
  };
  acquireStyle();
  const mid = snap((o.min + o.max) / 2, o.tick, o.decimals);
  let vals = { o: mid, h: mid, l: mid, c: mid };
  let active = 'c';
  let locked = false;
  let destroyed = false;
  let target = null;
  let reveal = { ghost: false, keys: new Set(), fresh: null, label: 'Target' };
  let L = null;
  let drag = null;
  const timers = new Set();
  let anim = null;

  const root = h('div', { class: 'cbw', role: 'group', 'aria-label': o.ariaLabel });
  const plot = h('div', { class: 'cbw__plot' });
  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgEl.setAttribute('class', 'cbw__svg');
  svgEl.setAttribute('aria-hidden', 'true');
  svgEl.setAttribute('focusable', 'false');
  plot.append(svgEl);
  const lanes = {};
  const knobs = {};
  const results = {};
  for (const key of KEYS) {
    results[key] = h('span', { class: 'cbw__res' });
    knobs[key] = h('div', {
      class: 'cbw__knob', role: 'slider', tabindex: '0', 'data-key': key,
      'aria-label': KEY_LABEL[key], 'aria-valuemin': o.min, 'aria-valuemax': o.max,
    });
    lanes[key] = h('div', { class: 'cbw__lane', 'data-lane': key },
      h('div', { class: 'cbw__head' }, h('span', { class: 'cbw__name' }, KEY_LABEL[key]), results[key]),
      knobs[key]);
    plot.append(lanes[key]);
  }
  root.append(plot);

  // Nudge bar for touch precision: pick a handle, then step it one tick at a time (press and hold repeats).
  const picks = {};
  let nudgeEl = null;
  if (o.nudge) {
    const stepBtn = (dir) => {
      const b = h('button', { type: 'button', class: 'btn btn--sm', 'data-nudge': dir > 0 ? 'up' : 'down', 'aria-label': dir > 0 ? 'Raise the selected price by one tick' : 'Lower the selected price by one tick' },
        icon(dir > 0 ? 'plus' : 'minus', { size: 18 }));
      let hold = null;
      let rep = null;
      const stop = () => {
        clearTimeout(hold);
        clearInterval(rep);
        timers.delete(hold);
        timers.delete(rep);
        hold = rep = null;
      };
      b.addEventListener('pointerdown', (e) => {
        if (locked || e.button > 0) return;
        e.preventDefault();
        nudge(active, dir);
        stop();
        hold = setTimeout(() => {
          rep = setInterval(() => nudge(active, dir), 70);
          timers.add(rep);
        }, 420);
        timers.add(hold);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stop));
      b.addEventListener('click', (e) => {
        // Keyboard activation (Enter / Space) arrives as a click with detail 0.
        if (e.detail === 0 && !locked) nudge(active, dir);
      });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };
    const pickRow = KEYS.map((key) => {
      picks[key] = h('button', { type: 'button', class: 'btn btn--sm cbw__pick', 'aria-pressed': 'false', 'data-pick': key, 'aria-label': `Select ${KEY_LABEL[key]}` }, key.toUpperCase());
      picks[key].addEventListener('click', () => setActive(key));
      return picks[key];
    });
    nudgeEl = h('div', { class: 'cbw__nudge' }, stepBtn(-1), ...pickRow, stepBtn(1));
    root.append(nudgeEl);
  }
  host.append(root);

  // ---------------------------------------------------------------- layout + render
  function layout() {
    const W = Math.max(260, Math.floor(plot.clientWidth || host.clientWidth || 320));
    const H = o.height || (W < 420 ? 320 : 340);
    const top = 44;
    const bottom = H - 16;
    const axisW = W < 380 ? 42 : 50;
    const candleW = W < 380 ? 60 : W < 520 ? 80 : 108;
    const lanesX = axisW + candleW + 6;
    const laneW = Math.max(52, Math.min(96, Math.floor((W - lanesX - 2) / 4)));
    const bw = Math.max(18, Math.min(34, Math.round(candleW * 0.4)));
    L = { W, H, top, bottom, axisW, candleW, cx: axisW + candleW / 2, lanesX, laneW, bw };
    plot.style.height = `${H}px`;
    svgEl.setAttribute('width', W);
    svgEl.setAttribute('height', H);
    svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
    KEYS.forEach((key, i) => {
      const lane = lanes[key];
      lane.style.left = `${lanesX + i * laneW}px`;
      lane.style.width = `${laneW}px`;
      lane.style.height = `${H}px`;
    });
  }
  const y = (p) => L.top + ((o.max - p) / (o.max - o.min)) * (L.bottom - L.top);
  const priceAt = (py) => o.max - ((py - L.top) / (L.bottom - L.top)) * (o.max - o.min);
  const fmt = (p) => Number(p).toFixed(o.decimals);

  function candleMarkup(k, cx, bw, cls) {
    const yT = y(Math.max(k.o, k.c));
    const yB = y(Math.min(k.o, k.c));
    const bh = Math.max(2, yB - yT);
    return `<path class="cbw__wick ${cls}" d="M${r1(cx)},${r1(y(k.h))}V${r1(y(k.l))}"/>` +
      `<rect class="${cls}" x="${r1(cx - bw / 2)}" y="${r1(bh === 2 ? (yT + yB) / 2 - 1 : yT)}" width="${bw}" height="${r1(bh)}" rx="2"/>`;
  }

  function render() {
    if (destroyed) return;
    if (!L) layout();
    const { W, top, bottom, axisW, cx, bw, lanesX, laneW } = L;
    let s = '';
    const { ticks, step } = niceTicks(o.min, o.max, 7);
    const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    for (const t of ticks) {
      if (t < o.min - EPS || t > o.max + EPS) continue;
      const yy = Math.round(y(t)) + 0.5;
      s += `<line class="cbw__grid" x1="${axisW}" x2="${W}" y1="${yy}" y2="${yy}"/>`;
      s += `<text class="cbw__axis" x="${axisW - 6}" y="${r1(yy + 4)}" text-anchor="end">${t.toFixed(dec)}</text>`;
    }
    KEYS.forEach((key, i) => {
      const x = lanesX + i * laneW + laneW / 2;
      s += `<line class="cbw__rail" x1="${r1(x)}" x2="${r1(x)}" y1="${top}" y2="${bottom}"/>`;
    });
    // Guides: candle edge → each handle, at its price (the active one in gold).
    const gx0 = cx + bw / 2 + 4;
    KEYS.forEach((key, i) => {
      const yy = r1(y(vals[key]));
      const x1 = lanesX + i * laneW + 3;
      s += `<line class="cbw__guide${key === active && !locked ? ' is-active' : ''}" x1="${r1(gx0)}" x2="${r1(x1)}" y1="${yy}" y2="${yy}"/>`;
    });
    // Target handles + connectors (after submit).
    if (target) {
      KEYS.forEach((key, i) => {
        if (!reveal.keys.has(key)) return;
        const err = Math.abs(vals[key] - target[key]);
        if (err <= o.tick * 1.001) return; // within one tick scores in full: nothing to point at
        const x = lanesX + i * laneW;
        const yt = y(target[key]);
        const yp = y(vals[key]);
        const cls = reveal.fresh === key ? ' cbw__new' : '';
        const dir = yt < yp ? -1 : 1;
        s += `<g class="cbw__diff${cls}">` +
          `<line class="cbw__conn" x1="${r1(x + laneW / 2)}" x2="${r1(x + laneW / 2)}" y1="${r1(yp + dir * 16)}" y2="${r1(yt - dir * 16)}"/>` +
          `<rect class="cbw__gknob" x="${r1(x + 3)}" y="${r1(yt - 15)}" width="${laneW - 6}" height="30" rx="8"/>` +
          `<text class="cbw__gtext" x="${r1(x + laneW / 2)}" y="${r1(yt + 4)}" text-anchor="middle">${esc(fmt(target[key]))}</text></g>`;
      });
    }
    // Player's candle.
    const f = features(vals);
    const cls = f.dir > 0 ? 'cbw__bull' : f.dir < 0 ? 'cbw__bear' : 'cbw__flat';
    s += candleMarkup(vals, cx, bw, cls);
    // Ghost of the target candle.
    if (target && reveal.ghost) {
      const gw = bw + 12;
      const yT = y(Math.max(target.o, target.c));
      const yB = y(Math.min(target.o, target.c));
      const cls2 = reveal.fresh === 'ghost' ? ' cbw__new' : '';
      const tagW = Math.max(52, reveal.label.length * 6.4 + 14);
      const tagY = Math.max(2, y(target.h) - 26);
      s += `<g class="cbw__ghostg${cls2}">` +
        `<rect class="cbw__ghost-fill" x="${r1(cx - gw / 2)}" y="${r1(yT)}" width="${gw}" height="${r1(Math.max(2, yB - yT))}" rx="3"/>` +
        `<path class="cbw__ghost" d="M${r1(cx)},${r1(y(target.h))}V${r1(yT)}M${r1(cx)},${r1(yB)}V${r1(y(target.l))}"/>` +
        `<rect class="cbw__ghost" x="${r1(cx - gw / 2)}" y="${r1(yT)}" width="${gw}" height="${r1(Math.max(2, yB - yT))}" rx="3"/>` +
        `<g class="cbw__ghost-tag"><rect x="${r1(cx - tagW / 2)}" y="${r1(tagY)}" width="${r1(tagW)}" height="18" rx="9"/>` +
        `<text x="${r1(cx)}" y="${r1(tagY + 12.5)}" text-anchor="middle">${esc(reveal.label)}</text></g></g>`;
    }
    svgEl.innerHTML = s;
    for (const key of KEYS) {
      const k = knobs[key];
      k.style.top = `${r1(y(vals[key]))}px`;
      k.textContent = fmt(vals[key]);
      k.setAttribute('aria-valuenow', String(vals[key]));
      k.setAttribute('aria-valuetext', `${KEY_LABEL[key]} ${fmt(vals[key])}`);
      k.classList.toggle('is-active', key === active && !locked);
      k.setAttribute('aria-disabled', locked ? 'true' : 'false');
      if (picks[key]) picks[key].setAttribute('aria-pressed', key === active ? 'true' : 'false');
    }
  }

  // ---------------------------------------------------------------- values
  function constrain(next, key) {
    const v = { ...next };
    const clampP = (p) => Math.min(o.max, Math.max(o.min, snap(p, o.tick, o.decimals)));
    v[key] = clampP(v[key]);
    if (key === 'o' || key === 'c') {
      if (v[key] > v.h) v.h = v[key];
      if (v[key] < v.l) v.l = v[key];
    } else if (key === 'h') {
      v.h = Math.max(v.h, v.o, v.c);
    } else if (key === 'l') {
      v.l = Math.min(v.l, v.o, v.c);
    }
    return v;
  }
  function setValue(key, p, { silent = false } = {}) {
    if (locked) return;
    const next = constrain({ ...vals, [key]: p }, key);
    const changed = KEYS.some((k) => next[k] !== vals[k]);
    vals = next;
    render();
    if (changed && !silent) o.onChange?.({ ...vals }, key);
  }
  function nudge(key, dir, mult = 1) {
    if (locked) return;
    const before = vals[key];
    setValue(key, vals[key] + dir * o.tick * mult);
    if (vals[key] !== before) sfx.tick();
  }
  function setActive(key, { focus = false } = {}) {
    if (!KEYS.includes(key)) return;
    active = key;
    render();
    if (focus) knobs[key].focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- pointer
  const localY = (e) => e.clientY - plot.getBoundingClientRect().top;
  function onDown(e) {
    if (locked || destroyed || (e.button != null && e.button > 0)) return;
    const lane = e.currentTarget;
    const key = lane.dataset.lane;
    e.preventDefault();
    try {
      lane.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const py = localY(e);
    const onKnob = e.target.closest('.cbw__knob');
    const offset = onKnob ? py - y(vals[key]) : 0;
    drag = { key, id: e.pointerId, offset, lane };
    root.classList.add('is-dragging');
    active = key;
    knobs[key].focus({ preventScroll: true });
    sfx.click();
    if (!onKnob) setValue(key, priceAt(py));
    else render();
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    setValue(drag.key, priceAt(localY(e) - drag.offset));
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    try {
      drag.lane.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag = null;
    root.classList.remove('is-dragging');
  }
  for (const key of KEYS) {
    const lane = lanes[key];
    lane.addEventListener('pointerdown', onDown);
    lane.addEventListener('pointermove', onMove);
    lane.addEventListener('pointerup', onUp);
    lane.addEventListener('pointercancel', onUp);
    knobs[key].addEventListener('focus', () => {
      if (active !== key) setActive(key);
    });
    knobs[key].addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const mult = e.shiftKey ? 10 : 1;
      let handled = true;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') nudge(key, 1, mult);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') nudge(key, -1, mult);
      else if (e.key === 'PageUp') nudge(key, 1, 10);
      else if (e.key === 'PageDown') nudge(key, -1, 10);
      else if (e.key === 'Home') setValue(key, o.min);
      else if (e.key === 'End') setValue(key, o.max);
      else if (e.key === 'Enter' && !locked && o.onSubmit) o.onSubmit();
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  // Hotkeys O / H / L / C select a handle from anywhere on the page.
  const onDocKey = (e) => {
    if (!o.hotkeys || locked || destroyed || !root.isConnected) return;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (document.body.classList.contains('has-modal')) return;
    const key = String(e.key || '').toLowerCase();
    if (!KEYS.includes(key) || e.repeat) return;
    const r = root.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return; // not on screen
    e.preventDefault();
    setActive(key, { focus: true });
  };
  document.addEventListener('keydown', onDocKey);

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => {
      const w = Math.floor(plot.clientWidth || 0);
      if (w > 0 && (!L || w !== L.W)) {
        layout();
        render();
      }
    });
    ro.observe(plot);
  }
  layout();
  if (o.values) vals = constrain(constrain(constrain(constrain({ ...o.values }, 'h'), 'l'), 'o'), 'c');
  render();

  const later = (ms) => new Promise((res) => {
    const t = setTimeout(() => {
      timers.delete(t);
      res(!destroyed);
    }, reducedMotion() ? 0 : ms);
    timers.add(t);
  });

  const api = {
    el: root,
    get values() {
      return { ...vals };
    },
    get locked() {
      return locked;
    },
    get active() {
      return active;
    },
    /** Moves the handles to `values` (constrained); animate tweens them. Resolves when done. */
    set(next, { animate = false, duration = 520, silent = false } = {}) {
      anim?.cancel?.();
      const goal = { ...vals, ...next };
      if (!animate || reducedMotion()) {
        vals = { o: goal.o, h: Math.max(goal.h, goal.o, goal.c), l: Math.min(goal.l, goal.o, goal.c), c: goal.c };
        KEYS.forEach((k) => { vals[k] = snap(vals[k], o.tick, o.decimals); });
        render();
        if (!silent) o.onChange?.({ ...vals }, null);
        return Promise.resolve(true);
      }
      const from = { ...vals };
      anim = tween({
        from, to: goal, duration,
        onUpdate: (v) => {
          if (destroyed) return;
          vals = { o: v.o, h: Math.max(v.h, v.o, v.c), l: Math.min(v.l, v.o, v.c), c: v.c };
          KEYS.forEach((k) => { vals[k] = snap(vals[k], o.tick, o.decimals); });
          render();
          if (!silent) o.onChange?.({ ...vals }, null);
        },
      });
      return anim;
    },
    setLocked(on) {
      locked = !!on;
      root.classList.toggle('is-locked', locked);
      KEYS.forEach((k) => knobs[k].setAttribute('tabindex', locked ? '-1' : '0'));
      if (locked && drag) {
        drag = null;
        root.classList.remove('is-dragging');
      }
      render();
    },
    /** Draws the target as a dashed ghost, then (diffs) the target handle next to each missed one. */
    async showTarget(t, { label = 'Target', diffs = true, stepMs = 260 } = {}) {
      target = { ...t };
      reveal = { ghost: true, keys: new Set(), fresh: 'ghost', label };
      render();
      if (!diffs) return true;
      if (!(await later(420))) return false;
      for (const key of KEYS) {
        if (destroyed) return false;
        reveal.keys.add(key);
        reveal.fresh = key;
        render();
        if (Math.abs(vals[key] - target[key]) > o.tick * 1.001) sfx.tick();
        if (!(await later(stepMs))) return false;
      }
      reveal.fresh = null;
      return true;
    },
    clearTarget() {
      target = null;
      reveal = { ghost: false, keys: new Set(), fresh: null, label: 'Target' };
      KEYS.forEach((k) => api.setResult(k, '', ''));
      render();
    },
    setResult(key, text, tone = '') {
      const el = results[key];
      if (!el) return;
      el.textContent = text || '';
      el.className = `cbw__res${tone ? ` is-${tone}` : ''}`;
    },
    focus(key = active) {
      setActive(key, { focus: true });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      anim?.cancel?.();
      timers.forEach((t) => {
        clearTimeout(t);
        clearInterval(t);
      });
      timers.clear();
      ro?.disconnect();
      document.removeEventListener('keydown', onDocKey);
      root.remove();
      releaseStyle();
    },
  };
  return api;
}

// ------------------------------------------------------------------ scoring

/**
 * Accuracy of a numeric build: each price scores 1 within one tick, falling linearly to 0 at
 * `zero` (10% of the price scale, never closer than 4 ticks).
 */
export function priceScore(err, tick, zero) {
  const z = Math.max(zero, tick * 4);
  if (err <= tick + EPS) return 1;
  return Math.max(0, 1 - (err - tick) / (z - tick));
}
