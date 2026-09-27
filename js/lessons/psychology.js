// Stub lesson (psychology) — proves the LessonShell contract (with the §12.5 takeaway block);
// replaced by the full lesson.
import { LessonShell, takeaway } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';

export default {
  id: 'psychology',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: "Recognise fear, greed, revenge trading and tilt in yourself, and write a trading plan and checklist that protect you from your worst trading days.",
      steps: [
        {
          title: 'The big idea',
          render(el) {
            el.append(
              h('p', { html: "Most losses that really hurt do not come from bad setups but from <strong>bad decisions</strong>: moving a stop, doubling down, trading to win back a loss. A written <strong>plan</strong> decides in advance, when you are calm, what you will do when you are not." }),
              takeaway(["Judge a trade by whether you followed your plan, not by whether it won.", "After a loss, pause. Revenge trading turns one loss into several.", "Keep a journal: your patterns show up in your own data."]),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'The full interactive lesson, with animated charts and real examples, is coming soon. Try the quick check, then practise in the game.')),
            );
          },
        },
        {
          title: 'Quick check',
          quiz: {
            question: "You just took two losses in a row, both inside your plan. What is the best next step?",
            options: [
              { label: "Double the size to win it back", value: 0 },
              { label: "Move your stops wider on the next trade", value: 1 },
              { label: "Keep following the plan (and your daily loss limit)", value: 2 },
              { label: "Skip your checklist to trade faster", value: 3 },
            ],
            answer: 2,
            explain: "<strong>Stick to the plan.</strong> Losses inside the plan are a cost of doing business. Increasing size or loosening rules after losses is how tilt starts.",
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
