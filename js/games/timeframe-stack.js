// Stub game (timeframe-stack) — proves the GameShell contract; replaced by the full game.
import { GameShell } from '../core/game-kit.js';
import { choiceQuiz } from '../core/ui.js';

// [question, options, index of the correct option, explanation]
const QUESTIONS = [
  ["Weekly up, daily up, hourly pulling back into support. Best plan?", ["Look for a long trigger on the hourly", "Go short", "No trade — timeframes disagree", "Buy the weekly high"], 0, "All three line up: the hourly pullback is a <strong>chance to join the bigger trend</strong>."],
  ["Weekly down, daily up, hourly up. Best plan?", ["Stand aside, or trade small — the higher timeframe disagrees", "Go long with full size", "Short the hourly immediately", "Timeframes do not matter"], 0, "The daily rally may just be a pullback in a weekly downtrend. <strong>Conflict means caution.</strong>"],
  ["A common ratio between the timeframes you stack is roughly…", ["4 to 6 times", "Exactly 2 times", "100 times", "It does not matter"], 0, "Daily → 4-hour → 1-hour steps by about <strong>4–6×</strong>: different enough to add information, close enough to connect."],
];

export default {
  id: 'timeframe-stack',
  mount(root, ctx) {
    let order = QUESTIONS;
    const game = new GameShell(root, ctx, {
      rounds: QUESTIONS.length,
      howTo: ["Read the weekly, daily and hourly picture.", "Decide whether the timeframes agree.", "Trade with the higher timeframe."],
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
