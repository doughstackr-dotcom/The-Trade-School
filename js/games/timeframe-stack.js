// Timeframe Stack — align higher-timeframe bias with a lower-timeframe decision.
import { GameShell } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';

function build(rng, difficulty) {
  const bias = rng.pick(['up', 'down']);
  const htf = trendSeries({ seed: rng.int(1, 1e9), count: 60, direction: bias, swings: 3 });
  // LTF is noisier path in same direction, sometimes a counter pullback at the end
  const pullback = rng.chance(0.45 + 0.2 * difficulty);
  const ltfDir = pullback ? (bias === 'up' ? 'down' : 'up') : bias;
  const ltf = trendSeries({ seed: rng.int(1, 1e9), count: Math.round(70 - 10 * difficulty), direction: ltfDir, swings: 4 });
  const best = pullback
    ? (bias === 'up' ? 'long-pullback' : 'short-pullback')
    : 'wait';
  // If LTF agrees with bias and not a pullback setup, take with trend
  const answer = pullback ? best : (bias === 'up' ? 'long-cont' : 'short-cont');
  return { htf: htf.candles, ltf: ltf.candles, bias, answer, pullback };
}

export default {
  id: 'timeframe-stack',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      rounds: 6,
      timer: { seconds: 35, perRound: true },
      howTo: [
        'Left: higher timeframe bias. Right: lower timeframe trigger zone.',
        'Choose: with-trend continuation, buy/sell the pullback, or wait.',
        'When HTF and LTF conflict without a clear pullback plan — wait.',
      ],
      onRound(g, { rng, stage, difficulty }) {
        const r = build(rng, difficulty);
        const row = h('div', { class: 'chart-compare' });
        const left = h('div', { class: 'chart-frame' });
        const right = h('div', { class: 'chart-frame' });
        row.append(
          h('div', null, h('p', { class: 'eyebrow' }, 'Higher TF'), left),
          h('div', null, h('p', { class: 'eyebrow' }, 'Lower TF'), right),
        );
        stage.append(
          h('p', { class: 'quiz__q' }, `HTF bias looks ${r.bias === 'up' ? 'bullish' : 'bearish'}. What is the disciplined plan?`),
          row,
        );
        const c1 = new CandleChart(left, { candles: r.htf, height: 220, yPad: 0.12, ariaLabel: 'Higher timeframe chart' });
        const c2 = new CandleChart(right, { candles: r.ltf, height: 220, yPad: 0.12, ariaLabel: 'Lower timeframe chart' });
        g.setHint('Pullbacks against HTF bias are often buys/sells with the larger trend — if your plan defines them.');
        g.ask({
          options: rng.shuffle([
            { label: 'Long pullback (HTF up)', value: 'long-pullback' },
            { label: 'Short pullback (HTF down)', value: 'short-pullback' },
            { label: 'With-trend continuation long', value: 'long-cont' },
            { label: 'With-trend continuation short', value: 'short-cont' },
            { label: 'Wait — conflict / no trigger', value: 'wait' },
          ]),
          answer: r.answer,
          explain: r.pullback
            ? `<strong>Trade the pullback with HTF bias (${r.bias})</strong>. Counter-trend LTF movement inside an HTF trend is often a location, not a new thesis.`
            : `<strong>${r.answer}</strong>. LTF already agrees with HTF — continuation or wait for a fresh trigger rather than inventing a fade.`,
        });
        return () => { c1.destroy(); c2.destroy(); };
      },
    });
    return () => game.destroy();
  },
};
