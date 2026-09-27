// Stub lesson (trends) — proves the LessonShell contract; replaced by the full lesson.
import { LessonShell } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';

export default {
  id: 'trends',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: "Label swing highs and lows, read the trend from market structure alone, and spot the moment a trend starts to break.",
      steps: [
        {
          title: 'The big idea',
          render(el) {
            el.append(
              h('p', null, "An uptrend is a staircase of higher highs (HH) and higher lows (HL). A downtrend makes lower highs (LH) and lower lows (LL). Anything else is a range."),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'The full interactive lesson, with animated diagrams and chart examples, is coming soon. Try the quick check, then practise in the game.')),
            );
          },
        },
        {
          title: 'Quick check',
          quiz: {
            question: "A chart prints these swings in order: HL, HH, HL, HH. What is the trend?",
            options: [
              { label: "Sideways range", value: 0 },
              { label: "Not enough information", value: 1 },
              { label: "Uptrend", value: 2 },
              { label: "Downtrend", value: 3 },
            ],
            answer: 2,
            explain: "<strong>Uptrend.</strong> Both the highs and the lows keep stepping higher. The trend stays intact until price makes a lower low.",
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
