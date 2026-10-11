// v2 integration: the pieces builders combine — scanner.simRound (offline twin of realRound),
// lesson-kit textbookExample / annotateSetup for every setup kind (real fixture rounds and
// textbook ones), market mock mode via ?market=mock, and precision rules added after the visual
// review of real detections (tests/visual/setups.html).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureMarket, resetMarketCache, isMockMode } from '../../js/core/market.js';
import * as scanner from '../../js/core/scanner.js';
import { textbookExample, annotateSetup } from '../../js/core/lesson-kit.js';
import { makeRng } from '../../js/core/rng.js';
import { atr, linearRegression } from '../../js/core/indicators.js';
import { CANDLE_PATTERN_IDS } from '../../js/core/patterns.js';

const { simRound, realRound, findSetups, SETUP_KIND_IDS, SETUP_KINDS } = scanner;
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'market');
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const fixtureFetch = async (url) => {
  const file = path.join(FIX, url.slice('fixture://'.length));
  return fs.existsSync(file) ? json(200, JSON.parse(fs.readFileSync(file, 'utf8'))) : json(404, {});
};
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), 'utf8')).candles;
const SERIES = ['BTC-USD_1d', 'BTC-USD_1w', 'ETH-USD_1d', 'ETH-USD_1w', 'SPY_1d', 'SPY_1w', 'EUR-USD_1d', 'EUR-USD_1w'];

after(() => {
  configureMarket({ mock: undefined, fetch: undefined, fixturesBase: undefined });
  resetMarketCache();
});

/** A stand-in CandleChart that records overlays and rejects non-finite coordinates. */
function recordingChart(candles) {
  const calls = [];
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const checkPt = (p, what) => assert.ok(p && finite(p.idx) && finite(p.price), `${what}: bad point ${JSON.stringify(p)}`);
  const add = (type, check) => (spec) => {
    check(spec);
    calls.push({ type, spec });
    return `${type}-${calls.length}`;
  };
  return {
    candles,
    calls,
    addBox: add('box', (s) => assert.ok(finite(s.from) && finite(s.to), 'box from/to')),
    addHLine: add('hline', (s) => assert.ok(finite(s.price), 'hline price')),
    addSegment: add('segment', (s) => {
      checkPt(s.a, 'segment a');
      checkPt(s.b, 'segment b');
    }),
    addMarker: add('marker', (s) => {
      assert.ok(finite(s.idx), 'marker idx');
      if (s.price != null) assert.ok(finite(s.price), 'marker price');
    }),
    addPath: add('path', (s) => s.points.forEach((p) => checkPt(p, 'path'))),
    addZone: add('zone', (s) => assert.ok(finite(s.from) && finite(s.to), 'zone prices')),
    addFib: add('fib', (s) => {
      checkPt(s.a, 'fib a');
      checkPt(s.b, 'fib b');
    }),
    addSeries: add('series', (s) => {
      assert.equal(s.values.length, candles.length, 'series aligned with the candles');
      assert.ok(s.values.some(finite), 'series has values');
    }),
    addPane: add('pane', (s) => assert.equal(s.series[0].values.length, candles.length, 'pane series aligned')),
    addText: add('text', () => {}),
  };
}

test('simRound: realRound-shaped, genuine (scanner-found) and deterministic for every kind', () => {
  for (const kind of SETUP_KIND_IDS) {
    const r = simRound(makeRng(`sim:${kind}`), { kinds: [kind], before: 60, after: 20 });
    assert.ok(r, `${kind}: a simulated round`);
    assert.equal(r.candles.length, 80, `${kind}: window`);
    assert.equal(r.decisionIdx, 59);
    assert.equal(r.setup.kind, kind);
    assert.equal(r.setup.decisionIdx, 59);
    assert.ok(r.setup.start >= 0 && r.setup.start <= 59, `${kind}: whole setup inside the window`);
    assert.equal(r.sim, true);
    assert.equal(r.symbol, null, 'no market to reveal');
    assert.ok(r.outcome && ['up', 'down', 'flat'].includes(r.outcome.direction));
    // Genuine: the scanner finds it again on lead + window.
    const all = [...r.lead, ...r.candles];
    const d = r.lead.length + r.decisionIdx;
    assert.ok(findSetups(all, { kinds: [kind] }).some((s) => s.decisionIdx === d), `${kind}: re-found on lead + window`);
  }
  const a = simRound(makeRng(42), { kinds: ['bull-flag', 'golden-cross', 'hammer'] });
  const b = simRound(makeRng(42), { kinds: ['bull-flag', 'golden-cross', 'hammer'] });
  assert.deepEqual(a.candles, b.candles, 'same rng → same round');
  assert.equal(simRound(makeRng(1), { kinds: ['not-a-kind'] }), null);
});

test('textbookExample: a real setup for every scanner kind (with the scanner module)', () => {
  for (const kind of SETUP_KIND_IDS) {
    const ex = textbookExample([kind], makeRng(`tb:${kind}`), { scanner });
    assert.ok(ex.candles.length >= 30, `${kind}: candles`);
    assert.ok(ex.setup, `${kind}: setup`);
    assert.equal(ex.setup.kind, kind);
    assert.ok(ex.decisionIdx >= 0 && ex.decisionIdx < ex.candles.length, `${kind}: decision inside`);
  }
  // Without the scanner, kinds the generators do not cover degrade to setup: null (no throw).
  assert.equal(textbookExample(['fib-pullback'], makeRng(1)).setup, null);
});

test('annotateSetup: finite overlays for every kind — textbook, simulated and real (fixture) rounds', async () => {
  const seen = new Set();
  const draw = (ex, label) => {
    const chart = recordingChart(ex.candles);
    annotateSetup(ex.setup, chart, ex);
    assert.ok(chart.calls.length > 0, `${label}: something was drawn`);
    seen.add(ex.setup.kind);
    return chart;
  };
  for (const kind of SETUP_KIND_IDS) draw(textbookExample([kind], makeRng(`a:${kind}`), { scanner }), `textbook ${kind}`);
  // Double tops carry the neckline as a PRICE (scanner) — it must become a horizontal line.
  const dt = simRound(makeRng('dt'), { kinds: ['double-top'] });
  const c = draw(dt, 'sim double-top');
  assert.ok(c.calls.some((x) => x.type === 'hline' && x.spec.label === 'Neckline'), 'double-top neckline drawn');
  // Crosses draw both averages; divergences add an RSI pane.
  assert.equal(draw(simRound(makeRng('gc'), { kinds: ['golden-cross'] }), 'gc').calls.filter((x) => x.type === 'series').length, 2);
  assert.ok(draw(simRound(makeRng('bd'), { kinds: ['bullish-divergence'] }), 'bd').calls.some((x) => x.type === 'pane'));

  configureMarket({ mock: true, fixturesBase: 'fixture://', fetch: fixtureFetch });
  let real = 0;
  for (const kind of SETUP_KIND_IDS.filter((k) => !CANDLE_PATTERN_IDS.includes(k) || k === 'hammer')) {
    const r = await realRound(makeRng(`real:${kind}`), { kinds: [kind] });
    if (!r) continue;
    draw(r, `real ${kind}`);
    real++;
  }
  assert.ok(real >= 18, `real fixture rounds annotated: ${real}`);
  assert.equal(seen.size, SETUP_KIND_IDS.length);
});

test('market mock mode: ?market=mock on localhost (works without storage), never elsewhere', () => {
  configureMarket({ mock: undefined, fetch: undefined, fixturesBase: undefined });
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const setLoc = (hostname, search) => Object.defineProperty(globalThis, 'location', { value: { hostname, search }, configurable: true, writable: true });
  try {
    setLoc('localhost', '?smoke=home&market=mock');
    assert.equal(isMockMode(), true);
    setLoc('127.0.0.1', '?market=mock');
    assert.equal(isMockMode(), true);
    setLoc('localhost', '?market=mockery');
    assert.equal(isMockMode(), false);
    setLoc('localhost', '');
    assert.equal(isMockMode(), false);
    setLoc('thetradeschool.example', '?market=mock');
    assert.equal(isMockMode(), false, 'never on a real host');
  } finally {
    if (saved) Object.defineProperty(globalThis, 'location', saved);
    else delete globalThis.location;
  }
});

test('precision rules from the visual review hold on every fixture detection', () => {
  let hs = 0;
  let flags = 0;
  for (const name of SERIES) {
    const cs = fixture(name);
    const A = atr(cs, 14);
    for (const s of findSetups(cs, { kinds: ['head-and-shoulders', 'inverse-head-and-shoulders', 'bull-flag', 'bear-flag'], atr: A })) {
      const m = s.meta;
      if (/head-and-shoulders/.test(s.kind)) {
        hs++;
        const d = s.kind === 'head-and-shoulders' ? 1 : -1;
        const [, T1, H, T2, RS] = m.points;
        assert.ok(Math.abs(T2.price - T1.price) <= 0.5 * m.height + 1e-9, `${name} ${s.kind} @${s.decisionIdx}: neckline tilt`);
        // The break clears every close of the trough between the head and the right shoulder.
        for (let j = H.idx + 1; j < RS.idx; j++) assert.ok((cs[s.decisionIdx].c - cs[j].c) * d < 0, `${name} ${s.kind} @${s.decisionIdx}: still inside the pattern`);
      } else {
        flags++;
        const d = s.kind === 'bull-flag' ? 1 : -1;
        const poleLen = m.poleTop.idx - m.poleStart.idx;
        const pts = [];
        for (let j = m.flag.from; j <= m.flag.to; j++) pts.push([j, cs[j].c * d]);
        const counter = -linearRegression(pts).slope / (m.height / poleLen);
        assert.ok(counter <= 0.5 + 1e-9, `${name} ${s.kind} @${s.decisionIdx}: flag drifts ${counter.toFixed(2)}× the pole's pace`);
        assert.ok((m.retrace * poleLen) / (m.flag.to - m.flag.from + 1) <= 0.8 + 1e-3, `${name} ${s.kind}: flag retraces too fast`);
      }
    }
  }
  assert.ok(hs >= 8 && flags >= 20, `enough detections to mean something (H&S ${hs}, flags ${flags})`);
  for (const k of ['head-and-shoulders', 'bull-flag', 'support-bounce']) assert.match(SETUP_KINDS[k].rule, /\S{20,}|\s/);
});

test('measured-move targets are positive and on the setup’s side for every fixture detection', () => {
  let n = 0;
  for (const name of SERIES) {
    const cs = fixture(name);
    for (const s of findSetups(cs)) {
      if (s.meta.target == null || s.direction === 'neutral') continue;
      n++;
      const dir = s.direction === 'bullish' ? 1 : -1;
      assert.ok(s.meta.target > 0, `${name} ${s.kind} @${s.decisionIdx}: target ${s.meta.target}`);
      if (s.kind !== 'fib-pullback') assert.ok((s.meta.target - cs[s.decisionIdx].c) * dir > 0, `${name} ${s.kind} @${s.decisionIdx}: target on the wrong side`);
    }
  }
  assert.ok(n >= 50, `targets checked: ${n}`);
});
