// Live Predict — call the next move on a real (or textbook) chart; reveal the market after.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';

const AHEAD = 10;

function textbookRound(rng, difficulty) {
  const direction = rng.pick(difficulty < 0.4 ? ['up', 'down'] : ['up', 'down', 'range']);
  const ts = trendSeries({ seed: rng.int(1, 2 ** 31 - 1), count: 72, direction, swings: 4 });
  const decisionIdx = ts.candles.length - 1 - AHEAD;
  return { candles: ts.candles, decisionIdx, direction };
}

function directionOf(candles, from, to, tolerance = 0.004) {
  const a = candles[from].c;
  const b = candles[Math.min(to, candles.length - 1)].c;
  const chg = (b - a) / a;
  if (Math.abs(chg) < tolerance) return 'range';
  return chg > 0 ? 'up' : 'down';
}

export default {
  id: 'live-predict',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 74, direction: 'down', title: 'live-predict', score: 450, streak: 3, round: '2/8' }),
      rounds: 6,
      timer: { seconds: 25, perRound: true },
      howTo: [
        'A real-market chart freezes before the next stretch of candles.',
        'Predict up, down or range over the hidden window.',
        'We reveal the path and the symbol after you commit — outcomes are noisy.',
      ],
      async onRound(g, { rng, stage, difficulty }) {
        const real = await g.realRound({
          kinds: ['trend-up', 'trend-down', 'range', 'breakout-up', 'breakout-down'],
          intervals: ['1h', '1d'],
          before: Math.round(60 - 10 * difficulty),
          after: AHEAD + 4,
        });
        const r = real
          ? { candles: real.candles, decisionIdx: real.decisionIdx, decimals: real.decimals }
          : textbookRound(rng, difficulty);
        const answer = directionOf(r.candles, r.decisionIdx, r.decisionIdx + AHEAD, 0.003 + 0.002 * difficulty);
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, `Next ~${AHEAD} candles — up, down or range?`), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 340, decimals: r.decimals ?? 2, yPad: 0.12,
          ariaLabel: 'Live predict chart; future hidden',
        });
        g.setHint('Use structure at the freeze — do not invent a story from one wick.');
        g.ask({
          options: [
            { label: 'Up', value: 'up' },
            { label: 'Down', value: 'down' },
            { label: 'Range', value: 'range' },
          ],
          answer,
          explain: `This window moved <strong>${answer}</strong>. One sample path — grade your process, not a single call.`,
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
