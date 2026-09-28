// miniChart() thumbnails and candleSVG() single-candle diagrams. Static SVG, no interaction.
// Part of the engine; import from js/core/chart.js, the public facade.

import {
  crisp,
  esc,
  f,
  heikinAshiCandles,
  isNum,
  nextUid,
  niceTicks,
  normType,
  NS,
  PILL_H,
  spread,
  textW,
} from './util.js';
import { LAYER_OF, normalizeOverlay, overlayPrices, RENDER, renderCandles } from './scene.js';

// ---------------------------------------------------------------------------------------------
// miniChart — static, axis-less thumbnail
// ---------------------------------------------------------------------------------------------

/**
 * miniChart(candles, { width = 160, height = 90, overlays = [], highlight = null, padding = 6, ariaLabel,
 *                      yPad = 0.06, chartType = 'candles'|'ohlc'|'line'|'heikin-ashi',
 *                      showAxis = false, labels = false, decimals = 2 })
 * overlays: specs with a `type` ('hline'|'segment'|'series'|'band'|'zone'|'box'|'marker'|'path'|'fib'|'text').
 * highlight: idx, [from, to] or { from, to } — tinted background behind those candles.
 * showAxis / labels: right price ticks + last-close pill (answer-surface charts). Tiny thumbs stay compact by default.
 */
export function miniChart(candles = [], {
  width = 160, height = 90, overlays = [], highlight = null, padding = 6,
  ariaLabel = 'Chart thumbnail', yPad = 0.06, chartType = 'candles',
  showAxis = false, labels = false, decimals = 2,
} = {}) {
  const n = candles.length;
  const type = normType(chartType);
  const draw = type === 'heikin-ashi' ? heikinAshiCandles(candles) : null;
  const axisOn = !!(showAxis || labels);
  let lo = Infinity;
  let hi = -Infinity;
  for (const k of draw || candles) {
    if (k.l < lo) lo = k.l;
    if (k.h > hi) hi = k.h;
  }
  for (const o of overlays) {
    if (o.type === 'series' || o.type === 'band') continue;
    for (const v of overlayPrices(o)) {
      if (isNum(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  }
  if (!(hi >= lo)) {
    lo = 0;
    hi = 1;
  }
  const r = hi - lo || Math.abs(hi) * 0.01 || 1;
  const dom = [lo - r * yPad, hi + r * yPad];
  const pad = Math.max(2, padding);
  const sample = [dom[0], dom[1], candles[n - 1]?.c].filter(isNum).map((p) => p.toFixed(decimals));
  const axisW = axisOn ? Math.ceil(Math.max(28, ...sample.map((s) => textW(s))) + 14) : 0;
  const x0 = pad;
  const x1 = width - pad - axisW;
  const y0 = pad + (axisOn ? 2 : 0);
  const y1 = height - pad - (axisOn ? 2 : 0);
  const slotW = (Math.max(1, x1 - x0)) / Math.max(1, n);
  const wickW = slotW >= 12 ? 2 : 1;
  let bw = Math.max(1, Math.round(slotW * (slotW >= 6 ? 0.7 : 0.65)));
  if (wickW === 1 && bw % 2 === 0) bw = Math.max(1, bw - 1);
  if (wickW === 2 && bw % 2 === 1) bw = Math.max(2, bw - 1);
  const fmt = (p) => (isNum(p) ? p.toFixed(decimals) : '');
  const S = {
    x: (i) => x0 + (i + 0.5) * slotW,
    y: (p) => y0 + ((dom[1] - p) / (dom[1] - dom[0])) * (y1 - y0),
    x0,
    x1,
    y0,
    y1,
    slotW,
    bw,
    wickW,
    n,
    candles,
    fmt,
    mini: true,
    axis: axisOn,
    pills: axisOn ? [] : null,
    type,
    draw,
    gradId: type === 'line' ? `tcm${nextUid()}-area` : null,
  };
  let back = type === 'line'
    ? `<defs><linearGradient id="${S.gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="tc-area-stop0"/><stop offset="1" class="tc-area-stop1"/></linearGradient></defs>`
    : '';
  if (highlight != null) {
    let a;
    let b;
    if (Array.isArray(highlight)) [a, b] = highlight;
    else if (typeof highlight === 'object') ({ from: a, to: b } = highlight);
    else a = b = highlight;
    if (isNum(a) && isNum(b)) {
      const xa = S.x(Math.min(a, b)) - slotW * 0.5 - 1;
      const xb = S.x(Math.max(a, b)) + slotW * 0.5 + 1;
      back += `<rect class="tc-mini-hl" x="${f(xa)}" y="0" width="${f(xb - xa)}" height="${height}" rx="3"/>`;
    }
  }
  let axisSvg = '';
  if (axisOn) {
    const { ticks } = niceTicks(dom[0], dom[1], Math.max(3, Math.min(6, Math.floor((y1 - y0) / 28))));
    for (const t of ticks) {
      const y = crisp(S.y(t), 1);
      if (y < y0 - 1 || y > y1 + 1) continue;
      axisSvg += `<path class="tc-grid" d="M${f(x0)},${y}H${f(x1)}"/>`;
      axisSvg += `<text class="tc-axis-text" x="${f(x1 + 6)}" y="${f(y + 3.5)}">${esc(fmt(t))}</text>`;
    }
    if (axisW) axisSvg += `<path class="tc-axis-line" d="M${f(x1)},${f(y0)}V${f(y1)}"/>`;
  }
  const layers = { back: '', series: '', lines: '', marks: '' };
  for (const o of overlays) {
    const fn = RENDER[o.type];
    if (!fn) continue;
    layers[LAYER_OF[o.type]] += fn(normalizeOverlay(o.type, o), S);
  }
  let pillSvg = '';
  if (axisOn && n) {
    const last = (draw || candles)[n - 1];
    if (last && isNum(last.c)) {
      const y = S.y(last.c);
      const col = last.c >= last.o ? 'var(--bull)' : 'var(--bear)';
      const text = fmt(last.c);
      const w = textW(text) + 12;
      const ph = 16;
      pillSvg =
        `<g class="tc-pill"><rect x="${f(x1 + 1)}" y="${f(y - ph / 2)}" width="${f(w)}" height="${ph}" rx="3" style="fill:${col}"/>` +
        `<text x="${f(x1 + 1 + w / 2)}" y="${f(y + 4)}" text-anchor="middle">${esc(text)}</text></g>`;
    }
  }
  if (S.pills && S.pills.length) {
    const axisPills = spread(S.pills.filter((p) => p.kind === 'axis'), PILL_H, y0, y1);
    for (const p of axisPills) {
      const w = textW(p.text) + 12;
      pillSvg +=
        `<g class="tc-pill"><rect x="${f(x1 + 1)}" y="${f(p.py - PILL_H / 2)}" width="${f(w)}" height="${PILL_H}" rx="3" style="fill:${p.col}"/>` +
        `<text x="${f(x1 + 1 + w / 2)}" y="${f(p.py + 4)}" text-anchor="middle">${esc(p.text)}</text></g>`;
    }
    const inner = spread(S.pills.filter((p) => p.kind === 'inner'), PILL_H, y0, y1);
    for (const p of inner) {
      const w = textW(p.text, 6.4) + 12;
      const xr = Math.min(p.xr ?? x1, x1);
      pillSvg +=
        `<g class="tc-ipill"><rect x="${f(xr - w)}" y="${f(p.py - PILL_H / 2)}" width="${f(w)}" height="${PILL_H}" rx="3" style="stroke:${p.col}"/>` +
        `<text x="${f(xr - w / 2)}" y="${f(p.py + 4)}" text-anchor="middle" style="fill:${p.col}">${esc(p.text)}</text></g>`;
    }
  }
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', axisOn ? 'tc-mini tc-mini--axis' : 'tc-mini');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', ariaLabel);
  svg.innerHTML = back + axisSvg + layers.back + renderCandles(S) + layers.series + layers.lines + layers.marks + pillSvg;
  return svg;
}

// ---------------------------------------------------------------------------------------------
// candleSVG — one large candle, optionally with labelled parts
// ---------------------------------------------------------------------------------------------

/**
 * candleSVG({ o, h, l, c }, { width = 60, height = 140, min, max, labels = false, prices = false, decimals = 2 })
 * → SVGSVGElement. With labels, callouts name the High / Low, Open / Close, Body, Upper wick and
 * Lower wick (the SVG widens to make room). The returned element has .update(candle).
 */
export function candleSVG(candle, { width = 60, height = 140, min, max, labels = false, prices = false, decimals = 2, ariaLabel } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', `tc-candle-svg${labels ? ' has-labels' : ''}`);
  svg.setAttribute('role', 'img');
  const leftW = labels ? 92 : 0;
  const rightW = labels ? (prices ? 124 : 76) : 0;
  const W = width + leftW + rightW;
  svg.setAttribute('viewBox', `0 0 ${W} ${height}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', height);

  const draw = (k) => {
    const { o, h, l, c } = k;
    const lo = isNum(min) ? min : l - (h - l) * 0.08 || l - 1;
    const hi = isNum(max) ? max : h + (h - l) * 0.08 || h + 1;
    const pad = labels ? 10 : 4;
    const y = (p) => pad + ((hi - p) / (hi - lo || 1)) * (height - pad * 2);
    const cx = leftW + width / 2;
    const bw = Math.max(6, Math.round(width * (width >= 48 ? 0.55 : 0.5)));
    const bull = c >= o;
    const cls = bull ? 'tc-bull' : 'tc-bear';
    const yT = y(Math.max(o, c));
    const yB = y(Math.min(o, c));
    const bh = Math.max(2, yB - yT);
    let s =
      `<path class="tc-wick ${cls}" stroke-width="2" d="M${f(cx)},${f(y(h))}V${f(y(l))}"/>` +
      `<rect class="tc-body ${cls}" x="${f(cx - bw / 2)}" y="${f(yT)}" width="${bw}" height="${f(bh)}" rx="1.5"/>`;
    if (labels) {
      const fmt = (p) => (prices ? ` ${p.toFixed(decimals)}` : '');
      // Right: price points with leader lines
      const right = spread(
        [
          { y: y(h), text: `High${fmt(h)}` },
          { y: yT, text: `${bull ? 'Close' : 'Open'}${fmt(Math.max(o, c))}` },
          { y: yT + bh, text: `${bull ? 'Open' : 'Close'}${fmt(Math.min(o, c))}` },
          { y: y(l), text: `Low${fmt(l)}` },
        ],
        14,
        2,
        height - 2,
      );
      const xr = cx + bw / 2 + 6;
      const xt = cx + bw / 2 + 22;
      for (const p of right) {
        s += `<path class="tc-callout" d="M${f(xr)},${f(p.y)}L${f(xt - 4)},${f(p.py)}"/>`;
        s += `<text class="tc-callout-text" x="${f(xt)}" y="${f(p.py + 4)}">${esc(p.text)}</text>`;
      }
      // Left: brackets for the three parts
      const xb = cx - bw / 2 - 8;
      const parts = [
        { a: y(h), b: yT, text: 'Upper wick' },
        { a: yT, b: yT + bh, text: 'Body' },
        { a: yT + bh, b: y(l), text: 'Lower wick' },
      ];
      for (const p of parts) {
        if (p.b - p.a >= 3) s += `<path class="tc-bracket" d="M${f(xb + 4)},${f(p.a + 1)}H${f(xb)}V${f(p.b - 1)}H${f(xb + 4)}"/>`;
        else s += `<path class="tc-bracket" d="M${f(xb + 4)},${f((p.a + p.b) / 2)}H${f(xb)}"/>`;
      }
      const left = spread(parts.map((p) => ({ y: (p.a + p.b) / 2, text: p.text })), 14, 2, height - 2);
      for (const p of left) s += `<text class="tc-callout-text" x="${f(xb - 6)}" y="${f(p.py + 4)}" text-anchor="end">${esc(p.text)}</text>`;
    }
    svg.innerHTML = s;
    svg.setAttribute(
      'aria-label',
      ariaLabel || `${bull ? 'Bullish' : 'Bearish'} candle: open ${o.toFixed(decimals)}, high ${h.toFixed(decimals)}, low ${l.toFixed(decimals)}, close ${c.toFixed(decimals)}`,
    );
  };
  draw(candle);
  svg.update = (k) => draw(k);
  return svg;
}
