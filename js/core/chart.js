// CandleChart — interactive SVG candlestick chart — plus miniChart() thumbnails and candleSVG().
// Standalone engine: imports only anim.js. No DOM access at import time.
// Styling lives in css/chart.css (.tc-* classes); colours come from design tokens.

import { reducedMotion, ease, now, raf, cancelRaf } from './anim.js';

const NS = 'http://www.w3.org/2000/svg';
const TOKENS = new Set([
  'accent', 'bull', 'bear', 'info', 'warn', 'support', 'resistance', 'ma1', 'ma2', 'ma3', 'fib', 'muted',
  'text', 'text-2', 'text-3', 'line', 'grid', 'surface', 'surface-2', 'focus', 'accent-soft', 'bull-soft', 'bear-soft',
]);
const DRAW_COLORS = { hline: 'accent', segment: 'info', fib: 'fib', zone: 'accent' };
const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const MONO_W = 6.6; // approx. advance of an 11px monospace glyph
const PILL_H = 16;
let UID = 0;

/** Token name ('bull', 'ma1', …) → var(--bull); anything else is used as a literal CSS colour. */
export function colorOf(c, fallback = 'accent') {
  const v = c == null || c === '' ? fallback : String(c);
  return TOKENS.has(v) ? `var(--${v})` : v;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const f = (v) => Math.round(v * 10) / 10;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const coarsePointer = () => {
  try {
    return !!globalThis.matchMedia?.('(pointer: coarse)').matches;
  } catch {
    return false;
  }
};
const crisp = (y, w = 1) => (Math.round(w) % 2 === 1 ? Math.round(y - 0.5) + 0.5 : Math.round(y));
const textW = (s, cw = MONO_W) => String(s).length * cw;

/** 1 / 2 / 5 × 10^n step at or above `raw`. */
export function niceStep(raw) {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const e = Math.floor(Math.log10(raw));
  const b = Math.pow(10, e);
  const m = raw / b;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * b;
}

/** Nice axis ticks inside [min, max] using at most ~maxTicks intervals. */
export function niceTicks(min, max, maxTicks = 6) {
  if (!(max > min)) return { step: 0, ticks: [] };
  const step = niceStep((max - min) / Math.max(1, maxTicks));
  const dec = clamp(-Math.floor(Math.log10(step)) + 1, 0, 12);
  const ticks = [];
  const first = Math.ceil(min / step - 1e-9);
  for (let k = first; k * step <= max + step * 1e-9; k++) ticks.push(+(k * step).toFixed(dec));
  return { step, ticks };
}

/**
 * Ticks for a logarithmic axis on [min, max] (min > 0): 1-2-5 (or denser / sparser) steps per
 * decade, at most ~maxTicks of them; ranges narrower than a decade fall back to niceTicks.
 */
export function logTicks(min, max, maxTicks = 6) {
  if (!(min > 0) || !(max > min)) return { step: 0, ticks: [] };
  if (max / min < 8) return niceTicks(min, max, maxTicks);
  const sets = [[1, 1.5, 2, 3, 5, 7], [1, 2, 5], [1, 3], [1]];
  const e0 = Math.floor(Math.log10(min));
  const e1 = Math.ceil(Math.log10(max));
  let best = null;
  for (const set of sets) {
    const ticks = [];
    for (let e = e0; e <= e1; e++) {
      for (const m of set) {
        const v = +(m * 10 ** e).toPrecision(6);
        if (v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9)) ticks.push(v);
      }
    }
    best = { step: 0, ticks };
    if (ticks.length <= maxTicks) break;
  }
  // Very long histories: keep every n-th decade.
  if (best.ticks.length > maxTicks) {
    const k = Math.ceil(best.ticks.length / maxTicks);
    best.ticks = best.ticks.filter((_, i) => i % k === 0);
  }
  return best;
}

/** Heikin-Ashi candles (averaged values — not traded prices). */
export function heikinAshiCandles(candles) {
  const out = new Array(candles.length);
  let po = 0;
  let pc = 0;
  for (let i = 0; i < candles.length; i++) {
    const k = candles[i];
    const c = (k.o + k.h + k.l + k.c) / 4;
    const o = i === 0 ? (k.o + k.c) / 2 : (po + pc) / 2;
    out[i] = { ...k, o, h: Math.max(k.h, o, c), l: Math.min(k.l, o, c), c };
    po = o;
    pc = c;
  }
  return out;
}

export const CHART_TYPES = ['candles', 'ohlc', 'line', 'heikin-ashi'];
const normType = (t) => (CHART_TYPES.includes(t) ? t : t === 'bars' ? 'ohlc' : t === 'ha' || t === 'heikin' ? 'heikin-ashi' : 'candles');

function spread(items, h, lo, hi) {
  items.sort((a, b) => a.y - b.y);
  for (let i = 0; i < items.length; i++) {
    const minY = i ? items[i - 1].py + h + 1 : lo + h / 2;
    items[i].py = Math.max(items[i].y, minY);
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const maxY = i < items.length - 1 ? items[i + 1].py - h - 1 : hi - h / 2;
    items[i].py = Math.min(items[i].py, maxY);
  }
  return items;
}

function paneDecimals(span) {
  return span < 0.05 ? 4 : span < 1 ? 3 : span < 20 ? 2 : 1;
}

// ---------------------------------------------------------------------------------------------
// Scene renderers (shared by CandleChart and miniChart). A scene S provides:
//   x(idx) y(price) x0 x1 y0 y1 slotW bw n candles fmt(p) mini pills?[]
//   optional: draw (candles to draw, e.g. Heikin-Ashi), type ('candles'|'ohlc'|'line'|
//   'heikin-ashi'), i0 / i1 (visible index range), focus ({ from, to }: dim the rest), gradId
// ---------------------------------------------------------------------------------------------

function candleGeometry(S, k, i) {
  const cx = S.x(i);
  const col = Math.round(cx - 0.5);
  const bw = S.bw;
  const wide = S.wickW === 2;
  const bx = wide ? Math.round(cx) - bw / 2 : col - (bw - 1) / 2;
  const wx = wide ? Math.round(cx) : col + 0.5;
  const top = Math.max(k.o, k.c);
  const bot = Math.min(k.o, k.c);
  const yTop = Math.round(S.y(top));
  const yBot = Math.round(S.y(bot));
  return { bx, wx, yTop, bh: Math.max(1, yBot - yTop), yH: S.y(k.h), yL: S.y(k.l) };
}

function barPath(S, k, i) {
  const g = candleGeometry(S, k, i);
  const tick = Math.max(2, Math.round(S.bw / 2));
  const yO = crisp(S.y(k.o), S.wickW || 1);
  const yC = crisp(S.y(k.c), S.wickW || 1);
  return `M${g.wx},${f(g.yH)}V${f(g.yL)}M${g.wx - tick},${yO}H${g.wx}M${g.wx},${yC}H${g.wx + tick}`;
}

/** Candles, OHLC bars or a close line for the visible range [S.i0, S.i1) (all by default). */
function renderCandles(S, skip = -1) {
  const list = S.draw || S.candles;
  const n = Math.min(S.n, list.length);
  const i0 = Math.max(0, S.i0 ?? 0);
  const i1 = Math.min(n, S.i1 ?? n);
  if (S.type === 'line') return renderLine(S, list, i0, i1);
  const bars = S.type === 'ohlc';
  const mk = () => ({ wb: '', wr: '', bb: '', br: '' });
  const inside = mk();
  const dim = mk();
  let dimmed = false;
  const F = S.focus;
  for (let i = i0; i < i1; i++) {
    if (i === skip) continue;
    const k = list[i];
    if (!k) continue;
    const out = F && (i < F.from || i > F.to);
    const B = out ? dim : inside;
    if (out) dimmed = true;
    const up = k.c >= k.o;
    if (bars) {
      if (up) B.wb += barPath(S, k, i);
      else B.wr += barPath(S, k, i);
      continue;
    }
    const g = candleGeometry(S, k, i);
    const w = `M${g.wx},${f(g.yH)}V${f(g.yL)}`;
    const b = `M${g.bx},${g.yTop}h${S.bw}v${g.bh}h${-S.bw}z`;
    if (up) {
      B.wb += w;
      B.bb += b;
    } else {
      B.wr += w;
      B.br += b;
    }
  }
  const ww = bars ? Math.max(1, S.wickW || 1) + (S.bw >= 5 ? 0.25 : 0) : S.wickW || 1;
  const cls = bars ? 'tc-bar' : 'tc-wick';
  const paths = (B) =>
    (B.wb ? `<path class="${cls} tc-bull" stroke-width="${ww}" d="${B.wb}"/>` : '') +
    (B.wr ? `<path class="${cls} tc-bear" stroke-width="${ww}" d="${B.wr}"/>` : '') +
    (B.bb ? `<path class="tc-body tc-bull" d="${B.bb}"/>` : '') +
    (B.br ? `<path class="tc-body tc-bear" d="${B.br}"/>` : '');
  return paths(inside) + (dimmed ? `<g class="tc-dimmed" style="opacity:${S.focusDim ?? 0.3}">${paths(dim)}</g>` : '');
}

/** Close line with a subtle area below it. */
function renderLine(S, list, i0, i1) {
  let d = '';
  let first = null;
  let last = null;
  for (let i = Math.max(0, i0); i < i1; i++) {
    const k = list[i];
    if (!k || !isNum(k.c)) continue;
    const x = f(S.x(i));
    const y = f(S.y(k.c));
    d += `${d ? 'L' : 'M'}${x},${y}`;
    if (first == null) first = x;
    last = x;
  }
  if (!d) return '';
  const base = f(S.areaBase ?? S.y1);
  const grad = S.gradId ? `url(#${S.gradId})` : 'var(--info)';
  return (
    `<path class="tc-area" d="${d}L${last},${base}L${first},${base}Z" style="fill:${grad}${S.gradId ? '' : ';fill-opacity:0.08'}"/>` +
    `<path class="tc-line" d="${d}"/>`
  );
}

function renderOneCandle(S, k, i, extraClass = '') {
  const g = candleGeometry(S, k, i);
  const cls = k.c >= k.o ? 'tc-bull' : 'tc-bear';
  if (S.type === 'ohlc') return `<path class="tc-bar ${cls} ${extraClass}" stroke-width="${S.wickW || 1}" d="${barPath(S, k, i)}"/>`;
  return (
    `<path class="tc-wick ${cls} ${extraClass}" stroke-width="${S.wickW || 1}" d="M${g.wx},${f(g.yH)}V${f(g.yL)}"/>` +
    `<path class="tc-body ${cls} ${extraClass}" d="M${g.bx},${g.yTop}h${S.bw}v${g.bh}h${-S.bw}z"/>`
  );
}

function strokeStyle(col, width, dashed, extra = '') {
  return `stroke:${col};stroke-width:${width}${dashed ? `;stroke-dasharray:${dashed === true ? '6 4' : dashed}` : ''}${extra}`;
}

function haloText(x, y, text, { col = 'var(--text)', cls = 'tc-label', anchor = 'start', size } = {}) {
  return `<text class="${cls}" x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" style="fill:${col}${size ? `;font-size:${size}px` : ''}">${esc(text)}</text>`;
}

function rHLine(o, S) {
  const y = S.y(o.price);
  if (!isNum(y) || y < S.y0 - 1 || y > S.y1 + 1) return '';
  const col = colorOf(o.color, 'accent');
  const xa = o.from != null ? S.x(o.from) : S.x0;
  const xb = o.to != null ? S.x(o.to) : S.x1;
  const w = o.width ?? 1.5;
  const yy = crisp(y, w);
  let s = `<path class="tc-hline" d="M${f(xa)},${yy}H${f(xb)}" style="${strokeStyle(col, w, o.dashed)}"/>`;
  if (S.pills) {
    if (S.axis && o.priceTag !== false) S.pills.push({ kind: 'axis', y, text: S.fmt(o.price), col });
    if (o.label) S.pills.push({ kind: 'inner', y, text: o.label, col, xr: xb });
  } else if (o.label) {
    s += haloText(xb - 3, y - 4, o.label, { col, anchor: 'end', size: S.mini ? 9 : 11 });
  }
  return s;
}

function segLine(S, a, b, extend) {
  let ax = S.x(a.idx);
  let ay = S.y(a.price);
  let bx = S.x(b.idx);
  let by = S.y(b.price);
  if (bx < ax) [ax, ay, bx, by] = [bx, by, ax, ay];
  if (extend && extend !== 'none' && bx !== ax) {
    const m = (by - ay) / (bx - ax);
    if (extend === 'right' || extend === 'both') {
      by = ay + m * (S.x1 - ax);
      bx = S.x1;
    }
    if (extend === 'left' || extend === 'both') {
      ay = ay + m * (S.x0 - ax);
      ax = S.x0;
    }
  }
  return { ax, ay, bx, by };
}

function rSegment(o, S) {
  if (!o.a || !o.b) return '';
  const col = colorOf(o.color, 'info');
  const { ax, ay, bx, by } = segLine(S, o.a, o.b, o.extend);
  if (![ax, ay, bx, by].every(isNum)) return '';
  let s = `<path class="tc-seg" d="M${f(ax)},${f(ay)}L${f(bx)},${f(by)}" style="${strokeStyle(col, o.width ?? 2, o.dashed)}"/>`;
  if (o.arrow) {
    const tx = S.x(o.b.idx);
    const ty = S.y(o.b.price);
    const ang = Math.atan2(ty - S.y(o.a.price), tx - S.x(o.a.idx));
    const L = 9;
    const p1 = [tx - L * Math.cos(ang - 0.45), ty - L * Math.sin(ang - 0.45)];
    const p2 = [tx - L * Math.cos(ang + 0.45), ty - L * Math.sin(ang + 0.45)];
    s += `<path class="tc-arrowhead" d="M${f(tx)},${f(ty)}L${f(p1[0])},${f(p1[1])}L${f(p2[0])},${f(p2[1])}z" style="fill:${col}"/>`;
  }
  if (o.label) {
    const mx = (S.x(o.a.idx) + S.x(o.b.idx)) / 2;
    const my = (S.y(o.a.price) + S.y(o.b.price)) / 2;
    s += labelPill(mx, my - 12, o.label, col, 'middle', S.mini);
  }
  return s;
}

function labelPill(x, y, text, col, anchor = 'middle', mini = false) {
  const fs = mini ? 9 : 11;
  const w = textW(text, fs * 0.58) + 10;
  const h = fs + 6;
  const rx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return (
    `<g class="tc-lpill"><rect x="${f(rx)}" y="${f(y - h / 2)}" width="${f(w)}" height="${h}" rx="3" style="stroke:${col}"/>` +
    `<text x="${f(rx + w / 2)}" y="${f(y + fs * 0.36)}" text-anchor="middle" style="fill:${col};font-size:${fs}px">${esc(text)}</text></g>`
  );
}

function rSeries(o, S) {
  const v = o.values || [];
  let d = '';
  let pen = false;
  const n = Math.min(S.n, v.length, S.i1 ?? Infinity);
  for (let i = Math.max(0, S.i0 ?? 0); i < n; i++) {
    const val = v[i];
    if (!isNum(val)) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${f(S.x(i))},${f(S.y(val))}`;
    pen = true;
  }
  if (!d) return '';
  const col = colorOf(o.color, 'ma1');
  return `<path class="tc-series" d="${d}" style="${strokeStyle(col, o.width ?? 1.75, o.dashed)}${o.opacity != null ? `;opacity:${o.opacity}` : ''}"/>`;
}

function rBand(o, S) {
  const up = o.upper || [];
  const lo = o.lower || [];
  const n = Math.min(S.n, up.length, lo.length, S.i1 ?? Infinity);
  const col = colorOf(o.color, 'info');
  let fill = '';
  let edges = '';
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      const top = run.map((i, j) => `${j ? 'L' : 'M'}${f(S.x(i))},${f(S.y(up[i]))}`).join('');
      const bot = run.slice().reverse().map((i) => `L${f(S.x(i))},${f(S.y(lo[i]))}`).join('');
      fill += `${top}${bot}Z`;
      if (o.edges !== false) {
        edges += top + run.map((i, j) => `${j ? 'L' : 'M'}${f(S.x(i))},${f(S.y(lo[i]))}`).join('');
      }
    }
    run = [];
  };
  for (let i = Math.max(0, S.i0 ?? 0); i < n; i++) {
    if (isNum(up[i]) && isNum(lo[i])) run.push(i);
    else flush();
  }
  flush();
  if (!fill) return '';
  return (
    `<path class="tc-band" d="${fill}" style="fill:${col};fill-opacity:${o.opacity ?? 0.12}"/>` +
    (edges ? `<path class="tc-band-edge" d="${edges}" style="stroke:${col}"/>` : '')
  );
}

function rZone(o, S) {
  if (!isNum(o.from) || !isNum(o.to)) return '';
  const col = colorOf(o.color, 'accent');
  const ya = S.y(o.from);
  const yb = S.y(o.to);
  const top = Math.min(ya, yb);
  const h = Math.max(1, Math.abs(ya - yb));
  const xa = o.x1 != null ? S.x(o.x1) : S.x0;
  const xb = o.x2 != null ? S.x(o.x2) : S.x1;
  let s =
    `<rect class="tc-zone" x="${f(xa)}" y="${f(top)}" width="${f(Math.max(1, xb - xa))}" height="${f(h)}" style="fill:${col};fill-opacity:${o.opacity ?? 0.14}"/>` +
    `<path class="tc-zone-edge" d="M${f(xa)},${crisp(top)}H${f(xb)}M${f(xa)},${crisp(top + h)}H${f(xb)}" style="stroke:${col}"/>`;
  if (o.label) {
    const fs = S.mini ? 9 : 11;
    const inside = h >= (S.mini ? 12 : 18);
    const tx = clamp(Math.max(xa, S.x0) + 6, S.x0 + 2, Math.max(S.x0 + 2, S.x1 - textW(o.label, fs * 0.6) - 4));
    s += haloText(tx, inside ? top + (S.mini ? 10 : 13) : top - 4, o.label, { col, size: fs });
  }
  return s;
}

function rBox(o, S) {
  if (!isNum(o.from) || !isNum(o.to)) return '';
  const col = colorOf(o.color, 'accent');
  const i0 = Math.min(o.from, o.to);
  const i1 = Math.max(o.from, o.to);
  const xa = S.x(i0) - S.slotW * 0.5;
  const xb = S.x(i1) + S.slotW * 0.5;
  let top;
  let bot;
  if (isNum(o.top) && isNum(o.bottom)) {
    top = Math.min(S.y(o.top), S.y(o.bottom));
    bot = Math.max(S.y(o.top), S.y(o.bottom));
  } else {
    let hi = -Infinity;
    let lo = Infinity;
    if (!o.full) {
      for (let i = Math.max(0, Math.ceil(i0)); i <= Math.min(i1, S.n - 1); i++) {
        const k = S.candles[i];
        if (!k) continue;
        hi = Math.max(hi, k.h);
        lo = Math.min(lo, k.l);
      }
    }
    if (hi > -Infinity) {
      const pad = S.mini ? 2 : 5;
      top = S.y(hi) - pad;
      bot = S.y(lo) + pad;
    } else {
      top = S.y0;
      bot = S.y1;
    }
  }
  let s = `<rect class="tc-box" x="${f(xa)}" y="${f(top)}" width="${f(Math.max(1, xb - xa))}" height="${f(Math.max(1, bot - top))}" rx="${S.mini ? 2 : 4}" style="fill:${col};stroke:${col}"/>`;
  if (o.label) {
    const fs = S.mini ? 9 : 11;
    const above = top - (S.mini ? 3 : 6) - fs > (S.labelTop ?? S.y0);
    const tx = clamp(xa + 2, S.x0 + 2, Math.max(S.x0 + 2, S.x1 - textW(o.label, fs * 0.6) - 4));
    s += haloText(tx, above ? top - (S.mini ? 3 : 6) : top + (S.mini ? 10 : 14), o.label, { col, size: fs });
  }
  return s;
}

function rMarker(o, S) {
  const i = o.idx;
  if (!isNum(i)) return '';
  const k = S.candles[Math.round(i)];
  const pos = o.position || 'above';
  const base = isNum(o.price) ? o.price : k ? (pos === 'above' ? k.h : pos === 'below' ? k.l : k.c) : null;
  if (!isNum(base)) return '';
  const col = colorOf(o.color, 'accent');
  const cx = S.x(i);
  const yb = S.y(base);
  const shape = o.shape || 'arrow';
  const sz = S.mini ? 0.7 : 1;
  let s = '';
  let tip;
  let textY;
  const gap = 5 * sz;
  if (shape === 'arrow') {
    if (pos === 'below') {
      tip = yb + gap;
      s += `<path class="tc-marker" d="M${f(cx)},${f(tip)}l${f(-5 * sz)},${f(9 * sz)}h${f(10 * sz)}z" style="fill:${col}"/>`;
      textY = tip + 9 * sz + 12;
    } else if (pos === 'at') {
      s += `<path class="tc-marker" d="M${f(cx + 3)},${f(yb)}l${f(9 * sz)},${f(-5 * sz)}v${f(10 * sz)}z" style="fill:${col}"/>`;
      textY = yb - 10;
    } else {
      tip = yb - gap;
      s += `<path class="tc-marker" d="M${f(cx)},${f(tip)}l${f(-5 * sz)},${f(-9 * sz)}h${f(10 * sz)}z" style="fill:${col}"/>`;
      textY = tip - 9 * sz - 4;
    }
  } else if (shape === 'dot') {
    const cy = pos === 'below' ? yb + gap + 4 : pos === 'at' ? yb : yb - gap - 4;
    s += `<circle class="tc-marker" cx="${f(cx)}" cy="${f(cy)}" r="${f(4 * sz)}" style="fill:${col}"/>`;
    textY = pos === 'below' ? cy + 16 : cy - 8;
  } else if (shape === 'ring') {
    const r = Math.max(7 * sz, Math.min(14, S.slotW * 0.9));
    s += `<circle class="tc-ring" cx="${f(cx)}" cy="${f(yb)}" r="${f(r)}" style="stroke:${col}"/>`;
    textY = pos === 'below' ? yb + r + 13 : yb - r - 5;
  } else if (shape === 'tag') {
    const text = o.text ?? '';
    const cy = pos === 'below' ? yb + gap + 11 : pos === 'at' ? yb : yb - gap - 11;
    s += labelPill(cx, cy, text, col, 'middle', S.mini);
    return s;
  }
  if (o.text) s += haloText(cx, textY, o.text, { col, anchor: 'middle', cls: 'tc-label tc-label--strong', size: S.mini ? 9 : 11 });
  return s;
}

function rPath(o, S) {
  const pts = (o.points || []).filter((p) => p && isNum(p.idx) && isNum(p.price));
  if (pts.length < 1) return '';
  const col = colorOf(o.color, 'info');
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${f(S.x(p.idx))},${f(S.y(p.price))}`).join('');
  let s = `<path class="tc-path" d="${d}" style="${strokeStyle(col, o.width ?? 2, o.dashed)}"/>`;
  const r = S.mini ? 2 : 3.5;
  if (o.dots !== false) {
    s += pts.map((p) => `<circle class="tc-dot" cx="${f(S.x(p.idx))}" cy="${f(S.y(p.price))}" r="${r}" style="stroke:${col}"/>`).join('');
  }
  if (o.labels && o.labels.length) {
    pts.forEach((p, i) => {
      const text = o.labels[i];
      if (!text) return;
      const prev = pts[i - 1];
      const next = pts[i + 1];
      const peak = (prev ? p.price >= prev.price : true) && (next ? p.price >= next.price : true) && (prev || next);
      const trough = (prev ? p.price <= prev.price : true) && (next ? p.price <= next.price : true);
      const above = peak ? true : trough ? false : /H$/.test(text);
      const y = S.y(p.price) + (above ? -(r + 6) : r + (S.mini ? 10 : 14));
      s += haloText(S.x(p.idx), y, text, { col, anchor: 'middle', cls: 'tc-label tc-label--strong', size: S.mini ? 8 : 11 });
    });
  }
  return s;
}

function fibLevelsOf(o) {
  const a = o.a;
  const b = o.b;
  const ratios = o.ratios || FIB_RATIOS;
  const lv = ratios.map((r) => ({ r, p: b.price - (b.price - a.price) * r, ext: false }));
  for (const r of o.extensions || []) lv.push({ r, p: a.price + (b.price - a.price) * r, ext: true });
  return lv;
}

function rFib(o, S) {
  if (!o.a || !o.b) return '';
  const col = colorOf(o.color, 'fib');
  const xa = S.x(Math.min(o.a.idx, o.b.idx));
  const xe = o.extend === false ? S.x(Math.max(o.a.idx, o.b.idx)) : S.x1;
  let s = '';
  if (o.zone && o.zone.length === 2) {
    const pa = o.b.price - (o.b.price - o.a.price) * o.zone[0];
    const pb = o.b.price - (o.b.price - o.a.price) * o.zone[1];
    const ya = S.y(pa);
    const yb = S.y(pb);
    s += `<rect class="tc-fib-zone" x="${f(xa)}" y="${f(Math.min(ya, yb))}" width="${f(Math.max(1, xe - xa))}" height="${f(Math.max(1, Math.abs(yb - ya)))}" style="fill:${col}"/>`;
  }
  s += `<path class="tc-fib-trend" d="M${f(S.x(o.a.idx))},${f(S.y(o.a.price))}L${f(S.x(o.b.idx))},${f(S.y(o.b.price))}" style="stroke:${col}"/>`;
  for (const lv of fibLevelsOf(o)) {
    const y = S.y(lv.p);
    if (!isNum(y)) continue;
    const key = lv.r === 0.5 || lv.r === 0.618;
    const w = key ? 1.5 : 1;
    s += `<path class="tc-fib-line${key ? ' is-key' : ''}" d="M${f(xa)},${crisp(y, w)}H${f(xe)}" style="${strokeStyle(col, w, lv.ext ? '5 4' : false)}"/>`;
    if (o.labels !== false) {
      const narrow = S.x1 - S.x0 < 520;
      const text = narrow && o.labels !== 'full' ? `${+lv.r.toFixed(3)}` : `${+lv.r.toFixed(3)} · ${S.fmt(lv.p)}`;
      if (S.pills) {
        if (y >= S.y0 - 1 && y <= S.y1 + 1) S.pills.push({ kind: 'inner', y, text, col, xr: xe, group: 'fib' });
      } else if (!S.mini) s += haloText(xe - 3, y - 3, text, { col, anchor: 'end' });
    }
  }
  if (!S.mini) {
    const r = 3;
    s += `<circle class="tc-dot" cx="${f(S.x(o.a.idx))}" cy="${f(S.y(o.a.price))}" r="${r}" style="stroke:${col}"/>`;
    s += `<circle class="tc-dot" cx="${f(S.x(o.b.idx))}" cy="${f(S.y(o.b.price))}" r="${r}" style="stroke:${col}"/>`;
  }
  return s;
}

function rText(o, S) {
  if (!isNum(o.idx) || !isNum(o.price) || o.text == null) return '';
  return haloText(S.x(o.idx), S.y(o.price), o.text, {
    col: colorOf(o.color, 'text'),
    anchor: o.anchor || 'start',
    cls: `tc-label${o.bold === false ? '' : ' tc-label--strong'}`,
    size: o.size || (S.mini ? 9 : null),
  });
}

const RENDER = { hline: rHLine, segment: rSegment, series: rSeries, band: rBand, zone: rZone, box: rBox, marker: rMarker, path: rPath, fib: rFib, text: rText };
const LAYER_OF = { zone: 'back', band: 'back', box: 'back', series: 'series', hline: 'lines', segment: 'lines', fib: 'lines', path: 'lines', marker: 'marks', text: 'marks' };

function overlayPrices(o) {
  switch (o.type) {
    case 'hline':
      return [o.price];
    case 'zone':
      return [o.from, o.to];
    case 'segment':
      return [o.a?.price, o.b?.price];
    case 'path':
      return (o.points || []).map((p) => p.price);
    case 'fib':
      return o.a && o.b ? fibLevelsOf(o).map((l) => l.p) : [];
    case 'marker':
    case 'text':
      return [o.price];
    case 'box':
      return [o.top, o.bottom];
    default:
      return [];
  }
}

const PULSE_MS = 1300;
/** Wrap an overlay's markup for className / a one-off pulse (spec.pulse: true | timestamp). */
function wrapOverlay(o, html) {
  if (!html || (!o.pulse && !o.className)) return html;
  const age = o.pulse ? now() - (o._pulseAt ?? 0) : Infinity;
  const pulsing = age >= 0 && age < PULSE_MS && !reducedMotion();
  if (!pulsing && !o.className) return html;
  const cls = `tc-ov${o.className ? ` ${esc(o.className)}` : ''}${pulsing ? ' tc-pulse' : ''}`;
  return `<g class="${cls}"${pulsing ? ` style="animation-delay:${-Math.round(age)}ms"` : ''}>${html}</g>`;
}

function normalizeOverlay(type, spec) {
  const o = { ...spec, type };
  if (o.pulse === true) o._pulseAt = now();
  else if (isNum(o.pulse)) o._pulseAt = o.pulse;
  if (type === 'fib') {
    o.ratios = o.ratios || FIB_RATIOS.slice();
    o.extensions = o.extensions || [];
    if (!('zone' in o)) o.zone = null;
  }
  return o;
}

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
    this._cid = `tc${++UID}`;
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
    const wickW = slotW >= 18 ? 2 : 1;
    let bw = Math.max(1, Math.round(slotW * 0.65));
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

// ---------------------------------------------------------------------------------------------
// miniChart — static, axis-less thumbnail
// ---------------------------------------------------------------------------------------------

/**
 * miniChart(candles, { width = 160, height = 90, overlays = [], highlight = null, padding = 6, ariaLabel,
 *                      yPad = 0.06, chartType = 'candles'|'ohlc'|'line'|'heikin-ashi' })
 * overlays: specs with a `type` ('hline'|'segment'|'series'|'band'|'zone'|'box'|'marker'|'path'|'fib'|'text').
 * highlight: idx, [from, to] or { from, to } — tinted background behind those candles.
 */
export function miniChart(candles = [], { width = 160, height = 90, overlays = [], highlight = null, padding = 6, ariaLabel = 'Chart thumbnail', yPad = 0.06, chartType = 'candles' } = {}) {
  const n = candles.length;
  const type = normType(chartType);
  const draw = type === 'heikin-ashi' ? heikinAshiCandles(candles) : null;
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
  const x0 = padding;
  const x1 = width - padding;
  const y0 = padding;
  const y1 = height - padding;
  const slotW = (x1 - x0) / Math.max(1, n);
  let bw = Math.max(1, Math.round(slotW * 0.65));
  if (bw % 2 === 0 && bw > 1) bw -= 1;
  const S = {
    x: (i) => x0 + (i + 0.5) * slotW,
    y: (p) => y0 + ((dom[1] - p) / (dom[1] - dom[0])) * (y1 - y0),
    x0,
    x1,
    y0,
    y1,
    slotW,
    bw,
    wickW: 1,
    n,
    candles,
    fmt: (p) => (isNum(p) ? p.toFixed(2) : ''),
    mini: true,
    axis: false,
    pills: null,
    type,
    draw,
    gradId: type === 'line' ? `tcm${++UID}-area` : null,
  };
  let back = type === 'line' ? `<defs><linearGradient id="${S.gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="tc-area-stop0"/><stop offset="1" class="tc-area-stop1"/></linearGradient></defs>` : '';
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
  const layers = { back: '', series: '', lines: '', marks: '' };
  for (const o of overlays) {
    const fn = RENDER[o.type];
    if (!fn) continue;
    layers[LAYER_OF[o.type]] += fn(normalizeOverlay(o.type, o), S);
  }
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'tc-mini');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', ariaLabel);
  svg.innerHTML = back + layers.back + renderCandles(S) + layers.series + layers.lines + layers.marks;
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
    const bw = Math.max(6, Math.round(width * 0.5));
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
