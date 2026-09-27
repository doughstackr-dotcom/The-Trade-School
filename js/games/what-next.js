// Stub game (what-next) — proves the GameShell contract; replaced by the full game.
import { GameShell } from '../core/game-kit.js';
import { choiceQuiz } from '../core/ui.js';

// [question, options, index of the correct option, explanation]
const QUESTIONS = [
  ["Uptrend, a pullback into support, then a bullish engulfing candle at the level. Most likely next?", ["Up", "Down", "Sideways"], 0, "Trend, level and trigger all agree: <strong>up</strong> is the higher-probability call — though not a certainty."],
  ["Three lower highs press down on flat support at 100 (a descending triangle), with momentum fading. More likely next?", ["A break below 100", "A breakout above the highs", "Nothing ever happens"], 0, "Descending triangles <strong>break down more often than up</strong>: sellers keep getting more aggressive while buyers only defend one price."],
  ["Strong downtrend. RSI reads 25 (oversold) but there is no reversal pattern yet. Best decision?", ["Wait — oversold is a condition, not a signal", "Buy now, it must bounce", "Short with no stop", "Double the position size"], 0, "Markets can stay oversold in a strong trend. <strong>Wait</strong> for structure or a confirmed pattern before acting."],
];

export default {
  id: 'what-next',
  mount(root, ctx) {
    let order = QUESTIONS;
    const game = new GameShell(root, ctx, {
      rounds: QUESTIONS.length,
      modes: [
        { id: 'beginner', label: 'Beginner', description: 'Call the direction: up, down or sideways.' },
        { id: 'advanced', label: 'Advanced', description: 'Make the trade decision: long, short or wait.' },
      ],
      howTo: ["The chart freezes at a decision point.", "Call what is most likely to happen next.", "Advanced mode asks for a trade decision: long, short or wait."],
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
