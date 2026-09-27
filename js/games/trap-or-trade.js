// Stub game (trap-or-trade) — proves the GameShell §12 contract (play styles, difficulty, hints);
// replaced by the full game.
import { GameShell } from '../core/game-kit.js';

// [difficulty 0–2, question, options (the first is correct; shown shuffled), explanation, hint]
const BANK = [
  [0, "Price closes well above a level tested four times, on 2× average volume, in the direction of the trend.", ["Trade the breakout", "Fade the trap", "Wait for the retest"], "<strong>Trade the breakout.</strong> A decisive close with strong volume and the trend behind it.", "Look at the close, the volume and the trend."],
  [0, "Price spikes above resistance but closes back below it on heavy volume.", ["Fade the trap", "Trade the breakout", "Wait for the retest"], "<strong>Fade the trap.</strong> The close back inside traps the breakout buyers.", "Where did the candle close?"],
  [1, "The breakout closes just above resistance on average volume. The next candle drifts back toward the level.", ["Wait for the retest", "Trade the breakout", "Fade the trap"], "<strong>Wait for the retest.</strong> Let the level prove it flipped to support.", "Nothing is decisive yet."],
  [1, "Price pokes above the range high minutes before a major news release, on thin volume.", ["Wait for the retest", "Trade the breakout", "Fade the trap"], "<strong>Wait.</strong> Thin volume before news is noise, not conviction.", "What could happen in a few minutes?"],
  [2, "A clean breakout, then a pullback to the broken level that holds with a bullish engulfing candle.", ["Buy the retest", "Fade it", "Keep waiting"], "<strong>Buy the retest.</strong> The level held as support and printed a trigger, with a tight stop below it.", "The retest you waited for just happened."],
  [2, "Price sweeps below an obvious double-bottom low, triggering stops, then closes back above it on strong volume.", ["Fade the break (go long)", "Short the breakdown", "Wait"], "<strong>Fade the break.</strong> A liquidity grab: stops were taken and price reclaimed the level.", "Where are the stops, and where did price close?"],
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
  id: 'trap-or-trade',
  mount(root, ctx) {
    let deck = [];
    const used = new Set();
    let current = 0;
    const game = new GameShell(root, ctx, {
      rounds: 6,
      timer: { seconds: 25, perRound: true },
      howTo: ["Price has just broken a level.", "Trade the breakout, fade the trap, or wait for the retest.", "Real-market mode grades your read, then shows what happened."],
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
