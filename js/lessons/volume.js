// Stub lesson (volume) — proves the LessonShell contract (with the §12.5 takeaway block);
// replaced by the full lesson.
import { LessonShell, takeaway } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';

export default {
  id: 'volume',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: "Read the volume bars under the chart, tell a confirmed move from a weak one, and spot the climaxes that often mark the end of a move.",
      steps: [
        {
          title: 'The big idea',
          render(el) {
            el.append(
              h('p', { html: "<strong>Volume</strong> counts how much traded in each period. A move on rising volume has many participants behind it. A move on shrinking volume is running on fumes, and a breakout on thin volume is a warning sign." }),
              takeaway(["Healthy trends: volume expands with the trend and contracts on pullbacks.", "A breakout on strong volume is more trustworthy than one on weak volume.", "A huge volume spike after a long move can mark exhaustion, not strength."]),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'The full interactive lesson, with animated charts and real examples, is coming soon. Try the quick check, then practise in the game.')),
            );
          },
        },
        {
          title: 'Quick check',
          quiz: {
            question: "Price breaks above resistance, but volume on the breakout candle is the lowest in two weeks. What does that suggest?",
            options: [
              { label: "A guaranteed rally", value: 0 },
              { label: "Volume does not matter for breakouts", value: 1 },
              { label: "Sellers are panicking", value: 2 },
              { label: "Weak conviction: the break may fail", value: 3 },
            ],
            answer: 3,
            explain: "<strong>Weak conviction.</strong> Few participants joined the breakout, so it has a higher chance of turning into a fakeout. Wait for confirmation.",
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
