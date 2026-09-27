// Stub lesson (multi-timeframe) — proves the LessonShell contract; replaced by the full lesson.
import { LessonShell } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';

export default {
  id: 'multi-timeframe',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: "Read the higher timeframe for direction, the middle one for the setup and the lower one for timing — and act when they agree.",
      steps: [
        {
          title: 'The big idea',
          render(el) {
            el.append(
              h('p', null, "The same market can trend up on the weekly chart and chop sideways on the hourly. Top-down analysis starts big and zooms in."),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'The full interactive lesson, with animated diagrams and chart examples, is coming soon. Try the quick check, then practise in the game.')),
            );
          },
        },
        {
          title: 'Quick check',
          quiz: {
            question: "The weekly chart is in a strong uptrend and the daily chart has pulled back to support. What is the higher-probability idea?",
            options: [
              { label: "Go short because the daily is falling", value: 0 },
              { label: "Ignore the weekly chart", value: 1 },
              { label: "Buy and sell at the same time", value: 2 },
              { label: "Look for a long entry on a lower timeframe", value: 3 },
            ],
            answer: 3,
            explain: "<strong>Look for a long.</strong> The pullback is against a strong higher-timeframe trend, so a bullish trigger at support on the hourly chart trades <em>with</em> the bigger picture.",
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
