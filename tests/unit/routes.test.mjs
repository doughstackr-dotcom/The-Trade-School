import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseToken, tokenToPath, pathToToken, legacyHashToken, canonicalPath,
} from '../../js/core/routes.js';
import { LESSONS, GAMES, PAGES, pathFor } from '../../js/registry.js';

test('tokens map to clean paths', () => {
  assert.equal(tokenToPath('home'), '/');
  assert.equal(tokenToPath(''), '/');
  assert.equal(tokenToPath('dashboard'), '/dashboard');
  assert.equal(tokenToPath('#dashboard'), '/dashboard');
  assert.equal(tokenToPath('l.fibonacci'), '/lessons/fibonacci');
  assert.equal(tokenToPath('g.fib-sniper'), '/games/fib-sniper');
  assert.equal(tokenToPath('library.hammer'), '/library/hammer');
  assert.equal(tokenToPath('playbook.hammer'), '/playbook/hammer');
  assert.equal(tokenToPath('account.signup'), '/account/signup');
  assert.equal(tokenToPath('library'), '/library');
  assert.equal(tokenToPath('games'), '/games');
});

test('paths map back to the same tokens (round trip for every route)', () => {
  const tokens = [
    'home', 'dashboard', 'progress', 'beginner', 'advanced', 'games', 'library', 'glossary',
    'platforms', 'affiliate', 'live', 'account', 'account.signup', 'paywall', 'privacy', 'terms',
    'refunds', 'playbook', 'playbook.hammer', 'library.doji',
    ...LESSONS.map((l) => `l.${l.id}`),
    ...GAMES.map((g) => `g.${g.id}`),
    ...PAGES.map((p) => p.hash),
  ];
  for (const t of tokens) {
    assert.equal(pathToToken(tokenToPath(t)), t, t);
    assert.notEqual(parseToken(t).kind, 'notfound', t);
  }
  assert.equal(pathToToken('/'), 'home');
  assert.equal(pathToToken('/index.html'), 'home');
  assert.equal(pathToToken('/dashboard/'), 'dashboard');
  assert.equal(pathToToken('/games/fib-sniper/'), 'g.fib-sniper');
  assert.equal(parseToken(pathToToken('/nope/deeper/still')).kind, 'notfound');
});

test('registry pathFor gives lesson and game paths', () => {
  assert.equal(pathFor('fibonacci'), '/lessons/fibonacci');
  assert.equal(pathFor('fib-sniper'), '/games/fib-sniper');
  assert.equal(pathFor('no-such-id'), '/');
});

test('old hash URLs are recognised; anchors and auth callbacks are not', () => {
  assert.equal(legacyHashToken('#l.fibonacci'), 'l.fibonacci');
  assert.equal(legacyHashToken('#dashboard'), 'dashboard');
  assert.equal(legacyHashToken('#account.signup'), 'account.signup');
  assert.equal(legacyHashToken('#home'), 'home');
  assert.equal(legacyHashToken(''), null);
  assert.equal(legacyHashToken('#'), null);
  assert.equal(legacyHashToken('#main'), null);
  assert.equal(legacyHashToken('#pricing'), null);
  assert.equal(legacyHashToken('#access_token=abc&refresh_token=def&type=signup'), null);
  assert.equal(legacyHashToken('#error=access_denied&error_description=expired'), null);
});

test('canonical paths collapse aliases', () => {
  assert.equal(canonicalPath(parseToken('progress')), '/dashboard');
  assert.equal(canonicalPath(parseToken('beginner')), '/dashboard');
  assert.equal(canonicalPath(parseToken('affiliate')), '/platforms');
  assert.equal(canonicalPath(parseToken('home')), '/');
  assert.equal(canonicalPath(parseToken('g.fib-sniper')), '/games/fib-sniper');
  assert.equal(canonicalPath(parseToken('nope')), null);
});
