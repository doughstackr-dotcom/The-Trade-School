import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../../js/core/indicators.js';
import { randomWalk, trendSeries, fromPath } from '../../js/core/data.js';

const close = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} expected ${b}, got ${a}`);
const ONE_TO_20 = Array.from({ length: 20 }, (_, i) => i + 1);
const K = (o, h, l, c, v = 100) => ({ o, h, l, c, v, t: 0 });

test('sma on 1..20', () => {
  const s = I.sma(ONE_TO_20, 5);
  assert.equal(s.length, 20);
  assert.deepEqual(s.slice(0, 4), [null, null, null, null]);
  assert.equal(s[4], 3);
  assert.equal(s[19], 18);
  assert.equal(I.sma(ONE_TO_20, 20)[19], 10.5);
  assert.equal(I.sma([1, null, 3, 4], 2)[2], null, 'window with a null is null');
  assert.equal(I.sma([1, null, 3, 4], 2)[3], 3.5);
});

test('ema: SMA seed, k = 2/(n+1), lags a straight line by (n−1)/2', () => {
  const e5 = I.ema(ONE_TO_20, 5);
  assert.deepEqual(e5.slice(0, 4), [null, null, null, null]);
  close(e5[4], 3); // seed = SMA of 1..5
  close(e5[5], 6 * (1 / 3) + 3 * (2 / 3)); // k = 2/6
  for (let i = 4; i < 20; i++) close(e5[i], i + 1 - 2, 1e-9, `ema5[${i}]`);
  const e10 = I.ema(ONE_TO_20, 10);
  close(e10[9], 5.5);
  close(e10[19], 15.5, 1e-9);
  // Leading nulls are skipped (EMA of a warm-up series).
  const e = I.ema([null, null, 2, 4, 6, 8], 2);
  assert.deepEqual(e.slice(0, 3), [null, null, null]);
  close(e[3], 3);
  close(e[4], 6 * (2 / 3) + 3 * (1 / 3));
});

test('rsi: Wilder smoothing reference values', () => {
  // Classic Wilder / StockCharts example series (14-period). Values match TA-Lib's unrounded
  // computation; StockCharts' spreadsheet (rounded intermediates) shows 70.53, 66.32, ….
  const px = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66, 43.13];
  const r = I.rsi(px, 14);
  assert.equal(r.length, px.length);
  assert.ok(r.slice(0, 14).every((v) => v === null));
  const expected = [70.46, 66.25, 66.48, 69.35, 66.29, 57.92, 62.88, 63.21, 56.01, 62.34, 54.67, 50.39, 40.02, 41.49, 41.9, 45.5, 37.32, 33.09, 37.79];
  expected.forEach((v, i) => close(r[14 + i], v, 0.006, `rsi[${14 + i}]`));
  const stockcharts = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38];
  stockcharts.forEach((v, i) => close(r[14 + i], v, 0.1, `vs StockCharts rsi[${14 + i}]`));
  // Hand-computed first value: avg gain / avg loss of the first 14 changes.
  let g = 0;
  let l = 0;
  for (let i = 1; i <= 14; i++) {
    const d = px[i] - px[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  close(r[14], 100 - 100 / (1 + g / l), 1e-9);
});

test('rsi edge cases: only gains → 100, flat → 50, bounded 0..100', () => {
  assert.equal(I.rsi(ONE_TO_20, 14)[19], 100);
  assert.equal(I.rsi(new Array(20).fill(5), 14)[19], 50);
  assert.equal(I.rsi([...ONE_TO_20].reverse(), 14)[19], 0);
  const cs = randomWalk({ seed: 4, count: 300 }).map((c) => c.c);
  assert.ok(I.rsi(cs).every((v) => v === null || (v >= 0 && v <= 100)));
});

test('macd: EMA12 − EMA26, signal EMA9, hist = macd − signal', () => {
  const cs = randomWalk({ seed: 11, count: 200 }).map((c) => c.c);
  const m = I.macd(cs);
  const e12 = I.ema(cs, 12);
  const e26 = I.ema(cs, 26);
  assert.equal(m.macd.findIndex((v) => v != null), 25);
  assert.equal(m.signal.findIndex((v) => v != null), 25 + 8);
  for (let i = 0; i < cs.length; i++) {
    if (m.macd[i] != null) close(m.macd[i], e12[i] - e26[i], 1e-12);
    if (m.hist[i] != null) close(m.hist[i], m.macd[i] - m.signal[i], 1e-12);
  }
  // Signal seed = SMA of the first 9 MACD values.
  const first9 = m.macd.slice(25, 34);
  close(m.signal[33], first9.reduce((s, v) => s + v, 0) / 9, 1e-12);
  // A steadily rising series has a positive MACD line.
  const up = I.macd(Array.from({ length: 60 }, (_, i) => 100 + i));
  assert.ok(up.macd[59] > 0);
});

test('bollinger: constant series collapses; population sd on 1..20', () => {
  const b = I.bollinger(new Array(30).fill(7), 20, 2);
  assert.equal(b.mid[29], 7);
  assert.equal(b.upper[29], 7);
  assert.equal(b.lower[29], 7);
  assert.equal(b.width[29], 0);
  assert.equal(b.mid[18], null);
  const b2 = I.bollinger(ONE_TO_20, 20, 2);
  const sd = Math.sqrt((20 * 20 - 1) / 12); // population sd of 1..n
  close(b2.mid[19], 10.5);
  close(b2.upper[19], 10.5 + 2 * sd, 1e-9);
  close(b2.lower[19], 10.5 - 2 * sd, 1e-9);
  close(b2.width[19], (4 * sd) / 10.5, 1e-9);
});

test('atr: Wilder smoothing of true range', () => {
  const cs = Array.from({ length: 20 }, (_, i) => K(100 + i, 101 + i, 99 + i, 100 + i));
  const a = I.atr(cs, 14);
  assert.equal(a[12], null);
  close(a[13], 2); // TR = high − low = 2 with no gaps
  close(a[19], 2);
  // Gap: TR uses the previous close.
  const tr = I.trueRange([K(10, 11, 9, 10), K(14, 15, 13.5, 14)]);
  assert.deepEqual(tr, [2, 5]);
  const b = I.atr([...cs.slice(0, 14), K(120, 130, 118, 125)], 14);
  close(b[14], (2 * 13 + Math.max(12, Math.abs(130 - 113), Math.abs(118 - 113))) / 14);
});

test('swings: pivot window and labelStructure', () => {
  const hs = [1, 2, 3, 6, 3, 2, 1, 2, 3, 4, 8, 4, 3, 2, 1];
  const cs = hs.map((h) => K(h - 0.5, h, h - 1, h - 0.4));
  const sw = I.swings(cs, { left: 3, right: 3 });
  const highs = sw.filter((s) => s.type === 'high');
  assert.deepEqual(highs.map((s) => s.idx), [3, 10]);
  assert.deepEqual(sw.filter((s) => s.type === 'low').map((s) => s.idx), [6]);
  assert.deepEqual(sw.map((s) => s.idx), [...sw.map((s) => s.idx)].sort((a, b) => a - b), 'ordered by idx');
  const lab = I.labelStructure([
    { idx: 1, price: 10, type: 'high' },
    { idx: 2, price: 5, type: 'low' },
    { idx: 3, price: 12, type: 'high' },
    { idx: 4, price: 7, type: 'low' },
    { idx: 5, price: 11, type: 'high' },
    { idx: 6, price: 4, type: 'low' },
  ]);
  assert.deepEqual(lab.map((s) => s.label), ['H', 'L', 'HH', 'HL', 'LH', 'LL']);
  // alternate merges same-type neighbours.
  const alt = I.swings(cs, { left: 1, right: 1, alternate: true });
  for (let i = 1; i < alt.length; i++) assert.notEqual(alt[i].type, alt[i - 1].type);
});

test('trendOf: up / down / range', () => {
  assert.equal(I.trendOf(trendSeries({ seed: 1, direction: 'up' }).candles), 'up');
  assert.equal(I.trendOf(trendSeries({ seed: 1, direction: 'down' }).candles), 'down');
  let range = 0;
  for (let s = 1; s <= 30; s++) if (I.trendOf(trendSeries({ seed: s, direction: 'range', strength: 0.8 }).candles) === 'range') range++;
  assert.ok(range >= 24, `range recognised ${range}/30`);
});

test('supportResistance: clusters repeated swing levels, strongest first', () => {
  // Price oscillates between ~100 and ~110 three times.
  const { candles } = fromPath([[0, 104], [0.15, 110], [0.3, 100], [0.45, 110.2], [0.6, 100.1], [0.75, 109.9], [0.9, 99.9], [1, 104]], { seed: 3, count: 120 });
  const lv = I.supportResistance(candles, { tolerance: 0.006 });
  assert.ok(lv.length >= 2);
  const top = lv.find((l) => Math.abs(l.price - 110) < 0.8);
  const bot = lv.find((l) => Math.abs(l.price - 100) < 0.8);
  assert.ok(top && top.type === 'resistance' && top.touches >= 3, JSON.stringify(lv));
  assert.ok(bot && bot.type === 'support' && bot.touches >= 3);
  assert.ok(lv[0].touches >= lv[lv.length - 1].touches);
  for (let i = 1; i < lv.length; i++) assert.ok(lv[i - 1].score >= lv[i].score);
  assert.ok(top.firstIdx < top.lastIdx);
});

test('fib levels, extensions and projection', () => {
  const lv = I.fibLevels(100, 120);
  const at = (r) => lv.find((l) => l.ratio === r).price;
  close(at(0), 120);
  close(at(1), 100);
  close(at(0.618), 120 - 20 * 0.618, 1e-12);
  close(at(0.5), 110);
  const down = I.fibLevels(120, 100, [0.382]);
  close(down[0].price, 100 + 20 * 0.382, 1e-12);
  const ext = I.fibExtensions(100, 120);
  close(ext.find((e) => e.ratio === 1.618).price, 132.36, 1e-9);
  close(ext.find((e) => e.ratio === 1.272).price, 125.44, 1e-9);
  close(I.fibProjection(100, 120, 110, [1])[0].price, 130);
});

test('crosses: golden and death, ignoring touches', () => {
  const fast = [1, 2, 3, 4, 3, 2, 2.5, 2.5, 3];
  const slow = [2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5];
  assert.deepEqual(I.crosses(fast, slow), [
    { idx: 2, type: 'golden' },
    { idx: 5, type: 'death' },
    { idx: 8, type: 'golden' },
  ]);
  assert.deepEqual(I.crosses([null, 1, 3], [null, 2, 2]), [{ idx: 2, type: 'golden' }]);
});

test('divergence: regular and hidden', () => {
  // Price makes a lower low at bar 30 than at bar 10; oscillator makes a higher low.
  const n = 45;
  const price = (i) => 100 - 8 * Math.exp(-((i - 10) ** 2) / 8) - 10 * Math.exp(-((i - 30) ** 2) / 8);
  const cs = Array.from({ length: n }, (_, i) => K(price(i) + 0.2, price(i) + 0.5, price(i) - 0.5, price(i) - 0.1));
  const osc = Array.from({ length: n }, (_, i) => 50 - 25 * Math.exp(-((i - 10) ** 2) / 8) - 12 * Math.exp(-((i - 30) ** 2) / 8));
  const d = I.divergence(cs, osc);
  const bull = d.find((x) => x.type === 'bullish');
  assert.ok(bull, JSON.stringify(d));
  assert.equal(bull.a.idx, 10);
  assert.equal(bull.b.idx, 30);
  assert.ok(bull.b.price < bull.a.price && bull.b.value > bull.a.value);
  // Mirror → bearish; oscillator agreeing → none.
  const csB = cs.map((c) => K(200 - c.o, 200 - c.l, 200 - c.h, 200 - c.c));
  const oscB = osc.map((v) => 100 - v);
  assert.ok(I.divergence(csB, oscB).some((x) => x.type === 'bearish'));
  const oscSame = Array.from({ length: n }, (_, i) => price(i));
  assert.equal(I.divergence(cs, oscSame).filter((x) => x.type === 'bullish').length, 0);
  // Hidden bullish: price higher low, oscillator lower low.
  const price2 = (i) => 100 - 10 * Math.exp(-((i - 10) ** 2) / 8) - 6 * Math.exp(-((i - 30) ** 2) / 8);
  const cs2 = Array.from({ length: n }, (_, i) => K(price2(i) + 0.2, price2(i) + 0.5, price2(i) - 0.5, price2(i) - 0.1));
  const osc2 = Array.from({ length: n }, (_, i) => 50 - 10 * Math.exp(-((i - 10) ** 2) / 8) - 25 * Math.exp(-((i - 30) ** 2) / 8));
  assert.ok(I.divergence(cs2, osc2).some((x) => x.type === 'hidden-bullish'));
  // lookback limits the distance between compared swings.
  assert.equal(I.divergence(cs, osc, { lookback: 10 }).filter((x) => x.type === 'bullish').length, 0);
});

test('linearRegression', () => {
  const r = I.linearRegression([[0, 1], [1, 3], [2, 5]]);
  close(r.slope, 2);
  close(r.intercept, 1);
  close(r.r2, 1);
  const r2 = I.linearRegression([{ idx: 0, price: 10 }, { idx: 10, price: 0 }]);
  close(r2.slope, -1);
  close(I.linearRegression([4, 4, 4]).slope, 0);
});

test('series helpers align with input length', () => {
  const cs = randomWalk({ seed: 1, count: 50 });
  for (const arr of [I.closes(cs), I.highs(cs), I.lows(cs), I.sma(I.closes(cs), 10), I.ema(I.closes(cs), 10), I.rsi(I.closes(cs)), I.atr(cs), I.bollinger(I.closes(cs)).upper, I.macd(I.closes(cs)).hist]) {
    assert.equal(arr.length, 50);
  }
});
