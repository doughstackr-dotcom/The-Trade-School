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
  [0, "Bid 80.00, ask 80.08. You send a market SELL. Roughly where does it fill?", ["80.00 (the bid)", "80.08 (the ask)", "80.04 (the middle)", "At your original buy price"], "<strong>At the bid.</strong> A market sell hits the best price buyers currently offer.", "An urgent seller accepts the buyer's price.", null],
  [1, "Price is 100. You place a buy limit at 98.50. What happens if the ask stays above 99?", ["It waits without filling", "It buys immediately at 100", "It becomes a stop order", "It sells at 98.50"], "<strong>It waits.</strong> A buy limit will not pay above 98.50; the order may never fill.", "A buy limit caps the highest price you will pay.", null],
  [1, "Bid 25.00, ask 25.12. You buy at market and immediately sell at market with no price move. Approximate cost per share?", ["0.12", "0.06", "0.00", "25.12"], "<strong>0.12 per share.</strong> You buy at the ask and sell at the bid, paying the full spread before fees.", "Compare what you pay to buy with what you receive to sell.", null],
  [1, "Price is 100. You want to sell only if it rallies to at least 104. Which order?", ["Sell limit at 104", "Sell stop at 104", "Buy limit at 104", "Market sell now"], "<strong>Sell limit at 104.</strong> It waits for 104 or better; a sell stop above market can trigger immediately.", "A limit order sets the least you will accept for a sale.", null],
  [2, "A sell stop-limit triggers at 97, with a limit price of 96.50. The next available bid after a gap is 96.20. What is the main risk?", ["No fill until a buyer offers 96.50 or better", "Guaranteed fill at 97", "It fills at 96.20", "It turns into a buy order"], "<strong>No immediate fill.</strong> The limit protects price but can leave you exposed after a gap through 96.50.", "A stop-limit becomes a limit order after its stop triggers.", null],
  [2, "Your 500-share buy limit is at 50.00. Only 200 shares are offered there and no one offers more at 50.00. What can happen?", ["200 fill; 300 remain open", "All 500 must fill", "The remaining 300 become a market buy", "Nothing can fill"], "<strong>Partial fill.</strong> The 200 available shares may fill while the other 300 wait at your limit price, unless your time-in-force says otherwise.", "A limit order can fill in pieces as liquidity arrives.", null],
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
      preview: (el) => gameplayPreview(el, { seed: 101, direction: 'up', title: 'Order Desk', score: 540, streak: 2, round: '2/3' }),
      onStart(g, { rng }) {
        deck = rng.shuffle(BANK.map((_, i) => i));
        used.clear();
      },
      onRound(g, { rng, difficulty, retry, stage }) {
        if (!retry) current = pickQuestion(deck, used, difficulty);
        const q = BANK[current];
        // Ladder round: market buy → pick the ask; market sell → pick the bid
        if (q[5] === 'ask' || (difficulty > 0.45 && rng.chance(0.55))) {
          const mid = +(90 + rng.float(0, 40)).toFixed(2);
          const tick = rng.pick(difficulty > 0.6 ? [0.05, 0.10, 0.25] : [0.10, 0.25]);
          const want = q[5] || (rng.chance(0.5) ? 'ask' : 'bid');
          const sweep = difficulty > 0.55 && rng.chance(0.48);
          let picked = null;
          let confirm;
          const ladder = orderLadder({
            mid, tick, levels: 5 + Math.round(difficulty * 2), seed: rng.int(1, 1e9),
            onPick: (row) => { picked = row; confirm.disabled = false; },
          });
          const rungs = [...ladder.querySelectorAll(`.order-desk__row--${want}`)]
            .map((el) => ({
              price: Number(el.querySelector('.order-desk__price').textContent),
              size: Number(el.querySelector('.order-desk__size').textContent),
            }))
            .sort((a, b) => want === 'ask' ? a.price - b.price : b.price - a.price);
          const target = rungs[sweep ? 1 : 0];
          const quantity = sweep ? rungs[0].size + Math.max(1, Math.min(3, rungs[1].size)) : 1;
          stage.append(
            h('p', { class: 'quiz__q' }, sweep
              ? `Market ${want === 'ask' ? 'BUY' : 'SELL'} ${quantity} shares at mid ${mid.toFixed(2)}. Tap the deepest price rung this order reaches.`
              : `Market ${want === 'ask' ? 'BUY' : 'SELL'} at mid ${mid.toFixed(2)}. Tap the first rung that fills.`),
            h('div', { class: 'row row--sm', style: { marginBottom: '0.5rem' } }, sampleCandle(want === 'ask' ? 'bull' : 'bear', { width: 56, height: 88 })),
          );
          stage.append(ladder);
          g.setHint(sweep
            ? `The first ${rungs[0].size} shares fill at ${rungs[0].price.toFixed(2)}; the rest move to the next ${want}.`
            : want === 'ask' ? 'Market buys lift the lowest ask.' : 'Market sells hit the highest bid.');
          const explain = sweep
            ? `<strong>Order walks the book to ${target.price.toFixed(2)}.</strong> ${rungs[0].size} shares fill at ${rungs[0].price.toFixed(2)}; ${quantity - rungs[0].size} reach the next ${want}.`
            : `<strong>First fill at ${target.price.toFixed(2)}.</strong> A market ${want === 'ask' ? 'buy lifts the lowest ask' : 'sell hits the highest bid'}.`;
          confirm = h('button', {
            type: 'button', class: 'btn btn--primary btn--lg', disabled: true,
            onclick: () => {
              if (confirm.disabled) return;
              confirm.disabled = true;
              const sideOk = picked && picked.side === want && picked.price === target.price;
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
