// Pattern Flash — name the candlestick pattern on a mystery chart.
import { GameShell, explainChoice, trackAnswer } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { simRound } from '../core/scanner.js';
import { annotateSetup } from '../core/lesson-kit.js';
import { CANDLE_PATTERNS } from '../core/patterns.js';
import { labelOf, lookalikesOf, candleWhy } from './banks/candle-lookalikes.js';

// Re-exported for tests and callers that predate the shared bank module.
export { labelOf, lookalikesOf, candleWhy };

const EASY = ['hammer', 'shooting-star', 'bullish-engulfing', 'bearish-engulfing', 'doji'];
const HARD = ['morning-star', 'evening-star', 'hanging-man', 'inverted-hammer', 'dragonfly-doji'];

export default {
  id: 'pattern-flash',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 31, direction: 'up', title: 'pattern-flash', score: 510, streak: 4, round: '2/8' }),
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
        const r = real || simRound(rng, q) || simRound(rng.fork('retry'), { ...q, kinds: EASY });
        if (!r) throw new Error('no pattern round could be generated');
        const kind = r.setup?.kind || rng.pick(pool);
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'Name the candlestick pattern.'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 340, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Candlestick chart with a pattern at the end; future hidden.',
        });
        // Lookalikes first (once they are in the pool), so hammer vs hanging man gets tested.
        const looks = lookalikesOf(kind).filter((k) => pool.includes(k));
        const others = rng.shuffle(pool.filter((k) => k !== kind && !looks.includes(k)));
        const distractors = [...rng.shuffle(looks).slice(0, 2), ...others].slice(0, 3);
        const opts = rng.shuffle([kind, ...distractors].map((k) => ({ label: labelOf(k), value: k })));
        g.setHint('Check the prior trend and whether the long wick is above or below the body.');
        g.ask({
          options: opts,
          answer: kind,
          explain: explainChoice(
            `<strong>${labelOf(kind)}</strong>. ${CANDLE_PATTERNS[kind]?.summary || ''} Next move in this sample: ${r.outcome?.result || 'n/a'}.`,
            (pick) => candleWhy(kind, pick),
          ),
          onAnswer: (ok) => {
            trackAnswer(g.store, 'candle-pattern', kind, ok);
            chart.reveal({ to: r.candles.length, interval: 40 });
            try { annotateSetup(r.setup, chart, r); } catch { /* */ }
            verdictFlourish(stage, { ok, title: ok ? 'Solid read' : 'Review the chart', scoreDelta: ok ? 100 : 0 });
          },
        });
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
