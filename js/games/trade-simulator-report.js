// Trade Simulator — report card (private helper of js/games/trade-simulator.js): the stats, the
// equity curve (inline SVG, token colours), the score breakdown and the behaviour feedback that
// the GameShell results screen shows under the stars.

import { h, svg, icon, fmt } from '../core/ui.js';
import { meter } from '../core/ui.js';
import { reasonLabel } from './trade-simulator-engine.js';
import { presetLabel } from './trade-simulator-market.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const money = (v, { sign = false } = {}) => {
  const s = sign ? (v > 0.004 ? '+' : v < -0.004 ? '−' : '') : v < -0.004 ? '−' : '';
  return `${s}$${fmt(Math.abs(v), 2)}`;
};
export const fmtR = (r, d = 2) => `${r > 0.004 ? '+' : r < -0.004 ? '−' : ''}${Math.abs(r).toFixed(d)}R`;
export const pctText = (v, d = 1) => `${v > 0.004 ? '+' : v < -0.004 ? '−' : ''}${Math.abs(v).toFixed(d)}%`;
export const EXIT_TEXT = { stop: 'Stop', target: 'Target', manual: 'Closed', end: 'Session end' };

/** Equity curve: equity by bar with the $10,000 start line, the deepest drawdown and trade exits. */
export function equityCurve(curve, trades, { startBalance = 10000, width = 640, height = 190 } = {}) {
  const W = width;
  const H = height;
  const padL = 58;
  const padR = 12;
  const padT = 14;
  const padB = 24;
  const pts = curve.filter((p) => isNum(p.equity));
  if (pts.length < 2) pts.push({ idx: (pts[0]?.idx ?? 0) + 1, equity: pts[0]?.equity ?? startBalance });
  const x0 = pts[0].idx;
  const x1 = pts[pts.length - 1].idx;
  let lo = Math.min(startBalance, ...pts.map((p) => p.equity));
  let hi = Math.max(startBalance, ...pts.map((p) => p.equity));
  const span = hi - lo || startBalance * 0.01;
  lo -= span * 0.12;
  hi += span * 0.12;
  const X = (i) => padL + ((i - x0) / Math.max(1, x1 - x0)) * (W - padL - padR);
  const Y = (v) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.idx).toFixed(1)},${Y(p.equity).toFixed(1)}`).join('');
  const base = Y(startBalance);
  // Deepest drawdown: from the running peak to the lowest point after it.
  let peak = pts[0];
  let dd = { from: null, to: null, depth: 0 };
  for (const p of pts) {
    if (p.equity > peak.equity) peak = p;
    const depth = peak.equity - p.equity;
    if (depth > dd.depth) dd = { from: peak, to: p, depth };
  }
  const last = pts[pts.length - 1];
  const up = last.equity >= startBalance;
  const tick = (v) => `$${fmt(v, 0)}`;
  const children = [
    svg('rect', { x: padL, y: padT, width: W - padL - padR, height: H - padT - padB, fill: 'var(--surface-2)', opacity: 0.45, rx: 4 }),
    // area between the curve and the start line
    svg('path', { d: `${d}L${X(last.idx).toFixed(1)},${base.toFixed(1)}L${X(pts[0].idx).toFixed(1)},${base.toFixed(1)}Z`, fill: up ? 'var(--bull)' : 'var(--bear)', opacity: 0.1 }),
    svg('line', { x1: padL, x2: W - padR, y1: base, y2: base, stroke: 'var(--muted)', 'stroke-width': 1, 'stroke-dasharray': '4 4' }),
    svg('text', { x: padL - 6, y: base + 4, 'text-anchor': 'end', fill: 'var(--text-3)', 'font-size': 11, 'font-family': 'var(--font-mono)' }, tick(startBalance)),
    svg('text', { x: padL - 6, y: padT + 10, 'text-anchor': 'end', fill: 'var(--text-3)', 'font-size': 11, 'font-family': 'var(--font-mono)' }, tick(hi - (hi - lo) * 0.02)),
    svg('text', { x: padL - 6, y: H - padB, 'text-anchor': 'end', fill: 'var(--text-3)', 'font-size': 11, 'font-family': 'var(--font-mono)' }, tick(lo + (hi - lo) * 0.02)),
    svg('text', { x: padL, y: H - 6, fill: 'var(--text-3)', 'font-size': 11, 'font-family': 'var(--font-mono)' }, `Bar ${x0 + 1}`),
    svg('text', { x: W - padR, y: H - 6, 'text-anchor': 'end', fill: 'var(--text-3)', 'font-size': 11, 'font-family': 'var(--font-mono)' }, `Bar ${x1 + 1}`),
  ];
  if (dd.depth > 0 && dd.from && dd.to) {
    const xa = X(dd.from.idx);
    const xb = X(dd.to.idx);
    children.push(
      svg('rect', { x: xa, y: Y(dd.from.equity), width: Math.max(2, xb - xa), height: Math.max(1, Y(dd.to.equity) - Y(dd.from.equity)), fill: 'var(--bear)', opacity: 0.12 }),
      svg('text', { x: Math.min(W - padR - 4, Math.max(padL + 4, (xa + xb) / 2)), y: Math.min(H - padB - 4, Y(dd.to.equity) + 14), 'text-anchor': 'middle', fill: 'var(--bear-strong)', 'font-size': 11, 'font-weight': 600 }, 'Max drawdown'),
    );
  }
  children.push(svg('path', { d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  for (const t of trades) {
    const p = pts.find((q) => q.idx === t.exitIdx);
    if (!p) continue;
    children.push(svg('circle', { cx: X(p.idx), cy: Y(p.equity), r: 3.5, fill: t.pnl >= 0 ? 'var(--bull)' : 'var(--bear)', stroke: 'var(--surface)', 'stroke-width': 1.5 }));
  }
  children.push(svg('circle', { cx: X(last.idx), cy: Y(last.equity), r: 4.5, fill: 'var(--accent)', stroke: 'var(--surface)', 'stroke-width': 2 }));
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `Equity curve from ${money(startBalance)} to ${money(last.equity)}` }, children);
}

/** Trade journal table (newest first when `newestFirst`). */
export function journalTable(trades, { newestFirst = false, highlightId = null } = {}) {
  const rows = (newestFirst ? [...trades].reverse() : trades).map((t) => h('tr', { class: t.id === highlightId ? 'is-new' : null },
    h('td', { class: 'num' }, String(t.id)),
    h('td', null, h('span', { class: `chip chip--sm ${t.side > 0 ? 'chip--bull' : 'chip--bear'}` }, t.side > 0 ? 'Buy' : 'Sell')),
    h('td', null, reasonLabel(t.reason)),
    h('td', { class: 'num' }, t.entry.toFixed(2)),
    h('td', { class: 'num' }, t.exit.toFixed(2)),
    h('td', null, `${EXIT_TEXT[t.exitType] || t.exitType}${t.gap ? ' (gap)' : ''}${!t.stopUsed ? ' · no stop' : ''}`),
    h('td', { class: ['num', t.r >= 0 ? 'up' : 'down'] }, fmtR(t.r)),
    h('td', { class: ['num', t.pnl >= 0 ? 'up' : 'down'] }, money(t.pnl, { sign: true }))));
  return h('div', { class: 'table-scroll' }, h('table', { class: 'data-table' },
    h('thead', null, h('tr', null, ['#', 'Side', 'Reason', 'Entry', 'Exit', 'Result', 'R', '$'].map((c, i) => h('th', { scope: 'col', class: i === 0 || i >= 3 && i !== 5 ? 'num' : null }, c)))),
    h('tbody', null, rows)));
}

const stat = (label, value, cls = '') => h('div', { class: 'stat' }, h('span', { class: 'stat__label' }, label), h('span', { class: ['stat__value', cls] }, value));

function scoreMeter(label, value, note) {
  return h('div', { class: 'tsr__meter' },
    h('div', { class: 'tsr__meter-top' }, h('span', null, label), h('b', null, `${Math.round(value * 100)}%`)),
    meter(value, { label: `${label} ${Math.round(value * 100)}%`, size: 'sm' }),
    h('small', null, note));
}

/**
 * The report card. report: { score: TradeSession.score(), trades, curve, startBalance, preset,
 * surprise, real, fellBack, marketMove, barsTraded, bestSession, isBestSession }.
 * revealReal(el): shows the real market's name (GameShell.revealSource) inside `el`.
 */
export function renderReport(report, { revealReal = null } = {}) {
  const S = report.score;
  const st = S.stats;
  const fb = S.feedback;
  const el = h('section', { class: 'tsr', 'aria-label': 'Report card' });

  // Which market was it?
  const market = h('div', { class: 'tsr__market' });
  if (report.real) {
    revealReal?.(market);
    if (report.period) market.append(h('p', null, `${report.period}.`));
    market.append(h('p', null, `${report.barsTraded} candles traded. Prices were rebased so the first candle opened at 100.00, so every percentage move is exactly what the real market did.`));
  } else {
    market.append(h('p', null,
      h('strong', null, report.surprise ? `Surprise market: ${presetLabel(report.preset)}. ` : `${presetLabel(report.preset)} market. `),
      report.fellBack ? 'No real market data could be loaded, so this was a simulated market. ' : '',
      `Simulated prices, ${report.barsTraded} bars traded.`));
  }
  market.append(h('p', null, `Buy and hold over the same bars: ${pctText(report.marketMove)}. Your account: ${pctText(st.returnPct, 2)}.`));

  const scoreBox = h('div', null,
    h('h3', null, `Session score ${fmt(S.total)} / 1,000`),
    h('div', { class: 'tsr__score' },
      scoreMeter('Discipline', S.discipline, '55% of the score'),
      scoreMeter('Expectancy', S.expectancy, st.trades ? `${fmtR(st.expectancyR)} per trade · 45%` : 'No trades'),
      scoreMeter('Sample size', S.activity, st.trades >= 4 ? `${st.trades} trades` : `${st.trades} of 4 trades needed`)));

  const pf = st.profitFactor;
  const stats = h('div', null,
    h('h3', null, 'Results'),
    h('div', { class: 'tsr__stats' },
      stat('Return', pctText(st.returnPct, 2), st.returnPct >= 0 ? 'up' : 'down'),
      stat('Trades', String(st.trades)),
      stat('Win rate', st.trades ? `${Math.round(st.winRate * 100)}%` : '—'),
      stat('Expectancy', st.trades ? fmtR(st.expectancyR) : '—', st.expectancyR >= 0 ? 'up' : 'down'),
      stat('Avg win', st.wins ? fmtR(st.avgWinR) : '—', 'up'),
      stat('Avg loss', st.losses ? fmtR(st.avgLossR) : '—', 'down'),
      stat('Max drawdown', `${st.maxDrawdownPct.toFixed(1)}%`),
      stat('Profit factor', pf == null ? '—' : pf === Infinity ? 'No losses' : pf.toFixed(2))));

  const curve = h('figure', { class: 'tsr__curve', style: { margin: 0 } },
    equityCurve(report.curve, report.trades, { startBalance: report.startBalance }),
    h('figcaption', null, `Equity curve: ${money(report.startBalance)} → ${money(st.equity)}. Dots mark closed trades (green win, red loss); the shaded box is the deepest drawdown.`));

  const items = [
    ...fb.flags.map((f) => h('li', { class: 'is-flag' }, icon('x', { size: 16 }), h('div', null, h('strong', null, f.title), h('span', null, f.detail)))),
    ...fb.positives.map((f) => h('li', { class: 'is-good' }, icon('check', { size: 16 }), h('div', null, h('strong', null, f.title), h('span', null, f.detail)))),
    ...fb.notes.map((f) => h('li', { class: 'is-note' }, icon('info', { size: 16 }), h('div', null, h('strong', null, f.title), h('span', null, f.detail)))),
  ];
  const feedback = h('div', null,
    h('h3', null, 'Discipline feedback'),
    h('ul', { class: 'tsr__fb' }, items.length ? items : [h('li', { class: 'is-note' }, icon('info', { size: 16 }), h('div', null, h('span', null, 'Nothing to flag.')))]));

  const journal = report.trades.length
    ? h('details', { open: report.trades.length <= 6 ? true : null },
      h('summary', null, `Trade journal (${report.trades.length})`),
      journalTable(report.trades))
    : null;

  el.append(
    h('div', null, h('h3', null, 'Report card'), market),
    scoreBox,
    stats,
    curve,
    feedback,
    journal,
    h('p', { class: 'tsr__nfa' }, report.real
      ? 'Real historical prices (rebased), replayed for practice. Past prices do not predict future ones. Not financial advice.'
      : 'Not financial advice — simulated prices and a virtual $10,000 account.'));
  return el;
}
