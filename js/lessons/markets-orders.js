// Stub lesson (markets-orders) — proves the LessonShell contract (with the §12.5 takeaway block);
// replaced by the full lesson.
import { LessonShell, takeaway } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';

export default {
  id: 'markets-orders',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: "See who is on the other side of every trade, read the bid, the ask and the spread, and choose between market, limit and stop orders.",
      steps: [
        {
          title: 'The big idea',
          render(el) {
            el.append(
              h('p', { html: "A market is a meeting place for buyers and sellers. Buyers post <strong>bids</strong>, sellers post <strong>asks</strong>, and the gap between the best bid and the best ask is the <strong>spread</strong>, a cost you pay every time you cross it." }),
              takeaway(["A <strong>market</strong> order fills now at the best available price (you pay the spread).", "A <strong>limit</strong> order sets your price and waits; it may never fill.", "A <strong>stop</strong> order becomes a market order once price touches your level."]),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'The full interactive lesson, with animated charts and real examples, is coming soon. Try the quick check, then practise in the game.')),
            );
          },
        },
        {
          title: 'Quick check',
          quiz: {
            question: "You want to buy only if price pulls back to 98.50. Which order do you place?",
            options: [
              { label: "Buy market now", value: 0 },
              { label: "Buy stop at 98.50", value: 1 },
              { label: "Buy limit at 98.50", value: 2 },
              { label: "Sell limit at 98.50", value: 3 },
            ],
            answer: 2,
            explain: "<strong>Buy limit at 98.50.</strong> A limit order waits for your price or better. A buy stop at 98.50 would only trigger if price rose to it from below.",
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
