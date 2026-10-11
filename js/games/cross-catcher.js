// Cross Catcher — spot golden / death-style MA crosses and price/MA relationships.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';
import { sma } from '../core/indicators.js';

function textbook(rng) {
  const direction = rng.pick(['up', 'down']);
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: 140, direction, swings: 3 });
  const decisionIdx = ts.candles.length - 15;
  return {
    candles: ts.candles,
    decisionIdx,
    lead: [],
    decimals: 2,
  };
}

function crossStatus(fast, slow, end) {
  let latest = null;
  for (let i = Math.max(1, end - 2); i <= end; i++) {
    if (!Number.isFinite(fast[i - 1]) || !Number.isFinite(slow[i - 1])) continue;
    if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) latest = 'golden';
    if (fast[i - 1] >= slow[i - 1] && fast[i] < slow[i]) latest = 'death';
  }
  return latest || (fast[end] > slow[end] ? 'fast-above' : 'fast-below');
}

export default {
  id: 'cross-catcher',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 71, direction: 'up', title: 'Cross Catcher', score: 180, streak: 2, round: '2/3' }),
      rounds: 6,
      timer: { seconds: 24, perRound: true },
      howTo: [
        'A moving average is drawn on the chart.',
        'Early rounds compare price with its average; later rounds track fast and slow averages and spot fresh crosses.',
        'Use MA location as a regime filter — not a crystal ball.',
      ],
      async onRound(g, { rng, stage, difficulty }) {
        // Scanner kinds (js/core/scanner.js SETUP_KINDS); the answer is read from the drawn MA.
        const real = await g.realRound({
          kinds: difficulty < 0.5 ? ['trend-up', 'trend-down'] : ['trend-up', 'trend-down', 'golden-cross', 'death-cross'],
          before: 120,
          after: 15,
        });
        const r = real || textbook(rng);
        const lead = r.lead || [];
        const prices = [...lead, ...r.candles].map((c) => c.c);
        const slowPeriod = r.setup?.meta?.slowPeriod && prices.length >= r.setup.meta.slowPeriod
          ? r.setup.meta.slowPeriod : difficulty > 0.6 ? 30 : 20;
        const fastPeriod = slowPeriod > 30 ? r.setup?.meta?.fastPeriod || 50 : 10;
        const slow = sma(prices, slowPeriod).slice(lead.length);
        const fast = sma(prices, fastPeriod).slice(lead.length);
        const d = r.decisionIdx;
        const advanced = difficulty > 0.45 && Number.isFinite(fast[d]) && Number.isFinite(slow[d]);
        const answer = advanced ? crossStatus(fast, slow, d) : r.candles[d].c >= slow[d] ? 'above' : 'below';
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, advanced
          ? `What did the fast ${fastPeriod}-bar MA do relative to the slow ${slowPeriod}-bar MA?`
          : 'Where is price relative to the moving average?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: d + 1, slots: r.candles.length,
          height: 250, decimals: r.decimals ?? 2, yPad: 0.12,
          ariaLabel: 'Price with moving average context',
        });
        chart.addSeries({ values: slow, color: 'accent', label: `Slow ${slowPeriod}` });
        if (advanced) chart.addSeries({ values: fast, color: 'info', label: `Fast ${fastPeriod}` });
        g.setHint(advanced ? 'A cross needs the fast line to change sides within the last three candles. Otherwise call its current side.'
          : 'Compare the last close to the moving-average line.');
        const quiz = g.ask({
          options: advanced ? [
            { label: 'Bullish cross: fast moved above', value: 'golden' },
            { label: 'Bearish cross: fast moved below', value: 'death' },
            { label: 'No new cross: fast still above', value: 'fast-above' },
            { label: 'No new cross: fast still below', value: 'fast-below' },
          ] : [
            { label: 'Price above MA (bullish filter)', value: 'above' },
            { label: 'Price below MA (bearish filter)', value: 'below' },
          ],
          answer,
          explain: advanced
            ? `<strong>${answer.replace('-', ' ')}</strong>. Fast ${fast[d].toFixed(2)}, slow ${slow[d].toFixed(2)} at the freeze. An MA cross confirms past momentum; it cannot predict the next bar.`
            : `<strong>Price ${answer} MA</strong> at the freeze. Filters lag; combine with structure.`,
          onAnswer: (ok) => {
            chart.reveal({ to: r.candles.length, interval: 40 });
            verdictFlourish(stage, { ok, title: ok ? 'Cross caught' : 'Recheck the lines', scoreDelta: ok ? 100 : 0 });
          },
        });
        stage.insertBefore(quiz, host);
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
