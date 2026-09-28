// store.js: load() from localStorage (migrate + normalize, blocked/corrupt storage), store.replace()
// and mergeProgress(), the pure cross-device merge used by js/core/progress-sync.js.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { store, mergeProgress, SCHEMA_VERSION, MAX_MISSES, RECENT_PER_BANK } from '../../js/core/store.js';

beforeEach(() => store.reset());

const clone = (v) => JSON.parse(JSON.stringify(v));

/** Import a fresh store.js instance whose load() runs against `ls` (a localStorage stand-in). */
let fresh = 0;
async function loadWith(ls) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const prev = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
  try {
    const mod = await import(`../../js/core/store.js?load=${++fresh}`);
    return mod.store.state;
  } finally {
    if (had) globalThis.localStorage = prev;
    else delete globalThis.localStorage;
  }
}

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

// ---------------------------------------------------------------- load

test('load: a v1 save is migrated and filled out to the full current shape', async () => {
  const st = await loadWith(memStorage({
    'tts-progress-v1': JSON.stringify({ v: 1, xp: 75, lessons: { a: { done: true, at: 1 } }, games: { g: { best: 5, stars: 1, plays: 2 } }, settings: { sound: false } }),
    'tts-theme': 'dark',
  }));
  assert.equal(st.v, SCHEMA_VERSION);
  assert.equal(st.xp, 75);
  assert.deepEqual(st.lessons, { a: { done: true, at: 1 } });
  assert.deepEqual(st.games.g.styles, { arcade: { best: 5, stars: 1, plays: 2, at: null } });
  assert.deepEqual(st.badges, []);
  assert.deepEqual(st.daily.history, {});
  assert.deepEqual(st.misses, []);
  assert.equal(st.settings.sound, false);
  assert.equal(st.settings.theme, 'dark');
});

test('load: malformed fields fall back to defaults; junk or blocked storage starts fresh', async () => {
  const st = await loadWith(memStorage({
    'tts-progress-v1': JSON.stringify({ v: 2, xp: 'lots', badges: 'x', lessons: null, daily: 5, misses: [null, { bank: 'b', id: 1 }] }),
  }));
  assert.equal(st.xp, 0);
  assert.deepEqual(st.badges, []);
  assert.deepEqual(st.lessons, {});
  assert.equal(st.daily.streak, 0);
  assert.deepEqual(st.misses, [{ bank: 'b', id: 1 }]);

  const junk = await loadWith(memStorage({ 'tts-progress-v1': '{not json' }));
  assert.equal(junk.xp, 0);
  assert.equal(junk.v, SCHEMA_VERSION);

  const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('x'); } };
  const blocked = await loadWith(throwing);
  assert.equal(blocked.xp, 0);
  assert.equal(blocked.settings.theme, 'system');
});

// ---------------------------------------------------------------- replace

test('store.replace: swaps progress, keeps this device settings, emits change, rejects junk', () => {
  store.setSetting('sound', false);
  let changes = 0;
  const off = store.on('change', () => changes++);
  assert.equal(store.replace({ v: SCHEMA_VERSION, xp: 300, badges: ['first-lesson'], settings: { sound: true } }), true);
  off();
  assert.equal(store.state.xp, 300);
  assert.deepEqual(store.state.badges, ['first-lesson']);
  assert.equal(store.state.settings.sound, false, 'settings are device-local');
  assert.deepEqual(store.state.lessons, {}, 'missing fields are defaulted');
  assert.equal(changes, 1);
  assert.equal(store.replace(null), false);
  assert.equal(store.replace({ v: SCHEMA_VERSION + 1, xp: 1 }), false);
  assert.equal(store.state.xp, 300);
});

// ---------------------------------------------------------------- mergeProgress

const LOCAL = {
  v: SCHEMA_VERSION,
  xp: 500,
  lessons: { a: { done: true, at: 10 }, b: { done: false, at: 5 } },
  games: {
    g: { best: 800, stars: 2, plays: 3, at: 100, lastStyle: 'arcade', modes: { beginner: 800 },
      styles: { arcade: { best: 800, stars: 2, plays: 3, at: 100 } } },
  },
  badges: ['first-lesson', 'first-game'],
  badgeDates: { 'first-lesson': 10, 'first-game': 30 },
  lessonSteps: { b: { step: 2, max: 3 } },
  last: { type: 'game', id: 'g', at: 100 },
  lastTier: 'beginner',
  bestStreak: 4,
  gamePrefs: { g: { style: 'arcade', level: 'hard' } },
  daily: { last: '2026-09-27', streak: 2, best: 2, history: { '2026-09-26': 10, '2026-09-27': 20 } },
  recent: { bank: ['q1', 'q2'] },
  misses: [{ bank: 'b', id: 'm1', n: 1, at: 50 }],
  settings: { sound: false, theme: 'dark' },
};

const REMOTE = {
  v: SCHEMA_VERSION,
  xp: 650,
  lessons: { b: { done: true, at: 20 }, c: { done: true, at: 30 } },
  games: {
    g: { best: 600, stars: 3, plays: 5, at: 200, lastStyle: 'survival',
      styles: { arcade: { best: 600, stars: 3, plays: 2, at: 90 }, survival: { best: 300, stars: 1, plays: 3, at: 200, rounds: 12, lastRounds: 9 } } },
    h: { best: 50, stars: 1, plays: 1, at: 150, styles: { practice: { best: 50, stars: 1, plays: 1, at: 150 } } },
  },
  badges: ['first-game', 'first-lesson', 'explorer'],
  badgeDates: { 'first-game': 20, 'first-lesson': 15, explorer: 40 },
  lessonSteps: { b: { step: 1, max: 4 }, c: { step: 5, max: 5 } },
  last: { type: 'lesson', id: 'c', at: 300 },
  lastTier: 'advanced',
  bestStreak: 7,
  gamePrefs: { g: { style: 'survival', source: 'real' }, h: { style: 'practice' } },
  daily: { last: '2026-09-28', streak: 1, best: 5, history: { '2026-09-20': 5, '2026-09-28': 30 } },
  recent: { bank: ['q2', 'q3'], other: ['x'] },
  misses: [{ bank: 'b', id: 'm1', n: 3, at: 40 }, { bank: 'b', id: 'm2', n: 1, at: 60 }],
  settings: { sound: true, theme: 'light' },
};

test('mergeProgress: XP, lessons, games and styles take the best of both', () => {
  const m = mergeProgress(clone(LOCAL), clone(REMOTE));
  assert.equal(m.v, SCHEMA_VERSION);
  assert.equal(m.xp, 650);
  assert.equal(m.bestStreak, 7);
  assert.deepEqual(m.lessons, { a: { done: true, at: 10 }, b: { done: true, at: 20 }, c: { done: true, at: 30 } });
  const g = m.games.g;
  assert.equal(g.best, 800);
  assert.equal(g.stars, 3);
  assert.equal(g.plays, 5);
  assert.equal(g.at, 200);
  assert.equal(g.lastStyle, 'survival', 'from the more recent record');
  assert.deepEqual(g.modes, { beginner: 800 });
  assert.deepEqual(g.styles.arcade, { best: 800, stars: 3, plays: 3, at: 100 });
  assert.deepEqual(g.styles.survival, { best: 300, stars: 1, plays: 3, at: 200, rounds: 12, lastRounds: 9 });
  assert.deepEqual(m.games.h, REMOTE.games.h);
});

test('mergeProgress: badges are a union ordered by earliest earned date', () => {
  const m = mergeProgress(clone(LOCAL), clone(REMOTE));
  assert.deepEqual(m.badges, ['first-lesson', 'first-game', 'explorer']);
  assert.deepEqual(m.badgeDates, { 'first-lesson': 10, 'first-game': 20, explorer: 40 });
});

test('mergeProgress: resume points, last visit, prefs and settings', () => {
  const m = mergeProgress(clone(LOCAL), clone(REMOTE));
  assert.deepEqual(m.lessonSteps, { b: { step: 2, max: 4 }, c: { step: 5, max: 5 } });
  assert.deepEqual(m.last, REMOTE.last, 'most recent visit wins');
  assert.equal(m.lastTier, 'beginner', 'this device wins');
  assert.deepEqual(m.gamePrefs, { g: { style: 'arcade', source: 'real', level: 'hard' }, h: { style: 'practice' } });
  assert.deepEqual(m.settings, LOCAL.settings, 'settings never come from the cloud');
});

test('mergeProgress: daily history is united and the streak recomputed from it', () => {
  const m = mergeProgress(clone(LOCAL), clone(REMOTE));
  assert.deepEqual(m.daily.history, { '2026-09-26': 10, '2026-09-27': 20, '2026-09-20': 5, '2026-09-28': 30 });
  assert.equal(m.daily.last, '2026-09-28');
  assert.equal(m.daily.streak, 3, '26, 27 (local) + 28 (remote) are consecutive');
  assert.equal(m.daily.best, 5);
  // A streak longer than the kept history is not shortened.
  const long = mergeProgress({ ...clone(LOCAL), daily: { last: '2026-09-28', streak: 120, best: 120, history: { '2026-09-28': 1 } } }, clone(REMOTE));
  assert.equal(long.daily.streak, 120);
  assert.equal(long.daily.best, 120);
});

test('mergeProgress: recent ids and misses are united and bounded', () => {
  const m = mergeProgress(clone(LOCAL), clone(REMOTE));
  assert.deepEqual(m.recent, { bank: ['q3', 'q1', 'q2'], other: ['x'] });
  assert.deepEqual(m.misses, [
    { bank: 'b', id: 'm1', n: 3, at: 50 },
    { bank: 'b', id: 'm2', n: 1, at: 60 },
  ]);
  const many = (p, n) => Array.from({ length: n }, (_, i) => ({ bank: p, id: i, n: 1, at: i }));
  const big = mergeProgress({ ...clone(LOCAL), misses: many('x', MAX_MISSES), recent: { k: Array.from({ length: RECENT_PER_BANK }, (_, i) => `a${i}`) } },
    { ...clone(REMOTE), misses: many('y', MAX_MISSES), recent: { k: ['z'] } });
  assert.equal(big.misses.length, MAX_MISSES);
  assert.equal(big.recent.k.length, RECENT_PER_BANK);
  assert.equal(big.recent.k.at(-1), `a${RECENT_PER_BANK - 1}`, 'local (newest) ids are kept last');
});

test('mergeProgress: pure, idempotent and symmetric on the numbers', () => {
  const l = clone(LOCAL);
  const r = clone(REMOTE);
  const m = mergeProgress(l, r);
  assert.deepEqual(l, LOCAL, 'local not mutated');
  assert.deepEqual(r, REMOTE, 'remote not mutated');
  assert.deepEqual(mergeProgress(m, r), m, 'merging the cloud copy again changes nothing');
  assert.deepEqual(mergeProgress(clone(m), clone(m)), m);
  const flipped = mergeProgress(clone(REMOTE), clone(LOCAL));
  for (const k of ['xp', 'bestStreak', 'lessons', 'games', 'badges', 'badgeDates', 'lessonSteps', 'last', 'misses']) {
    assert.deepEqual(flipped[k], m[k], `${k} does not depend on which side is local`);
  }
  assert.deepEqual(flipped.daily.history, m.daily.history);
  assert.equal(flipped.daily.streak, m.daily.streak);
});

test('mergeProgress: v1 saves are migrated; missing sides; newer schemas are refused', () => {
  const v1 = { v: 1, xp: 10, games: { g: { best: 900, stars: 3, plays: 1, at: 1 } } };
  const m = mergeProgress(v1, clone(REMOTE));
  assert.equal(m.games.g.best, 900);
  assert.deepEqual(m.games.g.styles.arcade, { best: 900, stars: 3, plays: 2, at: 90 });
  assert.equal(mergeProgress(null, null), null);
  assert.equal(mergeProgress(null, clone(REMOTE)).xp, 650);
  assert.equal(mergeProgress(clone(LOCAL), 'junk').xp, 500);
  assert.equal(mergeProgress(clone(LOCAL), { ...clone(REMOTE), v: SCHEMA_VERSION + 1 }), null);
  assert.equal(mergeProgress({ v: SCHEMA_VERSION + 1 }, clone(REMOTE)), null);
});
