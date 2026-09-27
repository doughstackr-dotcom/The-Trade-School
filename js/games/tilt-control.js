// Tilt Control — interactive GameShell module.
import { GameShell } from '../core/game-kit.js';

// [difficulty 0–2, question, options (the first is correct; shown shuffled), explanation, hint]
const BANK = [
  [0, "9:45. Your first trade hits its stop: −1R, exactly as planned. What now?", ["Log it and wait for the next valid setup", "Re-enter immediately, bigger", "Switch markets to win it back", "Quit trading for good"], "<strong>Log it and wait.</strong> A planned loss is a cost of doing business.", "Was anything wrong with the trade itself?"],
  [0, "A stock you don't follow is up 40% today and everyone is talking about it. Your plan doesn't cover it.", ["Skip it: not in the plan", "Buy now before it's too late", "Buy with the whole account", "Short it because it's up a lot"], "<strong>Skip it.</strong> Fear of missing out is not a setup.", "What does your plan say?"],
  [1, "Your trade sits at −0.8R, close to the stop. You feel it is about to turn.", ["Leave the stop where it is", "Move the stop further away", "Remove the stop", "Add to the position"], "<strong>Leave it.</strong> Moving a stop turns a small planned loss into a large unplanned one.", "The stop was set when you were calm."],
  [1, "You are up +3R, above your daily target. A mediocre setup appears.", ["Skip it and protect the day", "Take it at double size", "Take it because you're on fire", "Lower your standards today"], "<strong>Skip it.</strong> Overconfidence after wins is tilt too.", "Would you take this setup on a normal day?"],
  [1, "Two planned losses in a row. Your daily limit is 3R and you are at −2R.", ["A+ setups only at normal size, or stop", "Double size to recover", "Trade everything that moves", "Ignore the limit today"], "<strong>Tighten up or stop.</strong> One more loss ends the day by design.", "How much room is left before the limit?"],
  [2, "A winner is at +1.8R with the target at 2R. Price stalls. Your plan: trail the stop to breakeven at +1.5R.", ["Follow the plan: stop to breakeven", "Close now out of fear", "Move the target to 5R", "Remove the stop to give it room"], "<strong>Follow the plan.</strong> The rule already protects the trade.", "What did you decide before you entered?"],
  [2, "End of day: you made money but broke two rules. How do you grade it?", ["A poor day: process beats outcome", "A great day: money is money", "It doesn't matter", "Stop journaling, it's working"], "<strong>A poor day.</strong> Rule-breaking that pays is the most dangerous kind.", "Would you want to repeat how you traded?"],
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
  id: 'tilt-control',
  mount(root, ctx) {
    let deck = [];
    const used = new Set();
    let current = 0;
    const game = new GameShell(root, ctx, {
      rounds: 7,
      howTo: ["A trading day unfolds, one decision at a time.", "Choose what a disciplined trader would do.", "The full game branches: your choices change the day."],
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
