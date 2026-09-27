// Stub lesson (moving-averages) — proves the LessonShell contract; replaced by the full lesson.
import { LessonShell } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';

export default {
  id: 'moving-averages',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: "Use moving averages to read direction, find dynamic support and understand what crossovers do and do not tell you.",
      steps: [
        {
          title: 'The big idea',
          render(el) {
            el.append(
              h('p', null, "A moving average is the average close over the last N candles, recalculated each bar. It smooths noise, and its slope shows the trend — but it always lags price."),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'The full interactive lesson, with animated diagrams and chart examples, is coming soon. Try the quick check, then practise in the game.')),
            );
          },
        },
        {
          title: 'Quick check',
          quiz: {
            question: "The 50-period moving average crosses above the 200-period moving average. What is this called?",
            options: [
              { label: "Death cross", value: 0 },
              { label: "Bullish divergence", value: 1 },
              { label: "A breakout", value: 2 },
              { label: "Golden cross", value: 3 },
            ],
            answer: 3,
            explain: "<strong>A golden cross.</strong> It is bullish but lagging: by the time it prints, much of the move has usually happened. The opposite (fast crossing below slow) is a death cross.",
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
