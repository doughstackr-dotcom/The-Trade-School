// Stub game (divergence-detective) — proves the GameShell contract; replaced by the full game.
import { GameShell } from '../core/game-kit.js';
import { choiceQuiz } from '../core/ui.js';

// [question, options, index of the correct option, explanation]
const QUESTIONS = [
  ["Price: lower low. RSI: higher low.", ["Bullish divergence", "Bearish divergence", "Hidden bearish divergence", "No divergence"], 0, "Price fell further on weaker downside momentum: <strong>bullish divergence</strong>."],
  ["Price: higher high. MACD histogram: lower high.", ["Bearish divergence", "Bullish divergence", "Hidden bullish divergence", "No divergence"], 0, "New price high, less momentum behind it: <strong>bearish divergence</strong>."],
  ["In an uptrend, price makes a higher low while RSI makes a lower low.", ["Hidden bullish divergence — continuation", "Bearish divergence — reversal", "Bullish divergence — reversal", "No divergence"], 0, "Price held higher even though momentum dipped deeper: <strong>hidden bullish divergence</strong>, a trend-continuation clue."],
];

export default {
  id: 'divergence-detective',
  mount(root, ctx) {
    let order = QUESTIONS;
    const game = new GameShell(root, ctx, {
      rounds: QUESTIONS.length,
      howTo: ["Compare what price did with what the oscillator did.", "Name the divergence.", "Regular divergence warns of reversal; hidden divergence favours continuation."],
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
