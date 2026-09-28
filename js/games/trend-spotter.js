// Trend Spotter — call up, down or range from structure on a mystery chart.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';

function textbook(rng, difficulty) {
  const direction = rng.pick(difficulty < 0.35 ? ['up', 'down'] : ['up', 'down', 'range']);
  const ts = trendSeries({ seed: rng.int(1, 2 ** 31 - 1), count: Math.round(70 - 10 * difficulty), direction, swings: 3 + Math.floor(difficulty * 2) });
  const decisionIdx = ts.candles.length - 1 - Math.round(8 + 6 * difficulty);
  return { candles: ts.candles, decisionIdx, direction: direction === 'up' ? 'bullish' : direction === 'down' ? 'bearish' : 'range' };
}

export default {
  id: 'trend-spotter',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 44, direction: 'up', title: 'trend-spotter', score: 430, streak: 3, round: '2/8' }),
      rounds: 7,
      timer: { seconds: 25, perRound: true },
      howTo: [
        'Read swing structure: higher highs/lows, lower highs/lows, or chop.',
        'Call bullish, bearish or range.',
        'Harder rounds show less context and noisier swings.',
      ],
      async onRound(g, { rng, stage, difficulty }) {
        const real = await g.realRound({
          kinds: difficulty < 0.5 ? ['trend-up', 'trend-down'] : ['trend-up', 'trend-down', 'range'],
          before: Math.round(65 - 20 * difficulty),
          after: 12,
        });
        let r;
        if (real) {
          const k = real.setup?.kind || '';
          r = {
            candles: real.candles,
            decisionIdx: real.decisionIdx,
            direction: k.includes('up') || real.setup?.direction === 'bullish' ? 'bullish'
              : k.includes('down') || real.setup?.direction === 'bearish' ? 'bearish' : 'range',
            decimals: real.decimals,
            outcome: real.outcome,
          };
        } else r = textbook(rng, difficulty);
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'What is the dominant structure?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 340, decimals: r.decimals ?? 2, yPad: 0.12,
          ariaLabel: 'Price chart for trend reading; future hidden.',
        });
        g.setHint('Mark the last two or three swing highs and lows in your head.');
        g.ask({
          options: [
            { label: 'Bullish (HH / HL)', value: 'bullish' },
            { label: 'Bearish (LH / LL)', value: 'bearish' },
            { label: 'Range / unclear', value: 'range' },
          ],
          answer: r.direction,
          explain: `<strong>${r.direction}</strong> structure at the freeze. Always re-check after new swings print.`,
          onAnswer: (ok) => {
            chart.reveal({ to: r.candles.length, interval: 40 });
            verdictFlourish(stage, { ok, title: ok ? 'Solid read' : 'Review the chart', scoreDelta: ok ? 100 : 0 });
          },
        });
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
