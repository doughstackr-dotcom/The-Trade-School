// Lesson: Drawing trend lines that matter — trend lines, touches, wicks vs bodies, steepness,
// channels, a trend-line bounce and a break-and-retest, a real example, and quick checks.
// Charts come from the validated generators in ../games/trendline-challenge-kit.js.
import { LessonShell, storyStep, realExampleStep, compareStep, figure, takeaway, lessonRng, annotateSetup } from '../core/lesson-kit.js';
import { CandleChart, miniChart } from '../core/chart.js';
import { h, icon, sfx, kbdHint } from '../core/ui.js';
import { tween, reducedMotion } from '../core/anim.js';
import {
  chartContext, evaluateLine, idealLine, channelFor, lineAt, lineStart, ordered, span,
  makeTrendChart, makeHoldBreak, makeSteepChart, realTrend, outcomeAfter,
} from '../games/trendline-challenge-kit.js';

const CSS = `
[data-lesson="trendlines"] .tll-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
[data-lesson="trendlines"] .tll-toolbar__group { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
[data-lesson="trendlines"] .tll-toolbar .btn { min-height: 40px; }
[data-lesson="trendlines"] .tll-toolbar .btn[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
[data-lesson="trendlines"] .tll-chart { min-height: 200px; }
[data-lesson="trendlines"] .tll-fig .lesson-figure__media { padding: 0; }
[data-lesson="trendlines"] .tll-readout { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; max-width: 760px; }
[data-lesson="trendlines"] .tll-stat { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); }
[data-lesson="trendlines"] .tll-stat__label { font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-3); }
[data-lesson="trendlines"] .tll-stat__value { font-family: var(--font-mono); font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
[data-lesson="trendlines"] .tll-stat__value small { font-size: 13px; color: var(--text-3); font-weight: 600; }
[data-lesson="trendlines"] .tll-verdict { display: flex; align-items: flex-start; gap: 10px; max-width: 760px; padding: 11px 14px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); font-size: 15.5px; line-height: 1.5; }
[data-lesson="trendlines"] .tll-verdict > .icon { flex: none; margin-top: 3px; }
[data-lesson="trendlines"] .tll-verdict.is-good { border-color: var(--bull); background: var(--bull-soft); }
[data-lesson="trendlines"] .tll-verdict.is-good > .icon { color: var(--bull-strong, var(--bull)); }
[data-lesson="trendlines"] .tll-verdict.is-bad { border-color: var(--bear); background: var(--bear-soft); }
[data-lesson="trendlines"] .tll-verdict.is-bad > .icon { color: var(--bear-strong, var(--bear)); }
[data-lesson="trendlines"] .tll-hint { color: var(--text-3); font-size: 13px; }
[data-lesson="trendlines"] .tll-cta { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; max-width: 760px; padding: 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
[data-lesson="trendlines"] .tll-cta p { margin: 0; flex: 1 1 260px; }
[data-lesson="trendlines"] .tll-mini svg { display: block; width: 100%; height: auto; }
@media (max-width: 519.98px) {
  [data-lesson="trendlines"] .tll-readout { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  [data-lesson="trendlines"] .tll-readout .tll-stat:last-child { grid-column: 1 / -1; }
}
@media (hover: none) and (pointer: coarse) { [data-lesson="trendlines"] .tll-hint { display: none; } }
`;

const chartH = () => (window.innerWidth < 600 ? 280 : 330);
const P = (line, idx) => ({ idx, price: lineAt(line, idx) });

function injectStyle() {
  const el = document.createElement('style');
  el.setAttribute('data-module', 'lesson-trendlines');
  el.textContent = CSS;
  document.head.append(el);
  return () => el.remove();
}

/** Cancellable animation helper: tweens and waits that stop on replay / step change. */
function runner() {
  let token = 0;
  let current = null;
  const timers = new Set();
  const api = {
    start() {
      api.stop();
      return token;
    },
    alive: (t) => t === token,
    tween(opts) {
      current = tween(opts);
      return current;
    },
    wait(ms) {
      if (reducedMotion() || !(ms > 0)) return Promise.resolve();
      return new Promise((resolve) => {
        const id = setTimeout(() => {
          timers.delete(id);
          resolve();
        }, ms);
        timers.add(id);
      });
    },
    stop() {
      token += 1;
      current?.cancel?.();
      for (const id of timers) clearTimeout(id);
      timers.clear();
    },
  };
  return api;
}

/** Figure with a chart host (charts may use arrows: data-keys="capture"). */
function chartFigure(caption, label) {
  const host = h('div', { class: 'tll-chart', 'data-keys': 'capture' });
  return { host, fig: figure(host, caption, { label, wide: true, className: 'tll-fig' }) };
}

const replayButton = (onClick) => h('button', { type: 'button', class: 'btn btn--sm', 'data-action': 'replay', on: { click: onClick } }, icon('restart', { size: 15 }), h('span', null, 'Replay'));

/** Grows a segment from point to point (the line "draws itself"), ringing each point. */
async function drawThrough(chart, run, t, pts, { color = 'accent', width = 2.5, ringColor = color, ms = 650, onPoint } = {}) {
  const id = chart.addSegment({ a: pts[0], b: pts[0], color, width });
  chart.addMarker({ idx: pts[0].idx, price: pts[0].price, position: 'at', shape: 'ring', color: ringColor, pulse: true });
  onPoint?.(0);
  for (let k = 1; k < pts.length; k++) {
    const from = { idx: pts[k - 1].idx, price: pts[k - 1].price };
    const to = { idx: pts[k].idx, price: pts[k].price };
    const ok = await run.tween({ from, to, duration: ms, onUpdate: (v) => chart.update(id, { b: { idx: v.idx, price: v.price } }) });
    if (!ok && !run.alive(t)) return id;
    if (!run.alive(t)) return id;
    chart.update(id, { b: to });
    chart.addMarker({ idx: to.idx, price: to.price, position: 'at', shape: 'ring', color: ringColor, pulse: true });
    onPoint?.(k);
    await run.wait(160);
    if (!run.alive(t)) return id;
  }
  return id;
}

/** Stat cells + verdict box for the drawing widgets. */
function readoutUI(labels) {
  const cells = labels.map((l) => {
    const v = h('span', { class: 'tll-stat__value' }, '–');
    return { el: h('div', { class: 'tll-stat' }, h('span', { class: 'tll-stat__label' }, l), v), v };
  });
  const verdict = h('div', { class: 'tll-verdict', 'aria-live': 'polite' });
  const setVerdict = (kind, html) => {
    verdict.className = `tll-verdict${kind ? ` is-${kind}` : ''}`;
    verdict.replaceChildren(icon(kind === 'good' ? 'check' : kind === 'bad' ? 'x' : 'info', { size: 18 }), h('span', { html }));
  };
  return { grid: h('div', { class: 'tll-readout' }, cells.map((c) => c.el)), cells, verdict, setVerdict };
}

/** Plain-English verdict for an uptrend line drawn in the lesson widgets. */
function lineVerdict(ev) {
  const T = ev.touches.length;
  const V = ev.violations.length;
  if (ev.length < 2) return ['bad', 'Too short: connect two swing lows a few candles apart.'];
  if (!ev.slopeOk) return ['bad', '<strong>Wrong slope.</strong> An uptrend line rises from left to right, through higher lows.'];
  if (!ev.sideOk) return ['bad', ev.aboveFrac < 0.35 ? '<strong>Wrong side.</strong> An uptrend line goes <strong>under</strong> price, along the swing lows.' : '<strong>Cuts through price.</strong> A trend line sits under the swing lows, not through the middle of the candles.'];
  if (V > 0) return ['bad', `<strong>${V} ${V === 1 ? 'candle closes' : 'candles close'} below your line</strong> (red dots). Move it down onto the swing lows so price stays above it.`];
  if (T < 2) return ['bad', 'Anchor the line on the tips of two swing lows.'];
  if (T === 2) return ['info', '<strong>Drawn, not yet confirmed:</strong> 2 touches. Tilt it until a third swing low sits on the line.'];
  return ['good', `<strong>Valid: ${T} touches, no closes through.</strong> That is a trend line worth watching.`];
}

// ------------------------------------------------------------------ steps

function whatStep() {
  return {
    title: 'What a trend line is',
    render(el, step, shell) {
      const run = runner();
      const rng = lessonRng(shell, 'what');
      const scs = {
        up: makeTrendChart(rng.fork('up'), { dir: 'up', difficulty: 0.1, touches: 4 }),
        down: makeTrendChart(rng.fork('down'), { dir: 'down', difficulty: 0.1, touches: 4 }),
      };
      let dir = 'up';
      let chart = null;
      el.append(
        h('p', { html: 'A <strong>swing low</strong> is a dip with higher lows on both sides of it: a spot where buyers stepped in. A <strong>swing high</strong> is the mirror image, a peak where sellers took over.' }),
        h('p', { html: 'In an <strong>uptrend</strong>, a trend line joins the rising swing lows and sits <strong>under</strong> price. In a <strong>downtrend</strong>, it joins the falling swing highs and sits <strong>above</strong> price.' }));
      const upBtn = h('button', { type: 'button', 'aria-pressed': 'true', 'data-dir': 'up' }, 'Uptrend');
      const downBtn = h('button', { type: 'button', 'aria-pressed': 'false', 'data-dir': 'down' }, 'Downtrend');
      const { host, fig } = chartFigure('The line draws itself from swing to swing, then projects to the right: that is where traders expect price to find buyers (or sellers) next time.', 'Figure 1');
      el.append(h('div', { class: 'tll-toolbar' }, h('div', { class: 'segmented', role: 'group', 'aria-label': 'Trend direction' }, upBtn, downBtn), replayButton(() => play())), fig,
        h('p', { html: 'The line is a map of where the trend has been paying attention. While price stays on the right side of it, the trend is intact.' }));

      const build = () => {
        chart?.destroy();
        const sc = scs[dir];
        chart = new CandleChart(host, { candles: sc.candles, visible: sc.n, slots: sc.n + 6, height: chartH(), yPad: 0.12, legend: false, ariaLabel: `${dir === 'up' ? 'Uptrend' : 'Downtrend'} with its trend line drawn through the swing ${dir === 'up' ? 'lows' : 'highs'}` });
      };
      const play = async () => {
        const t = run.start();
        const sc = scs[dir];
        chart.clearOverlays();
        const line = sc.ideal.line;
        const pts = sc.ideal.ev.touches.map((i) => P(line, i));
        await run.wait(250);
        if (!run.alive(t)) return;
        const id = await drawThrough(chart, run, t, pts, {
          onPoint: (k) => {
            if (k === 0) chart.addMarker({ idx: pts[0].idx, price: pts[0].price, position: dir === 'up' ? 'below' : 'above', shape: 'tag', color: 'accent', text: dir === 'up' ? 'Swing low' : 'Swing high' });
          },
        });
        if (!run.alive(t)) return;
        const last = pts[pts.length - 1];
        chart.addSegment({ a: last, b: P(line, sc.n + 5), color: 'accent', width: 1.75, dashed: '6 5' });
        chart.update(id, { label: dir === 'up' ? 'Uptrend line' : 'Downtrend line' });
      };
      const pick = (d) => {
        if (d === dir) return;
        dir = d;
        upBtn.setAttribute('aria-pressed', String(d === 'up'));
        downBtn.setAttribute('aria-pressed', String(d === 'down'));
        sfx.click();
        run.stop();
        build();
        play();
      };
      upBtn.addEventListener('click', () => pick('up'));
      downBtn.addEventListener('click', () => pick('down'));
      build();
      play();
      return () => {
        run.stop();
        chart?.destroy();
      };
    },
  };
}

function thirdTouchStep() {
  return {
    title: 'Two points draw it, the third confirms it',
    render(el, step, shell) {
      const run = runner();
      const sc = makeTrendChart(lessonRng(shell, 'third'), { dir: 'up', difficulty: 0.15, touches: 3 });
      const line = sc.ideal.line;
      const [t1, t2, t3] = sc.ideal.ev.touches;
      el.append(h('p', { html: 'Any two points make a line, so two touches only give you a <strong>possible</strong> trend line.' }));
      const { host, fig } = chartFigure('Two swing lows draw the line. When price comes back to it and bounces a third time, the line is confirmed.', 'Figure 2');
      el.append(h('div', { class: 'tll-toolbar' }, h('span', { class: 'faint' }, 'Watch the third touch.'), replayButton(() => play())), fig,
        h('p', { html: 'The <strong>third touch</strong> is the test. If price returns to the line and bounces again, other traders are clearly watching it too. Every extra touch makes the line more respected, and makes a break of it more meaningful.' }));
      const chart = new CandleChart(host, { candles: sc.candles, visible: t2 + 4, slots: sc.n + 6, height: chartH(), yPad: 0.12, legend: false, ariaLabel: 'Uptrend: a line through two swing lows, then a third touch' });
      const play = async () => {
        const t = run.start();
        chart.clearOverlays();
        chart.setVisible(t2 + 4);
        await run.wait(350);
        if (!run.alive(t)) return;
        const id = await drawThrough(chart, run, t, [P(line, t1), P(line, t2)]);
        if (!run.alive(t)) return;
        chart.update(id, { label: '2 touches: a possible line' });
        const proj = chart.addSegment({ a: P(line, t2), b: P(line, sc.n + 5), color: 'accent', width: 1.75, dashed: '6 5' });
        await run.wait(700);
        if (!run.alive(t)) return;
        await chart.reveal({ to: t3 + 1, interval: reducedMotion() ? 0 : 150 });
        if (!run.alive(t)) return;
        chart.update(id, { b: P(line, t3), color: 'bull', label: null });
        chart.update(proj, { a: P(line, t3), color: 'bull' });
        chart.addMarker({ idx: t3, price: lineAt(line, t3), position: 'at', shape: 'ring', color: 'bull', pulse: true });
        chart.addMarker({ idx: t3, position: 'below', shape: 'tag', color: 'bull', text: '3rd touch: confirmed', pulse: true });
        chart.flash(t3, 'bull');
        await run.wait(500);
        if (!run.alive(t)) return;
        await chart.reveal({ to: sc.n, interval: reducedMotion() ? 0 : 90 });
      };
      play();
      return () => {
        run.stop();
        chart.destroy();
      };
    },
    quiz: {
      question: 'Price has touched a rising line twice and now returns to it a third time and bounces. What does that third touch tell you?',
      options: [
        { label: 'The line is confirmed: traders are respecting it', value: 'confirmed' },
        { label: 'Nothing: only the first two points matter', value: 'nothing' },
        { label: 'The trend is now guaranteed to continue', value: 'guaranteed' },
        { label: 'The line will certainly break on the next touch', value: 'break' },
      ],
      answer: 'confirmed',
      explain: '<strong>It confirms the line.</strong> Two points always make a line; a third bounce shows the market is respecting it. Nothing is guaranteed, though: a confirmed line can still break.',
    },
  };
}

function drawStep() {
  return {
    title: 'Try it: draw a trend line',
    locked: true,
    render(el, step, shell) {
      const sc = makeTrendChart(lessonRng(shell, 'draw'), { dir: 'up', difficulty: 0.3, touches: 4 });
      const { candles: C, n, st, piv } = sc;
      el.append(h('p', { html: 'Drag from one swing low to another (or tap two points). Then drag the round handles to fine-tune. The readout checks your line live: <strong>touches</strong> on swing lows, and <strong>closes through</strong> the line from its start to the right edge.' }));
      const againBtn = h('button', { type: 'button', class: 'btn btn--sm', 'data-action': 'draw-again' }, icon('restart', { size: 15 }), 'Draw again');
      const snapBtn = h('button', { type: 'button', class: 'btn btn--sm', 'aria-pressed': 'true', 'data-action': 'snap' }, icon('target', { size: 15 }), 'Snap to candles');
      const showBtn = h('button', { type: 'button', class: 'btn btn--sm btn--ghost', 'data-action': 'show-me' }, icon('eye', { size: 15 }), 'Show me');
      const { host, fig } = chartFigure('Your trend line. Green rings mark touches, red dots mark closes through the line.', 'Figure 3');
      const ro = readoutUI(['Touches', 'Closes through', 'Best line']);
      el.append(h('div', { class: 'tll-toolbar', 'data-keys': 'capture' }, h('div', { class: 'tll-toolbar__group' }, againBtn, snapBtn, showBtn),
        h('span', { class: 'tll-hint' }, kbdHint(['←', '→', '↑', '↓', 'Enter'], 'or draw with the keyboard'))), fig, ro.grid, ro.verdict);
      ro.setVerdict('info', 'Draw a line under the rising swing lows.');
      const ideal = sc.ideal;
      ro.cells[2].v.replaceChildren(String(ideal.ev.touches.length), h('small', null, ' touches'));
      const chart = new CandleChart(host, { candles: C, visible: n, slots: n + 6, height: chartH(), yPad: 0.12, ariaLabel: 'Uptrend chart: draw a trend line under the swing lows' });
      let snap = true;
      let lineId = null;
      let marks = [];
      let token = 0;
      let unlocked = false;

      const evaluate = (line) => {
        for (const id of marks) chart.remove(id);
        marks = [];
        const ev = evaluateLine(C, line, { dir: 'up', st, piv });
        for (const i of ev.touches) marks.push(chart.addMarker({ idx: i, price: lineAt(line, i), position: 'at', shape: 'ring', color: 'bull' }));
        for (const i of ev.violations.slice(0, 12)) marks.push(chart.addMarker({ idx: i, price: C[i].c, position: 'at', shape: 'dot', color: 'bear' }));
        ro.cells[0].v.textContent = String(ev.touches.length);
        ro.cells[1].v.textContent = String(ev.violations.length);
        const [kind, html] = lineVerdict(ev);
        ro.setVerdict(kind, html);
        if (kind === 'good' && !unlocked) {
          unlocked = true;
          sfx.correct();
          shell.unlock();
        }
        return ev;
      };
      const place = (a, b) => {
        lineId = chart.addSegment({ a, b, color: 'accent', width: 2.5, extend: 'right', snap: snap ? 'ohlc' : false });
        chart.setDraggable(lineId, (spec) => evaluate({ a: spec.a, b: spec.b }));
        evaluate({ a, b });
      };
      const start = () => {
        const my = ++token;
        chart.draw('segment', { snap: snap ? 'ohlc' : false, color: 'accent', keep: false }).then((shape) => {
          if (!shape || my !== token) return;
          sfx.click();
          place(shape.a, shape.b);
        });
      };
      const reset = () => {
        if (lineId) chart.remove(lineId);
        lineId = null;
        for (const id of marks) chart.remove(id);
        marks = [];
        ro.cells[0].v.textContent = '–';
        ro.cells[1].v.textContent = '–';
        ro.setVerdict('info', 'Draw a line under the rising swing lows.');
        chart.cancelDraw();
      };
      againBtn.addEventListener('click', () => {
        sfx.click();
        reset();
        start();
      });
      snapBtn.addEventListener('click', () => {
        snap = !snap;
        snapBtn.setAttribute('aria-pressed', String(snap));
        if (lineId) chart.update(lineId, { snap: snap ? 'ohlc' : false });
        if (chart.isDrawing) start();
      });
      showBtn.addEventListener('click', () => {
        reset();
        token += 1;
        const o = ordered(ideal.line);
        place(o.a, o.b);
      });
      start();
      return () => {
        token += 1;
        chart.destroy();
      };
    },
  };
}

function wicksStep() {
  const good = (rng) => {
    const sc = makeTrendChart(rng, { dir: 'up', difficulty: 0.2, touches: 4 });
    const line = sc.ideal.line;
    const C = sc.candles.slice(0, sc.n);
    return {
      candles: C,
      overlays: [
        { type: 'segment', ...span(line, lineStart(line), sc.n - 1), color: 'bull', width: 2.25 },
        ...sc.ideal.ev.touches.map((i) => ({ type: 'marker', idx: i, price: lineAt(line, i), position: 'at', shape: 'ring', color: 'bull' })),
      ],
    };
  };
  const forced = (rng) => {
    // A line aimed at a favourite point (a body top): steeper than the swings allow, so it slices
    // through bodies and has closes below it. Validated: at least two closes through.
    for (let k = 0; k < 20; k++) {
      const sc = makeTrendChart(rng.fork(`f${k}`), { dir: 'up', difficulty: 0.2, touches: 4 });
      const C = sc.candles;
      const [t1, , t3] = sc.ideal.ev.touches;
      const k3 = C[t3];
      const line = { a: { idx: t1, price: C[t1].l }, b: { idx: t3, price: Math.max(k3.o, k3.c) } };
      const ev = evaluateLine(C, line, { dir: 'up', st: sc.st, piv: sc.piv });
      if (ev.violations.length < 2) continue;
      return {
        candles: C.slice(0, sc.n),
        overlays: [
          { type: 'segment', ...span(line, t1, sc.n - 1), color: 'bear', width: 2.25 },
          ...ev.violations.slice(0, 10).map((i) => ({ type: 'marker', idx: i, price: C[i].c, position: 'at', shape: 'dot', color: 'bear' })),
        ],
      };
    }
    return good(rng);
  };
  return compareStep({
    title: 'Wicks or bodies?',
    text: [
      'Some traders draw through the candle <strong>bodies</strong> (the opens and closes) instead of the wick tips. Either works if you are consistent: pick one method and use it on every chart. Most traders use the <strong>wicks</strong>, because a wick shows where price actually traded.',
      'What never works is <strong>forcing</strong> a line: choosing the points you like first, then cutting through candles to make it fit.',
    ],
    left: {
      title: 'Wick to wick',
      verdict: 'good',
      tag: 'Valid',
      example: good,
      points: ['Anchored on the tips of the swing lows', 'No candle closes below it', 'Several touches, found by the market, not chosen'],
    },
    right: {
      title: 'Forced line',
      verdict: 'bad',
      tag: 'Forced',
      example: forced,
      points: ['Aimed at a favourite point, so it slices through bodies', 'Candles close below it (red dots): price already disagrees', 'A line that needs excuses is not a trend line'],
    },
    height: 230,
    after: 'A wick poking a little through a line is normal. Several closes through it mean the line is in the wrong place.',
  });
}

function steepStep() {
  return {
    title: 'Steepness: steep lines break sooner',
    render(el, step, shell) {
      const run = runner();
      const sc = makeSteepChart(lessonRng(shell, 'steep'));
      const [t1, t2, t3, t4] = sc.touches;
      const { steep, moderate } = sc;
      const brk = sc.breakIdx ?? t2 + 6;
      el.append(h('p', { html: 'The steeper the line, the faster price has to keep climbing to stay above it. Few trends keep up a steep pace for long, so <strong>steep lines break sooner</strong> and more often.' }));
      const { host, fig } = chartFigure('The first two lows give a steep line. Price soon closes below it, yet the uptrend continues along a moderate line through the later lows.', 'Figure 5');
      el.append(h('div', { class: 'tll-toolbar' }, h('span', { class: 'faint' }, 'Steep line versus moderate line.'), replayButton(() => play())), fig,
        h('p', { html: 'A steep line breaking often just means the trend is <strong>slowing down</strong>. If price keeps making higher lows, redraw through the newer swings instead of forcing the old line. Judge steepness against the swings, not with a protractor: the angle on screen depends on how the chart is scaled.' }));
      const chart = new CandleChart(host, { candles: sc.candles, visible: t2 + 5, slots: sc.n + 4, height: chartH(), yPad: 0.12, legend: false, ariaLabel: 'An uptrend with a steep trend line that breaks and a moderate one that holds' });
      const play = async () => {
        const t = run.start();
        chart.clearOverlays();
        chart.setVisible(t2 + 5);
        await run.wait(300);
        if (!run.alive(t)) return;
        const sid = await drawThrough(chart, run, t, [P(steep, t1), P(steep, t2)], { color: 'warn' });
        if (!run.alive(t)) return;
        chart.update(sid, { label: 'Steep line' });
        chart.addSegment({ a: P(steep, t2), b: P(steep, Math.min(sc.n - 1, brk + 4)), color: 'warn', width: 1.75, dashed: '6 5' });
        await run.wait(500);
        if (!run.alive(t)) return;
        await chart.reveal({ to: brk + 1, interval: reducedMotion() ? 0 : 140 });
        if (!run.alive(t)) return;
        chart.addMarker({ idx: brk, position: 'below', shape: 'arrow', color: 'bear', text: 'Steep line breaks', pulse: true });
        await run.wait(800);
        if (!run.alive(t)) return;
        await chart.reveal({ to: t3 + 3, interval: reducedMotion() ? 0 : 110 });
        if (!run.alive(t)) return;
        const mid = await drawThrough(chart, run, t, [P(moderate, t1), P(moderate, t3)], { color: 'bull', ringColor: 'bull' });
        if (!run.alive(t)) return;
        chart.update(mid, { label: 'Moderate line holds' });
        await chart.reveal({ to: sc.n, interval: reducedMotion() ? 0 : 90 });
        if (!run.alive(t)) return;
        chart.update(mid, { b: P(moderate, sc.n - 1) });
        chart.addMarker({ idx: t4, price: lineAt(moderate, t4), position: 'at', shape: 'ring', color: 'bull', pulse: true });
      };
      play();
      return () => {
        run.stop();
        chart.destroy();
      };
    },
    quiz: {
      question: 'A very steep uptrend line just broke, but price is still making higher lows. What is the most sensible reading?',
      options: [
        { label: 'The trend is slowing: look for a shallower line through the newer lows', value: 'slowing' },
        { label: 'The uptrend has definitely reversed', value: 'reversed' },
        { label: 'Redraw the steep line through the candle bodies so it has not broken', value: 'redraw' },
        { label: 'Trend lines never matter', value: 'never' },
      ],
      answer: 'slowing',
      explain: '<strong>The pace is slowing, not necessarily the trend.</strong> Higher lows mean buyers are still in charge. A shallower line through the newer swings describes the trend better. Moving your method to rescue a broken line is forcing it.',
    },
  };
}

function channelStep() {
  return {
    title: 'Channels: add the parallel line',
    locked: true,
    render(el, step, shell) {
      const sc = makeTrendChart(lessonRng(shell, 'channel'), { dir: 'up', difficulty: 0.15, channel: true, touches: 4 });
      const { candles: C, n, st, piv } = sc;
      el.append(
        h('p', { html: 'A <strong>channel</strong> adds a second line, parallel to the trend line, through the swings on the other side of price: the swing highs in an uptrend, the swing lows in a downtrend. Price then swings between the two lines.' }),
        h('p', { html: '<strong>Try it:</strong> draw the trend line under the swing lows. The channel line snaps into place, parallel, through the highest swing high.' }));
      const againBtn = h('button', { type: 'button', class: 'btn btn--sm', 'data-action': 'draw-again' }, icon('restart', { size: 15 }), 'Draw again');
      const showBtn = h('button', { type: 'button', class: 'btn btn--sm btn--ghost', 'data-action': 'show-me' }, icon('eye', { size: 15 }), 'Show me');
      const { host, fig } = chartFigure('The trend line (gold) and its parallel channel line (blue). Traders buy near the lower line and take profit near the upper one.', 'Figure 6');
      const ro = readoutUI(['Trend line touches', 'Channel touches', 'Closes through']);
      el.append(h('div', { class: 'tll-toolbar', 'data-keys': 'capture' }, h('div', { class: 'tll-toolbar__group' }, againBtn, showBtn)), fig, ro.grid, ro.verdict,
        h('p', { html: 'A rally that <strong>fails to reach</strong> the channel line is an early warning that the trend is losing steam. A strong push through the channel line is the opposite: the trend is speeding up, and the old channel no longer describes it.' }));
      ro.setVerdict('info', 'Draw the trend line under the swing lows.');
      const chart = new CandleChart(host, { candles: C, visible: n, slots: n + 6, height: chartH(), yPad: 0.12, ariaLabel: 'Rising channel: draw the trend line, the channel line follows' });
      let lineId = null;
      let chId = null;
      let marks = [];
      let token = 0;
      let unlocked = false;
      const update = (line) => {
        for (const id of marks) chart.remove(id);
        marks = [];
        const ev = evaluateLine(C, line, { dir: 'up', st, piv });
        const ch = channelFor(C, line, { dir: 'up', st, piv });
        const o = ordered(line);
        const spec = { a: { idx: o.a.idx, price: o.a.price + ch.offset }, b: { idx: o.b.idx, price: o.b.price + ch.offset }, extend: 'right', color: 'info', width: 2, dashed: '7 4', label: 'Channel line' };
        if (chId) chart.update(chId, spec);
        else chId = chart.addSegment(spec);
        for (const i of ev.touches) marks.push(chart.addMarker({ idx: i, price: lineAt(line, i), position: 'at', shape: 'ring', color: 'bull' }));
        for (const i of ch.ev.touches) marks.push(chart.addMarker({ idx: i, price: lineAt(ch.line, i), position: 'at', shape: 'ring', color: 'info' }));
        for (const i of ev.violations.slice(0, 12)) marks.push(chart.addMarker({ idx: i, price: C[i].c, position: 'at', shape: 'dot', color: 'bear' }));
        ro.cells[0].v.textContent = String(ev.touches.length);
        ro.cells[1].v.textContent = String(ch.ev.touches.length);
        ro.cells[2].v.textContent = String(ev.violations.length);
        const [kind, html] = lineVerdict(ev);
        if (kind === 'good' || (kind === 'info' && ev.touches.length === 2)) {
          ro.setVerdict(kind === 'good' ? 'good' : 'info', `${html} The channel line touches <strong>${ch.ev.touches.length}</strong> swing highs: price is swinging inside the channel.`);
          if (!unlocked) {
            unlocked = true;
            if (kind === 'good') sfx.correct();
            shell.unlock();
          }
        } else ro.setVerdict(kind, html);
      };
      const place = (a, b) => {
        lineId = chart.addSegment({ a, b, color: 'accent', width: 2.5, extend: 'right', snap: 'ohlc' });
        chart.setDraggable(lineId, (spec) => update({ a: spec.a, b: spec.b }));
        update({ a, b });
      };
      const start = () => {
        const my = ++token;
        chart.draw('segment', { snap: 'ohlc', color: 'accent', keep: false }).then((shape) => {
          if (!shape || my !== token) return;
          sfx.click();
          place(shape.a, shape.b);
        });
      };
      const reset = () => {
        for (const id of [lineId, chId, ...marks]) if (id) chart.remove(id);
        lineId = chId = null;
        marks = [];
        for (const c of ro.cells) c.v.textContent = '–';
        ro.setVerdict('info', 'Draw the trend line under the swing lows.');
        chart.cancelDraw();
      };
      againBtn.addEventListener('click', () => {
        sfx.click();
        reset();
        start();
      });
      showBtn.addEventListener('click', () => {
        reset();
        token += 1;
        const o = ordered(sc.ideal.line);
        place(o.a, o.b);
      });
      start();
      return () => {
        token += 1;
        chart.destroy();
      };
    },
  };
}

function bounceStory(rng) {
  let sc = null;
  let plan = null;
  for (let k = 0; k < 24; k++) {
    const cand = makeHoldBreak(rng.fork(`bounce-${k}`), { dir: 'up', outcome: 'hold', difficulty: 0.1, confirm: true, after: 16 });
    const { candles: C, t, line, tells } = cand;
    const entry = C[t + 1].c;
    const stop = Math.min(C[t].l, lineAt(line, t)) - 0.3 * cand.st.avgRange;
    const target = C[tells.peakLast].h;
    const risk = entry - stop;
    const reached = C.slice(t + 2).some((c) => c.h >= target);
    const heldAbove = C.slice(t + 2).every((c) => c.l > stop);
    sc = cand;
    plan = { entry, stop, target, rr: (target - entry) / risk };
    if (reached && heldAbove && plan.rr >= 1.5) break;
  }
  const { candles: C, t, line, touches } = sc;
  const [t1, t2, t3] = touches;
  const end = C.length - 1;
  return {
    candles: C,
    indicators: { volume: false },
    frames: [
      {
        to: t2 + 4,
        title: 'Context.',
        caption: 'An uptrend: higher highs and higher lows. Two swing lows give a possible trend line.',
        overlays: [
          { type: 'segment', ...span(line, t1, end), color: 'accent', width: 2 },
          { type: 'marker', idx: t1, price: lineAt(line, t1), position: 'at', shape: 'ring', color: 'accent' },
          { type: 'marker', idx: t2, price: lineAt(line, t2), position: 'at', shape: 'ring', color: 'accent' },
        ],
      },
      {
        to: t3 + 4,
        title: 'Confirmed.',
        caption: 'Price comes back to the line and bounces again: the third touch confirms it.',
        overlays: [{ type: 'marker', idx: t3, price: lineAt(line, t3), position: 'at', shape: 'ring', color: 'bull' }],
      },
      {
        to: t + 1,
        title: 'Trigger.',
        caption: 'A fourth pullback reaches the line. The test candle wicks into it and closes near its high: buyers defend it.',
        overlays: [{ type: 'box', from: t, to: t, color: 'bull', label: 'Test' }],
        focus: [Math.max(0, t - 18), t],
      },
      {
        to: t + 2,
        title: 'Confirmation.',
        caption: 'The next candle closes above the test candle’s high. Buyers followed through: that close is the entry.',
        overlays: [{ type: 'marker', idx: t + 1, position: 'below', shape: 'arrow', color: 'accent', text: 'Entry' }],
      },
      {
        to: t + 2,
        title: 'The plan.',
        caption: `Stop under the test low, on the other side of the line. Target: the last swing high, about ${plan.rr.toFixed(1)} times the risk.`,
        overlays: [
          { type: 'hline', price: plan.stop, color: 'bear', label: 'Stop', from: t - 6 },
          { type: 'hline', price: plan.target, color: 'bull', label: 'Target', from: t - 6 },
        ],
      },
      {
        to: C.length,
        title: 'Outcome.',
        caption: 'The line held and price reached the target. It will not always: the stop caps the loss if the line breaks.',
      },
    ],
  };
}

function breakStory(rng) {
  const sc = makeHoldBreak(rng, { dir: 'up', outcome: 'break', difficulty: 0.1, after: 14 });
  const { candles: C, t, line, touches, tells, result } = sc;
  const [t1, t2, t3] = touches;
  const end = C.length - 1;
  const b = result.breakIdx;
  const rt = result.retestIdx ?? Math.min(end, b + 4);
  return {
    candles: C,
    indicators: { volume: true },
    frames: [
      {
        to: t3 + 4,
        title: 'An established line.',
        caption: 'A rising trend line with three touches. Buyers have defended it every time.',
        overlays: [
          { type: 'segment', ...span(line, t1, end), color: 'accent', width: 2 },
          ...[t1, t2, t3].map((i) => ({ type: 'marker', idx: i, price: lineAt(line, i), position: 'at', shape: 'ring', color: 'accent' })),
        ],
      },
      {
        to: tells.peakLast + 3,
        title: 'Warning sign.',
        caption: 'The next rally fails to make a new high: a lower high. Buyers are running out of steam.',
        overlays: [{ type: 'path', points: [{ idx: tells.peakPrev, price: C[tells.peakPrev].h }, { idx: tells.peakLast, price: C[tells.peakLast].h }], color: 'bear', width: 1.75, dashed: '4 3', labels: ['', 'Lower high'] }],
      },
      {
        to: t + 1,
        title: 'Pressure.',
        caption: 'Price drops back to the line on heavy volume, and the test candle closes weak, near its low.',
        overlays: [{ type: 'box', from: tells.peakLast + 1, to: t, color: 'bear', label: 'Heavy selling' }],
        focus: [tells.peakLast - 4, t],
      },
      {
        to: b + 1,
        title: 'The break.',
        caption: 'A candle closes clearly below the line. The trend line has broken.',
        overlays: [{ type: 'marker', idx: b, position: 'below', shape: 'arrow', color: 'bear', text: 'Break' }],
      },
      {
        to: rt + 1,
        title: 'The retest.',
        caption: 'Price rallies back up to the underside of the line and stalls: old support now acts as resistance.',
        overlays: [{ type: 'marker', idx: rt, position: 'above', shape: 'arrow', color: 'info', text: 'Retest' }],
      },
      {
        to: C.length,
        title: 'Continue.',
        caption: 'Price turns lower again. Break, retest, continue: the uptrend is over for now. A close back above the line would cancel that read.',
      },
    ],
  };
}

function realStep() {
  return realExampleStep({
    title: 'A real trend line',
    kinds: ['trend-up', 'trend-down'],
    intervals: ['1d', '1w'],
    before: 60,
    after: 20,
    text: [
      'Here is a trend the setup scanner found in real market data. The gold line is the best trend line through the real swings <strong>up to the point where the trend was confirmed</strong> (the arrow): the most touches with no closes through it.',
      'The candles after the arrow show what happened next. Real lines are messier than textbook ones: wicks poke through and touches are near misses. Look for the same rules, not a perfect picture.',
    ],
    caption: 'Rings mark the touches. If price later closed through the line, the break is marked.',
    annotate(setup, chart, ex) {
      const rt = realTrend({ candles: ex.candles, decisionIdx: ex.decisionIdx, setup });
      if (!rt) {
        annotateSetup(setup, chart, ex);
        return;
      }
      const off = rt.offset || 0;
      const up = rt.dir === 'up';
      const L = rt.ideal.line;
      const shifted = { a: { idx: L.a.idx + off, price: L.a.price }, b: { idx: L.b.idx + off, price: L.b.price } };
      const last = ex.candles.length - 1;
      chart.addSegment({ ...span(shifted, Math.min(shifted.a.idx, shifted.b.idx), last), color: 'accent', width: 2.25, label: up ? 'Uptrend line' : 'Downtrend line' });
      for (const i of rt.ideal.ev.touches) chart.addMarker({ idx: i + off, price: lineAt(shifted, i + off), position: 'at', shape: 'ring', color: 'accent' });
      chart.addMarker({ idx: ex.decisionIdx, position: up ? 'above' : 'below', shape: 'arrow', color: 'info', text: 'Trend confirmed' });
      if (rt.after > 0) {
        const out = outcomeAfter(rt.candles, L, rt.n - 1, { dir: rt.dir, st: rt.st, bars: rt.after });
        if (out.broke) chart.addMarker({ idx: out.breakIdx + off, position: up ? 'below' : 'above', shape: 'arrow', color: 'warn', text: 'Break' });
      }
    },
    fallback(rng) {
      const dir = rng.chance(0.5) ? 'up' : 'down';
      const sc = makeTrendChart(rng, { dir, difficulty: 0.35 });
      const n = sc.n;
      return {
        candles: sc.candles.slice(0, n),
        decisionIdx: n - 1,
        setup: { kind: dir === 'up' ? 'trend-up' : 'trend-down', start: 0, end: n - 1, decisionIdx: n - 1, direction: dir === 'up' ? 'bullish' : 'bearish', meta: { name: dir === 'up' ? 'Uptrend' : 'Downtrend' } },
      };
    },
  });
}

function takeawayStep(ctx) {
  return {
    title: 'Key takeaways',
    render(el, step, shell) {
      const sc = makeTrendChart(lessonRng(shell, 'summary'), { dir: 'up', difficulty: 0.1, channel: true, touches: 4 });
      const C = sc.candles.slice(0, sc.n);
      const end = sc.n - 1;
      const base = sc.ideal.line;
      const ch = sc.channel.line;
      const x0 = lineStart(base);
      const overlays = [
        { type: 'segment', ...span(base, x0, end), color: 'accent', width: 2.25, label: 'Trend line' },
        { type: 'segment', ...span(ch, x0, end), color: 'info', width: 2, dashed: '7 4', label: 'Channel line' },
        ...sc.ideal.ev.touches.map((i) => ({ type: 'marker', idx: i, price: lineAt(base, i), position: 'at', shape: 'ring', color: 'bull' })),
      ];
      const art = miniChart(C, { width: 760, height: 250, overlays, yPad: 0.08, ariaLabel: 'Summary: an uptrend with its trend line under the swing lows and a parallel channel line above' });
      el.append(
        figure(h('div', { class: 'tll-mini' }, art), 'The whole picture: a trend line through the rising swing lows, confirmed by its touches (green rings), and a parallel channel line through the highs.', { label: 'Figure 9', wide: true }),
        takeaway([
          'Uptrend: join the rising swing lows <strong>under</strong> price. Downtrend: join the falling swing highs <strong>above</strong> price.',
          'Two touches draw a line; the <strong>third</strong> confirms it. More touches, more respect.',
          'Wicks or bodies, be consistent, and never force a line through candles. Closes through it mean it is in the wrong place, or broken.',
          'Steep lines break sooner. A channel line runs parallel through the opposite swings.',
          'A break of a well-tested line, then a <strong>retest</strong> from the other side, is the classic sign that the trend has ended. Lines tilt the odds; they guarantee nothing.',
        ], { title: 'Key takeaways' }),
        h('div', { class: 'tll-cta' },
          h('p', { html: '<strong>Put it into practice.</strong> In Trendline Challenge you draw lines on textbook and real charts, earn points for clean touches, lose them for closes through, then call Hold or Break.' }),
          h('a', { class: 'btn btn--primary', href: '#g.trendline-challenge', 'data-action': 'play-game' }, icon('play', { size: 16 }), 'Play Trendline Challenge')));
    },
  };
}

export default {
  id: 'trendlines',
  mount(root, ctx) {
    const removeStyle = injectStyle();
    const shell = new LessonShell(root, ctx, {
      intro: 'Draw trend lines and channels that the market actually respects, check them the way traders do, and read what it means when price breaks one.',
      steps: [
        whatStep(),
        thirdTouchStep(),
        drawStep(),
        wicksStep(),
        steepStep(),
        channelStep(),
        storyStep({
          title: 'A trend-line bounce, frame by frame',
          text: 'Step through a trade built on a trend line: the context, the trigger at the line, the confirmation, the plan (entry, stop and target) and the outcome.',
          story: bounceStory,
          height: 320,
          after: 'Notice the order: the line came first, the trigger happened <strong>at</strong> the line, and the stop sat on the far side of it before any entry.',
        }),
        storyStep({
          title: 'Break and retest',
          text: 'Trend lines do break. The classic sequence: warning signs, a close through the line, a retest from the other side, then continuation in the new direction.',
          story: breakStory,
          height: 320,
          after: 'Warning signs before a break: a failed new high (a lower high), heavy volume into the line, and a test candle that closes weak. They tilt the odds; they do not guarantee the break.',
          quiz: {
            question: 'Price closed below a rising trend line, then rallied back up to the underside of it and stalled. What is this called?',
            options: [
              { label: 'A break and retest: old support now acting as resistance', value: 'retest' },
              { label: 'A third touch confirming the uptrend', value: 'third' },
              { label: 'A channel line', value: 'channel' },
              { label: 'A guaranteed reversal back up', value: 'guaranteed' },
            ],
            answer: 'retest',
            explain: '<strong>Break and retest.</strong> After the break, the old line often acts from the other side: price returns to it, stalls and turns away. A close back above the line would cancel that read.',
          },
        }),
        realStep(),
        takeawayStep(ctx),
      ],
    });
    return () => {
      shell.destroy();
      removeStyle();
    };
  },
};
