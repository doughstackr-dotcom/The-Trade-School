// CandleChart drawing tools (draw() for hline / segment / fib / zone) and draggable overlays.
// Mixed into CandleChart.prototype by ./candle-chart.js; `this` is always a CandleChart.

import { clamp, coarsePointer, colorOf, crisp, DRAW_COLORS, esc, f, FIB_RATIOS } from './util.js';
import { labelPill, rFib } from './scene.js';

export class ChartDrawing {
  // ---- internals: drawing -------------------------------------------------------------------

  /**
   * draw(kind, { color, snap: false | 'ohlc' | 'candle', label, keep = true, fib: {...} }) → Promise<shape|null>
   */
  draw(kind, opts = {}) {
    this.cancelDraw();
    if (!['hline', 'segment', 'fib', 'zone'].includes(kind)) return Promise.reject(new Error(`CandleChart.draw: unknown kind ${kind}`));
    return new Promise((resolve) => {
      this._drawing = { kind, opts, resolve, a: null, b: null, hover: null, stage: 'idle', pressed: false, downAt: null, kb: null };
      this._prevTouch = this.svg.style.touchAction;
      this.svg.style.touchAction = 'none';
      this.el.classList.add('is-drawing');
      this._renderDraw();
    });
  }

  cancelDraw() {
    const d = this._drawing;
    if (!d) return;
    this._endDrawMode();
    d.resolve(null);
  }

  get isDrawing() {
    return !!this._drawing;
  }

  _endDrawMode() {
    this._drawing = null;
    this.svg.style.touchAction = this._prevTouch || '';
    this.el.classList.remove('is-drawing');
    this._g.draw.innerHTML = '';
  }

  _dataPoint(pt, snap) {
    const L = this._layoutNow();
    const y = clamp(pt.y, L.py0, L.py1);
    const x = clamp(pt.x, L.x0, L.x1);
    let idx = L.idxOf(x);
    let price = L.priceOf(y);
    if (snap === 'ohlc' || snap === true || snap === 'candle') {
      const i = clamp(Math.round(idx), 0, Math.max(0, L.n - 1));
      const k = this.candles[i];
      if (k && i < L.n) {
        if (snap !== 'candle') {
          let best = null;
          for (const v of [k.o, k.h, k.l, k.c]) {
            const dy = Math.abs(this.priceToY(v) - pt.y);
            if (dy <= 12 && (!best || dy < best.dy)) best = { v, dy };
          }
          if (best) {
            price = best.v;
            idx = i;
          }
        }
        if (snap === 'candle') idx = i;
      }
    }
    return { idx, price };
  }

  _drawDown(pt) {
    const d = this._drawing;
    const p = this._dataPoint(pt, d.opts.snap);
    d.pressed = true;
    d.downAt = pt;
    if (d.kind === 'hline') d.a = p;
    else if (!d.a) {
      d.a = p;
      d.b = p;
      d.stage = 'pressA';
    } else {
      d.b = p;
      d.stage = 'pressB';
    }
    this._renderDraw();
  }

  _drawMove(pt) {
    const d = this._drawing;
    const p = this._dataPoint(pt, d.opts.snap);
    if (d.kind === 'hline') d.a = p;
    else if (d.a) d.b = p;
    else d.hover = p;
    this._renderDraw();
  }

  _drawUp(pt) {
    const d = this._drawing;
    if (!d.pressed) return;
    d.pressed = false;
    const p = this._dataPoint(pt, d.opts.snap);
    if (d.kind === 'hline') {
      d.a = p;
      this._commitDraw();
      return;
    }
    const moved = d.downAt && Math.hypot(pt.x - d.downAt.x, pt.y - d.downAt.y) > 8;
    if (d.stage === 'pressA') {
      if (moved) {
        d.b = p;
        this._commitDraw();
      } else d.stage = 'placedA';
    } else if (d.stage === 'pressB') {
      const ax = this.idxToX(d.a.idx);
      const ay = this.priceToY(d.a.price);
      if (Math.hypot(pt.x - ax, pt.y - ay) > 6) {
        d.b = p;
        this._commitDraw();
      } else d.stage = 'placedA';
    }
  }

  _drawTapAt(p) {
    const d = this._drawing;
    if (d.kind === 'hline') {
      d.a = p;
      this._commitDraw();
    } else if (!d.a || d.stage === 'idle') {
      d.a = p;
      d.b = { ...p };
      d.stage = 'placedA';
      this._renderDraw();
    } else if (d.a.idx !== p.idx || d.a.price !== p.price) {
      d.b = p;
      this._commitDraw();
    }
  }

  _commitDraw() {
    const d = this._drawing;
    this._endDrawMode();
    const o = d.opts || {};
    const color = o.color || DRAW_COLORS[d.kind];
    const a = { idx: d.a.idx, price: d.a.price };
    const b = d.b ? { idx: d.b.idx, price: d.b.price } : { ...a };
    let shape;
    if (d.kind === 'hline') {
      const id = this.addHLine({ price: a.price, color, label: o.label, dashed: o.dashed });
      shape = { kind: 'hline', price: a.price, a, b: a, id };
    } else if (d.kind === 'segment') {
      const id = this.addSegment({ a, b, color, extend: o.extend || 'none', label: o.label });
      shape = { kind: 'segment', a, b, id };
    } else if (d.kind === 'fib') {
      const id = this.addFib({ a, b, color, ...(o.fib || {}) });
      shape = { kind: 'fib', a, b, id };
    } else {
      const from = Math.min(a.price, b.price);
      const to = Math.max(a.price, b.price);
      const id = this.addZone({ from, to, color, label: o.label });
      shape = { kind: 'zone', a, b, from, to, id };
    }
    if (o.keep === false) {
      this.remove(shape.id);
      shape.id = null;
    }
    d.resolve(shape);
  }

  _renderDraw() {
    const d = this._drawing;
    if (!d) return;
    const L = this._layoutNow();
    const S = { ...this._scene(L), pills: null };
    const col = colorOf(d.opts.color || DRAW_COLORS[d.kind]);
    let s = '';
    const dot = (p) => `<circle class="tc-draw-dot" cx="${f(S.x(p.idx))}" cy="${f(S.y(p.price))}" r="5" style="stroke:${col}"/>`;
    if (d.kind === 'hline') {
      const p = d.a || d.hover || d.kb;
      if (p) {
        const y = S.y(p.price);
        s += `<path class="tc-draw-line" d="M${L.x0},${crisp(y)}H${f(L.x1)}" style="stroke:${col}"/>`;
        s += labelPill(L.x1 - 6, y, S.fmt(p.price), col, 'end');
      }
    } else if (d.a) {
      const b = d.b || d.a;
      if (d.kind === 'segment') s += `<path class="tc-draw-line" d="M${f(S.x(d.a.idx))},${f(S.y(d.a.price))}L${f(S.x(b.idx))},${f(S.y(b.price))}" style="stroke:${col}"/>`;
      else if (d.kind === 'fib') s += rFib({ a: d.a, b, ratios: FIB_RATIOS, extensions: [], color: d.opts.color || 'fib', labels: true, zone: d.opts.fib?.zone ?? null }, S);
      else if (d.kind === 'zone') {
        const ya = S.y(d.a.price);
        const yb = S.y(b.price);
        s += `<rect class="tc-draw-zone" x="${L.x0}" y="${f(Math.min(ya, yb))}" width="${f(L.x1 - L.x0)}" height="${f(Math.max(1, Math.abs(yb - ya)))}" style="fill:${col};stroke:${col}"/>`;
        s += labelPill(L.x1 - 6, ya, S.fmt(d.a.price), col, 'end') + labelPill(L.x1 - 6, yb, S.fmt(b.price), col, 'end');
      }
      s += dot(d.a);
      if (d.b) s += dot(b);
    } else if (d.hover || d.kb) s += dot(d.hover || d.kb);
    this._g.draw.innerHTML = s;
  }

  // ---- internals: dragging ------------------------------------------------------------------

  /** Make overlay `id` draggable (hline: vertical; segment/fib: endpoints; zone: edges). Pass false to stop. */
  setDraggable(id, onChange) {
    const o = this._ov.get(String(id));
    if (!o) return false;
    if (onChange === false || onChange === null) {
      delete o._drag;
      if (this._activeDrag === o.id) this._activeDrag = null;
    } else {
      o._drag = typeof onChange === 'function' ? onChange : () => {};
      this._activeDrag = o.id;
    }
    this._changed();
    return true;
  }

  _handlesHTML(L, S) {
    let s = '';
    // 28px hit circles for mice, 44px on touch screens (see ARCHITECTURE §10).
    const hitR = coarsePointer() ? 22 : 14;
    const handle = (id, which, x, y, col, label) =>
      `<g class="tc-handle-g"><circle class="tc-handle" cx="${f(x)}" cy="${f(y)}" r="6" style="stroke:${col}"/>` +
      `<circle class="tc-hit" data-id="${esc(id)}" data-handle="${which}" cx="${f(x)}" cy="${f(y)}" r="${hitR}"><title>${esc(label)}</title></circle></g>`;
    for (const o of this._ov.values()) {
      if (!o._drag || o.hidden || o.pane) continue;
      const col = colorOf(o.color);
      if (o.type === 'hline') {
        const y = S.y(o.price);
        if (!(y >= L.py0 - 2 && y <= L.py1 + 2)) continue;
        // The grip sits mid-line so it never covers the label pill at the line's right end.
        const xa = o.from != null ? clamp(S.x(o.from), L.x0, L.x1) : L.x0;
        const xb = o.to != null ? clamp(S.x(o.to), L.x0, L.x1) : L.x1;
        s += `<path class="tc-hit tc-hit-line" data-id="${esc(o.id)}" data-handle="line" d="M${f(xa)},${f(y)}H${f(xb)}"/>`;
        s += handle(o.id, 'line', (xa + xb) / 2, y, col, 'Drag to move the line');
      } else if (o.type === 'segment' || o.type === 'fib') {
        if (!o.a || !o.b) continue;
        s += handle(o.id, 'a', S.x(o.a.idx), S.y(o.a.price), col, 'Drag point A');
        s += handle(o.id, 'b', S.x(o.b.idx), S.y(o.b.price), col, 'Drag point B');
      } else if (o.type === 'zone') {
        const xa = o.x1 != null ? S.x(o.x1) : L.x0;
        const xb = o.x2 != null ? S.x(o.x2) : L.x1;
        const xm = (xa + xb) / 2;
        s += handle(o.id, 'to', xm, S.y(o.to), col, 'Drag the zone edge');
        s += handle(o.id, 'from', xm, S.y(o.from), col, 'Drag the zone edge');
      }
    }
    return s;
  }

  _dragStart(id, which, pt) {
    const o = this._ov.get(id);
    if (!o || !o._drag) return;
    this._drag = { id, which, start: pt };
    this._activeDrag = id;
    this.svg.style.touchAction = 'none';
    this.el.classList.add('is-dragging');
  }

  _dragMove(pt) {
    const D = this._drag;
    const o = this._ov.get(D.id);
    if (!o) return;
    const p = this._dataPoint(pt, o.snap || false);
    if (o.type === 'hline') o.price = p.price;
    else if (o.type === 'segment' || o.type === 'fib') o[D.which] = { idx: p.idx, price: p.price };
    else if (o.type === 'zone') o[D.which] = p.price;
    this._changed();
    this._callDrag(o, 'move', D.which);
  }

  _dragEnd() {
    const D = this._drag;
    this._drag = null;
    this.svg.style.touchAction = this._drawing ? 'none' : this._prevTouch || '';
    this.el.classList.remove('is-dragging');
    const o = D && this._ov.get(D.id);
    if (!o) return;
    if (o.type === 'zone' && o.from > o.to) [o.from, o.to] = [o.to, o.from];
    this._changed();
    this._callDrag(o, 'end', D.which);
  }

  _callDrag(o, phase, handle) {
    if (!o._drag) return;
    const { _drag, ...spec } = o;
    try {
      _drag(spec, { phase, handle });
    } catch (err) {
      console.error(err);
    }
  }
}
