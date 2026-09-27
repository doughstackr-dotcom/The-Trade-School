// Markets, orders and the spread — how trades actually fill.
import { LessonShell, storyStep, figure, takeaway } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';

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

export default {
  id: 'markets-orders',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'Every fill has two sides. Learn the bid, the ask, the spread, and when to use market, limit and stop orders.',
      steps: [
        {
          title: 'Who is on the other side?',
          render(el) {
            const ts = trendSeries({ seed: 42, count: 40, direction: 'range', swings: 2 });
            el.append(
              h('p', null, 'A market is a meeting place. Buyers post ', h('strong', null, 'bids'), '; sellers post ', h('strong', null, 'asks'), '. Trades happen when someone crosses the gap.'),
              figure(
                miniChart(ts.candles, { width: 640, height: 200, yPad: 0.14, ariaLabel: 'Quiet range chart representing two-sided trading' }),
                'Quiet tape: bids and asks keep updating even when the candle barely moves.',
                { label: 'Figure 1' },
              ),
              takeaway([
                'You always trade with someone on the other side — not "the market" as a monolith.',
                'The <strong>spread</strong> (ask − bid) is a cost every time you cross it.',
                'Liquidity = how much size sits near the best bid and ask.',
              ]),
            );
          },
        },
        storyStep({
          title: 'Bid, ask and a market fill',
          text: 'Watch how a market order crosses the spread. Limits and stops behave differently.',
          story: tapeStory,
        }),
        {
          title: 'Three order types',
          render(el) {
            el.append(
              h('p', null, 'Pick the tool that matches your intent: speed, price, or a trigger.'),
              h('ul', { class: 'lesson-list' },
                h('li', null, h('strong', null, 'Market'), ' — fill now at the best available price. Guarantees a fill, not a price.'),
                h('li', null, h('strong', null, 'Limit'), ' — fill at your price or better, or not at all. Guarantees a price, not a fill.'),
                h('li', null, h('strong', null, 'Stop'), ' — sleeps until price trades through your level, then becomes a market order. Used for breakouts and stop-losses.'),
              ),
              takeaway([
                'Buy stop sits above price; buy limit sits at or below.',
                'Sell stop (stop-loss for longs) sits below; sell limit sits at or above.',
                'A triggered stop can slip in a fast or gapping market.',
              ]),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'Educational only: real venues add time-in-force, partial fills and fees. Start by mastering these three.')),
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
            explain: '<strong>Buy limit at 98.50.</strong> A limit waits for your price or better. A buy stop at 98.50 would only fire if price rose up to it.',
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
            explain: '<strong>Sell stop at 97.</strong> It triggers only if price drops to your level, then sells at the market. A sell limit at 97 would sit below and might never fill on the way down.',
          },
        },
        {
          title: 'Honest caveats',
          render(el) {
            el.append(
              h('p', null, 'Orders do not remove risk. Spreads widen, books thin out, and gaps skip your stop price.'),
              takeaway([
                'Size positions so a full stop-out is a planned, affordable loss.',
                'In thin names, prefer limits when you can wait; use markets when timing matters more than a few ticks.',
                'Practise order choice in Order Desk before you risk real money.',
              ]),
            );
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
