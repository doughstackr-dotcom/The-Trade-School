// realisticMarket (data.js) and the heikinAshi / zigzag additions (indicators.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realisticMarket, trendSeries, isValidCandle } from '../../js/core/data.js';
import { heikinAshi, zigzag, atr } from '../../js/core/indicators.js';

const logReturns = (cs) => cs.slice(1).map((k, i) => Math.log(k.c / cs[i].c));
const stats = (r) => {
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length;
  const kurt = r.reduce((a, b) => a + (b - m) ** 4, 0) / r.length / (v * v);
  const ab = r.map(Math.abs);
  const am = ab.reduce((a, b) => a + b, 0) / ab.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < ab.length; i++) {
    den += (ab[i] - am) ** 2;
    if (i) num += (ab[i] - am) * (ab[i - 1] - am);
  }
  return { sd: Math.sqrt(v), kurt, acfAbs: num / den };
};

test('realisticMarket: valid OHLC for every regime, seed and scale', () => {
  for (const regime of ['mixed', 'trend', 'range', 'volatile']) {
    for (let seed = 1; seed <= 40; seed++) {
      const start = [100, 1.085, 30000, 0.5][seed % 4];
      const cs = realisticMarket({ seed, count: 400, start, regime });
      assert.equal(cs.length, 400);
      cs.forEach((k, i) => {
        if (!isValidCandle(k) || k.t !== i || !(k.v >= 1) || !Number.isInteger(k.v)) assert.fail(`${regime} seed ${seed} candle ${i}: ${JSON.stringify(k)}`);
      });
    }
  }
  const r = realisticMarket({ seed: 9, count: 200, start: 1.08, decimals: 4 });
  for (const k of r) {
    assert.ok(isValidCandle(k), JSON.stringify(k));
    for (const v of [k.o, k.h, k.l, k.c]) assert.ok(Math.abs(v * 1e4 - Math.round(v * 1e4)) < 1e-6);
  }
});

test('realisticMarket: deterministic, regimes cover the series', () => {
  assert.deepEqual(realisticMarket({ seed: 5, count: 150 }), realisticMarket({ seed: 5, count: 150 }));
  assert.notDeepEqual(realisticMarket({ seed: 5, count: 150 }), realisticMarket({ seed: 6, count: 150 }));
  const { candles, regimes } = realisticMarket({ seed: 5, count: 600, info: true });
  assert.equal(candles.length, 600);
  assert.equal(regimes[0].from, 0);
  assert.equal(regimes[regimes.length - 1].to, 599);
  for (let i = 1; i < regimes.length; i++) assert.equal(regimes[i].from, regimes[i - 1].to + 1);
  assert.ok(regimes.length >= 5, 'several regime switches in 600 candles');
  assert.ok(regimes.every((g) => ['up', 'down', 'range', 'volatile'].includes(g.kind)));
});

test('realisticMarket: volatility clusters, fat tails, gaps and volume that follows volatility', () => {
  let acf = 0;
  let kurt = 0;
  let gaps = 0;
  let volCorr = 0;
  const N = 12;
  for (let seed = 1; seed <= N; seed++) {
    const cs = realisticMarket({ seed, count: 1000 });
    const s = stats(logReturns(cs));
    acf += s.acfAbs / N;
    kurt += s.kurt / N;
    gaps += cs.slice(1).filter((k, i) => Math.abs(Math.log(k.o / cs[i].c)) > 0.25 * s.sd).length;
    // Volume vs range correlation.
    const rg = cs.map((k) => (k.h - k.l) / k.c);
    const vv = cs.map((k) => Math.log(k.v));
    const mr = rg.reduce((a, b) => a + b, 0) / rg.length;
    const mv = vv.reduce((a, b) => a + b, 0) / vv.length;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < rg.length; i++) {
      sxy += (rg[i] - mr) * (vv[i] - mv);
      sxx += (rg[i] - mr) ** 2;
      syy += (vv[i] - mv) ** 2;
    }
    volCorr += sxy / Math.sqrt(sxx * syy) / N;
  }
  assert.ok(acf > 0.08, `|return| autocorrelation ${acf.toFixed(3)} (volatility clustering)`);
  assert.ok(kurt > 4, `kurtosis ${kurt.toFixed(1)} (fat tails)`);
  assert.ok(gaps >= N * 5, `gaps: ${gaps}`);
  assert.ok(volCorr > 0.25, `volume/range correlation ${volCorr.toFixed(2)}`);
});

test('realisticMarket: "trend" markets travel further than "range" markets', () => {
  const eff = (cs) => {
    // Efficiency ratio over 60-candle windows: |net move| / sum of |moves|.
    let s = 0;
    let m = 0;
    for (let i = 60; i < cs.length; i += 30) {
      let path = 0;
      for (let j = i - 59; j <= i; j++) path += Math.abs(cs[j].c - cs[j - 1].c);
      s += Math.abs(cs[i].c - cs[i - 60].c) / path;
      m++;
    }
    return s / m;
  };
  let tr = 0;
  let rg = 0;
  for (let seed = 1; seed <= 16; seed++) {
    tr += eff(realisticMarket({ seed, count: 800, regime: 'trend' }));
    rg += eff(realisticMarket({ seed, count: 800, regime: 'range' }));
  }
  assert.ok(tr > rg * 1.3, `trend efficiency ${(tr / 16).toFixed(3)} vs range ${(rg / 16).toFixed(3)}`);
});

test('heikinAshi: textbook formula', () => {
  const cs = [
    { o: 10, h: 12, l: 9, c: 11, v: 5, t: 0 },
    { o: 11, h: 13, l: 10.5, c: 12.5, v: 6, t: 1 },
  ];
  const ha = heikinAshi(cs);
  assert.equal(ha[0].c, (10 + 12 + 9 + 11) / 4);
  assert.equal(ha[0].o, (10 + 11) / 2);
  assert.equal(ha[1].o, (ha[0].o + ha[0].c) / 2);
  assert.equal(ha[1].c, (11 + 13 + 10.5 + 12.5) / 4);
  assert.equal(ha[1].h, 13);
  assert.equal(ha[1].l, Math.min(10.5, ha[1].o));
  assert.equal(ha[1].v, 6);
  for (const k of heikinAshi(realisticMarket({ seed: 3, count: 300 }))) assert.ok(isValidCandle(k));
});

test('zigzag: finds the textbook swings, alternates, and never looks ahead', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { candles, swings } = trendSeries({ seed, count: 120, direction: ['up', 'down', 'range'][seed % 3], swings: 5 });
    const zz = zigzag(candles, { atrMult: 2 });
    for (let i = 1; i < zz.length; i++) assert.notEqual(zz[i].type, zz[i - 1].type);
    for (const p of zz) {
      assert.ok(p.confirmedIdx > p.idx);
      assert.equal(p.price, p.type === 'high' ? candles[p.idx].h : candles[p.idx].l);
    }
    // Most generated swings are zigzag pivots.
    const found = swings.filter((s) => zz.some((p) => p.idx === s.idx && p.type === s.type)).length;
    assert.ok(found >= swings.length - 2, `seed ${seed}: ${found}/${swings.length}`);
    // Causal: the pivots confirmed before m are the same when the future is cut off.
    const m = 70;
    const cut = zigzag(candles.slice(0, m), { atrMult: 2 });
    assert.deepEqual(cut, zz.filter((p) => p.confirmedIdx < m));
  }
  const a = atr(trendSeries({ seed: 1 }).candles);
  assert.ok(a.length > 0);
  assert.deepEqual(zigzag([]), []);
  const withLast = zigzag(trendSeries({ seed: 4, count: 90 }).candles, { last: true });
  assert.equal(withLast[withLast.length - 1].confirmedIdx, null);
});
