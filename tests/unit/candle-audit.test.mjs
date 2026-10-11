// Adversarial checks for the candlestick side of js/core/patterns.js: textbook geometry for
// 500 seeds at four price scales, no accidental double meanings, and scenarios whose lead-in,
// pattern, confirmation and outcome all tell the story a trader expects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANDLE_PATTERNS, CANDLE_PATTERN_IDS, candleScenario, findCandlePatterns, checkCandlePattern } from '../../js/core/patterns.js';
import { linearRegression } from '../../js/core/indicators.js';
import { makeRng } from '../../js/core/rng.js';
import { randomWalk } from '../../js/core/data.js';

// Independent restatement of the textbook (Nison) rules, a little stricter than check().
const body = (k) => Math.abs(k.c - k.o);
const rng_ = (k) => k.h - k.l;
const up = (k) => k.h - Math.max(k.o, k.c);
const low = (k) => Math.min(k.o, k.c) - k.l;
const bull = (k) => k.c > k.o;
const bear = (k) => k.c < k.o;
const midpt = (k) => (k.o + k.c) / 2;
const long = (k) => body(k) >= 0.6 * rng_(k);
const doji = (k) => body(k) <= 0.08 * rng_(k);
const small = (k) => body(k) <= 0.35 * rng_(k);

const RULES = {
  doji: ([a]) => doji(a) && up(a) >= 0.2 * rng_(a) && low(a) >= 0.2 * rng_(a),
  'dragonfly-doji': ([a]) => doji(a) && up(a) <= 0.08 * rng_(a) && low(a) >= 0.6 * rng_(a),
  'gravestone-doji': ([a]) => doji(a) && low(a) <= 0.08 * rng_(a) && up(a) >= 0.6 * rng_(a),
  'spinning-top': ([a]) => body(a) >= 0.1 * rng_(a) && body(a) <= 0.3 * rng_(a) && up(a) > body(a) && low(a) > body(a),
  'bullish-marubozu': ([a]) => bull(a) && body(a) >= 0.9 * rng_(a),
  'bearish-marubozu': ([a]) => bear(a) && body(a) >= 0.9 * rng_(a),
  hammer: ([a]) => small(a) && body(a) > 0 && low(a) >= 2 * body(a) && up(a) <= 0.1 * rng_(a),
  'hanging-man': ([a]) => small(a) && body(a) > 0 && low(a) >= 2 * body(a) && up(a) <= 0.1 * rng_(a),
  'inverted-hammer': ([a]) => small(a) && body(a) > 0 && up(a) >= 2 * body(a) && low(a) <= 0.1 * rng_(a),
  'shooting-star': ([a]) => small(a) && body(a) > 0 && up(a) >= 2 * body(a) && low(a) <= 0.1 * rng_(a),
  'bullish-engulfing': ([a, b]) => bear(a) && bull(b) && b.o < a.c && b.c > a.o && body(a) > 0.25 * rng_(a),
  'bearish-engulfing': ([a, b]) => bull(a) && bear(b) && b.o > a.c && b.c < a.o && body(a) > 0.25 * rng_(a),
  'bullish-harami': ([a, b]) => bear(a) && long(a) && bull(b) && b.l > a.c && b.h < a.o,
  'bearish-harami': ([a, b]) => bull(a) && long(a) && bear(b) && b.h < a.c && b.l > a.o,
  'piercing-line': ([a, b]) => bear(a) && long(a) && bull(b) && b.o < a.l && b.c > midpt(a) && b.c < a.o,
  'dark-cloud-cover': ([a, b]) => bull(a) && long(a) && bear(b) && b.o > a.h && b.c < midpt(a) && b.c > a.o,
  'tweezer-top': ([a, b]) => bull(a) && bear(b) && Math.abs(a.h - b.h) <= Math.min(0.001 * a.h, 0.04 * Math.max(rng_(a), rng_(b))),
  'tweezer-bottom': ([a, b]) => bear(a) && bull(b) && Math.abs(a.l - b.l) <= Math.min(0.001 * a.l, 0.04 * Math.max(rng_(a), rng_(b))),
  'morning-star': ([a, b, c]) =>
    bear(a) && long(a) && body(b) < body(a) * 0.35 && Math.max(b.o, b.c) < a.c && bull(c) && long(c) && c.o > Math.max(b.o, b.c) && c.c > midpt(a),
  'evening-star': ([a, b, c]) =>
    bull(a) && long(a) && body(b) < body(a) * 0.35 && Math.min(b.o, b.c) > a.c && bear(c) && long(c) && c.o < Math.min(b.o, b.c) && c.c < midpt(a),
  'three-white-soldiers': (cs) =>
    cs.every((k) => bull(k) && long(k) && up(k) <= 0.15 * rng_(k)) &&
    [1, 2].every((i) => cs[i].o > cs[i - 1].o && cs[i].o < cs[i - 1].c && cs[i].c > cs[i - 1].c),
  'three-black-crows': (cs) =>
    cs.every((k) => bear(k) && long(k) && low(k) <= 0.15 * rng_(k)) &&
    [1, 2].every((i) => cs[i].o < cs[i - 1].o && cs[i].o > cs[i - 1].c && cs[i].c < cs[i - 1].c),
};

// Pairs that must never both describe the same generated candles (a quiz would have two
// right answers). Hammer/hanging man and inverted hammer/shooting star are the same shape and
// differ only by context, so they are not listed.
const DISJOINT = [
  ['bullish-engulfing', 'tweezer-bottom'], ['bearish-engulfing', 'tweezer-top'],
  ['bullish-harami', 'tweezer-bottom'], ['bearish-harami', 'tweezer-top'],
  ['piercing-line', 'tweezer-bottom'], ['dark-cloud-cover', 'tweezer-top'],
  ['tweezer-bottom', 'bullish-harami'], ['tweezer-bottom', 'piercing-line'], ['tweezer-bottom', 'bullish-engulfing'],
  ['tweezer-top', 'bearish-harami'], ['tweezer-top', 'dark-cloud-cover'], ['tweezer-top', 'bearish-engulfing'],
  ['doji', 'spinning-top'], ['spinning-top', 'doji'], ['hammer', 'spinning-top'], ['shooting-star', 'spinning-top'],
  ['hammer', 'dragonfly-doji'], ['shooting-star', 'gravestone-doji'], ['morning-star', 'tweezer-bottom'], ['evening-star', 'tweezer-top'],
];

const SCALES = [
  [1.085, 0.0013],
  [25, 0.3],
  [100, 1.3],
  [2500, 30],
];

test('generators: textbook geometry for 500 seeds at FX, 25, 100 and 2500 price scales', () => {
  for (const id of CANDLE_PATTERN_IDS) {
    const p = CANDLE_PATTERNS[id];
    for (let seed = 1; seed <= 500; seed++) {
      for (const [price, range] of SCALES) {
        const cs = p.generate(makeRng(seed * 31 + 7), { price, range });
        const msg = `${id} seed ${seed} @${price}`;
        assert.equal(cs.length, p.candles, msg);
        for (const [i, k] of cs.entries()) {
          if (!(k.l <= Math.min(k.o, k.c) && Math.max(k.o, k.c) <= k.h && k.l > 0 && [k.o, k.h, k.l, k.c].every(Number.isFinite))) {
            assert.fail(`${msg}: invalid candle ${JSON.stringify(k)}`);
          }
          assert.equal(k.t, i);
        }
        if (!RULES[id](cs)) assert.fail(`${msg} breaks the textbook rule: ${JSON.stringify(cs)}`);
        if (!p.check(cs) || !checkCandlePattern(id, cs)) assert.fail(`${msg}: own check() rejects it`);
        if (!(Math.abs(cs[0].o - price) <= 0.3 * range)) assert.fail(`${msg}: first open far from the previous close`);
        for (const [a, b] of DISJOINT) {
          if (a !== id) continue;
          const q = CANDLE_PATTERNS[b];
          if (q.candles <= cs.length && q.check(cs.slice(-q.candles)) && q.candles === p.candles) assert.fail(`${msg} is also a ${b}`);
        }
      }
    }
  }
});

test('check(): rejects near misses', () => {
  const K = (o, h, l, c) => ({ o, h, l, c, v: 0, t: 0 });
  assert.equal(checkCandlePattern('doji', [K(100, 101, 99, 100.1)]), true);
  assert.equal(checkCandlePattern('doji', [K(100, 101, 99, 100.5)]), false);
  assert.equal(checkCandlePattern('hammer', [K(100, 100.1, 97, 100.6)]), true);
  assert.equal(checkCandlePattern('hammer', [K(100, 101.2, 97, 100.6)]), false, 'upper wick too long');
  assert.equal(checkCandlePattern('bullish-engulfing', [K(101, 101.2, 99.8, 100), K(99.9, 101.3, 99.7, 101.2)]), true);
  assert.equal(checkCandlePattern('bullish-engulfing', [K(101, 101.2, 99.8, 100), K(100.1, 101.3, 99.7, 101.2)]), false, 'opens inside the body');
  // Tweezers: 0.1% of price is too loose at FX scale — the tolerance is also capped at 4% of range.
  const fxA = K(1.0860, 1.0864, 1.0848, 1.0850);
  assert.equal(checkCandlePattern('tweezer-bottom', [fxA, K(1.0851, 1.0866, 1.0848, 1.0865)]), true);
  assert.equal(checkCandlePattern('tweezer-bottom', [fxA, K(1.0851, 1.0866, 1.0845, 1.0865)]), false, '3 pips apart is not the same low');
  assert.equal(checkCandlePattern('nope', [fxA]), false);
  assert.equal(checkCandlePattern('morning-star', [fxA]), false, 'too few candles');
});

const SEEDS = Array.from({ length: 120 }, (_, i) => i * 7919 + 13);
const lowOf = (cs) => Math.min(...cs.map((k) => k.l));
const highOf = (cs) => Math.max(...cs.map((k) => k.h));

test('candleScenario: context-true lead-in, pattern at the extreme, one unambiguous signal', () => {
  for (const id of CANDLE_PATTERN_IDS) {
    const p = CANDLE_PATTERNS[id];
    for (const seed of SEEDS) {
      for (const start of [100, 1.085]) {
        const sc = candleScenario(id, { seed, leadIn: 14, after: 6, start });
        const msg = `${id} seed ${seed} @${start}`;
        const cs = sc.candles;
        assert.equal(cs.length, 14 + p.candles + 6, msg);
        assert.equal(sc.start, 14);
        assert.equal(sc.end, 14 + p.candles - 1);
        cs.forEach((k, i) => {
          assert.ok(k.l <= Math.min(k.o, k.c) && Math.max(k.o, k.c) <= k.h && k.l > 0, `${msg} candle ${i}`);
          assert.ok(k.v >= 1 && k.t === i);
        });
        const lead = cs.slice(0, sc.start);
        const pat = cs.slice(sc.start, sc.end + 1);
        assert.ok(RULES[id](pat), `${msg}: pattern broken inside the scenario`);
        // Lead-in direction by regression slope, measured in average candle ranges.
        const avgR = lead.reduce((s, k) => s + k.h - k.l, 0) / lead.length;
        const { slope } = linearRegression(lead.map((k) => k.c));
        const move = (slope * (lead.length - 1)) / avgR;
        if (p.context === 'downtrend') assert.ok(move < -2, `${msg}: lead-in not a downtrend (${move.toFixed(2)})`);
        if (p.context === 'uptrend') assert.ok(move > 2, `${msg}: lead-in not an uptrend (${move.toFixed(2)})`);
        assert.equal(sc.trend, p.context === 'downtrend' ? 'down' : p.context === 'uptrend' ? 'up' : sc.trend);
        // Reversal patterns print the extreme of the move (soldiers / crows start from it).
        if (p.kind === 'reversal' && !id.startsWith('three-')) {
          if (p.bias === 'bullish') assert.ok(lowOf(pat) < lowOf(lead), `${msg}: not at the low`);
          else assert.ok(highOf(pat) > highOf(lead), `${msg}: not at the high`);
        }
        if (id.startsWith('three-')) {
          if (p.bias === 'bullish') assert.ok(lowOf(pat) < lowOf(lead) + avgR, `${msg}: soldiers not from the low`);
          else assert.ok(highOf(pat) > highOf(lead) - avgR, `${msg}: crows not from the high`);
        }
        // Exactly one answer: no second instance, no earlier same-direction reversal signal,
        // nothing else ending on (or straddling into) the pattern.
        for (const m of findCandlePatterns(cs.slice(0, sc.end + 1), { context: true })) {
          const q = CANDLE_PATTERNS[m.id];
          if (m.id === id) assert.equal(m.start, sc.start, `${msg}: second ${id} at ${m.start}`);
          else if (q.bias !== 'neutral') {
            assert.ok(!(m.end >= sc.start && (m.start < sc.start || m.end === sc.end)), `${msg}: ${m.id} competes at ${m.start}-${m.end}`);
            if (m.end < sc.start && m.end >= sc.start - 12 && p.bias !== 'neutral' && q.kind === 'reversal') assert.notEqual(q.bias, p.bias, `${msg}: earlier ${m.id}`);
          }
        }
        assert.ok(findCandlePatterns(cs.slice(0, sc.end + 1), { ids: [id] }).some((m) => m.start === sc.start && m.end === sc.end), `${msg}: not found in context`);
      }
    }
  }
});

test('candleScenario: success is confirmed by the next candle, fail goes the other way', () => {
  for (const id of CANDLE_PATTERN_IDS) {
    const p = CANDLE_PATTERNS[id];
    for (const seed of SEEDS.slice(0, 80)) {
      const good = candleScenario(id, { seed, after: 6 });
      const bad = candleScenario(id, { seed, after: 6, outcome: 'fail' });
      const msg = `${id} seed ${seed}`;
      // Same setup for both outcomes: only the future differs.
      assert.deepEqual(good.candles.slice(0, good.end + 1).map(({ o, h, l, c }) => [o, h, l, c]), bad.candles.slice(0, bad.end + 1).map(({ o, h, l, c }) => [o, h, l, c]), `${msg}: setups differ`);
      const pat = good.candles.slice(good.start, good.end + 1);
      const last = pat[pat.length - 1];
      const d = good.direction;
      const f0 = good.candles[good.end + 1];
      assert.ok(Number.isFinite(good.confirm), msg);
      assert.ok((f0.c - good.confirm) * d > 0, `${msg}: first candle does not close beyond the confirmation level`);
      assert.ok((f0.c - f0.o) * d > 0, `${msg}: confirmation candle has the wrong colour`);
      assert.equal(f0.o, last.c, `${msg}: follow-through opens at the pattern close`);
      const endG = good.candles[good.candles.length - 1].c;
      assert.ok((endG - (d > 0 ? highOf(pat) : lowOf(pat))) * d > 0, `${msg}: success does not clear the pattern`);
      if (p.bias === 'neutral') continue;
      assert.equal(good.direction, p.bias === 'bullish' ? 1 : -1);
      assert.equal(bad.direction, -good.direction);
      const b0 = bad.candles[bad.end + 1];
      assert.ok((b0.c - last.c) * bad.direction > 0, `${msg}: fail's first candle does not go against the bias`);
      const endB = bad.candles[bad.candles.length - 1].c;
      assert.ok((endB - (bad.direction > 0 ? highOf(pat) : lowOf(pat))) * bad.direction > 0, `${msg}: fail does not break the pattern extreme`);
      // Volume tells the same story: strong on a real signal, weak on a failed one; a harami's
      // inside day is quiet.
      const prev = good.candles.slice(good.start - 8, good.start);
      const avg = prev.reduce((s, k) => s + k.v, 0) / prev.length;
      if (id.endsWith('harami')) assert.ok(good.candles[good.end].v <= avg, `${msg}: harami volume`);
      else assert.ok(good.candles[good.end].v >= 1.3 * avg, `${msg}: weak volume on a successful signal`);
      assert.ok(bad.candles[bad.end].v <= avg * 1.001, `${msg}: strong volume on a failed signal`);
    }
  }
});

test('candleScenario: deterministic, scales with start, handles leadIn 0 and after 1–2', () => {
  for (const id of CANDLE_PATTERN_IDS) {
    assert.deepEqual(candleScenario(id, { seed: 5, after: 4 }), candleScenario(id, { seed: 5, after: 4 }));
    const z = candleScenario(id, { seed: 3, leadIn: 0, after: 2, start: 1.085 });
    assert.equal(z.start, 0);
    assert.equal(z.candles.length, CANDLE_PATTERNS[id].candles + 2);
    assert.ok(z.candles.every((k) => k.l > 0 && k.l <= Math.min(k.o, k.c) && Math.max(k.o, k.c) <= k.h));
    assert.ok(Math.abs(z.candles[0].o - 1.085) < 0.005);
    const one = candleScenario(id, { seed: 3, after: 1 });
    assert.ok((one.candles[one.end + 1].c - one.confirm) * one.direction > 0, `${id}: after = 1 still confirms`);
  }
  // Different patterns with the same seed get different lead-ins (thumbnail grids look varied).
  const a = candleScenario('hammer', { seed: 9 }).candles.slice(0, 14);
  const b = candleScenario('morning-star', { seed: 9 }).candles.slice(0, 14);
  assert.notDeepEqual(a, b);
  assert.throws(() => candleScenario('nope', { seed: 1 }), /Unknown candle pattern/);
});

test('FX scenarios survive rounding to 4 decimals (pips) without losing their geometry', () => {
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  for (const id of CANDLE_PATTERN_IDS) {
    for (const seed of SEEDS.slice(0, 60)) {
      const sc = candleScenario(id, { seed, start: 1.085 });
      const pat = sc.candles.slice(sc.start, sc.end + 1).map((k) => ({ ...k, o: r4(k.o), h: r4(k.h), l: r4(k.l), c: r4(k.c) }));
      assert.ok(checkCandlePattern(id, pat), `${id} seed ${seed}: broken by rounding`);
    }
  }
});

test('scenario candles are valid for 1000 seeds (mixed patterns, outcomes, prices)', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const id = CANDLE_PATTERN_IDS[seed % CANDLE_PATTERN_IDS.length];
    const start = [100, 1.085, 25, 2500][seed % 4];
    const sc = candleScenario(id, { seed, start, after: seed % 9, leadIn: 6 + (seed % 20), outcome: seed % 3 ? 'success' : 'fail' });
    for (const k of sc.candles) {
      if (!(k.l > 0 && k.l <= Math.min(k.o, k.c) && Math.max(k.o, k.c) <= k.h && Number.isFinite(k.h) && k.v >= 1)) {
        assert.fail(`${id} seed ${seed}: invalid ${JSON.stringify(k)}`);
      }
    }
  }
});

test('findCandlePatterns on random data: every match satisfies its own geometry and context', () => {
  for (const seed of [1, 2, 3, 4]) {
    const cs = randomWalk({ seed, count: 300 });
    const found = findCandlePatterns(cs);
    assert.ok(found.length > 0);
    for (const m of found) {
      const p = CANDLE_PATTERNS[m.id];
      assert.equal(m.end - m.start + 1, p.candles);
      assert.ok(p.check(cs.slice(m.start, m.end + 1)));
    }
    // context: false finds a superset.
    assert.ok(findCandlePatterns(cs, { context: false }).length >= found.length);
  }
});
