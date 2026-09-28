// Kits v2 (ARCHITECTURE §12.1–§12.6): registry integrity, per-style bests and the daily streak.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as reg from '../../js/registry.js';
import { store, dailyKey } from '../../js/core/store.js';

test('registry: every unit item exists, every lesson/game sits in a unit, kinds/styles/sources are valid', () => {
  const kinds = new Set(reg.GAME_KINDS.map((k) => k.id));
  const styles = new Set(reg.STYLES.map((s) => s.id));
  for (const u of reg.UNITS) {
    if (u.lesson) assert.ok(reg.findEntry(u.lesson), `missing lesson ${u.lesson}`);
    for (const g of u.games) assert.ok(reg.findEntry(g), `missing game ${g}`);
  }
  for (const l of reg.LESSONS) assert.ok(reg.UNITS.some((u) => u.lesson === l.id), `orphan lesson ${l.id}`);
  for (const g of reg.GAMES) {
    assert.ok(reg.UNITS.some((u) => u.games.includes(g.id)), `orphan game ${g.id}`);
    assert.ok(kinds.has(g.kind), `${g.id}: unknown kind ${g.kind}`);
    assert.ok(g.styles.length && g.styles.every((s) => styles.has(s)), `${g.id}: bad styles`);
    assert.ok(g.sources.length && g.sources.every((s) => s === 'textbook' || s === 'real'), `${g.id}: bad sources`);
    assert.ok(reg.findBadge(`${g.id}-ace`), `${g.id}: no ace badge`);
    assert.ok(g.blurb && g.blurb.length > 20, `${g.id}: blurb`);
  }
  const ids = [...reg.LESSONS, ...reg.GAMES].map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
});

test('registry: curriculum order and the new entries', () => {
  assert.deepEqual(reg.unitsOf('beginner').map((u) => u.id), [
    'u-candle-anatomy', 'u-chart-basics', 'u-risk-basics', 'u-candle-patterns', 'u-trends', 'u-support-resistance',
    'u-trendlines', 'u-moving-averages', 'u-volume', 'u-markets-orders', 'u-beginner-capstone',
  ]);
  assert.deepEqual(reg.unitsOf('advanced').map((u) => u.id), [
    'u-chart-patterns', 'u-fibonacci', 'u-indicators', 'u-multi-timeframe', 'u-breakouts', 'u-confluence-risk',
    'u-psychology', 'u-advanced-capstone',
  ]);
  assert.deepEqual(reg.unitOf('daily-challenge').games, ['what-next', 'setup-swipe', 'daily-challenge']);
  assert.deepEqual(reg.unitOf('live-predict').games, ['what-next', 'trade-simulator', 'live-predict']);
  assert.equal(reg.findEntry('daily-challenge').daily, true);
  assert.deepEqual(reg.stylesOf('daily-challenge'), ['arcade']);
  assert.deepEqual(reg.sourcesOf('live-predict'), ['real']);
  assert.deepEqual(reg.tiersOf('live-predict'), ['advanced']);
  // A 'both' game that only sits in the Advanced capstone continues within Advanced.
  assert.equal(reg.nextItem('live-predict'), null);
  assert.equal(reg.nextItem('daily-challenge').id, 'chart-patterns');
  assert.equal(reg.nextItem('order-desk').id, 'what-next');
  // Risk & position sizing sits early in Beginner; Risk Manager is paired in both tracks.
  assert.equal(reg.nextItem('chart-match').id, 'risk-basics');
  assert.equal(reg.nextItem('risk-manager', 'beginner').id, 'candle-patterns');
  assert.equal(reg.nextItem('risk-manager', 'advanced').id, 'psychology');
  assert.equal(reg.findPage('playbook').hash, 'playbook');
  assert.equal(reg.findPage('games').hash, 'games');
  assert.equal(reg.findEntry('_kit-demo').dev, true);
  assert.ok(!reg.LESSONS.some((l) => l.id === '_kit-demo'), 'dev entries stay out of the curriculum');
});

test('store: best per (game, style), legacy records count as arcade, survival rounds', () => {
  store.reset();
  // A legacy record (before play styles) with no styles map.
  store.state.games['pattern-flash'] = { best: 700, stars: 2, plays: 3 };
  assert.equal(store.styleStats('pattern-flash', 'arcade').best, 700);
  assert.equal(store.styleStats('pattern-flash', 'survival'), null);

  let r = store.recordGame('pattern-flash', { score: 500, stars: 1, style: 'practice', xp: 5 });
  assert.equal(r.isBest, true, 'first practice run is a practice best');
  assert.equal(r.best, 500);
  assert.equal(r.isOverallBest, false);
  assert.equal(r.overallBest, 700);

  r = store.recordGame('pattern-flash', { score: 900, stars: 3, style: 'survival', rounds: 12, xp: 5 });
  assert.equal(r.bestRounds, 12);
  assert.equal(r.isBestRounds, true);
  r = store.recordGame('pattern-flash', { score: 1200, stars: 2, style: 'survival', rounds: 9, xp: 5 });
  assert.equal(r.bestRounds, 12, 'best rounds is kept');
  assert.equal(r.isBestRounds, false);
  assert.equal(r.best, 1200, 'best score per style is kept separately');
  assert.equal(store.gameStats('pattern-flash').best, 1200, 'overall best still updates');
  assert.equal(store.gameStats('pattern-flash').stars, 3);
  assert.equal(store.gameStats('pattern-flash').plays, 6);

  // Legacy call without a style: overall semantics, recorded as arcade.
  r = store.recordGame('pattern-flash', { score: 800, stars: 2, xp: 5 });
  assert.equal(r.best, 1200);
  assert.equal(store.styleStats('pattern-flash', 'arcade').best, 800);
  assert.ok(store.has('play-your-way'), 'all three styles played earns play-your-way');

  store.recordGame('trend-spotter', { score: 100, stars: 3, style: 'survival', rounds: 15, xp: 1 });
  assert.ok(store.has('survivor'));
});

test('store: remembered game prefs', () => {
  store.reset();
  assert.equal(store.getGamePref('fib-sniper', 'style'), null);
  assert.equal(store.getGamePref('fib-sniper', 'style', 'arcade'), 'arcade');
  store.setGamePref('fib-sniper', 'style', 'survival');
  store.setGamePref('fib-sniper', 'source', 'real');
  assert.equal(store.getGamePref('fib-sniper', 'style'), 'survival');
  assert.equal(store.getGamePref('fib-sniper', 'source'), 'real');
});

test('store: daily challenge streak uses consecutive local dates', () => {
  store.reset();
  const day = (d) => new Date(2026, 8, d, 12);
  assert.equal(dailyKey(day(1)), '2026-09-01');
  let r = store.recordDaily({ score: 300, key: dailyKey(day(1)) });
  assert.deepEqual([r.first, r.streak], [true, 1]);
  r = store.recordDaily({ score: 350, key: dailyKey(day(1)) });
  assert.equal(r.first, false, 'a replay the same day does not count');
  assert.equal(r.streak, 1);
  for (let d = 2; d <= 7; d++) r = store.recordDaily({ score: 100, key: dailyKey(day(d)) });
  assert.equal(r.streak, 7);
  assert.ok(r.newBadges.includes('daily-streak-7'));
  let s = store.dailyStatus(day(7));
  assert.deepEqual([s.done, s.streak, s.best, s.score], [true, 7, 7, 100]);
  s = store.dailyStatus(day(8));
  assert.deepEqual([s.done, s.streak], [false, 7], 'yesterday counts: the streak is still alive');
  s = store.dailyStatus(day(10));
  assert.equal(s.streak, 0, 'a missed day breaks the streak');
  r = store.recordDaily({ score: 50, key: dailyKey(day(10)) });
  assert.deepEqual([r.streak, r.best], [1, 7]);
  // Month boundary.
  store.reset();
  store.recordDaily({ key: '2026-09-30' });
  assert.equal(store.recordDaily({ key: '2026-10-01' }).streak, 2);
});
