// chart.js must be importable without a DOM; its pure helpers are tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceStep, niceTicks, colorOf, CandleChart, miniChart, candleSVG } from '../../js/core/chart.js';

test('chart.js imports in node without touching the DOM', () => {
  assert.equal(typeof CandleChart, 'function');
  assert.equal(typeof miniChart, 'function');
  assert.equal(typeof candleSVG, 'function');
});

test('niceStep returns 1 / 2 / 5 × 10^n', () => {
  const cases = [[0.7, 1], [1, 1], [1.2, 2], [2, 2], [2.1, 5], [4.9, 5], [5.1, 10], [0.013, 0.02], [0.0004, 0.0005], [73, 100], [1800, 2000]];
  for (const [raw, want] of cases) assert.ok(Math.abs(niceStep(raw) - want) < want * 1e-9, `${raw} → ${niceStep(raw)}`);
  assert.equal(niceStep(0), 1);
  assert.equal(niceStep(NaN), 1);
});

test('niceTicks: evenly spaced, inside the range, clean decimals', () => {
  const { step, ticks } = niceTicks(97.3, 112.8, 8);
  assert.equal(step, 2);
  assert.deepEqual(ticks, [98, 100, 102, 104, 106, 108, 110, 112]);
  const fx = niceTicks(1.0812, 1.0907, 5);
  assert.equal(fx.step, 0.002);
  assert.deepEqual(fx.ticks, [1.082, 1.084, 1.086, 1.088, 1.09]);
  for (const t of fx.ticks) assert.equal(String(t).length <= 5, true, `no float noise: ${t}`);
  assert.deepEqual(niceTicks(5, 5).ticks, []);
  for (const [a, b] of [[0, 1], [-3, 7], [1000, 1400], [0.1, 0.35]]) {
    const r = niceTicks(a, b, 6);
    assert.ok(r.ticks.length >= 2 && r.ticks.length <= 7, `${a}..${b}: ${r.ticks}`);
    assert.ok(r.ticks.every((t) => t >= a - 1e-9 && t <= b + 1e-9));
  }
});

test('colorOf maps token names to CSS variables and passes literals through', () => {
  assert.equal(colorOf('bull'), 'var(--bull)');
  assert.equal(colorOf('ma2'), 'var(--ma2)');
  assert.equal(colorOf('support'), 'var(--support)');
  assert.equal(colorOf('#ff0000'), '#ff0000');
  assert.equal(colorOf('rgb(1, 2, 3)'), 'rgb(1, 2, 3)');
  assert.equal(colorOf(undefined, 'info'), 'var(--info)');
});
