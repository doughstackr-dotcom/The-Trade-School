// Pattern Detective — identify chart patterns and estimate measured-move direction.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { simRound } from '../core/scanner.js';
import { annotateSetup } from '../core/lesson-kit.js';
import { CHART_PATTERNS, chartScenario } from '../core/patterns.js';

const EASY = ['bull-flag', 'bear-flag', 'double-top', 'double-bottom'];
// Scanner-detectable chart kinds only (js/core/scanner.js SETUP_KINDS) — the pool is also
// the distractor source, so every id here must exist in SETUP_KINDS.
const HARD = ['head-and-shoulders', 'inverse-head-and-shoulders'];
const TEXTBOOK = ['ascending-triangle', 'descending-triangle', 'rising-wedge', 'falling-wedge', 'triple-top', 'triple-bottom', 'bull-pennant', 'bear-pennant'];

function nameOf(kind) {
  return CHART_PATTERNS[kind]?.name || kind.replace(/-/g, ' ');
}

export default {
  id: 'pattern-detective',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 91, direction: 'up', title: 'pattern-detective', score: 200, streak: 2, round: '2/3' }),
      rounds: 7,
      timer: { seconds: 30, perRound: true },
      howTo: [
        'A classic chart pattern is forming into the freeze.',
        'Name it — then we reveal the break and measured-move idea.',
        'Harder rounds add the H&S family — the lookalike trap is double top vs head & shoulders.',
      ],
      async onRound(g, { rng, stage, difficulty }) {
        const scannerPool = difficulty < 0.3 ? EASY : [...EASY, ...HARD];
        const pool = difficulty < 0.45 ? scannerPool : [...scannerPool, ...TEXTBOOK.slice(0, difficulty < 0.7 ? 4 : TEXTBOOK.length)];
        const q = { kinds: scannerPool, before: Math.round(80 - 20 * difficulty), after: 20 };
        const real = await g.realRound(q);
        let r = real;
        if (!r && g.source !== 'real' && difficulty >= 0.45 && rng.chance(0.6)) {
          const id = rng.pick(pool.filter((k) => TEXTBOOK.includes(k)));
          const sc = chartScenario(id, { seed: rng.int(1, 1e9), count: Math.round(100 - 12 * difficulty), after: 20 });
          r = { candles: sc.candles, decisionIdx: sc.breakoutIdx, setup: { kind: id }, pattern: sc };
        }
        // The scanner is stochastic; retry its detectable kinds before skipping a round.
        for (let i = 0; !r && i < 7; i++) r = simRound(rng, q);
        if (!r) throw new Error('simRound found no setup after retries');
        const kind = r.setup?.kind || rng.pick(pool);
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'Which pattern formed before the latest break?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 255, showVolume: difficulty < 0.55, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Chart pattern mystery; breakout future hidden',
        });
        const distractors = rng.shuffle(pool.filter((k) => k !== kind)).slice(0, 3);
        g.setHint('Find the pole or the twin swings first, then the boundary that must break.');
        const quiz = g.ask({
          options: rng.shuffle([kind, ...distractors].map((k) => ({ label: nameOf(k), value: k }))),
          answer: kind,
          explain: `<strong>${nameOf(kind)}</strong>. ${r.outcome ? `Sample outcome: ${r.outcome.result || 'n/a'} (${r.outcome.r ?? '?'} ATR).` : 'This is a generated pattern example.'} Measured targets are guidelines.`,
          onAnswer: (ok) => {
            chart.reveal({ to: r.candles.length, interval: 35 });
            if (r.pattern) {
              if (Number.isFinite(r.pattern.level)) chart.addHLine({ price: r.pattern.level, color: 'accent', dashed: true, label: 'Break line' });
              for (const p of r.pattern.keyPoints.filter((p) => p.idx <= r.decisionIdx)) chart.addMarker({ idx: p.idx, position: 'above', shape: 'dot', color: 'info', text: p.label });
            } else try { annotateSetup(r.setup, chart, r); } catch { /* */ }
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
