// Level Hunter — pick whether price is reacting at support, resistance, or neither.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { chartScenario } from '../core/patterns.js';

function textbook(rng, difficulty) {
  const ids = ['double-bottom', 'double-top', 'ascending-triangle', 'descending-triangle'];
  const id = rng.pick(ids);
  const sc = chartScenario(id, { seed: rng.int(1, 1e9), count: Math.round(90 - 10 * difficulty), after: 12, outcome: rng.chance(0.55) ? 'success' : 'fail' });
  // The drawn level is the one about to break: above price (capping it) for the bullish patterns.
  const kind = /bottom|ascending/.test(id) ? 'resistance' : 'support';
  return { candles: sc.candles, decisionIdx: Math.max(10, sc.breakoutIdx - 1), level: sc.level, kind, name: sc.name };
}

export default {
  id: 'level-hunter',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 52, direction: 'down', title: 'Level Hunter', score: 180, streak: 2, round: '2/3' }),
      rounds: 7,
      timer: { seconds: 26, perRound: true },
      howTo: [
        'A horizontal level is marked (or implied by reactions).',
        'Is price treating it as support, resistance, or is it unclear?',
        'Harder rounds hide the label and shorten context.',
      ],
      async onRound(g, { rng, stage, difficulty }) {
        const real = await g.realRound({
          kinds: ['support-bounce', 'resistance-reject', 'breakout-up', 'breakout-down'],
          before: Math.round(60 - 15 * difficulty),
          after: 12,
        });
        // Early rounds stop before the break. Later rounds sometimes freeze on the break itself:
        // the old role has failed, and a new role needs a retest before it can be called support/resistance.
        const breakout = /^breakout/.test(real?.setup?.kind || '');
        const transition = breakout && difficulty > 0.55 && rng.chance(0.5);
        const r = real
          ? {
            candles: real.candles,
            decisionIdx: breakout && !transition ? Math.max(0, real.decisionIdx - 1) : real.decisionIdx,
            level: real.setup?.meta?.level,
            kind: transition ? 'unclear'
              : /support|bounce|breakout-down/i.test(real.setup?.kind || '') ? 'support'
              : /resist|reject|breakout-up/i.test(real.setup?.kind || '') ? 'resistance' : 'unclear',
            decimals: real.decimals,
            name: real.setup?.meta?.name || real.setup?.kind,
            transition,
          }
          : textbook(rng, difficulty);
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'How is price interacting with the key level?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 250, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Chart with a horizontal level to classify',
        });
        if (Number.isFinite(r.level)) chart.addHLine({ price: r.level, color: 'accent', dashed: true, label: 'Level' });
        g.setHint('Support holds from below. Resistance caps from above. A close through a level needs a retest before its new role is proven.');
        const quiz = g.ask({
          options: [
            { label: 'Support (buyers defending)', value: 'support' },
            { label: 'Resistance (sellers capping)', value: 'resistance' },
            { label: 'Unclear / transitioning', value: 'unclear' },
          ],
          answer: r.kind === 'unclear' ? 'unclear' : r.kind,
          explain: r.transition
            ? '<strong>Transitioning.</strong> Price closed through the old level; wait for a retest before declaring a new role.'
            : `<strong>${r.kind}</strong>${r.name ? ` · ${r.name}` : ''}. Several reactions make the role more credible; a later break can change it.`,
          onAnswer: (ok) => {
            chart.reveal({ to: r.candles.length, interval: 40 });
            if (r.transition) chart.addMarker({ idx: r.decisionIdx, position: 'above', shape: 'dot', color: 'accent' });
            verdictFlourish(stage, { ok, title: ok ? 'Level read' : 'Recheck the level', detail: r.transition ? 'A break starts a new test; it does not prove the role flip.' : `This level acts as ${r.kind}.`, scoreDelta: ok ? 100 : 0 });
          },
        });
        stage.insertBefore(quiz, host);
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
