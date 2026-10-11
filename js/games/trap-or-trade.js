// Trap or Trade — breakout, fakeout or wait on a live decision chart.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { annotateSetup } from '../core/lesson-kit.js';
import { chartScenario } from '../core/patterns.js';

function textbook(rng, difficulty) {
  const decision = rng.pick(difficulty < 0.25 ? ['trade', 'wait'] : ['trade', 'fade', 'wait']);
  const id = rng.pick(['ascending-triangle', 'descending-triangle', 'double-top', 'double-bottom', 'bull-flag', 'bear-flag']);
  const sc = chartScenario(id, {
    seed: rng.int(1, 1e9),
    count: Math.round(100 - 15 * difficulty),
    after: 18,
    outcome: decision === 'fade' ? 'fail' : 'success',
  });
  // A failed breakout cannot be identified at the first break. Freeze only after price closes
  // back inside the level; the trade and wait decisions freeze on their own observable signals.
  const backInside = sc.candles.findIndex((c, i) => i > sc.breakoutIdx
    && (sc.direction > 0 ? c.c < sc.level : c.c > sc.level));
  const answer = decision === 'fade' && backInside < 0 ? 'wait' : decision;
  return {
    candles: sc.candles,
    decisionIdx: answer === 'wait' ? Math.max(5, sc.breakoutIdx - 2) : answer === 'fade' ? backInside : sc.breakoutIdx,
    level: sc.level,
    answer,
    name: sc.name,
    direction: sc.direction,
    breakoutIdx: sc.breakoutIdx,
    outcome: { result: sc.reachedTarget ? 'measured target reached' : 'measured target missed' },
  };
}

export default {
  id: 'trap-or-trade',
  mount(root, ctx) {
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 48, direction: 'down', title: 'trap-or-trade', score: 200, streak: 2, round: '2/3' }),
      rounds: 8,
      timer: { seconds: 28, perRound: true },
      howTo: [
        'Price is challenging a level. Read only the closes and volume visible at the freeze.',
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
          // Fakeouts freeze on the close back inside (the scanner's decision candle), so the trap
          // is on the chart when you answer; on the break candle itself it looks like a breakout.
          r = {
            candles: real.candles,
            decisionIdx: real.decisionIdx,
            level: real.setup?.meta?.level,
            answer: /^fakeout/.test(k) ? 'fade' : 'trade',
            name: real.setup?.meta?.name || k,
            decimals: real.decimals,
            setup: real.setup,
            outcome: real.outcome,
          };
        } else r = textbook(rng, difficulty);

        const host = h('div', { class: 'chart-frame' });
        stage.append(h('p', { class: 'quiz__q' }, 'At this freeze: confirmed breakout, failed break, or no clear break yet?'), host);
        const chart = new CandleChart(host, {
          candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
          height: 255, showVolume: true, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Breakout decision chart with volume',
        });
        if (Number.isFinite(r.level)) chart.addHLine({ price: r.level, color: 'accent', dashed: true, label: 'Level' });
        chart.addMarker({ idx: r.decisionIdx, position: 'above', shape: 'dot', color: 'accent' });
        if (r.answer === 'fade' && Number.isInteger(r.breakoutIdx)) chart.addMarker({ idx: r.breakoutIdx, position: 'above', shape: 'dot', color: 'warn', text: 'Break' });
        g.setHint('Decisive close + expanding volume → trade. Close back inside → fade. Marginal poke → wait.');
        const quiz = g.ask({
          options: [
            { label: 'Trade the breakout', value: 'trade' },
            { label: 'Fade the trap', value: 'fade' },
            { label: 'Wait for retest / clarity', value: 'wait' },
          ],
          answer: r.answer,
          explain: `<strong>${r.answer === 'trade' ? 'Trade' : r.answer === 'fade' ? 'Fade' : 'Wait'}</strong> · ${r.name || ''}. Sample result: ${r.outcome?.result || 'see reveal'}.`,
          onAnswer: (ok) => {
            chart.reveal({ to: r.candles.length, interval: 40 });
            try { if (r.setup) annotateSetup(r.setup, chart, r); } catch { /* */ }
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
