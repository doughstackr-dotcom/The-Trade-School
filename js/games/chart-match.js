// Stub game (chart-match) — proves the GameShell §12 contract (play styles, difficulty, hints);
// replaced by the full game.
import { GameShell } from '../core/game-kit.js';

// [difficulty 0–2, question, options (the first is correct; shown shuffled), explanation, hint]
const BANK = [
  [0, "Which chart type joins only the closing prices?", ["Line chart", "Candlestick chart", "Bar chart", "Volume chart"], "<strong>Line chart.</strong> One point per period, the close, joined by a line.", "The simplest chart: one number per period."],
  [0, "A candle that closes above its open is…", ["Bullish (an up candle)", "Bearish (a down candle)", "Always a doji", "A gap"], "<strong>Bullish.</strong> Buyers pushed price up from the open to the close.", "Compare where it ended with where it started."],
  [1, "On a log-scale chart, a move from 10 to 20 is the same height as a move from…", ["50 to 100", "50 to 60", "100 to 110", "20 to 30"], "<strong>50 to 100.</strong> Both double. Log scale draws equal percentage moves at equal heights.", "Log scale cares about percentages, not points."],
  [1, "Almost no body, long wicks on both sides:", ["Doji / spinning top", "Marubozu", "Hammer", "Engulfing candle"], "<strong>A doji or spinning top:</strong> indecision, neither side won the period.", "Open and close ended up almost equal."],
  [1, "One daily candle of a stock shows…", ["One trading day's open, high, low and close", "One hour of trading", "One week of trading", "Only the close"], "<strong>One trading day.</strong> The timeframe decides how much time each candle covers.", "The timeframe name tells you."],
  [2, "On a bar chart, the small tick on the LEFT of each bar marks the…", ["Open", "Close", "High", "Low"], "<strong>The open.</strong> Left tick = open, right tick = close, the bar's ends = high and low.", "Left comes first in time."],
  [2, "Which chart gives the best first view of the bigger trend?", ["Weekly", "5-minute", "1-minute", "Tick chart"], "<strong>Weekly.</strong> Start high for context, then zoom in for timing.", "Zoom out before you zoom in."],
];
const CORRECT = BANK.map(() => 0);

/** Next unused question closest to the target difficulty; reuses the deck once it runs out. */
function pickQuestion(deck, used, difficulty) {
  if (used.size >= deck.length) used.clear();
  const target = Math.round(difficulty * 2);
  const open = deck.filter((i) => !used.has(i));
  const best = open.find((i) => BANK[i][0] === target) ?? open.find((i) => Math.abs(BANK[i][0] - target) === 1) ?? open[0];
  used.add(best);
  return best;
}

export default {
  id: 'chart-match',
  mount(root, ctx) {
    let deck = [];
    const used = new Set();
    let current = 0;
    const game = new GameShell(root, ctx, {
      rounds: 6,
      timer: { seconds: 20, perRound: true },
      howTo: ["Match each description to the right chart type, candle or pattern.", "Fewer misses, higher score. Streaks multiply your points.", "The full game flips cards memory-style."],
      onStart(g, { rng }) {
        deck = rng.shuffle(BANK.map((_, i) => i));
        used.clear();
      },
      onRound(g, { rng, difficulty, retry }) {
        if (!retry) current = pickQuestion(deck, used, difficulty);
        const q = BANK[current];
        g.ask({
          question: q[1],
          options: rng.shuffle(q[2].map((label, i) => ({ label, value: i }))),
          answer: CORRECT[current],
          explain: q[3],
          hint: q[4],
        });
      },
    });
    return () => game.destroy();
  },
};
