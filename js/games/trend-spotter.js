// Stub game (trend-spotter) — proves the GameShell contract; replaced by the full game.
import { GameShell } from '../core/game-kit.js';
import { choiceQuiz } from '../core/ui.js';

// [question, options, index of the correct option, explanation]
const QUESTIONS = [
  ["Swings: 100 → 106 → 102 → 109 → 105 → 112. What is the trend?", ["Uptrend", "Downtrend", "Range", "Reversing down"], 0, "Highs 106, 109, 112 and lows 102, 105 both rise: <strong>higher highs and higher lows</strong>."],
  ["Highs at 120, 116, 113 and lows at 110, 106, 101. What is the trend?", ["Downtrend", "Uptrend", "Range", "Cannot tell"], 0, "Lower highs and lower lows make a <strong>downtrend</strong>."],
  ["In an uptrend the last swing low was 104. Price now falls to 102. What does that mean?", ["A lower low — the structure is breaking", "A higher low — trend intact", "A higher high", "Nothing changes"], 0, "Undercutting the last higher low is a <strong>break of structure</strong>: the first warning the uptrend may be over."],
];

export default {
  id: 'trend-spotter',
  mount(root, ctx) {
    let order = QUESTIONS;
    const game = new GameShell(root, ctx, {
      rounds: QUESTIONS.length,
      howTo: ["Read the swing sequence.", "Call the trend or label the swing.", "Higher highs + higher lows = uptrend."],
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
