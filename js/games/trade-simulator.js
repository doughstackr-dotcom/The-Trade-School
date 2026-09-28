// Trade Simulator — multi-step trade management: entry, stop, trail, journal.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';

function book() {
  return { equity: 25000, openR: 0, dayR: 0, trades: 0, wins: 0 };
}

function scenario(rng, difficulty, bookState) {
  const ts = trendSeries({
    seed: rng.int(1, 1e9),
    count: 80,
    direction: rng.pick(['up', 'down']),
    swings: 3,
  });
  const decisionIdx = 50 + rng.int(0, 8);
  const entry = ts.candles[decisionIdx].c;
  const dir = ts.direction === 'down' || rng.chance(0.15) ? -1 : 1;
  const atr = Math.max(0.2, Math.abs(ts.candles[decisionIdx].h - ts.candles[decisionIdx].l) * 2);
  const stop = +(entry - dir * atr).toFixed(2);
  const target = +(entry + dir * atr * (difficulty > 0.6 ? 2 : 2.5)).toFixed(2);
  return { candles: ts.candles, decisionIdx, entry, stop, target, dir, atr, bookState };
}

export default {
  id: 'trade-simulator',
  mount(root, ctx) {
    const state = book();
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 66, direction: 'up', title: 'trade-simulator', score: 780, streak: 6, round: '2/8' }),
      rounds: 6,
      timer: { seconds: 45, perRound: true },
      howTo: [
        'Each round is a trade decision on a chart with a suggested plan.',
        'Take it, skip it, or manage an open winner (trail / scale).',
        'Desk rules: 1R risk, max 3R daily loss — revenge trades are wrong.',
      ],
      onStart() {
        state.equity = 25000;
        state.openR = 0;
        state.dayR = 0;
        state.trades = 0;
        state.wins = 0;
      },
      async onRound(g, { rng, stage, difficulty }) {
        const real = await g.realRound({
          kinds: ['bull-flag', 'bear-flag', 'breakout-up', 'breakout-down'],
          before: 60,
          after: 20,
        });
        let candles, decisionIdx, dir, entry, stop, target;
        if (real) {
          candles = real.candles;
          decisionIdx = real.decisionIdx;
          dir = real.setup?.direction === 'bearish' ? -1 : 1;
          entry = candles[decisionIdx].c;
          const atr = Math.abs(candles[decisionIdx].h - candles[decisionIdx].l) * 2 || entry * 0.01;
          stop = +(entry - dir * atr).toFixed(2);
          target = +(entry + dir * atr * 2).toFixed(2);
        } else {
          const s = scenario(rng, difficulty, state);
          ({ candles, decisionIdx, dir, entry, stop, target } = s);
        }

        stage.append(
          h('div', { class: 'callout risk-hud', role: 'status' },
            h('p', null, `Desk · equity $${state.equity.toLocaleString()} · day P&amp;L ${state.dayR.toFixed(1)}R · trades ${state.trades}`)),
          h('p', { class: 'quiz__q' },
            `Plan: ${dir > 0 ? 'LONG' : 'SHORT'} @ ${entry.toFixed(2)}, stop ${stop.toFixed(2)}, target ${target.toFixed(2)} (≈2R). Your call?`),
        );
        const host = h('div', { class: 'chart-frame' });
        stage.append(host);
        const chart = new CandleChart(host, {
          candles, visible: decisionIdx + 1, slots: candles.length,
          height: 300, yPad: 0.14, ariaLabel: 'Trade simulator chart',
        });
        chart.addHLine({ price: entry, color: 'accent', label: 'Entry' });
        chart.addHLine({ price: stop, color: 'bear', label: 'Stop' });
        chart.addHLine({ price: target, color: 'bull', label: 'Target' });

        const dayHot = state.dayR <= -2.5;
        const phases = [
          {
            when: dayHot,
            answer: 'skip',
            options: [
              { label: 'Skip — daily loss limit nearly hit', value: 'skip' },
              { label: 'Take it at double size to recover', value: 'revenge' },
              { label: 'Remove the stop', value: 'nostop' },
            ],
            explain: '<strong>Skip.</strong> Hitting the daily cap is how accounts survive to trade tomorrow.',
          },
          {
            when: !dayHot && rng.chance(0.5),
            answer: 'take',
            options: [
              { label: 'Take the plan at 1R risk', value: 'take' },
              { label: 'Skip with no reason', value: 'skip' },
              { label: 'Widen stop “for room”', value: 'widen' },
              { label: 'Triple size — feels good', value: 'triple' },
            ],
            explain: '<strong>Take at plan size.</strong> Widening stops and sizing up on emotion are process fails.',
          },
          {
            when: true,
            answer: 'trail',
            options: [
              { label: 'Trail stop to breakeven / new HL after +1.5R', value: 'trail' },
              { label: 'Remove stop to “let it run”', value: 'nostop' },
              { label: 'Add size with no new stop', value: 'add' },
              { label: 'Close in panic before the plan says so', value: 'panic' },
            ],
            explain: '<strong>Trail per plan.</strong> Managing winners is still risk management.',
          },
        ];
        const phase = phases.find((p) => p.when) || phases[1];
        g.setHint('Process over outcome: size, stop, daily limit.');
        g.ask({
          options: rng.shuffle(phase.options),
          answer: phase.answer,
          explain: phase.explain,
          onAnswer: (ok) => {
            state.trades += 1;
            if (ok && phase.answer === 'take') {
              // simulate coin-flip-ish outcome biased by difficulty
              const win = rng.chance(0.48);
              state.dayR += win ? 2 : -1;
              state.wins += win ? 1 : 0;
              state.equity = Math.round(state.equity * (1 + (win ? 0.008 : -0.004)));
            } else if (ok && phase.answer === 'skip') {
              /* flat */
            } else if (!ok && (phase.options.some((o) => o.value === 'revenge') || phase.answer === 'trail')) {
              state.dayR -= 1;
            }
            chart.reveal({ to: candles.length, interval: 35 });
            verdictFlourish(stage, { ok, title: ok ? 'Solid read' : 'Review the chart', scoreDelta: ok ? 100 : 0 });
          },
        });
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
