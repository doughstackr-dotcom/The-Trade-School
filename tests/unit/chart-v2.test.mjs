// Pure helpers added to js/core/chart.js for engine v2 (log ticks, Heikin-Ashi, chart types) and
// the module's node-safety. DOM behaviour (viewport, pan / pinch, story) is covered by Playwright
// checks against #dev-chart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logTicks, niceTicks, heikinAshiCandles, CHART_TYPES } from '../../js/core/chart.js';
import { heikinAshi } from '../../js/core/indicators.js';
import { realisticMarket, isValidCandle } from '../../js/core/data.js';

test('logTicks: decades with 1-2-5 style steps, never more than asked', () => {
  const a = logTicks(30, 300, 8);
  assert.deepEqual(a.ticks, [30, 50, 70, 100, 150, 200, 300]);
  const b = logTicks(150, 90000, 6);
  assert.ok(b.ticks.length >= 2 && b.ticks.length <= 6, JSON.stringify(b.ticks));
  for (const v of b.ticks) {
    assert.ok(v >= 150 && v <= 90000);
    assert.ok([1, 2, 3, 5].includes(+String(v).replace(/0+$/, '').replace(/^0\.0*/, '').slice(0, 1)), `${v}`);
  }
  // Very long ranges thin out to fit.
  const c = logTicks(0.001, 1e6, 5);
  assert.ok(c.ticks.length <= 5 && c.ticks.length >= 2, JSON.stringify(c.ticks));
  // Less than a decade: the linear nice ticks.
  assert.deepEqual(logTicks(100, 130, 4), niceTicks(100, 130, 4));
  assert.deepEqual(logTicks(0, 10).ticks, []);
  assert.deepEqual(logTicks(-5, 10).ticks, []);
});

test('heikinAshiCandles matches indicators.heikinAshi and stays valid', () => {
  const cs = realisticMarket({ seed: 8, count: 400 });
  assert.deepEqual(heikinAshiCandles(cs), heikinAshi(cs));
  assert.ok(heikinAshiCandles(cs).every(isValidCandle));
  assert.deepEqual(heikinAshiCandles([]), []);
});

test('chart types list', () => {
  assert.deepEqual(CHART_TYPES, ['candles', 'ohlc', 'line', 'heikin-ashi']);
});
