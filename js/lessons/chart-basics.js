// Stub lesson (chart-basics) — proves the LessonShell contract (with the §12.5 takeaway block);
// replaced by the full lesson.
import { LessonShell, takeaway } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';

export default {
  id: 'chart-basics',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: "Compare line, bar and candlestick charts, switch between linear and log scales, and see how one market looks on a daily versus a weekly chart.",
      steps: [
        {
          title: 'The big idea',
          render(el) {
            el.append(
              h('p', { html: "The same prices can be drawn many ways. A <strong>line chart</strong> joins the closes, a <strong>bar chart</strong> and a <strong>candlestick chart</strong> show open, high, low and close. The <strong>timeframe</strong> decides how much time each candle covers." }),
              takeaway(["Candles show the fight inside each period; lines show only where it ended.", "Log scale shows percentage moves evenly: use it for long, big trends.", "Start on a higher timeframe for context, then zoom in."]),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'The full interactive lesson, with animated charts and real examples, is coming soon. Try the quick check, then practise in the game.')),
            );
          },
        },
        {
          title: 'Quick check',
          quiz: {
            question: "One weekly candle covers the same time as about how many daily candles (for a stock)?",
            options: [
              { label: "7", value: 0 },
              { label: "5", value: 1 },
              { label: "1", value: 2 },
              { label: "52", value: 3 },
            ],
            answer: 1,
            explain: "<strong>About 5.</strong> Stocks trade on weekdays only, so a weekly candle combines roughly five daily candles. Crypto trades every day, so its weekly candle holds seven.",
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
