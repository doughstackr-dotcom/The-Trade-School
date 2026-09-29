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
  return { candles: ts.candles, decisionIdx, direction: direction === 'up' ? 'bullish' : direction === 'down' ? 'bearish' : 'range', swings: ts.swings };
}

export default {
  id: 'trend-spotter',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 44, direction: 'up', title: 'Trend Spotter', score: 180, streak: 2, round: '2/3' }),
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
            swings: (real.setup?.meta?.swings || []).map((p) => ({ ...p, idx: p.idx - (real.lead?.length || 0) })),
            bounds: k === 'range' ? [real.setup?.meta?.bottom, real.setup?.meta?.top] : null,
          };
        } else r = textbook(rng, difficulty);
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'What is the dominant structure?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 250, decimals: r.decimals ?? 2, yPad: 0.12,
          ariaLabel: 'Price chart for trend reading; future hidden.',
        });
        g.setHint('Mark the last two or three swing highs and lows in your head.');
        const quiz = g.ask({
          options: [
            { label: 'Bullish (HH / HL)', value: 'bullish' },
            { label: 'Bearish (LH / LL)', value: 'bearish' },
            { label: 'Range / unclear', value: 'range' },
          ],
          answer: r.direction,
          explain: `<strong>${r.direction}</strong> structure at the freeze. Always re-check after new swings print.`,
          onAnswer: (ok) => {
            chart.reveal({ to: r.candles.length, interval: 40 });
            for (const p of (r.swings || []).filter((p) => p.idx >= 0 && p.idx <= r.decisionIdx).slice(-4)) {
              chart.addMarker({ idx: p.idx, position: p.type === 'high' ? 'above' : 'below', shape: 'dot', color: 'accent' });
            }
            if (r.bounds?.every(Number.isFinite)) {
              chart.addHLine({ price: r.bounds[0], color: 'accent', dashed: true, label: 'Range floor' });
              chart.addHLine({ price: r.bounds[1], color: 'accent', dashed: true, label: 'Range ceiling' });
            }
            const detail = r.direction === 'bullish' ? 'Higher highs and higher lows are the checkpoints.'
              : r.direction === 'bearish' ? 'Lower highs and lower lows are the checkpoints.'
                : 'Repeated highs and lows inside the same band define the range.';
            verdictFlourish(stage, { ok, title: ok ? 'Structure spotted' : 'Recheck the swings', detail, scoreDelta: ok ? 100 : 0 });
          },
        });
        stage.insertBefore(quiz, host);
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
