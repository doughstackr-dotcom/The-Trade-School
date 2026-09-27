// LessonShell: numbered, step-by-step lesson with a step rail, Back/Next, ←/→ keys,
// quiz steps that gate Next, resume position, and a completion card linking to the games.
import { h, icon, sfx, confetti, choiceQuiz, kbdHint, tierChip, meter, setMeter, reducedMotion, starRow } from './ui.js';
import { findEntry, findTier, unitOf, unitsOf, nextItem, hashFor } from '../registry.js';

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
      if (top < topbar || top > window.innerHeight * 0.6) {
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
    this._backBtn = h('button', { type: 'button', class: 'btn', 'data-action': 'back', on: { click: () => this.back() } }, icon('arrow-left'), 'Back');
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
    this._gateNote.textContent = can ? '' : s.quiz ? 'Answer to continue' : 'Complete the task to continue';
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

    return h('div', { class: 'lesson-done card card--raised' },
      h('div', { class: 'lesson-done__icon', 'aria-hidden': 'true' }, icon('check', { size: 34 })),
      h('p', { class: 'eyebrow eyebrow--accent' }, 'Lesson complete'),
      h('h2', { class: 'lesson-done__title' }, this.title),
      h('p', { class: 'lesson-done__xp' },
        first ? h('span', { class: 'chip chip--accent' }, icon('spark', { size: 13 }), '+50 XP') : h('span', { class: 'chip' }, 'Reviewed · XP already earned'),
        h('span', { class: 'muted' }, first ? ' Nice work. Now lock it in with practice.' : ' Good refresher. Practice keeps it sharp.')),
      gameCards.length ? h('div', { class: 'lesson-done__games' }, h('h3', { class: 'lesson-done__h' }, 'Practise it'), ...gameCards) : null,
      h('div', { class: 'row lesson-done__actions' },
        gameCards.length
          ? h('a', { class: 'btn btn--primary', href: `#${hashFor(games[0].id)}` }, icon('play'), `Play ${games[0].title}`)
          : null,
        nextLesson ? h('a', { class: 'btn', href: `#l.${nextLesson.id}` }, `Next lesson: ${nextLesson.title}`, icon('arrow-right')) : null,
        h('button', { type: 'button', class: 'btn btn--ghost', on: { click: () => this.go(0) } }, icon('restart'), 'Review from start')));
  }
}

export default LessonShell;
