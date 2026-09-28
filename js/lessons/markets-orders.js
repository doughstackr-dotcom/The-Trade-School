// Markets, orders and the spread — how trades actually fill.
import { LessonShell, storyStep, figure, takeaway } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';
import {
  orderBookVisual, spreadVisual, orderCompareVisual, marketMeetingVisual,
} from './markets-orders-visuals.js';

function tapeStory(rng) {
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: 48, direction: 'up', swings: 3 });
  const candles = ts.candles;
  const mid = Math.floor(candles.length * 0.55);
  const px = candles[mid].c;
  return {
    candles,
    indicators: { volume: false },
    frames: [
      { to: mid, caption: 'Price drifts higher. Buyers and sellers keep meeting at the best bid and ask.' },
      {
        to: mid + 1,
        title: 'The spread.',
        caption: `Best bid ${(px - 0.05).toFixed(2)}, best ask ${(px + 0.05).toFixed(2)}. The gap is the spread you pay to cross.`,
        overlays: [
          { type: 'hline', price: px + 0.05, color: 'bear', label: 'Ask' },
          { type: 'hline', price: px - 0.05, color: 'bull', label: 'Bid' },
        ],
      },
      {
        to: mid + 6,
        title: 'Market buy.',
        caption: 'A market buy takes the ask now. You get filled, but you paid the spread.',
        overlays: [
          { type: 'marker', idx: mid + 2, position: 'above', shape: 'arrow', text: 'Market buy', color: 'accent' },
          { type: 'hline', price: px + 0.05, color: 'bear', label: 'Fill ≈ ask' },
        ],
      },
      {
        to: candles.length,
        caption: 'A limit buy below the market waits. It may never fill. A stop sits idle until price hits it, then becomes a market order.',
      },
    ],
  };
}

function withVisual(factory, build) {
  return (el) => {
    const cleanups = [];
    const addVis = () => {
      const vis = factory();
      el.append(vis.el);
      cleanups.push(() => vis.destroy?.());
    };
    build(el, addVis);
    return () => {
      while (cleanups.length) {
        try { cleanups.pop()(); } catch (err) { console.error(err); }
      }
    };
  };
}

export default {
  id: 'markets-orders',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'Every fill has two sides. Learn what a market is, who is on the other side, how bids and asks form a spread, and when to use market, limit and stop orders — with visuals that play out as you read.',
      steps: [
        {
          title: 'What a market is (and why it exists)',
          render: withVisual(marketMeetingVisual, (el, addVis) => {
            el.append(
              h('p', null,
                'A market is a meeting place. It exists so strangers can agree on a price without knowing each other. ',
                'Stock exchanges, futures pits, and crypto venues all do the same job: match someone who wants to buy with someone who wants to sell.'),
              h('p', null,
                'Your ', h('strong', null, 'broker'), ' is the doorway (the app or desk that routes your order). The ',
                h('strong', null, 'exchange'), ' (or liquidity venue) is where resting orders live in the book. You almost never trade “against the broker” — you trade against another participant.'),
            );
            addVis();
            el.append(
              takeaway([
                'Markets concentrate buyers and sellers so prices can be discovered continuously.',
                'Broker = access; exchange/venue = matching and the order book.',
                'Without the other side, there is no trade — only a wish.',
              ]),
            );
          }),
        },
        {
          title: 'Who is on the other side?',
          render: withVisual(() => orderBookVisual({ bid: 100.0, ask: 100.12, levels: 5 }), (el, addVis) => {
            const ts = trendSeries({ seed: 42, count: 40, direction: 'range', swings: 2 });
            el.append(
              h('p', null,
                'Buyers post ', h('strong', null, 'bids'), ' (prices they are willing to pay). Sellers post ',
                h('strong', null, 'asks'), ' or offers (prices they will accept). A trade happens when someone ',
                h('em', null, 'crosses'), ' — a marketable buy lifts the ask, or a marketable sell hits the bid.'),
              figure(
                miniChart(ts.candles, { width: 640, height: 200, yPad: 0.14, ariaLabel: 'Quiet range chart representing two-sided trading' }),
                'Quiet tape: bids and asks keep updating even when the candle barely moves.',
                { label: 'Figure 1' },
              ),
            );
            addVis();
            el.append(
              takeaway([
                'You always trade with someone on the other side — not “the market” as a monolith.',
                'The <strong>spread</strong> (ask − bid) is a cost every time you cross it.',
                'Liquidity = how much size sits near the best bid and ask.',
              ]),
            );
          }),
        },
        {
          title: 'The bid–ask spread',
          render: withVisual(() => spreadVisual({ mid: 100, tight: 0.04, wide: 0.32 }), (el, addVis) => {
            el.append(
              h('p', null,
                'The spread is the gap between the highest bid and the lowest ask. Cross it and you pay that gap as an immediate cost — before commissions.'),
              h('p', null,
                'Tight spreads (pennies on SPY) mean deep, competitive books. Wide spreads (thin small-caps, after-hours, news shocks) mean crossing is expensive and fills can jump.'),
            );
            addVis();
            el.append(
              takeaway([
                'Spread cost ≈ (ask − bid) when you buy at the ask and later sell at the bid.',
                'Spreads widen when liquidity leaves — respect that before you click Market.',
                'Quoted “last price” sits inside or at the edges of the live book; the book is what fills you.',
              ]),
            );
          }),
        },
        storyStep({
          title: 'Bid, ask and a market fill',
          text: 'Watch how a market order crosses the spread. Limits and stops behave differently.',
          story: tapeStory,
        }),
        {
          title: 'Market orders vs limit orders',
          render: withVisual(() => orderCompareVisual({ ask: 100.12, bid: 100.0, limitPx: 99.85 }), (el, addVis) => {
            el.append(
              h('p', null,
                h('strong', null, 'Market'), ' means “fill me now at the best available price.” Speed is guaranteed; price is not. A buy takes the ask (and deeper asks if you are large).'),
              h('p', null,
                h('strong', null, 'Limit'), ' means “only fill at my price or better.” Price is capped; a fill is not. Your order rests on the book until someone trades with it — or you cancel.'),
              h('p', null,
                'Example: stock shows bid 100.00 / ask 100.12. A market buy for 10 shares fills near 100.12. A limit buy at 99.85 sits below and only fills if sellers trade down to your price.'),
            );
            addVis();
            el.append(
              takeaway([
                'Market = certainty of fill, uncertainty of price (slippage possible).',
                'Limit = certainty of price (or better), uncertainty of fill.',
                'In quiet liquid names, the difference is small. In fast or thin names, it is the whole trade.',
              ]),
            );
          }),
        },
        {
          title: 'Stops, slippage, and honest caveats',
          render(el) {
            el.append(
              h('p', null, 'Pick the tool that matches your intent: speed, price, or a trigger.'),
              h('ul', { class: 'lesson-list' },
                h('li', null, h('strong', null, 'Market'), ' — fill now at the best available price. Guarantees a fill, not a price.'),
                h('li', null, h('strong', null, 'Limit'), ' — fill at your price or better, or not at all. Guarantees a price, not a fill.'),
                h('li', null, h('strong', null, 'Stop'), ' — sleeps until price trades through your level, then becomes a market order. Used for breakouts and stop-losses.'),
              ),
              h('p', null,
                h('strong', null, 'Slippage'), ' is the difference between the price you hoped for and the price you got. Gaps, thin books, and large size relative to the book all create it. A stop that triggers in a gap can fill far past your stop price.'),
              takeaway([
                'Buy stop sits above price; buy limit sits at or below.',
                'Sell stop (stop-loss for longs) sits below; sell limit sits at or above.',
                'Size positions so a full stop-out is a planned, affordable loss.',
                'In thin names, prefer limits when you can wait; use markets when timing matters more than a few ticks.',
              ]),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'Educational only: real venues add partial fills, fees and their own order rules. Practise order choice in Order Desk before you risk real money.')),
            );
          },
        },
        {
          title: 'Stop-limit, trailing stops and time in force',
          render(el) {
            el.append(
              h('ul', { class: 'lesson-list' },
                h('li', null, h('strong', null, 'Stop-limit'), ' — two prices: a stop that triggers and a limit that caps the fill. Sell stop 97, limit 96.50 means “once 97 trades, sell — but not below 96.50.” You control the price, but if price drops straight through 96.50 you may ',
                  h('em', null, 'not get out at all'), '.'),
                h('li', null, h('strong', null, 'Trailing stop'), ' — a stop that follows price by a set distance (for example $2 or 3%) as it moves in your favour and never moves back. Long at 100 with a $2 trail: the stop starts at 98; if price reaches 105 it has moved to 103.'),
                h('li', null, h('strong', null, 'Time in force'), ' — how long an order stays live. ', h('strong', null, 'Day'),
                  ' orders expire at the session close; ', h('strong', null, 'GTC'), ' (good-till-cancelled) orders stay until filled or cancelled, though many brokers cap them (often around 60–90 days). Forgotten GTC orders can fill months later.'),
              ),
              takeaway([
                'Stop = likely exit, uncertain price. Stop-limit = capped price, uncertain exit.',
                'Trailing stops lock in some open profit but can be shaken out by normal pullbacks — set the distance with volatility in mind.',
                'Check what time in force your order uses; defaults differ between brokers.',
              ]),
            );
          },
        },
        {
          title: 'Gaps: when stops cannot protect you',
          render(el) {
            el.append(
              h('p', null,
                'A ', h('strong', null, 'gap'), ' is a jump between one close and the next open with no trading in between. Earnings reports, economic data, company news and weekend events often cause them, especially in individual stocks.'),
              h('p', null,
                'Example: long at 50 with a sell stop at 48. Earnings come out overnight and the stock opens at 42. Your stop triggers at the open and fills near 42 — a loss of about 4R instead of 1R. A stop-limit at 48/47.50 would not fill at all, leaving you in the trade as it falls.'),
              takeaway([
                'Stops limit losses in continuous trading; they cannot guarantee a price through a gap.',
                'Know the calendar: earnings dates and major data releases are scheduled in advance.',
                'Common choices before a known event: smaller size, no position, or accept the gap risk knowingly.',
              ]),
            );
          },
          quiz: {
            question: 'Long at 50, sell stop at 48. Bad news overnight; the stock opens at 44. What most likely happens?',
            options: [
              { label: 'You are filled at 48 — that is what a stop guarantees', value: 0 },
              { label: 'The stop is cancelled because price skipped it', value: 1 },
              { label: 'The stop triggers at the open and fills near 44', value: 2 },
              { label: 'The broker covers the difference below 48', value: 3 },
            ],
            answer: 2,
            explain: 'Price skipped 48, so the stop triggers on the first trade at or below it — the open — and becomes a market order <strong>near 44</strong>. The planned 1R loss becomes about 3R.',
          },
        },
        {
          title: 'Quick check: pullback buy',
          quiz: {
            question: 'You want to buy only if price pulls back to 98.50. Which order?',
            options: [
              { label: 'Buy market now', value: 0 },
              { label: 'Buy stop at 98.50', value: 1 },
              { label: 'Buy limit at 98.50', value: 2 },
              { label: 'Sell limit at 98.50', value: 3 },
            ],
            answer: 2,
            explain: '<strong>Buy limit at 98.50.</strong> A limit waits for your price or better. A buy stop belongs <em>above</em> the current price (it fires when price rises to it); placed below the market, most brokers would trigger it at once or reject it.',
          },
        },
        {
          title: 'Quick check: protective exit',
          quiz: {
            question: 'You are long from 100 and want out automatically if price falls to 97. Which order?',
            options: [
              { label: 'Sell stop at 97', value: 0 },
              { label: 'Sell limit at 97', value: 1 },
              { label: 'Buy stop at 97', value: 2 },
              { label: 'Buy limit at 97', value: 3 },
            ],
            answer: 0,
            explain: '<strong>Sell stop at 97.</strong> It triggers only if price drops to your level, then sells at the market. A sell limit at 97 means “sell at 97 <em>or better</em>” — with price at 100 it is already marketable and would sell right away, near 100.',
          },
        },
        {
          title: 'Quick check: the spread',
          quiz: {
            question: 'Best bid is 50.00 and best ask is 50.06. You buy with a market order and immediately sell with a market order (no price move). What did the round-trip cost you in spread alone?',
            options: [
              { label: '$0.00 — last price was unchanged', value: 0 },
              { label: '$0.03 per share', value: 1 },
              { label: '$0.06 per share', value: 2 },
              { label: '$0.12 per share', value: 3 },
            ],
            answer: 2,
            explain: 'You buy at the ask (50.06) and sell at the bid (50.00). Round-trip spread cost = <strong>0.06</strong> per share, even if the “last” print never moved.',
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
