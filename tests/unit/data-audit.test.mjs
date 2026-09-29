// Adversarial checks for js/core/data.js: OHLC validity across 1000 seeds for every generator,
// determinism, exact anchors that are the true swing extremes, trend structure that matches the
// candles, and exact timeframe aggregation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomWalk, fromPath, trendSeries, aggregate, synthesize, addVolume, isValidCandle, concat } from '../../js/core/data.js';
import { swings, labelStructure } from '../../js/core/indicators.js';

const valid = (c) =>
  c &&
  [c.o, c.h, c.l, c.c].every((v) => Number.isFinite(v) && v > 0) &&
  c.l <= Math.min(c.o, c.c) &&
  Math.max(c.o, c.c) <= c.h &&
  Number.isFinite(c.v) &&
  c.v >= 0;

function assertSeries(cs, msg) {
  for (let i = 0; i < cs.length; i++) {
    if (!valid(cs[i])) assert.fail(`${msg}: invalid candle ${i} ${JSON.stringify(cs[i])}`);
    if (cs[i].t !== i) assert.fail(`${msg}: t ${cs[i].t} at ${i}`);
  }
}

test('every generator produces valid, finite, positive OHLC for 1000 seeds', () => {
  const paths = [
    [[0, 100], [0.25, 110], [0.5, 96], [0.75, 112], [1, 104]],
    [[0, 1.085], [0.3, 1.0912], [0.6, 1.0801], [1, 1.0899]],
    [[0, 2500], [0.5, 2380], [1, 2610]],
    [[0, 25], [0.2, 24.1], [0.4, 26], [0.6, 24.3], [0.8, 26.4], [1, 25.2]],
  ];
  for (let seed = 1; seed <= 1000; seed++) {
    const start = [100, 1.085, 25, 2500][seed % 4];
    assertSeries(randomWalk({ seed, count: 60, start, vol: seed % 7 === 0 ? 0.08 : 0.012 }), `walk ${seed}`);
    const pts = paths[seed % paths.length];
    const fp = fromPath(pts, { seed, count: 70, exact: seed % 5 !== 0 });
    assertSeries(fp.candles, `path ${seed}`);
    const dir = ['up', 'down', 'range'][seed % 3];
    assertSeries(trendSeries({ seed, count: 60, start, direction: dir, swings: 3 + (seed % 3) }).candles, `trend ${seed}`);
  }
  // Extreme inputs stay valid (huge volatility, crash towards zero, one candle, flat path).
  for (let seed = 1; seed <= 50; seed++) {
    assertSeries(randomWalk({ seed, count: 200, vol: 0.25, drift: -0.05 }), 'crash');
    assertSeries(fromPath([[0, 5], [1, 0.001]], { seed, count: 40 }).candles, 'to zero');
    assertSeries(fromPath([[0, 50], [1, 50]], { seed, count: 30 }).candles, 'flat');
  }
  assertSeries(randomWalk({ seed: 1, count: 1 }), 'one');
  assert.equal(fromPath([], { seed: 1, count: 10, start: 42 }).candles.length, 10);
});

test('generators are deterministic by seed and differ across seeds', () => {
  for (const seed of [1, 42, 'lesson-7', 4294967295]) {
    assert.deepEqual(randomWalk({ seed }), randomWalk({ seed }));
    assert.deepEqual(fromPath([[0, 100], [0.5, 110], [1, 95]], { seed }), fromPath([[0, 100], [0.5, 110], [1, 95]], { seed }));
    assert.deepEqual(trendSeries({ seed, direction: 'down' }), trendSeries({ seed, direction: 'down' }));
  }
  assert.notDeepEqual(trendSeries({ seed: 1 }).candles, trendSeries({ seed: 2 }).candles);
  // Generators do not mutate their inputs.
  const pts = [[0, 100], [0.5, 110], [1, 95]];
  const copy = JSON.stringify(pts);
  fromPath(pts, { seed: 3 });
  assert.equal(JSON.stringify(pts), copy);
});

test('fromPath: every peak is the highest high of its whole swing, every trough the lowest low', () => {
  const shapes = [
    [[0, 90], [0.14, 100], [0.28, 94], [0.42, 106], [0.56, 95], [0.7, 100.5], [0.85, 93], [1, 97]], // H&S-like
    [[0, 100], [0.12, 96], [0.3, 88], [0.5, 86.8], [0.7, 88], [0.88, 96], [1, 99]], // rounded bottom
    [[0, 1.08], [0.25, 1.0912], [0.5, 1.0831], [0.75, 1.0909], [1, 1.0851]], // FX double top
  ];
  for (let seed = 1; seed <= 300; seed++) {
    for (const pts of shapes) {
      const { candles, anchors } = fromPath(pts, { seed, count: 100 });
      anchors.forEach((a, k) => {
        if (a.kind === 'mid') {
          assert.equal(candles[a.idx].c, a.price, 'mid anchors are hit by the close');
          return;
        }
        const opp = a.kind === 'high' ? 'low' : 'high';
        let lo = 0;
        for (let q = k - 1; q >= 0; q--) if (anchors[q].kind === opp) { lo = anchors[q].idx; break; }
        let hi = candles.length - 1;
        for (let q = k + 1; q < anchors.length; q++) if (anchors[q].kind === opp) { hi = anchors[q].idx; break; }
        const c = candles[a.idx];
        assert.equal(a.kind === 'high' ? c.h : c.l, a.price, `exact ${a.kind} (seed ${seed})`);
        for (let j = lo; j <= hi; j++) {
          if (j === a.idx) continue;
          if (a.kind === 'high') assert.ok(candles[j].h < a.price, `seed ${seed}: bar ${j} above peak ${a.idx}`);
          else assert.ok(candles[j].l > a.price, `seed ${seed}: bar ${j} below trough ${a.idx}`);
        }
      });
    }
  }
});

test('trendSeries: labels match the candles and indicators agree with the structure', () => {
  for (let seed = 1; seed <= 300; seed++) {
    for (const direction of ['up', 'down', 'range']) {
      const { candles, swings: sw } = trendSeries({ seed, direction, count: 90, swings: 4 });
      // Labels are exactly what labelStructure says about these swing prices.
      const re = labelStructure(sw.map(({ idx, price, type }) => ({ idx, price, type })));
      assert.deepEqual(re.map((s) => s.label), sw.map((s) => s.label));
      // Alternating swings, each the extreme of the candles between its neighbours.
      for (let i = 0; i < sw.length; i++) {
        const s = sw[i];
        if (i) assert.notEqual(s.type, sw[i - 1].type);
        const a = i ? sw[i - 1].idx : 0;
        const b = i < sw.length - 1 ? sw[i + 1].idx : candles.length - 1;
        for (let j = a; j <= b; j++) {
          if (j === s.idx) continue;
          if (s.type === 'high') assert.ok(candles[j].h < s.price, `${direction} ${seed}: ${j} above swing high ${s.idx}`);
          else assert.ok(candles[j].l > s.price, `${direction} ${seed}: ${j} below swing low ${s.idx}`);
        }
      }
      // indicators.swings(3/3) finds every structural swing.
      const found = swings(candles, { left: 3, right: 3 });
      for (const s of sw) assert.ok(found.some((f) => f.idx === s.idx && f.type === s.type), `${direction} ${seed}: swing ${s.idx}`);
      if (direction === 'up') assert.ok(sw.slice(2).every((s) => s.label === 'HH' || s.label === 'HL'));
      if (direction === 'down') assert.ok(sw.slice(2).every((s) => s.label === 'LH' || s.label === 'LL'));
      if (direction === 'range') {
        const highs = sw.filter((s) => s.type === 'high').map((s) => s.price);
        const lows = sw.filter((s) => s.type === 'low').map((s) => s.price);
        assert.ok(Math.min(...highs) > Math.max(...lows), 'range: every high above every low');
        assert.ok((Math.max(...highs) - Math.min(...highs)) / 100 < 0.012, 'range: highs form a ceiling');
      }
    }
  }
});

test('aggregate: exact OHLCV per group, partial group, composes (2 × 3 = 6)', () => {
  for (const seed of [1, 2, 3]) {
    const cs = randomWalk({ seed, count: 97 });
    for (const f of [1, 2, 3, 4, 5, 7, 24, 97, 200]) {
      const agg = aggregate(cs, f);
      assert.equal(agg.length, Math.ceil(97 / f));
      agg.forEach((a, k) => {
        const g = cs.slice(k * f, k * f + f);
        assert.deepEqual(a, {
          o: g[0].o,
          h: Math.max(...g.map((c) => c.h)),
          l: Math.min(...g.map((c) => c.l)),
          c: g[g.length - 1].c,
          v: g.reduce((s, c) => s + c.v, 0),
          t: k,
        });
        assert.ok(isValidCandle(a));
      });
      assert.equal(aggregate(cs, f, { partial: false }).length, Math.floor(97 / f));
    }
    const full = cs.slice(0, 96);
    assert.deepEqual(aggregate(aggregate(full, 2), 3), aggregate(full, 6));
  }
  assert.deepEqual(aggregate([], 4), []);
});

test('synthesize: opens at the previous close (rare gaps), wicks enclose the body', () => {
  const closes = Array.from({ length: 400 }, (_, i) => 100 + 5 * Math.sin(i / 9) + i * 0.02);
  const cs = synthesize(closes, { seed: 5, scale: 0.6 });
  assert.equal(cs.length, 400);
  cs.forEach((c, i) => {
    assert.ok(isValidCandle(c));
    assert.equal(c.c, closes[i]);
  });
  let gaps = 0;
  for (let i = 1; i < cs.length; i++) if (Math.abs(cs[i].o - cs[i - 1].c) > 0.2) gaps++;
  assert.ok(gaps <= 20, `gaps ${gaps}`);
  // Volume is added deterministically and positive.
  const v = addVolume(cs, { seed: 1 });
  assert.ok(v.every((c) => Number.isInteger(c.v) && c.v >= 1));
  assert.deepEqual(v, addVolume(cs, { seed: 1 }));
  assert.equal(concat(cs.slice(0, 3), cs.slice(10, 12)).length, 5);
});
