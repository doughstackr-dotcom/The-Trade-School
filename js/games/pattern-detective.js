// Pattern Detective — identify chart patterns and estimate measured-move direction.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { simRound } from '../core/scanner.js';
import { annotateSetup } from '../core/lesson-kit.js';
import { CHART_PATTERNS } from '../core/patterns.js';

const EASY = ['bull-flag', 'bear-flag', 'double-top', 'double-bottom'];
// Scanner-detectable chart kinds only (js/core/scanner.js SETUP_KINDS) — the pool is also
// the distractor source, so every id here must exist in SETUP_KINDS.
const HARD = ['head-and-shoulders', 'inverse-head-and-shoulders'];

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
        'Harder rounds add the H&S family — the lookalike trap is double top vs head & shoulders.',
      ],
      async onRound(g, { rng, stage, difficulty }) {
        const pool = difficulty < 0.35 ? EASY : difficulty < 0.7 ? [...EASY, ...HARD.slice(0, 3)] : [...EASY, ...HARD];
        const q = { kinds: pool, before: Math.round(80 - 20 * difficulty), after: 20 };
        const real = await g.realRound(q);
        // simRound is stochastic (random markets × limited tries) and can return null — retry
        // with fresh rng draws before surfacing a broken round.
        let r = real || simRound(rng, q);
        for (let i = 0; !r && i < 6; i++) r = simRound(rng, q);
        if (!r) throw new Error('simRound found no setup after retries');
        const kind = r.setup?.kind || rng.pick(pool);
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'Which chart pattern is this?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 350, showVolume: difficulty < 0.55, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Chart pattern mystery; breakout future hidden',
        });
        const distractors = rng.shuffle(pool.filter((k) => k !== kind)).slice(0, 3);
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
