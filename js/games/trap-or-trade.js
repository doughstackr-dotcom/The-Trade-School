// Fakeout Filter (v2 of Trap or Trade) — a gauntlet of breaks, traps and waits.
// Practice keeps the classic study quiz. Arcade and Survival run the filter belt: read
// each freeze fast, and twice per run you can arm DOUBLE DOWN — a doubled payout if the
// read lands. Spend the presses wisely.
import { GameShell } from '../core/game-kit.js';
import { gameplayPreview, verdictFlourish } from '../core/game-ui.js';
import { h, sfx, floatText } from '../core/ui.js';
import { CandleChart } from '../core/chart.js';
import { annotateSetup } from '../core/lesson-kit.js';
import { chartScenario } from '../core/patterns.js';

const MAX_PRESSES = 2;

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
      preview: (el) => gameplayPreview(el, { seed: 48, direction: 'down', title: 'Fakeout Filter', score: 200, streak: 2, round: '2/3' }),
      rounds: 8,
      timer: { seconds: 28, perRound: true },
      howTo: [
        'Price is challenging a level. Read only the closes and volume visible at the freeze.',
        'Arcade: the belt runs fast. Arm DOUBLE DOWN before you call it — a doubled payout when the read lands. Two presses per run.',
        'We grade your read; the reveal shows what this sample did next.',
      ],
      onStart(g) {
        // Arms refresh every run; one is only spent when an armed call resolves.
        g._ddPresses = MAX_PRESSES;
        g._ddArmed = false;
      },
      async onRound(g, { rng, stage, difficulty, style }) {
        if (g._ddPresses == null) g._ddPresses = MAX_PRESSES;
        g._ddArmed = false;

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

        const explain = `<strong>${r.answer === 'trade' ? 'Trade' : r.answer === 'fade' ? 'Fade' : 'Wait'}</strong> · ${r.name || ''}. Sample result: ${r.outcome?.result || 'see reveal'}.`;
        const revealAndFlourish = (ok, points, doubled = false) => {
          chart.reveal({ to: r.candles.length, interval: 40 });
          try { if (r.setup) annotateSetup(r.setup, chart, r); } catch { /* */ }
          verdictFlourish(stage, { ok, title: ok ? (doubled ? 'Doubled through' : 'Solid read') : 'Review the chart', scoreDelta: points });
        };

        // ------------------------------------------------ practice: the classic quiz
        if (style === 'practice') {
          const quiz = g.ask({
            options: [
              { label: 'Trade the breakout', value: 'trade' },
              { label: 'Fade the trap', value: 'fade' },
              { label: 'Wait for retest / clarity', value: 'wait' },
            ],
            answer: r.answer,
            explain,
            onAnswer: (ok) => revealAndFlourish(ok, 100),
          });
          stage.append(quiz);
          return () => chart.destroy();
        }

        // ------------------------------------------------ arcade / survival: the gauntlet
        let answered = false;
        const finish = (value) => {
          if (answered) return;
          answered = true;
          const ok = value === r.answer;
          const doubled = ok && g._ddArmed;
          const points = doubled ? 200 : 100;
          if (g._ddArmed) g._ddPresses = Math.max(0, g._ddPresses - 1); // an arm is spent when the call resolves
          g._ddArmed = false;
          if (ok) {
            if (doubled) {
              floatText('DOUBLED!', { at: host, tone: 'arcade' });
              sfx.powerup();
            }
            g.correct(explain, { points });
          } else g.wrong(explain);
          revealAndFlourish(ok, points, doubled);
          g.nextButton();
        };

        const onKey = (e) => {
          if (answered || e.ctrlKey || e.metaKey || e.altKey) return;
          const t = e.target;
          if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
          if (e.key === '1') finish('trade');
          else if (e.key === '2') finish('fade');
          else if (e.key === '3') finish('wait');
        };
        document.addEventListener('keydown', onKey);

        const renderDd = () => {
          ddBtn.replaceChildren(h('span', { class: 'font-arcade' }, g._ddArmed ? 'Armed ×2' : `Double down (${g._ddPresses})`));
          ddBtn.setAttribute('aria-pressed', String(g._ddArmed));
          ddBtn.classList.toggle('is-armed', g._ddArmed);
          ddBtn.disabled = g._ddPresses <= 0 && !g._ddArmed;
          ddBtn.title = g._ddArmed ? 'Armed: this call pays double when it lands.' : `Arm to double this call's payout. ${g._ddPresses} arm${g._ddPresses === 1 ? '' : 's'} left this run.`;
        };
        const ddBtn = h('button', {
          type: 'button',
          class: 'btn btn--arcade-2 dd-btn',
          'aria-pressed': 'false',
          on: { click: () => {
            if (answered) return;
            if (!g._ddArmed && g._ddPresses <= 0) return;
            g._ddArmed = !g._ddArmed;
            if (g._ddArmed) sfx.coin();
            renderDd();
          } },
        }, 'Double down');
        renderDd();

        const buttons = h('div', { class: 'gauntlet-actions' },
          h('div', { class: 'option-grid', role: 'group', 'aria-label': 'Call the break' },
            [
              { label: 'Trade the breakout', value: 'trade', key: '1', cls: 'rush-option--bullish' },
              { label: 'Fade the trap', value: 'fade', key: '2', cls: 'rush-option--bearish' },
              { label: 'Wait for retest', value: 'wait', key: '3', cls: '' },
            ].map((o) => h('button', {
              type: 'button',
              class: ['option', 'rush-option', o.cls],
              on: { click: () => finish(o.value) },
            },
              h('span', { class: 'option__key', 'aria-hidden': 'true' }, o.key),
              h('span', { class: 'option__label' }, o.label),
              h('span', { class: 'option__mark', 'aria-hidden': 'true' })))),
          ddBtn);
        stage.append(buttons);

        return () => {
          document.removeEventListener('keydown', onKey);
          chart.destroy();
        };
      },
    });
    return () => game.destroy();
  },
};
