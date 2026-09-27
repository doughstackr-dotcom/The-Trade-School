// Stub lesson (support-resistance) — proves the LessonShell contract; replaced by the full lesson.
import { LessonShell } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';

export default {
  id: 'support-resistance',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: "Find the prices where the market keeps turning, draw them as zones, and know what to expect when a level breaks.",
      steps: [
        {
          title: 'The big idea',
          render(el) {
            el.append(
              h('p', null, "Support is where buying has repeatedly stopped a fall; resistance is where selling has repeatedly stopped a rise. Draw them as zones through the reactions, not razor-thin lines."),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'The full interactive lesson, with animated diagrams and chart examples, is coming soon. Try the quick check, then practise in the game.')),
            );
          },
        },
        {
          title: 'Quick check',
          quiz: {
            question: "Resistance at 105 breaks and price closes at 107. When price returns to 105, what is that level most likely to act as?",
            options: [
              { label: "Nothing — broken levels stop mattering", value: 0 },
              { label: "A profit target for shorts", value: 1 },
              { label: "Support — role reversal", value: 2 },
              { label: "Resistance again", value: 3 },
            ],
            answer: 2,
            explain: "<strong>Support.</strong> Broken resistance often flips into support (role reversal): traders who missed the breakout buy the retest. It is a tendency, not a guarantee.",
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
