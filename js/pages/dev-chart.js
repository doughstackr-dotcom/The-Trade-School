// #dev-chart — hidden kitchen-sink page that exercises every CandleChart feature.
// Also the engine's visual test bench. Uses no shell helpers so it works standalone.

import { CandleChart, miniChart, candleSVG } from '../core/chart.js';
import { randomSeed } from '../core/rng.js';
import { trendSeries, randomWalk, aggregate } from '../core/data.js';
import { CANDLE_PATTERNS, CHART_PATTERNS, candleScenario, chartScenario } from '../core/patterns.js';
import * as ind from '../core/indicators.js';

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

const CSS = `
.dev-chart { display: grid; gap: 20px; padding-block: 16px 48px; }
.dev-chart h1 { font-family: var(--font-display); font-size: 28px; margin: 0; text-wrap: balance; }
.dev-chart h2 { font-family: var(--font-display); font-size: 20px; margin: 0 0 4px; }
.dev-chart .dc-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius, 10px); padding: 16px; min-width: 0; }
.dev-chart .dc-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dev-chart .dc-btn { font: 600 14px/1 var(--font-body); padding: 9px 12px; border-radius: var(--radius-sm, 6px); border: 1px solid var(--line); background: var(--surface-2); color: var(--text); cursor: pointer; min-height: 36px; }
.dev-chart .dc-btn:hover { border-color: var(--text-3); }
.dev-chart .dc-btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.dev-chart .dc-btn[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); }
.dev-chart .dc-muted { color: var(--text-3); font-size: 13px; margin: 0; }
.dev-chart pre { font: 12px/1.5 var(--font-mono); background: var(--surface-2); color: var(--text-2); border-radius: 6px; padding: 10px 12px; margin: 0; overflow: auto; max-height: 180px; white-space: pre-wrap; word-break: break-word; }
.dev-chart .dc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.dev-chart .dc-thumb { display: grid; gap: 4px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 8px; margin: 0; }
.dev-chart .dc-thumb figcaption { font: 600 12px/1.3 var(--font-body); color: var(--text-2); }
.dev-chart .dc-thumb small { font-weight: 500; color: var(--text-3); }
.dev-chart .dc-thumb svg { width: 100%; height: auto; }
.dev-chart select { font: 500 14px var(--font-body); padding: 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface); color: var(--text); min-height: 36px; max-width: 100%; }
.dev-chart .dc-candles { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-end; }
`;

export function mount(root, ctx = {}) {
  let seed = ctx.seed ?? randomSeed();
  const cleanups = [];
  const charts = [];
  root.textContent = '';
  const style = el('style', {}, CSS);
  const page = el('div', { class: 'dev-chart container' });
  root.append(style, page);

  const seedLabel = el('span', { class: 'dc-muted mono' });
  const status = el('p', { class: 'dc-muted', 'aria-live': 'polite' }, 'Hover or tap the chart.');
  const out = el('pre', { 'aria-label': 'Last drawing result' }, '—');
  const mainHost = el('div');

  page.append(
    el('header', {}, el('h1', {}, 'Chart kitchen sink'), el('p', { class: 'dc-muted' }, 'Every CandleChart feature on one page. Seed: ', seedLabel)),
  );

  // ---- main chart -------------------------------------------------------------------------
  let main = null;
  let drag = { on: false, ids: [] };
  const ids = {};

  function buildMain() {
    main?.destroy();
    drag = { on: false, ids: [] };
    dragBtn.setAttribute('aria-pressed', 'false');
    seedLabel.textContent = String(seed);
    const { candles, swings } = trendSeries({ seed, count: 160, direction: 'up', swings: 5, strength: 1 });
    const cl = ind.closes(candles);
    const ma20 = ind.sma(cl, 20);
    const ma50 = ind.ema(cl, 50);
    const bb = ind.bollinger(cl, 20, 2);
    const rsi = ind.rsi(cl, 14);
    const m = ind.macd(cl);
    main = new CandleChart(mainHost, {
      candles,
      height: 380,
      showVolume: true,
      ariaLabel: 'Kitchen-sink price chart with moving averages, Bollinger Bands, RSI and MACD',
      timeLabel: (i) => `D${i + 1}`,
    });
    charts[0] = main;
    ids.band = main.addBand({ upper: bb.upper, lower: bb.lower, color: 'info', opacity: 0.07 });
    ids.ma20 = main.addSeries({ values: ma20, color: 'ma1', label: 'SMA 20' });
    ids.ma50 = main.addSeries({ values: ma50, color: 'ma2', label: 'EMA 50' });
    const levels = ind.supportResistance(candles, { tolerance: 0.008 }).slice(0, 2);
    levels.forEach((lv, i) => {
      ids[`sr${i}`] = main.addHLine({
        price: lv.price,
        color: lv.type === 'support' ? 'support' : lv.type === 'resistance' ? 'resistance' : 'accent',
        label: `${lv.type === 'both' ? 'S/R flip' : lv.type === 'support' ? 'Support' : 'Resistance'} ×${lv.touches}`,
        dashed: true,
      });
    });
    const lastHigh = [...swings].reverse().find((s) => s.type === 'high');
    const lowBefore = [...swings].reverse().find((s) => s.type === 'low' && s.idx < lastHigh.idx);
    if (lastHigh && lowBefore) {
      ids.fib = main.addFib({ a: { idx: lowBefore.idx, price: lowBefore.price }, b: { idx: lastHigh.idx, price: lastHigh.price }, zone: [0.5, 0.618] });
    }
    ids.path = main.addPath({ points: swings.map((s) => ({ idx: s.idx, price: s.price })), labels: swings.map((s) => s.label), color: 'info', width: 1.5 });
    const first = swings[0];
    ids.zone = main.addZone({ from: first.price * 0.994, to: first.price * 1.006, color: 'accent', label: 'Demand zone', x1: first.idx - 3, x2: first.idx + 30 });
    for (const x of ind.crosses(ma20, ma50)) {
      main.addMarker({ idx: x.idx, position: x.type === 'golden' ? 'below' : 'above', shape: 'arrow', color: x.type === 'golden' ? 'bull' : 'bear', text: x.type === 'golden' ? 'Golden' : 'Death' });
    }
    const s3 = swings[3];
    ids.box = main.addBox({ from: s3.idx - 5, to: s3.idx + 5, color: 'warn', label: 'Box' });
    main.addMarker({ idx: swings[2].idx, price: swings[2].price, shape: 'ring', color: 'warn' });
    main.addText({ idx: 2, price: Math.min(...candles.slice(0, 10).map((k) => k.l)), text: 'Start', color: 'text-3' });
    main.addPane({ id: 'rsi', title: 'RSI 14', height: 96, range: [0, 100], levels: [{ value: 70, color: 'bear' }, { value: 30, color: 'bull' }], series: [{ values: rsi, color: 'ma3' }] });
    main.addPane({ id: 'macd', title: 'MACD 12 26 9', height: 104, histogram: { values: m.hist }, series: [{ values: m.macd, color: 'ma1' }, { values: m.signal, color: 'ma2' }] });
    const div = ind.divergence(candles, rsi);
    for (const d of div.slice(-2)) {
      main.addSegment({ pane: 'rsi', a: { idx: d.a.idx, price: d.a.value }, b: { idx: d.b.idx, price: d.b.value }, color: d.type.includes('bull') ? 'bull' : 'bear', width: 1.5 });
    }
    main.on('hover', (p) => {
      status.textContent = `hover idx ${p.idx}${p.pane ? ` (${p.pane})` : ''} · ${p.price.toFixed(2)}${p.candle ? ` · close ${p.candle.c.toFixed(2)}` : ''}`;
    });
    main.on('click', (p) => {
      status.textContent = `click idx ${p.idx} · price ${p.price?.toFixed(2)}`;
      main.flash(p.idx, 'accent');
    });
    main.on('leave', () => {
      status.textContent = 'Pointer left the chart.';
    });
  }

  const btn = (label, fn, extra = {}) => el('button', { type: 'button', class: 'dc-btn', onclick: fn, ...extra }, label);
  const show = (obj) => {
    out.textContent = obj == null ? 'null (cancelled)' : JSON.stringify(obj, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v), 1);
  };
  const doDraw = (kind, opts) => async () => {
    out.textContent = `Drawing ${kind}… (press-drag-release, or tap twice; Esc cancels)`;
    const shape = await main.draw(kind, opts);
    show(shape);
  };
  const dragBtn = btn('Toggle draggable', () => {
    drag.on = !drag.on;
    dragBtn.setAttribute('aria-pressed', String(drag.on));
    const targets = [ids.sr0, ids.fib, ids.zone, ...drag.ids].filter(Boolean);
    for (const id of targets) main.setDraggable(id, drag.on ? (spec, info) => info.phase === 'end' && show({ dragged: id, ...spec }) : false);
  }, { 'aria-pressed': 'false' });

  const controls = el(
    'div',
    { class: 'dc-row' },
    btn('Reveal', async () => {
      main.setVisible(40);
      await main.reveal({ to: main.candles.length, interval: 45 });
    }),
    btn('Draw H-line', doDraw('hline', { snap: 'ohlc' })),
    btn('Draw segment', doDraw('segment', { snap: 'ohlc' })),
    btn('Draw fib', doDraw('fib', { snap: 'ohlc', fib: { zone: [0.5, 0.618] } })),
    btn('Draw zone', doDraw('zone', {})),
    btn('Cancel draw', () => main.cancelDraw()),
    dragBtn,
    btn('Flash last', () => main.flash(main.visibleCount - 1, 'accent')),
    btn('Append candle', () => {
      const last = main.candles[main.candles.length - 1];
      const c = last.c * (1 + (Math.random() - 0.48) * 0.02);
      main.append({ o: last.c, h: Math.max(last.c, c) * 1.003, l: Math.min(last.c, c) * 0.997, c, v: 1200 });
    }),
    btn('New seed', () => {
      seed = randomSeed();
      buildMain();
      buildPatternChart();
    }),
    btn('Toggle theme', () => {
      const html = document.documentElement;
      const dark = html.getAttribute('data-theme') === 'dark' || (!html.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
      html.setAttribute('data-theme', dark ? 'light' : 'dark');
    }),
  );

  page.append(el('section', { class: 'dc-card', 'aria-label': 'Main chart' }, el('h2', {}, 'Main chart'), controls, el('div', { style: { height: '10px' } }), mainHost, status, out));
  buildMain();

  // ---- chart pattern scenario viewer -----------------------------------------------------
  const pHost = el('div');
  const pInfo = el('p', { class: 'dc-muted' });
  const pSelect = el('select', { 'aria-label': 'Chart pattern' }, ...Object.values(CHART_PATTERNS).map((p) => el('option', { value: p.id }, p.name)));
  const oSelect = el('select', { 'aria-label': 'Outcome' }, el('option', { value: 'success' }, 'Success'), el('option', { value: 'fail' }, 'Failed breakout'));
  let pChart = null;
  function buildPatternChart() {
    pChart?.destroy();
    const id = pSelect.value;
    const sc = chartScenario(id, { seed, outcome: oSelect.value });
    pChart = new CandleChart(pHost, { candles: sc.candles, height: 320, showVolume: true, ariaLabel: `${CHART_PATTERNS[id].name} scenario` });
    charts[1] = pChart;
    pChart.addBox({ from: sc.patternStart, to: sc.patternEnd, color: 'accent', label: CHART_PATTERNS[id].name, full: false });
    if (sc.neckline) pChart.addSegment({ a: { idx: sc.neckline.x1, price: sc.neckline.y1 }, b: { idx: sc.neckline.x2, price: sc.neckline.y2 }, color: 'info', width: 2, extend: 'right', label: 'Neckline' });
    if (sc.boundaries) {
      for (const k of ['upper', 'lower']) {
        const b = sc.boundaries[k];
        pChart.addSegment({ a: { idx: b.x1, price: b.y1 }, b: { idx: b.x2, price: b.y2 }, color: k === 'upper' ? 'resistance' : 'support', width: 1.75 });
      }
    }
    pChart.addHLine({ price: sc.target, color: sc.reachedTarget ? 'bull' : 'muted', label: 'Target', dashed: true, from: sc.breakoutIdx });
    for (const kp of sc.keyPoints) {
      if (kp.label === 'Breakout') pChart.addMarker({ idx: kp.idx, shape: 'arrow', position: sc.direction > 0 ? 'below' : 'above', color: 'accent', text: 'Breakout' });
      else pChart.addMarker({ idx: kp.idx, price: kp.price, shape: 'dot', position: 'at', color: 'info' });
    }
    pInfo.textContent = `${sc.name}: ${sc.bias}, outcome ${sc.outcome}, breakout at ${sc.breakoutIdx}, height ${sc.height.toFixed(2)}, target ${sc.target.toFixed(2)} (${sc.reachedTarget ? 'reached' : 'not reached'}). ${sc.keyPoints.map((k) => `${k.label}@${k.idx}`).join(', ')}`;
  }
  pSelect.addEventListener('change', buildPatternChart);
  oSelect.addEventListener('change', buildPatternChart);
  page.append(el('section', { class: 'dc-card', 'aria-label': 'Chart pattern scenario' }, el('h2', {}, 'Chart pattern scenario'), el('div', { class: 'dc-row' }, pSelect, oSelect), el('div', { style: { height: '10px' } }), pHost, pInfo));
  buildPatternChart();

  // ---- multi-timeframe (randomWalk + aggregate) -----------------------------------------
  const tfLow = el('div');
  const tfHigh = el('div');
  page.append(
    el(
      'section',
      { class: 'dc-card', 'aria-label': 'Timeframes' },
      el('h2', {}, 'Timeframes'),
      el('p', { class: 'dc-muted' }, 'randomWalk (1H, 160 candles) → aggregate(×4) = 4H. The shaded box on 1H is the last 4H candle.'),
      el('div', { style: { display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' } }, tfLow, tfHigh),
    ),
  );
  {
    const base = randomWalk({ seed: seed ^ 0x5bd1, count: 160, drift: 0.0008, vol: 0.009 });
    const hi = aggregate(base, 4);
    const lo = new CandleChart(tfLow, { candles: base, height: 220, ariaLabel: '1-hour chart', timeLabel: (i) => `${String(i % 24).padStart(2, '0')}:00` });
    lo.addSeries({ values: ind.ema(ind.closes(base), 20), color: 'ma1', label: 'EMA 20' });
    lo.addBox({ from: 156, to: 159, color: 'accent', full: true });
    const hc = new CandleChart(tfHigh, { candles: hi, height: 220, ariaLabel: '4-hour chart', timeLabel: (i) => `D${Math.floor(i / 6) + 1}` });
    hc.addSeries({ values: ind.ema(ind.closes(hi), 20), color: 'ma2', label: 'EMA 20' });
    hc.addMarker({ idx: hi.length - 1, position: 'above', shape: 'dot', color: 'accent' });
    charts.push(lo, hc);
  }

  // ---- candleSVG -------------------------------------------------------------------------
  page.append(
    el(
      'section',
      { class: 'dc-card', 'aria-label': 'Single candles' },
      el('h2', {}, 'candleSVG'),
      el(
        'div',
        { class: 'dc-candles' },
        candleSVG({ o: 101.2, h: 104.6, l: 99.4, c: 103.8 }, { width: 70, height: 200, labels: true, prices: true }),
        candleSVG({ o: 103.8, h: 104.9, l: 98.6, c: 100.1 }, { width: 70, height: 200, labels: true }),
        candleSVG({ o: 100, h: 101.5, l: 98.5, c: 100.02 }, { width: 44, height: 120 }),
        candleSVG({ o: 100, h: 100.2, l: 96, c: 99.9 }, { width: 44, height: 120 }),
      ),
    ),
  );

  // ---- thumbnails ------------------------------------------------------------------------
  const cGrid = el('div', { class: 'dc-grid' });
  for (const p of Object.values(CANDLE_PATTERNS)) {
    const sc = candleScenario(p.id, { seed, leadIn: 12, after: 3 });
    cGrid.append(
      el('figure', { class: 'dc-thumb' }, miniChart(sc.candles, { width: 160, height: 96, highlight: [sc.start, sc.end], ariaLabel: p.name }), el('figcaption', {}, p.name, el('br'), el('small', {}, `${p.bias} · ${p.context}`))),
    );
  }
  const gGrid = el('div', { class: 'dc-grid' });
  for (const p of Object.values(CHART_PATTERNS)) {
    const sc = chartScenario(p.id, { seed, after: 16 });
    const overlays = [];
    if (sc.neckline) overlays.push({ type: 'segment', a: { idx: sc.neckline.x1, price: sc.neckline.y1 }, b: { idx: sc.neckline.x2, price: sc.neckline.y2 }, color: 'info', width: 1.25 });
    if (sc.boundaries) {
      overlays.push({ type: 'segment', a: { idx: sc.boundaries.upper.x1, price: sc.boundaries.upper.y1 }, b: { idx: sc.boundaries.upper.x2, price: sc.boundaries.upper.y2 }, color: 'resistance', width: 1.25 });
      overlays.push({ type: 'segment', a: { idx: sc.boundaries.lower.x1, price: sc.boundaries.lower.y1 }, b: { idx: sc.boundaries.lower.x2, price: sc.boundaries.lower.y2 }, color: 'support', width: 1.25 });
    }
    overlays.push({ type: 'hline', price: sc.target, color: 'accent', dashed: '3 3', width: 1, from: sc.breakoutIdx });
    overlays.push({ type: 'marker', idx: sc.breakoutIdx, position: sc.direction > 0 ? 'below' : 'above', color: 'accent' });
    gGrid.append(
      el('figure', { class: 'dc-thumb' }, miniChart(sc.candles, { width: 160, height: 96, overlays, highlight: [sc.patternStart, sc.patternEnd], ariaLabel: p.name, padding: 4 }), el('figcaption', {}, p.name, el('br'), el('small', {}, `${sc.bias} · ${p.kind}`))),
    );
  }
  page.append(
    el('section', { class: 'dc-card', 'aria-label': 'Candlestick pattern thumbnails' }, el('h2', {}, 'Candlestick patterns'), el('p', { class: 'dc-muted' }, 'candleScenario → miniChart (pattern highlighted)'), cGrid),
    el('section', { class: 'dc-card', 'aria-label': 'Chart pattern thumbnails' }, el('h2', {}, 'Chart patterns'), el('p', { class: 'dc-muted' }, 'chartScenario → miniChart with neckline / boundaries and target'), gGrid),
  );

  cleanups.push(() => {
    for (const c of charts) c?.destroy();
  });
  return () => {
    cleanups.forEach((fn) => fn());
    root.textContent = '';
  };
}

export default { id: 'dev-chart', mount };
