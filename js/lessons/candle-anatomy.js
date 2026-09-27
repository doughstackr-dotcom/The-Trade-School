// Stub lesson (candle-anatomy) — proves the LessonShell contract; replaced by the full lesson.
import { LessonShell } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';

export default {
  id: 'candle-anatomy',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: "Read any candle at a glance: where it opened, where it closed, and how far buyers and sellers pushed it in between.",
      steps: [
        {
          title: 'The big idea',
          render(el) {
            el.append(
              h('p', null, "Every candle records four prices for its period: the open, high, low and close (OHLC). The body spans open to close; the wicks reach to the high and the low."),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'The full interactive lesson, with animated diagrams and chart examples, is coming soon. Try the quick check, then practise in the game.')),
            );
          },
        },
        {
          title: 'Quick check',
          quiz: {
            question: "A candle opens at 100, trades up to 104, down to 98 and closes at 103. What is it?",
            options: [
              { label: "A doji", value: 0 },
              { label: "A bullish candle with a 6-point body", value: 1 },
              { label: "A bullish candle with a 3-point body", value: 2 },
              { label: "A bearish candle with a 3-point body", value: 3 },
            ],
            answer: 2,
            explain: "<strong>Close (103) is above open (100), so it is bullish.</strong> The body is 103 − 100 = 3. The 6-point figure is the full range (high 104 − low 98), which includes the wicks.",
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
