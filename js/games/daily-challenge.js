// Daily Challenge — interactive GameShell module.
import { GameShell } from '../core/game-kit.js';

// [difficulty 0–2, question, options (the first is correct; shown shuffled), explanation, hint]
const BANK = [
  [0, "A candle opens at 100 and closes at 103. On a standard chart it is…", ["Green / bullish", "Red / bearish", "Grey", "A doji"], "<strong>Bullish.</strong> It closed above its open.", "Compare the close with the open."],
  [0, "Higher highs and higher lows describe…", ["An uptrend", "A downtrend", "A range", "A reversal"], "<strong>An uptrend:</strong> each swing goes a little higher.", "Both the peaks and the dips are rising."],
  [0, "Support is a price where…", ["Buyers have stepped in before", "Sellers always win", "Volume is zero", "The chart ends"], "<strong>Buyers stepped in before,</strong> so they may again.", "Think of a floor."],
  [1, "The 50-period MA crosses above the 200-period MA. This is…", ["A golden cross", "A death cross", "A divergence", "A fakeout"], "<strong>A golden cross:</strong> the faster average rises above the slower one.", "Golden is the bullish one."],
  [1, "Bid 1.0848, ask 1.0850. The spread is…", ["2 pips (0.0002)", "0.2 pips", "20 pips", "1.0849"], "<strong>2 pips.</strong> 1.0850 − 1.0848 = 0.0002.", "Ask minus bid; a pip is 0.0001 here."],
  [1, "Price breaks resistance, retests it from above and holds. The old resistance is now…", ["Support", "Resistance", "A trend line", "A gap"], "<strong>Support:</strong> role reversal.", "Broken ceilings often become floors."],
  [1, "RSI above 70 is usually called…", ["Overbought", "Oversold", "Neutral", "Divergent"], "<strong>Overbought:</strong> strong recent gains, not an automatic sell signal.", "70 is the upper line."],
  [2, "Entry 50, stop 48, target 56. Reward-to-risk?", ["3:1", "2:1", "1:3", "4:1"], "<strong>3:1.</strong> Reward 6 ÷ risk 2.", "Divide the distance to the target by the distance to the stop."],
  [2, "You risk 1% of a $10,000 account with a stop $2 away. How many shares?", ["50", "100", "500", "20"], "<strong>50 shares.</strong> $100 risk ÷ $2 per share.", "1% of $10,000 is your dollar risk."],
  [2, "Price makes a higher high while RSI makes a lower high. This is…", ["Bearish divergence", "Bullish divergence", "Hidden bullish divergence", "Confirmation"], "<strong>Bearish divergence:</strong> momentum is fading as price rises.", "Price and momentum disagree at the top."],
  [2, "A head and shoulders target is found by…", ["Projecting the head-to-neckline height from the breakout", "Doubling the left shoulder", "Using the 200 MA", "Taking the highest high"], "<strong>The measured move:</strong> the height from head to neckline, projected from the break.", "Measure the pattern, then project it."],
];
const CORRECT = BANK.map(() => 0);

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
  id: 'daily-challenge',
  mount(root, ctx) {
    let deck = [];
    const used = new Set();
    let current = 0;
    const game = new GameShell(root, ctx, {
      rounds: 5,
      timer: { seconds: 25, perRound: true },
      howTo: ["Five questions, the same for everyone today.", "Answer fast: streaks multiply your score.", "Come back tomorrow to keep your streak alive."],
      onStart(g, { rng }) {
        deck = rng.shuffle(BANK.map((_, i) => i));
        used.clear();
      },
      onRound(g, { rng, difficulty, retry }) {
        if (!retry) current = pickQuestion(deck, used, difficulty);
        const q = BANK[current];
        g.ask({
          question: q[1],
          options: rng.shuffle(q[2].map((label, i) => ({ label, value: i }))),
          answer: CORRECT[current],
          explain: q[3],
          hint: q[4],
        });
      },
    });
    return () => game.destroy();
  },
};
