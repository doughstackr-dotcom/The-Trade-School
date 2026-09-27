// Stub game (setup-swipe) — proves the GameShell §12 contract (play styles, difficulty, hints);
// replaced by the full game.
import { GameShell } from '../core/game-kit.js';

// [difficulty 0–2, setup, options (fixed order: Skip = left, Take = right), explanation, hint]
const BANK = [
  [0, "Uptrend. Price pulls back to rising support and prints a bullish engulfing candle. Stop below the low, target 2.5R.", ["Skip", "Take"], "<strong>Take.</strong> Trend, level and trigger agree, the stop is defined and the reward is well above the risk.", "Count the reasons: trend, level, trigger, reward-to-risk."],
  [0, "No clear trend. Price sits in the middle of a range. No trigger candle.", ["Skip", "Take"], "<strong>Skip.</strong> Mid-range with no trigger is a coin flip with a spread attached.", "Where is the level? Where is the trigger?"],
  [1, "Breakout above resistance on the lowest volume of the month. The stop would be three times wider than usual.", ["Skip", "Take"], "<strong>Skip.</strong> Weak volume and poor risk: this is how fakeouts look.", "Check the volume and the size of the stop."],
  [1, "After a downtrend, a hammer at a support zone, confirmed by the next close above its high. Stop under the wick, target 2R.", ["Skip", "Take"], "<strong>Take.</strong> Context, level, pattern and confirmation are all there, with a clear stop.", "Was the pattern confirmed?"],
  [1, "A setup you like, but you already hit your daily loss limit.", ["Skip", "Take"], "<strong>Skip.</strong> The loss limit exists for exactly this moment.", "What does your plan say about today?"],
  [2, "Strong uptrend. RSI shows bearish divergence, but market structure has not broken. Short?", ["Skip", "Take"], "<strong>Skip.</strong> Divergence is a warning, not a trigger. Wait for structure to break.", "Has price actually made a lower low yet?"],
  [2, "Downtrend. A rally reaches the 61.8% retracement, right at old support-turned-resistance. A shooting star closes there. Stop above its high, 3R to the prior low. Short?", ["Skip", "Take"], "<strong>Take.</strong> Trend, Fibonacci level, role reversal and a trigger line up, with 3R of reward.", "How many independent reasons agree?"],
];
// Correct option per setup: 0 = Skip, 1 = Take.
const CORRECT = [1, 0, 0, 1, 0, 0, 1];

/** Next unused question closest to the target difficulty; reuses the deck once it runs out. */
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
      timer: { seconds: 12, perRound: true },
      howTo: ["A setup appears with its trend, level, trigger and risk.", "Take it or skip it before the clock runs out.", "Discipline scores: skipping a weak setup is a win."],
      onStart(g, { rng }) {
        deck = rng.shuffle(BANK.map((_, i) => i));
        used.clear();
      },
      onRound(g, { rng, difficulty, retry }) {
        if (!retry) current = pickQuestion(deck, used, difficulty);
        const q = BANK[current];
        g.ask({
          question: q[1],
          options: q[2].map((label, i) => ({ label, value: i })),
          answer: CORRECT[current],
          explain: q[3],
          hint: q[4],
        });
      },
    });
    return () => game.destroy();
  },
};
