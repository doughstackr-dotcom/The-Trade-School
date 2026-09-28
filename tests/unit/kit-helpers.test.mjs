// Pure helpers of the game kit (QuestionBank edge cases, bankOptions, trackAnswer) and ui.js
// (fmt, uid, pruneQuizRegistry). games-banks.test.mjs covers QuestionBank's main behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QuestionBank, bankOptions, trackAnswer, explainChoice } from '../../js/core/game-kit.js';
import { fmt, uid, pruneQuizRegistry } from '../../js/core/ui.js';
import { makeRng } from '../../js/core/rng.js';

const ITEMS = [
  { id: 'e1', level: 0 }, { id: 'e2', level: 0 },
  { id: 'm1', level: 1 }, { id: 'm2', level: 1 },
  { id: 'h1', level: 2 }, { id: 'h2', level: 2 },
];

// ---------------------------------------------------------------- QuestionBank

test('QuestionBank: drops items without an id; size / find', () => {
  const bank = new QuestionBank([...ITEMS, null, { level: 1 }, { id: 0 }], { id: 't' });
  assert.equal(bank.size, 7);
  assert.equal(bank.find('m2').level, 1);
  assert.equal(bank.find(0).id, 0);
  assert.equal(bank.find('nope'), null);
});

test('QuestionBank.next: exclude is honoured, and a used-up bank starts over', () => {
  const bank = new QuestionBank(ITEMS, { id: 't' }).reset();
  const ex = new Set(['e1', 'e2', 'm1']);
  const seen = new Set();
  for (let i = 0; i < 3; i++) seen.add(bank.next(0, { exclude: ex }).id);
  assert.deepEqual([...seen].sort(), ['h1', 'h2', 'm2']);
  const again = bank.next(0, { exclude: ex });
  assert.ok(!ex.has(again.id), 'after the bank runs dry exclusions still apply');
  // Excluding everything still returns something rather than null.
  assert.ok(bank.next(0, { exclude: new Set(ITEMS.map((x) => x.id)) }));
});

test('QuestionBank.next: difficulty is clamped and falls back to the nearest level', () => {
  const bank = new QuestionBank([{ id: 'x', level: 0 }, { id: 'y', level: 1 }], { id: 't' }).reset();
  assert.equal(bank.next(5).id, 'y', 'difficulty > 1 → level 2 → nearest is level 1');
  assert.equal(bank.next(-3).id, 'x');
});

test('QuestionBank: recent ids are capped at 60% of the bank and persisted via the store', () => {
  const seen = [];
  const store = {
    recentQuestions: () => ['e1', 'e2', 'm1', 'm2', 'h1'],
    noteQuestionSeen: (bank, id) => seen.push([bank, id]),
  };
  const bank = new QuestionBank(ITEMS, { id: 'bank-x' }).reset(makeRng(3), store);
  assert.equal(bank.recentCap, 3);
  assert.deepEqual(bank.recentIds(), ['m1', 'm2', 'h1'], 'the newest recentCap ids');
  const q = bank.next(0);
  assert.ok(!['m1', 'm2', 'h1'].includes(q.id));
  assert.deepEqual(seen, [['bank-x', q.id]]);
  assert.equal(new QuestionBank(ITEMS, { id: 't', recent: 1 }).recentCap, 1);
  assert.equal(new QuestionBank([{ id: 1 }], { id: 't' }).recentCap, 0);
});

test('QuestionBank.daily: empty bank, n larger than the bank, easiest first', () => {
  assert.deepEqual(new QuestionBank([], { id: 'e' }).daily('2026-09-28'), []);
  const small = new QuestionBank(ITEMS.slice(0, 2), { id: 's' }).daily('2026-09-28', 5);
  assert.equal(small.length, 2);
  const a = new QuestionBank(ITEMS, { id: 'one' }).daily('2026-09-28', 3).map((x) => x.id);
  const levels = new QuestionBank(ITEMS, { id: 'one' }).daily('2026-09-28', 3).map((x) => x.level);
  assert.deepEqual(levels, [...levels].sort((x, y) => x - y), 'easiest first');
  assert.equal(new Set(a).size, 3);
});

test('bankOptions: correct answer plus every wrong label; shuffled only with an rng', () => {
  const qn = { a: 'Right', wrong: { 'W1': 'why 1', 'W2': 'why 2' } };
  assert.deepEqual(bankOptions(qn), [
    { label: 'Right', value: 'Right' }, { label: 'W1', value: 'W1' }, { label: 'W2', value: 'W2' },
  ]);
  const shuffled = bankOptions(qn, makeRng(7));
  assert.deepEqual(shuffled.map((o) => o.label).sort(), ['Right', 'W1', 'W2']);
  assert.deepEqual(bankOptions({ a: 'Only' }), [{ label: 'Only', value: 'Only' }]);
});

test('explainChoice: function explain and function why', () => {
  const ex = explainChoice((ok) => (ok ? 'yes' : 'no'), (v) => `bad ${v}`);
  assert.equal(ex(true, 'a'), 'yes');
  assert.equal(ex(false, 'b'), '<span class="game__why">bad b</span><br>no');
  assert.equal(explainChoice('', { x: 'X!' })(false, 'x'), '<span class="game__why">X!</span>');
  assert.equal(explainChoice('base', { x: 'X!' })(false, 'y'), 'base');
});

test('trackAnswer: records misses, clears on a correct answer, tolerates a missing / throwing store', () => {
  const calls = [];
  const store = { recordMiss: (b, id) => calls.push(['miss', b, id]), clearMiss: (b, id) => calls.push(['clear', b, id]) };
  trackAnswer(store, 'bank', 'q1', false);
  trackAnswer(store, 'bank', 'q1', true);
  trackAnswer(store, 'bank', null, false);
  trackAnswer(store, '', 'q1', false);
  assert.deepEqual(calls, [['miss', 'bank', 'q1'], ['clear', 'bank', 'q1']]);
  assert.doesNotThrow(() => trackAnswer(null, 'bank', 'q', false));
  assert.doesNotThrow(() => trackAnswer({ recordMiss() { throw new Error('full'); } }, 'bank', 'q', false));
});

// ---------------------------------------------------------------- ui.js

test('fmt: en-US grouping, fixed decimals, null → 0', () => {
  assert.equal(fmt(1234567), '1,234,567');
  assert.equal(fmt(1.5, 2), '1.50');
  assert.equal(fmt(2.345, 1), '2.3');
  assert.equal(fmt(null), '0');
});

test('uid: unique, prefixed', () => {
  const a = uid('quiz');
  const b = uid('quiz');
  assert.match(a, /^quiz-\d+$/);
  assert.notEqual(a, b);
  assert.match(uid(), /^tts-\d+$/);
});

test('pruneQuizRegistry: drops collected and answered-and-detached quizzes only', () => {
  const quiz = (isConnected, answered) => ({ isConnected, _quiz: { answered: () => answered, count: 4 } });
  const ref = (el) => ({ deref: () => el });
  const live = ref(quiz(true, false));
  const liveAnswered = ref(quiz(true, true));
  const notYetMounted = ref(quiz(false, false));
  const finishedDetached = ref(quiz(false, true));
  const collected = ref(undefined);
  const list = [live, liveAnswered, notYetMounted, finishedDetached, collected, null];
  const out = pruneQuizRegistry(list);
  assert.deepEqual(out, [live, liveAnswered, notYetMounted]);
  assert.equal(list.length, 6, 'input not mutated');
  assert.deepEqual(pruneQuizRegistry(undefined), []);
});
