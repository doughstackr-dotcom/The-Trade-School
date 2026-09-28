// Lesson: Candlestick anatomy — how to read a single candle.
// Ten steps: one period → one candle (tick-by-tick animation), the four prices (tap-to-explore diagram),
// bullish vs bearish and colour conventions, a live candle builder with narration, wicks as rejection
// (animated) with a strong-close vs pushed-back comparison, body size as conviction, a chart story
// (context → trigger → confirmation → plan → outcome), a real-market example, 24 hourly candles merging
// into one daily candle, and key takeaways. Every diagram is drawn here in SVG with colour tokens.
import { LessonShell, storyStep, realExampleStep, compareStep, figure, takeaway, lessonRng } from '../core/lesson-kit.js';
import { h, svg, icon, sfx, kbdHint } from '../core/ui.js';
import { niceTicks } from '../core/chart.js';
import { candleScenario } from '../core/patterns.js';
import { randomWalk, fromPath, aggregate } from '../core/data.js';
import { tween, sleep, reducedMotion } from '../core/anim.js';
import { createBuilder, describeCandle, features } from '../games/candle-builder-kit.js';

const CSS = `
.candle-anatomy .ca-widget { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.candle-anatomy .ca-svgbox { position: relative; min-width: 0; }
.candle-anatomy .ca-svg { display: block; width: 100%; overflow: visible; -webkit-user-select: none; user-select: none; }
.candle-anatomy .ca-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.candle-anatomy .ca-controls .segmented button { min-height: 40px; }
.candle-anatomy .ca-scrub { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; font-size: 14px; color: var(--text-2); }
.candle-anatomy .ca-scrub input { min-height: 32px; }
.candle-anatomy .ca-readout { display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--text-2); font: 500 13.5px/1.4 var(--font-mono); font-variant-numeric: tabular-nums; }
.candle-anatomy .ca-readout b { color: var(--text); font-weight: 700; }
.candle-anatomy .ca-live { min-height: 3em; margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--surface-2); color: var(--text); font-size: 15px; line-height: 1.5; }
.candle-anatomy .ca-live b { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.candle-anatomy .ca-live.is-bull { box-shadow: inset 3px 0 0 var(--bull); }
.candle-anatomy .ca-live.is-bear { box-shadow: inset 3px 0 0 var(--bear); }
.candle-anatomy .ca-live.is-neutral { box-shadow: inset 3px 0 0 var(--accent); }
.candle-anatomy .ca-grid { stroke: var(--grid); stroke-width: 1; shape-rendering: crispEdges; }
.candle-anatomy .ca-axis { fill: var(--text-3); font: 500 11px/1 var(--font-mono); font-variant-numeric: tabular-nums; }
.candle-anatomy .ca-label { fill: var(--text-2); font: 600 12px/1 var(--font-body); }
.candle-anatomy .ca-label--strong { fill: var(--text); font-weight: 700; }
.candle-anatomy .ca-label--accent { fill: var(--accent-strong); font-weight: 700; }
.candle-anatomy .ca-label--bull { fill: var(--bull-strong); font-weight: 700; }
.candle-anatomy .ca-label--bear { fill: var(--bear-strong); font-weight: 700; }
.candle-anatomy .ca-price { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.candle-anatomy .ca-tick-line { fill: none; stroke: var(--info); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.candle-anatomy .ca-tick-ghost { fill: none; stroke: var(--info); stroke-width: 1.5; opacity: 0.18; }
.candle-anatomy .ca-ref { stroke: var(--text-3); stroke-width: 1; stroke-dasharray: 3 4; }
.candle-anatomy .ca-ref--hi { stroke: var(--bull); opacity: 0.8; }
.candle-anatomy .ca-ref--lo { stroke: var(--bear); opacity: 0.8; }
.candle-anatomy .ca-now { stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 5 3; }
.candle-anatomy .ca-dot { fill: var(--accent); stroke: var(--surface); stroke-width: 2; }
.candle-anatomy .ca-up { fill: var(--bull); stroke: var(--bull); }
.candle-anatomy .ca-dn { fill: var(--bear); stroke: var(--bear); }
.candle-anatomy .ca-flat { fill: var(--text-2); stroke: var(--text-2); }
.candle-anatomy .ca-wick { stroke-width: 2.5; stroke-linecap: round; fill: none; }
.candle-anatomy .ca-lock rect { fill: var(--accent); }
.candle-anatomy .ca-lock text { fill: var(--accent-ink); font: 700 11px/1 var(--font-body); }
.candle-anatomy .ca-hit { fill: transparent; cursor: pointer; }
.candle-anatomy .ca-sel { stroke: var(--accent); stroke-width: 3; fill: none; }
.candle-anatomy .ca-sel-fill { fill: var(--accent); opacity: 0.22; }
.candle-anatomy .is-dim { opacity: 0.38; }
.candle-anatomy .ca-parts { display: flex; flex-wrap: wrap; gap: 6px; }
.candle-anatomy .ca-parts .btn[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
.candle-anatomy .ca-def { display: grid; gap: 8px; padding: 14px 16px; border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: var(--radius); background: var(--surface); }
.candle-anatomy .ca-def h3 { margin: 0; font-size: 18px; }
.candle-anatomy .ca-def p { margin: 0; line-height: 1.55; }
.candle-anatomy .ca-def__vals { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 6px 16px; font-size: 14.5px; color: var(--text-2); }
.candle-anatomy .ca-def__vals strong.up { color: var(--bull-strong); }
.candle-anatomy .ca-def__vals strong.down { color: var(--bear-strong); }
.candle-anatomy .ca-sty-color .ca-c-up { fill: var(--bull); stroke: var(--bull); }
.candle-anatomy .ca-sty-color .ca-c-dn { fill: var(--bear); stroke: var(--bear); }
.candle-anatomy .ca-sty-hollow .ca-c-up { fill: var(--surface); stroke: var(--text); }
.candle-anatomy .ca-sty-hollow .ca-c-dn { fill: var(--text); stroke: var(--text); }
.candle-anatomy .ca-sty-redup .ca-c-up { fill: var(--bear); stroke: var(--bear); }
.candle-anatomy .ca-sty-redup .ca-c-dn { fill: var(--bull); stroke: var(--bull); }
.candle-anatomy .ca-c-body { stroke-width: 1.5; }
.candle-anatomy .ca-ring { fill: none; stroke: var(--accent); stroke-width: 2; stroke-dasharray: 4 3; }
.candle-anatomy .ca-tag rect { fill: var(--surface); stroke: var(--accent); stroke-width: 1.25; }
.candle-anatomy .ca-tag text { fill: var(--accent-strong); font: 700 11px/1 var(--font-body); }
.candle-anatomy .ca-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.candle-anatomy .ca-builder { padding: 10px 8px 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.candle-anatomy .ca-cards { display: grid; gap: 12px; }
@media (min-width: 640px) { .candle-anatomy .ca-cards--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); } .candle-anatomy .ca-cards--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 639.98px) { .candle-anatomy .ca-cards--4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.candle-anatomy .ca-card { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.candle-anatomy .ca-card h3 { margin: 0; font-size: 15.5px; }
.candle-anatomy .ca-card p { margin: 0; font-size: 14px; line-height: 1.5; color: var(--text-2); }
.candle-anatomy .ca-card svg { display: block; width: 100%; max-width: 190px; height: auto; margin-inline: auto; }
@media (max-width: 639.98px) {
  .candle-anatomy .ca-cards--3 .ca-card { display: grid; grid-template-columns: 104px minmax(0, 1fr); align-items: center; column-gap: 12px; }
  .candle-anatomy .ca-cards--3 .ca-card svg { grid-row: span 2; }
}
.candle-anatomy .ca-meter { height: 8px; border-radius: 4px; background: var(--surface-2); overflow: hidden; }
.candle-anatomy .ca-meter > span { display: block; height: 100%; border-radius: 4px; background: var(--accent); transform-origin: left; transition: transform 0.9s var(--ease-out, ease-out); }
.candle-anatomy .ca-meter-label { font: 600 12.5px/1.2 var(--font-mono); color: var(--text-2); }
.candle-anatomy .ca-path-up { stroke: var(--bull); stroke-width: 2.25; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.candle-anatomy .ca-path-dn { stroke: var(--bear); stroke-width: 2.25; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.candle-anatomy .ca-cta { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; max-width: 680px; padding: 16px 18px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.candle-anatomy .ca-cta p { flex: 1 1 240px; margin: 0; font-size: 15.5px; line-height: 1.5; }
.candle-anatomy .ca-fixed { max-width: 440px; margin-inline: auto; }
.candle-anatomy .ca-hint { margin: 0; color: var(--text-3); font-size: 13.5px; }
@media (pointer: coarse) { .candle-anatomy .ca-kbd { display: none; } }
@media (prefers-reduced-motion: reduce) { .candle-anatomy .ca-meter > span { transition: none; } }
`;

// ------------------------------------------------------------------ small helpers

const r1 = (v) => Math.round(v * 10) / 10;
const fx = (p, d = 2) => Number(p).toFixed(d);

/** Calls cb(width) now and whenever the element's width changes. → cleanup */
function watchWidth(el, cb) {
  let last = 0;
  const run = () => {
    const w = Math.floor(el.clientWidth || 0);
    if (w > 0 && w !== last) {
      last = w;
      cb(w);
    }
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(run) : null;
  ro?.observe(el);
  run();
  return () => ro?.disconnect();
}

function svgRoot(label) {
  const s = svg('svg', { class: 'ca-svg', role: 'img', 'aria-label': label });
  return s;
}

function sizeSvg(s, W, H) {
  s.setAttribute('width', W);
  s.setAttribute('height', H);
  s.setAttribute('viewBox', `0 0 ${W} ${H}`);
}

/** Wick + body markup for a candle at x (pixel) with a price → y mapper. */
function candleMarkup(k, x, y, bw, cls, extra = '') {
  const yT = y(Math.max(k.o, k.c));
  const yB = y(Math.min(k.o, k.c));
  const bh = Math.max(2, yB - yT);
  const top = bh === 2 ? (yT + yB) / 2 - 1 : yT;
  return `<path class="ca-wick ${cls}" d="M${r1(x)},${r1(y(k.h))}V${r1(y(k.l))}"${extra}/>` +
    `<rect class="${cls}" x="${r1(x - bw / 2)}" y="${r1(top)}" width="${r1(bw)}" height="${r1(bh)}" rx="2"${extra}/>`;
}
const dirClass = (k) => (k.c > k.o + 1e-9 ? 'ca-up' : k.c < k.o - 1e-9 ? 'ca-dn' : 'ca-flat');

/** Pushes labels apart vertically so they never overlap: items [{ y }] → same with .py */
function spreadLabels(items, gap = 15, lo = -Infinity, hi = Infinity) {
  const s = items.map((it) => ({ ...it, py: it.y })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < s.length; i++) if (s[i].py - s[i - 1].py < gap) s[i].py = s[i - 1].py + gap;
  const over = s.length ? s[s.length - 1].py - hi : 0;
  if (over > 0) s.forEach((it) => { it.py -= over; });
  for (let i = s.length - 2; i >= 0; i--) if (s[i + 1].py - s[i].py < gap) s[i].py = s[i + 1].py - gap;
  if (s.length && s[0].py < lo) {
    const d = lo - s[0].py;
    s.forEach((it) => { it.py += d; });
  }
  return s;
}

function segmented(options, value, onPick, label) {
  const wrap = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  const btns = options.map(([id, text]) => h('button', { type: 'button', 'aria-pressed': id === value ? 'true' : 'false', 'data-value': id }, text));
  btns.forEach((b) => b.addEventListener('click', () => {
    btns.forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    sfx.click();
    onPick(b.dataset.value);
  }));
  wrap.append(...btns);
  wrap.set = (id) => btns.forEach((x) => x.setAttribute('aria-pressed', x.dataset.value === id ? 'true' : 'false'));
  return wrap;
}

// ------------------------------------------------------------------ step 1: one period → one candle

const PERIOD = {
  bull: { o: 100, h: 102.6, l: 98.6, c: 102.1 },
  bear: { o: 100, h: 101.4, l: 97.4, c: 97.9 },
};

/**
 * 61 one-minute prices for one hour whose open / high / low / close are exactly t, visiting the two
 * extremes in the given order. Generate-and-test: the high and low appear only at their waypoints and
 * no minute jumps more than 30% of the range; fallback is the straight path between waypoints.
 */
function makeTicks(t, highFirst, rng) {
  const range = t.h - t.l;
  const build = (noise, a, b) => {
    const first = highFirst ? t.h : t.l;
    const second = highFirst ? t.l : t.h;
    const pts = [[0, t.o], [a, first], [b, second], [60, t.c]];
    const ticks = new Array(61);
    for (let s = 0; s < 3; s++) {
      const [m0, p0] = pts[s];
      const [m1, p1] = pts[s + 1];
      let wig = 0;
      for (let m = m0; m <= m1; m++) {
        const u = (m - m0) / (m1 - m0);
        wig = wig * 0.55 + rng.gauss(0, 1) * 0.45 * noise;
        ticks[m] = p0 + (p1 - p0) * u + wig * Math.sin(Math.PI * u) * range * 0.07;
      }
    }
    const inner = (p) => Math.min(t.h - range * 0.03, Math.max(t.l + range * 0.03, p));
    for (let m = 0; m <= 60; m++) ticks[m] = +inner(ticks[m]).toFixed(2);
    for (const [m, p] of pts) ticks[m] = p;
    return { ticks, pts };
  };
  for (let i = 0; i < 30; i++) {
    const a = highFirst ? rng.int(10, 20) : rng.int(12, 22);
    const b = highFirst ? rng.int(34, 44) : rng.int(38, 50);
    const r = build(1, a, b);
    const maxStep = Math.max(...r.ticks.slice(1).map((p, j) => Math.abs(p - r.ticks[j])));
    if (Math.max(...r.ticks) === t.h && Math.min(...r.ticks) === t.l && maxStep <= range * 0.3) return r;
  }
  return build(0, highFirst ? 15 : 17, highFirst ? 40 : 44);
}

function periodCaption(kind, pts, m) {
  const bull = kind === 'bull';
  const t = PERIOD[kind];
  const a = pts[1][0];
  const b = pts[2][0];
  const firstHigh = pts[1][1] === t.h;
  if (m >= 60) {
    return `<strong>The hour is over: the close locks at <b>${fx(t.c)}</b>.</strong> ${bull ? 'Close above open: a bullish candle.' : 'Close below open: a bearish candle.'} The wicks keep the high (${fx(t.h)}) and the low (${fx(t.l)}) that did not hold.`;
  }
  if (m < 1) return `The hour opens at <b>${fx(t.o)}</b>. The open is fixed from the first trade on.`;
  if (m <= a) {
    return firstHigh
      ? 'Buyers push price above the open: the body is green and the upper wick grows with every new high.'
      : 'Sellers push price below the open: the body is red and the lower wick grows with every new low.';
  }
  if (m <= b) {
    return firstHigh
      ? 'Sellers take over and drive price below the open: the candle turns red and the lower wick stretches down.'
      : 'Buyers take over and drive price back above the open: the candle turns green and the upper wick stretches up.';
  }
  const second = firstHigh ? t.l : t.h;
  if (Math.abs(t.c - second) < (t.h - t.l) * 0.3) {
    return `Price eases back from the ${firstHigh ? 'low' : 'high'} in the last minutes, leaving a short ${firstHigh ? 'lower' : 'upper'} wick. Nothing is final until the close.`;
  }
  return firstHigh
    ? 'Buyers drive price back up in the last minutes: the body can change colour again and again until the close.'
    : 'Sellers drive price back down in the last minutes: the body can change colour again and again until the close.';
}

function periodStep() {
  return {
    title: 'One candle, one period of time',
    render(el, step, shell) {
      const rng = lessonRng(shell, 'period');
      let kind = 'bull';
      let variant = 0;
      let data = null;
      let m = 0;
      let W = 0;
      let playToken = 0;
      let alive = true;

      const box = h('div', { class: 'ca-svgbox' });
      const s = svgRoot('One hour of prices on the left, and the candle it builds on the right');
      box.append(s);
      const live = h('p', { class: 'ca-live', 'aria-live': 'polite' });
      const readout = h('div', { class: 'ca-readout' });
      const scrub = h('input', { type: 'range', min: 0, max: 60, step: 1, value: 0, 'aria-label': 'Minute of the hour' });
      const scrubVal = h('span', { class: 'mono' }, '0 min');
      const replay = h('button', { type: 'button', class: 'btn btn--sm btn--primary', 'data-action': 'replay-period' }, icon('restart', { size: 16 }), h('span', null, 'Replay'));
      const another = h('button', { type: 'button', class: 'btn btn--sm', 'data-action': 'new-path' }, icon('trendline', { size: 16 }), h('span', null, 'New path, same candle'));
      const kindPick = segmented([['bull', 'Bullish hour'], ['bear', 'Bearish hour']], kind, (v) => {
        kind = v;
        variant = 0;
        load();
        play();
      }, 'Which hour to play');
      const widget = h('div', { class: 'ca-widget', 'data-keys': 'capture' },
        box,
        h('div', { class: 'ca-scrub' }, h('span', null, 'Minute'), scrub, scrubVal),
        readout,
        h('div', { class: 'ca-controls' }, replay, kindPick, another));

      el.append(
        h('p', { html: 'A candlestick chart is made of candles, and every candle covers <strong>one period of time</strong>: a minute, an hour, a day or a week. Whatever happened inside that period gets squeezed into one shape.' }),
        figure(widget, 'One hour of trading. The line on the left is every minute’s price; the candle on the right builds in step with it. Drag the minute slider to scrub through the hour.', { label: 'Figure 1' }),
        live,
        h('p', { html: 'The <strong>open</strong> is set by the first trade. The body stretches between the open and the latest price, the wicks reach out to the highest and lowest prices so far, and the <strong>close</strong> is only locked in when the period ends.' }),
        h('p', { html: 'Press <strong>New path, same candle</strong>: a different journey through the hour can leave exactly the same candle. A candle records <em>where</em> price went, not the order it went there.' }));

      function load() {
        const t = PERIOD[kind];
        // Bullish hours dip first by default, bearish hours rally first; "new path" flips the order.
        const highFirst = (kind === 'bear') !== (variant % 2 === 1);
        data = { t, ...makeTicks(t, highFirst, rng.fork(`${kind}-${variant}`)) };
      }

      function priceAt(mm) {
        const i = Math.floor(mm);
        if (i >= 60) return data.ticks[60];
        const u = mm - i;
        return data.ticks[i] + (data.ticks[i + 1] - data.ticks[i]) * u;
      }

      function draw() {
        if (!data || !W) return;
        const { t, ticks } = data;
        const phone = W < 480;
        const H = phone ? 236 : 268;
        sizeSvg(s, W, H);
        const top = 14;
        const bottom = H - 30;
        const colW = phone ? 104 : 150;
        const axisW = 46;
        const x0 = 6;
        const x1 = W - colW - axisW;
        const range = t.h - t.l;
        const lo = Math.min(PERIOD.bull.l, PERIOD.bear.l) - range * 0.1;
        const hi = Math.max(PERIOD.bull.h, PERIOD.bear.h) + range * 0.1;
        const y = (p) => top + ((hi - p) / (hi - lo)) * (bottom - top);
        const x = (mm) => x0 + (mm / 60) * (x1 - x0);
        const cx = W - colW + (phone ? 22 : 30);
        const bw = phone ? 22 : 28;
        let out = '';
        const { ticks: grid } = niceTicks(lo, hi, 6);
        for (const g of grid) {
          if (g < lo || g > hi) continue;
          const yy = Math.round(y(g)) + 0.5;
          out += `<line class="ca-grid" x1="${x0}" x2="${W - 4}" y1="${yy}" y2="${yy}"/>`;
          out += `<text class="ca-axis" x="${r1(x1 + axisW - 8)}" y="${r1(yy + 4)}" text-anchor="end">${g.toFixed(0)}</text>`;
        }
        for (const mm of [0, 15, 30, 45, 60]) {
          out += `<text class="ca-axis" x="${r1(x(mm))}" y="${H - 10}" text-anchor="${mm === 0 ? 'start' : mm === 60 ? 'end' : 'middle'}">${mm === 60 ? '60 min' : mm}</text>`;
        }
        // Open reference
        out += `<line class="ca-ref" x1="${x0}" x2="${r1(cx)}" y1="${r1(y(t.o))}" y2="${r1(y(t.o))}"/>`;
        // Whole path faintly, then the part already traded
        out += `<path class="ca-tick-ghost" d="${ticks.map((p, i) => `${i ? 'L' : 'M'}${r1(x(i))},${r1(y(p))}`).join('')}"/>`;
        const upto = Math.floor(m);
        const now = priceAt(m);
        let d = '';
        for (let i = 0; i <= Math.min(upto, 60); i++) d += `${i ? 'L' : 'M'}${r1(x(i))},${r1(y(ticks[i]))}`;
        if (m < 60) d += `L${r1(x(m))},${r1(y(now))}`;
        out += `<path class="ca-tick-line" d="${d}"/>`;
        // Running high / low and where they were set
        let runH = t.o;
        let runL = t.o;
        let iH = 0;
        let iL = 0;
        for (let i = 0; i <= Math.min(upto, 60); i++) {
          if (ticks[i] > runH) { runH = ticks[i]; iH = i; }
          if (ticks[i] < runL) { runL = ticks[i]; iL = i; }
        }
        if (now > runH) { runH = now; iH = m; }
        if (now < runL) { runL = now; iL = m; }
        const done = m >= 60;
        if (runH > t.o + 1e-9) out += `<line class="ca-ref ca-ref--hi" x1="${r1(x(iH))}" x2="${r1(cx)}" y1="${r1(y(runH))}" y2="${r1(y(runH))}"/>`;
        if (runL < t.o - 1e-9) out += `<line class="ca-ref ca-ref--lo" x1="${r1(x(iL))}" x2="${r1(cx)}" y1="${r1(y(runL))}" y2="${r1(y(runL))}"/>`;
        if (!done) out += `<line class="ca-now" x1="${r1(x(m))}" x2="${r1(cx - bw / 2 - 2)}" y1="${r1(y(now))}" y2="${r1(y(now))}"/>`;
        // The candle so far
        const k = { o: t.o, h: runH, l: runL, c: done ? t.c : now };
        out += candleMarkup(k, cx, y, bw, dirClass(k));
        if (!done) out += `<circle class="ca-dot" cx="${r1(x(m))}" cy="${r1(y(now))}" r="5"/>`;
        // Labels beside the candle
        const lx = cx + bw / 2 + 8;
        const labels = [
          { y: y(runH), text: done ? 'High' : 'High so far', cls: 'ca-label--bull', p: runH, show: runH > t.o + 1e-9 },
          { y: y(runL), text: done ? 'Low' : 'Low so far', cls: 'ca-label--bear', p: runL, show: runL < t.o - 1e-9 },
          { y: y(t.o), text: 'Open', cls: 'ca-label--strong', p: t.o, show: true },
          { y: y(k.c), text: done ? 'Close' : 'Now', cls: 'ca-label--accent', p: k.c, show: Math.abs(k.c - t.o) > range * 0.02 },
        ].filter((l) => l.show);
        for (const l of spreadLabels(labels, phone ? 14 : 15, top + 4, bottom)) {
          const txt = phone ? l.text.replace(' so far', '') : `${l.text} ${fx(l.p)}`;
          out += `<text class="ca-label ${l.cls}${phone ? '' : ' ca-price'}" x="${r1(lx)}" y="${r1(l.py + 4)}">${txt}</text>`;
        }
        if (done) {
          const ty = Math.min(bottom - 10, y(t.l) + 16);
          out += `<g class="ca-lock"><rect x="${r1(cx - 32)}" y="${r1(ty - 9)}" width="64" height="18" rx="9"/><text x="${r1(cx)}" y="${r1(ty + 4)}" text-anchor="middle">Closed</text></g>`;
        }
        s.innerHTML = out;
        // Readout, slider, caption
        scrub.value = String(Math.floor(m));
        scrubVal.textContent = `${Math.floor(m)} min`;
        readout.innerHTML = `<span>Price <b>${fx(k.c)}</b></span><span>O <b>${fx(t.o)}</b></span><span>H <b>${fx(runH)}</b></span><span>L <b>${fx(runL)}</b></span><span>C <b>${done ? fx(t.c) : '…'}</b></span>`;
        const cap = periodCaption(kind, data.pts, m);
        if (live.dataset.cap !== cap) {
          live.dataset.cap = cap;
          live.innerHTML = cap;
          live.className = `ca-live ${done ? (kind === 'bull' ? 'is-bull' : 'is-bear') : 'is-neutral'}`;
        }
      }

      function play() {
        const my = ++playToken;
        if (reducedMotion()) {
          m = 60;
          draw();
          return;
        }
        const dur = 7000;
        tween({
          from: 0, to: 60, duration: dur, ease: (u) => u,
          onUpdate: (v) => {
            if (my !== playToken || !alive) return;
            m = v;
            draw();
          },
        }).then(() => {
          if (my === playToken && alive) sfx.click();
        });
      }

      replay.addEventListener('click', () => play());
      another.addEventListener('click', () => {
        variant += 1;
        load();
        sfx.whoosh();
        play();
      });
      scrub.addEventListener('input', () => {
        playToken += 1; // user takes over: stop the animation
        m = Number(scrub.value);
        draw();
      });

      load();
      m = reducedMotion() ? 60 : 0;
      const stopWatch = watchWidth(box, (w) => {
        W = w;
        draw();
      });
      const t0 = setTimeout(() => alive && play(), 450);
      return () => {
        alive = false;
        playToken += 1;
        clearTimeout(t0);
        stopWatch();
      };
    },
  };
}

// ------------------------------------------------------------------ step 2: the four prices

const PAIR = {
  bull: { o: 99.2, h: 104.2, l: 97.5, c: 103.1 },
  bear: { o: 103.1, h: 104.2, l: 97.5, c: 99.2 },
};

const PARTS = [
  ['open', 'Open'], ['high', 'High'], ['low', 'Low'], ['close', 'Close'],
  ['body', 'Body'], ['upper', 'Upper wick'], ['lower', 'Lower wick'],
];

const PART_DEF = {
  open: 'The first price traded in the period.',
  high: 'The highest price traded in the period: the tip of the upper wick.',
  low: 'The lowest price traded in the period: the tip of the lower wick.',
  close: 'The last price traded in the period. Many traders treat it as the most important price, because it is where the period’s tug of war ended.',
  body: 'The box between the open and the close. Its length is how far price moved from the start of the period to the end.',
  upper: 'The thin line from the top of the body up to the high, also called the upper shadow: prices that traded but did not hold into the close.',
  lower: 'The thin line from the bottom of the body down to the low, also called the lower shadow: prices that traded but did not hold into the close.',
};

function partValues(part, k) {
  const bull = k.c > k.o;
  const top = Math.max(k.o, k.c);
  const bot = Math.min(k.o, k.c);
  switch (part) {
    case 'open': return `${fx(k.o)}, the ${bull ? 'bottom' : 'top'} of the body`;
    case 'close': return `${fx(k.c)}, the ${bull ? 'top' : 'bottom'} of the body`;
    case 'high': return `${fx(k.h)}`;
    case 'low': return `${fx(k.l)}`;
    case 'body': return bull ? `from the open ${fx(k.o)} up to the close ${fx(k.c)}` : `from the open ${fx(k.o)} down to the close ${fx(k.c)}`;
    case 'upper': return `from ${fx(top)} (the ${bull ? 'close' : 'open'}) up to ${fx(k.h)}`;
    case 'lower': return `from ${fx(bot)} (the ${bull ? 'open' : 'close'}) down to ${fx(k.l)}`;
    default: return '';
  }
}

function partsStep() {
  return {
    title: 'The four prices: open, high, low, close',
    render(el) {
      let sel = 'open';
      let hover = null;
      let W = 0;
      const box = h('div', { class: 'ca-svgbox' });
      const s = svgRoot('A bullish and a bearish candle with the same high and low, labelled');
      box.append(s);
      const btns = PARTS.map(([id, label]) => h('button', { type: 'button', class: 'btn btn--sm', 'data-part': id, 'aria-pressed': id === sel ? 'true' : 'false' }, label));
      const def = h('div', { class: 'ca-def', 'aria-live': 'polite' });
      const widget = h('div', { class: 'ca-widget' },
        box,
        h('div', { class: 'ca-parts', role: 'group', 'aria-label': 'Candle parts' }, btns),
        def);
      el.append(
        h('p', { html: 'Every candle records four prices for its period: the <strong>open</strong>, the <strong>high</strong>, the <strong>low</strong> and the <strong>close</strong> (OHLC for short). The shape is drawn from those four numbers and nothing else.' }),
        figure(widget, 'Same high, same low, same two prices at the ends of the body. Only the order of open and close differs. Tap a part of either candle, or a button, to see where it sits on each.', { label: 'Figure 2' }),
        h('p', { html: 'Notice the trap: the open is the <em>bottom</em> of a bullish body but the <em>top</em> of a bearish one. Always find the colour first, then you know which end of the body is the close.' }));

      function pick(id, { sound = true } = {}) {
        sel = id;
        btns.forEach((b) => b.setAttribute('aria-pressed', b.dataset.part === id ? 'true' : 'false'));
        if (sound) sfx.click();
        const name = PARTS.find((p) => p[0] === id)[1];
        def.innerHTML = '';
        def.append(
          h('h3', null, name),
          h('p', null, PART_DEF[id]),
          h('div', { class: 'ca-def__vals' },
            h('span', null, h('strong', { class: 'up' }, 'Bullish: '), partValues(id, PAIR.bull)),
            h('span', null, h('strong', { class: 'down' }, 'Bearish: '), partValues(id, PAIR.bear))));
        draw();
      }

      function draw() {
        if (!W) return;
        const phone = W < 480;
        const H = phone ? 270 : 300;
        sizeSvg(s, W, H);
        const top = 40;
        const bottom = H - 16;
        const lo = 97.5 - 0.6;
        const hi = 104.2 + 0.6;
        const y = (p) => top + ((hi - p) / (hi - lo)) * (bottom - top);
        const half = W / 2;
        const bw = phone ? 26 : 34;
        const active = hover || sel;
        let out = '';
        ['bull', 'bear'].forEach((kind, i) => {
          const k = PAIR[kind];
          const cx = i * half + (phone ? 40 : Math.min(half * 0.3, 110));
          const bull = kind === 'bull';
          const yT = y(Math.max(k.o, k.c));
          const yB = y(Math.min(k.o, k.c));
          out += `<text class="ca-label ${bull ? 'ca-label--bull' : 'ca-label--bear'}" x="${r1(cx - bw / 2)}" y="18">${bull ? 'Bullish candle' : 'Bearish candle'}</text>`;
          const dim = (part) => (active && active !== part ? ' is-dim' : '');
          const wickDim = active && !['upper', 'lower', 'high', 'low'].includes(active) ? ' is-dim' : '';
          const bodyDim = active && !['body', 'open', 'close'].includes(active) ? ' is-dim' : '';
          const cls = bull ? 'ca-up' : 'ca-dn';
          out += `<path class="ca-wick ${cls}${wickDim}" d="M${r1(cx)},${r1(y(k.h))}V${r1(yT)}M${r1(cx)},${r1(yB)}V${r1(y(k.l))}"/>`;
          out += `<rect class="${cls}${bodyDim}" x="${r1(cx - bw / 2)}" y="${r1(yT)}" width="${bw}" height="${r1(yB - yT)}" rx="2"/>`;
          // Highlights
          if (active === 'body') out += `<rect class="ca-sel" x="${r1(cx - bw / 2 - 5)}" y="${r1(yT - 5)}" width="${bw + 10}" height="${r1(yB - yT + 10)}" rx="4"/>`;
          if (active === 'upper') out += `<rect class="ca-sel-fill" x="${r1(cx - 8)}" y="${r1(y(k.h) - 3)}" width="16" height="${r1(yT - y(k.h) + 3)}" rx="4"/><rect class="ca-sel" x="${r1(cx - 8)}" y="${r1(y(k.h) - 3)}" width="16" height="${r1(yT - y(k.h) + 3)}" rx="4"/>`;
          if (active === 'lower') out += `<rect class="ca-sel-fill" x="${r1(cx - 8)}" y="${r1(yB)}" width="16" height="${r1(y(k.l) - yB + 3)}" rx="4"/><rect class="ca-sel" x="${r1(cx - 8)}" y="${r1(yB)}" width="16" height="${r1(y(k.l) - yB + 3)}" rx="4"/>`;
          // Price labels on the right with leader lines
          const lx = cx + bw / 2 + 12;
          const items = [
            { part: 'high', y: y(k.h), text: 'High', p: k.h },
            { part: bull ? 'close' : 'open', y: yT, text: bull ? 'Close' : 'Open', p: Math.max(k.o, k.c) },
            { part: bull ? 'open' : 'close', y: yB, text: bull ? 'Open' : 'Close', p: Math.min(k.o, k.c) },
            { part: 'low', y: y(k.l), text: 'Low', p: k.l },
          ];
          for (const it of spreadLabels(items, 18, top - 6, bottom + 4)) {
            const on = active === it.part;
            if (on) out += `<line class="ca-sel" x1="${r1(cx - bw / 2 - 8)}" x2="${r1(lx - 4)}" y1="${r1(it.y)}" y2="${r1(it.y)}" style="stroke-width:2"/>`;
            else out += `<path class="ca-ref${dim(it.part)}" d="M${r1(cx + bw / 2 + 3)},${r1(it.y)}L${r1(lx - 4)},${r1(it.py)}"/>`;
            out += `<text class="ca-label ${on ? 'ca-label--accent' : 'ca-label--strong'}${dim(it.part)}" x="${r1(lx)}" y="${r1(it.py + 4)}">${it.text} <tspan class="ca-price">${fx(it.p)}</tspan></text>`;
            out += `<rect class="ca-hit" data-part="${it.part}" x="${r1(lx - 6)}" y="${r1(it.py - 11)}" width="${phone ? 96 : 110}" height="22"/>`;
          }
          // Hit areas for the candle parts
          out += `<rect class="ca-hit" data-part="upper" x="${r1(cx - 16)}" y="${r1(y(k.h) - 6)}" width="32" height="${r1(Math.max(12, yT - y(k.h) + 4))}"/>`;
          out += `<rect class="ca-hit" data-part="body" x="${r1(cx - bw / 2 - 4)}" y="${r1(yT + 2)}" width="${bw + 8}" height="${r1(Math.max(12, yB - yT - 4))}"/>`;
          out += `<rect class="ca-hit" data-part="lower" x="${r1(cx - 16)}" y="${r1(yB - 2)}" width="32" height="${r1(Math.max(12, y(k.l) - yB + 8))}"/>`;
        });
        s.innerHTML = out;
      }

      s.addEventListener('click', (e) => {
        const part = e.target.closest?.('[data-part]')?.dataset.part;
        if (part) {
          hover = null;
          pick(part);
        }
      });
      s.addEventListener('pointerover', (e) => {
        if (e.pointerType !== 'mouse') return;
        const part = e.target.closest?.('[data-part]')?.dataset.part || null;
        if (part !== hover) {
          hover = part;
          draw();
        }
      });
      s.addEventListener('pointerleave', () => {
        if (hover) {
          hover = null;
          draw();
        }
      });
      btns.forEach((b) => b.addEventListener('click', () => pick(b.dataset.part)));
      pick('open', { sound: false });
      return watchWidth(box, (w) => {
        W = w;
        draw();
      });
    },
  };
}

// ------------------------------------------------------------------ step 3: bullish vs bearish

const STYLE_NOTES = {
  color: 'Green for up, red for down: the colours this site uses.',
  hollow: 'Hollow and filled: a hollow body closed above its open, a filled body below. Common on print and black-and-white charts.',
  redup: 'Red for up, green for down: the convention in some markets, for example mainland China. Same candles, opposite colours.',
};

function styleCandles(rng) {
  for (let i = 0; i < 30; i++) {
    const c = randomWalk({ seed: rng.int(1, 2 ** 31 - 2), count: 16, start: 100, vol: 0.012, volume: false });
    const f = c.map(features);
    const ups = f.filter((x) => x.dir > 0 && x.bodyR > 0.25).length;
    const downs = f.filter((x) => x.dir < 0 && x.bodyR > 0.25).length;
    const pickIdx = [11, 12, 13, 10, 14].find((j) => f[j].dir > 0 && f[j].bodyR >= 0.5);
    if (ups >= 5 && downs >= 5 && pickIdx != null) return { candles: c, pick: pickIdx };
  }
  const closes = [100, 101.2, 100.4, 99.1, 100.3, 101.5, 101, 102.2, 101.4, 100.6, 101.9, 103.1, 102.4, 101.8, 102.9, 102.2];
  const candles = closes.map((cl, i) => {
    const o = i ? closes[i - 1] : 99.4;
    return { o, h: Math.max(o, cl) + 0.35, l: Math.min(o, cl) - 0.3, c: cl, t: i, v: 0 };
  });
  return { candles, pick: 11 };
}

function stylesStep() {
  return {
    title: 'Bullish or bearish? Colour is only a convention',
    render(el, step, shell) {
      const { candles, pick } = styleCandles(lessonRng(shell, 'styles'));
      let style = 'color';
      let W = 0;
      const box = h('div', { class: 'ca-svgbox' });
      const s = svgRoot('A short candlestick chart drawn in the chosen colour style, with one bullish candle labelled Open and Close');
      box.append(s);
      const note = h('p', { class: 'ca-hint', 'aria-live': 'polite' }, STYLE_NOTES.color);
      const pickStyle = segmented([['color', 'Green / red'], ['hollow', 'Hollow / filled'], ['redup', 'Red for up']], style, (v) => {
        style = v;
        note.textContent = STYLE_NOTES[v];
        draw();
      }, 'Candle colour style');
      const widget = h('div', { class: 'ca-widget' }, box, h('div', { class: 'ca-controls' }, pickStyle), note);

      el.append(
        h('p', { html: 'A candle is <strong>bullish</strong> when it closes <em>above</em> its open: buyers won the period. It is <strong>bearish</strong> when it closes <em>below</em> its open: sellers won. On this site bullish candles are green and bearish ones red.' }),
        figure(widget, 'The same sixteen candles in three colour styles. The ringed candle is bullish in every one of them, because its close sits above its open.', { label: 'Figure 3' }),
        h('p', { html: 'Platforms disagree about colours: some draw hollow and filled bodies, some use blue and orange, and some markets use red for up. The colour is a convention; <strong>where the close sits compared with the open</strong> is the fact.' }),
        gapFigure(),
        h('p', { html: 'One more subtlety: colour compares a candle with <em>its own</em> open, not with the previous candle. When a period opens with a jump (a <strong>gap</strong>, common after a weekend or overnight), a candle can be green and still finish lower than the one before it.' }));

      function draw() {
        if (!W) return;
        const phone = W < 480;
        const H = phone ? 200 : 230;
        sizeSvg(s, W, H);
        const top = 26;
        const bottom = H - 14;
        let lo = Infinity;
        let hi = -Infinity;
        for (const k of candles) {
          lo = Math.min(lo, k.l);
          hi = Math.max(hi, k.h);
        }
        const pad = (hi - lo) * 0.08;
        lo -= pad;
        hi += pad;
        const y = (p) => top + ((hi - p) / (hi - lo)) * (bottom - top);
        const plotW = W - 16;
        const slot = plotW / (candles.length + 2.2);
        const bw = Math.max(6, Math.min(20, slot * 0.62));
        let out = `<g class="ca-sty-${style}">`;
        candles.forEach((k, i) => {
          const x = 8 + (i + 0.5) * slot;
          const cls = `ca-c-body ${k.c >= k.o ? 'ca-c-up' : 'ca-c-dn'}`;
          const yT = y(Math.max(k.o, k.c));
          const yB = y(Math.min(k.o, k.c));
          out += `<path class="${cls}" style="stroke-width:1.75" d="M${r1(x)},${r1(y(k.h))}V${r1(yT)}M${r1(x)},${r1(yB)}V${r1(y(k.l))}"/>`;
          out += `<rect class="${cls}" x="${r1(x - bw / 2)}" y="${r1(yT)}" width="${r1(bw)}" height="${r1(Math.max(2, yB - yT))}" rx="1.5"/>`;
        });
        out += '</g>';
        const k = candles[pick];
        const x = 8 + (pick + 0.5) * slot;
        const cy = (y(k.h) + y(k.l)) / 2;
        const ry = (y(k.l) - y(k.h)) / 2 + 9;
        out += `<ellipse class="ca-ring" cx="${r1(x)}" cy="${r1(cy)}" rx="${r1(bw / 2 + 9)}" ry="${r1(ry)}"/>`;
        const tag = (ty, text) => {
          const tx = x + bw / 2 + 14;
          const tw = text.length * 6.6 + 12;
          return `<line class="ca-ref" x1="${r1(x + bw / 2 + 2)}" x2="${r1(tx)}" y1="${r1(ty)}" y2="${r1(ty)}"/><g class="ca-tag"><rect x="${r1(tx)}" y="${r1(ty - 9)}" width="${r1(tw)}" height="18" rx="9"/><text x="${r1(tx + tw / 2)}" y="${r1(ty + 4)}" text-anchor="middle">${text}</text></g>`;
        };
        const tags = spreadLabels([{ y: y(k.c), text: 'Close' }, { y: y(k.o), text: 'Open' }], 21, top, bottom);
        for (const t of tags) out += tag(t.py, t.text);
        s.innerHTML = out;
      }
      return watchWidth(box, (w) => {
        W = w;
        draw();
      });
    },
    quiz: {
      question: 'You open a charting platform whose colours you have never seen. What tells you for sure that a candle is bullish?',
      options: [
        { label: 'Its close is higher than its own open', value: 0 },
        { label: 'It is drawn in green', value: 1 },
        { label: 'It is taller than the candle before it', value: 2 },
        { label: 'It closed higher than the previous candle closed', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Close above its own open.</strong> Colour is the platform’s choice, size says nothing about direction, and after a gap a bullish candle can still close below the previous close.',
    },
  };
}

function gapFigure() {
  const W = 360;
  const H = 190;
  const s = svg('svg', { class: 'ca-svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'A bullish candle that opened below the previous close and closed below it too' });
  const a = { o: 99.6, h: 103.4, l: 99.2, c: 103 };
  const b = { o: 100.8, h: 102.8, l: 100.3, c: 102.4 };
  const lo = 98.8;
  const hi = 103.8;
  const y = (p) => 14 + ((hi - p) / (hi - lo)) * (H - 28);
  let out = candleMarkup(a, 60, y, 26, 'ca-up') + candleMarkup(b, 130, y, 26, 'ca-up');
  out += `<line class="ca-ref" x1="74" x2="200" y1="${r1(y(a.c))}" y2="${r1(y(a.c))}"/>`;
  out += `<text class="ca-label ca-label--strong" x="206" y="${r1(y(a.c) + 4)}">Previous close <tspan class="ca-price">${fx(a.c)}</tspan></text>`;
  out += `<line class="ca-ref" x1="144" x2="200" y1="${r1(y(b.c))}" y2="${r1(y(b.c))}"/>`;
  out += `<text class="ca-label ca-label--accent" x="206" y="${r1(y(b.c) + 16)}">Close <tspan class="ca-price">${fx(b.c)}</tspan></text>`;
  out += `<line class="ca-ref" x1="144" x2="200" y1="${r1(y(b.o))}" y2="${r1(y(b.o))}"/>`;
  out += `<text class="ca-label ca-label--strong" x="206" y="${r1(y(b.o) + 4)}">Open <tspan class="ca-price">${fx(b.o)}</tspan></text>`;
  out += `<text class="ca-label" x="130" y="${r1(y(b.l) + 18)}" text-anchor="middle">Gap down</text>`;
  s.innerHTML = out;
  return figure(h('div', { class: 'ca-fixed' }, s), 'The second candle opened below the previous close (a gap), rallied and closed above its own open. It is bullish, even though it finished lower than the candle before it.', { label: 'Figure 4' });
}

// ------------------------------------------------------------------ step 4: try it — build a candle

const PRESETS = [
  ['Strong bull', { o: 98.2, h: 103.8, l: 97.9, c: 103.5 }],
  ['Strong bear', { o: 103.6, h: 103.9, l: 97.6, c: 98.1 }],
  ['Doji', { o: 100.2, h: 102.6, l: 97.8, c: 100.2 }],
  ['Long lower wick', { o: 101.4, h: 102.6, l: 96.8, c: 102.4 }],
  ['Long upper wick', { o: 98.8, h: 104.4, l: 98.6, c: 99.7 }],
  ['Spinning top', { o: 99.6, h: 102.8, l: 97.2, c: 100.5 }],
];

function builderStep() {
  return {
    title: 'Try it: build a candle',
    render(el) {
      const host = h('div', { class: 'ca-builder' });
      const live = h('p', { class: 'ca-live', 'aria-live': 'polite' });
      const presets = PRESETS.map(([label, v]) => {
        const b = h('button', { type: 'button', class: 'btn btn--sm', 'data-preset': label }, label);
        b.addEventListener('click', () => {
          sfx.click();
          builder.set(v, { animate: true, duration: 600 });
        });
        return b;
      });
      const widget = h('div', { class: 'ca-widget', 'data-keys': 'capture' },
        host,
        live,
        h('div', { class: 'ca-presets', role: 'group', 'aria-label': 'Example candles' }, h('span', { class: 'faint', style: 'align-self:center;font-size:14px' }, 'Try:'), presets),
        h('div', { class: 'ca-controls ca-kbd' }, kbdHint(['O', 'H', 'L', 'C'], 'pick a handle'), kbdHint(['↑', '↓'], 'one tick'), kbdHint('Shift', '×10')));
      el.append(
        h('p', { html: 'Drag the four handles to set the open, high, low and close, and watch the candle and its story update. On a keyboard, press <kbd class="kbd">O</kbd>, <kbd class="kbd">H</kbd>, <kbd class="kbd">L</kbd> or <kbd class="kbd">C</kbd> to pick a handle and use the arrow keys.' }),
        figure(widget, 'A live candle builder. The high can never sit below the body and the low never above it: push the open or close past them and they move along.', { label: 'Figure 5' }),
        h('p', { html: 'The story tells the usual path: a bullish candle is described as dipping first and then rallying, a bearish one the other way round. That is only the likeliest route. A candle does not record whether the high or the low came first.' }));
      const narrate = (v) => {
        const d = describeCandle(v, 2);
        live.innerHTML = d.html;
        live.className = `ca-live is-${d.tone}`;
      };
      const builder = createBuilder(host, {
        min: 95, max: 106, tick: 0.1, decimals: 2,
        values: { o: 100, h: 102.4, l: 98.8, c: 101.8 },
        onChange: narrate,
        ariaLabel: 'Candle builder: drag Open, High, Low and Close',
      });
      narrate(builder.values);
      return () => builder.destroy();
    },
  };
}

// ------------------------------------------------------------------ step 5: wicks = rejection

const WICK_CARDS = [
  {
    title: 'Long lower wick',
    path: [[0, 0.72], [0.18, 0.5], [0.42, 0], [0.6, 0.42], [0.86, 1], [1, 0.95]],
    text: 'Sellers drove price far below the open (red). Buyers pushed back and closed it near the high (green). The low was rejected.',
  },
  {
    title: 'Long upper wick',
    path: [[0, 0.28], [0.18, 0.5], [0.42, 1], [0.6, 0.58], [0.86, 0], [1, 0.05]],
    text: 'Buyers drove price far above the open (green). Sellers pushed back and closed it near the low (red). The high was rejected.',
  },
  {
    title: 'Long wicks on both sides',
    path: [[0, 0.5], [0.28, 1], [0.5, 0.55], [0.72, 0], [1, 0.56]],
    text: 'Both sides pushed hard and both got pushed back. The close ended near the open: indecision.',
  },
];

function wickCard(card) {
  const W = 180;
  const H = 170;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${card.title}: the price path and the candle it leaves` });
  const top = 14;
  const bottom = H - 14;
  const y = (p) => top + (1 - p) * (bottom - top);
  const x = (t) => 10 + t * 100;
  const cx = 148;
  const bw = 24;
  // Sample the path finely for the animation.
  const pts = [];
  for (let i = 0; i < card.path.length - 1; i++) {
    const [t0, p0] = card.path[i];
    const [t1, p1] = card.path[i + 1];
    const n = Math.max(2, Math.round((t1 - t0) * 60));
    for (let j = 0; j < n; j++) pts.push([t0 + ((t1 - t0) * j) / n, p0 + ((p1 - p0) * j) / n]);
  }
  pts.push(card.path[card.path.length - 1]);
  const o = card.path[0][1];
  const draw = (u) => {
    const n = Math.max(1, Math.round(u * (pts.length - 1)));
    const seen = pts.slice(0, n + 1);
    let hi = o;
    let lo = o;
    for (const [, p] of seen) {
      hi = Math.max(hi, p);
      lo = Math.min(lo, p);
    }
    const c = seen[seen.length - 1][1];
    let out = `<line class="ca-grid" x1="8" x2="112" y1="${bottom}" y2="${bottom}"/>`;
    out += `<line class="ca-ref" x1="10" x2="${cx}" y1="${r1(y(o))}" y2="${r1(y(o))}"/>`;
    // Path segments coloured by direction: red = pushed down, green = pushed up.
    for (let i = 1; i < seen.length; i++) {
      const up = seen[i][1] >= seen[i - 1][1];
      out += `<path class="${up ? 'ca-path-up' : 'ca-path-dn'}" d="M${r1(x(seen[i - 1][0]))},${r1(y(seen[i - 1][1]))}L${r1(x(seen[i][0]))},${r1(y(seen[i][1]))}"/>`;
    }
    const last = seen[seen.length - 1];
    if (u < 1) out += `<circle class="ca-dot" cx="${r1(x(last[0]))}" cy="${r1(y(last[1]))}" r="4.5"/>`;
    out += candleMarkup({ o, h: hi, l: lo, c }, cx, y, bw, dirClass({ o, c }));
    s.innerHTML = out;
  };
  draw(reducedMotion() ? 1 : 0);
  return { el: s, draw };
}

function wicksStep() {
  const compare = compareStep({
    title: 'Wicks show rejection',
    text: '<strong>Recognise it:</strong> two bullish candles at the top of a rise. Both closed above their open, but only one held its gains.',
    height: 210,
    left: {
      title: 'Strong close',
      verdict: 'good',
      tag: 'Held',
      example: (rng) => compareExample(rng, 'strong'),
      points: ['Closed right near its high', 'Tiny upper wick: sellers barely pushed back', 'Buyers kept control into the close'],
    },
    right: {
      title: 'Pushed back from the high',
      verdict: 'bad',
      tag: 'Rejected',
      example: (rng) => compareExample(rng, 'rejected'),
      points: ['Traded far higher, then fell back', 'Long upper wick: those prices were rejected', 'Still bullish, but a much weaker close'],
    },
    after: 'A wick is not a signal on its own. It tells you who pushed back <em>in that period</em>; the next lesson shows when that matters.',
  });
  return {
    title: 'Wicks show rejection',
    render(el, step, shell) {
      const cards = WICK_CARDS.map((c) => ({ ...c, ...wickCard(c) }));
      let token = 0;
      const replay = h('button', { type: 'button', class: 'btn btn--sm btn--primary', 'data-action': 'replay-wicks' }, icon('restart', { size: 16 }), h('span', null, 'Replay'));
      const grid = h('div', { class: 'ca-cards ca-cards--3' }, cards.map((c) => h('div', { class: 'ca-card' }, c.el, h('h3', null, c.title), h('p', null, c.text))));
      el.append(
        h('p', { html: 'A wick marks prices that traded during the period but did <strong>not</strong> survive to the close. Somebody pushed price there, and somebody else pushed it back. That is why traders read long wicks as <strong>rejection</strong>.' }),
        figure(h('div', { class: 'ca-widget' }, grid, h('div', { class: 'ca-controls' }, replay)),
          'Each path is one period. Red legs are sellers pushing down, green legs are buyers pushing up; the candle on the right keeps only the result.', { label: 'Figure 6' }));
      const play = () => {
        const my = ++token;
        if (reducedMotion()) {
          cards.forEach((c) => c.draw(1));
          return;
        }
        cards.forEach((c, i) => {
          c.draw(0);
          tween({ from: 0, to: 1, duration: 2600, delay: i * 350, ease: (u) => u, onUpdate: (v) => { if (my === token) c.draw(v); } });
        });
      };
      replay.addEventListener('click', () => {
        sfx.click();
        play();
      });
      const t0 = setTimeout(play, 300);
      const cleanCompare = compare.render(el, step, shell);
      return () => {
        token += 1;
        clearTimeout(t0);
        cleanCompare?.();
      };
    },
  };
}

/** Rising lead-in plus a final bullish candle: a strong close, or one pushed back from its high. */
function compareExample(rng, kind) {
  const make = (seed) => {
    const { candles } = fromPath([[0, 96], [0.5, 98.2], [1, 100]], { seed, count: 14, noise: 0.35, wick: 0.5, volume: false });
    const R = candles.reduce((sum, k) => sum + (k.h - k.l), 0) / candles.length;
    const last = candles[candles.length - 1];
    const o = last.c;
    const k = kind === 'strong'
      ? { o, c: o + 1.9 * R, h: o + 1.97 * R, l: o - 0.08 * R }
      : { o, c: o + 0.45 * R, h: o + 2.3 * R, l: o - 0.08 * R };
    return { candles: [...candles, { ...k, v: 0, t: candles.length }], R };
  };
  for (let i = 0; i < 30; i++) {
    const { candles, R } = make(rng.int(1, 2 ** 31 - 2));
    const lead = candles.slice(0, -1);
    const fin = candles[candles.length - 1];
    const f = features(fin);
    const rising = lead[lead.length - 1].c - lead[0].o > 2 * R;
    const top = fin.h > Math.max(...lead.map((k) => k.h));
    const shapeOk = kind === 'strong' ? f.bodyR >= 0.8 && f.upperR <= 0.06 : f.upperR >= 0.6 && f.bodyR <= 0.3 && f.dir > 0;
    if (rising && top && shapeOk) {
      const n = candles.length - 1;
      return { candles, overlays: [{ type: 'box', from: n, to: n, color: kind === 'strong' ? 'bull' : 'bear' }] };
    }
  }
  const { candles } = make(7);
  const n = candles.length - 1;
  return { candles, overlays: [{ type: 'box', from: n, to: n, color: 'accent' }] };
}

// ------------------------------------------------------------------ step 6: body size = conviction

const BODY_CARDS = [
  { title: 'Marubozu', k: { o: 0.03, h: 1, l: 0, c: 0.98 }, text: 'All body, almost no wicks: one side controlled the whole period. Maximum conviction.' },
  { title: 'Normal candle', k: { o: 0.2, h: 1, l: 0, c: 0.82 }, text: 'A healthy body with some wick: a clear winner, with some push-back.' },
  { title: 'Spinning top', k: { o: 0.4, h: 1, l: 0, c: 0.58 }, text: 'Small body, wicks on both sides longer than it: both sides tried, neither won.' },
  { title: 'Doji', k: { o: 0.5, h: 1, l: 0, c: 0.51 }, text: 'Open and close almost equal: perfect balance. Most telling after a strong move.' },
];

function bodyStep() {
  return {
    title: 'Body size shows conviction',
    render(el) {
      const fills = [];
      const cards = BODY_CARDS.map((card, i) => {
        const W = 90;
        const H = 150;
        const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${card.title} candle` });
        const y = (p) => 10 + (1 - p) * (H - 20);
        s.innerHTML = candleMarkup(card.k, W / 2, y, 30, i === 3 ? 'ca-flat' : 'ca-up');
        const f = features(card.k);
        const fill = h('span', { style: { transform: `scaleX(${reducedMotion() ? f.bodyR : 0})` } });
        fills.push([fill, f.bodyR]);
        return h('div', { class: 'ca-card' },
          s,
          h('h3', null, card.title),
          h('div', { class: 'ca-meter', role: 'img', 'aria-label': `Body ${Math.round(f.bodyR * 100)}% of the range` }, fill),
          h('span', { class: 'ca-meter-label', 'aria-hidden': 'true' }, `Body ${Math.round(f.bodyR * 100)}%`),
          h('p', null, card.text));
      });
      el.append(
        h('p', { html: 'The <strong>body</strong> is the distance from open to close. Compare it with the whole <strong>range</strong> (high minus low) and you get a quick read of conviction: how completely one side won the period.' }),
        figure(h('div', { class: 'ca-cards ca-cards--4' }, cards), 'From full conviction to none. The bar under each candle is its body as a share of its range.', { label: 'Figure 7' }),
        h('p', { html: 'Rules of thumb used on this site: a <strong>marubozu</strong> has a body of at least 90% of its range; a <strong>doji</strong> has a body of 8% or less; a <strong>spinning top</strong> sits in between with a body of 10 to 30% and longer wicks. Books and platforms draw these lines slightly differently.' }),
        h('p', { html: 'Size is relative, too. A long body after many small candles says far more than one long body among many. Always compare a candle with its neighbours.' }));
      const t = setTimeout(() => fills.forEach(([f, v]) => { f.style.transform = `scaleX(${v})`; }), 120);
      return () => clearTimeout(t);
    },
    quiz: {
      question: 'A candle trades between 48.00 and 52.00. It opens at 49.95 and closes at 50.05. How should you read it?',
      options: [
        { label: 'A doji: open and close almost equal, so neither side won', value: 0 },
        { label: 'A strong bullish candle, because it closed above its open', value: 1 },
        { label: 'A bullish marubozu', value: 2 },
        { label: 'A bearish candle with a long upper wick', value: 3 },
      ],
      answer: 0,
      explain: '<strong>A doji.</strong> The body is only 0.10, which is 2.5% of the 4.00 range. The close is a hair above the open, but after trading two points either way neither side won.',
    },
  };
}

// ------------------------------------------------------------------ step 7: chart story

function contextStory(rng) {
  let best = null;
  for (let i = 0; i < 30; i++) {
    const sc = candleScenario('hammer', { seed: rng.int(1, 2 ** 31 - 2), leadIn: 24, after: 12, outcome: 'success' });
    const k = sc.candles;
    const hm = k[sc.end];
    const conf = k[sc.end + 1];
    if (!conf || !(conf.c > hm.h)) continue;
    const entry = conf.c;
    const stop = +(hm.l - (hm.h - hm.l) * 0.1).toFixed(2);
    const target = +(entry + 2 * (entry - stop)).toFixed(2);
    let result = null;
    for (let j = sc.end + 2; j < k.length; j++) {
      if (k[j].l <= stop) { result = { hit: 'stop', idx: j }; break; }
      if (k[j].h >= target) { result = { hit: 'target', idx: j }; break; }
    }
    best = { sc, entry, stop, target, result };
    if (result?.hit === 'target') break;
  }
  const { sc, entry, stop, target, result } = best;
  const k = sc.candles;
  const hm = k[sc.end];
  const leadHi = Math.max(...k.slice(0, 6).map((c) => c.h));
  const leadHiIdx = k.findIndex((c) => c.h === leadHi);
  const outcome = result?.hit === 'target'
    ? { caption: `This time price reached the 2R target ${result.idx - sc.end - 1} candles later. Many setups do not; the stop is what limits the damage when they fail.`, marker: { type: 'marker', idx: result.idx, position: 'above', shape: 'dot', text: 'Target hit', color: 'bull' } }
    : result?.hit === 'stop'
      ? { caption: 'This time price fell back through the stop: the rejection failed and the loss was the planned 1R.', marker: { type: 'marker', idx: result.idx, position: 'below', shape: 'dot', text: 'Stopped', color: 'bear' } }
      : { caption: 'Price has not reached the target or the stop yet. Waiting is part of the plan.', marker: null };
  return {
    candles: k,
    indicators: { volume: false },
    frames: [
      {
        to: sc.start,
        title: 'Context.',
        caption: 'A steady decline: most bodies are red and close near their lows. Sellers have been in control.',
        overlays: [{ type: 'segment', a: { idx: leadHiIdx, price: leadHi }, b: { idx: sc.start - 1, price: k[sc.start - 1].l }, color: 'bear', dashed: true, arrow: true, label: 'Decline' }],
        focus: [0, sc.start - 1],
      },
      {
        to: sc.end + 1,
        title: 'Trigger.',
        caption: 'A long lower wick with a small body near the high: sellers pushed down, buyers pushed it all the way back.',
        overlays: [{ type: 'box', from: sc.start, to: sc.end, color: 'accent', label: 'Long lower wick' }],
        focus: [sc.start - 8, sc.end],
      },
      {
        to: sc.end + 2,
        title: 'Confirmation.',
        caption: `The next candle closes above the wick candle’s high (${fx(hm.h)}): buyers followed through.`,
        overlays: [{ type: 'hline', price: hm.h, color: 'accent', dashed: true, label: 'Its high', from: sc.start - 3, to: sc.end + 4 }],
        focus: [sc.start - 8, sc.end + 1],
      },
      {
        to: sc.end + 2,
        title: 'Plan.',
        caption: `Entry at that close (${fx(entry)}), stop just under the wick (${fx(stop)}), target twice the risk (2R).`,
        overlays: [
          { type: 'marker', idx: sc.end + 1, position: 'above', text: 'Entry', color: 'accent' },
          { type: 'hline', price: stop, color: 'bear', label: 'Stop', fit: true },
          { type: 'hline', price: target, color: 'bull', label: 'Target 2R', fit: true },
        ],
      },
      {
        to: k.length,
        title: 'Outcome.',
        caption: outcome.caption,
        overlays: outcome.marker ? [outcome.marker] : [],
      },
    ],
  };
}

// ------------------------------------------------------------------ step 8: real example

function annotateCandle(setup, chart, ex) {
  if (!setup) return;
  const i = setup.end;
  const k = ex.candles[i];
  if (!k) return;
  const name = setup.meta?.name || 'Candle';
  chart.addBox({ from: i, to: i, color: 'accent', label: name });
  const span = k.h - k.l || 1;
  if (Math.abs(k.c - k.o) <= span * 0.08) {
    chart.addHLine({ price: (k.o + k.c) / 2, color: 'text', dashed: true, label: 'Open ≈ close', from: i - 5, to: i + 4 });
  } else {
    chart.addHLine({ price: k.o, color: 'text', dashed: true, label: 'Open', from: i - 5, to: i + 4 });
    chart.addHLine({ price: k.c, color: k.c > k.o ? 'bull' : 'bear', label: 'Close', from: i - 5, to: i + 4 });
  }
}

// ------------------------------------------------------------------ step 9: timeframes

function hourlyDay(rng) {
  const ok = (c) => {
    const d = aggregate(c, 24)[0];
    const f = features(d);
    const hiIdx = c.findIndex((k) => k.h === d.h);
    const loIdx = c.findIndex((k) => k.l === d.l);
    return f.bodyR >= 0.3 && f.upperR >= 0.12 && f.lowerR >= 0.12 && hiIdx > 1 && hiIdx < 22 && loIdx > 1 && loIdx < 22 && Math.abs(hiIdx - loIdx) >= 4;
  };
  for (let i = 0; i < 30; i++) {
    const c = randomWalk({ seed: rng.int(1, 2 ** 31 - 2), count: 24, start: 100, vol: 0.0045, volume: false });
    if (ok(c)) return c;
  }
  const { candles } = fromPath([[0, 100], [0.22, 98.6], [0.6, 101.9], [1, 101.1]], { seed: 11, count: 24, noise: 0.3, volume: false });
  return candles;
}

const TF = [['1', '1 hour'], ['4', '4 hours'], ['24', '1 day']];
const hh = (i) => `${String(i).padStart(2, '0')}:00`;

function timeframeStep() {
  return {
    title: 'Same market, different timeframe',
    render(el, step, shell) {
      const hours = hourlyDay(lessonRng(shell, 'hourly-day'));
      const groups = { 1: hours, 4: aggregate(hours, 4), 24: aggregate(hours, 24) };
      const day = groups[24][0];
      const hiIdx = hours.findIndex((k) => k.h === day.h);
      const loIdx = hours.findIndex((k) => k.l === day.l);
      let from = 1;
      let to = 1;
      let u = 1;
      let phase = 'plain';
      let W = 0;
      let token = 0;
      let alive = true;
      const box = h('div', { class: 'ca-svgbox' });
      const s = svgRoot('Twenty-four hourly candles merging into one daily candle');
      box.append(s);
      const live = h('p', { class: 'ca-live', 'aria-live': 'polite' });
      const tfPick = segmented(TF, '1', (v) => morphTo(Number(v)), 'Timeframe');
      const replay = h('button', { type: 'button', class: 'btn btn--sm btn--primary', 'data-action': 'replay-merge' }, icon('restart', { size: 16 }), h('span', null, 'Replay merge'));
      const widget = h('div', { class: 'ca-widget', 'data-keys': 'capture' }, box, h('div', { class: 'ca-controls' }, replay, tfPick), live);
      el.append(
        h('p', { html: 'The <strong>timeframe</strong> is the length of the period each candle covers. Below are 24 hourly candles from one day of a market that trades around the clock. Merge them and you get a single daily candle.' }),
        figure(widget, 'One day as 24 hourly candles, six 4-hour candles or one daily candle. Switch the timeframe or replay the merge.', { label: 'Figure 8' }),
        h('p', { html: 'The daily candle’s <strong>open</strong> is the first hour’s open, its <strong>close</strong> the last hour’s close, its <strong>high</strong> the highest hourly high and its <strong>low</strong> the lowest hourly low. Everything in between is gone: the daily candle cannot tell you the low came at ' + hh(loIdx) + '.' }),
        h('p', { html: 'The market is the same; only the zoom level changes. Reading several timeframes together is an Advanced topic, <strong>multi-timeframe analysis</strong>.' }));

      function geom(f, i) {
        const list = groups[f];
        const G = list.length;
        const g = Math.floor(i / f);
        const x0 = 10;
        const x1 = W - 58;
        const slot = (x1 - x0) / G;
        const k = list[g];
        return { x: x0 + (g + 0.5) * slot, bw: Math.max(5, Math.min(f === 24 ? 64 : 40, slot * 0.64)), o: k.o, h: k.h, l: k.l, c: k.c };
      }

      function draw() {
        if (!W) return;
        const phone = W < 480;
        const H = phone ? 240 : 270;
        sizeSvg(s, W, H);
        const top = 22;
        const bottom = H - 30;
        const pad = (day.h - day.l) * 0.1;
        const lo = day.l - pad;
        const hi = day.h + pad;
        const y = (p) => top + ((hi - p) / (hi - lo)) * (bottom - top);
        let out = '';
        const { ticks } = niceTicks(lo, hi, 5);
        for (const t of ticks) {
          if (t < lo || t > hi) continue;
          const yy = Math.round(y(t)) + 0.5;
          out += `<line class="ca-grid" x1="8" x2="${W - 52}" y1="${yy}" y2="${yy}"/><text class="ca-axis" x="${W - 6}" y="${r1(yy + 4)}" text-anchor="end">${t.toFixed(1)}</text>`;
        }
        const e = (a, b) => a + (b - a) * u;
        for (let i = 0; i < 24; i++) {
          const A = geom(from, i);
          const B = geom(to, i);
          const k = { o: e(A.o, B.o), h: e(A.h, B.h), l: e(A.l, B.l), c: e(A.c, B.c) };
          out += candleMarkup(k, e(A.x, B.x), y, e(A.bw, B.bw), dirClass(k), u < 1 && from !== to ? ' style="opacity:0.8"' : '');
        }
        const settled = u >= 1 || from === to;
        const tf = settled ? to : 0;
        // Time axis
        if (tf === 1 || !settled) {
          for (const i of [0, 6, 12, 18, 23]) out += `<text class="ca-axis" x="${r1(geom(1, i).x)}" y="${H - 10}" text-anchor="middle">${hh(i)}</text>`;
        } else if (tf === 4) {
          for (let g = 0; g < 6; g++) out += `<text class="ca-axis" x="${r1(geom(4, g * 4).x)}" y="${H - 10}" text-anchor="middle">${hh(g * 4)}</text>`;
        } else {
          out += `<text class="ca-axis" x="${r1(geom(24, 0).x)}" y="${H - 10}" text-anchor="middle">One day</text>`;
        }
        // Where the daily prices come from (hourly view), and the daily candle's labels (daily view)
        if (settled && tf === 1 && phase === 'mark') {
          const mk = (i, p, text, cls, below = false) => {
            const g = geom(1, i);
            const yy = y(p) + (below ? 16 : -8);
            return `<circle class="ca-dot" cx="${r1(g.x)}" cy="${r1(y(p))}" r="4"/><text class="ca-label ${cls}" x="${r1(Math.min(W - 70, Math.max(24, g.x)))}" y="${r1(yy)}" text-anchor="middle">${text}</text>`;
          };
          out += mk(0, hours[0].o, 'Open', 'ca-label--strong', hours[0].o < (day.h + day.l) / 2);
          out += mk(23, hours[23].c, 'Close', 'ca-label--accent', hours[23].c < (day.h + day.l) / 2);
          out += mk(hiIdx, day.h, `High ${hh(hiIdx)}`, 'ca-label--bull');
          out += mk(loIdx, day.l, `Low ${hh(loIdx)}`, 'ca-label--bear', true);
        }
        if (settled && tf === 24) {
          const g = geom(24, 0);
          const lx = g.x + g.bw / 2 + 10;
          const items = [
            { y: y(day.h), text: `High ${fx(day.h)} (${hh(hiIdx)})`, cls: 'ca-label--bull' },
            { y: y(day.l), text: `Low ${fx(day.l)} (${hh(loIdx)})`, cls: 'ca-label--bear' },
            { y: y(day.o), text: `Open ${fx(day.o)} (00:00)`, cls: 'ca-label--strong' },
            { y: y(day.c), text: `Close ${fx(day.c)} (23:00)`, cls: 'ca-label--accent' },
          ];
          for (const it of spreadLabels(items, 16, top, bottom)) out += `<text class="ca-label ${it.cls} ca-price" x="${r1(lx)}" y="${r1(it.py + 4)}">${it.text}</text>`;
        }
        s.innerHTML = out;
      }

      function caption() {
        const d = describeCandle(day, 2);
        if (to === 24) return `<strong>One daily candle:</strong> ${d.html}`;
        if (to === 4) return '<strong>Six 4-hour candles:</strong> the same day, zoomed out. Each one merges four hourly candles in exactly the same way.';
        return phase === 'mark'
          ? `<strong>24 hourly candles.</strong> The daily candle keeps just four of these prices: the first open, the highest high (${hh(hiIdx)}), the lowest low (${hh(loIdx)}) and the last close.`
          : '<strong>24 hourly candles:</strong> one day of trading, hour by hour.';
      }
      function setLive() {
        const c = caption();
        if (live.dataset.cap !== c) {
          live.dataset.cap = c;
          live.innerHTML = c;
          live.className = `ca-live ${to === 24 ? `is-${describeCandle(day).tone}` : 'is-neutral'}`;
        }
      }

      function morphTo(f, duration = 800) {
        const my = ++token;
        from = to;
        to = f;
        phase = 'plain';
        tfPick.set(String(f));
        if (from === to || reducedMotion()) {
          u = 1;
          draw();
          setLive();
          return Promise.resolve(my === token);
        }
        u = 0;
        setLive();
        return tween({ from: 0, to: 1, duration, ease: (v) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2), onUpdate: (v) => { if (my === token && alive) { u = v; draw(); } } })
          .then(() => my === token && alive);
      }

      async function replayMerge() {
        const my = ++token;
        from = 1;
        to = 1;
        u = 1;
        phase = 'plain';
        tfPick.set('1');
        draw();
        setLive();
        await sleep(700);
        if (my !== token || !alive) return;
        phase = 'mark';
        draw();
        setLive();
        await sleep(2200);
        if (my !== token || !alive) return;
        phase = 'plain';
        const done = await morphTo(24, 1500);
        if (done) sfx.whoosh();
      }
      replay.addEventListener('click', () => {
        sfx.click();
        replayMerge();
      });
      const stop = watchWidth(box, (w) => {
        W = w;
        draw();
      });
      setLive();
      const t0 = setTimeout(() => alive && replayMerge(), 350);
      return () => {
        alive = false;
        token += 1;
        clearTimeout(t0);
        stop();
      };
    },
    quiz: {
      question: 'Four hourly candles make one 4-hour candle. The first hour opened at 50.00 and the last hour closed at 51.40. The hourly highs were 51.20, 50.80, 51.60 and 51.50; the lows were 49.60, 49.30, 50.10 and 50.90. What is the 4-hour candle?',
      options: [
        { label: 'Open 50.00, high 51.60, low 49.30, close 51.40', value: 0 },
        { label: 'Open 50.00, high 51.50, low 50.90, close 51.40', value: 1 },
        { label: 'Open 50.00, high 51.20, low 49.60, close 51.40', value: 2 },
        { label: 'Open 51.40, high 51.60, low 49.30, close 50.00', value: 3 },
      ],
      answer: 0,
      explain: '<strong>First open, highest high, lowest low, last close:</strong> 50.00, 51.60, 49.30, 51.40. The other answers use one hour’s high and low, or swap the open and the close.',
    },
  };
}

// ------------------------------------------------------------------ step 10: takeaways

function takeawayStep() {
  return {
    title: 'Key takeaways',
    render(el) {
      el.append(
        takeaway([
          'A candle summarises one period with four prices: <strong>open, high, low, close</strong>.',
          'The body runs from open to close. <strong>Bullish</strong> means the close finished above the open, <strong>bearish</strong> below it. Colour is only a convention.',
          '<strong>Wicks</strong> are prices that traded but were rejected by the close. Long wicks show where one side pushed and the other pushed back.',
          'A big body relative to the range (and to nearby candles) shows <strong>conviction</strong>; a small body shows indecision.',
          'A candle does not record the order of its high and low, and a single candle is never a signal on its own: read it in <strong>context</strong> and wait for confirmation.',
          'The same market can be drawn at any <strong>timeframe</strong>: many small candles or one big one.',
        ], { title: 'Key takeaways' }),
        h('div', { class: 'ca-cta' },
          h('p', { html: '<strong>Practise it:</strong> in Candle Builder you drag open, high, low and close to build the candle a story describes, then read candles back into stories.' }),
          h('a', { class: 'btn btn--primary', href: '#g.candle-builder' }, icon('play', { size: 16 }), 'Play Candle Builder')));
    },
    quiz: {
      question: 'Which statement about a bearish candle is always true?',
      options: [
        { label: 'Its open is the top of its body', value: 0 },
        { label: 'Its close is its lowest price', value: 1 },
        { label: 'It is drawn in red', value: 2 },
        { label: 'The next candle will also be bearish', value: 3 },
      ],
      answer: 0,
      explain: '<strong>The open is the top of a bearish body.</strong> The close is the low only when there is no lower wick, colours depend on the platform, and one candle never guarantees the next.',
    },
  };
}

// ------------------------------------------------------------------ lesson

export default {
  id: 'candle-anatomy',
  mount(root, ctx) {
    root.classList.add('candle-anatomy');
    const style = h('style', { 'data-owner': 'candle-anatomy' }, CSS);
    document.head.append(style);
    const shell = new LessonShell(root, ctx, {
      intro: 'Read any candle at a glance: where it opened, where it closed, and how far buyers and sellers pushed it in between.',
      steps: [
        periodStep(),
        partsStep(),
        stylesStep(),
        builderStep(),
        wicksStep(),
        bodyStep(),
        storyStep({
          title: 'Candles in context, step by step',
          text: 'One candle means little on its own. Here is how a trader reads a few candles in a row: context first, then the candle that matters, then confirmation, a plan and the outcome. Step through it with the controls.',
          story: contextStory,
          height: 320,
          after: 'That long-lower-wick candle after a decline has a name, the <strong>hammer</strong>. The next lesson, Candlestick patterns, covers it and its relatives, including when they fail.',
        }),
        realExampleStep({
          title: 'Real candles, same anatomy',
          kinds: ['bullish-marubozu', 'bearish-marubozu', 'doji', 'spinning-top'],
          intervals: ['1d', '1w'],
          before: 40,
          after: 10,
          height: 300,
          text: [
            'Real charts are messier than drawings, but every candle still has the same four prices. The highlighted candle below was picked from real market data by the site’s scanner: a marubozu, a doji or a spinning top.',
            'Find its open and close (the two lines across it), then its high and low at the tips of its wicks. Tap or hover the candle to read its exact prices in the chart legend, and press <strong>Show another</strong> for a different market.',
          ],
          caption: 'Real candles rarely match the textbook shape perfectly. Read the rules (body size, wick length), not the picture.',
          annotate: annotateCandle,
        }),
        timeframeStep(),
        takeawayStep(),
      ],
    });
    return () => {
      shell.destroy();
      style.remove();
      root.classList.remove('candle-anatomy');
    };
  },
};
