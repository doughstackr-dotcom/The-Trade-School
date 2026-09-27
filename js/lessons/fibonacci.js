// Stub lesson (fibonacci) — proves the LessonShell contract; replaced by the full lesson.
import { LessonShell } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';

export default {
  id: 'fibonacci',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: "Anchor the Fibonacci tool on a clean swing, watch the 38.2–61.8% zone for pullbacks, and project extension targets.",
      steps: [
        {
          title: 'The big idea',
          render(el) {
            el.append(
              h('p', null, "Fibonacci retracement levels divide a completed swing at 23.6%, 38.2%, 50%, 61.8% and 78.6%. Pullbacks in a healthy trend often pause in the 38.2–61.8% area."),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'The full interactive lesson, with animated diagrams and chart examples, is coming soon. Try the quick check, then practise in the game.')),
            );
          },
        },
        {
          title: 'Quick check',
          quiz: {
            question: "An uptrend swing runs from 100 up to 110. Where is the 50% retracement?",
            options: [
              { label: "110.00", value: 0 },
              { label: "105.00", value: 1 },
              { label: "106.18", value: 2 },
              { label: "103.82", value: 3 },
            ],
            answer: 1,
            explain: "<strong>105.00</strong> — halfway back down the 10-point swing. 106.18 is the 38.2% level (110 − 3.82) and 103.82 is the 61.8% level (110 − 6.18).",
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
