// GameShell: shared intro → rounds → results flow so every game feels the same.
// Scoring: game.correct() adds points × streak multiplier (streak ≥ 3 → ×1.5, ≥ 6 → ×2).
// Stars, XP and "perfect" use the base points (before the streak bonus) against maxScore.
//
// Play styles (ARCHITECTURE §12.1): the intro offers Practice (no clock, hints, retries, half XP,
// player-chosen difficulty), Arcade (fixed rounds, clock, streaks) and Survival (3 lives, rounds
// until they run out, difficulty ramps). Chart sources (§12.2): Textbook or Real market, with
// game.realRound() / game.revealSource() for "mystery chart" rounds and a textbook fallback.
import { h, svg, icon, sfx, confetti, starRow, fmt, kbdHint, tierChip, reducedMotion, explainer, toast, choiceQuiz } from './ui.js';
import { defaultGamePreview, bindRoundMeter } from './game-ui.js';
import { makeRng, randomSeed, hashString } from './rng.js';
import {
  findEntry, nextItem, unitOf, findBadge, hashFor, tiersOf,
  STYLES, DIFFICULTY_LEVELS, SOURCES, findStyle,
} from '../registry.js';

const STAR_LINES = [
  ['Keep practising', 'Every pro started here. Review the lesson and run it back.'],
  ['Good start', 'You are reading the chart. Tighten up and go again.'],
  ['Solid trading', 'Consistent reads. One more run for the third star?'],
  ['Outstanding', 'Sharp, fast and accurate. That is a three-star read.'],
];

const SURVIVAL_LINES = [
  ['Out of lives', 'Every run teaches something. Go again and push further.'],
  ['Still standing', 'You made it past the warm-up. The rounds only get harder from here.'],
  ['Hard to knock out', 'Deep into the run. One more push for the third star.'],
  ['Unbreakable', 'The market threw everything at you. That is a three-star run.'],
];

const STYLE_IDS = STYLES.map((s) => s.id);
const LEVEL_VALUE = Object.fromEntries(DIFFICULTY_LEVELS.map((l) => [l.id, l.value]));
const SURVIVAL_DEFAULTS = { ramp: 15, stars: [5, 10, 15], clockMin: 0.6 };
const REAL_FAILS_BEFORE_SWITCH = 3;

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

/** Resolves with the promise's value, or `null` after `ms` (rejections pass through). */
export function withTimeout(promise, ms) {
  let timer = 0;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// ------------------------------------------------------------------ lazy engine modules
// scanner.js / market.js are loaded on demand so textbook-only pages never fetch them.

let scannerPromise = null;
let marketPromise = null;

/** import('./scanner.js'), cached; a failed import is retried next time. */
export function loadScanner() {
  if (!scannerPromise) {
    scannerPromise = import('./scanner.js').catch((err) => {
      scannerPromise = null;
      throw err;
    });
  }
  return scannerPromise;
}

/** import('./market.js'), cached; a failed import is retried next time. */
export function loadMarket() {
  if (!marketPromise) {
    marketPromise = import('./market.js').catch((err) => {
      marketPromise = null;
      throw err;
    });
  }
  return marketPromise;
}

// ------------------------------------------------------------------ icons & labels

const HEART = 'M12 20.5s-7.3-4.5-8.9-9.1C2 8.1 4.2 4.8 7.5 4.8c1.9 0 3.4 1 4.5 2.5 1.1-1.5 2.6-2.5 4.5-2.5 3.3 0 5.5 3.3 4.4 6.6-1.6 4.6-8.9 9.1-8.9 9.1z';

/** Heart line icon (filled by default) — Survival lives. Same sizing contract as ui.icon(). */
export function heartIcon({ size = 18, filled = true, label = null, class: cls = '' } = {}) {
  return svg('svg', {
    class: `icon icon--heart${cls ? ' ' + cls : ''}`,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: filled ? 'currentColor' : 'none',
    stroke: 'currentColor',
    'stroke-width': 1.75,
    'stroke-linejoin': 'round',
    focusable: 'false',
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }),
  }, svg('path', { d: HEART }));
}

/** Icon for a play style: practice → book, arcade → bolt, survival → heart. */
export function styleIcon(styleId, { size = 18, label = null } = {}) {
  if (styleId === 'survival') return heartIcon({ size, label });
  return icon(findStyle(styleId)?.icon || 'gamepad', { size, label });
}

// Same wording as market.js intervalLabel().
const INTERVAL_LABEL = {
  '1m': '1 minute', '5m': '5 minutes', '15m': '15 minutes', '30m': '30 minutes',
  '1h': 'Hourly', '4h': '4 hours', '6h': '6 hours', '1d': 'Daily', '1w': 'Weekly', '1M': 'Monthly',
};

/** '1d' → 'Daily', '1w' → 'Weekly', '1h' → 'Hourly', … (unknown values pass through). */
export function intervalLabel(interval) {
  return INTERVAL_LABEL[interval] || (interval ? String(interval) : '');
}

function toDate(t) {
  if (t == null || t === '') return null;
  if (t instanceof Date) return Number.isNaN(t.getTime()) ? null : t;
  if (typeof t === 'number') {
    if (t > 1e11) return new Date(t); // ms
    if (t > 1e8) return new Date(t * 1000); // seconds
    return null; // a candle index, not a time
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** '12 Mar 2026' (UTC); intraday intervals add ', 14:00 UTC'. '' when t is not a timestamp. */
export function formatMarketDate(t, interval = '1d') {
  const d = toDate(t);
  if (!d) return '';
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (/^\d+[mh]$/.test(String(interval || ''))) {
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${day}, ${hh}:${mm} UTC`;
  }
  return day;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * CandleChart `timeLabel` for real candles (t = ms UTC): '12 Mar' (daily), 'Mar 26' (weekly),
 * '14:05' (intraday). Do not use it on a mystery chart before the reveal — dates give it away.
 */
export function marketTimeLabel(interval = '1d') {
  return (idx, candle) => {
    const d = toDate(candle?.t);
    if (!d) return '';
    if (interval === '1w' || interval === '1M') return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
    if (interval === '1d') return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };
}

function attributionText(a) {
  if (!a) return '';
  const t = String(a).trim();
  return /^(market\s+)?data\b|^source\b|^prices?\b/i.test(t) ? t : `Data: ${t}`;
}

function isTestData(info) {
  return !!(info && (info.mock || info.fixture || info.test || /fixture|mock|test/i.test(String(info.source || ''))));
}

/** "BTC-USD · Daily · 12 Mar 2026 — Data: Coinbase" for a real round / example ({ symbol,
 * interval, candles, decisionIdx, from, to, attribution }). The date is the decision candle's. */
export function sourceText(info) {
  if (!info) return '';
  const when = info.candles?.[info.decisionIdx]?.t ?? info.to ?? info.from ?? info.candles?.[info.candles.length - 1]?.t;
  const main = [info.name && info.name !== info.symbol ? `${info.symbol} (${info.name})` : info.symbol, intervalLabel(info.interval), formatMarketDate(when, info.interval)]
    .filter(Boolean).join(' · ');
  const attr = attributionText(info.attribution);
  return attr ? `${main} — ${attr}` : main;
}

/**
 * The standard "mystery chart" reveal: eyebrow + "SYMBOL · Daily · 12 Mar 2026" + attribution,
 * plus "Delayed · end of day" and "Test data" flags. → Element (.source-reveal).
 */
export function sourceReveal(info, { title = 'Mystery chart revealed', compact = false } = {}) {
  if (!info) return null;
  const when = info.candles?.[info.decisionIdx]?.t ?? info.to ?? info.from ?? info.candles?.[info.candles.length - 1]?.t;
  const date = formatMarketDate(when, info.interval);
  const flags = [
    info.delayed ? h('span', { class: 'chip chip--sm chip--outline' }, icon('clock', { size: 12 }), 'Delayed · end of day') : null,
    isTestData(info) ? h('span', { class: 'chip chip--sm chip--outline source-reveal__test' }, 'Test data') : null,
  ].filter(Boolean);
  return h('div', { class: ['source-reveal', compact && 'source-reveal--compact'], role: 'note', 'aria-label': `${title}: ${sourceText(info)}` },
    h('span', { class: 'source-reveal__icon', 'aria-hidden': 'true' }, icon('eye', { size: 18 })),
    h('div', { class: 'source-reveal__body' },
      title ? h('span', { class: 'source-reveal__eyebrow' }, title) : null,
      h('span', { class: 'source-reveal__line' },
        h('strong', { class: 'mono' }, info.symbol || 'Real market'),
        info.name && info.name !== info.symbol ? h('span', { class: 'source-reveal__name' }, info.name) : null,
        info.interval ? h('span', { class: 'source-reveal__sep', 'aria-hidden': 'true' }, '·') : null,
        info.interval ? h('span', null, intervalLabel(info.interval)) : null,
        date ? h('span', { class: 'source-reveal__sep', 'aria-hidden': 'true' }, '·') : null,
        date ? h('span', { class: 'mono' }, date) : null),
      h('span', { class: 'source-reveal__attr' }, attributionText(info.attribution) || 'Real market data'),
      flags.length ? h('span', { class: 'source-reveal__flags' }, flags) : null));
}

// ------------------------------------------------------------------ clock

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
    /** Starts the clock. Returns false (and does nothing) when the style has no clock (Practice). */
    start(seconds, onExpire) {
      this.stop();
      if (!game.timed) {
        game._timerBar.hidden = true;
        return false;
      }
      total = Math.max(0.1, seconds) * 1000;
      endAt = performance.now() + total;
      pausedLeft = null;
      expire = onExpire || null;
      lastTick = null;
      running = true;
      game._timerBar.hidden = false;
      render();
      raf = requestAnimationFrame(loop);
      return true;
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
    get paused() {
      return running && pausedLeft != null;
    },
  };
}

// ------------------------------------------------------------------ shell

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
    // Modes the member's plan does not include (§9.3: `requires`, or the access rules for a
    // 'both'-tier game's Advanced mode) are shown locked and never picked by default.
    const openModes = this.modes ? this.modes.filter((m) => !this._modeLock(m)) : null;
    this.mode = this.modes ? (openModes.find((m) => m.id === lastTier) || openModes[0] || this.modes[0]).id : null;

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
    if (this.modes && this._modeLock(this.modes.find((m) => m.id === modeId))) {
      modeId = (this.modes.find((m) => !this._modeLock(m)) || this.modes[0]).id;
    }
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

  /**
   * The plan a mode needs when the member's plan does not include it (else null): the mode's own
   * `requires` ('advanced' | 'beginner' | 'free'), or ctx.access.modeRequirement(entry, mode).
   */
  _modeLock(m) {
    const a = this.ctx.access;
    if (!m || !a || typeof a.can !== 'function') return null;
    let need = m.requires || null;
    if (!need && typeof a.modeRequirement === 'function') {
      try {
        need = a.modeRequirement(this.entry, m);
      } catch {
        need = null;
      }
    }
    if (!need) return null;
    try {
      return a.can(need) ? null : need;
    } catch {
      return null;
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
      modePicker = this._picker({
        key: 'mode',
        label: 'Mode',
        className: 'game-intro__modes',
        value: this.mode,
        options: this.modes.map((m) => {
          const need = this._modeLock(m);
          if (!need) return { id: m.id, label: m.label, note: m.description || '' };
          const plan = need === 'advanced' ? 'Advanced' : need === 'beginner' ? 'Beginner' : null;
          const href = this.ctx.access?.upgradeHash?.(need) || (plan ? `#pricing.${need}` : '#signup');
          const cta = plan ? `Upgrade to ${plan}` : 'Create a free account';
          return {
            id: m.id,
            label: m.label,
            note: m.description || '',
            locked: true,
            lockNote: plan ? `${m.label} mode is part of the ${plan} plan.` : `${m.label} mode needs a free account.`,
            lockNode: h('span', { class: 'mode-lock-note' }, plan ? `${m.label} mode is part of the ${plan} plan. ` : `${m.label} mode needs a free account. `,
              h('a', { href, 'data-upgrade': need }, cta), '.'),
          };
        }),
        onPick: (id) => {
          this.mode = id;
          this._barBack.replaceChildren(this._backLink());
        },
      }).el;
    }

    let stylePicker = null;
    if (this.styles.length > 1) {
      stylePicker = this._picker({
        key: 'style',
        label: 'Style',
        className: 'game-intro__styles',
        value: this.style,
        options: this.styles.map((id) => {
          const st = findStyle(id);
          return { id, label: st?.label || id, iconEl: styleIcon(id, { size: 16 }), note: st?.blurb || '' };
        }),
        onPick: (id) => {
          this.style = id;
          this._setPref('style', id);
          this.difficulty = id === 'practice' ? LEVEL_VALUE[this.level] ?? 0.5 : 0;
          this._wrap.dataset.style = id;
          if (this._levelPickerEl) this._levelPickerEl.hidden = id !== 'practice';
          this._renderFacts();
          this._renderIntroStats();
        },
      }).el;
    }

    this._levelPickerEl = null;
    if (this.styles.includes('practice')) {
      this._levelPickerEl = this._picker({
        key: 'level',
        label: 'Difficulty',
        className: 'game-intro__levels',
        value: this.level,
        options: DIFFICULTY_LEVELS.map((l) => ({ id: l.id, label: l.label })),
        onPick: (id) => {
          this.level = id;
          this._setPref('level', id);
          this.difficulty = LEVEL_VALUE[id];
        },
      }).el;
      this._levelPickerEl.hidden = this.style !== 'practice';
    }

    let sourcePicker = null;
    const canReal = this._canReal();
    if (this.sources.length > 1) {
      sourcePicker = this._picker({
        key: 'source',
        label: 'Charts',
        className: 'game-intro__sources',
        value: this.sourcePref === 'real' && !canReal ? 'textbook' : this.sourcePref,
        options: this.sources.map((id) => {
          const s = SOURCES.find((x) => x.id === id);
          const locked = id === 'real' && !canReal;
          return {
            id,
            label: s?.label || id,
            iconEl: icon(id === 'real' ? 'chart' : 'candle', { size: 16 }),
            note: s?.blurb || '',
            locked,
            lockNote: 'Real market charts need a free account.',
            lockNode: locked ? h('span', null, 'Real market charts need a free account. ', h('a', { href: '#signin' }, 'Sign in or create one'), '.') : null,
          };
        }),
        onPick: (id) => {
          this.sourcePref = id;
          this._setPref('source', id);
        },
      }).el;
    } else if (this.sources[0] === 'real') {
      sourcePicker = h('div', { class: 'game-intro__picker game-intro__sources', 'data-picker': 'source' },
        h('span', { class: 'field__label' }, 'Charts'),
        h('p', { class: 'game-intro__source-only' },
          h('span', { class: 'chip chip--sm source-chip is-real' }, h('span', { class: 'source-chip__dot', 'aria-hidden': 'true' }), 'Real market'),
          h('span', { class: 'faint' }, canReal
            ? ' Falls back to a textbook chart when real data is unavailable.'
            : ' Needs a free account; until then you play on textbook charts.')));
    }

    const setup = [modePicker, stylePicker, this._levelPickerEl, sourcePicker].filter(Boolean);
    this._dailyEl = this.daily ? h('div', { class: 'game-intro__daily' }) : null;

    this._introStats = h('div', { class: 'game-intro__best' });
    const howTo = (this.opts.howTo || []).map((line, i) =>
      h('li', null, h('span', { class: 'howto__n mono', 'aria-hidden': 'true' }, String(i + 1)), h('span', null, line)));

    const previewEl = h('div', { class: 'game-intro__preview-art' });
    this._facts = h('dl', { class: 'game-facts' });

    const art = h('div', { class: 'game-intro__preview' });
    // Always show a real gameplay candle preview (never the generic emblem).
    if (!this.opts.preview) {
      const id = this.id;
      this.opts.preview = (el) => defaultGamePreview(el, id);
    }
    this._previewEl = previewEl;
    art.append(previewEl);
    this._mountPreview();
    art.append(this._facts);

    this._intro = h('section', { class: 'game-intro', 'aria-labelledby': `${this.id}-title` },
      h('div', { class: 'game-intro__main' },
        h('p', { class: 'eyebrow' }, this.daily ? 'Daily Challenge' : unit ? `Game · ${unit.title}` : 'Game'),
        h('h1', { id: `${this.id}-title`, class: 'game-intro__title' }, e.title),
        h('div', { class: 'row row--sm' },
          tierChip(e.tier),
          e.minutes ? h('span', { class: 'chip chip--outline' }, icon('clock', { size: 13 }), `${e.minutes} min`) : null,
          ...(e.skills || []).map((s) => h('span', { class: 'chip chip--outline' }, s))),
        e.blurb ? h('p', { class: 'lead' }, e.blurb) : null,
        this._dailyEl,
        howTo.length ? h('div', { class: 'game-intro__howto' },
          h('h2', { class: 'game-intro__h' }, 'How to play'),
          h('ol', { class: 'howto' }, howTo)) : null,
        setup.length ? h('div', { class: 'game-intro__setup' }, setup) : null,
        h('div', { class: 'game-intro__cta' }, this._startBtn, kbdHint('Enter', 'to start')),
        this._introStats),
      art);

    // play
    this._roundEl = h('span', { class: 'hud__value mono' });
    this._scoreEl = h('span', { class: 'hud__value mono' }, '0');
    this._scoreWrap = h('div', { class: 'hud__cell hud__cell--score' }, h('span', { class: 'hud__label' }, 'Score'), this._scoreEl);
    this._streakEl = h('span', { class: 'hud__value mono' });
    this._streakWrap = h('div', { class: 'hud__cell hud__streak' }, h('span', { class: 'hud__label' }, 'Streak'), this._streakEl);
    this._livesEl = h('span', { class: 'hud__value hud__hearts', role: 'img' });
    this._livesWrap = h('div', { class: 'hud__cell hud__lives', hidden: true }, h('span', { class: 'hud__label' }, 'Lives'), this._livesEl);
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
      this._livesWrap,
      this.hudExtra,
      quit);

    // meta row: style · level · source chips, and the Practice hint button
    this._metaChips = h('div', { class: 'game__chips' });
    this._srcChip = h('span', { class: 'chip chip--sm source-chip' });
    this._hintBtn = h('button', {
      type: 'button', class: 'btn btn--sm game__hint-btn', 'data-action': 'hint', hidden: true,
      on: { click: () => this.hint() },
    });
    this._meta = h('div', { class: 'game__meta' }, this._metaChips, this._hintBtn);

    this.stage = h('div', { class: 'game__stage' });
    this._hintSlot = h('div', { class: 'game__hint-slot', 'aria-live': 'polite' });
    this._feedback = h('div', { class: 'game__feedback', 'aria-live': 'polite' });
    this._actions = h('div', { class: 'game__actions' });
    this._play = h('section', { class: 'game__play', 'aria-label': `${e.title} — play` }, this._hud, this._timerBar, this._meta, this._hintSlot, this.stage, this._feedback, this._actions);

    // results
    this._results = h('section', { class: 'game__results', 'aria-live': 'polite' });

    this._wrap = h('div', { class: 'game container', 'data-game': this.id, 'data-style': this.style }, bar, this._intro, this._play, this._results);
    this.root.append(this._wrap);
  }

  _quit() {
    this.timer.hide();
    this._runRoundCleanups();
    this._roundToken += 1;
    this._setLoading(false);
    this.stage.replaceChildren();
    this.clearFeedback();
    this.hideNext();
    this.finished = true;
    this._startToken++;
    this._show('intro');
    this._startBtn.focus({ preventScroll: true });
  }

  _renderFacts() {
    if (!this._facts) return;
    const t = this.opts.timer;
    const clockText = t?.seconds ? `${t.seconds}s${t.perRound === false ? ' total' : ' / round'}` : 'None';
    let cells;
    if (this.style === 'survival') {
      cells = [
        ['Lives', String(this.maxLives)],
        ['Clock', t?.seconds ? (t.perRound === false ? clockText : `${t.seconds}s, faster`) : 'None'],
        ['3 stars', `${this.survivalOpts.stars[2]} rounds`],
      ];
    } else {
      cells = [
        ['Rounds', this.baseRounds == null ? 'Open' : String(this.baseRounds)],
        ['Clock', this.style === 'practice' ? 'None' : clockText],
        ['3 stars', '90%+'],
      ];
    }
    this._facts.replaceChildren(...cells.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', { class: 'mono' }, v))));
  }

  _renderIntroStats() {
    if (this._dailyEl) {
      const d = this.store?.dailyStatus?.();
      const dateText = this._dailyDateText();
      this._dailyEl.replaceChildren(
        h('span', { class: 'game-intro__daily-icon', 'aria-hidden': 'true' }, icon('flame', { size: 20 })),
        h('span', { class: 'game-intro__daily-text' },
          h('strong', null, `Today · ${dateText}`),
          h('span', { class: 'faint' }, d?.done
            ? `Done today (score ${fmt(d.score || 0)}). Replays don't change your streak.`
            : d?.streak ? `Keep your ${d.streak}-day streak alive.` : 'Everyone gets the same questions today.')),
        h('span', { class: 'game-intro__streak mono', title: 'Current daily streak' }, String(d?.streak || 0), h('small', null, d?.streak === 1 ? 'day' : 'days')));
    }
    const styleLabel = findStyle(this.style)?.label || 'Arcade';
    let s = null;
    try {
      s = this.store?.styleStats ? this.store.styleStats(this.id, this.style) : this.style === 'arcade' ? this.store?.gameStats?.(this.id) : null;
    } catch {
      s = null;
    }
    if (!s || !s.plays) {
      this._introStats.replaceChildren(h('span', { class: 'faint' },
        this.styles.length > 1 ? `First ${styleLabel} run? Your best score and stars will show up here.` : 'First time here? Your best score and stars will show up here.'));
      return;
    }
    this._introStats.replaceChildren(...[
      h('span', { class: 'faint' }, this.styles.length > 1 ? `Your best · ${styleLabel}` : 'Your best'),
      h('strong', { class: 'mono' }, fmt(s.best)),
      this.style === 'survival' && s.rounds != null ? h('span', { class: 'chip chip--sm' }, heartIcon({ size: 12 }), `${s.rounds} ${s.rounds === 1 ? 'round' : 'rounds'}`) : null,
      starRow(s.stars || 0, { size: 16 }),
      h('span', { class: 'faint' }, `· ${s.plays} ${s.plays === 1 ? 'play' : 'plays'}`),
    ].filter(Boolean));
  }

  _renderRound() {
    this._roundEl.replaceChildren(...[String(this.round), this.rounds != null ? h('span', { class: 'hud__of' }, `/${this.rounds}`) : null].filter(Boolean));
  }

  _renderLives(lost = false) {
    const on = this.lives != null;
    this._livesWrap.hidden = !on;
    if (!on) return;
    const hearts = [];
    for (let i = 0; i < this.maxLives; i++) {
      const alive = i < this.lives;
      hearts.push(h('span', { class: ['heart', alive ? 'is-alive' : 'is-lost', lost && !alive && i === this.lives && 'is-breaking'] },
        heartIcon({ size: 18, filled: alive })));
    }
    this._livesEl.replaceChildren(...hearts);
    this._livesEl.setAttribute('aria-label', `${this.lives} of ${this.maxLives} lives left`);
    if (lost && !reducedMotion()) {
      this._livesWrap.classList.remove('is-hit');
      void this._livesWrap.offsetWidth;
      this._livesWrap.classList.add('is-hit');
    }
  }

  _renderMeta() {
    if (!this._metaChips) return;
    const st = findStyle(this.style);
    const chips = [];
    if (this.daily) chips.push(h('span', { class: 'chip chip--sm chip--accent' }, icon('flame', { size: 13 }), 'Daily Challenge'));
    else chips.push(h('span', { class: `chip chip--sm game-chip game-chip--${this.style}` }, styleIcon(this.style, { size: 13 }), st?.label || this.style));
    if (this.style === 'practice') {
      const lv = DIFFICULTY_LEVELS.find((l) => l.id === this.level);
      chips.push(h('span', { class: 'chip chip--sm chip--outline' }, lv?.label || 'Normal'));
    }
    if (this.modes && this.mode) {
      const m = this.modes.find((x) => x.id === this.mode);
      if (m) chips.push(h('span', { class: 'chip chip--sm chip--outline' }, m.label));
    }
    this._renderSourceChip();
    if (this.sources.includes('real')) chips.push(this._srcChip);
    this._metaChips.replaceChildren(...chips);
  }

  _renderSourceChip() {
    const c = this._srcChip;
    if (!c) return;
    let text;
    let cls;
    let title = '';
    if (this.source === 'real' && !this._roundFallback) {
      text = this._revealed?.symbol ? `${this._revealed.symbol} · ${intervalLabel(this._revealed.interval)}` : 'Real market';
      cls = 'is-real';
      title = this._revealed ? sourceText(this._revealed) : 'A real market chart. The symbol and date are revealed after you answer.';
    } else if (this._roundFallback || (this.sourcePref === 'real' && this.source === 'textbook' && this.state === 'play')) {
      text = 'Textbook chart';
      cls = 'is-fallback';
      title = 'No real chart was available, so this is a generated textbook example.';
    } else {
      text = 'Textbook';
      cls = 'is-textbook';
      title = 'A generated textbook example.';
    }
    c.className = `chip chip--sm source-chip ${cls}`;
    c.title = title;
    c.replaceChildren(h('span', { class: 'source-chip__dot', 'aria-hidden': 'true' }), text);
  }

  _renderHintBtn() {
    const b = this._hintBtn;
    if (!b) return;
    const show = this.state === 'play' && this._hintsAllowed() && this._hint != null && !this._roundOver;
    b.hidden = !show;
    if (!show) return;
    const used = !!this._hintEl?.isConnected;
    b.disabled = used;
    b.replaceChildren(...[icon('spark', { size: 15 }), h('span', null, used ? 'Hint shown' : 'Hint'),
      used ? null : h('small', { class: 'game__hint-cost' }, 'max 50%')].filter(Boolean));
    b.setAttribute('aria-label', used ? 'Hint shown' : 'Show a hint (this round then scores at most 50%)');
  }

  _setLoading(on, text = 'Loading…') {
    if (!on) {
      this._loadingEl?.remove();
      this._loadingEl = null;
      return;
    }
    if (!this._loadingEl) {
      this._loadingEl = h('div', { class: 'game__loading', role: 'status' },
        h('span', { class: 'game__loading-dots', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
        h('span', { class: 'game__loading-text' }));
    }
    this._loadingEl.querySelector('.game__loading-text').textContent = text;
    if (!this._loadingEl.isConnected) this.stage.append(this._loadingEl);
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

  _styleBests() {
    if (this.styles.length < 2) return null;
    const items = this.styles.map((id) => {
      let s = null;
      try {
        s = this.store?.styleStats?.(this.id, id) || null;
      } catch {
        s = null;
      }
      const st = findStyle(id);
      const value = !s?.plays ? '—' : id === 'survival' && s.rounds != null ? `${s.rounds} ${s.rounds === 1 ? 'round' : 'rounds'}` : fmt(s.best);
      return h('li', { class: ['style-bests__item', id === this.style && 'is-current'] },
        h('span', { class: 'style-bests__icon', 'aria-hidden': 'true' }, styleIcon(id, { size: 15 })),
        h('span', { class: 'style-bests__label' }, st?.label || id),
        h('strong', { class: 'style-bests__value mono' }, value),
        s?.plays ? starRow(s.stars || 0, { size: 12 }) : null);
    });
    return h('div', { class: 'style-bests' },
      h('p', { class: 'eyebrow' }, 'Your best per style'),
      h('ul', { class: 'style-bests__list' }, items));
  }

  _renderResults(s) {
    const e = this.entry;
    const tier = this.tier;
    const survival = s.style === 'survival';
    const [headline, sub0] = (survival ? SURVIVAL_LINES : STAR_LINES)[s.stars];
    let sub = sub0;
    if (survival) {
      const th = this.survivalOpts.stars;
      const nextT = th.find((x) => s.survived < x);
      sub = `You survived ${s.survived} ${s.survived === 1 ? 'round' : 'rounds'}. ${nextT != null ? `Reach ${nextT} for ${s.stars + 1} ${s.stars + 1 === 1 ? 'star' : 'stars'}.` : 'Maximum stars.'}`;
    } else if (s.style === 'practice') {
      sub = `${sub0} Practice runs earn half XP.`;
    }
    const styleLabel = findStyle(s.style)?.label;

    const starsEl = h('div', { class: 'results__stars', role: 'img', 'aria-label': `${s.stars} of 3 stars` },
      [0, 1, 2].map((i) => {
        const on = i < s.stars;
        return h('span', { class: ['results__star', on && 'is-on'], style: { '--i': i } }, icon(on ? 'star-fill' : 'star', { size: i === 1 ? 64 : 52 }));
      }));

    const scoreVal = h('span', { class: 'stat__value' }, '0');
    const newChip = (on) => (on ? h('span', { class: 'chip chip--accent chip--sm results__new' }, 'New best') : null);
    const stat = (label, ...value) => h('div', { class: 'stat' }, h('span', { class: 'stat__label' }, label), h('span', { class: 'stat__value' }, ...value));
    const cells = survival
      ? [
        stat('Survived', h('span', { class: 'results__survived' }, heartIcon({ size: 18 }), String(s.survived)), newChip(s.isBestRounds)),
        h('div', { class: 'stat' }, h('span', { class: 'stat__label' }, 'Score'), scoreVal),
        stat('Best run', s.bestRounds != null ? `${s.bestRounds}` : String(s.survived)),
        stat('XP earned', h('span', { class: 'results__xp' }, `+${s.xp}`)),
        stat('Best streak', String(s.bestStreak)),
      ]
      : [
        h('div', { class: 'stat' }, h('span', { class: 'stat__label' }, 'Score'), scoreVal),
        stat(this.styles.length > 1 ? `Best · ${styleLabel}` : 'Best', fmt(s.best ?? s.score), newChip(s.isBest)),
        stat('XP earned', h('span', { class: 'results__xp' }, `+${s.xp}`)),
        s.corrects + s.wrongs > 0 ? stat('Accuracy', `${s.corrects}/${s.corrects + s.wrongs}`) : null,
        stat('Best streak', String(s.bestStreak)),
      ];
    if (s.daily) cells.push(stat('Daily streak', h('span', { class: 'results__daily' }, icon('flame', { size: 18 }), String(s.daily.streak))));
    const stats = h('div', { class: 'results__stats' }, cells.filter(Boolean));

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
      this.styles.length > 1
        ? h('button', { type: 'button', class: 'btn btn--lg', 'data-action': 'change-style', on: { click: () => {
          this._show('intro');
          this._startBtn.focus({ preventScroll: true });
        } } }, icon('grid'), 'Change style')
        : null,
      h('a', { class: 'btn btn--lg', href: '#games' }, icon('arrow-left'), 'Back to Games'),
      nextEntry ? h('a', { class: 'btn btn--lg btn--ghost results__next', href: `#${hashFor(nextEntry.id)}` },
        h('span', null, h('small', null, `Next ${nextEntry.type}`), nextEntry.title), icon('arrow-right')) : null);

    const review = lesson && s.stars < 2
      ? h('p', { class: 'results__review' }, icon('book', { size: 16 }), 'Want a refresher first? ', h('a', { href: `#l.${lesson.id}` }, `Review “${lesson.title}”`))
      : null;

    const modeLabel = s.mode && this.modes ? this.modes.find((m) => m.id === s.mode)?.label || s.mode : null;
    const card = h('div', { class: 'results card card--raised', 'data-style': s.style },
      h('p', { class: 'eyebrow' }, [e.title, modeLabel, this.daily ? this._dailyDateText() : styleLabel].filter(Boolean).join(' · ')),
      starsEl,
      h('h2', { class: 'results__title' }, headline),
      h('p', { class: 'results__sub muted' }, sub),
      stats,
      badgesEl,
      this._styleBests(),
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
