// Order Desk — pick fills on a live bid/ask ladder + classic order-type rounds.
import { GameShell } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { gameplayPreview, orderLadder, verdictFlourish, sampleCandle } from '../core/game-ui.js';

const BANK = [
  [0, "Bid 99.98, ask 100.02. You send a market BUY. Roughly where does it fill?", ["100.02 (the ask)", "99.98 (the bid)", "100.00 (the middle)", "Wherever you choose"], "<strong>At the ask.</strong> A market buy takes the best price sellers are offering, so you pay the spread.", "Buyers who want to fill right now pay the sellers' price.", "ask"],
  [0, "Which order guarantees your price but not the fill?", ["Limit order", "Market order", "Stop order", "Every order"], "<strong>Limit order.</strong> It fills at your price or better, or not at all.", "It puts a limit on the price you will accept.", null],
  [1, "Price is 100. You want to buy only if price breaks above 102. Which order?", ["Buy stop at 102", "Buy limit at 102", "Sell stop at 102", "Market buy now"], "<strong>Buy stop at 102.</strong> A stop triggers when price moves through your level; a buy limit at 102 would fill immediately because 100 is already better.", "A stop waits for price to travel to your level and then fires.", null],
  [1, "Bid 49.90, ask 50.10. What is the spread?", ["0.20", "0.10", "50.00", "0.02"], "<strong>0.20.</strong> Spread = ask − bid = 50.10 − 49.90.", "Ask minus bid.", null],
  [1, "You are long from 100 and want out automatically if price falls to 97. Which order?", ["Sell stop at 97", "Sell limit at 97", "Buy stop at 97", "Buy limit at 97"], "<strong>Sell stop at 97.</strong> A stop-loss is a stop order on the exit side: it becomes a market sell once 97 trades.", "You are selling to exit, and it should only trigger if price drops to your level.", null],
  [2, "A fast market gaps from 97.40 straight to 96.80, through your sell stop at 97.00. Where do you most likely fill?", ["Near 96.80: slippage", "Exactly 97.00", "97.40", "You don't get filled"], "<strong>Near 96.80.</strong> Once triggered, a stop is a market order and fills at the next available price. The difference is slippage.", "A triggered stop becomes a market order.", null],
  [2, "The ask shows 200 shares at 50.10, then 800 at 50.25. You market-buy 1,000. Average fill?", ["About 50.22", "Exactly 50.10", "Exactly 50.25", "50.00"], "<strong>About 50.22.</strong> (200 × 50.10 + 800 × 50.25) ÷ 1,000 = 50.22. Big market orders walk the order book.", "Work down the ladder: 200 at the first price, the rest at the next.", null],
  [2, "Which order can fill at a better price than the one you set?", ["A limit order", "A stop order", "A market order", "None of them"], "<strong>A limit order</strong> fills at your price or better. Stops and market orders can fill worse.", "Think about which order promises 'this price or better'.", null],
];
const CORRECT = BANK.map(() => 0);

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
      howTo: [
        'A client order arrives with the current bid and ask.',
        'Pick the order type, or tap the right rung on the live ladder.',
        'Survival: three lives, and the orders get trickier.',
      ],
      preview: (el) => gameplayPreview(el, { seed: 101, direction: 'up', title: 'Order Desk', score: 540, streak: 4, round: '3/6' }),
      onStart(g, { rng }) {
        deck = rng.shuffle(BANK.map((_, i) => i));
        used.clear();
      },
      onRound(g, { rng, difficulty, retry, stage }) {
        if (!retry) current = pickQuestion(deck, used, difficulty);
        const q = BANK[current];
        // Ladder round: market buy → pick the ask; market sell → pick the bid
        if (q[5] === 'ask' || (difficulty > 0.55 && rng.chance(0.45))) {
          const mid = +(90 + rng.float(0, 40)).toFixed(2);
          const tick = 0.25;
          const want = q[5] || (rng.chance(0.5) ? 'ask' : 'bid');
          // A market order fills at the best price: the lowest ask / highest bid, next to Last.
          const best = +(mid + (want === 'ask' ? tick : -tick)).toFixed(2);
          stage.append(
            h('p', { class: 'quiz__q' }, want === 'ask'
              ? `Market BUY at mid ${mid.toFixed(2)}. Tap the ask you would lift.`
              : `Market SELL at mid ${mid.toFixed(2)}. Tap the bid you would hit.`),
            h('div', { class: 'row row--sm', style: { marginBottom: '0.5rem' } }, sampleCandle(want === 'ask' ? 'bull' : 'bear', { width: 56, height: 88 })),
          );
          let picked = null;
          const ladder = orderLadder({
            mid, tick, levels: 5 + Math.round(difficulty * 2), seed: rng.int(1, 1e9),
            onPick: (row) => { picked = row; },
          });
          stage.append(ladder);
          g.setHint(want === 'ask' ? 'Market buys take liquidity from sellers — the best (lowest) ask.' : 'Market sells hit the best (highest) bid.');
          const explain = want === 'ask'
            ? `<strong>Lift the ask at ${best.toFixed(2)}.</strong> Market buys pay the best offer — the lowest ask.`
            : `<strong>Hit the bid at ${best.toFixed(2)}.</strong> Market sells take the best bid — the highest one.`;
          const confirm = h('button', {
            type: 'button', class: 'btn btn--primary btn--lg',
            onclick: () => {
              if (confirm.disabled) return;
              confirm.disabled = true;
              const sideOk = picked && picked.side === want && picked.price === best;
              if (sideOk) g.correct(explain);
              else g.wrong(explain);
              verdictFlourish(stage, {
                ok: sideOk,
                title: sideOk ? 'Filled' : 'Missed the book',
                detail: picked ? `You tapped ${picked.side.toUpperCase()} ${picked.price.toFixed(2)}.` : 'No rung selected — tap a bid or ask first.',
                scoreDelta: sideOk ? 100 : 0,
              });
              g.nextButton();
            },
          }, 'Confirm fill');
          stage.append(h('div', { class: 'row', style: { marginTop: '0.6rem' } }, confirm));
          return;
        }
        g.ask({
          question: q[1],
          options: rng.shuffle(q[2].map((label, i) => ({ label, value: i }))),
          answer: CORRECT[current],
          explain: q[3],
          hint: q[4],
          onAnswer: (ok) => verdictFlourish(stage, { ok, title: ok ? 'Desk cleared' : 'Recheck the book', detail: q[3].replace(/<[^>]+>/g, ' ').slice(0, 120) }),
        });
      },
    });
    return () => game.destroy();
  },
};
