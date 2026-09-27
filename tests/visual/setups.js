// Setup contact sheet (see setups.html): findSetups() over every 1d / 1w market fixture, each
// detection drawn in its realRound-style window with lesson-kit's annotateSetup().
import { configureMarket, getCatalog, getHistory, intervalLabel, formatCandleTime } from '../../js/core/market.js';
import { findSetups, outcomeOf, shiftSetup, simRound, SETUP_KINDS, SETUP_KIND_IDS } from '../../js/core/scanner.js';
import { atr } from '../../js/core/indicators.js';
import { CandleChart } from '../../js/core/chart.js';
import { annotateSetup } from '../../js/core/lesson-kit.js';
import { makeRng } from '../../js/core/rng.js';

const q = new URLSearchParams(location.search);
const theme = q.get('theme');
if (theme === 'dark' || theme === 'light') document.documentElement.setAttribute('data-theme', theme);
const kindsWanted = (q.get('kind') || '').split(',').filter((k) => SETUP_KINDS[k]);
const group = q.get('group');
const per = Math.max(1, Number(q.get('per')) || 6);
const BEFORE = 60;
const AFTER = Math.max(0, Number(q.get('after') ?? 20));
const kinds = (kindsWanted.length ? kindsWanted : SETUP_KIND_IDS).filter((k) => !group || SETUP_KINDS[k].group === group);

const out = document.getElementById('out');
const lead = document.getElementById('lead');

function el(tag, attrs, ...kids) {
  attrs = attrs || {};
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) n.append(c);
  return n;
}

function card(ex, titleBits) {
  const host = el('div');
  const o = ex.outcome;
  const c = el('div', { class: 'card', 'data-kind': ex.setup.kind },
    el('h3', null, ...titleBits,
      o ? el('span', { class: `tag ${o.direction}` }, `${o.direction} ${o.r > 0 ? '+' : ''}${o.r} ATR${o.result ? ` · ${o.result}` : ''}`) : null),
    host);
  out.lastChild.append(c);
  const chart = new CandleChart(host, {
    candles: ex.candles, height: 230, showVolume: ex.candles.some((k) => k.v > 0), yPad: 0.14, interactive: false,
    decimals: ex.decimals ?? 2, legend: false, ariaLabel: ex.setup.kind,
  });
  annotateSetup(ex.setup, chart, ex);
  const m = ex.setup.meta || {};
  const facts = Object.entries(m)
    .filter(([k, v]) => typeof v === 'number' || typeof v === 'string')
    .filter(([k]) => !['name'].includes(k))
    .map(([k, v]) => `${k} ${typeof v === 'number' ? +v.toFixed(3) : v}`);
  c.append(el('p', { class: 'stats' }, facts.join(' · ')));
}

function section(kind, count) {
  const k = SETUP_KINDS[kind];
  out.append(el('h2', { id: kind }, `${k.name} (${kind}) — ${count} found`));
  out.append(el('p', { class: 'rule' }, k.rule));
  out.append(el('div', { class: 'grid' }));
}

async function fromFixtures() {
  configureMarket({ mock: true, fixturesBase: new URL('../fixtures/market/', import.meta.url).href });
  const cat = await getCatalog();
  const series = [];
  for (const s of cat.symbols) {
    if (q.get('symbol') && s.id !== q.get('symbol')) continue;
    for (const iv of s.intervals.filter((i) => i === '1d' || i === '1w')) {
      if (q.get('interval') && iv !== q.get('interval')) continue;
      const h = await getHistory({ symbol: s.id, interval: iv, bars: 1000 });
      if (h.candles.length) series.push({ s, iv, candles: h.candles, A: atr(h.candles, 14) });
    }
  }
  const found = new Map(kinds.map((k) => [k, []]));
  let total = 0;
  for (const x of series) {
    total += x.candles.length;
    for (const st of findSetups(x.candles, { kinds, atr: x.A })) found.get(st.kind).push({ ...x, st });
  }
  lead.textContent = `${series.length} fixture series, ${total} candles (TEST FIXTURES: synthetic candles). ${[...found.values()].reduce((a, b) => a + b.length, 0)} setups found. Showing up to ${per} per kind, spread across the series.`;
  const rows = [];
  for (const kind of kinds) {
    const list = found.get(kind);
    rows.push([kind, list.length, list.length ? (list.filter((f) => outcomeOf(f.candles, f.st.decisionIdx, { bars: AFTER, atr: f.A, direction: f.st.direction })?.result === 'followed').length / list.length * 100).toFixed(0) + '%' : '—']);
    section(kind, list.length);
    if (!list.length) {
      out.lastChild.append(el('p', { class: 'empty' }, 'None in the fixtures.'));
      continue;
    }
    // Spread the picks across the list (different series and dates).
    const step = Math.max(1, list.length / per);
    for (let i = 0; i < Math.min(per, list.length); i++) {
      const f = list[Math.floor(i * step)];
      const d = f.st.decisionIdx;
      const w0 = Math.max(0, Math.min(f.st.start - 2, d - BEFORE + 1)); // the whole setup + ≥ 60 candles
      const w1 = Math.min(f.candles.length - 1, d + AFTER);
      const ex = {
        candles: f.candles.slice(w0, w1 + 1),
        decisionIdx: d - w0,
        setup: shiftSetup(f.st, w0),
        lead: f.candles.slice(Math.max(0, w0 - 250), w0),
        outcome: outcomeOf(f.candles, d, { bars: AFTER, atr: f.A, direction: f.st.direction }),
        decimals: f.s.decimals,
      };
      card(ex, [el('b', null, f.s.id), `${intervalLabel(f.iv)} · ${formatCandleTime(f.candles[d].t, f.iv)}`]);
    }
  }
  const tbl = el('table', null, el('tr', null, el('th', null, 'kind'), el('th', null, 'found'), el('th', null, `followed (${AFTER} bars, ≥ 1 ATR)`)),
    rows.map((r) => el('tr', null, r.map((v) => el('td', null, String(v))))));
  document.getElementById('summary').append(tbl);
}

function fromSim() {
  lead.textContent = `simRound(): simulated markets in which the scanner found each setup (${per} seeds per kind).`;
  for (const kind of kinds) {
    section(kind, per);
    for (let i = 0; i < per; i++) {
      const r = simRound(makeRng(1000 + i * 37), { kinds: [kind], before: BEFORE, after: AFTER });
      if (!r) {
        out.lastChild.append(el('p', { class: 'empty' }, `seed ${i}: none`));
        continue;
      }
      card(r, [el('b', null, 'Simulated'), `seed ${1000 + i * 37}`]);
    }
  }
}

(async () => {
  try {
    if (q.get('sim') === '1') fromSim();
    else await fromFixtures();
    document.body.dataset.ready = '1';
  } catch (err) {
    lead.textContent = `Failed: ${err.message}`;
    console.error(err);
    document.body.dataset.ready = 'error';
  }
})();
