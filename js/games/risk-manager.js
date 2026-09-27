// Stub game (risk-manager) — proves the GameShell contract; replaced by the full game.
import { GameShell } from '../core/game-kit.js';
import { choiceQuiz } from '../core/ui.js';

// [question, options, index of the correct option, explanation]
const QUESTIONS = [
  ["Account $20,000, risking 1%. Entry 40.00, stop 38.00. Position size?", ["100 shares", "200 shares", "50 shares", "500 shares"], 0, "1% = $200. Risk per share = $2. $200 ÷ $2 = <strong>100 shares</strong>."],
  ["Entry 100, stop 98, target 106. What is the reward-to-risk?", ["3 : 1", "2 : 1", "1 : 3 (bad)", "6 : 1"], 0, "Risk 2, reward 6: <strong>3R</strong> of reward for 1R of risk."],
  ["Win rate 40%, average win 2R, average loss 1R. Expectancy per trade?", ["+0.2R", "−0.2R", "+0.8R", "0R"], 0, "0.4 × 2 − 0.6 × 1 = 0.8 − 0.6 = <strong>+0.2R</strong> per trade. Positive, despite losing more often than winning."],
];

export default {
  id: 'risk-manager',
  mount(root, ctx) {
    let order = QUESTIONS;
    const game = new GameShell(root, ctx, {
      rounds: QUESTIONS.length,
      howTo: ["Read the account and the setup.", "Work out size, reward-to-risk or expectancy.", "Protect the account first."],
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
