// store.js: schema migration (migrate / SCHEMA_VERSION) and the question-history API used by
// QuestionBank and the Daily Challenge reviews (recentQuestions, recordMiss, recentMisses…).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { store, migrate, SCHEMA_VERSION, MAX_MISSES, RECENT_PER_BANK } from '../../js/core/store.js';

beforeEach(() => store.reset());

test('migrate: v1 saves (and saves without v) upgrade to the current schema', () => {
  const v1 = {
    v: 1, xp: 120,
    games: {
      'order-desk': { best: 300, stars: 2, plays: 4, at: 5 },
      'pattern-flash': { best: 0, stars: 0, plays: 0 },
      'chart-match': { best: 90, stars: 1, plays: 1, styles: { practice: { best: 90, stars: 1, plays: 1 } } },
    },
  };
  const out = migrate(v1);
  assert.equal(out.v, SCHEMA_VERSION);
  assert.deepEqual(out.games['order-desk'].styles, { arcade: { best: 300, stars: 2, plays: 4, at: 5 } });
  assert.deepEqual(out.games['pattern-flash'].styles, {});
  assert.deepEqual(out.games['chart-match'].styles, { practice: { best: 90, stars: 1, plays: 1 } });
  assert.deepEqual(out.recent, {});
  assert.deepEqual(out.misses, []);
  assert.equal(out.xp, 120);
  assert.equal(v1.games['order-desk'].styles, undefined, 'input is not mutated');
  const noV = migrate({ xp: 5 });
  assert.equal(noV.v, SCHEMA_VERSION);
  assert.deepEqual(noV.misses, []);
});

test('migrate: current saves pass through, newer ones are kept, junk is rejected', () => {
  const cur = { v: SCHEMA_VERSION, xp: 1, recent: { a: ['x'] }, misses: [{ bank: 'b', id: 'c', n: 1, at: 1 }] };
  assert.deepEqual(migrate(cur), cur);
  const future = { v: SCHEMA_VERSION + 5, xp: 9, somethingNew: true };
  assert.deepEqual(migrate(future), future);
  for (const junk of [null, undefined, 42, 'x', [1, 2]]) assert.equal(migrate(junk), null);
  const bad = migrate({ v: 1, recent: [1], misses: 'no', games: { g: null } });
  assert.deepEqual(bad.recent, {});
  assert.deepEqual(bad.misses, []);
  assert.equal(bad.games.g, null);
});

test('store: fresh state is on the current schema', () => {
  assert.equal(store.state.v, SCHEMA_VERSION);
  assert.deepEqual(store.state.recent, {});
  assert.deepEqual(store.state.misses, []);
});

test('store: recent question ids per bank are de-duplicated and bounded', () => {
  for (let i = 0; i < RECENT_PER_BANK + 10; i++) store.noteQuestionSeen('bank', `q${i}`);
  store.noteQuestionSeen('bank', 'q20');
  const list = store.recentQuestions('bank');
  assert.equal(list.length, RECENT_PER_BANK);
  assert.equal(list[list.length - 1], 'q20');
  assert.equal(list.filter((x) => x === 'q20').length, 1);
  assert.deepEqual(store.recentQuestions('other'), []);
});

test('store: misses are recorded newest first, counted, cleared and bounded', () => {
  store.recordMiss('order-desk', 'a');
  store.recordMiss('candle-pattern', 'hammer');
  store.recordMiss('order-desk', 'a');
  const all = store.recentMisses();
  assert.equal(all.length, 2);
  assert.deepEqual([all[0].bank, all[0].id, all[0].n], ['order-desk', 'a', 2]);
  assert.deepEqual(store.recentMisses({ banks: ['candle-pattern'] }).map((m) => m.id), ['hammer']);
  assert.equal(store.clearMiss('order-desk', 'a'), true);
  assert.equal(store.clearMiss('order-desk', 'a'), false);
  for (let i = 0; i < MAX_MISSES + 15; i++) store.recordMiss('daily', `d${i}`);
  assert.equal(store.recentMisses().length, MAX_MISSES);
  assert.equal(store.recentMisses({ limit: 2 }).length, 2);
});
