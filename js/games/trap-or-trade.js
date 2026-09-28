// Trap or Trade — breakout, fakeout or wait on a live decision chart.
import { GameShell, explainChoice } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { annotateSetup } from '../core/lesson-kit.js';
import { chartScenario } from '../core/patterns.js';

/** First candle after the break that closes back inside the level (-1 if none). */
function closeBackIdx(candles, from, level, dir) {
  for (let i = from + 1; i < candles.length; i++) {
    if (dir > 0 ? candles[i].c < level : candles[i].c > level) return i;
  }
  return -1;
}

const WHY = {
  'trade|fade': 'Fading needs evidence that the break failed: a close back inside the level. Here the candle closed through the level and has not come back.',
  'trade|wait': 'Waiting for a retest is a valid style, but this is the signal itself: a clean close through the level. Retests do not always come, so the breakout trade is the read here.',
  'fade|trade': 'The break already failed: price closed back inside the level. Trading the breakout now means joining the side that just got trapped.',
  'fade|wait': 'Waiting is never a disaster, but the signal is already on the chart: a break that closes back inside the level is the classic trap, and fading it has a clear stop beyond the failed break’s extreme.',
  'wait|trade': 'There is no break yet: price is still on the near side of the level. Buying (or selling) before a close through the level is anticipating, not trading the signal.',
  'wait|fade': 'Nothing has failed yet: price has not even closed through the level. A fade needs a break that then closes back inside.',
};

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
  let decisionIdx = sc.breakoutIdx;
  if (trap) {
    // Freeze on the close back inside the level, so the trap is visible before you answer.
    const back = closeBackIdx(sc.candles, sc.breakoutIdx, sc.level, sc.direction);
    if (back > 0 && back < sc.candles.length - 3) {
      answer = 'fade';
      decisionIdx = back;
    } else answer = 'wait';
  } else if (wait) {
    answer = 'wait';
    decisionIdx = Math.max(5, sc.breakoutIdx - 2);
  }
  if (answer === 'wait' && decisionIdx === sc.breakoutIdx) decisionIdx = Math.max(5, sc.breakoutIdx - 2);
  return {
    candles: sc.candles,
    decisionIdx,
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
      preview: (el) => gameplayPreview(el, { seed: 48, direction: 'down', title: 'trap-or-trade', score: 590, streak: 4, round: '2/8' }),
      rounds: 8,
      timer: { seconds: 28, perRound: true },
      howTo: [
        'Price is challenging a level. Read where the last candle closed relative to it, and the volume.',
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
          // Breakouts freeze on the breakout close; fakeouts on the close back inside the level
          // (the scanner's decision candle), so the trap is visible before you answer.
          r = {
            candles: real.candles,
            decisionIdx: real.decisionIdx,
            direction: /-down$/.test(k) ? -1 : 1,
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
          height: 350, showVolume: true, decimals: r.decimals ?? 2, yPad: 0.14,
          ariaLabel: 'Breakout decision chart with volume',
        });
        if (Number.isFinite(r.level)) chart.addHLine({ price: r.level, color: 'accent', dashed: true, label: 'Level' });
        chart.addMarker({ idx: r.decisionIdx, position: r.direction < 0 ? 'below' : 'above', shape: 'dot', color: 'accent' });
        g.setHint('A close through the level → trade. A break that then closed back inside → fade. No close through the level yet → wait.');
        g.ask({
          options: [
            { label: 'Trade the breakout', value: 'trade' },
            { label: 'Fade the trap', value: 'fade' },
            { label: 'Wait for retest / clarity', value: 'wait' },
          ],
          answer: r.answer,
          explain: explainChoice(
            `<strong>${r.answer === 'trade' ? 'Trade' : r.answer === 'fade' ? 'Fade' : 'Wait'}</strong> · ${r.name || ''}. Sample result: ${r.outcome?.result || 'see reveal'}.`,
            (pick) => WHY[`${r.answer}|${pick}`],
          ),
          onAnswer: (ok) => {
            chart.reveal({ to: r.candles.length, interval: 40 });
            try { if (r.setup) annotateSetup(r.setup, chart, r); } catch { /* */ }
            verdictFlourish(stage, { ok, title: ok ? 'Solid read' : 'Review the chart', scoreDelta: ok ? 100 : 0 });
          },
        });
        return () => chart.destroy();
      },
    });
    return () => game.destroy();
  },
};
