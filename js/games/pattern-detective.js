// Stub game (pattern-detective) — proves the GameShell contract; replaced by the full game.
import { GameShell } from '../core/game-kit.js';
import { choiceQuiz } from '../core/ui.js';

// [question, options, index of the correct option, explanation]
const QUESTIONS = [
  ["Head at 110, neckline at 100, and price closes below the neckline. What is the measured target?", ["90", "110", "95", "80"], 0, "Height = 110 − 100 = 10. Project it down from the break: 100 − 10 = <strong>90</strong>."],
  ["Two lows at the same price with a peak between them; price then closes above that peak. Pattern?", ["Double bottom", "Double top", "Head and shoulders", "Bear flag"], 0, "Two failed attempts lower, confirmed by the break of the middle peak: a <strong>double bottom</strong>."],
  ["A sharp rally, then a tight channel sloping gently down. Pattern and bias?", ["Bull flag — continuation up", "Bear flag — continuation down", "Rising wedge — reversal down", "Double top"], 0, "The pole plus a small counter-trend channel is a <strong>bull flag</strong>, usually a pause before the trend continues."],
];

export default {
  id: 'pattern-detective',
  mount(root, ctx) {
    let order = QUESTIONS;
    const game = new GameShell(root, ctx, {
      rounds: QUESTIONS.length,
      howTo: ["Read the pattern description.", "Name it, or measure its target.", "Targets use the measured-move rule."],
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
