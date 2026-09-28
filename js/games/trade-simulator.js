// Trade Simulator (Advanced capstone): replay a market bar by bar and trade it.
// GameShell provides the intro and the results; the session itself (chart, playback, order ticket,
// position, journal) is this module's own UI inside game.stage. Private helpers:
//   trade-simulator-market.js  — the replay market (presets, stitched patterns, validation, real data)
//   trade-simulator-engine.js  — execution, account, statistics, discipline grading and score
//   trade-simulator-report.js  — the report card (equity curve, stats, feedback)
//   trade-simulator-styles.js  — scoped CSS (.trade-sim)

import { GameShell, formatMarketDate, intervalLabel } from '../core/game-kit.js';
import { CandleChart, miniChart } from '../core/chart.js';
import { h, icon, sfx, kbdHint, modal, fmt, toast } from '../core/ui.js';
import { reducedMotion } from '../core/anim.js';
import { ema, sma, bollinger, rsi, atr, closes } from '../core/indicators.js';
import { fromPath } from '../core/data.js';
import { describeChart } from '../core/scanner.js';
import { generateMarket, rebaseReal, PRESETS, presetLabel, START_VISIBLE } from './trade-simulator-market.js';
import { TradeSession, REASONS, reasonLabel, START_BALANCE, DEFAULT_RISK, MAX_SAFE_RISK } from './trade-simulator-engine.js';
import { renderReport, journalTable, money, fmtR, pctText, EXIT_TEXT } from './trade-simulator-report.js';
import { CSS } from './trade-simulator-styles.js';

const ID = 'trade-simulator';
const SPEEDS = [1, 2, 4];
const INTERVAL = { 1: 700, 2: 350, 4: 175 }; // ms per bar
const RISK_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5];
const REAL_KINDS = ['trend-up', 'trend-down', 'range', 'support-bounce', 'resistance-reject', 'breakout-up', 'breakout-down'];
const IND = {
  ema: { label: 'EMA 20', color: 'ma1', key: null },
  sma: { label: 'SMA 50', color: 'ma2', key: null },
  bb: { label: 'Bollinger', color: 'info', key: null },
  rsi: { label: 'RSI', color: 'ma3', key: null },
};
const DRAW = {
  hline: { label: 'Line', title: 'Horizontal line', key: 'H', hint: 'Tap or drag to place a horizontal line. Esc cancels.' },
  segment: { label: 'Trend line', title: 'Trend line', key: 'T', hint: 'Drag from one point to another (or tap both). Esc cancels.' },
  fib: { label: 'Fib', title: 'Fibonacci retracement', key: 'F', hint: 'Drag from the swing start to the swing end (or tap both). Esc cancels.' },
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100;
const px = (v) => (isNum(v) ? v.toFixed(2) : '—');
const isTyping = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
// A focused, visible control handles Enter itself (a hidden one, e.g. the intro's Start button, does not).
const isControl = (t) => !!t?.closest?.('button, a, [role="button"], [role="radio"], summary, input, select, textarea') && t.getClientRects().length > 0;

// ------------------------------------------------------------------------------ intro preview

function drawPreview(el, store) {
  const { candles, anchors } = fromPath(
    [[0, 100.4], [0.18, 104.6], [0.3, 101.9], [0.47, 107.8], [0.6, 104.7], [0.84, 113.6], [1, 112.1]],
    { seed: 20260927, count: 110, noise: 0.42, volume: false },
  );
  const pull = anchors[4];
  const e = Math.min(candles.length - 2, pull.idx + 2);
  const entry = candles[e].c;
  const stop = r2(pull.price - 0.7);
  const target = r2(entry + 2 * (entry - stop));
  let exitIdx = candles.length - 1;
  for (let i = e + 1; i < candles.length; i++) {
    if (candles[i].l <= stop) break;
    if (candles[i].h >= target) {
      exitIdx = i;
      break;
    }
  }
  const e20 = ema(closes(candles), 20);
  const overlays = [
    { type: 'series', values: e20, color: 'ma1', width: 1.4 },
    { type: 'zone', from: stop, to: entry, color: 'bear', opacity: 0.14, x1: e, x2: exitIdx },
    { type: 'zone', from: entry, to: target, color: 'bull', opacity: 0.12, x1: e, x2: exitIdx },
    { type: 'marker', idx: e, price: entry, position: 'below', text: 'Buy', color: 'bull' },
    { type: 'marker', idx: exitIdx, price: target, position: 'above', text: '+2R', color: 'bull' },
  ];
  const art = miniChart(candles, { width: 560, height: 280, overlays, yPad: 0.1, padding: 10, ariaLabel: 'A long trade on a pullback to the 20 EMA: the red box is the risk to the stop, the green box the reward to a 2R target' });
  let best = null;
  try {
    best = store?.getGamePref?.(ID, 'bestSession', null);
  } catch {
    best = null;
  }
  el.append(h('div', { class: 'ts-preview' },
    art,
    h('div', { class: 'ts-preview__cap' },
      h('span', null, 'Virtual account ', h('b', null, '$10,000')),
      h('span', null, 'Default risk ', h('b', null, '1%'), ' · target ', h('b', null, '2R')),
      best && isNum(best.score)
        ? h('span', null, 'Best session ', h('b', null, `${fmt(best.score)} pts · ${pctText(best.returnPct || 0, 1)}`))
        : h('span', null, 'Not financial advice'))));
}

/** Rename the shell's "Mode" picker to "Market" and explain what Real market does to it. */
function setupIntro(root, game) {
  const picker = root.querySelector('[data-picker="mode"]');
  if (!picker) return () => {};
  const label = picker.querySelector('.field__label');
  if (label) label.textContent = 'Market';
  const note = h('p', { class: 'ts-intro-note faint', hidden: true },
    'Real market is on (Charts): you get a random stretch of a real market instead, its name kept secret until the report card. The preset is used only if no real data loads.');
  picker.append(note);
  const sync = () => {
    const real = game.sourcePref === 'real' && game.sources.includes('real');
    note.hidden = !real;
    picker.classList.toggle('is-muted', real);
  };
  const onClick = (e) => {
    if (e.target.closest?.('[data-picker="source"]')) requestAnimationFrame(sync);
  };
  root.addEventListener('click', onClick);
  sync();
  return () => root.removeEventListener('click', onClick);
}

// ------------------------------------------------------------------------------ the session

async function runSession(g, { rng, stage, difficulty, source }, done) {
  const presetId = g.mode || 'mixed';
  const diff = g.style === 'practice' ? difficulty : 0.5;
  const coach = g.style === 'practice';

  // 1. The market: a real stretch (mystery until the report card) or a generated preset.
  let real = null;
  let rb = null;
  if (source === 'real') {
    real = await g.realRound({ kinds: REAL_KINDS, intervals: ['1d', '1w'], before: 300, after: 100, tries: 10, loadingText: 'Finding a real market…' });
    rb = real ? rebaseReal(real) : null;
  }
  let market;
  if (rb) {
    market = { candles: rb.candles, lead: rb.lead, hasVolume: rb.hasVolume, preset: 'real', surprise: false, real };
  } else {
    const m = generateMarket({ seed: rng.int(1, 2 ** 31 - 1), preset: presetId, difficulty: diff });
    market = { ...m, lead: [], hasVolume: true, real: null, fellBack: source === 'real' };
  }
  const candles = market.candles;
  const N = candles.length;

  // 2. Indicators over the whole market (all causal: a value at bar i only uses bars ≤ i, and the
  //    chart only ever holds the revealed bars, so nothing from the future can leak).
  const all = [...market.lead, ...candles];
  const L0 = market.lead.length;
  const cl = closes(all);
  const cut = (arr) => arr.slice(L0);
  const ind = {
    ema: cut(ema(cl, 20)),
    sma: cut(sma(cl, 50)),
    bb: (() => {
      const b = bollinger(cl, 20, 2);
      return { upper: cut(b.upper), lower: cut(b.lower) };
    })(),
    rsi: cut(rsi(cl, 14)),
    atr: cut(atr(all, 14)),
  };
  const S = new TradeSession({ candles, start: START_VISIBLE - 1, atr: ind.atr, sma50: ind.sma });

  // ---------------------------------------------------------------- state
  const cleanups = [];
  let dead = false;
  let playing = false;
  let speed = 1;
  let raf = 0;
  let lastT = 0;
  let following = true;
  let programmatic = 0;
  let drawing = null;
  const drawings = [];
  let modalApi = null;
  let ended = false;
  let floatTimer = 0;
  let lastJournalId = null;
  let spaceConsumed = false;
  const on = { ema: true, sma: true, bb: false, rsi: false };
  const T = { side: 0, riskPct: DEFAULT_RISK, stop: null, target: null, useStop: true, useTarget: true, reason: null, stopTouched: false, targetTouched: false };
  let quote = null;
  g.onRoundCleanup(() => {
    dead = true;
    cancelAnimationFrame(raf);
    clearTimeout(floatTimer);
    modalApi?.close();
    for (const fn of cleanups.splice(0).reverse()) {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }
  });

  // ---------------------------------------------------------------- DOM
  const marketChip = market.real
    ? h('span', { class: 'chip chip--sm chip--accent' }, icon('eye', { size: 13 }), 'Mystery market')
    : h('span', { class: 'chip chip--sm chip--outline' }, icon('chart', { size: 13 }), market.surprise ? 'Surprise market' : `${presetLabel(market.preset)} market`);
  const head = h('div', { class: 'ts-head' },
    h('div', { class: 'ts-head__market' }, marketChip,
      h('span', null, market.real ? 'Real prices, rebased to 100. Name and dates revealed on your report card.' : `Simulated prices · ${g.style === 'practice' ? 'Practice with coach' : 'Arcade'}`)),
    h('span', { class: 'ts-nfa' }, icon('info', { size: 14 }), market.real ? 'Not financial advice — historical prices' : 'Not financial advice — simulated prices'));
  const fellBackNote = market.fellBack
    ? h('p', { class: 'ts-note', role: 'status' }, `No real market data could be loaded right now, so you are trading a simulated ${presetLabel(market.preset)} market instead.`)
    : null;

  // Toolbar: indicators + drawing tools.
  const indBtns = {};
  for (const [k, cfg] of Object.entries(IND)) {
    indBtns[k] = h('button', { type: 'button', class: 'ts-tog', 'aria-pressed': String(on[k]), style: { '--c': `var(--${cfg.color})` }, 'data-ind': k, on: { click: () => toggleInd(k) } },
      h('span', { class: 'ts-sw', 'aria-hidden': 'true' }), cfg.label);
  }
  const drawBtns = {};
  for (const [k, cfg] of Object.entries(DRAW)) {
    drawBtns[k] = h('button', { type: 'button', class: 'ts-tog', 'aria-pressed': 'false', 'data-draw': k, title: `${cfg.title} (${cfg.key})`, on: { click: () => startDraw(k) } },
      icon(k === 'hline' ? 'minus' : k === 'segment' ? 'trendline' : 'ruler', { size: 15 }), cfg.label, h('kbd', { class: 'kbd', 'aria-hidden': 'true' }, cfg.key));
  }
  const clearBtn = h('button', { type: 'button', class: 'ts-tog', 'data-draw': 'clear', on: { click: clearDrawings } }, icon('x', { size: 14 }), 'Clear');
  const tools = h('div', { class: 'ts-tools', role: 'toolbar', 'aria-label': 'Indicators and drawing tools' },
    h('div', { class: 'ts-group', role: 'group', 'aria-label': 'Indicators' }, h('span', { class: 'ts-group__label' }, 'Show'), Object.values(indBtns)),
    h('div', { class: 'ts-group', role: 'group', 'aria-label': 'Drawing tools' }, h('span', { class: 'ts-group__label' }, 'Draw'), Object.values(drawBtns), clearBtn));

  // Chart area.
  const chartHost = h('div', { class: 'ts-chart' });
  const followBtn = h('button', { type: 'button', class: 'btn btn--sm ts-follow', hidden: true, on: { click: () => follow(true) } }, icon('arrow-right', { size: 15 }), 'Latest');
  const drawHint = h('div', { class: 'ts-drawhint', hidden: true, 'aria-live': 'polite' });
  const liveMsg = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const chartWrap = h('div', { class: 'ts-chart-wrap' }, chartHost, followBtn, drawHint, liveMsg);

  // Playback controls.
  const playLabel = h('span', null, 'Play');
  const playIcon = h('span', { class: 'ts-ic', style: { display: 'inline-flex' } }, icon('play', { size: 18 }));
  const playBtn = h('button', { type: 'button', class: 'btn btn--primary ts-play', 'data-action': 'play', 'aria-pressed': 'false', on: { click: togglePlay } }, playIcon, playLabel, h('kbd', { class: 'kbd', 'aria-hidden': 'true' }, 'Space'));
  const stepBtn = h('button', { type: 'button', class: 'btn ts-step-btn', 'data-action': 'step', on: { click: () => manualStep() } }, icon('step', { size: 18 }), 'Step', h('kbd', { class: 'kbd', 'aria-hidden': 'true' }, '→'));
  const speedBtns = SPEEDS.map((s) => h('button', { type: 'button', 'aria-pressed': String(s === speed), 'data-speed': String(s), on: { click: () => setSpeed(s) } }, `${s}x`));
  const speedSeg = h('div', { class: 'segmented ts-speed', role: 'group', 'aria-label': 'Playback speed ([ and ] change it)' }, speedBtns);
  const barText = h('span', { class: 'mono' });
  const leftText = h('span', { class: 'mono' });
  const progFill = h('span', { class: 'ts-progress__fill' });
  const endBtn = h('button', { type: 'button', class: 'btn btn--ghost ts-end', 'data-action': 'end-session', on: { click: askEnd } }, icon('flag', { size: 16 }), 'End session');
  const controls = h('div', { class: 'ts-controls' },
    playBtn, stepBtn, speedSeg,
    h('div', { class: 'ts-progress', 'aria-hidden': 'true' }, h('div', { class: 'ts-progress__text' }, barText, leftText), h('div', { class: 'ts-progress__bar' }, progFill)),
    endBtn);
  const keys = h('div', { class: 'ts-keys', 'aria-hidden': 'true' },
    kbdHint('B', 'buy'), kbdHint('S', 'sell'), kbdHint('Enter', 'confirm'), kbdHint('X', 'close trade'), kbdHint(['[', ']'], 'speed'), kbdHint('Esc', 'cancel'));

  // Order ticket.
  const priceSmall = { buy: h('small', null, '—'), sell: h('small', null, '—') };
  const buyBtn = h('button', { type: 'button', class: 'ts-side-btn ts-side-btn--buy', 'aria-pressed': 'false', 'data-side': 'buy', on: { click: () => arm(1) } },
    h('span', null, 'Buy', h('kbd', { class: 'kbd', 'aria-hidden': 'true' }, 'B')), priceSmall.buy);
  const sellBtn = h('button', { type: 'button', class: 'ts-side-btn ts-side-btn--sell', 'aria-pressed': 'false', 'data-side': 'sell', on: { click: () => arm(-1) } },
    h('span', null, 'Sell', h('kbd', { class: 'kbd', 'aria-hidden': 'true' }, 'S')), priceSmall.sell);
  const sheetBtn = h('button', { type: 'button', class: 'btn ts-sheet-toggle', 'aria-label': 'Show or hide the order ticket', 'aria-expanded': 'false', on: { click: () => setSheet(!ticket.classList.contains('is-open')) } }, icon('chevron-down', { size: 18 }));
  const qpText = h('span', { class: 'ts-quick-pos__txt' });
  const qpClose = h('button', { type: 'button', class: 'btn btn--sm', on: { click: () => closePosition() } }, icon('x', { size: 15 }), 'Close');
  const quickPos = h('div', { class: 'ts-quick-pos' }, qpText, qpClose);

  const riskInput = h('input', { class: 'ts-num', type: 'number', inputmode: 'decimal', min: '0.1', max: '10', step: '0.25', value: String(T.riskPct), 'aria-label': 'Risk per trade, percent of equity', 'data-field': 'risk' });
  const riskAside = h('span', { class: 'ts-aside' }, '$100');
  const riskDown = h('button', { type: 'button', class: 'btn btn--sm ts-step', 'aria-label': 'Lower the risk', on: { click: () => nudgeRisk(-1) } }, icon('minus', { size: 14 }));
  const riskUp = h('button', { type: 'button', class: 'btn btn--sm ts-step', 'aria-label': 'Raise the risk', on: { click: () => nudgeRisk(1) } }, icon('plus', { size: 14 }));
  const stopChk = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Use a stop' });
  const stopInput = h('input', { class: 'ts-num', type: 'number', inputmode: 'decimal', step: '0.01', 'aria-label': 'Stop price', 'data-field': 'stop' });
  const stopAside = h('span', { class: 'ts-aside' }, '—');
  const tgtChk = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Use a target' });
  const tgtInput = h('input', { class: 'ts-num', type: 'number', inputmode: 'decimal', step: '0.01', 'aria-label': 'Target price', 'data-field': 'target' });
  const tgtAside = h('span', { class: 'ts-aside' }, '—');
  const sumCells = { size: h('dd', null, '—'), risk: h('dd', null, '—'), rr: h('dd', null, '—'), notional: h('dd', null, '—') };
  const msgList = h('ul', { class: 'ts-msg', 'aria-live': 'polite' });
  const reasonBtns = REASONS.map((r, i) => h('button', { type: 'button', class: 'ts-reason', 'aria-pressed': 'false', 'data-reason': r.id, on: { click: () => pickReason(r.id) } },
    h('span', { class: 'ts-rk', 'aria-hidden': 'true' }, String(i + 1)), r.label));
  const confirmBtn = h('button', { type: 'button', class: 'btn ts-confirm', 'data-action': 'confirm', disabled: true, on: { click: confirmOrder } }, 'Pick Buy or Sell');
  const cancelBtn = h('button', { type: 'button', class: 'btn btn--ghost', 'data-action': 'cancel-order', on: { click: () => disarm() } }, 'Cancel');
  const form = h('div', { class: 'ts-form' },
    h('div', { class: 'ts-row ts-row--risk' }, h('span', { class: 'ts-row__label' }, 'Risk %'), h('div', { class: 'ts-field' }, riskDown, riskInput, riskUp, riskAside)),
    h('div', { class: 'ts-row' }, h('label', { class: 'ts-row__label' }, stopChk, 'Stop'), h('div', { class: 'ts-field' }, stopInput, stopAside)),
    h('div', { class: 'ts-row' }, h('label', { class: 'ts-row__label' }, tgtChk, 'Target'), h('div', { class: 'ts-field' }, tgtInput, tgtAside)),
    h('dl', { class: 'ts-sum' },
      h('div', null, h('dt', null, 'Size'), sumCells.size),
      h('div', null, h('dt', null, 'Max loss'), sumCells.risk),
      h('div', null, h('dt', null, 'R:R'), sumCells.rr),
      h('div', null, h('dt', null, 'Value'), sumCells.notional)),
    msgList,
    h('fieldset', { class: 'ts-reasons', 'aria-label': 'Reason for the trade (keys 1 to 5)' }, h('legend', null, 'Reason'), reasonBtns),
    h('div', { class: 'ts-confirm-row' }, confirmBtn, cancelBtn));
  const ticket = h('section', { class: 'ts-card ts-ticket', 'aria-label': 'Order ticket' },
    h('h2', { class: 'ts-card__h' }, 'Order ticket'),
    h('div', { class: 'ts-quick' }, buyBtn, sellBtn, quickPos, sheetBtn),
    form);

  // Position card.
  const posBody = h('div', { class: 'ts-pos__body' });
  const posCard = h('section', { class: 'ts-card ts-pos', 'aria-label': 'Open position' }, h('h2', { class: 'ts-card__h' }, 'Position'), posBody);
  // Stats card.
  const statCells = {};
  const statDefs = [['balance', 'Balance'], ['equity', 'Equity'], ['trades', 'Trades'], ['win', 'Win rate'], ['avg', 'Avg win / loss'], ['exp', 'Expectancy'], ['dd', 'Max drawdown'], ['ret', 'Return']];
  const statsCard = h('section', { class: 'ts-card ts-stats', 'aria-label': 'Account statistics' },
    h('h2', { class: 'ts-card__h' }, 'Account'),
    h('dl', null, statDefs.map(([k, label]) => h('div', null, h('dt', null, label), (statCells[k] = h('dd', null, '—'))))));
  // Coach (Practice only).
  const coachText = h('p', { class: 'ts-coach__text', 'aria-live': 'polite' }, 'Coach tips appear here: warnings while you build an order and a comment after each trade. Ask for a read of the chart at any time.');
  const coachCard = coach
    ? h('section', { class: 'ts-card ts-coach', 'aria-label': 'Coach' },
      h('h2', { class: 'ts-card__h' }, h('span', null, 'Coach'), h('span', { class: 'chip chip--sm' }, 'Practice')),
      coachText,
      h('button', { type: 'button', class: 'btn btn--sm', 'data-action': 'coach-read', on: { click: coachRead } }, icon('eye', { size: 15 }), 'Read the chart'))
    : null;

  const side = h('aside', { class: 'ts-side' }, ticket, posCard, statsCard, coachCard);
  const main = h('section', { class: 'ts-main', 'aria-label': 'Replay chart and playback' }, tools, chartWrap, controls, keys);
  const journalHost = h('div');
  const journal = h('section', { class: 'ts-card ts-journal', 'aria-label': 'Trade journal' }, h('h2', { class: 'ts-card__h' }, 'Trade journal'), journalHost);
  const help = h('details', { class: 'ts-help ts-card' },
    h('summary', null, 'How orders fill (and keyboard keys)'),
    h('ul', null,
      h('li', null, 'Buy or Sell fills at the close of the latest bar (a market order). One position at a time.'),
      h('li', null, 'Position size = account × risk % ÷ distance from entry to stop, capped at 2× equity (buying power).'),
      h('li', null, 'Stops and targets trigger when a later bar reaches them. If a bar opens beyond your level (a gap), you are filled at that open, which can be worse than your stop.'),
      h('li', null, 'If one bar reaches both your stop and your target, the stop is assumed to fill first. That is conservative: a single candle does not show which came first.'),
      h('li', null, 'Drag the red stop line and the green target line on the chart, or type the prices. Moving a stop further away is graded as a discipline slip; moving it towards profit is fine.'),
      h('li', null, 'Keys: Space play/pause · → step one bar · [ ] speed · B buy · S sell · 1–5 reason · Enter confirm · X close · H, T, F drawing tools · Esc cancel.'),
      h('li', null, 'Scoring: 55% discipline, 45% expectancy (average R per trade), scaled down below 4 trades. A careful trader with a modest edge earns 3 stars. No commissions; virtual money only.')));

  const root = h('div', { class: 'ts', 'data-ts': '' }, head, fellBackNote, h('div', { class: 'ts-grid' }, main, side), journal, help);
  stage.append(root);

  // HUD readouts (in the shell's hudExtra slot).
  const hudEq = h('span', { class: 'ts-hud__v' });
  const hudPnl = h('span', { class: 'ts-hud__v' });
  const hudBar = h('span', { class: 'ts-hud__v' });
  const hudBox = h('div', { class: 'ts-hud' },
    h('div', { class: 'ts-hud__cell' }, h('span', { class: 'hud__label' }, 'Equity'), hudEq),
    h('div', { class: 'ts-hud__cell' }, h('span', { class: 'hud__label' }, 'Open P&L'), hudPnl),
    h('div', { class: 'ts-hud__cell ts-hud__cell--bar' }, h('span', { class: 'hud__label' }, 'Bar'), hudBar));
  g.hudExtra.replaceChildren(hudBox);
  cleanups.push(() => hudBox.remove());

  // ---------------------------------------------------------------- chart
  const narrow = () => (chartWrap.clientWidth || window.innerWidth) < 560;
  const chartHeight = () => {
    const vh = window.innerHeight || 800;
    if (narrow()) return Math.round(Math.max(250, Math.min(310, vh * 0.36)));
    return Math.round(Math.max(290, Math.min(430, vh - 420)));
  };
  const chart = new CandleChart(chartHost, {
    candles: candles.slice(0, S.cursor + 1),
    height: chartHeight(),
    showVolume: market.hasVolume,
    yPad: 0.12,
    pannable: true,
    wheelZoom: 'ctrl',
    minBars: 24,
    timeLabel: (i) => `${i + 1}`,
    ariaLabel: market.real ? 'Replay chart of a mystery real market' : 'Replay chart of a simulated market',
  });
  cleanups.push(() => chart.destroy());
  chart.addSeries({ id: 'ind-ema', values: ind.ema, color: 'ma1', label: 'EMA 20', width: 1.5, hidden: !on.ema });
  chart.addSeries({ id: 'ind-sma', values: ind.sma, color: 'ma2', label: 'SMA 50', width: 1.6, hidden: !on.sma });
  chart.addBand({ id: 'ind-bb', upper: ind.bb.upper, lower: ind.bb.lower, color: 'info', opacity: 0.07, hidden: !on.bb });
  chart.on('viewport', () => {
    if (programmatic || !following) return;
    following = false;
    followBtn.hidden = false;
  });

  const viewWidth = () => {
    const w = chartWrap.clientWidth || 800;
    return w < 560 ? 70 : w < 900 ? 100 : 120;
  };
  function follow(user = false) {
    if (user) {
      following = true;
      followBtn.hidden = true;
    }
    if (!following) return;
    const n = chart.candles.length;
    const w = viewWidth();
    const pad = Math.max(4, Math.round(w * 0.09));
    const to = n + pad;
    programmatic++;
    try {
      chart.setViewport(Math.max(0, to - w), to);
    } finally {
      programmatic--;
    }
  }
  follow();
  let lastW = chartWrap.clientWidth;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    const w = chartWrap.clientWidth;
    if (w && Math.abs(w - lastW) > 2) {
      lastW = w;
      chart.o.height = chartHeight();
      follow();
    }
  }) : null;
  ro?.observe(chartWrap);
  cleanups.push(() => ro?.disconnect());

  function toggleInd(k) {
    on[k] = !on[k];
    indBtns[k].setAttribute('aria-pressed', String(on[k]));
    sfx.click();
    if (k === 'rsi') {
      if (on.rsi) {
        chart.addPane({ id: 'rsi', title: 'RSI 14', height: narrow() ? 76 : 92, range: [0, 100], levels: [{ value: 70, color: 'bear' }, { value: 30, color: 'bull' }], series: [{ values: ind.rsi, color: 'ma3' }], decimals: 1 });
      } else chart.removePane('rsi');
      return;
    }
    chart.update(`ind-${k}`, { hidden: !on[k] });
  }

  // ---------------------------------------------------------------- drawing tools
  async function startDraw(kind) {
    if (ended) return;
    if (chart.isDrawing) {
      const same = drawing === kind;
      chart.cancelDraw();
      if (same) return;
    }
    pause();
    drawing = kind;
    for (const [k, b] of Object.entries(drawBtns)) {
      b.setAttribute('aria-pressed', String(k === kind));
      b.classList.toggle('is-drawing', k === kind);
    }
    drawHint.textContent = DRAW[kind].hint;
    drawHint.hidden = false;
    sfx.click();
    const opts = kind === 'hline'
      ? { snap: 'ohlc', color: 'accent', dashed: true }
      : kind === 'segment' ? { snap: 'ohlc', color: 'info', extend: 'right' } : { snap: 'ohlc', color: 'fib', fib: { zone: [0.5, 0.618] } };
    const shape = await chart.draw(kind, opts);
    if (dead) return;
    if (drawing === kind) {
      drawing = null;
      for (const b of Object.values(drawBtns)) {
        b.setAttribute('aria-pressed', 'false');
        b.classList.remove('is-drawing');
      }
      drawHint.hidden = true;
    }
    if (shape?.id) drawings.push(shape.id);
  }
  function clearDrawings() {
    if (chart.isDrawing) chart.cancelDraw();
    for (const id of drawings.splice(0)) chart.remove(id);
    sfx.click();
  }

  // ---------------------------------------------------------------- playback
  function setPlaying(p) {
    playing = p && !ended && !S.done;
    playBtn.setAttribute('aria-pressed', String(playing));
    playLabel.textContent = playing ? 'Pause' : 'Play';
    playIcon.replaceChildren(icon(playing ? 'pause' : 'play', { size: 18 }));
    cancelAnimationFrame(raf);
    raf = 0;
    if (playing) {
      lastT = performance.now();
      raf = requestAnimationFrame(tick);
    }
  }
  function pause() {
    if (playing) setPlaying(false);
  }
  function togglePlay() {
    if (ended) return;
    if (!playing && chart.isDrawing) chart.cancelDraw();
    if (!playing && T.side) disarm();
    setPlaying(!playing);
    sfx.click();
  }
  function tick(now) {
    raf = 0;
    if (!playing || dead) return;
    if (now - lastT >= INTERVAL[speed]) {
      lastT = now;
      advance();
    }
    if (playing) raf = requestAnimationFrame(tick);
  }
  function setSpeed(s) {
    speed = s;
    speedBtns.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s)));
    sfx.click();
  }
  function manualStep() {
    if (ended) return;
    pause();
    advance();
  }

  /** Reveal one bar: fills first, then the chart, readouts and (while armed) the ticket. */
  function advance() {
    if (ended || S.done) {
      if (S.done && !ended) finishBars();
      return;
    }
    const { idx, fill } = S.step();
    programmatic++;
    try {
      chart.append(candles[idx], { grow: !reducedMotion() });
    } finally {
      programmatic--;
    }
    follow();
    if (fill) onFill(fill);
    else if (S.position) updatePositionLines();
    if (T.side) refreshTicket();
    updateLive();
    if (S.done) finishBars();
  }

  // ---------------------------------------------------------------- order ticket
  function setSheet(open) {
    ticket.classList.toggle('is-open', !!open);
    sheetBtn.setAttribute('aria-expanded', String(!!open));
  }
  function arm(sideVal) {
    if (ended) return;
    if (S.position) {
      toast('One position at a time: close the open trade first (X).', { type: 'warn' });
      return;
    }
    if (chart.isDrawing) chart.cancelDraw();
    pause();
    const switching = T.side && T.side !== sideVal;
    if (!T.side) {
      // A fresh order starts from the safe defaults: a stop and a target (risk % is remembered).
      T.useStop = true;
      T.useTarget = true;
      stopChk.checked = true;
      tgtChk.checked = true;
    }
    T.side = sideVal;
    if (!T.stopTouched || switching || !stopOk()) T.stop = S.defaultStop(sideVal);
    if (!T.targetTouched || switching || !targetOk()) T.target = S.defaultTarget(sideVal, T.useStop ? T.stop : null);
    if (switching) T.stopTouched = T.targetTouched = false;
    buyBtn.setAttribute('aria-pressed', String(sideVal > 0));
    sellBtn.setAttribute('aria-pressed', String(sideVal < 0));
    setSheet(true);
    sfx.click();
    refreshTicket();
    if (narrow()) {
      // Keep the chart (and the lines being set) visible above the sheet.
      const top = chartWrap.getBoundingClientRect().top + window.scrollY - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 56) - 8;
      window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }
  function disarm({ keepSheet = false } = {}) {
    T.side = 0;
    T.stopTouched = T.targetTouched = false;
    buyBtn.setAttribute('aria-pressed', 'false');
    sellBtn.setAttribute('aria-pressed', 'false');
    if (!keepSheet) setSheet(false);
    if (!S.position) removeLines();
    refreshTicket();
  }
  const stopOk = () => !T.useStop || (isNum(T.stop) && (T.side > 0 ? T.stop < S.price : T.stop > S.price));
  const targetOk = () => !T.useTarget || (isNum(T.target) && (T.side > 0 ? T.target > S.price : T.target < S.price));
  function nudgeRisk(dir) {
    const cur = T.riskPct;
    const next = dir > 0 ? RISK_STEPS.find((s) => s > cur + 1e-9) ?? RISK_STEPS[RISK_STEPS.length - 1] : [...RISK_STEPS].reverse().find((s) => s < cur - 1e-9) ?? RISK_STEPS[0];
    T.riskPct = next;
    riskInput.value = String(next);
    sfx.click();
    refreshTicket();
  }
  function pickReason(id) {
    T.reason = id;
    reasonBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.reason === id)));
    sfx.click();
    refreshTicket();
  }

  riskInput.addEventListener('input', () => {
    const v = parseFloat(riskInput.value);
    if (isNum(v) && v > 0) T.riskPct = Math.min(10, v);
    refreshTicket();
  });
  riskInput.addEventListener('change', () => {
    riskInput.value = String(T.riskPct);
  });
  const priceField = (input, key) => {
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (!isNum(v)) return;
      T[key] = r2(v);
      T[`${key}Touched`] = true;
      refreshTicket({ fromInput: true });
    });
    input.addEventListener('change', () => refreshTicket());
  };
  priceField(stopInput, 'stop');
  priceField(tgtInput, 'target');
  stopChk.addEventListener('change', () => {
    T.useStop = stopChk.checked;
    if (T.side && T.useStop && !stopOk()) T.stop = S.defaultStop(T.side);
    refreshTicket();
  });
  tgtChk.addEventListener('change', () => {
    T.useTarget = tgtChk.checked;
    if (T.side && T.useTarget && !targetOk()) T.target = S.defaultTarget(T.side, T.useStop ? T.stop : null);
    refreshTicket();
  });

  /** Re-quotes the order and redraws the ticket (and the preview lines while armed). */
  function refreshTicket({ fromInput = false } = {}) {
    const flat = !S.position;
    const armed = !!T.side && flat && !ended;
    ticket.classList.toggle('is-locked', !flat || ended);
    root.classList.toggle('is-armed', armed);
    for (const b of [buyBtn, sellBtn]) {
      b.setAttribute('aria-disabled', String(!flat || ended));
    }
    const p = S.price;
    priceSmall.buy.textContent = px(p);
    priceSmall.sell.textContent = px(p);
    if (armed) {
      // Untouched defaults follow price (1.5 ATR stop, 2R target).
      if (!T.stopTouched) T.stop = S.defaultStop(T.side);
      if (!T.targetTouched) T.target = S.defaultTarget(T.side, T.useStop ? T.stop : null);
    }
    for (const el of [riskInput, stopInput, tgtInput, stopChk, tgtChk, riskDown, riskUp, ...reasonBtns]) el.disabled = !armed;
    stopInput.disabled = !armed || !T.useStop;
    tgtInput.disabled = !armed || !T.useTarget;
    if (!fromInput || document.activeElement !== stopInput) stopInput.value = armed && T.useStop && isNum(T.stop) ? T.stop.toFixed(2) : '';
    if (!fromInput || document.activeElement !== tgtInput) tgtInput.value = armed && T.useTarget && isNum(T.target) ? T.target.toFixed(2) : '';
    quote = armed ? S.quote({ side: T.side, riskPct: T.riskPct, stop: T.stop, target: T.target, useStop: T.useStop, useTarget: T.useTarget }) : null;
    const eq = S.equity;
    riskAside.textContent = money((eq * T.riskPct) / 100);
    if (quote) {
      const a = S.atrAt();
      stopAside.textContent = T.useStop && isNum(T.stop) ? `${(Math.abs(p - T.stop) / a).toFixed(1)} ATR` : 'no stop';
      tgtAside.textContent = quote.rr != null ? `${quote.rr.toFixed(1)}R` : T.useTarget ? '—' : 'no target';
      sumCells.size.textContent = quote.size > 0 ? fmt(quote.size) : '—';
      sumCells.risk.textContent = quote.size > 0 ? `${money(quote.risk)}` : '—';
      sumCells.rr.textContent = quote.rr != null ? `1 : ${quote.rr.toFixed(1)}` : '—';
      sumCells.notional.textContent = quote.size > 0 ? money(quote.notional) : '—';
      stopInput.classList.toggle('is-bad', T.useStop && !stopOk());
      tgtInput.classList.toggle('is-bad', T.useTarget && !targetOk());
    } else {
      stopAside.textContent = T.useStop ? '1.5 ATR' : 'no stop';
      tgtAside.textContent = T.useTarget ? '2R' : 'no target';
      for (const c of Object.values(sumCells)) c.textContent = '—';
      stopInput.classList.remove('is-bad');
      tgtInput.classList.remove('is-bad');
    }
    // Messages: errors always; coach warnings in Practice.
    const msgs = [];
    if (quote) {
      for (const e of quote.errors) msgs.push({ cls: 'is-error', ic: 'x', text: e });
      if (coach) for (const w of quote.warnings) msgs.push({ cls: 'is-warn', ic: 'info', text: w.text });
      if (!quote.errors.length && !T.reason) msgs.push({ cls: 'is-ok', ic: 'flag', text: 'Tag a reason so your journal shows which setups work.' });
      if (coach && !msgs.some((m) => m.cls !== 'is-ok')) msgs.push({ cls: 'is-ok', ic: 'check', text: 'Coach: stop, size and reward look sensible.' });
      if (!coach && quote.capped) msgs.push({ cls: 'is-warn', ic: 'info', text: quote.warnings.find((w) => w.id === 'capped')?.text || '' });
    } else if (!flat) {
      msgs.push({ cls: 'is-ok', ic: 'info', text: 'One position at a time: manage or close the open trade first.' });
    } else if (!ended) {
      msgs.push({ cls: 'is-ok', ic: 'info', text: 'Pick Buy or Sell to plan an order. Playback pauses while you set it up.' });
    }
    msgList.replaceChildren(...msgs.map((m) => h('li', { class: m.cls }, icon(m.ic, { size: 14 }), h('span', null, m.text))));
    // Confirm button.
    let label = 'Pick Buy or Sell';
    let ok = false;
    if (quote) {
      if (!quote.ok) label = 'Fix the order';
      else if (!T.reason) label = 'Pick a reason';
      else {
        ok = true;
        label = `${T.side > 0 ? 'Buy' : 'Sell'} ${fmt(quote.size)} @ ${px(quote.entry)}`;
      }
    } else if (!flat) label = 'Position open';
    confirmBtn.disabled = !ok;
    confirmBtn.classList.toggle('btn--bull', ok && T.side > 0);
    confirmBtn.classList.toggle('btn--bear', ok && T.side < 0);
    confirmBtn.replaceChildren(...[h('span', null, label), ok ? h('kbd', { class: 'kbd', 'aria-hidden': 'true' }, 'Enter') : null].filter(Boolean));
    cancelBtn.disabled = !armed;
    if (armed) drawPreviewLines();
  }

  // ---------------------------------------------------------------- chart lines (preview / position)
  const LINE = { stop: 'ts-stop', target: 'ts-target', entry: 'ts-entry', risk: 'ts-zone-risk', reward: 'ts-zone-reward' };
  function removeLines() {
    for (const id of Object.values(LINE)) chart.remove(id);
  }
  function upsert(id, type, spec) {
    if (chart.getOverlay(id)) chart.update(id, spec);
    else if (type === 'hline') chart.addHLine({ id, ...spec });
    else chart.addZone({ id, ...spec });
  }
  function drawPreviewLines() {
    const p = S.price;
    const x1 = S.cursor;
    if (T.useStop && isNum(T.stop)) {
      upsert(LINE.stop, 'hline', { price: T.stop, color: 'bear', dashed: true, width: 1.75, label: 'Stop', fit: true });
      upsert(LINE.risk, 'zone', { from: Math.min(p, T.stop), to: Math.max(p, T.stop), color: 'bear', opacity: 0.1, x1 });
      if (!chart.getOverlay(LINE.stop)._drag) chart.setDraggable(LINE.stop, onLineDrag('stop'));
    } else {
      chart.remove(LINE.stop);
      chart.remove(LINE.risk);
    }
    if (T.useTarget && isNum(T.target)) {
      upsert(LINE.target, 'hline', { price: T.target, color: 'bull', dashed: true, width: 1.75, label: 'Target', fit: true });
      upsert(LINE.reward, 'zone', { from: Math.min(p, T.target), to: Math.max(p, T.target), color: 'bull', opacity: 0.09, x1 });
      if (!chart.getOverlay(LINE.target)._drag) chart.setDraggable(LINE.target, onLineDrag('target'));
    } else {
      chart.remove(LINE.target);
      chart.remove(LINE.reward);
    }
  }
  function updatePositionLines() {
    const pos = S.position;
    if (!pos) return;
    const x1 = pos.entryIdx;
    upsert(LINE.entry, 'hline', { price: pos.entry, color: 'text-3', dashed: '3 3', width: 1.25, label: 'Entry', from: pos.entryIdx, fit: true });
    if (isNum(pos.stop)) {
      upsert(LINE.stop, 'hline', { price: pos.stop, color: 'bear', dashed: false, width: 1.75, label: 'Stop', fit: true });
      upsert(LINE.risk, 'zone', { from: Math.min(pos.entry, pos.stop), to: Math.max(pos.entry, pos.stop), color: 'bear', opacity: 0.1, x1 });
      if (!chart.getOverlay(LINE.stop)._drag) chart.setDraggable(LINE.stop, onLineDrag('stop'));
    } else {
      chart.remove(LINE.stop);
      chart.remove(LINE.risk);
    }
    if (isNum(pos.target)) {
      upsert(LINE.target, 'hline', { price: pos.target, color: 'bull', dashed: false, width: 1.75, label: 'Target', fit: true });
      upsert(LINE.reward, 'zone', { from: Math.min(pos.entry, pos.target), to: Math.max(pos.entry, pos.target), color: 'bull', opacity: 0.09, x1 });
      if (!chart.getOverlay(LINE.target)._drag) chart.setDraggable(LINE.target, onLineDrag('target'));
    } else {
      chart.remove(LINE.target);
      chart.remove(LINE.reward);
    }
  }
  /** Drag handler for the stop / target line (preview while armed, live order while in a trade). */
  function onLineDrag(which) {
    return (spec, { phase }) => {
      if (dead) return;
      const id = which === 'stop' ? LINE.stop : LINE.target;
      const zone = which === 'stop' ? LINE.risk : LINE.reward;
      const price = r2(spec.price);
      const pos = S.position;
      const ref = pos ? pos.entry : S.price;
      if (phase === 'move') {
        if (spec.fit) chart.update(id, { fit: false }); // no rescaling under the finger
        chart.update(zone, { from: Math.min(ref, price), to: Math.max(ref, price) });
        if (!pos && T.side) {
          T[which] = price;
          T[`${which}Touched`] = true;
          refreshTicket();
        }
        return;
      }
      pause();
      if (pos) {
        const res = which === 'stop' ? S.setStop(price) : S.setTarget(price);
        if (!res.ok) {
          toast(res.error, { type: 'warn' });
          sfx.wrong();
        } else if (res.widened) {
          if (coach) coachSay('You moved the stop further away. That raises the risk you planned; the report card counts it as a discipline slip.');
          liveMsg.textContent = `Stop widened to ${px(price)}.`;
        } else {
          liveMsg.textContent = `${which === 'stop' ? 'Stop' : 'Target'} moved to ${px(price)}.`;
        }
        chart.update(id, { fit: true });
        updatePositionLines();
        renderPosition();
        updateLive();
      } else if (T.side) {
        T[which] = price;
        T[`${which}Touched`] = true;
        chart.update(id, { fit: true });
        refreshTicket();
      }
    };
  }

  function confirmOrder() {
    if (ended || !T.side || !quote?.ok || !T.reason) return;
    const res = S.open({ side: T.side, riskPct: T.riskPct, stop: T.stop, target: T.target, useStop: T.useStop, useTarget: T.useTarget, reason: T.reason });
    if (!res.ok) {
      toast(res.error, { type: 'warn' });
      return;
    }
    const t = res.trade;
    sfx.whoosh();
    chart.addMarker({ id: `ts-in-${t.id}`, idx: t.entryIdx, price: t.entry, position: t.side > 0 ? 'below' : 'above', color: t.side > 0 ? 'bull' : 'bear', text: t.side > 0 ? 'Buy' : 'Sell' });
    removeLines();
    const reasonKept = T.reason;
    T.side = 0;
    T.stopTouched = T.targetTouched = false;
    buyBtn.setAttribute('aria-pressed', 'false');
    sellBtn.setAttribute('aria-pressed', 'false');
    setSheet(false);
    updatePositionLines();
    showFloat(`${t.side > 0 ? 'Bought' : 'Sold'} ${fmt(t.size)} @ ${px(t.entry)}`, `${reasonLabel(reasonKept)} · risking ${money(t.risk)} (${t.riskPct.toFixed(1)}%)`, '');
    liveMsg.textContent = `${t.side > 0 ? 'Bought' : 'Sold short'} ${t.size} at ${px(t.entry)}.`;
    if (coach && res.quote.warnings.length) coachSay(`Trade placed with ${res.quote.warnings.length} warning${res.quote.warnings.length > 1 ? 's' : ''}: ${res.quote.warnings.map((w) => w.text).join(' ')}`);
    else if (coach) coachSay('Trade placed. Now let the plan work: the stop and target are on the chart. Drag the stop only towards profit.');
    refreshTicket();
    renderPosition();
    updateLive();
  }

  function closePosition() {
    if (!S.position || ended) return;
    const t = S.close('manual');
    if (t) onFill(t);
    updateLive();
  }
  function stopToBreakeven() {
    const pos = S.position;
    if (!pos) return;
    const res = S.setStop(pos.entry);
    if (!res.ok) {
      toast('Price must be beyond your entry before the stop can go to breakeven.', { type: 'warn' });
      return;
    }
    sfx.click();
    liveMsg.textContent = `Stop moved to breakeven at ${px(pos.entry)}.`;
    updatePositionLines();
    renderPosition();
  }

  /** A trade closed (stop, target, manual or end): markers, float, sound, journal, coach. */
  function onFill(t) {
    removeLines();
    const win = t.pnl > 0;
    const col = t.pnl > 0 ? 'bull' : t.pnl < 0 ? 'bear' : 'muted';
    chart.addSegment({ id: `ts-path-${t.id}`, a: { idx: t.entryIdx, price: t.entry }, b: { idx: t.exitIdx, price: t.exit }, color: col, width: 1.25, dashed: '4 3' });
    chart.addMarker({ id: `ts-out-${t.id}`, idx: t.exitIdx, price: t.exit, position: 'at', shape: 'dot', color: col, text: fmtR(t.r, 1) });
    chart.flash(t.exitIdx, col === 'muted' ? 'accent' : col);
    const why = t.exitType === 'stop' ? (t.gap ? 'Gapped through the stop' : t.both ? 'Stop hit (bar reached both: stop first)' : 'Stopped out')
      : t.exitType === 'target' ? (t.gap ? 'Gapped past the target' : 'Target hit') : t.exitType === 'end' ? 'Closed at session end' : 'Closed';
    showFloat(`${fmtR(t.r, 1)} · ${money(t.pnl, { sign: true })}`, `${why} at ${px(t.exit)}`, win ? 'is-win' : t.pnl < 0 ? 'is-loss' : '');
    liveMsg.textContent = `${why} at ${px(t.exit)}: ${fmtR(t.r, 1)}, ${money(t.pnl, { sign: true })}.`;
    if (win) sfx.correct();
    else if (t.pnl < 0) sfx.wrong();
    lastJournalId = t.id;
    renderJournal();
    renderPosition();
    renderStats();
    refreshTicket();
    if (coach) coachSay(tradeComment(t));
  }

  function tradeComment(t) {
    if (t.exitType === 'stop' && t.gap) return 'The bar opened beyond your stop, so it filled at the open, a bigger loss than planned. Gaps are why risk per trade stays small.';
    if (t.exitType === 'stop' && t.againstTrend) return 'Stopped out on a trade against the 50 SMA trend. Trades with the bigger trend fail less often.';
    if (t.exitType === 'stop' && t.tightStop) return 'Stopped out: the stop sat inside normal noise (under half an ATR). Give the trade room, and size down to keep the same risk.';
    if (t.exitType === 'stop' && t.widened) return 'Stopped out after the stop was widened: the loss grew beyond the plan. Next time take the planned 1R loss.';
    if (t.exitType === 'stop') return 'A planned loss. That is what the stop is for: one R, then on to the next setup. Check whether the setup was valid, not whether it won.';
    if (t.exitType === 'target') return `Target hit: ${fmtR(t.r, 1)}. Note what the setup looked like when you entered. Repeatable setups build expectancy.`;
    if (t.r < 0) return 'You closed a losing trade by hand. Fine if the reason for the trade broke; if it was nerves, let the stop do its job.';
    if (t.r < 1 && t.targetUsed) return `Closed early at ${fmtR(t.r, 1)}, short of the target. Small wins against full-size losses drag expectancy down.`;
    return `Closed at ${fmtR(t.r, 1)}. Managing a winner by hand works when you have a rule for it (a broken trend line, a close under the 20 EMA).`;
  }
  function coachSay(text) {
    if (!coach) return;
    coachText.textContent = text;
  }
  function coachRead() {
    const vis = candles.slice(0, S.cursor + 1);
    let summary = '';
    try {
      summary = describeChart(vis, { decimals: 2 }).summary;
    } catch (err) {
      console.warn('[trade-simulator] chart read failed', err);
      summary = 'No read available right now.';
    }
    const tr = S.trendAt();
    const extra = tr === 'up' ? ' The 50 SMA rises under price: favour buys on pullbacks.' : tr === 'down' ? ' The 50 SMA falls above price: favour sells on rallies.' : ' The 50 SMA is flat: expect a range, or wait for a breakout.';
    coachText.textContent = summary + extra;
    sfx.click();
  }

  let floatEl = null;
  function showFloat(main, sub, cls) {
    floatEl?.remove();
    clearTimeout(floatTimer);
    floatEl = h('div', { class: ['ts-float', cls], 'aria-hidden': 'true' }, h('strong', null, main), sub ? h('span', null, sub) : null);
    chartWrap.append(floatEl);
    floatTimer = setTimeout(() => {
      floatEl?.remove();
      floatEl = null;
    }, 2700);
  }

  // ---------------------------------------------------------------- readouts
  function renderPosition() {
    const pos = S.position;
    root.classList.toggle('has-pos', !!pos);
    if (!pos) {
      posBody.replaceChildren(h('p', { class: 'ts-pos__empty' }, ended ? 'Session over.' : 'No open position. Plan an order in the ticket: the stop (red) and target (green) appear on the chart, and you can drag them.'));
      qpText.replaceChildren();
      return;
    }
    const pnl = S.openPnl;
    const r = S.openR;
    const canBE = (S.price - pos.entry) * pos.side > 0 && (!isNum(pos.stop) || (pos.stop - pos.entry) * pos.side < 0);
    posBody.replaceChildren(
      h('div', { class: 'ts-pos__top' },
        h('span', { class: `chip ${pos.side > 0 ? 'chip--bull' : 'chip--bear'}` }, pos.side > 0 ? 'Long' : 'Short'),
        h('span', { class: 'mono' }, `${fmt(pos.size)} @ ${px(pos.entry)}`),
        h('span', { class: 'faint' }, `· ${reasonLabel(pos.reason)}`)),
      h('div', { class: ['ts-pos__pnl', pnl >= 0 ? 'up' : 'down'], 'data-live': 'pnl' }, money(pnl, { sign: true }), h('small', null, fmtR(r))),
      h('dl', { class: 'ts-pos__lv' },
        h('div', null, h('dt', null, 'Stop'), h('dd', { class: 'down' }, isNum(pos.stop) ? px(pos.stop) : 'none')),
        h('div', null, h('dt', null, 'Target'), h('dd', { class: 'up' }, isNum(pos.target) ? px(pos.target) : 'none')),
        h('div', null, h('dt', null, 'Risk'), h('dd', null, `${pos.riskPct.toFixed(1)}%`))),
      h('div', { class: 'ts-pos__btns' },
        h('button', { type: 'button', class: 'btn btn--sm', 'data-action': 'breakeven', disabled: !canBE, on: { click: stopToBreakeven } }, icon('shield', { size: 15 }), 'Stop to breakeven'),
        h('button', { type: 'button', class: 'btn btn--sm', 'data-action': 'close-trade', on: { click: closePosition } }, icon('x', { size: 15 }), 'Close', h('kbd', { class: 'kbd', 'aria-hidden': 'true' }, 'X'))));
    qpText.replaceChildren(h('span', null, `${pos.side > 0 ? 'Long' : 'Short'} ${fmt(pos.size)} @ ${px(pos.entry)}`), h('b', { class: pnl >= 0 ? 'up' : 'down' }, `${money(pnl, { sign: true })} · ${fmtR(r)}`));
  }
  function renderStats() {
    const st = S.stats();
    statCells.balance.textContent = money(S.balance);
    statCells.equity.textContent = money(S.equity);
    statCells.trades.textContent = String(st.trades);
    statCells.win.textContent = st.trades ? `${Math.round(st.winRate * 100)}%` : '—';
    statCells.avg.textContent = st.trades ? `${st.wins ? fmtR(st.avgWinR, 1) : '—'} / ${st.losses ? fmtR(st.avgLossR, 1) : '—'}` : '—';
    statCells.exp.textContent = st.trades ? `${fmtR(st.expectancyR)} / trade` : '—';
    statCells.dd.textContent = `${st.maxDrawdownPct.toFixed(1)}%`;
    statCells.ret.textContent = pctText(st.returnPct, 2);
    statCells.ret.className = st.returnPct >= 0 ? 'up' : 'down';
  }
  function renderJournal() {
    if (!S.trades.length) {
      journalHost.replaceChildren(h('p', { class: 'ts-journal__empty' }, 'No trades yet. Each closed trade lands here with its reason and its result in R (profit or loss divided by the amount you risked).'));
      return;
    }
    journalHost.replaceChildren(journalTable(S.trades, { newestFirst: true, highlightId: reducedMotion() ? null : lastJournalId }));
    lastJournalId = null;
  }
  /** Per-bar readouts (text only: fixed-size slots, so nothing shifts while playing). */
  function updateLive() {
    const eq = S.equity;
    const pnl = S.openPnl;
    hudEq.textContent = money(eq);
    hudPnl.className = `ts-hud__v ${pnl > 0.004 ? 'up' : pnl < -0.004 ? 'down' : ''}`;
    if (S.position) hudPnl.replaceChildren(money(pnl, { sign: true }), h('small', null, fmtR(S.openR, 1)));
    else hudPnl.replaceChildren('—');
    hudBar.textContent = `${S.cursor + 1}/${N}`;
    barText.textContent = `Bar ${S.cursor + 1}/${N}`;
    leftText.textContent = S.done ? 'last bar' : `${S.barsLeft} left`;
    const frac = (S.cursor + 1 - START_VISIBLE) / Math.max(1, N - START_VISIBLE);
    progFill.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
    if (S.position) {
      const pnlEl = posBody.querySelector('[data-live="pnl"]');
      if (pnlEl) {
        pnlEl.className = `ts-pos__pnl ${pnl >= 0 ? 'up' : 'down'}`;
        pnlEl.replaceChildren(money(pnl, { sign: true }), h('small', null, fmtR(S.openR)));
      }
      const b = qpText.querySelector('b');
      if (b) {
        b.className = pnl >= 0 ? 'up' : 'down';
        b.textContent = `${money(pnl, { sign: true })} · ${fmtR(S.openR)}`;
      }
      const be = posBody.querySelector('[data-action="breakeven"]');
      if (be) be.disabled = !((S.price - S.position.entry) * S.position.side > 0 && (!isNum(S.position.stop) || (S.position.stop - S.position.entry) * S.position.side < 0));
    }
    renderStats();
    if (!T.side) {
      priceSmall.buy.textContent = px(S.price);
      priceSmall.sell.textContent = px(S.price);
    }
  }

  // ---------------------------------------------------------------- ending
  function finishBars() {
    if (ended) return;
    setPlaying(false);
    if (S.position) {
      const t = S.end();
      if (t) onFill(t);
    } else S.end();
    ended = true;
    if (chart.isDrawing) chart.cancelDraw();
    disarm();
    renderPosition();
    updateLive();
    for (const b of [playBtn, stepBtn, ...speedBtns]) b.disabled = true;
    const reportBtn = h('button', { type: 'button', class: 'btn btn--primary btn--lg', 'data-action': 'report', on: { click: () => endSession() } }, icon('trophy', { size: 18 }), 'See your report card');
    chartWrap.append(h('div', { class: 'ts-endcard', role: 'dialog', 'aria-label': 'Session complete' },
      h('div', { class: 'ts-endcard__box' },
        h('h3', null, 'Last bar reached'),
        h('p', null, `Final equity ${money(S.equity)} (${pctText(S.stats().returnPct, 2)}). Any open trade was closed at the last price.`),
        reportBtn,
        kbdHint('Enter', 'report card'))));
    requestAnimationFrame(() => reportBtn.isConnected && reportBtn.focus({ preventScroll: true }));
  }
  function askEnd() {
    if (dead) return;
    if (ended) {
      endSession();
      return;
    }
    pause();
    modalApi = modal({
      title: 'End the session?',
      body: h('p', null, S.position
        ? `Your open ${S.position.side > 0 ? 'long' : 'short'} closes at the last price (${px(S.price)}). Then you get your report card.`
        : `${S.barsLeft} bars are left. Your report card grades the trades you have taken so far.`),
      actions: [
        { label: 'Keep trading' },
        { label: 'End session', primary: true, onClick: () => endSession() },
      ],
      onClose: () => {
        modalApi = null;
      },
    });
  }
  function endSession() {
    if (dead) return;
    setPlaying(false);
    if (!ended && S.position) {
      const t = S.end();
      if (t) onFill(t);
    } else S.end();
    ended = true;
    const score = S.score();
    const marketMove = ((candles[S.cursor].c - candles[S.startIdx].c) / candles[S.startIdx].c) * 100;
    let bestPrev = null;
    try {
      bestPrev = g.store?.getGamePref?.(ID, 'bestSession', null);
    } catch {
      bestPrev = null;
    }
    const st = score.stats;
    const isBest = st.trades > 0 && (!bestPrev || !(score.total <= bestPrev.score));
    if (isBest) {
      try {
        g.store?.setGamePref?.(ID, 'bestSession', { score: score.total, returnPct: +st.returnPct.toFixed(2), expectancyR: +st.expectancyR.toFixed(3), trades: st.trades, preset: market.preset, at: Date.now() });
      } catch {
        /* storage blocked: the shell still records the best score */
      }
    }
    done({
      score,
      trades: S.trades.slice(),
      curve: S.curve.slice(),
      startBalance: START_BALANCE,
      preset: market.preset,
      surprise: !!market.surprise,
      real: market.real,
      fellBack: !!market.fellBack,
      marketMove,
      barsTraded: S.cursor + 1 - START_VISIBLE,
      period: market.real ? `${intervalLabel(market.real.interval)} candles from ${formatMarketDate(candles[0].t, market.real.interval)} to ${formatMarketDate(candles[N - 1].t, market.real.interval)}` : null,
      isBestSession: isBest,
    });
    g.award(score.total, { reason: 'session' });
    g.finish();
  }

  // ---------------------------------------------------------------- keyboard
  function onKeyCapture(e) {
    if (dead || g.state !== 'play' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.body.classList.contains('has-modal')) return;
    const t = e.target;
    if (e.key === ' ' && !isTyping(t) && !(t?.tagName === 'SUMMARY')) {
      // Space always plays / pauses (even on a focused button, which would otherwise click).
      if (ended || chart.isDrawing) return;
      e.preventDefault();
      e.stopPropagation();
      spaceConsumed = true;
      if (!e.repeat) togglePlay();
      return;
    }
    if (e.key === 'ArrowRight' && !isTyping(t) && !chart.isDrawing && !ended) {
      e.preventDefault();
      e.stopPropagation();
      manualStep();
    }
  }
  function onKeyUpCapture(e) {
    if (e.key === ' ' && spaceConsumed) {
      spaceConsumed = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }
  function onKey(e) {
    if (dead || g.state !== 'play' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.body.classList.contains('has-modal')) return;
    const t = e.target;
    const k = e.key;
    if (k === 'Escape') {
      if (chart.isDrawing) chart.cancelDraw();
      else if (T.side) disarm();
      else return;
      e.preventDefault();
      return;
    }
    if (isTyping(t)) {
      if (k === 'Enter') {
        t.blur();
        e.preventDefault();
      }
      return;
    }
    if (ended) {
      if (k === 'Enter' && !isControl(t)) {
        e.preventDefault();
        endSession();
      }
      return;
    }
    if (chart.isDrawing) return;
    const lower = k.length === 1 ? k.toLowerCase() : k;
    switch (lower) {
      case 'b':
        arm(1);
        break;
      case 's':
        arm(-1);
        break;
      case 'x':
        closePosition();
        break;
      case 'h':
        startDraw('hline');
        break;
      case 't':
        startDraw('segment');
        break;
      case 'f':
        startDraw('fib');
        break;
      case '[':
        setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(speed) - 1)]);
        break;
      case ']':
        setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed) + 1)]);
        break;
      case 'Enter':
        if (!T.side || isControl(t)) return;
        confirmOrder();
        break;
      default:
        if (/^[1-5]$/.test(k) && T.side) {
          pickReason(REASONS[Number(k) - 1].id);
          break;
        }
        return;
    }
    e.preventDefault();
  }
  document.addEventListener('keydown', onKeyCapture, true);
  document.addEventListener('keyup', onKeyUpCapture, true);
  document.addEventListener('keydown', onKey);
  cleanups.push(() => {
    document.removeEventListener('keydown', onKeyCapture, true);
    document.removeEventListener('keyup', onKeyUpCapture, true);
    document.removeEventListener('keydown', onKey);
  });

  // ---------------------------------------------------------------- go
  renderPosition();
  renderStats();
  renderJournal();
  refreshTicket();
  updateLive();
  if (coach) coachSay(`Practice with a coach (${g.level || 'normal'} market). Press Play or step through the bars, then plan a trade: the coach flags risky orders before you confirm.`);
  liveMsg.textContent = `${N - START_VISIBLE} bars to trade. Press Space to play.`;
  requestAnimationFrame(() => {
    if (!dead && playBtn.isConnected && !isControl(document.activeElement)) playBtn.focus({ preventScroll: true });
  });
}

// ------------------------------------------------------------------------------ module

export default {
  id: ID,
  mount(root, ctx) {
    root.classList.add('trade-sim');
    const style = h('style', { 'data-module': ID }, CSS);
    document.head.append(style);
    let report = null;
    const game = new GameShell(root, ctx, {
      rounds: null,
      maxScore: 1000,
      modes: PRESETS.map((p) => ({ id: p.id, label: p.label, description: p.blurb })),
      howTo: [
        'Replay a market bar by bar: Space plays or pauses, → steps one bar, 1x / 2x / 4x sets the speed. The first 80 bars are your history.',
        'Plan a trade: Buy or Sell at the latest close, set your risk %, then drag the red stop and green target lines (defaults: 1.5 ATR stop, 2R target). Tag a reason and confirm.',
        'Stops and targets fill when a later bar reaches them; gaps fill at the open, and a bar that hits both counts as a stop. One position at a time.',
        'End any time. Your report card grades discipline and expectancy, not just profit: a careful trader earns 3 stars even with a modest return. Virtual $10,000; not financial advice.',
      ],
      preview: (el) => drawPreview(el, ctx?.store),
      onStart() {
        report = null;
      },
      onRound(g, args) {
        return runSession(g, args, (r) => {
          report = r;
        });
      },
      onEnd(g, summary) {
        // "Best streak" means nothing in a simulator: the report card replaces it.
        summary.el?.closest('.results')?.querySelectorAll('.results__stats .stat').forEach((s) => {
          if (s.querySelector('.stat__label')?.textContent === 'Best streak') s.remove();
        });
        if (!report) return null;
        const r = report;
        report = null;
        return renderReport(r, { revealReal: (into) => g.revealSource({ ...r.real, decisionIdx: 0 }, { into, title: 'Mystery market revealed' }) });
      },
    });
    const introCleanup = setupIntro(root, game);
    return () => {
      introCleanup();
      game.destroy();
      style.remove();
      root.classList.remove('trade-sim');
    };
  },
};
