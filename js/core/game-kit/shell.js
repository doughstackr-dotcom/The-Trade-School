// GameShell: shared intro → rounds → results flow so every game feels the same.
// Scoring: game.correct() adds points × streak multiplier (streak ≥ 3 → ×1.5, ≥ 6 → ×2).
// Stars, XP and "perfect" use the base points (before the streak bonus) against maxScore.
//
// Play styles (ARCHITECTURE §12.1): the intro offers Practice (no clock, hints, retries, half XP,
// player-chosen difficulty), Arcade (fixed rounds, clock, streaks) and Survival (3 lives, rounds
// until they run out, difficulty ramps). Chart sources (§12.2): Textbook or Real market, with
// game.realRound() / game.revealSource() for "mystery chart" rounds and a textbook fallback.
//
// This module holds the flow and public API; the intro / HUD / results DOM is mixed in from
// ./shell-view.js. Part of the game kit; import from js/core/game-kit.js, the public facade.

import { h, icon, sfx, kbdHint, reducedMotion, explainer, toast, choiceQuiz } from '../ui.js';
import { bindRoundMeter } from '../game-ui.js';
import { makeRng, randomSeed, hashString } from '../rng.js';
import { findEntry, tiersOf } from '../../registry.js';
import {
  STYLE_IDS, LEVEL_VALUE, SURVIVAL_DEFAULTS, REAL_FAILS_BEFORE_SWITCH, isTypingTarget,
  multiplierFor,
} from './util.js';
import { withTimeout, loadScanner, loadMarket } from './real-data.js';
import { heartIcon, sourceReveal } from './labels.js';
import { createTimer } from './timer.js';
import { GameShellView } from './shell-view.js';

export class GameShell {
  constructor(root, ctx, opts = {}) {
    this.root = root;
    this.ctx = ctx || {};
    this.opts = opts;
    this.store = this.ctx.store;
    this.entry = this.ctx.entry || findEntry(opts.id) || { id: opts.id || 'game', title: opts.title || 'Game', tier: 'beginner', blurb: '' };
    this.id = this.entry.id;
    this.baseRounds = opts.rounds === undefined ? 10 : opts.rounds;
    this.rounds = this.baseRounds;
    this.maxScore = opts.maxScore ?? (this.baseRounds ? this.baseRounds * 100 : 1000);
    this.modes = Array.isArray(opts.modes) && opts.modes.length ? opts.modes : null;
    const lastTier = this.store?.state?.lastTier;
    this.mode = this.modes ? (this.modes.find((m) => m.id === lastTier) || this.modes[0]).id : null;

    // Daily challenge: one fixed Arcade run per local date, seeded from the date.
    this.daily = !!(opts.daily ?? this.entry.daily);
    this.dailyKey = this.daily ? this._todayKey() : null;

    // Play styles (§12.1)
    const wanted = (opts.styles || this.entry.styles || STYLE_IDS).filter((s) => STYLE_IDS.includes(s));
    this.styles = this.daily ? ['arcade'] : wanted.length ? wanted : ['arcade'];
    const prefStyle = this._pref('style');
    this.style = this.styles.includes(prefStyle) ? prefStyle
      : this.styles.includes(opts.defaultStyle) ? opts.defaultStyle
        : this.styles.includes('arcade') ? 'arcade' : this.styles[0];
    const prefLevel = this._pref('level');
    this.level = LEVEL_VALUE[prefLevel] != null ? prefLevel : 'normal';
    this.maxLives = Math.max(1, Math.round(opts.lives ?? 3));
    this.survivalOpts = { ...SURVIVAL_DEFAULTS, ...(opts.survival || {}) };
    this.lives = null;
    this.over = false;

    // Chart sources (§12.2)
    const src = (opts.sources || this.entry.sources || ['textbook']).filter((s) => s === 'textbook' || s === 'real');
    this.sources = src.length ? src : ['textbook'];
    const prefSource = this._pref('source');
    this.sourcePref = this.sources.includes(prefSource) ? prefSource : this.sources[0];
    this.source = this.sourcePref === 'real' && this._canReal() ? 'real' : 'textbook';
    this.roundSource = this.source;
    this.real = null;
    this.sawReal = false;
    this.sawReal = false;
    this.fallbacks = 0;

    this.state = 'intro';
    this.score = 0;
    this.base = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.round = 0;
    this.corrects = 0;
    this.wrongs = 0;
    this.rng = null;
    this.roundRng = null;
    this.seed = null;
    this.finished = false;
    this.difficulty = this.style === 'practice' ? LEVEL_VALUE[this.level] : 0;
    this.roundCap = 1;
    this.hintsUsed = 0;
    this.retries = 0;
    this.isRetry = false;
    this._plays = 0;
    this._cleanups = [];
    this._roundCleanups = [];
    this._introCleanup = null;
    this._runBadges = [];
    this._startToken = 0;
    this._roundToken = 0;
    this._hint = null;
    this._hintEl = null;
    this._hintUsedRound = false;
    this._roundOver = false;
    this._roundWrong = false;
    this._roundFallback = false;
    this._realFails = 0;
    this._realUsed = false;
    this._revealed = null;
    this._loadingEl = null;
    this._previewEl = null;
    this._previewStale = false;
    this._meterCleanup = null;

    this._build();
    this.timer = createTimer(this);

    this._onKey = (e) => this._handleKey(e);
    document.addEventListener('keydown', this._onKey);
    this._onVis = () => (document.hidden ? this.timer.pause() : this.timer.resume());
    document.addEventListener('visibilitychange', this._onVis);
    this._show('intro');
  }

  // ------------------------------------------------------------ public API

  /** False in Practice (no clock): the shell never starts a clock and timer.start() is a no-op. */
  get timed() {
    return this.style !== 'practice';
  }

  /** Survival shortens the shell-managed per-round clock from 100% to clockMin (60%) as difficulty rises. */
  get clockScale() {
    if (this.style !== 'survival') return 1;
    const min = Math.max(0.2, Math.min(1, this.survivalOpts.clockMin));
    return 1 - (1 - min) * this.difficulty;
  }

  /** Adds points. { bonus: true } points raise the score but not stars/XP. Positive points are capped by roundCap. */
  award(points, { reason = '', bonus = false } = {}) {
    let p = Math.round(points || 0);
    if (!bonus && p > 0 && this.roundCap < 1) p = Math.round(p * this.roundCap);
    if (!p) return 0;
    const before = this.score;
    this.score = Math.max(0, this.score + p);
    if (!bonus) this.base = Math.max(0, this.base + p);
    this._renderScore(before, reason ? `${p > 0 ? '+' : ''}${p} ${reason}` : `${p > 0 ? '+' : ''}${p}`);
    return p;
  }

  correct(text = '', { points = 100 } = {}) {
    const p = Math.round((points || 0) * this.roundCap);
    this.streak += 1;
    this.corrects += 1;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.store?.noteStreak?.(this.streak);
    const mult = multiplierFor(this.streak);
    const gained = Math.round(p * mult);
    const before = this.score;
    this.score += gained;
    this.base += p;
    this._renderScore(before, `+${gained}`);
    this._renderStreak(true);
    sfx.correct();
    const notes = [
      mult > 1 ? `×${mult} streak` : '',
      this.roundCap < 1 ? `${this.isRetry ? 'retry' : 'hint'} · ${Math.round(this.roundCap * 100)}%` : '',
    ].filter(Boolean).join(' · ');
    this._banner('good', text || 'Correct!', gained > 0 ? `+${gained}` : '', notes);
    if (this.streak === 10 && this.store?.award?.('streak-10')) this._runBadges.push('streak-10');
    return gained;
  }

  /** Streak resets; in Survival it costs a life (the run ends at 0 — Next then shows the results). */
  wrong(text = '') {
    this.streak = 0;
    this.wrongs += 1;
    this._roundWrong = true;
    this._renderStreak(false);
    sfx.wrong();
    let note = '';
    if (this.lives != null) {
      this.loseLife(1, { silent: true });
      note = h('span', { class: 'feedback__lives' }, heartIcon({ size: 14, filled: false }),
        this.over ? 'Out of lives' : `${this.lives} ${this.lives === 1 ? 'life' : 'lives'} left`);
    }
    this._banner('bad', text || 'Not quite.', note, '');
  }

  /** Survival: removes n lives (no banner). Returns the lives left (null outside Survival). */
  loseLife(n = 1, { silent = false } = {}) {
    if (this.lives == null || this.over) return this.lives;
    this.lives = Math.max(0, this.lives - Math.max(0, Math.round(n)));
    this._renderLives(true);
    if (this.lives === 0) {
      this.over = true;
      if (!silent) this._banner('bad', 'Out of lives!', h('span', { class: 'feedback__lives' }, heartIcon({ size: 14, filled: false }), 'Run over'), '');
      // A clock left running must not add a second verdict after the run is over.
      if (this.opts.timer?.perRound !== false) this.timer.stop();
    }
    return this.lives;
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
    this._hintSlot?.replaceChildren();
    this._hintEl = null;
  }

  /** Sets this round's hint (string/HTML, Node, or (game) => either). Cleared every round. */
  setHint(textOrFn) {
    this._hint = textOrFn ?? null;
    this._renderHintBtn();
  }

  /**
   * Shows a hint right under the meta row / Hint button, above the stage (text defaults to the one
   * from setHint) and caps this round's points at 1 − cost (default 50%). Returns the hint element,
   * or null if there is no hint. The Hint button (Practice) calls this; games may call it directly
   * in any style.
   */
  hint(text = null, { cost = 0.5 } = {}) {
    if (this.state !== 'play') return null;
    if (this._hintEl?.isConnected) return this._hintEl;
    let content = text ?? this._hint;
    if (typeof content === 'function') {
      try {
        content = content(this);
      } catch (err) {
        console.error(`[${this.id}] hint failed:`, err);
        content = null;
      }
    }
    if (content == null || content === '') return null;
    this.roundCap = Math.min(this.roundCap, Math.max(0, 1 - cost));
    if (!this._hintUsedRound) {
      this._hintUsedRound = true;
      this.hintsUsed += 1;
    }
    const body = h('div', { class: 'hint-note' },
      h('span', { class: 'hint-note__icon', 'aria-hidden': 'true' }, icon('spark', { size: 16 })),
      h('div', { class: 'hint-note__body' },
        h('strong', { class: 'hint-note__title' }, 'Hint'),
        typeof content === 'string' ? h('span', { html: content }) : content));
    this._hintEl = explainer(body, 'info');
    this._hintEl.classList.add('game__note', 'game__hint');
    this._hintSlot.replaceChildren(this._hintEl);
    sfx.click();
    this._renderHintBtn();
    return this._hintEl;
  }

  /**
   * Standard multiple-choice round: renders a choiceQuiz into the stage, calls correct()/wrong()
   * with `explain` as the banner, reveals the real-chart source (if any) and shows Next.
   * opts: { question, options, answer, explain (html|Node|(ok, value) => …), hint, points = 100,
   *         columns, next = true, reveal = true, onAnswer(ok, value) } → the quiz element.
   */
  ask({ question = '', options = [], answer, explain = null, hint = null, points = 100, columns = null, next = true, reveal = true, onAnswer = null } = {}) {
    if (hint != null) this.setHint(hint);
    const quiz = choiceQuiz({
      question,
      options,
      answer,
      columns,
      sfx: false,
      onAnswer: (ok, value) => {
        const ex = typeof explain === 'function' ? explain(ok, value) : explain;
        if (ok) this.correct(ex || '', { points });
        else this.wrong(ex || '');
        if (reveal && this.real) this.revealSource();
        try {
          onAnswer?.(ok, value);
        } catch (err) {
          console.error(err);
        }
        if (next) this.nextButton();
      },
    });
    this.stage.append(quiz);
    return quiz;
  }

  /**
   * Real-market round (§12.2). Resolves with scanner.realRound(roundRng, query) — { candles,
   * decisionIdx, setup, outcome, symbol, interval, from, to, attribution, … } — or null when the
   * run uses textbook charts or no real chart is available (the HUD chip then says "Textbook
   * chart"; render your textbook scenario instead). Pauses the clock while loading. If the round
   * ends first (Next, Quit, leaving the page) the promise never settles, so code after the await
   * simply does not run. opts: scanner query ({ kinds, intervals, before, after, … }) plus
   * { timeout = 9000, rng, loadingText }.
   */
  async realRound(opts = {}) {
    if (this.source !== 'real' || this.state !== 'play') return null;
    const { timeout = 9000, rng = null, loadingText = 'Finding a real chart…', ...query } = opts;
    const token = this._roundToken;
    const clockWasRunning = this.timer.running && !this.timer.paused;
    if (clockWasRunning) this.timer.pause();
    const showLoading = setTimeout(() => {
      if (token === this._roundToken) this._setLoading(true, loadingText);
    }, 180);
    let res = null;
    try {
      const scanner = await loadScanner();
      res = await withTimeout(scanner.realRound(rng || this.roundRng || this.rng, query), timeout);
    } catch (err) {
      console.warn(`[${this.id}] real chart unavailable:`, err?.message || err);
      res = null;
    }
    clearTimeout(showLoading);
    if (token !== this._roundToken || this.state !== 'play' || !this._alive()) return new Promise(() => {});
    this._setLoading(false);
    if (clockWasRunning) this.timer.resume();
    if (res && Array.isArray(res.candles) && res.candles.length) {
      this.real = res;
      this.sawReal = true;
      this.roundSource = 'real';
      this._roundFallback = false;
      this._realFails = 0;
      this._realUsed = true;
    } else {
      this.real = null;
      this.roundSource = 'textbook';
      this._roundFallback = true;
      this.fallbacks += 1;
      this._realFails += 1;
      if (this._realFails >= REAL_FAILS_BEFORE_SWITCH) {
        this.source = 'textbook';
        toast('Real market charts are unavailable right now, so the rest of this run uses textbook charts.', { type: 'warn', duration: 4200 });
      }
    }
    this._renderSourceChip();
    return this.real;
  }

  /**
   * Shows the standard "mystery chart revealed" line under the stage (default: this round's real
   * chart) — "BTC-USD · Daily · 12 Mar 2026 — Data: …". Returns the element, or null when there
   * is nothing to reveal (textbook rounds). opts: { into: Element, title }.
   */
  revealSource(info = this.real, { into = null, title } = {}) {
    if (!info) return null;
    const el = sourceReveal(info, title === undefined ? {} : { title });
    (into || this._feedback).append(el);
    this._revealed = info;
    this._renderSourceChip();
    return el;
  }

  nextButton(label = null) {
    // The round is over once Next shows: freeze a per-round clock where it stopped.
    if (this.opts.timer?.perRound !== false) this.timer.stop();
    this._roundOver = true;
    this._renderHintBtn();
    // Honest chip: a Real-market run whose game never produced a real chart shows "Textbook chart".
    if (this.source === 'real' && !this._realUsed && !this._roundFallback) {
      this._roundFallback = true;
      this._renderSourceChip();
    }
    const last = this.over || (this.rounds != null && this.round >= this.rounds);
    const text = label || (last ? 'See results' : 'Next round');
    this._actions.replaceChildren();
    const btn = h('button', { type: 'button', class: 'btn btn--primary btn--lg', 'data-action': 'next', on: { click: () => this.nextRound() } },
      h('span', null, text), icon('arrow-right'));
    const retry = this._canRetry()
      ? h('button', { type: 'button', class: 'btn btn--lg game__retry', 'data-action': 'retry', on: { click: () => this.retryRound() } },
        icon('restart'), h('span', null, 'Try again'))
      : null;
    this._actions.append(...[retry, btn, kbdHint('Enter')].filter(Boolean));
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
    if (this.over || (this.rounds != null && this.round >= this.rounds)) {
      this.finish();
      return;
    }
    this.round += 1;
    this.difficulty = this._difficultyFor(this.round);
    this.roundCap = 1;
    this.isRetry = false;
    this._hintUsedRound = false;
    this._runRound();
  }

  /** Practice: replays the current round (same round rng) after a miss; it can then earn up to 50%. */
  retryRound() {
    if (this.state !== 'play' || this.finished || this.over) return;
    this.timer.stop();
    this._runRoundCleanups();
    this.hideNext();
    this.clearFeedback();
    if (this._roundWrong) this.wrongs = Math.max(0, this.wrongs - 1); // the miss is forgiven
    this.roundCap = Math.min(this.roundCap, 0.5);
    this.isRetry = true;
    this.retries += 1;
    this._runRound();
  }

  finish() {
    if (this.finished || this.state !== 'play') return;
    this.finished = true;
    this._roundToken += 1;
    this.timer.hide();
    this._runRoundCleanups();
    this.hideNext();
    this._setLoading(false);

    const survival = this.style === 'survival';
    const survived = survival ? Math.max(0, this.over ? this.round - 1 : this.round) : null;
    let pct;
    let stars;
    if (survival) {
      const th = this.survivalOpts.stars;
      stars = survived >= th[2] ? 3 : survived >= th[1] ? 2 : survived >= th[0] ? 1 : 0;
      pct = Math.min(1, survived / Math.max(1, th[2]));
    } else {
      pct = this.maxScore > 0 ? Math.min(1, this.base / this.maxScore) : 0;
      stars = pct >= 0.9 ? 3 : pct >= 0.65 ? 2 : pct >= 0.35 ? 1 : 0;
    }
    const perfect = !survival && this.wrongs === 0 && this.hintsUsed === 0 && this.retries === 0
      && (this.base >= this.maxScore || (this.rounds != null && this.corrects >= this.rounds && this.corrects > 0));
    let xp = Math.round(pct * 60) + 10 * stars;
    if (this.style === 'practice') xp = Math.round(xp * (this.opts.practice?.xp ?? 0.5));

    let daily = null;
    if (this.daily) {
      try {
        daily = this.store?.recordDaily?.({ score: this.score, key: this.dailyKey }) || null;
      } catch (err) {
        console.error(err);
      }
    }
    let rec = { isBest: false, xp, newBadges: [], best: this.score, bestRounds: survived, isBestRounds: false };
    try {
      if (this.store?.recordGame) {
        rec = this.store.recordGame(this.id, {
          score: this.score, stars, mode: this.mode, maxScore: this.maxScore, xp, perfect, style: this.style, rounds: survived,
          real: !!this.sawReal,
        });
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
      overallBest: rec.overallBest ?? rec.best,
      newBadges: [...new Set([...this._runBadges, ...(daily?.newBadges || []), ...(rec.newBadges || [])])],
      corrects: this.corrects,
      wrongs: this.wrongs,
      bestStreak: this.bestStreak,
      rounds: this.round,
      mode: this.mode,
      style: this.style,
      level: this.style === 'practice' ? this.level : null,
      source: this.source,
      survived,
      bestRounds: rec.bestRounds ?? null,
      isBestRounds: !!rec.isBestRounds,
      lives: this.lives,
      hintsUsed: this.hintsUsed,
      retries: this.retries,
      fallbacks: this.fallbacks,
      daily,
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

  /** Starts (or restarts) a run with the intro's style/level/source. Called by Start / Play again. */
  start(modeId = this.mode) {
    this.timer.hide();
    this._runRoundCleanups();
    this._runIntroCleanup();
    this._roundToken += 1;
    this.mode = modeId;
    if (this.daily) this.dailyKey = this._todayKey();
    this.seed = this.daily
      ? hashString(`daily:${this.id}:${this.dailyKey}`)
      : this._plays === 0 && Number.isFinite(this.ctx.seed) ? this.ctx.seed : randomSeed();
    this._plays += 1;
    this.rng = makeRng(this.seed);
    this.roundRng = this.rng.fork('round-0');
    this.score = 0;
    this.base = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.round = 0;
    this.corrects = 0;
    this.wrongs = 0;
    this.finished = false;
    this.rounds = this.style === 'survival' ? null : this.baseRounds;
    this.lives = this.style === 'survival' ? this.maxLives : null;
    this.over = false;
    this.difficulty = this.style === 'practice' ? LEVEL_VALUE[this.level] ?? 0.5 : 0;
    this.roundCap = 1;
    this.hintsUsed = 0;
    this.retries = 0;
    this.isRetry = false;
    this.fallbacks = 0;
    this._realFails = 0;
    this._realUsed = false;
    this._hint = null;
    this._roundWrong = false;
    this._roundOver = false;
    this.source = this.sourcePref === 'real' && this._canReal() ? 'real' : 'textbook';
    this.roundSource = this.source;
    this.real = null;
    this._roundFallback = false;
    this._revealed = null;
    this._runBadges = [];
    this._scoreEl.textContent = '0';
    this._renderStreak(false);
    this._renderRound();
    this._renderLives(false);
    this._renderMeta();
    this.stage.replaceChildren();
    this.clearFeedback();
    this.hideNext();
    this._show('play');
    try {
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch {
      window.scrollTo(0, 0);
    }
    const token = ++this._startToken;
    const begin = () => {
      const t = this.opts.timer;
      if (t && t.perRound === false && t.seconds) this.timer.start(t.seconds, () => this._onTimeout());
      let r;
      try {
        r = this.opts.onStart?.(this, { mode: this.mode, seed: this.seed, rng: this.rng, style: this.style, source: this.source, difficulty: this.difficulty });
      } catch (err) {
        console.error(`[${this.id}] onStart failed:`, err);
      }
      Promise.resolve(r).then(() => {
        if (token === this._startToken && this.round === 0 && this.state === 'play' && !this.finished) this.nextRound();
      }, (err) => console.error(`[${this.id}] onStart failed:`, err));
    };
    if (this.source === 'real') {
      this._setLoading(true, 'Connecting to market data…');
      this._prepareReal().then((ok) => {
        if (token !== this._startToken || this.state !== 'play' || this.finished) return;
        this._setLoading(false);
        if (!ok) {
          this.source = 'textbook';
          this.roundSource = 'textbook';
          this._renderMeta();
          toast('Real market data is unavailable right now, so this run uses textbook charts.', { type: 'warn', duration: 4200 });
        }
        begin();
      });
    } else begin();
  }

  destroy() {
    if (typeof this._meterCleanup === 'function') { try { this._meterCleanup(); } catch { /* */ } this._meterCleanup = null; }
    this._roundToken += 1;
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
      const tiers = tiersOf(this.id);
      if (tiers.length === 1) return tiers[0];
      return this.store?.state?.lastTier || 'beginner';
    }
    return this.entry.tier || 'beginner';
  }

  _todayKey() {
    try {
      if (this.store?.dailyKey) return this.store.dailyKey();
    } catch {
      /* fall through */
    }
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** 'Sun 27 Sept' for today's (or the run's) daily key. */
  _dailyDateText() {
    const key = this.dailyKey || this._todayKey();
    const [y, m, dd] = String(key).split('-').map(Number);
    try {
      return new Date(y, m - 1, dd).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    } catch {
      return key;
    }
  }

  _pref(key) {
    try {
      return this.store?.getGamePref?.(this.id, key) ?? null;
    } catch {
      return null;
    }
  }

  _setPref(key, value) {
    try {
      this.store?.setGamePref?.(this.id, key, value);
    } catch {
      /* storage blocked */
    }
  }

  /** Real charts need a free account when an access gate is registered. */
  _canReal() {
    const a = this.ctx.access;
    if (!a || typeof a.can !== 'function') return true;
    try {
      return !!a.can('free');
    } catch {
      return true;
    }
  }

  _hintsAllowed() {
    const mode = this.opts.hints ?? 'practice';
    if (mode === false) return false;
    if (mode === 'always') return true;
    return this.style === 'practice';
  }

  _canRetry() {
    return this.style === 'practice' && this._roundWrong && this.opts.retry !== false && !this.over && this.state === 'play' && !this.finished;
  }

  _difficultyFor(round) {
    if (this.style === 'practice') return LEVEL_VALUE[this.level] ?? 0.5;
    if (this.style === 'survival') {
      const ramp = Math.max(2, this.survivalOpts.ramp || 15);
      return Math.min(1, (round - 1) / (ramp - 1));
    }
    if (this.rounds != null) return this.rounds > 1 ? Math.min(1, (round - 1) / (this.rounds - 1)) : 0;
    return Math.min(1, (round - 1) / 14);
  }

  async _prepareReal() {
    try {
      const [market] = await Promise.all([loadMarket(), loadScanner()]);
      const cat = await withTimeout(market.getCatalog?.(), 7000);
      const status = (() => {
        try {
          return market.marketStatus?.();
        } catch {
          return null;
        }
      })();
      if (!cat || status === 'offline' || status === 'unconfigured') return false;
      if (cat.status === 'offline' || cat.status === 'unconfigured') return false;
      return Array.isArray(cat.symbols) ? cat.symbols.length > 0 : true;
    } catch (err) {
      console.warn(`[${this.id}] real market data unavailable:`, err?.message || err);
      return false;
    }
  }

  _runRound() {
    this._roundToken += 1;
    const token = this._roundToken;
    this._roundOver = false;
    this._roundWrong = false;
    this._hint = null;
    this._hintEl = null;
    this.real = null;
    this.roundSource = this.source;
    this._roundFallback = false;
    this._revealed = null;
    this.roundRng = this.rng.fork(`round-${this.round}`);
    this.stage.replaceChildren();
    this._renderRound();
    this._renderMeta();
    const t = this.opts.timer;
    if (t && t.perRound !== false && t.seconds) this.timer.start(t.seconds * this.clockScale, () => this._onTimeout());
    const fail = (err) => {
      console.error(`[${this.id}] onRound failed:`, err);
      this._setLoading(false);
      this.stage.append(h('div', { class: 'callout callout--warn' }, icon('info'), h('p', null, 'This round failed to load. Skip to the next one.')));
      this.nextButton('Skip round');
    };
    const hook = this.isRetry && typeof this.opts.onRetry === 'function' ? this.opts.onRetry : this.opts.onRound;
    try {
      const r = hook?.(this, {
        round: this.round, rng: this.roundRng, stage: this.stage, mode: this.mode,
        style: this.style, difficulty: this.difficulty, source: this.source, retry: this.isRetry,
      });
      if (typeof r === 'function') this._roundCleanups.push(r);
      else if (r && typeof r.then === 'function') {
        r.then((fn) => {
          if (typeof fn !== 'function') return;
          if (token === this._roundToken && this.state === 'play') this._roundCleanups.push(fn);
          else {
            try {
              fn();
            } catch (err) {
              console.error(err);
            }
          }
        }, (err) => {
          if (token === this._roundToken && this.state === 'play') fail(err);
          else console.error(`[${this.id}] onRound failed:`, err);
        });
      }
    } catch (err) {
      fail(err);
    }
    this._renderHintBtn();
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
      this._previewStale = true;
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }
  }

  /** (Re)draws opts.preview into the intro art; re-run when returning to the intro after its cleanup ran. */
  _mountPreview() {
    if (!this.opts.preview || !this._previewEl) return;
    this._previewStale = false;
    this._previewEl.replaceChildren();
    try {
      const r = this.opts.preview(this._previewEl);
      if (typeof r === 'function') this._introCleanup = r;
    } catch (err) {
      console.error(`[${this.id}] preview failed:`, err);
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
    this._wrap.dataset.style = this.style;
    this._barTitle.hidden = which === 'intro';
    if (which === 'intro') {
      if (this._previewStale) this._mountPreview();
      this._renderIntroStats();
      this._renderFacts();
      if (typeof this._meterCleanup === 'function') {
        try { this._meterCleanup(); } catch { /* */ }
        this._meterCleanup = null;
      }
    } else if (which === 'play') {
      if (typeof this._meterCleanup === 'function') {
        try { this._meterCleanup(); } catch { /* */ }
      }
      try { this._meterCleanup = bindRoundMeter(this); } catch { this._meterCleanup = null; }
    }
  }

  _backLink() {
    // Always return to the Games hub, regardless of entry point (Games tiles, home arcade, or track).
    return h('a', { class: 'link-btn', href: '#games' }, icon('arrow-left', { size: 16 }), 'Games');
  }

  /** Segmented radio picker. options: [{ id, label, iconEl?, note?, locked?, lockNote? }]. */
  _picker({ key, label, options, value, onPick, className = '' }) {
    const labelId = `${this.id}-${key}-label`;
    const note = h('p', { class: 'game-intro__mode-note faint', 'aria-live': 'polite' });
    const describe = (id) => {
      const o = options.find((x) => x.id === id);
      note.replaceChildren(...[o?.note || ''].filter(Boolean));
    };
    const buttons = options.map((o) => h('button', {
      type: 'button',
      role: 'radio',
      'aria-checked': String(o.id === value),
      [`data-${key}`]: o.id,
      'aria-disabled': o.locked ? 'true' : null,
      class: o.locked ? 'is-locked' : null,
      title: o.locked ? o.lockNote || null : null,
      on: {
        click: () => {
          if (o.locked) {
            note.replaceChildren(o.lockNode || o.lockNote || '');
            return;
          }
          select(o.id);
          sfx.click();
          onPick?.(o.id);
        },
        keydown: (ev) => {
          if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
          ev.preventDefault();
          const open = buttons.filter((b) => b.getAttribute('aria-disabled') !== 'true');
          const i = open.indexOf(ev.currentTarget);
          if (i < 0 || !open.length) return;
          const n = open[(i + (ev.key === 'ArrowRight' ? 1 : open.length - 1)) % open.length];
          n.focus();
          n.click();
        },
      },
    }, o.iconEl || null, h('span', null, o.label), o.locked ? icon('lock', { size: 13 }) : null));
    function select(id) {
      buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset[key] === id)));
      describe(id);
    }
    describe(value);
    const el = h('div', { class: ['game-intro__picker', className], 'data-picker': key },
      h('span', { class: 'field__label', id: labelId }, label),
      h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': labelId }, buttons),
      note);
    return { el, select, buttons, note };
  }
}

// Copy the view methods onto GameShell.prototype (same `this`, split only for file size).
for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(GameShellView.prototype))) {
  if (key !== 'constructor') Object.defineProperty(GameShell.prototype, key, desc);
}
