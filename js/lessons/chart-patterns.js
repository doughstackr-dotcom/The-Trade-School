// Stub lesson (chart-patterns) — proves the LessonShell contract; replaced by the full lesson.
import { LessonShell } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';

export default {
  id: 'chart-patterns',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: "Recognise the classic reversal and continuation patterns, know where each one is confirmed, and measure a sensible target.",
      steps: [
        {
          title: 'The big idea',
          render(el) {
            el.append(
              h('p', null, "Chart patterns are shapes made by many candles. Each has a trigger line — a neckline or boundary — and nothing is confirmed until price closes beyond it."),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'The full interactive lesson, with animated diagrams and chart examples, is coming soon. Try the quick check, then practise in the game.')),
            );
          },
        },
        {
          title: 'Quick check',
          quiz: {
            question: "When is a head-and-shoulders top confirmed?",
            options: [
              { label: "When the right shoulder rises above the head", value: 0 },
              { label: "When RSI reaches 70", value: 1 },
              { label: "When price closes below the neckline", value: 2 },
              { label: "As soon as the head forms", value: 3 },
            ],
            answer: 2,
            explain: "<strong>On a close below the neckline.</strong> Until then it is just three peaks. The measured target is the head-to-neckline height projected down from the break.",
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
