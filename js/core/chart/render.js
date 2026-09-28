// CandleChart rendering internals: grid, axes, volume, panes, tags and legend.
// Mixed into CandleChart.prototype by ./candle-chart.js; `this` is always a CandleChart.

import { ease, now } from '../anim.js';
import { clamp, colorOf, crisp, esc, f, isNum, logTicks, niceTicks, PILL_H, spread, textW } from './util.js';
import {
  candleGeometry,
  LAYER_OF,
  RENDER,
  renderCandles,
  renderOneCandle,
  rSeries,
  wrapOverlay,
} from './scene.js';

export class ChartRender {
  // ---- internals: render --------------------------------------------------------------------

  _render() {
    if (this._destroyed) return;
    const t = now();
    const L = this._layoutNow(t);
    const g = this._g;
    const o = this.o;
    const svg = this.svg;
    svg.setAttribute('height', L.H);
    svg.style.height = `${L.H}px`;
    g.bg.setAttribute('width', L.W);
    g.bg.setAttribute('height', L.H);
    g.clip.setAttribute('x', 0);
    g.clip.setAttribute('y', 0);
    g.clip.setAttribute('width', f(L.x1));
    g.clip.setAttribute('height', f(L.priceBottom));

    const S = this._scene(L);

    // Grid + axes
    g.grid.innerHTML = o.showGrid !== false ? this._gridHTML(L) : '';
    g.axis.innerHTML = this._axisHTML(L);

    // Overlays by layer
    const buckets = { back: '', series: '', lines: '', marks: '' };
    for (const ov of this._ov.values()) {
      if (ov.pane || ov.hidden) continue;
      const fn = RENDER[ov.type];
      if (fn) buckets[LAYER_OF[ov.type]] += wrapOverlay(ov, fn(ov, S));
    }
    g.back.innerHTML = buckets.back;
    g.series.innerHTML = buckets.series;
    g.lines.innerHTML = buckets.lines;
    g.marks.innerHTML = buckets.marks;

    // Volume + candles (+ growing candle)
    g.vol.innerHTML = o.showVolume ? this._volumeHTML(L, S) : '';
    let grow = '';
    let skip = -1;
    if (this._grow && this._type === 'line') this._grow = null;
    if (this._grow) {
      const G = this._grow;
      const p = clamp((t - G.t0) / G.dur, 0, 1);
      const k = (S.draw || this.candles)[G.idx];
      if (!k || p >= 1 || G.idx >= L.n) this._grow = null;
      else {
        const e = ease.easeOutCubic(p);
        const c = k.o + (k.c - k.o) * e;
        const partial = { o: k.o, c, h: Math.max(k.o + (k.h - k.o) * e, Math.max(k.o, c)), l: Math.min(k.o + (k.l - k.o) * e, Math.min(k.o, c)) };
        grow = renderOneCandle(S, partial, G.idx, 'is-growing');
        skip = G.idx;
      }
    }
    g.candles.innerHTML = renderCandles(S, skip) + grow;

    // Panes
    g.panes.innerHTML = L.panes.map((p) => this._paneHTML(L, p)).join('');

    // Pills / tags
    g.tags.innerHTML = this._tagsHTML(L, S);

    // Legend + pane titles
    const li = this._cross ? this._cross.idx : L.last;
    this._renderLegend(li, L);

    // Handles and draw preview
    g.handles.innerHTML = this._handlesHTML(L, S);
    if (this._drawing) this._renderDraw();
    if (this._cross) this._placeCross(this._cross.idx, this._cross.y, L);

    if (this._domAnim || this._grow || this._vpAnim) this._schedule();
  }

  _priceTicks(L) {
    const max = Math.max(2, Math.floor((L.py1 - L.py0) / 34));
    return L.log ? logTicks(L.dom[0], L.dom[1], max) : niceTicks(L.dom[0], L.dom[1], max);
  }

  _gridHTML(L) {
    let d = '';
    const { ticks } = this._priceTicks(L);
    const S = this._scene(L);
    const yMax = this.o.showVolume ? L.volTop : L.priceBottom - 2;
    for (const v of ticks) {
      const y = S.y(v);
      if (y < 2 || y > yMax) continue;
      d += `M${L.x0 - 4},${crisp(y)}H${f(L.x1)}`;
    }
    for (const i of this._timeTicks(L)) {
      const x = crisp(S.x(i));
      d += `M${x},0V${L.H - L.timeH}`;
    }
    for (const pane of L.panes) {
      const PS = this._scene(L, pane);
      for (const v of this._paneTicks(pane)) {
        const y = PS.y(v);
        if (y < pane.top + 4 || y > pane.bottom - 2) continue;
        d += `M${L.x0 - 4},${crisp(y)}H${f(L.x1)}`;
      }
    }
    return d ? `<path class="tc-grid" d="${d}"/>` : '';
  }

  _paneTicks(pane) {
    const p = pane.spec;
    if (p.levels && p.levels.length) return p.levels.map((l) => l.value).filter(isNum);
    return niceTicks(pane.dom[0], pane.dom[1], Math.max(1, Math.floor((pane.y1 - pane.y0) / 28))).ticks;
  }

  _timeTicks(L) {
    // Keep labels apart: at least 70px, more for long custom labels.
    let longest = 0;
    for (const i of [0, Math.floor(L.slots / 2), L.slots - 1]) longest = Math.max(longest, textW(this._timeText(i)));
    const minGap = Math.max(70, longest + 18);
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
    let step = steps.find((s) => s * L.slotW >= minGap) || Math.ceil(minGap / L.slotW);
    const out = [];
    const last = Math.max(L.n, this.candles.length ? Math.min(L.slots, this.candles.length) : 0);
    const lim = Math.min(this._slots ? L.slots : last, Math.ceil(L.vt));
    for (let i = Math.max(0, Math.ceil(Math.floor(L.vf) / step) * step); i < lim; i += step) out.push(i);
    return out;
  }

  _timeText(i) {
    const k = this.candles[i];
    if (typeof this.o.timeLabel === 'function') {
      try {
        const s = this.o.timeLabel(i, k);
        return s == null ? '' : String(s);
      } catch {
        return '';
      }
    }
    return String(i);
  }

  _axisHTML(L) {
    if (!L.axis) return '';
    let s = `<path class="tc-axis-line" d="M${crisp(L.x1)},0V${L.H - L.timeH}M0,${crisp(L.H - L.timeH)}H${L.W}"/>`;
    for (const pane of L.panes) s += `<path class="tc-pane-div" d="M0,${crisp(pane.top)}H${L.W}"/>`;
    const S = this._scene(L);
    const { ticks } = this._priceTicks(L);
    const yMax = this.o.showVolume ? L.volTop : L.priceBottom - 6;
    for (const v of ticks) {
      const y = S.y(v);
      if (y < 8 || y > yMax) continue;
      s += `<text class="tc-axis-text" x="${f(L.x1 + 8)}" y="${f(y + 4)}">${this._fmtAxis(v)}</text>`;
    }
    for (const pane of L.panes) {
      const PS = this._scene(L, pane);
      for (const v of this._paneTicks(pane)) {
        const y = PS.y(v);
        if (y < pane.top + 8 || y > pane.bottom - 4) continue;
        s += `<text class="tc-axis-text" x="${f(L.x1 + 8)}" y="${f(y + 4)}">${PS.fmt(v)}</text>`;
      }
    }
    const ty = L.H - L.timeH + 15;
    for (const i of this._timeTicks(L)) {
      const text = this._timeText(i);
      if (!text) continue;
      const x = S.x(i);
      if (x - textW(text) / 2 < 2 || x + textW(text) / 2 > L.x1 - 2) continue;
      s += `<text class="tc-axis-text tc-time-text" x="${f(x)}" y="${ty}" text-anchor="middle" data-w="${f(textW(text))}">${esc(text)}</text>`;
    }
    return s;
  }

  /** Axis label: the chart's decimals (log axes over big ranges drop needless decimals). */
  _fmtAxis(v) {
    const d = this.o.decimals;
    if (this._L && this._L.log && v >= 1000) return v.toFixed(0);
    return v.toFixed(d);
  }

  _volumeHTML(L, S) {
    let maxV = 0;
    const j0 = L.i0;
    const j1 = Math.min(L.n, L.i1);
    for (let i = j0; i < j1; i++) maxV = Math.max(maxV, this.candles[i].v || 0);
    if (!(maxV > 0)) return '';
    const hMax = L.volBot - L.volTop;
    let up = '';
    let dn = '';
    let dimUp = '';
    let dimDn = '';
    const F = this._focus;
    for (let i = j0; i < j1; i++) {
      const k = this.candles[i];
      const h = Math.max(1, Math.round(((k.v || 0) / maxV) * hMax));
      const g = candleGeometry(S, k, i);
      const d = `M${g.bx},${Math.round(L.volBot) - h}h${L.bw}v${h}h${-L.bw}z`;
      const out = F && (i < F.from || i > F.to);
      if (k.c >= k.o) out ? (dimUp += d) : (up += d);
      else out ? (dimDn += d) : (dn += d);
    }
    const paths = (u, dd) => (u ? `<path class="tc-vol tc-bull" d="${u}"/>` : '') + (dd ? `<path class="tc-vol tc-bear" d="${dd}"/>` : '');
    return paths(up, dn) + (dimUp || dimDn ? `<g class="tc-dimmed" style="opacity:${this.o.focusDim ?? 0.3}">${paths(dimUp, dimDn)}</g>` : '');
  }

  _paneHTML(L, pane) {
    const p = pane.spec;
    const S = this._scene(L, pane);
    const cid = `${this._cid}-${esc(p.id)}`;
    let s = `<clipPath id="${cid}"><rect x="0" y="${pane.top + 1}" width="${f(L.x1)}" height="${pane.bottom - pane.top - 1}"/></clipPath>`;
    let body = '';
    for (const lv of p.levels || []) {
      if (!isNum(lv.value)) continue;
      const col = colorOf(lv.color, 'muted');
      body += `<path class="tc-level" d="M${L.x0},${crisp(S.y(lv.value))}H${f(L.x1)}" style="stroke:${col}"/>`;
    }
    if (p.histogram && p.histogram.values) {
      const hv = p.histogram.values;
      const y0 = S.y(0);
      let pos = '';
      let neg = '';
      for (let i = L.i0; i < Math.min(L.n, hv.length, L.i1); i++) {
        const v = hv[i];
        if (!isNum(v)) continue;
        const y = S.y(v);
        const x = Math.round(S.x(i) - L.bw / 2);
        const top = Math.round(Math.min(y, y0));
        const h = Math.max(1, Math.round(Math.abs(y - y0)));
        const d = `M${x},${top}h${L.bw}v${h}h${-L.bw}z`;
        if (v >= 0) pos += d;
        else neg += d;
      }
      body += `<path class="tc-zero" d="M${L.x0},${crisp(y0)}H${f(L.x1)}"/>`;
      if (pos) body += `<path class="tc-hist" d="${pos}" style="fill:${colorOf(p.histogram.pos, 'bull')}"/>`;
      if (neg) body += `<path class="tc-hist" d="${neg}" style="fill:${colorOf(p.histogram.neg, 'bear')}"/>`;
    }
    for (const sr of p.series || []) body += rSeries({ ...sr, color: sr.color || 'ma1', width: sr.width ?? 1.5 }, S);
    for (const ov of this._ov.values()) {
      if (ov.pane !== p.id || ov.hidden) continue;
      const fn = RENDER[ov.type];
      if (fn && ov.type !== 'fib' && ov.type !== 'band') body += wrapOverlay(ov, fn(ov, { ...S, pills: null }));
    }
    s += `<g clip-path="url(#${cid})">${body}</g>`;
    return s;
  }

  _tagsHTML(L, S) {
    const pills = S.pills || [];
    if (L.axis && this.o.showLast !== false && L.n > 0) {
      const k = this.candles[L.n - 1];
      const y = S.y(k.c);
      if (y >= L.py0 - 2 && y <= L.py1 + 2) {
        pills.push({ kind: 'axis', y, text: k.c.toFixed(this.o.decimals), col: k.c >= k.o ? 'var(--bull)' : 'var(--bear)', last: true });
      }
    }
    let s = '';
    const last = pills.find((p) => p.last);
    if (last) s += `<path class="tc-lastline" d="M${L.x0},${crisp(last.y)}H${f(L.x1)}" style="stroke:${last.col}"/>`;
    const axis = spread(pills.filter((p) => p.kind === 'axis'), PILL_H, 0, L.priceBottom);
    for (const p of axis) {
      const w = L.axisW - 2;
      s +=
        `<g class="tc-pill"><rect x="${f(L.x1 + 1)}" y="${f(p.py - PILL_H / 2)}" width="${f(w)}" height="${PILL_H}" rx="3" style="fill:${p.col}"/>` +
        `<text x="${f(L.x1 + 8)}" y="${f(p.py + 4)}">${esc(p.text)}</text></g>`;
    }
    const inner = spread(pills.filter((p) => p.kind === 'inner'), PILL_H, L.py0, L.py1);
    for (const p of inner) {
      const w = textW(p.text, 6.4) + 12;
      const xr = Math.min(p.xr ?? L.x1, L.x1) - 4;
      s +=
        `<g class="tc-ipill"><rect x="${f(xr - w)}" y="${f(p.py - PILL_H / 2)}" width="${f(w)}" height="${PILL_H}" rx="3" style="stroke:${p.col}"/>` +
        `<text x="${f(xr - w / 2)}" y="${f(p.py + 4)}" text-anchor="middle" style="fill:${p.col}">${esc(p.text)}</text></g>`;
    }
    return s;
  }

  _legendBottom() {
    if (this.o.legend === false) return 4;
    const named = [...this._ov.values()].some((o) => o.type === 'series' && o.label && !o.pane && !o.hidden);
    return (named ? 38 : 22) + (this._type === 'heikin-ashi' ? 16 : 0);
  }

  _renderLegend(idx, L = this._layoutNow()) {
    const g = this._g;
    if (this.o.legend === false || !this.candles.length) {
      g.legend.innerHTML = '';
    } else {
      const i = clamp(idx, 0, Math.max(0, Math.min(L.n, this.candles.length) - 1));
      const ha = this._type === 'heikin-ashi';
      const list = ha ? this._drawList() : this.candles;
      const k = L.n > 0 ? list[i] : null;
      if (!k) g.legend.innerHTML = '';
      else {
        const prev = list[i - 1];
        const ref = prev ? prev.c : k.o;
        const chg = ref ? ((k.c - ref) / ref) * 100 : 0;
        const cls = k.c >= k.o ? 'tc-up' : 'tc-down';
        const d = this.o.decimals;
        const fields = [['O', k.o], ['H', k.h], ['L', k.l], ['C', k.c]];
        const width = L.x1 - L.x0 - 12;
        let est = fields.reduce((s, [, v]) => s + textW(v.toFixed(d)) + (ha ? 40 : 20), 0);
        const chgText = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
        const showChg = est + textW(chgText) + 10 < width;
        if (showChg) est += textW(chgText) + 10;
        const shown = est > width ? fields.slice(1) : fields; // very narrow: drop the open
        let s = `<text class="tc-legend" x="${L.x0 + 6}" y="17">`;
        shown.forEach(([key, v], j) => {
          s += `<tspan class="tc-legend-k" dx="${j ? 9 : 0}">${ha ? `HA ${key}` : key}</tspan><tspan class="${cls}" dx="4">${v.toFixed(d)}</tspan>`;
        });
        if (showChg && !ha) s += `<tspan class="${cls}" dx="9">${chgText}</tspan>`;
        s += '</text>';
        const named = [...this._ov.values()].filter((o) => o.type === 'series' && o.label && !o.pane && !o.hidden);
        let y2 = 33;
        if (ha) {
          const narrow = L.x1 - L.x0 < 420;
          s += `<text class="tc-legend tc-legend-note" x="${L.x0 + 6}" y="33">${narrow ? 'Heikin-Ashi: averaged, not traded prices' : 'Heikin-Ashi candles: averaged values, not prices that traded'}</text>`;
          y2 = 49;
        }
        if (named.length) {
          s += `<text class="tc-legend tc-legend--series" x="${L.x0 + 6}" y="${y2}">`;
          named.forEach((o, j) => {
            const v = o.values?.[i];
            s += `<tspan dx="${j ? 10 : 0}" style="fill:${colorOf(o.color, 'ma1')}">${esc(o.label)}${isNum(v) ? ` ${v.toFixed(d)}` : ''}</tspan>`;
          });
          s += '</text>';
        }
        g.legend.innerHTML = s;
      }
    }
    // Pane titles with the value at idx.
    let pt = '';
    for (const pane of L.panes) {
      const p = pane.spec;
      const i = clamp(idx, 0, Math.max(0, L.n - 1));
      let s = `<text class="tc-pane-title" x="${L.x0 + 6}" y="${pane.top + 15}">${esc(p.title || '')}`;
      for (const sr of p.series || []) {
        const v = sr.values?.[i];
        if (isNum(v)) s += `<tspan dx="8" style="fill:${colorOf(sr.color, 'ma1')}">${v.toFixed(pane.decimals)}</tspan>`;
      }
      const hv = p.histogram?.values?.[i];
      if (isNum(hv)) s += `<tspan dx="8" style="fill:${colorOf(hv >= 0 ? p.histogram.pos : p.histogram.neg, hv >= 0 ? 'bull' : 'bear')}">${hv.toFixed(pane.decimals)}</tspan>`;
      pt += `${s}</text>`;
    }
    g.ptitles.innerHTML = pt;
  }
}
