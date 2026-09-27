// Stub lesson (indicators) — proves the LessonShell contract; replaced by the full lesson.
import { LessonShell } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';

export default {
  id: 'indicators',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: "Learn what RSI, MACD, Bollinger Bands and volume actually measure, and how divergence warns that a move is tiring.",
      steps: [
        {
          title: 'The big idea',
          render(el) {
            el.append(
              h('p', null, "Momentum indicators compare recent moves with earlier ones. When price keeps going but momentum does not, that gap is called divergence."),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'The full interactive lesson, with animated diagrams and chart examples, is coming soon. Try the quick check, then practise in the game.')),
            );
          },
        },
        {
          title: 'Quick check',
          quiz: {
            question: "Price makes a higher high, but RSI makes a lower high. What is this?",
            options: [
              { label: "Hidden bullish divergence", value: 0 },
              { label: "An instant signal to go short", value: 1 },
              { label: "Bearish divergence", value: 2 },
              { label: "Bullish divergence", value: 3 },
            ],
            answer: 2,
            explain: "<strong>Bearish divergence.</strong> Price pushed higher on weaker momentum. It is a warning, not a trigger — wait for price to confirm, for example with a break of the last higher low.",
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
