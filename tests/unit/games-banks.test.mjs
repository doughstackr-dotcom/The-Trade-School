// Game content and helpers: QuestionBank (recent-question avoidance, daily sets), the question
// banks (sizes, ids, answer/distractor hygiene), Divergence Detective rounds, Setup Swipe charts,
// Risk Manager numbers, and Daily Challenge review items built from recorded misses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../../js/core/rng.js';
import { simRound, SETUP_KINDS } from '../../js/core/scanner.js';
import { QuestionBank, bankOptions, explainChoice } from '../../js/core/game-kit.js';
import * as daily from '../../js/games/daily-challenge.js';
import * as div from '../../js/games/divergence-detective.js';
import * as swipe from '../../js/games/setup-swipe.js';
import * as risk from '../../js/games/risk-manager.js';
import { QUESTIONS as ORDER } from '../../js/games/order-desk.js';
import { QUESTIONS as TILT } from '../../js/games/tilt-control.js';
import { candleWhy, lookalikesOf } from '../../js/games/pattern-flash.js';

/** Minimal store double with the question-history API. */
function fakeStore() {
  const recent = {};
  let misses = [];
  return {
    recent,
    recentQuestions: (b) => recent[b] || [],
    noteQuestionSeen: (b, id) => {
      const l = (recent[b] || []).filter((x) => x !== id);
      l.push(id);
      recent[b] = l.slice(-40);
    },
    recordMiss: (bank, id) => {
      misses = misses.filter((m) => !(m.bank === bank && m.id === id));
      misses.push({ bank, id, n: 1, at: Date.now() });
    },
    clearMiss: (bank, id) => { misses = misses.filter((m) => !(m.bank === bank && m.id === id)); },
    recentMisses: ({ banks = null } = {}) => misses.filter((m) => !banks || banks.includes(m.bank)).slice().reverse(),
  };
}

// ---------------------------------------------------------------- Divergence Detective

test('divergence: the game kinds are real scanner kinds', () => {
  for (const k of [...div.DIVERGENCE_KINDS, ...div.CONFIRM_KINDS]) assert.ok(SETUP_KINDS[k], `unknown kind ${k}`);
});

test('divergence: simRound with the game kinds returns a round for every seed', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const r = simRound(makeRng(seed), { kinds: div.DIVERGENCE_KINDS, before: 80, after: 16 });
    assert.ok(r, `seed ${seed}: no round`);
    assert.ok(div.DIVERGENCE_KINDS.includes(r.setup.kind));
    assert.ok(['bear-div', 'bull-div'].includes(div.answerFor(r)));
    assert.ok(r.candles.length > r.decisionIdx);
  }
});

test('divergence: textbookRound never returns null and confirmation rounds really confirm', () => {
  let confirms = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const rng = makeRng(seed);
    const d = div.textbookRound(rng.fork('d'), { wantConfirm: false });
    assert.ok(d && d.candles.length, 'divergence round');
    const c = div.textbookRound(rng.fork('c'), { wantConfirm: true });
    assert.ok(c && c.candles.length, 'confirm round (or divergence fallback)');
    if (div.answerFor(c) === 'confirm') {
      confirms++;
      const info = div.confirmationOf(c);
      assert.ok(info.confirms, 'RSI must confirm the price swing');
      assert.ok(info.up ? info.b.price > info.a.price : info.b.price < info.a.price, 'price makes a new extreme');
    }
  }
  assert.ok(confirms >= 6, `expected most confirm rounds to succeed, got ${confirms}/12`);
});

// ---------------------------------------------------------------- QuestionBank

const ITEMS = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, level: i % 3 }));

test('QuestionBank: no repeats within a run until the bank is used up', () => {
  const bank = new QuestionBank(ITEMS, { id: 't' }).reset(makeRng(1));
  const seen = new Set();
  for (let i = 0; i < ITEMS.length; i++) seen.add(bank.next(i / ITEMS.length).id);
  assert.equal(seen.size, ITEMS.length);
  assert.ok(bank.next(0), 'keeps going after the bank is exhausted');
});

test('QuestionBank: prefers the level matching the difficulty', () => {
  const bank = new QuestionBank(ITEMS, { id: 't' }).reset(makeRng(2));
  assert.equal(bank.next(0).level, 0);
  assert.equal(bank.next(1).level, 2);
  assert.equal(bank.next(0.5).level, 1);
});

test('QuestionBank: a new run avoids the questions seen in the last run (persisted)', () => {
  const store = fakeStore();
  const bank = new QuestionBank(ITEMS, { id: 't' });
  bank.reset(makeRng(3), store);
  const first = new Set(Array.from({ length: 7 }, (_, i) => bank.next(i / 7).id));
  assert.deepEqual(new Set(store.recent.t), first);
  bank.reset(makeRng(3), store); // same shuffle: without the recent list it would repeat
  const second = Array.from({ length: 7 }, (_, i) => bank.next(i / 7).id);
  for (const id of second) assert.ok(!first.has(id), `${id} repeated from the previous run`);
});

test('QuestionBank: works without a store and with a throwing store', () => {
  const bad = { recentQuestions() { throw new Error('x'); }, noteQuestionSeen() { throw new Error('x'); } };
  const bank = new QuestionBank(ITEMS, { id: 't' }).reset(makeRng(4), bad);
  assert.ok(bank.next(0.2));
  assert.equal(new QuestionBank([], { id: 'e' }).next(0), null);
});

test('QuestionBank.daily: deterministic, easiest first, no repeats on consecutive days', () => {
  const bank = new QuestionBank(daily.QUESTIONS, { id: 'daily' });
  const a = bank.daily('2026-09-28', 5).map((q) => q.id);
  assert.deepEqual(a, new QuestionBank(daily.QUESTIONS, { id: 'daily' }).daily('2026-09-28', 5).map((q) => q.id));
  const lv = bank.daily('2026-09-28', 5).map((q) => q.level);
  assert.deepEqual(lv, [...lv].sort((x, y) => x - y));
  const days = Math.floor(daily.QUESTIONS.length / 5);
  const seen = new Set();
  for (let d = 0; d < days; d++) {
    const key = new Date(Date.UTC(2026, 9, 1 + d)).toISOString().slice(0, 10);
    for (const q of bank.daily(key, 5)) {
      assert.ok(!seen.has(q.id), `${q.id} repeated within ${days} days`);
      seen.add(q.id);
    }
  }
});

test('explainChoice leads with the specific mistake on a wrong answer only', () => {
  const ex = explainChoice('<strong>A.</strong>', { b: 'B is wrong because…' });
  assert.equal(ex(true, 'a'), '<strong>A.</strong>');
  assert.match(ex(false, 'b'), /B is wrong because…/);
  assert.match(ex(false, 'b'), /<strong>A\.<\/strong>/);
  assert.equal(ex(false, 'zzz'), '<strong>A.</strong>');
});

// ---------------------------------------------------------------- banks

function checkMcq(list, name, min) {
  assert.ok(list.length >= min, `${name}: ${list.length} < ${min}`);
  const ids = new Set();
  for (const q of list) {
    assert.ok(q.id && !ids.has(q.id), `${name}: duplicate or missing id ${q.id}`);
    ids.add(q.id);
    assert.ok([0, 1, 2].includes(q.level), `${name}/${q.id}: level`);
    assert.ok(q.q && q.a && q.explain && q.hint, `${name}/${q.id}: fields`);
    const wrong = Object.keys(q.wrong || {});
    assert.ok(wrong.length >= 1, `${name}/${q.id}: needs distractors`);
    assert.ok(!wrong.includes(q.a), `${name}/${q.id}: answer listed as wrong`);
    for (const w of wrong) assert.ok(q.wrong[w].length > 10, `${name}/${q.id}: explain why "${w}" is wrong`);
    const opts = bankOptions(q, makeRng(1));
    assert.equal(new Set(opts.map((o) => o.value)).size, opts.length);
    assert.ok(opts.some((o) => o.value === q.a));
  }
  return list;
}

test('Daily Challenge bank: ≥ 40 questions covering every level', () => {
  const list = checkMcq(daily.QUESTIONS, 'daily', 40);
  for (const lv of [0, 1, 2]) assert.ok(list.filter((q) => q.level === lv).length >= 8, `level ${lv}`);
  for (const id of ['d-one-percent', 'd-size-50', 'd-rr-3to1', 'd-drawdown', 'd-expectancy']) assert.ok(list.some((q) => q.id === id), `risk basics: ${id}`);
});

test('Order Desk bank: ≥ 20 questions incl. stop-limit, time-in-force, slippage, gaps', () => {
  const list = checkMcq(ORDER, 'order-desk', 20);
  for (const id of ['od-stop-limit', 'od-stop-limit-gap', 'od-day-order', 'od-gtc', 'od-ioc', 'od-slippage-definition', 'od-overnight-gap']) {
    assert.ok(list.some((q) => q.id === id), id);
  }
});

test('Tilt Control bank: ≥ 16 scenarios with a heat value', () => {
  const list = checkMcq(TILT, 'tilt-control', 16);
  for (const q of list) assert.ok(q.heat > 0, `${q.id}: heat`);
});

test('Setup Swipe: ≥ 24 cards and every card chart shows its setup', () => {
  assert.ok(swipe.CARDS.length >= 24);
  const ids = new Set();
  for (const c of swipe.CARDS) {
    assert.ok(!ids.has(c.id), c.id);
    ids.add(c.id);
    assert.equal(typeof c.take, 'boolean');
    assert.ok(c.text && c.explain && c.why && c.hint, c.id);
    const r = swipe.cardRound(c, makeRng(ids.size));
    assert.ok(r.candles.length > 10 && r.decisionIdx < r.candles.length, `${c.id}: chart`);
    if (c.chart.t === 'sim') {
      assert.ok(r.setup, `${c.id}: expected a scanner setup`);
      assert.ok(c.chart.kinds.includes(r.setup.kind), `${c.id}: ${r.setup.kind}`);
    }
    if (c.chart.lowVolume) {
      const d = r.decisionIdx;
      const prev = r.candles.slice(d - 20, d).map((k) => k.v);
      assert.ok(r.candles[d].v < Math.min(...prev), `${c.id}: breakout volume should be the lowest`);
    }
  }
  assert.ok(swipe.CARDS.filter((c) => c.take).length >= 8 && swipe.CARDS.filter((c) => !c.take).length >= 8);
});

test('Pattern Flash: lookalikes get a specific explanation', () => {
  assert.match(candleWhy('hammer', 'hanging-man'), /prior trend|context/i);
  assert.match(candleWhy('shooting-star', 'inverted-hammer'), /rally/);
  assert.match(candleWhy('bullish-engulfing', 'bearish-engulfing'), /GREEN/);
  assert.ok(lookalikesOf('hammer').includes('hanging-man'));
  assert.ok(candleWhy('hammer', 'three-black-crows').length > 20, 'generic fallback');
});

// ---------------------------------------------------------------- Risk Manager

test('Risk Manager: share options are distinct, ≥ 1, and the answer is rounded down', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = makeRng(seed);
    const s = risk.scenario(rng, (seed % 10) / 10);
    assert.equal(s.shares, Math.max(1, Math.floor(s.risk$ / s.riskPerShare)));
    const opts = risk.shareOptions(s, rng);
    assert.equal(opts.length, 4);
    assert.equal(opts[0].value, s.shares);
    assert.equal(new Set(opts.map((o) => o.value)).size, 4);
    for (const o of opts.slice(1)) assert.ok(o.value >= 1 && o.why, 'each distractor explains its mistake');
  }
});

test('Risk Manager: expectancy and R:R change between rounds and have 4 distinct options', () => {
  const qs = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const rng = makeRng(seed);
    const ex = risk.expectancyQuestion(rng);
    qs.add(`${ex.p}/${ex.W}`);
    assert.equal(ex.opts.length, 4);
    assert.equal(ex.opts[0].value, Math.round((ex.p * ex.W - (1 - ex.p)) * 100) / 100);
    assert.equal(new Set(ex.opts.map((o) => o.value)).size, 4);
    const s = risk.scenario(rng, 0.8);
    const rr = risk.rrOptions(s, rng);
    assert.equal(new Set(rr.map((o) => o.value)).size, 4);
  }
  assert.ok(qs.size >= 10, 'expectancy numbers vary');
});

test('Risk Manager: the portfolio heat question has both answers', () => {
  const answers = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const s = risk.scenario(makeRng(seed), 0.5);
    answers.add(s.openR + s.newR <= s.heatLimitR ? 'yes' : 'no');
  }
  assert.deepEqual([...answers].sort(), ['no', 'yes']);
});

// ---------------------------------------------------------------- Daily reviews

test('Daily Challenge: misses from every review bank become labelled review items', () => {
  const store = fakeStore();
  store.recordMiss('order-desk', 'od-stop-limit');
  store.recordMiss('candle-pattern', 'hammer');
  store.recordMiss('divergence', 'confirm');
  store.recordMiss('setup-swipe', 'ss-mid-range');
  store.recordMiss('tilt-control', 'tc-revenge');
  store.recordMiss('chart-pattern', 'double-top');
  store.recordMiss('daily', 'd-fib-calc');
  store.recordMiss('nope', 'x');
  const rng = makeRng(9);
  for (const m of store.recentMisses({ banks: daily.REVIEW_BANKS })) {
    const item = daily.reviewItem(m, rng);
    assert.ok(item, `${m.bank}/${m.id}`);
    const wrong = Object.keys(item.wrong);
    assert.ok(wrong.length >= 1 && !wrong.includes(item.a), `${m.bank}: options`);
  }
  const items = daily.reviewItems(store, rng);
  assert.equal(items.length, 2);
  assert.ok(items.every((it) => it.review));
  assert.equal(items[0].bank, 'daily'); // newest miss first
  const skip = daily.reviewItems(store, rng, { skipIds: new Set(['d-fib-calc']) });
  assert.ok(skip.every((it) => it.q.id !== 'd-fib-calc'));
  assert.deepEqual(daily.reviewItems(null, rng), []);
});
