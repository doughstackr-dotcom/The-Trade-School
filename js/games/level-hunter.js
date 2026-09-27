// Stub game (level-hunter) — proves the GameShell contract; replaced by the full game.
import { GameShell } from '../core/game-kit.js';
import { choiceQuiz } from '../core/ui.js';

// [question, options, index of the correct option, explanation]
const QUESTIONS = [
  ["Price has bounced from 98.00 four times this month. What is 98 most likely?", ["Support", "Resistance", "A moving average", "A trend line"], 0, "Repeated bounces from below mark <strong>support</strong>: buyers keep defending that price."],
  ["Price broke above 105, came back to retest 105 from above, and a bullish candle closed there. Bounce or break?", ["Bounce — old resistance is acting as support", "Break — price will fall through", "Neither — levels only work once", "Break — retests always fail"], 0, "A retest that holds is classic <strong>role reversal</strong>: broken resistance became support."],
  ["Price wicks above resistance but closes back below it. What is that?", ["A fakeout (false breakout)", "A confirmed breakout", "Role reversal", "A golden cross"], 0, "No close above the level means <strong>no breakout</strong>. The wick trapped early buyers."],
];

export default {
  id: 'level-hunter',
  mount(root, ctx) {
    let order = QUESTIONS;
    const game = new GameShell(root, ctx, {
      rounds: QUESTIONS.length,
      howTo: ["Read the price action.", "Decide what the level is, or whether it will bounce or break.", "Streaks multiply your points."],
      onStart(g, { rng }) {
        order = rng.shuffle(QUESTIONS);
        g.nextRound();
      },
      onRound(g, { round, rng, stage }) {
        const [question, labels, correct, explain] = order[round - 1];
        const options = rng.shuffle(labels.map((label, i) => ({ label, value: i })));
        stage.append(choiceQuiz({
          question,
          options,
          answer: correct,
          sfx: false,
          onAnswer(ok) {
            if (ok) g.correct(explain);
            else g.wrong(explain);
            g.nextButton();
          },
        }));
      },
    });
    return () => game.destroy();
  },
};
