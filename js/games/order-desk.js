// Order Desk — interactive GameShell module.
import { GameShell } from '../core/game-kit.js';

// [difficulty 0–2, question, options (the first is correct; shown shuffled), explanation, hint]
const BANK = [
  [0, "Bid 99.98, ask 100.02. You send a market BUY. Roughly where does it fill?", ["100.02 (the ask)", "99.98 (the bid)", "100.00 (the middle)", "Wherever you choose"], "<strong>At the ask.</strong> A market buy takes the best price sellers are offering, so you pay the spread.", "Buyers who want to fill right now pay the sellers' price."],
  [0, "Which order guarantees your price but not the fill?", ["Limit order", "Market order", "Stop order", "Every order"], "<strong>Limit order.</strong> It fills at your price or better, or not at all.", "It puts a limit on the price you will accept."],
  [1, "Price is 100. You want to buy only if price breaks above 102. Which order?", ["Buy stop at 102", "Buy limit at 102", "Sell stop at 102", "Market buy now"], "<strong>Buy stop at 102.</strong> A stop triggers when price moves through your level; a buy limit at 102 would fill immediately because 100 is already better.", "A stop waits for price to travel to your level and then fires."],
  [1, "Bid 49.90, ask 50.10. What is the spread?", ["0.20", "0.10", "50.00", "0.02"], "<strong>0.20.</strong> Spread = ask − bid = 50.10 − 49.90.", "Ask minus bid."],
  [1, "You are long from 100 and want out automatically if price falls to 97. Which order?", ["Sell stop at 97", "Sell limit at 97", "Buy stop at 97", "Buy limit at 97"], "<strong>Sell stop at 97.</strong> A stop-loss is a stop order on the exit side: it becomes a market sell once 97 trades.", "You are selling to exit, and it should only trigger if price drops to your level."],
  [2, "A fast market gaps from 97.40 straight to 96.80, through your sell stop at 97.00. Where do you most likely fill?", ["Near 96.80: slippage", "Exactly 97.00", "97.40", "You don't get filled"], "<strong>Near 96.80.</strong> Once triggered, a stop is a market order and fills at the next available price. The difference is slippage.", "A triggered stop becomes a market order."],
  [2, "The ask shows 200 shares at 50.10, then 800 at 50.25. You market-buy 1,000. Average fill?", ["About 50.22", "Exactly 50.10", "Exactly 50.25", "50.00"], "<strong>About 50.22.</strong> (200 × 50.10 + 800 × 50.25) ÷ 1,000 = 50.22. Big market orders walk the order book.", "Work down the ladder: 200 at the first price, the rest at the next."],
  [2, "Which order can fill at a better price than the one you set?", ["A limit order", "A stop order", "A market order", "None of them"], "<strong>A limit order</strong> fills at your price or better. Stops and market orders can fill worse.", "Think about which order promises 'this price or better'."],
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
  id: 'order-desk',
  mount(root, ctx) {
    let deck = [];
    const used = new Set();
    let current = 0;
    const game = new GameShell(root, ctx, {
      rounds: 6,
      timer: { seconds: 25, perRound: true },
      howTo: ["A client order arrives with the current bid and ask.", "Pick the order type, or work out where it fills.", "Survival: three lives, and the orders get trickier."],
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
