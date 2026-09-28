// Chart engine scene renderers: candles / OHLC / line bodies and every overlay type, as SVG markup.
// Shared by CandleChart and miniChart. Part of the engine; import from js/core/chart.js.

import { reducedMotion, now } from '../anim.js';
import { clamp, colorOf, crisp, esc, f, FIB_RATIOS, isNum, textW } from './util.js';

// ---------------------------------------------------------------------------------------------
// Scene renderers (shared by CandleChart and miniChart). A scene S provides:
//   x(idx) y(price) x0 x1 y0 y1 slotW bw n candles fmt(p) mini pills?[]
//   optional: draw (candles to draw, e.g. Heikin-Ashi), type ('candles'|'ohlc'|'line'|
//   'heikin-ashi'), i0 / i1 (visible index range), focus ({ from, to }: dim the rest), gradId
// ---------------------------------------------------------------------------------------------

export function candleGeometry(S, k, i) {
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
  const range = Math.abs(k.h - k.l);
  const doji = Math.abs(k.c - k.o) <= Math.max(range * 0.04, 1e-9);
  // Doji stay 1px so the cross is readable; real bodies get at least 2px.
  const minBh = doji ? 1 : 2;
  return { bx, wx, yTop, bh: Math.max(minBh, yBot - yTop), yH: S.y(k.h), yL: S.y(k.l) };
}

export function barPath(S, k, i) {
  const g = candleGeometry(S, k, i);
  const tick = Math.max(2, Math.round(S.bw / 2));
  const yO = crisp(S.y(k.o), S.wickW || 1);
  const yC = crisp(S.y(k.c), S.wickW || 1);
  return `M${g.wx},${f(g.yH)}V${f(g.yL)}M${g.wx - tick},${yO}H${g.wx}M${g.wx},${yC}H${g.wx + tick}`;
}

/** Candles, OHLC bars or a close line for the visible range [S.i0, S.i1) (all by default). */
export function renderCandles(S, skip = -1) {
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
export function renderLine(S, list, i0, i1) {
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

export function renderOneCandle(S, k, i, extraClass = '') {
  const g = candleGeometry(S, k, i);
  const cls = k.c >= k.o ? 'tc-bull' : 'tc-bear';
  if (S.type === 'ohlc') return `<path class="tc-bar ${cls} ${extraClass}" stroke-width="${S.wickW || 1}" d="${barPath(S, k, i)}"/>`;
  return (
    `<path class="tc-wick ${cls} ${extraClass}" stroke-width="${S.wickW || 1}" d="M${g.wx},${f(g.yH)}V${f(g.yL)}"/>` +
    `<path class="tc-body ${cls} ${extraClass}" d="M${g.bx},${g.yTop}h${S.bw}v${g.bh}h${-S.bw}z"/>`
  );
}

export function strokeStyle(col, width, dashed, extra = '') {
  return `stroke:${col};stroke-width:${width}${dashed ? `;stroke-dasharray:${dashed === true ? '6 4' : dashed}` : ''}${extra}`;
}

export function haloText(x, y, text, { col = 'var(--text)', cls = 'tc-label', anchor = 'start', size } = {}) {
  return `<text class="${cls}" x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" style="fill:${col}${size ? `;font-size:${size}px` : ''}">${esc(text)}</text>`;
}

export function rHLine(o, S) {
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

export function segLine(S, a, b, extend) {
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

export function rSegment(o, S) {
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

export function labelPill(x, y, text, col, anchor = 'middle', mini = false) {
  const fs = mini ? 9 : 11;
  const w = textW(text, fs * 0.58) + 10;
  const h = fs + 6;
  const rx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return (
    `<g class="tc-lpill"><rect x="${f(rx)}" y="${f(y - h / 2)}" width="${f(w)}" height="${h}" rx="3" style="stroke:${col}"/>` +
    `<text x="${f(rx + w / 2)}" y="${f(y + fs * 0.36)}" text-anchor="middle" style="fill:${col};font-size:${fs}px">${esc(text)}</text></g>`
  );
}

export function rSeries(o, S) {
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

export function rBand(o, S) {
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

export function rZone(o, S) {
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

export function rBox(o, S) {
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

export function rMarker(o, S) {
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

export function rPath(o, S) {
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

export function fibLevelsOf(o) {
  const a = o.a;
  const b = o.b;
  const ratios = o.ratios || FIB_RATIOS;
  const lv = ratios.map((r) => ({ r, p: b.price - (b.price - a.price) * r, ext: false }));
  for (const r of o.extensions || []) lv.push({ r, p: a.price + (b.price - a.price) * r, ext: true });
  return lv;
}

export function rFib(o, S) {
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
      // Prefer percent-style labels on lesson figures (0.618 → 61.8%); keep 0/1 as 0% / 100%.
      const pct = `${+(lv.r * 100).toFixed(lv.r === 0 || lv.r === 1 ? 0 : 1)}%`;
      const text = o.labels === 'full' || !narrow
        ? `${pct} · ${S.fmt(lv.p)}`
        : (S.mini ? pct : `${+lv.r.toFixed(3)}`);
      if (S.pills) {
        if (y >= S.y0 - 1 && y <= S.y1 + 1) S.pills.push({ kind: 'inner', y, text, col, xr: xe, group: 'fib' });
      } else {
        // miniChart sets pills:null; still draw labels when requested (lesson figures use miniChart).
        s += haloText(xe - 3, y - 3, text, { col, anchor: 'end', size: S.mini ? 9 : null });
      }
    }
  }
  if (!S.mini) {
    const r = 3;
    s += `<circle class="tc-dot" cx="${f(S.x(o.a.idx))}" cy="${f(S.y(o.a.price))}" r="${r}" style="stroke:${col}"/>`;
    s += `<circle class="tc-dot" cx="${f(S.x(o.b.idx))}" cy="${f(S.y(o.b.price))}" r="${r}" style="stroke:${col}"/>`;
  }
  return s;
}

export function rText(o, S) {
  if (!isNum(o.idx) || !isNum(o.price) || o.text == null) return '';
  return haloText(S.x(o.idx), S.y(o.price), o.text, {
    col: colorOf(o.color, 'text'),
    anchor: o.anchor || 'start',
    cls: `tc-label${o.bold === false ? '' : ' tc-label--strong'}`,
    size: o.size || (S.mini ? 9 : null),
  });
}

export const RENDER = { hline: rHLine, segment: rSegment, series: rSeries, band: rBand, zone: rZone, box: rBox, marker: rMarker, path: rPath, fib: rFib, text: rText };
export const LAYER_OF = { zone: 'back', band: 'back', box: 'back', series: 'series', hline: 'lines', segment: 'lines', fib: 'lines', path: 'lines', marker: 'marks', text: 'marks' };

export function overlayPrices(o) {
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

export const PULSE_MS = 1300;
/** Wrap an overlay's markup for className / a one-off pulse (spec.pulse: true | timestamp). */
export function wrapOverlay(o, html) {
  if (!html || (!o.pulse && !o.className)) return html;
  const age = o.pulse ? now() - (o._pulseAt ?? 0) : Infinity;
  const pulsing = age >= 0 && age < PULSE_MS && !reducedMotion();
  if (!pulsing && !o.className) return html;
  const cls = `tc-ov${o.className ? ` ${esc(o.className)}` : ''}${pulsing ? ' tc-pulse' : ''}`;
  return `<g class="${cls}"${pulsing ? ` style="animation-delay:${-Math.round(age)}ms"` : ''}>${html}</g>`;
}

export function normalizeOverlay(type, spec) {
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
