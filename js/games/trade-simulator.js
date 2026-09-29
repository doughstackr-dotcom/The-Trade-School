// Trade Simulator — multi-step trade management: entry, stop, trail, journal.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';

function book() {
  return { equity: 25000, dayR: 0, trades: 0, wins: 0, violations: 0 };
}

function scenario(rng, difficulty) {
  const direction = rng.pick(['up', 'down']);
  const ts = trendSeries({
    seed: rng.int(1, 1e9),
    count: 80,
    direction,
    swings: 3,
  });
  const decisionIdx = 50 + rng.int(0, 8);
  const entry = ts.candles[decisionIdx].c;
  // The plan trades with the chart's trend (trendSeries returns only { candles, swings }).
  const dir = direction === 'down' ? -1 : 1;
  const atr = Math.max(0.2, Math.abs(ts.candles[decisionIdx].h - ts.candles[decisionIdx].l) * 2);
  const stop = +(entry - dir * atr).toFixed(2);
  const target = +(entry + dir * atr * (difficulty > 0.6 ? 2 : 2.5)).toFixed(2);
  return { candles: ts.candles, decisionIdx, entry, stop, target, dir };
}

// Settle against the actual hidden candles. If stop and target are both touched in one candle,
// assume the stop went first because their intrabar order is unknowable from OHLC data.
function settleTrade(candles, decisionIdx, entry, stop, target, dir, trail = false) {
  const risk = Math.abs(entry - stop);
  const trigger = entry + dir * risk * 1.5;
  let activeStop = stop;
  let armed = false;
  for (let i = decisionIdx + 1; i < candles.length; i++) {
    const c = candles[i];
    const hit = (price) => dir > 0 ? c.l <= price : c.h >= price;
    const reached = (price) => dir > 0 ? c.h >= price : c.l <= price;
    if (hit(activeStop)) return { r: armed ? 0 : -1, exitIdx: i, reason: armed ? 'trailing stop at entry' : 'planned stop' };
    if (trail && !armed && reached(trigger)) {
      armed = true;
      activeStop = entry;
      if (hit(activeStop)) return { r: 0, exitIdx: i, reason: 'trailing stop at entry' };
    }
    if (reached(target)) return { r: Math.abs(target - entry) / risk, exitIdx: i, reason: 'planned target' };
  }
  const exitIdx = candles.length - 1;
  const r = Math.max(-1, Math.min(Math.abs(target - entry) / risk, ((candles[exitIdx].c - entry) * dir) / risk));
  return { r, exitIdx, reason: 'window close' };
}

export default {
  id: 'trade-simulator',
  mount(root, ctx) {
    const state = book();
    const game = new GameShell(root, ctx, {
      preview: (el) => gameplayPreview(el, { seed: 66, direction: 'up', title: 'trade-simulator', score: 200, streak: 2, round: '2/3' }),
      rounds: 6,
      timer: { seconds: 45, perRound: true },
      howTo: [
        'Each round is a trade decision on a chart with a suggested plan.',
        'Take it, skip it, or manage an open winner (trail / scale).',
        'Desk rules: 1R risk, max 3R daily loss — revenge trades are wrong.',
      ],
      onStart() {
        state.equity = 25000;
        state.dayR = 0;
        state.trades = 0;
        state.wins = 0;
        state.violations = 0;
      },
      async onRound(g, { rng, stage, difficulty }) {
        const real = await g.realRound({
          kinds: ['bull-flag', 'bear-flag', 'breakout-up', 'breakout-down'],
          before: 60,
          after: 20,
        });
        let candles, decisionIdx, dir, entry, stop, target, decimals = 2;
        if (real) {
          candles = real.candles;
          decisionIdx = real.decisionIdx;
          dir = real.setup?.direction === 'bearish' ? -1 : 1;
          decimals = Math.max(0, Math.min(6, real.decimals ?? 2));
          entry = candles[decisionIdx].c;
          const atr = Math.max(Math.abs(candles[decisionIdx].h - candles[decisionIdx].l) * 2, entry * 0.005, 10 ** -decimals);
          stop = +(entry - dir * atr).toFixed(decimals);
          target = +(entry + dir * atr * 2).toFixed(decimals);
        } else {
          const s = scenario(rng, difficulty);
          ({ candles, decisionIdx, dir, entry, stop, target } = s);
        }

        const planR = Math.round((Math.abs(target - entry) / Math.abs(entry - stop)) * 10) / 10;
        const planQ = h('p', { class: 'quiz__q' },
          `Plan: ${dir > 0 ? 'LONG' : 'SHORT'} @ ${entry.toFixed(decimals)}, stop ${stop.toFixed(decimals)}, target ${target.toFixed(decimals)} (≈${planR}R). Your call?`);
        stage.append(
          h('div', { class: 'callout risk-hud', role: 'status' },
            h('p', null, `Desk · equity $${state.equity.toLocaleString()} · day P&L ${state.dayR.toFixed(1)}R · trades ${state.trades} · wins ${state.wins}`)),
          planQ,
        );
        const host = h('div', { class: 'chart-frame' });
        stage.append(host);
        const chart = new CandleChart(host, {
          candles, visible: decisionIdx + 1, slots: candles.length,
          height: 200, decimals, yPad: 0.14, ariaLabel: 'Trade simulator chart',
        });
        chart.addHLine({ price: entry, color: 'accent', label: 'Entry' });
        chart.addHLine({ price: stop, color: 'bear', label: 'Stop' });
        chart.addHLine({ price: target, color: 'bull', label: 'Target' });

        const dayHot = state.dayR - 1 < -3;
        const phases = [
          {
            when: dayHot,
            answer: 'skip',
            options: [
              { label: 'Skip — daily loss limit nearly hit', value: 'skip' },
              { label: 'Take it at double size to recover', value: 'revenge' },
              { label: 'Remove the stop', value: 'nostop' },
            ],
            explain: '<strong>Skip.</strong> Another 1R loss could exceed the 3R daily cap.',
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
            explain: '<strong>Take at plan size.</strong> Judge the planned entry and risk, then inspect the revealed path.',
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
            explain: '<strong>Trail per plan.</strong> If price reaches +1.5R, protect the entry; the hidden candles determine the outcome.',
          },
        ];
        const phase = phases.find((p) => p.when) || phases[1];
        if (phase.answer === 'trail') planQ.textContent = planQ.textContent.replace('Your call?', 'If you take it and price reaches +1.5R, how do you manage the winner?');
        g.setHint('Process over outcome: size, stop, daily limit.');
        const quiz = g.ask({
          options: rng.shuffle(phase.options),
          answer: phase.answer,
          explain: phase.explain,
          onAnswer: (ok, value) => {
            if (!ok) state.violations += 1;
            let detail = value === 'skip' ? 'No order placed; the desk remains flat.' : 'Rule-breaking action rejected by the desk; no order placed.';
            if (value === 'take' || value === 'trail') {
              const result = settleTrade(candles, decisionIdx, entry, stop, target, dir, value === 'trail');
              state.trades += 1;
              state.dayR += result.r;
              state.wins += result.r > 0 ? 1 : 0;
              state.equity = Math.round(state.equity * (1 + result.r * 0.01));
              chart.addMarker({ idx: result.exitIdx, position: result.r >= 0 ? 'above' : 'below', shape: 'dot', color: result.r >= 0 ? 'bull' : 'bear', text: `${result.r >= 0 ? '+' : ''}${result.r.toFixed(1)}R` });
              detail = `${result.reason}: ${result.r >= 0 ? '+' : ''}${result.r.toFixed(1)}R on the revealed chart.`;
            }
            chart.reveal({ to: candles.length, interval: 35 });
            verdictFlourish(stage, { ok, title: ok ? 'Desk rule held' : 'Rule slip', detail, scoreDelta: ok ? 100 : 0 });
          },
        });
        stage.insertBefore(quiz, host);
        return () => chart.destroy();
      },
      onEnd() {
        return h('p', { class: 'callout' }, `Desk close · equity $${state.equity.toLocaleString()} · ${state.trades} trades · ${state.wins} winners · ${state.violations} rule slips.`);
      },
    });
    return () => game.destroy();
  },
};
