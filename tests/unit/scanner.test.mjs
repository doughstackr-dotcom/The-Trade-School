// js/core/scanner.js: every detector must find what the textbook generators made, stay rare on
// noise, and never look ahead; plus outcomeOf, realRound (mock fixtures) and describeChart.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSetups, outcomeOf, realRound, describeChart, shiftSetup, SETUP_KINDS, SETUP_KIND_IDS } from '../../js/core/scanner.js';
import { candleScenario, chartScenario, CANDLE_PATTERN_IDS } from '../../js/core/patterns.js';
import { trendSeries, randomWalk, realisticMarket, fromPath } from '../../js/core/data.js';
import { configureMarket, resetMarketCache } from '../../js/core/market.js';
import { makeRng } from '../../js/core/rng.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'market');
const SEEDS = (n) => Array.from({ length: n }, (_, i) => i * 7919 + 3);
const near = (list, kind, idx, tol = 3) => list.find((x) => x.kind === kind && x.decisionIdx >= idx && x.decisionIdx <= idx + tol);
const rateOf = (seeds, fn) => seeds.filter(fn).length / seeds.length;

after(() => {
  configureMarket({ mock: undefined, fetch: undefined, fixturesBase: undefined });
  resetMarketCache();
});

test('every §12.4 kind is registered with a documented rule', () => {
  const required = [
    ...CANDLE_PATTERN_IDS, 'trend-up', 'trend-down', 'range', 'support-bounce', 'resistance-reject', 'breakout-up', 'breakout-down',
    'fakeout-up', 'fakeout-down', 'golden-cross', 'death-cross', 'bullish-divergence', 'bearish-divergence', 'fib-pullback',
    'double-top', 'double-bottom', 'head-and-shoulders', 'inverse-head-and-shoulders', 'bull-flag', 'bear-flag',
  ];
  assert.deepEqual([...SETUP_KIND_IDS].sort(), [...required].sort());
  for (const id of SETUP_KIND_IDS) {
    const k = SETUP_KINDS[id];
    assert.equal(k.id, id);
    assert.ok(k.name && k.rule.length > 30, id);
    assert.ok(['bullish', 'bearish', 'neutral'].includes(k.direction));
  }
  assert.deepEqual(findSetups([]), []);
  assert.deepEqual(findSetups(null), []);
  assert.deepEqual(findSetups(randomWalk({ seed: 1, count: 50 }), { kinds: ['nope'] }), []);
});

test('candle patterns: every generated scenario is found at its pattern', () => {
  for (const id of CANDLE_PATTERN_IDS) {
    for (const seed of SEEDS(20)) {
      const sc = candleScenario(id, { seed, leadIn: 16, after: 4 });
      const f = findSetups(sc.candles, { kinds: [id] }).find((x) => x.start === sc.start && x.end === sc.end);
      assert.ok(f, `${id} seed ${seed} not found`);
      assert.equal(f.decisionIdx, sc.end);
      assert.equal(f.direction, SETUP_KINDS[id].direction);
      if (f.direction !== 'neutral') assert.equal(f.meta.confirm, sc.confirm);
    }
  }
});

test('chart patterns: textbook formations are found at the breakout (≥ 90% of seeds)', (t) => {
  const cases = [
    ['double-top', 'double-top'], ['double-bottom', 'double-bottom'], ['head-and-shoulders', 'head-and-shoulders'],
    ['inverse-head-and-shoulders', 'inverse-head-and-shoulders'], ['bull-flag', 'bull-flag'], ['bear-flag', 'bear-flag'],
    ['ascending-triangle', 'breakout-up'], ['descending-triangle', 'breakout-down'],
  ];
  const seeds = SEEDS(30);
  const report = [];
  for (const [pid, kind] of cases) {
    const r = rateOf(seeds, (seed) => {
      const sc = chartScenario(pid, { seed, outcome: seed % 2 ? 'success' : 'fail' });
      const f = near(findSetups(sc.candles, { kinds: [kind] }), kind, sc.breakoutIdx);
      if (!f) return false;
      assert.equal(f.direction, sc.bias, `${pid}: direction`);
      if (f.meta.target != null) assert.ok((f.meta.target - sc.candles[f.decisionIdx].c) * sc.direction > 0, `${pid}: target on the right side`);
      return true;
    });
    report.push(`${pid}→${kind} ${(r * 100).toFixed(0)}%`);
    assert.ok(r >= 0.9, `${pid} → ${kind}: found in ${(r * 100).toFixed(0)}% of seeds`);
  }
  // Failed breakouts become fakeouts within ~15 candles.
  for (const [pid, kind] of [['ascending-triangle', 'fakeout-up'], ['descending-triangle', 'fakeout-down']]) {
    const r = rateOf(seeds, (seed) => {
      const sc = chartScenario(pid, { seed, outcome: 'fail' });
      return findSetups(sc.candles, { kinds: [kind] }).some((x) => x.decisionIdx > sc.breakoutIdx && x.decisionIdx <= sc.breakoutIdx + 16 && x.meta.breakoutIdx <= sc.breakoutIdx + 1);
    });
    report.push(`${pid} fail→${kind} ${(r * 100).toFixed(0)}%`);
    assert.ok(r >= 0.7, `${kind}: ${(r * 100).toFixed(0)}%`);
  }
  t.diagnostic(report.join(', '));
});

test('trends, ranges, levels and Fibonacci pullbacks on trendSeries', () => {
  const seeds = SEEDS(30);
  for (const dir of ['up', 'down', 'range']) {
    const kind = dir === 'up' ? 'trend-up' : dir === 'down' ? 'trend-down' : 'range';
    const r = rateOf(seeds, (seed) => findSetups(trendSeries({ seed, direction: dir, count: 100, swings: 5 }).candles, { kinds: [kind] }).length > 0);
    assert.ok(r >= 0.95, `${kind}: ${r}`);
    // …and not the opposite trend.
    const other = dir === 'up' ? 'trend-down' : dir === 'down' ? 'trend-up' : null;
    if (other) assert.equal(rateOf(seeds, (seed) => findSetups(trendSeries({ seed, direction: dir, count: 100, swings: 5 }).candles, { kinds: [other] }).length > 0), 0, `${other} in a ${dir}trend`);
  }
  const lv = rateOf(seeds, (seed) => findSetups(trendSeries({ seed, direction: 'range', count: 120, swings: 6 }).candles, { kinds: ['support-bounce', 'resistance-reject'] }).length > 0);
  assert.ok(lv >= 0.9, `levels in ranges: ${lv}`);
  const fib = rateOf(seeds, (seed) => {
    const f = findSetups(trendSeries({ seed, direction: 'up', count: 100, swings: 5 }).candles, { kinds: ['fib-pullback'] });
    for (const x of f) {
      assert.ok(x.meta.ratio >= 0.382 && x.meta.ratio <= 0.786, `ratio ${x.meta.ratio}`);
      assert.ok(x.meta.impulseAtr >= 3);
    }
    return f.some((x) => x.direction === 'bullish');
  });
  assert.ok(fib >= 0.9, `fib-pullback: ${fib}`);
});

test('moving-average crosses and RSI divergences on constructed paths', () => {
  const seeds = SEEDS(30);
  const ma = { maFast: 20, maSlow: 50, maType: 'ema' };
  const gc = rateOf(seeds, (seed) => findSetups(fromPath([[0, 120], [0.45, 90], [1, 125]], { seed, count: 160 }).candles, { kinds: ['golden-cross'], ...ma }).length > 0);
  const dc = rateOf(seeds, (seed) => findSetups(fromPath([[0, 90], [0.45, 120], [1, 85]], { seed, count: 160 }).candles, { kinds: ['death-cross'], ...ma }).length > 0);
  const e = findSetups(fromPath([[0, 120], [0.45, 90], [1, 125]], { seed: 3, count: 160 }).candles, { kinds: ['golden-cross'], ...ma })[0];
  assert.equal(e.meta.fast, 'EMA 20');
  assert.equal(findSetups(fromPath([[0, 120], [0.45, 90], [1, 125]], { seed: 3, count: 160 }).candles, { kinds: ['golden-cross'] }).length, 0, 'SMA 200 needs a long history');
  assert.ok(gc >= 0.95 && dc >= 0.95, `crosses ${gc} ${dc}`);
  const long = fromPath([[0, 150], [0.4, 90], [1, 160]], { seed: 5, count: 400 }).candles;
  const g = findSetups(long, { kinds: ['golden-cross'] });
  assert.ok(g.length && g[0].meta.fast === 'SMA 50' && g[0].meta.slow === 'SMA 200', 'long histories use SMA 50 / 200');
  const bull = rateOf(seeds, (seed) => findSetups(fromPath([[0, 112], [0.45, 100], [0.58, 104.5], [0.75, 99.2], [1, 103]], { seed, count: 110 }).candles, { kinds: ['bullish-divergence'] }).length > 0);
  const bear = rateOf(seeds, (seed) => findSetups(fromPath([[0, 88], [0.45, 100], [0.58, 95.5], [0.75, 100.8], [1, 97]], { seed, count: 110 }).candles, { kinds: ['bearish-divergence'] }).length > 0);
  assert.ok(bull >= 0.85 && bear >= 0.85, `divergence ${bull} ${bear}`);
});

test('noise: setups stay rare on random walks and simulated markets (rates reported)', (t) => {
  const counts = {};
  let bars = 0;
  for (let seed = 1; seed <= 8; seed++) {
    for (const cs of [randomWalk({ seed, count: 500 }), realisticMarket({ seed, count: 500 })]) {
      bars += cs.length;
      for (const s of findSetups(cs)) counts[s.kind] = (counts[s.kind] || 0) + 1;
    }
  }
  const per1000 = (k) => ((counts[k] || 0) / bars) * 1000;
  t.diagnostic(`setups per 1000 noise candles: ${SETUP_KIND_IDS.filter((k) => !CANDLE_PATTERN_IDS.includes(k)).map((k) => `${k} ${per1000(k).toFixed(1)}`).join(', ')}`);
  const bounds = {
    'double-top': 6, 'double-bottom': 6, 'head-and-shoulders': 6, 'inverse-head-and-shoulders': 6, 'bull-flag': 8, 'bear-flag': 8,
    'golden-cross': 4, 'death-cross': 4, 'bullish-divergence': 7, 'bearish-divergence': 7, 'fib-pullback': 10,
    'support-bounce': 10, 'resistance-reject': 10, 'breakout-up': 10, 'breakout-down': 10, 'fakeout-up': 8, 'fakeout-down': 8,
    'trend-up': 8, 'trend-down': 8, range: 14,
  };
  for (const [k, b] of Object.entries(bounds)) assert.ok(per1000(k) <= b, `${k}: ${per1000(k).toFixed(1)} per 1000 candles (bound ${b})`);
});

test('causal: every setup is found identically with the future cut off; shapes are consistent', () => {
  for (const seed of [11, 12, 13]) {
    const cs = realisticMarket({ seed, count: 500 });
    const all = findSetups(cs);
    assert.ok(all.length > 20);
    for (const s of all) {
      assert.ok(s.start <= s.end && s.end === s.decisionIdx && s.start >= 0 && s.decisionIdx < cs.length, JSON.stringify(s));
      assert.ok(['bullish', 'bearish', 'neutral'].includes(s.direction));
      assert.equal(s.meta.name, SETUP_KINDS[s.kind].name);
      if (s.kind === 'doji' || s.kind === 'spinning-top') continue;
      const cut = findSetups(cs.slice(0, s.decisionIdx + 1), { kinds: [s.kind], from: s.decisionIdx });
      const same = cut.find((x) => x.decisionIdx === s.decisionIdx && x.start === s.start);
      assert.deepEqual(same, s, `${s.kind} at ${s.decisionIdx} depends on later candles`);
    }
    // from / to only filter.
    const mid = findSetups(cs, { from: 200, to: 300 });
    assert.deepEqual(mid, all.filter((s) => s.decisionIdx >= 200 && s.decisionIdx <= 300));
  }
  const t0 = Date.now();
  findSetups(realisticMarket({ seed: 3, count: 1500 }));
  assert.ok(Date.now() - t0 < 1500, 'fast enough for 1500 candles');
});

test('outcomeOf and shiftSetup', () => {
  const up = Array.from({ length: 40 }, (_, i) => ({ o: 100 + i, h: 101.5 + i, l: 99.5 + i, c: 100.8 + i, v: 1, t: i }));
  const o = outcomeOf(up, 20, { bars: 10, direction: 'bullish' });
  assert.equal(o.bars, 10);
  assert.ok(Math.abs(o.move - 10) < 1e-9);
  assert.equal(o.direction, 'up');
  assert.equal(o.result, 'followed');
  assert.ok(o.r > 1 && o.maxUp >= o.r && o.maxDown <= 0.5);
  assert.equal(outcomeOf(up, 20, { bars: 10, direction: 'bearish' }).result, 'failed');
  const flat = up.map((k) => ({ ...k, o: 100, c: 100.1, h: 101, l: 99 }));
  assert.equal(outcomeOf(flat, 20, { direction: -1 }).direction, 'flat');
  assert.equal(outcomeOf(flat, 20, { direction: -1 }).result, 'flat');
  assert.equal(outcomeOf(up, 39).bars, 0);
  assert.equal(outcomeOf(up, 39).direction, 'flat');
  assert.equal(outcomeOf(up, 99), null);
  assert.equal(outcomeOf([], 0), null);
  const s = { kind: 'double-top', start: 50, end: 90, decisionIdx: 90, direction: 'bearish', meta: { points: [{ idx: 50, price: 10 }], neckline: 9.5, zone: [1, 2], touchIdx: 60, flag: { from: 70, to: 80 }, upper: { x1: 55, y1: 3, x2: 60, y2: 4 } } };
  const t = shiftSetup(s, 40);
  assert.deepEqual([t.start, t.end, t.decisionIdx], [10, 50, 50]);
  assert.deepEqual(t.meta.points, [{ idx: 10, price: 10 }]);
  assert.equal(t.meta.neckline, 9.5);
  assert.deepEqual(t.meta.zone, [1, 2]);
  assert.equal(t.meta.touchIdx, 20);
  assert.deepEqual(t.meta.flag, { from: 30, to: 40 });
  assert.deepEqual(t.meta.upper, { x1: 15, y1: 3, x2: 20, y2: 4 });
  assert.equal(s.start, 50, 'original untouched');
});

test('realRound: a mystery window from real (fixture) history, or null without data', async () => {
  configureMarket({
    mock: true,
    fixturesBase: 'fixture://',
    fetch: async (url) => {
      const f = path.join(FIX, url.slice('fixture://'.length));
      return fs.existsSync(f) ? { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) } : { ok: false, status: 404, json: async () => ({}) };
    },
  });
  const kinds = ['bullish-engulfing', 'bearish-engulfing', 'double-bottom', 'support-bounce', 'breakout-up'];
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = await realRound(makeRng(seed), { kinds, before: 60, after: 20 });
    assert.ok(r, `seed ${seed}: no round`);
    assert.equal(r.candles.length, 80);
    assert.equal(r.decisionIdx, 59);
    assert.equal(r.setup.decisionIdx, 59);
    assert.ok(kinds.includes(r.setup.kind));
    assert.ok(r.setup.start >= 0 && r.setup.end === 59);
    assert.ok(['1d', '1w'].includes(r.interval));
    assert.match(r.title, new RegExp(`^${r.symbol} · (Daily|Weekly) · \\d{1,2} [A-Z][a-z]{2} \\d{4}$`));
    assert.equal(r.decisionTime, r.candles[59].t);
    assert.equal(r.from, r.candles[0].t);
    assert.equal(r.to, r.candles[79].t);
    assert.equal(r.mock, true);
    assert.match(r.attribution, /fixture/i);
    assert.ok(r.outcome && ['up', 'down', 'flat'].includes(r.outcome.direction) && r.outcome.bars === 20);
    assert.ok(Array.isArray(r.lead) && r.lead.length <= 250);
    if (r.lead.length) assert.ok(r.lead[r.lead.length - 1].t < r.candles[0].t);
    // The window really contains the setup it claims (re-detected in window coordinates).
    const again = findSetups([...r.lead, ...r.candles], { kinds: [r.setup.kind] }).find((x) => x.decisionIdx === r.lead.length + 59);
    assert.ok(again, `seed ${seed}: ${r.setup.kind} not re-found in the window`);
  }
  const a = await realRound(makeRng(9), { kinds, before: 50, after: 10 });
  const b = await realRound(makeRng(9), { kinds, before: 50, after: 10 });
  assert.deepEqual([a.symbol, a.interval, a.decisionTime, a.setup.kind], [b.symbol, b.interval, b.decisionTime, b.setup.kind], 'deterministic for a seed');
  const only = await realRound(makeRng(2), { kinds: ['support-bounce'], intervals: ['1w'], symbols: ['SPY', 'EUR-USD'] });
  assert.ok(!only || (only.interval === '1w' && ['SPY', 'EUR-USD'].includes(only.symbol)));
  assert.equal(await realRound(makeRng(1), { kinds, intervals: ['1h'] }), null, 'no such interval');
  configureMarket({ mock: false, url: 'https://x.test', key: 'k', retryMs: [1, 1], fetch: async () => {
    throw new TypeError('offline');
  } });
  assert.equal(await realRound(makeRng(1), { kinds }), null, 'offline → null');
  configureMarket({ url: undefined, key: undefined, retryMs: undefined });
});

test('describeChart: a plain-English read of trend, levels, patterns, MAs and RSI', () => {
  const up = trendSeries({ seed: 4, direction: 'up', count: 120, swings: 6 }).candles;
  const d = describeChart(up);
  assert.equal(d.trend, 'up');
  assert.ok(['above', 'below'].includes(d.ma.priceVsEma20));
  assert.ok(typeof d.rsi === 'number' && d.rsi >= 0 && d.rsi <= 100);
  const last = up[up.length - 1].c;
  for (const l of d.levels) assert.equal(l.type, l.price < last ? 'support' : 'resistance');
  assert.ok(d.levels.filter((l) => l.type === 'support').length <= 2 && d.levels.filter((l) => l.type === 'resistance').length <= 2);
  const n = d.summary.split(/(?<=\.)\s+/).length;
  assert.ok(n >= 2 && n <= 4, d.summary);
  assert.match(d.summary, /uptrend/);
  assert.equal(describeChart(trendSeries({ seed: 4, direction: 'down', count: 120 }).candles).trend, 'down');
  const rg = describeChart(trendSeries({ seed: 4, direction: 'range', count: 120 }).candles);
  assert.equal(rg.trend, 'range');
  assert.match(rg.summary, /sideways/);
  for (const p of rg.recentPatterns) assert.ok(p.idx >= 110 && SETUP_KINDS[p.kind]);
  assert.match(describeChart(up.slice(0, 10)).summary, /Not enough/);
  assert.match(describeChart([]).summary, /Not enough/);
  const fx = describeChart(realisticMarket({ seed: 2, count: 300, start: 1.085, vol: 0.004 }), { decimals: 5 });
  assert.match(fx.summary, /\d\.\d{5}/);
});
