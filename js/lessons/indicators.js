// indicators — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, realExampleStep, compareStep, figure, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';
import { sma, rsi as rsiOf, closes as closesOf } from '../core/indicators.js';
import { simRound } from '../core/scanner.js';

/**
 * A scanner-confirmed bearish RSI divergence in a calm simulated market: meta.a / meta.b are real
 * swing highs (B higher in price, RSI ≥ 4 points lower). ok(round, lowBetween) filters further.
 */
function bearishDivergence(rng, ok = () => true) {
  let first = null;
  for (let t = 0; t < 40; t++) {
    const r = simRound(rng, { kinds: ['bearish-divergence'], before: 90, after: 20 });
    if (!r) continue;
    const { a, b } = r.setup.meta;
    let low = Infinity;
    for (let i = a.idx + 1; i < b.idx; i++) low = Math.min(low, r.candles[i].l);
    const calm = r.outcome.atr / r.candles[r.decisionIdx].c < 0.025;
    if (b.idx - a.idx >= 10 && calm && ok(r, low)) return { ...r, low };
    first = first || { ...r, low };
  }
  return first;
}

/** First close below the low between A and B after B (the structure break), or -1. */
function breakIdx(r) {
  for (let i = r.setup.meta.b.idx + 1; i < r.candles.length; i++) if (r.candles[i].c < r.low) return i;
  return -1;
}

function divStory(rng) {
  const r = bearishDivergence(rng);
  if (!r) return null;
  const c = r.candles;
  const p1 = r.setup.meta.a.idx, p2 = r.setup.meta.b.idx;
  return {
    candles: c,
    indicators: { rsi: true },
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
      { type: 'marker', idx: mark, position: 'below', text: 'RSI < 30', color: 'bear' },
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
    title: 'Momentum contexts',
    kinds: ['bearish-divergence', 'bullish-divergence'],
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
        { label: 'Buy immediately, it must bounce', value: 1 },
        { label: 'Short with no stop', value: 2 },
        { label: 'Delete RSI forever', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Wait.</strong> Markets can stay oversold. Need structure or a confirmed trigger.',
    },
  },
  compareStep({
    title: 'Caveats',
    text: 'Divergence fails often — grade the read, manage risk.',
    left: {
      title: 'Warned, then reversed',
      verdict: 'good',
      tag: 'Useful warn',
      example: (rng) => {
        const r = bearishDivergence(rng, (x, low) => x.outcome.result === 'followed' && breakIdx({ ...x, low }) > 0);
        return {
          candles: r.candles,
          overlays: [
            { type: 'marker', idx: r.setup.meta.a.idx, position: 'above', text: 'A', color: 'accent' },
            { type: 'marker', idx: r.setup.meta.b.idx, position: 'above', text: 'B weaker', color: 'bear' },
            { type: 'marker', idx: breakIdx(r), position: 'below', text: 'Break', color: 'bear' },
          ],
        };
      },
      points: ['Higher high in price', 'Momentum failed to confirm', 'Structure break validated the warning'],
    },
    right: {
      title: 'Warned, trend ran on',
      verdict: 'bad',
      tag: 'Failed fade',
      example: (rng) => {
        // First candle clearly (1 ATR) above B, away from the right edge so its label fits.
        const top = (x) => x.candles.findIndex((k, i) => i > x.setup.meta.b.idx && k.h > x.setup.meta.b.price + x.outcome.atr);
        const r = bearishDivergence(rng, (x, low) => breakIdx({ ...x, low }) < 0 && top(x) > 0 && top(x) < x.candles.length - 6);
        return {
          candles: r.candles,
          overlays: [
            { type: 'marker', idx: r.setup.meta.a.idx, position: 'above', text: 'A', color: 'accent' },
            { type: 'marker', idx: r.setup.meta.b.idx, position: 'above', text: 'B weaker', color: 'bear' },
            { type: 'marker', idx: top(r), position: 'above', text: 'New highs', color: 'bull' },
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
