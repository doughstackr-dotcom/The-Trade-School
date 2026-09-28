// Candle Builder — two round types, roughly alternating in a random order:
//   Build it: a story gives a candle ("Opened at 100.00, dipped to 97.50 …", or later a shape brief) and the
//             player drags Open / High / Low / Close on a price scale (keyboard: O H L C, arrows, Shift ×10,
//             Enter). A dashed ghost of the right candle then overlays theirs; numeric rounds score each price
//             (full within one tick, falling to 0 at 10% of the scale) plus a colour bonus, shape rounds score
//             the shape rules.
//   Read it:  a highlighted candle on a small chart with a price axis; pick the matching story from four
//             (options differ in one key detail: colour, which wick is long, where it closed, or one price).
// Every round is generated on demand from the round rng and game.difficulty (Practice / Arcade / Survival).
import { GameShell } from '../core/game-kit.js';
import { CandleChart } from '../core/chart.js';
import { h, svg, icon, kbdHint, confetti, reducedMotion } from '../core/ui.js';
import { randomWalk } from '../core/data.js';
import {
  ARCHETYPES, QUAL_IDS, KEYS, KEY_LABEL, makeCandle, features, isValidOHLC, numericStory,
  createBuilder, priceScore, snap,
} from './candle-builder-kit.js';

const ROUNDS = 10;
const PASS_NUMERIC = 60;
const PASS_SHAPE = 75;
const SECONDS = { buildNum: 45, buildShape: 40, readNum: 25, readShape: 20 };
const DEC = 2;

const CSS = `
.candle-builder .cbg-build { display: grid; gap: 12px; align-items: start; grid-template-areas: "brief" "board" "readout" "actions" "keys"; }
.candle-builder .cbg-build > .cbg-brief { grid-area: brief; }
.candle-builder .cbg-build > .cbg-board { grid-area: board; }
.candle-builder .cbg-build > .cbg-readout { grid-area: readout; }
.candle-builder .cbg-build > .cbg-actions { grid-area: actions; }
.candle-builder .cbg-build > .cbg-keys { grid-area: keys; }
@media (min-width: 760px) {
  .candle-builder .cbg-build { grid-template-columns: minmax(0, 1fr) minmax(320px, 480px); grid-template-rows: auto auto auto 1fr; grid-template-areas: "brief board" "readout board" "actions board" "keys board"; gap: 12px 24px; }
}
.candle-builder .cbg-brief { padding: 14px 16px; border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: var(--radius); background: var(--surface); }
.candle-builder .cbg-brief__top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.candle-builder .cbg-brief__meta { font-size: 13px; }
.candle-builder .cbg-brief__text { margin: 10px 0 0; font-size: clamp(16px, 1.2vw + 12px, 18px); font-weight: 600; line-height: 1.5; text-wrap: pretty; }
.candle-builder .cbg-brief__text b { color: var(--accent-strong); font-weight: 700; font-variant-numeric: tabular-nums; }
.candle-builder .cbg-brief__sub { margin: 6px 0 0; font-size: 14px; line-height: 1.45; }
.candle-builder .cbg-readout { display: flex; flex-wrap: wrap; gap: 6px; min-height: 28px; }
.candle-builder .cbg-pill { display: inline-flex; align-items: center; gap: 4px; padding: 5px 8px; border-radius: 6px; background: var(--surface-2); color: var(--text-2); font: 600 13px/1.1 var(--font-mono); font-variant-numeric: tabular-nums; }
.candle-builder .cbg-pill strong { color: var(--text); font-weight: 700; }
.candle-builder .cbg-pill--bull { background: var(--bull-soft); color: var(--bull-strong); }
.candle-builder .cbg-pill--bear { background: var(--bear-soft); color: var(--bear-strong); }
.candle-builder .cbg-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.candle-builder .cbg-keys { display: flex; flex-wrap: wrap; gap: 6px 14px; }
@media (pointer: coarse) { .candle-builder .cbg-keys--build { display: none; } }
.candle-builder .cbg-board { min-width: 0; padding: 10px 8px 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.candle-builder .cbg-read { display: grid; gap: 16px; align-items: start; }
@media (min-width: 900px) {
  .candle-builder .cbg-read { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 24px; }
  .candle-builder .cbg-read .option-grid { --cols: 1; }
}
.candle-builder .cbg-read__chart { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.candle-builder .cbg-read__cap { margin: 0; color: var(--text-3); font-size: 13.5px; }
.candle-builder .cbg-read .quiz__q { margin-top: 0; }
.candle-builder .cbg-table { display: grid; grid-template-columns: repeat(4, max-content); justify-content: start; gap: 4px 20px; margin: 4px 0 0; font: 13px/1.5 var(--font-mono); font-variant-numeric: tabular-nums; }
.candle-builder .cbg-table > span:nth-child(-n + 4) { color: var(--text-3); font: 600 11.5px/1.6 var(--font-body); letter-spacing: 0.05em; text-transform: uppercase; }
.candle-builder .cbg-table .is-good { color: var(--bull-strong); }
.candle-builder .cbg-table .is-bad { color: var(--bear-strong); }
.candle-builder .cbg-table .is-mid { color: var(--accent-strong); }
.candle-builder .cbg-table .cbg-total { font-weight: 700; color: var(--text); }
.candle-builder .cbg-checks { display: flex; flex-direction: column; gap: 6px; margin: 6px 0 0; }
.candle-builder .cbg-checks li { display: flex; align-items: flex-start; gap: 8px; line-height: 1.4; }
.candle-builder .cbg-checks .icon { flex: 0 0 auto; margin-top: 2px; }
.candle-builder .cbg-checks .is-pass .icon { color: var(--bull-strong); }
.candle-builder .cbg-checks .is-fail .icon { color: var(--bear-strong); }
.candle-builder .cbg-checks small { display: block; color: var(--text-3); font-size: 13px; }
.candle-builder .cbg-summary { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
.candle-builder .cbg-summary .stat { padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.candle-builder .cbg-summary p { grid-column: 1 / -1; margin: 0; color: var(--text-2); }
.candle-builder .cbg-preview { display: block; width: 100%; max-width: 320px; height: auto; margin-inline: auto; }
.candle-builder .cbg-preview .p-grid { stroke: var(--grid); }
.candle-builder .cbg-preview .p-rail { stroke: var(--line); stroke-width: 2; stroke-linecap: round; }
.candle-builder .cbg-preview .p-guide { stroke: var(--text-3); stroke-dasharray: 2 4; opacity: 0.7; }
.candle-builder .cbg-preview .p-bull { fill: var(--bull); stroke: var(--bull); }
.candle-builder .cbg-preview .p-ghost { fill: none; stroke: var(--accent); stroke-width: 2; stroke-dasharray: 5 4; }
.candle-builder .cbg-preview .p-knob { fill: var(--surface); stroke: var(--line); stroke-width: 1.5; }
.candle-builder .cbg-preview .p-knob.is-on { fill: var(--accent-soft); stroke: var(--accent); }
.candle-builder .cbg-preview text { fill: var(--text-2); font: 700 11px/1 var(--font-body); }
.candle-builder .cbg-preview .p-price { fill: var(--text); font: 600 10px/1 var(--font-mono); }
.candle-builder .cbg-preview .p-float { animation: cbg-bob 2.4s ease-in-out infinite; }
@keyframes cbg-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
@media (prefers-reduced-motion: reduce) { .candle-builder .cbg-preview .p-float { animation: none; } }
`;

// ------------------------------------------------------------------ round plan (deterministic per run)

/** Round type: blocks of two rounds hold one Build and one Read in a random order (never 3 in a row). */
function typeOf(g, round) {
  const block = Math.floor((round - 1) / 2);
  return g.rng.fork(`cb-type-${block}`).shuffle(['build', 'read'])[(round - 1) % 2];
}
function countBefore(g, round, type) {
  let n = 0;
  for (let r = 1; r < round; r++) if (typeOf(g, r) === type) n += 1;
  return n;
}

const NUM_POOL = {
  bull: [['bull-plain', 'bull-maru'], ['bull-lower', 'bull-both', 'bull-upper-mid'], ['bull-upper']],
  bear: [['bear-plain', 'bear-maru'], ['bear-upper', 'bear-both', 'bear-lower-mid'], ['bear-lower']],
};

function scaleFor(rng, tick) {
  const span = tick === 0.5 ? 12 : tick === 0.2 ? 10 : 8;
  const lo = rng.int(24, 170);
  return { lo, hi: lo + span, span };
}

function planBuild(g, round, rng, d) {
  const idx = countBefore(g, round, 'build');
  const colour = g.rng.fork(`cb-bcol-${Math.floor(idx / 2)}`).shuffle(['bull', 'bear'])[idx % 2];
  const shape = d >= 0.72 ? rng.chance(0.7) : d >= 0.45 ? rng.chance(0.4) : false;
  const tick = d < 0.34 ? 0.5 : d < 0.67 ? 0.2 : 0.1;
  const { lo, hi, span } = scaleFor(rng, tick);
  if (shape) {
    const maxLevel = d < 0.6 ? 1 : 2;
    let pool = QUAL_IDS.filter((id) => ARCHETYPES[id].level <= maxLevel && (ARCHETYPES[id].colour === colour || ARCHETYPES[id].colour === 'doji'));
    if (!pool.length) pool = QUAL_IDS.filter((id) => ARCHETYPES[id].level <= maxLevel);
    const id = rng.pick(pool);
    return { kind: 'shape', id, lo, hi, span, tick, colour };
  }
  const tiers = NUM_POOL[colour];
  const pool = d < 0.25 ? tiers[0] : d < 0.55 ? [...tiers[0], ...tiers[1]] : [...tiers[0], ...tiers[1], ...tiers[2]];
  const id = rng.pick(pool);
  const target = makeCandle(id, rng, { lo, hi, tick, decimals: DEC, frac: [0.42, 0.66], margin: 0.08 });
  return { kind: 'num', id, target, lo, hi, span, tick, colour };
}

/** The archetype's textbook proportions placed inside the player's own range (for the shape ghost). */
function exampleIn(id, v, plan) {
  const a = ARCHETYPES[id];
  const mid = (r) => (r[0] + r[1]) / 2;
  let lo = v.l;
  let range = v.h - v.l;
  if (range < plan.span * 0.2) {
    range = plan.span * 0.5;
    lo = plan.lo + plan.span * 0.25;
  }
  const s = (p) => snap(p, plan.tick, DEC);
  const o = s(lo + mid(a.o) * range);
  const c = a.colour === 'doji' ? o : s(lo + mid(a.c) * range);
  return { o, h: s(lo + range), l: s(lo), c };
}

/** Shape checks for a build brief. Each is { label, ok, detail }. */
function shapeChecks(id, v, plan) {
  const a = ARCHETYPES[id];
  const f = features(v);
  const pct = (x) => `${Math.round(x * 100)}%`;
  const checks = [{
    label: 'Big enough to read',
    ok: f.range >= plan.span * 0.25 - 1e-9,
    detail: `Range is ${pct(f.range / plan.span)} of the scale (needs 25% or more).`,
  }];
  if (!(f.range > 0)) {
    checks.push({ label: 'A real candle', ok: false, detail: 'All four prices are equal: there is no candle to judge.' });
    return checks;
  }
  if (a.colour === 'doji') {
    checks.push({ label: 'Open and close almost equal', ok: f.bodyR <= 0.08, detail: `Body is ${pct(f.bodyR)} of the range (a doji needs 8% or less).` });
  } else {
    const want = a.colour === 'bull' ? 1 : -1;
    checks.push({
      label: a.colour === 'bull' ? 'Bullish: close above open' : 'Bearish: close below open',
      ok: f.dir === want && f.bodyR > 0.08,
      detail: f.dir === 0 || f.bodyR <= 0.08 ? 'Open and close are (almost) equal: that is a doji, not a clear body.' : `Close is ${f.dir > 0 ? 'above' : 'below'} the open.`,
    });
  }
  const up = { label: 'Little or no upper wick', ok: f.upperR <= 0.1, detail: `Upper wick is ${pct(f.upperR)} of the range (needs 10% or less).` };
  const dn = { label: 'Little or no lower wick', ok: f.lowerR <= 0.1, detail: `Lower wick is ${pct(f.lowerR)} of the range (needs 10% or less).` };
  if (a.wick === 'none') checks.push(up, dn);
  else if (a.wick === 'lower') {
    if (a.ratio2) checks.push({ label: 'Lower wick at least twice the body', ok: f.lower >= 2 * f.body && f.lowerR >= 0.45, detail: `Lower wick ${pct(f.lowerR)}, body ${pct(f.bodyR)} of the range.` });
    else checks.push({ label: 'Long lower wick', ok: f.lowerR >= (a.colour === 'doji' ? 0.6 : 0.4), detail: `Lower wick is ${pct(f.lowerR)} of the range (needs ${a.colour === 'doji' ? '60' : '40'}% or more).` });
    checks.push(up);
  } else if (a.wick === 'upper') {
    if (a.ratio2) checks.push({ label: 'Upper wick at least twice the body', ok: f.upper >= 2 * f.body && f.upperR >= 0.45, detail: `Upper wick ${pct(f.upperR)}, body ${pct(f.bodyR)} of the range.` });
    else checks.push({ label: 'Long upper wick', ok: f.upperR >= (a.colour === 'doji' ? 0.6 : 0.4), detail: `Upper wick is ${pct(f.upperR)} of the range (needs ${a.colour === 'doji' ? '60' : '40'}% or more).` });
    checks.push(dn);
  } else if (a.wick === 'both') {
    if (a.colour === 'doji') {
      checks.push({ label: 'Wicks on both sides', ok: f.upperR >= 0.25 && f.lowerR >= 0.25, detail: `Upper ${pct(f.upperR)}, lower ${pct(f.lowerR)} of the range (each needs 25% or more).` });
    } else {
      checks.push({ label: 'Small body: 10 to 30% of the range', ok: f.bodyR >= 0.1 && f.bodyR <= 0.3, detail: `Body is ${pct(f.bodyR)} of the range.` });
      checks.push({ label: 'Both wicks longer than the body', ok: f.upper > f.body && f.lower > f.body, detail: `Upper ${pct(f.upperR)}, lower ${pct(f.lowerR)}, body ${pct(f.bodyR)}.` });
    }
  }
  if (a.close === 'mid') {
    checks.push({ label: 'Closes mid-range', ok: f.closeLoc >= 0.33 && f.closeLoc <= 0.67, detail: `The close sits ${pct(f.closeLoc)} of the way up the range (needs 33 to 67%).` });
  }
  return checks;
}

// ------------------------------------------------------------------ read round plan

function contextSeries(target, rng, n, ratio) {
  const tr = target.h - target.l;
  for (let i = 0; i < 30; i++) {
    const walk = randomWalk({ seed: rng.int(1, 2 ** 31 - 2), count: n, start: 100, vol: 0.01, volume: false });
    const avg = walk.reduce((s, k) => s + (k.h - k.l), 0) / n;
    const f = (tr * ratio) / avg;
    const last = walk[n - 1].c;
    const map = (p) => +(target.o + (p - last) * f).toFixed(DEC);
    const ctx = walk.map((k, j) => ({ o: map(k.o), h: map(k.h), l: map(k.l), c: map(k.c), v: 0, t: j }));
    const all = [...ctx, { ...target, v: 0, t: n }];
    const lo = Math.min(...all.map((k) => k.l));
    const hi = Math.max(...all.map((k) => k.h));
    if (lo <= 0 || !all.every(isValidOHLC)) continue;
    if (tr / (hi - lo) < 0.42) continue; // the highlighted candle must dominate the price axis
    return { candles: all, lo, hi };
  }
  // Hand-tuned fallback: quiet candles stepping into the open.
  const ctx = Array.from({ length: n }, (_, j) => {
    const base = target.o + (j - n) * tr * 0.04;
    return { o: +(base - tr * 0.03).toFixed(DEC), h: +(base + tr * 0.08).toFixed(DEC), l: +(base - tr * 0.1).toFixed(DEC), c: +(j === n - 1 ? target.o : base + tr * 0.03).toFixed(DEC), v: 0, t: j };
  }).map((k) => ({ ...k, h: Math.max(k.h, k.o, k.c), l: Math.min(k.l, k.o, k.c) }));
  const all = [...ctx, { ...target, v: 0, t: n }];
  return { candles: all, lo: Math.min(...all.map((k) => k.l)), hi: Math.max(...all.map((k) => k.h)) };
}

const same = (a, b) => KEYS.every((k) => Math.abs(a[k] - b[k]) < 1e-9);
const maxDiff = (a, b) => Math.max(...KEYS.map((k) => Math.abs(a[k] - b[k])));

/** Numeric distractors: swap open / close (colour), or move one price by a clearly readable amount. */
function numericDistractors(k, rng, span, tick, lo, hi) {
  const minDiff = Math.max(0.12 * span, 3 * tick);
  const out = [];
  const add = (type, dk) => {
    if (!isValidOHLC(dk) || maxDiff(dk, k) < minDiff - 1e-9) return false;
    if (out.some((o) => same(o.k, dk))) return false;
    out.push({ type, k: dk });
    return true;
  };
  const f = features(k);
  if (f.body >= minDiff) add('colour', { ...k, o: k.c, c: k.o });
  const moves = rng.shuffle(['c', 'h', 'l', 'o']);
  for (const key of moves) {
    if (out.length >= 3) break;
    for (let tries = 0; tries < 6; tries++) {
      const d = snap(rng.float(0.2, 0.34) * span, tick, DEC);
      const dirs = rng.shuffle([1, -1]);
      let done = false;
      for (const dir of dirs) {
        const dk = { ...k, [key]: snap(k[key] + dir * d, tick, DEC) };
        const inside = dk[key] >= lo - 0.08 * span && dk[key] <= hi + 0.08 * span;
        if (inside && add(key, dk)) {
          done = true;
          break;
        }
      }
      if (done) break;
    }
  }
  return out.slice(0, 3);
}

/** Shape distractors: archetypes that differ from the target in one detail each (colour / wick / close). */
function shapeDistractors(id, rng, d) {
  const a = ARCHETYPES[id];
  const others = QUAL_IDS.filter((x) => x !== id);
  const diffs = (x) => ['colour', 'wick', 'close'].filter((f) => ARCHETYPES[x][f] !== a[f]).length;
  const pickFrom = (list, used) => {
    const pool = list.filter((x) => !used.includes(x));
    if (!pool.length) return null;
    // Hard rounds use the closest lookalikes; easy rounds allow any candidate of the slot.
    const best = Math.min(...pool.map(diffs));
    const near = pool.filter((x) => diffs(x) === best);
    return rng.pick(d >= 0.6 ? near : rng.chance(0.5) ? near : pool);
  };
  const used = [];
  const slots = [
    ['colour', others.filter((x) => ARCHETYPES[x].colour !== a.colour)],
    ['wick', others.filter((x) => ARCHETYPES[x].colour === a.colour && ARCHETYPES[x].wick !== a.wick)],
    ['close', others.filter((x) => ARCHETYPES[x].colour === a.colour && ARCHETYPES[x].close !== a.close)],
  ];
  for (const [, list] of slots) {
    const x = pickFrom(list, used) || pickFrom(others, used);
    if (x) used.push(x);
  }
  while (used.length < 3) {
    const y = pickFrom(others, used);
    if (!y) break;
    used.push(y);
  }
  return used.slice(0, 3);
}

function planRead(g, round, rng, d) {
  const idx = countBefore(g, round, 'read');
  const pos = g.rng.fork(`cb-rpos-${Math.floor(idx / 4)}`).shuffle([0, 1, 2, 3])[idx % 4];
  const numeric = d < 0.34 ? true : d < 0.6 ? rng.chance(0.35) : false;
  const n = d < 0.5 ? 8 : 12;
  const ratio = d < 0.5 ? 0.38 : 0.55;
  if (numeric) {
    const tick = d < 0.2 ? 0.5 : 0.2;
    const { lo, hi } = scaleFor(rng, tick);
    const colour = rng.pick(['bull', 'bear']);
    const pool = colour === 'bull' ? ['bull-plain', 'bull-lower', 'bull-maru', 'bull-upper-mid'] : ['bear-plain', 'bear-upper', 'bear-maru', 'bear-lower-mid'];
    for (let attempt = 0; attempt < 30; attempt++) {
      const id = rng.pick(pool);
      const target = makeCandle(id, rng, { lo, hi, tick, decimals: DEC, frac: [0.46, 0.66] });
      const ctx = contextSeries(target, rng, n, ratio);
      const ds = numericDistractors(target, rng, ctx.hi - ctx.lo, tick, ctx.lo, ctx.hi);
      if (ds.length < 3) continue;
      return { numeric: true, id, target, pos, ...ctx, n, distractors: ds, tick };
    }
  }
  const maxLevel = d < 0.4 ? 0 : d < 0.7 ? 1 : 2;
  const pool = QUAL_IDS.filter((id) => ARCHETYPES[id].level <= maxLevel);
  const id = rng.pick(pool);
  const lo = rng.int(24, 170);
  const target = makeCandle(id, rng, { lo, hi: lo + 10, tick: 0.1, decimals: DEC, frac: [0.5, 0.7] });
  const ctx = contextSeries(target, rng, n, ratio);
  return { numeric: false, id, target, pos, ...ctx, n, distractors: shapeDistractors(id, rng, d).map((x) => ({ type: 'shape', id: x })) };
}

// ------------------------------------------------------------------ text helpers

const fx = (p) => Number(p).toFixed(DEC);
const colourWord = (k) => (k.c > k.o ? 'bullish' : k.c < k.o ? 'bearish' : 'a doji (no body)');

function bodyExplain(k) {
  const f = features(k);
  const bull = f.dir > 0;
  const bits = [];
  if (f.dir === 0) bits.push(`It opened and closed at ${fx(k.o)}, so it has no body: a doji.`);
  else bits.push(`It is <strong>${bull ? 'bullish' : 'bearish'}</strong>: it closed at <b>${fx(k.c)}</b>, ${bull ? 'above' : 'below'} its open at <b>${fx(k.o)}</b>, so the ${bull ? 'green' : 'red'} body runs from ${fx(Math.min(k.o, k.c))} to ${fx(Math.max(k.o, k.c))}.`);
  bits.push(f.upper > 1e-9 ? `The upper wick reaches the high at <b>${fx(k.h)}</b>.` : `There is no upper wick: the ${bull ? 'close' : 'open'} was the high.`);
  bits.push(f.lower > 1e-9 ? `The lower wick reaches the low at <b>${fx(k.l)}</b>.` : `There is no lower wick: the ${bull ? 'open' : 'close'} was the low.`);
  return bits.join(' ');
}

const FEATURE_WORDS = {
  colour: { bull: 'bullish (close above open)', bear: 'bearish (close below open)', doji: 'a doji (close equal to the open)' },
  wick: { none: 'almost no wicks', lower: 'a long lower wick', upper: 'a long upper wick', both: 'long wicks on both sides' },
  close: { high: 'a close near the high', mid: 'a close mid-range', low: 'a close near the low' },
};

function shapeDiff(chosenId, trueId) {
  const a = ARCHETYPES[trueId];
  const b = ARCHETYPES[chosenId];
  const parts = ['colour', 'wick', 'close'].filter((f) => a[f] !== b[f]).map((f) => `your pick has ${FEATURE_WORDS[f][b[f]]}, but this candle has ${FEATURE_WORDS[f][a[f]]}`);
  return parts.length ? `${parts.join('; ')}.` : '';
}

function numericDiff(chosen, truth) {
  if (chosen.type === 'colour') return 'Your pick swapped the open and the close, which would flip the colour of the body.';
  const key = KEYS.find((k) => Math.abs(chosen.k[k] - truth[k]) > 1e-9);
  if (!key) return '';
  return `Your pick put the ${KEY_LABEL[key].toLowerCase()} at ${fx(chosen.k[key])}; on the chart it is ${fx(truth[key])}.`;
}

// ------------------------------------------------------------------ intro preview

function drawPreview(el) {
  const W = 280;
  const H = 176;
  const s = svg('svg', { class: 'cbg-preview', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'A candle being built by dragging Open, High, Low and Close handles on a price scale' });
  const top = 34;
  const bot = 162;
  const y = (p) => top + (1 - p) * (bot - top);
  for (let i = 0; i <= 4; i++) s.append(svg('line', { class: 'p-grid', x1: 8, x2: W - 4, y1: top + i * ((bot - top) / 4), y2: top + i * ((bot - top) / 4) }));
  const k = { o: 0.3, h: 0.94, l: 0.1, c: 0.82 };
  const cx = 40;
  const lanes = [['o', 'Open', 104], ['h', 'High', 162], ['l', 'Low', 208], ['c', 'Close', 254]];
  const prices = { o: '100.00', h: '104.20', l: '97.50', c: '103.10' };
  for (const [key, , x] of lanes) {
    s.append(svg('line', { class: 'p-rail', x1: x, x2: x, y1: top, y2: bot }));
    s.append(svg('line', { class: 'p-guide', x1: cx + 14, x2: x - 22, y1: y(k[key]), y2: y(k[key]) }));
  }
  s.append(svg('path', { class: 'p-bull', d: `M${cx},${y(k.h)}V${y(k.l)}`, 'stroke-width': 2.5 }));
  s.append(svg('rect', { class: 'p-bull', x: cx - 11, y: y(k.c), width: 22, height: y(k.o) - y(k.c), rx: 2 }));
  s.append(svg('rect', { class: 'p-ghost', x: cx - 16, y: y(0.86), width: 32, height: y(0.34) - y(0.86), rx: 3 }));
  for (const [key, label, x] of lanes) {
    s.append(svg('text', { x, y: 18, 'text-anchor': 'middle' }, label));
    const g = svg('g', key === 'c' ? { class: 'p-float' } : null,
      svg('rect', { class: `p-knob${key === 'c' ? ' is-on' : ''}`, x: x - 21, y: y(k[key]) - 10, width: 42, height: 20, rx: 6 }),
      svg('text', { class: 'p-price', x, y: y(k[key]) + 3.5, 'text-anchor': 'middle' }, prices[key]));
    s.append(g);
  }
  el.append(s);
}

// ------------------------------------------------------------------ rounds

function buildRound(g, { round, rng, stage, difficulty: d }, stats) {
  const plan = planBuild(g, round, rng, d);
  const numeric = plan.kind === 'num';
  const a = ARCHETYPES[plan.id];
  let done = false;
  let alive = true;
  const typeChip = h('span', { class: 'chip chip--accent chip--sm' }, icon('candle', { size: 14 }), 'Build it');
  const briefHtml = numeric ? `Build this candle: ${numericStory(plan.target, DEC).html}` : `Build ${a.brief}.`;
  const sub = numeric
    ? `Match all four prices. Each scores in full within one tick (the smallest price step, ${plan.tick.toFixed(1)} here); the right colour earns a bonus.`
    : 'Place it anywhere on the scale, at least a quarter of the scale tall. The shape is what counts.';
  const readout = h('div', { class: 'cbg-readout', 'aria-live': 'off' });
  const submitBtn = h('button', { type: 'button', class: 'btn btn--primary btn--lg', 'data-action': 'submit-candle' }, icon('check'), h('span', null, 'Submit candle'));
  const resetBtn = h('button', { type: 'button', class: 'btn btn--ghost', 'data-action': 'reset-candle' }, icon('restart', { size: 16 }), h('span', null, 'Reset'));
  const keys = h('div', { class: 'cbg-keys cbg-keys--build' },
    kbdHint(['O', 'H', 'L', 'C'], 'pick a handle'), kbdHint(['↑', '↓'], 'one tick'), kbdHint('Shift', '×10'), kbdHint('Enter', 'submit'));
  const board = h('div', { class: 'cbg-board' });
  stage.append(h('div', { class: 'cbg-build' },
    h('div', { class: 'cbg-brief' },
      h('div', { class: 'cbg-brief__top' }, typeChip, h('span', { class: 'faint cbg-brief__meta' }, numeric ? 'Exact prices' : 'Shape brief')),
      h('p', { class: 'cbg-brief__text', html: briefHtml }),
      h('p', { class: 'cbg-brief__sub faint' }, sub)),
    board,
    readout,
    h('div', { class: 'cbg-actions' }, submitBtn, resetBtn),
    keys));

  const mid = snap((plan.lo + plan.hi) / 2, plan.tick, DEC);
  const start = { o: mid, h: mid, l: mid, c: mid };
  const showShape = !numeric && d < 0.8;

  function updateReadout(v) {
    const f = features(v);
    const tone = f.dir > 0 ? 'bull' : f.dir < 0 ? 'bear' : '';
    const colour = h('span', { class: ['cbg-pill', tone && `cbg-pill--${tone}`] }, f.range > 0 ? (f.dir > 0 ? 'Bullish' : f.dir < 0 ? 'Bearish' : 'No body') : 'Flat');
    if (showShape) {
      const pct = (x) => `${Math.round(x * 100)}%`;
      readout.replaceChildren(colour,
        h('span', { class: 'cbg-pill' }, 'Body ', h('strong', null, pct(f.bodyR))),
        h('span', { class: 'cbg-pill' }, 'Upper ', h('strong', null, pct(f.upperR))),
        h('span', { class: 'cbg-pill' }, 'Lower ', h('strong', null, pct(f.lowerR))),
        h('span', { class: 'cbg-pill' }, 'Size ', h('strong', null, pct(f.range / plan.span))));
    } else {
      readout.replaceChildren(colour, ...KEYS.map((k) => h('span', { class: 'cbg-pill' }, `${k.toUpperCase()} `, h('strong', null, fx(v[k])))));
    }
  }

  const builder = createBuilder(board, {
    min: plan.lo, max: plan.hi, tick: plan.tick, decimals: DEC, values: start,
    onChange: (v) => updateReadout(v),
    onSubmit: () => submit(),
    ariaLabel: numeric ? 'Candle builder: set the four prices from the story' : 'Candle builder: build the shape from the brief',
  });
  updateReadout(builder.values);

  g.setHint(() => {
    if (numeric) {
      const up = plan.target.c > plan.target.o;
      return `Set the body first: Open and Close. The close is ${up ? 'above' : 'below'} the open, so the body is ${up ? 'green' : 'red'}. Then stretch High and Low out to the wick tips; use − / + or the arrow keys for the last tick.`;
    }
    const tips = {
      none: 'Almost no wicks: put High on the top of the body and Low on the bottom.',
      lower: a.ratio2 ? 'Make the lower wick at least twice as long as the body, and keep High right at the top of the body.' : 'Make a long lower wick and keep High close to the top of the body.',
      upper: a.ratio2 ? 'Make the upper wick at least twice as long as the body, and keep Low right at the bottom of the body.' : 'Make a long upper wick and keep Low close to the bottom of the body.',
      both: a.colour === 'doji' ? 'Put Open and Close on the same price, with wicks above and below.' : 'Keep the body small (10 to 30% of the range) and make both wicks longer than the body.',
    };
    const colourTip = a.colour === 'doji' ? 'Open and Close at (almost) the same price.' : a.colour === 'bull' ? 'Bullish: Close above Open.' : 'Bearish: Close below Open.';
    return `${colourTip} ${tips[a.wick] || ''}`;
  });

  async function submit({ timeout = false } = {}) {
    if (done || !alive || g.state !== 'play') return;
    done = true;
    g.timer.stop();
    builder.setLocked(true);
    submitBtn.disabled = true;
    resetBtn.disabled = true;
    const v = builder.values;
    if (numeric) {
      const t = plan.target;
      const zero = 0.1 * plan.span;
      const rows = KEYS.map((key) => {
        const err = Math.abs(v[key] - t[key]);
        const s = priceScore(err, plan.tick, zero);
        return { key, err, s, pts: Math.round(20 * s) };
      });
      const colourOk = Math.sign(v.c - v.o) === Math.sign(t.c - t.o);
      const points = rows.reduce((s, r) => s + r.pts, 0) + (colourOk ? 20 : 0);
      rows.forEach((r) => builder.setResult(r.key, r.err < 1e-9 ? 'exact' : r.err <= plan.tick + 1e-9 ? '1 tick' : `${v[r.key] > t[r.key] ? '+' : '−'}${r.err.toFixed(2)}`, r.err <= plan.tick + 1e-9 ? 'good' : r.s >= 0.5 ? 'mid' : 'bad'));
      await builder.showTarget(t, { label: 'Story candle', diffs: true, stepMs: 200 });
      if (!alive || g.state !== 'play') return;
      stats.builds.set(round, points);
      const table = h('div', { class: 'cbg-table', 'aria-label': 'Score, price by price' },
        h('span', null, 'Price'), h('span', null, 'Story'), h('span', null, 'Yours'), h('span', null, 'Points'),
        ...rows.flatMap((r) => [
          h('span', null, KEY_LABEL[r.key]), h('span', null, fx(t[r.key])), h('span', null, fx(v[r.key])),
          h('span', { class: r.pts >= 20 ? 'is-good' : r.pts >= 10 ? 'is-mid' : 'is-bad' }, `${r.pts}/20`),
        ]),
        h('span', null, 'Colour'), h('span', null, colourWord(t)), h('span', null, features(v).range > 0 ? colourWord(v) : 'flat'),
        h('span', { class: colourOk ? 'is-good' : 'is-bad' }, `${colourOk ? 20 : 0}/20`),
        h('span', { class: 'cbg-total' }, 'Total'), h('span'), h('span'), h('span', { class: 'cbg-total' }, `${points}/100`));
      const pass = points >= PASS_NUMERIC && !timeout;
      const head = timeout ? `Time's up! Your candle scored ${points}/100.` : pass ? `${points === 100 ? 'Perfect build' : 'Nice build'}: ${points}/100.` : `Not quite: ${points}/100.`;
      const tip = !colourOk ? ' The colour is wrong: check which of open and close is higher.' : pass ? '' : ' The gold handles show where each price belongs.';
      if (pass) g.correct(`<strong>${head}</strong>${tip}`, { points });
      else {
        g.wrong(`<strong>${head}</strong>${tip}`);
        if (g.style !== 'practice' && points > 0) g.award(points, { reason: 'accuracy' });
      }
      g.feedback(h('div', null, h('p', { html: bodyExplain(t) }), table), pass ? 'good' : 'info');
      if (points === 100 && !timeout) confetti(board);
    } else {
      const checks = shapeChecks(plan.id, v, plan);
      const passed = checks.filter((c) => c.ok).length;
      const points = Math.round((100 * passed) / checks.length);
      await builder.showTarget(exampleIn(plan.id, v, plan), { label: 'Textbook shape', diffs: false });
      if (!alive || g.state !== 'play') return;
      stats.builds.set(round, points);
      const list = h('ul', { class: 'cbg-checks' }, checks.map((c) => h('li', { class: c.ok ? 'is-pass' : 'is-fail' },
        icon(c.ok ? 'check' : 'x', { size: 16 }), h('span', null, h('strong', null, c.label), h('small', null, c.detail)))));
      const pass = points >= PASS_SHAPE && !timeout;
      const head = timeout ? `Time's up! ${passed} of ${checks.length} shape checks passed.` : pass ? `Shape matches: ${passed} of ${checks.length} checks.` : `Shape is off: ${passed} of ${checks.length} checks.`;
      if (pass) g.correct(`<strong>${head}</strong> ${a.why}`, { points });
      else {
        g.wrong(`<strong>${head}</strong> The dashed gold candle shows the textbook shape in your range.`);
        if (g.style !== 'practice' && points > 0) g.award(points, { reason: 'shape' });
      }
      g.feedback(h('div', null, h('p', { html: `<strong>The brief:</strong> ${a.brief}. ${pass ? '' : a.why}` }), list), pass ? 'good' : 'info');
      if (points === 100 && !timeout) confetti(board);
    }
    g.nextButton();
  }

  submitBtn.addEventListener('click', () => submit());
  resetBtn.addEventListener('click', () => {
    if (!done) builder.set(start, { animate: true, duration: 360 });
  });
  const onKey = (e) => {
    if (done || e.key !== 'Enter' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.body.classList.contains('has-modal')) return;
    const t = e.target;
    if (t && t.closest && t.closest('button, a, input, textarea, select, [role="radio"]')) return;
    if (!stage.isConnected) return;
    e.preventDefault();
    submit();
  };
  document.addEventListener('keydown', onKey);

  if (g.timed) g.timer.start((numeric ? SECONDS.buildNum : SECONDS.buildShape) * g.clockScale, () => submit({ timeout: true }));
  requestAnimationFrame(() => {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    if (alive && !done && !coarse) builder.focus('o');
  });

  return () => {
    alive = false;
    document.removeEventListener('keydown', onKey);
    builder.destroy();
  };
}

function readRound(g, { round, rng, stage, difficulty: d }, stats) {
  const plan = planRead(g, round, rng, d);
  const t = plan.target;
  const n = plan.n;
  let answered = false;
  let alive = true;
  const timers = new Set();

  const chartHost = h('div', { class: 'chart-frame cbg-read__host' });
  const chartCol = h('div', { class: 'cbg-read__chart' },
    h('div', { class: 'row row--sm' }, h('span', { class: 'chip chip--accent chip--sm' }, icon('eye', { size: 14 }), 'Read it'),
      h('span', { class: 'faint' }, plan.numeric ? 'Read the prices off the axis' : 'Read the shape')),
    chartHost,
    h('p', { class: 'cbg-read__cap' }, 'Tap or hover the chart to read any price on the axis.'));
  const quizCol = h('div', { class: 'cbg-read__quiz' });
  stage.append(h('div', { class: 'cbg-read' }, chartCol, quizCol));

  const phone = (stage.clientWidth || window.innerWidth) < 560;
  const chart = new CandleChart(chartHost, {
    candles: plan.candles,
    height: phone ? 250 : 290,
    slots: plan.candles.length + 2,
    showAxis: true,
    legend: false,
    showLast: false,
    crosshair: true,
    yPad: 0.16,
    decimals: DEC,
    focus: [n, n],
    focusDim: 0.32,
    timeLabel: () => '',
    ariaLabel: 'Price chart with one highlighted candle at the right edge. Read its open, high, low and close.',
  });
  const boxId = chart.addBox({ from: n, to: n, color: 'accent', label: 'This candle' });

  // Options: the truth at a balanced position, three one-detail distractors around it.
  const truthLabel = plan.numeric ? numericStory(t, DEC).text : ARCHETYPES[plan.id].story;
  const wrongs = plan.distractors.map((ds, i) => ({
    value: `d${i}`,
    label: plan.numeric ? numericStory(ds.k, DEC).text : ARCHETYPES[ds.id].story,
    ds,
  }));
  const options = [];
  let w = 0;
  for (let i = 0; i < 4; i++) {
    if (i === plan.pos) options.push({ value: 'correct', label: truthLabel });
    else if (wrongs[w]) options.push(wrongs[w++]);
  }
  const whyText = () => {
    if (plan.numeric) return bodyExplain(t);
    const a = ARCHETYPES[plan.id];
    return `${a.why} ${bodyShape(t)}`;
  };

  function annotate() {
    const bull = t.c >= t.o;
    chart.update(boxId, { label: null });
    const steps = [
      () => chart.addHLine({ price: t.o, color: 'text', dashed: true, label: 'Open', from: n - 2.6, to: n + 1.9, pulse: true }),
      () => chart.addHLine({ price: t.c, color: bull ? 'bull' : 'bear', label: 'Close', from: n - 2.6, to: n + 1.9, pulse: true }),
      () => chart.addMarker({ idx: n, price: t.h, position: 'above', shape: 'dot', text: 'High', color: 'accent', pulse: true }),
      () => chart.addMarker({ idx: n, price: t.l, position: 'below', shape: 'dot', text: 'Low', color: 'accent', pulse: true }),
    ];
    const gap = reducedMotion() ? 0 : 320;
    steps.forEach((fn, i) => {
      const id = setTimeout(() => {
        timers.delete(id);
        if (alive) fn();
      }, i * gap);
      timers.add(id);
    });
  }

  const explain = (ok, value) => {
    if (ok) return `<strong>Correct.</strong> ${whyText()}`;
    const chosen = wrongs.find((o) => o.value === value);
    const diff = chosen ? (plan.numeric ? numericDiff(chosen.ds, t) : shapeDiff(chosen.ds.id, plan.id)) : '';
    return `<strong>Not this one.</strong> ${diff.charAt(0).toUpperCase()}${diff.slice(1)} ${whyText()}`;
  };

  const quiz = g.ask({
    question: 'Which story matches the highlighted candle?',
    options: options.map(({ value, label }) => ({ value, label })),
    answer: 'correct',
    explain,
    hint: plan.numeric
      ? 'Find the body first: a green body closes at its top, a red body closes at its bottom. Then read the wick tips on the price axis for the high and the low.'
      : 'Check three things in order: the colour (close versus open), which wick is longer, and where the close sits in the candle’s range.',
    onAnswer: (ok) => {
      answered = true;
      stats.reads.set(round, ok);
      annotate();
    },
  });
  quizCol.append(quiz, h('div', { class: 'cbg-keys' }, kbdHint(['1', '2', '3', '4'], 'to answer')));

  const onExpire = () => {
    if (answered || !alive || g.state !== 'play') return;
    answered = true;
    // Freeze the options: a static copy, so neither clicks nor number keys can answer after the clock.
    const frozen = quiz.cloneNode(true);
    quiz.replaceWith(frozen);
    frozen.classList.add('is-answered');
    frozen.querySelectorAll('.option').forEach((b) => {
      b.classList.add('is-locked');
      b.setAttribute('aria-disabled', 'true');
      if (b.dataset.value === 'correct') {
        b.classList.add('is-correct', 'is-reveal');
        b.querySelector('.option__mark')?.append(icon('check', { size: 18 }));
      } else b.classList.add('is-dim');
    });
    stats.reads.set(round, false);
    g.wrong(`<strong>Time's up!</strong> The matching story is marked. ${whyText()}`);
    annotate();
    g.nextButton();
  };
  if (g.timed) g.timer.start((plan.numeric ? SECONDS.readNum : SECONDS.readShape) * g.clockScale, onExpire);

  return () => {
    alive = false;
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
    chart.destroy();
  };
}

function bodyShape(k) {
  const f = features(k);
  const pct = (x) => `${Math.round(x * 100)}%`;
  return `Here the body is ${pct(f.bodyR)} of the range, the upper wick ${pct(f.upperR)} and the lower wick ${pct(f.lowerR)}.`;
}

// ------------------------------------------------------------------ module

export default {
  id: 'candle-builder',
  mount(root, ctx) {
    root.classList.add('candle-builder');
    const style = h('style', { 'data-owner': 'candle-builder' }, CSS);
    document.head.append(style);
    let stats = { builds: new Map(), reads: new Map() };

    const game = new GameShell(root, ctx, {
      rounds: ROUNDS,
      maxScore: ROUNDS * 100,
      timer: { seconds: SECONDS.buildNum, perRound: true },
      howTo: [
        'Build it: read the story, then drag the Open, High, Low and Close handles until your candle matches it.',
        'Read it: pick the story that matches the highlighted candle (keys 1 to 4).',
        'Each price scores in full within one tick, and the right colour earns a bonus. Later rounds describe a shape instead of prices.',
        'Keyboard: O, H, L, C pick a handle, arrows move it one tick (Shift for ten), Enter submits.',
      ],
      preview: drawPreview,
      onStart(g) {
        stats = { builds: new Map(), reads: new Map() };
        g.nextRound();
      },
      onRound(g, args) {
        return typeOf(g, args.round) === 'build' ? buildRound(g, args, stats) : readRound(g, args, stats);
      },
      onEnd() {
        const builds = [...stats.builds.values()];
        const reads = [...stats.reads.values()];
        const avg = builds.length ? Math.round(builds.reduce((s, x) => s + x, 0) / builds.length) : null;
        const right = reads.filter(Boolean).length;
        const tip = avg != null && avg < 70
          ? 'Tip: set Open and Close first (they make the body), then stretch High and Low out to the wick tips.'
          : reads.length && right / reads.length < 0.7
            ? 'Tip: read a candle in three steps: colour (close versus open), the longer wick, then where it closed.'
            : 'Clean reading. Candlestick patterns are next: the same candles, read in context.';
        return h('div', { class: 'cbg-summary' },
          h('div', { class: 'stat' }, h('span', { class: 'stat__label' }, 'Builds'), h('span', { class: 'stat__value' }, avg == null ? '–' : `${avg}/100`), h('small', { class: 'faint' }, `average over ${builds.length} build${builds.length === 1 ? '' : 's'}`)),
          h('div', { class: 'stat' }, h('span', { class: 'stat__label' }, 'Reads'), h('span', { class: 'stat__value' }, `${right}/${reads.length}`), h('small', { class: 'faint' }, 'stories matched')),
          h('p', null, tip));
      },
    });
    return () => {
      game.destroy();
      style.remove();
      root.classList.remove('candle-builder');
    };
  },
};

// Node-side checks (tests / sweeps): round planning is pure and deterministic for a given run rng.
export const __test = { typeOf, planBuild, planRead, shapeChecks, exampleIn, numericDistractors, shapeDistractors, contextSeries };
