// indicators — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, realExampleStep, compareStep, figure, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';
import { sma, rsi as rsiOf, closes as closesOf } from '../core/indicators.js';


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

function maRibbonChart(seed = 4) {
  const ts = trendSeries({ seed, count: 80, direction: 'up', swings: 3 });
  const closes = closesOf(ts.candles);
  return miniChart(ts.candles, {
    width: 640, height: 200, yPad: 0.12,
    ariaLabel: 'Price with moving averages',
    overlays: [
      { type: 'series', values: sma(closes, 10), color: 'ma1', label: 'MA 10' },
      { type: 'series', values: sma(closes, 30), color: 'ma2', label: 'MA 30' },
    ],
  });
}

function oversoldDowntrendChart() {
  const ts = trendSeries({ seed: 17, count: 70, direction: 'down', swings: 3 });
  const closes = closesOf(ts.candles);
  const r = rsiOf(closes, 14);
  let mark = 50;
  for (let i = 20; i < r.length; i++) {
    if (r[i] != null && r[i] < 30) { mark = i; break; }
  }
  return miniChart(ts.candles, {
    width: 640, height: 190, yPad: 0.14,
    ariaLabel: 'Downtrend with oversold RSI condition',
    overlays: [
      { type: 'series', values: sma(closes, 20), color: 'ma2' },
      { type: 'marker', idx: mark, position: 'below', text: 'RSI ~25', color: 'bear' },
      { type: 'marker', idx: ts.candles.length - 1, position: 'above', text: 'Still falling', color: 'accent' },
    ],
  });
}

const steps = [
  {
    title: 'Indicators are math on price',
    render(el) {
      el.append(
        h('p', null, 'RSI measures relative strength of recent closes. MACD tracks EMA distance and its signal line. Bollinger Bands wrap a moving average with volatility bands.'),
        figure(
          maRibbonChart(),
          'Moving averages (and RSI / MACD / bands) only transform past closes — they cannot see the future.',
          { label: 'Figure 1' },
        ),
        takeaway(['They cannot see the future — only transform the past.', 'Overbought can stay overbought in trends.', 'Use fewer indicators well rather than many poorly.']),
      );
    },
  },
  storyStep({ title: 'Divergence idea', story: divStory }),
  realExampleStep({
    title: 'Divergence & cross contexts',
    // Must be scanner SETUP_KIND_IDS (js/core/scanner.js).
    kinds: ['bearish-divergence', 'bullish-divergence', 'golden-cross', 'death-cross'],
    intervals: ['1d'],
    caption: 'Scanner labels are a starting point. Confirm with your own eyes.',
  }),
  {
    title: 'Quick check',
    render(el) {
      el.append(
        figure(
          oversoldDowntrendChart(),
          'Strong downtrend, RSI near 25 — a <em>condition</em>, not a buy signal until structure turns.',
          { label: 'Figure' },
        ),
      );
    },
    quiz: {
      question: 'Strong downtrend, RSI at 25, no reversal pattern yet. Best action?',
      options: [
        { label: 'Wait — oversold is a condition, not a buy signal', value: 0 },
        { label: 'Buy now — below 30 means the selling is exhausted', value: 1 },
        { label: 'Buy now with a smaller size and no stop, since RSI will recover', value: 2 },
        { label: 'Switch RSI to a shorter period until it shows a buy signal', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Wait.</strong> Markets can stay oversold for a long time in strong trends. Look for structure (a higher low, a reclaimed level) or a confirmed trigger — and tuning settings until they agree with you is not confirmation.',
    },
  },
  {
    title: 'Quick check: divergence',
    quiz: {
      question: 'Price makes a higher high, RSI makes a lower high. What is the most accurate read?',
      options: [
        { label: 'Short now — bearish divergence means the top is in', value: 0 },
        { label: 'Momentum is fading: a warning to tighten risk or wait for structure to break', value: 1 },
        { label: 'Bullish — a higher high in price always overrides the indicator', value: 2 },
        { label: 'Nothing — divergence only counts on the weekly chart', value: 3 },
      ],
      answer: 1,
      explain: 'This is <strong>bearish divergence</strong>: the push higher had less momentum. It is a warning, not a timing signal — strong trends can show divergence several times before turning.',
    },
  },
  compareStep({
    title: 'Caveats',
    text: 'Divergence fails often — grade the read, manage risk.',
    left: {
      title: 'Warned, then reversed',
      verdict: 'good',
      tag: 'Useful warn',
      example: () => {
        const ts = trendSeries({ seed: 22, count: 90, direction: 'up', swings: 4 });
        return {
          candles: ts.candles,
          overlays: [
            { type: 'marker', idx: 42, position: 'above', text: 'A', color: 'accent' },
            { type: 'marker', idx: 68, position: 'above', text: 'B weaker', color: 'bear' },
            { type: 'marker', idx: 78, position: 'below', text: 'Break', color: 'bear' },
          ],
        };
      },
      points: ['Higher high in price', 'Momentum failed to confirm', 'Structure break validated the warning'],
    },
    right: {
      title: 'Warned, trend ran on',
      verdict: 'bad',
      tag: 'Failed fade',
      example: () => {
        const ts = trendSeries({ seed: 9, count: 90, direction: 'up', swings: 3 });
        return {
          candles: ts.candles,
          overlays: [
            { type: 'marker', idx: 35, position: 'above', text: 'A', color: 'accent' },
            { type: 'marker', idx: 55, position: 'above', text: 'B weaker', color: 'bear' },
            { type: 'marker', idx: 85, position: 'above', text: 'New highs', color: 'bull' },
          ],
        };
      },
      points: ['Same divergence shape', 'No structure break', 'Fading early got run over'],
    },
    after: () => takeaway(['Divergence fails often — grade the read, manage risk.', 'Practice in Divergence Detective.']),
  }),
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
