// Setup Swipe — Take or Skip with a candle thumb on each card.
import { GameShell } from '../core/game-kit.js';
import { miniChart } from '../core/chart.js';
import { gameplayPreview, swipeCard, tinySeries, verdictFlourish } from '../core/game-ui.js';

const BANK = [
  [0, "Uptrend. Price pulls back to rising support and prints a bullish engulfing candle. Stop below the low, target 2.5R.", 1, "<strong>Take.</strong> Trend, level and trigger agree, the stop is defined and the reward is well above the risk.", "Count the reasons: trend, level, trigger, reward-to-risk.", 'up'],
  [0, "No clear trend. Price sits in the middle of a range. No trigger candle.", 0, "<strong>Skip.</strong> Mid-range with no trigger is a coin flip with a spread attached.", "Where is the level? Where is the trigger?", 'down'],
  [1, "Breakout above resistance on the lowest volume of the month. The stop would be three times wider than usual.", 0, "<strong>Skip.</strong> Weak volume and poor risk: this is how fakeouts look.", "Check the volume and the size of the stop.", 'up'],
  [1, "After a downtrend, a hammer at a support zone, confirmed by the next close above its high. Stop under the wick, target 2R.", 1, "<strong>Take.</strong> Context, level, pattern and confirmation are all there, with a clear stop.", "Was the pattern confirmed?", 'up'],
  [1, "A setup you like, but you already hit your daily loss limit.", 0, "<strong>Skip.</strong> The loss limit exists for exactly this moment.", "What does your plan say about today?", 'down'],
  [2, "Strong uptrend. RSI shows bearish divergence, but market structure has not broken. Short?", 0, "<strong>Skip.</strong> Divergence is a warning, not a trigger. Wait for structure to break.", "Has price actually made a lower low yet?", 'up'],
  [2, "Downtrend. A rally reaches the 61.8% retracement, right at old support-turned-resistance. A shooting star closes there. Stop above its high, 3R to the prior low. Short?", 1, "<strong>Take.</strong> Trend, Fibonacci level, role reversal and a trigger line up, with 3R of reward.", "How many independent reasons agree?", 'down'],
];

function pickQuestion(deck, used, difficulty) {
  if (used.size >= deck.length) used.clear();
  const target = Math.round(difficulty * 2);
  const open = deck.filter((i) => !used.has(i));
  const best = open.find((i) => BANK[i][0] === target) ?? open.find((i) => Math.abs(BANK[i][0] - target) === 1) ?? open[0];
  used.add(best);
  return best;
}

export default {
  id: 'setup-swipe',
  mount(root, ctx) {
    let deck = [];
    const used = new Set();
    let current = 0;
    const game = new GameShell(root, ctx, {
      rounds: 7,
      timer: { seconds: 14, perRound: true },
      howTo: [
        'A setup appears with its trend, level, trigger and risk.',
        'Take it or skip it before the clock runs out.',
        'Discipline scores: skipping a weak setup is a win.',
      ],
      preview: (el) => gameplayPreview(el, { seed: 55, direction: 'up', title: 'Setup Swipe', score: 610, streak: 5, round: '4/7' }),
      onStart(g, { rng }) {
        deck = rng.shuffle(BANK.map((_, i) => i));
        used.clear();
      },
      onRound(g, { difficulty, retry, stage }) {
        if (!retry) current = pickQuestion(deck, used, difficulty);
        const q = BANK[current];
        const thumb = miniChart(tinySeries(30 + current, q[5], 28), { width: 420, height: 180, yPad: 0.1, showAxis: true, ariaLabel: 'Setup chart' });
        let answered = false;
        const finish = (take) => {
          if (answered) return;
          answered = true;
          const ok = (take ? 1 : 0) === q[2];
          if (ok) g.correct(q[3]);
          else g.wrong(q[3]);
          verdictFlourish(stage, { ok, title: ok ? (take ? 'Taken' : 'Skipped') : 'Misread', detail: q[3].replace(/<[^>]+>/g, ' ').slice(0, 140), scoreDelta: ok ? 100 : 0 });
          g.nextButton();
        };
        stage.append(swipeCard({
          chartNode: thumb,
          title: 'Setup card',
          body: q[1],
          takeLabel: 'Take',
          skipLabel: 'Skip',
          takeClass: 'btn--bull',
          skipClass: 'btn--ghost',
          onTake: () => finish(true),
          onSkip: () => finish(false),
        }));
        g.setHint(q[4]);
      },
    });
    return () => game.destroy();
  },
};
