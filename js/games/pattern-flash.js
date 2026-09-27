// Stub game (pattern-flash) — proves the GameShell contract; replaced by the full game.
import { GameShell } from '../core/game-kit.js';
import { choiceQuiz } from '../core/ui.js';

// [question, options, index of the correct option, explanation]
const QUESTIONS = [
  ["After a decline: small body at the top, long lower wick.", ["Hammer", "Shooting star", "Doji", "Bearish engulfing"], 0, "A <strong>hammer</strong>: buyers rejected the lows. Wait for a bullish close to confirm."],
  ["At the top of a rally, a big bearish body completely covers the previous bullish body.", ["Bearish engulfing", "Bullish harami", "Morning star", "Hammer"], 0, "<strong>Bearish engulfing</strong>: sellers overwhelmed the prior candle’s entire body."],
  ["Open and close almost equal, with wicks on both sides.", ["Doji", "Marubozu", "Three white soldiers", "Hanging man"], 0, "A <strong>doji</strong> shows indecision — neither side won the period."],
];

export default {
  id: 'pattern-flash',
  mount(root, ctx) {
    let order = QUESTIONS;
    const game = new GameShell(root, ctx, {
      rounds: QUESTIONS.length,
      timer: { seconds: 20, perRound: true },
      howTo: ["A pattern description flashes up — name it before the clock runs out.", "Answer fast: streaks of 3+ multiply your points.", "Timeouts count as a miss."],
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
