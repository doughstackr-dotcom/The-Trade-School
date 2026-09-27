// Trap or Trade — breakout, fakeout or wait on a live decision chart.
import { GameShell } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { annotateSetup } from '../core/lesson-kit.js';
import { chartScenario } from '../core/patterns.js';

function textbook(rng, difficulty) {
  const trap = rng.chance(0.4 + 0.15 * difficulty);
  const wait = !trap && rng.chance(0.25);
  const id = rng.pick(['ascending-triangle', 'descending-triangle', 'double-top', 'double-bottom', 'bull-flag', 'bear-flag']);
  const sc = chartScenario(id, {
    seed: rng.int(1, 1e9),
    count: Math.round(100 - 15 * difficulty),
    after: 18,
    outcome: trap ? 'fail' : 'success',
  });
  let answer = 'trade';
  if (trap) answer = 'fade';
  else if (wait) answer = 'wait';
  return {
    candles: sc.candles,
    decisionIdx: wait ? Math.max(5, sc.breakoutIdx - 2) : sc.breakoutIdx,
    level: sc.level,
    answer,
    name: sc.name,
    direction: sc.direction,
  };
}

export default {
  id: 'trap-or-trade',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      rounds: 8,
      timer: { seconds: 28, perRound: true },
      howTo: [
        'Price is challenging a level. Read the close and the volume context.',
        'Trade the breakout, fade the trap, or wait for a retest.',
        'We grade your read; the reveal shows what this sample did next.',
      ],
      async onRound(g, { rng, stage, difficulty }) {
        const real = await g.realRound({
          kinds: ['breakout-up', 'breakout-down', 'fakeout-up', 'fakeout-down'],
          intervals: ['1d', '1w'],
          before: Math.round(70 - 15 * difficulty),
          after: 16,
        });
        let r;
        if (real) {
          const k = real.setup?.kind || '';
          const breakIdx = /^fakeout/.test(k) && Number.isFinite(real.setup.meta?.breakoutIdx)
            ? real.setup.meta.breakoutIdx
            : real.decisionIdx;
          r = {
            candles: real.candles,
            decisionIdx: breakIdx,
            level: real.setup?.meta?.level,
            answer: /^fakeout/.test(k) ? 'fade' : 'trade',
            name: real.setup?.meta?.name || k,
            decimals: real.decimals,
            setup: real.setup,
            outcome: real.outcome,
          };
        } else r = textbook(rng, difficulty);

        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'Break of the level — trade it, fade the trap, or wait?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 310, showVolume: true, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Breakout decision chart with volume',
        });
        if (Number.isFinite(r.level)) chart.addHLine({ price: r.level, color: 'accent', dashed: true, label: 'Level' });
        chart.addMarker({ idx: r.decisionIdx, position: 'above', shape: 'dot', color: 'accent' });
        g.setHint('Decisive close + expanding volume → trade. Close back inside → fade. Marginal poke → wait.');
        g.ask({
          options: [
            { label: 'Trade the breakout', value: 'trade' },
            { label: 'Fade the trap', value: 'fade' },
            { label: 'Wait for retest / clarity', value: 'wait' },
          ],
          answer: r.answer,
          explain: `<strong>${r.answer === 'trade' ? 'Trade' : r.answer === 'fade' ? 'Fade' : 'Wait'}</strong> · ${r.name || ''}. Sample result: ${r.outcome?.result || 'see reveal'}.`,
          onAnswer: () => {
            chart.reveal({ to: r.candles.length, interval: 40 });
            try { if (r.setup) annotateSetup(r.setup, chart, r); } catch { /* */ }
          },
        });
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
