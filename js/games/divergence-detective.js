// Divergence Detective — compare price swings with RSI (or the MACD histogram) and name the
// divergence: bullish, bearish, hidden bullish, hidden bearish, or none. Early rounds offer only
// the regular kinds plus "none"; later ones add hidden divergence and MACD histogram charts.
// A correct divergence read earns a bonus step (tap the two price swings that form it, graded
// within ±2 candles). The reveal draws the divergence on both panes, then plays the next candles:
// mostly the expected reaction, occasionally (late rounds) a failed signal with the lesson that
// divergence is a warning, not a guarantee.
//
// Scenarios: ./divergence-detective-scenarios.js (generate-and-test on the computed oscillator).
// Real-market runs: scanner bullish / bearish RSI divergences and clean trend windows ("none"),
// each re-checked so the read on screen is unambiguous; the read is graded, the outcome reported.
import { GameShell } from '../core/game-kit.js';
import { h, svg, icon, kbdHint, sfx } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { reducedMotion } from '../core/anim.js';
import { divergenceScenario, checkRealWindow, DIV_INFO } from './divergence-detective-scenarios.js';

const BASIC = ['bullish', 'bearish', 'none'];
const FULL = ['bullish', 'bearish', 'hidden-bullish', 'hidden-bearish', 'none'];
const OPTION_LABEL = {
  bullish: 'Bullish divergence',
  bearish: 'Bearish divergence',
  'hidden-bullish': 'Hidden bullish',
  'hidden-bearish': 'Hidden bearish',
  none: 'No divergence',
};
const COLOR = { bullish: 'bull', 'hidden-bullish': 'bull', bearish: 'bear', 'hidden-bearish': 'bear', none: 'info' };
const BONUS = 50;
const TOL = 2; // bonus taps: within ±2 candles of each swing

// ------------------------------------------------------------------ styles

const CSS = `
.dd-game { display: grid; gap: 14px; }
.dd-game__layout { display: grid; gap: 14px; align-items: start; }
.dd-game__main { display: grid; gap: 8px; min-width: 0; }
.dd-game__side { display: grid; gap: 10px; min-width: 0; }
.dd-game__chart { position: relative; }
.dd-game__chart.is-picking { box-shadow: 0 0 0 2px var(--accent); }
.dd-game__chart.is-picking .tc-svg { cursor: crosshair; }
.dd-game__key { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin: 0; font-size: 13px; color: var(--text-2); }
.dd-game__key .swatch { display: inline-block; width: 14px; height: 3px; border-radius: 2px; background: var(--c); margin-right: 6px; vertical-align: middle; }
.dd-game__tag { display: inline-flex; align-items: center; gap: 6px; }
.dd-game .quiz__q { margin-bottom: 10px; font-size: 16.5px; }
.dd-game .option { min-height: 48px; padding-block: 10px; }
.dd-game .option-grid { --cols: 2; }
.dd-game .option-grid .option:last-child:nth-child(odd) { grid-column: 1 / -1; }
.dd-game__keys { margin: 0; }
.dd-bonus { display: grid; gap: 8px; padding: 12px 14px; border: 1px solid var(--accent); border-radius: var(--radius); background: color-mix(in oklab, var(--surface), var(--accent-soft) 55%); }
.dd-bonus__title { display: flex; align-items: center; gap: 8px; margin: 0; font-weight: 700; color: var(--text); }
.dd-bonus__title .chip { margin-left: auto; }
.dd-bonus__text { margin: 0; font-size: 14px; color: var(--text-2); }
.dd-bonus__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.dd-bonus__taps { display: inline-flex; gap: 6px; }
.dd-bonus__dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--accent); background: transparent; }
.dd-bonus__dot.is-on { background: var(--accent); }
.dd-log { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; text-align: left; }
.dd-log__item { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--surface-2); font-size: 14px; }
.dd-log__n { font-family: var(--font-mono); color: var(--text-3); font-size: 12px; }
.dd-log__what { min-width: 0; }
.dd-log__what small { display: block; color: var(--text-3); font-size: 12px; }
.dd-log__mark { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; }
.dd-log__mark.is-good { color: var(--bull-strong, var(--bull)); background: var(--bull-soft); }
.dd-log__mark.is-bad { color: var(--bear-strong, var(--bear)); background: var(--bear-soft); }
.dd-sum { display: grid; gap: 10px; text-align: left; }
.dd-sum__h { margin: 0; font-size: 15px; }
.dd-preview { display: grid; gap: 4px; width: 100%; max-width: 360px; margin-inline: auto; }
.dd-preview svg { width: 100%; height: auto; display: block; }
.dd-preview__cap { margin: 0; font-size: 12.5px; color: var(--text-3); text-align: center; }
.dd-preview .dd-draw { stroke-dasharray: 100; stroke-dashoffset: 100; animation: dd-draw 1.4s var(--ease-out, ease-out) 0.3s forwards; }
.dd-preview .dd-draw--2 { animation-delay: 0.9s; }
.dd-preview .dd-pop { opacity: 0; animation: dd-pop 0.4s ease-out 1.6s forwards; }
@keyframes dd-draw { to { stroke-dashoffset: 0; } }
@keyframes dd-pop { to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .dd-preview .dd-draw { animation: none; stroke-dashoffset: 0; }
  .dd-preview .dd-pop { animation: none; opacity: 1; }
}
@media (min-width: 1000px) {
  .dd-game__layout { grid-template-columns: minmax(0, 1fr) 290px; }
  .dd-game .option-grid { --cols: 1; }
  .dd-game .option-grid .option:last-child:nth-child(odd) { grid-column: auto; }
}
@media (max-width: 519.98px) {
  .dd-game .option-grid:not(.option-grid--visual) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dd-game .option { min-height: 46px; padding: 8px 34px 8px 10px; font-size: 14.5px; gap: 8px; }
  .dd-game .quiz__q { font-size: 15.5px; }
}
`;

function injectStyle() {
  const el = document.createElement('style');
  el.dataset.module = 'divergence-detective';
  el.textContent = CSS;
  document.head.append(el);
  return () => el.remove();
}

// ------------------------------------------------------------------ helpers

const pairWord = (a, b, va, vb) => {
  if (a.type === 'high') return (vb ?? b.price) > (va ?? a.price) ? 'Higher high' : 'Lower high';
  return (vb ?? b.price) < (va ?? a.price) ? 'Lower low' : 'Higher low';
};

function fmtPrice(p, decimals = 2) {
  return Number.isFinite(p) ? p.toFixed(decimals) : '';
}

/** Intro art: a price line making a lower low while RSI makes a higher low. */
function previewArt() {
  const W = 320;
  const price = [[8, 30], [60, 70], [95, 50], [150, 104], [200, 84], [240, 112], [290, 60], [312, 70]];
  const rsiPts = [[8, 40], [60, 58], [95, 44], [150, 88], [200, 52], [240, 74], [290, 40], [312, 46]];
  const pl = (pts, y0) => pts.map(([x, y]) => `${x},${y + y0}`).join(' ');
  const art = svg('svg', { viewBox: `0 0 ${W} 230`, role: 'img', 'aria-label': 'Price makes a lower low while RSI makes a higher low: bullish divergence' },
    svg('rect', { x: 0, y: 0, width: W, height: 130, rx: 8, style: 'fill: var(--surface); stroke: var(--line)' }),
    svg('rect', { x: 0, y: 138, width: W, height: 92, rx: 8, style: 'fill: var(--surface); stroke: var(--line)' }),
    svg('text', { x: 10, y: 18, style: 'fill: var(--text-3); font: 600 11px var(--font-body)' }, 'Price'),
    svg('text', { x: 10, y: 154, style: 'fill: var(--text-3); font: 600 11px var(--font-body)' }, 'RSI 14'),
    svg('line', { x1: 4, x2: W - 4, y1: 166, y2: 166, style: 'stroke: var(--bear); stroke-dasharray: 4 4; opacity: .55' }),
    svg('line', { x1: 4, x2: W - 4, y1: 206, y2: 206, style: 'stroke: var(--bull); stroke-dasharray: 4 4; opacity: .55' }),
    svg('polyline', { points: pl(price, 0), class: 'dd-draw', pathLength: 100, style: 'fill: none; stroke: var(--text-2); stroke-width: 2.2; stroke-linejoin: round' }),
    svg('polyline', { points: pl(rsiPts, 120), class: 'dd-draw', pathLength: 100, style: 'fill: none; stroke: var(--ma3); stroke-width: 2.2; stroke-linejoin: round' }),
    svg('line', { x1: 150, y1: 104, x2: 240, y2: 112, class: 'dd-draw dd-draw--2', pathLength: 100, style: 'stroke: var(--bull); stroke-width: 2.6; stroke-linecap: round' }),
    svg('line', { x1: 150, y1: 208, x2: 240, y2: 194, class: 'dd-draw dd-draw--2', pathLength: 100, style: 'stroke: var(--bull); stroke-width: 2.6; stroke-linecap: round' }),
    svg('text', { x: 196, y: 127, 'text-anchor': 'middle', class: 'dd-pop', style: 'fill: var(--bull); font: 700 11px var(--font-body)' }, 'Lower low'),
    svg('text', { x: 196, y: 188, 'text-anchor': 'middle', class: 'dd-pop', style: 'fill: var(--bull); font: 700 11px var(--font-body)' }, 'Higher low'));
  return h('figure', { class: 'dd-preview' }, art,
    h('figcaption', { class: 'dd-preview__cap' }, 'Price: lower low. RSI: higher low. Selling is running out of steam.'));
}

// ------------------------------------------------------------------ round building

/** Real-market round: scanner divergence (or a clean trend for "none"), re-checked for a fair read. */
async function realModel(g, kind, rng) {
  if (g.source !== 'real') return null;
  const query = {
    kinds: kind === 'none' ? ['trend-up', 'trend-down'] : [kind === 'bullish' ? 'bullish-divergence' : 'bearish-divergence'],
    intervals: ['1d', '1w'],
    before: 56,
    after: 16,
  };
  for (let t = 0; t < 3; t++) {
    const r = await g.realRound({ ...query, rng: rng.fork(`real-${t}`) });
    if (!r) return null; // the shell already switched this round to a textbook chart
    const c = checkRealWindow(r, kind);
    if (c.ok) {
      return {
        kind, osc: 'rsi', real: r, candles: r.candles, decisionIdx: r.decisionIdx, decimals: r.decimals ?? 2,
        oscValues: c.rsi, a: c.a, b: c.b, structure: c.structure, other: c.other, outcome: null,
      };
    }
  }
  // Real windows were found but none gave an unambiguous read. Ask for one that cannot exist so the
  // shell records this round as a textbook fallback (the HUD chip then says "Textbook chart").
  await g.realRound({ ...query, symbols: [] });
  return null;
}

/** Textbook round from the generator (generate-and-test), with fallbacks that always succeed. */
function textbookModel(cfg, difficulty) {
  const { kind, seed, outcome } = cfg;
  let osc = cfg.osc;
  let sc = divergenceScenario(kind, { seed, difficulty, osc, outcome });
  if (!sc && osc === 'macd') {
    osc = 'rsi';
    sc = divergenceScenario(kind, { seed, difficulty, osc, outcome });
  }
  for (let k = 1; !sc && k < 4; k++) sc = divergenceScenario(kind, { seed: seed + k * 7919, difficulty, osc: 'rsi', outcome });
  if (!sc) {
    osc = 'rsi';
    sc = divergenceScenario(kind, { seed, difficulty: 1, osc, outcome: 'expected' });
  }
  return {
    kind, osc, real: null, candles: sc.candles, decisionIdx: sc.decisionIdx, decimals: 2,
    oscValues: osc === 'macd' ? sc.macd.hist : sc.rsi, a: sc.a, b: sc.b, structure: sc.structure,
    other: sc.other, outcome: sc.outcome,
  };
}

// ------------------------------------------------------------------ the game

export default {
  id: 'divergence-detective',
  mount(root, ctx) {
    const removeStyle = injectStyle();
    const state = { decks: { basic: [], full: [] }, dealt: 0, log: [], cfg: null };
    let current = null; // live round controller (timeout, cleanup)

    /** Next target kind from a shuffled deck (balanced answers, never three in a row). */
    function deal(g, full) {
      const key = full ? 'full' : 'basic';
      const pool = full ? FULL : BASIC;
      if (!state.decks[key].length) state.decks[key] = g.rng.fork(`deck-${state.dealt}`).shuffle(pool);
      state.dealt += 1;
      const deck = state.decks[key];
      let kind = deck.shift();
      const recent = state.log.slice(-2).map((x) => x.kind);
      if (recent.length === 2 && recent[0] === kind && recent[1] === kind) {
        if (!deck.length) state.decks[key] = g.rng.fork(`deck-${state.dealt}-b`).shuffle(pool);
        const alt = state.decks[key].findIndex((k) => k !== kind);
        if (alt >= 0) {
          const next = state.decks[key].splice(alt, 1)[0];
          state.decks[key].push(kind);
          kind = next;
        }
      }
      return kind;
    }

    const game = new GameShell(root, ctx, {
      rounds: 8,
      maxScore: 800,
      timer: { seconds: 40, perRound: true },
      howTo: [
        'Compare the last two swing highs and the last two swing lows with the oscillator under the chart.',
        'Name it: bullish or bearish divergence, hidden divergence (later rounds), or no divergence. Keys 1–5.',
        `Nail a divergence and earn a +${BONUS} bonus: tap the two price swings that form it.`,
        'Watch the reveal: divergence is a warning, not a guarantee. Real-market runs use regular RSI divergence only.',
      ],
      preview: (el) => {
        el.append(previewArt());
      },
      onStart() {
        state.decks = { basic: [], full: [] };
        state.dealt = 0;
        state.log = [];
        state.cfg = null;
      },
      onTimeout: (g) => {
        if (current?.timeout) current.timeout();
        else {
          g.wrong("Time's up!");
          g.nextButton();
        }
      },
      async onRound(g, { rng, stage, difficulty, retry }) {
        const realRun = g.source === 'real';
        if (!retry || !state.cfg) {
          const full = !realRun && difficulty > 0.45;
          const kind = deal(g, full);
          const osc = !realRun && difficulty >= 0.7 && BASIC.includes(kind) && rng.chance(0.45) ? 'macd' : 'rsi';
          const outcome = kind !== 'none' && difficulty >= 0.7 && rng.chance(0.25) ? 'failed' : 'expected';
          state.cfg = { kind, osc, outcome, full: full && osc === 'rsi', seed: rng.int(1, 2 ** 31 - 1) };
        }
        const cfg = state.cfg;
        const real = BASIC.includes(cfg.kind) ? await realModel(g, cfg.kind, rng) : null;
        const m = real || textbookModel(cfg, difficulty);
        return playRound(g, stage, m, { cfg, difficulty });
      },
      onEnd(g, summary) {
        return resultsLog(summary);
      },
    });

    /** One log entry per round (a Practice retry replaces the round's earlier entry). */
    function logRound(entry) {
      const e = { ...entry, round: game.round };
      const last = state.log[state.log.length - 1];
      if (last && last.round === e.round) state.log[state.log.length - 1] = e;
      else state.log.push(e);
    }

    // ------------------------------------------------------------ one round

    function playRound(g, stage, m, { cfg, difficulty }) {
      const isReal = !!m.real;
      const oscName = m.osc === 'macd' ? 'MACD histogram' : 'RSI 14';
      const options = (cfg.full && !isReal && m.osc === 'rsi' ? FULL : BASIC).map((k) => ({ label: OPTION_LABEL[k], value: k }));
      const narrow = () => (host.clientWidth || stage.clientWidth || 800) < 560;
      let alive = true;
      let done = false;
      const timers = new Set();
      const later = (fn, ms) => {
        const t = setTimeout(() => {
          timers.delete(t);
          if (alive) fn();
        }, reducedMotion() ? 0 : ms);
        timers.add(t);
      };

      // Layout
      const host = h('div', { class: 'dd-game__chart chart-frame', 'data-keys': 'capture' });
      const key = h('p', { class: 'dd-game__key' },
        h('span', { class: 'dd-game__tag' }, h('span', { class: 'swatch', style: { '--c': 'var(--text-2)' } }), 'Price'),
        h('span', { class: 'dd-game__tag' }, h('span', { class: 'swatch', style: { '--c': m.osc === 'macd' ? 'var(--bull)' : 'var(--ma3)' } }), oscName),
        h('span', { class: 'faint' }, isReal ? 'Mystery chart: the market and date are revealed after you answer.' : 'Hover or tap the chart to read values.'));
      const side = h('div', { class: 'dd-game__side' });
      const wrap = h('div', { class: 'dd-game' }, h('div', { class: 'dd-game__layout' }, h('div', { class: 'dd-game__main' }, host, key), side));
      stage.append(wrap);

      // Chart: price + oscillator pane. Only candles up to the decision are drawn (the rest keep
      // their slots, empty), autoscale uses visible candles only, so nothing leaks.
      const priceH = narrow() ? 230 : 290;
      const chart = new CandleChart(host, {
        candles: m.candles,
        visible: Math.max(1, m.decisionIdx + 1 - (reducedMotion() ? 0 : 16)),
        slots: m.candles.length,
        height: priceH,
        yPad: 0.14,
        decimals: m.decimals,
        ariaLabel: `Price chart with ${oscName} below it. The candles after the decision point are hidden.`,
      });
      // RSI keeps its 30 / 70 lines but scales to the visible readings (always including 30–70), so
      // a few points of difference between two swings are easy to see.
      const paneH = narrow() ? 110 : 130;
      const pane = m.osc === 'macd'
        ? { id: 'osc', title: 'MACD histogram (12, 26, 9)', height: paneH, histogram: { values: m.oscValues } }
        : { id: 'osc', title: 'RSI 14', height: paneH, range: 'auto', decimals: 1, levels: [{ value: 70, color: 'bear' }, { value: 30, color: 'bull' }], series: [{ values: m.oscValues, color: 'ma3', width: 1.8 }] };
      chart.addPane(pane);
      if (narrow()) {
        // Phones: frame the swings that matter (all of them stay in view) so candles are tappable.
        const first = Math.min(m.a.idx, m.other?.a.idx ?? m.a.idx, m.structure?.idx ?? m.a.idx);
        const from = Math.max(0, Math.min(first - 6, m.decisionIdx - 40));
        chart.setViewport(from, m.candles.length);
      }
      chart.reveal({ to: m.decisionIdx + 1, interval: 14 });

      // Hint: points at the evidence (which swings to compare), never at the answer.
      const lastSide = m.b.type;
      g.setHint(() => {
        if (!alive) return null;
        for (const p of [m.a, m.b]) chart.addMarker({ id: `hint-${p.idx}`, idx: p.idx, price: p.price, position: 'at', shape: 'ring', color: 'accent', pulse: true });
        const word = lastSide === 'low' ? 'low' : 'high';
        return `The latest swing is a <strong>${word}</strong>, circled with the ${word} before it. Is the new ${word} ${word === 'low' ? 'lower or higher' : 'higher or lower'} than the first? Now read ${m.osc === 'macd' ? 'the histogram bars' : 'RSI'} under the same two candles: did it move the same way?`;
      });

      // Answer
      const correctKind = m.kind;
      const info = DIV_INFO[correctKind];
      const explain = (ok, value) => {
        if (correctKind === 'none') {
          return ok
            ? `<strong>No divergence.</strong> Price and ${m.osc === 'macd' ? 'the histogram' : 'RSI'} made the same kind of swing, so momentum confirms the move.`
            : `It was <strong>no divergence</strong>: the last two ${lastSide === 'low' ? 'lows' : 'highs'} of price and ${m.osc === 'macd' ? 'the histogram' : 'RSI'} point the same way. ${value ? `${OPTION_LABEL[value]} needs price and the oscillator to disagree.` : ''}`;
        }
        const osc = m.osc === 'macd' ? 'the histogram' : 'RSI';
        const core = `price made a <strong>${info.price.toLowerCase()}</strong> while ${osc} made a <strong>${info.osc.toLowerCase()}</strong>, so ${info.meaning}.`;
        return ok ? `<strong>${info.name}.</strong> ${core.charAt(0).toUpperCase()}${core.slice(1)}` : `It was <strong>${info.name.toLowerCase()}</strong>: ${core}`;
      };

      const quiz = g.ask({
        question: m.osc === 'macd'
          ? 'Compare the last two swing highs and lows with the MACD histogram bars under them. What does the chart show?'
          : 'Compare the last two swing highs and lows with RSI. What does the chart show?',
        options,
        answer: correctKind,
        explain,
        next: false,
        points: 100,
        onAnswer: (ok, value) => answered(ok, value),
      });
      side.append(quiz, h('p', { class: 'dd-game__keys faint' }, kbdHint(options.map((_, i) => String(i + 1)), 'to answer')));

      function answered(ok, value) {
        if (done) return;
        done = true;
        g.timer.stop();
        logRound({ kind: correctKind, ok, value, osc: m.osc, real: isReal, outcome: m.outcome, bonus: null });
        if (ok && correctKind !== 'none') bonusStep();
        else later(reveal, 250);
      }

      // Bonus: tap the two price swings that form the divergence (±2 candles).
      function bonusStep() {
        const taps = [];
        const dots = [h('span', { class: 'dd-bonus__dot' }), h('span', { class: 'dd-bonus__dot' })];
        const msg = h('p', { class: 'dd-bonus__text', 'aria-live': 'polite' },
          `Tap the two ${lastSide === 'low' ? 'swing lows' : 'swing highs'} on the price chart that form the divergence. Keyboard: focus the chart, move with ← →, press Enter.`);
        const skip = h('button', { type: 'button', class: 'btn btn--sm btn--ghost', 'data-action': 'skip-bonus', on: { click: () => finishBonus(null) } }, 'Skip bonus');
        const box = h('div', { class: 'dd-bonus', role: 'group', 'aria-label': 'Bonus step' },
          h('p', { class: 'dd-bonus__title' }, icon('target', { size: 18 }), 'Bonus: mark the swings', h('span', { class: 'chip chip--sm chip--accent' }, `+${BONUS}`)),
          msg,
          h('div', { class: 'dd-bonus__row' }, h('span', { class: 'dd-bonus__taps', 'aria-hidden': 'true' }, dots), skip, kbdHint('S', 'skip')));
        side.append(box);
        host.classList.add('is-picking');
        const onKey = (e) => {
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          if (e.key === 's' || e.key === 'S' || e.key === 'Escape') {
            e.preventDefault();
            finishBonus(null);
          }
        };
        document.addEventListener('keydown', onKey);
        const onClick = (p) => {
          if (!p || !Number.isFinite(p.idx)) return;
          if (p.idx > m.decisionIdx) {
            msg.textContent = 'That is past the last candle. Tap a swing on the chart so far.';
            return;
          }
          if (taps.includes(p.idx)) return;
          taps.push(p.idx);
          const k = m.candles[p.idx];
          chart.addMarker({ id: `tap-${taps.length}`, idx: p.idx, price: lastSide === 'low' ? k.l : k.h, position: lastSide === 'low' ? 'below' : 'above', shape: 'dot', color: 'accent' });
          dots[taps.length - 1]?.classList.add('is-on');
          sfx.tick();
          if (taps.length >= 2) finishBonus(taps.slice(0, 2));
        };
        chart.on('click', onClick);
        focusChartSoon();
        bonusCleanup = () => {
          document.removeEventListener('keydown', onKey);
          chart.off('click', onClick);
          host.classList.remove('is-picking');
        };
        function finishBonus(picks) {
          if (!bonusCleanup) return;
          bonusCleanup();
          bonusCleanup = null;
          skip.disabled = true;
          const entry = state.log[state.log.length - 1];
          if (!picks) {
            entry.bonus = 'skipped';
            msg.textContent = 'Bonus skipped.';
          } else {
            const [p, q] = [...picks].sort((x, y) => x - y);
            const hit = Math.abs(p - m.a.idx) <= TOL && Math.abs(q - m.b.idx) <= TOL;
            entry.bonus = hit ? 'hit' : 'miss';
            if (hit) {
              g.award(BONUS, { reason: 'bonus', bonus: true });
              sfx.correct();
              msg.replaceChildren(h('strong', null, 'Bonus! '), `You marked both swings that form the ${info.name.toLowerCase()}.`);
            } else {
              sfx.wrong();
              msg.replaceChildren(h('strong', null, 'No bonus. '), `The two swings are circled now: candles ${m.a.idx + 1} and ${m.b.idx + 1} (within ±${TOL} counts).`);
            }
          }
          later(reveal, 200);
        }
      }
      let bonusCleanup = null;

      function focusChartSoon() {
        requestAnimationFrame(() => {
          if (!alive) return;
          try {
            host.focus({ preventScroll: true });
          } catch {
            /* ignore */
          }
          const r = host.getBoundingClientRect();
          if (r.top < 0 || r.bottom > window.innerHeight) host.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
        });
      }

      // Reveal: the divergence (or agreement) on both panes, then the next candles.
      function reveal() {
        if (!alive) return;
        const col = COLOR[correctKind];
        const drawPair = (pa, pb, color, dashed = false) => {
          chart.addSegment({ a: { idx: pa.idx, price: pa.price }, b: { idx: pb.idx, price: pb.price }, color, width: 2.4, dashed, label: pairWord(pa, pb), pulse: true });
          chart.addSegment({ pane: 'osc', a: { idx: pa.oscIdx, price: pa.osc }, b: { idx: pb.oscIdx, price: pb.osc }, color, width: 2.4, dashed, label: pairWord(pa, pb, pa.osc, pb.osc), pulse: true });
          for (const p of [pa, pb]) {
            chart.addMarker({ idx: p.idx, price: p.price, position: 'at', shape: 'ring', color });
            chart.addMarker({ pane: 'osc', idx: p.oscIdx, price: p.osc, position: 'at', shape: 'dot', color });
          }
        };
        drawPair(m.a, m.b, col);
        if (correctKind === 'none' && m.other) drawPair(m.other.a, m.other.b, 'info', true);
        // The confirmation level: a close through the swing between the two points.
        if (correctKind !== 'none' && m.structure && Number.isFinite(m.structure.price)) {
          chart.addHLine({ price: m.structure.price, from: m.structure.idx, color: 'accent', dashed: true, label: 'Confirm', priceTag: false, pulse: true });
        }
        sfx.whoosh();
        later(() => {
          chart.reveal({ to: m.candles.length, interval: 60 }).then(() => {
            if (!alive) return;
            outcomeNote();
            g.nextButton();
          });
        }, 700);
      }

      function outcomeNote() {
        const entry = state.log[state.log.length - 1];
        const up = correctKind === 'none' ? m.b.type === 'high' : info.bias > 0;
        if (isReal) {
          const o = m.real.outcome;
          if (o) {
            const moved = o.direction === 'flat' ? 'went nowhere much' : `${o.direction === 'up' ? 'rose' : 'fell'} ${Math.abs(o.r).toFixed(1)} ATR`;
            const verdict = correctKind === 'none'
              ? (o.result === 'followed' ? 'the trend carried on this time' : o.result === 'failed' ? 'the trend turned this time' : 'the trend stalled')
              : (o.result === 'followed' ? 'the signal played out this time' : o.result === 'failed' ? 'the signal failed this time' : 'no clear follow-through');
            entry.played = o.result;
            g.feedback(`<strong>What happened next (${o.bars} candles):</strong> price ${moved}, so ${verdict}. Only your read of the chart is graded; real outcomes vary, and one example proves nothing.`, 'info');
          }
          return;
        }
        if (correctKind === 'none') {
          entry.played = 'followed';
          g.feedback(`<strong>What happened next:</strong> the trend carried on to a new ${up ? 'high' : 'low'}. With momentum confirming each push, there was no reason to fight it.`, 'info');
          return;
        }
        if (m.outcome === 'failed') {
          entry.played = 'failed';
          g.feedback(`<strong>This one failed.</strong> Price never closed through the Confirm line and went on to a new ${up ? 'low' : 'high'}. Divergence is a warning, not a guarantee: waiting for structure to break kept a careful trader out of this trade.`, 'bad');
        } else {
          entry.played = 'followed';
          g.feedback(`<strong>What happened next:</strong> price closed through the Confirm line (the swing between the two ${lastSide === 'low' ? 'lows' : 'highs'}) and ${up ? 'rallied' : 'dropped'}. That break was the trigger; the divergence was the early warning.`, 'good');
        }
      }

      // Timeout: lock the options (an inert copy that shows the answer), then reveal as usual.
      current = {
        timeout() {
          if (done) return;
          done = true;
          const clone = quiz.cloneNode(true);
          clone.classList.add('is-answered');
          clone.querySelectorAll('.option').forEach((b) => {
            b.classList.add('is-locked');
            b.setAttribute('aria-disabled', 'true');
            b.disabled = true;
            if (b.dataset.value === correctKind) {
              b.classList.add('is-correct', 'is-reveal');
              b.querySelector('.option__mark')?.replaceChildren(icon('check', { size: 18 }));
            } else b.classList.add('is-dim');
          });
          quiz.replaceWith(clone);
          logRound({ kind: correctKind, ok: false, value: null, osc: m.osc, real: isReal, outcome: m.outcome, bonus: null, timeout: true });
          g.wrong(`Time's up! It was ${info.name.toLowerCase()}.`);
          if (g.real) g.revealSource();
          later(reveal, 250);
        },
      };

      return () => {
        alive = false;
        current = null;
        bonusCleanup?.();
        bonusCleanup = null;
        for (const t of timers) clearTimeout(t);
        timers.clear();
        chart.destroy();
      };
    }

    // ------------------------------------------------------------ results

    function resultsLog(summary) {
      if (!state.log.length) return null;
      const reads = state.log.filter((x) => x.ok).length;
      const divs = state.log.filter((x) => x.kind !== 'none');
      const played = divs.filter((x) => x.played === 'followed').length;
      const bonusHits = state.log.filter((x) => x.bonus === 'hit').length;
      const items = state.log.slice(-10).map((x, i, arr) => {
        const n = state.log.length - arr.length + i + 1;
        const what = DIV_INFO[x.kind].name;
        const notes = [
          x.osc === 'macd' ? 'MACD histogram' : 'RSI',
          x.real ? 'real market' : null,
          x.kind !== 'none' && x.played ? (x.played === 'followed' ? 'played out' : x.played === 'failed' ? 'failed' : 'no follow-through') : null,
          x.bonus === 'hit' ? `bonus +${BONUS}` : null,
          x.timeout ? 'time ran out' : !x.ok && x.value ? `you said ${OPTION_LABEL[x.value].toLowerCase()}` : null,
        ].filter(Boolean).join(' · ');
        return h('li', { class: 'dd-log__item' },
          h('span', { class: 'dd-log__n' }, String(n)),
          h('span', { class: 'dd-log__what' }, h('strong', null, what), h('small', null, notes)),
          h('span', { class: ['dd-log__mark', x.ok ? 'is-good' : 'is-bad'], 'aria-label': x.ok ? 'Read correctly' : 'Missed' }, icon(x.ok ? 'check' : 'x', { size: 15 })));
      });
      return h('div', { class: 'dd-sum' },
        h('h3', { class: 'dd-sum__h' }, `Your reads: ${reads} of ${state.log.length} correct${bonusHits ? ` · ${bonusHits} swing ${bonusHits === 1 ? 'bonus' : 'bonuses'}` : ''}`),
        divs.length ? h('p', { class: 'faint', style: 'margin:0' }, `Of the ${divs.length} divergences you saw, ${played} played out and ${divs.length - played} did not. That is why a divergence is a warning to wait for confirmation, not a signal on its own.`) : null,
        h('ol', { class: 'dd-log' }, items));
    }

    return () => {
      game.destroy();
      removeStyle();
    };
  },
};
