// Pattern Detective — identify chart patterns and estimate measured-move direction.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { simRound, outcomeOf, SETUP_KINDS } from '../core/scanner.js';
import { annotateSetup, textbookExample } from '../core/lesson-kit.js';
import { CHART_PATTERNS } from '../core/patterns.js';

const EASY = ['bull-flag', 'bear-flag', 'double-top', 'double-bottom'];
const HARD = ['head-and-shoulders', 'inverse-head-and-shoulders', 'ascending-triangle', 'descending-triangle', 'rising-wedge', 'falling-wedge'];

function nameOf(kind) {
  return CHART_PATTERNS[kind]?.name || kind.replace(/-/g, ' ');
}

export default {
  id: 'pattern-detective',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 91, direction: 'up', title: 'pattern-detective', score: 640, streak: 5, round: '2/8' }),
      rounds: 7,
      timer: { seconds: 30, perRound: true },
      howTo: [
        'A classic chart pattern is forming into the freeze.',
        'Name it — then we reveal the break and measured-move idea.',
        'Harder rounds mix lookalikes (wedges vs flags, H&S vs double top).',
      ],
      async onRound(g, { rng, stage, difficulty }) {
        const pool = difficulty < 0.35 ? EASY : difficulty < 0.7 ? [...EASY, ...HARD.slice(0, 3)] : [...EASY, ...HARD];
        // Triangles and wedges have no scanner rule: real charts use the scanner kinds, and textbook
        // rounds draw a triangle / wedge from chartScenario (via textbookExample) when one is picked.
        const scanKinds = pool.filter((k) => SETUP_KINDS[k]);
        const q = { kinds: scanKinds, before: Math.round(80 - 20 * difficulty), after: 20 };
        const real = await g.realRound(q);
        let r = real;
        if (!r) {
          const pick = rng.pick(pool);
          r = SETUP_KINDS[pick] ? simRound(rng, q) : textbookExample([pick], rng, { after: 20 });
          if (r && !r.outcome && r.setup) r.outcome = outcomeOf(r.candles, r.decisionIdx, { bars: 20, direction: r.setup.direction });
        }
        const kind = r.setup?.kind || rng.pick(pool);
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'Which chart pattern is this?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 350, showVolume: difficulty < 0.55, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Chart pattern mystery; breakout future hidden',
        });
        const distractors = rng.shuffle((real ? scanKinds : pool).filter((k) => k !== kind)).slice(0, 3);
        g.setHint('Find the pole or the twin swings first, then the boundary that must break.');
        g.ask({
          options: rng.shuffle([kind, ...distractors].map((k) => ({ label: nameOf(k), value: k }))),
          answer: kind,
          explain: `<strong>${nameOf(kind)}</strong>. Sample outcome: ${r.outcome?.result || 'n/a'} (${r.outcome?.r ?? '?'} ATR). Measured targets are guidelines.`,
          onAnswer: (ok) => {
            chart.reveal({ to: r.candles.length, interval: 35 });
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
