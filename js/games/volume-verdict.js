// Volume Verdict — Confirm or Trap with swipe + volume chart.
import { GameShell } from '../core/game-kit.js';
import { chartScenario } from '../core/patterns.js';
import { gameplayPreview, decisionChart, swipeCard, verdictFlourish } from '../core/game-ui.js';

const TEXTBOOK_PATTERNS = ['ascending-triangle', 'descending-triangle', 'double-top', 'double-bottom', 'bull-flag', 'bear-flag'];

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
        'Swipe Confirm or Trap, then watch the reveal.',
      ],
      preview: (el) => gameplayPreview(el, { seed: 88, direction: 'up', title: 'Volume Verdict', score: 470, streak: 3, round: '2/6', showVolume: true }),
      async onRound(g, { rng, stage, difficulty }) {
        const real = await g.realRound({
          kinds: ['breakout-up', 'breakout-down', 'fakeout-up', 'fakeout-down'],
          intervals: ['1d', '1w'],
          before: 60,
          after: 14,
        });
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
        const q = `Price just broke ${r.direction < 0 ? 'down through support' : 'up through resistance'}. Does volume confirm?`;
        const dc = decisionChart(stage, {
          candles: r.candles,
          visible: r.decisionIdx + 1,
          slots: r.candles.length,
          height: 340,
          showVolume: true,
          decimals: r.decimals ?? 2,
          question: q,
          ariaLabel: 'Breakout chart with volume. Future hidden.',
        });
        if (Number.isFinite(r.level)) dc.chart.addHLine({ price: r.level, color: 'accent', dashed: true, label: 'Level' });
        dc.chart.addMarker({ idx: r.decisionIdx, position: r.direction < 0 ? 'below' : 'above', shape: 'dot', color: 'accent' });
        let answered = false;
        const finish = (sayTrap) => {
          if (answered) return;
          answered = true;
          const ok = sayTrap === r.trap;
          const explain = r.trap
            ? '<strong>Trap.</strong> The break came on weak participation and price fell back inside the range.'
            : '<strong>Confirmed.</strong> Volume expanded on the break and price followed through.';
          if (ok) g.correct(explain);
          else g.wrong(explain);
          dc.reveal();
          verdictFlourish(stage, { ok, title: ok ? 'Volume read' : 'Missed the tape', detail: explain.replace(/<[^>]+>/g, ' '), scoreDelta: ok ? 100 : 0 });
          g.nextButton();
        };
        stage.append(swipeCard({
          title: 'Volume call',
          body: 'Strong participation = Confirm. Thin poke = Trap.',
          takeLabel: 'Confirm',
          skipLabel: 'Trap',
          takeClass: 'btn--bull',
          skipClass: 'btn--bear',
          onTake: () => finish(false),
          onSkip: () => finish(true),
        }));
        g.setHint('Compare the breakout candle’s volume bar with the ten bars before it.');
        return () => dc.destroy();
      },
    });
    return () => game.destroy();
  },
};
