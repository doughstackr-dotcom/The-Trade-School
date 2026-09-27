// Stub lesson (confluence-risk) — proves the LessonShell contract; replaced by the full lesson.
import { LessonShell } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';

export default {
  id: 'confluence-risk',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: "Stack reasons for a trade, time the entry, and size every position so a single loss never hurts much.",
      steps: [
        {
          title: 'The big idea',
          render(el) {
            el.append(
              h('p', null, "Position size comes from your stop: risk amount ÷ distance from entry to stop. That keeps every loss to a fixed slice of the account."),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'The full interactive lesson, with animated diagrams and chart examples, is coming soon. Try the quick check, then practise in the game.')),
            );
          },
        },
        {
          title: 'Quick check',
          quiz: {
            question: "Account $10,000, risk 1% per trade. Entry at 50.00 with a stop at 48.00. How many shares?",
            options: [
              { label: "100 shares", value: 0 },
              { label: "200 shares", value: 1 },
              { label: "20 shares", value: 2 },
              { label: "50 shares", value: 3 },
            ],
            answer: 3,
            explain: "<strong>50 shares.</strong> 1% of $10,000 is $100. The stop is $2 away, so $100 ÷ $2 = 50 shares. If the stop is hit you lose $100 — exactly 1R.",
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
