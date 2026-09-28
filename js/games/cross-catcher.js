// Cross Catcher — spot golden / death-style MA crosses and price/MA relationships.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';
import { sma } from '../core/indicators.js';

function textbook(rng, difficulty) {
  const direction = rng.pick(['up', 'down']);
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: 140, direction, swings: 3 });
  const closes = ts.candles.map((c) => c.c);
  const ma = sma(closes, difficulty > 0.6 ? 30 : 20);
  const decisionIdx = ts.candles.length - 15;
  const above = closes[decisionIdx] > ma[decisionIdx];
  return {
    candles: ts.candles,
    decisionIdx,
    ma,
    answer: above ? 'above' : 'below',
    decimals: 2,
  };
}

export default {
  id: 'cross-catcher',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 71, direction: 'up', title: 'cross-catcher', score: 520, streak: 4, round: '2/8' }),
      rounds: 6,
      timer: { seconds: 24, perRound: true },
      howTo: [
        'A moving average is drawn on the chart.',
        'Is price (or the fast MA) above or below the slow average at the freeze?',
        'Use MA location as a regime filter — not a crystal ball.',
      ],
      async onRound(g, { rng, stage, difficulty }) {
        const real = await g.realRound({
          kinds: difficulty < 0.5 ? ['price-above-ma', 'price-below-ma'] : ['price-above-ma', 'price-below-ma', 'golden-cross', 'death-cross'],
          before: 120,
          after: 15,
          maFast: 20,
          maSlow: 50,
        });
        let r;
        if (real) {
          const k = real.setup?.kind || '';
          r = {
            candles: real.candles,
            decisionIdx: real.decisionIdx,
            answer: /above|golden|cross-up/i.test(k) || real.setup?.direction === 'bullish' ? 'above' : 'below',
            decimals: real.decimals,
            setup: real.setup,
          };
        } else r = textbook(rng, difficulty);
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'Where is price relative to the moving average?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 340, decimals: r.decimals ?? 2, yPad: 0.12,
          ariaLabel: 'Price with moving average context',
        });
        if (r.ma) {
          try { chart.addSeries?.({ values: r.ma, color: 'accent', label: 'MA' }); } catch { /* optional API */ }
        }
        g.setHint('Compare the last close to the average line — above or below?');
        g.ask({
          options: [
            { label: 'Price above MA (bullish filter)', value: 'above' },
            { label: 'Price below MA (bearish filter)', value: 'below' },
          ],
          answer: r.answer,
          explain: `<strong>Price ${r.answer} MA</strong> at the freeze. Filters lag; combine with structure.`,
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
