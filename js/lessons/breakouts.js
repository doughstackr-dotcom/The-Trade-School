// Stub lesson (breakouts) — proves the LessonShell contract (with the §12.5 takeaway block);
// replaced by the full lesson.
import { LessonShell, takeaway } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';

export default {
  id: 'breakouts',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: "Learn why levels break, why so many first breaks fail, where the stop orders sit that fuel both, and the three ways to play a break: trade it, fade it, or wait for the retest.",
      steps: [
        {
          title: 'The big idea',
          render(el) {
            el.append(
              h('p', { html: "Obvious levels collect <strong>stop orders</strong> just beyond them. When price pokes through, those stops fill and add fuel. If no real buyers follow, price snaps back inside: a <strong>fakeout</strong> (or liquidity grab) that traps the late breakout traders." }),
              takeaway(["Confirmation: a close beyond the level, ideally on strong volume.", "A failed break that closes back inside the range is a signal in the other direction.", "The retest of the broken level offers a better-defined entry and stop."]),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'The full interactive lesson, with animated charts and real examples, is coming soon. Try the quick check, then practise in the game.')),
            );
          },
        },
        {
          title: 'Quick check',
          quiz: {
            question: "Price closes above resistance, then the next candle closes back below it on heavy volume. What is this?",
            options: [
              { label: "A confirmed breakout", value: 0 },
              { label: "A failed breakout (fakeout)", value: 1 },
              { label: "A retest that held", value: 2 },
              { label: "A golden cross", value: 3 },
            ],
            answer: 1,
            explain: "<strong>A fakeout.</strong> The close back inside the range traps the breakout buyers, whose stops below now become fuel for a move down.",
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
