// Stub game (fib-sniper) — proves the GameShell contract; replaced by the full game.
import { GameShell } from '../core/game-kit.js';
import { choiceQuiz } from '../core/ui.js';

// [question, options, index of the correct option, explanation]
const QUESTIONS = [
  ["Swing low 50, swing high 60. Where is the 61.8% retracement?", ["53.82", "56.18", "55.00", "61.80"], 0, "Range 10 × 0.618 = 6.18. 60 − 6.18 = <strong>53.82</strong>. (56.18 is the 38.2% level.)"],
  ["To measure a pullback in an uptrend, where do you anchor the Fibonacci tool?", ["On the swing low and the swing high of the move", "On any two random candles", "On the two highest closes", "On the moving average"], 0, "Anchor on a <strong>clear, completed swing</strong>: from its low to its high. The levels then show how far the pullback has retraced."],
  ["The 61.8% level lines up with old support and a rising 50-period MA. That is called…", ["Confluence", "Divergence", "Slippage", "A fakeout"], 0, "Several independent tools pointing at one price is <strong>confluence</strong> — better odds, never a guarantee."],
];

export default {
  id: 'fib-sniper',
  mount(root, ctx) {
    let order = QUESTIONS;
    const game = new GameShell(root, ctx, {
      rounds: QUESTIONS.length,
      howTo: ["Read the swing.", "Pick the right level or anchor.", "Retracement = high − range × ratio in an uptrend."],
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
