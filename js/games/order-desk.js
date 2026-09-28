// Order Desk — pick fills on a live bid/ask ladder + classic order-type rounds.
import { GameShell, QuestionBank, bankOptions, explainChoice, trackAnswer } from '../core/game-kit.js';
import { h } from '../core/ui.js';
import { gameplayPreview, orderLadder, verdictFlourish, sampleCandle } from '../core/game-ui.js';

// { id, level 0–2, q, a (correct option), wrong: { option: why it is wrong }, explain, hint,
//   ladder (true: sometimes played as a tap-the-ladder round) }
export const QUESTIONS = [
  {
    id: 'od-market-buy-fill', level: 0, ladder: true,
    q: 'Bid 99.98, ask 100.02. You send a market BUY. Roughly where does it fill?',
    a: '100.02 (the ask)',
    wrong: {
      '99.98 (the bid)': 'The bid is what buyers are offering: a market SELL fills there. A buyer who wants in right now pays the sellers’ price.',
      '100.00 (the middle)': 'Nobody is quoting the midpoint. A market order takes the best price already on the book, which for a buy is the ask.',
      'Wherever you choose': 'Choosing your price is what a limit order does. A market order accepts the best price available.',
    },
    explain: '<strong>At the ask.</strong> A market buy takes the best price sellers are offering, so you pay the spread.',
    hint: 'Buyers who want to fill right now pay the sellers’ price.',
  },
  {
    id: 'od-market-sell-fill', level: 0, ladder: true,
    q: 'Bid 20.10, ask 20.14. You send a market SELL. Roughly where does it fill?',
    a: '20.10 (the bid)',
    wrong: {
      '20.14 (the ask)': 'The ask is where sellers are waiting to sell: a market BUY fills there. To sell right now you hit the buyers’ bid.',
      '20.12 (the middle)': 'Nobody is quoting the midpoint. A market sell takes the best bid on the book.',
      'The last traded price': 'The last trade is history. A market order fills against the orders on the book now, and for a sell that is the bid.',
    },
    explain: '<strong>At the bid.</strong> A market sell takes the best price buyers are offering.',
    hint: 'Sellers who want out right now accept the buyers’ price.',
  },
  {
    id: 'od-ask-definition', level: 0,
    q: 'The ask (or offer) is…',
    a: 'The lowest price a seller is currently willing to accept',
    wrong: {
      'The highest price a buyer is currently willing to pay': 'That is the bid.',
      'The price of the last trade': 'The last trade can differ from both the current bid and ask.',
      'The highest price of the day': 'That is the day’s high, which has nothing to do with the quotes on the book right now.',
    },
    explain: '<strong>The best (lowest) offer to sell.</strong> The bid is the best (highest) offer to buy; the gap between them is the spread.',
    hint: 'Sellers “ask” for a price.',
  },
  {
    id: 'od-limit-guarantee', level: 0,
    q: 'Which order guarantees your price but not the fill?',
    a: 'Limit order',
    wrong: {
      'Market order': 'A market order all but guarantees the fill, not the price: it takes whatever is available.',
      'Stop order': 'A stop order triggers at your level and then becomes a market order, so the price is not guaranteed.',
      'Every order': 'No order guarantees both price and fill. You trade one for the other.',
    },
    explain: '<strong>Limit order.</strong> It fills at your price or better, or not at all.',
    hint: 'It puts a limit on the price you will accept.',
  },
  {
    id: 'od-buy-limit-dip', level: 0,
    q: 'Price is 100. You want to buy only if it dips to 95. Which order?',
    a: 'Buy limit at 95',
    wrong: {
      'Buy stop at 95': 'A buy stop triggers when price RISES to its level. With price at 100, already above 95, it would trigger straight away.',
      'Sell limit at 95': 'That is a sell order. You want to buy.',
      'Market buy now': 'That buys at about 100 now, not at 95.',
    },
    explain: '<strong>Buy limit at 95.</strong> A buy limit fills at 95 or lower, so it waits below the market for the dip.',
    hint: 'Buying below the current price: “this price or better”.',
  },
  {
    id: 'od-sell-limit-target', level: 0,
    q: 'You own shares at 50 and want to sell if price rises to 55. Which order?',
    a: 'Sell limit at 55',
    wrong: {
      'Sell stop at 55': 'A sell stop triggers when price FALLS to its level. With price at 50, already below 55, it would trigger straight away.',
      'Buy limit at 55': 'That buys more shares. You want to sell.',
      'Market sell now': 'That sells at about 50 now, not at your 55 target.',
    },
    explain: '<strong>Sell limit at 55.</strong> A sell limit fills at 55 or higher: the classic take-profit order.',
    hint: 'Selling above the current price: “this price or better”.',
  },
  {
    id: 'od-slippage-definition', level: 0,
    q: 'The screen shows an ask of 25.00. You market-buy and fill at 25.04. The 0.04 difference is…',
    a: 'Slippage',
    wrong: {
      'The spread': 'The spread is ask minus bid at one moment. You paid more than the ask you saw because the price moved or the size at 25.00 ran out.',
      'A commission': 'A commission is a fee charged on top of the fill, not a worse fill price.',
      'A dividend': 'A dividend is a payment to shareholders and has nothing to do with the fill.',
    },
    explain: '<strong>Slippage:</strong> the gap between the price you expected and the price you got. Fast markets and thin books make it bigger.',
    hint: 'Expected price vs actual fill.',
  },
  {
    id: 'od-buy-stop-breakout', level: 1,
    q: 'Price is 100. You want to buy only if price breaks above 102. Which order?',
    a: 'Buy stop at 102',
    wrong: {
      'Buy limit at 102': 'A buy limit means “102 or lower”. With price at 100 that is already true, so it would fill immediately, before any breakout.',
      'Sell stop at 102': 'That is a sell order. You want to buy.',
      'Market buy now': 'That buys at about 100 now, whether or not the breakout happens.',
    },
    explain: '<strong>Buy stop at 102.</strong> A stop triggers when price trades up through your level; a buy limit at 102 would fill at once because 100 is already better.',
    hint: 'A stop waits for price to travel to your level and then fires.',
  },
  {
    id: 'od-spread', level: 1,
    q: 'Bid 49.90, ask 50.10. What is the spread?',
    a: '0.20',
    wrong: {
      '0.10': 'That is half the spread: the distance from the midpoint to either side.',
      '50.00': 'That is the midpoint, not the spread.',
      '0.02': 'Check the decimals: 50.10 − 49.90 = 0.20.',
    },
    explain: '<strong>0.20.</strong> Spread = ask − bid = 50.10 − 49.90.',
    hint: 'Ask minus bid.',
  },
  {
    id: 'od-stop-loss-long', level: 1,
    q: 'You are long from 100 and want out automatically if price falls to 97. Which order?',
    a: 'Sell stop at 97',
    wrong: {
      'Sell limit at 97': 'A sell limit means “97 or higher”. With price at 100 it would fill immediately and close the trade now.',
      'Buy stop at 97': 'You exit a long position by selling, not buying.',
      'Buy limit at 97': 'That buys more on the way down: it adds to the loser instead of cutting it.',
    },
    explain: '<strong>Sell stop at 97.</strong> A stop-loss is a stop order on the exit side: it becomes a market sell once 97 trades.',
    hint: 'You are selling to exit, and it should only trigger if price drops to your level.',
  },
  {
    id: 'od-stop-loss-short', level: 1,
    q: 'You are short from 50 with a stop-loss at 52. Which order is that stop?',
    a: 'Buy stop at 52',
    wrong: {
      'Sell stop at 52': 'You close a short by BUYING the shares back, not by selling more.',
      'Buy limit at 52': 'A buy limit means “52 or lower”. With price at 50 it would fill immediately and close the short now.',
      'Sell limit at 52': 'That sells more: it would add to the short instead of protecting it.',
    },
    explain: '<strong>Buy stop at 52.</strong> A short loses as price rises; the buy stop closes it once 52 trades.',
    hint: 'How do you close a short, and in which direction is the danger?',
  },
  {
    id: 'od-day-order', level: 1,
    q: 'A limit order marked DAY has not filled by the close of the session. What happens to it?',
    a: 'It is cancelled',
    wrong: {
      'It carries over to tomorrow': 'That is good-’til-cancelled (GTC). A DAY order expires at the end of the session.',
      'It turns into a market order': 'Unfilled limit orders never convert into market orders on their own.',
      'It fills at the closing price': 'That is a market-on-close order, a different order type.',
    },
    explain: '<strong>It expires.</strong> DAY is the usual default time-in-force: work the order today, cancel whatever is left at the close.',
    hint: 'Time-in-force: how long the order stays alive.',
  },
  {
    id: 'od-gtc', level: 1,
    q: 'Which time-in-force keeps an order working across sessions until it fills or you cancel it?',
    a: 'GTC (good ’til cancelled)',
    wrong: {
      'DAY': 'A DAY order expires at the end of the session.',
      'IOC (immediate or cancel)': 'IOC fills whatever it can immediately and cancels the rest at once.',
      'FOK (fill or kill)': 'FOK must fill completely and immediately, or it is cancelled in full.',
    },
    explain: '<strong>GTC.</strong> It stays on the book across sessions. Many brokers still expire GTC orders after a set period (often 60–90 days), so check yours.',
    hint: 'The name says how long it lasts.',
  },
  {
    id: 'od-overnight-gap', level: 1,
    q: 'You hold a stock with a sell stop at 45. It closes at 47, bad news hits overnight and it opens at 41. Where does your stop most likely fill?',
    a: 'Near 41, around the open',
    wrong: {
      'At 45': 'A stop does not guarantee its price. Nothing traded between 47 and 41, so the first price available after it triggers is near the open.',
      'It does not trigger': 'It does: price is below 45. It triggers at the open and fills at the next available price.',
      'At 47, the last close': 'The close is history. Orders fill at prices that trade after they trigger.',
    },
    explain: '<strong>Near 41.</strong> Gaps jump over stop levels. The stop becomes a market order at the open, and the gap is extra loss (slippage) beyond the planned risk.',
    hint: 'Did anything trade at 45?',
  },
  {
    id: 'od-queue', level: 1,
    q: 'Your buy limit at 30.00 is resting on the book. Price touches exactly 30.00 once and bounces. Is a fill guaranteed?',
    a: 'No: orders ahead of you in the queue may take all the volume',
    wrong: {
      'Yes: touching the price guarantees a fill': 'A touch only means some shares traded at 30.00. Orders placed before yours at that price are usually filled first.',
      'Yes, but at 29.99': 'A buy limit never fills worse than your price, and a touch of 30.00 does not create trades at 29.99.',
      'No: buy limits only fill above their price': 'The opposite: a buy limit fills at its price or LOWER.',
    },
    explain: '<strong>Not guaranteed.</strong> At one price level, orders queue (typically first come, first served). A limit is certain to fill only if price trades through it.',
    hint: 'Who else was bidding 30.00 before you?',
  },
  {
    id: 'od-reduce-slippage', level: 1,
    q: 'Which habit usually reduces slippage on entries?',
    a: 'Using limit orders in liquid markets, away from news spikes',
    wrong: {
      'Sending bigger market orders': 'Bigger market orders eat through more of the book, so the average fill gets worse.',
      'Trading right as major news is released': 'Spreads widen and prices jump around news, which is when slippage is at its worst.',
      'Trading thin, illiquid stocks': 'Thin markets have wide spreads and little size at each price: more slippage, not less.',
    },
    explain: '<strong>Limits, liquidity, calm.</strong> A limit order caps the price you pay; liquid markets have tight spreads and depth.',
    hint: 'Where are spreads tight and prices steady?',
  },
  {
    id: 'od-stop-limit', level: 1,
    q: 'A sell stop-limit has a stop of 97.00 and a limit of 96.50. What does it do once 97.00 trades?',
    a: 'Becomes a limit order to sell at 96.50 or better',
    wrong: {
      'Becomes a market order': 'That is a plain stop (stop-market) order. A stop-limit becomes a LIMIT order.',
      'Sells exactly at 97.00': 'No order guarantees an exact price. The stop only switches the order on.',
      'Cancels itself': 'The stop price activates the order; it does not cancel it.',
    },
    explain: '<strong>A limit at 96.50 or better.</strong> The stop switches the order on; the limit sets the worst price you accept.',
    hint: 'Two prices: one to trigger, one to cap the fill.',
  },
  {
    id: 'od-gap-slippage', level: 2,
    q: 'A fast market drops from 97.40 straight to 96.80, through your sell stop at 97.00. Where do you most likely fill?',
    a: 'Near 96.80: slippage',
    wrong: {
      'Exactly 97.00': 'A stop is not a guaranteed price. Once triggered it is a market order, and 97.00 was skipped.',
      '97.40': 'That was before the stop triggered. The order fills at prices available after the trigger.',
      'You do not get filled': 'A stop-MARKET order fills at the next available price. Not filling is the risk of a stop-limit.',
    },
    explain: '<strong>Near 96.80.</strong> Once triggered, a stop is a market order and fills at the next available price. The difference is slippage.',
    hint: 'A triggered stop becomes a market order.',
  },
  {
    id: 'od-stop-limit-gap', level: 2,
    q: 'Your sell stop-limit is stop 97.00, limit 96.50. Price gaps from 97.40 to 96.20 and keeps falling. What happens?',
    a: 'It triggers but does not fill: price is below your limit',
    wrong: {
      'It fills near 96.20': 'That is what a stop-market order would do. The 96.50 limit forbids selling any lower.',
      'It fills at 97.00': 'Nothing traded at 97.00: the gap skipped it.',
      'It never triggers': 'Trading at or below 97.00 triggers it, and 96.20 is below 97.00. It triggers, but the limit then stops it filling.',
    },
    explain: '<strong>Triggered, not filled.</strong> A stop-limit protects you from a terrible fill at the cost of maybe not getting out at all, which is dangerous for a stop-loss in a falling market.',
    hint: 'The limit sets the worst price you will accept.',
  },
  {
    id: 'od-ioc', level: 2,
    q: 'You send an IOC buy for 1,000 shares with a limit of 20.00. Only 300 are offered at 20.00 or less. Result?',
    a: '300 fill; the other 700 are cancelled',
    wrong: {
      'Nothing fills': 'That is fill-or-kill (FOK): all or nothing. IOC takes what it can.',
      'All 1,000 fill, 700 at higher prices': 'The 20.00 limit forbids paying more.',
      '300 fill; the other 700 wait on the book': 'A DAY or GTC limit would rest on the book. IOC cancels the unfilled part immediately.',
    },
    explain: '<strong>Partial fill, rest cancelled.</strong> Immediate-or-cancel takes whatever is available at your limit right now.',
    hint: 'Immediate… or cancel.',
  },
  {
    id: 'od-walk-book', level: 2,
    q: 'The ask shows 200 shares at 50.10, then 800 at 50.25. You market-buy 1,000. Average fill?',
    a: 'About 50.22',
    wrong: {
      'Exactly 50.10': 'Only 200 shares were offered at 50.10. The other 800 had to come from the next price up.',
      'Exactly 50.25': 'The first 200 shares filled cheaper, at 50.10.',
      '50.00': 'A market buy never fills below the best ask.',
    },
    explain: '<strong>About 50.22.</strong> (200 × 50.10 + 800 × 50.25) ÷ 1,000 = 50.22. Big market orders walk the order book.',
    hint: 'Work down the ladder: 200 at the first price, the rest at the next.',
  },
  {
    id: 'od-better-price', level: 2,
    q: 'Which order can fill at a better price than the one you set?',
    a: 'A limit order',
    wrong: {
      'A stop order': 'A stop becomes a market order when triggered, so it can fill WORSE than the stop, especially in fast markets.',
      'A market order': 'A market order has no price of its own; it takes whatever is available.',
      'None of them': 'A limit order fills at your price or better: a buy limit at 20 can fill at 19.95 if that is offered.',
    },
    explain: '<strong>A limit order</strong> fills at your price or better. Stops and market orders can fill worse.',
    hint: 'Which order promises “this price or better”?',
  },
];

export default {
  id: 'order-desk',
  mount(root, ctx) {
    const bank = new QuestionBank(QUESTIONS, { id: 'order-desk' });
    let current = null;
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
        bank.reset(rng, g.store);
      },
      onRound(g, { rng, difficulty, retry, stage }) {
        if (!retry || !current) current = bank.next(difficulty);
        const q = current;
        // Ladder round: market buy → pick the ask; market sell → pick the bid
        if (q.ladder || (difficulty > 0.55 && rng.chance(0.45))) {
          const mid = +(90 + rng.float(0, 40)).toFixed(2);
          const tick = 0.25;
          const want = rng.chance(0.5) ? 'ask' : 'bid';
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
          // Bind the rungs with real listeners (orderLadder passes lowercase `onclick`, which h()
          // does not bind); idempotent if its own handler also fires.
          for (const btn of ladder.querySelectorAll('.order-desk__row')) {
            btn.addEventListener('click', () => {
              ladder.querySelectorAll('.is-picked').forEach((n) => n.classList.remove('is-picked'));
              btn.classList.add('is-picked');
              picked = {
                side: btn.classList.contains('order-desk__row--ask') ? 'ask' : 'bid',
                price: parseFloat(btn.querySelector('.order-desk__price')?.textContent || 'NaN'),
              };
            });
          }
          stage.append(ladder);
          g.setHint(want === 'ask' ? 'Market buys take liquidity from sellers: the best (lowest) ask fills first.' : 'Market sells take liquidity from buyers: the best (highest) bid fills first.');
          const explain = want === 'ask'
            ? `<strong>Lift the best ask (${(mid + tick).toFixed(2)}).</strong> Market buys pay the lowest offer first.`
            : `<strong>Hit the best bid (${(mid - tick).toFixed(2)}).</strong> Market sells take the highest bid first.`;
          const confirm = h('button', {
            type: 'button', class: 'btn btn--primary btn--lg',
            onClick: () => {
              if (confirm.disabled) return;
              confirm.disabled = true;
              // A market order fills at the best price on its side first: the lowest ask / highest bid.
              const best = +(want === 'ask' ? mid + tick : mid - tick).toFixed(2);
              const sideOk = !!picked && picked.side === want && Math.abs(picked.price - best) < tick / 2;
              let why = '';
              if (!sideOk && picked) {
                if (picked.side !== want) {
                  why = want === 'ask'
                    ? 'You tapped the BID side: that is where a market SELL fills. A market buy lifts the best (lowest) ask.'
                    : 'You tapped the ASK side: that is where a market BUY fills. A market sell hits the best (highest) bid.';
                } else {
                  why = want === 'ask'
                    ? `Right side, wrong rung: a market buy fills at the BEST ask first, the lowest one (${best.toFixed(2)}). Higher asks only fill once the size at better prices is used up.`
                    : `Right side, wrong rung: a market sell fills at the BEST bid first, the highest one (${best.toFixed(2)}). Lower bids only fill once the size at better prices is used up.`;
                }
              }
              if (sideOk) g.correct(explain);
              else g.wrong(why ? `<span class="game__why">${why}</span><br>${explain}` : explain);
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
          question: q.q,
          options: bankOptions(q, rng),
          answer: q.a,
          explain: explainChoice(q.explain, q.wrong),
          hint: q.hint,
          onAnswer: (ok) => {
            trackAnswer(g.store, 'order-desk', q.id, ok);
            verdictFlourish(stage, { ok, title: ok ? 'Desk cleared' : 'Recheck the book', detail: q.explain.replace(/<[^>]+>/g, ' ').slice(0, 120) });
          },
        });
      },
    });
    return () => game.destroy();
  },
};
