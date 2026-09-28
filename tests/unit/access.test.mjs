import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC_PAGES,
  isCurriculumGated,
  requiredPlan,
  rememberReturn,
  consumeReturn,
  peekReturn,
  canOpen,
} from '../../js/core/access.js';

function memStorage() {
  const store = Object.create(null);
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

test('PUBLIC_PAGES keeps home, dashboard, tools and platforms open', () => {
  for (const p of [
    'home', 'dashboard', 'progress', 'library', 'glossary',
    'playbook', 'live', 'platforms', 'affiliate', 'account', 'paywall',
  ]) {
    assert.ok(PUBLIC_PAGES.includes(p), `expected ${p} in PUBLIC_PAGES`);
  }
  assert.equal(PUBLIC_PAGES.includes('beginner'), false);
  assert.equal(PUBLIC_PAGES.includes('advanced'), false);
  assert.equal(PUBLIC_PAGES.includes('track'), false);
});

test('isCurriculumGated: only Beginner/Advanced tracks and their modules', () => {
  assert.equal(isCurriculumGated(null, { page: 'track', tier: 'beginner' }), true);
  assert.equal(isCurriculumGated(null, { page: 'track', tier: 'advanced' }), true);
  assert.equal(isCurriculumGated(null, { page: 'home' }), false);
  assert.equal(isCurriculumGated(null, { page: 'dashboard' }), false);
  assert.equal(isCurriculumGated(null, { page: 'platforms' }), false);
  assert.equal(isCurriculumGated(null, { page: 'affiliate' }), false);
  assert.equal(isCurriculumGated(null, { page: 'library' }), false);
  assert.equal(isCurriculumGated(null, { page: 'playbook' }), false);
  assert.equal(isCurriculumGated(null, { page: 'live' }), false);
  assert.equal(isCurriculumGated(null, { page: 'glossary' }), false);

  assert.equal(isCurriculumGated({ type: 'lesson', tier: 'beginner', id: 'candle-anatomy' }, { kind: 'lesson' }), true);
  assert.equal(isCurriculumGated({ type: 'game', tier: 'advanced', id: 'fib-sniper' }, { kind: 'game' }), true);
  assert.equal(isCurriculumGated({ type: 'game', tier: 'both', id: 'what-next' }, { kind: 'game' }), true);
  assert.equal(isCurriculumGated(null, { kind: 'lesson', id: 'missing' }), true);
});

test('requiredPlan: FREE_IDS stay free; tiers map to plans', () => {
  assert.equal(requiredPlan({ id: 'candle-anatomy', tier: 'beginner' }), 'free');
  assert.equal(requiredPlan({ id: 'chart-basics', tier: 'beginner' }), 'beginner');
  assert.equal(requiredPlan({ id: 'fib-sniper', tier: 'advanced' }), 'advanced');
  assert.equal(requiredPlan('beginner'), 'beginner');
  assert.equal(requiredPlan('advanced'), 'advanced');
  assert.equal(requiredPlan({ tier: 'both', id: 'what-next' }), 'beginner');
});

test('rememberReturn / consumeReturn round-trip; skips auth surfaces', () => {
  globalThis.sessionStorage = memStorage();
  rememberReturn('#beginner');
  assert.equal(peekReturn(), 'beginner');
  assert.equal(consumeReturn(), 'beginner');
  assert.equal(peekReturn(), null);

  rememberReturn('l.candle-anatomy');
  rememberReturn('account.signup'); // should be ignored / not overwrite? actually ignored entirely
  assert.equal(peekReturn(), 'l.candle-anatomy');
  consumeReturn();

  rememberReturn('account');
  assert.equal(peekReturn(), null);
  rememberReturn('paywall');
  assert.equal(peekReturn(), null);
  rememberReturn('home');
  assert.equal(peekReturn(), null);
});

test('canOpen (unsigned, enforcing): public pages yes; curriculum no', async () => {
  // ACCESS_MODE auto + no browser location → isEnforcing() true; session stays null.
  assert.equal(canOpen(null, { page: 'home' }), true);
  assert.equal(canOpen(null, { page: 'dashboard' }), true);
  assert.equal(canOpen(null, { page: 'platforms' }), true);
  assert.equal(canOpen(null, { page: 'affiliate' }), true);
  assert.equal(canOpen(null, { page: 'library' }), true);
  assert.equal(canOpen(null, { page: 'playbook' }), true);
  assert.equal(canOpen(null, { page: 'live' }), true);
  assert.equal(canOpen(null, { page: 'glossary' }), true);
  assert.equal(canOpen(null, { page: 'account' }), true);

  assert.equal(canOpen(null, { page: 'track', tier: 'beginner' }), false);
  assert.equal(canOpen(null, { page: 'track', tier: 'advanced' }), false);
  assert.equal(
    canOpen({ type: 'lesson', tier: 'beginner', id: 'candle-anatomy' }, { kind: 'lesson', id: 'candle-anatomy' }),
    false,
  );
  assert.equal(
    canOpen({ type: 'game', tier: 'advanced', id: 'fib-sniper' }, { kind: 'game', id: 'fib-sniper' }),
    false,
  );
});
