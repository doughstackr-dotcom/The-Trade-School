// Visual contact sheet for js/core/patterns.js (see patterns.html). Not part of the app.
import {
  CANDLE_PATTERNS,
  CANDLE_PATTERN_IDS,
  CHART_PATTERNS,
  CHART_PATTERN_IDS,
  candleScenario,
  chartScenario,
  checkCandlePattern,
  trendBefore,
} from '../../js/core/patterns.js';
import { miniChart } from '../../js/core/chart.js';

const params = new URLSearchParams(location.search);
const theme = params.get('theme');
if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
const only = params.get('only');
const onlyId = params.get('id');
const seeds = (params.get('seeds') || '1,2,3')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((s) => Number.isFinite(s));
const showFail = params.get('fail') !== '0';
// ?zoom=N: candle cards show only the N candles before the pattern (plus pattern and
// follow-through) at a larger size, to judge individual candle geometry.
const zoom = Number(params.get('zoom')) || 0;

// Theme links keep the other query parameters.
for (const a of document.querySelectorAll('nav.bar a')) {
  const t = new URLSearchParams(a.getAttribute('href').slice(1)).get('theme');
  if (!t) continue;
  const q = new URLSearchParams(location.search);
  q.set('theme', t);
  a.setAttribute('href', `?${q}`);
}

const sheet = document.getElementById('sheet');
let problems = 0;
let cardsDrawn = 0;

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
};
const tagFor = (bias) => el('span', { class: `tag ${bias === 'bullish' ? 'bull' : bias === 'bearish' ? 'bear' : ''}`, text: bias });

function card(title, svg, issues, extra = '') {
  cardsDrawn++;
  const c = el('figure', { class: `card${issues.length ? ' problem' : ''}` });
  c.style.margin = '0';
  c.append(el('figcaption', { class: 'cap' }, el('b', { text: title }), el('span', { text: extra })), svg);
  if (issues.length) {
    problems++;
    c.append(el('div', { class: 'issues', text: issues.join(' · ') }));
  }
  return c;
}

// ---------------------------------------------------------------------------------------------
// Candlestick patterns
// ---------------------------------------------------------------------------------------------
function candleRow(id) {
  const p = CANDLE_PATTERNS[id];
  const row = el('section', { class: 'row', 'aria-label': p.name });
  row.append(
    el(
      'header',
      {},
      el('h3', { text: p.name }),
      tagFor(p.bias),
      el('span', { class: 'tag', text: p.kind }),
      el('span', { class: 'meta', text: `context: ${p.context} · ${p.candles} candle${p.candles > 1 ? 's' : ''} · id ${id}` }),
    ),
  );
  const cards = el('div', { class: 'cards' });
  cards.style.setProperty('--card-w', zoom ? '280px' : '220px');
  const variants = seeds.map((seed) => ({ seed, outcome: 'success' }));
  if (showFail && p.bias !== 'neutral') variants.push({ seed: seeds[0], outcome: 'fail' });
  for (const { seed, outcome } of variants) {
    const sc = candleScenario(id, { seed, leadIn: 16, after: 6, outcome });
    const pat = sc.candles.slice(sc.start, sc.end + 1);
    const issues = [];
    if (!checkCandlePattern(id, pat)) issues.push('geometry check failed');
    const tr = trendBefore(sc.candles, sc.start, 10);
    if (p.context === 'downtrend' && tr !== 'down') issues.push(`lead-in ${tr}`);
    if (p.context === 'uptrend' && tr !== 'up') issues.push(`lead-in ${tr}`);
    const from = zoom ? Math.max(0, sc.start - zoom) : 0;
    const shown = sc.candles.slice(from);
    const overlays = [];
    if (outcome === 'success' && sc.confirm != null) {
      overlays.push({ type: 'hline', price: sc.confirm, color: 'info', dashed: true, width: 1, from: sc.end - from, to: sc.end - from + 1.5 });
    }
    const svg = miniChart(shown, {
      width: zoom ? 300 : 240,
      height: zoom ? 220 : 150,
      highlight: [sc.start - from, sc.end - from],
      overlays,
      ariaLabel: `${p.name}, seed ${seed}, ${outcome}`,
    });
    cards.append(card(`seed ${seed}`, svg, issues, `${sc.trend} → ${outcome}`));
  }
  row.append(cards);
  return row;
}

// ---------------------------------------------------------------------------------------------
// Chart patterns
// ---------------------------------------------------------------------------------------------
const SHORT = {
  'Left shoulder': 'LS',
  'Right shoulder': 'RS',
  Head: 'H',
  Neckline: 'N',
  'Top 1': 'T1',
  'Top 2': 'T2',
  'Top 3': 'T3',
  'Bottom 1': 'B1',
  'Bottom 2': 'B2',
  'Bottom 3': 'B3',
  'Upper line': 'U',
  'Lower line': 'L',
  Resistance: 'R',
  Support: 'S',
  'Rising support': 'RS',
  'Falling resistance': 'FR',
  'Flagpole start': 'P0',
  'Flagpole top': 'P1',
  'Flagpole bottom': 'P1',
  Flag: 'F',
  'Left rim': 'Rim',
  'Right rim': 'Rim',
  'Cup bottom': 'Btm',
  Handle: 'Hdl',
  'Left lip': 'Lip',
  Bottom: 'Btm',
};

function chartOverlays(sc) {
  const ov = [];
  const seg = (ln, color, dashed = false) => ({
    type: 'segment',
    a: { idx: ln.x1, price: ln.y1 },
    b: { idx: ln.x2, price: ln.y2 },
    color,
    width: 1.5,
    dashed,
  });
  if (sc.neckline) ov.push(seg(sc.neckline, 'info'));
  if (sc.boundaries) {
    ov.push(seg(sc.boundaries.upper, 'resistance'));
    ov.push(seg(sc.boundaries.lower, 'support'));
  }
  ov.push({ type: 'hline', price: sc.target, color: 'accent', dashed: true, width: 1, from: sc.breakoutIdx, label: 'Target' });
  for (const k of sc.keyPoints) {
    if (k.label === 'Breakout') {
      ov.push({ type: 'marker', idx: k.idx, position: sc.direction > 0 ? 'below' : 'above', shape: 'arrow', color: 'accent', text: 'BO' });
      continue;
    }
    const c = sc.candles[k.idx];
    const isHigh = Math.abs(c.h - k.price) <= Math.abs(c.l - k.price);
    ov.push({
      type: 'marker',
      idx: k.idx,
      price: k.price,
      position: isHigh ? 'above' : 'below',
      shape: 'dot',
      color: 'text',
      text: SHORT[k.label] ?? k.label,
    });
  }
  return ov;
}

function chartIssues(sc) {
  const out = [];
  const n = sc.candles.length;
  const W = 3;
  for (const k of sc.keyPoints) {
    if (k.label === 'Breakout') continue;
    const c = sc.candles[k.idx];
    const isHigh = c.h === k.price;
    const isLow = c.l === k.price;
    if (!isHigh && !isLow) {
      out.push(`${k.label}@${k.idx} not a high/low`);
      continue;
    }
    for (let j = Math.max(0, k.idx - W); j <= Math.min(n - 1, k.idx + W); j++) {
      if (j === k.idx) continue;
      if (isHigh && sc.candles[j].h > k.price) out.push(`${k.label}@${k.idx} not a local high`);
      if (isLow && sc.candles[j].l < k.price) out.push(`${k.label}@${k.idx} not a local low`);
    }
  }
  const last = sc.candles[n - 1].c;
  if (sc.outcome === 'success' && !sc.reachedTarget) out.push('target not reached');
  if (sc.outcome === 'fail' && (last - sc.level) * sc.direction >= 0) out.push('fail did not reverse');
  return [...new Set(out)];
}

function chartRow(id) {
  const P = CHART_PATTERNS[id];
  const row = el('section', { class: 'row', 'aria-label': P.name });
  row.append(
    el(
      'header',
      {},
      el('h3', { text: P.name }),
      tagFor(P.bias),
      el('span', { class: 'tag', text: P.kind }),
      el('span', { class: 'meta', text: `id ${id}` }),
    ),
  );
  const cards = el('div', { class: 'cards' });
  cards.style.setProperty('--card-w', '330px');
  const variants = seeds.map((seed) => ({ seed, outcome: 'success' }));
  if (showFail) variants.push({ seed: seeds[0], outcome: 'fail' });
  for (const { seed, outcome } of variants) {
    const sc = chartScenario(id, { seed, outcome });
    const svg = miniChart(sc.candles, {
      width: 400,
      height: 210,
      overlays: chartOverlays(sc),
      highlight: [sc.patternStart, sc.patternEnd],
      yPad: 0.14,
      ariaLabel: `${P.name}, seed ${seed}, ${outcome}`,
    });
    const extra = `${sc.bias} · ${outcome}${outcome === 'success' ? '' : sc.reachedTarget ? ' (hit target)' : ''}`;
    cards.append(card(`seed ${seed}`, svg, chartIssues(sc), extra));
  }
  row.append(cards);
  return row;
}

// ---------------------------------------------------------------------------------------------

try {
  if (only !== 'chart') {
    const ids = onlyId ? CANDLE_PATTERN_IDS.filter((i) => i === onlyId) : CANDLE_PATTERN_IDS;
    if (ids.length) {
      sheet.append(el('h2', { text: `Candlestick patterns (${ids.length})` }));
      ids.forEach((id) => sheet.append(candleRow(id)));
    }
  }
  if (only !== 'candle') {
    const ids = onlyId ? CHART_PATTERN_IDS.filter((i) => i === onlyId) : CHART_PATTERN_IDS;
    if (ids.length) {
      sheet.append(el('h2', { text: `Chart patterns (${ids.length})` }));
      ids.forEach((id) => sheet.append(chartRow(id)));
    }
  }
  const sum = document.getElementById('summary');
  sum.textContent = `${cardsDrawn} scenarios drawn · ${problems} with self-check problems`;
  sum.className = problems ? 'bad' : 'ok';
  document.documentElement.dataset.ready = 'true';
} catch (err) {
  console.error(err);
  document.getElementById('summary').textContent = `Error: ${err.message}`;
  document.documentElement.dataset.ready = 'error';
}
