// Divergence Detective — spot bullish / bearish divergence vs confirmation.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { simRound, outcomeOf } from '../core/scanner.js';
import { annotateSetup } from '../core/lesson-kit.js';
import { rsi, swings, atr } from '../core/indicators.js';

// Scanner setup kinds (js/core/scanner.js SETUP_KINDS): the two RSI divergences.
const KINDS = ['bearish-divergence', 'bullish-divergence'];
const LABELS = { 'bear-div': 'Bearish divergence', 'bull-div': 'Bullish divergence', confirm: 'Confirmation / no clear divergence' };

// A confirmation round from a trend-up / trend-down round: the latest swing high (low) is a new
// extreme and RSI 14 confirms it (the mirror of the scanner's divergence rule). Frozen 3 candles
// after that swing, like the divergence rounds. null when the chart does not show a clear case.
function confirmation(r) {
  if (!r || !/^trend-/.test(r.setup?.kind || '')) return null;
  const lead = r.lead || [];
  const all = [...lead, ...r.candles];
  const up = r.setup.kind === 'trend-up';
  const R = rsi(all.map((c) => c.c), 14);
  const A = atr(all, 14);
  const sw = swings(all.slice(0, lead.length + r.decisionIdx + 1)).filter((x) => x.type === (up ? 'high' : 'low') && x.idx >= lead.length);
  const b = sw[sw.length - 1];
  const a = sw.filter((x) => b && b.idx - x.idx >= 5 && b.idx - x.idx <= 40).reduce((m, x) => (!m || (up ? x.price > m.price : x.price < m.price) ? x : m), null);
  if (!a || !Number.isFinite(A[b.idx])) return null;
  const osc = (i) => (up ? Math.max : Math.min)(...R.slice(Math.max(0, i - 2), i + 3).filter(Number.isFinite));
  const priceOk = up ? b.price >= a.price + 0.25 * A[b.idx] : b.price <= a.price - 0.25 * A[b.idx];
  const oscOk = up ? osc(b.idx) >= osc(a.idx) + 4 : osc(b.idx) <= osc(a.idx) - 4;
  if (!priceOk || !oscOk) return null;
  const at = (x) => ({ idx: x.idx - lead.length, price: x.price, rsi: osc(x.idx) });
  const decisionIdx = b.idx - lead.length + 3;
  return { ...r, decisionIdx, outcome: outcomeOf(r.candles, decisionIdx, { bars: 16, direction: up ? 'bullish' : 'bearish' }), confirm: { up, a: at(a), b: at(b) } };
}

export default {
  id: 'divergence-detective',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 28, direction: 'down', title: 'divergence-detective', score: 410, streak: 2, round: '2/8' }),
      rounds: 6,
      timer: { seconds: 30, perRound: true },
      howTo: [
        'Price swings vs momentum: does the oscillator confirm the new high/low?',
        'Call bearish divergence, bullish divergence, or confirmation.',
        'Divergence can persist — grade the read, then manage risk.',
      ],
      async onRound(g, { rng, stage, difficulty }) {
        const q = { kinds: KINDS, before: Math.round(90 - 15 * difficulty), after: 16 };
        let r = null;
        if (rng.chance(1 / 3)) {
          // Confirmation round: price makes a new swing extreme and RSI confirms it.
          const cq = { ...q, kinds: ['trend-up', 'trend-down'] };
          const realTrend = await g.realRound(cq);
          r = confirmation(realTrend);
          for (let t = 0; !r && !realTrend && t < 4; t++) r = confirmation(simRound(rng, cq));
        }
        if (!r) r = await g.realRound(q);
        // simRound is stochastic (random markets × limited tries) and can return null —
        // retry with fresh rng draws, then show a skip card instead of a broken round.
        for (let i = 0; !r && i < 6; i++) r = simRound(rng, q);
        if (!r) {
          stage.append(h('p', { class: 'muted' }, 'Could not build a chart for this round.'));
          g.nextButton();
          return undefined;
        }
        const k = r.setup?.kind || '';
        let answer = 'confirm';
        if (r.confirm) answer = 'confirm';
        else if (k === 'bearish-divergence') answer = 'bear-div';
        else if (k === 'bullish-divergence') answer = 'bull-div';
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'Price vs momentum at the latest swing — what do you see?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 340, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Chart for divergence reading',
        });
        // Momentum pane (RSI 14, warmed up on the lead candles); annotateSetup reuses the 'rsi' id.
        const lead = r.lead || [];
        chart.addPane({ id: 'rsi', title: 'RSI 14', height: 80, range: [0, 100], levels: [{ value: 70, color: 'bear' }, { value: 30, color: 'bull' }], series: [{ values: rsi([...lead, ...r.candles].map((c) => c.c), 14).slice(lead.length), color: 'ma3' }] });
        g.setHint('Bearish div: higher high in price, lower high in momentum. Bullish: lower low in price, higher low in momentum.');
        g.ask({
          options: [
            { label: 'Bearish divergence', value: 'bear-div' },
            { label: 'Bullish divergence', value: 'bull-div' },
            { label: 'Confirmation / no clear divergence', value: 'confirm' },
          ],
          answer,
          explain: `<strong>${LABELS[answer]}</strong> (${r.confirm ? `RSI confirms the ${r.confirm.up ? 'higher high' : 'lower low'}` : r.setup?.meta?.name || k || 'setup'}). Sample follow-through: ${r.outcome?.result || 'n/a'}.`,
          onAnswer: (ok) => {
            chart.reveal({ to: r.candles.length, interval: 40 });
            if (r.confirm) {
              const { up, a, b } = r.confirm;
              const label = up ? 'Higher high' : 'Lower low';
              chart.addSegment({ a: { idx: a.idx, price: a.price }, b: { idx: b.idx, price: b.price }, color: up ? 'bull' : 'bear', width: 2, label });
              chart.addSegment({ pane: 'rsi', a: { idx: a.idx, price: a.rsi }, b: { idx: b.idx, price: b.rsi }, color: up ? 'bull' : 'bear', width: 2, label });
            } else {
              try { annotateSetup(r.setup, chart, r); } catch { /* */ }
            }
            verdictFlourish(stage, { ok, title: ok ? 'Solid read' : 'Review the chart', scoreDelta: ok ? 100 : 0 });
          },
        });
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
