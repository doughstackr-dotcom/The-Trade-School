// indicators — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, realExampleStep, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { trendSeries } from '../core/data.js';


function divStory(rng) {
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: 100, direction: 'up', swings: 4 });
  const c = ts.candles;
  const p1 = 40, p2 = 75;
  return {
    candles: c,
    frames: [
      { to: p1 + 1, caption: 'Price makes a swing high. Momentum (e.g. RSI) is strong.',
        overlays: [{ type: 'marker', idx: p1, position: 'above', text: 'High A', color: 'accent' }] },
      { to: p2 + 1, title: 'Higher high, weaker thrust.', caption: 'Price makes a higher high while momentum fails to confirm — classic bearish divergence setup.',
        overlays: [
          { type: 'marker', idx: p1, position: 'above', text: 'High A', color: 'accent' },
          { type: 'marker', idx: p2, position: 'above', text: 'High B', color: 'bear' },
        ] },
      { to: c.length, caption: 'Divergence can persist in strong trends. Treat it as a warning, wait for structure to break.' },
    ],
  };
}

const steps = [
  {
    title: 'Indicators are math on price',
    render(el) {
      el.append(
        h('p', null, 'RSI measures relative strength of recent closes. MACD tracks EMA distance and its signal line. Bollinger Bands wrap a moving average with volatility bands.'),
        takeaway(['They cannot see the future — only transform the past.', 'Overbought can stay overbought in trends.', 'Use fewer indicators well rather than many poorly.']),
      );
    },
  },
  storyStep({ title: 'Divergence idea', story: divStory }),
  realExampleStep({
    title: 'Momentum contexts',
    kinds: ['rsi-divergence-bear', 'rsi-divergence-bull', 'macd-cross-up', 'macd-cross-down'],
    intervals: ['1d'],
    caption: 'Scanner labels are a starting point. Confirm with your own eyes.',
  }),
  {
    title: 'Quick check',
    quiz: {
      question: 'Strong downtrend, RSI at 25, no reversal pattern yet. Best action?',
      options: [
        { label: 'Wait — oversold is a condition, not a buy signal', value: 0 },
        { label: 'Buy immediately, it must bounce', value: 1 },
        { label: 'Short with no stop', value: 2 },
        { label: 'Delete RSI forever', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Wait.</strong> Markets can stay oversold. Need structure or a confirmed trigger.',
    },
  },
  {
    title: 'Caveats',
    render(el) {
      el.append(takeaway(['Divergence fails often — grade the read, manage risk.', 'Practice in Divergence Detective.']));
    },
  },
];


export default {
  id: 'indicators',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'RSI, MACD, Bollinger Bands and divergence: tools that summarise price — and how they fail in strong trends.',
      steps,
    });
    return () => shell.destroy();
  },
};
