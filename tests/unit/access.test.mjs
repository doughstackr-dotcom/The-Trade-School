// Access rules (js/core/access.js), progress merge (js/core/sync.js) and premium import rewriting
// (js/core/premium-loader.js) — ARCHITECTURE §9. Pure functions, no DOM.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  requiredPlan, canOpen, blockReason, planCta, lockLabel, levelLabel, planChipLabel, rankOf, PLAN_RANK,
  resolveAccessMode, isLocalHost, makeAccess, unlocksFor, unlockLines, premiumFolder, modeRequirement,
  describeTarget, upgradeHash, planForTier,
} from '../../js/core/access.js';
import { FREE_IDS, PAGE_PLANS } from '../../js/config.js';
import { LESSONS, GAMES, DEV_ENTRIES, findEntry } from '../../js/registry.js';
import { parseHash } from '../../js/core/router.js';
import { mergeProgress, pickSynced, SYNC_FIELDS, stableKey } from '../../js/core/sync.js';
import { rewriteImports, sitePath, bucketPath } from '../../js/core/premium-loader.js';

const LEVELS = [null, 'free', 'beginner', 'advanced'];
const ENTRIES = [...LESSONS, ...GAMES];

/** The access matrix from the brief, written out independently of access.js. */
function expected(entry, mode = null) {
  if (FREE_IDS.includes(entry.id)) return 'account';
  if (entry.tier === 'beginner') return 'beginner';
  if (entry.tier === 'advanced') return 'advanced';
  if (entry.tier === 'both') return mode === 'advanced' ? 'advanced' : 'beginner';
  throw new Error(`unknown tier ${entry.tier}`);
}
const allowed = { null: [], account: ['free', 'beginner', 'advanced'], beginner: ['beginner', 'advanced'], advanced: ['advanced'] };

describe('access rules', () => {
  test('config keeps the owner-editable rules', () => {
    assert.deepEqual(FREE_IDS, ['candle-anatomy', 'candle-builder', 'daily-challenge']);
    assert.equal(PAGE_PLANS.library, 'account');
    assert.equal(PAGE_PLANS.playbook, 'account');
    assert.equal(PAGE_PLANS.live, 'beginner');
  });

  test('every registry entry × every level follows the access matrix', () => {
    let checks = 0;
    for (const e of ENTRIES) {
      const need = expected(e);
      assert.equal(requiredPlan(e), need, `${e.id} requires ${need}`);
      assert.equal(requiredPlan(e.id), need, `${e.id} by id`);
      for (const lv of LEVELS) {
        const ok = allowed[need].includes(lv);
        assert.equal(canOpen(e, lv), ok, `${e.id} at level ${lv}`);
        assert.equal(canOpen(e, lv, { enforce: false }), true, `${e.id} open mode`);
        checks++;
      }
    }
    assert.ok(checks >= (LESSONS.length + GAMES.length) * 4);
  });

  test("'both'-tier games: Beginner mode needs Beginner, Advanced mode needs Advanced", () => {
    const both = GAMES.filter((g) => g.tier === 'both' && !FREE_IDS.includes(g.id));
    assert.ok(both.some((g) => g.id === 'what-next'));
    for (const g of both) {
      for (const mode of ['beginner', 'advanced']) {
        const need = expected(g, mode);
        assert.equal(requiredPlan(g, { mode }), need, `${g.id} ${mode}`);
        for (const lv of LEVELS) assert.equal(canOpen(g, lv, { mode }), allowed[need].includes(lv), `${g.id} ${mode} @ ${lv}`);
      }
    }
    const wn = findEntry('what-next');
    assert.equal(canOpen(wn, 'beginner', { mode: 'beginner' }), true);
    assert.equal(canOpen(wn, 'beginner', { mode: 'advanced' }), false);
    assert.equal(canOpen(wn, 'advanced', { mode: 'advanced' }), true);
    assert.equal(canOpen(wn, 'free', { mode: 'beginner' }), false);
    // the Daily Challenge is free in every mode (mixed-level questions are a plan perk inside it)
    assert.equal(requiredPlan('daily-challenge', { mode: 'advanced' }), 'account');
  });

  test('GameShell modes: explicit requires wins, else the rule for the game', () => {
    const wn = findEntry('what-next');
    assert.equal(modeRequirement(wn, { id: 'advanced' }), 'advanced');
    assert.equal(modeRequirement(wn, 'beginner'), 'beginner');
    assert.equal(modeRequirement(findEntry('fib-sniper'), { id: 'easy' }), 'advanced');
    assert.equal(modeRequirement(findEntry('pattern-flash'), { id: 'pro', requires: 'advanced' }), 'advanced');
    assert.equal(modeRequirement(findEntry('pattern-flash'), { id: 'x', requires: 'free' }), 'account');
  });

  test('routes: public pages, gated pages, lessons and games', () => {
    const cases = {
      home: null, beginner: null, advanced: null, pricing: null, 'pricing.advanced': null, glossary: null, progress: null,
      signin: null, signup: null, reset: null, 'reset.update': null, terms: null, privacy: null, account: null, 'dev-chart': null,
      library: 'account', 'library.hammer': 'account', playbook: 'account', 'playbook.hammer': 'account', live: 'beginner',
      'l.candle-anatomy': 'account', 'g.candle-builder': 'account', 'g.daily-challenge': 'account',
      'l.trends': 'beginner', 'g.pattern-flash': 'beginner', 'g.what-next': 'beginner', 'g.setup-swipe': 'beginner', 'g.live-predict': 'beginner',
      'l.fibonacci': 'advanced', 'g.trade-simulator': 'advanced', 'g.tilt-control': 'advanced',
      'l.nope': null, nonsense: null,
    };
    for (const [hash, need] of Object.entries(cases)) assert.equal(requiredPlan(parseHash(hash)), need, `#${hash}`);
    assert.equal(parseHash('signin').page, 'auth');
    assert.equal(parseHash('reset.update').param, 'reset.update');
    assert.equal(parseHash('terms').page, 'legal');
    assert.equal(parseHash('pricing.beginner').param, 'beginner');
  });

  test('developer demos are never gated', () => {
    for (const d of DEV_ENTRIES) assert.equal(requiredPlan(d), null);
  });

  test('block reasons and plan buttons', () => {
    assert.deepEqual(blockReason('candle-anatomy', null), { required: 'account', plan: null, reason: 'signin' });
    assert.equal(blockReason('candle-anatomy', 'free'), null);
    assert.deepEqual(blockReason('trends', null), { required: 'beginner', plan: 'beginner', reason: 'signin' });
    assert.deepEqual(blockReason('trends', 'free'), { required: 'beginner', plan: 'beginner', reason: 'subscribe' });
    assert.deepEqual(blockReason('fibonacci', 'free'), { required: 'advanced', plan: 'advanced', reason: 'subscribe' });
    assert.deepEqual(blockReason('fibonacci', 'beginner'), { required: 'advanced', plan: 'advanced', reason: 'upgrade' });
    assert.deepEqual(blockReason('what-next', 'beginner', { mode: 'advanced' }), { required: 'advanced', plan: 'advanced', reason: 'upgrade' });
    assert.equal(blockReason('fibonacci', 'advanced'), null);

    assert.equal(planCta('beginner', null).action, 'signup');
    assert.equal(planCta('beginner', 'free').label, 'Subscribe to Beginner');
    assert.equal(planCta('advanced', 'free').action, 'subscribe');
    assert.deepEqual(planCta('advanced', 'beginner'), { action: 'upgrade', label: 'Upgrade to Advanced', current: false });
    assert.equal(planCta('beginner', 'beginner').action, 'manage');
    assert.equal(planCta('beginner', 'beginner').current, true);
    assert.equal(planCta('beginner', 'advanced').action, 'included');
    assert.equal(planCta('advanced', 'advanced').action, 'manage');
  });

  test('labels', () => {
    assert.equal(lockLabel('account'), 'Free');
    assert.equal(lockLabel('beginner'), 'Beginner plan');
    assert.equal(lockLabel('advanced'), 'Advanced plan');
    assert.equal(lockLabel(null), null);
    assert.equal(levelLabel(null), 'Signed out');
    assert.equal(levelLabel('advanced'), 'Advanced');
    assert.equal(planChipLabel('free'), 'Free plan');
    assert.equal(planChipLabel(null), null);
    assert.equal(upgradeHash('advanced', 'beginner'), '#pricing.advanced');
    assert.equal(upgradeHash('account', null), '#signup');
    assert.ok(PLAN_RANK.advanced > PLAN_RANK.beginner && PLAN_RANK.beginner > PLAN_RANK.free && PLAN_RANK.free > PLAN_RANK.none);
    assert.equal(rankOf(undefined), 0);
    assert.equal(planForTier('both', { mode: 'advanced' }), 'advanced');
  });

  test('ACCESS_MODE: auto is open on localhost unless tts-enforce-access = 1, enforced elsewhere', () => {
    for (const hn of ['localhost', '127.0.0.1', '::1', '[::1]']) {
      assert.equal(isLocalHost(hn), true, hn);
      assert.equal(resolveAccessMode({ mode: 'auto', hostname: hn }), 'open');
      assert.equal(resolveAccessMode({ mode: 'auto', hostname: hn, enforceFlag: '1' }), 'enforce');
      assert.equal(resolveAccessMode({ mode: 'auto', hostname: hn, enforceFlag: '0' }), 'open');
    }
    for (const hn of ['example.com', 'doughstackr-dotcom.github.io', '192.168.1.5', '']) {
      assert.equal(resolveAccessMode({ mode: 'auto', hostname: hn }), 'enforce', hn || '(empty)');
    }
    assert.equal(resolveAccessMode({ mode: 'open', hostname: 'example.com' }), 'open');
    assert.equal(resolveAccessMode({ mode: 'enforce', hostname: 'localhost' }), 'enforce');
  });

  test('ctx.access object', () => {
    let lv = null;
    const a = makeAccess(() => lv, { enforce: true });
    assert.equal(a.level, null);
    assert.equal(a.signedIn, false);
    assert.equal(a.can('free'), false);
    assert.equal(a.can(null), true);
    assert.equal(a.canOpen('candle-builder'), false);
    lv = 'free';
    assert.equal(a.signedIn, true);
    assert.equal(a.can('free'), true);
    assert.equal(a.can('beginner'), false);
    assert.equal(a.canTier('beginner'), false);
    lv = 'beginner';
    assert.equal(a.canTier('beginner'), true);
    assert.equal(a.canTier('advanced'), false);
    assert.equal(a.canOpen('what-next', { mode: 'advanced' }), false);
    assert.equal(a.modeRequirement(findEntry('what-next'), 'advanced'), 'advanced');
    const open = makeAccess(null, { enforce: false });
    assert.equal(open.can('advanced'), true);
    assert.equal(open.canOpen('fibonacci'), true);
    assert.equal(open.canTier('advanced'), true);
  });

  test('what each plan unlocks covers the whole catalogue exactly once', () => {
    const free = unlocksFor('account');
    const beg = unlocksFor('beginner');
    const adv = unlocksFor('advanced');
    const lessonIds = [...free.lessons, ...beg.lessons, ...adv.lessons].map((e) => e.id);
    const gameIds = [...free.games, ...beg.games, ...adv.games].map((e) => e.id);
    assert.deepEqual([...lessonIds].sort(), LESSONS.map((l) => l.id).sort());
    assert.deepEqual([...gameIds].sort(), GAMES.map((g) => g.id).sort());
    assert.equal(new Set(lessonIds).size, lessonIds.length);
    assert.equal(new Set(gameIds).size, gameIds.length);
    assert.deepEqual(free.lessons.map((e) => e.id), ['candle-anatomy']);
    assert.deepEqual(free.games.map((e) => e.id).sort(), ['candle-builder', 'daily-challenge']);
    assert.ok(beg.games.some((g) => g.id === 'what-next') && beg.games.some((g) => g.id === 'live-predict'));
    assert.ok(adv.modes.some((m) => m.game.id === 'what-next' && m.mode === 'advanced'));
    assert.ok(!adv.modes.some((m) => m.game.id === 'daily-challenge'));
    assert.deepEqual(free.pages.map((p) => p.id).sort(), ['library', 'playbook']);
    assert.deepEqual(beg.pages.map((p) => p.id), ['live']);
    assert.ok(unlockLines('advanced').some((l) => /Advanced mode/.test(l)));
    assert.ok(unlockLines('beginner').some((l) => /Live Market Lab/.test(l)));
  });

  test('paywall descriptions and premium folders', () => {
    assert.equal(describeTarget(parseHash('live')).title, 'Live Market Lab');
    assert.equal(describeTarget(parseHash('library')).required, 'account');
    assert.equal(describeTarget(parseHash('g.fib-sniper')).kind, 'game');
    assert.equal(premiumFolder('candle-anatomy'), null);
    assert.equal(premiumFolder('daily-challenge'), null);
    assert.equal(premiumFolder('trends'), 'beginner');
    assert.equal(premiumFolder('what-next'), 'beginner');
    assert.equal(premiumFolder('fibonacci'), 'advanced');
  });
});

// ---------------------------------------------------------------- progress merge

describe('progress merge (sync.js)', () => {
  const local = {
    v: 1, xp: 300,
    lessons: { a: { done: true, at: 10 }, b: { done: false, at: 5 } },
    games: {
      g1: { best: 500, stars: 2, plays: 3, at: 100, lastStyle: 'arcade', modes: { beginner: 500 }, styles: { arcade: { best: 500, stars: 2, plays: 3, at: 100 } } },
      g2: { best: 100, stars: 1, plays: 1, at: 50 },
    },
    badges: ['first-lesson', 'first-game'], badgeDates: { 'first-lesson': 10, 'first-game': 40 },
    lessonSteps: { a: { step: 2, max: 5 } },
    last: { type: 'game', id: 'g1', at: 100 },
    bestStreak: 4,
    daily: { last: '2026-09-26', streak: 2, best: 2, history: { '2026-09-25': 300, '2026-09-26': 400 } },
    gamePrefs: { g1: { style: 'survival' } },
    settings: { theme: 'dark', sound: false },
  };
  const remote = {
    v: 1, xp: 450,
    lessons: { b: { done: true, at: 20 }, c: { done: true, at: 30 } },
    games: {
      g1: { best: 700, stars: 3, plays: 5, at: 200, lastStyle: 'practice', modes: { advanced: 700 }, styles: { arcade: { best: 400, stars: 1, plays: 2, at: 90 }, practice: { best: 700, stars: 3, plays: 3, at: 200 } } },
      g3: { best: 50, stars: 0, plays: 2, at: 30 },
    },
    badges: ['first-lesson', 'explorer'], badgeDates: { 'first-lesson': 5, explorer: 60 },
    lessonSteps: { a: { step: 4, max: 4 }, c: { step: 1, max: 1 } },
    last: { type: 'lesson', id: 'c', at: 300 },
    bestStreak: 6,
    daily: { last: '2026-09-27', streak: 1, best: 3, history: { '2026-09-27': 250, '2026-09-20': 100 } },
    gamePrefs: { g1: { style: 'arcade', source: 'real' }, g3: { level: 'hard' } },
  };

  test('pickSynced keeps only the synced fields (never settings)', () => {
    const p = pickSynced(local);
    assert.equal(p.settings, undefined);
    assert.equal(p.lastTier, undefined);
    for (const k of SYNC_FIELDS) assert.ok(k in p, k);
    p.games.g1.best = 1;
    assert.equal(local.games.g1.best, 500, 'deep copy');
  });

  test('first merge (no base): xp max, lessons union, games max + summed plays, badges union', () => {
    const m = mergeProgress(pickSynced(local), remote, null);
    assert.equal(m.xp, 450);
    assert.deepEqual(Object.keys(m.lessons).sort(), ['a', 'b', 'c']);
    assert.equal(m.lessons.b.done, true, 'done wins');
    assert.equal(m.lessons.b.at, 20);
    assert.equal(m.games.g1.best, 700);
    assert.equal(m.games.g1.stars, 3);
    assert.equal(m.games.g1.plays, 8, 'anonymous plays + account plays');
    assert.equal(m.games.g1.lastStyle, 'practice', 'newer side for other fields');
    assert.deepEqual(m.games.g1.modes, { beginner: 500, advanced: 700 });
    assert.equal(m.games.g1.styles.arcade.best, 500);
    assert.equal(m.games.g1.styles.arcade.plays, 5);
    assert.equal(m.games.g1.styles.practice.plays, 3);
    assert.equal(m.games.g2.plays, 1);
    assert.equal(m.games.g3.plays, 2);
    assert.deepEqual(new Set(m.badges), new Set(['first-lesson', 'first-game', 'explorer']));
    assert.equal(m.badgeDates['first-lesson'], 5, 'earliest date');
    assert.deepEqual(m.badges, ['first-lesson', 'first-game', 'explorer'], 'ordered by date earned');
    assert.deepEqual(m.lessonSteps.a, { step: 2, max: 5 });
    assert.deepEqual(m.lessonSteps.c, { step: 1, max: 1 });
    assert.equal(m.last.id, 'c', 'newest last item');
    assert.equal(m.bestStreak, 6);
    assert.equal(m.gamePrefs.g1.style, 'survival', 'local prefs win');
    assert.equal(m.gamePrefs.g1.source, 'real', 'missing prefs come from remote');
    assert.equal(m.gamePrefs.g3.level, 'hard');
    assert.equal(m.settings, undefined);
  });

  test('daily streak chains across devices and history is unioned', () => {
    const m = mergeProgress(pickSynced(local), remote, null);
    assert.equal(m.daily.last, '2026-09-27');
    assert.equal(m.daily.streak, 3, '25th + 26th on one device, 27th on the other');
    assert.equal(m.daily.best, 3);
    assert.deepEqual(Object.keys(m.daily.history).sort(), ['2026-09-20', '2026-09-25', '2026-09-26', '2026-09-27']);
  });

  test('with a base, plays count each side\'s new plays once (no double counting)', () => {
    const base = { games: { g1: { plays: 5, styles: { arcade: { plays: 2 } } } } };
    const a = { games: { g1: { best: 10, stars: 0, plays: 7, at: 1, styles: { arcade: { best: 1, stars: 0, plays: 4, at: 1 } } } } };
    const b = { games: { g1: { best: 20, stars: 1, plays: 6, at: 2, styles: { arcade: { best: 2, stars: 1, plays: 3, at: 2 } } } } };
    const m = mergeProgress(a, b, base);
    assert.equal(m.games.g1.plays, 8, '5 + 2 on device A + 1 on device B');
    assert.equal(m.games.g1.styles.arcade.plays, 5);
    // merging a device with the remote it already pushed changes nothing
    const again = mergeProgress(m, m, m);
    assert.equal(again.games.g1.plays, 8);
    assert.equal(stableKey(again), stableKey(m));
  });

  test('merge is idempotent and tolerates empty or broken rows', () => {
    const m = mergeProgress(pickSynced(local), remote, null);
    assert.equal(stableKey(mergeProgress(m, m, m)), stableKey(m));
    const empty = mergeProgress({}, {}, null);
    assert.equal(empty.xp, 0);
    assert.deepEqual(empty.badges, []);
    const fromNothing = mergeProgress(pickSynced(local), {}, null);
    assert.equal(fromNothing.xp, 300);
    assert.equal(fromNothing.games.g1.plays, 3);
    assert.doesNotThrow(() => mergeProgress(null, { games: null, lessons: 'x', badges: 'y' }, 'z'));
  });
});

// ---------------------------------------------------------------- premium import rewriting

describe('premium loader import rewriting', () => {
  const site = 'https://example.com/tts/';
  const moduleUrl = `${site}js/games/fib-sniper.js`;
  const isPremium = (abs) => abs.startsWith(`${site}js/games/`) && /fib-sniper-/.test(abs);

  test('core imports become absolute site URLs; premium siblings are collected and swapped', () => {
    const src = [
      "import { GameShell } from '../core/game-kit.js';",
      "import * as reg from \"../registry.js\";",
      "import { helper } from './fib-sniper-levels.js';",
      "export { x } from './fib-sniper-levels.js';",
      "import './fib-sniper-style.js';",
      "const lazy = () => import('../core/scanner.js');",
      "const url = new URL('./art.svg', import.meta.url);",
      "import thing from 'bare-module';",
      "const s = 'from ./not-an-import.js';",
    ].join('\n');
    const first = rewriteImports(src, { moduleUrl, isPremium });
    assert.deepEqual(first.premiumDeps, [`${site}js/games/fib-sniper-levels.js`, `${site}js/games/fib-sniper-style.js`]);
    assert.match(first.code, /from 'https:\/\/example\.com\/tts\/js\/core\/game-kit\.js'/);
    assert.match(first.code, /from "https:\/\/example\.com\/tts\/js\/registry\.js"/);
    assert.match(first.code, /import\('https:\/\/example\.com\/tts\/js\/core\/scanner\.js'\)/);
    assert.match(first.code, /new URL\('\.\/art\.svg', "https:\/\/example\.com\/tts\/js\/games\/fib-sniper\.js"\)/);
    assert.match(first.code, /from 'bare-module'/);
    assert.match(first.code, /'from \.\/not-an-import\.js'/, 'string contents without quotes around a specifier stay');
    const blobs = new Map([[`${site}js/games/fib-sniper-levels.js`, 'blob:x1'], [`${site}js/games/fib-sniper-style.js`, 'blob:x2']]);
    const second = rewriteImports(src, { moduleUrl, isPremium, premiumUrls: blobs });
    assert.match(second.code, /from 'blob:x1'/);
    assert.match(second.code, /import 'blob:x2'/);
    assert.equal((second.code.match(/blob:x1/g) || []).length, 2);
  });

  test('bucket paths mirror the site layout under the plan folder', () => {
    assert.equal(sitePath(moduleUrl, site), 'js/games/fib-sniper.js');
    assert.equal(sitePath('https://other.com/x.js', site), null);
    assert.equal(bucketPath('advanced', 'js/games/fib-sniper.js'), 'advanced/js/games/fib-sniper.js');
    assert.equal(bucketPath('beginner', './js/lessons/trends.js'), 'beginner/js/lessons/trends.js');
  });
});
