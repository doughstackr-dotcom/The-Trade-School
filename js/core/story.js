// ChartStory (ARCHITECTURE §12.5): an annotated, step-by-step chart — like a broadcast replay.
// Each frame reveals candles up to `to`, adds overlays (same specs as miniChart overlays), can
// dim everything outside a focus range (and smoothly zoom to it), and shows a caption in a bar
// under the chart. Transport: play / pause, back / forward, a scrubber with numbered frame dots,
// ←/→ keys when focused. Reduced motion: instant frames and no autoplay.
// Styles: .cs-* in css/chart.css. No DOM access at import time.

import { CandleChart } from './chart.js';
import { ema, sma, rsi, macd, bollinger, closes } from './indicators.js';
import { reducedMotion } from './anim.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const ADD = { hline: 'addHLine', segment: 'addSegment', series: 'addSeries', band: 'addBand', zone: 'addZone', box: 'addBox', marker: 'addMarker', path: 'addPath', fib: 'addFib', text: 'addText' };
const ICON = {
  prev: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  play: '<path d="M8 5.5v13l11-6.5z" class="cs-fill"/>',
  pause: '<path d="M8 5h3v14H8zM13 5h3v14h-3z" class="cs-fill"/>',
  replay: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>',
};
const svgIcon = (name) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;
const INDICATOR_DEFAULTS = { ema20: false, ema50: false, sma20: false, sma50: false, sma200: false, bb: false, volume: false, rsi: false, macd: false };

function el(tag, cls, attrs = {}) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  return n;
}

/**
 * new ChartStory(container, {
 *   candles, height = 340, frames: [{ to, caption, title?, overlays?, focus?: [from, to], zoom?,
 *     clear?, indicators?, duration?, revealInterval? }],
 *   indicators = { ema20, ema50, sma20, sma50, sma200, bb, volume, rsi, macd },
 *   autoplay = false, loop = false, interval = 3600, zoom = false, decimals = 2, timeLabel,
 *   chartType = 'candles', slots, yPad = 0.14, ariaLabel = 'Chart story', interactive = true, onFrame(i, frame) })
 * Frames are cumulative: overlays of earlier frames stay until a frame has clear: true. `to` is
 * the number of candles shown (exclusive). The newest frame's overlays pulse once as they appear.
 */
export class ChartStory {
  constructor(container, opts = {}) {
    if (!container) throw new Error('ChartStory: container element required');
    this.el = container;
    // yPad 0.14: story frames usually carry text markers ('Entry', 'Hammer'), which a tighter
    // price range would clip at the top / bottom edge.
    this.o = { height: 340, frames: [], autoplay: false, loop: false, interval: 3600, zoom: false, decimals: 2, chartType: 'candles', yPad: 0.14, ariaLabel: 'Chart story', interactive: true, ...opts };
    this.candles = (opts.candles || []).slice();
    this.frames = (this.o.frames || []).map((f) => ({ ...f }));
    if (!this.frames.length) this.frames = [{ to: this.candles.length, caption: '' }];
    this.index = -1;
    this.playing = false;
    this._timer = null;
    this._ls = { frame: new Set(), play: new Set(), pause: new Set() };
    this._ids = new Map(); // overlay key → chart id
    this._visible = true;
    this._destroyed = false;
    this._zoomed = false;
    this._build();
    this._indicators = { ...INDICATOR_DEFAULTS, ...(this.o.indicators || {}) };
    this._applyIndicators(this._indicators);
    this.goTo(0, { animate: false });
    this._observe();
    if (this.o.autoplay && !reducedMotion()) this.play({ fromUser: false });
  }

  // ---- DOM ------------------------------------------------------------------------------------

  _build() {
    const root = el('figure', 'cs', { tabindex: '0', role: 'group', 'aria-roledescription': 'chart story', 'aria-label': this.o.ariaLabel, 'data-keys': 'capture' });
    const stage = el('div', 'cs__stage');
    const chartHost = el('div', 'cs__chart');
    stage.append(chartHost);
    const cap = el('figcaption', 'cs__caption');
    const num = el('span', 'cs__num', { 'aria-hidden': 'true' });
    const text = el('p', 'cs__text', { 'aria-live': 'polite' });
    cap.append(num, text);
    const controls = el('div', 'cs__controls');
    const btn = (name, label) => {
      const b = el('button', `cs__btn cs__btn--${name}`, { type: 'button', 'aria-label': label });
      b.innerHTML = svgIcon(name);
      return b;
    };
    const prev = btn('prev', 'Previous step');
    const play = btn('play', 'Play');
    const next = btn('next', 'Next step');
    const scrub = el('div', 'cs__scrub', { role: 'slider', tabindex: '0', 'aria-label': 'Story step', 'aria-valuemin': '1', 'aria-valuemax': String(this.frames.length) });
    const track = el('div', 'cs__track', { 'aria-hidden': 'true' });
    const fill = el('div', 'cs__fill');
    track.append(fill);
    scrub.append(track);
    const dots = this.frames.map((_, i) => {
      const d = el('span', 'cs__dot', { 'data-i': String(i), 'aria-hidden': 'true' });
      d.textContent = String(i + 1);
      scrub.append(d);
      return d;
    });
    controls.append(prev, play, next, scrub);
    root.append(stage, cap, controls);
    this.el.append(root);
    this.root = root;
    this._dom = { stage, chartHost, num, text, prev, play, next, scrub, fill, dots };
    root.classList.toggle('cs--single', this.frames.length < 2);

    this.chart = new CandleChart(chartHost, {
      candles: this.candles,
      height: this.o.height,
      slots: this.o.slots ?? this.candles.length,
      visible: this.frames[0].to ?? this.candles.length,
      decimals: this.o.decimals,
      yPad: this.o.yPad,
      timeLabel: this.o.timeLabel || null,
      chartType: this.o.chartType,
      showVolume: !!this.o.indicators?.volume,
      ariaLabel: this.o.ariaLabel,
      interactive: this.o.interactive !== false,
    });

    // Events
    this._h = {
      prev: () => this._user(() => this.prev()),
      next: () => this._user(() => this.next()),
      play: () => (this.playing ? this.pause() : this.play()),
      key: (e) => this._onKey(e),
      down: (e) => this._scrubDown(e),
      move: (e) => this._scrubMove(e),
      up: (e) => this._scrubUp(e),
      vis: () => this._syncPlayback(),
    };
    prev.addEventListener('click', this._h.prev);
    next.addEventListener('click', this._h.next);
    play.addEventListener('click', this._h.play);
    root.addEventListener('keydown', this._h.key);
    scrub.addEventListener('pointerdown', this._h.down);
    scrub.addEventListener('pointermove', this._h.move);
    scrub.addEventListener('pointerup', this._h.up);
    scrub.addEventListener('pointercancel', this._h.up);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._h.vis);
  }

  _observe() {
    if (typeof IntersectionObserver !== 'function') return;
    this._io = new IntersectionObserver(
      (entries) => {
        this._visible = entries[entries.length - 1].intersectionRatio >= 0.35;
        this._syncPlayback();
      },
      { threshold: [0, 0.35, 0.7] },
    );
    this._io.observe(this.root);
  }

  // ---- public API ------------------------------------------------------------------------------

  on(event, fn) {
    this._ls[event]?.add(fn);
    return this;
  }
  off(event, fn) {
    this._ls[event]?.delete(fn);
    return this;
  }
  _emit(event, payload) {
    for (const fn of this._ls[event] || []) {
      try {
        fn(payload);
      } catch (err) {
        console.error(err);
      }
    }
  }

  get frame() {
    return this.frames[this.index] || null;
  }

  /** Show frame i (0-based). animate: reveal new candles / zoom smoothly (never with reduced motion). */
  goTo(i, { animate = true } = {}) {
    if (this._destroyed) return;
    const n = this.frames.length;
    const idx = clamp(Math.floor(i), 0, n - 1);
    const prevIdx = this.index;
    this.index = idx;
    const F = this.frames[idx];
    const anim = animate && !reducedMotion();
    const chart = this.chart;
    const to = clamp(F.to ?? this.candles.length, 0, this.candles.length);

    // Candles.
    const cur = chart.visibleCount;
    this._revealing = null;
    if (anim && to > cur && to - cur <= 60 && idx === prevIdx + 1) {
      const interval = F.revealInterval ?? clamp(Math.round(900 / (to - cur)), 45, 220);
      this._revealing = chart.reveal({ to, interval });
    } else chart.setVisible(to);

    // Overlays: everything since the last `clear` frame up to this one.
    let from = 0;
    for (let k = idx; k >= 0; k--) {
      if (this.frames[k].clear) {
        from = k;
        break;
      }
    }
    const want = new Map();
    for (let k = from; k <= idx; k++) (this.frames[k].overlays || []).forEach((o, m) => want.set(`f${k}-${m}`, { spec: o, k }));
    for (const [key, id] of this._ids) {
      if (!want.has(key)) {
        chart.remove(id);
        this._ids.delete(key);
      }
    }
    for (const [key, { spec, k }] of want) {
      const fresh = k === idx && prevIdx !== idx;
      if (this._ids.has(key)) {
        if (fresh) chart.update(this._ids.get(key), { pulse: true });
        continue;
      }
      const method = ADD[spec.type];
      if (!method) continue;
      const { type, ...rest } = spec;
      const id = chart[method]({ ...rest, id: `cs-${key}`, pulse: fresh && anim ? true : undefined });
      this._ids.set(key, id);
    }

    // Focus (dim the rest) and optional zoom.
    const focus = Array.isArray(F.focus) ? F.focus : null;
    chart.setFocus(focus ? focus[0] : null, focus ? focus[1] : null);
    const zoom = focus && (F.zoom ?? this.o.zoom);
    if (zoom) {
      const w = focus[1] - focus[0] + 1;
      const pad = Math.max(3, Math.round(w * 0.35));
      chart.setViewport(focus[0] - pad, focus[1] + 1 + pad, { animate: anim });
      this._zoomed = true;
    } else if (this._zoomed) {
      chart.resetViewport({ animate: anim });
      this._zoomed = false;
    }

    // Indicators for this frame (frame.indicators override the story's).
    this._applyIndicators({ ...this._indicators, ...(F.indicators || {}) });

    this._renderCaption(F, idx);
    this._emit('frame', { index: idx, frame: F });
    try {
      this.o.onFrame?.(idx, F);
    } catch (err) {
      console.error(err);
    }
    if (this.playing) this._scheduleNext();
  }

  next() {
    if (this.index < this.frames.length - 1) this.goTo(this.index + 1);
    else if (this.o.loop) this.goTo(0, { animate: false });
  }
  prev() {
    if (this.index > 0) this.goTo(this.index - 1, { animate: false });
  }

  play({ fromUser = true } = {}) {
    if (this._destroyed || this.frames.length < 2) return;
    if (this.index >= this.frames.length - 1) this.goTo(0, { animate: false });
    this.playing = true;
    this._userPaused = false;
    this._updatePlayButton();
    this._emit('play', { index: this.index, fromUser });
    this._scheduleNext();
  }
  pause() {
    this.playing = false;
    this._userPaused = true;
    clearTimeout(this._timer);
    this._timer = null;
    this._updatePlayButton();
    this._emit('pause', { index: this.index });
  }
  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    clearTimeout(this._timer);
    this._io?.disconnect();
    const d = this._dom;
    d.prev.removeEventListener('click', this._h.prev);
    d.next.removeEventListener('click', this._h.next);
    d.play.removeEventListener('click', this._h.play);
    this.root.removeEventListener('keydown', this._h.key);
    d.scrub.removeEventListener('pointerdown', this._h.down);
    d.scrub.removeEventListener('pointermove', this._h.move);
    d.scrub.removeEventListener('pointerup', this._h.up);
    d.scrub.removeEventListener('pointercancel', this._h.up);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._h.vis);
    for (const k of Object.keys(this._ls)) this._ls[k].clear();
    this.chart.destroy();
    this.root.remove();
  }

  // ---- internals -------------------------------------------------------------------------------

  _user(fn) {
    if (this.playing) this.pause();
    fn();
  }

  _scheduleNext() {
    clearTimeout(this._timer);
    this._timer = null;
    if (!this.playing || this._destroyed) return;
    if (!this._visible || (typeof document !== 'undefined' && document.hidden)) return; // resumes when visible
    const F = this.frame;
    const last = this.index >= this.frames.length - 1;
    if (last && !this.o.loop) {
      this.playing = false;
      this._updatePlayButton();
      return;
    }
    const words = String(F?.caption || '').length;
    const dwell = F?.duration ?? Math.max(this.o.interval, 1600 + words * 40);
    const started = this._revealing || Promise.resolve();
    started.then(() => {
      if (!this.playing || this._destroyed) return;
      this._timer = setTimeout(() => {
        this._timer = null;
        if (this.playing) this.next();
      }, dwell);
    });
  }

  _syncPlayback() {
    if (!this.playing) return;
    if (this._visible && !(typeof document !== 'undefined' && document.hidden)) {
      if (!this._timer) this._scheduleNext();
    } else {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _updatePlayButton() {
    const b = this._dom.play;
    const atEnd = this.index >= this.frames.length - 1 && !this.o.loop;
    const icon = this.playing ? 'pause' : atEnd ? 'replay' : 'play';
    b.innerHTML = svgIcon(icon);
    b.setAttribute('aria-label', this.playing ? 'Pause' : atEnd ? 'Replay from the start' : 'Play');
    b.setAttribute('aria-pressed', this.playing ? 'true' : 'false');
    this.root.classList.toggle('is-playing', this.playing);
  }

  _renderCaption(F, idx) {
    const d = this._dom;
    const n = this.frames.length;
    d.num.innerHTML = `${idx + 1}<span>/${n}</span>`;
    d.text.textContent = '';
    if (F.title) {
      const b = document.createElement('strong');
      b.textContent = `${F.title} `;
      d.text.append(b);
    }
    d.text.append(document.createTextNode(F.caption || ''));
    d.text.classList.remove('is-new');
    // Restart the caption fade (reflow between remove and add).
    void d.text.offsetWidth;
    d.text.classList.add('is-new');
    d.prev.disabled = idx === 0;
    d.next.disabled = idx === n - 1 && !this.o.loop;
    d.fill.style.width = n > 1 ? `${(idx / (n - 1)) * 100}%` : '0%';
    d.dots.forEach((dot, i) => {
      dot.classList.toggle('is-done', i < idx);
      dot.classList.toggle('is-current', i === idx);
    });
    d.scrub.setAttribute('aria-valuenow', String(idx + 1));
    d.scrub.setAttribute('aria-valuetext', `Step ${idx + 1} of ${n}${F.title ? `: ${F.title}` : ''}`);
    this._updatePlayButton();
  }

  _applyIndicators(ind) {
    const chart = this.chart;
    const cl = closes(this.candles);
    this._cache = this._cache || {};
    const get = (k, fn) => this._cache[k] || (this._cache[k] = fn());
    const series = [
      ['ema20', () => ema(cl, 20), 'ma1', 'EMA 20'],
      ['ema50', () => ema(cl, 50), 'ma2', 'EMA 50'],
      ['sma20', () => sma(cl, 20), 'ma1', 'SMA 20'],
      ['sma50', () => sma(cl, 50), 'ma2', 'SMA 50'],
      ['sma200', () => sma(cl, 200), 'ma3', 'SMA 200'],
    ];
    for (const [key, fn, color, label] of series) {
      const id = `cs-ind-${key}`;
      const on = !!ind[key];
      if (on && !chart.getOverlay(id)) chart.addSeries({ id, values: get(key, fn), color, label, width: 1.6 });
      else if (chart.getOverlay(id)) chart.update(id, { hidden: !on });
    }
    const bbId = 'cs-ind-bb';
    if (ind.bb && !chart.getOverlay(bbId)) {
      const bb = get('bb', () => bollinger(cl, 20, 2));
      chart.addBand({ id: bbId, upper: bb.upper, lower: bb.lower, color: 'info', opacity: 0.07 });
    } else if (chart.getOverlay(bbId)) chart.update(bbId, { hidden: !ind.bb });
    if (!!ind.volume !== !!chart.o.showVolume) chart.setVolume(!!ind.volume);
    if (ind.rsi && !this._paneRsi) {
      chart.addPane({ id: 'cs-rsi', title: 'RSI 14', height: 84, range: [0, 100], levels: [{ value: 70, color: 'bear' }, { value: 30, color: 'bull' }], series: [{ values: get('rsi', () => rsi(cl, 14)), color: 'ma3' }] });
      this._paneRsi = true;
    } else if (!ind.rsi && this._paneRsi) {
      chart.removePane('cs-rsi');
      this._paneRsi = false;
    }
    if (ind.macd && !this._paneMacd) {
      const m = get('macd', () => macd(cl));
      chart.addPane({ id: 'cs-macd', title: 'MACD 12 26 9', height: 90, histogram: { values: m.hist }, series: [{ values: m.macd, color: 'ma1' }, { values: m.signal, color: 'ma2' }] });
      this._paneMacd = true;
    } else if (!ind.macd && this._paneMacd) {
      chart.removePane('cs-macd');
      this._paneMacd = false;
    }
  }

  _onKey(e) {
    if (this._destroyed) return;
    // The chart handles its own arrows (crosshair) when it has focus.
    if (e.target !== this.root && e.target !== this._dom.scrub && !e.target.closest?.('.cs__btn')) return;
    let handled = true;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        this._user(() => this.next());
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        this._user(() => this.prev());
        break;
      case 'Home':
        this._user(() => this.goTo(0, { animate: false }));
        break;
      case 'End':
        this._user(() => this.goTo(this.frames.length - 1, { animate: false }));
        break;
      case ' ':
      case 'k':
        if (e.target.closest?.('.cs__btn')) return; // the button's own click
        this.toggle();
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  }

  _scrubIndex(e) {
    const r = this._dom.scrub.getBoundingClientRect();
    const n = this.frames.length;
    if (n < 2 || !(r.width > 0)) return 0;
    // Dots sit evenly from the first dot's centre to the last one's.
    const first = this._dom.dots[0].getBoundingClientRect();
    const last = this._dom.dots[n - 1].getBoundingClientRect();
    const a = first.left + first.width / 2;
    const b = last.left + last.width / 2;
    return clamp(Math.round(((e.clientX - a) / Math.max(1, b - a)) * (n - 1)), 0, n - 1);
  }
  _scrubDown(e) {
    if (e.button != null && e.button > 0) return;
    this._scrubbing = true;
    try {
      this._dom.scrub.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const i = this._scrubIndex(e);
    this._user(() => i !== this.index && this.goTo(i, { animate: i === this.index + 1 }));
  }
  _scrubMove(e) {
    if (!this._scrubbing) return;
    const i = this._scrubIndex(e);
    if (i !== this.index) this.goTo(i, { animate: false });
  }
  _scrubUp() {
    this._scrubbing = false;
  }
}

export default ChartStory;
