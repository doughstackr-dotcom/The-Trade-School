// What Happens Next? — predict direction / trade decision from a frozen setup.
import { GameShell, explainChoice } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { simRound } from '../core/scanner.js';
import { annotateSetup } from '../core/lesson-kit.js';

export default {
  id: 'what-next',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 82, direction: 'down', title: 'what-next', score: 480, streak: 2, round: '2/8' }),
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
          : ['bull-flag', 'bear-flag', 'double-top', 'double-bottom', 'breakout-up', 'breakout-down', 'fakeout-up', 'fakeout-down'];
        const q = { kinds, before: Math.round(70 - 15 * difficulty), after: 18 };
        const real = await g.realRound(q);
        const r = real || simRound(rng, q) || simRound(rng.fork('retry'), { ...q, kinds: ['bull-flag', 'bear-flag', 'breakout-up', 'breakout-down'] });
        if (!r) throw new Error('no round could be generated');
        const setupName = r.setup?.meta?.name || r.setup?.kind || 'this setup';
        const dir = r.setup?.direction === 'bearish' ? 'down' : r.setup?.direction === 'bullish' ? 'up' : 'sideways';
        const bias = dir === 'up' ? 'bullish' : dir === 'down' ? 'bearish' : 'neutral';
        const host = h('div', { class: 'chart-frame' });
        const advanced = mode === 'advanced';
        stage.append(
          h('p', { class: 'quiz__q' }, advanced
            ? 'Trade decision at the freeze (plan a stop either way)?'
            : 'Most likely path from here?'),
          host,
        );
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 340, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Frozen decision chart',
        });
        g.setHint(advanced
          ? 'If confluence is weak or fakeout risk is high, waiting is a valid trade.'
          : 'Trend + level + trigger agree → lean that way; otherwise sideways/unclear.');
        if (advanced) {
          const ans = /^fakeout/.test(r.setup?.kind || '') ? 'wait'
            : dir === 'up' ? 'long' : dir === 'down' ? 'short' : 'wait';
          g.ask({
            options: [
              { label: 'Long', value: 'long' },
              { label: 'Short', value: 'short' },
              { label: 'Wait', value: 'wait' },
            ],
            answer: ans,
            explain: explainChoice(
              `<strong>${ans}</strong> · ${r.setup?.meta?.name || r.setup?.kind || 'setup'}. Sample: ${r.outcome?.result || 'n/a'}.`,
              (pick) => {
                if (ans === 'wait') {
                  return `This is a ${setupName}: a level just broke and then reversed back through it. After a whipsaw like that, chasing either side is a coin flip; wait for the next move to prove itself (or trade a planned fade with a tight stop).`;
                }
                if (pick === 'wait') return `Waiting is never a disaster, but this ${setupName} gives a defined ${ans} plan: a clear trigger with a stop just beyond the pattern.`;
                return `A ${setupName} is a ${bias} setup; going ${pick} fights it. You could be right on the outcome, but the read on the chart points ${ans}.`;
              },
            ),
            onAnswer: (ok) => {
              chart.reveal({ to: r.candles.length, interval: 40 });
              try { annotateSetup(r.setup, chart, r); } catch { /* */ }
            verdictFlourish(stage, { ok, title: ok ? 'Solid read' : 'Review the chart', scoreDelta: ok ? 100 : 0 });
          },
          });
        } else {
          g.ask({
            options: [
              { label: 'Up', value: 'up' },
              { label: 'Down', value: 'down' },
              { label: 'Sideways / unclear', value: 'sideways' },
            ],
            answer: dir,
            explain: explainChoice(
              `Lean <strong>${dir}</strong> from ${r.setup?.meta?.name || r.setup?.kind || 'structure'}. Not a guarantee.`,
              (pick) => (pick === 'sideways'
                ? `Sideways fits when trend, level and trigger disagree. Here a ${setupName} (a ${bias} setup) gives a clear lean ${dir}.`
                : dir === 'sideways'
                  ? `Nothing on this chart gives a clear directional edge, so calling ${pick} is a guess.`
                  : `A ${setupName} is a ${bias} setup, so the odds lean ${dir}, not ${pick}. Odds, not certainty: the reveal may still go either way.`),
            ),
            onAnswer: (ok) => {
              chart.reveal({ to: r.candles.length, interval: 40 });
              try { annotateSetup(r.setup, chart, r); } catch { /* */ }
            verdictFlourish(stage, { ok, title: ok ? 'Solid read' : 'Review the chart', scoreDelta: ok ? 100 : 0 });
          },
          });
        }
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
