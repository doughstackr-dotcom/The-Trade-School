// #dev-chart — hidden kitchen-sink page that exercises every CandleChart feature.
// Also the engine's visual test bench. Uses no shell helpers so it works standalone.

import { CandleChart, miniChart, candleSVG, CHART_TYPES } from '../core/chart.js';
import { ChartStory } from '../core/story.js';
import { randomSeed } from '../core/rng.js';
import { trendSeries, randomWalk, aggregate, realisticMarket } from '../core/data.js';
import { CANDLE_PATTERNS, CHART_PATTERNS, candleScenario, chartScenario, CANDLE_PATTERN_IDS } from '../core/patterns.js';
import { findSetups, describeChart, SETUP_KINDS } from '../core/scanner.js';
import { isMockMode, setMockMode, marketInfo, marketStatus, getCatalog, subscribeLive, axisLabel, intervalLabel } from '../core/market.js';
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
.dev-chart .dc-seg { display: inline-flex; flex-wrap: wrap; gap: 0; border: 1px solid var(--line); border-radius: var(--radius-sm, 6px); overflow: hidden; }
.dev-chart .dc-seg .dc-btn { border: 0; border-radius: 0; border-right: 1px solid var(--line); }
.dev-chart .dc-seg .dc-btn:last-child { border-right: 0; }
.dev-chart .dc-list { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.dev-chart .dc-list button { font: 600 12px/1.2 var(--font-body); padding: 6px 8px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface-2); color: var(--text-2); cursor: pointer; min-height: 30px; }
.dev-chart .dc-list button[data-dir="bullish"] { border-color: var(--bull); }
.dev-chart .dc-list button[data-dir="bearish"] { border-color: var(--bear); }
.dev-chart .dc-note { font: 600 12px/1.4 var(--font-body); color: var(--warn); margin: 0; }
.dev-chart .dc-kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; font: 13px/1.4 var(--font-mono); color: var(--text-2); margin: 0; }
.dev-chart .dc-kv dt { color: var(--text-3); }
.dev-chart .dc-kv dd { margin: 0; overflow-wrap: anywhere; }
.dev-chart .dc-read { font: 15px/1.55 var(--font-body); color: var(--text); margin: 0; }
@media (pointer: coarse) {
  .dev-chart .dc-btn, .dev-chart .dc-list button { min-height: 44px; }
  .dev-chart select { min-height: 44px; font-size: 16px; }
}
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

  // ---- chart types, log scale, viewport ---------------------------------------------------
  {
    const host = el('div', { 'data-test': 'viewport-chart' });
    const readout = el('p', { class: 'dc-muted mono', 'data-test': 'vp-readout', 'aria-live': 'polite' }, '—');
    const long = realisticMarket({ seed: seed ^ 0x2f1, count: 1500, start: 40, drift: 0.0021, vol: 0.02, regime: 'mixed' });
    const vc = new CandleChart(host, {
      candles: long,
      height: 340,
      showVolume: true,
      pannable: true,
      viewport: [1350, 1500],
      ariaLabel: 'Pannable 1500-candle chart: scroll or pinch to zoom, drag to pan',
      timeLabel: (i) => `W${i + 1}`,
    });
    charts.push(vc);
    const e50 = ind.ema(ind.closes(long), 50);
    vc.addSeries({ values: e50, color: 'ma2', label: 'EMA 50' });
    const show = (v) => {
      readout.textContent = `viewport ${v.from.toFixed(1)} → ${v.to.toFixed(1)} · candles ${v.first}–${v.last} (${v.count} of ${v.total}) · ${vc.chartType}${vc.logScale ? ' · log' : ''}`;
    };
    vc.on('viewport', show);
    show(vc.getViewport());
    const typeBtns = CHART_TYPES.map((t) =>
      el('button', { type: 'button', class: 'dc-btn', 'aria-pressed': String(t === 'candles'), 'data-type': t, onclick: () => {
        vc.setChartType(t);
        typeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === t)));
        show(vc.getViewport());
      } }, t === 'heikin-ashi' ? 'Heikin-Ashi' : t === 'ohlc' ? 'OHLC bars' : t[0].toUpperCase() + t.slice(1)),
    );
    const logBtn = el('button', { type: 'button', class: 'dc-btn', 'aria-pressed': 'false', 'data-test': 'log', onclick: () => {
      vc.setLogScale(!vc.logScale);
      logBtn.setAttribute('aria-pressed', String(vc.logScale));
      show(vc.getViewport());
    } }, 'Log scale');
    const b = (label, fn, extra = {}) => el('button', { type: 'button', class: 'dc-btn', onclick: fn, ...extra }, label);
    page.append(
      el('section', { class: 'dc-card', 'aria-label': 'Chart types, log scale and viewport' },
        el('h2', {}, 'Chart types, log scale & viewport'),
        el('p', { class: 'dc-muted' }, '1500 simulated candles (realisticMarket). pannable: true — wheel / ctrl-wheel / trackpad pinch to zoom, drag to pan, two-finger pinch and pan on touch, + / − / 0 keys. Only the visible range is drawn.'),
        el('div', { class: 'dc-row' }, el('div', { class: 'dc-seg', role: 'group', 'aria-label': 'Chart type' }, ...typeBtns), logBtn),
        el('div', { class: 'dc-row', style: { marginTop: '8px' } },
          b('Last 150', () => vc.setViewport(1350, 1500, { animate: true })),
          b('Last 40', () => vc.setViewport(1460, 1500, { animate: true })),
          b('All', () => vc.resetViewport({ animate: true }), { 'data-test': 'vp-all' }),
          b('Zoom +', () => vc.zoomBy(1.5)),
          b('Zoom −', () => vc.zoomBy(1 / 1.5)),
          b('Pan ←', () => vc.panBy(-20)),
          b('Pan →', () => vc.panBy(20)),
          b('Append', () => {
            const last = vc.candles[vc.candles.length - 1];
            const c = last.c * (1 + (Math.random() - 0.48) * 0.03);
            vc.append({ o: last.c, h: Math.max(last.c, c) * 1.004, l: Math.min(last.c, c) * 0.996, c, v: last.v });
          })),
        el('div', { style: { height: '10px' } }), host, readout,
      ),
    );
  }

  // ---- ChartStory --------------------------------------------------------------------------
  {
    const sc = candleScenario('hammer', { seed, leadIn: 30, after: 8, outcome: 'success' });
    const i = sc.end;
    const k = sc.candles[i];
    const risk = k.h - k.l;
    const entry = sc.candles[i + 1].c;
    const stop = k.l - risk * 0.1;
    const target = entry + 2 * (entry - stop);
    const lows = sc.candles.slice(Math.max(0, i - 30), i - 3).map((c) => c.l);
    const zoneLo = Math.min(...lows.slice(-12));
    const host = el('div', { 'data-test': 'story' });
    page.append(el('section', { class: 'dc-card', 'aria-label': 'Chart story' }, el('h2', {}, 'ChartStory'), el('p', { class: 'dc-muted' }, 'Frames with captions, cumulative overlays (the newest pulse once), focus dimming with smooth zoom, EMA 20 and volume. ←/→ when focused.'), el('div', { style: { height: '8px' } }), host));
    const story = new ChartStory(host, {
      candles: sc.candles,
      height: 300,
      indicators: { ema20: true, volume: true },
      ariaLabel: 'Hammer at the end of a decline, step by step',
      frames: [
        { to: i - 6, title: 'The set-up.', caption: 'Price has fallen for weeks: lower highs, lower lows, all under a falling 20-EMA.', overlays: [{ type: 'segment', a: { idx: 2, price: sc.candles[2].h }, b: { idx: i - 7, price: sc.candles[i - 7].h }, color: 'bear', dashed: true, label: 'Downtrend' }] },
        { to: i, title: 'Into support.', caption: 'Sellers push price back towards the area where it bounced before.', overlays: [{ type: 'zone', from: zoneLo - risk * 0.25, to: zoneLo + risk * 0.35, color: 'support', label: 'Support' }], focus: [i - 10, i] },
        { to: i + 1, title: 'A hammer.', caption: 'A long lower wick and a close near the high: lower prices were rejected.', overlays: [{ type: 'box', from: i, to: i, color: 'accent', label: 'Hammer' }], focus: [i - 6, i + 3], zoom: true },
        { to: i + 2, title: 'Confirmation.', caption: 'The next candle closes above the hammer high — the signal to act, with a stop under the wick.', overlays: [{ type: 'marker', idx: i + 1, position: 'below', text: 'Entry', color: 'bull' }, { type: 'hline', price: stop, color: 'bear', label: 'Stop' }, { type: 'hline', price: target, color: 'bull', label: 'Target 2R' }], focus: [i - 6, i + 3], zoom: true },
        { to: sc.candles.length, title: 'What happened.', caption: 'This time buyers followed through. Not every hammer works — that is why the stop comes first.', clear: false },
      ],
    });
    cleanups.push(() => story.destroy());
  }

  // ---- scanner ------------------------------------------------------------------------------
  {
    const host = el('div', { 'data-test': 'scanner-chart' });
    const info = el('p', { class: 'dc-note' });
    const list = el('ul', { class: 'dc-list', 'aria-label': 'Setups found' });
    const counts = el('p', { class: 'dc-muted' });
    const read = el('p', { class: 'dc-read', 'data-test': 'describe' });
    const readJson = el('pre', { 'aria-label': 'describeChart output' });
    const dsSelect = el('select', { 'aria-label': 'Data set' }, ...['BTC-USD_1d', 'SPY_1d', 'EUR-USD_1w', 'ETH-USD_1w'].map((v) => el('option', { value: v }, v.replace('_', ' · '))));
    const GROUPS = {
      'Chart patterns & levels': ['double-top', 'double-bottom', 'head-and-shoulders', 'inverse-head-and-shoulders', 'bull-flag', 'bear-flag', 'support-bounce', 'resistance-reject', 'breakout-up', 'breakout-down', 'fakeout-up', 'fakeout-down'],
      'Trend & momentum': ['trend-up', 'trend-down', 'range', 'golden-cross', 'death-cross', 'bullish-divergence', 'bearish-divergence', 'fib-pullback'],
      'Candle patterns (no doji)': CANDLE_PATTERN_IDS.filter((id) => id !== 'doji' && id !== 'spinning-top'),
    };
    const gSelect = el('select', { 'aria-label': 'Setup kinds' }, ...Object.keys(GROUPS).map((g) => el('option', { value: g }, g)));
    page.append(el('section', { class: 'dc-card', 'aria-label': 'Scanner' }, el('h2', {}, 'Scanner: findSetups + describeChart'), el('div', { class: 'dc-row' }, dsSelect, gSelect), info, el('div', { style: { height: '8px' } }), host, counts, list, el('h2', { style: { marginTop: '12px' } }, 'describeChart'), read, readJson));
    let sChart = null;
    let alive = true;
    cleanups.push(() => {
      alive = false;
      sChart?.destroy();
    });
    const loadSet = async (name) => {
      try {
        const res = await fetch(new URL(`../../tests/fixtures/market/${name}.json`, import.meta.url));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return { candles: data.candles, label: `TEST FIXTURE (synthetic, not real prices): ${name}`, interval: data.interval, decimals: name.startsWith('EUR') ? 5 : 2 };
      } catch {
        return { candles: realisticMarket({ seed, count: 500 }), label: 'Fixtures unavailable here: simulated market (realisticMarket)', interval: null, decimals: 2 };
      }
    };
    const colorOfDir = (d) => (d === 'bullish' ? 'bull' : d === 'bearish' ? 'bear' : 'info');
    const short = (kind) => (SETUP_KINDS[kind].name.length > 16 ? SETUP_KINDS[kind].name.replace('Inverse head and shoulders', 'Inv. H&S').replace('Head and shoulders', 'H&S').replace('Failed breakout', 'Fakeout').replace('Fibonacci pullback', 'Fib pullback').replace('Resistance rejection', 'Rejection').replace('Bullish RSI divergence', 'Bull div.').replace('Bearish RSI divergence', 'Bear div.') : SETUP_KINDS[kind].name);
    const run = async () => {
      const set = await loadSet(dsSelect.value);
      if (!alive) return;
      const cs = set.candles;
      info.textContent = set.label;
      sChart?.destroy();
      const bars = host.clientWidth && host.clientWidth < 560 ? 70 : 160;
      sChart = new CandleChart(host, { candles: cs, height: 320, pannable: true, viewport: [cs.length - bars, cs.length], decimals: set.decimals, showVolume: cs.some((c) => c.v > 0), ariaLabel: 'Scanner results', timeLabel: set.interval ? (i, k) => (k ? axisLabel(k.t, set.interval) : '') : null });
      const setups = findSetups(cs, { kinds: GROUPS[gSelect.value] });
      for (const s of setups) {
        const col = colorOfDir(s.direction);
        const m = s.meta;
        if (SETUP_KINDS[s.kind].group === 'candle') sChart.addBox({ from: s.start, to: s.end, color: col });
        if (m.points) sChart.addPath({ points: m.points, color: col, width: 1.5 });
        if (m.neckline && typeof m.neckline === 'object') sChart.addSegment({ a: { idx: m.neckline.x1, price: m.neckline.y1 }, b: { idx: m.neckline.x2, price: m.neckline.y2 }, color: 'info', width: 1.5 });
        else if (typeof m.neckline === 'number') sChart.addSegment({ a: { idx: s.start, price: m.neckline }, b: { idx: s.end, price: m.neckline }, color: 'info', width: 1.5 });
        if (m.level != null) sChart.addSegment({ a: { idx: s.start, price: m.level }, b: { idx: s.end, price: m.level }, color: col, width: 1.5, dashed: true });
        if (m.upper) sChart.addSegment({ a: { idx: m.upper.x1, price: m.upper.y1 }, b: { idx: m.upper.x2, price: m.upper.y2 }, color: 'resistance', width: 1.25 });
        if (m.lower) sChart.addSegment({ a: { idx: m.lower.x1, price: m.lower.y1 }, b: { idx: m.lower.x2, price: m.lower.y2 }, color: 'support', width: 1.25 });
        if (m.a && m.b && m.c) sChart.addPath({ points: [m.a, m.b, m.c], color: 'fib', width: 1.25 });
        else if (m.a && m.b) sChart.addSegment({ a: { idx: m.a.idx, price: m.a.price }, b: { idx: m.b.idx, price: m.b.price }, color: col, width: 1.5 });
        if (s.kind === 'range') sChart.addBox({ from: s.start, to: s.end, top: m.top, bottom: m.bottom, color: 'info' });
        sChart.addMarker({ idx: s.decisionIdx, position: s.direction === 'bearish' ? 'above' : 'below', shape: s.direction === 'neutral' ? 'dot' : 'arrow', color: col, text: short(s.kind) });
      }
      const byKind = {};
      for (const s of setups) byKind[s.kind] = (byKind[s.kind] || 0) + 1;
      counts.textContent = `${setups.length} setups in ${cs.length} candles: ${Object.entries(byKind).map(([k, n]) => `${k} ×${n}`).join(', ') || 'none'}. Tap one to jump to it.`;
      list.textContent = '';
      for (const s of setups.slice(-40).reverse()) {
        list.append(el('li', {}, el('button', { type: 'button', 'data-dir': s.direction, onclick: () => {
          const w = Math.max(40, s.end - s.start + 30);
          sChart.setViewport(s.decisionIdx - w + 12, s.decisionIdx + 12, { animate: true });
          sChart.flash(s.decisionIdx);
        } }, `${short(s.kind)} @${s.decisionIdx}`)));
      }
      const d = describeChart(cs, { decimals: set.decimals });
      read.textContent = d.summary;
      readJson.textContent = JSON.stringify({ ...d, summary: undefined }, (key, v) => (typeof v === 'number' ? +v.toFixed(set.decimals + 1) : v), 1);
    };
    dsSelect.addEventListener('change', run);
    gSelect.addEventListener('change', run);
    run();
  }

  // ---- market.js status (mock mode) --------------------------------------------------------
  {
    const box = el('div', { class: 'stack' });
    page.append(el('section', { class: 'dc-card', 'aria-label': 'Market data', 'data-test': 'market' }, el('h2', {}, 'market.js'), box));
    let unsub = null;
    let lChart = null;
    cleanups.push(() => {
      unsub?.();
      lChart?.destroy();
    });
    const render = () => {
      unsub?.();
      unsub = null;
      lChart?.destroy();
      lChart = null;
      box.textContent = '';
      const info = marketInfo();
      const kv = el('dl', { class: 'dc-kv' }, el('dt', {}, 'mock mode'), el('dd', { 'data-test': 'mock' }, String(info.mock)), el('dt', {}, 'marketStatus()'), el('dd', {}, marketStatus()), el('dt', {}, 'last error'), el('dd', {}, info.lastError || '—'));
      const toggle = el('button', { type: 'button', class: 'dc-btn', onclick: () => {
        setMockMode(!isMockMode());
        render();
      } }, info.mock ? 'Turn mock mode off' : 'Turn mock mode on (localhost)');
      box.append(kv, el('div', { class: 'dc-row' }, toggle));
      if (!info.mock) {
        box.append(el('p', { class: 'dc-muted' }, 'Mock mode is off, so this page makes no market-data requests. With it on, market.js serves tests/fixtures/market/*.json (labelled test data).'));
        return;
      }
      const cat = el('p', { class: 'dc-muted mono' }, 'catalog…');
      const status = el('p', { class: 'dc-muted mono', 'aria-live': 'polite' }, 'subscribing…');
      const host = el('div');
      const pick = el('select', { 'aria-label': 'Live or replay' }, el('option', { value: 'BTC-USD|1m' }, 'BTC-USD 1m (live, mock clock)'), el('option', { value: 'SPY|1d' }, 'SPY 1d (replay)'));
      box.append(cat, el('div', { class: 'dc-row' }, pick), host, status);
      getCatalog().then((c) => {
        cat.textContent = `catalog (${c.status}${c.mock ? ', fixture' : ''}): ${c.symbols.map((s) => `${s.id} [${s.intervals.join(' ')}]${s.live ? ' live' : ''}`).join(' · ')}`;
      });
      const start = () => {
        unsub?.();
        lChart?.destroy();
        const [symbol, interval] = pick.value.split('|');
        lChart = new CandleChart(host, { candles: [], height: 240, ariaLabel: `${symbol} ${interval}`, pannable: true, timeLabel: (i, k) => (k ? axisLabel(k.t, interval) : '') });
        unsub = subscribeLive({ symbol, interval, bars: 80, stepMs: 1500 }, (u) => {
          if (u.candles.length) lChart.setCandles(u.candles);
          status.textContent = `${u.status}${u.forming ? ' (forming)' : ''} · ${u.symbol} ${intervalLabel(u.interval)} · ${u.candles.length} candles${u.last ? ` · last ${axisLabel(u.last.t, u.interval)} ${u.last.c}` : ''} · ${u.attribution || ''}`;
        });
      };
      pick.addEventListener('change', start);
      start();
    };
    render();
  }

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
