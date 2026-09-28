// QuestionBank and helpers shared by the multiple-choice / card games (option shuffling,
// explanations, swipe cards, spaced-repetition bookkeeping).
// Part of the game kit; import from js/core/game-kit.js, the public facade.

import { makeRng, hashString } from '../rng.js';

// ---------------------------------------------------------------------------------------------
// QuestionBank — shared question picking for the multiple-choice / card games.
// ---------------------------------------------------------------------------------------------

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const levelOf = (q) => (Number.isFinite(q?.level) ? q.level : 0);

/** Days since 1970-01-01 for a 'YYYY-MM-DD' key (local calendar date, no time zone drift). */
function dayNumber(key) {
  const [y, m, d] = String(key || '').split('-').map(Number);
  if (!y || !m || !d) return 0;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * A bank of questions with stable string ids and a difficulty level 0–2:
 *   const bank = new QuestionBank(ITEMS, { id: 'order-desk' });
 *   onStart(g, { rng }) { bank.reset(rng, g.store); }
 *   onRound(g, { difficulty, retry }) { if (!retry) q = bank.next(difficulty); … }
 * next() prefers the question closest to round(difficulty × 2) that has not been asked this run
 * and is not among the ids this player saw most recently (persisted per bank through
 * store.recentQuestions / noteQuestionSeen, so a new run starts with fresh questions); when the
 * bank runs dry it relaxes those rules in that order instead of failing.
 * daily(key, n) is the Daily Challenge variant: the same n questions for everyone on a date,
 * walking a fixed shuffle of the bank so consecutive days do not repeat until it is used up.
 * opts: { id (store key, required for persistence), recent (max ids avoided; default 60% of
 *         the bank, so a run always has fresh picks) }.
 */
export class QuestionBank {
  constructor(items = [], { id = 'bank', recent = null } = {}) {
    this.id = id;
    this.items = items.filter((q) => q && q.id != null);
    this.byId = new Map(this.items.map((q) => [q.id, q]));
    const size = this.items.length;
    this.recentCap = Math.max(0, Math.min(recent ?? Infinity, Math.floor(size * 0.6)));
    this.store = null;
    this._order = this.items.slice();
    this._used = new Set();
  }

  get size() {
    return this.items.length;
  }

  find(id) {
    return this.byId.get(id) || null;
  }

  /** Starts a run: shuffles the order with rng (optional) and forgets this run's picks. */
  reset(rng = null, store = null) {
    this.store = store || null;
    this._order = rng?.shuffle ? rng.shuffle(this.items.slice()) : this.items.slice();
    this._used.clear();
    return this;
  }

  /** Ids this player saw most recently from this bank (up to recentCap). */
  recentIds() {
    if (!this.recentCap) return [];
    let list = [];
    try {
      list = this.store?.recentQuestions?.(this.id) || [];
    } catch {
      list = [];
    }
    return list.slice(-this.recentCap);
  }

  /** Marks a question as asked (this run + the persisted recent list). */
  markSeen(q) {
    if (!q) return;
    this._used.add(q.id);
    try {
      this.store?.noteQuestionSeen?.(this.id, q.id);
    } catch {
      /* storage unavailable: the in-run rule still applies */
    }
  }

  /** The next question for a difficulty 0–1 (see the class comment). Null only for an empty bank. */
  next(difficulty = 0, { exclude = null } = {}) {
    if (!this.items.length) return null;
    const target = Math.round(clamp01(difficulty) * 2);
    const recent = new Set(this.recentIds());
    const skip = (q) => exclude && exclude.has?.(q.id);
    const tiers = [
      (q) => !this._used.has(q.id) && !recent.has(q.id) && !skip(q),
      (q) => !this._used.has(q.id) && !skip(q),
    ];
    let pool = null;
    for (const t of tiers) {
      const p = this._order.filter(t);
      if (p.length) {
        pool = p;
        break;
      }
    }
    if (!pool) {
      this._used.clear();
      pool = this._order.filter((q) => !skip(q));
      if (!pool.length) pool = this._order;
    }
    const pick = pool.find((q) => levelOf(q) === target)
      ?? pool.find((q) => Math.abs(levelOf(q) - target) === 1)
      ?? pool[0];
    this.markSeen(pick);
    return pick;
  }

  /**
   * The Daily Challenge set for a date key ('YYYY-MM-DD'): n questions, identical for everyone,
   * easiest first. Day d takes positions d·n … d·n + n − 1 of a fixed (bank-id seeded) shuffle,
   * so a bank of N questions repeats only every ⌊N / n⌋ days.
   */
  daily(key, n = 5) {
    const size = this.items.length;
    if (!size) return [];
    const perm = makeRng(hashString(`qbank:${this.id}`)).shuffle(this.items.slice());
    const count = Math.min(n, size);
    const start = (dayNumber(key) * count) % size;
    const out = [];
    for (let i = 0; i < count; i++) out.push(perm[(start + i) % size]);
    return out.sort((a, b) => levelOf(a) - levelOf(b));
  }
}

/**
 * Multiple-choice options for a bank item written as { a: 'correct label', wrong: { 'label':
 * 'why that is wrong', … } } → shuffled [{ label, value }] (value = label).
 */
export function bankOptions(q, rng = null) {
  const labels = [q.a, ...Object.keys(q.wrong || {})];
  const opts = labels.map((label) => ({ label, value: label }));
  return rng?.shuffle ? rng.shuffle(opts) : opts;
}

/**
 * explain for GameShell.ask that names the specific mistake: on a wrong answer it leads with
 * why[value] (an object keyed by option value, or a function value → text), then the usual
 * explanation. explain may itself be a string or (ok, value) → string.
 */
export function explainChoice(explain, why = null) {
  return (ok, value) => {
    const base = typeof explain === 'function' ? explain(ok, value) : explain || '';
    if (ok || why == null) return base;
    let reason = typeof why === 'function' ? why(value) : why[value];
    if (!reason) return base;
    reason = String(reason);
    return base ? `<span class="game__why">${reason}</span><br>${base}` : `<span class="game__why">${reason}</span>`;
  };
}

/**
 * Wires Take / Skip handlers onto a swipeCard's two action buttons (skip first, take second) with
 * real event listeners, and adds the card's is-take / is-skip animation class. (swipeCard passes
 * lowercase `onclick`, which h() does not bind as a listener.) Handlers must be idempotent: if
 * swipeCard's own handlers also fire, each is called twice. Returns the card.
 */
export function bindSwipeCard(card, { onTake, onSkip } = {}) {
  const [skipBtn, takeBtn] = card?.querySelectorAll?.('.swipe-card__actions button') || [];
  skipBtn?.addEventListener('click', () => { card.classList.add('is-skip'); onSkip?.(); });
  takeBtn?.addEventListener('click', () => { card.classList.add('is-take'); onTake?.(); });
  return card;
}

/**
 * Spaced repetition bookkeeping for one answer: a miss is recorded for review (store.recordMiss),
 * a correct answer clears an earlier miss of the same item. Safe without a store.
 */
export function trackAnswer(store, bank, id, ok) {
  if (!store || !bank || id == null) return;
  try {
    if (ok) store.clearMiss?.(bank, id);
    else store.recordMiss?.(bank, id);
  } catch {
    /* storage unavailable */
  }
}
