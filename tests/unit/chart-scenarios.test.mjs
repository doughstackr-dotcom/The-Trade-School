import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHART_PATTERNS, CHART_PATTERN_IDS, chartScenario } from '../../js/core/patterns.js';
import { isValidCandle } from '../../js/core/data.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7727 + 11);
const REQUIRED = [
  'head-and-shoulders', 'inverse-head-and-shoulders', 'double-top', 'double-bottom', 'triple-top', 'triple-bottom',
  'rising-wedge', 'falling-wedge', 'ascending-triangle', 'descending-triangle', 'symmetrical-triangle', 'bull-flag',
  'bear-flag', 'cup-and-handle', 'rounding-bottom', 'rounding-top', 'bull-pennant', 'bear-pennant',
  'bull-rectangle', 'bear-rectangle',
];
const kp = (sc, label) => sc.keyPoints.filter((k) => k.label === label);
const lineAt = (ln, x) => ln.y1 + ((ln.y2 - ln.y1) * (x - ln.x1)) / (ln.x2 - ln.x1 || 1);
const pct = (a, b) => Math.abs(a - b) / b;

test('all chart patterns exist with complete text', () => {
  assert.deepEqual([...CHART_PATTERN_IDS].sort(), [...REQUIRED].sort());
  for (const id of REQUIRED) {
    const p = CHART_PATTERNS[id];
    assert.equal(p.id, id);
    assert.ok(typeof p.name === 'string' && p.name.length > 3, `${id}.name`);
    for (const k of ['summary', 'psychology', 'howToTrade', 'target']) assert.ok(typeof p[k] === 'string' && p[k].length > 20, `${id}.${k}`);
    assert.ok(['bullish', 'bearish', 'neutral'].includes(p.bias));
    assert.ok(['reversal', 'continuation'].includes(p.kind));
    assert.ok([1, 2, 3].includes(p.reliability));
    const path = p.path(makeFakeRng());
    assert.ok(Array.isArray(path.points) && path.points.length >= 5);
    assert.ok(Number.isInteger(path.breakoutPoint));
    assert.equal(path.labels[path.breakoutPoint], 'Breakout');
  }
});

function makeFakeRng() {
  let s = 1;
  const next = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  return { next, float: (a, b) => a + (b - a) * next(), chance: (p) => next() < p, sign: () => (next() < 0.5 ? -1 : 1), int: (a, b) => a + Math.floor(next() * (b - a + 1)), pick: (arr) => arr[0] };
}

function common(id, sc, seed, outcome) {
  const msg = `${id} seed ${seed} ${outcome}`;
  assert.equal(sc.candles.length, 110, msg);
  sc.candles.forEach((c, i) => {
    assert.ok(isValidCandle(c), `${msg} candle ${i}`);
    assert.ok(c.v > 0);
  });
  assert.ok(sc.patternStart < sc.patternEnd && sc.patternEnd < sc.breakoutIdx, msg);
  assert.equal(sc.patternEnd, sc.breakoutIdx - 1);
  assert.ok(sc.breakoutIdx <= 110 - 20, `${msg}: breakout before the follow-through`);
  assert.equal(kp(sc, 'Breakout').length, 1);
  assert.equal(kp(sc, 'Breakout')[0].idx, sc.breakoutIdx);
  assert.ok(sc.height > 0);
  const dir = sc.direction;
  assert.equal(sc.bias, dir > 0 ? 'bullish' : 'bearish');
  const bo = sc.candles[sc.breakoutIdx];
  assert.ok((bo.c - sc.level) * dir > 0, `${msg}: breakout candle closes beyond the level`);
  for (let i = sc.patternEnd - 3; i < sc.breakoutIdx; i++) {
    assert.ok((sc.candles[i].c - lineLevel(sc, i)) * dir <= 1e-9, `${msg}: close ${i} beyond the level before the breakout`);
  }
  assert.ok(Math.abs(sc.target - (sc.level + dir * sc.height)) < 1e-9, 'measured move');
  assert.ok((sc.target - bo.c) * dir > 0, `${msg}: target lies beyond the breakout`);
  // Key points sit on real candle extremes.
  for (const k of sc.keyPoints) {
    if (k.label === 'Breakout') continue;
    const c = sc.candles[k.idx];
    assert.ok([c.h, c.l, c.c].includes(k.price), `${msg}: key point ${k.label}@${k.idx} not on a candle`);
  }
  const last = sc.candles[sc.candles.length - 1].c;
  if (outcome === 'success') {
    assert.equal(sc.reachedTarget, true, `${msg}: success reaches the target`);
  } else {
    assert.ok((last - sc.level) * dir < 0, `${msg}: failed breakout ends back on the other side of the level`);
  }
}

function lineLevel(sc, i) {
  if (sc.neckline) return lineAt(sc.neckline, i);
  return lineAt(sc.direction > 0 ? sc.boundaries.upper : sc.boundaries.lower, i);
}

test('every pattern: valid candles, breakout, measured move, success & fail outcomes (200 seeds)', () => {
  for (const id of REQUIRED) {
    for (const seed of SEEDS) {
      for (const outcome of ['success', 'fail']) common(id, chartScenario(id, { seed, outcome }), seed, outcome);
    }
  }
});

test('head and shoulders geometry', () => {
  for (const id of ['head-and-shoulders', 'inverse-head-and-shoulders']) {
    const s = id === 'head-and-shoulders' ? 1 : -1;
    for (const seed of SEEDS) {
      const sc = chartScenario(id, { seed });
      const [L] = kp(sc, 'Left shoulder');
      const [H] = kp(sc, 'Head');
      const [R] = kp(sc, 'Right shoulder');
      const necks = kp(sc, 'Neckline');
      assert.ok(L && H && R && necks.length === 2, `${id} labels`);
      assert.ok(L.idx < necks[0].idx && necks[0].idx < H.idx && H.idx < necks[1].idx && necks[1].idx < R.idx && R.idx < sc.breakoutIdx);
      // Head clearly beyond both shoulders (5–12%).
      for (const sh of [L, R]) {
        const d = ((H.price - sh.price) * s) / sh.price;
        assert.ok(d >= 0.04 && d <= 0.13, `${id} seed ${seed}: head vs shoulder ${d.toFixed(3)}`);
      }
      assert.ok(pct(L.price, R.price) < 0.03, 'shoulders roughly level');
      // Neckline passes through the two troughs (peaks for the inverse).
      for (const n of necks) assert.ok(Math.abs(lineAt(sc.neckline, n.idx) - n.price) < 1e-9);
      // Prior trend leads into the pattern.
      const pre = sc.candles[0].c;
      assert.ok((L.price - pre) * s > 0, `${id} prior trend`);
      assert.equal(sc.direction, -s);
      assert.ok(pct(sc.height, Math.abs(H.price - lineAt(sc.neckline, H.idx))) < 1e-9);
    }
  }
});

test('double / triple tops and bottoms: extremes level, neckline at the middle trough/peak', () => {
  for (const [id, labels, s] of [
    ['double-top', ['Top 1', 'Top 2'], 1],
    ['double-bottom', ['Bottom 1', 'Bottom 2'], -1],
    ['triple-top', ['Top 1', 'Top 2', 'Top 3'], 1],
    ['triple-bottom', ['Bottom 1', 'Bottom 2', 'Bottom 3'], -1],
  ]) {
    for (const seed of SEEDS) {
      const sc = chartScenario(id, { seed });
      const ext = labels.map((l) => kp(sc, l)[0]);
      assert.ok(ext.every(Boolean), `${id} labels`);
      const prices = ext.map((e) => e.price);
      assert.ok((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices) <= 0.02, `${id} seed ${seed}: extremes within 2%`);
      const necks = kp(sc, 'Neckline');
      assert.equal(necks.length, labels.length - 1);
      for (const n of necks) {
        assert.ok((Math.min(...prices.map((p) => p * s)) - n.price * s) / n.price > 0.025, `${id} seed ${seed}: neckline clearly beyond the extremes`);
        assert.ok(ext[0].idx < n.idx);
      }
      if (id.startsWith('double')) {
        assert.equal(sc.neckline.y1, sc.neckline.y2, 'double top/bottom neckline is the horizontal trough/peak level');
        assert.equal(sc.neckline.y1, necks[0].price);
      }
      assert.equal(sc.direction, -s);
    }
  }
});

test('triangles and wedges: boundaries converge and contain the formation', () => {
  const cases = {
    'rising-wedge': (u, l) => u > 0 && l > u,
    'falling-wedge': (u, l) => l < 0 && u < l,
    'ascending-triangle': (u, l) => Math.abs(u) < 1e-9 && l > 0,
    'descending-triangle': (u, l) => Math.abs(l) < 1e-9 && u < 0,
    'symmetrical-triangle': (u, l) => u < 0 && l > 0,
  };
  for (const [id, slopeOk] of Object.entries(cases)) {
    for (const seed of SEEDS) {
      const sc = chartScenario(id, { seed });
      const { upper, lower } = sc.boundaries;
      assert.equal(sc.neckline, null);
      assert.equal(upper.x1, lower.x1);
      assert.equal(upper.x2, sc.breakoutIdx);
      const w1 = upper.y1 - lower.y1;
      const w2 = upper.y2 - lower.y2;
      assert.ok(w1 > 0 && w2 > 0 && w2 < w1 * 0.8, `${id} seed ${seed}: converging (${w1.toFixed(2)} → ${w2.toFixed(2)})`);
      const su = (upper.y2 - upper.y1) / (upper.x2 - upper.x1);
      const sl = (lower.y2 - lower.y1) / (lower.x2 - lower.x1);
      assert.ok(slopeOk(su, sl), `${id} seed ${seed}: slopes ${su.toFixed(4)} / ${sl.toFixed(4)}`);
      assert.ok(Math.abs(sc.height - w1) < 1e-9, 'height = widest part');
      // Touches of each line lie on (or just inside) it.
      for (const k of sc.keyPoints) {
        if (k.label === 'Breakout') continue;
        const u = lineAt(upper, k.idx);
        const l = lineAt(lower, k.idx);
        assert.ok(k.price <= u + 1e-6 && k.price >= l - 1e-6, `${id} seed ${seed}: ${k.label}@${k.idx} outside boundaries`);
      }
      if (id !== 'symmetrical-triangle') assert.equal(sc.bias, CHART_PATTERNS[id].bias);
    }
  }
});

test('symmetrical triangle breaks in the direction of the prior trend', () => {
  const dirs = new Set();
  for (const seed of SEEDS) {
    const sc = chartScenario('symmetrical-triangle', { seed });
    dirs.add(sc.direction);
    const pre = sc.candles[0].c;
    const start = sc.candles[sc.patternStart].c;
    assert.ok((start - pre) * sc.direction > 0, `seed ${seed}: prior trend`);
  }
  assert.deepEqual([...dirs].sort(), [-1, 1], 'both directions occur');
});

test('flags: steep pole, shallow counter-sloped flag, pole projected from the breakout', () => {
  for (const [id, s] of [['bull-flag', 1], ['bear-flag', -1]]) {
    for (const seed of SEEDS) {
      const sc = chartScenario(id, { seed });
      const [ps] = kp(sc, 'Flagpole start');
      const [pt] = kp(sc, s > 0 ? 'Flagpole top' : 'Flagpole bottom');
      assert.ok(ps && pt);
      const pole = (pt.price - ps.price) * s;
      assert.ok(pole > 0);
      assert.ok(Math.abs(sc.height - pole) < 1e-9);
      const { upper, lower } = sc.boundaries;
      const slope = (upper.y2 - upper.y1) / (upper.x2 - upper.x1);
      assert.ok(slope * s < 0, 'flag slopes against the pole');
      const flagDepth = Math.max(...sc.keyPoints.filter((k) => k.label === 'Flag').map((k) => (pt.price - k.price) * s));
      assert.ok(flagDepth < pole * 0.5, `${id} seed ${seed}: flag retraces less than half the pole`);
      const poleBars = pt.idx - ps.idx;
      const flagBars = sc.breakoutIdx - pt.idx;
      assert.ok(pole / poleBars > (2 * (upper.y1 - lower.y1)) / flagBars, 'pole is steeper than the flag');
    }
  }
});

test('pennants: steep pole, short converging consolidation, pole projected from the breakout', () => {
  for (const [id, s] of [['bull-pennant', 1], ['bear-pennant', -1]]) {
    for (const seed of SEEDS) {
      const sc = chartScenario(id, { seed });
      const [ps] = kp(sc, 'Flagpole start');
      const [pt] = kp(sc, s > 0 ? 'Flagpole top' : 'Flagpole bottom');
      assert.ok(ps && pt);
      const pole = (pt.price - ps.price) * s;
      assert.ok(pole > 0);
      assert.ok(Math.abs(sc.height - pole) < 1e-9);
      const { upper, lower } = sc.boundaries;
      const w0 = Math.abs(upper.y1 - lower.y1);
      const w1 = Math.abs(upper.y2 - lower.y2);
      assert.ok(w1 < w0 * 0.85, `${id} seed ${seed}: pennant should converge (${w1} vs ${w0})`);
      const flagDepth = Math.max(...sc.keyPoints.filter((k) => k.label === 'Pennant').map((k) => (pt.price - k.price) * s));
      assert.ok(flagDepth < pole * 0.5, `${id} seed ${seed}: pennant retraces less than half the pole`);
    }
  }
});

test('cup and handle / rounding bottom: rounded base, rim neckline', () => {
  for (const seed of SEEDS) {
    const sc = chartScenario('cup-and-handle', { seed });
    const [lr] = kp(sc, 'Left rim');
    const [rr] = kp(sc, 'Right rim');
    const [bot] = kp(sc, 'Cup bottom');
    const [h] = kp(sc, 'Handle');
    assert.ok(lr && rr && bot && h);
    assert.ok(pct(lr.price, rr.price) < 0.01, 'rims level');
    assert.equal(sc.neckline.y1, lr.price);
    const depth = lr.price - bot.price;
    assert.ok(depth / lr.price > 0.08 && depth / lr.price < 0.17);
    assert.ok(rr.price - h.price < depth * 0.5, 'handle in the upper half of the cup');
    assert.ok(h.idx - rr.idx < rr.idx - lr.idx, 'handle shorter than the cup');
    // Rounded: the middle third of the cup stays in the lower half.
    const third = Math.round((rr.idx - lr.idx) / 3);
    for (let i = lr.idx + third; i <= rr.idx - third; i++) assert.ok(sc.candles[i].c < lr.price - depth * 0.4, `cup ${seed} not rounded at ${i}`);
    const rb = chartScenario('rounding-bottom', { seed });
    const [lip] = kp(rb, 'Left lip');
    const [b2] = kp(rb, 'Bottom');
    assert.ok(lip && b2 && b2.price < lip.price * 0.92);
    assert.equal(rb.neckline.y1, lip.price);
    const rt = chartScenario('rounding-top', { seed });
    const [rtLip] = kp(rt, 'Left lip');
    const [top] = kp(rt, 'Top');
    assert.ok(rtLip && top && top.price > rtLip.price * 1.08);
    assert.equal(rt.neckline.y1, rtLip.price);
  }
});

test('chartScenario: deterministic, scales with start, supports other counts', () => {
  assert.deepEqual(chartScenario('double-top', { seed: 4 }), chartScenario('double-top', { seed: 4 }));
  const a = chartScenario('bull-flag', { seed: 4 });
  const b = chartScenario('bull-flag', { seed: 4, start: 1.085 });
  assert.ok(Math.abs(b.target / a.target - 0.01085) < 1e-9);
  const c = chartScenario('head-and-shoulders', { seed: 4, count: 160, after: 30 });
  assert.equal(c.candles.length, 160);
  assert.ok(c.breakoutIdx < 130);
  const d = chartScenario('triple-bottom', { seed: 4, after: 0 });
  assert.equal(d.candles.length, 110);
  assert.ok(d.breakoutIdx >= 100);
  assert.throws(() => chartScenario('nope', { seed: 1 }));
});
