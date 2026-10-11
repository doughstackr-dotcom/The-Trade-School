// Candle Credits (v2): catalog sanity, token minting/spending, cosmetics ownership rules.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { COSMETICS, cosmeticsOf, defaultOf, findCosmetic, SLOT_LABEL } from '../../js/core/cosmetics.js';
import { store } from '../../js/core/store.js';

const ORIGINAL = store.snapshot();

after(() => {
  store.replaceState(ORIGINAL, { settings: true });
});

test('catalog: unique ids, valid swatches, one free default per known slot', () => {
  const ids = new Set(COSMETICS.map((c) => c.id));
  assert.equal(ids.size, COSMETICS.length, 'cosmetic ids are unique');
  for (const c of COSMETICS) {
    assert.equal(typeof c.name, 'string', `${c.id} has a name`);
    assert.equal(c.swatch.length, 2, `${c.id} carries a two-colour swatch`);
    assert.ok(c.price >= 0, `${c.id} price is non-negative`);
  }
  for (const slot of Object.keys(SLOT_LABEL)) {
    const items = cosmeticsOf(slot);
    assert.ok(items.length > 0, `${slot} has items`);
    assert.equal(items.filter((c) => c.price === 0).length, 1, `${slot} has exactly one free default`);
    assert.ok(defaultOf(slot), `${slot} has a resolvable default`);
  }
});

test('tokens: mint 1:1 with XP, spend down but never below zero', () => {
  store.replaceState({ xp: 0, lifetimeXp: 0, tokensSpent: 0 });
  store.addXP(100, 'test', { silent: true, noModal: true });
  assert.equal(store.tokens(), 100, '100 XP mints 100 credits');
  assert.equal(store.state.xp, 100);
  assert.equal(store.state.lifetimeXp, 100);

  assert.equal(store.spendTokens(30), true);
  assert.equal(store.tokens(), 70);
  assert.equal(store.state.xp, 100, 'spending never reduces XP/levels');

  assert.equal(store.spendTokens(999), false, 'overspending is refused');
  assert.equal(store.tokens(), 70);
});

test('baseline mint: v1 progress without lifetimeXp gets its XP as starting credits', () => {
  store.replaceState({ xp: 540 });
  assert.equal(store.state.lifetimeXp, 540, 'legacy XP becomes the baseline mint');
  assert.equal(store.tokens(), 540);
});

test('buy + equip: ownership rules, poverty refusal, equipped slots', () => {
  store.replaceState({ xp: 0, lifetimeXp: 0, tokensSpent: 0, cosmetics: { owned: [], equipped: {} } });
  assert.equal(store.buyCosmetic('synthwave'), 'poor', 'cannot buy without credits');
  store.addXP(600, 'test', { silent: true, noModal: true });
  assert.equal(store.buyCosmetic('synthwave'), true, '600 credits buy the 500-credit skin');
  assert.equal(store.tokens(), 100);
  assert.equal(store.buyCosmetic('synthwave'), 'owned', 'no double buying');
  assert.equal(store.buyCosmetic('nope'), 'unknown', 'unknown ids refused');

  assert.equal(store.equipCosmetic('synthwave'), 'synthwave');
  assert.equal(store.equippedOf('skin'), 'synthwave');
  assert.equal(store.equipCosmetic('blueprint'), null, 'cannot equip unowned items');

  store.resetCosmetic('skin');
  assert.equal(store.equippedOf('skin'), 'midnight', 'reset returns the default look');

  // Free items are equippable without buying.
  assert.equal(store.hasCosmetic('classic'), true);
  assert.equal(store.equipCosmetic('classic'), 'classic');
});

test('normalize: equipped unknown or unowned cosmetics fall back to defaults', () => {
  store.replaceState({ xp: 0, lifetimeXp: 0, tokensSpent: 0, cosmetics: { owned: ['mono'], equipped: { skin: 'hacker-green', candles: 'fire' } } });
  assert.equal(store.equippedOf('skin'), 'midnight', 'unknown equipped skin falls back');
  assert.equal(store.equippedOf('candles'), 'classic', 'unowned equipped palette falls back');
  assert.equal(store.equippedOf('frame'), 'frame-classic');
  assert.equal(store.equippedOf('hat'), 'hat-none');
  assert.ok(store.state.cosmetics.owned.includes('mono'));
  assert.ok(findCosmetic('mono'));
});
