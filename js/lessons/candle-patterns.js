// Stub lesson (candle-patterns) — proves the LessonShell contract; replaced by the full lesson.
import { LessonShell } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';

export default {
  id: 'candle-patterns',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: "Spot the one-, two- and three-candle patterns that hint at a turn — and learn why the same shape can mean different things in different places.",
      steps: [
        {
          title: 'The big idea',
          render(el) {
            el.append(
              h('p', null, "Candlestick patterns summarise a shift in control between buyers and sellers. Context matters: a hammer after a decline is a potential bottom; the same shape after a rally is a hanging man."),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'The full interactive lesson, with animated diagrams and chart examples, is coming soon. Try the quick check, then practise in the game.')),
            );
          },
        },
        {
          title: 'Quick check',
          quiz: {
            question: "After a downtrend, a candle has a small body near its high and a lower wick three times the size of the body. What is it?",
            options: [
              { label: "Shooting star", value: 0 },
              { label: "Hanging man", value: 1 },
              { label: "Bearish engulfing", value: 2 },
              { label: "Hammer", value: 3 },
            ],
            answer: 3,
            explain: "<strong>A hammer.</strong> Sellers drove price down, buyers pushed it back up to close near the high. The same shape after an <em>uptrend</em> is called a hanging man. Either way, wait for the next candle to confirm.",
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
