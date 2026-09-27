// fibonacci — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { trendSeries } from '../core/data.js';


function fibStory(rng) {
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: 90, direction: 'up', swings: 3 });
  const c = ts.candles;
  const loIdx = 15, hiIdx = 55;
  const lo = c[loIdx].l, hi = c[hiIdx].h;
  const r618 = hi - (hi - lo) * 0.618;
  const r382 = hi - (hi - lo) * 0.382;
  return {
    candles: c,
    frames: [
      { to: hiIdx + 1, caption: 'Mark a clear swing low to swing high — the impulse you care about.',
        overlays: [{ type: 'segment', a: { idx: loIdx, price: lo }, b: { idx: hiIdx, price: hi }, color: 'bull', arrow: true, label: 'Swing' }] },
      { to: hiIdx + 20, title: 'Retracement map.', caption: '38.2% and 61.8% are commonly watched pullback zones — habits, not laws.',
        overlays: [
          { type: 'hline', price: r382, color: 'accent', dashed: true, label: '38.2%' },
          { type: 'hline', price: r618, color: 'accent', dashed: true, label: '61.8%' },
        ] },
      { to: c.length, caption: 'Extensions (1.272, 1.618…) project take-profit ideas beyond the swing. Always pair with structure.' },
    ],
  };
}

const steps = [
  {
    title: 'Ratios traders watch',
    render(el) {
      el.append(
        h('p', null, 'Common retracements: 23.6%, 38.2%, 50%, 61.8%, 78.6%. They are popular because many people place orders there — a self-fulfilling habit, not sacred geometry.'),
        takeaway(['Anchor on a clear completed swing.', 'In an uptrend, measure low → high; pullback levels hang below the high.', 'Confluence with a level or MA beats a lone Fib.']),
      );
    },
  },
  storyStep({ title: 'Anchoring a pullback', story: fibStory }),
  {
    title: 'Quick check',
    quiz: {
      question: 'Swing low 50, swing high 60. Where is the 61.8% retracement?',
      options: [
        { label: '53.82', value: 0 },
        { label: '56.18', value: 1 },
        { label: '55.00', value: 2 },
        { label: '61.80', value: 3 },
      ],
      answer: 0,
      explain: 'Range 10 × 0.618 = 6.18. From the high: 60 − 6.18 = <strong>53.82</strong>. (56.18 is 38.2%.)',
    },
  },
  {
    title: 'Caveats',
    render(el) {
      el.append(takeaway(['Wrong swing = wrong map.', 'Drill in Fib Sniper.', 'Never size up just because a Fib “touches”.']));
    },
  },
];


export default {
  id: 'fibonacci',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'Fibonacci retracements and extensions: anchoring swings, key ratios, and confluence — without mysticism.',
      steps,
    });
    return () => shell.destroy();
  },
};
