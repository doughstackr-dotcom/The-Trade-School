// Order Desk (Beginner · Markets, orders & the spread). A client calls with an order request; the
// player picks the side and order type, sets the price on a live price ladder (drag, tap or ↑/↓)
// and sends it. The market then plays out tick by tick: the order walks the book, rests, triggers,
// slips through a gap or never fills. Scored on the right order type, a sensible price and whether
// the client's goal was met. Scenarios and the order simulator live in ./order-desk-engine.js.
import { GameShell } from '../core/game-kit.js';
import { CandleChart } from '../core/chart.js';
import { h, svg, icon, sfx, kbdHint, reducedMotion } from '../core/ui.js';
import {
  TICK, PER, HIST, FUT, T_MAX, SL_OFFSET, TYPE_LABEL, KINDS,
  buildScenario, pickKind, simulate, evalGoal, describeOrder, marketOf, futureCandles, candleIndexOf,
  fmtTicks, fmtSize, priceOf, jitterBook, makeBook,
} from './order-desk-engine.js';

const ROUNDS = 8;
const TICK_MS = 72; // playout speed: one trade per 72 ms (12 one-minute candles ≈ 4.5 s)
const WALK_MS = 300; // a market order eating one price level
const TYPE_KEYS = { market: '1', limit: '2', stop: '3', 'stop-limit': '4' };
const SIDE_WORD = { buy: 'Buy', sell: 'Sell' };

const P = (t) => fmtTicks(t);
const minuteOf = (t) => Math.max(1, Math.floor((t - 1) / PER) + 1);

// ------------------------------------------------------------------ styles (scoped, tokens only)

const CSS = `
.order-desk .od { display: grid; gap: 14px; }
.order-desk .od-ticket { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 14px; align-items: start; padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow); position: relative; overflow: hidden; }
.order-desk .od-ticket::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--accent); }
.order-desk .od-ticket.is-in { animation: od-ring 0.5s var(--ease-back); }
@keyframes od-ring { 0% { transform: translateY(-8px) scale(0.98); opacity: 0; } 100% { transform: none; opacity: 1; } }
.order-desk .od-avatar { grid-row: span 2; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--accent-soft); color: var(--accent-strong); font: 700 18px/1 var(--font-display); }
.order-desk .od-who { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; font-size: 13px; color: var(--text-3); }
.order-desk .od-who strong { font-size: 15px; color: var(--text); }
.order-desk .od-quote { margin: 0; font-size: 18px; line-height: 1.45; color: var(--text); text-wrap: pretty; }
.order-desk .od-quote strong { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 600; color: var(--accent-strong); }
.order-desk .od-chips { grid-column: 2; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.order-desk .od-chips .chip { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.order-desk .od-desk { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); align-items: start; }
.order-desk .od-market { display: grid; gap: 8px; min-width: 0; }
.order-desk .od-mhead { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 14px; font-size: 13px; color: var(--text-3); }
.order-desk .od-quotes { display: flex; flex-wrap: wrap; gap: 4px 12px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 13px; color: var(--text-2); }
.order-desk .od-quotes b { font-weight: 600; }
.order-desk .od-quotes .q-bid b { color: var(--bull-strong); }
.order-desk .od-quotes .q-ask b { color: var(--bear-strong); }
.order-desk .od-frame { display: flex; align-items: stretch; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
.order-desk .od-chart { flex: 1 1 auto; min-width: 0; }
.order-desk .od-ladder { flex: 0 0 var(--od-ladder-w, 224px); width: var(--od-ladder-w, 224px); border-left: 1px solid var(--line); position: relative; touch-action: none; cursor: ns-resize; user-select: none; -webkit-user-select: none; outline: none; }
.order-desk .od-ladder:focus-visible { box-shadow: inset 0 0 0 2px var(--focus); }
.order-desk .od-ladder.is-off { cursor: default; }
.order-desk .od-ladder svg { display: block; width: 100%; }
.order-desk .odl-row { fill: transparent; }
.order-desk .odl-row--alt { fill: var(--surface-2); opacity: 0.45; }
.order-desk .odl-sep { stroke: var(--line); stroke-width: 1; }
.order-desk .odl-spread { fill: var(--accent-soft); opacity: 0.7; }
.order-desk .odl-spread-text { fill: var(--accent-strong); font: 600 9.5px var(--font-body); letter-spacing: 0.06em; text-transform: uppercase; }
.order-desk .odl-bar--bid { fill: var(--bull); opacity: 0.2; }
.order-desk .odl-bar--ask { fill: var(--bear); opacity: 0.2; }
.order-desk .odl-size { fill: var(--text-2); font: 500 11px var(--font-mono); font-variant-numeric: tabular-nums; }
.order-desk .odl-size--best { fill: var(--text); font-weight: 700; }
.order-desk .odl-px { fill: var(--text-3); font: 500 11px var(--font-mono); font-variant-numeric: tabular-nums; }
.order-desk .odl-px--bid { fill: var(--bull-strong); font-weight: 700; }
.order-desk .odl-px--ask { fill: var(--bear-strong); font-weight: 700; }
.order-desk .odl-pxbg { fill: var(--surface); }
.order-desk .odl-last { fill: var(--text); }
.order-desk .odl-order { fill: color-mix(in oklab, var(--accent) 16%, transparent); stroke: var(--accent); stroke-width: 1.5; }
.order-desk .odl-order--limit { fill: none; stroke-dasharray: 4 3; }
.order-desk .odl-tag { fill: var(--accent); }
.order-desk .odl-tag-text { fill: var(--accent-ink); font: 700 9.5px var(--font-body); letter-spacing: 0.04em; }
.order-desk .odl-grip { stroke: var(--accent); stroke-width: 1.5; stroke-linecap: round; }
.order-desk .odl-client { fill: var(--info); }
.order-desk .odl-eat { fill: var(--accent); opacity: 0.35; animation: od-eat 0.5s ease-out both; }
@keyframes od-eat { from { opacity: 0.75; } to { opacity: 0.25; } }
.order-desk .odl-fill { fill: none; stroke: var(--bull); stroke-width: 2; }
.order-desk .odl-fill--sell { stroke: var(--bear); }
.order-desk .od-status { min-height: 22px; margin: 0; font-size: 14px; color: var(--text-2); display: flex; align-items: center; gap: 8px; }
.order-desk .od-status .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: 0 0 auto; }
.order-desk .od-status.is-working .dot { background: var(--accent); animation: od-pulse 1s ease-in-out infinite; }
.order-desk .od-status.is-filled .dot { background: var(--bull); }
.order-desk .od-status.is-miss .dot { background: var(--bear); }
@keyframes od-pulse { 50% { opacity: 0.3; } }
.order-desk .od-entry { display: grid; gap: 14px; padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); min-width: 0; }
.order-desk .od-field { display: grid; gap: 6px; min-width: 0; }
.order-desk .od-label { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-3); }
.order-desk .od-label .faint { text-transform: none; letter-spacing: 0; font-weight: 500; }
.order-desk .od-seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 3px; border-radius: 10px; background: var(--surface-2); }
.order-desk .od-seg--types { grid-auto-flow: row; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.order-desk .od-seg--types.od-seg--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.order-desk .od-seg button { position: relative; min-height: 44px; padding: 4px 10px; border-radius: 8px; font-size: 15px; font-weight: 700; color: var(--text-2); display: flex; align-items: center; justify-content: center; gap: 6px; transition: background-color 0.15s, color 0.15s, box-shadow 0.15s; }
.order-desk .od-seg button:hover:not(:disabled) { color: var(--text); background: color-mix(in oklab, var(--surface) 60%, transparent); }
.order-desk .od-seg button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgba(15, 27, 45, 0.14), 0 0 0 1.5px var(--accent); }
.order-desk .od-seg button.is-buy[aria-pressed="true"] { background: var(--bull); color: var(--bull-ink); box-shadow: none; }
.order-desk .od-seg button.is-sell[aria-pressed="true"] { background: var(--bear); color: var(--bear-ink); box-shadow: none; }
.order-desk .od-seg button:disabled { cursor: default; opacity: 0.55; }
.order-desk .od-seg button[aria-pressed="true"]:disabled { opacity: 1; }
.order-desk .od-seg .key { position: absolute; top: 3px; left: 5px; font: 600 10px var(--font-mono); color: var(--text-3); }
.order-desk .od-seg button[aria-pressed="true"] .key { color: inherit; opacity: 0.7; }
.order-desk .od-price { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; gap: 6px; align-items: center; }
.order-desk .od-price button { min-height: 44px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface-2); color: var(--text); display: grid; place-items: center; }
.order-desk .od-price button:disabled { opacity: 0.45; cursor: default; }
.order-desk .od-price output { display: block; text-align: center; font: 700 22px/1.2 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text); padding: 6px 4px; border-radius: 8px; background: var(--surface-2); }
.order-desk .od-price output small { display: block; font: 500 11.5px/1.3 var(--font-body); color: var(--text-3); }
.order-desk .od-price output.is-market { font-size: 16px; color: var(--text-2); }
.order-desk .od-desc { margin: 0; font-size: 14px; line-height: 1.45; color: var(--text-2); min-height: 3em; }
.order-desk .od-desc.is-hot { color: var(--warn); }
.order-desk .od-send { width: 100%; }
.order-desk .od-keys { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 12px; color: var(--text-3); }
.order-desk .od-report { display: grid; gap: 10px; }
.order-desk .od-report h3 { margin: 0; font-size: 15px; }
.order-desk .od-checks { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.order-desk .od-checks li { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 8px; align-items: start; font-size: 14.5px; line-height: 1.45; }
.order-desk .od-checks .mk { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--bull); color: var(--bull-ink); margin-top: 1px; }
.order-desk .od-checks .is-no .mk { background: var(--bear); color: var(--bear-ink); }
.order-desk .od-checks .pts { font: 600 13px var(--font-mono); color: var(--text-3); }
.order-desk .od-checks .is-ok .pts { color: var(--bull-strong); }
.order-desk .od-tickets { display: grid; gap: 6px; font-size: 14px; }
.order-desk .od-tickets div { display: grid; grid-template-columns: 7.5em minmax(0, 1fr); gap: 8px; }
.order-desk .od-tickets span:first-child { color: var(--text-3); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding-top: 2px; }
.order-desk .od-mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.order-desk .od-why { margin: 0; font-size: 14.5px; line-height: 1.55; color: var(--text); }
.order-desk .od-deskrep { display: grid; gap: 10px; text-align: left; }
.order-desk .od-deskrep table { width: 100%; border-collapse: collapse; font-size: 14px; }
.order-desk .od-deskrep th, .order-desk .od-deskrep td { padding: 7px 8px; border-bottom: 1px solid var(--line); text-align: left; }
.order-desk .od-deskrep td.num { text-align: right; font-family: var(--font-mono); }
.order-desk .od-deskrep tr:last-child td { border-bottom: 0; }
.order-desk .od-preview { width: 100%; max-width: 340px; height: auto; display: block; margin-inline: auto; }
.order-desk .od-preview .odl-tag, .order-desk .od-preview .odl-order { animation: od-float 2.4s ease-in-out infinite; }
@keyframes od-float { 0%, 30% { transform: none; } 50%, 80% { transform: translateY(-20px); } }
@media (prefers-reduced-motion: reduce) {
  .order-desk .od-ticket.is-in, .order-desk .odl-eat, .order-desk .od-status.is-working .dot, .order-desk .od-preview .odl-tag, .order-desk .od-preview .odl-order { animation: none; }
}
@media (min-width: 1000px) {
  .order-desk .od-desk { grid-template-columns: minmax(0, 1fr) 320px; }
  .order-desk .od-quote { font-size: 19px; }
}
@media (min-width: 720px) and (max-width: 999.98px) {
  .order-desk .od-entry { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 22px; }
  .order-desk .od-entry .od-wide { grid-column: 1 / -1; }
}
@media (max-width: 719.98px) {
  .order-desk .od-ticket { padding: 12px 12px 12px 14px; gap: 2px 10px; }
  .order-desk .od-avatar { width: 36px; height: 36px; font-size: 15px; }
  .order-desk .od-quote { font-size: 16px; }
  .order-desk .od-chips { grid-column: 1 / -1; }
  .order-desk .od-entry { padding: 12px; gap: 12px; }
  .order-desk .od-keys { display: none; }
}
`;

// ------------------------------------------------------------------ words

function sideOfPosition(scn) {
  if (!scn.position) return null;
  return scn.position.side === 'long' ? `Long ${fmtSize(scn.position.size)} @ ${P(scn.position.entry)}` : `Short ${fmtSize(scn.position.size)} @ ${P(scn.position.entry)}`;
}

/** The client's request (HTML). Easy wording names the side; Normal/Hard wording makes you work it out. */
function requestHtml(scn) {
  const n = `<strong>${fmtSize(scn.size)}</strong>`;
  const X = scn.level != null ? `<strong>${P(scn.level)}</strong>` : '';
  const Y = scn.cap != null ? `<strong>${P(scn.cap)}</strong>` : '';
  const plain = scn.difficulty < 0.35;
  switch (scn.kind) {
    case 'now-buy': return plain ? `Buy ${n} shares now. I need to be in before the news.` : `Get me ${n} shares right away, before the announcement. Don't make me wait.`;
    case 'now-sell': return plain ? `Sell my ${n} shares now. I need the cash today.` : `Get me out of all ${n} shares immediately. I need the cash today.`;
    case 'now-big': return scn.side === 'buy'
      ? `The fund needs ${n} shares <em>right now</em>, whatever the price. Fill it all.`
      : `Risk wants us out: dump all ${n} shares <em>right now</em>, whatever the price.`;
    case 'cap-buy': return plain ? `Buy ${n} shares, but don't pay more than ${X}.` : `I want ${n} shares, but only at ${X} or cheaper. I'm happy to wait.`;
    case 'target-sell': return plain ? `Sell my ${n} shares at ${X} to take profit.` : `Take profit on my position at ${X}.`;
    case 'stoploss-sell': return plain ? `Sell my ${n} shares if the price drops to ${X}, to cap my loss.` : `Protect my position: if it falls to ${X}, I'm out.`;
    case 'breakout-buy': return plain ? `Buy ${n} shares only if the price breaks above ${X}.` : `If it breaks out through ${X}, I want ${n} shares. Not a moment before.`;
    case 'short-limit': return scn.difficulty < 0.6 ? `Sell short ${n} shares if the price rallies up to ${X}.` : `I want to be short ${n} shares if it bounces up to ${X}. Not lower.`;
    case 'breakdown-short': return scn.difficulty < 0.6 ? `Sell short ${n} shares if the price breaks below ${X}.` : `If support at ${X} gives way, get me short ${n} shares.`;
    case 'cover-stop': return `I'm short. If the price rises to ${X}, close it: that's as much as I'll lose.`;
    case 'cover-target': return `My short is working. Take profit at ${X}.`;
    case 'stoplimit-cap': return `Buy ${n} if it breaks above ${X}, but never pay more than ${Y}. News is due, so it could jump.`;
    case 'stoplimit-exit': return `If it drops to ${X}, sell my shares, but not for less than ${Y}. If it crashes through that, I'd rather hold.`;
    case 'stoplimit-trap': return `Earnings are out any minute. If the price drops to ${X}, get me out at <em>any</em> price. No exceptions.`;
    default: return '';
  }
}

/** What the client needed, in one plain sentence (the report). */
function goalText(scn) {
  const X = P(scn.level ?? 0);
  switch (scn.goal.kind) {
    case 'now': return `${SIDE_WORD[scn.side]} all ${fmtSize(scn.size)} shares immediately, at whatever price it takes.`;
    case 'better': return scn.side === 'buy' ? `Buy at ${X} or cheaper, and only if the price comes down there.` : `Sell at ${X} or higher, and only if the price gets up there.`;
    case 'trigger': return KINDS[scn.kind].exit
      ? `${SIDE_WORD[scn.side]} to close the position, but only if the price ${scn.side === 'buy' ? 'rises' : 'falls'} to ${X}${scn.kind === 'stoplimit-trap' ? ', at any price' : ''}.`
      : `${SIDE_WORD[scn.side]} only after the price ${scn.side === 'buy' ? 'breaks above' : 'breaks below'} ${X}.`;
    case 'capped': return `${SIDE_WORD[scn.side]} once the price ${scn.side === 'buy' ? 'rises' : 'falls'} to ${X}, but never at a worse price than ${P(scn.cap)}.`;
    default: return '';
  }
}

function hintFor(scn) {
  const buy = scn.side === 'buy';
  const pos = scn.position ? `The client is ${scn.position.side} ${fmtSize(scn.position.size)} shares, so closing means ${scn.position.side === 'long' ? 'selling' : 'buying back'}. ` : '';
  switch (scn.goal.kind) {
    case 'now': return 'Read the client’s timing words. Is the exact price or the speed more important to them?';
    case 'better': return `${pos}Compare the client’s price, ${P(scn.level)}, with the current ${buy ? 'ask' : 'bid'}, ${P(buy ? scn.ref + scn.s0 : scn.ref)}. Is it a better or a worse price than the market offers right now?`;
    case 'trigger':
      if (scn.kind === 'stoplimit-trap') return `${pos}What happens to an order that has a price limit if the market jumps straight past that limit?`;
      return `${pos}The client wants to act only after the price travels to ${P(scn.level)}. Is that above or below the last trade, ${P(scn.ref)}? Should the order wait for a better price or react to a move?`;
    case 'capped': return 'Two prices: one that switches the order on and one it must never cross. Which order type carries both?';
    default: return null;
  }
}

function orderLabel(o) {
  const side = (o.side || '').toUpperCase();
  const n = fmtSize(o.size);
  if (o.type === 'market') return `${side} MARKET ${n}`;
  if (o.type === 'limit') return `${side} LIMIT ${n} @ ${P(o.price)}`;
  if (o.type === 'stop') return `${side} STOP ${n} @ ${P(o.price)}`;
  return `${side} STOP-LIMIT ${n} · stop ${P(o.price)} · limit ${P(o.limit)}`;
}

function shortLabel(o) {
  if (o.type === 'market') return `${SIDE_WORD[o.side]} market`;
  if (o.type === 'stop-limit') return `${SIDE_WORD[o.side]} stop ${P(o.price)}`;
  return `${SIDE_WORD[o.side]} ${o.type} ${P(o.price)}`;
}

function avgText(res) {
  if (res.avg == null) return '';
  const whole = res.fills.every((f) => f.p === res.fills[0].p);
  return whole ? P(res.fills[0].p) : (res.avg * TICK).toFixed(3);
}

/** What happened to an order (plain words). */
function outcomeText(res) {
  const o = res.order;
  if (res.full) {
    if (res.doneT === 0) {
      if (res.fills.length > 1) return `Filled at once across ${res.fills.length} price levels: ${res.fills.map((f) => `${fmtSize(f.size)} @ ${P(f.p)}`).join(', ')} (average ${avgText(res)}).`;
      return `Filled at once: ${fmtSize(o.size)} @ ${P(res.fills[0].p)}.`;
    }
    return `Filled ${fmtSize(o.size)} @ ${avgText(res)} in minute ${minuteOf(res.doneT)}.`;
  }
  if (res.filled) return `Only ${fmtSize(res.filled)} of ${fmtSize(o.size)} filled (average ${avgText(res)}); the rest is still waiting at ${P(res.restingAt)}.`;
  if (res.triggered) return `Triggered in minute ${minuteOf(Math.max(1, res.triggerT))} but never filled: the price jumped past the ${P(o.limit)} limit.`;
  if (o.type === 'stop' || o.type === 'stop-limit') return `Never triggered: no trade printed at ${P(o.price)}.`;
  return `Never filled: the price never traded at ${P(o.price)}.`;
}

/** Teaching sentence for the right ticket, from the market that actually played out. */
function lessonText(scn, right) {
  const m = scn.future;
  const buy = scn.side === 'buy';
  const X = scn.level;
  const f = right.fills[0];
  switch (scn.goal.kind) {
    case 'now': {
      const best = buy ? scn.ref + scn.s0 : scn.ref;
      if (right.fills.length > 1) {
        const slip = Math.abs(right.avg - best) * TICK;
        return `A market order fills at once at the best price on offer, and keeps going when it is bigger than what waits there. ${fmtSize(scn.size)} shares took ${right.fills.length} price levels: an average of ${avgText(right)}, ${slip.toFixed(3)} ${buy ? 'above' : 'below'} the best ${buy ? 'ask' : 'bid'}. That extra cost is slippage.`;
      }
      return `A market order fills at once at the best price on offer: the ${buy ? 'ask' : 'bid'}, ${P(best)}. Crossing the spread (${P(scn.s0)}) is the price of getting it done now. Waiting for a cheaper price would have missed the move.`;
    }
    case 'better':
      if (!right.filled) return `The price turned one tick before ${P(X)}, so the limit never filled. That is the trade-off of a limit order: the client controls the price, not whether it fills.`;
      if (scn.variant === 'gap') return `The price gapped straight through ${P(X)} and the limit filled at ${P(f.p)}, even better than asked. A limit fills at your price or better, never worse.`;
      return `A ${buy ? 'buy' : 'sell'} limit waits ${buy ? 'below' : 'above'} the market and fills only at its price or better. In minute ${minuteOf(f.t)} the price reached ${P(X)} and it filled at ${P(f.p)}.`;
    case 'trigger': {
      if (!right.filled) return `The price never reached ${P(X)}, so the stop never triggered and the client kept the position. That is fine: a stop only acts when it is needed.`;
      const slip = Math.abs(f.p - X);
      const t = right.triggerT;
      const pre = m.last[Math.max(0, t - 1)];
      if (scn.kind === 'stoplimit-trap') return `The price gapped from ${P(pre)} to ${P(m.last[t])}. The plain stop triggered and filled at ${P(f.p)}: a worse price, but the client is out, as they insisted. A stop-limit at ${P(X)} with a ${P(X - SL_OFFSET)} limit would still be waiting while the price fell.`;
      if (scn.variant === 'gap') return `The price gapped from ${P(pre)} straight to ${P(m.last[t])}. The stop triggered and filled at the next available price, ${P(f.p)}: ${fmtTicks(slip)} of slippage. A stop becomes a market order, so in a gap it cannot promise its price.`;
      if (slip > 0) return `A fast market: the stop triggered at ${P(X)} but the next available price was ${P(f.p)}, ${fmtTicks(slip)} of slippage. Once triggered, a stop is a market order.`;
      return `The stop did nothing until a trade printed at ${P(X)} in minute ${minuteOf(t)}; then it became a market order and filled at ${P(f.p)}.`;
    }
    case 'capped': {
      const t = right.triggerT;
      if (right.filled) return `The stop-limit switched on at ${P(X)} and filled at ${P(f.p)}, inside the client's ${P(scn.cap)} limit.`;
      const pre = m.last[Math.max(0, (t ?? 1) - 1)];
      return `The price jumped from ${P(pre)} straight to ${P(m.last[t ?? 1])}, past the ${P(scn.cap)} limit. The stop-limit triggered but did not fill, so the client never ${buy ? 'paid more' : 'sold for less'} than ${P(scn.cap)}. That is exactly what they asked for.`;
    }
    default: return '';
  }
}

/** Why the player's order was wrong (list of HTML strings). */
function mistakeNotes(scn, order, res, g, marks) {
  const notes = [];
  const buy = scn.side === 'buy';
  if (!marks.side) {
    if (scn.position) notes.push(`The client is <strong>${scn.position.side}</strong>, so closing the position means <strong>${scn.position.side === 'long' ? 'selling' : 'buying back'}</strong>.`);
    else notes.push(`The client wants to <strong>${scn.side === 'buy' ? 'buy' : 'sell (short)'}</strong>, not ${order.side}.`);
  }
  if (marks.side && !marks.type) {
    const t = order.type;
    const k = scn.goal.kind;
    if (k === 'now') notes.push(`Only a market order (or a limit at or through the ${buy ? 'ask' : 'bid'}) is meant to fill the moment it arrives. A ${TYPE_LABEL[t].toLowerCase()} order waits for ${t === 'limit' ? 'a better price' : 'the price to move'} first${res.full && res.doneT === 0 ? '; yours filled at once only because its price was already past the market' : ''}.`);
    else if (k === 'better') {
      if (t === 'market') notes.push(`A market order ${buy ? 'buys at the ask' : 'sells at the bid'} right now, ${P(buy ? scn.ref + scn.s0 : scn.ref)}: a worse price than the client's ${P(scn.level)}.`);
      else if (t === 'stop') notes.push(`A ${order.side} stop ${buy ? 'below' : 'above'} the market is already past its price, so it triggers at once and ${buy ? 'buys' : 'sells'} at market. Stops react to moves; to wait for a <em>better</em> price, use a limit.`);
      else notes.push('A stop-limit waits for the price to move <em>against</em> the order before switching on. To wait for a better price, a plain limit does the job.');
    } else if (k === 'trigger') {
      if (t === 'limit') notes.push(`A ${order.side} limit at ${P(scn.level)} is already ${buy ? 'above the ask' : 'below the bid'} (a marketable limit), so it filled at once, before the price got there. Limits wait for a better price; stops wait for a move.`);
      else if (t === 'market') notes.push(`A market order acts now, before the price reaches ${P(scn.level)}.`);
      else if (t === 'stop-limit') notes.push(scn.kind === 'stoplimit-trap' || scn.variant === 'gap'
        ? `A stop-limit refuses prices beyond its limit (${P(order.limit)}). In the gap it triggered but did not fill, and the client is still in the trade. For an exit “at any price”, use a plain stop.`
        : 'A stop-limit can refuse to fill when the price jumps past its limit. The client wanted certainty of the fill, which only a plain stop gives.');
    } else if (k === 'capped') {
      if (t === 'stop') notes.push(`A plain stop has no price cap: ${res.filled ? `it filled at ${avgText(res)}` : 'it fills at whatever the next price is'}, ${res.filled && (buy ? res.avg > scn.cap : res.avg < scn.cap) ? `beyond the client's ${P(scn.cap)} limit` : `and in a gap it would go beyond the ${P(scn.cap)} limit`}. Stop + limit in one order is a stop-limit.`);
      else if (t === 'limit') notes.push(`A ${order.side} limit at ${P(scn.level)} is already through the market, so it filled at once, before any ${buy ? 'breakout' : 'break'}.`);
      else notes.push(`A market order acts now and has no price cap.`);
    }
  }
  if (marks.side && marks.type && !marks.price && scn.tol) {
    const want = scn.tol[0] === scn.tol[1] ? P(scn.tol[0]) : `${P(scn.tol[0])}–${P(scn.tol[1])}`;
    notes.push(`Right order type, but the price was off: the client's level is ${P(scn.level)}, so the order belongs at ${want}. Yours was at ${P(order.price)}.`);
  }
  if (marks.side && marks.type && !marks.price && !scn.tol && order.type === 'limit') {
    notes.push(`Your limit at ${P(order.price)} was not ${buy ? 'high' : 'low'} enough to take all ${fmtSize(scn.size)} shares from the book at once.`);
  }
  if (!g.met && !notes.length) notes.push(`The client's goal was not met: ${outcomeText(res)}`);
  return notes;
}

// ------------------------------------------------------------------ intro preview (static art)

function previewArt(el) {
  const rows = 9;
  const W = 340;
  const rh = 20;
  const Hh = rows * rh + 8;
  const s = svg('svg', { class: 'od-preview', viewBox: `0 0 ${W} ${Hh}`, role: 'img', 'aria-label': 'A price ladder: sellers’ asks above, buyers’ bids below, and a buy limit order waiting under the market' });
  const px = [50.2, 50.15, 50.1, 50.05, 50.0, 49.95, 49.9, 49.85, 49.8];
  const sizes = [1200, 900, 700, 300, 400, 800, 600, 1100, 1300];
  const mid = 4; // rows 0..3 asks, 4.. bids (49.95 is the best bid after a 1-row spread at 50.00)
  px.forEach((p, i) => {
    const y = 4 + i * rh;
    if (i % 2) s.append(svg('rect', { class: 'odl-row--alt', x: 0, y, width: W, height: rh }));
    if (i === mid) {
      s.append(svg('rect', { class: 'odl-spread', x: 0, y, width: W, height: rh }));
      s.append(svg('text', { class: 'odl-spread-text', x: W / 2 + 44, y: y + 14 }, 'spread'));
    } else if (i < mid) {
      const w = (sizes[i] / 1300) * 110;
      s.append(svg('rect', { class: 'odl-bar--ask', x: 200, y: y + 2, width: w, height: rh - 4, rx: 2 }));
      s.append(svg('text', { class: 'odl-size', x: 206, y: y + 14 }, sizes[i].toLocaleString('en-US')));
    } else {
      const w = (sizes[i] / 1300) * 110;
      s.append(svg('rect', { class: 'odl-bar--bid', x: 140 - w, y: y + 2, width: w, height: rh - 4, rx: 2 }));
      s.append(svg('text', { class: 'odl-size', x: 134, y: y + 14, 'text-anchor': 'end' }, sizes[i].toLocaleString('en-US')));
    }
    const cls = i === mid - 1 ? 'odl-px odl-px--ask' : i === mid + 1 ? 'odl-px odl-px--bid' : 'odl-px';
    s.append(svg('text', { class: cls, x: 170, y: y + 14, 'text-anchor': 'middle' }, p.toFixed(2)));
  });
  const oy = 4 + 7 * rh;
  const g = svg('g', null,
    svg('rect', { class: 'odl-order', x: 1, y: oy + 1, width: W - 2, height: rh - 2, rx: 4 }),
    svg('rect', { class: 'odl-tag', x: 6, y: oy + 3, width: 58, height: rh - 6, rx: 3 }),
    svg('text', { class: 'odl-tag-text', x: 35, y: oy + 13.5, 'text-anchor': 'middle' }, 'BUY LMT'));
  s.append(g);
  el.append(s);
}

// ------------------------------------------------------------------ desk report (results)

function deskReport(log) {
  const rows = ['market', 'limit', 'stop', 'stop-limit'].map((t) => {
    const all = log.filter((r) => r && r.type === t);
    return { t, n: all.length, ok: all.filter((r) => r.ok).length, typeOk: all.filter((r) => r.typeOk).length };
  }).filter((r) => r.n);
  if (!rows.length) return null;
  const weakest = rows.filter((r) => r.ok < r.n).sort((a, b) => a.ok / a.n - b.ok / b.n)[0];
  const TIP = {
    market: 'Market orders: speed first, price second. They fill at once at the best price on offer and can walk the book.',
    limit: 'Limit orders wait for a better price: buy below the market, sell above it. They may never fill.',
    stop: 'Stops wait for a move against the order: buy above the market, sell below it. Triggered, they fill at the next price.',
    'stop-limit': 'Stop-limits switch on like a stop but refuse prices beyond their limit, so a gap can leave them unfilled.',
  };
  return h('div', { class: 'od-deskrep' },
    h('h3', { class: 'results__h' }, 'Desk report'),
    h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Right order'), h('th', null, 'Tickets'), h('th', null, 'Type right'), h('th', null, 'Client happy'))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', null, TYPE_LABEL[r.t]),
        h('td', { class: 'num' }, String(r.n)),
        h('td', { class: 'num' }, `${r.typeOk}/${r.n}`),
        h('td', { class: 'num' }, `${r.ok}/${r.n}`))))),
    weakest
      ? h('p', { class: 'faint' }, `Work on: ${TIP[weakest.t]} `, h('a', { href: '#l.markets-orders' }, 'Review the lesson'), '.')
      : h('p', { class: 'faint' }, 'Every client left happy. Try Survival: the markets get faster and the tickets trickier.'));
}

// ------------------------------------------------------------------ a round

function playRound(g, stage, scn, rng, hooks) {
  const reduce = reducedMotion();
  const lo = scn.band[0];
  const hi = scn.band[1];
  const d = scn.difficulty;
  const types = scn.stopLimit ? ['market', 'limit', 'stop', 'stop-limit'] : ['market', 'limit', 'stop'];
  const bid0 = scn.ref;
  const ask0 = scn.ref + scn.s0;
  const showClient = d < 0.35 && scn.level != null;
  const phone = window.innerWidth < 720;
  const H = phone ? 300 : window.innerWidth < 1000 ? 340 : 372;
  const liveRng = rng.fork('live');
  const timers = new Set();
  let alive = true;
  let phase = 'setup'; // setup → playing → done
  let book = jitterBook(scn.book, liveRng, 0.12);
  let draft = { side: scn.sideLocked ? scn.side : null, type: null, price: scn.ref, size: scn.size };
  let view = { t: 0, bid: bid0, ask: ask0, last: scn.ref, book, eaten: null, fills: [], flash: null };
  let skip = null;

  // ---- ticket
  const chips = [];
  const pos = sideOfPosition(scn);
  chips.push(h('span', { class: 'chip chip--sm chip--outline' }, pos || 'No position'));
  chips.push(h('span', { class: 'chip chip--sm chip--outline' }, `Size ${fmtSize(scn.size)}`));
  if (showClient) chips.push(h('span', { class: 'chip chip--sm chip--accent' }, `Client level ${P(scn.level)}`));
  if (scn.cap != null) chips.push(h('span', { class: 'chip chip--sm chip--accent' }, `Cap ${P(scn.cap)}`));
  const ticket = h('section', { class: 'od-ticket is-in', 'aria-label': 'Client request' },
    h('span', { class: 'od-avatar', 'aria-hidden': 'true' }, scn.client.name[0]),
    h('div', { class: 'od-who' }, h('strong', null, scn.client.name), h('span', null, scn.client.role), h('span', null, '· on the line')),
    h('p', { class: 'od-quote', html: `“${requestHtml(scn)}”` }),
    h('div', { class: 'od-chips' }, chips));

  // ---- market panel
  const qBid = h('span', { class: 'q-bid' });
  const qAsk = h('span', { class: 'q-ask' });
  const qSpread = h('span');
  const qLast = h('span');
  const chartHost = h('div', { class: 'od-chart' });
  const ladderHost = h('div', {
    class: 'od-ladder', tabindex: '0', role: 'slider', 'aria-label': 'Order price ladder: drag, tap a row, or use the up and down arrow keys',
    'aria-valuemin': P(lo), 'aria-valuemax': P(hi), 'aria-orientation': 'vertical',
  });
  const ladderSvg = svg('svg', { height: H, 'aria-hidden': 'true' });
  ladderHost.append(ladderSvg);
  const status = h('p', { class: 'od-status', 'aria-live': 'polite' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'od-status__text' }, 'Waiting for your order.'));
  const statusText = status.querySelector('.od-status__text');
  const market = h('section', { class: 'od-market', 'aria-label': 'Market' },
    h('div', { class: 'od-mhead' },
      h('span', null, 'Practice stock · 1-minute candles'),
      h('span', { class: 'od-quotes' }, qBid, qAsk, qSpread, qLast)),
    h('div', { class: 'od-frame' }, chartHost, ladderHost),
    status);

  // ---- order entry
  const sideBtns = ['buy', 'sell'].map((s) => h('button', {
    type: 'button', class: `is-${s}`, 'aria-pressed': 'false', 'data-side': s,
    on: { click: () => setSide(s) },
  }, SIDE_WORD[s], h('span', { class: 'key', 'aria-hidden': 'true' }, s === 'buy' ? 'B' : 'S')));
  const typeBtns = types.map((t) => h('button', {
    type: 'button', 'aria-pressed': 'false', 'data-type': t,
    on: { click: () => setType(t) },
  }, h('span', { class: 'key', 'aria-hidden': 'true' }, TYPE_KEYS[t]), TYPE_LABEL[t]));
  const priceOut = h('output', { class: 'od-mono', 'aria-live': 'polite' });
  const minus = h('button', { type: 'button', 'aria-label': 'Lower the price one tick', 'data-step': '-1', on: { click: () => nudge(-1) } }, icon('minus', { size: 18 }));
  const plus = h('button', { type: 'button', 'aria-label': 'Raise the price one tick', 'data-step': '1', on: { click: () => nudge(1) } }, icon('plus', { size: 18 }));
  const desc = h('p', { class: 'od-desc', 'aria-live': 'polite' });
  const sendBtn = h('button', { type: 'button', class: 'btn btn--primary btn--lg od-send', 'data-action': 'send', on: { click: () => (phase === 'playing' ? skip?.() : send()) } });
  const entry = h('section', { class: 'od-entry', 'aria-label': 'Order ticket' },
    h('div', { class: 'od-field' },
      h('span', { class: 'od-label' }, 'Side', scn.sideLocked ? h('span', { class: 'faint' }, 'set by the client') : null),
      h('div', { class: 'od-seg', role: 'group', 'aria-label': 'Side' }, sideBtns)),
    h('div', { class: 'od-field' },
      h('span', { class: 'od-label' }, 'Order type'),
      h('div', { class: `od-seg od-seg--types${types.length === 3 ? ' od-seg--3' : ''}`, role: 'group', 'aria-label': 'Order type' }, typeBtns)),
    h('div', { class: 'od-field' },
      h('span', { class: 'od-label' }, 'Price', h('span', { class: 'faint' }, phone ? 'drag the ladder' : 'drag the ladder or ↑ ↓')),
      h('div', { class: 'od-price' }, minus, priceOut, plus)),
    h('div', { class: 'od-field od-wide' }, desc, sendBtn),
    h('div', { class: 'od-keys od-wide' },
      kbdHint(types.map((t) => TYPE_KEYS[t]), 'type'),
      scn.sideLocked ? null : kbdHint(['B', 'S'], 'side'),
      kbdHint(['↑', '↓'], 'price (Shift ×5)'),
      kbdHint('Enter', 'send')));

  stage.append(h('div', { class: 'od' }, ticket, h('div', { class: 'od-desk' }, market, entry)));
  sfx.whoosh();

  // ---- chart
  const slots = HIST + FUT + 1;
  const chart = new CandleChart(chartHost, {
    candles: scn.histCandles,
    slots,
    height: H,
    autoscale: [(lo - 0.5) * TICK, (hi + 0.5) * TICK],
    showAxis: false,
    legend: false,
    crosshair: false,
    interactive: false,
    showLast: false,
    decimals: 2,
    ariaLabel: `Price chart: the last ${HIST} one-minute candles. The next ${FUT} minutes play out after you send the order.`,
  });
  const ids = {};
  if (showClient) ids.client = chart.addHLine({ price: priceOf(scn.level), color: 'info', dashed: true, width: 1, label: 'Client', priceTag: false });
  if (scn.cap != null) ids.cap = chart.addHLine({ price: priceOf(scn.cap), color: 'muted', dashed: true, width: 1, label: 'Cap', priceTag: false });

  // ---- ladder geometry (rows sit exactly on the chart's price scale)
  let W = 224;
  let yTop = 0;
  let rowH = 16;
  const measure = () => {
    const y0 = chart.priceToY(priceOf(hi));
    const y1 = chart.priceToY(priceOf(lo));
    rowH = (y1 - y0) / Math.max(1, hi - lo);
    yTop = y0;
    W = Math.max(120, Math.round(ladderHost.clientWidth || W));
  };
  const yOf = (p) => yTop + (hi - p) * rowH;
  const levelAt = (y) => Math.max(lo, Math.min(hi, Math.round(hi - (y - yTop) / rowH)));
  const ladderW = () => (phone ? Math.min(158, Math.round(window.innerWidth * 0.4)) : window.innerWidth < 1000 ? 214 : 232);
  ladderHost.style.setProperty('--od-ladder-w', `${ladderW()}px`);
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => {
      if (!alive) return;
      ladderHost.style.setProperty('--od-ladder-w', `${ladderW()}px`);
      measure();
      renderLadder();
    });
    ro.observe(ladderHost);
  }

  function renderLadder() {
    if (!alive) return;
    measure();
    const pw = W < 170 ? 46 : 54;
    const cw = (W - pw) / 2;
    const cx = cw + pw / 2;
    const bk = view.book;
    const maxSize = Math.max(...bk.bids.slice(0, 12).map((l) => l.size), ...bk.asks.slice(0, 12).map((l) => l.size), 1);
    const sizeAt = (list, p) => list.find((l) => l.p === p);
    let s = '';
    const fs = W < 170 ? 10 : 11;
    for (let p = hi; p >= lo; p--) {
      const y = yOf(p) - rowH / 2;
      const idx = hi - p;
      if (idx % 2) s += `<rect class="odl-row--alt" x="0" y="${y.toFixed(1)}" width="${W}" height="${rowH.toFixed(1)}"/>`;
      if (p > view.bid && p < view.ask) {
        s += `<rect class="odl-spread" x="0" y="${y.toFixed(1)}" width="${W}" height="${rowH.toFixed(1)}"/>`;
        if (rowH >= 12 && W >= 170) s += `<text class="odl-spread-text" x="${(cx + pw / 2 + 6).toFixed(1)}" y="${(y + rowH / 2 + 3.5).toFixed(1)}">spread</text>`;
      }
      const cy = (y + rowH / 2 + fs * 0.36).toFixed(1);
      if (p <= view.bid) {
        const lv = sizeAt(bk.bids, p);
        let size = lv ? lv.size : 0;
        if (view.eaten && view.eaten.side === 'bids' && view.eaten.map.has(p)) size = view.eaten.map.get(p);
        if (size > 0) {
          const bw = Math.max(2, (size / maxSize) * (cw - 6));
          s += `<rect class="odl-bar--bid" x="${(cw - bw).toFixed(1)}" y="${(y + 1.5).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, rowH - 3).toFixed(1)}" rx="2"/>`;
          s += `<text class="odl-size${p === view.bid ? ' odl-size--best' : ''}" style="font-size:${fs}px" x="${(cw - 4).toFixed(1)}" y="${cy}" text-anchor="end">${fmtSize(size)}</text>`;
        }
      }
      if (p >= view.ask) {
        const lv = sizeAt(bk.asks, p);
        let size = lv ? lv.size : 0;
        if (view.eaten && view.eaten.side === 'asks' && view.eaten.map.has(p)) size = view.eaten.map.get(p);
        if (size > 0) {
          const bw = Math.max(2, (size / maxSize) * (cw - 6));
          s += `<rect class="odl-bar--ask" x="${(cw + pw).toFixed(1)}" y="${(y + 1.5).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, rowH - 3).toFixed(1)}" rx="2"/>`;
          s += `<text class="odl-size${p === view.ask ? ' odl-size--best' : ''}" style="font-size:${fs}px" x="${(cw + pw + 4).toFixed(1)}" y="${cy}">${fmtSize(size)}</text>`;
        }
      }
      if (view.flash && view.flash.has(p)) s += `<rect class="odl-eat" x="0" y="${y.toFixed(1)}" width="${W}" height="${rowH.toFixed(1)}"/>`;
      const pc = p === view.bid ? 'odl-px odl-px--bid' : p === view.ask ? 'odl-px odl-px--ask' : 'odl-px';
      s += `<text class="${pc}" style="font-size:${fs}px" x="${cx.toFixed(1)}" y="${cy}" text-anchor="middle">${P(p)}</text>`;
      if (p === view.last) s += `<path class="odl-last" d="M${(cx - pw / 2 + 2).toFixed(1)},${(yOf(p) - 3.5).toFixed(1)}l5,3.5l-5,3.5z"/>`;
      if (showClient && p === scn.level) s += `<rect class="odl-client" x="${(W - 4).toFixed(1)}" y="${(y + 2).toFixed(1)}" width="3" height="${Math.max(2, rowH - 4).toFixed(1)}" rx="1.5"/>`;
    }
    s += `<line class="odl-sep" x1="${cw}" y1="0" x2="${cw}" y2="${H}"/><line class="odl-sep" x1="${cw + pw}" y1="0" x2="${cw + pw}" y2="${H}"/>`;
    // the working order
    const o = phase === 'setup' ? draft : view.order;
    if (o && o.type && o.type !== 'market' && o.price != null && (phase !== 'done' || view.showOrder)) {
      const y = yOf(o.price) - rowH / 2;
      s += `<rect class="odl-order" x="1" y="${(y + 0.5).toFixed(1)}" width="${W - 2}" height="${(rowH - 1).toFixed(1)}" rx="3"/>`;
      if (o.type === 'stop-limit') {
        const lim = o.price + (o.side === 'sell' ? -SL_OFFSET : SL_OFFSET);
        if (lim >= lo && lim <= hi) {
          const yl = yOf(lim) - rowH / 2;
          s += `<rect class="odl-order odl-order--limit" x="1" y="${(yl + 0.5).toFixed(1)}" width="${W - 2}" height="${(rowH - 1).toFixed(1)}" rx="3"/>`;
        }
      }
      if (W >= 150 && rowH >= 11) {
        const tag = `${o.side ? (o.side === 'buy' ? 'BUY ' : 'SELL ') : ''}${o.type === 'limit' ? 'LMT' : o.type === 'stop' ? 'STP' : 'STP LMT'}`;
        const tw = Math.min(cw - 6, tag.length * 6.1 + 10);
        s += `<rect class="odl-tag" x="4" y="${(y + 2).toFixed(1)}" width="${tw.toFixed(1)}" height="${Math.max(8, rowH - 4).toFixed(1)}" rx="3"/>`;
        s += `<text class="odl-tag-text" x="${(4 + tw / 2).toFixed(1)}" y="${(y + rowH / 2 + 3.4).toFixed(1)}" text-anchor="middle">${tag}</text>`;
      }
      if (phase === 'setup') {
        const gx = W - 12;
        const gy = y + rowH / 2;
        s += `<path class="odl-grip" d="M${gx - 4},${(gy - 3).toFixed(1)}h8M${gx - 4},${gy.toFixed(1)}h8M${gx - 4},${(gy + 3).toFixed(1)}h8"/>`;
      }
    }
    for (const f of view.fills || []) {
      const y = yOf(f.p) - rowH / 2;
      s += `<rect class="odl-fill${f.side === 'sell' ? ' odl-fill--sell' : ''}" x="1.5" y="${(y + 1).toFixed(1)}" width="${W - 3}" height="${(rowH - 2).toFixed(1)}" rx="3"/>`;
    }
    ladderSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    ladderSvg.setAttribute('width', W);
    ladderSvg.innerHTML = s;
    ladderHost.setAttribute('aria-valuenow', draft.price != null ? P(draft.price) : '');
    ladderHost.setAttribute('aria-valuetext', draft.type === 'market' ? 'At market' : `Order price ${P(draft.price)}`);
  }

  function renderQuotes() {
    qBid.replaceChildren('Bid ', h('b', null, P(view.bid)));
    qAsk.replaceChildren('Ask ', h('b', null, P(view.ask)));
    qSpread.textContent = `Spread ${fmtTicks(view.ask - view.bid)}`;
    qLast.textContent = `Last ${P(view.last)}`;
  }

  // ---- order entry state
  const lineLabel = (o) => (o.type === 'stop-limit' ? `${SIDE_WORD[o.side] || ''} stop`.trim() : `${o.side ? SIDE_WORD[o.side] + ' ' : ''}${o.type}`);
  function syncChartOrder() {
    const show = draft.type && draft.type !== 'market';
    if (show) {
      const spec = { price: priceOf(draft.price), label: lineLabel(draft), color: 'accent', dashed: true, width: 1.5, priceTag: false, from: HIST - 1 };
      if (ids.order) chart.update(ids.order, spec);
      else ids.order = chart.addHLine(spec);
    } else if (ids.order) {
      chart.remove(ids.order);
      ids.order = null;
    }
    const wantLim = draft.type === 'stop-limit';
    if (wantLim) {
      const lim = draft.price + (draft.side === 'sell' ? -SL_OFFSET : SL_OFFSET);
      const spec = { price: priceOf(lim), label: 'limit', color: 'accent', dashed: true, width: 1, priceTag: false, from: HIST - 1 };
      if (ids.limit) chart.update(ids.limit, spec);
      else ids.limit = chart.addHLine(spec);
    } else if (ids.limit) {
      chart.remove(ids.limit);
      ids.limit = null;
    }
  }

  function renderEntry() {
    sideBtns.forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.side === draft.side));
      b.disabled = scn.sideLocked || phase !== 'setup';
    });
    typeBtns.forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.type === draft.type));
      b.disabled = phase !== 'setup';
    });
    const atMarket = draft.type === 'market';
    minus.disabled = plus.disabled = !draft.type || atMarket || phase !== 'setup';
    if (atMarket) {
      priceOut.className = 'od-mono is-market';
      priceOut.replaceChildren('At market', h('small', null, draft.side ? `≈ ${draft.side === 'buy' ? 'ask' : 'bid'} ${P(draft.side === 'buy' ? ask0 : bid0)}` : 'fills at the best price'));
    } else if (draft.type === 'stop-limit') {
      priceOut.className = 'od-mono';
      const lim = draft.price + (draft.side === 'sell' ? -SL_OFFSET : SL_OFFSET);
      priceOut.replaceChildren(P(draft.price), h('small', null, draft.side ? `stop · limit ${P(lim)}` : `stop · limit ${fmtTicks(SL_OFFSET)} beyond`));
    } else {
      priceOut.className = 'od-mono';
      priceOut.replaceChildren(P(draft.price), h('small', null, draft.type === 'stop' ? 'stop price' : draft.type === 'limit' ? 'limit price' : 'order price'));
    }
    const ready = !!(draft.side && draft.type);
    if (phase === 'setup') {
      sendBtn.disabled = !ready;
      sendBtn.replaceChildren(icon('arrow-right'), h('span', null, ready ? `Send: ${shortLabel(draft)}` : draft.side ? 'Pick an order type' : 'Pick a side'));
    }
    if (d < 0.6) {
      const dd = describeOrder(draft, { last: scn.ref, bid: bid0, ask: ask0 });
      desc.textContent = dd.text;
      desc.classList.toggle('is-hot', !!(dd.immediate && draft.type !== 'market'));
    } else {
      desc.textContent = draft.side && draft.type ? orderLabel({ ...draft, limit: draft.price + (draft.side === 'sell' ? -SL_OFFSET : SL_OFFSET) }) : 'Hard mode: no order preview. Read the ticket carefully.';
      desc.classList.remove('is-hot');
    }
    ladderHost.classList.toggle('is-off', atMarket || phase !== 'setup');
    syncChartOrder();
    renderLadder();
  }

  function setSide(s) {
    if (phase !== 'setup' || scn.sideLocked) return;
    draft.side = s;
    sfx.click();
    renderEntry();
  }
  function setType(t) {
    if (phase !== 'setup' || !types.includes(t)) return;
    draft.type = t;
    sfx.click();
    renderEntry();
  }
  function setPrice(p, { sound = true } = {}) {
    if (phase !== 'setup' || draft.type === 'market') return;
    const np = Math.max(lo, Math.min(hi, p));
    if (np === draft.price) return;
    draft.price = np;
    if (sound) sfx.tick();
    renderEntry();
  }
  function nudge(dp) {
    if (!draft.type) return;
    setPrice(draft.price + dp);
  }

  // ---- ladder dragging
  let dragId = null;
  const yFromEvent = (e) => {
    const r = ladderSvg.getBoundingClientRect();
    return ((e.clientY - r.top) / Math.max(1, r.height)) * H;
  };
  const onDown = (e) => {
    if (phase !== 'setup' || draft.type === 'market') return;
    if (!draft.type) {
      statusText.textContent = 'Pick an order type first, then set its price here.';
      return;
    }
    e.preventDefault();
    dragId = e.pointerId;
    try {
      ladderHost.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
    setPrice(levelAt(yFromEvent(e)));
    ladderHost.focus({ preventScroll: true });
  };
  const onMove = (e) => {
    if (dragId !== e.pointerId) return;
    setPrice(levelAt(yFromEvent(e)));
  };
  const onUp = (e) => {
    if (dragId !== e.pointerId) return;
    dragId = null;
    try {
      ladderHost.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };
  ladderHost.addEventListener('pointerdown', onDown);
  ladderHost.addEventListener('pointermove', onMove);
  ladderHost.addEventListener('pointerup', onUp);
  ladderHost.addEventListener('pointercancel', onUp);

  // ---- keyboard
  const onKey = (e) => {
    if (!alive || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.body.classList.contains('has-modal')) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!stage.isConnected) return;
    if (phase === 'playing') {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        skip?.();
      }
      return;
    }
    if (phase !== 'setup') return;
    const k = e.key;
    const typeFor = Object.entries(TYPE_KEYS).find(([, key]) => key === k);
    if (typeFor && types.includes(typeFor[0])) {
      e.preventDefault();
      setType(typeFor[0]);
    } else if (k === 'b' || k === 'B') {
      e.preventDefault();
      setSide('buy');
    } else if (k === 's' || k === 'S') {
      e.preventDefault();
      setSide('sell');
    } else if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'PageUp' || k === 'PageDown') {
      if (!draft.type || draft.type === 'market') return;
      e.preventDefault();
      const n = k.startsWith('Page') || e.shiftKey ? 5 : 1;
      setPrice(draft.price + (k === 'ArrowUp' || k === 'PageUp' ? n : -n));
    } else if (k === 'Enter') {
      const onBtn = t && t.closest && t.closest('button, a');
      if (onBtn && onBtn !== sendBtn) return; // the focused button handles Enter itself
      if (draft.side && draft.type) {
        e.preventDefault();
        send();
      }
    }
  };
  document.addEventListener('keydown', onKey);

  // ---- the book looks alive while the client waits
  const liveTimer = setInterval(() => {
    if (!alive || phase !== 'setup' || reduce) return;
    book = jitterBook(scn.book, liveRng, 0.16);
    view.book = book;
    renderLadder();
  }, 650);

  // ---- playout
  const later = (ms) => new Promise((res) => {
    if (!alive) return;
    if (ms <= 0) {
      res();
      return;
    }
    const id = setTimeout(() => {
      timers.delete(id);
      res();
    }, ms);
    timers.add(id);
  });

  function setStatus(text, kind = '') {
    statusText.textContent = text;
    status.className = `od-status${kind ? ` is-${kind}` : ''}`;
  }

  /**
   * Plays the market after the order: book walk at t = 0, then one trade per TICK_MS with the
   * forming candle, bid / ask on the ladder, triggers and fills marked on the chart.
   * → Promise (resolves when done; instant with reduced motion or after Skip).
   */
  async function playout(order, res, { demo = false } = {}) {
    let fast = reduce;
    skip = () => {
      fast = true;
    };
    view.order = order;
    view.showOrder = true;
    const m = scn.future;
    const buy = order.side === 'buy';
    const sideKey = buy ? 'asks' : 'bids';
    // 1) orders that fill on arrival walk the book
    const walk = res.fills.filter((f) => f.t === 0);
    if (walk.length) {
      setStatus(`${orderLabel(order)}: ${res.fills.length > 1 && walk.length > 1 ? 'taking the book level by level…' : 'filling now…'}`, 'working');
      view.eaten = { side: sideKey, map: new Map() };
      view.flash = new Set();
      for (const f of walk) {
        const lv = view.book[sideKey].find((l) => l.p === f.p);
        const start = lv ? lv.size : f.size;
        view.flash = new Set([f.p]);
        view.eaten.map.set(f.p, Math.max(0, start - f.size));
        view.fills = [...(view.fills || []), { p: f.p, side: order.side }];
        renderLadder();
        sfx.tick();
        if (!fast) await later(WALK_MS);
        if (!alive) return;
      }
      view.flash = null;
      const idx = HIST - 0.5;
      chart.addMarker({ idx, price: priceOf(res.avg), position: 'at', shape: 'dot', color: buy ? 'bull' : 'bear', text: `${demo ? 'Right order: ' : ''}filled ${avgText(res)}`, pulse: true });
      setStatus(`Filled ${fmtSize(walk.reduce((s, f) => s + f.size, 0))} @ ${avgText(res)}${walk.length > 1 ? ` across ${walk.length} levels` : ''}.`, 'filled');
      sfx.badge();
      if (!fast) await later(350);
    } else if (res.immediate) {
      setStatus(`Triggered at once (the price was already past ${P(order.price)}); now it waits to ${order.side} at ${P(order.limit)} or better.`, 'working');
    } else {
      setStatus(`Order working: ${orderLabel(order)}.`, 'working');
    }
    if (!alive) return;
    // 2) the market plays out
    const events = new Map();
    for (const ev of res.events) if (ev.t > 0) events.set(ev.t, [...(events.get(ev.t) || []), ev]);
    let histBook = view.book;
    for (let t = 1; t <= T_MAX; t++) {
      if (!alive) return;
      view.t = t;
      view.bid = m.bid[t];
      view.ask = m.ask[t];
      view.last = m.last[t];
      view.eaten = null;
      if (!fast || t === T_MAX) {
        histBook = jitterBook(makeBook({ bid: m.bid[t], ask: m.ask[t], salt: scn.ref }), liveRng, 0.2);
        view.book = histBook;
      }
      for (const ev of events.get(t) || []) {
        const idx = candleIndexOf(scn, t);
        if (ev.kind === 'trigger') {
          chart.addMarker({ idx, price: priceOf(order.price), position: 'at', shape: 'ring', color: 'accent', pulse: true });
          setStatus(`Triggered: a trade printed at ${P(m.last[t])}. ${order.type === 'stop' ? 'Now it is a market order…' : `Now it may only ${order.side} at ${P(order.limit)} or better…`}`, 'working');
          if (!fast) sfx.click();
        } else if (ev.kind === 'fill') {
          const slip = order.type === 'stop' ? Math.abs(ev.p - order.price) : 0;
          chart.addMarker({ idx, price: priceOf(ev.p), position: buy ? 'below' : 'above', shape: 'arrow', color: buy ? 'bull' : 'bear', text: `${demo ? 'Right order ' : ''}${buy ? 'bought' : 'sold'} ${P(ev.p)}`, pulse: true });
          if (slip >= 1) chart.addZone({ from: priceOf(Math.min(ev.p, order.price)), to: priceOf(Math.max(ev.p, order.price)), x1: idx - 1.5, x2: idx + 1.5, color: 'warn', opacity: 0.22, label: `slippage ${fmtTicks(slip)}` });
          view.fills = [...(view.fills || []), { p: ev.p, side: order.side }];
          setStatus(`Filled ${fmtSize(ev.size)} @ ${P(ev.p)} in minute ${minuteOf(t)}${slip >= 1 ? ` (slippage ${fmtTicks(slip)})` : ''}.`, 'filled');
          if (!fast) sfx.badge();
        } else if (ev.kind === 'rest' && !fast) {
          setStatus(`Triggered but not filled: the price is past the ${P(ev.p)} limit. The order waits there.`, 'miss');
        }
      }
      if (!fast || t === T_MAX) {
        chart.setCandles([...scn.histCandles, ...futureCandles(scn, t)]);
        renderQuotes();
        renderLadder();
      }
      if (!fast) await later(TICK_MS);
    }
    if (!alive) return;
    if (!res.filled) setStatus(res.triggered ? `Triggered, never filled: ${outcomeText(res)}` : outcomeText(res), 'miss');
    else if (!res.full) setStatus(outcomeText(res), 'miss');
    skip = null;
  }

  // ---- send and grade
  let result = null;
  async function send() {
    if (phase !== 'setup' || !draft.side || !draft.type) return;
    g.timer.stop();
    phase = 'playing';
    clearInterval(liveTimer);
    hooks.sent?.();
    const order = {
      side: draft.side, type: draft.type, size: scn.size,
      price: draft.type === 'market' ? null : draft.price,
      limit: draft.type === 'stop-limit' ? draft.price + (draft.side === 'sell' ? -SL_OFFSET : SL_OFFSET) : null,
    };
    const m = marketOf(scn, book);
    const res = simulate(order, m);
    const goal = evalGoal(scn.goal, res, m);
    const right = simulate({ side: scn.side, type: scn.type, size: scn.size, price: scn.type === 'market' ? null : scn.level, limit: scn.type === 'stop-limit' ? scn.cap : null }, m);
    result = { order, res, goal, right };
    renderEntry();
    sendBtn.disabled = false;
    sendBtn.replaceChildren(icon('step'), h('span', null, 'Skip to the end'), kbdHint('Space'));
    if (window.innerWidth < 1000) market.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    await playout(order, res);
    if (!alive) return;
    grade();
  }

  function grade() {
    phase = 'done';
    const { order, res, goal, right } = result;
    const sideOk = order.side === scn.side;
    let typeOk = sideOk && order.type === scn.type;
    // "Right now": a marketable limit (at or through the ask / bid) is a fine alternative to a market order.
    if (!typeOk && sideOk && scn.goal.kind === 'now' && order.type === 'limit' && res.marketable) typeOk = true;
    let priceOk = false;
    if (typeOk) {
      if (scn.tol) priceOk = order.price >= scn.tol[0] && order.price <= scn.tol[1];
      else priceOk = order.type === 'market' || (res.full && res.doneT === 0);
    }
    const marks = { side: sideOk, type: typeOk, price: priceOk, goal: goal.met };
    const all = typeOk && priceOk && goal.met;
    const pts = (typeOk ? 50 : 0) + (priceOk ? 25 : 0) + (goal.met ? 25 : 0);
    hooks.graded?.({ typeOk, ok: all });

    // chart: the order line tells the outcome
    if (ids.order) chart.update(ids.order, { label: res.filled ? (res.full ? 'filled' : 'part filled') : 'not filled', color: res.filled ? 'accent' : 'muted' });
    if (!all && scn.type !== 'market') {
      chart.addHLine({ price: priceOf(scn.level), color: 'info', dashed: true, width: 1.25, label: `right: ${shortLabel({ side: scn.side, type: scn.type, price: scn.level })}`, priceTag: false, from: HIST - 1 });
    }
    if (!all && right.filled && (order.type !== scn.type || order.side !== scn.side)) {
      const f = right.fills[0];
      const idx = f.t > 0 ? candleIndexOf(scn, f.t) : HIST - 0.5;
      chart.addMarker({ idx, price: priceOf(f.t > 0 ? f.p : right.avg), position: 'at', shape: 'ring', color: 'info', pulse: true });
    }
    sendBtn.disabled = true;
    sendBtn.replaceChildren(icon(all ? 'check' : 'x'), h('span', null, all ? 'Client happy' : 'Client not happy'));

    const headline = all
      ? `Client happy. ${res.full ? `Filled @ ${avgText(res)}.` : 'No fill, exactly as the client wanted.'}`
      : !typeOk ? 'Wrong order for this client.' : !priceOk ? 'Right order, wrong price.' : 'The client’s goal was not met.';
    const why = lessonText(scn, right);
    const notes = all ? [] : mistakeNotes(scn, order, res, goal, marks);
    const check = (ok, label, detail, p) => h('li', { class: ok ? 'is-ok' : 'is-no' },
      h('span', { class: 'mk', 'aria-hidden': 'true' }, icon(ok ? 'check' : 'x', { size: 14 })),
      h('span', null, h('strong', null, label), ' ', detail),
      h('span', { class: 'pts' }, ok ? `+${p}` : '0'));
    const report = h('div', { class: 'od-report' },
      h('div', { class: 'od-tickets' },
        h('div', null, h('span', null, 'Client'), h('span', null, goalText(scn))),
        h('div', null, h('span', null, 'Your order'), h('span', null, h('span', { class: 'od-mono' }, orderLabel(order)), ' → ', outcomeText(res))),
        all ? null : h('div', null, h('span', null, 'Right order'), h('span', null, h('span', { class: 'od-mono' }, orderLabel(right.order)), ' → ', outcomeText(right)))),
      h('ul', { class: 'od-checks', 'aria-label': 'Score' },
        check(typeOk, 'Order type.', typeOk ? `${TYPE_LABEL[order.type]} ${order.side} is right for this request.` : `Needed a ${TYPE_LABEL[scn.type].toLowerCase()} ${scn.side === 'buy' ? 'buy' : 'sell'}.`, 50),
        check(priceOk, 'Price.', priceOk ? (order.type === 'market' ? 'Market orders need no price.' : `${P(order.price)} matches the client's level.`) : typeOk ? 'Not where the client asked.' : 'Only scored with the right order type.', 25),
        check(goal.met, 'Client goal.', goal.met ? 'Met.' : 'Not met.', 25)),
      notes.length ? h('ul', { class: 'od-checks od-notes' }, notes.map((n) => h('li', { class: 'is-no' }, h('span', { class: 'mk', 'aria-hidden': 'true' }, icon('info', { size: 14 })), h('span', { html: n }), h('span')))) : null,
      h('p', { class: 'od-why', html: `<strong>What the market did:</strong> ${why}` }));
    if (all) g.correct(headline, { points: 100 });
    else {
      g.wrong(headline);
      if (pts > 0) g.award(pts, { reason: 'partial' });
    }
    g.feedback(report, all ? 'good' : 'bad');
    g.nextButton();
  }

  // ---- time out: the client hangs up; show what the right order would have done
  async function timeout() {
    if (phase !== 'setup') return;
    phase = 'playing';
    clearInterval(liveTimer);
    const m = marketOf(scn, book);
    const order = { side: scn.side, type: scn.type, size: scn.size, price: scn.type === 'market' ? null : scn.level, limit: scn.type === 'stop-limit' ? scn.cap : null };
    const right = simulate(order, m);
    draft = { ...order };
    renderEntry();
    hooks.graded?.({ typeOk: false, ok: false });
    g.wrong('Time’s up! The client hung up.');
    g.feedback(h('div', { class: 'od-report' },
      h('div', { class: 'od-tickets' },
        h('div', null, h('span', null, 'Client'), h('span', null, goalText(scn))),
        h('div', null, h('span', null, 'Right order'), h('span', null, h('span', { class: 'od-mono' }, orderLabel(right.order)), ' → ', outcomeText(right)))),
      h('p', { class: 'od-why', html: `<strong>What the market did:</strong> ${lessonText(scn, right)}` })), 'bad');
    sendBtn.disabled = true;
    sendBtn.replaceChildren(icon('clock'), h('span', null, 'Watching the right order'));
    g.nextButton();
    await playout(order, right, { demo: true });
    phase = 'done';
  }

  renderQuotes();
  renderEntry();
  g.setHint(hintFor(scn));

  return {
    timeout,
    cleanup() {
      alive = false;
      clearInterval(liveTimer);
      for (const id of timers) clearTimeout(id);
      timers.clear();
      document.removeEventListener('keydown', onKey);
      ladderHost.removeEventListener('pointerdown', onDown);
      ladderHost.removeEventListener('pointermove', onMove);
      ladderHost.removeEventListener('pointerup', onUp);
      ladderHost.removeEventListener('pointercancel', onUp);
      ro?.disconnect();
      try {
        chart.destroy();
      } catch (err) {
        console.error(err);
      }
    },
  };
}

// ------------------------------------------------------------------ module

export default {
  id: 'order-desk',
  mount(root, ctx) {
    root.classList.add('order-desk');
    const style = h('style', { 'data-module': 'order-desk' }, CSS);
    document.head.append(style);
    let recent = [];
    let roundKind = null;
    let log = [];
    let current = null;

    const game = new GameShell(root, ctx, {
      rounds: ROUNDS,
      maxScore: ROUNDS * 100,
      timer: { seconds: 40, perRound: true },
      howTo: [
        'A client calls with an order. Read what they want and where the market is: the bid, the ask and the last trade.',
        'Pick the side and the order type (1–4), then drag the price ladder, tap a row or use ↑ ↓ to set the price.',
        'Send it and watch the market play out: does it fill, where, and is the client happy?',
        'Score: the right order type, a sensible price and the client’s goal met. Harder tickets bring shorts, fast markets, gaps and stop-limit traps.',
      ],
      preview: (el) => previewArt(el),
      onStart() {
        recent = [];
        log = [];
        roundKind = null;
      },
      onRound(g, { round, rng, stage, difficulty, retry }) {
        if (!retry || !roundKind) {
          roundKind = pickKind(rng.fork('kind'), difficulty, recent);
          recent.push({ kind: roundKind, type: KINDS[roundKind].type });
          if (recent.length > 8) recent.shift();
        }
        const scn = buildScenario(rng.fork('scenario'), { kind: roundKind, difficulty });
        if (!scn) throw new Error(`order-desk: no scenario for ${roundKind}`);
        const ctl = playRound(g, stage, scn, rng, {
          graded: ({ typeOk, ok }) => {
            log[round - 1] = { type: scn.type, typeOk, ok };
          },
        });
        current = ctl;
        return () => {
          if (current === ctl) current = null;
          ctl.cleanup();
        };
      },
      onTimeout() {
        current?.timeout();
      },
      onEnd() {
        return deskReport(log.filter(Boolean));
      },
    });
    return () => {
      game.destroy();
      style.remove();
      root.classList.remove('order-desk');
    };
  },
};

