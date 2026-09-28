// chart-basics — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, figure, takeaway } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';


function tfStory(rng) {
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: 90, direction: 'up', swings: 4 });
  const candles = ts.candles;
  const mid = 50;
  return {
    candles,
    frames: [
      { to: 30, caption: 'On a short timeframe every wiggle looks important. Zoom out before you decide the trend.' },
      { to: mid, title: 'Same market, more context.', caption: 'Higher highs and higher lows appear once you see enough structure.', focus: [10, mid], zoom: true },
      { to: candles.length, caption: 'Pick a timeframe that matches your holding period. Day traders and investors can both be right on different clocks.' },
    ],
  };
}

const steps = [
  {
    title: 'Chart types',
    render(el) {
      const ts = trendSeries({ seed: 21, count: 48, direction: 'up', swings: 3 });
      el.append(
        h('p', null, 'Most traders here use ', h('strong', null, 'candlesticks'), ': each period shows open, high, low and close. Line charts show closes only; OHLC bars show the same four prices without colour fills.'),
        figure(
          miniChart(ts.candles, { width: 640, height: 200, yPad: 0.12, ariaLabel: 'Uptrend candlestick chart' }),
          'Candles pack OHLC into a shape you can scan quickly. The story is still the same four numbers.',
          { label: 'Figure 1' },
        ),
        takeaway([
          'Candles = OHLC with a body and wicks.',
          'Line charts hide intra-period extremes — fine for big-picture trend, weak for wick rejection.',
          'Never mix timeframes without labelling them.',
        ]),
      );
    },
  },
  storyStep({
    title: 'Timeframe changes the read',
    text: 'A noisy 5-minute chart can be a clean daily uptrend. Context first.',
    story: tfStory,
  }),
  {
    title: 'Linear vs log scale',
    render(el) {
      el.append(
        h('p', null, 'Linear scale treats a $10 move the same everywhere. Log scale treats equal ', h('em', null, 'percent'), ' moves as equal distance — useful for multi-year or high-growth charts.'),
        takeaway([
          'Use linear for short-term price action near current levels.',
          'Use log when comparing large percentage moves across years.',
          'Trend lines drawn on the wrong scale can look “broken” when they are not.',
        ]),
        h('div', { class: 'callout callout--tip' }, icon('info'),
          h('p', null, 'This school’s charts are linear by default. When you move to a platform, check the scale toggle before drawing.')),
      );
    },
  },
  {
    title: 'Quick check',
    quiz: {
      question: 'You swing-trade for days to weeks. Which primary chart is usually most appropriate?',
      options: [
        { label: 'Daily (with a higher timeframe weekly for bias)', value: 0 },
        { label: '1-minute — more candles give more precise entries', value: 1 },
        { label: 'Monthly only — a longer timeframe is always more reliable', value: 2 },
        { label: 'Whichever timeframe shows the pattern you are hoping for', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Daily with a weekly bias</strong> matches multi-day holds. 1-minute charts add noise for that horizon, monthly candles hide the swings you trade, and hunting for the timeframe that agrees with you is confirmation bias.',
    },
  },
  {
    title: 'Quick check: log scale',
    quiz: {
      question: 'A stock climbed from $10 to $100 over several years. On which scale does the move from 10→20 look the same size as the move from 50→100?',
      options: [
        { label: 'Linear scale', value: 0 },
        { label: 'Log scale', value: 1 },
        { label: 'Both scales', value: 2 },
        { label: 'Neither — only candlestick charts show that', value: 3 },
      ],
      answer: 1,
      explain: 'Both moves are +100%. A <strong>log scale</strong> spaces equal percentage moves equally; a linear scale spaces equal dollar moves equally, so 10→20 looks tiny next to 50→100.',
    },
  },
  {
    title: 'Honest caveats',
    render(el) {
      el.append(
        takeaway([
          'Chart type does not create edge — it only displays price.',
          'Changing timeframe mid-trade to “make the chart look better” is a common bias.',
          'Next: candlestick patterns — still just OHLC, with names.',
        ]),
      );
    },
  },
];


export default {
  id: 'chart-basics',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'Line, bar and candle charts; linear vs log scale; and why the timeframe you pick changes the story.',
      steps,
    });
    return () => shell.destroy();
  },
};
