// LessonShell: numbered, step-by-step lesson with a step rail, Back/Next, ←/→ keys,
// quiz steps that gate Next, resume position, and a completion card linking to the games.
// Media helpers (ARCHITECTURE §12.5): storyStep, realExampleStep, checklistStep, compareStep
// build ready-made steps; figure() and takeaway() are content blocks for any step.
import { h, icon, sfx, confetti, choiceQuiz, kbdHint, tierChip, meter, setMeter, reducedMotion, starRow } from './ui.js';
import { findEntry, findTier, unitOf, unitsOf, nextItem, hashFor } from '../registry.js';
import { makeRng, hashString } from './rng.js';
import { CandleChart } from './chart.js';
import { CANDLE_PATTERNS, CHART_PATTERNS, candleScenario, chartScenario } from './patterns.js';
import { trendSeries, randomWalk, fromPath } from './data.js';
import { sma, ema, rsi as rsiOf, closes as closesOf } from './indicators.js';
import { loadScanner, loadMarket, withTimeout, sourceReveal, intervalLabel, marketTimeLabel } from './game-kit.js';

function isTypingTarget(t) {
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export class LessonShell {
  /**
   * steps: [{ title, render(el, step, shell) → cleanup?, quiz?: { question, options, answer, explain }, locked? }]
   * A step with `quiz` gates Next until answered. A step with `locked: true` gates Next until
   * the step calls shell.unlock().
   */
  constructor(root, ctx, { intro = '', steps = [], title = null } = {}) {
    this.root = root;
    this.ctx = ctx || {};
    this.store = this.ctx.store;
    this.entry = this.ctx.entry || { id: 'lesson', title: title || 'Lesson', tier: 'beginner', minutes: null };
    this.id = this.entry.id;
    this.title = title || this.entry.title;
    this.intro = intro;
    this.steps = steps.length ? steps : [{ title: 'Coming soon', render: (el) => el.append(h('p', null, 'This lesson is being written.')) }];
    this.passed = new Set();
    this._stepCleanup = null;
    this._destroyed = false;
    this.done = false;

    const saved = this.store?.getLessonStep?.(this.id) || { step: 0, max: 0 };
    const last = this.steps.length - 1;
    this.max = this.store?.isLessonDone?.(this.id) ? last : Math.min(last, Math.max(0, saved.max || 0));
    this.index = Math.min(this.max, Math.max(0, saved.step || 0));
    for (let i = 0; i < this.max; i++) this.passed.add(i);

    this._build();
    this._onKey = (e) => this._handleKey(e);
    document.addEventListener('keydown', this._onKey);
    this.go(this.index, { initial: true });
  }

  // ------------------------------------------------------------ public API

  get step() {
    return this.steps[this.index];
  }

  unlock() {
    this.passed.add(this.index);
    this._renderNav();
  }

  lock() {
    this.passed.delete(this.index);
    this._renderNav();
  }

  canAdvance(i = this.index) {
    const s = this.steps[i];
    if (!s) return false;
    if (this.passed.has(i)) return true;
    return !(s.quiz || s.locked);
  }

  next() {
    if (!this.canAdvance()) return;
    this.passed.add(this.index);
    if (this.index >= this.steps.length - 1) this.finish();
    else this.go(this.index + 1);
  }

  back() {
    if (this.done) {
      this.go(this.steps.length - 1);
      return;
    }
    if (this.index > 0) this.go(this.index - 1);
  }

  go(i, { initial = false } = {}) {
    if (this._destroyed) return;
    const idx = Math.max(0, Math.min(this.steps.length - 1, i));
    if (idx > this.max + 1 || (idx > this.max && !this.canAdvance(this.max))) return;
    this._runStepCleanup();
    this.done = false;
    this.index = idx;
    this.max = Math.max(this.max, idx);
    this.store?.setLessonStep?.(this.id, idx, this.max);
    this._wrap.classList.toggle('is-later', idx > 0);
    this._main.hidden = false;
    this._doneHost.hidden = true;
    this._doneHost.replaceChildren();
    this._renderStep();
    this._renderRail();
    this._renderNav();
    if (!initial) {
      const top = this._main.getBoundingClientRect().top;
      const topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 60;
      // On narrow screens the compact step rail is sticky under the top bar.
      const compact = this._railLabel.parentNode && getComputedStyle(this._railLabel.parentNode).display !== 'none';
      const covered = topbar + (compact ? this._railLabel.parentNode.parentNode.getBoundingClientRect().height : 0);
      if (top < covered || top > window.innerHeight * 0.6) {
        this._main.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
      this._stepTitle.focus({ preventScroll: true });
    }
  }

  finish() {
    this._runStepCleanup();
    let first = false;
    try {
      first = this.store?.completeLesson?.(this.id) || false;
    } catch (err) {
      console.error(err);
    }
    this.done = true;
    this.max = this.steps.length - 1;
    this.store?.setLessonStep?.(this.id, 0, this.max);
    this._renderRail();
    this._main.hidden = true;
    this._doneHost.hidden = false;
    this._doneHost.replaceChildren(this._completionCard(first));
    this._doneHost.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    sfx.win();
    if (first) {
      setTimeout(() => {
        if (!this._destroyed && this._doneHost.isConnected) confetti(this._doneHost.querySelector('.lesson-done__icon'));
      }, 250);
    }
    requestAnimationFrame(() => this._doneHost.querySelector('.btn--primary')?.focus({ preventScroll: true }));
  }

  destroy() {
    this._destroyed = true;
    this._runStepCleanup();
    document.removeEventListener('keydown', this._onKey);
  }

  // ------------------------------------------------------------ internals

  _runStepCleanup() {
    const fn = this._stepCleanup;
    this._stepCleanup = null;
    if (typeof fn === 'function') {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }
  }

  _handleKey(e) {
    // Safety net: a lesson that forgot to return () => shell.destroy() must not keep
    // reacting to arrow keys (and completing itself) on other pages.
    if (this._destroyed) return;
    if (this.root && !this.root.isConnected) {
      this.destroy();
      return;
    }
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (document.body.classList.contains('has-modal')) return;
    if (isTypingTarget(e.target)) return;
    if (e.target?.closest?.('[data-keys="capture"], [role="slider"], [role="tablist"], [role="radiogroup"]')) return;
    if (e.key === 'ArrowRight') {
      if (this.done) return;
      e.preventDefault();
      this.next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.back();
    }
  }

  _build() {
    const e = this.entry;
    const tier = e.tier === 'both' ? this.store?.state?.lastTier || 'beginner' : e.tier;
    const tierEntry = findTier(tier);
    const unit = unitOf(this.id, tier);
    const units = unitsOf(tier);
    const unitNo = unit ? units.indexOf(unit) + 1 : null;

    this._rail = h('ol', { class: 'rail' });
    this._railLabel = h('span', { class: 'rail-compact__label' });
    this._railMeter = meter(0, { size: 'sm', label: 'Lesson progress' });
    const railCompact = h('div', { class: 'rail-compact' }, this._railLabel, this._railMeter);

    this._stepEyebrow = h('p', { class: 'eyebrow' });
    this._stepTitle = h('h2', { class: 'lesson__step-title', tabindex: '-1' });
    this._body = h('div', { class: 'lesson__body' });
    this._backBtn = h('button', { type: 'button', class: 'btn', 'data-action': 'back', on: { click: () => this.back() } }, icon('arrow-left'), h('span', { class: 'lesson__back-label' }, 'Back'));
    this._nextBtn = h('button', { type: 'button', class: 'btn btn--primary', 'data-action': 'next', on: { click: () => this.next() } });
    this._gateNote = h('span', { class: 'lesson__gate faint' });
    const nav = h('div', { class: 'lesson__nav' },
      this._backBtn,
      h('span', { class: 'lesson__nav-mid' }, this._gateNote, kbdHint(['←', '→'], 'to move')),
      this._nextBtn);

    this._main = h('section', { class: 'lesson__main', 'aria-live': 'off' },
      h('div', { class: 'lesson__step' }, this._stepEyebrow, this._stepTitle, this._body),
      nav);
    this._doneHost = h('section', { class: 'lesson__done', hidden: true });

    this._wrap = h('article', { class: 'lesson container', 'data-lesson': this.id },
      h('div', { class: 'lesson__bar' },
        h('a', { class: 'link-btn', href: `#${tier}` }, icon('arrow-left', { size: 16 }), tierEntry ? `${tierEntry.title} track` : 'Back')),
      h('header', { class: 'lesson__head' },
        h('p', { class: 'eyebrow eyebrow--accent' }, unitNo ? `Lesson · Unit ${unitNo} of ${units.length}` : 'Lesson'),
        h('h1', { class: 'lesson__title' }, this.title),
        h('div', { class: 'row row--sm' },
          tierChip(e.tier),
          e.minutes ? h('span', { class: 'chip chip--outline' }, icon('clock', { size: 13 }), `${e.minutes} min`) : null,
          h('span', { class: 'chip chip--outline' }, `${this.steps.length} steps`),
          this.store?.isLessonDone?.(this.id) ? h('span', { class: 'chip chip--bull' }, icon('check', { size: 13 }), 'Completed') : null),
        this.intro ? h('p', { class: 'lead lesson__intro' }, this.intro) : null),
      h('div', { class: 'lesson__layout' },
        h('nav', { class: 'lesson__rail', 'aria-label': 'Lesson steps' }, railCompact, this._rail),
        h('div', { class: 'lesson__content' }, this._main, this._doneHost)));
    this.root.append(this._wrap);
  }

  _renderRail() {
    const n = this.steps.length;
    this._rail.replaceChildren(...this.steps.map((s, i) => {
      const current = i === this.index && !this.done;
      const done = this.done || (this.passed.has(i) && !current);
      const reachable = i <= this.max || (i === this.max + 1 && this.canAdvance(this.max));
      const btn = h('button', {
        type: 'button',
        class: ['rail__step', current && 'is-current', done && 'is-done', !reachable && 'is-locked'],
        'aria-current': current ? 'step' : null,
        'aria-disabled': reachable ? null : 'true',
        'aria-label': `Step ${i + 1}: ${s.title}${done ? ' (done)' : ''}${!reachable ? ' (locked)' : ''}`,
        on: { click: () => reachable && this.go(i) },
      },
      h('span', { class: 'rail__dot mono', 'aria-hidden': 'true' }, done ? icon('check', { size: 14 }) : String(i + 1)),
      h('span', { class: 'rail__title' }, s.title));
      return h('li', null, btn);
    }));
    const shown = this.done ? n : this.index + 1;
    this._railLabel.replaceChildren(...[
      h('strong', null, this.done ? 'Complete' : `Step ${shown} of ${n}`),
      this.done ? null : h('span', { class: 'faint' }, ` · ${this.steps[this.index].title}`),
    ].filter(Boolean));
    setMeter(this._railMeter, this.done ? 1 : (this.index + 1) / n);
  }

  _renderNav() {
    const last = this.index >= this.steps.length - 1;
    const can = this.canAdvance();
    this._backBtn.disabled = this.index === 0;
    this._nextBtn.replaceChildren(h('span', null, last ? 'Finish lesson' : 'Next'), icon(last ? 'check' : 'arrow-right'));
    this._nextBtn.disabled = !can;
    const s = this.step;
    this._gateNote.textContent = can ? '' : s.quiz ? 'Answer to continue' : 'Finish the task to continue';
    this._renderRail();
  }

  _renderStep() {
    const s = this.step;
    const n = this.steps.length;
    this._stepEyebrow.textContent = `Step ${this.index + 1} of ${n}`;
    this._stepTitle.textContent = s.title;
    this._body.replaceChildren();
    this._body.classList.remove('is-entering');
    void this._body.offsetWidth;
    this._body.classList.add('is-entering');
    if (typeof s.render === 'function') {
      try {
        const r = s.render(this._body, s, this);
        if (typeof r === 'function') this._stepCleanup = r;
      } catch (err) {
        console.error(`[${this.id}] step ${this.index + 1} failed:`, err);
        this._body.append(h('div', { class: 'callout callout--warn' }, icon('info'), h('p', null, 'This step failed to load. You can skip ahead.')));
        this.passed.add(this.index);
      }
    }
    if (s.quiz) {
      const q = s.quiz;
      const titled = /quick check|quiz/i.test(s.title || '');
      this._body.append(h('div', { class: ['lesson__quiz', titled && 'lesson__quiz--solo'] },
        titled ? null : h('p', { class: 'eyebrow' }, 'Quick check'),
        choiceQuiz({
          ...q,
          onAnswer: (correct, value) => {
            this.passed.add(this.index);
            this._renderNav();
            try {
              q.onAnswer?.(correct, value);
            } catch (err) {
              console.error(err);
            }
            requestAnimationFrame(() => this._nextBtn.focus({ preventScroll: true }));
          },
        })));
    }
  }

  _completionCard(first) {
    const e = this.entry;
    const tier = e.tier === 'both' ? 'beginner' : e.tier;
    const unit = unitOf(this.id, tier);
    const games = (unit?.games || []).map((id) => findEntry(id)).filter(Boolean);
    const next = nextItem(this.id, tier);
    // Skip past this unit's games when looking for the next lesson.
    let nextLesson = null;
    let probe = next;
    let guard = 0;
    while (probe && guard++ < 30) {
      if (probe.type === 'lesson') {
        nextLesson = findEntry(probe.id);
        break;
      }
      probe = nextItem(probe.id, tier);
    }

    const gameCards = games.map((g) => {
      const st = this.store?.gameStats?.(g.id);
      return h('a', { class: 'lesson-done__game card card--link', href: `#${hashFor(g.id)}` },
        h('span', { class: 'lesson-done__game-icon', 'aria-hidden': 'true' }, icon('gamepad', { size: 22 })),
        h('span', { class: 'lesson-done__game-text' },
          h('strong', null, g.title),
          h('small', { class: 'muted' }, g.blurb)),
        st?.plays ? starRow(st.stars || 0, { size: 14 }) : h('span', { class: 'chip chip--accent chip--sm' }, 'New'),
        icon('arrow-right', { size: 18 }));
    });
    const practiceCards = gameCards;

    return h('div', { class: 'lesson-done card card--raised' },
      h('div', { class: 'lesson-done__icon', 'aria-hidden': 'true' }, icon('check', { size: 34 })),
      h('p', { class: 'eyebrow eyebrow--accent' }, 'Lesson complete'),
      h('h2', { class: 'lesson-done__title' }, this.title),
      h('p', { class: 'lesson-done__xp' },
        first ? h('span', { class: 'chip chip--accent' }, icon('spark', { size: 13 }), '+50 XP') : h('span', { class: 'chip' }, 'Reviewed · XP already earned'),
        h('span', { class: 'muted' }, first ? ' Nice work. Now lock it in with practice.' : ' Good refresher. Practice keeps it sharp.')),
      practiceCards.length ? h('div', { class: 'lesson-done__games' }, h('h3', { class: 'lesson-done__h' }, 'Practise it'), ...practiceCards) : null,
      h('div', { class: 'row lesson-done__actions' },
        gameCards.length
          ? h('a', { class: 'btn btn--primary', href: `#${hashFor(games[0].id)}` }, icon('play'), `Play ${games[0].title}`)
          : null,
        nextLesson ? h('a', { class: 'btn', href: `#l.${nextLesson.id}` }, `Next lesson: ${nextLesson.title}`, icon('arrow-right')) : null,
        h('button', { type: 'button', class: 'btn btn--ghost', on: { click: () => this.go(0) } }, icon('restart'), 'Review from start')));
  }
}

// ==========================================================================
// Media helpers (§12.5). Each *Step() returns a plain step object for `steps: [...]`; extra
// fields you pass (quiz, locked, …) are kept, so a helper step can also carry a quick check.
// ==========================================================================

const OVERLAY_METHOD = {
  hline: 'addHLine', segment: 'addSegment', series: 'addSeries', band: 'addBand', zone: 'addZone',
  box: 'addBox', marker: 'addMarker', path: 'addPath', fib: 'addFib', text: 'addText',
};

/** Adds one overlay spec ({ type: 'hline'|'segment'|…, …add* options }) or runs fn(chart). → id | null */
export function addOverlay(chart, spec) {
  if (!chart || !spec) return null;
  if (typeof spec === 'function') return spec(chart) ?? null;
  const { type, ...rest } = spec;
  const m = OVERLAY_METHOD[type];
  if (!m || typeof chart[m] !== 'function') {
    console.warn(`[lesson-kit] unknown overlay type "${type}"`);
    return null;
  }
  return chart[m](rest);
}

/** Deterministic rng for a lesson step (same example every visit): hash of lesson id + label. */
export function lessonRng(shellOrId, label = '') {
  const id = typeof shellOrId === 'string' ? shellOrId : shellOrId?.id || 'lesson';
  return makeRng(hashString(`${id}:${label}`));
}

/** Appends text: string (HTML) → <p>, Node → as is, array → each item. */
function appendText(el, text) {
  if (text == null || text === '' || text === false) return;
  if (Array.isArray(text)) {
    text.forEach((t) => appendText(el, t));
    return;
  }
  if (typeof text === 'string') el.append(h('p', { html: text }));
  else if (typeof text === 'function') appendText(el, text());
  else el.append(text);
}

function prettyKind(kind) {
  if (!kind) return 'Setup';
  const p = CANDLE_PATTERNS[kind] || CHART_PATTERNS[kind];
  if (p?.name) return p.name;
  const s = String(kind).replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function decimalsFor(candles) {
  const c = candles?.[candles.length - 1]?.c;
  if (!Number.isFinite(c)) return 2;
  if (c < 5) return 4;
  if (c >= 10000) return 0;
  return 2;
}

function safeDestroy(chart) {
  try {
    chart?.destroy?.();
  } catch (err) {
    console.error(err);
  }
}

/**
 * Figure with a caption for diagrams, charts and pictures.
 * figure(media: Node, caption?: string(HTML)|Node, { label: 'Figure 1', credit, wide, className }) → <figure>
 */
export function figure(media, caption = '', { label = null, credit = null, wide = false, className = '' } = {}) {
  const cap = caption || label
    ? h('figcaption', { class: 'figure__caption lesson-figure__caption' },
      label ? h('span', { class: 'lesson-figure__label mono' }, label) : null,
      typeof caption === 'string' ? h('span', { html: caption }) : caption || null)
    : null;
  return h('figure', { class: ['figure', 'lesson-figure', wide && 'lesson-figure--wide', className] },
    h('div', { class: 'lesson-figure__media' }, media),
    cap,
    credit ? h('p', { class: 'lesson-figure__credit' }, credit) : null);
}

/**
 * "Key takeaway" callout. content: string (HTML) | Node | string[] (bullets).
 * takeaway(content, { title = 'Key takeaway' }) → <aside class="takeaway">
 */
export function takeaway(content, { title = 'Key takeaway' } = {}) {
  let body;
  if (Array.isArray(content)) body = h('ul', { class: 'takeaway__list' }, content.map((c) => h('li', typeof c === 'string' ? { html: c } : null, typeof c === 'string' ? null : c)));
  else if (typeof content === 'string') body = h('p', { html: content });
  else body = content;
  return h('aside', { class: 'takeaway', role: 'note', 'aria-label': title },
    h('span', { class: 'takeaway__icon', 'aria-hidden': 'true' }, icon('flag', { size: 18 })),
    h('div', { class: 'takeaway__body' }, h('p', { class: 'takeaway__title' }, title), body));
}

// ------------------------------------------------------------------ storyStep

/** Static stand-in when story.js is unavailable: final frame's chart + the captions as a list. */
function staticStory(host, opts) {
  const frames = opts.frames || [];
  const to = frames.length ? Math.max(...frames.map((f) => f.to || 0)) : opts.candles.length;
  const chartHost = h('div', { class: 'chart-frame' });
  host.append(chartHost, frames.length
    ? h('ol', { class: 'story-fallback__captions' }, frames.map((f) => h('li', null, f.caption || '')))
    : null);
  const chart = new CandleChart(chartHost, { candles: opts.candles, height: opts.height || 320, visible: Math.min(opts.candles.length, to || opts.candles.length), showVolume: !!opts.indicators?.volume });
  for (const f of frames) for (const o of f.overlays || []) addOverlay(chart, o);
  return () => safeDestroy(chart);
}

/**
 * Animated chart story step (ChartStory from story.js, §12.5).
 * storyStep({ title, story, text, after, height, ...stepFields })
 *   story: ChartStory options ({ candles, frames, indicators, autoplay, loop, … }) or
 *          (rng) => options (rng is seeded from the lesson id + title, so it is stable)
 *   text / after: paragraphs before / after the story (HTML string | Node | array)
 * Falls back to a static chart with the frame captions if story.js cannot load.
 */
export function storyStep({ title, story, text = null, after = null, height = 340, ...rest } = {}) {
  return {
    title,
    ...rest,
    render(el, step, shell) {
      appendText(el, text);
      const host = h('div', { class: 'lesson-story', 'data-keys': 'capture' });
      el.append(host);
      appendText(el, after);
      let opts;
      try {
        opts = typeof story === 'function' ? story(lessonRng(shell, `story:${title}`)) : story;
      } catch (err) {
        console.error('[lesson-kit] story data failed:', err);
        host.append(h('p', { class: 'callout callout--warn' }, 'This animation failed to load.'));
        return undefined;
      }
      if (!opts || !opts.candles?.length) return undefined;
      let alive = true;
      let inst = null;
      let fallback = null;
      host.append(h('div', { class: 'lesson-story__loading skeleton skeleton--block', 'aria-hidden': 'true' }));
      import('./story.js').then((mod) => {
        if (!alive) return;
        host.replaceChildren();
        const ChartStory = mod.ChartStory || mod.default;
        inst = new ChartStory(host, { height, ...opts });
      }).catch((err) => {
        if (!alive) return;
        console.warn('[lesson-kit] story.js unavailable, showing a static chart:', err?.message || err);
        host.replaceChildren();
        try {
          fallback = staticStory(host, { height, ...opts });
        } catch (e) {
          console.error(e);
        }
      });
      return () => {
        alive = false;
        try {
          inst?.destroy?.();
        } catch (err) {
          console.error(err);
        }
        fallback?.();
      };
    },
  };
}

// ------------------------------------------------------------------ realExampleStep

/**
 * Textbook stand-in for a scanner setup kind → { candles, decisionIdx, setup, lead? }.
 * textbookExample(kinds, rng, { scanner, before = 60, after = 20 })
 *   Candle patterns, chart patterns, trends, ranges, support bounces / resistance rejections and
 *   breakouts / fakeouts come from the clean generators (candleScenario, chartScenario, trendSeries,
 *   fromPath). Every other scanner kind (crosses, divergences, fib pullbacks) needs the scanner
 *   module: pass { scanner } (the module from loadScanner()) and it uses scanner.simRound() — a
 *   simulated market in which the scanner itself found that setup. Without it such kinds fall back
 *   to a plain random walk with setup: null.
 */
export function textbookExample(kinds, rng, { scanner = null, before = 60, after = 20 } = {}) {
  const list = (kinds && kinds.length ? kinds : ['hammer']).slice();
  const kind = rng.pick(list);
  const seed = rng.int(1, 2 ** 31 - 1);
  if (CANDLE_PATTERNS[kind]) {
    const sc = candleScenario(kind, { seed, leadIn: 30, after: 8 });
    return { candles: sc.candles, decisionIdx: sc.end, setup: { kind, start: sc.start, end: sc.end, decisionIdx: sc.end, direction: sc.bias, meta: { name: CANDLE_PATTERNS[kind].name, confirm: sc.confirm } } };
  }
  const chartKind = {
    'breakout-up': 'ascending-triangle', 'breakout-down': 'descending-triangle',
    'fakeout-up': 'ascending-triangle', 'fakeout-down': 'descending-triangle',
  }[kind] || kind;
  if (CHART_PATTERNS[chartKind]) {
    const outcome = /^fakeout/.test(kind) ? 'fail' : 'success';
    const sc = chartScenario(chartKind, { seed, count: 100, after: 20, outcome });
    const points = (sc.keyPoints || []).filter((k) => k.label !== 'Breakout');
    const fake = /^fakeout/.test(kind);
    return {
      candles: sc.candles,
      decisionIdx: sc.breakoutIdx,
      setup: {
        kind,
        start: sc.patternStart,
        end: sc.breakoutIdx,
        decisionIdx: sc.breakoutIdx,
        direction: fake ? (sc.bias === 'bullish' ? 'bearish' : 'bullish') : sc.bias,
        meta: {
          name: fake ? `Failed breakout ${sc.direction > 0 ? 'up' : 'down'}` : CHART_PATTERNS[chartKind].name,
          neckline: sc.neckline, boundaries: sc.boundaries, target: sc.target, level: sc.level,
          points: /triangle|wedge|flag/.test(chartKind) ? null : points.map((k) => ({ idx: k.idx, price: k.price })),
          labels: points.map((k) => k.label),
          breakoutIdx: fake ? sc.breakoutIdx : undefined,
          ...(/flag$/.test(chartKind) && points.length >= 2 ? {
            poleStart: { idx: points[0].idx, price: points[0].price },
            poleTop: { idx: points[1].idx, price: points[1].price },
            upper: sc.boundaries?.upper, lower: sc.boundaries?.lower,
          } : {}),
        },
      },
    };
  }
  if (kind === 'trend-up' || kind === 'trend-down' || kind === 'range') {
    const ts = trendSeries({ seed, count: 80, direction: kind === 'range' ? 'range' : kind === 'trend-up' ? 'up' : 'down' });
    const last = ts.candles.length - 1;
    return { candles: ts.candles, decisionIdx: last, setup: { kind, start: ts.swings[0]?.idx ?? 0, end: last, decisionIdx: last, direction: kind === 'trend-up' ? 'bullish' : kind === 'trend-down' ? 'bearish' : 'neutral', meta: { name: kind === 'range' ? 'Trading range' : kind === 'trend-up' ? 'Uptrend' : 'Downtrend', swings: ts.swings } } };
  }
  if (kind === 'support-bounce' || kind === 'resistance-reject') {
    const up = kind === 'support-bounce';
    const lvl = 100;
    const pts = up
      ? [[0, 104], [0.25, lvl], [0.45, 103.2], [0.72, lvl + 0.05], [1, 102.8]]
      : [[0, 96], [0.25, lvl], [0.45, 96.8], [0.72, lvl - 0.05], [1, 97.2]];
    const { candles, anchors } = fromPath(pts, { seed, count: 70 });
    return { candles, decisionIdx: anchors[3].idx, setup: { kind, start: anchors[1].idx, end: anchors[3].idx, decisionIdx: anchors[3].idx, direction: up ? 'bullish' : 'bearish', meta: { name: up ? 'Support bounce' : 'Resistance rejection', level: lvl, pivots: [{ idx: anchors[1].idx, price: anchors[1].price }], touchIdx: anchors[3].idx } } };
  }
  if (scanner?.simRound) {
    const r = scanner.simRound(rng, { kinds: [kind], before, after });
    if (r) return { candles: r.candles, decisionIdx: r.decisionIdx, setup: r.setup, lead: r.lead, sim: true };
  }
  const candles = randomWalk({ seed, count: 80 });
  return { candles, decisionIdx: candles.length - 1, setup: null };
}

const LEVEL_KINDS = new Set(['support-bounce', 'resistance-reject', 'breakout-up', 'breakout-down', 'fakeout-up', 'fakeout-down']);

/** Structure labels (HH / HL / LH / LL, first swing H / L) for swings without a label. */
function structureLabels(swings) {
  let lastH = null;
  let lastL = null;
  return swings.map((p) => {
    if (p.label) return p.label;
    if (p.type === 'high') {
      const l = lastH == null ? 'H' : p.price > lastH ? 'HH' : 'LH';
      lastH = p.price;
      return l;
    }
    const l = lastL == null ? 'L' : p.price > lastL ? 'HL' : 'LL';
    lastL = p.price;
    return l;
  });
}

/**
 * Default annotation for a scanner / textbook setup (realExampleStep uses it): draws what the rule
 * looked at, per family — candle patterns: a box + the confirmation line; trends: the swing path
 * (HH / HL …); ranges: the range zone; levels: the level, its earlier touches (rings) and the
 * breakout / bounce candle; crosses: both moving averages; divergences: price lows (highs) and an
 * RSI pane with the matching RSI line; fib pullbacks: the fib tool; double tops / H&S: the labelled
 * points and the neckline; flags: pole + flag lines. ex: { candles, decisionIdx, lead } (lead =
 * candles before the window, used to warm up moving averages / RSI).
 */
export function annotateSetup(setup, chart, ex = {}) {
  if (!setup || !chart) return;
  const m = setup.meta || {};
  const kind = setup.kind || '';
  const candles = ex.candles || chart.candles || [];
  const n = candles.length;
  const inRange = (i) => Number.isFinite(i) && i >= 0 && i < n;
  const isPt = (p) => p && inRange(p.idx) && Number.isFinite(p.price);
  const dir = setup.direction === 'bullish' ? 1 : setup.direction === 'bearish' ? -1 : 0;
  const color = dir > 0 ? 'bull' : dir < 0 ? 'bear' : 'accent';
  const name = m.name || prettyKind(kind);
  const start = Math.max(0, setup.start ?? ex.decisionIdx ?? 0);
  const end = Math.max(start, setup.end ?? start);
  const d = Number.isFinite(ex.decisionIdx) ? ex.decisionIdx : setup.decisionIdx;
  const decision = (text, pos = dir < 0 ? 'above' : 'below') => {
    if (inRange(d)) chart.addMarker({ idx: d, position: pos, shape: 'arrow', text, color: 'accent' });
  };
  const lead = Array.isArray(ex.lead) ? ex.lead : [];
  const withLead = (fn) => fn(closesOf([...lead, ...candles])).slice(lead.length);

  // Candle patterns: the candles themselves and the confirmation level.
  if (CANDLE_PATTERNS[kind]) {
    chart.addBox({ from: start, to: end, color, label: name });
    if (Number.isFinite(m.confirm) && dir) chart.addHLine({ price: m.confirm, from: start, color: 'accent', dashed: true, label: 'Confirm', priceTag: false });
    return;
  }
  // Trends: the swing structure.
  if (kind === 'trend-up' || kind === 'trend-down') {
    const sw = (m.swings || []).filter(isPt).sort((a, b) => a.idx - b.idx);
    if (sw.length >= 2) chart.addPath({ points: sw.map((p) => ({ idx: p.idx, price: p.price })), color, labels: structureLabels(sw) });
    else chart.addBox({ from: start, to: end, color, label: name, full: true });
    decision(name);
    return;
  }
  // Range: the box price has been trading in.
  if (kind === 'range') {
    let top = m.top;
    let bottom = m.bottom;
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
      top = -Infinity;
      bottom = Infinity;
      for (let i = start; i <= Math.min(end, n - 1); i++) {
        top = Math.max(top, candles[i].h);
        bottom = Math.min(bottom, candles[i].l);
      }
    }
    if (Number.isFinite(top) && Number.isFinite(bottom)) chart.addZone({ from: bottom, to: top, x1: start, x2: end, color: 'accent', label: 'Range' });
    for (const p of [...(m.tops || []), ...(m.bottoms || [])].filter(isPt)) chart.addMarker({ idx: p.idx, price: p.price, position: 'at', shape: 'ring', color: 'accent' });
    return;
  }
  // Levels: the level, its earlier touches and the decisive candle.
  if (LEVEL_KINDS.has(kind)) {
    const sup = kind === 'support-bounce' || kind === 'breakout-down' || kind === 'fakeout-down';
    const pivots = (m.pivots || []).filter(isPt);
    const from = pivots.length ? pivots[0].idx : start;
    if (Number.isFinite(m.level)) chart.addHLine({ price: m.level, from, color: sup ? 'support' : 'resistance', dashed: true, label: sup ? 'Support' : 'Resistance' });
    for (const p of pivots) chart.addMarker({ idx: p.idx, price: p.price, position: 'at', shape: 'ring', color: sup ? 'support' : 'resistance' });
    if (/^fakeout/.test(kind)) {
      // The break is labelled on the level's side of its candle, clear of the "Back inside" arrow.
      if (inRange(m.breakoutIdx)) chart.addMarker({ idx: m.breakoutIdx, position: sup ? 'above' : 'below', shape: 'dot', text: 'Break', color: 'accent' });
      decision('Back inside', sup ? 'below' : 'above');
    } else if (/^breakout/.test(kind)) decision('Breakout', sup ? 'below' : 'above');
    else decision(sup ? 'Bounce' : 'Rejected', sup ? 'below' : 'above');
    return;
  }
  // Moving-average crosses: both averages, warmed up on the lead candles.
  if (kind === 'golden-cross' || kind === 'death-cross') {
    const fp = m.fastPeriod || 50;
    const sp = m.slowPeriod || 200;
    const f = m.type === 'ema' ? ema : sma;
    chart.addSeries({ values: withLead((cl) => f(cl, fp)), color: 'ma1', label: m.fast || `SMA ${fp}` });
    chart.addSeries({ values: withLead((cl) => f(cl, sp)), color: 'ma2', label: m.slow || `SMA ${sp}` });
    if (inRange(d)) chart.addMarker({ idx: d, price: Number.isFinite(m.fastValue) ? m.fastValue : undefined, position: 'at', shape: 'ring', text: name, color: 'accent' });
    return;
  }
  // RSI divergence: price makes a new extreme, RSI does not.
  if (kind === 'bullish-divergence' || kind === 'bearish-divergence') {
    if (isPt(m.a) && isPt(m.b)) {
      chart.addSegment({ a: m.a, b: m.b, color, width: 2, label: dir > 0 ? 'Lower low' : 'Higher high' });
      if (Number.isFinite(m.a.rsi) && Number.isFinite(m.b.rsi)) {
        try {
          chart.addPane({ id: 'rsi', title: 'RSI 14', height: 80, range: [0, 100], levels: [{ value: 70, color: 'bear' }, { value: 30, color: 'bull' }], series: [{ values: withLead((cl) => rsiOf(cl, 14)), color: 'ma3' }] });
          chart.addSegment({ pane: 'rsi', a: { idx: m.a.idx, price: m.a.rsi }, b: { idx: m.b.idx, price: m.b.rsi }, color, width: 2, label: dir > 0 ? 'Higher low' : 'Lower high' });
        } catch (err) {
          console.warn('[lesson-kit] rsi pane failed:', err);
        }
      }
    }
    decision('Decision', dir < 0 ? 'below' : 'above'); // opposite the price-extreme label
    return;
  }
  // Fibonacci pullback: the fib tool on the impulse, the pullback low / high and the turn.
  if (kind === 'fib-pullback' && isPt(m.a) && isPt(m.b)) {
    chart.addFib({ a: m.a, b: m.b, ratios: [0, 0.382, 0.5, 0.618, 0.786, 1], zone: [0.5, 0.618] });
    if (isPt(m.c)) chart.addMarker({ idx: m.c.idx, price: m.c.price, position: 'at', shape: 'ring', text: Number.isFinite(m.ratio) ? `${Math.round(m.ratio * 1000) / 10}%` : null, color: 'accent' });
    decision('Turn');
    return;
  }
  // Flags: the pole and the two flag lines.
  if ((kind === 'bull-flag' || kind === 'bear-flag') && isPt(m.poleStart) && isPt(m.poleTop)) {
    chart.addSegment({ a: m.poleStart, b: m.poleTop, color, width: 2, arrow: true, label: 'Pole' });
    for (const ln of [m.upper, m.lower]) {
      if (ln && inRange(ln.x1) && Number.isFinite(ln.y1) && Number.isFinite(ln.x2) && Number.isFinite(ln.y2)) chart.addSegment({ a: { idx: ln.x1, price: ln.y1 }, b: { idx: ln.x2, price: ln.y2 }, color: 'accent', dashed: true });
    }
    decision('Breakout', dir > 0 ? 'above' : 'below');
    return;
  }
  // Chart patterns (double tops / bottoms, head and shoulders, textbook triangles …).
  const pts = (m.points || []).filter(isPt);
  if (pts.length >= 2) {
    let labels = m.labels || [];
    if ((kind === 'double-top' || kind === 'double-bottom') && pts.length === 3) labels = kind === 'double-top' ? ['Top 1', '', 'Top 2'] : ['Bottom 1', '', 'Bottom 2'];
    else if (/head-and-shoulders/.test(kind) && pts.length === 5) labels = ['Left shoulder', '', 'Head', '', 'Right shoulder'];
    chart.addPath({ points: pts.map((p) => ({ idx: p.idx, price: p.price })), color, labels: labels.map((l) => (/^neckline$/i.test(l) ? '' : l)) });
  } else if (!m.boundaries && !m.neckline) chart.addBox({ from: start, to: end, color, label: name, full: end - start > 6 });
  if (typeof m.neckline === 'number') chart.addHLine({ price: m.neckline, from: pts[0]?.idx ?? start, color: 'accent', dashed: true, label: 'Neckline' });
  else if (m.neckline && Number.isFinite(m.neckline.x1)) chart.addSegment({ a: { idx: m.neckline.x1, price: m.neckline.y1 }, b: { idx: m.neckline.x2, price: m.neckline.y2 }, color: 'accent', dashed: true, extend: 'right', label: 'Neckline' });
  for (const side of ['upper', 'lower']) {
    const b = m.boundaries?.[side];
    if (b && Number.isFinite(b.x1)) chart.addSegment({ a: { idx: b.x1, price: b.y1 }, b: { idx: b.x2, price: b.y2 }, color: 'accent', dashed: true });
  }
  if (!m.neckline && !m.boundaries && Number.isFinite(m.level)) chart.addHLine({ price: m.level, color: 'accent', dashed: true, label: 'Level' });
  // The marker sits on the side price broke towards (away from the Top / Bottom labels).
  decision(/^fakeout/.test(kind) ? 'Back inside' : 'Breakout', dir < 0 ? 'below' : 'above');
}

/**
 * A real instance of a setup from the market data (scanner.realRound), with a textbook fallback,
 * the symbol/date/attribution line and a "Show another real example" button.
 * realExampleStep({ title, kinds, intervals = ['1d', '1w'], before = 60, after = 20, text, caption,
 *                   height = 320, volume = false, annotate(setup, chart, example), fallback(rng),
 *                   ...stepFields })
 *   annotate: draw on the chart (default annotateSetup: box + level/neckline + Decision marker)
 *   fallback: (rng) => { candles, decisionIdx, setup } when no real example is available
 *             (default textbookExample(kinds, rng))
 */
export function realExampleStep({
  title, kinds = [], intervals = ['1d', '1w'], before = 60, after = 20, text = null, caption = null,
  height = 320, volume = false, annotate = null, fallback = null, ...rest
} = {}) {
  return {
    title,
    ...rest,
    render(el, step, shell) {
      appendText(el, text);
      const statusEl = h('div', { class: 'real-example__status' });
      const anotherBtn = h('button', { type: 'button', class: 'btn btn--sm', 'data-action': 'another-example' }, icon('restart', { size: 15 }), h('span', null, 'Show another real example'));
      const chartHost = h('div', { class: 'real-example__chart chart-frame', 'data-keys': 'capture' });
      const sourceEl = h('div', { class: 'real-example__source' });
      el.append(h('figure', { class: 'real-example figure' },
        h('div', { class: 'real-example__head' }, statusEl, anotherBtn),
        chartHost,
        sourceEl,
        caption ? h('figcaption', { class: 'figure__caption', html: typeof caption === 'string' ? caption : null }, typeof caption === 'string' ? null : caption) : null));
      let chart = null;
      let alive = true;
      let n = 0;
      const baseSeed = hashString(`${shell?.id || 'lesson'}:real:${title}`);

      const setStatus = (kind, extra = '') => {
        const chip = kind === 'loading'
          ? h('span', { class: 'chip chip--sm source-chip is-loading' }, h('span', { class: 'source-chip__dot', 'aria-hidden': 'true' }), 'Finding a real example…')
          : kind === 'real'
            ? h('span', { class: 'chip chip--sm source-chip is-real' }, h('span', { class: 'source-chip__dot', 'aria-hidden': 'true' }), `Real market${extra ? ` · ${extra}` : ''}`)
            : h('span', { class: 'chip chip--sm source-chip is-fallback' }, h('span', { class: 'source-chip__dot', 'aria-hidden': 'true' }), 'Textbook example');
        statusEl.replaceChildren(...[chip, kind === 'textbook'
          ? h('span', { class: 'real-example__note faint' }, 'Real data is unavailable right now, so this is a generated example.')
          : null].filter(Boolean));
      };

      const draw = (ex, real) => {
        safeDestroy(chart);
        chartHost.replaceChildren();
        chart = new CandleChart(chartHost, {
          candles: ex.candles,
          height,
          showVolume: volume,
          yPad: 0.14,
          decimals: ex.decimals ?? decimalsFor(ex.candles),
          timeLabel: real && ex.candles[0]?.t > 1e11 ? marketTimeLabel(ex.interval) : null,
          ariaLabel: real ? `Real example: ${prettyKind(ex.setup?.kind)}` : `Textbook example: ${prettyKind(ex.setup?.kind)}`,
        });
        try {
          (annotate || annotateSetup)(ex.setup, chart, ex);
        } catch (err) {
          console.error('[lesson-kit] annotate failed:', err);
        }
        // Candle patterns are one to three candles: zoom in so they are big enough to read.
        const st = ex.setup;
        if (st && CANDLE_PATTERNS[st.kind] && ex.candles.length > 48) {
          chart.setViewport(Math.max(0, st.start - 30), Math.min(ex.candles.length, st.end + 13));
        }
        setStatus(real ? 'real' : 'textbook', real ? intervalLabel(ex.interval) : '');
        sourceEl.replaceChildren(...[real ? sourceReveal(ex, { title: 'Real example', compact: true }) : null].filter(Boolean));
        anotherBtn.disabled = false;
        anotherBtn.querySelector('span').textContent = real ? 'Show another real example' : 'Try a real example again';
      };

      const load = async () => {
        const my = ++n;
        anotherBtn.disabled = true;
        setStatus('loading');
        const rng = makeRng((baseSeed + my * 7919) >>> 0);
        let ex = null;
        try {
          const market = await loadMarket().catch(() => null);
          const status = market?.marketStatus?.();
          if (status !== 'offline' && status !== 'unconfigured') {
            const scanner = await loadScanner();
            ex = await withTimeout(scanner.realRound(rng, { kinds, intervals, before, after }), 9000);
          }
        } catch (err) {
          console.warn('[lesson-kit] real example unavailable:', err?.message || err);
          ex = null;
        }
        if (!alive || my !== n) return;
        const real = !!(ex && Array.isArray(ex.candles) && ex.candles.length);
        if (!real) {
          try {
            const scanner = fallback ? null : await loadScanner().catch(() => null);
            if (!alive || my !== n) return;
            ex = fallback ? fallback(rng) : textbookExample(kinds, rng, { scanner, before, after });
          } catch (err) {
            console.error('[lesson-kit] textbook fallback failed:', err);
            ex = textbookExample(['hammer'], rng);
          }
        }
        draw(ex, real);
      };
      anotherBtn.addEventListener('click', () => {
        sfx.click();
        load();
      });
      load();
      return () => {
        alive = false;
        n += 1;
        safeDestroy(chart);
      };
    },
  };
}

// ------------------------------------------------------------------ checklistStep

/**
 * Interactive "is this a valid setup?" checklist: each item ticks (or crosses) as its overlay
 * appears on the chart. Next unlocks once every item is checked (locked: false to skip the gate).
 * checklistStep({ title, text, example, items, verdict, height = 300, ...stepFields })
 *   example: { candles, visible?, decimals?, volume?, yPad? (default 0.14) } | (rng) => that
 *   items: [{ label, detail?, overlay?: spec | spec[] | (chart, example) => void, to?: idx
 *             (reveal candles up to idx when checked), pass = true (false → a failed criterion) }]
 *   verdict: string (HTML) | Node | (passedCount, items) => string|Node  (shown when all are checked;
 *            default: "Valid setup: every rule is met." / "Not a valid setup: n of m rules met.")
 */
export function checklistStep({ title, text = null, example, items = [], verdict = null, height = 300, locked = true, ...rest } = {}) {
  return {
    title,
    locked,
    ...rest,
    render(el, step, shell) {
      appendText(el, text);
      let ex;
      try {
        ex = typeof example === 'function' ? example(lessonRng(shell, `checklist:${title}`)) : example;
      } catch (err) {
        console.error('[lesson-kit] checklist example failed:', err);
      }
      const chartHost = h('div', { class: 'checklist-step__chart chart-frame', 'data-keys': 'capture' });
      const verdictEl = h('div', { class: 'checklist-step__verdict', 'aria-live': 'polite' });
      let checked = 0;
      let playing = 0;
      const rows = items.map((it, i) => {
        const mark = h('span', { class: 'check-item__mark', 'aria-hidden': 'true' }, h('span', { class: 'mono' }, String(i + 1)));
        const btn = h('button', {
          type: 'button', class: 'check-item', 'aria-pressed': 'false', 'data-check': String(i),
          on: { click: () => checkUpTo(i) },
        }, mark, h('span', { class: 'check-item__text' }, h('strong', null, it.label), it.detail ? h('small', { html: it.detail }) : null));
        return { it, btn, mark };
      });
      const nextBtn = h('button', { type: 'button', class: 'btn btn--primary btn--sm', 'data-action': 'check-next', on: { click: () => checkUpTo(checked) } }, icon('check', { size: 15 }), 'Check next');
      const playBtn = h('button', { type: 'button', class: 'btn btn--sm btn--ghost', 'data-action': 'check-all', on: { click: () => playAll() } }, icon('play', { size: 15 }), 'Check all');
      el.append(h('div', { class: 'checklist-step' },
        chartHost,
        h('div', { class: 'checklist-step__panel' },
          h('p', { class: 'eyebrow' }, 'Setup checklist'),
          h('ol', { class: 'check-items' }, rows.map((r) => h('li', null, r.btn))),
          h('div', { class: 'row row--sm checklist-step__actions' }, nextBtn, playBtn),
          verdictEl)));

      let chart = null;
      if (ex?.candles?.length) {
        chart = new CandleChart(chartHost, {
          candles: ex.candles, height, visible: ex.visible ?? null, showVolume: !!ex.volume, yPad: ex.yPad ?? 0.14,
          decimals: ex.decimals ?? decimalsFor(ex.candles), ariaLabel: `${title}: example chart`,
        });
      }

      function check(i) {
        const r = rows[i];
        if (!r || r.btn.getAttribute('aria-pressed') === 'true') return;
        const pass = r.it.pass !== false;
        r.btn.setAttribute('aria-pressed', 'true');
        r.btn.classList.add(pass ? 'is-pass' : 'is-fail');
        r.mark.replaceChildren(icon(pass ? 'check' : 'x', { size: 15 }));
        try {
          if (chart && Number.isFinite(r.it.to)) chart.setVisible(Math.min(ex.candles.length, r.it.to + 1));
          const ov = r.it.overlay;
          if (chart && ov) (Array.isArray(ov) ? ov : [ov]).forEach((o) => (typeof o === 'function' ? o(chart, ex) : addOverlay(chart, o)));
        } catch (err) {
          console.error('[lesson-kit] checklist overlay failed:', err);
        }
        checked = Math.max(checked, i + 1);
        (pass ? sfx.tick : sfx.wrong)();
        if (checked >= rows.length) finish();
      }
      function checkUpTo(i) {
        for (let k = 0; k <= Math.min(i, rows.length - 1); k++) check(k);
      }
      function finish() {
        nextBtn.disabled = true;
        playBtn.disabled = true;
        const passed = rows.filter((r) => r.it.pass !== false).length;
        let v = typeof verdict === 'function' ? verdict(passed, items) : verdict;
        const ok = passed === rows.length;
        if (v == null || v === '') v = ok ? '<strong>Valid setup:</strong> every rule on the checklist is met.' : `<strong>Not a valid setup:</strong> ${passed} of ${rows.length} rules met. Skip it and wait for a better one.`;
        verdictEl.replaceChildren(h('div', { class: ['explainer', ok ? 'explainer--good' : 'explainer--bad'], html: typeof v === 'string' ? v : null }, typeof v === 'string' ? null : v));
        if (locked) shell?.unlock?.();
      }
      function playAll() {
        const my = ++playing;
        const stepOnce = () => {
          if (my !== playing || !el.isConnected || checked >= rows.length) return;
          check(checked);
          if (checked < rows.length) setTimeout(stepOnce, reducedMotion() ? 0 : 750);
        };
        stepOnce();
      }
      if (!rows.length) finish();
      return () => {
        playing += 1;
        safeDestroy(chart);
      };
    },
  };
}

// ------------------------------------------------------------------ compareStep

/**
 * Side-by-side comparison (good vs bad example).
 * compareStep({ title, text, left, right, height = 220, after, ...stepFields })
 *   left/right: { title, verdict: 'good'|'bad'|'neutral', tag (chip text; default Valid / Trap),
 *                 candles | example: (rng) => { candles }, overlays: [specs], visible, points:
 *                 [strings (HTML)], caption, axis = false, volume = false }
 */
export function compareStep({ title, text = null, left = {}, right = {}, height = 220, after = null, ...rest } = {}) {
  return {
    title,
    ...rest,
    render(el, step, shell) {
      appendText(el, text);
      const charts = [];
      const panel = (side, key) => {
        const verdict = side.verdict || 'neutral';
        const tag = side.tag || (verdict === 'good' ? 'Valid' : verdict === 'bad' ? 'Trap' : 'Example');
        const chipCls = verdict === 'good' ? 'chip--bull' : verdict === 'bad' ? 'chip--bear' : 'chip--outline';
        const host = h('div', { class: 'compare__chart' });
        const card = h('div', { class: ['compare__side', `compare__side--${verdict}`] },
          h('div', { class: 'compare__head' },
            h('span', { class: ['chip', 'chip--sm', chipCls] }, icon(verdict === 'good' ? 'check' : verdict === 'bad' ? 'x' : 'eye', { size: 13 }), tag),
            side.title ? h('h3', { class: 'compare__title' }, side.title) : null),
          host,
          side.points?.length ? h('ul', { class: 'compare__points' }, side.points.map((p) => h('li', typeof p === 'string' ? { html: p } : null, typeof p === 'string' ? null : p))) : null,
          side.caption ? h('p', { class: 'figure__caption', html: typeof side.caption === 'string' ? side.caption : null }, typeof side.caption === 'string' ? null : side.caption) : null);
        let data = null;
        try {
          data = side.candles ? { candles: side.candles } : typeof side.example === 'function' ? side.example(lessonRng(shell, `compare:${title}:${key}`)) : null;
        } catch (err) {
          console.error('[lesson-kit] compare example failed:', err);
        }
        const candles = data?.candles || side.candles;
        return { card, host, side, candles, data };
      };
      const L = panel(left, 'left');
      const R = panel(right, 'right');
      el.append(h('div', { class: 'compare' }, L.card, R.card));
      appendText(el, after);
      for (const p of [L, R]) {
        if (!p.candles?.length) continue;
        try {
          const chart = new CandleChart(p.host, {
            candles: p.candles, height, visible: p.side.visible ?? p.data?.visible ?? null, yPad: p.side.yPad ?? 0.12,
            showAxis: !!p.side.axis, showVolume: !!p.side.volume, legend: false,
            decimals: decimalsFor(p.candles), ariaLabel: `${p.side.title || 'Example'} chart`,
          });
          for (const o of p.side.overlays || p.data?.overlays || []) addOverlay(chart, o);
          charts.push(chart);
        } catch (err) {
          console.error('[lesson-kit] compare chart failed:', err);
        }
      }
      return () => charts.forEach(safeDestroy);
    },
  };
}

export default LessonShell;
