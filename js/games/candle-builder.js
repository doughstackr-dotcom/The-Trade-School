// Stub game (candle-builder) — proves the GameShell contract; replaced by the full game.
import { GameShell } from '../core/game-kit.js';
import { choiceQuiz } from '../core/ui.js';

// [question, options, index of the correct option, explanation]
const QUESTIONS = [
  ["Open 100, high 101, low 95, close 96. How long is the upper wick?", ["1 point", "5 points", "4 points", "6 points"], 0, "This candle is bearish, so the top of the body is the open (100). The upper wick runs from 100 to the high at 101: <strong>1 point</strong>."],
  ["A candle opens at 50, dips to 49, then closes at its high of 55. What story does it tell?", ["Sellers tried early, buyers took control and closed at the high", "Buyers failed at the high", "Nobody won — pure indecision", "Sellers closed it at the low"], 0, "A small lower wick and a close <strong>at the high</strong> means buyers dominated the period after a brief early dip."],
  ["Which part of a candle shows prices that were reached but rejected?", ["The wicks", "The body", "The open", "The colour"], 0, "<strong>Wicks</strong> mark prices that traded and were pushed away before the close."],
];

export default {
  id: 'candle-builder',
  mount(root, ctx) {
    let order = QUESTIONS;
    const game = new GameShell(root, ctx, {
      rounds: QUESTIONS.length,
      howTo: ["Read the question about a candle’s open, high, low and close.", "Pick the answer that matches (keys 1–4 work too).", "Streaks of 3 or more multiply your points."],
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
