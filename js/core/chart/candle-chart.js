// CandleChart core: options, public API (data, viewport, overlays, panes, events) and layout.
// Rendering, pointer/keyboard interaction and drawing tools are mixed in from sibling modules.
// Part of the engine; import from js/core/chart.js, the public facade.

import { reducedMotion, ease, now, raf, cancelRaf } from '../anim.js';
import {
  clamp,
  colorOf,
  f,
  heikinAshiCandles,
  isNum,
  nextUid,
  normType,
  NS,
  paneDecimals,
  PILL_H,
  textW,
} from './util.js';
import { normalizeOverlay, overlayPrices } from './scene.js';
import { ChartRender } from './render.js';
import { ChartInteraction } from './interaction.js';
import { ChartDrawing } from './drawing.js';

// ---------------------------------------------------------------------------------------------
// CandleChart
// ---------------------------------------------------------------------------------------------

const DEFAULTS = {
  candles: [],
  height: 340,
  slots: null,
  visible: null,
  autoscale: 'visible',
  yPad: 0.08,
  showVolume: false,
  showAxis: true,
  showGrid: true,
  crosshair: true,
  decimals: 2,
  timeLabel: null,
  ariaLabel: 'Price chart',
  legend: true,
  showLast: true,
  interactive: true,
  chartType: 'candles', // 'candles' | 'ohlc' | 'line' | 'heikin-ashi'
  logScale: false,
  pannable: false, // wheel / drag / pinch pan-zoom (off: existing games are unaffected)
  wheelZoom: true, // with pannable: true = plain wheel zooms, 'ctrl' = only ctrl/⌘ + wheel
  viewport: null, // [from, to] slot range shown initially (null = everything)
  minBars: 10, // narrowest viewport (slots)
  focus: null, // [from, to]: candles outside are dimmed (ChartStory)
  focusDim: 0.3,
};

export class CandleChart {
  constructor(container, opts = {}) {
    if (!container) throw new Error('CandleChart: container element required');
    this.el = container;
    this.o = { ...DEFAULTS, ...opts };
    this.candles = (opts.candles || []).slice();
    this._visible = opts.visible ?? null;
    this._slots = opts.slots ?? null;
    this._ov = new Map();
    this._panes = [];
    this._ls = { click: new Set(), hover: new Set(), leave: new Set() };
    this._uid = 0;
    this._cid = `tc${nextUid()}`;
    this._width = 0;
    this._raf = null;
    this._destroyed = false;
    this._dom = null;
    this._domAnim = null;
    this._snapNext = true;
    this._easeNext = false;
    this._grow = null;
    this._revealToken = 0;
    this._timers = new Set();
    this._cross = null; // { idx, y } when visible
    this._drawing = null;
    this._drag = null;
    this._down = null;
    this._activeDrag = null;
    this._interactive = false;
    this._L = null;
    this._ver = 0;
    this._Lver = -1;
    this._type = normType(this.o.chartType);
    this._log = !!this.o.logScale;
    this._vp = null; // { from, to } in slot units, or null = everything
    this._vpAnim = null;
    this._ha = null; // { src, ver, candles } Heikin-Ashi cache
    this._focus = null;
    this._touch = new Map(); // pointerId → { x, y } for active touch pointers
    this._pan = null;
    this._pinch = null;
    this._lastVp = '';

    container.classList.add('tc-chart');
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'tc-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', this.o.ariaLabel);
    const cid = this._cid;
    svg.innerHTML =
      `<defs><clipPath id="${cid}-p"><rect class="tc-clip-rect"/></clipPath>` +
      `<linearGradient id="${cid}-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="tc-area-stop0"/><stop offset="1" class="tc-area-stop1"/></linearGradient></defs>` +
      `<rect class="tc-bg"/>` +
      `<g class="tc-l-grid"></g>` +
      `<g class="tc-l-back" clip-path="url(#${cid}-p)"></g>` +
      `<g class="tc-l-vol" clip-path="url(#${cid}-p)"></g>` +
      `<g class="tc-l-candles" clip-path="url(#${cid}-p)"></g>` +
      `<g class="tc-l-series" clip-path="url(#${cid}-p)"></g>` +
      `<g class="tc-l-lines" clip-path="url(#${cid}-p)"></g>` +
      `<g class="tc-l-marks" clip-path="url(#${cid}-p)"></g>` +
      `<g class="tc-l-panes"></g>` +
      `<g class="tc-l-axis"></g>` +
      `<g class="tc-l-tags"></g>` +
      `<g class="tc-l-legend"></g>` +
      `<g class="tc-l-ptitles"></g>` +
      `<g class="tc-l-flash" clip-path="url(#${cid}-p)"></g>` +
      `<g class="tc-l-cross" style="display:none"><path class="tc-cross-line"/>` +
      `<g class="tc-cross-y"><rect rx="3" height="${PILL_H}"/><text/></g>` +
      `<g class="tc-cross-x"><rect rx="3" height="${PILL_H}"/><text text-anchor="middle"/></g></g>` +
      `<g class="tc-l-draw"></g>` +
      `<g class="tc-l-handles"></g>`;
    this.svg = svg;
    const q = (s) => svg.querySelector(s);
    this._g = {
      clip: q('.tc-clip-rect'),
      bg: q('.tc-bg'),
      grid: q('.tc-l-grid'),
      back: q('.tc-l-back'),
      vol: q('.tc-l-vol'),
      candles: q('.tc-l-candles'),
      series: q('.tc-l-series'),
      lines: q('.tc-l-lines'),
      marks: q('.tc-l-marks'),
      panes: q('.tc-l-panes'),
      axis: q('.tc-l-axis'),
      tags: q('.tc-l-tags'),
      legend: q('.tc-l-legend'),
      ptitles: q('.tc-l-ptitles'),
      flash: q('.tc-l-flash'),
      cross: q('.tc-l-cross'),
      crossLine: q('.tc-cross-line'),
      crossY: q('.tc-cross-y'),
      crossX: q('.tc-cross-x'),
      draw: q('.tc-l-draw'),
      handles: q('.tc-l-handles'),
    };
    this._sr = document.createElement('div');
    this._sr.className = 'tc-sr';
    this._sr.setAttribute('aria-live', 'polite');
    container.appendChild(svg);
    container.appendChild(this._sr);

    // Events
    this._h = {
      down: (e) => this._onDown(e),
      move: (e) => this._onMove(e),
      up: (e) => this._onUp(e),
      leave: (e) => this._onLeave(e),
      cancel: (e) => this._onCancel(e),
      key: (e) => this._onKey(e),
      touch: (e) => {
        if (this._drawing || this._drag || (e.target && e.target.closest && e.target.closest('[data-handle]'))) e.preventDefault();
        else if (this.o.pannable && this._interactive && e.touches && e.touches.length >= 2) e.preventDefault(); // our pinch, not the page's
      },
      touchmove: (e) => {
        if (this.o.pannable && this._interactive && (this._pinch || this._pan || (e.touches && e.touches.length >= 2))) e.preventDefault();
      },
      wheel: (e) => this._onWheel(e),
      blur: () => {
        if (this._kbIdx != null) {
          this._kbIdx = null;
          this._hideCross();
        }
      },
    };
    svg.addEventListener('pointerdown', this._h.down);
    svg.addEventListener('pointermove', this._h.move);
    svg.addEventListener('pointerup', this._h.up);
    svg.addEventListener('pointerleave', this._h.leave);
    svg.addEventListener('pointercancel', this._h.cancel);
    svg.addEventListener('touchstart', this._h.touch, { passive: false });
    svg.addEventListener('touchmove', this._h.touchmove, { passive: false });
    svg.addEventListener('wheel', this._h.wheel, { passive: false });
    container.addEventListener('keydown', this._h.key);
    container.addEventListener('blur', this._h.blur);

    if (typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver((entries) => {
        const w = Math.floor(entries[0]?.contentRect?.width || container.clientWidth || 0);
        if (w > 0 && w !== this._width) {
          this._width = w;
          this._snapNext = true;
          this._ver++;
          this._render();
        }
      });
      this._ro.observe(container);
    }
    this._width = Math.floor(container.clientWidth || 0);
    this.setInteractive(this.o.interactive !== false);
    container.classList.toggle('is-pannable', !!this.o.pannable);
    if (Array.isArray(this.o.focus)) this._focus = { from: this.o.focus[0], to: this.o.focus[1] };
    const v = this.o.viewport;
    if (Array.isArray(v) && v.length === 2) this._vp = this._clampVp(v[0], v[1]);
    else if (v && isNum(v.from) && isNum(v.to)) this._vp = this._clampVp(v.from, v.to);
    this._lastVp = this._vpKey();
    this._render();
  }

  // ---- chart type, scale, viewport, focus ------------------------------------------------------

  get chartType() {
    return this._type;
  }
  /** 'candles' | 'ohlc' | 'line' | 'heikin-ashi' (HA values are averaged, not traded prices). */
  setChartType(type) {
    const t = normType(type);
    if (t === this._type) return;
    this._type = t;
    this.o.chartType = t;
    this._snapNext = true;
    this._changed();
  }
  get logScale() {
    return this._log;
  }
  /** Logarithmic price axis (ignored while any visible price is ≤ 0). */
  setLogScale(on) {
    this._log = !!on;
    this.o.logScale = this._log;
    this._snapNext = true;
    this._changed();
  }
  /** Candles as drawn: Heikin-Ashi in that mode, otherwise the real candles. */
  get drawnCandles() {
    return this._drawList();
  }
  _drawList() {
    if (this._type !== 'heikin-ashi') return this.candles;
    const h = this._ha;
    if (!h || h.src !== this.candles || h.len !== this.candles.length || h.last !== this.candles[this.candles.length - 1]) {
      this._ha = { src: this.candles, len: this.candles.length, last: this.candles[this.candles.length - 1], candles: heikinAshiCandles(this.candles) };
    }
    return this._ha.candles;
  }

  _totalSlots() {
    return Math.max(1, this._slots ?? this.candles.length, this.visibleCount);
  }
  _clampVp(from, to) {
    const total = this._totalSlots();
    const minW = Math.min(total, Math.max(2, this.o.minBars || 10));
    const maxW = total + Math.max(2, total * 0.1);
    let w = clamp((isNum(to) ? to : total) - (isNum(from) ? from : 0), minW, maxW);
    let a = isNum(from) ? from : total - w;
    // Keep at least a few candles on screen; allow some empty space on the right.
    if (w >= total) a = 0;
    else a = clamp(a, -w * 0.05, total + Math.max(1, w * 0.15) - w);
    if (a + w < Math.min(total, 3)) a = Math.min(total, 3) - w;
    return { from: a, to: a + w };
  }
  _vpKey() {
    const v = this.getViewport();
    return `${v.from.toFixed(3)}|${v.to.toFixed(3)}`;
  }
  _vpChanged() {
    const k = this._vpKey();
    if (k === this._lastVp) return;
    this._lastVp = k;
    this._emit('viewport', this.getViewport());
  }

  /**
   * setViewport(from, to, { animate = false, duration = 450 }) — show slots [from, to) (fractional
   * allowed; candle i sits at i + 0.5). Clamped to the data (≥ minBars wide). Emits 'viewport'.
   */
  setViewport(from, to, { animate = false, duration = 450 } = {}) {
    const target = this._clampVp(from, to);
    this._vpResetAfter = false;
    if (animate && !reducedMotion() && duration > 0) {
      const cur = this.getViewport();
      this._vpAnim = { a: { from: cur.from, to: cur.to }, b: target, t0: now(), dur: duration };
      this._changed();
      return;
    }
    this._vpAnim = null;
    this._vp = target;
    this._changed();
    this._vpChanged();
  }
  /** Show everything again (the default). */
  resetViewport({ animate = false } = {}) {
    if (animate && !reducedMotion()) {
      const total = this._totalSlots();
      this.setViewport(0, total, { animate: true });
      this._vpResetAfter = true;
      return;
    }
    this._vpAnim = null;
    this._vp = null;
    this._changed();
    this._vpChanged();
  }
  /** → { from, to, first, last, count, total }: slot range shown and the candles inside it. */
  getViewport() {
    const total = this._totalSlots();
    const v = this._vpAnim ? this._vpAt(now()) : this._vp;
    const from = v ? v.from : 0;
    const to = v ? v.to : total;
    const n = this.visibleCount;
    const first = clamp(Math.ceil(from - 0.5), 0, Math.max(0, n - 1)) || 0;
    const last = clamp(Math.floor(to - 0.5), 0, Math.max(0, n - 1)) || 0;
    return { from, to, first, last, count: n ? Math.max(0, last - first + 1) : 0, total };
  }
  _vpAt(t) {
    const A = this._vpAnim;
    if (!A) return this._vp;
    const p = clamp((t - A.t0) / A.dur, 0, 1);
    const e = ease.easeInOutCubic(p);
    const v = { from: A.a.from + (A.b.from - A.a.from) * e, to: A.a.to + (A.b.to - A.a.to) * e };
    if (p >= 1) {
      this._vpAnim = null;
      this._vp = this._vpResetAfter ? null : A.b;
      this._vpResetAfter = false;
      this._vpChanged();
      return this._vp;
    }
    return v;
  }
  /** Pan by `slots` (positive = later candles). */
  panBy(slots) {
    const v = this.getViewport();
    this.setViewport(v.from + slots, v.to + slots);
  }
  /** Zoom by `factor` (> 1 zooms in) around slot `anchor` (default: the viewport centre). */
  zoomBy(factor, anchor) {
    const v = this.getViewport();
    const w = v.to - v.from;
    const a = isNum(anchor) ? anchor : (v.from + v.to) / 2;
    const nw = w / Math.max(0.05, factor);
    const from = a - ((a - v.from) * nw) / w;
    this.setViewport(from, from + nw);
  }

  /** Show / hide the volume bars under the price area. */
  setVolume(on) {
    this.o.showVolume = !!on;
    this._snapNext = true;
    this._changed();
  }

  /** Dim every candle outside [from, to] (null clears). */
  setFocus(from, to, { dim } = {}) {
    this._focus = from == null ? null : { from: Math.min(from, to ?? from), to: Math.max(from, to ?? from) };
    if (dim != null) this.o.focusDim = dim;
    this._changed();
  }
  get focus() {
    return this._focus ? { ...this._focus } : null;
  }

  // ---- data ---------------------------------------------------------------------------------

  get visibleCount() {
    const n = this.candles.length;
    return this._visible == null ? n : clamp(Math.floor(this._visible), 0, n);
  }

  setCandles(candles) {
    this.candles = (candles || []).slice();
    this._revealToken++;
    this._grow = null;
    this._snapNext = true;
    if (this._vp) this._vp = this._clampVp(this._vp.from, this._vp.to);
    this._changed();
    this._vpChanged();
  }

  setVisible(n) {
    this._revealToken++;
    this._grow = null;
    this._visible = n == null ? null : Math.max(0, Math.floor(n));
    this._easeNext = true;
    this._changed();
  }

  setSlots(n) {
    this._slots = n == null ? null : Math.max(1, Math.floor(n));
    if (this._vp) this._vp = this._clampVp(this._vp.from, this._vp.to);
    this._changed();
  }

  append(candle, { grow = true } = {}) {
    const all = this._visible == null || this._visible >= this.candles.length;
    const v = this._vp;
    const total0 = this._totalSlots();
    this.candles.push({ ...candle, t: candle.t ?? this.candles.length });
    if (this._visible != null && all) this._visible = this.candles.length;
    // A viewport showing the latest candle follows the new one (live / replay charts).
    const grew = this._totalSlots() - total0;
    if (v && grew > 0 && v.to >= total0 - 0.5) {
      this._vp = { from: v.from + grew, to: v.to + grew };
      this._vpChanged();
    }
    this._easeNext = true;
    if (grow && !reducedMotion()) this._grow = { idx: this.candles.length - 1, t0: now(), dur: 260 };
    this._changed();
  }

  /** Animate candles appearing one at a time up to index `to` (exclusive). */
  reveal({ to, interval = 160, onStep, grow = true } = {}) {
    const token = ++this._revealToken;
    const target = clamp(to == null ? this.candles.length : Math.floor(to), 0, this.candles.length);
    let n = this.visibleCount;
    if (this._visible == null) this._visible = n;
    if (reducedMotion() || n >= target) {
      const from = n;
      this._visible = Math.max(n, target);
      this._easeNext = true;
      this._changed();
      for (let i = from; i < target; i++) onStep?.(i);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const step = () => {
        if (token !== this._revealToken || this._destroyed || n >= target) {
          resolve();
          return;
        }
        n++;
        this._visible = n;
        this._easeNext = true;
        if (grow) this._grow = { idx: n - 1, t0: now(), dur: Math.max(60, Math.min(interval * 0.85, 320)) };
        this._changed();
        try {
          onStep?.(n - 1);
        } catch (err) {
          console.error(err);
        }
        if (n >= target) {
          const t = setTimeout(() => {
            this._timers.delete(t);
            resolve();
          }, Math.min(interval, 320));
          this._timers.add(t);
          return;
        }
        const t = setTimeout(() => {
          this._timers.delete(t);
          step();
        }, interval);
        this._timers.add(t);
      };
      step();
    });
  }

  // ---- overlays -----------------------------------------------------------------------------

  _add(type, spec = {}) {
    const id = spec.id != null ? String(spec.id) : `${type}-${++this._uid}`;
    this._ov.set(id, normalizeOverlay(type, { ...spec, id }));
    this._changed();
    return id;
  }
  addHLine(spec) {
    return this._add('hline', { color: 'accent', dashed: false, width: 1.5, ...spec });
  }
  addSegment(spec) {
    return this._add('segment', { color: 'info', width: 2, extend: 'none', ...spec });
  }
  addSeries(spec) {
    return this._add('series', { color: 'ma1', width: 1.75, ...spec });
  }
  addBand(spec) {
    return this._add('band', { color: 'info', opacity: 0.12, ...spec });
  }
  addZone(spec) {
    return this._add('zone', { color: 'accent', opacity: 0.14, ...spec });
  }
  addBox(spec) {
    return this._add('box', { color: 'accent', ...spec });
  }
  addMarker(spec) {
    return this._add('marker', { position: 'above', shape: 'arrow', color: 'accent', ...spec });
  }
  addPath(spec) {
    return this._add('path', { color: 'info', width: 2, dots: true, ...spec });
  }
  addFib(spec) {
    return this._add('fib', { color: 'fib', labels: true, ...spec });
  }
  addText(spec) {
    return this._add('text', { color: 'text', anchor: 'start', ...spec });
  }
  update(id, patch = {}) {
    const o = this._ov.get(String(id));
    if (!o) return false;
    this._ov.set(String(id), normalizeOverlay(o.type, { ...o, ...patch, id: o.id }));
    this._changed();
    return true;
  }
  remove(id) {
    const ok = this._ov.delete(String(id));
    if (this._activeDrag === String(id)) this._activeDrag = null;
    if (ok) this._changed();
    return ok;
  }
  clearOverlays() {
    this._ov.clear();
    this._activeDrag = null;
    this._changed();
  }
  getOverlay(id) {
    const o = this._ov.get(String(id));
    return o ? { ...o } : null;
  }
  get overlays() {
    return [...this._ov.values()].map((o) => ({ ...o }));
  }

  // ---- panes --------------------------------------------------------------------------------

  addPane(spec = {}) {
    const id = spec.id != null ? String(spec.id) : `pane-${++this._uid}`;
    this._panes = this._panes.filter((p) => p.id !== id);
    this._panes.push({ height: 90, range: 'auto', levels: [], series: [], histogram: null, ...spec, id });
    this._changed();
    return id;
  }
  updatePane(id, patch = {}) {
    const i = this._panes.findIndex((p) => p.id === String(id));
    if (i < 0) return false;
    this._panes[i] = { ...this._panes[i], ...patch, id: this._panes[i].id };
    this._changed();
    return true;
  }
  removePane(id) {
    const before = this._panes.length;
    this._panes = this._panes.filter((p) => p.id !== String(id));
    if (this._panes.length !== before) this._changed();
    return this._panes.length !== before;
  }

  // ---- events -------------------------------------------------------------------------------

  on(event, fn) {
    if (!this._ls[event]) this._ls[event] = new Set();
    this._ls[event].add(fn);
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

  setInteractive(enabled) {
    this._interactive = !!enabled;
    if (this._interactive) {
      this.el.setAttribute('tabindex', '0');
      this.el.setAttribute('role', 'group');
      this.el.setAttribute('aria-label', `${this.o.ariaLabel}. Use the arrow keys to inspect candles.`);
    } else {
      this.el.removeAttribute('tabindex');
      this.el.removeAttribute('role');
      this.el.removeAttribute('aria-label');
      this._hideCross();
    }
    this.el.classList.toggle('is-interactive', this._interactive);
  }

  setAriaLabel(label) {
    this.o.ariaLabel = label;
    this.svg.setAttribute('aria-label', label);
    if (this._interactive) this.el.setAttribute('aria-label', `${label}. Use the arrow keys to inspect candles.`);
  }

  // ---- coordinates --------------------------------------------------------------------------

  get layout() {
    return this._layoutNow();
  }
  idxToX(idx) {
    return this._layoutNow().xOf(idx);
  }
  xToIdx(x) {
    return this._layoutNow().idxOf(x);
  }
  priceToY(p) {
    return this._layoutNow().yOf(p);
  }
  yToPrice(y) {
    return this._layoutNow().priceOf(y);
  }

  // ---- flash --------------------------------------------------------------------------------

  flash(idx, color = 'accent') {
    const L = this._layoutNow();
    const x = L.xOf(idx);
    const w = Math.max(6, L.slotW);
    const g = document.createElementNS(NS, 'rect');
    g.setAttribute('class', 'tc-flash');
    g.setAttribute('x', f(x - w / 2));
    g.setAttribute('y', 0);
    g.setAttribute('width', f(w));
    g.setAttribute('height', f(L.priceBottom));
    g.setAttribute('rx', 3);
    g.style.fill = colorOf(color, 'accent');
    this._g.flash.appendChild(g);
    const t = setTimeout(() => {
      this._timers.delete(t);
      g.remove();
    }, 950);
    this._timers.add(t);
  }

  // ---- lifecycle ----------------------------------------------------------------------------

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._revealToken++;
    if (this._drawing) {
      const d = this._drawing;
      this._drawing = null;
      d.resolve(null);
    }
    cancelRaf(this._raf);
    this._raf = null;
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
    this._ro?.disconnect();
    const svg = this.svg;
    svg.removeEventListener('pointerdown', this._h.down);
    svg.removeEventListener('pointermove', this._h.move);
    svg.removeEventListener('pointerup', this._h.up);
    svg.removeEventListener('pointerleave', this._h.leave);
    svg.removeEventListener('pointercancel', this._h.cancel);
    svg.removeEventListener('touchstart', this._h.touch);
    svg.removeEventListener('touchmove', this._h.touchmove);
    svg.removeEventListener('wheel', this._h.wheel);
    this.el.removeEventListener('keydown', this._h.key);
    this.el.removeEventListener('blur', this._h.blur);
    for (const k of Object.keys(this._ls)) this._ls[k].clear();
    svg.remove();
    this._sr.remove();
    this.el.classList.remove('tc-chart', 'is-interactive', 'is-drawing');
    this.el.removeAttribute('tabindex');
    this.el.removeAttribute('role');
    this.el.removeAttribute('aria-label');
  }

  // ---- internals: layout --------------------------------------------------------------------

  _changed() {
    this._ver++;
    this._schedule();
  }
  _schedule() {
    if (this._raf != null || this._destroyed) return;
    this._raf = raf(() => {
      this._raf = null;
      this._render();
    });
  }

  /** Target y-domain from candles [a, b) (and series / bands / fit overlays over the same range). */
  _targetDomain(n, a = 0, b = n) {
    const A = this.o.autoscale;
    if (Array.isArray(A) && A.length === 2 && isNum(A[0]) && isNum(A[1]) && A[1] > A[0]) return this._padDomain(A[0], A[1], false);
    const list = this._drawList();
    let i0 = 0;
    let m = A === 'all' ? this.candles.length : n;
    if (A !== 'all') {
      i0 = clamp(Math.floor(a), 0, m);
      m = clamp(Math.ceil(b), i0, m);
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = i0; i < m; i++) {
      const k = list[i];
      if (!k) continue;
      if (k.l < lo) lo = k.l;
      if (k.h > hi) hi = k.h;
    }
    for (const o of this._ov.values()) {
      if (o.pane) continue;
      if (o.type === 'series' || o.type === 'band') {
        const arrs = o.type === 'series' ? [o.values] : [o.upper, o.lower];
        if (o.fit === false || o.hidden) continue;
        for (const arr of arrs) {
          if (!arr) continue;
          for (let i = i0; i < Math.min(m, arr.length); i++) {
            const v = arr[i];
            if (isNum(v)) {
              if (v < lo) lo = v;
              if (v > hi) hi = v;
            }
          }
        }
      } else if (o.fit) {
        for (const v of overlayPrices(o)) {
          if (isNum(v)) {
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
      }
    }
    if (!(hi >= lo)) {
      // Nothing visible yet: fall back to the first candle or 0..1.
      const k = this.candles[0];
      if (k) {
        lo = k.l;
        hi = k.h;
      } else {
        lo = 0;
        hi = 1;
      }
    }
    return this._padDomain(lo, hi, true);
  }

  _padDomain(lo, hi, pad = true) {
    const yPad = pad ? this.o.yPad ?? 0.08 : 0;
    const vol = pad && this.o.showVolume ? 0.24 : 0;
    if (this._log && lo > 0 && hi > 0) {
      const a = Math.log(lo);
      const b = Math.log(hi);
      let r = b - a;
      if (!(r > 0)) r = 0.01;
      return [Math.exp(a - r * (yPad + vol)), Math.exp(b + r * yPad)];
    }
    let r = hi - lo;
    if (!(r > 0)) r = Math.abs(hi) * 0.01 || 1;
    return [lo - r * (yPad + vol), hi + r * yPad];
  }

  _domainAt(t) {
    const A = this._domAnim;
    if (!A) return this._dom;
    const p = clamp((t - A.t0) / A.dur, 0, 1);
    const e = ease.easeOutCubic(p);
    const d = [A.from[0] + (A.to[0] - A.from[0]) * e, A.from[1] + (A.to[1] - A.from[1]) * e];
    if (p >= 1) {
      this._domAnim = null;
      this._dom = A.to;
      return A.to;
    }
    return d;
  }

  _resolveDomain(n, t, a, b) {
    const target = this._targetDomain(n, a, b);
    const same = (a, b) => a && b && Math.abs(a[0] - b[0]) <= (b[1] - b[0]) * 1e-4 && Math.abs(a[1] - b[1]) <= (b[1] - b[0]) * 1e-4;
    if (!this._dom || this._snapNext || reducedMotion()) {
      this._dom = target;
      this._domAnim = null;
    } else if (this._domAnim) {
      if (!same(this._domAnim.to, target)) {
        const cur = this._domainAt(t);
        this._domAnim = { from: cur, to: target, t0: t, dur: 280 };
      }
    } else if (!same(this._dom, target)) {
      if (this._easeNext) this._domAnim = { from: this._dom, to: target, t0: t, dur: 280 };
      else this._dom = target;
    }
    this._snapNext = false;
    this._easeNext = false;
    return this._domainAt(t);
  }

  _layoutNow(t = now()) {
    if (this._L && this._Lver === this._ver && !this._domAnim && !this._vpAnim) return this._L;
    const o = this.o;
    const W = Math.max(120, this._width || Math.floor(this.el.clientWidth || 0) || 600);
    const height = Math.max(80, o.height);
    const n = this.visibleCount;
    const slots = this._totalSlots();
    const vp = this._vpAnim ? this._vpAt(t) : this._vp;
    const vf = vp ? vp.from : 0;
    const vt = vp ? vp.to : slots;
    // Candles whose slot overlaps the viewport (one extra each side so lines run off the edge).
    const a = Math.max(0, Math.floor(vf) - 1);
    const b = Math.min(n, Math.ceil(vt) + 1);
    const dom = this._resolveDomain(n, t, vp ? Math.max(0, Math.ceil(vf - 0.5)) : 0, vp ? Math.min(n, Math.floor(vt - 0.5) + 1) : n);
    const axis = o.showAxis !== false;
    const fmtW = Math.max(textW(dom[1].toFixed(o.decimals)), textW(dom[0].toFixed(o.decimals)));
    const axisW = axis ? Math.ceil(fmtW + 16) : 0;
    const timeH = axis ? 22 : 0;
    const priceBottom = height - timeH;
    const x0 = axis ? 4 : 2;
    const x1 = W - (axis ? axisW : 2);
    const py0 = 8;
    const py1 = priceBottom - 6;
    let top = priceBottom;
    const panes = this._panes.map((p) => {
      const ph = Math.max(40, p.height || 90);
      const pane = { spec: p, top, bottom: top + ph, y0: top + 20, y1: top + ph - 6 };
      top += ph;
      return pane;
    });
    const H = top + timeH;
    const slotW = (x1 - x0) / Math.max(1e-6, vt - vf);
    // Thicker wicks once slots are healthy; bodies take ~70% of the slot when space allows.
    const wickW = slotW >= 14 ? 2 : 1;
    let bw = Math.max(1, Math.round(slotW * (slotW >= 8 ? 0.7 : 0.65)));
    if (wickW === 1 && bw % 2 === 0) bw = Math.max(1, bw - 1);
    if (wickW === 2 && bw % 2 === 1) bw = bw - 1;
    const log = this._log && dom[0] > 0;
    const L = { W, H, height, x0, x1, axisW, timeH, axis, priceBottom, py0, py1, panes, slots, slotW, bw, wickW, n, dom, vf, vt, i0: a, i1: b, log };
    const l0 = log ? Math.log(dom[0]) : 0;
    const l1 = log ? Math.log(dom[1]) : 0;
    L.yOf = log
      ? (p) => (p > 0 ? py0 + ((l1 - Math.log(p)) / (l1 - l0)) * (py1 - py0) : NaN)
      : (p) => py0 + ((dom[1] - p) / (dom[1] - dom[0])) * (py1 - py0);
    L.priceOf = log ? (y) => Math.exp(l1 - ((y - py0) / (py1 - py0)) * (l1 - l0)) : (y) => dom[1] - ((y - py0) / (py1 - py0)) * (dom[1] - dom[0]);
    L.xOf = (i) => x0 + (i - vf + 0.5) * slotW;
    L.idxOf = (x) => (x - x0) / slotW - 0.5 + vf;
    L.first = clamp(Math.ceil(vf - 0.5), 0, Math.max(0, n - 1)) || 0;
    L.last = clamp(Math.floor(vt - 0.5), 0, Math.max(0, n - 1));
    L.volTop = py1 - (py1 - py0) * 0.18;
    L.volBot = py1;
    // Pane scales.
    for (const pane of panes) {
      const p = pane.spec;
      let lo;
      let hi;
      if (Array.isArray(p.range) && p.range.length === 2) [lo, hi] = p.range;
      else {
        lo = Infinity;
        hi = -Infinity;
        const scan = (arr) => {
          if (!arr) return;
          const j0 = vp ? L.first : 0;
          const j1 = vp ? L.last + 1 : n;
          for (let i = j0; i < Math.min(j1, arr.length); i++) {
            const v = arr[i];
            if (isNum(v)) {
              if (v < lo) lo = v;
              if (v > hi) hi = v;
            }
          }
        };
        for (const s of p.series || []) scan(s.values);
        if (p.histogram) {
          scan(p.histogram.values);
          lo = Math.min(lo, 0);
          hi = Math.max(hi, 0);
        }
        for (const lv of p.levels || []) {
          if (isNum(lv.value)) {
            lo = Math.min(lo, lv.value);
            hi = Math.max(hi, lv.value);
          }
        }
        if (!(hi >= lo)) {
          lo = 0;
          hi = 1;
        }
        const r = hi - lo || Math.abs(hi) || 1;
        lo -= r * 0.08;
        hi += r * 0.08;
      }
      pane.dom = [lo, hi];
      pane.decimals = p.decimals ?? paneDecimals(hi - lo);
    }
    this._L = L;
    this._Lver = this._ver;
    return L;
  }

  _scene(L, pane = null) {
    const yOf = pane ? (v) => pane.y0 + ((pane.dom[1] - v) / (pane.dom[1] - pane.dom[0] || 1)) * (pane.y1 - pane.y0) : L.yOf;
    return {
      x: L.xOf,
      y: yOf,
      i0: L.i0,
      i1: L.i1,
      x0: L.x0,
      x1: L.x1,
      y0: pane ? pane.top : 0,
      y1: pane ? pane.bottom : L.priceBottom,
      slotW: L.slotW,
      bw: L.bw,
      wickW: L.wickW,
      n: L.n,
      candles: this.candles,
      fmt: (p) => (isNum(p) ? p.toFixed(pane ? pane.decimals : this.o.decimals) : ''),
      mini: false,
      axis: L.axis,
      pills: pane ? null : [],
      labelTop: pane ? pane.top + 20 : this._legendBottom(),
      type: this._type,
      draw: this._type === 'heikin-ashi' ? this._drawList() : null,
      focus: this._focus,
      focusDim: this.o.focusDim,
      gradId: `${this._cid}-area`,
      areaBase: this.o.showVolume ? L.volTop : L.py1 + 6,
    };
  }
}

/** Copy the methods (and accessors) of each mixin class onto CandleChart.prototype. */
function mixin(target, ...sources) {
  for (const src of sources) {
    for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(src.prototype))) {
      if (key !== 'constructor') Object.defineProperty(target.prototype, key, desc);
    }
  }
}

mixin(CandleChart, ChartRender, ChartInteraction, ChartDrawing);
