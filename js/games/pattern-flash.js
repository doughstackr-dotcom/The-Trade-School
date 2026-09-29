// Pattern Flash — name the candlestick pattern on a mystery chart.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { simRound, findSetups } from '../core/scanner.js';
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
        // simRound is stochastic (random markets × limited tries) and can return null — retry
        // with fresh rng draws before surfacing a broken round.
        let r = real || simRound(rng, q);
        for (let i = 0; !r && i < 6; i++) r = simRound(rng, q);
        if (!r) throw new Error('simRound found no setup after retries');
        const kind = r.setup?.kind || rng.pick(pool);
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'Name the candlestick pattern.'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 340, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Candlestick chart with a pattern at the end; future hidden.',
        });
        // Kinds the scanner also finds on this decision candle (a dragonfly doji is also a doji)
        // are not wrong answers — keep them out of the distractors.
        const lead = r.lead || [];
        const at = lead.length + r.decisionIdx;
        const also = new Set(findSetups([...lead, ...r.candles], { kinds: pool, from: at, to: at }).map((s) => s.kind));
        const distractors = rng.shuffle(pool.filter((k) => k !== kind && !also.has(k))).slice(0, 3);
        const opts = rng.shuffle([kind, ...distractors].map((k) => ({ label: labelOf(k), value: k })));
        g.setHint('Check the prior trend and whether the long wick is above or below the body.');
        g.ask({
          options: opts,
          answer: kind,
          explain: `<strong>${labelOf(kind)}</strong>. Next move in this sample: ${r.outcome?.result || 'n/a'}.`,
          onAnswer: (ok) => {
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
