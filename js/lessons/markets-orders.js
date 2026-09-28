// Lesson: Markets, orders and the spread (Beginner, unit 1) — "How a trade actually happens".
// An animated order book, the four big market types, every order type as a mini chart story, a whole
// breakout trade placed order by order, stops vs stop-limits in a gap, long vs short, leverage and
// margin, trading costs, a real breakout's stop fill and paper trading. Order fills in the stories
// come from the Order Desk engine (../games/order-desk-engine.js), so every "filled at" is computed.
import { LessonShell, storyStep, realExampleStep, compareStep, figure, takeaway, lessonRng } from '../core/lesson-kit.js';
import { h, icon, sfx, kbdHint } from '../core/ui.js';
import { CandleChart, miniChart } from '../core/chart.js';
import { ChartStory } from '../core/story.js';
import { chartScenario } from '../core/patterns.js';
import { tween, reducedMotion } from '../core/anim.js';
import { walkPath, quotes, ticksToCandles, simulate, makeBook, fmtSize } from '../games/order-desk-engine.js';

// ------------------------------------------------------------------ styles (scoped, tokens only)

const CSS = `
.markets-orders .mo-widget { display: grid; gap: 16px; padding: 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); max-width: 860px; }
.markets-orders .mo-widget--split { grid-template-columns: minmax(0, 1fr); }
@media (min-width: 720px) { .markets-orders .mo-widget--split { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); align-items: start; } }
.markets-orders .mo-controls { display: grid; gap: 12px; align-content: start; min-width: 0; }
.markets-orders .mo-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.markets-orders .mo-label { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-3); }
.markets-orders .mo-out { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 600; color: var(--text); }
.markets-orders .mo-seg { display: inline-grid; grid-auto-flow: column; gap: 3px; padding: 3px; border-radius: 9px; background: var(--surface-2); }
.markets-orders .mo-seg button { min-height: 40px; padding: 0 14px; border-radius: 7px; font-weight: 700; color: var(--text-2); }
.markets-orders .mo-seg button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: 0 0 0 1.5px var(--accent); }
.markets-orders .mo-seg button.is-buy[aria-pressed="true"] { background: var(--bull); color: var(--bull-ink); box-shadow: none; }
.markets-orders .mo-seg button.is-sell[aria-pressed="true"] { background: var(--bear); color: var(--bear-ink); box-shadow: none; }
.markets-orders .mo-slider { display: grid; gap: 4px; }
.markets-orders .mo-slider input { min-height: 40px; }
.markets-orders .mo-readout { display: grid; gap: 6px; padding: 12px; border-radius: 8px; background: var(--surface-2); font-size: 14.5px; line-height: 1.5; min-height: 64px; }
.markets-orders .mo-readout strong { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.markets-orders .mo-fills { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.markets-orders .mo-fills li { padding: 3px 8px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); font: 600 12.5px var(--font-mono); font-variant-numeric: tabular-nums; animation: mo-pop 0.3s var(--ease-back); }
@keyframes mo-pop { from { transform: scale(0.6); opacity: 0; } }
.markets-orders .mo-book { width: 100%; display: block; }
.markets-orders .mo-book .row-alt { fill: var(--surface-2); opacity: 0.5; }
.markets-orders .mo-book .bar-bid { fill: var(--bull); opacity: 0.22; }
.markets-orders .mo-book .bar-ask { fill: var(--bear); opacity: 0.22; }
.markets-orders .mo-book .eaten { fill: var(--accent); opacity: 0.28; }
.markets-orders .mo-book text { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 12.5px; fill: var(--text-2); }
.markets-orders .mo-book .px { fill: var(--text-3); }
.markets-orders .mo-book .px-bid { fill: var(--bull-strong); font-weight: 700; }
.markets-orders .mo-book .px-ask { fill: var(--bear-strong); font-weight: 700; }
.markets-orders .mo-book .head { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; fill: var(--text-3); }
.markets-orders .mo-book .spread { fill: var(--accent-soft); }
.markets-orders .mo-book .spread-text { font-family: var(--font-body); font-size: 11px; font-weight: 700; fill: var(--accent-strong); }
.markets-orders .mo-book .gone { fill: var(--text-3); opacity: 0.6; text-decoration: line-through; }
.markets-orders .mo-week { display: block; width: 100%; }
.markets-orders .mo-week .lbl { font: 600 12.5px var(--font-body); fill: var(--text); }
.markets-orders .mo-week .day { font: 600 11px var(--font-body); fill: var(--text-3); }
.markets-orders .mo-week .track { fill: var(--surface-2); }
.markets-orders .mo-week .open { fill: var(--bull); opacity: 0.75; }
.markets-orders .mo-week .ext { fill: var(--bull); opacity: 0.3; }
.markets-orders .mo-week .grid { stroke: var(--line); stroke-width: 1; }
.markets-orders .mo-week .cursor { stroke: var(--accent); stroke-width: 2.5; }
.markets-orders .mo-week .cursor-knob { fill: var(--accent); }
.markets-orders .mo-status { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 6px 14px; margin: 0; padding: 0; list-style: none; font-size: 14px; }
.markets-orders .mo-status li { display: flex; gap: 8px; align-items: center; }
.markets-orders .mo-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--muted); flex: 0 0 auto; }
.markets-orders .mo-dot.is-open { background: var(--bull); }
.markets-orders .mo-dot.is-ext { background: var(--bull); opacity: 0.45; }
.markets-orders .mo-cards { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); max-width: 860px; }
@media (min-width: 640px) { .markets-orders .mo-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.markets-orders .mo-card { display: grid; gap: 8px; align-content: start; padding: 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.markets-orders .mo-card h3 { margin: 0; font-size: 16px; }
.markets-orders .mo-card p { margin: 0; font-size: 14.5px; line-height: 1.55; color: var(--text-2); }
.markets-orders .mo-card svg { width: 100%; height: auto; display: block; }
.markets-orders .mo-card .chip { justify-self: start; }
.markets-orders .mo-tabs { max-width: 860px; }
.markets-orders .mo-tabpanel { display: grid; gap: 12px; padding-top: 14px; max-width: 860px; }
.markets-orders .mo-rules { display: grid; gap: 8px; margin: 0; padding: 12px 14px; border-radius: var(--radius); background: var(--surface-2); font-size: 14.5px; line-height: 1.5; }
.markets-orders .mo-rules div { display: grid; grid-template-columns: 6.5em minmax(0, 1fr); gap: 10px; }
.markets-orders .mo-rules dt { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-3); padding-top: 2px; }
.markets-orders .mo-rules dd { margin: 0; color: var(--text); }
.markets-orders .mo-pnl-path { display: block; width: 100%; }
.markets-orders .mo-pnl-path .line { fill: none; stroke: var(--text-3); stroke-width: 2; }
.markets-orders .mo-pnl-path .done { fill: none; stroke: var(--accent); stroke-width: 2.5; }
.markets-orders .mo-pnl-path .base { stroke: var(--line); stroke-dasharray: 4 4; }
.markets-orders .mo-pnl-path .dot { fill: var(--accent); stroke: var(--surface); stroke-width: 2; }
.markets-orders .mo-pnl-path text { font: 600 11.5px var(--font-mono); fill: var(--text-3); }
.markets-orders .mo-bars { display: grid; gap: 10px; }
.markets-orders .mo-bar { display: grid; grid-template-columns: 7.2em minmax(0, 1fr) 6.2em; gap: 10px; align-items: center; font-size: 14px; }
.markets-orders .mo-bar .val { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 700; text-align: right; }
.markets-orders .mo-bar .val.up { color: var(--bull-strong); }
.markets-orders .mo-bar .val.down { color: var(--bear-strong); }
.markets-orders .mo-track { position: relative; height: 22px; border-radius: 6px; background: var(--surface-2); overflow: hidden; }
.markets-orders .mo-track::after { content: ""; position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--text-3); }
.markets-orders .mo-fill { position: absolute; top: 3px; bottom: 3px; border-radius: 4px; background: var(--bull); }
.markets-orders .mo-fill.is-neg { background: var(--bear); }
.markets-orders .mo-equity { position: relative; height: 26px; border-radius: 6px; background: var(--surface-2); overflow: hidden; }
.markets-orders .mo-equity .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--bull); opacity: 0.8; }
.markets-orders .mo-equity .fill.is-low { background: var(--warn); }
.markets-orders .mo-equity .fill.is-out { background: var(--bear); }
.markets-orders .mo-equity .mark { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--bear); }
.markets-orders .mo-equity .start { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--text-3); }
.markets-orders .mo-scale { display: flex; justify-content: space-between; font: 500 11.5px var(--font-mono); color: var(--text-3); }
.markets-orders .mo-stamp { justify-self: start; padding: 4px 10px; border: 2px solid var(--bear); border-radius: 6px; color: var(--bear-strong); font: 800 13px var(--font-display); letter-spacing: 0.06em; text-transform: uppercase; transform: rotate(-3deg); animation: mo-pop 0.35s var(--ease-back); }
.markets-orders .mo-kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
.markets-orders .mo-kv .stat__value { font-size: 19px; }
.markets-orders .mo-kv .up { color: var(--bull-strong); }
.markets-orders .mo-kv .down { color: var(--bear-strong); }
.markets-orders .mo-costbar { position: relative; height: 30px; border-radius: 6px; background: color-mix(in oklab, var(--bull) 22%, var(--surface-2)); overflow: hidden; display: flex; }
.markets-orders .mo-costbar span { height: 100%; transition: width 0.25s var(--ease-out); }
.markets-orders .mo-costbar .c-spread { background: var(--bear); }
.markets-orders .mo-costbar .c-comm { background: var(--warn); }
.markets-orders .mo-costbar .c-slip { background: var(--ma3); }
.markets-orders .mo-costbar .c-fund { background: var(--info); }
.markets-orders .mo-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; color: var(--text-2); }
.markets-orders .mo-legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
.markets-orders .mo-curve { display: block; width: 100%; }
.markets-orders .mo-curve .axis { stroke: var(--line); }
.markets-orders .mo-curve .curve { fill: none; stroke: var(--bear); stroke-width: 2.5; }
.markets-orders .mo-curve .dot { fill: var(--accent); stroke: var(--surface); stroke-width: 2; }
.markets-orders .mo-curve text { font: 500 11px var(--font-mono); fill: var(--text-3); }
.markets-orders .mo-curve .half { stroke: var(--warn); stroke-dasharray: 4 4; }
.markets-orders .mo-toggle[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }
.markets-orders .mo-ticket { display: grid; gap: 0; max-width: 420px; margin-inline: auto; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); overflow: hidden; box-shadow: var(--shadow); }
.markets-orders .mo-ticket header { padding: 10px 14px; background: var(--surface-2); font-weight: 700; display: flex; justify-content: space-between; align-items: center; }
.markets-orders .mo-ticket .r { display: grid; grid-template-columns: 26px 1fr auto; gap: 10px; align-items: center; padding: 9px 14px; border-top: 1px solid var(--line); font-size: 14.5px; }
.markets-orders .mo-ticket .n { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: var(--accent-ink); font: 700 12px var(--font-mono); }
.markets-orders .mo-ticket .v { font-family: var(--font-mono); font-weight: 700; }
.markets-orders .mo-ticket .v.buy { color: var(--bull-strong); }
.markets-orders .mo-ticket footer { padding: 10px 14px; border-top: 1px solid var(--line); font-size: 13px; color: var(--text-3); }
.markets-orders .mo-notes { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; font-size: 14.5px; line-height: 1.5; }
.markets-orders .mo-notes li { display: grid; grid-template-columns: 26px 1fr; gap: 8px; }
.markets-orders .mo-notes .n { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: var(--accent-ink); font: 700 12px var(--font-mono); }
.markets-orders .mo-cta { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); max-width: 860px; }
.markets-orders .mo-cta p { margin: 0; flex: 1 1 260px; color: var(--text-2); }
@media (prefers-reduced-motion: reduce) {
  .markets-orders .mo-fills li, .markets-orders .mo-stamp { animation: none; }
  .markets-orders .mo-costbar span { transition: none; }
}
`;

// ------------------------------------------------------------------ helpers

const TICK = 0.05;
const px2 = (ticks) => (ticks * TICK).toFixed(2);
const pr = (ticks) => Number((ticks * TICK).toFixed(2));
const money = (n, dp = 0) => `${n < 0 ? '−' : n > 0 ? '+' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const plainMoney = (n, dp = 0) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

/** Calls draw(width) now and whenever the host's width changes. → cleanup */
function responsive(host, draw) {
  let w = 0;
  const run = () => {
    const nw = Math.round(host.clientWidth || 0);
    if (nw > 0 && nw !== w) {
      w = nw;
      draw(w);
    }
  };
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(run);
    ro.observe(host);
  }
  requestAnimationFrame(run);
  return () => ro?.disconnect();
}

/** A replay-able button label swap: Play → Replay. */
function playLabel(btn, text, iconName = 'play') {
  btn.replaceChildren(icon(iconName, { size: 16 }), h('span', null, text));
}

/**
 * A tick tape for the order-type stories: a history walk that ends at `base`, then a future walk
 * through `fut` waypoints. Prices in ticks of 0.05 around 50.00. → { candles, K, last, bid, ask,
 * book, idx(t), sim(order) } where K = history candles and future tick t sits in candle idx(t).
 * Generate-and-test: `valid(tape)` must hold (up to 30 forks, then a noiseless path).
 */
function makeTape(seed, { base = 1000, per = 4, K = 16, from = -5, hist = [], fut = [], T = 56, spread = 1, noise = 0.55, valid = () => true }) {
  const build = (r, nz) => {
    const Hn = K * per;
    const hp = [...hist.map((p) => ({ t: Math.round(p[0] * Hn), v: base + p[1] })), { t: Hn, v: base }];
    const hl = walkPath(r, { from: base + from, T: Hn, points: hp, noise: nz, lo: base - 40, hi: base + 40 });
    const fp = fut.map((p) => ({ t: p[0], v: base + p[1], jump: !!p[2], noise: p[3] }));
    if (fp[fp.length - 1].t !== T) fp.push({ t: T, v: fp[fp.length - 1].v });
    const fl = walkPath(r, { from: base, T, points: fp, noise: nz, lo: base - 40, hi: base + 40 });
    if (!hl || !fl) return null;
    const all = [...hl, ...fl.slice(1)];
    const candles = ticksToCandles(all, { per, start: 1, tick: TICK });
    const q = quotes(fl, spread);
    const book = makeBook({ bid: q.bid[0], ask: q.ask[0], salt: seed });
    const tape = {
      candles, K, per, base, last: fl, bid: q.bid, ask: q.ask, book,
      idx: (t) => K + Math.max(0, Math.floor((t - 1) / per)),
      sim: (order) => simulate({ size: 100, ...order }, { last: fl, bid: q.bid, ask: q.ask, book }),
    };
    return valid(tape) ? tape : null;
  };
  const rng = lessonRng('markets-orders', `tape:${seed}`);
  for (let i = 0; i < 30; i++) {
    const t = build(rng.fork(`try-${i}`), noise);
    if (t) return t;
  }
  return build(rng.fork('flat'), 0) || build(rng.fork('flat2'), 0);
}

const firstFill = (res) => (res.fills.length ? res.fills[0] : null);
const minBetween = (arr, a, b) => Math.min(...arr.slice(a, b + 1));
const maxBetween = (arr, a, b) => Math.max(...arr.slice(a, b + 1));

// ------------------------------------------------------------------ step 1: the order book

const BOOK_ASKS = [300, 500, 800, 600, 1200];
const BOOK_BIDS = [400, 700, 600, 1100, 900];
const BEST_BID = 999; // 49.95
const BEST_ASK = 1000; // 50.00

function orderBookStep(el) {
  let side = 'buy';
  let size = 1200;
  let asks = BOOK_ASKS.map((s, i) => ({ p: BEST_ASK + i, size: s, start: s }));
  let bids = BOOK_BIDS.map((s, i) => ({ p: BEST_BID - i, size: s, start: s }));
  let running = null;
  let alive = true;
  let hot = null;

  const host = h('div', { class: 'mo-bookhost' });
  const sideBtns = ['buy', 'sell'].map((s) => h('button', { type: 'button', class: `is-${s}`, 'aria-pressed': String(s === side), on: { click: () => setSide(s) } }, s === 'buy' ? 'Market buy' : 'Market sell'));
  const sizeOut = h('output', { class: 'mo-out' });
  const slider = h('input', { type: 'range', min: 100, max: 3000, step: 100, value: size, 'aria-label': 'Order size in shares' });
  const sendBtn = h('button', { type: 'button', class: 'btn btn--primary', 'data-action': 'send-market' });
  const resetBtn = h('button', { type: 'button', class: 'btn btn--ghost', on: { click: () => reset(true) } }, icon('restart', { size: 16 }), 'Reset book');
  const fillsEl = h('ul', { class: 'mo-fills', 'aria-label': 'Fills' });
  const readout = h('div', { class: 'mo-readout', 'aria-live': 'polite' });
  playLabel(sendBtn, 'Send the order');

  const W = 360;
  const rowH = 28;
  const head = 26;
  const gapH = 26;
  const H = head + rowH * 10 + gapH + 4;
  const cw = 118;
  const pw = W - 2 * cw;

  function drawBook() {
    const yAsk = (i) => head + (4 - i) * rowH; // best ask at the bottom of the ask block
    const yBid = (i) => head + 5 * rowH + gapH + i * rowH;
    const maxS = 1300;
    let s = `<text class="head" x="${cw - 6}" y="16" text-anchor="end">Bids · buyers</text><text class="head" x="${W / 2}" y="16" text-anchor="middle">Price</text><text class="head" x="${cw + pw + 6}" y="16">Asks · sellers</text>`;
    asks.forEach((lv, i) => {
      const y = yAsk(i);
      if (i % 2) s += `<rect class="row-alt" x="0" y="${y}" width="${W}" height="${rowH}"/>`;
      if (hot && hot.p === lv.p && hot.side === 'ask') s += `<rect class="eaten" x="0" y="${y}" width="${W}" height="${rowH}"/>`;
      const bw = (lv.size / maxS) * (cw - 8);
      if (lv.size > 0) s += `<rect class="bar-ask" x="${cw + pw}" y="${y + 3}" width="${bw.toFixed(1)}" height="${rowH - 6}" rx="3"/>`;
      s += `<text x="${cw + pw + 6}" y="${y + 18.5}" class="${lv.size ? '' : 'gone'}">${lv.size ? fmtSize(lv.size) : fmtSize(lv.start)}</text>`;
      const best = lv.size > 0 && asks.slice(0, i).every((a) => a.size === 0);
      s += `<text class="${best ? 'px-ask' : 'px'}" x="${W / 2}" y="${y + 18.5}" text-anchor="middle">${px2(lv.p)}</text>`;
    });
    bids.forEach((lv, i) => {
      const y = yBid(i);
      if (i % 2) s += `<rect class="row-alt" x="0" y="${y}" width="${W}" height="${rowH}"/>`;
      if (hot && hot.p === lv.p && hot.side === 'bid') s += `<rect class="eaten" x="0" y="${y}" width="${W}" height="${rowH}"/>`;
      const bw = (lv.size / maxS) * (cw - 8);
      if (lv.size > 0) s += `<rect class="bar-bid" x="${(cw - bw).toFixed(1)}" y="${y + 3}" width="${bw.toFixed(1)}" height="${rowH - 6}" rx="3"/>`;
      s += `<text x="${cw - 6}" y="${y + 18.5}" text-anchor="end" class="${lv.size ? '' : 'gone'}">${lv.size ? fmtSize(lv.size) : fmtSize(lv.start)}</text>`;
      const best = lv.size > 0 && bids.slice(0, i).every((a) => a.size === 0);
      s += `<text class="${best ? 'px-bid' : 'px'}" x="${W / 2}" y="${y + 18.5}" text-anchor="middle">${px2(lv.p)}</text>`;
    });
    const bestAsk = asks.find((a) => a.size > 0);
    const bestBid = bids.find((b) => b.size > 0);
    const spread = bestAsk && bestBid ? (bestAsk.p - bestBid.p) * TICK : null;
    const gy = head + 5 * rowH;
    s += `<rect class="spread" x="0" y="${gy + 2}" width="${W}" height="${gapH - 4}" rx="4"/>`;
    s += `<text class="spread-text" x="${W / 2}" y="${gy + 17}" text-anchor="middle">${spread != null ? `Spread ${spread.toFixed(2)}` : 'Spread'}</text>`;
    host.innerHTML = `<svg class="mo-book" viewBox="0 0 ${W} ${H}" role="img" aria-label="Order book: bids ${bids.map((b) => `${fmtSize(b.size)} at ${px2(b.p)}`).join(', ')}; asks ${asks.map((a) => `${fmtSize(a.size)} at ${px2(a.p)}`).join(', ')}">${s}</svg>`;
  }

  function setSide(s) {
    if (running) return;
    side = s;
    sideBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['buy', 'sell'][i] === s)));
    reset(false);
    sfx.click();
  }

  function reset(sound) {
    running?.cancel?.();
    running = null;
    hot = null;
    asks = BOOK_ASKS.map((s, i) => ({ p: BEST_ASK + i, size: s, start: s }));
    bids = BOOK_BIDS.map((s, i) => ({ p: BEST_BID - i, size: s, start: s }));
    fillsEl.replaceChildren();
    readout.replaceChildren(h('span', null, side === 'buy'
      ? 'A market buy takes the lowest asks first: 50.00, then 50.05, and so on until the order is filled.'
      : 'A market sell hits the highest bids first: 49.95, then 49.90, and so on until the order is filled.'));
    playLabel(sendBtn, 'Send the order');
    sendBtn.disabled = false;
    slider.disabled = false;
    drawBook();
    if (sound) sfx.click();
  }

  async function send() {
    if (running) return;
    const levels = side === 'buy' ? asks : bids;
    if (!levels.some((l) => l.size < l.start)) {
      /* fresh book */
    } else reset(false);
    slider.disabled = true;
    sendBtn.disabled = true;
    fillsEl.replaceChildren();
    const book = side === 'buy' ? asks : bids;
    const best = book[0].p;
    let left = size;
    const fills = [];
    let token = { cancelled: false, cancel() { this.cancelled = true; } };
    running = token;
    for (const lv of book) {
      if (left <= 0 || token.cancelled || !alive) break;
      const take = Math.min(left, lv.size);
      const from = lv.size;
      hot = { p: lv.p, side: side === 'buy' ? 'ask' : 'bid' };
      sfx.tick();
      await tween({ from, to: from - take, duration: 420, onUpdate: (v) => { lv.size = Math.round(v / 10) * 10; drawBook(); } });
      if (token.cancelled || !alive) return;
      lv.size = from - take;
      left -= take;
      fills.push({ p: lv.p, size: take });
      fillsEl.append(h('li', null, `${fmtSize(take)} @ ${px2(lv.p)}`));
      drawBook();
    }
    if (token.cancelled || !alive) return;
    hot = null;
    drawBook();
    const filled = fills.reduce((s, f) => s + f.size, 0);
    const avgTicks = fills.reduce((s, f) => s + f.p * f.size, 0) / filled;
    const avg = avgTicks * TICK;
    const slipPer = Math.abs(avgTicks - best) * TICK;
    const bestAfter = (side === 'buy' ? asks : bids).find((l) => l.size > 0);
    readout.replaceChildren(
      h('span', null, 'Average fill ', h('strong', null, avg.toFixed(3)), ` on ${fmtSize(filled)} shares. The best ${side === 'buy' ? 'ask' : 'bid'} was `, h('strong', null, px2(best)), '.'),
      slipPer > 0
        ? h('span', null, 'Slippage: ', h('strong', null, slipPer.toFixed(3)), ' per share, ', h('strong', null, plainMoney(slipPer * filled, 2)), ` in total. The order ate ${fills.length} price levels.`)
        : h('span', null, 'No slippage: the whole order fitted at the best price.'),
      bestAfter ? h('span', null, `The best ${side === 'buy' ? 'ask' : 'bid'} is now `, h('strong', null, px2(bestAfter.p)), fills.length > 1 ? ': your order moved the price.' : '.') : null);
    sfx.correct();
    playLabel(sendBtn, 'Replay', 'restart');
    sendBtn.disabled = false;
    running = null;
    sendBtn.onclick = null;
  }

  sendBtn.addEventListener('click', () => {
    if (sendBtn.textContent.includes('Replay')) reset(false);
    send();
  });
  const onSize = () => {
    size = Number(slider.value);
    sizeOut.textContent = `${fmtSize(size)} shares`;
    if (!running && fillsEl.children.length) reset(false);
  };
  slider.addEventListener('input', onSize);
  onSize();

  el.append(
    h('p', { html: 'Every market is an auction. <strong>Buyers</strong> post <strong>bids</strong>: the most they will pay. <strong>Sellers</strong> post <strong>asks</strong> (also called offers): the least they will accept. All the waiting bids and asks together are the <strong>order book</strong>.' }),
    h('p', { html: 'The highest bid and the lowest ask are the best prices right now, and the gap between them is the <strong>spread</strong>. Buy at the market and you pay the ask; sell at the market and you get the bid. Buy and sell again straight away and you lose the spread.' }),
    figure(h('div', { class: 'mo-widget mo-widget--split', 'data-keys': 'capture' },
      host,
      h('div', { class: 'mo-controls' },
        h('span', { class: 'mo-label' }, 'Your order'),
        h('div', { class: 'mo-seg', role: 'group', 'aria-label': 'Side' }, sideBtns),
        h('label', { class: 'mo-slider' }, h('span', { class: 'mo-row' }, h('span', { class: 'mo-label' }, 'Size'), sizeOut), slider),
        h('div', { class: 'mo-row' }, sendBtn, resetBtn),
        fillsEl,
        readout)),
    'An order book (price ladder). Bids wait below, asks above; the spread is the gap between the best bid and the best ask. Send a big market order and watch it take one price level after another.',
    { label: 'Figure 1' }),
    h('p', { html: 'A trade only happens when a buyer and a seller agree on a price. A <strong>market order</strong> agrees to the best waiting price at once. When it is bigger than what waits at that price, it keeps going to the next level, and the average price gets worse. That extra cost is <strong>slippage</strong>. Try 300 shares, then 2,500.' }),
  );
  reset(false);
  return () => {
    alive = false;
    running?.cancel?.();
  };
}

// ------------------------------------------------------------------ step 2: markets and their clocks

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Sessions in hours from Monday 00:00, New York time (typical examples; exact hours vary).
const MARKETS = [
  {
    id: 'stocks', label: 'Stocks & ETFs',
    open: [0, 1, 2, 3, 4].map((d) => [d * 24 + 9.5, d * 24 + 16]),
    ext: [0, 1, 2, 3, 4].flatMap((d) => [[d * 24 + 4, d * 24 + 9.5], [d * 24 + 16, d * 24 + 20]]),
  },
  { id: 'fx', label: 'Forex', open: [[0, 4 * 24 + 17], [6 * 24 + 17, 168]], ext: [] },
  { id: 'crypto', label: 'Crypto', open: [[0, 168]], ext: [] },
  {
    id: 'futures', label: 'Futures',
    open: [[0, 17], [18, 24 + 17], [24 + 18, 48 + 17], [48 + 18, 72 + 17], [72 + 18, 96 + 17], [6 * 24 + 18, 168]],
    ext: [],
  },
];
const inAny = (list, t) => list.some(([a, b]) => t >= a && t < b);
const stateAt = (m, t) => (inAny(m.open, t) ? 'open' : inAny(m.ext, t) ? 'ext' : 'closed');
const hourText = (t) => `${DAYS[Math.floor(t / 24) % 7]} ${String(Math.floor(t % 24)).padStart(2, '0')}:${t % 1 ? '30' : '00'}`;

/** Candles with a gap at every session start (stock-like). */
function sessionCandles(seed) {
  const r = lessonRng('markets-orders', `sessions:${seed}`);
  const per = 4;
  const sessions = 5;
  const perSession = 8;
  const T = sessions * perSession * per;
  const pts = [];
  let lvl = 1000;
  for (let s = 0; s < sessions; s++) {
    const t0 = 1 + s * perSession * per;
    if (s > 0) {
      lvl += r.pick([-1, 1]) * r.int(5, 9);
      pts.push({ t: t0, v: lvl, jump: true });
    }
    lvl += r.int(-4, 4);
    pts.push({ t: t0 + perSession * per - 1, v: lvl });
  }
  const last = walkPath(r, { from: 1000, T, points: pts, noise: 0.6 }) || walkPath(r, { from: 1000, T, points: pts, noise: 0 });
  const candles = ticksToCandles(last, { per, tick: TICK });
  const gaps = [];
  for (let s = 1; s < sessions; s++) gaps.push(s * perSession);
  return { candles, gaps };
}

function continuousCandles(seed, { count = 42, per = 4, tick = TICK, base = 1000, drift = 0 } = {}) {
  const r = lessonRng('markets-orders', `cont:${seed}`);
  const T = count * per;
  const pts = [];
  for (let k = 1; k <= 5; k++) pts.push({ t: Math.round((T * k) / 5), v: base + Math.round(drift * k) + r.int(-8, 8) });
  const last = walkPath(r, { from: base, T, points: pts, noise: 0.8 }) || walkPath(r, { from: base, T, points: pts, noise: 0 });
  return ticksToCandles(last, { per, tick, decimals: tick < 0.01 ? 5 : 2 });
}

function futuresRoll(seed) {
  const r = lessonRng('markets-orders', `roll:${seed}`);
  const per = 4;
  const n1 = 26;
  const n2 = 16;
  const T = (n1 + n2) * per;
  const roll = 1 + n1 * per;
  const pts = [
    { t: 30, v: 1000 + r.int(-5, 5) },
    { t: roll - 1, v: 1000 + r.int(-4, 4) },
  ];
  pts.push({ t: roll, v: pts[1].v + 12, jump: true });
  pts.push({ t: T, v: pts[1].v + 12 + r.int(-5, 5) });
  const last = walkPath(r, { from: 1000, T, points: pts, noise: 0.6 }) || walkPath(r, { from: 1000, T, points: pts, noise: 0 });
  return { candles: ticksToCandles(last, { per, tick: TICK }), roll: n1 };
}

function marketsStep(el) {
  let hour = 2 * 24 + 11; // Wed 11:00
  const weekHost = h('div', { class: 'mo-weekhost' });
  const slider = h('input', { type: 'range', min: 0, max: 167.5, step: 0.5, value: hour, 'aria-label': 'Time of the week, New York time' });
  const timeOut = h('output', { class: 'mo-out' });
  const statusList = h('ul', { class: 'mo-status', 'aria-live': 'polite' });
  let W = 640;
  const presets = [['Tue 03:00', 24 + 3], ['Wed 11:00', 2 * 24 + 11], ['Fri 18:00', 4 * 24 + 18], ['Sat 12:00', 5 * 24 + 12], ['Sun 19:00', 6 * 24 + 19]];

  function drawWeek(w) {
    W = w;
    const narrow = W < 520;
    const lx = narrow ? 0 : 118;
    const x0 = lx + (narrow ? 2 : 8);
    const x1 = W - 4;
    const rowGap = narrow ? 44 : 34;
    const top = 22;
    const barH = narrow ? 14 : 18;
    const H = top + MARKETS.length * rowGap + 6;
    const xOf = (t) => x0 + ((x1 - x0) * t) / 168;
    let s = '';
    DAYS.forEach((d, i) => {
      const x = xOf(i * 24);
      s += `<line class="grid" x1="${x.toFixed(1)}" y1="${top - 6}" x2="${x.toFixed(1)}" y2="${H - 4}"/>`;
      s += `<text class="day" x="${(x + (xOf(24) - xOf(0)) / 2).toFixed(1)}" y="14" text-anchor="middle">${d}</text>`;
    });
    MARKETS.forEach((m, i) => {
      const yb = top + i * rowGap + (narrow ? 16 : (rowGap - barH) / 2);
      if (narrow) s += `<text class="lbl" x="${x0}" y="${yb - 4}">${m.label}</text>`;
      else s += `<text class="lbl" x="0" y="${(yb + barH / 2 + 4.5).toFixed(1)}">${m.label}</text>`;
      s += `<rect class="track" x="${x0}" y="${yb}" width="${(x1 - x0).toFixed(1)}" height="${barH}" rx="4"/>`;
      for (const [a, b] of m.ext) s += `<rect class="ext" x="${xOf(a).toFixed(1)}" y="${yb}" width="${(xOf(b) - xOf(a)).toFixed(1)}" height="${barH}"/>`;
      for (const [a, b] of m.open) s += `<rect class="open" x="${xOf(a).toFixed(1)}" y="${yb}" width="${Math.max(1, xOf(b) - xOf(a)).toFixed(1)}" height="${barH}"/>`;
    });
    const cx = xOf(hour);
    s += `<line class="cursor" x1="${cx.toFixed(1)}" y1="${top - 4}" x2="${cx.toFixed(1)}" y2="${H - 2}"/><circle class="cursor-knob" cx="${cx.toFixed(1)}" cy="${top - 4}" r="4.5"/>`;
    weekHost.innerHTML = `<svg class="mo-week" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trading hours in a typical week, New York time: stocks and ETFs on weekdays with extended hours, forex from Sunday evening to Friday evening, crypto all week, futures from Sunday evening to Friday evening with a daily one-hour break.">${s}</svg>`;
  }

  function update() {
    timeOut.textContent = `${hourText(hour)} New York time`;
    statusList.replaceChildren(...MARKETS.map((m) => {
      const st = stateAt(m, hour);
      return h('li', null, h('span', { class: `mo-dot${st === 'open' ? ' is-open' : st === 'ext' ? ' is-ext' : ''}`, 'aria-hidden': 'true' }),
        h('span', null, h('strong', null, m.label), ` · ${st === 'open' ? 'open' : st === 'ext' ? 'extended hours (thin)' : 'closed'}`));
    }));
    drawWeek(W);
  }
  slider.addEventListener('input', () => {
    hour = Number(slider.value);
    update();
  });
  const presetBtns = presets.map(([label, t]) => h('button', {
    type: 'button', class: 'btn btn--sm btn--ghost',
    on: { click: () => { hour = t; slider.value = String(t); update(); sfx.click(); } },
  }, label));

  const stock = sessionCandles(3);
  const fx = continuousCandles(5, { tick: 0.0001, base: 10850, count: 40 });
  const crypto = continuousCandles(9, { count: 42, drift: 3 });
  const fut = futuresRoll(4);
  const card = (title, chipText, media, text) => h('article', { class: 'mo-card' },
    h('h3', null, title), h('span', { class: 'chip chip--sm chip--outline' }, chipText), media, h('p', { html: text }));

  el.append(
    h('p', { html: 'You will chart many kinds of market. The candles look alike, but <strong>when</strong> a market trades and <strong>what</strong> its volume means differ, and that changes how you read the chart.' }),
    figure(h('div', { class: 'mo-widget', 'data-keys': 'capture' },
      weekHost,
      h('label', { class: 'mo-slider' }, h('span', { class: 'mo-row' }, h('span', { class: 'mo-label' }, 'Drag the clock'), timeOut), slider),
      h('div', { class: 'mo-row' }, presetBtns),
      statusList),
    'When each market trades in a typical week, New York time (example schedules: US stock exchanges, the forex market, crypto exchanges and equity-index futures; exact hours vary by exchange and product).',
    { label: 'Figure 2' }),
    h('div', { class: 'mo-cards' },
      card('Stocks & ETFs', 'Exchange sessions', miniChart(stock.candles, {
        width: 320, height: 118, yPad: 0.16, ariaLabel: 'Stock-like chart with a gap at each new session',
        overlays: stock.gaps.slice(0, 2).map((g) => ({ type: 'marker', idx: g, position: 'above', shape: 'dot', text: 'gap', color: 'accent' })),
      }), 'Shares of one company, or an <strong>ETF</strong> (exchange-traded fund: a basket you trade like one share). They trade on exchanges in sessions, with thinner pre- and after-hours trading. News that lands while the exchange is closed shows up as a <strong>gap</strong> at the next open. Volume counts the shares traded.'),
      card('Forex', '24 hours, 5 days', miniChart(fx, { width: 320, height: 118, yPad: 0.12, ariaLabel: 'Continuous currency chart around 1.0850' }),
        'Currencies trade in <strong>pairs</strong>: EUR/USD at 1.0850 means one euro costs 1.0850 US dollars. Banks and brokers trade around the clock from Sunday evening to Friday evening. Moves are counted in <strong>pips</strong> (0.0001 for most pairs, 0.01 for yen pairs). There is no single exchange, so charts usually show <strong>tick volume</strong>: how often the price changed.'),
      card('Crypto', '24/7', miniChart(crypto, {
        width: 320, height: 118, yPad: 0.14, ariaLabel: 'Continuous crypto chart that keeps trading through the weekend',
        overlays: [{ type: 'box', from: 30, to: 41, full: true, color: 'info', label: 'Weekend' }],
      }), 'Coins trade 24 hours a day, 7 days a week, on many separate exchanges, so there are no session gaps. Weekends can be thin, which allows sudden moves, and each exchange reports its own volume.'),
      card('Futures & commodities', 'Contracts that expire', miniChart(fut.candles, {
        width: 320, height: 118, yPad: 0.16, ariaLabel: 'Futures chart with a jump where one contract rolls into the next',
        overlays: [{ type: 'marker', idx: fut.roll, position: 'above', shape: 'dot', text: 'roll', color: 'accent' }],
      }), 'A <strong>futures contract</strong> is an agreement to buy or sell something (a stock index, oil, gold) at a set price on a future date, its <strong>expiry</strong>. Traders <strong>roll</strong> to the next contract before expiry, which can leave a jump on a continuous chart. Volume and open interest (contracts still open) come from one exchange.')),
  );
  update();
  return responsive(weekHost, drawWeek);
}

// ------------------------------------------------------------------ step 3: order types as mini stories

const P0 = 1000; // 50.00

function storyMarket() {
  const tp = makeTape(11, { hist: [[0.4, -3], [0.75, 2]], fut: [[12, 2], [28, 1], [44, 6], [56, 8]], valid: (t) => maxBetween(t.last, 1, 56) >= P0 + 5 });
  const K = tp.K;
  const res = tp.sim({ side: 'buy', type: 'market' });
  const f = firstFill(res);
  return {
    candles: tp.candles,
    frames: [
      { to: K, caption: 'Price is at 50.00: the best bid is 50.00 and the best ask 50.05. You want to own the shares right now.', overlays: [
        { type: 'hline', price: pr(tp.ask[0]), color: 'bear', dashed: true, label: `Ask ${px2(tp.ask[0])}`, priceTag: false, from: K - 6 },
        { type: 'hline', price: pr(tp.bid[0]), color: 'bull', dashed: true, label: `Bid ${px2(tp.bid[0])}`, priceTag: false, from: K - 6 }] },
      { to: K, title: 'Market buy.', caption: `It fills at once at the ask, ${px2(f.p)}. The ${(TICK * (tp.ask[0] - tp.bid[0])).toFixed(2)} spread is paid the moment you buy.`, overlays: [
        { type: 'marker', idx: K - 0.5, price: pr(f.p), position: 'at', shape: 'dot', color: 'bull', text: `Bought ${px2(f.p)}` }] },
      { to: tp.candles.length, caption: 'What price does next is up to the market. A market order promises a fill, not a price.' },
    ],
  };
}

function storyLimit() {
  const L = P0 - 10; // 49.50
  const tp = makeTape(12, {
    hist: [[0.35, 4], [0.7, -2]],
    fut: [[12, -8], [24, -2], [38, -11], [56, -3]],
    valid: (t) => {
      const r = t.sim({ side: 'buy', type: 'limit', price: L });
      const f = firstFill(r);
      return minBetween(t.last, 1, 16) === P0 - 8 && minBetween(t.last, 1, 30) >= P0 - 9 && f && f.t >= 32 && f.t <= 44 && f.p === L;
    },
  });
  const K = tp.K;
  const res = tp.sim({ side: 'buy', type: 'limit', price: L });
  const f = firstFill(res);
  let dipT = 1;
  for (let t = 1; t <= 20; t++) if (tp.last[t] < tp.last[dipT]) dipT = t;
  return {
    candles: tp.candles,
    frames: [
      { to: K, caption: 'Price is 50.00. You place a buy limit at 49.50: buy only at 49.50 or lower.', overlays: [{ type: 'hline', price: pr(L), color: 'accent', dashed: true, label: 'Buy limit 49.50', priceTag: false, from: K - 1 }] },
      { to: tp.idx(dipT) + 2, caption: `Price dips to ${px2(tp.last[dipT])} and turns back up. No trade at 49.50, so no fill: a limit order can miss.`, overlays: [{ type: 'marker', idx: tp.idx(dipT), price: pr(tp.last[dipT]), position: 'at', shape: 'ring', color: 'muted', text: 'no fill' }] },
      { to: tp.idx(f.t) + 1, title: 'Filled.', caption: `Later it trades down to 49.50: filled at ${px2(f.p)}, your price.`, overlays: [{ type: 'marker', idx: tp.idx(f.t), price: pr(f.p), position: 'below', shape: 'arrow', color: 'bull', text: `Bought ${px2(f.p)}` }] },
      { to: tp.candles.length, caption: 'A limit fills at your price or better, never worse. The cost of that control: no promise of a fill.' },
    ],
  };
}

/** The gap-down tape shared by the stop and stop-limit stories (and the compare step). */
function gapTape() {
  const S = P0 - 12; // 49.40
  const Lm = P0 - 14; // 49.30
  const tg = 1 + 9 * 4; // a candle opens with the gap
  return makeTape(13, {
    hist: [[0.4, -3], [0.75, 3]],
    fut: [[10, -1], [22, 1], [tg - 2, -9, false, 0.4], [tg, -16, true], [56, -24, false, 0.4]],
    valid: (t) => {
      const st = t.sim({ side: 'sell', type: 'stop', price: S });
      const sl = t.sim({ side: 'sell', type: 'stop-limit', price: S, limit: Lm });
      return st.triggerT === tg && st.fills[0]?.p === P0 - 16 && minBetween(t.last, 1, tg - 1) >= P0 - 10 && sl.triggered && !sl.filled && maxBetween(t.last, tg, 56) <= P0 - 15;
    },
  });
}

function storyStop() {
  const S = P0 - 12;
  const tp = gapTape();
  const K = tp.K;
  const res = tp.sim({ side: 'sell', type: 'stop', price: S });
  const f = firstFill(res);
  const gi = tp.idx(f.t);
  return {
    candles: tp.candles,
    frames: [
      { to: K, caption: 'You bought at 50.00. To cap the loss, a sell stop waits at 49.40, below the market.', overlays: [{ type: 'hline', price: pr(S), color: 'bear', dashed: true, label: 'Sell stop 49.40', priceTag: false, from: K - 1 }] },
      { to: gi, caption: 'While price stays above 49.40, the stop does nothing. It is not in the market yet.' },
      { to: gi + 1, title: 'Gap.', caption: `Bad news: the next trade is at ${px2(tp.last[f.t])}. The stop triggers, becomes a market order and fills at ${px2(f.p)}, not 49.40.`, overlays: [
        { type: 'marker', idx: gi, price: pr(f.p), position: 'below', shape: 'arrow', color: 'bear', text: `Sold ${px2(f.p)}` },
        { type: 'zone', from: pr(f.p), to: pr(S), x1: gi - 1.5, x2: gi + 1.5, color: 'warn', opacity: 0.25, label: 'slippage' }] },
      { to: tp.candles.length, caption: `That is ${((S - f.p) * TICK).toFixed(2)} of slippage, but you are out and the loss stays close to plan. A buy stop above resistance works the same way to enter a breakout.` },
    ],
  };
}

function storyStopLimit() {
  const S = P0 - 12;
  const Lm = P0 - 14;
  const tp = gapTape();
  const K = tp.K;
  const res = tp.sim({ side: 'sell', type: 'stop-limit', price: S, limit: Lm });
  const gi = tp.idx(res.triggerT);
  return {
    candles: tp.candles,
    frames: [
      { to: K, caption: 'The same trade with a stop-limit: trigger at 49.40, then sell only at 49.30 or higher.', overlays: [
        { type: 'hline', price: pr(S), color: 'bear', dashed: true, label: 'Stop 49.40', priceTag: false, from: K - 1 },
        { type: 'hline', price: pr(Lm), color: 'accent', dashed: true, label: 'Limit 49.30', priceTag: false, from: K - 1 }] },
      { to: gi + 1, title: 'Gap.', caption: `The gap to ${px2(tp.last[res.triggerT])} triggers the order, but that is below the 49.30 limit, so it does not fill.`, overlays: [
        { type: 'marker', idx: gi, price: pr(tp.last[res.triggerT]), position: 'at', shape: 'ring', color: 'bear', text: 'triggered, no fill' }] },
      { to: tp.candles.length, caption: `Price keeps falling to ${px2(tp.last[tp.last.length - 1])} and you still hold the shares. A stop-limit protects the price, not the exit.` },
    ],
  };
}

function storyTakeProfit() {
  const TPp = P0 + 12; // 50.60
  const tp = makeTape(14, {
    hist: [[0.35, -6], [0.7, -2]],
    fut: [[16, 5], [26, 3], [40, 13], [56, 7]],
    valid: (t) => {
      const r = t.sim({ side: 'sell', type: 'limit', price: TPp });
      const f = firstFill(r);
      return f && f.t >= 32 && f.t <= 44 && f.p === TPp && maxBetween(t.last, 1, 30) <= P0 + 10;
    },
  });
  const K = tp.K;
  const f = firstFill(tp.sim({ side: 'sell', type: 'limit', price: TPp }));
  return {
    candles: tp.candles,
    frames: [
      { to: K, caption: 'You are long. Your target is 50.60, so a sell limit waits there: that is your take-profit.', overlays: [{ type: 'hline', price: pr(TPp), color: 'bull', dashed: true, label: 'Take-profit 50.60', priceTag: false, from: K - 1 }] },
      { to: tp.idx(f.t) + 1, title: 'Target hit.', caption: `The rally trades at 50.60 and the take-profit fills at ${px2(f.p)}.`, overlays: [{ type: 'marker', idx: tp.idx(f.t), price: pr(f.p), position: 'above', shape: 'arrow', color: 'bull', text: `Sold ${px2(f.p)}` }] },
      { to: tp.candles.length, caption: 'Price falls back afterwards, but the gain is banked. A take-profit is simply a limit order on the exit side.' },
    ],
  };
}

function storyOCO() {
  const SL = P0 - 10; // 49.50
  const TPp = P0 + 14; // 50.70
  const tp = makeTape(15, {
    hist: [[0.4, -4], [0.75, 2]],
    fut: [[14, -7], [28, 2], [44, 15], [56, 10]],
    valid: (t) => {
      const r = t.sim({ side: 'sell', type: 'limit', price: TPp });
      const f = firstFill(r);
      return f && f.t >= 38 && f.t <= 48 && minBetween(t.last, 1, f.t) === P0 - 7;
    },
  });
  const K = tp.K;
  const f = firstFill(tp.sim({ side: 'sell', type: 'limit', price: TPp }));
  let dipT = 1;
  for (let t = 1; t <= f.t; t++) if (tp.last[t] < tp.last[dipT]) dipT = t;
  const tpLine = { type: 'hline', price: pr(TPp), color: 'bull', dashed: true, label: 'Take-profit 50.70', priceTag: false, from: K - 1 };
  const fillMark = { type: 'marker', idx: tp.idx(f.t), price: pr(f.p), position: 'above', shape: 'arrow', color: 'bull', text: `Sold ${px2(f.p)}` };
  return {
    candles: tp.candles,
    frames: [
      { to: K, caption: 'Long from 50.00. Both exits go in together as one-cancels-other (OCO): a stop at 49.50 and a take-profit at 50.70.', overlays: [
        { type: 'hline', price: pr(SL), color: 'bear', dashed: true, label: 'Stop 49.50', priceTag: false, from: K - 1 }, tpLine] },
      { to: tp.idx(dipT) + 2, caption: `A dip to ${px2(tp.last[dipT])} comes close to the stop but never trades at 49.50.`, overlays: [{ type: 'marker', idx: tp.idx(dipT), price: pr(tp.last[dipT]), position: 'at', shape: 'ring', color: 'muted' }] },
      { to: tp.idx(f.t) + 1, title: 'One fills…', caption: `The take-profit fills at ${px2(f.p)}.`, overlays: [fillMark] },
      { to: tp.candles.length, clear: true, title: '…the other is cancelled.', caption: 'The broker cancels the stop automatically. Without OCO, a forgotten stop could fire later and open a position you never wanted.', overlays: [
        tpLine, fillMark, { type: 'hline', price: pr(SL), color: 'muted', dashed: true, label: 'Stop cancelled', priceTag: false, from: K - 1 }] },
    ],
  };
}

const ORDER_TABS = [
  { id: 'market', label: 'Market', story: storyMarket, rules: [
    ['Use it', 'when getting filled matters more than the exact price.'],
    ['Fills', 'at once, at the best price on offer: buy at the ask, sell at the bid.'],
    ['Watch', 'a big order in a thin or fast market walks the book (slippage).']] },
  { id: 'limit', label: 'Limit', story: storyLimit, rules: [
    ['Use it', 'to set your price: buy below the market, or sell above it.'],
    ['Fills', 'at your price or better, and only if the market trades there.'],
    ['Watch', 'it may never fill, and the move can leave without you.']] },
  { id: 'stop', label: 'Stop', story: storyStop, rules: [
    ['Use it', 'to exit a losing trade (a stop-loss) or to enter a breakout: a buy stop above the market, a sell stop below it.'],
    ['Fills', 'once a trade prints at the stop price, it becomes a market order.'],
    ['Watch', 'in a gap or a fast market it fills at the next available price (slippage).']] },
  { id: 'stop-limit', label: 'Stop-limit', story: storyStopLimit, rules: [
    ['Use it', 'when you want a trigger and a price cap in one order.'],
    ['Fills', 'after the trigger, only at the limit price or better.'],
    ['Watch', 'a gap past the limit means no fill. As a stop-loss it can leave you in the trade.']] },
  { id: 'tp', label: 'Take-profit', story: storyTakeProfit, rules: [
    ['Use it', 'to bank a gain at your target.'],
    ['Fills', 'like any limit on the exit side: a sell limit above the market for a long, a buy limit below it for a short.'],
    ['Watch', 'a target set far away may never be reached.']] },
  { id: 'oco', label: 'OCO bracket', story: storyOCO, rules: [
    ['Use it', 'to place the stop-loss and the take-profit together.'],
    ['Fills', 'whichever is reached first; the broker then cancels the other. A bracket order adds the entry to the same ticket.'],
    ['Watch', 'not every broker offers every order type: read the order preview.']] },
];

function orderTypesStep(el) {
  let current = null;
  let story = null;
  const panel = h('div', { class: 'mo-tabpanel', role: 'tabpanel', id: 'mo-types-panel' });
  const tabs = ORDER_TABS.map((t) => h('button', {
    type: 'button', role: 'tab', class: 'tab', id: `mo-tab-${t.id}`, 'aria-selected': 'false', 'aria-controls': 'mo-types-panel', tabindex: '-1', 'data-tab': t.id,
    on: { click: () => show(t.id, true) },
  }, t.label));
  const list = h('div', { class: 'tabs mo-tabs', role: 'tablist', 'aria-label': 'Order types' }, tabs);
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = ORDER_TABS.findIndex((t) => t.id === current);
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + ORDER_TABS.length) % ORDER_TABS.length;
    show(ORDER_TABS[n].id, true);
    tabs[n].focus();
  });

  function show(id, sound) {
    if (id === current) return;
    current = id;
    const t = ORDER_TABS.find((x) => x.id === id);
    tabs.forEach((b) => {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', `mo-tab-${id}`);
    try {
      story?.destroy();
    } catch (err) {
      console.error(err);
    }
    story = null;
    const host = h('div', { class: 'lesson-story', 'data-keys': 'capture' });
    panel.replaceChildren(host, h('dl', { class: 'mo-rules' }, t.rules.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v)))));
    try {
      const opts = t.story();
      story = new ChartStory(host, { height: window.innerWidth < 720 ? 250 : 280, indicators: { volume: false }, ariaLabel: `${t.label} order: chart story`, ...opts });
    } catch (err) {
      console.error('[markets-orders] story failed:', err);
      host.append(h('p', { class: 'callout callout--warn' }, 'This animation failed to load.'));
    }
    if (sound) sfx.click();
  }

  el.append(
    h('p', { html: 'An <strong>order</strong> is an instruction to your broker: buy or sell, how many, and under what conditions. Each order type answers one question differently: <em>do I care more about getting filled, or about the price?</em> Pick a tab and press play to see exactly when each one fills.' }),
    list,
    panel,
  );
  show('market', false);
  return () => {
    try {
      story?.destroy();
    } catch (err) {
      console.error(err);
    }
  };
}

// ------------------------------------------------------------------ step 4: a whole trade (storyStep)

function breakoutTradeStory(rng) {
  let best = null;
  for (let i = 0; i < 30 && !best; i++) {
    const sc = chartScenario('ascending-triangle', { seed: rng.int(1, 1e9), count: 92, after: 26, outcome: 'success' });
    const c = sc.candles;
    const b = sc.breakoutIdx;
    const ranges = c.slice(b - 10, b).map((k) => k.h - k.l);
    const avgR = ranges.reduce((s, v) => s + v, 0) / ranges.length;
    const X = +(sc.level + Math.max(0.01, avgR * 0.15)).toFixed(2);
    let trig = -1;
    for (let k = sc.patternStart; k < c.length; k++) {
      if (c[k].h >= X) {
        trig = k;
        break;
      }
    }
    if (trig !== b) continue;
    const fill = +Math.max(X, c[b].o).toFixed(2);
    const S = +(Math.min(...c.slice(b - 8, b).map((k) => k.l)) - avgR * 0.1).toFixed(2);
    const T = +sc.target.toFixed(2);
    if (!(T > fill + (fill - S) * 1.2) || c[b].l <= S) continue;
    let tpIdx = -1;
    let stopped = false;
    for (let k = b + 1; k < c.length; k++) {
      if (c[k].l <= S) {
        stopped = true;
        break;
      }
      if (c[k].h >= T) {
        tpIdx = k;
        break;
      }
    }
    if (stopped || tpIdx < 0 || tpIdx > c.length - 3) continue;
    best = { sc, X, fill, S, T, tpIdx };
  }
  if (!best) return null;
  const { sc, X, fill, S, T, tpIdx } = best;
  const b = sc.breakoutIdx;
  const up = sc.boundaries?.upper;
  const lowL = sc.boundaries?.lower;
  const seg = (l, color) => ({ type: 'segment', a: { idx: l.x1, price: l.y1 }, b: { idx: l.x2, price: l.y2 }, color, dashed: true, width: 1.5 });
  const R = fill - S;
  const lateFrom = Math.max(sc.patternStart, b - 30);
  return {
    candles: sc.candles,
    indicators: { volume: false },
    frames: [
      {
        to: b - 2, title: 'Context.',
        caption: `Price keeps stalling near the same ceiling (about ${sc.level.toFixed(2)}) while the lows rise: an ascending triangle. Buyers are pressing.`,
        overlays: [up ? seg(up, 'resistance') : { type: 'hline', price: sc.level, color: 'resistance', dashed: true }, ...(lowL ? [seg(lowL, 'support')] : [])],
        focus: [sc.patternStart, b - 2],
      },
      {
        to: b, title: 'The plan.',
        caption: `No trade yet. A buy stop waits just above resistance at ${X.toFixed(2)}: it only fires if price breaks out.`,
        overlays: [{ type: 'hline', price: X, color: 'accent', dashed: true, label: `Buy stop ${X.toFixed(2)}`, priceTag: false, from: b - 8 }],
        focus: [lateFrom, b], zoom: true,
      },
      {
        to: b + 1, title: 'Trigger.',
        caption: `The breakout candle trades through ${X.toFixed(2)}: the stop triggers and fills at ${fill.toFixed(2)}.`,
        overlays: [{ type: 'marker', idx: b, price: fill, position: 'below', shape: 'arrow', color: 'bull', text: `Bought ${fill.toFixed(2)}` }],
        focus: [lateFrom, b + 1], zoom: true,
      },
      {
        to: b + 1, title: 'Protect and target.',
        caption: `Straight away, an OCO bracket: a stop-loss at ${S.toFixed(2)} under the last higher low and a take-profit at ${T.toFixed(2)}, the triangle's height added to the breakout. Risk ${R.toFixed(2)} to make ${(T - fill).toFixed(2)}.`,
        overlays: [
          { type: 'hline', price: S, color: 'bear', dashed: true, label: `Stop-loss ${S.toFixed(2)}`, priceTag: false, from: b },
          { type: 'hline', price: T, color: 'bull', dashed: true, label: `Take-profit ${T.toFixed(2)}`, priceTag: false, from: b },
        ],
        focus: [lateFrom, b + 1], zoom: true,
      },
      {
        to: tpIdx + 1, title: 'Outcome.',
        caption: `The take-profit fills at ${T.toFixed(2)} and the broker cancels the stop. It does not always work: the stop is there for the times it fails.`,
        overlays: [{ type: 'marker', idx: tpIdx, price: T, position: 'above', shape: 'arrow', color: 'bull', text: 'Take-profit filled' }],
        focus: [lateFrom, tpIdx + 1], zoom: true,
      },
      { to: sc.candles.length, caption: 'Every order was placed before it was needed: entry, stop and target decided while calm, executed by the broker when the market got there.', zoom: false },
    ],
  };
}

// ------------------------------------------------------------------ step 5: stop vs stop-limit (compare)

function gapCompareSides() {
  const S = P0 - 12;
  const Lm = P0 - 14;
  const tp = gapTape();
  const st = tp.sim({ side: 'sell', type: 'stop', price: S });
  const sl = tp.sim({ side: 'sell', type: 'stop-limit', price: S, limit: Lm });
  const f = st.fills[0];
  const gi = tp.idx(f.t);
  const end = tp.last[tp.last.length - 1];
  const candles = tp.candles.slice(tp.K - 10);
  const off = tp.K - 10;
  const common = [{ type: 'hline', price: pr(S), color: 'bear', dashed: true, label: 'Stop 49.40', priceTag: false }];
  return {
    left: {
      title: 'Sell stop at 49.40',
      verdict: 'good',
      tag: 'Out',
      candles,
      overlays: [...common, { type: 'marker', idx: gi - off, price: pr(f.p), position: 'below', shape: 'arrow', color: 'bear', text: `Sold ${px2(f.p)}` }],
      points: ['Triggers when the gap trade prints below 49.40.', `Fills at the next price, ${px2(f.p)}: ${((S - f.p) * TICK).toFixed(2)} of slippage.`, 'The position is closed; the loss stays near the plan.'],
    },
    right: {
      title: 'Stop-limit 49.40 / 49.30',
      verdict: 'bad',
      tag: 'Stuck',
      candles,
      overlays: [...common, { type: 'hline', price: pr(Lm), color: 'accent', dashed: true, label: 'Limit 49.30', priceTag: false },
        { type: 'marker', idx: tp.idx(sl.triggerT) - off, price: pr(tp.last[sl.triggerT]), position: 'at', shape: 'ring', color: 'bear', text: 'no fill' }],
      points: ['Triggers at the same moment.', 'Refuses to sell below its 49.30 limit, and every trade is lower.', `No fill: still holding as the price falls to ${px2(end)}.`],
    },
  };
}

// ------------------------------------------------------------------ step 6: long vs short

const PATH = [100, 104, 111, 115, 108, 99, 92, 88, 95, 104, 110, 122];

function longShortStep(el) {
  const shares = 10;
  let price = 100;
  let anim = null;
  let alive = true;
  let progress = 0;
  const pathHost = h('div', { class: 'mo-pathhost' });
  const priceOut = h('output', { class: 'mo-out' });
  const slider = h('input', { type: 'range', min: 60, max: 160, step: 0.5, value: price, 'aria-label': 'Price' });
  const playBtn = h('button', { type: 'button', class: 'btn btn--primary', 'data-action': 'play-pnl' });
  playLabel(playBtn, 'Play the price path');
  const bar = (label) => {
    const fill = h('span', { class: 'mo-fill' });
    const val = h('span', { class: 'val' });
    return { el: h('div', { class: 'mo-bar' }, h('span', null, label), h('span', { class: 'mo-track' }, fill), val), fill, val };
  };
  const longBar = bar('Long 10 @ 100');
  const shortBar = bar('Short 10 @ 100');
  const maxNote = h('p', { class: 'faint', 'aria-live': 'polite' });
  let W = 600;

  function drawPath(w) {
    W = w;
    const H = 150;
    const pad = 28;
    const lo = 80;
    const hi = 130;
    const n = PATH.length - 1;
    const x = (i) => pad + ((W - pad - 10) * i) / n;
    const y = (p) => 10 + ((hi - p) / (hi - lo)) * (H - 30);
    const d = PATH.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join('');
    // the part already played
    const upto = progress * n;
    const k = Math.floor(upto);
    const pts = PATH.slice(0, k + 1).map((p, i) => [x(i), y(p)]);
    if (k < n) pts.push([x(upto), y(PATH[k] + (PATH[k + 1] - PATH[k]) * (upto - k))]);
    const dd = progress > 0 ? pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('') : '';
    const dot = progress > 0 ? pts[pts.length - 1] : [x(0), y(price)];
    pathHost.innerHTML = `<svg class="mo-pnl-path" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="A price path starting at 100, rising to 115, falling to 88 and ending at 122">
      <line class="base" x1="${pad}" y1="${y(100).toFixed(1)}" x2="${W - 10}" y2="${y(100).toFixed(1)}"/>
      <text x="0" y="${(y(100) + 4).toFixed(1)}">100</text><text x="0" y="${(y(120) + 4).toFixed(1)}">120</text><text x="0" y="${(y(90) + 4).toFixed(1)}">90</text>
      <path class="line" d="${d}"/>${dd ? `<path class="done" d="${dd}"/>` : ''}
      <circle class="dot" cx="${dot[0].toFixed(1)}" cy="${Math.max(6, Math.min(H - 6, dot[1])).toFixed(1)}" r="6"/></svg>`;
  }

  function setBars() {
    const pl = (price - 100) * shares;
    const scale = 400; // $ at full half-track
    const put = (b, v) => {
      const w = Math.min(50, (Math.abs(v) / scale) * 50);
      b.fill.style.left = v >= 0 ? '50%' : `${50 - w}%`;
      b.fill.style.width = `${w}%`;
      b.fill.classList.toggle('is-neg', v < 0);
      b.val.textContent = money(v);
      b.val.className = `val ${v > 0 ? 'up' : v < 0 ? 'down' : ''}`;
    };
    put(longBar, pl);
    put(shortBar, -pl);
    priceOut.textContent = price.toFixed(2);
    maxNote.innerHTML = price > 100
      ? `Price above 100: the long gains and the short loses the same amount. There is no ceiling on how high a price can go, so there is no ceiling on the short's loss.`
      : price < 100
        ? `Price below 100: the short gains, the long loses. The long's worst case is a price of 0: a loss of ${plainMoney(1000)}.`
        : 'At 100 both positions are flat (before costs).';
  }

  function update() {
    setBars();
    drawPath(W);
  }

  function play() {
    anim?.cancel?.();
    const n = PATH.length - 1;
    playLabel(playBtn, 'Playing…', 'pause');
    playBtn.disabled = true;
    sfx.whoosh();
    anim = tween({
      from: 0, to: 1, duration: 6000, ease: (t) => t,
      onUpdate: (v) => {
        if (!alive) return;
        progress = Math.max(0.0001, v);
        const u = v * n;
        const k = Math.min(n - 1, Math.floor(u));
        price = PATH[k] + (PATH[k + 1] - PATH[k]) * (u - k);
        slider.value = String(price);
        update();
      },
    });
    anim.then(() => {
      if (!alive) return;
      playLabel(playBtn, 'Replay', 'restart');
      playBtn.disabled = false;
    });
  }
  playBtn.addEventListener('click', play);
  slider.addEventListener('input', () => {
    anim?.cancel?.();
    playBtn.disabled = false;
    playLabel(playBtn, 'Play the price path');
    progress = 0;
    price = Number(slider.value);
    update();
  });

  el.append(
    h('p', { html: 'Going <strong>long</strong> means buying first and selling later: you profit when the price rises. Going <strong>short</strong> means selling first and buying back later: you profit when the price falls.' }),
    h('p', { html: 'To short shares you <strong>borrow</strong> them from your broker, sell them, and later buy them back to return them. While you hold the short you pay a borrowing fee, and you owe any dividend the shares pay.' }),
    figure(h('div', { class: 'mo-widget', 'data-keys': 'capture' },
      pathHost,
      h('div', { class: 'mo-bars' }, longBar.el, shortBar.el),
      h('label', { class: 'mo-slider' }, h('span', { class: 'mo-row' }, h('span', { class: 'mo-label' }, 'Or drag the price'), priceOut), slider),
      h('div', { class: 'mo-row' }, playBtn),
      maxNote),
    'The same price path seen by a long and a short position of 10 shares from 100. Profit and loss = (exit − entry) × shares for a long, (entry − exit) × shares for a short, before costs.',
    { label: 'Figure 3' }),
    h('p', { html: 'A long can lose at most what it paid, because a price stops at zero. A short has no such floor: in theory the loss is unlimited, which is why shorts always need a stop.' }),
  );
  update();
  const off = responsive(pathHost, drawPath);
  return () => {
    alive = false;
    anim?.cancel?.();
    off();
  };
}

// ------------------------------------------------------------------ step 7: leverage and margin

function leverageStep(el) {
  const MONEY = 1000;
  let lev = 10;
  let move = -4; // %
  let alive = true;
  let anim = null;
  const levIn = h('input', { type: 'range', min: 1, max: 20, step: 1, value: lev, 'aria-label': 'Leverage' });
  const moveIn = h('input', { type: 'range', min: -15, max: 15, step: 0.5, value: move, 'aria-label': 'Price move in percent' });
  const levOut = h('output', { class: 'mo-out' });
  const moveOut = h('output', { class: 'mo-out' });
  const kv = h('div', { class: 'mo-kv' });
  const eqFill = h('span', { class: 'fill' });
  const eqMark = h('span', { class: 'mark', title: 'Close-out level' });
  const eqStart = h('span', { class: 'start' });
  const stampHost = h('div', { 'aria-live': 'polite' });
  const playBtn = h('button', { type: 'button', class: 'btn btn--primary', 'data-action': 'play-drop' });
  playLabel(playBtn, 'Play a 6% drop');
  const MAXEQ = 2500;

  const stat = (label, value, cls = '') => h('div', { class: 'stat' }, h('span', { class: 'stat__label' }, label), h('span', { class: `stat__value ${cls}` }, value));

  function update() {
    const pos = MONEY * lev;
    const closeAt = -50 / lev; // % move that leaves half the margin
    const out = move <= closeAt;
    const pnl = out ? -MONEY / 2 : pos * (move / 100);
    const eq = MONEY + pnl;
    levOut.textContent = `${lev}x`;
    moveOut.textContent = `${move > 0 ? '+' : ''}${move.toFixed(1)}%`;
    kv.replaceChildren(
      stat('Your money', plainMoney(MONEY)),
      stat('Position', plainMoney(pos)),
      stat('Profit / loss', money(Math.round(pnl)), pnl > 0 ? 'up' : pnl < 0 ? 'down' : ''),
      stat('On your money', `${pnl > 0 ? '+' : pnl < 0 ? '−' : ''}${Math.abs((pnl / MONEY) * 100).toFixed(0)}%`, pnl > 0 ? 'up' : pnl < 0 ? 'down' : ''));
    eqFill.style.width = `${Math.max(0, Math.min(100, (eq / MAXEQ) * 100))}%`;
    eqFill.className = `fill${out ? ' is-out' : eq < MONEY * 0.75 ? ' is-low' : ''}`;
    eqMark.style.left = `${((MONEY / 2) / MAXEQ) * 100}%`;
    eqStart.style.left = `${(MONEY / MAXEQ) * 100}%`;
    stampHost.replaceChildren(out
      ? h('div', { class: 'stack' },
        h('span', { class: 'mo-stamp' }, 'Closed out'),
        h('p', { class: 'faint', html: `At ${lev}x, a ${Math.abs(closeAt).toFixed(1)}% drop costs half your money, and in this example the broker closes the position there. You lost ${plainMoney(MONEY / 2)} and the trade is over, even if the price comes back.` }))
      : h('p', { class: 'faint' }, lev === 1
        ? 'No leverage: the position moves one for one with your money.'
        : `At ${lev}x, every 1% move is ${lev}% of your money. The broker closes you out after a ${Math.abs(closeAt).toFixed(1)}% drop.`));
  }

  function playDrop() {
    anim?.cancel?.();
    playBtn.disabled = true;
    sfx.whoosh();
    anim = tween({
      from: 0, to: -6, duration: 2600, ease: (t) => t,
      onUpdate: (v) => {
        if (!alive) return;
        move = Math.round(v * 10) / 10;
        moveIn.value = String(move);
        update();
      },
    });
    anim.then(() => {
      if (!alive) return;
      playBtn.disabled = false;
      playLabel(playBtn, 'Replay the drop', 'restart');
      if (move <= -50 / lev) sfx.wrong();
    });
  }
  playBtn.addEventListener('click', playDrop);
  levIn.addEventListener('input', () => {
    lev = Number(levIn.value);
    update();
  });
  moveIn.addEventListener('input', () => {
    anim?.cancel?.();
    playBtn.disabled = false;
    move = Number(moveIn.value);
    update();
  });

  el.append(
    h('p', { html: '<strong>Leverage</strong> means controlling a bigger position than your own money pays for, with the rest lent by your broker. The money you put up is your <strong>margin</strong>. With 10x leverage, $1,000 of margin controls a $10,000 position.' }),
    h('p', { html: 'Worked example at 10x: a 1% move is $100, which is 10% of your money. A 5% drop costs $500, half your money. A 10% drop wipes out the whole $1,000. Gains grow the same way, which is why leverage looks attractive, but losses arrive just as fast.' }),
    figure(h('div', { class: 'mo-widget', 'data-keys': 'capture' },
      h('div', { class: 'mo-cards', style: { gap: '12px' } },
        h('label', { class: 'mo-slider' }, h('span', { class: 'mo-row' }, h('span', { class: 'mo-label' }, 'Leverage'), levOut), levIn),
        h('label', { class: 'mo-slider' }, h('span', { class: 'mo-row' }, h('span', { class: 'mo-label' }, 'Price move'), moveOut), moveIn)),
      kv,
      h('div', { class: 'stack', style: { gap: '4px' } },
        h('span', { class: 'mo-label' }, 'Your money left (equity)'),
        h('div', { class: 'mo-equity', role: 'img', 'aria-label': 'Equity bar with the close-out level at half the margin' }, eqFill, eqStart, eqMark),
        h('div', { class: 'mo-scale' }, h('span', null, '$0'), h('span', null, 'close-out $500 · start $1,000'), h('span', null, plainMoney(MAXEQ)))),
      h('div', { class: 'mo-row' }, playBtn),
      stampHost),
    'Your profit or loss as a share of your own money, for the same price move at different leverage. Close-out rule used here: the broker closes the position when your equity falls to half the margin (the rule for retail CFD accounts in the EU and UK).',
    { label: 'Figure 4' }),
    h('div', { class: 'callout callout--warn' }, icon('info'),
      h('p', { html: '<strong>Leverage multiplies losses exactly as much as gains.</strong> The broker will <strong>close out</strong> (liquidate) your position long before you feel ready, and a gap can cost more than your deposit on some accounts. Regulators in many countries make brokers warn that most retail accounts trading leveraged products such as CFDs lose money. Learn with no leverage and paper money first.' })),
  );
  update();
  return () => {
    alive = false;
    anim?.cancel?.();
  };
}

// ------------------------------------------------------------------ step 8: costs

function costsStep(el) {
  let target = 0.25;
  let thin = false;
  let overnight = false;
  const SHARES = 100;
  const PRICE = 50;
  const slider = h('input', { type: 'range', min: 0.05, max: 2, step: 0.05, value: target, 'aria-label': 'Target per share in dollars' });
  const tOut = h('output', { class: 'mo-out' });
  const thinBtn = h('button', { type: 'button', class: 'btn btn--sm mo-toggle', 'aria-pressed': 'false' }, 'Thin market: wider spread');
  const nightBtn = h('button', { type: 'button', class: 'btn btn--sm mo-toggle', 'aria-pressed': 'false' }, 'Held 5 nights with leverage');
  const barEl = h('div', { class: 'mo-costbar', role: 'img' });
  const kv = h('div', { class: 'mo-kv' });
  const curveHost = h('div');
  const legend = h('div', { class: 'mo-legend' },
    h('span', null, h('i', { style: { background: 'var(--bear)' } }), 'Spread'),
    h('span', null, h('i', { style: { background: 'var(--warn)' } }), 'Commission'),
    h('span', null, h('i', { style: { background: 'var(--ma3)' } }), 'Slippage'),
    h('span', null, h('i', { style: { background: 'var(--info)' } }), 'Overnight financing'),
    h('span', null, h('i', { style: { background: 'color-mix(in oklab, var(--bull) 22%, var(--surface-2))' } }), 'What you keep'));
  let W = 600;

  const costs = () => {
    const spread = thin ? 0.15 : 0.05; // paid once per round trip (buy at the ask, sell at the bid)
    const comm = 2 / SHARES; // $1 per order, two orders
    const slip = 0.02; // about a cent each side
    const fund = overnight ? +((PRICE * 0.06) / 365 * 5).toFixed(3) : 0; // ~6% a year on the position
    return { spread, comm, slip, fund, total: spread + comm + slip + fund };
  };

  function drawCurve(w) {
    W = w;
    const H = 150;
    const pl = 38;
    const pb = 22;
    const c = costs();
    const x = (v) => pl + ((W - pl - 10) * (v - 0.05)) / (2 - 0.05);
    const y = (pct) => 8 + (1 - Math.min(pct, 150) / 150) * (H - pb - 8);
    let d = '';
    for (let v = 0.05; v <= 2.0001; v += 0.01) d += `${d ? 'L' : 'M'}${x(v).toFixed(1)},${y((c.total / v) * 100).toFixed(1)}`;
    const cx = x(target);
    const cy = y((c.total / target) * 100);
    curveHost.innerHTML = `<svg class="mo-curve" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Costs as a share of the target fall as the target grows">
      <line class="axis" x1="${pl}" y1="${H - pb}" x2="${W - 6}" y2="${H - pb}"/><line class="axis" x1="${pl}" y1="6" x2="${pl}" y2="${H - pb}"/>
      <line class="half" x1="${pl}" y1="${y(50).toFixed(1)}" x2="${W - 6}" y2="${y(50).toFixed(1)}"/>
      <text x="4" y="${(y(100) + 4).toFixed(1)}">100%</text><text x="4" y="${(y(50) + 4).toFixed(1)}">50%</text><text x="4" y="${(y(0) + 4).toFixed(1)}">0%</text>
      <text x="${pl}" y="${H - 5}">$0.05</text><text x="${(W - 6).toFixed(1)}" y="${H - 5}" text-anchor="end">$2.00 target</text>
      <path class="curve" d="${d}"/><circle class="dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="6"/></svg>`;
  }

  function update() {
    const c = costs();
    tOut.textContent = `$${target.toFixed(2)} a share`;
    const share = c.total / target;
    const seg = (cls, v, label) => h('span', { class: cls, style: { width: `${Math.min(100, (v / target) * 100).toFixed(2)}%` }, title: `${label} $${v.toFixed(3)}` });
    barEl.replaceChildren(seg('c-spread', c.spread, 'Spread'), seg('c-comm', c.comm, 'Commission'), seg('c-slip', c.slip, 'Slippage'), seg('c-fund', c.fund, 'Financing'));
    barEl.setAttribute('aria-label', `Costs ${Math.round(share * 100)}% of the target`);
    const net = target - c.total;
    const stat = (label, value, cls = '') => h('div', { class: 'stat' }, h('span', { class: 'stat__label' }, label), h('span', { class: `stat__value ${cls}` }, value));
    kv.replaceChildren(
      stat('Costs per share', `$${c.total.toFixed(3)}`),
      stat('Share of target', `${Math.round(share * 100)}%`, share >= 0.5 ? 'down' : ''),
      stat('Kept if right', `${money(net * SHARES, 2)}`, net > 0 ? 'up' : 'down'),
      stat('Lost if wrong', `${money(-(target + c.total) * SHARES, 2)}`, 'down'));
    thinBtn.setAttribute('aria-pressed', String(thin));
    nightBtn.setAttribute('aria-pressed', String(overnight));
    drawCurve(W);
  }
  slider.addEventListener('input', () => {
    target = Number(slider.value);
    update();
  });
  thinBtn.addEventListener('click', () => {
    thin = !thin;
    sfx.click();
    update();
  });
  nightBtn.addEventListener('click', () => {
    overnight = !overnight;
    sfx.click();
    update();
  });

  el.append(
    h('p', { html: 'Every trade pays. The <strong>spread</strong>: you buy at the ask and sell at the bid. <strong>Commission</strong>: the broker’s fee per order (zero-commission brokers often earn it through wider spreads instead). <strong>Slippage</strong>: fills a little worse than the price you saw. And on leveraged positions held overnight, <strong>financing</strong>: interest on the borrowed money, called funding on crypto perpetual futures.' }),
    h('p', { html: 'These costs are about the same whatever you aim for, so they hurt small targets most. Drag the target down and watch the share of it that goes to costs.' }),
    figure(h('div', { class: 'mo-widget', 'data-keys': 'capture' },
      h('label', { class: 'mo-slider' }, h('span', { class: 'mo-row' }, h('span', { class: 'mo-label' }, 'Target (per share)'), tOut), slider),
      h('div', { class: 'mo-row' }, thinBtn, nightBtn),
      barEl, legend, kv, curveHost),
    'Round-trip costs against the size of the target: 100 shares of a $50 stock, $1 commission per order, about $0.01 of slippage each way, a $0.05 spread ($0.15 in a thin market) and, if held 5 nights on borrowed money, about 6% a year in financing. Example numbers; your broker’s will differ.',
    { label: 'Figure 5' }),
  );
  update();
  return responsive(curveHost, drawCurve);
}

// ------------------------------------------------------------------ step 9: a real breakout's stop fill

function stopFillAnnotate(setup, chart, ex) {
  const m = setup?.meta || {};
  const c = ex.candles || [];
  const up = setup?.direction !== 'bearish';
  const level = m.level;
  if (!Number.isFinite(level) || !c.length) return;
  const dec = ex.decimals ?? (level < 5 ? 4 : 2);
  const buf = Math.max(level * 0.001, 10 ** -dec);
  const stop = up ? level + buf : level - buf;
  const pivots = (m.pivots || []).filter((p) => p && Number.isFinite(p.idx));
  const from = Math.max(0, (pivots.length ? pivots[pivots.length - 1].idx : setup.start ?? 0) + 1);
  chart.addHLine({ price: level, from: pivots[0]?.idx ?? setup.start ?? 0, color: up ? 'resistance' : 'support', dashed: true, label: up ? 'Resistance' : 'Support', priceTag: false });
  chart.addHLine({ price: stop, from: Math.max(0, from - 3), color: 'accent', dashed: true, width: 1.5, label: up ? 'Buy stop' : 'Sell stop', priceTag: false });
  let trig = -1;
  for (let k = from; k < c.length; k++) {
    if (up ? c[k].h >= stop : c[k].l <= stop) {
      trig = k;
      break;
    }
  }
  if (trig < 0) return;
  const fill = up ? Math.max(stop, c[trig].o) : Math.min(stop, c[trig].o);
  const gapped = up ? c[trig].o > stop : c[trig].o < stop;
  chart.addMarker({ idx: trig, price: fill, position: up ? 'below' : 'above', shape: 'arrow', color: up ? 'bull' : 'bear', text: `${gapped ? 'Gap fill' : 'Filled'} ${fill.toFixed(dec)}` });
  const d = ex.decisionIdx ?? setup.decisionIdx;
  if (Number.isFinite(d) && d !== trig && d < c.length) chart.addMarker({ idx: d, position: up ? 'above' : 'below', shape: 'dot', color: 'accent', text: 'Breakout close' });
}

// ------------------------------------------------------------------ step 10: brokers, paper trading, takeaways

function brokerStep(el) {
  const rows = [
    ['1', 'Side', h('span', { class: 'v buy' }, 'BUY')],
    ['2', 'Quantity', h('span', { class: 'v' }, '100 shares')],
    ['3', 'Order type', h('span', { class: 'v' }, 'LIMIT')],
    ['4', 'Limit price', h('span', { class: 'v' }, '49.50')],
    ['5', 'Time in force', h('span', { class: 'v' }, 'DAY')],
  ];
  const ticket = h('div', { class: 'mo-ticket', role: 'img', 'aria-label': 'An order preview: buy 100 shares, limit order at 49.50, time in force Day, estimated cost $4,950 plus $1 commission' },
    h('header', null, h('span', null, 'Order preview'), h('span', { class: 'chip chip--sm chip--outline' }, 'Paper account')),
    rows.map(([n, k, v]) => h('div', { class: 'r' }, h('span', { class: 'n' }, n), h('span', null, k), v)),
    h('footer', null, 'Estimated cost $4,950.00 + $1.00 commission. Not filled yet: it waits at 49.50.'));
  el.append(
    h('p', { html: 'A <strong>broker</strong> stands between you and the market. It holds your cash and positions, sends your orders to exchanges and other trading venues, confirms every fill, lends money on margin and charges fees for all of it.' }),
    figure(h('div', { class: 'mo-widget' }, ticket,
      h('ol', { class: 'mo-notes' },
        h('li', null, h('span', { class: 'n' }, '1'), h('span', { html: '<strong>Side.</strong> Buy or sell. Closing a long is a sell; closing a short is a buy.' })),
        h('li', null, h('span', { class: 'n' }, '2'), h('span', { html: '<strong>Quantity.</strong> Check the zeros: 100, not 1,000.' })),
        h('li', null, h('span', { class: 'n' }, '3'), h('span', { html: '<strong>Order type.</strong> Market, limit, stop or stop-limit: fill first, or price first?' })),
        h('li', null, h('span', { class: 'n' }, '4'), h('span', { html: '<strong>Price.</strong> A buy limit above the market fills at once; a buy stop below it triggers at once.' })),
        h('li', null, h('span', { class: 'n' }, '5'), h('span', { html: '<strong>Time in force.</strong> <em>Day</em> orders are cancelled at the close if unfilled; <em>good ’til cancelled</em> (GTC) orders keep working until they fill or you cancel them (brokers often cap this, for example at 90 days).' })))),
    'Read the order preview before you send: side, size, type, price and how long the order lives.', { label: 'Figure 6' }),
    h('p', { html: 'Use a broker that is <strong>regulated</strong> by the financial regulator where you live, and look its name up on that regulator’s public register. Regulated brokers must keep client money separate from their own, and many countries run compensation schemes if a broker fails. Walk away from anyone promising guaranteed returns, rushing you to deposit, or offering huge leverage.' }),
    h('p', { html: 'Before real money, <strong>paper trade</strong>: most platforms offer a demo account with pretend money. Place every order type until it feels boring, and write down each trade. Paper fills are kinder than real ones (no nerves, often no slippage), so a good paper record is a start, not proof.' }),
    takeaway([
      'The <strong>bid</strong> is what buyers pay, the <strong>ask</strong> what sellers want; the <strong>spread</strong> between them is a cost on every round trip.',
      '<strong>Market</strong> orders buy certainty of a fill; <strong>limit</strong> orders buy control of the price; <strong>stops</strong> react to a move and can slip in gaps; <strong>stop-limits</strong> can refuse to fill.',
      'A <strong>long</strong> profits when price rises, a <strong>short</strong> when it falls; a short’s loss has no ceiling.',
      '<strong>Leverage</strong> multiplies losses as much as gains, and the broker closes you out early.',
      'Costs are roughly fixed per trade, so small targets need a very high win rate. Use a regulated broker and paper trade first.',
    ], { title: 'Key takeaways' }),
    h('div', { class: 'mo-cta' },
      h('p', null, 'Now fill real-looking client orders on a live price ladder: pick the order type, drag the price, and watch the market decide.'),
      h('a', { class: 'btn btn--primary', href: '#g.order-desk' }, icon('play', { size: 16 }), 'Play Order Desk')),
  );
}

// ------------------------------------------------------------------ the lesson

export default {
  id: 'markets-orders',
  mount(root, ctx) {
    root.classList.add('markets-orders');
    const style = h('style', { 'data-module': 'markets-orders' }, CSS);
    document.head.append(style);

    const shell = new LessonShell(root, ctx, {
      intro: 'How a trade actually happens: who is on the other side, what the bid, the ask and the spread are, how market, limit and stop orders fill (or don’t), and what shorting, leverage and costs do to your results.',
      steps: [
        { title: 'Bid, ask and the spread', render: (el) => orderBookStep(el) },
        { title: 'Four markets, four clocks', render: (el) => marketsStep(el) },
        {
          title: 'Order types: when does each fill?',
          render: (el) => orderTypesStep(el),
          quiz: {
            question: 'Price is 50.00. You want to buy only if the price breaks above 51.00. Which order?',
            options: [
              { label: 'Buy stop at 51.00', value: 'buy-stop' },
              { label: 'Buy limit at 51.00', value: 'buy-limit' },
              { label: 'Sell stop at 51.00', value: 'sell-stop' },
              { label: 'Market buy now', value: 'market' },
            ],
            answer: 'buy-stop',
            explain: '<strong>Buy stop at 51.00.</strong> A buy stop waits above the market and triggers when a trade prints at 51.00. A buy limit at 51.00 is above the current price, so it would fill at once at about 50.00, before any breakout.',
          },
        },
        storyStep({
          title: 'One trade, order by order',
          text: 'Here is how the orders work together on one textbook trade: a breakout from an ascending triangle. Step through it with the controls; every price is computed from the chart.',
          after: 'The stop-loss and the take-profit were decided before the entry filled. That is the point of orders: you decide while you are calm, and the broker acts when the market gets there.',
          story: (rng) => breakoutTradeStory(rng),
        }),
        compareStep({
          title: 'Stops in a gap: exit or stuck?',
          text: 'The same position, the same stop level, the same gap down. One order gets you out with some slippage; the other refuses the price and leaves you holding. Which would you rather have when you must be out?',
          ...gapCompareSides(),
          height: 230,
          after: 'Neither is always right. A stop protects the <strong>exit</strong> but not the price; a stop-limit protects the <strong>price</strong> but not the exit. For a stop-loss, most traders want the exit.',
          quiz: {
            question: 'You must be out of a long position if the price falls to 49.40, even if it gaps. Which order?',
            options: [
              { label: 'Sell stop at 49.40', value: 'stop' },
              { label: 'Sell stop-limit: stop 49.40, limit 49.30', value: 'stop-limit' },
              { label: 'Sell limit at 49.40', value: 'limit' },
              { label: 'Buy stop at 49.40', value: 'buy-stop' },
            ],
            answer: 'stop',
            explain: '<strong>A sell stop.</strong> Once a trade prints at 49.40 it becomes a market order and fills at the next available price, even after a gap. The stop-limit refuses anything below 49.30, and a sell limit at 49.40 is below the market, so it would sell at once.',
          },
        }),
        {
          title: 'Long or short',
          render: (el) => longShortStep(el),
          quiz: {
            question: 'You short 10 shares at 100. The price rises to 130. What is your profit or loss, before costs?',
            options: [
              { label: '−$300', value: -300 },
              { label: '+$300', value: 300 },
              { label: '−$30', value: -30 },
              { label: '−$1,300', value: -1300 },
            ],
            answer: -300,
            explain: '<strong>−$300.</strong> A short makes (entry − exit) × shares = (100 − 130) × 10 = −$300. The higher the price goes, the bigger the loss.',
          },
        },
        { title: 'Leverage and margin', render: (el) => leverageStep(el) },
        {
          title: 'Costs eat small targets',
          render: (el) => costsStep(el),
          quiz: {
            question: 'Your plan targets $0.10 a share and risks $0.10. Round-trip costs are $0.08 a share. What is the problem?',
            options: [
              { label: 'Costs eat most of each win and add to each loss', value: 'costs' },
              { label: 'None: the reward equals the risk', value: 'none' },
              { label: 'Costs only matter to long-term investors', value: 'investors' },
              { label: 'Commission-free brokers have no costs', value: 'free' },
            ],
            answer: 'costs',
            explain: '<strong>Costs dominate.</strong> A win keeps $0.02 while a loss costs $0.18, so you would need to be right 9 times out of 10 just to break even. Bigger targets make the same costs matter less.',
          },
        },
        realExampleStep({
          title: 'A real breakout: where did the stop fill?',
          kinds: ['breakout-up', 'breakout-down'],
          intervals: ['1d', '1w'],
          before: 60,
          after: 20,
          text: 'A real breakout from the market-data sample. The dashed line is where a trader might have parked a stop order to enter the move, a little beyond the level. The arrow shows where it would have filled: at the stop price, or at the open if the market gapped past it.',
          caption: 'Stocks and ETFs are closed between daily candles, so a stop can fill well beyond its price at the next open; forex and crypto trade around the clock and gap less. Real data, shown to learn from: not a prediction.',
          annotate: stopFillAnnotate,
        }),
        { title: 'Paper trade first', render: (el) => brokerStep(el) },
      ],
    });
    return () => {
      shell.destroy();
      style.remove();
      root.classList.remove('markets-orders');
    };
  },
};
