// Divergence Detective — spot bullish / bearish divergence vs confirmation.
import { GameShell } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { simRound } from '../core/scanner.js';
import { annotateSetup } from '../core/lesson-kit.js';

const KINDS = ['rsi-divergence-bear', 'rsi-divergence-bull', 'macd-divergence-bear', 'macd-divergence-bull'];

export default {
  id: 'divergence-detective',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      rounds: 6,
      timer: { seconds: 30, perRound: true },
      howTo: [
        'Price swings vs momentum: does the oscillator confirm the new high/low?',
        'Call bearish divergence, bullish divergence, or confirmation.',
        'Divergence can persist — grade the read, then manage risk.',
      ],
      async onRound(g, { rng, stage, difficulty }) {
        const pool = difficulty < 0.5 ? KINDS.slice(0, 2) : KINDS;
        const q = { kinds: pool, before: Math.round(90 - 15 * difficulty), after: 16 };
        const real = await g.realRound(q);
        const r = real || simRound(rng, q);
        const k = r.setup?.kind || '';
        let answer = 'confirm';
        if (/divergence-bear/.test(k)) answer = 'bear-div';
        else if (/divergence-bull/.test(k)) answer = 'bull-div';
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'Price vs momentum at the latest swing — what do you see?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 300, decimals: r.decimals ?? 2, yPad: 0.14,
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
          onAnswer: () => {
            chart.reveal({ to: r.candles.length, interval: 40 });
            try { annotateSetup(r.setup, chart, r); } catch { /* */ }
          },
        });
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
