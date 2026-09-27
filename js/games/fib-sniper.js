// Fib Sniper — pick the right retracement level for a marked swing.
import { GameShell } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';

const RATIOS = [
  { id: '382', r: 0.382, label: '38.2%' },
  { id: '500', r: 0.5, label: '50%' },
  { id: '618', r: 0.618, label: '61.8%' },
];

function build(rng, difficulty) {
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: Math.round(85 - 10 * difficulty), direction: 'up', swings: 3 });
  const c = ts.candles;
  const loIdx = 12 + rng.int(0, 8);
  const hiIdx = Math.min(c.length - 20, loIdx + 30 + rng.int(0, 10));
  const lo = c[loIdx].l;
  const hi = c[hiIdx].h;
  const pick = rng.pick(RATIOS);
  const level = hi - (hi - lo) * pick.r;
  // freeze somewhere after the high so the pullback is visible
  const decisionIdx = Math.min(c.length - 8, hiIdx + 8 + Math.round(10 * (1 - difficulty)));
  return { candles: c, loIdx, hiIdx, lo, hi, pick, level, decisionIdx };
}

export default {
  id: 'fib-sniper',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      rounds: 7,
      timer: { seconds: 28, perRound: true },
      howTo: [
        'A swing low and swing high are marked on an uptrend impulse.',
        'Which Fib retracement is highlighted — 38.2%, 50% or 61.8%?',
        'Harder rounds shorten the swing clarity and add noise.',
      ],
      onRound(g, { rng, stage, difficulty }) {
        const r = build(rng, difficulty);
        const host = h('div', { class: 'chart-frame' });
        stage.append(
          h('p', { class: 'quiz__q' }, 'Swing low → swing high is marked. Which retracement is the dashed level?'),
          host,
        );
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 300, yPad: 0.16, ariaLabel: 'Uptrend with Fibonacci retracement level',
        });
        chart.addSegment({ a: { idx: r.loIdx, price: r.lo }, b: { idx: r.hiIdx, price: r.hi }, color: 'bull', arrow: true, label: 'Swing' });
        chart.addHLine({ price: r.level, color: 'accent', dashed: true, label: 'Fib?' });
        chart.addMarker({ idx: r.loIdx, position: 'below', shape: 'dot', color: 'bull' });
        chart.addMarker({ idx: r.hiIdx, position: 'above', shape: 'dot', color: 'bull' });
        g.setHint('Retracement from the high: distance = range × ratio. 61.8% sits deeper than 38.2%.');
        g.ask({
          options: rng.shuffle(RATIOS.map((x) => ({ label: x.label, value: x.id }))),
          answer: r.pick.id,
          explain: `<strong>${r.pick.label}</strong> at ${r.level.toFixed(2)} (range ${(r.hi - r.lo).toFixed(2)}). Confluence still required to trade it.`,
          onAnswer: () => {
            for (const x of RATIOS) {
              const px = r.hi - (r.hi - r.lo) * x.r;
              chart.addHLine({ price: px, color: x.id === r.pick.id ? 'accent' : 'info', dashed: true, label: x.label });
            }
            chart.reveal({ to: r.candles.length, interval: 40 });
          },
        });
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
