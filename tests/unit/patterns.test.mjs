import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANDLE_PATTERNS, CANDLE_PATTERN_IDS, candleScenario, checkCandlePattern, findCandlePatterns, trendBefore } from '../../js/core/patterns.js';
import { isValidCandle } from '../../js/core/data.js';
import { makeRng } from '../../js/core/rng.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 104729 + 3);
const REQUIRED = [
  'doji', 'dragonfly-doji', 'gravestone-doji', 'spinning-top', 'bullish-marubozu', 'bearish-marubozu', 'hammer',
  'inverted-hammer', 'hanging-man', 'shooting-star', 'bullish-engulfing', 'bearish-engulfing', 'bullish-harami',
  'bearish-harami', 'piercing-line', 'dark-cloud-cover', 'tweezer-top', 'tweezer-bottom', 'morning-star', 'evening-star',
  'three-white-soldiers', 'three-black-crows',
];

// Independent restatement of the textbook (Nison) definitions.
const body = (k) => Math.abs(k.c - k.o);
const rng_ = (k) => k.h - k.l;
const up = (k) => k.h - Math.max(k.o, k.c);
const low = (k) => Math.min(k.o, k.c) - k.l;
const bull = (k) => k.c > k.o;
const bear = (k) => k.c < k.o;
const midpt = (k) => (k.o + k.c) / 2;
const long = (k) => body(k) >= 0.6 * rng_(k);
const doji = (k) => body(k) <= 0.08 * rng_(k);

const RULES = {
  doji: ([a]) => doji(a),
  'dragonfly-doji': ([a]) => doji(a) && up(a) <= 0.08 * rng_(a) && low(a) >= 0.6 * rng_(a),
  'gravestone-doji': ([a]) => doji(a) && low(a) <= 0.08 * rng_(a) && up(a) >= 0.6 * rng_(a),
  'spinning-top': ([a]) => body(a) >= 0.1 * rng_(a) && body(a) <= 0.3 * rng_(a) && up(a) > body(a) && low(a) > body(a),
  'bullish-marubozu': ([a]) => bull(a) && body(a) >= 0.9 * rng_(a),
  'bearish-marubozu': ([a]) => bear(a) && body(a) >= 0.9 * rng_(a),
  hammer: ([a]) => low(a) >= 2 * body(a) && up(a) <= 0.1 * rng_(a),
  'hanging-man': ([a]) => low(a) >= 2 * body(a) && up(a) <= 0.1 * rng_(a),
  'inverted-hammer': ([a]) => up(a) >= 2 * body(a) && low(a) <= 0.1 * rng_(a),
  'shooting-star': ([a]) => up(a) >= 2 * body(a) && low(a) <= 0.1 * rng_(a),
  'bullish-engulfing': ([a, b]) => bear(a) && bull(b) && b.o < a.c && b.c > a.o,
  'bearish-engulfing': ([a, b]) => bull(a) && bear(b) && b.o > a.c && b.c < a.o,
  'bullish-harami': ([a, b]) => bear(a) && long(a) && bull(b) && b.o > a.c && b.c < a.o,
  'bearish-harami': ([a, b]) => bull(a) && long(a) && bear(b) && b.o < a.c && b.c > a.o,
  'piercing-line': ([a, b]) => bear(a) && long(a) && bull(b) && b.o < a.c && b.c > midpt(a) && b.c < a.o,
  'dark-cloud-cover': ([a, b]) => bull(a) && long(a) && bear(b) && b.o > a.c && b.c < midpt(a) && b.c > a.o,
  'tweezer-top': ([a, b]) => bull(a) && bear(b) && Math.abs(a.h - b.h) <= 0.001 * a.h,
  'tweezer-bottom': ([a, b]) => bear(a) && bull(b) && Math.abs(a.l - b.l) <= 0.001 * a.l,
  'morning-star': ([a, b, c]) => bear(a) && long(a) && body(b) < body(a) * 0.35 && Math.max(b.o, b.c) < a.c && bull(c) && long(c) && c.c > midpt(a),
  'evening-star': ([a, b, c]) => bull(a) && long(a) && body(b) < body(a) * 0.35 && Math.min(b.o, b.c) > a.c && bear(c) && long(c) && c.c < midpt(a),
  'three-white-soldiers': (cs) =>
    cs.every((k) => bull(k) && long(k) && up(k) <= 0.15 * rng_(k)) &&
    [1, 2].every((i) => cs[i].o > cs[i - 1].o && cs[i].o < cs[i - 1].c && cs[i].c > cs[i - 1].c),
  'three-black-crows': (cs) =>
    cs.every((k) => bear(k) && long(k) && low(k) <= 0.15 * rng_(k)) &&
    [1, 2].every((i) => cs[i].o < cs[i - 1].o && cs[i].o > cs[i - 1].c && cs[i].c < cs[i - 1].c),
};

test('every required candle pattern exists with complete, sensible metadata', () => {
  assert.deepEqual([...CANDLE_PATTERN_IDS].sort(), [...REQUIRED].sort());
  for (const id of REQUIRED) {
    const p = CANDLE_PATTERNS[id];
    assert.equal(p.id, id);
    assert.ok(p.name && p.summary && p.psychology && p.howToTrade, id);
    assert.ok([1, 2, 3].includes(p.candles));
    assert.ok(['bullish', 'bearish', 'neutral'].includes(p.bias));
    assert.ok(['reversal', 'continuation', 'indecision'].includes(p.kind));
    assert.ok(['downtrend', 'uptrend', 'any'].includes(p.context));
    assert.ok([1, 2, 3].includes(p.reliability));
    if (p.kind === 'reversal') assert.equal(p.context, p.bias === 'bullish' ? 'downtrend' : 'uptrend', `${id} context`);
    if (p.kind === 'continuation') assert.equal(p.context, p.bias === 'bullish' ? 'uptrend' : 'downtrend', `${id} context`);
    if (p.bias === 'neutral') assert.equal(p.context, 'any');
  }
});

test('generators satisfy the textbook definitions for 200 seeds (and FX-scale prices)', () => {
  for (const id of REQUIRED) {
    const p = CANDLE_PATTERNS[id];
    for (const seed of SEEDS) {
      for (const [price, range] of [[100, 1.5], [1.085, 0.0022], [25000, 400]]) {
        const cs = p.generate(makeRng(seed), { price, range });
        assert.equal(cs.length, p.candles, id);
        cs.forEach((k) => assert.ok(isValidCandle(k), `${id} invalid candle seed ${seed}`));
        assert.ok(RULES[id](cs), `${id} fails its definition (seed ${seed}, price ${price}): ${JSON.stringify(cs)}`);
        assert.ok(p.check(cs), `${id}.check (seed ${seed})`);
        assert.ok(Math.abs(cs[0].o - price) < range * 0.3, `${id} opens near the previous close`);
      }
    }
  }
});

test('hammer vs hanging man / inverted hammer vs shooting star differ only by context', () => {
  assert.equal(CANDLE_PATTERNS.hammer.context, 'downtrend');
  assert.equal(CANDLE_PATTERNS['hanging-man'].context, 'uptrend');
  assert.equal(CANDLE_PATTERNS['inverted-hammer'].context, 'downtrend');
  assert.equal(CANDLE_PATTERNS['shooting-star'].context, 'uptrend');
});

test('candleScenario: lead-in matches context, pattern embedded intact (200 seeds each)', () => {
  for (const id of REQUIRED) {
    const p = CANDLE_PATTERNS[id];
    for (const seed of SEEDS) {
      const sc = candleScenario(id, { seed, leadIn: 14, after: 0 });
      assert.equal(sc.candles.length, 14 + p.candles);
      assert.equal(sc.start, 14);
      assert.equal(sc.end, 14 + p.candles - 1);
      sc.candles.forEach((k, i) => {
        assert.ok(isValidCandle(k), `${id} seed ${seed} candle ${i}`);
        assert.equal(k.t, i);
        assert.ok(k.v > 0);
      });
      const pat = sc.candles.slice(sc.start, sc.end + 1);
      assert.ok(RULES[id](pat), `${id} (seed ${seed}) broken inside scenario`);
      const tr = trendBefore(sc.candles, sc.start, 10);
      if (p.context === 'downtrend') assert.equal(tr, 'down', `${id} seed ${seed} needs a downtrend lead-in`);
      if (p.context === 'uptrend') assert.equal(tr, 'up', `${id} seed ${seed} needs an uptrend lead-in`);
      // Bullish reversals print at (or near) the low of the move; bearish ones near the high.
      const leadLow = Math.min(...sc.candles.slice(0, sc.start).map((k) => k.l));
      const leadHigh = Math.max(...sc.candles.slice(0, sc.start).map((k) => k.h));
      const patLow = Math.min(...pat.map((k) => k.l));
      const patHigh = Math.max(...pat.map((k) => k.h));
      const span = leadHigh - leadLow;
      if (p.kind === 'reversal' && p.bias === 'bullish') assert.ok(patLow < leadLow + span * 0.2, `${id} seed ${seed} not at the lows`);
      if (p.kind === 'reversal' && p.bias === 'bearish') assert.ok(patHigh > leadHigh - span * 0.2, `${id} seed ${seed} not at the highs`);
    }
  }
});

test('candleScenario: outcome success follows the bias, fail goes against it', () => {
  for (const id of REQUIRED) {
    const p = CANDLE_PATTERNS[id];
    if (p.bias === 'neutral') continue;
    const dir = p.bias === 'bullish' ? 1 : -1;
    for (const seed of SEEDS.slice(0, 100)) {
      const ok = candleScenario(id, { seed, after: 6 });
      const last = ok.candles[ok.candles.length - 1].c;
      const patEnd = ok.candles[ok.end].c;
      assert.equal(ok.outcome, 'success');
      assert.ok((last - patEnd) * dir > 0, `${id} success moves with bias (seed ${seed})`);
      assert.ok((ok.candles[ok.end + 1].c - patEnd) * dir > 0, `${id} first candle confirms (seed ${seed})`);
      const bad = candleScenario(id, { seed, after: 6, outcome: 'fail' });
      assert.equal(bad.outcome, 'fail');
      const pat = bad.candles.slice(bad.start, bad.end + 1);
      const lastB = bad.candles[bad.candles.length - 1].c;
      if (dir > 0) assert.ok(lastB < Math.min(...pat.map((k) => k.l)), `${id} fail breaks the pattern low (seed ${seed})`);
      else assert.ok(lastB > Math.max(...pat.map((k) => k.h)), `${id} fail breaks the pattern high (seed ${seed})`);
      bad.candles.forEach((k) => assert.ok(isValidCandle(k)));
    }
  }
});

test('candleScenario: deterministic, respects start price and leadIn = 0', () => {
  assert.deepEqual(candleScenario('hammer', { seed: 9, after: 3 }), candleScenario('hammer', { seed: 9, after: 3 }));
  const sc = candleScenario('morning-star', { seed: 2, leadIn: 0, start: 1.085 });
  assert.equal(sc.start, 0);
  assert.equal(sc.candles.length, 3);
  assert.ok(Math.abs(sc.candles[0].o - 1.085) < 0.01);
  const fx = candleScenario('bearish-engulfing', { seed: 2, start: 1.085, after: 4 });
  assert.ok(fx.candles.every(isValidCandle));
  assert.ok(Math.abs(fx.candles[0].c - 1.085) < 0.005);
  assert.throws(() => candleScenario('nope', { seed: 1 }));
});

test('findCandlePatterns finds the generated pattern in context', () => {
  let found = 0;
  let total = 0;
  for (const id of REQUIRED) {
    for (const seed of SEEDS.slice(0, 30)) {
      const sc = candleScenario(id, { seed, leadIn: 14 });
      total++;
      if (findCandlePatterns(sc.candles, { ids: [id] }).some((m) => m.start === sc.start && m.end === sc.end)) found++;
    }
  }
  assert.ok(found / total > 0.97, `found ${found}/${total}`);
  assert.equal(checkCandlePattern('doji', [{ o: 1, h: 2, l: 0, c: 1.01 }]), true);
  assert.equal(checkCandlePattern('doji', [{ o: 1, h: 2, l: 0, c: 1.5 }]), false);
});
