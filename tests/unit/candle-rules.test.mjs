// CANDLE_RULES (patterns.js): the real-market candlestick detectors must find every generated
// textbook scenario at its pattern index, stay quiet on random noise, and cope with the quirks
// of real candles (any price scale, gaps, flat and zero-volume candles, junk values).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANDLE_RULES, CANDLE_PATTERNS, CANDLE_PATTERN_IDS, CANDLE_THRESHOLDS, candleScenario, contextTrend, typicalRange,
  candleConfirm, checkCandlePattern,
} from '../../js/core/patterns.js';
import { randomWalk, realisticMarket, trendSeries, scale } from '../../js/core/data.js';

// (An offline sweep of 211,200 scenarios — 300 seeds × 4 scales × 4 lead-ins × 2 outcomes — found
// every one; the suite keeps a fast sample.)
const SEEDS = Array.from({ length: 20 }, (_, i) => i * 104729 + 17);

test('thresholds are shared, frozen and used by check()', () => {
  assert.ok(Object.isFrozen(CANDLE_THRESHOLDS));
  assert.equal(CANDLE_THRESHOLDS.dojiBody, 0.08);
  const K = (o, h, l, c) => ({ o, h, l, c, v: 0, t: 0 });
  // Exactly at the doji threshold (body 8% of range) passes, just above fails.
  assert.equal(checkCandlePattern('doji', [K(100, 101, 99, 100.16)]), true);
  assert.equal(checkCandlePattern('doji', [K(100, 101, 99, 100.17)]), false);
  assert.deepEqual(Object.keys(CANDLE_RULES).sort(), [...CANDLE_PATTERN_IDS].sort());
});

test('every generated scenario is detected at its pattern index by its own rule', () => {
  for (const id of CANDLE_PATTERN_IDS) {
    const n = CANDLE_PATTERNS[id].candles;
    for (const seed of SEEDS) {
      for (const start of seed % 3 ? [100, 1.085] : [2500]) {
        for (const leadIn of [6, 12, 24]) {
          const sc = candleScenario(id, { seed, start, leadIn, after: 3, outcome: seed % 2 ? 'success' : 'fail' });
          const msg = `${id} seed ${seed} @${start} leadIn ${leadIn}`;
          assert.equal(sc.end - sc.start + 1, n);
          if (!CANDLE_RULES[id](sc.candles, sc.end)) assert.fail(`${msg}: not detected (trend ${contextTrend(sc.candles, sc.start)})`);
          // The explicit ctx gives the same answer as the default one.
          assert.equal(CANDLE_RULES[id](sc.candles, sc.end, { trend: contextTrend(sc.candles, sc.start), avgRange: typicalRange(sc.candles, sc.start) }), true, msg);
          // Detection only uses candles up to the pattern (no look-ahead).
          assert.equal(CANDLE_RULES[id](sc.candles.slice(0, sc.end + 1), sc.end), true, `${msg}: needs the future`);
        }
      }
    }
  }
});

test('same shape, other context: the twin rule stays quiet (hammer vs hanging man, …)', () => {
  const twins = [['hammer', 'hanging-man'], ['inverted-hammer', 'shooting-star'], ['bullish-marubozu', 'bearish-marubozu']];
  for (const [a, b] of twins) {
    for (const seed of SEEDS) {
      const sa = candleScenario(a, { seed, leadIn: 14 });
      const sb = candleScenario(b, { seed, leadIn: 14 });
      assert.equal(CANDLE_RULES[b](sa.candles, sa.end), false, `${b} fires on a ${a} (seed ${seed})`);
      assert.equal(CANDLE_RULES[a](sb.candles, sb.end), false, `${a} fires on a ${b} (seed ${seed})`);
    }
  }
});

test('low false-positive rate on random-walk noise (rates per pattern reported)', (t) => {
  const hits = Object.fromEntries(CANDLE_PATTERN_IDS.map((id) => [id, 0]));
  let bars = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const cs = randomWalk({ seed, count: 400, start: [100, 1.085, 25000][seed % 3] });
    bars += cs.length;
    for (const id of CANDLE_PATTERN_IDS) for (let i = 0; i < cs.length; i++) if (CANDLE_RULES[id](cs, i)) hits[id]++;
  }
  const rates = Object.fromEntries(CANDLE_PATTERN_IDS.map((id) => [id, hits[id] / bars]));
  t.diagnostic(`rule hits per candle on noise (${bars} candles): ${CANDLE_PATTERN_IDS.map((id) => `${id} ${(rates[id] * 100).toFixed(2)}%`).join(', ')}`);
  for (const id of CANDLE_PATTERN_IDS) {
    const neutral = CANDLE_PATTERNS[id].bias === 'neutral';
    // Doji and spinning tops really are common; directional signals in context are not.
    const bound = neutral ? 0.12 : 0.012;
    assert.ok(rates[id] <= bound, `${id}: ${(rates[id] * 100).toFixed(2)}% of noise candles (bound ${bound * 100}%)`);
  }
  const directional = CANDLE_PATTERN_IDS.filter((id) => CANDLE_PATTERNS[id].bias !== 'neutral').reduce((s, id) => s + rates[id], 0);
  assert.ok(directional < 0.05, `directional signals on ${(directional * 100).toFixed(1)}% of noise candles`);
});

test('real-candle quirks: price scale invariance, flat / zero-volume candles, junk values', () => {
  for (const seed of [3, 4, 5]) {
    const cs = realisticMarket({ seed, count: 300 });
    for (const f of [1e-4, 1e4]) {
      const sc = scale(cs, f);
      for (const id of CANDLE_PATTERN_IDS) {
        for (let i = 0; i < cs.length; i += 1) {
          if (CANDLE_RULES[id](cs, i) !== CANDLE_RULES[id](sc, i)) {
            // Only tweezers compare absolute distances with 0.1% of price, which is scale-free too.
            assert.fail(`${id} at ${i} depends on the price scale (×${f})`);
          }
        }
      }
    }
  }
  // Flat market (h = l, zero volume, as an exchange reports for intervals without trades).
  const flat = Array.from({ length: 40 }, (_, t) => ({ o: 50, h: 50, l: 50, c: 50, v: 0, t }));
  for (const id of CANDLE_PATTERN_IDS) for (let i = 0; i < flat.length; i++) assert.equal(CANDLE_RULES[id](flat, i), false, `${id} on a flat market`);
  // Junk: NaN, null, out-of-range indexes never throw.
  const junk = [...flat.slice(0, 10), null, { o: NaN, h: 1, l: 1, c: 1 }, ...flat.slice(0, 10)];
  for (const id of CANDLE_PATTERN_IDS) {
    for (const i of [-1, 0, 5, 10, 11, 12, 21, 99, 2.5]) assert.equal(CANDLE_RULES[id](junk, i), false);
    assert.equal(CANDLE_RULES[id](null, 3), false);
  }
  // A 24/7 market: opens exactly at the prior close — engulfing still counts.
  const hs = candleScenario('bullish-engulfing', { seed: 11, leadIn: 12 });
  const cs = hs.candles.map((k) => ({ ...k }));
  const b = cs[hs.end];
  b.o = cs[hs.end - 1].c;
  b.l = Math.min(b.l, b.o);
  assert.equal(CANDLE_RULES['bullish-engulfing'](cs, hs.end), true, 'engulfing that opens at the prior close');
});

test('contextTrend and typicalRange', () => {
  const up = trendSeries({ seed: 2, direction: 'up', count: 80 }).candles;
  const down = trendSeries({ seed: 2, direction: 'down', count: 80 }).candles;
  const ups = [];
  const downs = [];
  for (let i = 20; i < 80; i += 5) {
    ups.push(contextTrend(up, i, 30));
    downs.push(contextTrend(down, i, 30));
  }
  assert.ok(ups.filter((x) => x === 'up').length >= ups.length * 0.7, ups.join(','));
  assert.ok(downs.filter((x) => x === 'down').length >= downs.length * 0.7, downs.join(','));
  assert.equal(contextTrend(up, 3), 'range', 'too little history');
  const flat = Array.from({ length: 20 }, (_, t) => ({ o: 10, h: 10.1, l: 9.9, c: 10, v: 1, t }));
  assert.equal(contextTrend(flat, 20), 'range');
  assert.ok(Math.abs(typicalRange(flat, 20) - 0.2) < 1e-9);
  assert.equal(typicalRange(flat, 0), 0);
});

test('candleConfirm returns the scenario confirmation level', () => {
  for (const id of CANDLE_PATTERN_IDS) {
    const sc = candleScenario(id, { seed: 21, after: 2 });
    const pat = sc.candles.slice(sc.start, sc.end + 1);
    assert.equal(candleConfirm(id, pat, sc.direction), sc.confirm, id);
  }
  assert.equal(candleConfirm('nope', [], 1), null);
});
