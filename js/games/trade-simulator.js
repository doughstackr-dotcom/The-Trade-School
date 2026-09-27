// Stub game (trade-simulator) — proves the GameShell contract; replaced by the full game.
import { GameShell } from '../core/game-kit.js';
import { choiceQuiz } from '../core/ui.js';

// [question, options, index of the correct option, explanation]
const QUESTIONS = [
  ["You are long at 50 with a stop at 48. Price rallies to 54. A sensible way to protect the trade?", ["Trail the stop up, e.g. to breakeven or below the new higher low", "Widen the stop", "Remove the stop", "Add to the position with no plan"], 0, "<strong>Trailing the stop</strong> locks in some of the gain while giving the trend room to run."],
  ["Price gaps below your stop overnight. Where are you filled?", ["At the next available price — possibly worse than the stop", "Exactly at the stop price", "Not at all", "At the previous high"], 0, "A stop becomes a market order: in a gap you get the <strong>next available price</strong>. That difference is slippage."],
  ["After a losing trade, the best next step is…", ["Journal it and follow the plan on the next setup", "Double the size to win it back", "Take the next trade you see, any trade", "Stop using stop losses"], 0, "Losses are part of trading. <strong>Review, then stick to the plan</strong> — revenge trading turns one loss into many."],
];

export default {
  id: 'trade-simulator',
  mount(root, ctx) {
    let order = QUESTIONS;
    const game = new GameShell(root, ctx, {
      rounds: QUESTIONS.length,
      howTo: ["Read the trade situation.", "Pick the disciplined response.", "Full bar-by-bar simulator coming soon."],
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
