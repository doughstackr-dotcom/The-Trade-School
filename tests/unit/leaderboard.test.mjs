// Leaderboard client (v2): pure helpers — handle validation, ISO week math, event rotation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validHandle, isoWeek, weeklyEventGame } from '../../js/core/leaderboard.js';
import { GAMES } from '../../js/registry.js';

test('validHandle: 2–24 chars, starts alphanumeric, limited charset (padded input is trimmed)', () => {
  for (const good of ['ray', 'R3', 'candle_sensei', 'the-trade-school', 'Paper Trader 77', 'a'.repeat(24), ' padded ']) {
    assert.equal(validHandle(good), true, `${good} is valid`);
  }
  for (const bad of ['', 'x', '_underscore', '-dash', 'a'.repeat(25), 'no<u>html', 'semi;colon', 'a b\tc', '   ']) {
    assert.equal(validHandle(bad), false, `${JSON.stringify(bad)} is rejected`);
  }
});

test('isoWeek: known anchors match the ISO 8601 calendar', () => {
  assert.equal(isoWeek(new Date('2026-01-01T12:00:00Z')), 1, '1 Jan 2026 is week 1');
  assert.equal(isoWeek(new Date('2026-10-10T00:00:00Z')), 41, '10 Oct 2026 is week 41');
  // A Monday and the Sunday before it share a week.
  const monday = new Date('2026-10-05T00:00:00Z'); // Monday
  const sunday = new Date('2026-10-04T23:00:00Z'); // the day before
  assert.equal(isoWeek(monday), isoWeek(sunday) + 1);
});

test('weeklyEventGame: always a real game, stable within the week, rotates across weeks', () => {
  const ids = new Set(GAMES.map((g) => g.id));
  const thisWeek = weeklyEventGame();
  assert.ok(ids.has(thisWeek), 'event game exists in the registry');
  const midWeek = new Date();
  midWeek.setUTCDate(midWeek.getUTCDate() - ((midWeek.getUTCDay() + 6) % 7) + 2); // Wednesday of this week
  assert.equal(weeklyEventGame(midWeek), thisWeek, 'stable mid-week');
  const seen = new Set([thisWeek]);
  for (let w = 1; w <= 30; w++) {
    const d = new Date(Date.UTC(2026, 0, 1 + w * 7));
    seen.add(weeklyEventGame(d));
  }
  assert.ok(seen.size >= 4, `rotation covers several games (got ${seen.size})`);
});
