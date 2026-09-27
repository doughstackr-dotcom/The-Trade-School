// multi-timeframe — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { trendSeries } from '../core/data.js';


function mtfStory(rng) {
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: 100, direction: 'up', swings: 4 });
  const c = ts.candles;
  return {
    candles: c,
    frames: [
      { to: 40, caption: 'Higher timeframe (think weekly/daily): clear higher highs and higher lows — bullish bias.' },
      { to: 70, title: 'Pullback.', caption: 'On the lower timeframe you wait for a pullback into support / MA / Fib — not a chase of the high.',
        overlays: [{ type: 'marker', idx: 65, position: 'below', text: 'Trigger zone', color: 'accent' }] },
      { to: c.length, caption: 'Align HTF bias with LTF trigger. If they conflict, stand aside or shrink size.' },
    ],
  };
}

const steps = [
  {
    title: 'Top down',
    render(el) {
      el.append(
        h('p', null, 'Decide direction on a ', h('strong', null, 'higher timeframe'), ', refine location on an intermediate one, and time entry on a ', h('strong', null, 'lower timeframe'), '.'),
        takeaway(['HTF bias first.', 'Do not invent a short on LTF against a strong HTF uptrend without a clear HTF break.', 'Same market, different questions per clock.']),
      );
    },
  },
  storyStep({ title: 'Bias then trigger', story: mtfStory }),
  {
    title: 'Quick check',
    quiz: {
      question: 'Weekly chart is a clean uptrend; 5-minute chart looks toppy. Best default?',
      options: [
        { label: 'Favour pullback longs or wait — respect the weekly bias', value: 0 },
        { label: 'Short aggressively with huge size', value: 1 },
        { label: 'Ignore the weekly completely', value: 2 },
        { label: 'Only trade the 5-minute forever', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Respect HTF.</strong> A toppy LTF often is just a pullback in a larger uptrend.',
    },
  },
  {
    title: 'Caveats',
    render(el) {
      el.append(takeaway(['Too many timeframes = analysis paralysis.', 'Practice stacking in Timeframe Stack.']));
    },
  },
];


export default {
  id: 'multi-timeframe',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'Top-down analysis: higher-timeframe bias, lower-timeframe trigger, and avoiding timeframe conflict.',
      steps,
    });
    return () => shell.destroy();
  },
};
