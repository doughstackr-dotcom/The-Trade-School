// GameShell: shared intro → rounds → results flow so every game feels the same.
// Scoring: game.correct() adds points × streak multiplier (streak ≥ 3 → ×1.5, ≥ 6 → ×2).
// Stars, XP and "perfect" use the base points (before the streak bonus) against maxScore.
import { h, icon, sfx, confetti, starRow, fmt, kbdHint, tierChip, reducedMotion, explainer, toast } from './ui.js';
import { makeRng, randomSeed } from './rng.js';
import { findEntry, findTier, nextItem, unitOf, findBadge, hashFor } from '../registry.js';

const STAR_LINES = [
  ['Keep practising', 'Every pro started here. Review the lesson and run it back.'],
  ['Good start', 'You are reading the chart. Tighten up and go again.'],
  ['Solid trading', 'Consistent reads. One more run for the third star?'],
  ['Outstanding', 'Sharp, fast and accurate. That is a three-star read.'],
];

function isTypingTarget(t) {
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

function multiplierFor(streak) {
  if (streak >= 6) return 2;
  if (streak >= 3) return 1.5;
  return 1;
}

function animateNumber(el, from, to, duration = 450) {
  if (reducedMotion() || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (t < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function createTimer(game) {
  let raf = 0;
  let total = 0;
  let endAt = 0;
  let pausedLeft = null;
  let expire = null;
  let lastTick = null;
  let running = false;

  const render = () => {
    const left = Math.max(0, pausedLeft != null ? pausedLeft : endAt - performance.now());
    const frac = total ? left / total : 0;
    game._timerFill.style.transform = `scaleX(${frac})`;
    game._timerText.textContent = `${Math.ceil(left / 1000)}s`;
    game._timerBar.classList.toggle('is-low', frac <= 0.3);
    return left;
  };

  const loop = () => {
    if (!running || pausedLeft != null) return;
    if (!game._alive()) {
      running = false;
      return;
    }
    const left = render();
    const sec = Math.ceil(left / 1000);
    if (sec <= 3 && sec > 0 && sec !== lastTick) {
      lastTick = sec;
      sfx.tick();
    }
    if (left <= 0) {
      running = false;
      const fn = expire;
      expire = null;
      fn?.();
      return;
    }
    raf = requestAnimationFrame(loop);
  };

  return {
    start(seconds, onExpire) {
      this.stop();
      total = Math.max(0.1, seconds) * 1000;
      endAt = performance.now() + total;
      pausedLeft = null;
      expire = onExpire || null;
      lastTick = null;
      running = true;
      game._timerBar.hidden = false;
      render();
      raf = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      pausedLeft = null;
    },
    pause() {
      if (!running || pausedLeft != null) return;
      pausedLeft = Math.max(0, endAt - performance.now());
      cancelAnimationFrame(raf);
    },
    resume() {
      if (!running || pausedLeft == null) return;
      endAt = performance.now() + pausedLeft;
      pausedLeft = null;
      raf = requestAnimationFrame(loop);
    },
    hide() {
      this.stop();
      game._timerBar.hidden = true;
    },
    get remaining() {
      if (!running) return 0;
      return Math.max(0, (pausedLeft != null ? pausedLeft : endAt - performance.now()) / 1000);
    },
    get running() {
      return running;
    },
  };
}

export class GameShell {
  constructor(root, ctx, opts = {}) {
    this.root = root;
    this.ctx = ctx || {};
    this.opts = opts;
    this.store = this.ctx.store;
    this.entry = this.ctx.entry || findEntry(opts.id) || { id: opts.id || 'game', title: opts.title || 'Game', tier: 'beginner', blurb: '' };
    this.id = this.entry.id;
    this.rounds = opts.rounds === undefined ? 10 : opts.rounds;
    this.maxScore = opts.maxScore ?? (this.rounds ? this.rounds * 100 : 1000);
    this.modes = Array.isArray(opts.modes) && opts.modes.length ? opts.modes : null;
    const lastTier = this.store?.state?.lastTier;
    this.mode = this.modes ? (this.modes.find((m) => m.id === lastTier) || this.modes[0]).id : null;

    this.state = 'intro';
    this.score = 0;
    this.base = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.round = 0;
    this.corrects = 0;
    this.wrongs = 0;
    this.rng = null;
    this.seed = null;
    this.finished = false;
    // Forward-compatible defaults for ARCHITECTURE §12.1/§12.2 (play styles, chart sources).
    // The pickers are not built yet: every run is 'arcade' on 'textbook' charts, and
    // `difficulty` ramps 0 → 1 across the run so round generators can already depend on it.
    this.style = 'arcade';
    this.source = 'textbook';
    this.lives = null;
    this.difficulty = 0;
    this._plays = 0;
    this._cleanups = [];
    this._roundCleanups = [];
    this._introCleanup = null;
    this._runBadges = [];
    this._startToken = 0;

    this._build();
    this.timer = createTimer(this);

    this._onKey = (e) => this._handleKey(e);
    document.addEventListener('keydown', this._onKey);
    this._onVis = () => (document.hidden ? this.timer.pause() : this.timer.resume());
    document.addEventListener('visibilitychange', this._onVis);
    this._show('intro');
  }

  // ------------------------------------------------------------ public API

  /** Adds points. { bonus: true } points raise the score but not stars/XP. */
  award(points, { reason = '', bonus = false } = {}) {
    const p = Math.round(points || 0);
    if (!p) return 0;
    const before = this.score;
    this.score = Math.max(0, this.score + p);
    if (!bonus) this.base = Math.max(0, this.base + p);
    this._renderScore(before, reason ? `${p > 0 ? '+' : ''}${p} ${reason}` : `${p > 0 ? '+' : ''}${p}`);
    return p;
  }

  correct(text = '', { points = 100 } = {}) {
    this.streak += 1;
    this.corrects += 1;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.store?.noteStreak?.(this.streak);
    const mult = multiplierFor(this.streak);
    const gained = Math.round(points * mult);
    const before = this.score;
    this.score += gained;
    this.base += points;
    this._renderScore(before, `+${gained}`);
    this._renderStreak(true);
    sfx.correct();
    this._banner('good', text || 'Correct!', gained > 0 ? `+${gained}` : '', mult > 1 ? `×${mult} streak` : '');
    if (this.streak === 10 && this.store?.award?.('streak-10')) this._runBadges.push('streak-10');
    return gained;
  }

  wrong(text = '') {
    this.streak = 0;
    this.wrongs += 1;
    this._renderStreak(false);
    sfx.wrong();
    this._banner('bad', text || 'Not quite.', '', '');
  }

  /** Appends an explanation block under the stage. type: 'good' | 'bad' | 'info'. */
  feedback(nodeOrHtml, type = 'info') {
    const el = explainer(nodeOrHtml, type);
    el.classList.add('game__note');
    this._feedback.append(el);
    return el;
  }

  clearFeedback() {
    this._feedback.replaceChildren();
  }

  nextButton(label = null) {
    // The round is over once Next shows: freeze a per-round clock where it stopped.
    if (this.opts.timer?.perRound !== false) this.timer.stop();
    const last = this.rounds != null && this.round >= this.rounds;
    const text = label || (last ? 'See results' : 'Next round');
    this._actions.replaceChildren();
    const btn = h('button', { type: 'button', class: 'btn btn--primary btn--lg', 'data-action': 'next', on: { click: () => this.nextRound() } },
      h('span', null, text), icon('arrow-right'));
    this._actions.append(btn, kbdHint('Enter'));
    this._nextBtn = btn;
    requestAnimationFrame(() => {
      if (!btn.isConnected) return;
      btn.focus({ preventScroll: true });
      const r = this._actions.getBoundingClientRect();
      const bottomLimit = window.innerHeight - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tabbar-h')) || 0) - 12;
      if (r.bottom > bottomLimit || r.top < 0) this._actions.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    });
    return btn;
  }

  hideNext() {
    this._actions.replaceChildren();
    this._nextBtn = null;
  }

  nextRound() {
    if (this.state !== 'play' || this.finished) return;
    this.timer.stop();
    this._runRoundCleanups();
    this.hideNext();
    this.clearFeedback();
    if (this.rounds != null && this.round >= this.rounds) {
      this.finish();
      return;
    }
    this.round += 1;
    this.difficulty = this.rounds != null && this.rounds > 1
      ? Math.min(1, (this.round - 1) / (this.rounds - 1))
      : Math.min(1, (this.round - 1) / 14);
    this.stage.replaceChildren();
    this._renderRound();
    const t = this.opts.timer;
    if (t && t.perRound !== false && t.seconds) {
      this.timer.start(t.seconds, () => this._onTimeout());
    }
    try {
      const r = this.opts.onRound?.(this, { round: this.round, rng: this.rng, stage: this.stage, mode: this.mode });
      if (typeof r === 'function') this._roundCleanups.push(r);
    } catch (err) {
      console.error(`[${this.id}] onRound failed:`, err);
      this.stage.append(h('div', { class: 'callout callout--warn' }, icon('info'), h('p', null, 'This round failed to load. Skip to the next one.')));
      this.nextButton('Skip round');
    }
  }

  finish() {
    if (this.finished || this.state !== 'play') return;
    this.finished = true;
    this.timer.hide();
    this._runRoundCleanups();
    this.hideNext();

    const pct = this.maxScore > 0 ? Math.min(1, this.base / this.maxScore) : 0;
    const stars = pct >= 0.9 ? 3 : pct >= 0.65 ? 2 : pct >= 0.35 ? 1 : 0;
    const perfect = this.wrongs === 0 && (this.base >= this.maxScore || (this.rounds != null && this.corrects >= this.rounds && this.corrects > 0));
    const xp = Math.round(pct * 60) + 10 * stars;
    let rec = { isBest: false, xp, newBadges: [], best: this.score };
    try {
      if (this.store?.recordGame) {
        rec = this.store.recordGame(this.id, { score: this.score, stars, mode: this.mode, maxScore: this.maxScore, xp, perfect });
      }
    } catch (err) {
      console.error(err);
    }
    const summary = {
      score: this.score,
      base: this.base,
      maxScore: this.maxScore,
      pct,
      stars,
      perfect,
      xp: rec.xp,
      isBest: rec.isBest,
      best: rec.best,
      newBadges: [...new Set([...this._runBadges, ...(rec.newBadges || [])])],
      corrects: this.corrects,
      wrongs: this.wrongs,
      bestStreak: this.bestStreak,
      rounds: this.round,
      mode: this.mode,
      seed: this.seed,
      el: null,
    };
    this._renderResults(summary);
    this._show('results');
  }

  onCleanup(fn) {
    if (typeof fn === 'function') this._cleanups.push(fn);
  }

  /** Register teardown for the current round only (also: onRound may return a function). */
  onRoundCleanup(fn) {
    if (typeof fn === 'function') this._roundCleanups.push(fn);
  }

  /** Starts (or restarts) a run. Normally called by the Start / Play again buttons. */
  start(modeId = this.mode) {
    this.timer.hide();
    this._runRoundCleanups();
    this._runIntroCleanup();
    this.mode = modeId;
    this.seed = this._plays === 0 && Number.isFinite(this.ctx.seed) ? this.ctx.seed : randomSeed();
    this._plays += 1;
    this.rng = makeRng(this.seed);
    this.score = 0;
    this.base = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.round = 0;
    this.difficulty = 0;
    this.corrects = 0;
    this.wrongs = 0;
    this.finished = false;
    this._runBadges = [];
    this._scoreEl.textContent = '0';
    this._renderStreak(false);
    this._renderRound();
    this.stage.replaceChildren();
    this.clearFeedback();
    this.hideNext();
    this._show('play');
    try {
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch {
      window.scrollTo(0, 0);
    }
    const t = this.opts.timer;
    if (t && t.perRound === false && t.seconds) this.timer.start(t.seconds, () => this._onTimeout());
    const token = ++this._startToken;
    let r;
    try {
      r = this.opts.onStart?.(this, { mode: this.mode, seed: this.seed, rng: this.rng });
    } catch (err) {
      console.error(`[${this.id}] onStart failed:`, err);
    }
    Promise.resolve(r).then(() => {
      if (token === this._startToken && this.round === 0 && this.state === 'play' && !this.finished) this.nextRound();
    });
  }

  destroy() {
    this.timer.stop();
    this._runRoundCleanups();
    this._runIntroCleanup();
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('visibilitychange', this._onVis);
    for (const fn of this._cleanups.splice(0)) {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }
    this.state = 'destroyed';
  }

  // ------------------------------------------------------------ internals

  get tier() {
    if (this.entry.tier === 'both') {
      if (this.mode === 'beginner' || this.mode === 'advanced') return this.mode;
      return this.store?.state?.lastTier || 'beginner';
    }
    return this.entry.tier || 'beginner';
  }

  _onTimeout() {
    if (this.state !== 'play' || this.finished) return;
    if (this.opts.onTimeout) {
      try {
        this.opts.onTimeout(this);
      } catch (err) {
        console.error(err);
      }
      return;
    }
    const t = this.opts.timer;
    if (t && t.perRound === false) {
      this.finish();
      return;
    }
    this.stage.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-disabled', 'true');
      b.classList.add('is-locked');
    });
    this.stage.classList.add('is-timeout');
    this.wrong("Time's up!");
    this.nextButton();
  }

  _runRoundCleanups() {
    this.stage?.classList.remove('is-timeout');
    for (const fn of this._roundCleanups.splice(0)) {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }
  }

  _runIntroCleanup() {
    const fn = this._introCleanup;
    this._introCleanup = null;
    if (typeof fn === 'function') {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }
  }

  /** False once destroyed, or when the module forgot to return a cleanup and its root left the page. */
  _alive() {
    if (this.state === 'destroyed') return false;
    if (this.root && !this.root.isConnected) {
      this.destroy();
      return false;
    }
    return true;
  }

  _handleKey(e) {
    if (!this._alive()) return;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.body.classList.contains('has-modal')) return;
    const t = e.target;
    if (isTypingTarget(t)) return;
    const isActivate = e.key === 'Enter' || e.key === ' ';
    if (!isActivate) return;
    const onButton = t && t.closest && t.closest('button, a, [role="button"], [role="radio"]');
    const lockedButton = onButton && (onButton.classList.contains('is-locked') || onButton.getAttribute('aria-disabled') === 'true');
    if (this.state === 'intro' && e.key === 'Enter' && (!onButton || onButton === this._startBtn)) {
      e.preventDefault();
      this.start(this.mode);
    } else if (this.state === 'play' && this._nextBtn?.isConnected && (!onButton || lockedButton)) {
      e.preventDefault();
      this._nextBtn.click();
    } else if (this.state === 'results' && e.key === 'Enter' && !onButton) {
      e.preventDefault();
      this.start(this.mode);
    }
  }

  _show(which) {
    this.state = which;
    this._intro.hidden = which !== 'intro';
    this._play.hidden = which !== 'play';
    this._results.hidden = which !== 'results';
    this._wrap.dataset.state = which;
    this._barTitle.hidden = which === 'intro';
    if (which === 'intro') this._renderIntroStats();
  }

  _backLink() {
    const tier = this.tier;
    const t = findTier(tier);
    return h('a', { class: 'link-btn', href: `#${tier}` }, icon('arrow-left', { size: 16 }), t ? t.title : 'Back');
  }

  _build() {
    const e = this.entry;
    const unit = unitOf(this.id, this.tier);

    // top bar
    this._barBack = h('span', { class: 'game__back' }, this._backLink());
    this._barTitle = h('span', { class: 'game__bar-title' }, e.title);
    const bar = h('div', { class: 'game__bar' }, this._barBack, this._barTitle);

    // intro
    this._startBtn = h('button', { type: 'button', class: 'btn btn--primary btn--lg', 'data-action': 'start', on: { click: () => this.start(this.mode) } },
      icon('play', { size: 18 }), 'Start game');
    let modePicker = null;
    if (this.modes) {
      const buttons = this.modes.map((m) => h('button', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(m.id === this.mode),
        'data-mode': m.id,
        on: {
          click: () => {
            this.mode = m.id;
            buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m.id)));
            this._barBack.replaceChildren(this._backLink());
            const d = this.modes.find((x) => x.id === m.id)?.description;
            if (modeNote) modeNote.textContent = d || '';
            sfx.click();
          },
          keydown: (ev) => {
            if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
            ev.preventDefault();
            const i = buttons.indexOf(ev.currentTarget);
            const n = buttons[(i + (ev.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
            n.focus();
            n.click();
          },
        },
      }, m.label));
      const modeNote = h('p', { class: 'game-intro__mode-note faint' }, this.modes.find((m) => m.id === this.mode)?.description || '');
      const labelId = `${this.id}-mode-label`;
      modePicker = h('div', { class: 'game-intro__modes' },
        h('span', { class: 'field__label', id: labelId }, 'Mode'),
        h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': labelId }, buttons),
        modeNote);
    }

    this._introStats = h('div', { class: 'game-intro__best' });
    const howTo = (this.opts.howTo || []).map((line, i) =>
      h('li', null, h('span', { class: 'howto__n mono', 'aria-hidden': 'true' }, String(i + 1)), h('span', null, line)));

    const previewEl = h('div', { class: 'game-intro__preview-art' });
    const facts = h('dl', { class: 'game-facts' },
      h('div', null, h('dt', null, 'Rounds'), h('dd', { class: 'mono' }, this.rounds == null ? 'Open' : String(this.rounds))),
      h('div', null, h('dt', null, 'Clock'), h('dd', { class: 'mono' }, this.opts.timer?.seconds ? `${this.opts.timer.seconds}s${this.opts.timer.perRound === false ? ' total' : ' / round'}` : 'None')),
      h('div', null, h('dt', null, '3 stars'), h('dd', { class: 'mono' }, '90%+')));

    const art = h('div', { class: 'game-intro__preview' });
    if (this.opts.preview) {
      art.append(previewEl);
      try {
        const r = this.opts.preview(previewEl);
        if (typeof r === 'function') this._introCleanup = r;
      } catch (err) {
        console.error(`[${this.id}] preview failed:`, err);
      }
    } else {
      const badge = findBadge(`${this.id}-ace`);
      art.append(h('div', { class: 'game-intro__emblem', 'aria-hidden': 'true' }, icon(badge?.icon || 'gamepad', { size: 56 })));
    }
    art.append(facts);

    this._intro = h('section', { class: 'game-intro', 'aria-labelledby': `${this.id}-title` },
      h('div', { class: 'game-intro__main' },
        h('p', { class: 'eyebrow' }, unit ? `Game · ${unit.title}` : 'Game'),
        h('h1', { id: `${this.id}-title`, class: 'game-intro__title' }, e.title),
        h('div', { class: 'row row--sm' },
          tierChip(e.tier),
          e.minutes ? h('span', { class: 'chip chip--outline' }, icon('clock', { size: 13 }), `${e.minutes} min`) : null,
          ...(e.skills || []).map((s) => h('span', { class: 'chip chip--outline' }, s))),
        e.blurb ? h('p', { class: 'lead' }, e.blurb) : null,
        howTo.length ? h('div', { class: 'game-intro__howto' },
          h('h2', { class: 'game-intro__h' }, 'How to play'),
          h('ol', { class: 'howto' }, howTo)) : null,
        modePicker,
        h('div', { class: 'game-intro__cta' }, this._startBtn, kbdHint('Enter', 'to start')),
        this._introStats),
      art);

    // play
    this._roundEl = h('span', { class: 'hud__value mono' });
    this._scoreEl = h('span', { class: 'hud__value mono' }, '0');
    this._scoreWrap = h('div', { class: 'hud__cell hud__cell--score' }, h('span', { class: 'hud__label' }, 'Score'), this._scoreEl);
    this._streakEl = h('span', { class: 'hud__value mono' });
    this._streakWrap = h('div', { class: 'hud__cell hud__streak' }, h('span', { class: 'hud__label' }, 'Streak'), this._streakEl);
    this.hudExtra = h('div', { class: 'hud__extra' });
    this._timerFill = h('span', { class: 'timerbar__fill' });
    this._timerText = h('span', { class: 'timerbar__text mono' });
    this._timerBar = h('div', { class: 'timerbar', hidden: true, 'aria-hidden': 'true' }, h('span', { class: 'timerbar__track' }, this._timerFill), this._timerText);
    const quit = h('button', {
      type: 'button', class: 'btn btn--ghost btn--sm hud__quit', 'aria-label': 'Quit this run and return to the intro',
      on: { click: () => this._quit() },
    }, icon('x', { size: 16 }), h('span', { class: 'hud__quit-label' }, 'Quit'));
    this._hud = h('div', { class: 'hud', role: 'group', 'aria-label': 'Game status' },
      h('div', { class: 'hud__cell' }, h('span', { class: 'hud__label' }, 'Round'), this._roundEl),
      this._scoreWrap,
      this._streakWrap,
      this.hudExtra,
      quit);
    this.stage = h('div', { class: 'game__stage' });
    this._feedback = h('div', { class: 'game__feedback', 'aria-live': 'polite' });
    this._actions = h('div', { class: 'game__actions' });
    this._play = h('section', { class: 'game__play', 'aria-label': `${e.title} — play` }, this._hud, this._timerBar, this.stage, this._feedback, this._actions);

    // results
    this._results = h('section', { class: 'game__results', 'aria-live': 'polite' });

    this._wrap = h('div', { class: 'game container', 'data-game': this.id }, bar, this._intro, this._play, this._results);
    this.root.append(this._wrap);
  }

  _quit() {
    this.timer.hide();
    this._runRoundCleanups();
    this.stage.replaceChildren();
    this.clearFeedback();
    this.hideNext();
    this.finished = true;
    this._startToken++;
    this._show('intro');
    this._startBtn.focus({ preventScroll: true });
  }

  _renderIntroStats() {
    const s = this.store?.gameStats?.(this.id);
    if (!s || !s.plays) {
      this._introStats.replaceChildren(h('span', { class: 'faint' }, 'First time here? Your best score and stars will show up here.'));
      return;
    }
    this._introStats.replaceChildren(
      h('span', { class: 'faint' }, 'Your best'),
      h('strong', { class: 'mono' }, fmt(s.best)),
      starRow(s.stars || 0, { size: 16 }),
      h('span', { class: 'faint' }, `· ${s.plays} ${s.plays === 1 ? 'play' : 'plays'}`));
  }

  _renderRound() {
    this._roundEl.replaceChildren(...[String(this.round), this.rounds != null ? h('span', { class: 'hud__of' }, `/${this.rounds}`) : null].filter(Boolean));
  }

  _renderScore(before, floatText) {
    animateNumber(this._scoreEl, before, this.score);
    if (floatText && !reducedMotion()) {
      const f = h('span', { class: 'hud__float mono', 'aria-hidden': 'true' }, floatText);
      this._scoreWrap.append(f);
      setTimeout(() => f.remove(), 900);
    }
  }

  _renderStreak(bumped) {
    const mult = multiplierFor(this.streak);
    this._streakWrap.classList.toggle('is-hot', this.streak >= 3);
    this._streakEl.replaceChildren(...[
      icon('flame', { size: 16 }),
      String(this.streak),
      mult > 1 ? h('span', { class: 'hud__mult' }, `×${mult}`) : null,
    ].filter(Boolean));
    if (bumped && !reducedMotion()) {
      this._streakWrap.classList.remove('is-bump');
      void this._streakWrap.offsetWidth;
      this._streakWrap.classList.add('is-bump');
    }
  }

  _banner(type, text, points, extra) {
    // Replace the previous banner only; explanations added with feedback() stay.
    this._feedback.querySelectorAll(':scope > .feedback').forEach((n) => n.remove());
    const body = h('div', { class: 'feedback__body' });
    if (typeof text === 'string' && /<\w/.test(text)) body.innerHTML = text;
    else body.append(text);
    const el = h('div', { class: `feedback feedback--${type}`, role: 'status' },
      h('span', { class: 'feedback__icon', 'aria-hidden': 'true' }, icon(type === 'good' ? 'check' : 'x', { size: 20 })),
      body,
      points || extra ? h('span', { class: 'feedback__pts mono' }, points, extra ? h('small', null, extra) : null) : null);
    this._feedback.prepend(el);
    return el;
  }

  _renderResults(s) {
    const e = this.entry;
    const tier = this.tier;
    const tierEntry = findTier(tier);
    const [headline, sub] = STAR_LINES[s.stars];

    const starsEl = h('div', { class: 'results__stars', role: 'img', 'aria-label': `${s.stars} of 3 stars` },
      [0, 1, 2].map((i) => {
        const on = i < s.stars;
        const st = h('span', { class: ['results__star', on && 'is-on'], style: { '--i': i } }, icon(on ? 'star-fill' : 'star', { size: i === 1 ? 64 : 52 }));
        return st;
      }));

    const scoreVal = h('span', { class: 'stat__value' }, '0');
    const stats = h('div', { class: 'results__stats' },
      h('div', { class: 'stat' }, h('span', { class: 'stat__label' }, 'Score'), scoreVal),
      h('div', { class: 'stat' }, h('span', { class: 'stat__label' }, 'Best'),
        h('span', { class: 'stat__value' }, fmt(s.best ?? s.score), s.isBest ? h('span', { class: 'chip chip--accent chip--sm results__new' }, 'New best') : null)),
      h('div', { class: 'stat' }, h('span', { class: 'stat__label' }, 'XP earned'), h('span', { class: 'stat__value results__xp' }, `+${s.xp}`)),
      s.corrects + s.wrongs > 0
        ? h('div', { class: 'stat' }, h('span', { class: 'stat__label' }, 'Accuracy'), h('span', { class: 'stat__value' }, `${s.corrects}/${s.corrects + s.wrongs}`))
        : null,
      h('div', { class: 'stat' }, h('span', { class: 'stat__label' }, 'Best streak'), h('span', { class: 'stat__value' }, String(s.bestStreak))));

    let badgesEl = null;
    if (s.newBadges.length) {
      badgesEl = h('div', { class: 'results__badges' },
        h('p', { class: 'eyebrow eyebrow--accent' }, s.newBadges.length > 1 ? 'Badges earned' : 'Badge earned'),
        h('ul', { class: 'badge-list' }, s.newBadges.map((id) => {
          const b = findBadge(id);
          if (!b) return null;
          return h('li', { class: 'badge-chip' }, h('span', { class: 'badge-chip__icon' }, icon(b.icon, { size: 18 })),
            h('span', null, h('strong', null, b.title), h('small', null, b.description)));
        })));
    }

    const extra = h('div', { class: 'results__extra' });
    s.el = extra;

    const next = nextItem(this.id, tier);
    const nextEntry = next ? findEntry(next.id) : null;
    const unit = unitOf(this.id, tier);
    const lesson = unit?.lesson ? findEntry(unit.lesson) : null;

    const actions = h('div', { class: 'results__actions' },
      h('button', { type: 'button', class: 'btn btn--primary btn--lg', 'data-action': 'again', on: { click: () => this.start(this.mode) } }, icon('restart'), 'Play again'),
      h('a', { class: 'btn btn--lg', href: `#${tier}` }, icon('arrow-left'), `Back to ${tierEntry ? tierEntry.title : 'track'}`),
      nextEntry ? h('a', { class: 'btn btn--lg btn--ghost results__next', href: `#${hashFor(nextEntry.id)}` },
        h('span', null, h('small', null, `Next ${nextEntry.type}`), nextEntry.title), icon('arrow-right')) : null);

    const review = lesson && s.stars < 2
      ? h('p', { class: 'results__review' }, icon('book', { size: 16 }), 'Want a refresher first? ', h('a', { href: `#l.${lesson.id}` }, `Review “${lesson.title}”`))
      : null;

    const card = h('div', { class: 'results card card--raised' },
      h('p', { class: 'eyebrow' }, `${e.title}${s.mode && this.modes ? ` · ${this.modes.find((m) => m.id === s.mode)?.label || s.mode}` : ''}`),
      starsEl,
      h('h2', { class: 'results__title' }, headline),
      h('p', { class: 'results__sub muted' }, sub),
      stats,
      badgesEl,
      extra,
      review,
      actions);

    this._results.replaceChildren(card);

    try {
      const r = this.opts.onEnd?.(this, s);
      if (r instanceof Node) extra.append(r);
    } catch (err) {
      console.error(`[${this.id}] onEnd failed:`, err);
    }

    animateNumber(scoreVal, 0, s.score, 900);
    requestAnimationFrame(() => card.querySelector('[data-action="again"]')?.focus({ preventScroll: true }));
    const live = () => this.state !== 'destroyed' && card.isConnected;
    if (s.xp > 0) setTimeout(() => live() && toast(`+${s.xp} XP · ${e.title}`, { type: 'xp' }), 350);
    if (s.stars >= 2) setTimeout(() => live() && sfx.win(), 250);
    if (s.stars === 3) setTimeout(() => live() && confetti(starsEl), 450);
    this._renderIntroStats();
  }
}

export default GameShell;
