// Pattern Flash — name the candlestick pattern on a mystery chart.
import { GameShell } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { simRound } from '../core/scanner.js';
import { annotateSetup } from '../core/lesson-kit.js';
import { CANDLE_PATTERNS } from '../core/patterns.js';

const EASY = ['hammer', 'shooting-star', 'bullish-engulfing', 'bearish-engulfing', 'doji'];
const HARD = ['morning-star', 'evening-star', 'hanging-man', 'inverted-hammer', 'dragonfly-doji'];

function labelOf(kind) {
  return CANDLE_PATTERNS[kind]?.name || kind.replace(/-/g, ' ');
}

export default {
  id: 'pattern-flash',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      rounds: 8,
      timer: { seconds: 22, perRound: true },
      howTo: [
        'A candlestick pattern sits at the decision point.',
        'Name it. Context (prior trend) matters for hammers vs hanging men.',
        'The reveal shows what happened next — not proof the pattern “works”.',
      ],
      async onRound(g, { rng, stage, difficulty }) {
        const pool = difficulty < 0.4 ? EASY : difficulty < 0.7 ? [...EASY, ...HARD.slice(0, 2)] : [...EASY, ...HARD];
        const q = { kinds: pool, before: Math.round(55 - 15 * difficulty), after: 12 };
        const real = await g.realRound(q);
        const r = real || simRound(rng, q);
        const kind = r.setup?.kind || rng.pick(pool);
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'Name the candlestick pattern.'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 290, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Candlestick chart with a pattern at the end; future hidden.',
        });
        const distractors = rng.shuffle(pool.filter((k) => k !== kind)).slice(0, 3);
        const opts = rng.shuffle([kind, ...distractors].map((k) => ({ label: labelOf(k), value: k })));
        g.setHint('Check the prior trend and whether the long wick is above or below the body.');
        g.ask({
          options: opts,
          answer: kind,
          explain: `<strong>${labelOf(kind)}</strong>. Next move in this sample: ${r.outcome?.result || 'n/a'}.`,
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
