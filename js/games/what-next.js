// What Happens Next? (tier: both) — the chart freezes at a decision point; the player calls it,
// then the next 15–25 candles are revealed with the setup drawn in and explained.
//
// Beginner: Up / Down / Sideways (keys ↑ ↓ →/←, or U D S, or 1 2 3). Advanced: Long / Short /
// Wait (↑ ↓ →/←, L S W) plus a conviction of 1–3 (keys 1 2 3) that multiplies the points:
// right +100 × conviction, wrong −60 × conviction; Wait earns +60 when there is no edge and +10
// otherwise. About one well-read Advanced setup in eight fails, with an honest note.
//
// Textbook rounds come from ./what-next-scenarios.js (seeded, validated generators). Real-market
// rounds come from scanner.realRound(); they grade the READ (the textbook call for the setup the
// scanner found) separately from the OUTCOME (what the market did next), and show how often that
// setup followed through in the real data loaded this session.
import { GameShell } from '../core/game-kit.js';
import { h, svg, icon, sfx, kbdHint, reducedMotion, fmt } from '../core/ui.js';
import { CandleChart, miniChart } from '../core/chart.js';
import { ema, sma, rsi as rsiOf, closes as closesOf, atr as atrOf } from '../core/indicators.js';
import { addOverlay, annotateSetup } from '../core/lesson-kit.js';
import { CANDLE_PATTERNS } from '../core/patterns.js';
import { SETUP_KINDS, findSetups, outcomeOf } from '../core/scanner.js';
import { getHistory } from '../core/market.js';
import { makeRng } from '../core/rng.js';
import { ANSWERS, SCENARIO_TYPES, buildScenario, planAnswers, answerBag, pickType, answerDir, answerFor } from './what-next-scenarios.js';

const ID = 'what-next';
const ROUNDS = 10;
const CONV_LABEL = ['Low', 'Medium', 'High'];
const MINUS = '−';

// ------------------------------------------------------------------------------------------
// Real-market setup kinds per answer (every scanner kind with a directional or range read;
// doji and spinning tops are pure indecision, so they have no read to grade).
// ------------------------------------------------------------------------------------------

const CANDLE_BULL = ['hammer', 'inverted-hammer', 'bullish-engulfing', 'piercing-line', 'morning-star', 'tweezer-bottom', 'dragonfly-doji', 'bullish-harami', 'bullish-marubozu', 'three-white-soldiers'];
const CANDLE_BEAR = ['hanging-man', 'shooting-star', 'bearish-engulfing', 'dark-cloud-cover', 'evening-star', 'tweezer-top', 'gravestone-doji', 'bearish-harami', 'bearish-marubozu', 'three-black-crows'];
const BEGIN_UP = [...CANDLE_BULL, 'trend-up', 'support-bounce', 'breakout-up', 'fakeout-down', 'golden-cross'];
const BEGIN_DOWN = [...CANDLE_BEAR, 'trend-down', 'resistance-reject', 'breakout-down', 'fakeout-up', 'death-cross'];
const REAL_KINDS = {
  up: BEGIN_UP,
  down: BEGIN_DOWN,
  sideways: ['range'],
  long: [...BEGIN_UP, 'bullish-divergence', 'fib-pullback', 'double-bottom', 'inverse-head-and-shoulders', 'bull-flag'],
  short: [...BEGIN_DOWN, 'bearish-divergence', 'fib-pullback', 'double-top', 'head-and-shoulders', 'bear-flag'],
  wait: ['range'],
};
const LEVEL_KINDS = new Set(['support-bounce', 'resistance-reject', 'breakout-up', 'breakout-down', 'fakeout-up', 'fakeout-down']);
const GROUP_LABEL = { candle: 'Candlestick patterns', trend: 'Trends', level: 'Support & resistance', ma: 'Moving averages', momentum: 'Indicators & divergence', fib: 'Fibonacci & confluence', chart: 'Chart patterns' };

// ------------------------------------------------------------------------------------------
// Styles (scoped under .what-next; tokens only)
// ------------------------------------------------------------------------------------------

const CSS = `
.what-next { --wn-gap: 12px; }
.wn-round { display: grid; gap: var(--wn-gap); }
.wn-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; }
.wn-prompt { margin: 0; font-family: var(--font-display); font-size: 22px; font-weight: 750; line-height: 1.2; text-wrap: balance; }
.wn-sub { margin: 2px 0 0; color: var(--text-2); font-size: 14px; }
.wn-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.wn-chips .chip { white-space: nowrap; }
.wn-board { display: grid; gap: 10px; align-items: start; }
.wn-board.has-htf { grid-template-columns: minmax(0, 1fr); }
@media (min-width: 900px) {
  .wn-board.has-htf { grid-template-columns: minmax(0, 1fr) 232px; }
  .wn-board.has-htf .wn-htf { order: 2; }
}
.wn-chart { position: relative; min-height: 120px; }
.wn-chart .tc-svg { display: block; }
.wn-htf { display: grid; gap: 6px; padding: 10px 12px 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.wn-htf__title { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-3); }
.wn-htf__art svg { display: block; width: 100%; height: auto; }
.wn-htf__note { margin: 0; font-size: 12.5px; color: var(--text-2); line-height: 1.4; }
@media (max-width: 899.98px) {
  .wn-htf { grid-template-columns: 150px minmax(0, 1fr); align-items: center; column-gap: 12px; }
  .wn-htf__title { grid-column: 1 / -1; }
}
@media (max-width: 419.98px) {
  .wn-htf { grid-template-columns: 124px minmax(0, 1fr); }
}
.wn-controls { display: grid; gap: 10px; }
.wn-answers { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.wn-choice { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 72px; padding: 10px 8px; border: 1.5px solid var(--line); border-radius: 10px; background: var(--surface-2); color: var(--text); font: inherit; font-weight: 700; font-size: 16.5px; line-height: 1.2; cursor: pointer; touch-action: manipulation; transition: border-color .15s, background-color .15s, transform .1s, opacity .2s; }
.wn-choice__icon { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--surface); color: var(--text-2); transition: background-color .15s, color .15s; }
.wn-choice--up .wn-choice__icon, .wn-choice--long .wn-choice__icon { color: var(--bull-strong); }
.wn-choice--down .wn-choice__icon, .wn-choice--short .wn-choice__icon { color: var(--bear-strong); }
.wn-choice--sideways .wn-choice__icon, .wn-choice--wait .wn-choice__icon { color: var(--info); }
.wn-choice .kbd-hint { font-size: 11px; }
.wn-choice:hover:not([aria-disabled="true"]) { border-color: color-mix(in oklab, var(--accent) 65%, transparent); background: color-mix(in oklab, var(--surface-2), var(--accent-soft) 45%); }
.wn-choice--up:hover:not([aria-disabled="true"]), .wn-choice--long:hover:not([aria-disabled="true"]) { border-color: var(--bull); }
.wn-choice--down:hover:not([aria-disabled="true"]), .wn-choice--short:hover:not([aria-disabled="true"]) { border-color: var(--bear); }
.wn-choice:active:not([aria-disabled="true"]) { transform: scale(0.98); }
.wn-choice[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 1px var(--accent) inset; }
.wn-choice[aria-disabled="true"] { cursor: default; }
.wn-choice.is-dim { opacity: 0.45; }
.wn-choice.is-right { border-color: var(--bull); background: var(--bull-soft); }
.wn-choice.is-right .wn-choice__icon { background: var(--bull); color: var(--bull-ink); }
.wn-choice.is-wrong { border-color: var(--bear); background: var(--bear-soft); animation: wn-shake .42s ease-in-out; }
.wn-choice.is-wrong .wn-choice__icon { background: var(--bear); color: var(--bear-ink); }
.wn-choice.is-read:not(.is-right) { border-style: dashed; border-color: var(--bull); }
.wn-choice__tag { position: absolute; top: 6px; right: 8px; font-size: 11px; font-weight: 700; color: var(--text-3); }
.wn-conv { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); transition: border-color .2s, box-shadow .2s; }
.wn-conv.is-asking { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 22%, transparent); }
.wn-conv__label { font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); }
.wn-conv__opts { display: flex; flex: 1 1 auto; gap: 8px; min-width: 0; }
.wn-conv__btn { display: inline-flex; flex: 1 1 0; align-items: center; justify-content: center; gap: 7px; min-height: 44px; min-width: 0; padding: 6px 10px; border: 1.5px solid var(--line); border-radius: 8px; background: var(--surface-2); color: var(--text); font: inherit; font-weight: 650; font-size: 14.5px; cursor: pointer; touch-action: manipulation; }
.wn-conv__btn:hover:not([aria-disabled="true"]) { border-color: var(--accent); }
.wn-conv__btn[aria-checked="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
.wn-conv__btn[aria-disabled="true"] { cursor: default; opacity: .55; }
.wn-conv__btn[aria-checked="true"][aria-disabled="true"] { opacity: 1; }
.wn-conv__btn .kbd { min-width: 20px; height: 20px; }
.wn-bars rect { fill: var(--line); }
.wn-bars rect.is-on { fill: var(--accent); }
.wn-payoff { margin: 0; font-size: 13px; color: var(--text-3); line-height: 1.45; }
.wn-payoff strong { color: var(--text-2); }
.wn-status { margin: 0; min-height: 1.4em; font-size: 14px; font-weight: 600; color: var(--text-2); }
.wn-skip { justify-self: start; }
@media (hover: none) and (pointer: coarse) { .wn-conv__btn .kbd { display: none; } }
@media (max-width: 519.98px) {
  .wn-prompt { font-size: 19px; }
  .wn-choice { min-height: 64px; font-size: 15px; gap: 2px; }
  .wn-choice__icon { width: 30px; height: 30px; }
  .wn-conv { padding: 8px 10px; }
  .wn-conv__label { width: 100%; }
  .wn-conv__btn { font-size: 13.5px; gap: 5px; padding: 6px 6px; }
}
@keyframes wn-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-5px); } 40% { transform: translateX(4px); } 60% { transform: translateX(-2px); } 80% { transform: translateX(1px); } }
@media (prefers-reduced-motion: reduce) { .wn-choice.is-wrong { animation: none; } }

.wn-card { display: grid; gap: 10px; color: var(--text-2); }
.wn-card__head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.wn-card__title { color: var(--text); font-size: 16.5px; }
.wn-card__outcome { display: flex; align-items: center; gap: 8px; margin: 0; font-weight: 600; color: var(--text); }
.wn-card__outcome .icon { flex: 0 0 auto; }
.wn-card__outcome.is-up .icon { color: var(--bull-strong); }
.wn-card__outcome.is-down .icon { color: var(--bear-strong); }
.wn-card__outcome.is-flat .icon { color: var(--info); }
.wn-card p { margin: 0; }
.wn-grades { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 0; }
.wn-grade { display: grid; gap: 2px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.wn-grade dt { font-size: 11.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); }
.wn-grade dd { display: flex; align-items: center; gap: 6px; margin: 0; font-weight: 650; color: var(--text); }
.wn-grade dd .icon { flex: 0 0 auto; }
.wn-grade.is-good dd .icon { color: var(--bull-strong); }
.wn-grade.is-bad dd .icon { color: var(--bear-strong); }
.wn-grade.is-neutral dd .icon { color: var(--info); }
.wn-pts { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.wn-pts.is-pos { color: var(--bull-strong); }
.wn-pts.is-neg { color: var(--bear-strong); }
.wn-tell { display: flex; gap: 8px; padding: 10px 12px; border-radius: 8px; background: var(--accent-soft); color: var(--text); line-height: 1.45; }
.wn-tell .icon { flex: 0 0 auto; margin-top: 2px; color: var(--accent-strong); }
.wn-fail { display: flex; gap: 8px; padding: 10px 12px; border: 1px solid color-mix(in oklab, var(--warn) 40%, transparent); border-radius: 8px; background: color-mix(in oklab, var(--warn) 10%, var(--surface)); color: var(--text); line-height: 1.45; }
.wn-fail .icon { flex: 0 0 auto; margin-top: 2px; color: var(--warn); }
.wn-rule { font-size: 13px; color: var(--text-3); }
.wn-stats { display: grid; gap: 6px; padding: 10px 12px; border: 1px dashed var(--line); border-radius: 8px; font-size: 14px; }
.wn-stats__bar { display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: var(--surface-2); }
.wn-stats__bar span { display: block; height: 100%; }
.wn-stats__bar .is-followed { background: var(--bull); }
.wn-stats__bar .is-failed { background: var(--bear); }
.wn-stats__bar .is-flat { background: var(--muted); }
.wn-stats__legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; }
.wn-stats__legend span { display: inline-flex; align-items: center; gap: 6px; }
.wn-stats__legend i { width: 10px; height: 10px; border-radius: 2px; }
.wn-stats__legend .is-followed { background: var(--bull); }
.wn-stats__legend .is-failed { background: var(--bear); }
.wn-stats__legend .is-flat { background: var(--muted); }
.wn-hud-reads .hud__value small { color: var(--text-3); font-size: .8em; }

.wn-results { display: grid; gap: 14px; text-align: left; }
.wn-results h3 { margin: 0; font-family: var(--font-display); font-size: 18px; color: var(--text); }
.wn-results__lead { margin: 0; color: var(--text-2); }
.wn-acc { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.wn-acc__row { display: grid; grid-template-columns: minmax(0, 1fr) 110px 52px; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.wn-acc__row.is-miss { border-color: color-mix(in oklab, var(--bear) 45%, var(--line)); }
.wn-acc__name { display: grid; min-width: 0; }
.wn-acc__name strong { color: var(--text); font-size: 14.5px; overflow-wrap: anywhere; }
.wn-acc__name small { color: var(--text-3); font-size: 12px; }
.wn-acc__meter { display: flex; gap: 3px; }
.wn-acc__meter i { flex: 1 1 0; height: 10px; border-radius: 3px; background: var(--bear); }
.wn-acc__meter i.is-ok { background: var(--bull); }
.wn-acc__score { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 600; text-align: right; color: var(--text); }
.wn-insights { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }
.wn-insight { display: grid; gap: 4px; padding: 10px 12px; border-radius: 8px; background: var(--surface-2); color: var(--text-2); font-size: 14px; line-height: 1.45; }
.wn-insight strong { color: var(--text); }
@media (max-width: 519.98px) {
  .wn-acc__row { grid-template-columns: minmax(0, 1fr) 72px 44px; gap: 8px; }
}
.wn-preview { width: 100%; }
.wn-preview .tc-svg { display: block; }
`;

// ------------------------------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------------------------------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const signed = (v, d = 1) => `${v >= 0 ? '+' : MINUS}${Math.abs(v).toFixed(d)}`;
const answerMeta = (mode, id) => ANSWERS[mode].find((a) => a.id === id) || { id, label: id, short: id };
const labelOf = (mode, id) => answerMeta(mode, id).label;
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

function convBars(n) {
  return svg('svg', { class: 'wn-bars', width: 16, height: 14, viewBox: '0 0 16 14', 'aria-hidden': 'true', focusable: 'false' },
    [0, 1, 2].map((i) => svg('rect', { x: i * 5.5, y: 10 - i * 4, width: 4, height: 4 + i * 4, rx: 1, class: i < n ? 'is-on' : '' })));
}

function isTyping(t) {
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

/** The scanner explanation for a real setup: what it is and why its textbook read points that way. */
function realWhy(setup, mode) {
  const kind = setup.kind;
  const m = setup.meta || {};
  const def = SETUP_KINDS[kind] || { name: kind, group: 'chart' };
  const dir = setup.direction === 'bullish' ? 1 : setup.direction === 'bearish' ? -1 : 0;
  const word = labelOf(mode, answerFor(mode, dir)).toLowerCase();
  const name = m.name || def.name;
  const read = `<strong>${word}</strong>`;
  const cp = CANDLE_PATTERNS[kind];
  if (cp) {
    const ctx = cp.kind === 'reversal'
      ? `It printed after a ${dir > 0 ? 'decline, at the low' : 'rally, at the high'} of the move, which makes it a ${dir > 0 ? 'bullish' : 'bearish'} reversal signal`
      : `In a ${dir > 0 ? 'rising' : 'falling'} market it confirms ${dir > 0 ? 'buying' : 'selling'} pressure`;
    return `<strong>${name}.</strong> ${cp.summary} ${ctx}, so the textbook read is ${read} (ideally confirmed by the next candle).`;
  }
  const T = {
    'trend-up': `An established <strong>uptrend</strong>: over 50 candles price climbed at least 5 ATR with higher highs and higher lows, and the 20 EMA is above a rising 50 EMA. Trends tend to continue until they break, so the read is ${read}.`,
    'trend-down': `An established <strong>downtrend</strong>: over 50 candles price fell at least 5 ATR with lower highs and lower lows, and the 20 EMA is below a falling 50 EMA. Trends tend to continue until they break, so the read is ${read}.`,
    range: `A <strong>trading range</strong>: 40 candles of flat highs and flat lows, 3–8 ATR apart, with price still inside. Until it breaks out, the read is ${read}.`,
    'support-bounce': `A <strong>support bounce</strong>: price came back to a level made by at least two earlier swing lows, tagged it and closed well above it. Buyers defended the floor again, so the read is ${read}.`,
    'resistance-reject': `A <strong>resistance rejection</strong>: price came back to a level made by at least two earlier swing highs, tagged it and closed well below it. Sellers defended the ceiling again, so the read is ${read}.`,
    'breakout-up': `A <strong>breakout</strong>: the first decisive close above a resistance that had held for at least 10 candles. The read is ${read}.`,
    'breakout-down': `A <strong>breakdown</strong>: the first decisive close below a support that had held for at least 10 candles. The read is ${read}.`,
    'fakeout-up': `A <strong>failed breakout</strong>: price closed above resistance, then closed back below it within a few candles. Breakout buyers are trapped, so the read is ${read}.`,
    'fakeout-down': `A <strong>failed breakdown</strong>: price closed below support, then closed back above it within a few candles. Breakdown sellers are trapped, so the read is ${read}.`,
    'golden-cross': `A <strong>golden cross</strong>: the 50-period average crossed above the 200-period average, with price above them. The longer-term trend is turning up, so the read is ${read}.`,
    'death-cross': `A <strong>death cross</strong>: the 50-period average crossed below the 200-period average, with price below them. The longer-term trend is turning down, so the read is ${read}.`,
    'bullish-divergence': `A <strong>bullish RSI divergence</strong>: price made a lower low but RSI 14 made a higher low, so selling momentum is fading. The read is ${read}.`,
    'bearish-divergence': `A <strong>bearish RSI divergence</strong>: price made a higher high but RSI 14 made a lower high, so buying momentum is fading. The read is ${read}.`,
    'fib-pullback': `A <strong>Fibonacci pullback</strong>: a clean impulse, a pullback to the ${isNum(m.ratio) ? `${(m.ratio * 100).toFixed(1)}% ` : ''}retracement (inside the 38.2–78.6% zone), then a candle turning back the impulse’s way. The read is ${read}.`,
    'double-top': `A <strong>double top</strong>: two peaks at about the same price and a close below the low between them (the neckline). The read is ${read}.`,
    'double-bottom': `A <strong>double bottom</strong>: two lows at about the same price and a close above the high between them (the neckline). The read is ${read}.`,
    'head-and-shoulders': `A <strong>head and shoulders</strong> top: three peaks with the middle one highest, and a close below the neckline. The read is ${read}.`,
    'inverse-head-and-shoulders': `An <strong>inverse head and shoulders</strong>: three lows with the middle one lowest, and a close above the neckline. The read is ${read}.`,
    'bull-flag': `A <strong>bull flag</strong>: a steep pole up, a quiet drift lower (the flag), and a close above the flag. A continuation pattern, so the read is ${read}.`,
    'bear-flag': `A <strong>bear flag</strong>: a steep pole down, a quiet drift higher (the flag), and a close below the flag. A continuation pattern, so the read is ${read}.`,
  };
  return T[kind] || `<strong>${name}.</strong> The read is ${read}.`;
}

function realHint(setup) {
  const g = SETUP_KINDS[setup.kind]?.group;
  return {
    candle: 'The scanner found a candlestick pattern on the last candle or two. What does its shape say, and after what kind of move did it form?',
    trend: 'Look at the whole chart: are the swing highs and lows rising, falling or flat? Where is price compared with the moving averages?',
    level: 'Look at the dashed level: how did price treat it before, and where did the last candle close compared with it?',
    ma: 'Watch the two moving averages near the last candle. Which one is on top now, and which was on top before?',
    momentum: 'Compare the last two price swings with the two RSI swings under them. Do they agree?',
    fib: 'Measure the last big move and how far price pulled back. Which way did the last candle turn?',
    chart: 'Look for a pattern in the last 20–40 candles and where the last candle closed compared with its lines.',
  }[g] || 'Where did the last candle close compared with the structure before it?';
}

// ------------------------------------------------------------------------------------------
// Round models
// ------------------------------------------------------------------------------------------

/** Textbook scenario → round model. */
function fromScenario(sc) {
  const readDir = answerDir(sc.answer);
  const m = sc.measure;
  let pnlDir;
  if (sc.outcome === 'whipsaw') pnlDir = 'whipsaw';
  else if (sc.failed) pnlDir = -readDir;
  else pnlDir = sc.outcome === 'up' ? 1 : sc.outcome === 'down' ? -1 : 0;
  return {
    source: 'textbook',
    key: sc.type,
    title: sc.title,
    group: sc.group,
    answer: sc.answer,
    candles: sc.candles,
    d: sc.decisionIdx,
    reveal: sc.reveal,
    decimals: 2,
    lead: [],
    show: sc.show,
    htf: sc.htf,
    aids: sc.aids,
    annotations: sc.annotations,
    viewFrom: sc.viewFrom,
    explanation: sc.explanation,
    tellTale: sc.tellTale,
    hint: sc.hint,
    failNote: sc.failNote,
    failed: sc.failed,
    outcome: sc.outcome,
    pnlDir,
    moveAtr: m.moveAtr,
    movePct: m.pct,
    maxUp: m.maxUp,
    maxDown: m.maxDown,
    bars: m.bars,
  };
}

/** scanner.realRound() result → round model. */
function fromReal(real, mode, difficulty) {
  const s = real.setup;
  const dir = s.direction === 'bullish' ? 1 : s.direction === 'bearish' ? -1 : 0;
  const o = real.outcome || { direction: 'flat', r: 0, pct: 0, bars: real.candles.length - 1 - real.decisionIdx, maxUp: 0, maxDown: 0 };
  const hasVol = real.candles.some((k) => (k.v || 0) > 0);
  const def = SETUP_KINDS[s.kind] || { name: s.kind, group: 'chart', rule: '' };
  const g = def.group;
  return {
    source: 'real',
    key: `real:${s.kind}`,
    kind: s.kind,
    title: s.meta?.name || def.name,
    group: GROUP_LABEL[g] || 'Real setups',
    answer: answerFor(mode, dir),
    candles: real.candles,
    d: real.decisionIdx,
    reveal: real.candles.length - 1 - real.decisionIdx,
    decimals: isNum(real.decimals) ? real.decimals : 2,
    lead: Array.isArray(real.lead) ? real.lead : [],
    show: {
      volume: hasVol && (g === 'level' || g === 'chart' || g === 'candle'),
      ema20: g === 'trend',
      ema50: g === 'trend',
      sma: g === 'ma' ? { fast: s.meta?.fastPeriod || 50, slow: s.meta?.slowPeriod || 200 } : null,
      rsi: g === 'momentum',
    },
    htf: null,
    setup: s,
    real,
    nameChip: difficulty < 0.35 ? def.name : null,
    viewFrom: Math.max(0, (s.start ?? real.decisionIdx) - 10),
    explanation: realWhy(s, mode),
    rule: def.rule,
    tellTale: null,
    hint: realHint(s),
    failNote: null,
    failed: false,
    outcome: o.direction,
    result: dir ? o.result : o.direction === 'flat' ? 'followed' : 'broke',
    pnlDir: o.direction === 'up' ? 1 : o.direction === 'down' ? -1 : 0,
    moveAtr: isNum(o.r) ? o.r : 0,
    movePct: isNum(o.pct) ? o.pct : 0,
    maxUp: o.maxUp || 0,
    maxDown: o.maxDown || 0,
    bars: o.bars || 20,
  };
}

/** Advanced points: conviction × (+100 / −60); Wait +60 on a no-edge setup, +10 otherwise. */
function advancedPoints(R, choice, conv) {
  const read = R.answer;
  if (choice === 'wait') return { pts: read === 'wait' ? 60 : 10, kind: read === 'wait' ? 'patience' : 'missed' };
  const pd = answerDir(choice);
  const od = R.pnlDir;
  if (choice === read) {
    if (od === pd) return { pts: 100 * conv, kind: 'win' };
    if (od === 0) return { pts: 0, kind: 'scratch' };
    return { pts: -60 * conv, kind: 'loss' };
  }
  if (od === pd) return { pts: 0, kind: 'lucky' };
  return { pts: -60 * conv, kind: 'misread' };
}

// ------------------------------------------------------------------------------------------
// Real-sample hit rates (in the market data already loaded this session)
// ------------------------------------------------------------------------------------------

async function hitRate(kind, pairs, cache) {
  const tally = { n: 0, followed: 0, failed: 0, flat: 0, charts: 0, labels: [] };
  const neutral = SETUP_KINDS[kind]?.direction === 'neutral' && kind !== 'fib-pullback';
  for (const key of pairs) {
    const [symbol, interval] = key.split('|');
    const ck = `${key}|${kind}`;
    let res = cache.get(ck);
    if (!res) {
      const hist = await getHistory({ symbol, interval, bars: 1000 });
      const cs = hist?.candles || [];
      res = { n: 0, followed: 0, failed: 0, flat: 0 };
      if (cs.length >= 80) {
        const A = atrOf(cs, 14);
        for (const s of findSetups(cs, { kinds: [kind], atr: A })) {
          if (s.decisionIdx + 20 > cs.length - 1) continue;
          const o = outcomeOf(cs, s.decisionIdx, { bars: 20, atr: A, direction: s.direction });
          if (!o) continue;
          res.n += 1;
          if (neutral) {
            if (o.direction === 'flat') res.followed += 1;
            else res.failed += 1;
          } else if (o.result === 'followed') res.followed += 1;
          else if (o.result === 'failed') res.failed += 1;
          else res.flat += 1;
        }
      }
      cache.set(ck, res);
    }
    if (res.n) {
      tally.charts += 1;
      tally.labels.push(`${symbol} ${interval === '1w' ? 'weekly' : 'daily'}`);
    }
    tally.n += res.n;
    tally.followed += res.followed;
    tally.failed += res.failed;
    tally.flat += res.flat;
  }
  tally.neutral = neutral;
  return tally;
}

function statsView(kindName, t) {
  if (!t.n) return h('p', null, `No other ${kindName.toLowerCase()} setups in the real data loaded so far, so there is no sample to compare with yet.`);
  const pf = pct(t.followed, t.n);
  const pl = pct(t.failed, t.n);
  const pz = Math.max(0, 100 - pf - pl);
  const words = t.neutral
    ? [`${pf}% stayed in the range`, `${pl}% broke out`]
    : [`${pf}% followed through`, `${pl}% failed`, `${pz}% went nowhere`];
  return h('div', { class: 'wn-stats', role: 'group', 'aria-label': 'Real-sample hit rate' },
    h('p', null, h('strong', null, `In this sample of ${t.n} ${kindName.toLowerCase()} setup${t.n === 1 ? '' : 's'}`),
      ` (${t.labels.slice(0, 4).join(', ')}${t.labels.length > 4 ? '…' : ''}), measured 20 candles later with a 1 ATR threshold:`),
    h('div', { class: 'wn-stats__bar', 'aria-hidden': 'true' },
      h('span', { class: 'is-followed', style: { width: `${pf}%` } }),
      h('span', { class: 'is-failed', style: { width: `${pl}%` } }),
      t.neutral ? null : h('span', { class: 'is-flat', style: { width: `${pz}%` } })),
    h('div', { class: 'wn-stats__legend' },
      h('span', null, h('i', { class: 'is-followed' }), words[0]),
      h('span', null, h('i', { class: 'is-failed' }), words[1]),
      t.neutral ? null : h('span', null, h('i', { class: 'is-flat' }), words[2])),
    h('p', { class: 'wn-rule' }, 'A past sample, not a forecast: it tells you how much conviction the setup has earned, nothing more.'));
}

// ------------------------------------------------------------------------------------------
// The game
// ------------------------------------------------------------------------------------------

export default {
  id: ID,
  mount(root, ctx) {
    const styleEl = h('style', { 'data-module': ID }, CSS);
    document.head.append(styleEl);

    let run = null; // per-run state (plan, used types, log, real pairs)
    let cur = null; // the active round controller
    const hitCache = new Map();

    const onKey = (e) => {
      if (!cur || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target) || document.body.classList.contains('has-modal')) return;
      cur.key(e);
    };
    document.addEventListener('keydown', onKey);

    const readsCell = h('span', { class: 'hud__value mono' }, '0/0');
    const readsWrap = h('div', { class: 'hud__cell wn-hud-reads', title: 'Setups read correctly' }, h('span', { class: 'hud__label' }, 'Reads'), readsCell);

    function renderReads() {
      if (!run) return;
      const done = run.log.length;
      const right = run.log.filter((x) => x.right).length;
      readsCell.textContent = `${right}/${done}`;
    }

    /** This round's answer, scenario type and whether it is an honest failure (fixed on retry). */
    function specFor(g, round, rng, difficulty, retry) {
      const prev = run.specs.get(round);
      if (prev) return prev; // Practice "Try again" (retry) replays the identical round
      void retry;
      let answer;
      if (run.plan) answer = run.plan[(round - 1) % run.plan.length];
      else {
        if (!run.bag.length) run.bag = answerBag(g.rng, run.mode);
        answer = run.bag.shift();
      }
      const directional = answerDir(answer) !== 0;
      let fail = false;
      if (run.mode === 'advanced' && directional) {
        fail = run.plan ? round - 1 === run.failRound : round > 2 && rng.fork('fail').chance(1 / 8);
      }
      const type = pickType(rng.fork('type'), { mode: run.mode, answer, difficulty, used: run.used, last: run.last });
      run.used.add(type);
      run.last = type;
      const spec = { answer, fail, type };
      run.specs.set(round, spec);
      return spec;
    }

    function logRound(entry) {
      const i = run.log.findIndex((x) => x.round === entry.round);
      if (i >= 0) run.log[i] = entry;
      else run.log.push(entry);
      renderReads();
    }

    // ---------------------------------------------------------------- one round

    function playRound(g, R, { round, stage, difficulty }) {
      const mode = run.mode;
      const adv = mode === 'advanced';
      const answers = ANSWERS[mode];
      let dead = false;
      let locked = false;
      let revealing = false;
      let pendingChoice = null;
      let pendingConv = null;

      // ---- header
      const chips = [];
      if (R.source === 'real') chips.push(h('span', { class: 'chip chip--sm chip--outline' }, icon('eye', { size: 13 }), 'Symbol and date hidden'));
      if (R.nameChip) chips.push(h('span', { class: 'chip chip--sm chip--accent' }, icon('search', { size: 13 }), `Scanner: ${R.nameChip}`));
      if (R.show.volume) chips.push(h('span', { class: 'chip chip--sm' }, 'Volume'));
      if (R.show.ema20) chips.push(h('span', { class: 'chip chip--sm' }, h('span', { class: 'swatch', style: { '--c': 'var(--ma1)' } }), 'EMA 20'));
      if (R.show.ema50) chips.push(h('span', { class: 'chip chip--sm' }, h('span', { class: 'swatch', style: { '--c': 'var(--ma2)' } }), 'EMA 50'));
      if (R.show.sma) chips.push(h('span', { class: 'chip chip--sm' }, `SMA ${R.show.sma.fast} / ${R.show.sma.slow}`));
      if (R.show.rsi) chips.push(h('span', { class: 'chip chip--sm' }, 'RSI 14'));
      if (R.htf) chips.push(h('span', { class: 'chip chip--sm' }, icon('layers', { size: 13 }), 'Two timeframes'));
      const prompt = adv ? 'Your trade?' : 'What happens next?';
      const sub = adv
        ? `Long, short or wait, then your conviction. The next ${R.reveal} candles are hidden.`
        : `Call the next ${R.reveal} candles: up, down or sideways.`;
      const top = h('div', { class: 'wn-top' },
        h('div', null, h('h2', { class: 'wn-prompt' }, prompt), h('p', { class: 'wn-sub' }, sub)),
        chips.length ? h('div', { class: 'wn-chips' }, chips) : null);

      // ---- chart (+ higher-timeframe inset)
      const host = h('div', { class: 'chart-frame wn-chart' });
      let htfArt = null;
      let htfEl = null;
      if (R.htf) {
        htfArt = h('div', { class: 'wn-htf__art' });
        htfEl = h('aside', { class: 'wn-htf', 'aria-label': 'Higher-timeframe chart' },
          h('p', { class: 'wn-htf__title' }, h('span', null, 'Higher timeframe'), h('span', { class: 'mono' }, `1 candle = ${R.htf.factor}`)),
          htfArt,
          h('p', { class: 'wn-htf__note' }, 'The same market zoomed out: each candle here covers five of the main chart’s.'));
        htfArt.append(miniChart(R.htf.candles, { width: 220, height: 120, overlays: R.htf.overlays || [], ariaLabel: 'Higher-timeframe chart up to the decision point', yPad: 0.08 }));
      }
      const board = h('div', { class: ['wn-board', R.htf && 'has-htf'] }, htfEl, host);

      // ---- controls
      const status = h('p', { class: 'wn-status', 'aria-live': 'polite' });
      const choiceBtns = answers.map((a) => h('button', {
        type: 'button',
        class: `wn-choice wn-choice--${a.id}`,
        'data-answer': a.id,
        'aria-pressed': 'false',
        'aria-keyshortcuts': a.keys.join(' '),
        on: { click: () => pickChoice(a.id) },
      },
      h('span', { class: 'wn-choice__icon', 'aria-hidden': 'true' }, icon(a.icon, { size: 20 })),
      h('span', { class: 'wn-choice__label' }, a.short),
      kbdHint(a.keys)));
      const answersEl = h('div', { class: 'wn-answers', role: 'group', 'aria-label': adv ? 'Your trade' : 'Your prediction' }, choiceBtns);
      let convBtns = [];
      let convEl = null;
      if (adv) {
        convBtns = [1, 2, 3].map((n) => h('button', {
          type: 'button', class: 'wn-conv__btn', role: 'radio', 'aria-checked': 'false', 'data-conv': String(n), 'aria-keyshortcuts': String(n),
          on: { click: () => pickConv(n) },
        }, convBars(n), h('span', null, CONV_LABEL[n - 1]), h('kbd', { class: 'kbd' }, String(n))));
        convEl = h('div', { class: 'wn-conv' },
          h('span', { class: 'wn-conv__label', id: `wn-conv-${round}` }, 'Conviction'),
          h('div', { class: 'wn-conv__opts', role: 'radiogroup', 'aria-labelledby': `wn-conv-${round}` }, convBtns));
      }
      const payoff = adv
        ? h('p', { class: 'wn-payoff' }, h('strong', null, 'Right'), ` +100 × conviction · `, h('strong', null, 'Wrong'), ` ${MINUS}60 × conviction · `, h('strong', null, 'Wait'), ' +60 when there is no edge, +10 otherwise')
        : null;
      const skipBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm wn-skip', hidden: true, on: { click: () => skipReveal() } }, icon('step', { size: 15 }), 'Skip animation');
      const controls = h('div', { class: 'wn-controls' }, answersEl, convEl, payoff, status, skipBtn);

      const wrap = h('div', { class: 'what-next wn-round', 'data-round': String(round), 'data-source': R.source });
      wrap.append(top, board, controls);
      stage.append(wrap);

      // ---- the chart itself
      const narrow = (stage.clientWidth || window.innerWidth) < 560;
      const slots = R.d + 1 + R.reveal;
      const lead = R.lead || [];
      const cl = closesOf([...lead, ...R.candles]);
      const withLead = (arr) => arr.slice(lead.length);
      const chart = new CandleChart(host, {
        candles: R.candles,
        visible: R.d + 1,
        slots,
        height: narrow ? 290 : 350,
        showVolume: !!R.show.volume,
        decimals: R.decimals,
        yPad: 0.16,
        ariaLabel: `Price chart frozen at the decision point. The next ${R.reveal} candles are hidden until you answer.`,
      });
      if (narrow) {
        const from = clamp(R.viewFrom ?? 0, 0, Math.max(0, R.d - 30));
        if (from > 0) chart.setViewport(from, slots);
      }
      const clueIds = [];
      if (R.show.ema20) clueIds.push(chart.addSeries({ values: withLead(ema(cl, 20)), color: 'ma1', label: 'EMA 20' }));
      if (R.show.ema50) clueIds.push(chart.addSeries({ values: withLead(ema(cl, 50)), color: 'ma2', label: 'EMA 50' }));
      if (R.show.sma) {
        clueIds.push(chart.addSeries({ values: withLead(sma(cl, R.show.sma.fast)), color: 'ma1', label: `SMA ${R.show.sma.fast}` }));
        clueIds.push(chart.addSeries({ values: withLead(sma(cl, R.show.sma.slow)), color: 'ma2', label: `SMA ${R.show.sma.slow}` }));
      }
      if (R.show.rsi) {
        chart.addPane({ id: 'rsi', title: 'RSI 14', height: 92, range: [0, 100], levels: [{ value: 70, color: 'bear' }, { value: 30, color: 'bull' }], series: [{ values: withLead(rsiOf(cl, 14)), color: 'ma3' }] });
      }
      for (const spec of R.aids || []) clueIds.push(addOverlay(chart, spec));
      if (R.source === 'real') for (const id of realClues(R, chart, difficulty)) clueIds.push(id);

      // "Now" line, shaded future and the question mark.
      let vLo = Infinity;
      let vHi = -Infinity;
      for (let i = 0; i <= R.d; i++) {
        vLo = Math.min(vLo, R.candles[i].l);
        vHi = Math.max(vHi, R.candles[i].h);
      }
      const span = vHi - vLo || 1;
      const far = [vLo - span * 50, vHi + span * 50];
      chart.addSegment({ id: 'wn-now', a: { idx: R.d + 0.5, price: far[0] }, b: { idx: R.d + 0.5, price: far[1] }, color: 'accent', width: 1.5, dashed: '5 4' });
      chart.addZone({ id: 'wn-future', from: far[0], to: far[1], x1: R.d + 0.5, x2: slots + 1, color: 'muted', opacity: 0.08 });
      chart.addText({ id: 'wn-q', idx: R.d + 0.5 + R.reveal / 2, price: vLo + span * 0.5, text: '?', anchor: 'middle', size: narrow ? 30 : 40, color: 'muted' });
      chart.addText({ id: 'wn-now-t', idx: R.d + 0.5, price: vLo - span * 0.1, text: 'Now', anchor: 'middle', size: 11, color: 'accent' });

      g.setHint(R.hint);
      setStatus(adv ? 'Pick long, short or wait.' : 'Make your call.');

      function setStatus(t) {
        status.textContent = t;
      }

      // ---- choosing
      function pickChoice(id) {
        if (locked || dead) return;
        if (!adv) {
          commit(id, null);
          return;
        }
        if (id === 'wait') {
          commit('wait', null);
          return;
        }
        pendingChoice = id;
        sfx.click();
        choiceBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.answer === id)));
        if (pendingConv) commit(id, pendingConv);
        else {
          convEl.classList.add('is-asking');
          setStatus(`${labelOf(mode, id)}: now pick your conviction (1, 2 or 3).`);
          convBtns[1].focus({ preventScroll: true });
        }
      }

      function pickConv(n) {
        if (locked || dead) return;
        pendingConv = n;
        sfx.click();
        convBtns.forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.conv) === n)));
        if (pendingChoice) commit(pendingChoice, n);
        else setStatus(`Conviction ${n} (${CONV_LABEL[n - 1].toLowerCase()}): now pick long or short, or wait.`);
      }

      function lockUi(choice, conv) {
        choiceBtns.forEach((b) => {
          b.setAttribute('aria-disabled', 'true');
          const on = b.dataset.answer === choice;
          b.setAttribute('aria-pressed', String(on));
          if (!on) b.classList.add('is-dim');
        });
        convBtns.forEach((b) => {
          b.setAttribute('aria-disabled', 'true');
          b.setAttribute('aria-checked', String(Number(b.dataset.conv) === conv));
        });
        convEl?.classList.remove('is-asking');
      }

      async function commit(choice, conv) {
        if (locked || dead) return;
        locked = true;
        g.timer.stop();
        lockUi(choice, conv);
        setStatus(adv
          ? choice === 'wait' ? 'You wait. Watch what happens…' : `${labelOf(mode, choice)} × ${conv}. Watch what happens…`
          : `You said ${labelOf(mode, choice).toLowerCase()}. Watch what happens…`);
        if (adv && choice !== 'wait') {
          chart.addHLine({ id: 'wn-entry', price: R.candles[R.d].c, from: R.d, color: 'accent', dashed: true, width: 1.25, label: `${labelOf(mode, choice)} × ${conv}`, priceTag: false });
        }
        await runReveal();
        if (dead) return;
        grade(choice, conv);
      }

      function timeout() {
        if (locked || dead) return;
        locked = true;
        lockUi(null, null);
        g.wrong("Time's up! No call made.");
        setStatus('Time’s up. Here is what happened…');
        runReveal().then(() => {
          if (dead) return;
          finishReveal();
          const card = explainCard({ choice: null, conv: null, right: false, pts: 0, kind: 'timeout' });
          g.feedback(card, 'bad');
          if (R.source === 'real') afterReal(card);
          logRound({ round, key: R.key, title: R.title, group: R.group, answer: R.answer, choice: null, conv: null, right: false, pts: 0, source: R.source, result: R.result, failed: R.failed });
          g.nextButton();
        });
      }

      async function runReveal() {
        revealing = true;
        chart.remove('wn-q');
        chart.remove('wn-future');
        chart.remove('wn-now-t');
        skipBtn.hidden = reducedMotion();
        sfx.whoosh();
        const interval = reducedMotion() ? 0 : clamp(Math.round(1350 / Math.max(1, R.reveal)), 45, 80);
        await chart.reveal({ to: R.candles.length, interval });
        revealing = false;
        skipBtn.hidden = true;
      }

      function skipReveal() {
        if (!revealing || dead) return;
        chart.setVisible(R.candles.length);
      }

      function finishReveal() {
        for (const id of clueIds) if (id) chart.remove(id);
        if (R.source === 'real') {
          // annotateSetup draws what the scanner rule looked at (it replaces the RSI pane for divergences).
          annotateSetup(R.setup, chart, { candles: R.candles, decisionIdx: R.d, lead: R.lead });
          if (R.show.ema20) chart.addSeries({ values: withLead(ema(cl, 20)), color: 'ma1', label: 'EMA 20' });
          if (R.show.ema50) chart.addSeries({ values: withLead(ema(cl, 50)), color: 'ma2', label: 'EMA 50' });
        } else {
          if (R.show.ema20) chart.addSeries({ values: withLead(ema(cl, 20)), color: 'ma1', label: 'EMA 20' });
          for (const spec of R.annotations || []) addOverlay(chart, { ...spec, pulse: true });
        }
        // What happened: an arrow from the decision close to the last revealed close.
        const end = R.candles.length - 1;
        const up = R.candles[end].c >= R.candles[R.d].c;
        const flat = Math.abs(R.moveAtr) < 1;
        chart.addSegment({
          id: 'wn-move', a: { idx: R.d, price: R.candles[R.d].c }, b: { idx: end, price: R.candles[end].c },
          color: flat ? 'info' : up ? 'bull' : 'bear', width: 2.5, arrow: true, pulse: true,
          label: `${signed(R.moveAtr)} ATR`,
        });
        if (R.htf?.full && htfArt) {
          htfArt.replaceChildren(miniChart(R.htf.full, { width: 220, height: 120, overlays: R.htf.overlays || [], highlight: [R.htf.candles.length - 1, R.htf.full.length - 1], ariaLabel: 'Higher-timeframe chart including the revealed candles', yPad: 0.08 }));
        }
      }

      // ---- grading
      function grade(choice, conv) {
        finishReveal();
        const read = R.answer;
        const right = choice === read;
        let pts;
        let kind;
        if (adv) ({ pts, kind } = advancedPoints(R, choice, conv));
        else {
          pts = right ? 100 : 0;
          kind = right ? 'right' : 'wrong';
        }
        choiceBtns.forEach((b) => {
          const id = b.dataset.answer;
          if (id === choice) b.classList.add(right ? 'is-right' : 'is-wrong');
          if (id === read) {
            b.classList.remove('is-dim');
            b.classList.add('is-read');
            if (!right) b.append(h('span', { class: 'wn-choice__tag' }, 'Read'));
          }
        });
        const banner = bannerText(choice, conv, right, pts, kind);
        if (right) {
          g.correct(banner, { points: Math.max(0, pts) });
          if (pts < 0) g.award(pts, { reason: 'trade lost' });
        } else {
          g.wrong(banner);
          if (pts) g.award(pts, { reason: pts > 0 ? 'patience' : 'trade lost' });
        }
        setStatus(right ? 'Right read.' : 'Misread. The textbook read is marked.');
        const card = explainCard({ choice, conv, right, pts, kind });
        g.feedback(card, right ? (pts < 0 ? 'info' : 'good') : 'bad');
        if (R.source === 'real') afterReal(card);
        logRound({ round, key: R.key, title: R.title, group: R.group, answer: read, choice, conv, right, pts, source: R.source, result: R.result, failed: R.failed });
        g.nextButton();
      }

      function outcomeWords() {
        if (R.outcome === 'whipsaw') return `whipsawed: up ${R.maxUp.toFixed(1)} ATR and down ${R.maxDown.toFixed(1)} ATR, ending ${signed(R.moveAtr)} ATR`;
        if (R.outcome === 'flat') return `went sideways (${signed(R.moveAtr)} ATR)`;
        return `went ${R.outcome} (${signed(R.moveAtr)} ATR, ${signed(R.movePct)}%)`;
      }

      function bannerText(choice, conv, right, pts, kind) {
        const readL = labelOf(mode, R.answer);
        const call = choice ? `${labelOf(mode, choice)}${conv ? ` × ${conv}` : ''}` : '';
        const p = pts > 0 ? `+${pts}` : pts < 0 ? `${MINUS}${Math.abs(pts)}` : '0';
        if (!adv) {
          if (R.source === 'real') {
            const res = R.result === 'followed' ? 'and the setup followed through' : R.result === 'failed' ? 'but the setup failed this time' : R.result === 'broke' ? 'but the range broke this time' : 'and then price went nowhere much';
            return right ? `<strong>Right read: ${readL.toLowerCase()}</strong>, ${res}.` : `<strong>The textbook read was ${readL.toLowerCase()}.</strong> You said ${call.toLowerCase()}.`;
          }
          return right ? `<strong>Right: it ${outcomeWords().split(' (')[0]}.</strong>` : `<strong>It ${outcomeWords().split(' (')[0]}.</strong> You said ${call.toLowerCase()}.`;
        }
        switch (kind) {
          case 'win': return `<strong>Good trade.</strong> ${call} paid ${p}.`;
          case 'loss': return `<strong>Right read, losing trade.</strong> ${call}: ${p}.`;
          case 'scratch': return `<strong>Right read, no follow-through.</strong> ${call}: scratch, 0.`;
          case 'patience': return `<strong>Good patience.</strong> No edge here: ${p}.`;
          case 'missed': return `<strong>Missed trade.</strong> The read was ${readL.toLowerCase()}. Waiting kept you safe: ${p}.`;
          case 'lucky': return `<strong>Misread, lucky outcome.</strong> The read was ${readL.toLowerCase()}. No points for luck.`;
          default: return `<strong>Misread.</strong> The read was ${readL.toLowerCase()}. ${call}: ${p}.`;
        }
      }

      function grade3(label, value, tone) {
        const ic = tone === 'good' ? 'check' : tone === 'bad' ? 'x' : 'info';
        return h('div', { class: `wn-grade is-${tone}` }, h('dt', null, label), h('dd', null, icon(ic, { size: 16 }), value));
      }

      function explainCard({ choice, conv, right, pts, kind }) {
        const readL = labelOf(mode, R.answer);
        const outcomeCls = R.outcome === 'up' ? 'is-up' : R.outcome === 'down' ? 'is-down' : 'is-flat';
        const head = h('div', { class: 'wn-card__head' },
          h('strong', { class: 'wn-card__title' }, R.title),
          h('span', { class: 'chip chip--sm chip--outline' }, R.group),
          R.failed ? h('span', { class: 'chip chip--sm chip--bear' }, 'Setup failed') : null,
          R.source === 'real' ? h('span', { class: 'chip chip--sm chip--accent' }, 'Real market') : null);
        const outcome = h('p', { class: `wn-card__outcome ${outcomeCls}` },
          icon(R.outcome === 'up' ? 'trend-up' : R.outcome === 'down' ? 'trend-down' : 'arrow-right', { size: 18 }),
          `Next ${R.bars} candles: price ${outcomeWords()}.`);
        const rows = [];
        if (adv || R.source === 'real' || R.failed) {
          rows.push(grade3('Your call', choice ? `${labelOf(mode, choice)}${conv ? ` × ${conv}` : ''}` : 'No call (time ran out)', choice ? 'neutral' : 'bad'));
          rows.push(grade3('The read', `${readL}: ${right ? 'you read it right' : 'misread'}`, right ? 'good' : 'bad'));
          if (R.source === 'real' || R.failed || R.answer !== 'wait') {
            const oc = R.source === 'real'
              ? R.result === 'followed' ? ['Followed through', 'good'] : R.result === 'failed' ? ['Failed this time', 'bad'] : R.result === 'broke' ? ['Broke out of the range', 'bad'] : ['Went nowhere (under 1 ATR)', 'neutral']
              : R.failed ? ['Failed this time', 'bad'] : R.answer === 'wait' ? ['No edge: it chopped', 'neutral'] : ['Followed through', 'good'];
            rows.push(grade3('The outcome', oc[0], oc[1]));
          }
          if (adv) rows.push(h('div', { class: `wn-grade is-${pts > 0 ? 'good' : pts < 0 ? 'bad' : 'neutral'}` }, h('dt', null, 'Points'),
            h('dd', null, h('span', { class: `wn-pts ${pts > 0 ? 'is-pos' : pts < 0 ? 'is-neg' : ''}` }, pts > 0 ? `+${pts}` : pts < 0 ? `${MINUS}${Math.abs(pts)}` : '0'),
              h('small', { class: 'faint' }, kind === 'lucky' ? 'no points for luck' : kind === 'scratch' ? 'scratch' : ''))));
        }
        const why = h('p', { class: 'wn-card__why' });
        why.innerHTML = R.explanation;
        const tell = R.tellTale ? h('p', { class: 'wn-tell' }, icon('eye', { size: 16 }), h('span', null, h('strong', null, 'Tell-tale: '), R.tellTale)) : null;
        const fail = R.failNote ? h('p', { class: 'wn-fail' }, icon('info', { size: 16 }), h('span', null, R.failNote)) : null;
        const rule = R.rule ? h('p', { class: 'wn-rule' }, h('strong', null, 'Scanner rule: '), R.rule) : null;
        const honest = R.source === 'real'
          ? h('p', { class: 'wn-rule' }, 'Real charts are graded on the read (the textbook call for this setup). What the market did next is shown separately: even good reads fail often.')
          : null;
        return h('div', { class: 'what-next wn-card' }, head, outcome, rows.length ? h('dl', { class: 'wn-grades' }, rows) : null, why, tell, fail, rule, honest);
      }

      function afterReal(card) {
        g.revealSource(R.real);
        const slot = h('div', { class: 'wn-stats' }, h('p', { class: 'faint' }, 'Checking how often this setup worked in the real data loaded this session…'));
        card.append(slot);
        run.pairs.add(`${R.real.symbol}|${R.real.interval}`);
        hitRate(R.kind, [...run.pairs], hitCache).then((t) => {
          if (dead || !slot.isConnected) return;
          slot.replaceWith(statsView(SETUP_KINDS[R.kind]?.name || R.title, t));
        }, (err) => {
          console.warn('[what-next] hit rate unavailable:', err?.message || err);
          if (!dead && slot.isConnected) slot.replaceWith(h('p', { class: 'wn-rule' }, 'The real-data sample could not be loaded right now.'));
        });
      }

      // ---- keyboard
      function key(e) {
        if (dead) return;
        if (revealing && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          skipReveal();
          return;
        }
        if (locked) return;
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        const inChart = !!e.target?.closest?.('.tc-chart');
        let choice = null;
        let conv = null;
        if (k === 'ArrowUp') choice = adv ? 'long' : 'up';
        else if (k === 'ArrowDown') choice = adv ? 'short' : 'down';
        else if ((k === 'ArrowRight' || k === 'ArrowLeft') && !inChart) choice = adv ? 'wait' : 'sideways';
        else if (adv) {
          if (k === 'l') choice = 'long';
          else if (k === 's') choice = 'short';
          else if (k === 'w') choice = 'wait';
          else if (k === '1' || k === '2' || k === '3') conv = Number(k);
        } else if (k === 'u' || k === '1') choice = 'up';
        else if (k === 'd' || k === '2') choice = 'down';
        else if (k === 's' || k === '3') choice = 'sideways';
        if (choice) {
          e.preventDefault();
          pickChoice(choice);
        } else if (conv) {
          e.preventDefault();
          pickConv(conv);
        }
      }

      cur = { key, timeout, get locked() { return locked; } };

      return () => {
        dead = true;
        if (cur?.key === key) cur = null;
        chart.destroy();
      };
    }

    /** Neutral pre-answer clues for a real setup (what defines it), scaled by difficulty. */
    function realClues(R, chart, difficulty) {
      const ids = [];
      const s = R.setup;
      const m = s.meta || {};
      const n = R.candles.length;
      const ok = (i) => isNum(i) && i >= 0 && i <= R.d;
      const g = SETUP_KINDS[s.kind]?.group;
      if (LEVEL_KINDS.has(s.kind) && isNum(m.level)) {
        const from = (m.pivots || []).map((p) => p.idx).filter(ok)[0] ?? 0;
        ids.push(chart.addHLine({ price: m.level, from, color: 'muted', dashed: true, width: 1.25, priceTag: true }));
      }
      if (difficulty < 0.5) {
        if (g === 'candle' && ok(s.start)) ids.push(chart.addBox({ from: s.start, to: s.end, color: 'muted', label: s.end > s.start ? 'Last candles' : 'Last candle' }));
        if (s.kind === 'range' && isNum(m.top) && isNum(m.bottom)) ids.push(chart.addZone({ from: m.bottom, to: m.top, x1: ok(s.start) ? s.start : 0, x2: R.d, color: 'muted', opacity: 0.08 }));
        if (s.kind === 'fib-pullback' && m.a && m.b && ok(m.a.idx) && ok(m.b.idx)) ids.push(chart.addFib({ a: m.a, b: m.b, ratios: [0, 0.382, 0.5, 0.618, 0.786, 1], color: 'muted', labels: true }));
        const seg = (l) => (l && ok(l.x1) && isNum(l.y1) && isNum(l.x2) && isNum(l.y2) ? chart.addSegment({ a: { idx: l.x1, price: l.y1 }, b: { idx: Math.min(l.x2, R.d), price: l.y1 + ((l.y2 - l.y1) * (Math.min(l.x2, R.d) - l.x1)) / ((l.x2 - l.x1) || 1) }, color: 'muted', dashed: true, width: 1.25 }) : null);
        if (/flag$/.test(s.kind)) {
          ids.push(seg(m.upper), seg(m.lower));
        }
        if (/head-and-shoulders/.test(s.kind) && m.neckline && isNum(m.neckline.x1)) ids.push(seg(m.neckline));
        if (/^double-/.test(s.kind) && isNum(m.neckline)) ids.push(chart.addHLine({ price: m.neckline, from: (m.points || [])[0]?.idx ?? 0, color: 'muted', dashed: true, width: 1.25, priceTag: false }));
      }
      void n;
      return ids.filter(Boolean);
    }

    // ---------------------------------------------------------------- results extra

    function resultsView(summary) {
      if (!run || !run.log.length) return null;
      const adv = run.mode === 'advanced';
      const byKey = new Map();
      for (const x of run.log) {
        if (!byKey.has(x.key)) byKey.set(x.key, { key: x.key, title: x.title, group: x.group, n: 0, right: 0, pts: 0, marks: [] });
        const r = byKey.get(x.key);
        r.n += 1;
        r.right += x.right ? 1 : 0;
        r.pts += x.pts || 0;
        r.marks.push(!!x.right);
      }
      const rows = [...byKey.values()].sort((a, b) => a.right / a.n - b.right / b.n || b.n - a.n || a.title.localeCompare(b.title));
      const list = h('ul', { class: 'wn-acc' }, rows.map((r) => h('li', { class: ['wn-acc__row', r.right < r.n && 'is-miss'] },
        h('span', { class: 'wn-acc__name' }, h('strong', null, r.title), h('small', null, r.group)),
        h('span', { class: 'wn-acc__meter', role: 'img', 'aria-label': `${r.right} of ${r.n} read correctly` }, r.marks.map((ok) => h('i', { class: ok ? 'is-ok' : '' }))),
        h('span', { class: 'wn-acc__score' }, adv ? (r.pts > 0 ? `+${r.pts}` : r.pts < 0 ? `${MINUS}${Math.abs(r.pts)}` : '0') : `${r.right}/${r.n}`))));
      const misses = rows.filter((r) => r.right < r.n);
      const insights = [];
      if (misses.length) {
        const worst = misses[0];
        const tell = SCENARIO_TYPES[worst.key] ? run.tells.get(worst.key) : null;
        insights.push(h('div', { class: 'wn-insight' }, h('strong', null, `Misread most: ${worst.title}`), h('span', null, tell ? `Tell-tale: ${tell}` : 'Replay it and look for what defines the setup before you answer.')));
      } else {
        insights.push(h('div', { class: 'wn-insight' }, h('strong', null, 'Every setup read correctly'), h('span', null, 'Clean reads across the board. Try a harder difficulty or real-market charts next.')));
      }
      if (adv) {
        const traded = run.log.filter((x) => x.conv);
        const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x.conv, 0) / xs.length : null);
        const onRight = avg(traded.filter((x) => x.right));
        const onWrong = avg(traded.filter((x) => !x.right));
        const waits = run.log.filter((x) => x.choice === 'wait');
        let msg;
        if (onRight != null && onWrong != null) msg = onRight > onWrong + 0.2 ? 'Your conviction was higher on good reads than on misreads: exactly how sizing should work.' : 'Your conviction was about as high on misreads as on good reads. Save 3s for setups where everything lines up.';
        else if (onRight != null) msg = 'No trade was a misread. Where did you hold back a level of conviction, and why?';
        else msg = 'Pick long or short with a conviction when you see an edge; conviction is how you size risk.';
        insights.push(h('div', { class: 'wn-insight' }, h('strong', null, 'Conviction check'),
          h('span', null, `Average conviction on right reads: ${onRight != null ? onRight.toFixed(1) : '—'} · on misreads: ${onWrong != null ? onWrong.toFixed(1) : '—'}. ${msg}`),
          h('span', null, `You waited ${waits.length} time${waits.length === 1 ? '' : 's'} (${waits.filter((x) => x.right).length} when there really was no edge).`)));
        const fails = run.log.filter((x) => x.failed);
        if (fails.length) insights.push(h('div', { class: 'wn-insight' }, h('strong', null, 'The setup that failed'), h('span', null, `${fails.map((x) => x.title).join(', ')}: a good read that lost anyway. Losses like that are the cost of trading; conviction decides how big they are.`)));
      }
      const real = run.log.filter((x) => x.source === 'real');
      if (real.length) {
        const followed = real.filter((x) => x.result === 'followed').length;
        insights.push(h('div', { class: 'wn-insight' }, h('strong', null, 'Real charts: read vs outcome'),
          h('span', null, `${real.length} real chart${real.length === 1 ? '' : 's'}: you read ${real.filter((x) => x.right).length} correctly, and ${followed} of those setups followed through. A right read and a winning trade are not the same thing.`)));
      }
      void summary;
      return h('section', { class: 'what-next wn-results', 'aria-label': 'Reads by setup' },
        h('h3', null, 'Your reads by setup'),
        h('p', { class: 'wn-results__lead' }, misses.length ? 'Setups you misread are at the top, so you know what to review.' : 'Each setup you saw this run, and how you read it.'),
        list,
        h('div', { class: 'wn-insights' }, insights));
    }

    // ---------------------------------------------------------------- intro preview

    function preview(el) {
      const sc = buildScenario('support-bounce', makeRng('what-next-preview'), { difficulty: 0.2 });
      const host = h('div', { class: 'what-next wn-preview' });
      el.append(host);
      const d = sc.decisionIdx;
      const slots = sc.candles.length;
      const chart = new CandleChart(host, {
        candles: sc.candles, visible: d + 1, slots, height: 180, showAxis: false, showGrid: false, legend: false,
        crosshair: false, interactive: false, showLast: false, yPad: 0.12, ariaLabel: 'Preview: a chart frozen at a decision point, then revealed',
      });
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i <= d; i++) {
        lo = Math.min(lo, sc.candles[i].l);
        hi = Math.max(hi, sc.candles[i].h);
      }
      const sp = hi - lo;
      const addFuture = () => {
        chart.addZone({ id: 'z', from: lo - sp * 50, to: hi + sp * 50, x1: d + 0.5, x2: slots + 1, color: 'muted', opacity: 0.08 });
        chart.addText({ id: 'q', idx: d + 0.5 + (slots - d) / 2, price: lo + sp * 0.5, text: '?', anchor: 'middle', size: 34, color: 'muted' });
      };
      chart.addSegment({ a: { idx: d + 0.5, price: lo - sp * 50 }, b: { idx: d + 0.5, price: hi + sp * 50 }, color: 'accent', width: 1.5, dashed: '5 4' });
      addFuture();
      const timers = new Set();
      let stopped = false;
      const wait = (ms) => new Promise((res) => {
        const t = setTimeout(() => {
          timers.delete(t);
          res();
        }, ms);
        timers.add(t);
      });
      if (!reducedMotion()) {
        (async () => {
          while (!stopped) {
            await wait(1800);
            if (stopped) return;
            chart.remove('z');
            chart.remove('q');
            await chart.reveal({ to: slots, interval: 70 });
            if (stopped) return;
            chart.addHLine({ id: 's', price: sc.annotations[0]?.price, color: 'support', dashed: true, label: 'Support', priceTag: false, pulse: true });
            await wait(2600);
            if (stopped) return;
            chart.remove('s');
            chart.setVisible(d + 1);
            addFuture();
          }
        })();
      }
      return () => {
        stopped = true;
        for (const t of timers) clearTimeout(t);
        chart.destroy();
      };
    }

    // ---------------------------------------------------------------- shell

    const game = new GameShell(root, ctx, {
      rounds: ROUNDS,
      modes: [
        { id: 'beginner', label: 'Beginner', description: 'Call the direction: up, down or sideways. Keys ↑ ↓ → or U D S.' },
        { id: 'advanced', label: 'Advanced', requires: 'advanced', description: 'Make the trade: long, short or wait, with a conviction of 1–3 that multiplies the points won or lost.' },
      ],
      timer: { seconds: 35, perRound: true },
      howTo: [
        'The chart freezes at a decision point. The candles after it are hidden.',
        'Beginner: call it up, down or sideways (↑ ↓ →, or U D S). Advanced: long, short or wait (↑ ↓ →, or L S W), then a conviction of 1–3.',
        'Watch the reveal: the setup is drawn in and explained, including the tell-tale sign.',
        'No setup works every time. On real charts your read is graded separately from what the market did.',
      ],
      preview,
      onStart(g, { rng, mode, style }) {
        const adv = mode === 'advanced';
        const plan = style === 'survival' ? null : planAnswers(rng.fork('plan'), mode, ROUNDS);
        let failRound = -1;
        if (adv && plan) {
          const idx = plan.map((a, i) => (answerDir(a) !== 0 && i >= 2 ? i : -1)).filter((i) => i >= 0);
          if (idx.length) failRound = rng.fork('fail-round').pick(idx);
        }
        run = { mode, plan, bag: [], used: new Set(), last: null, log: [], specs: new Map(), failRound, pairs: new Set(), tells: new Map() };
        if (plan) g.maxScore = adv ? plan.reduce((s, a) => s + (answerDir(a) !== 0 ? 250 : 60), 0) : ROUNDS * 100;
        g.hudExtra.replaceChildren(readsWrap);
        renderReads();
      },
      async onRound(g, { round, rng, stage, difficulty, retry }) {
        const spec = specFor(g, round, rng, difficulty, retry);
        let R = null;
        if (g.source === 'real') {
          const real = await g.realRound({
            kinds: REAL_KINDS[spec.answer],
            intervals: ['1d', '1w'],
            before: Math.round(70 - 15 * difficulty),
            after: 20,
            rng: rng.fork('real'),
          });
          if (real && real.setup) R = fromReal(real, run.mode, difficulty);
        }
        if (!R) {
          const sc = buildScenario(spec.type, rng.fork('scenario'), { difficulty, fail: spec.fail });
          R = fromScenario(sc);
          run.tells.set(sc.type, sc.tellTale);
        }
        return playRound(g, R, { round, stage, difficulty });
      },
      onTimeout() {
        cur?.timeout();
      },
      onEnd(g, summary) {
        return resultsView(summary);
      },
    });

    game.onCleanup(() => {
      document.removeEventListener('keydown', onKey);
      styleEl.remove();
      cur = null;
    });
    return () => game.destroy();
  },
};
