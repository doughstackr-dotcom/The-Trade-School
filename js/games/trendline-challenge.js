// Stub game (trendline-challenge) — proves the GameShell contract; replaced by the full game.
import { GameShell } from '../core/game-kit.js';
import { choiceQuiz } from '../core/ui.js';

// [question, options, index of the correct option, explanation]
const QUESTIONS = [
  ["How many touches does a trend line need?", ["Two to draw it, a third to confirm it", "Just one", "At least ten", "Touches do not matter"], 0, "Any two points make a line. A <strong>third touch that holds</strong> shows other traders respect it."],
  ["Your uptrend line slices through several candle bodies. What should you do?", ["Redraw it along the swing lows so it does not cut bodies", "Keep it — close enough", "Delete all trend lines", "Draw it through the highs instead"], 0, "A valid trend line <strong>hugs the swing lows</strong>. Cutting through bodies means it is not where price actually turned."],
  ["Price closes below a rising trend line. What is the best reading?", ["The uptrend is weakening — watch for a lower high", "A reversal is guaranteed", "Buy more, it is cheaper", "Ignore it"], 0, "A trend-line break is an <strong>early warning</strong>. Confirmation comes from market structure: a lower high and a lower low."],
];

export default {
  id: 'trendline-challenge',
  mount(root, ctx) {
    let order = QUESTIONS;
    const game = new GameShell(root, ctx, {
      rounds: QUESTIONS.length,
      howTo: ["Read the scenario.", "Pick how a good trend line should be drawn or read.", "Clean lines touch swings without cutting candle bodies."],
      onStart(g, { rng }) {
        order = rng.shuffle(QUESTIONS);
        g.nextRound();
      },
      onRound(g, { round, rng, stage }) {
        const [question, labels, correct, explain] = order[(round - 1) % order.length];
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
