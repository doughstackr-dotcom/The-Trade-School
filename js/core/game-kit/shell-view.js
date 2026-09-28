// GameShell view internals: builds the intro, HUD, feedback banners and results screens.
// Mixed into GameShell.prototype by ./shell.js; `this` is always a GameShell.

import { h, icon, sfx, confetti, starRow, fmt, kbdHint, tierChip, reducedMotion, toast } from '../ui.js';
import { defaultGamePreview } from '../game-ui.js';
import {
  findEntry, nextItem, unitOf, findBadge, pathFor, DIFFICULTY_LEVELS, SOURCES, findStyle,
} from '../../registry.js';
import { STAR_LINES, SURVIVAL_LINES, LEVEL_VALUE, animateNumber, multiplierFor } from './util.js';
import { heartIcon, styleIcon, intervalLabel, sourceText } from './labels.js';

export class GameShellView {
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
        options: this.modes.map((m) => ({ id: m.id, label: m.label, note: m.description || '' })),
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
            lockNode: locked ? h('span', null, 'Real market charts need a free account. ', h('a', { href: '/account/signin' }, 'Sign in or create one'), '.') : null,
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
      h('a', { class: 'btn btn--lg', href: '/games' }, icon('arrow-left'), 'Back to Games'),
      nextEntry ? h('a', { class: 'btn btn--lg btn--ghost results__next', href: pathFor(nextEntry.id) },
        h('span', null, h('small', null, `Next ${nextEntry.type}`), nextEntry.title), icon('arrow-right')) : null);

    const review = lesson && s.stars < 2
      ? h('p', { class: 'results__review' }, icon('book', { size: 16 }), 'Want a refresher first? ', h('a', { href: `/lessons/${lesson.id}` }, `Review “${lesson.title}”`))
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
