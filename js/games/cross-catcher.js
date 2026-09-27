// Stub game (cross-catcher) — proves the GameShell contract; replaced by the full game.
import { GameShell } from '../core/game-kit.js';
import { choiceQuiz } from '../core/ui.js';

// [question, options, index of the correct option, explanation]
const QUESTIONS = [
  ["The 10-period MA crosses above the 30-period MA. Which cross is it?", ["Golden cross", "Death cross", "Not a cross"], 0, "Fast crossing <strong>above</strong> slow is a golden (bullish) cross."],
  ["Why do crossovers often arrive after the move has started?", ["Moving averages are built from past prices, so they lag", "Brokers delay them", "They are random", "They predict the future"], 0, "Every moving average is an average of the past — <strong>lag</strong> is built in."],
  ["In a sideways market, moving-average crosses tend to…", ["Whipsaw back and forth, giving false signals", "Be extremely reliable", "Stop happening", "Always point up"], 0, "With no trend, the averages tangle together and <strong>whipsaw</strong>. Crosses work best in trending markets."],
];

export default {
  id: 'cross-catcher',
  mount(root, ctx) {
    let order = QUESTIONS;
    const game = new GameShell(root, ctx, {
      rounds: QUESTIONS.length,
      howTo: ["Read the moving-average situation.", "Call the cross or what it means.", "Remember: crossovers lag price."],
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
