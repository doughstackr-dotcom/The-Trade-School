// Stub game (live-predict) — real-market-only game (sources: ['real']): each round asks the
// scanner for a real chart, falls back to a textbook trend when real data is unavailable, and
// reveals the market after the call. The full game streams live / replayed candles
// (market.subscribeLive) and waits for the candle to close.
import { GameShell } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';

const AHEAD = 10;

function textbookRound(rng, difficulty) {
  const direction = rng.pick(difficulty < 0.4 ? ['up', 'down'] : ['up', 'down', 'range']);
  const ts = trendSeries({ seed: rng.int(1, 2 ** 31 - 1), count: 72, direction, swings: 4 });
  const decisionIdx = ts.candles.length - 1 - AHEAD;
  return { candles: ts.candles, decisionIdx };
}

function directionOf(candles, from, to, tolerance = 0.004) {
  const a = candles[from].c;
  const b = candles[Math.min(candles.length - 1, to)].c;
  const m = (b - a) / a;
  return m > tolerance ? 'up' : m < -tolerance ? 'down' : 'flat';
}

export default {
  id: 'live-predict',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      rounds: 5,
      timer: { seconds: 30, perRound: true },
      howTo: [
        'A real market chart appears. The symbol and date stay hidden.',
        `Call where price will be ${AHEAD} candles from now: higher, lower or about the same.`,
        'Then watch the candles play out and see which market it was.',
      ],
      async onRound(g, { rng, stage, difficulty }) {
        const real = await g.realRound({ kinds: ['trend-up', 'trend-down', 'range'], intervals: ['1d', '1w'], before: 60, after: AHEAD });
        const r = real ? { candles: real.candles, decisionIdx: real.decisionIdx, decimals: real.decimals } : textbookRound(rng, difficulty);
        const actual = real?.outcome?.direction || directionOf(r.candles, r.decisionIdx, r.decisionIdx + AHEAD);
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, `Where will price be ${AHEAD} candles from now?`), host);
        const chart = new CandleChart(host, { candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length, height: 300, decimals: r.decimals ?? 2, ariaLabel: 'Price chart; the next candles are hidden until you answer.' });
        g.setHint('Read the structure first: are the swing highs and lows still rising, falling, or going sideways?');
        g.ask({
          options: [
            { label: 'Higher', value: 'up' },
            { label: 'About the same', value: 'flat' },
            { label: 'Lower', value: 'down' },
          ],
          answer: actual,
          explain: `Price ended <strong>${actual === 'up' ? 'higher' : actual === 'down' ? 'lower' : 'about flat'}</strong>. ${real ? 'Real markets are noisy: a good read can still lose.' : ''}`,
          onAnswer: () => chart.reveal({ to: r.candles.length, interval: 90 }),
        });
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
