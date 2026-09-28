// Volume Verdict — Confirm or Trap with swipe + volume chart.
import { GameShell, bindSwipeCard } from '../core/game-kit.js';
import { chartScenario } from '../core/patterns.js';
import { gameplayPreview, decisionChart, swipeCard, verdictFlourish } from '../core/game-ui.js';

const TEXTBOOK_PATTERNS = ['ascending-triangle', 'descending-triangle', 'double-top', 'double-bottom', 'bull-flag', 'bear-flag'];

/** Volume of candle i ÷ the average volume of the 10 candles before it (NaN without volume). */
export function volumeRatio(candles, i, n = 10) {
  const prev = candles.slice(Math.max(0, i - n), i).map((k) => k.v).filter((v) => Number.isFinite(v) && v > 0);
  const v = candles[i]?.v;
  if (!prev.length || !Number.isFinite(v)) return NaN;
  return v / (prev.reduce((a, b) => a + b, 0) / prev.length);
}

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
        const vr = volumeRatio(r.candles, r.decisionIdx);
        const vText = Number.isFinite(vr) ? `Breakout volume was ${vr.toFixed(1)}× the average of the 10 candles before it.` : '';
        let answered = false;
        const finish = (sayTrap) => {
          if (answered) return;
          answered = true;
          const ok = sayTrap === r.trap;
          const base = r.trap
            ? `<strong>Trap.</strong> Price could not hold beyond the level and fell back inside. ${vText}`
            : `<strong>Confirmed.</strong> Price held beyond the level and followed through. ${vText}`;
          let explain = base;
          if (!ok) {
            const why = r.trap
              ? (vr < 1.3
                ? 'You called Confirm, but volume barely expanded on the break: without real participation a poke through a level often fails.'
                : 'You called Confirm, and volume did expand, but the break still failed. Volume raises the odds; it guarantees nothing, which is why the stop goes back inside the level.')
              : (vr >= 1.3
                ? 'You called Trap, but the breakout candle came on clearly above-average volume and price kept going: that is what participation looks like.'
                : 'You called Trap, and volume was modest, but price still followed through. Thin volume is a warning sign, not proof of a trap.');
            explain = `<span class="game__why">${why}</span><br>${explain}`;
          }
          if (ok) g.correct(explain);
          else g.wrong(explain);
          dc.reveal();
          verdictFlourish(stage, { ok, title: ok ? 'Volume read' : 'Missed the tape', detail: base.replace(/<[^>]+>/g, ' '), scoreDelta: ok ? 100 : 0 });
          g.nextButton();
        };
        stage.append(bindSwipeCard(swipeCard({
          title: 'Volume call',
          body: 'Strong participation = Confirm. Thin poke = Trap.',
          takeLabel: 'Confirm',
          skipLabel: 'Trap',
          takeClass: 'btn--bull',
          skipClass: 'btn--bear',
        }), { onTake: () => finish(false), onSkip: () => finish(true) }));
        g.setHint('Compare the breakout candle’s volume bar with the ten bars before it.');
        return () => dc.destroy();
      },
    });
    return () => game.destroy();
  },
};
