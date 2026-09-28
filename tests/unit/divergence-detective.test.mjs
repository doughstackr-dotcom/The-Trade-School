// js/games/divergence-detective-scenarios.js (Divergence Detective + Indicators lesson): every
// kind generates for every difficulty, the read is exactly the intended one (cross-checked against
// indicators.divergence()), it never depends on the future, and outcomes do what they promise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { divergenceScenario, readDivergence, classifyPair, DIV_KINDS, DIV_INFO } from '../../js/games/divergence-detective-scenarios.js';
import { rsi, closes, divergence, macd } from '../../js/core/indicators.js';
import { isValidCandle } from '../../js/core/data.js';

const SEEDS = (n) => Array.from({ length: n }, (_, i) => i * 7919 + 17);

test('every kind generates at easy, normal and hard difficulty (RSI), valid candles', () => {
  for (const kind of DIV_KINDS) {
    for (const difficulty of [0.1, 0.5, 0.9]) {
      for (const seed of SEEDS(4)) {
        const sc = divergenceScenario(kind, { seed, difficulty, osc: 'rsi', outcome: seed % 2 ? 'failed' : 'expected' });
        assert.ok(sc, `${kind} d${difficulty} seed ${seed}`);
        assert.equal(sc.kind, kind);
        assert.ok(sc.candles.every(isValidCandle), 'valid OHLC');
        assert.ok(sc.decisionIdx > sc.b.idx + 2 && sc.decisionIdx < sc.candles.length - 10, 'decision after B, outcome candles after it');
        assert.ok(sc.a.idx < sc.b.idx, 'A before B');
        assert.equal(sc.rsi.length, sc.candles.length);
      }
    }
  }
});

test('the read at the decision candle is the intended one, with clear margins', () => {
  for (const kind of DIV_KINDS) {
    for (const seed of SEEDS(5)) {
      const sc = divergenceScenario(kind, { seed, difficulty: 0.3 });
      const all = [...sc.lead, ...sc.candles];
      const R = rsi(closes(all), 14);
      const off = sc.lead.length;
      const read = readDivergence(all, R, { from: off, decision: off + sc.decisionIdx });
      const side = sc.a.type;
      const pair = side === 'low' ? read.lows : read.highs;
      const other = side === 'low' ? read.highs : read.lows;
      assert.equal(pair.A.idx - off, sc.a.idx);
      assert.equal(pair.B.idx - off, sc.b.idx);
      assert.equal(pair.rel, kind === 'none' ? 'agree' : kind, `${kind} seed ${seed}`);
      if (kind !== 'none') assert.ok(Math.abs(pair.oscDiff) >= 5, `${kind}: RSI step ${pair.oscDiff}`);
      if (other) assert.equal(other.rel, 'agree', `${kind}: the other side agrees`);
      if (kind !== 'none') assert.equal(side, DIV_INFO[kind].side);
    }
  }
});

test('regular divergences agree with indicators.divergence() on the same two swings', () => {
  let hits = 0;
  let total = 0;
  for (const kind of ['bullish', 'bearish', 'hidden-bullish', 'hidden-bearish']) {
    for (const seed of SEEDS(6)) {
      const sc = divergenceScenario(kind, { seed, difficulty: 0.3 });
      const upTo = [...sc.lead, ...sc.candles.slice(0, sc.decisionIdx + 1)];
      const off = sc.lead.length;
      const found = divergence(upTo, rsi(closes(upTo), 14), { left: 3, right: 3, lookback: 40 });
      const same = found.filter((d) => Math.abs(d.b.idx - off - sc.b.idx) <= 2);
      total += 1;
      if (same.some((d) => d.type === kind)) hits += 1;
      assert.ok(!same.some((d) => d.type !== kind && DIV_INFO[d.type]?.bias === -DIV_INFO[kind].bias), `${kind}: no opposite divergence ending on B`);
    }
  }
  assert.ok(hits / total >= 0.7, `divergence() confirms ${hits}/${total}`);
});

test('causal: the visible part is identical whatever the outcome candles do', () => {
  for (const kind of ['bullish', 'bearish']) {
    const sc = divergenceScenario(kind, { seed: 101, difficulty: 0.5 });
    const cut = [...sc.lead, ...sc.candles.slice(0, sc.decisionIdx + 1)];
    const full = [...sc.lead, ...sc.candles];
    const r1 = rsi(closes(cut), 14);
    const r2 = rsi(closes(full), 14).slice(0, cut.length);
    assert.deepEqual(r1, r2);
    const off = sc.lead.length;
    const a = readDivergence(cut, r1, { from: off, decision: off + sc.decisionIdx });
    const b = readDivergence(full, rsi(closes(full), 14), { from: off, decision: off + sc.decisionIdx });
    assert.equal(a.lows?.rel, b.lows?.rel);
    assert.equal(a.highs?.rel, b.highs?.rel);
  }
});

test('outcomes: expected breaks the swing between A and B, failed takes out the signal extreme', () => {
  for (const kind of ['bullish', 'bearish', 'hidden-bullish', 'hidden-bearish']) {
    const up = DIV_INFO[kind].bias > 0;
    for (const outcome of ['expected', 'failed']) {
      const sc = divergenceScenario(kind, { seed: 77, difficulty: 0.8, outcome });
      const after = sc.candles.slice(sc.decisionIdx + 1);
      const broke = after.some((c) => (up ? c.c > sc.structure.price : c.c < sc.structure.price));
      assert.equal(broke, outcome === 'expected', `${kind} ${outcome}`);
    }
  }
});

test('MACD histogram rounds: regular divergence and "none" generate and read on the histogram', () => {
  for (const kind of ['bullish', 'bearish', 'none']) {
    for (const seed of SEEDS(3)) {
      const sc = divergenceScenario(kind, { seed, difficulty: 0.8, osc: 'macd' });
      assert.ok(sc, `${kind} macd seed ${seed}`);
      const all = [...sc.lead, ...sc.candles];
      const hist = macd(closes(all)).hist;
      const off = sc.lead.length;
      const read = readDivergence(all, hist, { from: off, decision: off + sc.decisionIdx, oscKind: 'macd' });
      const pair = sc.a.type === 'low' ? read.lows : read.highs;
      assert.equal(pair.rel, kind === 'none' ? 'agree' : kind);
    }
  }
});

test('classifyPair names all four divergences', () => {
  const lo = (idx, price) => ({ idx, price, type: 'low' });
  const hi = (idx, price) => ({ idx, price, type: 'high' });
  const v = (value) => ({ value });
  assert.equal(classifyPair(lo(1, 10), lo(5, 9), v(25), v(35), { atrValue: 1 }).rel, 'bullish');
  assert.equal(classifyPair(lo(1, 10), lo(5, 11), v(40), v(30), { atrValue: 1 }).rel, 'hidden-bullish');
  assert.equal(classifyPair(hi(1, 10), hi(5, 11), v(75), v(65), { atrValue: 1 }).rel, 'bearish');
  assert.equal(classifyPair(hi(1, 10), hi(5, 9), v(55), v(65), { atrValue: 1 }).rel, 'hidden-bearish');
  assert.equal(classifyPair(hi(1, 10), hi(5, 11), v(60), v(70), { atrValue: 1 }).rel, 'agree');
  assert.equal(classifyPair(hi(1, 10), hi(5, 10.1), v(60), v(70), { atrValue: 1 }).rel, 'flat');
});
