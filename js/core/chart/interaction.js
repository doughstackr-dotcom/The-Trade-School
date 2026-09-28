// CandleChart interaction internals: crosshair, pointer (pan / pinch / wheel) and keyboard.
// Mixed into CandleChart.prototype by ./candle-chart.js; `this` is always a CandleChart.

import { clamp, crisp, f, PILL_H, textW } from './util.js';

export class ChartInteraction {
  // ---- internals: crosshair -----------------------------------------------------------------

  _areaAt(y, L) {
    if (y < L.priceBottom) return { pane: null };
    for (const p of L.panes) if (y >= p.top && y < p.bottom) return { pane: p };
    return null;
  }

  _placeCross(idx, y, L = this._layoutNow()) {
    const g = this._g;
    if (!this.o.crosshair) return;
    const x = crisp(L.xOf(idx));
    const area = this._areaAt(y, L);
    let d = `M${x},0V${L.H - L.timeH}`;
    if (area) d += `M${L.x0},${crisp(y)}H${f(L.x1)}`;
    g.crossLine.setAttribute('d', d);
    // price / value pill
    if (area && L.axis) {
      const pane = area.pane;
      const v = pane ? pane.dom[1] - ((y - pane.y0) / (pane.y1 - pane.y0)) * (pane.dom[1] - pane.dom[0]) : L.priceOf(y);
      const text = v.toFixed(pane ? pane.decimals : this.o.decimals);
      const r = g.crossY.firstChild;
      const tx = g.crossY.lastChild;
      r.setAttribute('x', f(L.x1 + 1));
      r.setAttribute('y', f(y - PILL_H / 2));
      r.setAttribute('width', f(L.axisW - 2));
      tx.setAttribute('x', f(L.x1 + 8));
      tx.setAttribute('y', f(y + 4));
      tx.textContent = text;
      g.crossY.style.display = '';
    } else g.crossY.style.display = 'none';
    if (L.axis) {
      const text = this._timeText(idx);
      const w = textW(text) + 12;
      const cx = clamp(x, L.x0 + w / 2, L.x1 - w / 2);
      const r = g.crossX.firstChild;
      const tx = g.crossX.lastChild;
      r.setAttribute('x', f(cx - w / 2));
      r.setAttribute('y', f(L.H - L.timeH + 3));
      r.setAttribute('width', f(w));
      tx.setAttribute('x', f(cx));
      tx.setAttribute('y', f(L.H - L.timeH + 15));
      tx.textContent = text;
      g.crossX.style.display = text ? '' : 'none';
      this._maskTimeLabels(text ? cx - w / 2 - 3 : null, cx + w / 2 + 3);
    } else g.crossX.style.display = 'none';
    g.cross.style.display = '';
  }

  /** Hide time-axis labels under the crosshair's time pill (so no characters peek out beside it). */
  _maskTimeLabels(from, to) {
    for (const t of this._g.axis.querySelectorAll('.tc-time-text')) {
      const x = +t.getAttribute('x');
      const hw = (+t.getAttribute('data-w') || 0) / 2;
      const hide = from != null && x + hw > from && x - hw < to;
      t.style.visibility = hide ? 'hidden' : '';
    }
  }

  _showCross(idx, y) {
    const L = this._layoutNow();
    this._cross = { idx, y };
    this._placeCross(idx, y, L);
    if (this.o.crosshair) this._renderLegend(idx, L);
  }

  _hideCross() {
    if (!this._cross) return;
    this._cross = null;
    this._g.cross.style.display = 'none';
    this._maskTimeLabels(null);
    this._renderLegend(this._layoutNow().last);
  }

  _eventPoint(e) {
    const r = this.svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _payload(pt) {
    const L = this._layoutNow();
    const exactIdx = L.idxOf(pt.x);
    const idx = clamp(Math.round(exactIdx), 0, Math.max(0, L.slots - 1));
    const area = this._areaAt(pt.y, L);
    let price;
    let pane = null;
    if (area && area.pane) {
      const P = area.pane;
      pane = P.spec.id;
      price = P.dom[1] - ((pt.y - P.y0) / (P.y1 - P.y0)) * (P.dom[1] - P.dom[0]);
    } else {
      price = L.priceOf(pt.y);
    }
    const candle = idx < L.n ? this.candles[idx] : null;
    return { idx, exactIdx, price, x: pt.x, y: pt.y, candle: candle || null, pane };
  }

  _hover(pt) {
    const P = this._payload(pt);
    if (this.o.crosshair) this._showCross(P.idx, pt.y);
    this._emit('hover', P);
  }

  // ---- internals: pointer -------------------------------------------------------------------

  _onDown(e) {
    if (!this._interactive || this._destroyed) return;
    if (e.button != null && e.button > 0) return;
    const pt = this._eventPoint(e);
    const touch = e.pointerType !== 'mouse';
    if (touch) this._touch.set(e.pointerId, pt);
    if (this._drawing) {
      this._capture(e);
      this._drawDown(pt);
      return;
    }
    const h = e.target && e.target.closest ? e.target.closest('[data-handle]') : null;
    if (h) {
      this._capture(e);
      this._dragStart(h.getAttribute('data-id'), h.getAttribute('data-handle'), pt);
      return;
    }
    if (this.o.pannable && touch && this._touch.size >= 2) {
      this._startPinch();
      return;
    }
    this._down = { x: pt.x, y: pt.y, id: e.pointerId, type: e.pointerType, vp: this.getViewport(), moved: false, scrub: false, hold: null };
    if (touch) {
      this._hover(pt);
      // Pannable charts: a touch held still for 300 ms scrubs the crosshair instead of panning.
      if (this.o.pannable) {
        const d = this._down;
        d.hold = setTimeout(() => {
          this._timers.delete(d.hold);
          if (this._down === d && !d.moved && !this._pan) d.scrub = true;
        }, 300);
        this._timers.add(d.hold);
      }
    }
  }

  _startPinch() {
    const ids = [...this._touch.keys()].slice(-2);
    const [p1, p2] = ids.map((id) => this._touch.get(id));
    const L = this._layoutNow();
    const mid = (p1.x + p2.x) / 2;
    this._endPan();
    if (this._down?.hold) clearTimeout(this._down.hold);
    this._down = null;
    this._pinch = { ids, d0: Math.max(24, Math.hypot(p1.x - p2.x, p1.y - p2.y)), anchor: L.idxOf(mid), vp: this.getViewport() };
    this._hideCross();
    this.el.classList.add('is-panning');
  }

  _movePinch() {
    const P = this._pinch;
    const [p1, p2] = P.ids.map((id) => this._touch.get(id));
    if (!p1 || !p2) return;
    const L = this._layoutNow();
    const scale = Math.max(24, Math.hypot(p1.x - p2.x, p1.y - p2.y)) / P.d0;
    const w = (P.vp.to - P.vp.from) / scale;
    const mid = (p1.x + p2.x) / 2;
    const sw = (L.x1 - L.x0) / w;
    const from = P.anchor + 0.5 - (mid - L.x0) / sw;
    this.setViewport(from, from + w);
  }

  _endPan() {
    if (!this._pan && !this._pinch) return;
    this._pan = null;
    this._pinch = null;
    this.el.classList.remove('is-panning');
  }

  _onWheel(e) {
    if (!this.o.pannable || !this._interactive || this._destroyed || this._drawing) return;
    const L = this._layoutNow();
    const pt = this._eventPoint(e);
    if (pt.x < L.x0 || pt.x > L.x1 || pt.y > L.priceBottom) return;
    let dx = e.deltaX || 0;
    let dy = e.deltaY || 0;
    if (e.deltaMode === 1) {
      dx *= 16;
      dy *= 16;
    } else if (e.deltaMode === 2) {
      dx *= 400;
      dy *= 400;
    }
    const zoomKey = e.ctrlKey || e.metaKey; // trackpad pinch arrives as ctrl + wheel
    if (!zoomKey && (Math.abs(dx) > Math.abs(dy) || e.shiftKey)) {
      const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      if (!delta) return;
      this.panBy(delta / L.slotW);
      e.preventDefault();
      return;
    }
    if ((!zoomKey && this.o.wheelZoom === 'ctrl') || this.o.wheelZoom === false || !dy) return;
    const factor = Math.exp(-dy * (zoomKey ? 0.01 : 0.0022));
    const v = this.getViewport();
    const w = v.to - v.from;
    const total = this._totalSlots();
    const minW = Math.min(total, Math.max(2, this.o.minBars || 10));
    const maxW = total + Math.max(2, total * 0.1);
    // At a limit the page scrolls instead of the chart.
    if ((factor < 1 && w >= maxW - 1e-6) || (factor > 1 && w <= minW + 1e-6)) return;
    this.zoomBy(factor, L.idxOf(pt.x) + 0.5);
    e.preventDefault();
    this._hover(pt);
  }

  _capture(e) {
    try {
      this.svg.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  _onMove(e) {
    if (!this._interactive || this._destroyed) return;
    const pt = this._eventPoint(e);
    const touch = e.pointerType !== 'mouse';
    if (touch && this._touch.has(e.pointerId)) this._touch.set(e.pointerId, pt);
    if (this._drag) {
      this._dragMove(pt);
      return;
    }
    if (this._drawing) {
      this._drawMove(pt);
      if (this.o.crosshair) this._showCross(this._payload(pt).idx, pt.y);
      return;
    }
    if (this._pinch) {
      this._movePinch();
      return;
    }
    const d = this._down;
    if (this.o.pannable && d && d.id === e.pointerId) {
      const dx = pt.x - d.x;
      const dy = pt.y - d.y;
      if (!this._pan && !d.scrub) {
        const start = touch ? Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) : (e.buttons & 1) === 1 && Math.abs(dx) > 4;
        if (start) {
          this._pan = { x: d.x, vp: d.vp, id: e.pointerId };
          d.moved = true;
          clearTimeout(d.hold);
          this._capture(e);
          this._hideCross();
          this.el.classList.add('is-panning');
        } else if (touch && Math.hypot(dx, dy) > 8) {
          d.moved = true;
          clearTimeout(d.hold);
        }
      }
      if (this._pan) {
        const L = this._layoutNow();
        const shift = -(pt.x - this._pan.x) / L.slotW;
        this.setViewport(this._pan.vp.from + shift, this._pan.vp.to + shift);
        return;
      }
    }
    this._hover(pt);
  }

  _onUp(e) {
    if (!this._interactive || this._destroyed) return;
    const pt = this._eventPoint(e);
    this._touch.delete(e.pointerId);
    if (this._drag) {
      this._dragEnd();
      return;
    }
    if (this._drawing) {
      this._drawUp(pt);
      return;
    }
    if (this._pinch) {
      if (this._touch.size < 2) this._endPan();
      this._down = null;
      return;
    }
    const d = this._down;
    this._down = null;
    if (d?.hold) clearTimeout(d.hold);
    if (this._pan) {
      this._endPan();
      return; // a pan is not a click
    }
    if (d && Math.hypot(pt.x - d.x, pt.y - d.y) < 10) this._emit('click', this._payload(pt));
  }

  _onLeave(e) {
    if (this._drag || this._pan || this._pinch || (this._drawing && this._drawing.pressed)) return;
    this._down = null;
    // Touch/pen: the pointer "leaves" as soon as the finger lifts. Keep the crosshair (and the
    // hovered candle in the legend) until the next interaction instead of flickering it away.
    if (e.pointerType !== 'mouse') return;
    this._hideCross();
    if (this._drawing) {
      this._drawing.hover = null;
      this._renderDraw();
    }
    this._emit('leave', { idx: null, price: null, x: null, y: null, candle: null, pane: null });
  }

  _onCancel(e) {
    if (e && e.pointerId != null) this._touch.delete(e.pointerId);
    if (this._down?.hold) clearTimeout(this._down.hold);
    this._down = null;
    this._endPan();
    if (this._drag) this._dragEnd();
    if (this._drawing) this._drawing.pressed = false;
    this._hideCross();
    this._emit('leave', { idx: null, price: null, x: null, y: null, candle: null, pane: null });
  }

  // ---- internals: keyboard ------------------------------------------------------------------

  _onKey(e) {
    if (!this._interactive || this._destroyed) return;
    if (e.target !== this.el) return;
    const L = this._layoutNow();
    const big = e.shiftKey ? 5 : 1;
    if (this._drawing) {
      const d = this._drawing;
      const cur = d.kb || { idx: Math.max(0, L.n - 1), price: L.n ? this.candles[L.n - 1].c : (L.dom[0] + L.dom[1]) / 2 };
      const pStep = ((L.dom[1] - L.dom[0]) / 60) * big;
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft':
          cur.idx = Math.max(0, Math.round(cur.idx) - big);
          break;
        case 'ArrowRight':
          cur.idx = Math.min(L.slots - 1, Math.round(cur.idx) + big);
          break;
        case 'ArrowUp':
          cur.price = Math.min(L.dom[1], cur.price + pStep);
          break;
        case 'ArrowDown':
          cur.price = Math.max(L.dom[0], cur.price - pStep);
          break;
        case 'Enter':
        case ' ':
          d.kb = cur;
          this._drawTapAt({ ...cur });
          e.preventDefault();
          return;
        case 'Escape':
          this.cancelDraw();
          e.preventDefault();
          return;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        d.kb = cur;
        if (d.a && d.stage === 'placedA') d.b = { ...cur };
        else if (d.kind === 'hline') d.a = { ...cur };
        else d.hover = { ...cur };
        this._renderDraw();
        if (this.o.crosshair) this._showCross(Math.round(cur.idx), this.priceToY(cur.price));
      }
      return;
    }
    let idx = this._kbIdx ?? (this._cross ? this._cross.idx : L.n - 1);
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':
        idx -= big;
        break;
      case 'ArrowRight':
        idx += big;
        break;
      case 'Home':
        idx = 0;
        break;
      case 'End':
        idx = L.n - 1;
        break;
      case 'ArrowUp':
      case 'ArrowDown': {
        const id = this._activeDrag;
        const ov = id && this._ov.get(id);
        if (!ov) {
          handled = false;
          break;
        }
        const step = ((L.dom[1] - L.dom[0]) / 100) * big * (e.key === 'ArrowUp' ? 1 : -1);
        if (ov.type === 'hline') ov.price += step;
        else if (ov.type === 'zone') {
          ov.from += step;
          ov.to += step;
        } else if (ov.type === 'segment' || ov.type === 'fib') {
          ov.a = { ...ov.a, price: ov.a.price + step };
          ov.b = { ...ov.b, price: ov.b.price + step };
        }
        this._changed();
        this._callDrag(ov, 'end', 'key');
        e.preventDefault();
        return;
      }
      case 'Enter': {
        if (this._kbIdx == null) return;
        const k = this.candles[this._kbIdx];
        this._emit('click', { idx: this._kbIdx, exactIdx: this._kbIdx, price: k ? k.c : null, x: this.idxToX(this._kbIdx), y: k ? this.priceToY(k.c) : null, candle: k || null, pane: null, keyboard: true });
        e.preventDefault();
        return;
      }
      case 'Escape':
        this._kbIdx = null;
        this._hideCross();
        return;
      case '+':
      case '=':
      case '-':
      case '_':
      case '0':
        if (!this.o.pannable) return;
        if (e.key === '0') this.resetViewport();
        else this.zoomBy(e.key === '+' || e.key === '=' ? 1.25 : 0.8, this._kbIdx != null ? this._kbIdx + 0.5 : undefined);
        e.preventDefault();
        return;
      default:
        handled = false;
    }
    if (!handled || L.n === 0) return;
    e.preventDefault();
    idx = clamp(idx, 0, L.n - 1);
    // Keep the keyboard cursor on screen when a viewport is set.
    if (this._vp && (idx < L.first || idx > L.last)) {
      const v = this.getViewport();
      const w = v.to - v.from;
      const from = idx < L.first ? idx - 1 : idx + 2 - w;
      this.setViewport(from, from + w);
    }
    this._kbIdx = idx;
    const k = this.candles[idx];
    const y = this.priceToY(k.c);
    if (this.o.crosshair) this._showCross(idx, y);
    this._emit('hover', { idx, exactIdx: idx, price: k.c, x: this.idxToX(idx), y, candle: k, pane: null, keyboard: true });
    const prev = this.candles[idx - 1];
    const chg = prev ? ((k.c - prev.c) / prev.c) * 100 : 0;
    const d = this.o.decimals;
    this._sr.textContent = `Candle ${idx + 1} of ${L.n}: open ${k.o.toFixed(d)}, high ${k.h.toFixed(d)}, low ${k.l.toFixed(d)}, close ${k.c.toFixed(d)}, ${k.c >= k.o ? 'up' : 'down'} candle${prev ? `, ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% on the previous close` : ''}.`;
  }
}
