// Stub lesson (trendlines) — proves the LessonShell contract; replaced by the full lesson.
import { LessonShell } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';

export default {
  id: 'trendlines',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: "Draw clean trend lines and channels, and read what it means when price breaks one.",
      steps: [
        {
          title: 'The big idea',
          render(el) {
            el.append(
              h('p', null, "In an uptrend, a trend line connects rising swing lows; in a downtrend it connects falling swing highs. Two touches draw it, a third that holds makes it meaningful."),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'The full interactive lesson, with animated diagrams and chart examples, is coming soon. Try the quick check, then practise in the game.')),
            );
          },
        },
        {
          title: 'Quick check',
          quiz: {
            question: "In an uptrend, which points do you connect to draw the trend line?",
            options: [
              { label: "Every closing price", value: 0 },
              { label: "The highest and lowest candles on the chart", value: 1 },
              { label: "The rising swing lows", value: 2 },
              { label: "The swing highs", value: 3 },
            ],
            answer: 2,
            explain: "<strong>The swing lows.</strong> An uptrend line sits underneath price, joining the higher lows. It should touch the lows without slicing through candle bodies.",
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
