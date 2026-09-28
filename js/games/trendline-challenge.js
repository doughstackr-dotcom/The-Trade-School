// Trendline Challenge — draw the trend line (and, on channel rounds, the channel line) on a
// trending chart, then call "Hold or break?" when price returns to an established line.
// Textbook charts come from validated generators in ./trendline-challenge-kit.js; Real-market runs
// use scanner trend-up / trend-down windows with the ideal line computed from the real swings.
import { GameShell } from '../core/game-kit.js';
import { CandleChart, miniChart } from '../core/chart.js';
import { h, icon, kbdHint, sfx, meter, setMeter } from '../core/ui.js';
import { reducedMotion } from '../core/anim.js';
import { makeRng } from '../core/rng.js';
import {
  chartContext, evaluateLine, scoreLine, evaluateChannel, channelFor, lineAt, lineStart, ordered,
  makeTrendChart, makeHoldBreak, realTrend, realHoldBreak, outcomeAfter,
} from './trendline-challenge-kit.js';

const ROUNDS = 8;
const DRAW_SECONDS = 50;
const HOLD_SECONDS = 20;
const TREND_KINDS = ['trend-up', 'trend-down'];

const CSS = `
.tlc { display: flex; flex-direction: column; gap: 12px; }
.tlc__head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 8px 16px; }
.tlc__title { margin: 0; font-family: var(--font-display); font-size: 21px; font-weight: 700; line-height: 1.25; text-wrap: balance; }
.tlc__sub { margin: 4px 0 0; color: var(--text-2); font-size: 14.5px; line-height: 1.45; max-width: 62ch; }
.tlc__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.tlc__chart { position: relative; }
.tlc__chart .tc-svg { display: block; }
.tlc__bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; }
.tlc__status { margin: 0; font-size: 14.5px; line-height: 1.45; color: var(--text-2); }
.tlc__status strong { color: var(--text); }
.tlc__bar .tlc__status { flex: 1 1 240px; }
.tlc__tools { display: flex; flex-wrap: wrap; gap: 8px; }
.tlc__tools .btn:disabled { opacity: 0.55; }
.tlc__tools .btn { min-height: 44px; }
.tlc__tools .btn[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
.tlc__key { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; margin-left: 2px; border: 1px solid var(--line); border-radius: 4px; font: 600 11.5px/1 var(--font-mono); color: var(--text-2); background: var(--surface); }
.btn--primary .tlc__key { border-color: transparent; background: rgba(255, 255, 255, 0.22); color: inherit; }
.tlc__kbd { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13px; color: var(--text-3); }
@media (hover: none) and (pointer: coarse) { .tlc__key, .tlc__kbd { display: none; } }
.tlc-choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.tlc-choice { position: relative; display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 12px 14px; border: 1.5px solid var(--line); border-radius: 10px; background: var(--surface-2); color: var(--text); font: inherit; text-align: left; cursor: pointer; transition: border-color 0.15s, background-color 0.15s, transform 0.12s; }
.tlc-choice:hover:not([aria-disabled="true"]) { border-color: var(--accent); }
.tlc-choice:active:not([aria-disabled="true"]) { transform: translateY(1px); }
.tlc-choice__icon { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 50%; background: var(--surface); color: var(--accent); }
.tlc-choice__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tlc-choice__text strong { font-size: 17px; }
.tlc-choice__text small { font-size: 13px; color: var(--text-2); line-height: 1.35; }
.tlc-choice .tlc__key { margin-left: auto; }
.tlc-choice[aria-disabled="true"] { cursor: default; }
.tlc-choice.is-dim { opacity: 0.55; }
.tlc-choice.is-right { border-color: var(--bull); background: var(--bull-soft); }
.tlc-choice.is-wrong { border-color: var(--bear); background: var(--bear-soft); }
.tlc-score { display: grid; gap: 10px; }
.tlc-score__top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.tlc-score__num { font-family: var(--font-mono); font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
.tlc-score__num small { font-size: 14px; color: var(--text-3); font-weight: 600; }
.tlc-score .meter { flex: 1 1 160px; max-width: 280px; }
.tlc-score__list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; font-size: 14.5px; line-height: 1.45; }
.tlc-score__list li { display: flex; align-items: flex-start; gap: 8px; }
.tlc-score__list li > .icon { flex: none; margin-top: 2px; }
.tlc-score__list .is-good > .icon { color: var(--bull); }
.tlc-score__list .is-bad > .icon { color: var(--bear); }
.tlc-score__list .is-info > .icon { color: var(--text-3); }
.tlc-score p { margin: 0; }
.tlc-next { margin: 0; font-size: 14.5px; }
.tlc-next:empty { display: none; }
.tlc-preview { display: grid; place-items: center; padding: 10px; }
.tlc-preview svg { width: 100%; height: auto; max-width: 420px; }
.tlc-preview .tlc-preview__line { stroke-dasharray: 520; stroke-dashoffset: 520; animation: tlc-draw 1.5s 0.3s var(--ease-out, ease-out) forwards; }
.tlc-preview .tlc-preview__chan { stroke-dasharray: 520; stroke-dashoffset: 520; animation: tlc-draw 1.2s 1.6s var(--ease-out, ease-out) forwards; }
.tlc-preview .tc-ring { opacity: 0; animation: tlc-pop 0.35s var(--ease-out, ease-out) forwards; }
@keyframes tlc-draw { to { stroke-dashoffset: 0; } }
@keyframes tlc-pop { from { opacity: 0; transform: scale(0.4); } to { opacity: 1; transform: scale(1); } }
.tlc-preview .tc-ring { transform-box: fill-box; transform-origin: center; }
@media (prefers-reduced-motion: reduce) {
  .tlc-preview .tlc-preview__line, .tlc-preview .tlc-preview__chan { animation: none; stroke-dashoffset: 0; }
  .tlc-preview .tc-ring { animation: none; opacity: 1; }
}
:root[data-motion="reduce"] .tlc-preview .tlc-preview__line, :root[data-motion="reduce"] .tlc-preview .tlc-preview__chan { animation: none; stroke-dashoffset: 0; }
:root[data-motion="reduce"] .tlc-preview .tc-ring { animation: none; opacity: 1; }
.tlc.is-done .tlc__tools, .tlc.is-done .tlc__kbd, .tlc.is-done .tlc__sub { display: none; }
.tlc.is-done .tlc-choice { min-height: 48px; }
.tlc.is-done .tlc-choice small { display: none; }
@media (min-width: 1040px) {
  .tlc { display: grid; grid-template-columns: minmax(0, 1fr) 290px; grid-template-rows: auto auto auto auto auto 1fr; column-gap: 22px; row-gap: 14px; align-items: start; }
  .tlc > * { grid-column: 2; }
  .tlc > .tlc__chart { grid-column: 1; grid-row: 1 / span 6; }
  .tlc__head { flex-direction: column; align-items: flex-start; }
  .tlc__chips { order: -1; }
  .tlc__bar { flex-direction: column; align-items: stretch; }
  .tlc__bar .tlc__status { flex: none; }
  .tlc__tools { flex-direction: column; }
  .tlc__tools .btn { justify-content: flex-start; }
  .tlc__tools .btn .tlc__key { margin-left: auto; }
  .tlc-choices { grid-template-columns: minmax(0, 1fr); }
  .tlc__kbd { flex-direction: column; align-items: flex-start; }
}
@media (max-width: 519.98px) {
  .tlc__title { font-size: 18.5px; }
  .tlc__tools { width: 100%; }
  .tlc__tools .btn { flex: 1 1 auto; padding: 0 12px; }
  .tlc-choice { min-height: 58px; padding: 10px 12px; gap: 10px; }
  .tlc-choice__icon { width: 34px; height: 34px; }
}
`;

function injectStyle() {
  const el = document.createElement('style');
  el.setAttribute('data-module', 'trendline-challenge');
  el.textContent = CSS;
  document.head.append(el);
  return () => el.remove();
}

// ------------------------------------------------------------------ round plan

/** 'draw' | 'hold'. Arcade / Practice: rounds 1–6 draw, the last two hold-or-break. Survival: every 4th. */
function kindOf(g, round) {
  if (g.rounds != null) return round > g.rounds - 2 ? 'hold' : 'draw';
  return round % 4 === 0 ? 'hold' : 'draw';
}
function drawIndex(g, round) {
  return g.rounds != null ? round - 1 : round - 1 - Math.floor(round / 4);
}
function holdIndex(g, round) {
  return g.rounds != null ? round - (g.rounds - 1) : Math.floor(round / 4) - 1;
}
/** Balanced picks: every consecutive pair of rounds of a kind gets one of each item (seeded per run). */
function bag(g, name, i, items) {
  const k = Math.max(0, i);
  const seq = g.rng.fork(`${name}-${Math.floor(k / items.length)}`).shuffle(items);
  return seq[k % items.length];
}

const dirWords = (dir) => (dir === 'up'
  ? { trend: 'uptrend', line: 'uptrend line', swings: 'swing lows', swing: 'swing low', side: 'under', opp: 'swing high', oppSide: 'above', closeSide: 'below', rising: 'rising' }
  : { trend: 'downtrend', line: 'downtrend line', swings: 'swing highs', swing: 'swing high', side: 'above', opp: 'swing low', oppSide: 'below', closeSide: 'above', rising: 'falling' });

const keyTag = (k) => h('kbd', { class: 'tlc__key', 'aria-hidden': 'true' }, k);

/** Chart height: roomy on big screens, but short enough on short ones that the chart stays in view
 * while the verdict and explanation appear under it. */
function chartHeight(stage) {
  const vh = window.innerHeight || 800;
  let wide = false;
  try {
    wide = window.matchMedia('(min-width: 1040px)').matches;
  } catch {
    wide = false;
  }
  if (wide) return Math.round(Math.max(280, Math.min(400, vh - 420)));
  const w = stage.clientWidth || window.innerWidth || 800;
  return Math.round(Math.max(250, Math.min(w < 600 ? 290 : 360, vh - 560)));
}

/** A new round starts where the last one's Next button was: bring its top (and chart) into view. */
function bringIntoView(el) {
  requestAnimationFrame(() => {
    if (!el.isConnected) return;
    const top = el.getBoundingClientRect().top;
    const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 60;
    if (top >= bar + 4 && top <= window.innerHeight * 0.45) return;
    // Scroll to the top of the play area so the HUD (score, clock) shows too.
    const target = el.closest('.game__play') || el;
    const dy = target.getBoundingClientRect().top - bar - 8;
    window.scrollBy({ top: dy, behavior: reducedMotion() ? 'auto' : 'smooth' });
  });
}

/** Cancellable sleep chain for reveal animations. */
function animator() {
  let token = 0;
  const timers = new Set();
  return {
    start() {
      token += 1;
      return token;
    },
    alive: (t) => t === token,
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
      for (const id of timers) clearTimeout(id);
      timers.clear();
    },
  };
}

function scoreList(items) {
  return h('ul', { class: 'tlc-score__list' }, items.map(([kind, html]) => h('li', { class: `is-${kind}` },
    icon(kind === 'good' ? 'check' : kind === 'bad' ? 'x' : 'info', { size: 16 }), h('span', { html }))));
}

// ------------------------------------------------------------------ verdict copy

function verdictCopy(res, ev, idealT, W, dir) {
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  switch (res.verdict) {
    case 'great':
      return { title: `Clean line! ${plural(res.T, 'touch', 'touches')}, nothing closes through.`, why: `That is the line other traders are watching too: it catches the ${W.swings} and price respects it all the way to the right edge.` };
    case 'good':
      return { title: `Valid trend line: ${res.T} of ${idealT} possible touches.`, why: res.T < idealT ? `The best line here catches <strong>${idealT}</strong> ${W.swings}. Look for the line that meets every ${W.swing} without a close through it.` : 'Good placement. Tighten it onto the wick tips for full marks.' };
    case 'weak':
      return { title: 'Close, but weak.', why: `Only ${plural(res.T, 'touch', 'touches')} and ${plural(res.V, 'close', 'closes')} through it. A trend line earns trust with touches and loses it with closes on the wrong side.` };
    case 'few-touches':
      return { title: res.T ? 'Only one touch.' : 'Your line misses the swings.', why: `A trend line needs two ${W.swings} to exist and a third to matter. Anchor it on the tips of the ${W.swings}, not in open space.` };
    case 'closes-through':
      return { title: `${res.V} candles close through your line.`, why: `A trend line keeps price on one side. Closes ${W.closeSide} it mean the line is in the wrong place, or already broken. Move it onto the ${W.swings} that price never closed ${W.closeSide}.` };
    case 'wrong-side':
      return { title: 'Wrong side of price.', why: dir === 'up'
        ? 'Your line sits above price. In an uptrend the trend line goes <strong>under</strong> price and joins the rising swing lows. A line across the highs is a channel line (or resistance), not the trend line.'
        : 'Your line sits under price. In a downtrend the trend line goes <strong>above</strong> price and joins the falling swing highs. A line along the lows is a channel line (or support), not the trend line.' };
    case 'through':
      return { title: 'Your line cuts through the middle of price.', why: `A trend line sits on one side of price: ${dir === 'up' ? 'under the lows in an uptrend' : 'over the highs in a downtrend'}. Anchor it on two ${W.swings}.` };
    case 'direction':
      return { title: dir === 'up' ? 'Your line slopes the wrong way.' : 'Your line slopes the wrong way.', why: dir === 'up'
        ? 'Price is climbing (higher highs and higher lows), so the trend line must rise from left to right through the higher lows.'
        : 'Price is falling (lower highs and lower lows), so the trend line must fall from left to right through the lower highs.' };
    default:
      return { title: 'Too short to judge.', why: `Connect two ${W.swings} at least a few candles apart.` };
  }
}

// ------------------------------------------------------------------ draw round

async function drawRound(g, { rng, stage, difficulty, round }, given = null) {
  const idx = drawIndex(g, round);
  let sc = null;
  let real = null;
  if (given) {
    real = given.round;
    sc = given.sc;
  } else if (g.source === 'real') {
    for (let k = 0; k < 2 && !sc; k++) {
      const r = await g.realRound({ kinds: TREND_KINDS, before: 64, after: 16 });
      if (!r) break;
      const rt = realTrend(r);
      if (rt) {
        real = r;
        sc = rt;
      }
    }
  }
  if (!sc) {
    const dir = bag(g, 'dir', idx, ['up', 'down']);
    const channel = difficulty >= 0.4 && rng.chance(0.75);
    sc = makeTrendChart(rng, { dir, difficulty, channel });
  }
  const { candles: C, n, dir, st, piv } = sc;
  const ideal = sc.ideal;
  const idealT = Math.max(2, ideal.ev.touches.length);
  const idealCh = sc.channel || (real ? channelFor(C, ideal.line, { dir, st, piv }) : null);
  const channelRound = real ? difficulty >= 0.4 && idealCh && idealCh.ev.touches.length >= 2 && !idealCh.ev.violations.length : !!sc.channel;
  const tellDir = difficulty < 0.5;
  const W = dirWords(dir);
  const decimals = real ? real.decimals ?? 2 : 2;
  const slots = real ? C.length : n + 6;
  const rightIdx = slots - 1;

  // ---- UI
  const status = h('p', { class: 'tlc__status', 'aria-live': 'polite' });
  const host = h('div', { class: 'tlc__chart chart-frame' });
  const redrawBtn = h('button', { type: 'button', class: 'btn', 'data-action': 'redraw' }, icon('restart', { size: 16 }), h('span', null, 'Redraw'), keyTag('D'));
  const snapBtn = h('button', { type: 'button', class: 'btn', 'aria-pressed': 'true', 'data-action': 'snap', title: 'Snap points to candle highs, lows, opens and closes' }, icon('target', { size: 16 }), h('span', null, 'Snap'), keyTag('S'));
  const chanBtn = channelRound ? h('button', { type: 'button', class: 'btn', 'aria-pressed': 'false', 'data-action': 'channel', disabled: true }, icon('layers', { size: 16 }), h('span', null, 'Channel line'), keyTag('C')) : null;
  const lockBtn = h('button', { type: 'button', class: 'btn btn--primary', 'data-action': 'lock', disabled: true }, icon('check', { size: 16 }), h('span', null, 'Lock in'), keyTag('L'));
  const title = tellDir ? `Draw the ${W.line}` : 'Draw the trend line';
  const sub = tellDir
    ? `Connect the ${W.rising} ${W.swings} ${W.side} price. Touches score; closes through the line cost points.`
    : 'Is this chart trending up or down? Draw the line on the correct side of price. Touches score; closes through it cost points.';
  const wrap = h('div', { class: 'tlc', 'data-round': 'draw' },
    h('div', { class: 'tlc__head' },
      h('div', null, h('h3', { class: 'tlc__title' }, title), h('p', { class: 'tlc__sub' }, sub)),
      h('div', { class: 'tlc__chips' },
        h('span', { class: 'chip chip--sm chip--outline' }, icon('trendline', { size: 13 }), 'Draw it'),
        channelRound ? h('span', { class: 'chip chip--sm chip--accent' }, icon('layers', { size: 13 }), 'Channel bonus') : null)),
    host,
    h('div', { class: 'tlc__bar' }, status, h('div', { class: 'tlc__tools' }, redrawBtn, snapBtn, chanBtn, lockBtn)),
    h('div', { class: 'tlc__kbd' }, kbdHint(['D', 'S', channelRound ? 'C' : null, 'L'].filter(Boolean), channelRound ? 'redraw · snap · channel · lock in' : 'redraw · snap · lock in'),
      kbdHint(['←', '→', '↑', '↓', 'Enter'], 'draw with the keyboard (focus the chart)')));
  stage.append(wrap);
  bringIntoView(wrap);

  const chart = new CandleChart(host, {
    candles: C, visible: n, slots, height: chartHeight(stage), yPad: 0.1, decimals,
    ariaLabel: `${real ? 'Mystery market' : 'Textbook'} chart. Draw a trend line: drag across the chart, or tap two points.`,
  });

  g.setHint(tellDir
    ? `Find the two ${dir === 'up' ? 'lowest' : 'highest'} ${W.swings} that ${dir === 'up' ? 'rise' : 'fall'} from left to right and join their wick tips. Then check the whole line to the right edge: no candle should close ${W.closeSide} it.${channelRound ? ` For the bonus, press Channel line and tap the most extreme ${W.opp} ${W.oppSide} price.` : ''}`
    : 'First decide the trend: are the swing highs and lows stepping up or stepping down? Up: join the swing lows under price. Down: join the swing highs above price.');

  // ---- state
  let snap = true;
  let line = null;
  let lineId = null;
  let projId = null;
  let chPoint = null;
  let chId = null;
  let chMode = false;
  let drawToken = 0;
  let done = false;
  const anim = animator();

  const setStatus = (html) => {
    status.innerHTML = html;
  };
  const snapMode = () => (snap ? 'ohlc' : false);

  const renderProj = () => {
    if (!line) return;
    const o = ordered(line);
    const spec = { a: o.a, b: o.b, extend: 'right', dashed: '5 5', width: 1.5, color: 'accent' };
    if (projId) chart.update(projId, spec);
    else projId = chart.addSegment(spec);
  };
  const renderChannel = () => {
    if (!line || !chPoint) return;
    const D = chPoint.price - lineAt(line, chPoint.idx);
    const x0 = lineStart(line);
    const spec = { a: { idx: x0, price: lineAt(line, x0) + D }, b: { idx: rightIdx, price: lineAt(line, rightIdx) + D }, color: 'info', width: 2, dashed: '7 4' };
    if (chId) chart.update(chId, spec);
    else chId = chart.addSegment(spec);
  };

  const onDrag = (spec) => {
    line = { a: { ...spec.a }, b: { ...spec.b } };
    renderProj();
    renderChannel();
  };

  const startDraw = () => {
    if (done) return;
    const my = ++drawToken;
    setStatus(`<strong>Draw:</strong> press on a ${W.swing} and drag to another, or tap two points.`);
    chart.draw('segment', { snap: snapMode(), color: 'accent' }).then((shape) => {
      if (!shape || my !== drawToken || done) return;
      sfx.click();
      lineId = shape.id;
      line = { a: shape.a, b: shape.b };
      chart.update(lineId, { width: 2.75, snap: snapMode() });
      chart.setDraggable(lineId, onDrag);
      renderProj();
      lockBtn.disabled = false;
      if (chanBtn) chanBtn.disabled = false;
      setStatus(channelRound
        ? '<strong>Line placed.</strong> Drag the handles to fine-tune. For the bonus, add the channel line, then lock in.'
        : '<strong>Line placed.</strong> Drag the handles to fine-tune, then lock it in.');
    });
  };

  const setChannelMode = (on) => {
    if (!chanBtn || done) return;
    chMode = !!on && !!line;
    chanBtn.setAttribute('aria-pressed', String(chMode));
    if (chMode) setStatus(`<strong>Channel line:</strong> tap the ${W.opp} the parallel line should run through (${W.oppSide} price).`);
    else if (line) setStatus('<strong>Line placed.</strong> Drag the handles to fine-tune, then lock it in.');
  };

  const onChartClick = (p) => {
    if (!chMode || done || !line) return;
    const i = Math.max(0, Math.min(n - 1, p.idx));
    const k = C[i];
    if (!k) return;
    chPoint = { idx: i, price: snap ? (dir === 'up' ? k.h : k.l) : p.price };
    sfx.click();
    renderChannel();
    chart.flash(i, 'info');
    setStatus('<strong>Channel line placed.</strong> Tap another swing to move it, or lock in.');
  };
  chart.on('click', onChartClick);

  const redraw = () => {
    if (done) return;
    sfx.click();
    for (const id of [lineId, projId, chId]) if (id) chart.remove(id);
    lineId = projId = chId = null;
    line = null;
    chPoint = null;
    lockBtn.disabled = true;
    if (chanBtn) {
      chanBtn.disabled = true;
      chanBtn.setAttribute('aria-pressed', 'false');
    }
    chMode = false;
    chart.cancelDraw();
    startDraw();
  };

  const toggleSnap = () => {
    if (done) return;
    snap = !snap;
    snapBtn.setAttribute('aria-pressed', String(snap));
    sfx.click();
    if (lineId) chart.update(lineId, { snap: snapMode() });
    if (chart.isDrawing && !line) {
      chart.cancelDraw();
      startDraw();
    }
  };

  // ---- grading + reveal
  const lockIn = (timeout = false) => {
    if (done) return;
    done = true;
    g.timer.stop();
    drawToken += 1;
    chart.cancelDraw();
    chart.off('click', onChartClick);
    if (lineId) chart.setDraggable(lineId, false);
    for (const b of [redrawBtn, snapBtn, chanBtn, lockBtn]) if (b) b.disabled = true;
    wrap.classList.add('is-done');
    const tAnim = anim.start();

    if (!line) {
      g.wrong(timeout ? "Time's up! No line was drawn." : 'No line drawn.');
      g.feedback(`The best line joins <strong>${idealT}</strong> ${W.swings}: see the dashed line on the chart.`, 'bad');
      setStatus('The best line is drawn on the chart.');
      if (real) g.revealSource();
      g.nextButton();
      revealIdeal(tAnim);
      return;
    }

    const ev = evaluateLine(C, line, { dir, st, piv });
    const res = scoreLine(ev, idealT);
    const copy = verdictCopy(res, ev, idealT, W, dir);
    let ch = null;
    if (channelRound && chPoint) ch = evaluateChannel(C, line, chPoint, { dir, st, piv });

    if (res.pass) g.correct(timeout ? `Time's up, but your line counts. ${copy.title}` : copy.title, { points: res.score });
    else g.wrong(timeout ? `Time's up! ${copy.title}` : copy.title);
    if (res.pass && ch && ch.bonus > 0) g.award(ch.bonus, { reason: 'channel', bonus: true });

    // Breakdown under the stage.
    const items = [];
    if (['wrong-side', 'through', 'direction', 'short'].includes(res.verdict)) items.push(['bad', copy.why]);
    else {
      items.push([res.T >= 2 ? 'good' : 'bad', `<strong>${res.T} ${res.T === 1 ? 'touch' : 'touches'}</strong> on ${W.swings} (best possible here: ${idealT}).`]);
      items.push([res.V === 0 ? 'good' : 'bad', res.V === 0 ? `<strong>No closes through</strong> the line, all the way to the right edge.` : `<strong>${res.V} ${res.V === 1 ? 'close' : 'closes'} through</strong> the line (red dots).`]);
      if (res.W > 0) items.push(['info', res.W === 1 ? 'One wick pokes through: fine, a single stray wick does not break a line.' : `${res.W} wicks poke through: a sign the line is forced.`]);
      items.push(['info', copy.why]);
    }
    if (channelRound) {
      if (!chPoint) items.push(['info', `Channel bonus missed: after the trend line, add a parallel line through the extreme ${W.opp}.`]);
      else if (!res.pass) items.push(['info', 'Channel bonus needs a valid trend line first.']);
      else if (ch.bonus > 0) items.push(['good', `<strong>Channel bonus +${ch.bonus}</strong>: ${ch.ev.touches.length} ${ch.ev.touches.length === 1 ? 'touch' : 'touches'} on the channel line${ch.ev.violations.length ? ', one close beyond it' : ', nothing closes beyond it'}.`]);
      else items.push(['bad', !ch.sideRight ? `Channel line on the wrong side: it belongs ${W.oppSide} price, through the ${W.opp}s.` : `Channel line misplaced: ${ch.ev.violations.length ? 'candles close beyond it' : 'it misses the swings'}. It should run through the most extreme ${W.opp}.`]);
    }
    const scoreNum = h('span', { class: 'tlc-score__num' }, '0', h('small', null, ' / 100'));
    const bar = meter(0, { label: 'Line score', tone: res.pass ? 'bull' : '' });
    const nextNote = h('p', { class: 'tlc-next', 'aria-live': 'polite' });
    g.feedback(h('div', { class: 'tlc-score' },
      h('div', { class: 'tlc-score__top' }, h('strong', null, 'Line score'), scoreNum, bar),
      scoreList(items), nextNote), res.pass ? 'good' : 'bad');
    requestAnimationFrame(() => setMeter(bar, res.score / 100));
    countTo(scoreNum.firstChild, res.score);
    setStatus(res.pass ? '<strong>Locked in.</strong> Your touches are ringed in green.' : '<strong>Locked in.</strong> Compare your line with the dashed best line.');
    if (real) g.revealSource();
    g.nextButton();
    revealLine(tAnim, ev, res, ch, nextNote);
  };

  const countTo = (node, to) => {
    if (reducedMotion()) {
      node.textContent = String(to);
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 650);
      node.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1 && node.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const revealIdeal = async (t) => {
    const o = ordered(ideal.line);
    chart.addSegment({ a: o.a, b: { idx: rightIdx, price: lineAt(ideal.line, rightIdx) }, color: 'accent', width: 2, dashed: '8 5', label: `Best line · ${idealT} touches`, pulse: true });
    for (const i of ideal.ev.touches) {
      await anim.wait(140);
      if (!anim.alive(t)) return;
      chart.addMarker({ idx: i, price: lineAt(ideal.line, i), position: 'at', shape: 'ring', color: 'accent', pulse: true });
    }
    if (channelRound && idealCh) {
      await anim.wait(250);
      if (!anim.alive(t)) return;
      const c = ordered(idealCh.line);
      chart.addSegment({ a: c.a, b: { idx: rightIdx, price: lineAt(idealCh.line, rightIdx) }, color: 'info', width: 1.75, dashed: '8 5', label: 'Channel line', pulse: true });
    }
    await revealFuture(t, ideal.line, null);
  };

  const revealLine = async (t, ev, res, ch, nextNote) => {
    const col = res.pass ? 'bull' : 'bear';
    chart.update(lineId, { color: col });
    chart.update(projId, { color: col });
    for (const i of ev.touches) {
      await anim.wait(160);
      if (!anim.alive(t)) return;
      chart.addMarker({ idx: i, price: lineAt(line, i), position: 'at', shape: 'ring', color: 'bull', pulse: true });
      sfx.tick();
    }
    // Label one close-through dot, away from the chart edges so the text is not clipped.
    const shown = ev.violations.slice(0, 10);
    const labelAt = shown.find((i) => i > n * 0.12 && i < n * 0.88);
    shown.forEach((i) => {
      chart.addMarker({ idx: i, price: C[i].c, position: 'at', shape: 'dot', color: 'bear', text: i === labelAt ? 'Close through' : null, pulse: true });
    });
    if (ev.violations.length) sfx.tick();
    await anim.wait(420);
    if (!anim.alive(t)) return;
    const o = ordered(ideal.line);
    chart.addSegment({ a: o.a, b: { idx: rightIdx, price: lineAt(ideal.line, rightIdx) }, color: 'accent', width: 1.75, dashed: '8 5', label: `Best line · ${idealT} touches`, pulse: true });
    if (channelRound && idealCh) {
      await anim.wait(250);
      if (!anim.alive(t)) return;
      if (chId && ch) chart.update(chId, { color: ch.bonus > 0 ? 'bull' : 'bear', dashed: false });
      const c = ordered(idealCh.line);
      chart.addSegment({ a: c.a, b: { idx: rightIdx, price: lineAt(idealCh.line, rightIdx) }, color: 'info', width: 1.5, dashed: '8 5', label: 'Channel line', pulse: true });
      for (const i of idealCh.ev.touches) chart.addMarker({ idx: i, price: lineAt(idealCh.line, i), position: 'at', shape: 'ring', color: 'info', pulse: true });
    }
    await revealFuture(t, res.pass ? line : ideal.line, nextNote, res.pass);
  };

  // Real charts: show what happened after the chart ended (reported, not scored).
  const revealFuture = async (t, ln, noteEl, mine = false) => {
    if (!real || C.length <= n) return;
    await anim.wait(350);
    if (!anim.alive(t)) return;
    chart.setAriaLabel('Real market chart with the candles that followed revealed.');
    await chart.reveal({ to: C.length, interval: reducedMotion() ? 0 : 70 });
    if (!anim.alive(t)) return;
    const out = outcomeAfter(C, ln, n - 1, { dir, st, bars: C.length - n });
    const whose = mine ? 'your line' : 'the best line';
    if (out.broke) {
      chart.addMarker({ idx: out.breakIdx, position: dir === 'up' ? 'below' : 'above', shape: 'arrow', color: 'warn', text: 'Broke', pulse: true });
      if (noteEl) noteEl.innerHTML = `<strong>What happened next:</strong> price closed through ${whose} ${out.breakIdx - (n - 1)} ${out.breakIdx - (n - 1) === 1 ? 'candle' : 'candles'} later. That is the outcome, not your score: you are graded on the line you drew.`;
    } else if (noteEl) {
      noteEl.innerHTML = `<strong>What happened next:</strong> ${whose} held for all ${C.length - n} candles that followed. Real charts do not always behave, so this is shown for interest, not scored.`;
    }
  };

  const onTimeout = () => {
    if (done) return;
    lockIn(true);
  };

  // ---- wiring
  redrawBtn.addEventListener('click', redraw);
  snapBtn.addEventListener('click', toggleSnap);
  lockBtn.addEventListener('click', () => lockIn(false));
  chanBtn?.addEventListener('click', () => {
    sfx.click();
    setChannelMode(!chMode);
  });
  const onKey = (e) => {
    if (done || g.state !== 'play' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (document.body.classList.contains('has-modal')) return;
    const k = e.key.toLowerCase();
    if (k === 'd') redraw();
    else if (k === 's') toggleSnap();
    else if (k === 'c' && chanBtn && !chanBtn.disabled) {
      sfx.click();
      setChannelMode(!chMode);
    } else if (k === 'l' && !lockBtn.disabled) lockIn(false);
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  startDraw();
  g._tlcTimeout = onTimeout; // the shell-managed clock (opts.timer) was started with the round

  return () => {
    done = true;
    anim.stop();
    document.removeEventListener('keydown', onKey);
    chart.destroy();
  };
}

// ------------------------------------------------------------------ hold-or-break round

function tellItems(tells, dir, hasVolume) {
  const up = dir === 'up';
  const s = {
    1: up ? 'The last rally made a <strong>higher high</strong>: the uptrend still had energy.' : 'The last drop made a <strong>lower low</strong>: the downtrend still had energy.',
    '-1': up ? 'The last rally <strong>failed to make a new high</strong> (a lower high): buyers were tiring.' : 'The last drop <strong>failed to make a new low</strong> (a higher low): sellers were tiring.',
    0: up ? 'The last high was about level with the one before: no clear signal from structure.' : 'The last low was about level with the one before: no clear signal from structure.',
  };
  const c = {
    1: up ? 'The test candle left a <strong>long lower wick</strong> and closed near its high: buyers defended the line.' : 'The test candle left a <strong>long upper wick</strong> and closed near its low: sellers defended the line.',
    '-1': up ? 'The test candle was a <strong>big red candle closing near its low</strong>, right on the line: sellers pressing.' : 'The test candle was a <strong>big green candle closing near its high</strong>, right on the line: buyers pressing.',
    0: 'The test candle was ordinary: no clear signal from the candle.',
  };
  const v = {
    1: `Volume <strong>dried up</strong> on the way ${up ? 'down' : 'up'} to the line: a quiet pullback.`,
    '-1': `Volume <strong>swelled</strong> on the way ${up ? 'down' : 'up'} to the line: heavy pressure.`,
    0: 'Volume on the approach was about average: no clear signal.',
  };
  const kind = (x) => (x > 0 ? 'good' : x < 0 ? 'bad' : 'info');
  const out = [[kind(tells.structure), s[tells.structure]], [kind(tells.candle), c[tells.candle]]];
  if (hasVolume) out.push([kind(tells.volume), v[tells.volume]]);
  return out;
}

function sliceReal(hb, maxShown = 78) {
  const off = Math.max(0, Math.min(Math.floor(lineStart(hb.line)) - 5, hb.t - maxShown + 1));
  if (!off) return hb;
  const sh = (i) => (i == null ? i : i - off);
  const res = hb.result;
  return {
    ...hb,
    candles: hb.candles.slice(off),
    n: hb.n - off,
    t: hb.t - off,
    line: { a: { idx: hb.line.a.idx - off, price: hb.line.a.price }, b: { idx: hb.line.b.idx - off, price: hb.line.b.price } },
    touches: hb.touches.map(sh),
    tells: { ...hb.tells, peakLast: sh(hb.tells.peakLast), peakPrev: sh(hb.tells.peakPrev), lastTouch: sh(hb.tells.lastTouch), prevTouch: sh(hb.tells.prevTouch) },
    result: { ...res, breakIdx: sh(res.breakIdx), retestIdx: sh(res.retestIdx), end: sh(res.end) },
  };
}

async function holdRound(g, args) {
  const { rng, stage, round } = args;
  const i = holdIndex(g, round);
  const difficulty = g.style === 'arcade' ? (i <= 0 ? 0.35 : 0.75) : args.difficulty;
  let sc = null;
  let real = null;
  let spare = null;
  if (g.source === 'real') {
    for (let k = 0; k < 3 && !sc; k++) {
      const r = await g.realRound({ kinds: TREND_KINDS, before: 60, after: 40, loadingText: 'Finding a real trend-line test…' });
      if (!r) break;
      const hb = realHoldBreak(r);
      if (hb && hb.tells.read !== 'mixed' && !hb.tells.contradict) {
        real = r;
        sc = sliceReal(hb);
      } else spare = r;
    }
    if (!sc && spare && g.real === spare) {
      // A real chart with no clean test of its line: keep it real and make it a drawing round.
      const rt = realTrend(spare);
      if (rt) {
        g.feedback('No clean trend-line test in this real chart, so this round is a drawing round instead.', 'info');
        return drawRound(g, args, { round: spare, sc: rt });
      }
    }
  }
  if (!sc) {
    const outcome = bag(g, 'hb', Math.max(0, i), ['hold', 'break']);
    const dir = bag(g, 'hbdir', Math.max(0, i), ['up', 'down']);
    sc = makeHoldBreak(rng, { dir, outcome, difficulty });
  }
  const { candles: C, t, dir, line, touches, tells } = sc;
  const answer = real ? tells.read : sc.outcome;
  const end = real ? Math.min(C.length - 1, sc.result.end) : C.length - 1;
  const hasVolume = C.slice(0, t + 1).some((k) => (k.v || 0) > 0);
  const W = dirWords(dir);
  const decimals = real ? real.decimals ?? 2 : 2;

  const host = h('div', { class: 'tlc__chart chart-frame' });
  const mk = (value, label, detail, ic, key) => h('button', { type: 'button', class: 'tlc-choice', 'data-choice': value },
    h('span', { class: 'tlc-choice__icon', 'aria-hidden': 'true' }, icon(ic, { size: 20 })),
    h('span', { class: 'tlc-choice__text' }, h('strong', null, label), h('small', null, detail)),
    keyTag(key));
  const holdBtn = mk('hold', 'Hold', `Price ${dir === 'up' ? 'bounces up' : 'turns back down'} off the line`, 'shield', 'H');
  const breakBtn = mk('break', 'Break', `Price closes through it and ${dir === 'up' ? 'falls' : 'rises'}`, 'bolt', 'B');
  const status = h('p', { class: 'tlc__status', 'aria-live': 'polite' }, `The ${W.line} has ${touches.length} touches. Read the last swing, the test candle${hasVolume ? ' and the volume' : ''}.`);
  const wrap = h('div', { class: 'tlc', 'data-round': 'hold' },
    h('div', { class: 'tlc__head' },
      h('div', null,
        h('h3', { class: 'tlc__title' }, `Price is back at the ${W.line}. Hold or break?`),
        h('p', { class: 'tlc__sub' }, `The line has held ${touches.length} times. Will it hold again, or will price close through it?`)),
      h('div', { class: 'tlc__chips' }, h('span', { class: 'chip chip--sm chip--outline' }, icon('eye', { size: 13 }), 'Hold or break?'))),
    host,
    status,
    h('div', { class: 'tlc-choices', role: 'group', 'aria-label': 'Hold or break' }, holdBtn, breakBtn),
    h('div', { class: 'tlc__kbd' }, kbdHint(['H', 'B'], 'hold · break')));
  stage.append(wrap);
  bringIntoView(wrap);

  const chart = new CandleChart(host, {
    candles: C.slice(0, end + 1), visible: t + 1, slots: end + 1, height: chartHeight(stage), yPad: 0.12, decimals,
    showVolume: hasVolume, ariaLabel: `${real ? 'Mystery market' : 'Textbook'} chart: price is testing an established trend line. The next candles are hidden.`,
  });
  const o = ordered(line);
  chart.addSegment({ a: o.a, b: o.b, extend: 'right', color: 'accent', width: 2.25 });
  for (const ti of touches) chart.addMarker({ idx: ti, price: lineAt(line, ti), position: 'at', shape: 'ring', color: 'accent' });
  chart.addMarker({ idx: t, position: dir === 'up' ? 'above' : 'below', shape: 'arrow', color: 'info', text: 'Now' });

  g.setHint(dir === 'up'
    ? 'Compare the last peak with the one before it, then look at the test candle: where did it close, and how long is its lower wick? Finally check the volume bars on the way down to the line.'
    : 'Compare the last trough with the one before it, then look at the test candle: where did it close, and how long is its upper wick? Finally check the volume bars on the way up to the line.');

  let done = false;
  const anim = animator();

  const answerWith = (choice, timeout = false) => {
    if (done) return;
    done = true;
    g.timer.stop();
    for (const b of [holdBtn, breakBtn]) {
      b.setAttribute('aria-disabled', 'true');
      b.classList.add('is-locked');
    }
    wrap.classList.add('is-done');
    const ok = choice != null && choice === answer;
    const picked = choice === 'hold' ? holdBtn : choice === 'break' ? breakBtn : null;
    if (picked) picked.classList.add(ok ? 'is-right' : 'is-wrong');
    const right = answer === 'hold' ? holdBtn : breakBtn;
    if (!ok) right.classList.add('is-right');
    for (const b of [holdBtn, breakBtn]) if (b !== picked && b !== right) b.classList.add('is-dim');

    const res = sc.result;
    const held = !res.broke;
    const tellList = tellItems(tells, dir, hasVolume);
    const read = answer === 'hold' ? 'Hold' : 'Break';
    let title;
    if (timeout) title = `Time's up! The tells pointed to ${read}.`;
    else if (real) title = ok ? `Good read: the tells pointed to ${read}.` : `The tells pointed to ${read}.`;
    else title = ok ? (answer === 'hold' ? 'Held! Good read.' : 'Broke! Good read.') : answer === 'hold' ? 'It held.' : 'It broke.';
    if (ok) g.correct(title);
    else g.wrong(title);

    const story = held
      ? `<strong>What happened:</strong> the line held. Price ${dir === 'up' ? 'bounced' : 'turned down'} for another touch and the ${W.trend} carried on.`
      : `<strong>What happened:</strong> the line broke. ${res.retestIdx != null ? `Price then came back to test it from the other side${res.retestHeld ? ` and was rejected (old ${dir === 'up' ? 'support acting as resistance' : 'resistance acting as support'})` : ''}. ` : ''}${res.retestIdx != null && res.retestHeld ? 'Break, retest, continue: the classic end of a trend.' : ''}`;
    const items = [...tellList];
    if (real) {
      items.push(['info', `${story} You are scored on the read, not the result: real charts do not always follow the tells${held === (answer === 'hold') ? '' : ', as this one shows'}.`]);
    } else {
      items.push([ok ? 'good' : 'info', story]);
      items.push(['info', 'Tells tilt the odds. They never guarantee the outcome, which is why a stop goes on the other side of the line.']);
    }
    g.feedback(h('div', { class: 'tlc-score' }, h('p', null, h('strong', null, `The tells: ${read}.`)), scoreList(items)), ok ? 'good' : 'bad');
    status.textContent = 'Revealing the next candles…';
    if (real) g.revealSource();
    g.nextButton();
    reveal();
  };

  const reveal = async () => {
    const my = anim.start();
    const up = dir === 'up';
    // Evidence first.
    if (tells.peakPrev != null && tells.peakLast != null) {
      const ext = (i) => (up ? C[i].h : C[i].l);
      chart.addPath({ points: [{ idx: tells.peakPrev, price: ext(tells.peakPrev) }, { idx: tells.peakLast, price: ext(tells.peakLast) }], color: tells.structure > 0 ? 'bull' : tells.structure < 0 ? 'bear' : 'muted', width: 1.75, dashed: '4 3', labels: ['', tells.structure > 0 ? (up ? 'Higher high' : 'Lower low') : tells.structure < 0 ? (up ? 'Lower high' : 'Higher low') : 'Level'], pulse: true });
    }
    await anim.wait(350);
    if (!anim.alive(my)) return;
    chart.addBox({ from: t, to: t, color: tells.candle > 0 ? 'bull' : tells.candle < 0 ? 'bear' : 'muted', pulse: true });
    await anim.wait(450);
    if (!anim.alive(my)) return;
    await chart.reveal({ to: end + 1, interval: reducedMotion() ? 0 : 110 });
    if (!anim.alive(my)) return;
    const res = sc.result;
    if (res.broke) {
      chart.addMarker({ idx: res.breakIdx, position: up ? 'below' : 'above', shape: 'arrow', color: 'warn', text: 'Break', pulse: true });
      if (res.retestIdx != null) chart.addMarker({ idx: res.retestIdx, position: up ? 'above' : 'below', shape: 'arrow', color: 'info', text: 'Retest', pulse: true });
      status.textContent = res.retestIdx != null ? 'The line broke, was retested from the other side, and price moved on.' : 'The line broke.';
    } else {
      chart.addMarker({ idx: t, price: lineAt(line, t), position: 'at', shape: 'ring', color: 'bull', pulse: true });
      status.textContent = 'The line held.';
    }
    sfx.whoosh();
  };

  holdBtn.addEventListener('click', () => answerWith('hold'));
  breakBtn.addEventListener('click', () => answerWith('break'));
  const onKey = (e) => {
    if (done || g.state !== 'play' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const tg = e.target;
    if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
    if (document.body.classList.contains('has-modal')) return;
    const k = e.key.toLowerCase();
    if (k === 'h') answerWith('hold');
    else if (k === 'b') answerWith('break');
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  g._tlcTimeout = () => answerWith(null, true);
  g.timer.start(HOLD_SECONDS * g.clockScale, () => g._tlcTimeout?.());

  return () => {
    done = true;
    anim.stop();
    document.removeEventListener('keydown', onKey);
    chart.destroy();
  };
}

// ------------------------------------------------------------------ intro preview

function preview(el) {
  const sc = makeTrendChart(makeRng(20240611), { dir: 'up', difficulty: 0.1, channel: true });
  const C = sc.candles.slice(0, sc.n);
  const end = sc.n - 1;
  const seg = (ln, cls, color) => ({ type: 'segment', a: { idx: ln.a.idx, price: ln.a.price }, b: { idx: end, price: lineAt(ln, end) }, color, width: 2.25, dashed: cls === 'chan' ? '6 4' : false });
  const overlays = [seg(sc.ideal.line, 'line', 'accent'), seg(sc.channel.line, 'chan', 'info')];
  sc.ideal.ev.touches.forEach((i) => overlays.push({ type: 'marker', idx: i, price: lineAt(sc.ideal.line, i), position: 'at', shape: 'ring', color: 'bull' }));
  const art = miniChart(C, { width: 420, height: 250, overlays, yPad: 0.08, ariaLabel: 'An uptrend with its trend line under the swing lows and a parallel channel line above' });
  const segs = art.querySelectorAll('.tc-seg');
  segs[0]?.classList.add('tlc-preview__line');
  segs[1]?.classList.add('tlc-preview__chan');
  art.querySelectorAll('.tc-ring').forEach((r, k) => {
    r.style.animationDelay = `${0.45 + k * 0.32}s`;
  });
  el.append(h('div', { class: 'tlc-preview' }, art));
}

// ------------------------------------------------------------------ module

export default {
  id: 'trendline-challenge',
  mount(root, ctx) {
    const removeStyle = injectStyle();
    const game = new GameShell(root, ctx, {
      rounds: ROUNDS,
      maxScore: ROUNDS * 100,
      // Draw rounds run this clock; Hold-or-break rounds restart it with HOLD_SECONDS.
      timer: { seconds: DRAW_SECONDS, perRound: true },
      onTimeout(g) {
        const fn = g._tlcTimeout;
        if (typeof fn === 'function') fn();
        else {
          g.wrong("Time's up!");
          g.nextButton();
        }
      },
      howTo: [
        '<strong>Draw it:</strong> drag along the trend (or tap two points) to draw the trend line: under the rising swing lows in an uptrend, over the falling swing highs in a downtrend.',
        'Each swing your line touches scores. Each candle that closes through it costs points. Drag the handles to fine-tune, then press <strong>Lock in</strong> (L).',
        'Later charts get noisier. Channel rounds pay a bonus for the parallel channel line through the opposite swings.',
        '<strong>Hold or break?</strong> (the last two rounds; every fourth in Survival): price is back at an established line. Read the tells, then press H or B.',
      ].map((s) => h('span', { html: s })),
      preview,
      onStart(g) {
        g.nextRound();
      },
      onRound(g, args) {
        g._tlcTimeout = null;
        return kindOf(g, args.round) === 'hold' ? holdRound(g, args) : drawRound(g, args);
      },
    });
    return () => {
      game.destroy();
      removeStyle();
    };
  },
};
