// Volume Verdict — interactive GameShell module.
import { GameShell } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { chartScenario } from '../core/patterns.js';

const TEXTBOOK_PATTERNS = ['ascending-triangle', 'descending-triangle', 'double-top', 'double-bottom', 'bull-flag', 'bear-flag'];

/** Textbook round: a chart-pattern breakout that either holds (strong volume) or fails (thin volume). */
function textbookRound(rng, difficulty) {
  const trap = rng.chance(0.5);
  const id = rng.pick(difficulty < 0.5 ? TEXTBOOK_PATTERNS.slice(0, 4) : TEXTBOOK_PATTERNS);
  const sc = chartScenario(id, { seed: rng.int(1, 2 ** 31 - 1), count: 96, after: 16, outcome: trap ? 'fail' : 'success' });
  return { candles: sc.candles, decisionIdx: sc.breakoutIdx, level: sc.level, trap, direction: sc.direction, name: sc.name };
}

export default {
  id: 'volume-verdict',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      rounds: 6,
      timer: { seconds: 25, perRound: true },
      howTo: [
        'Price has just broken a level. Check the volume under the breakout candle.',
        'Confirms: strong volume behind the move. Trap: thin volume, likely to fail.',
        'Watch the reveal: what happened next, and on real charts, which market it was.',
      ],
      async onRound(g, { rng, stage, difficulty }) {
        const real = await g.realRound({
          kinds: ['breakout-up', 'breakout-down', 'fakeout-up', 'fakeout-down'],
          intervals: ['1d', '1w'],
          before: 60,
          after: 14,
        });
        // A scanner fakeout is decided on the candle that closes back inside the range, so stop
        // the chart at its breakout candle (meta.breakoutIdx) or the answer would be visible.
        const kind = real?.setup?.kind || '';
        const r = real
          ? {
            candles: real.candles,
            decisionIdx: /^fakeout/.test(kind) && Number.isFinite(real.setup.meta?.breakoutIdx) ? real.setup.meta.breakoutIdx : real.decisionIdx,
            level: real.setup?.meta?.level,
            trap: /^fakeout/.test(kind),
            direction: /-down$/.test(kind) ? -1 : 1,
            decimals: real.decimals,
          }
          : textbookRound(rng, difficulty);
        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, `Price just broke ${r.direction < 0 ? 'down through support' : 'up through resistance'}. Does volume confirm the move?`), host);
        const chart = new CandleChart(host, {
          candles: r.candles,
          visible: r.decisionIdx + 1,
          slots: r.candles.length,
          height: 300,
          showVolume: true,
          decimals: r.decimals ?? 2,
          ariaLabel: 'Breakout chart with volume. The future is hidden until you answer.',
        });
        if (Number.isFinite(r.level)) chart.addHLine({ price: r.level, color: 'accent', dashed: true, label: 'Level' });
        chart.addMarker({ idx: r.decisionIdx, position: r.direction < 0 ? 'below' : 'above', shape: 'dot', color: 'accent' });
        g.setHint('Compare the breakout candle’s volume bar with the ten bars before it. Real breakouts usually come on clearly above-average volume.');
        g.ask({
          options: [
            { label: 'Trap: thin volume', value: 'trap' },
            { label: 'Confirms: strong volume', value: 'confirm' },
          ],
          answer: r.trap ? 'trap' : 'confirm',
          explain: r.trap
            ? '<strong>Trap.</strong> The break came on weak participation and price fell back inside the range.'
            : '<strong>Confirmed.</strong> Volume expanded on the break and price followed through.',
          onAnswer: () => {
            chart.reveal({ to: r.candles.length, interval: 45 });
          },
        });
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
