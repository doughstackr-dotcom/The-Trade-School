// What Happens Next? — predict direction / trade decision from a frozen setup.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { simRound } from '../core/scanner.js';
import { annotateSetup } from '../core/lesson-kit.js';

export default {
  id: 'what-next',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 82, direction: 'down', title: 'What Happens Next?', score: 180, streak: 2, round: '2/3' }),
      rounds: 8,
      timer: { seconds: 30, perRound: true },
      modes: [
        { id: 'beginner', label: 'Beginner', description: 'Call the direction: up, down or sideways.' },
        { id: 'advanced', label: 'Advanced', description: 'Trade decision: long, short or wait.', requires: 'advanced' },
      ],
      howTo: [
        'The chart freezes at a decision point.',
        'Beginner: most likely path. Advanced: long / short / wait with risk in mind.',
        'We grade the setup read; the reveal is one sample path, not destiny.',
      ],
      async onRound(g, { rng, stage, difficulty, mode }) {
        const kinds = difficulty < 0.4
          ? ['bull-flag', 'bear-flag', 'hammer', 'shooting-star']
          : ['bull-flag', 'bear-flag', 'double-top', 'double-bottom', 'breakout-up', 'breakout-down', 'fakeout-up', 'fakeout-down', 'range'];
        const q = { kinds, before: Math.round(70 - 15 * difficulty), after: 18 };
        const real = await g.realRound(q);
        let r = real || simRound(rng, q);
        for (let i = 0; !r && i < 6; i++) r = simRound(rng, q);
        if (!r) throw new Error('No suitable forecast setup found');
        const dir = r.setup?.direction === 'bearish' ? 'down' : r.setup?.direction === 'bullish' ? 'up' : 'sideways';
        const host = h('div', { class: 'chart-frame' });
        const advanced = mode === 'advanced';
        const freeze = r.candles[r.decisionIdx].c;
        const future = r.candles.at(-1).c;
        const move = ((future / freeze - 1) * 100).toFixed(1);
        const sample = `The sample path moved ${Number(move) >= 0 ? '+' : ''}${move}% after the freeze.`;
        const reveal = (ok) => {
          chart.addHLine({ price: freeze, color: 'accent', dashed: true, label: 'Freeze' });
          chart.reveal({ to: r.candles.length, interval: 40 });
          try { annotateSetup(r.setup, chart, r); } catch { /* optional annotation */ }
          verdictFlourish(stage, { ok, title: ok ? 'Forecast locked' : 'Review the setup', detail: sample, scoreDelta: ok ? 100 : 0 });
        };
        stage.append(
          h('p', { class: 'quiz__q' }, advanced
            ? 'Trade decision at the freeze (plan a stop either way)?'
            : 'Most likely path from here?'),
          host,
        );
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 250, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Frozen decision chart',
        });
        g.setHint(advanced
          ? 'If confluence is weak or fakeout risk is high, waiting is a valid trade.'
          : 'Trend + level + trigger agree → lean that way; otherwise sideways/unclear.');
        if (advanced) {
          const ans = /^fakeout/.test(r.setup?.kind || '') ? 'wait'
            : dir === 'up' ? 'long' : dir === 'down' ? 'short' : 'wait';
          const quiz = g.ask({
            options: [
              { label: 'Long', value: 'long' },
              { label: 'Short', value: 'short' },
              { label: 'Wait', value: 'wait' },
            ],
            answer: ans,
            explain: `<strong>${ans}</strong> · ${r.setup?.meta?.name || r.setup?.kind || 'setup'}. This is a plan based on evidence, not a guarantee.`,
            onAnswer: reveal,
          });
          stage.insertBefore(quiz, host);
        } else {
          const quiz = g.ask({
            options: [
              { label: 'Up', value: 'up' },
              { label: 'Down', value: 'down' },
              { label: 'Sideways / unclear', value: 'sideways' },
            ],
            answer: dir,
            explain: `Lean <strong>${dir}</strong> from ${r.setup?.meta?.name || r.setup?.kind || 'structure'}. Not a guarantee.`,
            onAnswer: reveal,
          });
          stage.insertBefore(quiz, host);
        }
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
