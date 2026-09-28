// Level Hunter — pick whether price is reacting at support, resistance, or neither.
import { GameShell, explainChoice } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { chartScenario } from '../core/patterns.js';

function textbook(rng, difficulty) {
  const ids = ['double-bottom', 'double-top', 'ascending-triangle', 'descending-triangle'];
  const id = rng.pick(ids);
  const sc = chartScenario(id, { seed: rng.int(1, 1e9), count: Math.round(90 - 10 * difficulty), after: 12, outcome: rng.chance(0.55) ? 'success' : 'fail' });
  const decisionIdx = Math.max(10, sc.breakoutIdx - 1);
  // The marked level is the pattern's breakout line, not yet broken at the freeze: above price
  // (the neckline / flat top of a bullish pattern) it is resistance, below price it is support.
  const kind = sc.candles[decisionIdx].c < sc.level ? 'resistance' : 'support';
  return { candles: sc.candles, decisionIdx, level: sc.level, kind, name: sc.name };
}

export default {
  id: 'level-hunter',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 52, direction: 'down', title: 'level-hunter', score: 390, streak: 2, round: '2/8' }),
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
        const r = real
          ? {
            candles: real.candles,
            decisionIdx: real.decisionIdx,
            level: real.setup?.meta?.level,
            kind: /support|bounce|breakout-up|double-bottom/i.test(real.setup?.kind || '') ? 'support'
              : /resist|reject|breakout-down|double-top/i.test(real.setup?.kind || '') ? 'resistance' : 'unclear',
            decimals: real.decimals,
            name: real.setup?.meta?.name || real.setup?.kind,
          }
          : textbook(rng, difficulty);
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'How is price interacting with the key level?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 340, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Chart with a horizontal level to classify',
        });
        if (Number.isFinite(r.level)) chart.addHLine({ price: r.level, color: 'accent', dashed: true, label: 'Level' });
        g.setHint('Support = buyers defending from below. Resistance = sellers capping from above.');
        g.ask({
          options: [
            { label: 'Support (buyers defending)', value: 'support' },
            { label: 'Resistance (sellers capping)', value: 'resistance' },
            { label: 'Unclear / transitioning', value: 'unclear' },
          ],
          answer: r.kind === 'unclear' ? 'unclear' : r.kind,
          explain: explainChoice(
            `<strong>${r.kind}</strong>${r.name ? ` · ${r.name}` : ''}. Levels flip roles after decisive breaks.`,
            (pick) => {
              if (r.kind === 'unclear') return 'Price keeps closing on both sides of this level, so neither side is clearly defending it.';
              const where = r.kind === 'support' ? 'below price, acting as a floor that buyers defend' : 'above price, acting as a ceiling that sellers defend';
              if (pick === 'unclear') return `The level is clear enough: it sits ${where}.`;
              return `${r.kind === 'support' ? 'Resistance is a ceiling above price' : 'Support is a floor below price'}. Here the level sits ${where}: ${r.kind}.`;
            },
          ),
          onAnswer: (ok) => {
            chart.reveal({ to: r.candles.length, interval: 40 });
            verdictFlourish(stage, { ok, title: ok ? 'Solid read' : 'Review the chart', scoreDelta: ok ? 100 : 0 });
          },
        });
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
