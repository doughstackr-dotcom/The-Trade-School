// Arcade kit (v2): reusable boss-battle widgets for the redesigned games — and only
// those games. The untouched v1 games never import this module.
//
// Everything here is presentation + local state around the shell's scoring: games still
// report through game.correct()/wrong()/award() and finish through GameShell.finish(),
// so XP, stars, campaigns, daily challenge and access gating behave exactly as before.
import { h, sfx, reducedMotion } from './ui.js';
import { sleep } from './anim.js';

/**
 * Boss health bar. damage(n) animates the drain and flickers under 25%; ko() switches
 * to the cleared state. Phases (optional) show "PHASE 2/3" and fire onPhase when a
 * threshold is crossed (hp fractions at which the next phase begins, descending).
 *
 * const boss = new BossBar({ name: 'The Oracle', hp: 12, phases: [0.66, 0.33] });
 * stage.prepend(boss.el); boss.damage(2); boss.ko();
 */
export class BossBar {
  constructor({ name = 'BOSS', hp = 10, phases = [], onPhase = null, ariaLabel = null } = {}) {
    this.max = Math.max(1, Math.round(hp));
    this.hp = this.max;
    this.phase = 1;
    this.phases = Array.isArray(phases) ? [...phases].sort((a, b) => b - a) : [];
    this.onPhase = onPhase || null;
    this.dead = false;
    this._phaseEl = h('span', { class: 'bossbar__phase' }, this._phaseText());
    this._fill = h('span', { class: 'bossbar__fill' });
    this.el = h('div', {
      class: 'bossbar',
      role: 'progressbar',
      'aria-label': ariaLabel || `${name} health`,
      'aria-valuemin': 0,
      'aria-valuemax': this.max,
      'aria-valuenow': this.hp,
    },
      h('div', { class: 'bossbar__head' },
        h('span', { class: 'bossbar__name' }, name),
        this._phaseEl),
      h('span', { class: 'bossbar__track' }, this._fill));
    this._render();
  }

  _phaseText() {
    return this.phases.length ? `PHASE ${this.phase}/${this.phases.length + 1}` : '';
  }

  _render() {
    const frac = Math.max(0, this.hp / this.max);
    this._fill.style.width = `${Math.round(frac * 100)}%`;
    this.el.setAttribute('aria-valuenow', String(Math.max(0, this.hp)));
    this.el.classList.toggle('is-dying', !this.dead && frac > 0 && frac <= 0.25);
    this._phaseEl.textContent = this._phaseText();
  }

  /** Removes n HP. Returns the hp left (never below 0). Does not cross to ko() — call it. */
  damage(n = 1) {
    if (this.dead) return 0;
    this.hp = Math.max(0, this.hp - Math.max(0, Math.round(n)));
    const frac = this.hp / this.max;
    while (this.phases.length && frac <= this.phases[0]) {
      this.phases.shift();
      this.phase += 1;
      sfx.alarm();
      try {
        this.onPhase?.(this.phase, this);
      } catch (err) {
        console.error('[arcade] onPhase failed:', err);
      }
    }
    this._render();
    return this.hp;
  }

  /** Restores n HP (never above max). The boss regains ground on player mistakes. */
  heal(n = 1) {
    if (this.dead) return 0;
    this.hp = Math.min(this.max, this.hp + Math.max(0, Math.round(n)));
    this._render();
    return this.hp;
  }

  /** Boss defeated: cleared state + fanfare. */
  ko() {
    this.hp = 0;
    this.dead = true;
    this.el.classList.remove('is-dying');
    this.el.classList.add('is-clear');
    this._render();
    sfx.fanfare();
  }
}

/**
 * Confidence wager: a point bank you stake on a call before answering. Risk-free default
 * is stake(0) — games decide how much of their scoring runs through this.
 *
 * const wager = new Wager({ bank: 500 });
 * stage.append(wager.el);
 * wager.stake(100);            // commit 100 of the bank
 * wager.settle(true);          // correct: banked +stake (returns payout)
 * wager.double();              // "double down" — next stake is doubled
 */
export class Wager {
  constructor({ bank = 0, label = 'Bank', minStake = 0 } = {}) {
    this.bank = Math.max(0, Math.round(bank));
    this.staked = 0;
    this.minStake = minStake;
    this._boost = 1;
    this._bankEl = h('span', { class: 'wager__bank mono' }, String(this.bank));
    this._stakeEl = h('span', { class: 'wager__stake mono' }, '—');
    this.el = h('div', { class: 'wager', role: 'status', 'aria-label': `Bank ${this.bank} points` },
      h('span', { class: 'wager__label' }, label),
      this._bankEl,
      h('span', { class: 'wager__label' }, 'Stake'),
      this._stakeEl);
    this._render();
  }

  _render() {
    this._bankEl.textContent = String(this.bank);
    this._stakeEl.textContent = this.staked > 0 ? `${this.staked}${this._boost > 1 ? ' ×2' : ''}` : '—';
    this.el.setAttribute('aria-label', `Bank ${this.bank} points${this.staked > 0 ? `, ${this.staked} staked` : ''}`);
  }

  /** Commits n points (clamped to the bank, at least minStake when the bank allows).
   * Returns the stake actually committed. */
  stake(n = 0) {
    const want = Math.round(n * this._boost);
    this.staked = Math.max(0, Math.min(this.bank, want));
    this._boost = 1; // double-down applies to one stake only
    this._render();
    if (this.staked > 0) sfx.coin();
    return this.staked;
  }

  /** Next stake() is doubled (the "double down" press). */
  double() {
    this._boost = 2;
    this._render();
    sfx.powerup();
    return this._boost;
  }

  /**
   * Settles the staked points: correct pays 1:1 into the bank (returns the payout),
   * wrong sweeps the stake out of the game (the bank itself never drops — it is the
   * score pool the shell already awarded into).
   */
  settle(correct) {
    const s = this.staked;
    this.staked = 0;
    if (correct && s > 0) this.bank += s;
    this._render();
    return correct ? s : -s;
  }

  /** Adds points to the bank (e.g. round bonuses paid straight in). */
  add(n = 0) {
    this.bank = Math.max(0, this.bank + Math.round(n));
    this._render();
    return this.bank;
  }
}

/**
 * "READY / GO!" cabinet flash over a stage element (needs position: relative).
 * Resolves after both flashes (~1.15s, instant under reduced motion).
 */
export async function readyGo(stage, { ready = 'Ready', go = 'Go!' } = {}) {
  if (!stage) return;
  const pop = (text, cls) => {
    const el = h('span', { class: ['readygo__text', cls] }, text);
    const wrap = h('div', { class: 'readygo' }, el);
    stage.append(wrap);
    setTimeout(() => wrap.remove(), reducedMotion() ? 30 : 780);
  };
  pop(ready, '');
  sfx.tick();
  await sleep(520);
  pop(go, 'readygo__text--go');
  sfx.powerup();
  await sleep(620);
}
