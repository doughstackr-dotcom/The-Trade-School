// Independent textbook re-implementations of every indicator, compared with
// js/core/indicators.js on several series (trending, choppy, flat, gappy, tiny FX prices) and on
// the edge cases (period > length, warm-up nulls, very short arrays, flat series).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../../js/core/indicators.js';
import { randomWalk, trendSeries, fromPath } from '../../js/core/data.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const near = (a, b, eps, msg) => {
  if (a === null || b === null) return assert.equal(a, b, msg);
  assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: expected ${b}, got ${a}`);
};
const sameSeries = (got, want, eps, msg) => {
  assert.equal(got.length, want.length, `${msg}: length`);
  want.forEach((w, i) => near(got[i], w, eps, `${msg}[${i}]`));
};

// ---------------------------------------------------------------------------------------------
// Reference implementations (deliberately naive: loops over whole windows, no running sums)
// ---------------------------------------------------------------------------------------------
function refSMA(v, n) {
  return v.map((_, i) => {
    if (i < n - 1) return null;
    const w = v.slice(i - n + 1, i + 1);
    return w.every(isNum) ? w.reduce((s, x) => s + x, 0) / n : null;
  });
}
function refEMA(v, n) {
  const out = v.map(() => null);
  const f = v.findIndex(isNum);
  if (f < 0 || f + n > v.length) return out;
  let e = v.slice(f, f + n).reduce((s, x) => s + x, 0) / n;
  out[f + n - 1] = e;
  const k = 2 / (n + 1);
  for (let i = f + n; i < v.length; i++) {
    e = v[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}
function refRSI(c, n) {
  const out = c.map(() => null);
  if (c.length <= n) return out;
  const ch = c.map((x, i) => (i ? x - c[i - 1] : 0));
  let g = 0;
  let l = 0;
  for (let i = 1; i <= n; i++) {
    g += Math.max(ch[i], 0);
    l += Math.max(-ch[i], 0);
  }
  g /= n;
  l /= n;
  const val = () => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
  out[n] = val();
  for (let i = n + 1; i < c.length; i++) {
    g = (g * (n - 1) + Math.max(ch[i], 0)) / n;
    l = (l * (n - 1) + Math.max(-ch[i], 0)) / n;
    out[i] = val();
  }
  return out;
}
function refBoll(c, n, k) {
  const mid = refSMA(c, n);
  const sd = c.map((_, i) => {
    if (mid[i] == null) return null;
    const w = c.slice(i - n + 1, i + 1);
    return Math.sqrt(w.reduce((s, x) => s + (x - mid[i]) ** 2, 0) / n); // population
  });
  return {
    mid,
    upper: mid.map((m, i) => (m == null ? null : m + k * sd[i])),
    lower: mid.map((m, i) => (m == null ? null : m - k * sd[i])),
  };
}
function refTR(cs) {
  return cs.map((c, i) => (i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - cs[i - 1].c), Math.abs(c.l - cs[i - 1].c))));
}
function refATR(cs, n) {
  const tr = refTR(cs);
  const out = cs.map(() => null);
  if (cs.length < n) return out;
  let a = tr.slice(0, n).reduce((s, x) => s + x, 0) / n;
  out[n - 1] = a;
  for (let i = n; i < cs.length; i++) {
    a = (a * (n - 1) + tr[i]) / n;
    out[i] = a;
  }
  return out;
}
function refSwings(cs, L, R) {
  const out = [];
  for (let i = L; i < cs.length - R; i++) {
    const left = cs.slice(i - L, i);
    const right = cs.slice(i + 1, i + R + 1);
    if (left.every((k) => k.h < cs[i].h) && right.every((k) => k.h <= cs[i].h)) out.push({ idx: i, price: cs[i].h, type: 'high' });
    if (left.every((k) => k.l > cs[i].l) && right.every((k) => k.l >= cs[i].l)) out.push({ idx: i, price: cs[i].l, type: 'low' });
  }
  return out;
}

const K = (o, h, l, c, v = 100) => ({ o, h, l, c, v, t: 0 });
const SERIES = {
  walk: randomWalk({ seed: 7, count: 260 }),
  trendUp: trendSeries({ seed: 3, count: 200, direction: 'up', swings: 6 }).candles,
  trendDown: trendSeries({ seed: 5, count: 200, direction: 'down', swings: 6 }).candles,
  choppy: randomWalk({ seed: 99, count: 180, vol: 0.03 }),
  fx: randomWalk({ seed: 12, count: 150, start: 1.085, vol: 0.002 }),
  path: fromPath([[0, 100], [0.3, 112], [0.55, 104], [0.8, 118], [1, 109]], { seed: 8, count: 150 }).candles,
};

// ---------------------------------------------------------------------------------------------

test('SMA / EMA match the textbook definitions on every series and period', () => {
  for (const [name, cs] of Object.entries(SERIES)) {
    const c = I.closes(cs);
    for (const n of [1, 2, 5, 9, 12, 20, 26, 50, 200]) {
      sameSeries(I.sma(c, n), refSMA(c, n), 1e-10, `${name} sma${n}`);
      sameSeries(I.ema(c, n), refEMA(c, n), 1e-10, `${name} ema${n}`);
    }
  }
  // EMA k = 2/(n+1) spelled out on a tiny series: seed = SMA(3) of 2,4,6 = 4, k = 0.5.
  assert.deepEqual(I.ema([2, 4, 6, 10, 0], 3), [null, null, 4, 7, 3.5]);
  // Period 1: both are the series itself.
  assert.deepEqual(I.sma([3, 1, 2], 1), [3, 1, 2]);
  assert.deepEqual(I.ema([3, 1, 2], 1), [3, 1, 2]);
});

test('SMA / EMA edge cases: period > length, empty, nulls in the warm-up', () => {
  assert.deepEqual(I.sma([1, 2, 3], 5), [null, null, null]);
  assert.deepEqual(I.ema([1, 2, 3], 5), [null, null, null]);
  assert.deepEqual(I.sma([], 3), []);
  assert.deepEqual(I.ema([], 3), []);
  assert.deepEqual(I.sma([7], 1), [7]);
  // Leading nulls (e.g. an indicator that is still warming up) are skipped by EMA.
  const warm = [null, null, null, 1, 2, 3, 4, 5];
  sameSeries(I.ema(warm, 3), refEMA(warm, 3), 1e-12, 'ema with warm-up');
  assert.equal(I.ema(warm, 3)[5], 2);
  // SMA windows that include a null are null.
  assert.deepEqual(I.sma([null, 2, 4, 6], 2), [null, null, 3, 5]);
});

test('RSI reproduces the StockCharts / Wilder 14-period worked example to 0.01', () => {
  // StockCharts "RSI" ChartSchool spreadsheet closes (4 decimals) and its published RSI column.
  const px = [
    44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.614,
    46.282, 46.282, 46.0028, 46.0328, 46.4116, 46.2222, 45.6439, 46.2122, 46.2521, 45.7137, 46.4515, 45.7835, 45.3548,
    44.0288, 44.1783, 44.2181, 44.5672, 43.4205, 42.6628, 43.1314,
  ];
  const published = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.3, 33.08, 37.77];
  const r = I.rsi(px, 14);
  assert.ok(r.slice(0, 14).every((v) => v === null), 'first value at index 14');
  published.forEach((v, i) => assert.ok(Math.abs(r[14 + i] - v) <= 0.01, `rsi[${14 + i}] ${r[14 + i].toFixed(3)} vs ${v}`));
  // First average gain / loss from the article: 0.24 / 0.10 → RS 2.39.
  let g = 0;
  let l = 0;
  for (let i = 1; i <= 14; i++) {
    const d = px[i] - px[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  assert.ok(Math.abs(g / 14 - 0.2384) < 0.0001 && Math.abs(l / 14 - 0.0996) < 0.0001);
  assert.ok(Math.abs(g / l - 2.39) < 0.005);
});

test('RSI matches the Wilder reference on every series; flat / one-way / short edge cases', () => {
  for (const [name, cs] of Object.entries(SERIES)) {
    const c = I.closes(cs);
    for (const n of [2, 5, 14, 21]) sameSeries(I.rsi(c, n), refRSI(c, n), 1e-9, `${name} rsi${n}`);
    assert.ok(I.rsi(c).every((v) => v === null || (v >= 0 && v <= 100)));
  }
  // Flat series: no gains and no losses → neutral 50 (documented choice; never NaN).
  assert.ok(I.rsi(new Array(30).fill(1.085), 14).slice(14).every((v) => v === 50));
  // Only gains → 100, only losses → 0; a flat stretch after gains keeps RSI at 100.
  assert.equal(I.rsi([1, 2, 3, 4, 5, 6], 3)[5], 100);
  assert.equal(I.rsi([6, 5, 4, 3, 2, 1], 3)[5], 0);
  assert.equal(I.rsi([1, 2, 3, 4, 4, 4, 4], 3)[6], 100);
  // Period >= length → all null; exactly period + 1 values → one value.
  assert.deepEqual(I.rsi([1, 2, 3], 14), [null, null, null]);
  assert.deepEqual(I.rsi([1, 2, 3], 3), [null, null, null]);
  assert.equal(I.rsi([1, 2, 1, 2], 3)[3], refRSI([1, 2, 1, 2], 3)[3]);
  assert.deepEqual(I.rsi([], 14), []);
});

test('MACD 12/26/9 = EMA12 − EMA26, signal = EMA9 of MACD, hist = macd − signal', () => {
  for (const [name, cs] of Object.entries(SERIES)) {
    const c = I.closes(cs);
    const m = I.macd(c);
    const e12 = refEMA(c, 12);
    const e26 = refEMA(c, 26);
    const line = c.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null));
    const sig = refEMA(line, 9);
    sameSeries(m.macd, line, 1e-9, `${name} macd`);
    sameSeries(m.signal, sig, 1e-9, `${name} signal`);
    sameSeries(m.hist, line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null)), 1e-9, `${name} hist`);
    assert.equal(m.macd.findIndex((v) => v != null), 25);
    assert.equal(m.signal.findIndex((v) => v != null), 33);
  }
  const short = I.macd([1, 2, 3, 4, 5]);
  assert.ok([...short.macd, ...short.signal, ...short.hist].every((v) => v === null));
  // Custom periods work too.
  const c = I.closes(SERIES.walk);
  const m = I.macd(c, 5, 35, 5);
  const line = refEMA(c, 5).map((v, i) => (v != null && refEMA(c, 35)[i] != null ? v - refEMA(c, 35)[i] : null));
  sameSeries(m.macd, line, 1e-9, 'macd 5/35');
});

test('Bollinger bands use the population standard deviation', () => {
  for (const [name, cs] of Object.entries(SERIES)) {
    const c = I.closes(cs);
    for (const [n, k] of [[20, 2], [10, 1.5], [5, 2.5]]) {
      const b = I.bollinger(c, n, k);
      const r = refBoll(c, n, k);
      sameSeries(b.mid, r.mid, 1e-10, `${name} mid`);
      sameSeries(b.upper, r.upper, 1e-9, `${name} upper`);
      sameSeries(b.lower, r.lower, 1e-9, `${name} lower`);
      b.width.forEach((w, i) => {
        if (r.mid[i] == null) assert.equal(w, null);
        else near(w, (r.upper[i] - r.lower[i]) / r.mid[i], 1e-9, `${name} width`);
      });
    }
  }
  // 2,4,4,4,5,5,7,9: the classic population-sd example (sd = 2, sample sd would be 2.138).
  const b = I.bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
  assert.equal(b.mid[7], 5);
  near(b.upper[7], 9, 1e-12, 'upper');
  near(b.lower[7], 1, 1e-12, 'lower');
  assert.deepEqual(I.bollinger([1, 2], 20).upper, [null, null]);
  // A fractional period behaves like its integer part (no NaN from fractional indexes).
  const c = I.closes(SERIES.walk);
  assert.deepEqual(I.bollinger(c, 20.7), I.bollinger(c, 20));
});

test('ATR is Wilder-smoothed true range seeded with the mean of the first n TRs', () => {
  for (const [name, cs] of Object.entries(SERIES)) {
    for (const n of [1, 5, 14]) sameSeries(I.atr(cs, n), refATR(cs, n), 1e-10, `${name} atr${n}`);
    sameSeries(I.trueRange(cs), refTR(cs), 0, `${name} tr`);
  }
  // Hand example: gaps make TR use the previous close.
  const cs = [K(10, 11, 9, 10), K(12, 13, 11.5, 12.5), K(9, 10, 8, 8.5), K(8.5, 9, 8, 8.8)];
  assert.deepEqual(I.trueRange(cs), [2, 3, 4.5, 1]);
  const a = I.atr(cs, 3);
  assert.deepEqual(a.slice(0, 2), [null, null]);
  near(a[2], 9.5 / 3, 1e-12, 'atr seed');
  near(a[3], ((9.5 / 3) * 2 + 1) / 3, 1e-12, 'atr smoothing');
  assert.deepEqual(I.atr(cs, 10), [null, null, null, null]);
  assert.deepEqual(I.atr([], 14), []);
});

test('swings: pivots over left/right windows, ties resolved to the first bar of a plateau', () => {
  for (const [name, cs] of Object.entries(SERIES)) {
    for (const [L, R] of [[1, 1], [2, 2], [3, 3], [5, 2]]) {
      const got = I.swings(cs, { left: L, right: R });
      const want = refSwings(cs, L, R);
      assert.deepEqual(got, want, `${name} swings ${L}/${R}`);
    }
  }
  // Plateau: two equal highs → only the first is a swing high (strictly above the left bars,
  // >= the right bars); equal lows likewise.
  const hs = [1, 2, 5, 5, 2, 1, 1];
  const cs = hs.map((h) => K(h - 0.2, h, h - 0.5, h - 0.1));
  assert.deepEqual(I.swings(cs, { left: 2, right: 2 }).filter((s) => s.type === 'high').map((s) => s.idx), [2]);
  const ls = [5, 4, 1, 1, 4, 5, 6];
  const cl = ls.map((l) => K(l + 0.2, l + 0.5, l, l + 0.1));
  assert.deepEqual(I.swings(cl, { left: 2, right: 2 }).filter((s) => s.type === 'low').map((s) => s.idx), [2]);
  // No swings inside the first `left` / last `right` bars; too-short input → [].
  assert.deepEqual(I.swings(cs.slice(0, 3), { left: 3, right: 3 }), []);
  // alternate: merges consecutive same-type swings, keeping the more extreme.
  const alt = I.swings(SERIES.choppy, { left: 1, right: 1, alternate: true });
  for (let i = 1; i < alt.length; i++) assert.notEqual(alt[i].type, alt[i - 1].type);
  const raw = I.swings(SERIES.choppy, { left: 1, right: 1 });
  for (const s of alt) assert.ok(raw.some((r) => r.idx === s.idx && r.type === s.type));
});

test('labelStructure: HH/LH against the previous high, HL/LL against the previous low', () => {
  const sw = [
    { idx: 1, price: 10, type: 'low' },
    { idx: 3, price: 20, type: 'high' },
    { idx: 5, price: 12, type: 'low' },
    { idx: 7, price: 25, type: 'high' },
    { idx: 9, price: 11, type: 'low' },
    { idx: 11, price: 25, type: 'high' },
    { idx: 13, price: 11, type: 'low' },
  ];
  assert.deepEqual(I.labelStructure(sw).map((s) => s.label), ['L', 'H', 'HL', 'HH', 'LL', 'LH', 'HL']);
  assert.deepEqual(I.labelStructure([]), []);
  // trendSeries labels agree with labelStructure applied to the same swings.
  for (const direction of ['up', 'down', 'range']) {
    const { swings } = trendSeries({ seed: 17, direction });
    const relabeled = I.labelStructure(swings.map(({ idx, price, type }) => ({ idx, price, type })));
    assert.deepEqual(relabeled.map((s) => s.label), swings.map((s) => s.label), direction);
  }
});

test('supportResistance clusters touches within tolerance and classifies the role', () => {
  // Swing highs near 110 (x3), swing lows near 100 (x3), and a level near 105 that acted as
  // resistance first and support later (role reversal → 'both').
  const pts = [
    [0, 102], [0.08, 110], [0.16, 100], [0.24, 110.3], [0.32, 100.2], [0.4, 109.9], [0.48, 99.9],
    [0.56, 105], [0.64, 101], [0.72, 116], [0.8, 105.2], [0.88, 114], [1, 112],
  ];
  const { candles, anchors } = fromPath(pts, { seed: 4, count: 160, noise: 0.25 });
  const lv = I.supportResistance(candles, { tolerance: 0.006, left: 3, right: 3 });
  const find = (p) => lv.find((l) => Math.abs(l.price - p) / p < 0.004);
  const r110 = find(110.07);
  const s100 = find(100.03);
  const b105 = find(105.1);
  assert.ok(r110 && r110.type === 'resistance' && r110.touches === 3, JSON.stringify(lv));
  assert.ok(s100 && s100.type === 'support' && s100.touches === 3, JSON.stringify(lv));
  assert.ok(b105 && b105.type === 'both' && b105.touches >= 2, JSON.stringify(lv));
  // The cluster price is the average of its touches, first/last index span the touches.
  near(r110.price, (110 + 110.3 + 109.9) / 3, 1e-9, 'cluster average');
  assert.equal(r110.firstIdx, anchors[1].idx);
  assert.equal(r110.lastIdx, anchors[5].idx);
  // Sorted by score, and each score = touches + recency bonus (+0.5 for role reversal).
  for (let i = 1; i < lv.length; i++) assert.ok(lv[i - 1].score >= lv[i].score);
  // Tighter tolerance splits 110 / 110.3 apart; minTouches filters.
  const tight = I.supportResistance(candles, { tolerance: 0.001, left: 3, right: 3 });
  assert.ok(!tight.some((l) => l.touches === 3 && Math.abs(l.price - 110.07) < 0.3));
  assert.ok(I.supportResistance(candles, { minTouches: 4, left: 3, right: 3 }).every((l) => l.touches >= 4));
  assert.deepEqual(I.supportResistance([]), []);
});

test('fib retracements go the right way for up- and down-swings; extensions and projections', () => {
  const up = I.fibLevels(100, 150);
  const at = (lv, r) => lv.find((l) => l.ratio === r).price;
  near(at(up, 0), 150, 1e-12, 'up 0');
  near(at(up, 0.236), 138.2, 1e-12, 'up 0.236');
  near(at(up, 0.382), 130.9, 1e-12, 'up 0.382');
  near(at(up, 0.5), 125, 1e-12, 'up 0.5');
  near(at(up, 0.618), 119.1, 1e-12, 'up 0.618');
  near(at(up, 0.786), 110.7, 1e-12, 'up 0.786');
  near(at(up, 1), 100, 1e-12, 'up 1');
  const down = I.fibLevels(150, 100);
  near(at(down, 0.618), 130.9, 1e-12, 'down 0.618');
  near(at(down, 0.382), 119.1, 1e-12, 'down 0.382');
  near(at(down, 0), 100, 1e-12, 'down 0');
  // FX scale, 4 decimals.
  near(at(I.fibLevels(1.08, 1.09), 0.618), 1.08382, 1e-12, 'fx');
  // Extensions beyond the swing end: from + (to − from) × r.
  const ext = I.fibExtensions(100, 150);
  near(at(ext, 1.272), 163.6, 1e-12, 'ext 1.272');
  near(at(ext, 1.618), 180.9, 1e-12, 'ext 1.618');
  near(at(ext, 2.618), 230.9, 1e-12, 'ext 2.618');
  near(at(I.fibExtensions(150, 100), 1.618), 69.1, 1e-12, 'down ext');
  // A-B-C projection: C + (B − A) × r.
  const pr = I.fibProjection(100, 120, 110);
  near(at(pr, 0.618), 122.36, 1e-12, 'proj');
  near(at(pr, 1), 130, 1e-12, 'proj 1');
  near(at(I.fibProjection(120, 100, 110, [1.618]), 1.618), 77.64, 1e-12, 'down proj');
});

test('crosses: exactly one event per cross, golden = fast crosses above slow', () => {
  // Touch then cross, touch without cross, nulls in the warm-up.
  assert.deepEqual(I.crosses([1, 2, 2, 3], [2, 2, 2, 2]), [{ idx: 3, type: 'golden' }]);
  assert.deepEqual(I.crosses([3, 2, 3], [2, 2, 2]), [], 'touch and back is not a cross');
  assert.deepEqual(I.crosses([3, 2, 1], [2, 2, 2]), [{ idx: 2, type: 'death' }]);
  assert.deepEqual(I.crosses([null, null, 1, 3, 1], [null, 2, 2, 2, 2]), [
    { idx: 3, type: 'golden' },
    { idx: 4, type: 'death' },
  ]);
  assert.deepEqual(I.crosses([], []), []);
  // On real MA pairs: events alternate, each one is a real sign change, and every sign change
  // is reported once.
  for (const [name, cs] of Object.entries(SERIES)) {
    const c = I.closes(cs);
    const fast = I.sma(c, 10);
    const slow = I.sma(c, 30);
    const ev = I.crosses(fast, slow);
    for (let i = 1; i < ev.length; i++) assert.notEqual(ev[i].type, ev[i - 1].type, `${name} alternate`);
    let side = 0;
    const want = [];
    for (let i = 0; i < c.length; i++) {
      if (fast[i] == null || slow[i] == null) continue;
      const s = Math.sign(fast[i] - slow[i]);
      if (s === 0) continue;
      if (side && s !== side) want.push({ idx: i, type: s > 0 ? 'golden' : 'death' });
      side = s;
    }
    assert.deepEqual(ev, want, name);
    for (const e of ev) assert.ok(e.type === 'golden' ? fast[e.idx] > slow[e.idx] : fast[e.idx] < slow[e.idx]);
  }
});

// Price with two swing lows (or highs) of chosen depth, and an oscillator with chosen lows.
function twoDips({ p1, p2, o1, o2, invert = false }) {
  const n = 60;
  const bump = (i, c) => Math.exp(-((i - c) ** 2) / 10);
  const price = (i) => 100 - p1 * bump(i, 18) - p2 * bump(i, 42);
  const osc = (i) => 50 - o1 * bump(i, 18) - o2 * bump(i, 42);
  const cs = Array.from({ length: n }, (_, i) => {
    const p = price(i);
    const k = K(p + 0.15, p + 0.4, p - 0.4, p - 0.1);
    return invert ? K(200 - k.o, 200 - k.l, 200 - k.h, 200 - k.c) : k;
  });
  const o = Array.from({ length: n }, (_, i) => (invert ? 100 - osc(i) : osc(i)));
  return { cs, o };
}

test('divergence: regular and hidden, bullish and bearish, and nothing on agreement', () => {
  const find = (d, type) => d.filter((x) => x.type === type);
  // Bullish: price lower low, oscillator higher low.
  let { cs, o } = twoDips({ p1: 6, p2: 9, o1: 25, o2: 12 });
  let d = I.divergence(cs, o);
  assert.equal(find(d, 'bullish').length, 1, JSON.stringify(d));
  const b = find(d, 'bullish')[0];
  assert.deepEqual([b.a.idx, b.b.idx], [18, 42]);
  assert.ok(b.b.price < b.a.price && b.b.value > b.a.value);
  assert.equal(d.length, 1, 'nothing else');
  // Bearish (mirror): price higher high, oscillator lower high.
  ({ cs, o } = twoDips({ p1: 6, p2: 9, o1: 25, o2: 12, invert: true }));
  d = I.divergence(cs, o);
  assert.deepEqual(d.map((x) => x.type), ['bearish']);
  // Hidden bullish: price higher low, oscillator lower low (trend continuation).
  ({ cs, o } = twoDips({ p1: 9, p2: 6, o1: 12, o2: 25 }));
  assert.deepEqual(I.divergence(cs, o).map((x) => x.type), ['hidden-bullish']);
  // Hidden bearish: price lower high, oscillator higher high.
  ({ cs, o } = twoDips({ p1: 9, p2: 6, o1: 12, o2: 25, invert: true }));
  assert.deepEqual(I.divergence(cs, o).map((x) => x.type), ['hidden-bearish']);
  // Agreement (lower low + lower oscillator low) → no divergence.
  ({ cs, o } = twoDips({ p1: 6, p2: 9, o1: 12, o2: 25 }));
  assert.deepEqual(I.divergence(cs, o), []);
  // Differences inside minDiff are ignored; lookback limits the distance between swings.
  ({ cs, o } = twoDips({ p1: 6, p2: 9, o1: 25, o2: 12 }));
  assert.deepEqual(I.divergence(cs, o, { minDiff: 20 }), []);
  assert.deepEqual(I.divergence(cs, o, { lookback: 20 }), []);
});

test('divergence: no false signals on a clean trend where the oscillator follows price', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    for (const direction of ['up', 'down']) {
      const { candles } = trendSeries({ seed, direction, count: 120, swings: 5 });
      // An oscillator that is a smoothed copy of price agrees with every swing.
      const osc = I.ema(I.closes(candles), 2).map((v, i) => v ?? candles[i].c);
      const regular = I.divergence(candles, osc).filter((x) => x.type === 'bullish' || x.type === 'bearish');
      assert.deepEqual(regular, [], `${direction} seed ${seed}`);
    }
  }
});

test('divergence on RSI finds the classic setup: lower low in price, higher low in RSI', () => {
  // A hard sell-off, a bounce, then a slow grind to a marginally lower low: RSI's second low
  // is higher because the second decline has less momentum.
  const { candles } = fromPath([[0, 120], [0.3, 100], [0.45, 108], [0.8, 99], [1, 106]], { seed: 21, count: 120, noise: 0.15 });
  const r = I.rsi(I.closes(candles), 14);
  const d = I.divergence(candles, r, { left: 4, right: 4, lookback: 60 });
  assert.ok(d.some((x) => x.type === 'bullish'), JSON.stringify(d));
});

test('trendOf, highest, lowest, linearRegression', () => {
  let ok = 0;
  for (let s = 1; s <= 40; s++) {
    if (I.trendOf(trendSeries({ seed: s, direction: 'up' }).candles) === 'up') ok++;
    if (I.trendOf(trendSeries({ seed: s, direction: 'down' }).candles) === 'down') ok++;
  }
  assert.ok(ok >= 78, `trendOf ${ok}/80`);
  assert.equal(I.trendOf([]), 'range');
  assert.equal(I.trendOf([K(1, 2, 0.5, 1.5)]), 'range');
  assert.deepEqual(I.highest([1, 3, 2, 5, 4], 2), [null, 3, 3, 5, 5]);
  assert.deepEqual(I.lowest([1, 3, 2, 5, 4], 3), [null, null, 1, 2, 2]);
  assert.deepEqual(I.highest([1, 2], 5), [null, null]);
  assert.deepEqual(I.highest([-3, null, -5], 2), [null, -3, -5], 'nulls are ignored, not treated as 0');
  const lr = I.linearRegression([[1, 3], [2, 5], [3, 7.2], [4, 8.8]]);
  // Least squares by hand: slope = Sxy / Sxx = 9.8 / 5 = 1.96, intercept = 6 − 1.96 × 2.5 = 1.1.
  near(lr.slope, 1.96, 1e-12, 'slope');
  near(lr.intercept, 1.1, 1e-12, 'intercept');
  assert.ok(lr.r2 > 0.99 && lr.r2 <= 1);
  assert.deepEqual(I.linearRegression([]), { slope: 0, intercept: 0, r2: 0 });
});
