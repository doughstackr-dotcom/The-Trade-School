// Divergence Detective — spot bullish / bearish divergence vs confirmation.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { simRound } from '../core/scanner.js';
import { annotateSetup } from '../core/lesson-kit.js';

// Scanner setup kinds (js/core/scanner.js): RSI 14 divergences.
const KINDS = ['bearish-divergence', 'bullish-divergence'];

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
        const real = await g.realRound(q);
        const r = real || simRound(rng, q) || simRound(rng, { ...q, before: 80 });
        if (!r) {
          stage.append(h('p', { class: 'muted' }, 'Could not build a chart for this round.'));
          g.nextButton();
          return undefined;
        }
        const k = r.setup?.kind || '';
        let answer = 'confirm';
        if (k === 'bearish-divergence') answer = 'bear-div';
        else if (k === 'bullish-divergence') answer = 'bull-div';
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'Price vs momentum at the latest swing — what do you see?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 340, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Chart for divergence reading',
        });
        g.setHint('Bearish div: higher high in price, lower high in momentum. Bullish: lower low in price, higher low in momentum.');
        g.ask({
          options: [
            { label: 'Bearish divergence', value: 'bear-div' },
            { label: 'Bullish divergence', value: 'bull-div' },
            { label: 'Confirmation / no clear divergence', value: 'confirm' },
          ],
          answer,
          explain: `<strong>${answer}</strong> (${r.setup?.meta?.name || k || 'setup'}). Sample follow-through: ${r.outcome?.result || 'n/a'}.`,
          onAnswer: (ok) => {
            chart.reveal({ to: r.candles.length, interval: 40 });
            try { annotateSetup(r.setup, chart, r); } catch { /* */ }
            verdictFlourish(stage, { ok, title: ok ? 'Solid read' : 'Review the chart', scoreDelta: ok ? 100 : 0 });
          },
        });
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
