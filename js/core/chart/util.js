// Chart engine shared constants and pure helpers (tick maths, colour tokens, Heikin-Ashi…).
// Part of the CandleChart engine; import from js/core/chart.js, the public facade.

export const NS = 'http://www.w3.org/2000/svg';
export const TOKENS = new Set([
  'accent', 'bull', 'bear', 'info', 'warn', 'support', 'resistance', 'ma1', 'ma2', 'ma3', 'fib', 'muted',
  'text', 'text-2', 'text-3', 'line', 'grid', 'surface', 'surface-2', 'focus', 'accent-soft', 'bull-soft', 'bear-soft',
  'live-indicator', 'live-indicator-soft',
]);
export const DRAW_COLORS = { hline: 'accent', segment: 'info', fib: 'fib', zone: 'accent' };
export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const MONO_W = 6.6; // approx. advance of an 11px monospace glyph
export const PILL_H = 16;
let UID = 0;
/** Next id for per-chart SVG ids (clip paths, gradients). */
export const nextUid = () => ++UID;

/** Token name ('bull', 'ma1', …) → var(--bull); anything else is used as a literal CSS colour. */
export function colorOf(c, fallback = 'accent') {
  const v = c == null || c === '' ? fallback : String(c);
  return TOKENS.has(v) ? `var(--${v})` : v;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
export const f = (v) => Math.round(v * 10) / 10;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const coarsePointer = () => {
  try {
    return !!globalThis.matchMedia?.('(pointer: coarse)').matches;
  } catch {
    return false;
  }
};
export const crisp = (y, w = 1) => (Math.round(w) % 2 === 1 ? Math.round(y - 0.5) + 0.5 : Math.round(y));
export const textW = (s, cw = MONO_W) => String(s).length * cw;

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
export const normType = (t) => (CHART_TYPES.includes(t) ? t : t === 'bars' ? 'ohlc' : t === 'ha' || t === 'heikin' ? 'heikin-ashi' : 'candles');

export function spread(items, h, lo, hi) {
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

export function paneDecimals(span) {
  return span < 0.05 ? 4 : span < 1 ? 3 : span < 20 ? 2 : 1;
}
