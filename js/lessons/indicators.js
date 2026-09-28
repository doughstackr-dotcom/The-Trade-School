// Lesson: Indicators & divergence — "Momentum, volatility and divergence".
// RSI, MACD, Bollinger Bands, ATR and volume: what each one measures, how to read it, and how a
// divergence between price and momentum warns that a move is tiring. Every chart is generated and
// checked in code (generate-and-test); divergence examples come from the same validated generator
// as the Divergence Detective game (js/games/divergence-detective-scenarios.js).
import { LessonShell, storyStep, realExampleStep, checklistStep, figure, takeaway } from '../core/lesson-kit.js';
import { h, svg, icon, sfx, kbdHint } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { fromPath } from '../core/data.js';
import { rsi, macd, sma, bollinger, atr, closes, crosses } from '../core/indicators.js';
import { reducedMotion } from '../core/anim.js';
import { makeRng, hashString } from '../core/rng.js';
import { divergenceScenario, classifyPair, oscAtSwing, DIV_INFO } from '../games/divergence-detective-scenarios.js';

// ------------------------------------------------------------------ styles (scoped to .ind-l)

const CSS = `
.ind-l { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.ind-l > p, .ind-l > ul { max-width: 680px; margin: 0; }
.ind-l__panel { display: grid; gap: 12px; padding: 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.ind-l__eyebrow { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--accent-strong, var(--accent)); }
.ind-l__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.ind-l__label { font-size: 14px; font-weight: 600; color: var(--text-2); }
.ind-l__note { margin: 0; font-size: 14.5px; line-height: 1.5; color: var(--text-2); }
.ind-l__status { margin: 0; min-height: 1.5em; font-size: 15px; line-height: 1.5; color: var(--text); }
.ind-l .chart-frame { min-width: 0; }
.ind-fam { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ind-fam__card { display: grid; grid-template-columns: 64px 1fr; gap: 4px 12px; align-items: center; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); }
.ind-fam__card svg { grid-row: span 2; width: 64px; height: 44px; }
.ind-fam__card strong { font-size: 15px; color: var(--text); }
.ind-fam__card span { font-size: 13px; line-height: 1.4; color: var(--text-2); }
.ind-stack__chips { display: flex; flex-wrap: wrap; gap: 8px; }
.ind-chip { min-height: 40px; padding: 6px 12px; border: 1.5px solid var(--line); border-radius: 999px; background: var(--surface-2); color: var(--text-2); font: 600 14px/1.2 var(--font-body); }
.ind-chip[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
.ind-chip:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.ind-stack__bars { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.ind-stack__bar { display: grid; gap: 4px; font-size: 12.5px; color: var(--text-2); text-align: center; }
.ind-stack__meter { display: flex; flex-direction: column-reverse; gap: 3px; height: 54px; padding: 4px; border-radius: 6px; background: var(--surface-2); }
.ind-stack__meter i { display: block; height: 13px; border-radius: 3px; background: var(--info); }
.ind-stack__meter.is-over i { background: var(--warn); }
.ind-split { display: flex; height: 16px; border-radius: 999px; overflow: hidden; background: var(--surface-2); }
.ind-split__g { background: var(--bull); transition: width .25s; }
.ind-split__l { background: var(--bear); transition: width .25s; }
.ind-kv { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 14px; color: var(--text-2); }
.ind-kv b { font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text); font-weight: 600; }
.ind-kv .up { color: var(--bull-strong, var(--bull)); }
.ind-kv .down { color: var(--bear-strong, var(--bear)); }
.ind-seg { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 3px; border-radius: 9px; background: var(--surface-2); }
.ind-seg button { min-height: 40px; padding: 0 14px; border-radius: 7px; color: var(--text-2); font: 600 14px var(--font-body); }
.ind-seg button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: 0 0 0 1px var(--line); }
.ind-seg button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.ind-cheat { width: 100%; border-collapse: collapse; font-size: 14px; }
.ind-cheat th, .ind-cheat td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
.ind-cheat th { color: var(--text-3); font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.ind-cheat td:first-child { font-weight: 700; color: var(--text); white-space: nowrap; }
.ind-cheat .is-bull { color: var(--bull-strong, var(--bull)); }
.ind-cheat .is-bear { color: var(--bear-strong, var(--bear)); }
.ind-result { display: grid; gap: 4px; padding: 10px 12px; border-radius: var(--radius-sm); border-left: 4px solid var(--info); background: var(--surface-2); font-size: 15px; line-height: 1.5; }
.ind-result.is-bull { border-left-color: var(--bull); }
.ind-result.is-bear { border-left-color: var(--bear); }
.ind-result strong { color: var(--text); }
.ind-cta { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding: 16px; border: 1px solid var(--accent); border-radius: var(--radius); background: color-mix(in oklab, var(--surface), var(--accent-soft) 50%); }
.ind-cta p { margin: 0; flex: 1 1 260px; font-size: 15.5px; color: var(--text); }
.ind-mini4 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ind-mini4 figure { margin: 0; display: grid; gap: 6px; padding: 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); }
.ind-mini4 svg { width: 100%; height: auto; }
.ind-mini4 figcaption { font-size: 13px; line-height: 1.35; color: var(--text-2); }
.ind-mini4 figcaption strong { display: block; font-size: 14px; color: var(--text); }
@media (max-width: 519.98px) {
  .ind-fam { grid-template-columns: minmax(0, 1fr); }
  .ind-stack__bars { gap: 6px; }
  .ind-cheat { font-size: 13px; }
  .ind-cheat th, .ind-cheat td { padding: 6px; }
  .ind-cheat td:first-child { white-space: normal; }
}
`;

function injectStyle() {
  const el = document.createElement('style');
  el.dataset.module = 'lesson-indicators';
  el.textContent = CSS;
  document.head.append(el);
  return () => el.remove();
}

// ------------------------------------------------------------------ small helpers

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const P = (html) => h('p', { html });
const wrapStep = (el) => {
  const box = h('div', { class: 'ind-l' });
  el.append(box);
  return box;
};

/** Animation runner: one run at a time, every wait cancellable, timers cleared on stop. */
function runner() {
  let token = 0;
  const timers = new Set();
  const wait = (ms) => new Promise((resolve) => {
    if (reducedMotion() || ms <= 0) {
      resolve();
      return;
    }
    const t = setTimeout(() => {
      timers.delete(t);
      resolve();
    }, ms);
    timers.add(t);
  });
  return {
    run(fn) {
      const my = ++token;
      const alive = () => my === token;
      Promise.resolve(fn(alive, wait)).catch((err) => console.error(err));
    },
    stop() {
      token += 1;
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
}

/** Play / Replay button for an animation. */
function playButton(onClick, label = 'Replay') {
  return h('button', { type: 'button', class: 'btn btn--sm', 'data-action': 'replay', on: { click: () => { sfx.click(); onClick(); } } }, icon('restart', { size: 15 }), h('span', null, label));
}

function segmented(options, value, onPick, label) {
  const buttons = options.map((o) => h('button', {
    type: 'button', 'aria-pressed': String(o.value === value), 'data-value': String(o.value),
    on: { click: () => { buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === btnOf(o.value)))); onPick(o.value); } },
  }, o.label));
  const btnOf = (v) => buttons[options.findIndex((o) => o.value === v)];
  return h('div', { class: 'ind-seg', role: 'group', 'aria-label': label }, buttons);
}

/** Wilder average gain / loss (what RSI is built from). */
function wilderAverages(cl, p) {
  const n = cl.length;
  const avgG = new Array(n).fill(null);
  const avgL = new Array(n).fill(null);
  if (n <= p) return { avgG, avgL };
  let g = 0;
  let l = 0;
  for (let i = 1; i <= p; i++) {
    const d = cl[i] - cl[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  let ag = g / p;
  let al = l / p;
  avgG[p] = ag;
  avgL[p] = al;
  for (let i = p + 1; i < n; i++) {
    const d = cl[i] - cl[i - 1];
    ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p;
    al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
    avgG[i] = ag;
    avgL[i] = al;
  }
  return { avgG, avgL };
}

/** Generate-and-test: fn(rng) → value | null, retried with forked seeds, then a fixed fallback seed. */
function generate(label, fn, tries = 30) {
  const base = makeRng(hashString(`indicators:${label}`));
  for (let t = 0; t < tries; t++) {
    const v = fn(base.fork(`try-${t}`));
    if (v) return v;
  }
  for (let t = 0; t < 200; t++) {
    const v = fn(makeRng(hashString(`indicators:${label}:fallback:${t}`)));
    if (v) return v;
  }
  return null;
}

// ------------------------------------------------------------------ chart data (validated)

/** A lag demo: a decline, a clear low, a rally; the 10-SMA turns several candles after price. */
function lagData() {
  return generate('lag', (rng) => {
    const { candles, anchors } = fromPath([[0, 108], [0.45, 96], [1, 110]], { seed: rng.int(1, 2 ** 31 - 1), count: 48, noise: 0.25 });
    const m = sma(closes(candles), 10);
    const low = anchors[1].idx;
    let mMin = null;
    for (let i = 10; i < candles.length; i++) if (isNum(m[i]) && (mMin == null || m[i] < m[mMin])) mMin = i;
    if (mMin == null || mMin - low < 3 || mMin - low > 8) return null;
    return { candles, sma: m, low, mMin };
  });
}

/** RSI demo: a strong rally (RSI pinned above 70), a pullback that holds near 40–50, a top, a decline. */
function rsiData() {
  return generate('rsi', (rng) => {
    const { candles, anchors } = fromPath(
      [[0, 100], [0.08, 99], [0.34, 123], [0.44, 116.5], [0.58, 128], [0.66, 124], [0.72, 127], [1, 106]],
      { seed: rng.int(1, 2 ** 31 - 1), count: 100, noise: 0.32 },
    );
    const r = rsi(closes(candles), 14);
    let run = 0;
    let best = 0;
    for (let i = anchors[1].idx; i <= anchors[2].idx; i++) {
      run = r[i] > 70 ? run + 1 : 0;
      best = Math.max(best, run);
    }
    let pull = 100;
    for (let i = anchors[2].idx; i <= anchors[3].idx + 2; i++) if (isNum(r[i])) pull = Math.min(pull, r[i]);
    let late = 0;
    for (let i = anchors[6].idx + 3; i < candles.length; i++) late = Math.max(late, r[i]);
    if (best < 4 || pull < 38 || pull > 56 || late > 62) return null;
    return { candles, anchors };
  });
}

/** MACD demo: a decline, a base, a rally, with a histogram that shrinks, a signal cross, then a zero cross. */
function macdData() {
  return generate('macd', (rng) => {
    const { candles, anchors } = fromPath(
      [[0, 114], [0.42, 93], [0.5, 96], [0.56, 94], [1, 112]],
      { seed: rng.int(1, 2 ** 31 - 1), count: 92, noise: 0.28 },
    );
    const m = macd(closes(candles));
    const low = anchors[1].idx;
    const golden = crosses(m.macd, m.signal).find((c) => c.type === 'golden' && c.idx >= low - 2);
    if (!golden) return null;
    // Earlier golden crosses after the start of the decline would muddy the story.
    if (crosses(m.macd, m.signal).some((c) => c.idx > 36 && c.idx < golden.idx && c.type === 'golden')) return null;
    let zero = null;
    for (let i = golden.idx + 1; i < candles.length; i++) {
      if (isNum(m.macd[i]) && isNum(m.macd[i - 1]) && m.macd[i - 1] <= 0 && m.macd[i] > 0) {
        zero = i;
        break;
      }
    }
    if (zero == null || zero - golden.idx < 4 || zero > candles.length - 8) return null;
    // Histogram shrinking: negative and rising for ≥ 3 bars just before the cross.
    let shrink = null;
    for (let i = golden.idx - 1; i > golden.idx - 12; i--) {
      if (m.hist[i] < 0 && m.hist[i] > m.hist[i - 1]) shrink = i;
      else break;
    }
    if (shrink == null || golden.idx - shrink < 3) return null;
    // After the zero cross, no bearish signal cross for a while (a clean example).
    if (crosses(m.macd, m.signal).some((c) => c.type === 'death' && c.idx > golden.idx && c.idx < zero + 5)) return null;
    return { candles, m, golden: golden.idx, zero, shrink, low };
  });
}

/** Bollinger demo: quiet squeeze, breakout that walks the upper band on rising volume, a climax spike. */
function bbData() {
  return generate('bb', (rng) => {
    const { candles, anchors } = fromPath(
      [[0, 95.5], [0.2, 100], [0.46, 100.5], [0.64, 109.5], [0.8, 116], [0.85, 120.5], [1, 116.5]],
      { seed: rng.int(1, 2 ** 31 - 1), count: 100, noise: 0.3 },
    );
    const cl = closes(candles);
    const bb = bollinger(cl, 20, 2);
    const sqFrom = anchors[1].idx;
    const sqTo = anchors[2].idx;
    let minW = null;
    for (let i = 20; i < candles.length; i++) if (isNum(bb.width[i]) && (minW == null || bb.width[i] < bb.width[minW])) minW = i;
    if (minW == null || minW < sqFrom + 8 || minW > sqTo + 2) return null;
    let brk = null;
    for (let i = sqTo - 2; i < sqTo + 10; i++) if (candles[i].c > bb.upper[i]) { brk = i; break; }
    if (brk == null) return null;
    // Climax: the blow-off candle into the top, on outsized volume.
    const cx = anchors[5].idx;
    const k = candles[cx];
    const prev = candles[cx - 1];
    k.o = Math.min(k.o, prev.c);
    k.c = Math.max(k.c, k.h - (k.h - k.o) * 0.2);
    k.l = Math.min(k.l, k.o);
    const avgV = candles.slice(cx - 20, cx).reduce((s, c) => s + c.v, 0) / 20;
    k.v = Math.round(Math.max(k.v, avgV) * 3.1);
    const bb2 = bollinger(closes(candles), 20, 2);
    let walk = 0;
    for (let i = brk; i < cx; i++) if (candles[i].c > bb2.mid[i] + 0.55 * (bb2.upper[i] - bb2.mid[i])) walk++;
    if (walk < (cx - brk) * 0.55) return null;
    return { candles, bb: bb2, atr: atr(candles, 14), sqFrom, sqTo, minW, brk, cx };
  });
}

/** Divergence examples (validated in the game's generator). */
function divExample(kind, label, opts = {}) {
  return generate(`div:${kind}:${label}`, (rng) => {
    const sc = divergenceScenario(kind, { seed: rng.int(1, 2 ** 31 - 1), difficulty: 0.1, ...opts });
    if (!sc) return null;
    if (opts.check && !opts.check(sc)) return null;
    return sc;
  }, 12);
}

// ------------------------------------------------------------------ figures

function glyph(kind) {
  const s = (tag, attrs) => svg(tag, attrs);
  const base = { viewBox: '0 0 64 44', 'aria-hidden': 'true' };
  if (kind === 'trend') {
    return svg('svg', base,
      s('polyline', { points: '2,38 12,28 18,32 28,18 34,24 44,12 50,16 62,6', style: 'fill:none;stroke:var(--text-3);stroke-width:1.6' }),
      s('path', { d: 'M2,38 C18,34 30,24 62,10', style: 'fill:none;stroke:var(--ma1);stroke-width:2.4' }));
  }
  if (kind === 'momentum') {
    return svg('svg', base,
      s('line', { x1: 2, x2: 62, y1: 10, y2: 10, style: 'stroke:var(--bear);stroke-dasharray:3 3' }),
      s('line', { x1: 2, x2: 62, y1: 34, y2: 34, style: 'stroke:var(--bull);stroke-dasharray:3 3' }),
      s('path', { d: 'M2,30 C10,4 18,4 26,22 S42,42 50,20 S58,8 62,12', style: 'fill:none;stroke:var(--ma3);stroke-width:2.4' }));
  }
  if (kind === 'volatility') {
    return svg('svg', base,
      s('path', { d: 'M2,20 C20,19 30,19 38,16 S54,4 62,2', style: 'fill:none;stroke:var(--info);stroke-width:2' }),
      s('path', { d: 'M2,24 C20,25 30,25 38,28 S54,40 62,42', style: 'fill:none;stroke:var(--info);stroke-width:2' }),
      s('path', { d: 'M2,22 C24,22 36,22 62,22', style: 'fill:none;stroke:var(--ma2);stroke-width:1.4;stroke-dasharray:3 3' }));
  }
  const bars = [10, 14, 9, 16, 12, 30, 22, 38, 18, 14];
  return svg('svg', base, bars.map((v, i) => s('rect', { x: 2 + i * 6.2, y: 42 - v, width: 4.6, height: v, rx: 1, style: `fill:${i === 7 ? 'var(--warn)' : 'var(--muted)'}` })));
}

/** 2×2 cheat sheet of the four divergences: price swing on top, oscillator below. */
function fourMini() {
  const card = (kind) => {
    const info = DIV_INFO[kind];
    const lows = info.side === 'low';
    const col = info.bias > 0 ? 'var(--bull)' : 'var(--bear)';
    // price points (y grows downward)
    const pDir = (kind === 'bullish' || kind === 'hidden-bearish') ? 1 : -1; // + = second swing lower on screen? computed below
    const priceY = lows ? (kind === 'bullish' ? [30, 38] : [34, 26]) : (kind === 'bearish' ? [14, 6] : [8, 16]);
    const oscY = lows ? (kind === 'bullish' ? [86, 76] : [74, 86]) : (kind === 'bearish' ? [56, 66] : [66, 56]);
    void pDir;
    const pricePath = lows
      ? `M4,6 L20,${priceY[0]} L34,14 L50,${priceY[1]} L62,20`
      : `M4,36 L20,${priceY[0]} L34,28 L50,${priceY[1]} L62,24`;
    const oscPath = lows
      ? `M4,58 L20,${oscY[0]} L34,62 L50,${oscY[1]} L62,64`
      : `M4,84 L20,${oscY[0]} L34,82 L50,${oscY[1]} L62,80`;
    return h('figure', null,
      svg('svg', { viewBox: '0 0 66 94', role: 'img', 'aria-label': `${info.name}: price ${info.price.toLowerCase()}, oscillator ${info.osc.toLowerCase()}` },
        svg('rect', { x: 0.5, y: 0.5, width: 65, height: 44, rx: 4, style: 'fill:var(--surface-2);stroke:none' }),
        svg('rect', { x: 0.5, y: 49.5, width: 65, height: 44, rx: 4, style: 'fill:var(--surface-2);stroke:none' }),
        svg('path', { d: pricePath, style: 'fill:none;stroke:var(--text-2);stroke-width:1.6;stroke-linejoin:round' }),
        svg('path', { d: oscPath, style: 'fill:none;stroke:var(--ma3);stroke-width:1.6;stroke-linejoin:round' }),
        svg('line', { x1: 20, y1: priceY[0], x2: 50, y2: priceY[1], style: `stroke:${col};stroke-width:2.4;stroke-linecap:round` }),
        svg('line', { x1: 20, y1: oscY[0], x2: 50, y2: oscY[1], style: `stroke:${col};stroke-width:2.4;stroke-linecap:round` })),
      h('figcaption', null, h('strong', null, info.name), `Price ${info.price.toLowerCase()}, oscillator ${info.osc.toLowerCase()}.`));
  };
  return h('div', { class: 'ind-mini4' }, ['bullish', 'bearish', 'hidden-bullish', 'hidden-bearish'].map(card));
}

// ------------------------------------------------------------------ step renders

function stepFamilies(el) {
  const box = wrapStep(el);
  const fams = [
    ['trend', 'Trend', 'Which way is price going? Moving averages, MACD.'],
    ['momentum', 'Momentum', 'How hard is it pushing? RSI, Stochastic.'],
    ['volatility', 'Volatility', 'How big are the swings? Bollinger Bands, ATR.'],
    ['volume', 'Volume', 'How many took part? Volume bars, OBV.'],
  ];
  box.append(
    P('An <strong>indicator</strong> is a calculation on past prices (and sometimes volume) drawn on or under the chart. It does not know anything price does not: it re-expresses what already happened. That is why indicators <strong>lag</strong>. Price moves first, the indicator confirms later.'),
    figure(h('div', { class: 'ind-fam' }, fams.map(([k, t, d]) => h('div', { class: 'ind-fam__card' }, glyph(k), h('strong', null, t), h('span', null, d)))),
      'Four families answer four different questions. Most popular indicators belong to one of them.', { label: 'Figure 1' }),
  );
  // Lag demo
  const lag = lagData();
  const host = h('div', { class: 'chart-frame', 'data-keys': 'capture' });
  box.append(figure(host, 'Price makes its low first; the 10-candle average keeps falling and only turns several candles later. That delay is the price you pay for a smoother line.', { label: 'Figure 2' }));
  const chart = new CandleChart(host, { candles: lag.candles, height: 210, yPad: 0.16, legend: false, ariaLabel: 'Price with a 10-candle simple moving average that turns after price' });
  chart.addSeries({ values: lag.sma, color: 'ma1', width: 2, label: 'SMA 10' });
  chart.addMarker({ idx: lag.low, position: 'below', shape: 'arrow', text: 'Price turns', color: 'bull' });
  chart.addMarker({ idx: lag.mMin, price: lag.sma[lag.mMin], position: 'below', shape: 'dot', text: 'Average turns', color: 'ma1' });

  // Stack checker
  const TOOLS = [
    ['SMA 50', 'trend'], ['EMA 20', 'trend'], ['MACD', 'trend'], ['RSI', 'momentum'], ['Stochastic', 'momentum'],
    ['Bollinger Bands', 'volatility'], ['ATR', 'volatility'], ['Volume', 'volume'], ['OBV', 'volume'],
  ];
  const picked = new Set(['EMA 20', 'RSI', 'Stochastic']);
  const status = h('p', { class: 'ind-l__status', 'aria-live': 'polite' });
  const bars = h('div', { class: 'ind-stack__bars' });
  const chips = TOOLS.map(([name]) => h('button', {
    type: 'button', class: 'ind-chip', 'aria-pressed': String(picked.has(name)),
    on: { click: (e) => { if (picked.has(name)) picked.delete(name); else picked.add(name); e.currentTarget.setAttribute('aria-pressed', String(picked.has(name))); sfx.tick(); update(); } },
  }, name));
  function update() {
    const count = { trend: 0, momentum: 0, volatility: 0, volume: 0 };
    const byFam = { trend: [], momentum: [], volatility: [], volume: [] };
    for (const [name, fam] of TOOLS) if (picked.has(name)) { count[fam]++; byFam[fam].push(name); }
    bars.replaceChildren(...fams.map(([k, t]) => h('div', { class: 'ind-stack__bar' },
      h('div', { class: ['ind-stack__meter', count[k] > 1 && 'is-over'], 'aria-hidden': 'true' }, Array.from({ length: count[k] }, () => h('i'))),
      h('span', null, `${t} · ${count[k]}`))));
    const dup = Object.entries(byFam).find(([, list]) => list.length > 1);
    const covered = Object.values(count).filter((c) => c > 0).length;
    if (!picked.size) status.innerHTML = 'Pick the tools you would put on your chart.';
    else if (dup) status.innerHTML = `<strong>Doubled up:</strong> ${dup[1].join(' and ')} all measure ${dup[0]}. When they agree it is one opinion counted twice, not extra confirmation. Keep one.`;
    else if (picked.size > 4) status.innerHTML = '<strong>Crowded:</strong> every family is covered, but a busy chart hides price. Two or three tools you know well beat five you glance at.';
    else status.innerHTML = `<strong>Balanced:</strong> ${covered} ${covered === 1 ? 'family' : 'different families'}, each answering its own question. Price itself stays the main tool.`;
  }
  update();
  box.append(h('div', { class: 'ind-l__panel' },
    h('p', { class: 'ind-l__eyebrow' }, 'Try it: build a chart setup'),
    h('div', { class: 'ind-stack__chips', role: 'group', 'aria-label': 'Indicators' }, chips),
    bars, status));
  box.append(P('Rule of thumb: <strong>one tool per family</strong>. RSI and Stochastic both measure momentum, so when they agree you have learned nothing new. A trend tool plus a momentum tool plus volume tells you far more.'));
  return () => chart.destroy();
}

function stepRsi(el) {
  const box = wrapStep(el);
  const data = rsiData();
  box.append(
    P('<strong>RSI</strong> (Relative Strength Index, J. Welles Wilder, 1978) compares the size of recent up-moves with recent down-moves. Over the last 14 candles it takes the <em>average gain</em> and the <em>average loss</em> (smoothed, so older candles fade out gradually) and scales their ratio to a 0–100 line: RSI = 100 − 100 ÷ (1 + average gain ÷ average loss). It is an <strong>oscillator</strong>: a line that swings within a fixed range and measures momentum rather than price.'),
    P('Readings above <strong>70</strong> are called overbought and below <strong>30</strong> oversold. That does not mean “about to reverse”. In a strong uptrend RSI can stay above 70 for many candles, and pullbacks tend to hold around 40–50: the range shifts up (roughly 40–80). In downtrends it shifts down (roughly 20–60).'),
  );
  const host = h('div', { class: 'chart-frame', 'data-keys': 'capture' });
  const split = h('div', { class: 'ind-split', role: 'img' }, h('span', { class: 'ind-split__g' }), h('span', { class: 'ind-split__l' }));
  const kv = h('div', { class: 'ind-kv', 'aria-live': 'polite' });
  let period = 14;
  let ranges = false;
  let idx = data.candles.length - 1;
  let series = null;
  const cl = closes(data.candles);
  const compute = () => {
    series = { rsi: rsi(cl, period), ...wilderAverages(cl, period) };
  };
  compute();
  const chart = new CandleChart(host, { candles: data.candles, height: 240, yPad: 0.12, ariaLabel: 'Price with RSI below it. Hover or tap to read RSI.' });
  const paneSpec = () => ({
    id: 'rsi', title: `RSI ${period}`, height: 110, range: [0, 100],
    levels: [{ value: 70, color: 'bear' }, { value: 30, color: 'bull' }, ...(ranges ? [{ value: 80, color: 'muted' }, { value: 40, color: 'muted' }] : [])],
    series: [{ values: series.rsi, color: 'ma3', width: 1.8 }],
  });
  chart.addPane(paneSpec());
  let rangeText = [];
  const drawRanges = () => {
    rangeText.forEach((id) => chart.remove(id));
    rangeText = [];
    if (!ranges) return;
    const a = data.anchors;
    rangeText.push(chart.addText({ pane: 'rsi', idx: a[1].idx + 1, price: 87, text: 'Uptrend: RSI holds 40–80', color: 'bull', size: 11 }));
    rangeText.push(chart.addText({ pane: 'rsi', idx: a[6].idx + 3, price: 14, text: 'Downtrend: 20–60', color: 'bear', size: 11 }));
  };
  const read = () => {
    const r = series.rsi[idx];
    const g = series.avgG[idx];
    const l = series.avgL[idx];
    if (!isNum(r)) {
      kv.replaceChildren(h('span', null, `Candle ${idx + 1}: RSI ${period} needs ${period} candles of history first.`));
      split.firstChild.style.width = '50%';
      split.lastChild.style.width = '50%';
      return;
    }
    const zone = r >= 70 ? 'above 70 (overbought zone)' : r <= 30 ? 'below 30 (oversold zone)' : 'between 30 and 70';
    kv.replaceChildren(
      h('span', null, `Candle ${idx + 1} · RSI ${period} `, h('b', null, r.toFixed(1)), ` · ${zone}`),
      h('span', { class: 'up' }, 'Average gain ', h('b', null, g.toFixed(2))),
      h('span', { class: 'down' }, 'Average loss ', h('b', null, l.toFixed(2))));
    const share = g + l > 0 ? (g / (g + l)) * 100 : 50;
    split.firstChild.style.width = `${share}%`;
    split.lastChild.style.width = `${100 - share}%`;
    split.setAttribute('aria-label', `Gains are ${share.toFixed(0)} percent of the average move, which is the RSI value`);
  };
  const onPoint = (p) => {
    if (!p || !Number.isFinite(p.idx) || p.idx >= data.candles.length) return;
    idx = p.idx;
    read();
  };
  chart.on('hover', onPoint);
  chart.on('click', onPoint);
  read();
  const periodSeg = segmented([7, 14, 21].map((v) => ({ value: v, label: String(v) })), period, (v) => {
    period = v;
    compute();
    chart.updatePane('rsi', paneSpec());
    read();
  }, 'RSI period');
  const rangeBtn = h('button', {
    type: 'button', class: 'ind-chip', 'aria-pressed': 'false',
    on: { click: () => { ranges = !ranges; rangeBtn.setAttribute('aria-pressed', String(ranges)); chart.updatePane('rsi', paneSpec()); drawRanges(); sfx.tick(); } },
  }, 'Show trend ranges');
  box.append(h('div', { class: 'ind-l__panel' },
    h('p', { class: 'ind-l__eyebrow' }, 'Try it: read RSI'),
    host,
    h('div', { class: 'ind-l__row' }, h('span', { class: 'ind-l__label' }, 'Period'), periodSeg, rangeBtn),
    kv, split,
    h('p', { class: 'ind-l__note' }, 'Hover or tap a candle. The green share of the bar is the average gain as a share of the average move: that share, times 100, is the RSI. A shorter period (7) reacts faster and whips around; a longer one (21) is smoother and slower.')));
  return () => chart.destroy();
}

function stepMacd(el) {
  const box = wrapStep(el);
  const d = macdData();
  box.append(
    P('<strong>MACD</strong> (Moving Average Convergence Divergence, Gerald Appel) is built from two <strong>EMAs</strong> (exponential moving averages, which weight recent candles more). The <strong>MACD line</strong> is the 12-period EMA minus the 26-period EMA. The <strong>signal line</strong> is a 9-period EMA of the MACD line. The <strong>histogram</strong> is the gap between the two: MACD minus signal.'),
  );
  const host = h('div', { class: 'chart-frame', 'data-keys': 'capture' });
  const caption = h('p', { class: 'ind-l__status', 'aria-live': 'polite' });
  const chart = new CandleChart(host, { candles: d.candles, height: 230, yPad: 0.14, visible: 30, slots: d.candles.length, ariaLabel: 'Price with MACD below it' });
  chart.addPane({ id: 'macd', title: 'MACD 12 26 9', height: 120, histogram: { values: d.m.hist }, series: [{ values: d.m.macd, color: 'ma1', width: 1.6 }, { values: d.m.signal, color: 'ma2', width: 1.6 }] });
  const r = runner();
  const ids = [];
  const clear = () => {
    ids.splice(0).forEach((id) => chart.remove(id));
  };
  const play = () => r.run(async (alive, wait) => {
    clear();
    chart.setVisible(30);
    caption.textContent = 'A downtrend: the MACD line is below zero and below its signal line.';
    await wait(900);
    if (!alive()) return;
    await chart.reveal({ to: d.shrink + 1, interval: 55 });
    if (!alive()) return;
    ids.push(chart.addMarker({ pane: 'macd', idx: d.shrink, price: d.m.hist[d.shrink], position: 'below', shape: 'dot', text: 'Shrinking', color: 'warn', pulse: true }));
    caption.textContent = 'The histogram bars shrink toward zero: downside momentum is fading. The earliest clue, and the least reliable.';
    await wait(1400);
    if (!alive()) return;
    await chart.reveal({ to: d.golden + 1, interval: 70 });
    if (!alive()) return;
    ids.push(chart.addMarker({ pane: 'macd', idx: d.golden, price: d.m.macd[d.golden], position: 'at', shape: 'ring', text: 'Signal cross', color: 'bull', pulse: true }));
    ids.push(chart.addMarker({ idx: d.golden, position: 'below', shape: 'arrow', color: 'bull', pulse: true }));
    caption.textContent = 'Signal cross: the MACD line crosses above its signal line (the histogram flips positive). Momentum has turned up.';
    await wait(1600);
    if (!alive()) return;
    await chart.reveal({ to: d.zero + 1, interval: 70 });
    if (!alive()) return;
    ids.push(chart.addHLine({ pane: 'macd', price: 0, color: 'muted', dashed: true }));
    ids.push(chart.addMarker({ pane: 'macd', idx: d.zero, price: 0, position: 'at', shape: 'ring', text: 'Zero cross', color: 'info', pulse: true }));
    caption.textContent = 'Zero-line cross: the MACD line turns positive, meaning the 12 EMA is now above the 26 EMA. Slower, but a firmer sign the trend has changed.';
    await wait(1600);
    if (!alive()) return;
    await chart.reveal({ to: d.candles.length, interval: 45 });
    if (!alive()) return;
    caption.textContent = 'In this example price kept rising. In a sideways market the same crosses flip back and forth (whipsaw), so use them with trend and structure, not alone.';
  });
  box.append(h('div', { class: 'ind-l__panel' },
    h('div', { class: 'ind-l__row' }, h('p', { class: 'ind-l__eyebrow', style: 'margin-right:auto' }, 'Animation: a signal cross'), playButton(play)),
    host, caption));
  box.append(
    P('Three readings, from earliest to latest: the <strong>histogram shrinking</strong> (momentum slowing), the <strong>signal cross</strong> (momentum turning), and the <strong>zero-line cross</strong> (the two EMAs have crossed). Earlier signals come with more false alarms.'),
  );
  play();
  return () => {
    r.stop();
    chart.destroy();
  };
}

function stepBollinger(el) {
  const box = wrapStep(el);
  const d = bbData();
  box.append(
    P('<strong>Bollinger Bands</strong> (John Bollinger) draw a 20-period simple moving average with a band 2 <strong>standard deviations</strong> above and below it. Standard deviation measures how far closes spread from their average, so the bands widen when price swings hard and narrow when it goes quiet. <strong>ATR</strong> (Average True Range, Wilder) measures the same thing in price units: the average size of a candle, gaps included. Neither says which way price will go.'),
  );
  const host = h('div', { class: 'chart-frame', 'data-keys': 'capture' });
  const caption = h('p', { class: 'ind-l__status', 'aria-live': 'polite' });
  const readout = h('div', { class: 'ind-kv' });
  const chart = new CandleChart(host, { candles: d.candles, height: 260, yPad: 0.14, showVolume: true, visible: 24, slots: d.candles.length, ariaLabel: 'Price with Bollinger Bands, volume and ATR' });
  chart.addBand({ upper: d.bb.upper, lower: d.bb.lower, color: 'info', opacity: 0.1 });
  chart.addSeries({ values: d.bb.mid, color: 'ma2', width: 1.4, dashed: true, label: 'SMA 20' });
  chart.addPane({ id: 'atr', title: 'ATR 14', height: 80, series: [{ values: d.atr, color: 'ma1', width: 1.8 }] });
  const r = runner();
  const ids = [];
  const setRead = (i) => {
    const w = d.bb.width[i];
    const a = d.atr[i];
    readout.replaceChildren(
      h('span', null, 'Band width ', h('b', null, isNum(w) ? `${(w * 100).toFixed(1)}%` : '–')),
      h('span', null, 'ATR 14 ', h('b', null, isNum(a) ? a.toFixed(2) : '–')));
  };
  const play = () => r.run(async (alive, wait) => {
    ids.splice(0).forEach((id) => chart.remove(id));
    chart.setVisible(24);
    setRead(23);
    caption.textContent = 'Price drifts and then goes quiet. Watch the bands and ATR.';
    await wait(700);
    if (!alive()) return;
    await chart.reveal({ to: d.minW + 1, interval: 55, onStep: (i) => setRead(i) });
    if (!alive()) return;
    ids.push(chart.addBox({ from: d.sqFrom + 4, to: d.minW, color: 'info', label: 'Squeeze', pulse: true }));
    caption.textContent = 'The squeeze: the narrowest bands in the whole chart and a low ATR. Quiet markets tend not to stay quiet, but the squeeze does not tell you the direction.';
    await wait(1600);
    if (!alive()) return;
    await chart.reveal({ to: d.brk + 1, interval: 70, onStep: (i) => setRead(i) });
    if (!alive()) return;
    ids.push(chart.addMarker({ idx: d.brk, position: 'above', shape: 'arrow', text: 'Breakout', color: 'bull', pulse: true }));
    caption.textContent = 'Expansion: a close outside the upper band, the bands open up, ATR rises and volume expands. Volume confirms that many traders took part.';
    await wait(1500);
    if (!alive()) return;
    await chart.reveal({ to: d.cx + 1, interval: 60, onStep: (i) => setRead(i) });
    if (!alive()) return;
    ids.push(chart.addText({ idx: Math.round((d.brk + d.cx) / 2) - 4, price: d.bb.upper[Math.round((d.brk + d.cx) / 2)] * 1.012, text: 'Walking the band', color: 'info', anchor: 'middle' }));
    ids.push(chart.addMarker({ idx: d.cx, position: 'above', shape: 'dot', text: 'Climax volume', color: 'warn', pulse: true }));
    caption.textContent = 'In a trend price can walk along the upper band: strength, not an automatic sell. Then a huge candle on the biggest volume of the move: a possible climax, where the last buyers pile in.';
    await wait(1700);
    if (!alive()) return;
    await chart.reveal({ to: d.candles.length, interval: 60, onStep: (i) => setRead(i) });
    if (!alive()) return;
    caption.textContent = 'After the climax the rally stalls. In a sideways market, touches of the outer bands tend to drift back to the middle band (mean reversion); in a trend they often do not.';
  });
  box.append(h('div', { class: 'ind-l__panel' },
    h('div', { class: 'ind-l__row' }, h('p', { class: 'ind-l__eyebrow', style: 'margin-right:auto' }, 'Animation: squeeze to breakout'), playButton(play)),
    host, readout, caption));
  box.append(
    P('<strong>Volume</strong> is the number of shares, contracts or coins traded in each candle. Rising volume behind a breakout or a trend means broad participation; a breakout on thin volume is easier to reverse. A sudden volume spike after a long move can mark <strong>exhaustion</strong>: the move\'s final burst.'),
  );
  play();
  return () => {
    r.stop();
    chart.destroy();
  };
}

function stepFour(el) {
  const box = wrapStep(el);
  const KINDS = ['bullish', 'bearish', 'hidden-bullish', 'hidden-bearish'];
  const examples = Object.fromEntries(KINDS.map((k) => [k, divExample(k, 'four')]));
  box.append(
    P('<strong>Divergence</strong> is a disagreement between price and momentum. Compare two <strong>swing lows</strong> (troughs, where price turned up) or two <strong>swing highs</strong> (peaks) with the oscillator at the same candles. <strong>Regular</strong> divergence warns that a trend is tiring and may reverse. <strong>Hidden</strong> divergence appears inside a trend and favours continuation.'),
  );
  const host = h('div', { class: 'chart-frame', 'data-keys': 'capture' });
  const result = h('div', { class: 'ind-result', 'aria-live': 'polite' });
  let chart = null;
  let kind = 'bullish';
  const r = runner();
  const build = () => {
    r.stop();
    chart?.destroy();
    host.replaceChildren();
    const sc = examples[kind];
    chart = new CandleChart(host, { candles: sc.candles, height: 230, yPad: 0.16, visible: Math.max(10, sc.a.idx - 6), slots: sc.candles.length, ariaLabel: `${DIV_INFO[kind].name} example with RSI below` });
    chart.addPane({ id: 'rsi', title: 'RSI 14', height: 104, range: 'auto', decimals: 1, levels: [{ value: 70, color: 'bear' }, { value: 30, color: 'bull' }], series: [{ values: sc.rsi, color: 'ma3', width: 1.8 }] });
    return sc;
  };
  const play = () => {
    const sc = build();
    const info = DIV_INFO[kind];
    const col = info.bias > 0 ? 'bull' : 'bear';
    result.className = `ind-result ${info.bias > 0 ? 'is-bull' : 'is-bear'}`;
    result.replaceChildren(h('span', null, 'Watch the last two swing ', info.side === 'low' ? 'lows…' : 'highs…'));
    r.run(async (alive, wait) => {
      await chart.reveal({ to: sc.decisionIdx + 1, interval: 45 });
      if (!alive()) return;
      await wait(250);
      if (!alive()) return;
      chart.addSegment({ a: sc.a, b: sc.b, color: col, width: 2.6, label: info.price, pulse: true });
      chart.addMarker({ idx: sc.a.idx, price: sc.a.price, position: 'at', shape: 'ring', color: col });
      chart.addMarker({ idx: sc.b.idx, price: sc.b.price, position: 'at', shape: 'ring', color: col });
      await wait(700);
      if (!alive()) return;
      chart.addSegment({ pane: 'rsi', a: { idx: sc.a.oscIdx, price: sc.a.osc }, b: { idx: sc.b.oscIdx, price: sc.b.osc }, color: col, width: 2.6, label: info.osc, pulse: true });
      chart.addMarker({ pane: 'rsi', idx: sc.a.oscIdx, price: sc.a.osc, position: 'at', shape: 'dot', color: col });
      chart.addMarker({ pane: 'rsi', idx: sc.b.oscIdx, price: sc.b.osc, position: 'at', shape: 'dot', color: col });
      result.replaceChildren(h('strong', null, `${info.name}: `), `price ${info.price.toLowerCase()}, RSI ${info.osc.toLowerCase()}. ${info.meaning.charAt(0).toUpperCase()}${info.meaning.slice(1)}.`);
      await wait(900);
      if (!alive()) return;
      if (sc.structure) chart.addHLine({ price: sc.structure.price, from: sc.structure.idx, color: 'accent', dashed: true, label: 'Confirm', priceTag: false, pulse: true });
      await wait(700);
      if (!alive()) return;
      await chart.reveal({ to: sc.candles.length, interval: 55 });
      if (!alive()) return;
      result.append(h('span', null, ` Here price then closed through the Confirm line (the swing between the two ${info.side === 'low' ? 'lows' : 'highs'}) and ${info.bias > 0 ? 'rose' : 'fell'}. That close was the trigger; the divergence was the warning.`));
    });
  };
  const seg = segmented(KINDS.map((k) => ({ value: k, label: DIV_INFO[k].name.replace(' divergence', '') })), kind, (v) => {
    kind = v;
    play();
  }, 'Divergence type');
  box.append(h('div', { class: 'ind-l__panel' },
    h('div', { class: 'ind-l__row' }, h('p', { class: 'ind-l__eyebrow', style: 'margin-right:auto' }, 'Animation: the four divergences'), playButton(play)),
    seg, host, result));
  const row = (k) => {
    const info = DIV_INFO[k];
    return h('tr', null, h('td', null, info.name), h('td', null, info.price), h('td', null, info.osc),
      h('td', { class: info.bias > 0 ? 'is-bull' : 'is-bear' }, info.regular ? (info.bias > 0 ? 'Possible turn up' : 'Possible turn down') : (info.bias > 0 ? 'Uptrend continues' : 'Downtrend continues')));
  };
  box.append(figure(h('table', { class: 'ind-cheat' },
    h('thead', null, h('tr', null, h('th', null, 'Type'), h('th', null, 'Price'), h('th', null, 'RSI'), h('th', null, 'Suggests'))),
    h('tbody', null, KINDS.map(row))), 'Regular divergence fights the trend; hidden divergence sides with it.', { label: 'Table 1' }));
  box.append(P('Divergence is a <strong>warning, not a trigger</strong>. Momentum can fade for a long time while price keeps going. Wait for structure to break: for a bullish divergence, a close above the swing high between the two lows.'));
  play();
  return () => {
    r.stop();
    chart?.destroy();
  };
}

/** Story: one exact bullish divergence setup, frame by frame. */
function bullishStory() {
  const LEAD = 26;
  const pick = generate('story', (rng) => {
    const sc = divergenceScenario('bullish', { seed: rng.int(1, 2 ** 31 - 1), difficulty: 0.05, outcome: 'expected' });
    if (!sc || sc.a.osc > 30) return null;
    const candles = [...sc.lead.slice(-LEAD), ...sc.candles];
    const off = LEAD;
    // The story recomputes RSI on its own candles: make sure the read still holds there.
    const r = rsi(closes(candles), 14);
    const oa = oscAtSwing(r, { idx: sc.a.idx + off, type: 'low' });
    const ob = oscAtSwing(r, { idx: sc.b.idx + off, type: 'low' });
    if (!oa || !ob || ob.value - oa.value < 7 || oa.value > 32) return null;
    const D = sc.decisionIdx + off;
    const st = sc.structure;
    let entry = null;
    for (let i = D + 1; i < candles.length; i++) if (candles[i].c > st.price) { entry = i; break; }
    if (entry == null || entry > candles.length - 6) return null;
    const stop = sc.b.price - (st.price - sc.b.price) * 0.08;
    const e = candles[entry].c;
    const target = e + 2 * (e - stop);
    let hit = null;
    for (let i = entry + 1; i < candles.length; i++) {
      if (candles[i].l <= stop) break;
      if (candles[i].h >= target) { hit = i; break; }
    }
    if (hit == null) return null;
    return { sc, candles, off, oa, ob, D, entry, stop, target, hit };
  });
  const { sc, candles, off, oa, ob, D, entry, stop, target, hit } = pick;
  const A = { idx: sc.a.idx + off, price: sc.a.price };
  const B = { idx: sc.b.idx + off, price: sc.b.price };
  const S = { idx: sc.structure.idx + off, price: sc.structure.price };
  const e = candles[entry].c;
  return {
    candles,
    indicators: { rsi: true },
    frames: [
      {
        to: A.idx + 3, title: 'Context.',
        caption: 'A downtrend: lower highs, lower lows. The fast drop into this low pushes RSI deep below 30.',
        overlays: [
          { type: 'marker', idx: A.idx, price: A.price, position: 'at', shape: 'ring', color: 'bear' },
          { type: 'marker', pane: 'cs-rsi', idx: oa.idx, price: oa.value, position: 'at', shape: 'dot', color: 'bear' },
        ],
        focus: [Math.max(0, A.idx - 16), A.idx + 2],
      },
      {
        to: B.idx + 1, title: 'Trigger.',
        caption: 'Price makes a lower low, but RSI makes a higher low. Sellers pushed price down with less force.',
        overlays: [
          { type: 'segment', a: A, b: B, color: 'bull', width: 2.6, label: 'Lower low' },
          { type: 'marker', idx: B.idx, price: B.price, position: 'at', shape: 'ring', color: 'bull' },
          { type: 'segment', pane: 'cs-rsi', a: { idx: oa.idx, price: oa.value }, b: { idx: ob.idx, price: ob.value }, color: 'bull', width: 2.6, label: 'Higher low' },
        ],
      },
      {
        to: D + 1, title: 'Wait.',
        caption: 'Divergence is only a warning. Mark the swing high between the two lows: a close above it breaks the downtrend.',
        overlays: [{ type: 'hline', price: S.price, from: S.idx, color: 'accent', dashed: true, label: 'Confirm' }],
      },
      {
        to: entry + 1, title: 'Confirmation.',
        caption: 'A candle closes above the Confirm line: lower highs are over. That close is the entry signal.',
        overlays: [{ type: 'marker', idx: entry, position: 'below', shape: 'arrow', text: 'Entry', color: 'accent' }],
        focus: [B.idx - 2, entry],
      },
      {
        to: entry + 1, title: 'Plan.',
        caption: 'Stop just below the second low (where the idea is wrong). Target at 2R: twice the distance from entry to stop.',
        overlays: [
          { type: 'hline', price: stop, color: 'bear', label: 'Stop' },
          { type: 'hline', price: e, color: 'accent', dashed: true, label: 'Entry' },
          { type: 'hline', price: target, color: 'bull', label: 'Target 2R' },
        ],
      },
      {
        to: Math.min(candles.length, hit + 4), title: 'Outcome.',
        caption: 'Here price reached the 2R target. It will not always, which is why the stop is set before the entry.',
        overlays: [{ type: 'marker', idx: hit, position: 'above', shape: 'dot', text: 'Target hit', color: 'bull' }],
      },
    ],
  };
}

function stepFind(el) {
  const box = wrapStep(el);
  const ORDER = ['bullish', 'hidden-bearish', 'none', 'bearish', 'hidden-bullish'];
  let n = 0;
  let chart = null;
  let sc = null;
  let picks = [];
  const host = h('div', { class: 'chart-frame', 'data-keys': 'capture' });
  const status = h('div', { class: 'ind-result', 'aria-live': 'polite' });
  const ids = [];
  const setStatus = (html, tone = '') => {
    status.className = `ind-result${tone ? ` is-${tone}` : ''}`;
    status.innerHTML = html;
  };
  const clearPicks = () => {
    ids.splice(0).forEach((id) => chart?.remove(id));
    picks = [];
  };
  const load = () => {
    chart?.destroy();
    host.replaceChildren();
    const kind = ORDER[n % ORDER.length];
    sc = divExample(kind, `find-${n}`);
    n += 1;
    picks = [];
    ids.length = 0;
    chart = new CandleChart(host, { candles: sc.candles, height: 240, yPad: 0.16, visible: sc.decisionIdx + 1, slots: sc.decisionIdx + 4, ariaLabel: 'Find the divergence: tap two swing lows or two swing highs' });
    chart.addPane({ id: 'rsi', title: 'RSI 14', height: 104, range: 'auto', decimals: 1, levels: [{ value: 70, color: 'bear' }, { value: 30, color: 'bull' }], series: [{ values: sc.rsi, color: 'ma3', width: 1.8 }] });
    chart.on('click', onTap);
    setStatus('Tap a swing low or a swing high on the price chart, then another of the same kind. Keyboard: focus the chart, move with ← →, press Enter.');
  };
  function onTap(p) {
    if (!p || !Number.isFinite(p.idx) || p.idx > sc.decisionIdx) return;
    // Snap to the nearest significant swing (the peaks and troughs a trader would mark).
    let best = null;
    for (const s of sc.swings) {
      if (s.idx < 0) continue;
      const dd = Math.abs(s.idx - p.idx);
      if (dd <= 4 && (!best || dd < Math.abs(best.idx - p.idx))) best = s;
    }
    if (!best) {
      setStatus('That candle is not a swing. Tap a clear peak (swing high) or trough (swing low).');
      return;
    }
    if (picks.length >= 2) clearPicks();
    if (picks.length === 1 && (picks[0].type !== best.type || picks[0].idx === best.idx)) {
      if (picks[0].idx === best.idx) return;
      setStatus(`Pick another swing <strong>${picks[0].type}</strong>. Divergence compares lows with lows, or highs with highs.`);
      return;
    }
    sfx.tick();
    picks.push(best);
    ids.push(chart.addMarker({ idx: best.idx, price: best.price, position: 'at', shape: 'ring', color: 'accent' }));
    const o = oscAtSwing(sc.rsi, best, { limit: sc.decisionIdx });
    ids.push(chart.addMarker({ pane: 'rsi', idx: o.idx, price: o.value, position: 'at', shape: 'dot', color: 'accent', pulse: true }));
    if (picks.length === 1) {
      setStatus(`Swing ${best.type} picked; its RSI reading (${o.value.toFixed(1)}) is highlighted. Now tap another swing ${best.type}.`);
      return;
    }
    const [A, B] = [...picks].sort((x, y) => x.idx - y.idx);
    const oa = oscAtSwing(sc.rsi, A, { limit: sc.decisionIdx });
    const ob = oscAtSwing(sc.rsi, B, { limit: sc.decisionIdx });
    const atrV = atr(sc.candles, 14)[B.idx] || 1;
    const c = classifyPair(A, B, oa, ob, { atrValue: atrV });
    const pw = A.type === 'high' ? (B.price > A.price ? 'higher high' : 'lower high') : (B.price < A.price ? 'lower low' : 'higher low');
    const ow = A.type === 'high' ? (ob.value > oa.value ? 'higher high' : 'lower high') : (ob.value < oa.value ? 'lower low' : 'higher low');
    const info = DIV_INFO[c.rel];
    const col = info && info.bias ? (info.bias > 0 ? 'bull' : 'bear') : 'info';
    ids.push(chart.addSegment({ a: A, b: B, color: col, width: 2.4, label: c.rel === 'flat' ? 'About equal' : pw.charAt(0).toUpperCase() + pw.slice(1), pulse: true }));
    ids.push(chart.addSegment({ pane: 'rsi', a: { idx: oa.idx, price: oa.value }, b: { idx: ob.idx, price: ob.value }, color: col, width: 2.4, label: ow.charAt(0).toUpperCase() + ow.slice(1), pulse: true }));
    const between = sc.swings.filter((s) => s.type === A.type && s.idx > A.idx && s.idx < B.idx).length;
    const note = between ? ' <em>Tip: you skipped a swing in between. Traders usually compare the two most recent swings.</em>' : '';
    if (c.rel === 'flat') setStatus(`Price ${Math.abs(c.priceDiff) < 0.35 ? 'made about the same level' : `made a ${pw}`} and RSI ${Math.abs(c.oscDiff) < 1.5 ? 'barely changed' : `made a ${ow}`}: too close to call, so <strong>no clear divergence</strong>.${note}`);
    else if (c.rel === 'agree') setStatus(`Price made a <strong>${pw}</strong> and RSI a <strong>${ow}</strong>: they agree. <strong>No divergence</strong>: momentum confirms the move.${note}`);
    else {
      setStatus(`Price made a <strong>${pw}</strong> while RSI made a <strong>${ow}</strong>: <strong>${info.name.toLowerCase()}</strong>. ${info.meaning.charAt(0).toUpperCase()}${info.meaning.slice(1)}.${note}`, col);
      sfx.correct();
    }
  }
  const newBtn = h('button', { type: 'button', class: 'btn btn--sm', 'data-action': 'new-chart', on: { click: () => { sfx.click(); load(); } } }, icon('restart', { size: 15 }), h('span', null, 'New chart'));
  const clearBtn = h('button', { type: 'button', class: 'btn btn--sm btn--ghost', on: { click: () => { clearPicks(); setStatus('Cleared. Tap a swing low or a swing high.'); } } }, 'Clear');
  box.append(
    P('Your turn. Pick two swing lows (or two swing highs) on the price chart. The RSI readings at the same candles light up, and the widget tells you what the pair shows. Each new chart hides a different case, including charts with no divergence at all.'),
    h('div', { class: 'ind-l__panel' },
      h('div', { class: 'ind-l__row' }, h('p', { class: 'ind-l__eyebrow', style: 'margin-right:auto' }, 'Try it: find the divergence'), clearBtn, newBtn),
      host, status),
    P('Look at the <strong>most recent</strong> swings first; that is where a warning matters. And compare like with like: the trough of a swing low with the RSI trough at the same time.'),
  );
  load();
  return () => chart?.destroy();
}

function checklistExample() {
  const sc = generate('checklist', (rng) => {
    const s = divergenceScenario('bullish', { seed: rng.int(1, 2 ** 31 - 1), difficulty: 0.1, outcome: 'failed' });
    return s && s.a.osc < 30 ? s : null;
  });
  let newLow = sc.decisionIdx + 1;
  for (let i = sc.decisionIdx + 1; i < sc.candles.length; i++) if (sc.candles[i].l < sc.candles[newLow].l) newLow = i;
  return { candles: sc.candles, visible: sc.decisionIdx + 1, yPad: 0.16, sc, newLow };
}

function stepTakeaways(el) {
  const box = wrapStep(el);
  box.append(
    figure(fourMini(), 'The four divergences at a glance: price on top, the oscillator below.', { label: 'Figure 3' }),
    takeaway([
      'Indicators are calculations on past prices: they lag. Use <strong>one tool per family</strong> (trend, momentum, volatility, volume).',
      '<strong>RSI</strong> compares average gains with average losses (0–100). Above 70 in an uptrend is strength, not a sell signal on its own.',
      '<strong>MACD</strong> = EMA 12 − EMA 26, with a 9-EMA signal line and a histogram of the gap. Shrinking bars, signal crosses and zero crosses are early to late signs of a turn.',
      '<strong>Bollinger Bands</strong> and <strong>ATR</strong> measure volatility, not direction. A squeeze often comes before a big move; volume shows whether traders back it.',
      '<strong>Regular divergence</strong> warns of a reversal; <strong>hidden divergence</strong> favours continuation. Both are warnings: wait for structure to break.',
    ], { title: 'Key takeaways' }),
    h('div', { class: 'ind-cta' },
      h('p', null, 'Now train your eye: spot divergence on price and RSI (and the MACD histogram) against the clock, then mark the swings for a bonus.'),
      h('a', { class: 'btn btn--primary', href: '#g.divergence-detective' }, icon('play', { size: 16 }), 'Play Divergence Detective')),
  );
}

// ------------------------------------------------------------------ lesson

export default {
  id: 'indicators',
  mount(root, ctx) {
    const removeStyle = injectStyle();
    const shell = new LessonShell(root, ctx, {
      intro: 'Momentum, volatility and divergence: learn what RSI, MACD, Bollinger Bands, ATR and volume actually measure, and how a disagreement between price and momentum warns that a move is running out of steam.',
      steps: [
        { title: 'Indicators are calculations that lag', render: (el) => stepFamilies(el) },
        {
          title: 'RSI: momentum on a 0–100 scale',
          render: (el) => stepRsi(el),
          quiz: {
            question: 'Price is in a strong uptrend and RSI 14 has read above 70 for six candles. What is the best reading?',
            options: [
              { label: 'Overbought: sell now', value: 'sell' },
              { label: 'Strong momentum: in uptrends RSI often holds 40–80, so above 70 alone is no reason to sell', value: 'strong' },
              { label: 'RSI is broken above 70 in trends and should be ignored', value: 'broken' },
              { label: 'It is a bearish divergence', value: 'div' },
            ],
            answer: 'strong',
            explain: (ok) => `${ok ? '<strong>Right.</strong> ' : 'The best reading: <strong>strong momentum</strong>. '}Overbought describes momentum, not a reversal. In a strong uptrend RSI can stay above 70 while price keeps climbing. A warning would need more, such as a bearish divergence (price higher high, RSI lower high) and a break in structure.`,
          },
        },
        { title: 'MACD: momentum from two moving averages', render: (el) => stepMacd(el) },
        { title: 'Bollinger Bands, ATR and volume', render: (el) => stepBollinger(el) },
        {
          title: 'Divergence: four ways price and momentum disagree',
          render: (el) => stepFour(el),
          quiz: {
            question: 'In an uptrend, price makes a higher low while RSI makes a lower low. What is it?',
            options: [
              { label: 'Regular bullish divergence', value: 'bullish' },
              { label: 'Hidden bullish divergence', value: 'hidden-bullish' },
              { label: 'Regular bearish divergence', value: 'bearish' },
              { label: 'Hidden bearish divergence', value: 'hidden-bearish' },
            ],
            answer: 'hidden-bullish',
            explain: (ok) => `${ok ? '<strong>Hidden bullish divergence.</strong>' : 'It is <strong>hidden bullish divergence</strong>.'} Price held a higher low even though momentum dipped deeper, so buyers stepped in earlier than before. It favours the uptrend continuing. Regular bullish divergence is the opposite: a lower low in price with a higher low in RSI.`,
          },
        },
        storyStep({
          title: 'A bullish divergence, step by step',
          text: 'Here is one complete setup, frame by frame: the context, the divergence, the confirmation, the trade plan and what happened. Use the arrows or press play.',
          story: () => bullishStory(),
          after: 'Notice the order: the divergence came first, but the trade only started once price closed above the swing high between the lows. The stop sat under the second low, where the idea would be proven wrong.',
          height: 280,
        }),
        { title: 'Try it: find the divergence', render: (el) => stepFind(el) },
        checklistStep({
          title: 'Is this divergence a trade?',
          text: [
            'Divergence plus confirmation is a setup; divergence alone is just a warning. Check this chart against the rules, one at a time.',
          ],
          example: () => checklistExample(),
          height: 240,
          items: [
            {
              label: 'Price made a lower low',
              detail: 'The second swing low is below the first.',
              overlay: (chart, ex) => chart.addSegment({ a: ex.sc.a, b: ex.sc.b, color: 'bull', width: 2.4, label: 'Lower low' }),
            },
            {
              label: 'RSI made a higher low',
              detail: 'RSI at the second low is above its reading at the first.',
              overlay: (chart, ex) => {
                chart.addPane({ id: 'rsi', title: 'RSI 14', height: 96, range: 'auto', decimals: 1, levels: [{ value: 70, color: 'bear' }, { value: 30, color: 'bull' }], series: [{ values: ex.sc.rsi, color: 'ma3', width: 1.8 }] });
                chart.addSegment({ pane: 'rsi', a: { idx: ex.sc.a.oscIdx, price: ex.sc.a.osc }, b: { idx: ex.sc.b.oscIdx, price: ex.sc.b.osc }, color: 'bull', width: 2.4, label: 'Higher low' });
              },
            },
            {
              label: 'The first RSI low was oversold (below 30)',
              detail: 'The selling had been extreme, so fading momentum matters.',
              overlay: (chart, ex) => chart.addMarker({ pane: 'rsi', idx: ex.sc.a.oscIdx, price: ex.sc.a.osc, position: 'at', shape: 'ring', color: 'bull' }),
            },
            {
              label: 'Price closed above the swing high between the lows',
              detail: 'The confirmation. Reveal the next candles to check.',
              pass: false,
              to: 999,
              overlay: (chart, ex) => {
                chart.setVisible(ex.candles.length);
                chart.addHLine({ price: ex.sc.structure.price, from: ex.sc.structure.idx, color: 'accent', dashed: true, label: 'Confirm', priceTag: false });
                chart.addMarker({ idx: ex.newLow, position: 'below', shape: 'arrow', text: 'New low', color: 'bear' });
              },
            },
          ],
          verdict: '<strong>No trade.</strong> Three warning signs were there, but price never closed above the Confirm line; it made a new low instead. Anyone who bought the divergence alone took a loss. Waiting for the break kept you out.',
        }),
        realExampleStep({
          title: 'Real market examples',
          kinds: ['bullish-divergence', 'bearish-divergence'],
          text: [
            'The same rules on real price history. The scanner looks for a new swing low (high) with RSI 14 at least 4 points higher (lower) than at the previous swing, with a real bounce in between. The line on price and the matching line on RSI show the disagreement.',
          ],
          caption: 'Real charts are messier than textbook ones: the divergence can be small, the confirmation late, and the outcome anything. Press “Show another” to see more.',
          quiz: {
            question: 'You spot a bearish divergence at a new high on a real chart. What is the disciplined next step?',
            options: [
              { label: 'Short immediately: divergence means the top is in', value: 'short' },
              { label: 'Wait for price to break structure, such as a close below the last higher low', value: 'wait' },
              { label: 'Buy more: price is making new highs', value: 'buy' },
              { label: 'Ignore it: divergence never works on real charts', value: 'ignore' },
            ],
            answer: 'wait',
            explain: (ok) => `${ok ? '<strong>Exactly.</strong> ' : 'The disciplined step is to <strong>wait for structure to break</strong>. '}Divergence says momentum is fading, not that price has turned. Momentum can fade for a long time while price grinds higher. A close below the last higher low confirms sellers have taken over, and gives you a clear place for a stop.`,
          },
        }),
        { title: 'Key takeaways', render: (el) => stepTakeaways(el) },
      ],
    });
    return () => {
      shell.destroy();
      removeStyle();
    };
  },
};
