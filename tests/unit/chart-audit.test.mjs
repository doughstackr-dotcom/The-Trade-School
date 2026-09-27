// Adversarial checks for the chart-pattern side of js/core/patterns.js: explicit textbook
// geometry for every pattern over 200 seeds, key points on the real swing extremes, a clean
// formation, a decisive breakout, measured-move targets, and outcomes (and volume) that behave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHART_PATTERNS, CHART_PATTERN_IDS, chartScenario } from '../../js/core/patterns.js';
import { linearRegression } from '../../js/core/indicators.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 104729 + 17);
const lineAt = (ln, x) => ln.y1 + ((ln.y2 - ln.y1) * (x - ln.x1)) / (ln.x2 - ln.x1 || 1);
const slopeOf = (ln) => (ln.y2 - ln.y1) / (ln.x2 - ln.x1);
const kp = (sc, label) => sc.keyPoints.filter((k) => k.label === label);
const one = (sc, label) => {
  const [k] = kp(sc, label);
  assert.ok(k, `${sc.id}: missing key point ${label}`);
  return k;
};
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const brokenLine = (sc) => sc.neckline || (sc.direction > 0 ? sc.boundaries.upper : sc.boundaries.lower);
const avgRange = (cs, a, b) => cs.slice(a, b + 1).reduce((s, k) => s + k.h - k.l, 0) / (b - a + 1);
const avgVol = (cs, a, b) => cs.slice(a, b).reduce((s, k) => s + k.v, 0) / Math.max(1, b - a);

const cache = new Map();
function scenario(id, seed, outcome = 'success') {
  const key = `${id}|${seed}|${outcome}`;
  if (!cache.has(key)) cache.set(key, chartScenario(id, { seed, outcome }));
  return cache.get(key);
}

test('every scenario: clean formation, decisive breakout, measured move, outcome behaves', () => {
  for (const id of CHART_PATTERN_IDS) {
    for (const seed of SEEDS) {
      for (const outcome of ['success', 'fail']) {
        const sc = scenario(id, seed, outcome);
        const cs = sc.candles;
        const msg = `${id} seed ${seed} ${outcome}`;
        const dir = sc.direction;
        const line = brokenLine(sc);
        const first = line.x1; // where the neckline / boundary starts
        assert.equal(sc.patternEnd, sc.breakoutIdx - 1, msg);
        assert.ok(sc.breakoutIdx <= cs.length - 20, `${msg}: breakout inside the setup`);
        // No close beyond the broken line before the breakout; inside both lines for
        // triangles / wedges / flags.
        for (let i = first; i < sc.breakoutIdx; i++) {
          if ((cs[i].c - lineAt(line, i)) * dir >= 0) assert.fail(`${msg}: close ${i} beyond the line before the breakout`);
          if (sc.boundaries) {
            const u = lineAt(sc.boundaries.upper, i);
            const l = lineAt(sc.boundaries.lower, i);
            if (cs[i].c > u || cs[i].c < l) assert.fail(`${msg}: close ${i} outside the boundaries`);
          }
        }
        // The breakout candle closes decisively beyond the line.
        const bo = cs[sc.breakoutIdx];
        const R = avgRange(cs, sc.patternStart, sc.breakoutIdx);
        assert.ok((bo.c - sc.level) * dir >= Math.max(0.3 * R, 0.05 * sc.height) - 1e-9, `${msg}: marginal breakout`);
        assert.equal(one(sc, 'Breakout').price, bo.c);
        // Measured move.
        assert.ok(Math.abs(sc.target - (sc.level + dir * sc.height)) < 1e-9, `${msg}: target`);
        assert.ok(Math.abs(sc.level - lineAt(line, sc.breakoutIdx)) < 1e-9, `${msg}: level`);
        assert.ok((sc.target - bo.c) * dir > 0, `${msg}: target beyond the breakout close`);
        const after = cs.slice(sc.breakoutIdx + 1);
        if (outcome === 'success') {
          assert.equal(sc.reachedTarget, true, `${msg}: target not reached`);
          assert.ok(after.some((k) => (dir > 0 ? k.h : -k.l) >= dir * sc.target), `${msg}: no candle at the target`);
          // A successful breakout holds: no close back through the broken level.
          after.forEach((k, j) => assert.ok((k.c - sc.level) * dir > 0, `${msg}: close ${sc.breakoutIdx + 1 + j} back inside`));
        } else {
          assert.equal(sc.reachedTarget, false, `${msg}: a failed breakout reached the target`);
          assert.ok(after.slice(0, 5).some((k) => (k.c - sc.level) * dir > 0), `${msg}: the trap never looked like a breakout`);
          const last = cs[cs.length - 1].c;
          assert.ok((last - sc.level) * dir < -0.3 * sc.height, `${msg}: failure does not reverse back through the pattern`);
        }
      }
    }
  }
});

test('key points sit on the real swing extremes (highest high / lowest low of their swing)', () => {
  for (const id of CHART_PATTERN_IDS) {
    for (const seed of SEEDS) {
      const sc = scenario(id, seed);
      const cs = sc.candles;
      const kps = sc.keyPoints.filter((k) => k.label !== 'Breakout');
      kps.forEach((k, j) => {
        const c = cs[k.idx];
        const isHigh = c.h === k.price;
        const isLow = c.l === k.price;
        assert.ok(isHigh || isLow, `${id} seed ${seed}: ${k.label}@${k.idx} is not a candle high/low`);
        const a = j > 0 ? kps[j - 1].idx : Math.max(0, k.idx - 3);
        const b = j < kps.length - 1 ? kps[j + 1].idx : sc.breakoutIdx;
        for (let i = a; i <= b; i++) {
          if (i === k.idx) continue;
          if (isHigh) assert.ok(cs[i].h < k.price, `${id} seed ${seed}: bar ${i} above ${k.label}@${k.idx}`);
          else assert.ok(cs[i].l > k.price, `${id} seed ${seed}: bar ${i} below ${k.label}@${k.idx}`);
        }
      });
      for (let j = 1; j < sc.keyPoints.length; j++) assert.ok(sc.keyPoints[j].idx > sc.keyPoints[j - 1].idx, 'ordered');
    }
  }
});

test('reversal patterns follow a prior trend; continuations break with it', () => {
  for (const id of CHART_PATTERN_IDS) {
    const P = CHART_PATTERNS[id];
    for (const seed of SEEDS.slice(0, 100)) {
      const sc = scenario(id, seed);
      const k0 = sc.keyPoints[0].idx;
      const prior = sc.candles.slice(0, k0 + 1).map((k) => k.c);
      const { slope } = linearRegression(prior);
      const R = avgRange(sc.candles, 0, k0);
      const move = (slope * (prior.length - 1)) / R;
      // Reversals reverse the prior trend; continuations continue it.
      const expected = P.kind === 'reversal' ? -sc.direction : sc.direction;
      assert.ok(move * expected > 1.5, `${id} seed ${seed}: prior trend ${move.toFixed(2)} ranges`);
      if (id !== 'symmetrical-triangle') assert.equal(sc.bias, P.bias);
    }
  }
});

test('head and shoulders (and inverse): head clearly beyond level shoulders, neckline between', () => {
  for (const id of ['head-and-shoulders', 'inverse-head-and-shoulders']) {
    const s = id === 'head-and-shoulders' ? 1 : -1;
    for (const seed of SEEDS) {
      const sc = scenario(id, seed);
      const L = one(sc, 'Left shoulder');
      const H = one(sc, 'Head');
      const R = one(sc, 'Right shoulder');
      const [N1, N2] = kp(sc, 'Neckline');
      assert.ok(L.idx < N1.idx && N1.idx < H.idx && H.idx < N2.idx && N2.idx < R.idx && R.idx < sc.breakoutIdx);
      for (const sh of [L, R]) assert.ok(((H.price - sh.price) * s) / sh.price >= 0.03, `${id} seed ${seed}: head barely beyond a shoulder`);
      assert.ok(rel(L.price, R.price) <= 0.05, `${id} seed ${seed}: shoulders ${L.price} / ${R.price}`);
      // Shoulders stand well clear of the neckline (at least a third of the head's height).
      const hh = Math.abs(H.price - lineAt(sc.neckline, H.idx));
      for (const sh of [L, R]) assert.ok(Math.abs(sh.price - lineAt(sc.neckline, sh.idx)) > hh * 0.25, `${id} seed ${seed}: flat shoulder`);
      for (const nk of [N1, N2]) assert.ok(Math.abs(lineAt(sc.neckline, nk.idx) - nk.price) < 1e-9, 'neckline through the troughs');
      assert.equal(sc.neckline.x1, L.idx);
      assert.equal(sc.neckline.x2, sc.breakoutIdx);
      assert.ok(Math.abs(sc.height - hh) < 1e-9, 'height = head to neckline');
      assert.equal(sc.direction, -s);
      assert.ok((sc.candles[sc.breakoutIdx].c - lineAt(sc.neckline, sc.breakoutIdx)) * s < 0, 'breakout closes through the neckline');
    }
  }
});

test('double / triple tops and bottoms: level extremes, a meaningful trough/peak between', () => {
  const cases = [
    ['double-top', ['Top 1', 'Top 2'], 1],
    ['double-bottom', ['Bottom 1', 'Bottom 2'], -1],
    ['triple-top', ['Top 1', 'Top 2', 'Top 3'], 1],
    ['triple-bottom', ['Bottom 1', 'Bottom 2', 'Bottom 3'], -1],
  ];
  for (const [id, labels, s] of cases) {
    for (const seed of SEEDS) {
      const sc = scenario(id, seed);
      const ext = labels.map((l) => one(sc, l));
      const px = ext.map((e) => e.price);
      assert.ok((Math.max(...px) - Math.min(...px)) / Math.min(...px) <= 0.02, `${id} seed ${seed}: extremes not level`);
      const necks = kp(sc, 'Neckline');
      assert.equal(necks.length, labels.length - 1);
      necks.forEach((n, j) => {
        assert.ok(ext[j].idx < n.idx && n.idx < ext[j + 1].idx, 'neckline point between the extremes');
        const depth = (Math.min(...px.map((p) => p * s)) - n.price * s) / Math.abs(n.price);
        assert.ok(depth >= 0.03, `${id} seed ${seed}: trough/peak between only ${(depth * 100).toFixed(1)}%`);
      });
      if (id.startsWith('double')) assert.ok(sc.neckline.y1 === necks[0].price && sc.neckline.y2 === necks[0].price, 'horizontal neckline');
      // Height: from the most extreme top/bottom to the neckline.
      const hh = Math.max(...ext.map((e) => Math.abs(e.price - lineAt(sc.neckline, e.idx))));
      assert.ok(Math.abs(sc.height - hh) < 1e-9);
      // Two (three) separate swings: the extremes are several bars apart.
      for (let j = 1; j < ext.length; j++) assert.ok(ext[j].idx - ext[j - 1].idx >= 10, `${id} seed ${seed}: extremes too close`);
    }
  }
});

test('triangles and wedges: slopes, convergence, touches on the lines', () => {
  const rules = {
    'rising-wedge': (u, l) => u > 0 && l > u,
    'falling-wedge': (u, l) => l < 0 && u < l,
    'ascending-triangle': (u, l) => u === 0 && l > 0,
    'descending-triangle': (u, l) => l === 0 && u < 0,
    'symmetrical-triangle': (u, l) => u < 0 && l > 0,
  };
  for (const [id, ok] of Object.entries(rules)) {
    for (const seed of SEEDS) {
      const sc = scenario(id, seed);
      const { upper, lower } = sc.boundaries;
      const su = slopeOf(upper);
      const sl = slopeOf(lower);
      assert.ok(ok(su, sl), `${id} seed ${seed}: slopes ${su} / ${sl}`);
      const w0 = upper.y1 - lower.y1;
      const w1 = upper.y2 - lower.y2;
      assert.ok(w0 > 0 && w1 > 0 && w1 < 0.75 * w0, `${id} seed ${seed}: not converging`);
      assert.ok(Math.abs(sc.height - w0) < 1e-9, 'height = widest part');
      // At least two touches of each line, alternating between the lines.
      const touches = sc.keyPoints.filter((k) => k.label !== 'Breakout');
      const onUpper = touches.filter((k) => Math.abs(lineAt(upper, k.idx) - k.price) < 1e-6 * k.price);
      const onLower = touches.filter((k) => Math.abs(lineAt(lower, k.idx) - k.price) < 1e-6 * k.price);
      assert.ok(onUpper.length >= 2 && onLower.length >= 2, `${id} seed ${seed}: touches`);
      for (const t of touches) assert.ok(t.price <= lineAt(upper, t.idx) + 1e-9 && t.price >= lineAt(lower, t.idx) - 1e-9);
      // The pattern is several swings long and the breakout happens before the apex.
      assert.ok(sc.breakoutIdx - upper.x1 >= 30, `${id} seed ${seed}: too short`);
      if (id.includes('wedge')) {
        // Wedges run with (not against) their slope for most of the formation.
        const mid = Math.round((upper.x1 + sc.breakoutIdx) / 2);
        const s0 = (lineAt(upper, mid) + lineAt(lower, mid)) / 2 - (upper.y1 + lower.y1) / 2;
        assert.ok(s0 * (id === 'rising-wedge' ? 1 : -1) > 0);
      }
    }
  }
});

test('symmetrical triangle breaks both ways, in the direction of the prior trend', () => {
  const dirs = { 1: 0, [-1]: 0 };
  for (const seed of SEEDS) {
    const sc = scenario('symmetrical-triangle', seed);
    dirs[sc.direction]++;
    assert.equal(sc.bias, sc.direction > 0 ? 'bullish' : 'bearish');
  }
  assert.ok(dirs[1] > 50 && dirs[-1] > 50, JSON.stringify(dirs));
});

test('flags: a sharp pole, then a short, shallow channel sloping against it', () => {
  for (const [id, s] of [['bull-flag', 1], ['bear-flag', -1]]) {
    for (const seed of SEEDS) {
      const sc = scenario(id, seed);
      const ps = one(sc, 'Flagpole start');
      const pt = one(sc, s > 0 ? 'Flagpole top' : 'Flagpole bottom');
      const pole = (pt.price - ps.price) * s;
      const poleBars = pt.idx - ps.idx;
      const flagBars = sc.breakoutIdx - pt.idx;
      assert.ok(pole / ps.price >= 0.07, `${id} seed ${seed}: pole only ${(100 * pole / ps.price).toFixed(1)}%`);
      assert.ok(Math.abs(sc.height - pole) < 1e-9, 'height = pole');
      assert.ok(flagBars <= 2.2 * poleBars, `${id} seed ${seed}: flag ${flagBars} bars vs pole ${poleBars}`);
      const { upper, lower } = sc.boundaries;
      assert.ok(slopeOf(upper) * s < 0 && slopeOf(lower) * s < 0, 'flag slopes against the pole');
      assert.ok(Math.abs(slopeOf(upper) - slopeOf(lower)) < 0.35 * Math.abs(slopeOf(upper)) + 1e-9, 'roughly parallel channel');
      const poleSlope = pole / poleBars;
      assert.ok(poleSlope > 4 * Math.abs(slopeOf(upper)), `${id} seed ${seed}: pole not much steeper than the flag`);
      // Prior trend is gentler than the pole.
      const pre = sc.candles.slice(0, ps.idx + 1).map((k) => k.c);
      assert.ok(Math.abs(linearRegression(pre).slope) < poleSlope / 2.5, `${id} seed ${seed}: pole does not stand out`);
      const flagExt = Math.max(...sc.candles.slice(pt.idx + 1, sc.breakoutIdx).map((k) => (pt.price - (s > 0 ? k.l : k.h)) * s));
      assert.ok(flagExt < 0.5 * pole, `${id} seed ${seed}: flag retraces ${(flagExt / pole).toFixed(2)} of the pole`);
    }
  }
});

test('cup and handle / rounding bottom: rounded base, small handle, rim neckline', () => {
  for (const seed of SEEDS) {
    const sc = scenario('cup-and-handle', seed);
    const lr = one(sc, 'Left rim');
    const rr = one(sc, 'Right rim');
    const bot = one(sc, 'Cup bottom');
    const h = one(sc, 'Handle');
    const depth = lr.price - bot.price;
    assert.ok(rel(lr.price, rr.price) < 0.01, 'rims level');
    assert.ok(depth / lr.price >= 0.08 && depth / lr.price <= 0.17, 'cup depth 8–17%');
    const cupBars = rr.idx - lr.idx;
    assert.ok(Math.abs(bot.idx - (lr.idx + cupBars / 2)) <= cupBars / 6, 'bottom in the middle of the cup (U, not V)');
    // Rounded: the whole middle third of the cup stays in its lower half.
    const third = Math.round(cupBars / 3);
    for (let i = lr.idx + third; i <= rr.idx - third; i++) assert.ok(sc.candles[i].c < lr.price - depth * 0.45, `cup ${seed}: not rounded at ${i}`);
    assert.ok(rr.price - h.price > 0.15 * depth && rr.price - h.price < 0.5 * depth, 'handle: a real but shallow pullback');
    assert.ok(h.idx - rr.idx < cupBars / 2, 'handle shorter than half the cup');
    assert.equal(sc.neckline.y1, lr.price);
    assert.ok(Math.abs(sc.height - depth) < 1e-9, 'height = cup depth');

    const rb = scenario('rounding-bottom', seed);
    const lip = one(rb, 'Left lip');
    const b = one(rb, 'Bottom');
    const d2 = lip.price - b.price;
    assert.ok(d2 / lip.price >= 0.08, 'saucer depth');
    const span = rb.breakoutIdx - lip.idx;
    assert.ok(Math.abs(b.idx - (lip.idx + span / 2)) <= span / 5, 'bottom near the middle');
    for (let i = lip.idx + Math.round(span * 0.35); i <= lip.idx + Math.round(span * 0.65); i++) {
      assert.ok(rb.candles[i].c < lip.price - d2 * 0.55, `saucer ${seed}: not rounded at ${i}`);
    }
    assert.equal(rb.neckline.y1, lip.price);
  }
});

test('volume: dries up in the formation, surges on a real breakout, stays light on a trap', () => {
  const LATER = ['Top 2', 'Top 3', 'Bottom 2', 'Bottom 3', 'Right shoulder'];
  for (const id of CHART_PATTERN_IDS) {
    for (const seed of SEEDS) {
      const good = scenario(id, seed);
      const bad = scenario(id, seed, 'fail');
      const cs = good.candles;
      const msg = `${id} seed ${seed}`;
      const k0 = good.keyPoints[0].idx;
      const b = good.breakoutIdx;
      const flagTop = good.keyPoints.find((k) => k.label === 'Flagpole top' || k.label === 'Flagpole bottom');
      const from = flagTop ? flagTop.idx + 1 : k0; // a flag's own volume, without the pole
      const form = avgVol(cs, from, b);
      const recent = avgVol(cs, b - 10, b);
      assert.ok(cs[b].v >= 1.35 * form && cs[b].v >= 1.7 * recent, `${msg}: breakout volume ${cs[b].v} vs ${form.toFixed(0)}`);
      assert.ok(bad.candles[b].v <= recent * 1.001, `${msg}: trap breakout on strong volume`);
      if (id === 'cup-and-handle' || id === 'rounding-bottom') {
        // U-shaped: quiet at the bottom of the base, busier on the way down and back up.
        const bot = one(good, id === 'cup-and-handle' ? 'Cup bottom' : 'Bottom').idx;
        const third = Math.floor((bot - k0) / 2);
        assert.ok(avgVol(cs, bot - 3, bot + 4) < avgVol(cs, k0, k0 + third), `${msg}: base volume not drying up`);
      } else if (good.keyPoints.some((k) => LATER.includes(k.label))) {
        // Each retest of the level on lighter volume than the first test.
        const around = (idx) => avgVol(cs, idx - 2, idx + 3);
        const firstTest = good.keyPoints.find((k) => ['Top 1', 'Bottom 1', 'Left shoulder'].includes(k.label));
        for (const k of good.keyPoints.filter((q) => LATER.includes(q.label))) {
          assert.ok(around(k.idx) < around(firstTest.idx), `${msg}: ${k.label} volume not lighter than ${firstTest.label}`);
        }
      } else {
        const third = Math.floor((b - from) / 3);
        assert.ok(avgVol(cs, b - third, b) < avgVol(cs, from, from + third), `${msg}: volume does not fade`);
      }
    }
  }
});

test('the setup is identical for both outcomes: only the future differs', () => {
  for (const id of CHART_PATTERN_IDS) {
    for (const seed of SEEDS.slice(0, 40)) {
      const good = scenario(id, seed);
      const bad = scenario(id, seed, 'fail');
      assert.equal(good.breakoutIdx, bad.breakoutIdx);
      assert.deepEqual(good.keyPoints, bad.keyPoints);
      assert.deepEqual(good.neckline, bad.neckline);
      assert.deepEqual(good.boundaries, bad.boundaries);
      assert.equal(good.target, bad.target);
      for (let i = 0; i <= good.breakoutIdx; i++) {
        const [g, f] = [good.candles[i], bad.candles[i]];
        assert.deepEqual([g.o, g.h, g.l, g.c], [f.o, f.h, f.l, f.c], `${id} seed ${seed}: candle ${i} differs`);
        if (i < good.breakoutIdx) assert.equal(g.v, f.v, `${id} seed ${seed}: volume ${i} differs`);
      }
    }
  }
});

test('scenario candles are valid for 1000 seeds (mixed patterns, outcomes, prices, counts)', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const id = CHART_PATTERN_IDS[seed % CHART_PATTERN_IDS.length];
    const start = [100, 1.085, 25, 2500][seed % 4];
    const sc = chartScenario(id, { seed, start, count: 90 + (seed % 70), after: 10 + (seed % 21), outcome: seed % 2 ? 'success' : 'fail' });
    for (const k of sc.candles) {
      if (!(k.l > 0 && k.l <= Math.min(k.o, k.c) && Math.max(k.o, k.c) <= k.h && Number.isFinite(k.h) && k.v >= 1)) {
        assert.fail(`${id} seed ${seed}: invalid ${JSON.stringify(k)}`);
      }
    }
    assert.ok(sc.breakoutIdx > sc.patternStart && sc.height > 0 && Number.isFinite(sc.target));
  }
});

test('chartScenario: other counts, FX / high prices, determinism', () => {
  for (const id of CHART_PATTERN_IDS) {
    for (const [count, after] of [[160, 30], [90, 15], [110, 0], [110, 3]]) {
      const sc = chartScenario(id, { seed: 5, count, after });
      assert.equal(sc.candles.length, count);
      assert.ok(sc.breakoutIdx <= count - after - 1 && sc.breakoutIdx >= count - after - 12, `${id} ${count}/${after}: breakout at ${sc.breakoutIdx}`);
      sc.candles.forEach((k) => assert.ok(k.l > 0 && k.l <= Math.min(k.o, k.c) && Math.max(k.o, k.c) <= k.h && k.v >= 1));
    }
    const base = chartScenario(id, { seed: 8 });
    for (const start of [1.085, 2500]) {
      const sc = chartScenario(id, { seed: 8, start });
      assert.ok(rel(sc.target / base.target, start / 100) < 1e-9, `${id}: target scales`);
      assert.equal(sc.breakoutIdx, base.breakoutIdx);
    }
    assert.deepEqual(chartScenario(id, { seed: 3 }), chartScenario(id, { seed: 3 }));
  }
});
