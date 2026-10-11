import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMES } from '../../js/registry.js';
import { store } from '../../js/core/store.js';
import {
  CAMPAIGN_LEVEL_COUNT, campaignChapter, campaignDifficulty, campaignProfile,
} from '../../js/core/game-levels.js';

test('all registered games share a 40-stage campaign with short, increasingly difficult runs', () => {
  assert.equal(GAMES.length, 21);
  assert.equal(CAMPAIGN_LEVEL_COUNT, 40);
  assert.equal(campaignProfile(1, 8).rounds, 3);
  assert.equal(campaignProfile(5, 8).rounds, 4, 'chapter checkpoint adds one round');
  assert.ok(campaignProfile(5, 8).timerScale < campaignProfile(4, 8).timerScale, 'checkpoint tightens the clock');
  assert.equal(campaignProfile(11, 8).rounds, 4);
  assert.equal(campaignProfile(15, 8).rounds, 5, 'later checkpoint adds one round');
  assert.equal(campaignProfile(26, 8).rounds, 5);
  assert.equal(campaignProfile(40, 8).rounds, 5);
  assert.equal(campaignProfile(40, 5, { daily: true }).rounds, 5);
  assert.equal(campaignProfile(40, 6).timerScale < campaignProfile(1, 6).timerScale, true);
  for (let level = 1; level < CAMPAIGN_LEVEL_COUNT; level++) {
    assert.ok(campaignDifficulty(level + 1, 1, 5) > campaignDifficulty(level, 1, 5), `level ${level} increases difficulty`);
  }
  assert.ok(campaignDifficulty(1, 5, 5) > campaignDifficulty(1, 1, 5));
  assert.equal(campaignChapter(5).checkpoint, true);
  assert.equal(campaignChapter(40).number, 8);
});

test('a cleared level unlocks the next; replays only pay XP for newly earned stars', () => {
  store.reset();
  const id = 'candle-builder';
  assert.deepEqual([store.levelProgress(id).unlocked, store.levelProgress(id).selected], [1, 1]);
  assert.equal(store.selectLevel(id, 2), false, 'locked levels cannot be selected');

  let result = store.recordGame(id, { style: 'arcade', campaignLevel: 1, score: 30, stars: 0, xp: 90 });
  assert.equal(result.xp, 0);
  assert.equal(store.levelProgress(id).unlocked, 1);

  result = store.recordGame(id, { style: 'arcade', campaignLevel: 1, score: 120, stars: 1, xp: 90 });
  assert.equal(result.xp, 30);
  assert.equal(result.levelResult.unlockedNow, true);
  assert.deepEqual([store.levelProgress(id).unlocked, store.levelProgress(id).selected], [2, 2]);
  assert.equal(store.levelProgress(id).stars[0], 1);

  const earned = store.state.xp;
  result = store.recordGame(id, { style: 'arcade', campaignLevel: 1, score: 400, stars: 1, xp: 90 });
  assert.equal(result.xp, 0);
  assert.equal(store.state.xp, earned);
  assert.equal(store.levelProgress(id).scores[0], 400);
  result = store.recordGame(id, { style: 'arcade', campaignLevel: 1, score: 450, stars: 3, xp: 90 });
  assert.equal(result.xp, 60);
  assert.equal(store.levelProgress(id).stars[0], 3);
  assert.equal(store.selectLevel(id, 1), true);
  assert.equal(store.levelProgress(id).selected, 1);
  assert.equal(store.selectLevel(id, 40), false);
  assert.equal(store.levelProgress('order-desk').unlocked, 1, 'each game progresses independently');
});

test('daily stage advancement requires a distinct day and replay cannot overwrite the first score', () => {
  store.reset();
  const id = 'daily-challenge';
  const first = store.recordDaily({ key: '2026-09-01', score: 200, level: 1 });
  assert.equal(first.first, true);
  const dayOne = store.recordGame(id, {
    style: 'arcade', campaignLevel: 1, score: 200, stars: 0, campaignAdvance: first.first,
  });
  assert.equal(dayOne.xp, 0);
  assert.equal(store.levelProgress(id).unlocked, 2, 'daily stage advances even on a low score');

  const repeat = store.recordDaily({ key: '2026-09-01', score: 500 });
  assert.equal(repeat.first, false);
  assert.equal(repeat.level, 1, 'same-day replays use the completed stage');
  const rejected = store.recordGame(id, {
    style: 'arcade', campaignLevel: 2, score: 500, stars: 3,
    campaignEligible: repeat.first, campaignAdvance: repeat.first,
  });
  assert.equal(rejected.xp, 0);
  assert.equal(store.levelProgress(id).unlocked, 2);
  assert.equal(store.dailyStatus(new Date(2026, 8, 1, 12)).score, 200);
  assert.equal(store.dailyStatus(new Date(2026, 8, 1, 12)).level, 1);

  const next = store.recordDaily({ key: '2026-09-02', score: 250, level: 2 });
  store.recordGame(id, {
    style: 'arcade', campaignLevel: 2, score: 250, stars: 2, campaignAdvance: next.first,
  });
  assert.equal(store.levelProgress(id).unlocked, 3);
  assert.equal(store.levelProgress(id).stars[1], 2);
});

test('old saves remain readable and malformed campaign arrays are bounded', () => {
  store.reset();
  store.replaceState({ games: { 'pattern-flash': { best: 700, stars: 2, plays: 3 } } });
  assert.equal(store.styleStats('pattern-flash', 'arcade').best, 700);
  assert.equal(store.levelProgress('pattern-flash').unlocked, 1);
  assert.equal(store.gameStats('pattern-flash').best, 700);

  store.replaceState({ games: { 'pattern-flash': {
    best: 700, stars: 2, plays: 3,
    campaign: { unlocked: 900, selected: -5, stars: Array(500).fill(7), scores: Array(500).fill(Infinity) },
  } } });
  const progress = store.levelProgress('pattern-flash');
  assert.equal(progress.unlocked, 40);
  assert.equal(progress.selected, 1);
  assert.equal(progress.stars.length, 40);
  assert.equal(progress.scores.length, 40);
  assert.ok(progress.stars.every((n) => n === 3));
  assert.ok(progress.scores.every((n) => n === 0));
});
