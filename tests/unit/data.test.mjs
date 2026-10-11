import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomWalk, fromPath, trendSeries, aggregate, addVolume, scale, shift, roundPrice, isValidCandle, reindex, concat } from '../../js/core/data.js';
import { swings, trendOf } from '../../js/core/indicators.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 1);

function assertValid(candles, msg) {
  candles.forEach((c, i) => {
    assert.ok(isValidCandle(c), `${msg}: invalid candle ${i} ${JSON.stringify(c)}`);
    assert.ok(Number.isFinite(c.v) && c.v >= 0, `${msg}: bad volume at ${i}`);
    assert.equal(c.t, i, `${msg}: t must equal index`);
  });
}

test('randomWalk: valid OHLC across 200 seeds, deterministic, realistic opens', () => {
  for (const seed of SEEDS) {
    const cs = randomWalk({ seed, count: 150 });
    assert.equal(cs.length, 150);
    assertValid(cs, `seed ${seed}`);
    // Opens sit near the previous close (gaps are rare and small).
    let bigGaps = 0;
    for (let i = 1; i < cs.length; i++) {
      const range = cs[i - 1].h - cs[i - 1].l;
      if (Math.abs(cs[i].o - cs[i - 1].c) > range) bigGaps++;
    }
    assert.ok(bigGaps <= 3, `too many gaps (${bigGaps}) for seed ${seed}`);
  }
  assert.deepEqual(randomWalk({ seed: 5 }), randomWalk({ seed: 5 }));
  assert.notDeepEqual(randomWalk({ seed: 5 }), randomWalk({ seed: 6 }));
});

test('randomWalk: drift moves price in its direction; volume optional', () => {
  let up = 0;
  for (const seed of SEEDS.slice(0, 50)) {
    const cs = randomWalk({ seed, count: 200, drift: 0.004, vol: 0.01 });
    if (cs[cs.length - 1].c > cs[0].o) up++;
  }
  assert.ok(up >= 45, `drift up won only ${up}/50`);
  const nv = randomWalk({ seed: 3, volume: false });
  assert.ok(nv.every((c) => c.v === 0));
  assert.ok(randomWalk({ seed: 3 }).every((c) => Number.isInteger(c.v) && c.v > 0));
});

test('randomWalk stays positive even with violent volatility', () => {
  for (const seed of SEEDS.slice(0, 40)) assertValid(randomWalk({ seed, count: 300, vol: 0.2, drift: -0.02 }), `seed ${seed}`);
});

const PATHS = [
  [[0, 90], [0.2, 100], [0.35, 95], [0.5, 106], [0.65, 95.5], [0.8, 100.5], [1, 91]],
  [[0, 100], [0.3, 110], [0.6, 104], [1, 118]],
  [[0.1, 1.085], [0.4, 1.0912], [0.7, 1.0801], [0.9, 1.089]],
  [[0, 50], [0.5, 40], [1, 60]],
];

test('fromPath: anchors hit exactly and are the local extreme within ±3 bars (200 seeds)', () => {
  for (const seed of SEEDS) {
    for (const pts of PATHS) {
      const { candles, anchors } = fromPath(pts, { seed, count: 110, start: pts[0][1] });
      assert.equal(candles.length, 110);
      assertValid(candles, `seed ${seed}`);
      assert.equal(anchors.length, pts.length, 'one anchor per point');
      anchors.forEach((a, k) => {
        assert.equal(a.price, pts[k][1]);
        const c = candles[a.idx];
        if (a.kind === 'high') {
          assert.equal(c.h, a.price, `high anchor exact (seed ${seed})`);
          for (let j = a.idx - 3; j <= a.idx + 3; j++) {
            if (j === a.idx || !candles[j]) continue;
            assert.ok(candles[j].h < a.price, `neighbour ${j} exceeds peak ${a.idx} (seed ${seed})`);
          }
        } else if (a.kind === 'low') {
          assert.equal(c.l, a.price, `low anchor exact (seed ${seed})`);
          for (let j = a.idx - 3; j <= a.idx + 3; j++) {
            if (j === a.idx || !candles[j]) continue;
            assert.ok(candles[j].l > a.price, `neighbour ${j} undercuts trough ${a.idx} (seed ${seed})`);
          }
        } else {
          assert.equal(c.c, a.price, 'mid anchor: close exact');
        }
      });
    }
  }
});

test('fromPath: anchor kinds and index mapping', () => {
  const { anchors } = fromPath([[0, 90], [0.25, 100], [0.5, 95], [0.75, 97], [1, 110]], { seed: 1, count: 101 });
  assert.deepEqual(anchors.map((a) => a.kind), ['mid', 'high', 'low', 'mid', 'mid']);
  assert.deepEqual(anchors.map((a) => a.idx), [0, 25, 50, 75, 100]);
  // Points that map to the same candle are spread apart.
  const r = fromPath([[0.5, 100], [0.5, 101], [0.5, 102]], { seed: 1, count: 10 });
  const idxs = r.anchors.map((a) => a.idx);
  assert.equal(new Set(idxs).size, 3);
});

test('fromPath: closes follow the path (shape stays readable)', () => {
  for (const seed of SEEDS.slice(0, 60)) {
    const { candles } = fromPath([[0, 100], [0.5, 120], [1, 100]], { seed, count: 81 });
    // Mid-leg closes stay within 25% of the leg height of the straight path.
    for (let i = 5; i < 76; i++) {
      const base = i <= 40 ? 100 + (20 * i) / 40 : 120 - (20 * (i - 40)) / 40;
      assert.ok(Math.abs(candles[i].c - base) < 5, `close ${i} strays (seed ${seed})`);
    }
    // Realistic: a trend leg still contains some counter-trend candles.
    const counter = candles.slice(1, 40).filter((c) => c.c < c.o).length;
    assert.ok(counter >= 2 && counter <= 20, `counter-trend candles ${counter}`);
  }
});

test('fromPath: exact = false still valid; noise scales with the move', () => {
  for (const seed of SEEDS.slice(0, 40)) assertValid(fromPath([[0, 100], [1, 130]], { seed, count: 60, exact: false }).candles, 'inexact');
  const avgRange = (cs) => cs.reduce((s, c) => s + c.h - c.l, 0) / cs.length;
  const small = fromPath([[0, 100], [1, 102]], { seed: 4, count: 60 }).candles;
  const big = fromPath([[0, 100], [1, 140]], { seed: 4, count: 60 }).candles;
  assert.ok(avgRange(big) > 4 * avgRange(small));
});

test('trendSeries: clean HH/HL, LH/LL structure whose swings match the candles (200 seeds)', () => {
  for (const seed of SEEDS) {
    for (const direction of ['up', 'down', 'range']) {
      const { candles, swings: sw } = trendSeries({ seed, direction, count: 80, swings: 4 });
      assertValid(candles, `${direction} ${seed}`);
      assert.equal(sw.length, 8);
      for (let i = 1; i < sw.length; i++) {
        assert.notEqual(sw[i].type, sw[i - 1].type, 'swings alternate');
        assert.ok(sw[i].idx - sw[i - 1].idx >= 4, 'legs are at least 4 bars');
      }
      for (const s of sw) {
        const c = candles[s.idx];
        assert.equal(s.type === 'high' ? c.h : c.l, s.price, 'swing price is the candle extreme');
        for (let j = s.idx - 3; j <= s.idx + 3; j++) {
          if (j === s.idx || !candles[j]) continue;
          if (s.type === 'high') assert.ok(candles[j].h < s.price);
          else assert.ok(candles[j].l > s.price);
        }
      }
      const labels = sw.map((s) => s.label);
      assert.deepEqual(labels.slice(0, 2).sort(), ['H', 'L']);
      if (direction === 'up') assert.ok(labels.slice(2).every((l) => l === 'HH' || l === 'HL'), labels.join(' '));
      if (direction === 'down') assert.ok(labels.slice(2).every((l) => l === 'LH' || l === 'LL'), labels.join(' '));
      // indicators.swings finds every structural swing.
      const found = swings(candles, { left: 3, right: 3 });
      for (const s of sw) assert.ok(found.some((f) => f.idx === s.idx && f.type === s.type), `swing ${s.idx} detected`);
    }
  }
});

test('trendSeries: trendOf agrees with the requested direction', () => {
  let ok = 0;
  let n = 0;
  for (const seed of SEEDS.slice(0, 100)) {
    for (const direction of ['up', 'down']) {
      n++;
      if (trendOf(trendSeries({ seed, direction }).candles) === direction) ok++;
    }
  }
  assert.ok(ok / n >= 0.97, `trendOf matched ${ok}/${n}`);
});

test('aggregate: correct OHLCV per group, partial last group', () => {
  const cs = randomWalk({ seed: 3, count: 23 });
  const agg = aggregate(cs, 5);
  assert.equal(agg.length, 5);
  agg.forEach((a, k) => {
    const g = cs.slice(k * 5, k * 5 + 5);
    assert.equal(a.o, g[0].o);
    assert.equal(a.c, g[g.length - 1].c);
    assert.equal(a.h, Math.max(...g.map((c) => c.h)));
    assert.equal(a.l, Math.min(...g.map((c) => c.l)));
    assert.equal(a.v, g.reduce((s, c) => s + c.v, 0));
    assert.equal(a.t, k);
    assert.ok(isValidCandle(a));
  });
  assert.equal(aggregate(cs, 5, { partial: false }).length, 4);
  assert.deepEqual(aggregate(cs, 1).map((c) => c.c), cs.map((c) => c.c));
});

test('addVolume: positive integers, bigger candles tend to carry more volume', () => {
  const cs = randomWalk({ seed: 21, count: 400, volume: false });
  const v = addVolume(cs, { seed: 1, base: 1000 });
  assert.ok(v.every((c) => Number.isInteger(c.v) && c.v > 0));
  const sorted = [...v].sort((a, b) => a.h - a.l - (b.h - b.l));
  const small = sorted.slice(0, 100).reduce((s, c) => s + c.v, 0);
  const large = sorted.slice(-100).reduce((s, c) => s + c.v, 0);
  assert.ok(large > small * 1.5);
  assert.deepEqual(v.map((c) => c.c), cs.map((c) => c.c), 'prices untouched');
});

test('scale / shift / roundPrice / reindex / concat', () => {
  const cs = randomWalk({ seed: 2, count: 5 });
  const s2 = scale(cs, 2);
  assert.equal(s2[3].h, cs[3].h * 2);
  assert.equal(s2[3].v, cs[3].v);
  const sh = shift(cs, 10);
  assert.equal(sh[1].l, cs[1].l + 10);
  assert.equal(roundPrice(1.23456, 2), 1.23);
  assert.equal(roundPrice(1.08456, 4), 1.0846);
  assert.deepEqual(reindex(cs.slice(2)).map((c) => c.t), [0, 1, 2]);
  assert.deepEqual(concat(cs.slice(0, 2), cs.slice(3)).map((c) => c.t), [0, 1, 2, 3]);
});
