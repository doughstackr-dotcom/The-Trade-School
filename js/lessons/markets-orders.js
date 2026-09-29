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
                h('strong', null, 'exchange'), ' (or liquidity venue) is where resting orders live in the book. On an exchange you trade against another participant, not the broker (retail stock orders are often filled by a wholesale market maker). With CFDs, spread bets, most retail FX and binary options, the broker itself is usually on the other side of your trade.'),
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
                h('p', null, 'Educational only: real venues add time-in-force, partial fills and fees. Practise order choice in Order Desk before you risk real money.')),
            );
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
            explain: '<strong>Buy limit at 98.50.</strong> A limit waits for your price or better. A buy stop belongs above the market: at 98.50, with price above it, it would trigger at once (or be rejected) and buy now at the market.',
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
            explain: '<strong>Sell stop at 97.</strong> It triggers only if price drops to your level, then sells at the market. A sell limit at 97 is below the current price, so it would fill at once at about 100: you would exit now, not only if price fell.',
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
