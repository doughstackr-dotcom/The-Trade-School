// Fib Sniper — pick the right retracement level for a marked swing.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';

const RATIOS = [
  { id: '236', r: 0.236, label: '23.6%' },
  { id: '382', r: 0.382, label: '38.2%' },
  { id: '500', r: 0.5, label: '50%' },
  { id: '618', r: 0.618, label: '61.8%' },
  { id: '786', r: 0.786, label: '78.6%' },
];

function build(rng, difficulty) {
  const direction = difficulty < 0.25 || rng.chance(0.5) ? 'up' : 'down';
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: Math.round(85 - 10 * difficulty), direction, swings: 3 });
  const c = ts.candles;
  // Pick a completed impulse with enough room for the following bars.
  const firstType = direction === 'up' ? 'low' : 'high';
  const secondType = direction === 'up' ? 'high' : 'low';
  const legs = ts.swings.filter((s, i) => s.type === firstType && ts.swings[i + 1]?.type === secondType && ts.swings[i + 1].idx <= c.length - 16);
  const first = rng.pick(legs);
  const second = ts.swings[ts.swings.indexOf(first) + 1];
  const choices = difficulty < 0.3 ? RATIOS.slice(1, 4) : difficulty < 0.65 ? RATIOS.slice(0, 4) : RATIOS;
  const pick = rng.pick(choices);
  const level = second.price - (second.price - first.price) * pick.r;
  const decisionIdx = Math.min(c.length - 8, second.idx + 8 + Math.round(10 * (1 - difficulty)));
  return { candles: c, first, second, pick, level, decisionIdx, choices, direction };
}

export default {
  id: 'fib-sniper',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 17, direction: 'up', title: 'fib-sniper', score: 200, streak: 2, round: '2/3' }),
      rounds: 7,
      timer: { seconds: 28, perRound: true },
      howTo: [
        'The start and end of an impulse are marked on the chart.',
        'Name the dashed retracement measured back from the end of that move.',
        'Later rounds include down moves and shallower or deeper levels.',
      ],
      onRound(g, { rng, stage, difficulty }) {
        const r = build(rng, difficulty);
        const host = h('div', { class: 'chart-frame' });
        stage.append(
          h('p', { class: 'quiz__q' }, `${r.direction === 'up' ? 'Low → high' : 'High → low'} impulse: which retracement is the dashed level?`),
          host,
        );
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 260, yPad: 0.16, ariaLabel: 'Impulse with Fibonacci retracement level',
        });
        chart.addSegment({ a: { idx: r.first.idx, price: r.first.price }, b: { idx: r.second.idx, price: r.second.price }, color: r.direction === 'up' ? 'bull' : 'bear', arrow: true, label: 'Impulse' });
        chart.addHLine({ price: r.level, color: 'accent', dashed: true, label: 'Fib?' });
        chart.addMarker({ idx: r.first.idx, position: r.direction === 'up' ? 'below' : 'above', shape: 'dot', color: 'accent' });
        chart.addMarker({ idx: r.second.idx, position: r.direction === 'up' ? 'above' : 'below', shape: 'dot', color: 'accent' });
        g.setHint('Measure from the impulse end back toward its start. Deeper retracements are farther from the end.');
        const quiz = g.ask({
          options: rng.shuffle(r.choices.map((x) => ({ label: x.label, value: x.id }))),
          answer: r.pick.id,
          explain: `<strong>${r.pick.label}</strong> at ${r.level.toFixed(2)} (impulse size ${Math.abs(r.second.price - r.first.price).toFixed(2)}). A Fib level alone is not a trade signal.`,
          onAnswer: (ok) => {
            for (const x of r.choices) {
              const px = r.second.price - (r.second.price - r.first.price) * x.r;
              chart.addHLine({ price: px, color: x.id === r.pick.id ? 'accent' : 'info', dashed: true, label: x.label });
            }
            chart.reveal({ to: r.candles.length, interval: 40 });
            verdictFlourish(stage, { ok, title: ok ? 'Solid read' : 'Review the chart', scoreDelta: ok ? 100 : 0 });
          },
        });
        stage.insertBefore(quiz, host);
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
