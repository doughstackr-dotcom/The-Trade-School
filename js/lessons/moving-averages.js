// moving-averages — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, figure, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';
import { sma, ema, closes as closesOf } from '../core/indicators.js';

/** SMA 20 vs EMA 20 on a choppy series: the EMA turns sooner, the SMA is smoother. */
function smaEmaFigure() {
  const ts = trendSeries({ seed: 12, count: 90, direction: 'range', swings: 3, strength: 1.6 });
  const closes = closesOf(ts.candles);
  return miniChart(ts.candles, {
    width: 640, height: 200, yPad: 0.12,
    ariaLabel: 'Price with a 20-period SMA and a 20-period EMA',
    overlays: [
      { type: 'series', values: sma(closes, 20), color: 'ma2', label: 'SMA 20' },
      { type: 'series', values: ema(closes, 20), color: 'ma1', label: 'EMA 20' },
    ],
  });
}

/** Uptrend with a rising 20 SMA; marks pullbacks that tagged the average and closed back above. */
function dynamicSupportFigure() {
  const ts = trendSeries({ seed: 3, count: 100, direction: 'up', swings: 4 });
  const c = ts.candles;
  const m = sma(closesOf(c), 20);
  const touches = [];
  for (let i = 25; i < c.length && touches.length < 3; i++) {
    if (m[i] && c[i].l <= m[i] * 1.003 && c[i].c > m[i] && c[i - 1].l > m[i - 1] * 1.003) touches.push(i);
  }
  const closesBelow = c.filter((k, i) => m[i] && k.c < m[i]).length;
  return {
    closesBelow,
    chart: miniChart(c, {
      width: 640, height: 200, yPad: 0.12,
      ariaLabel: 'Uptrend where pullbacks react near a rising 20-period moving average',
      overlays: [
        { type: 'series', values: m, color: 'ma2', label: 'SMA 20' },
        ...touches.map((idx) => ({ type: 'marker', idx, position: 'below', text: 'Tag', color: 'bull' })),
      ],
    }),
  };
}


function maStory(rng) {
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: 120, direction: 'up', swings: 3 });
  const c = ts.candles;
  const mid = 70;
  return {
    candles: c,
    frames: [
      { to: 40, caption: 'Price chops. A moving average will look messy here — MAs lag by design.' },
      { to: mid, title: 'Trend ride.', caption: 'In a steady advance, price often stays on one side of a medium MA (e.g. 20/50).',
        overlays: [{ type: 'marker', idx: mid - 1, position: 'below', text: 'Above MA', color: 'bull' }] },
      { to: c.length, caption: 'Crosses of slow MAs (50/200) are rare and lagging. Use them as context, not a crystal ball.' },
    ],
  };
}

const steps = [
  {
    title: 'What an MA is',
    render(el) {
      el.append(
        h('p', { html: 'A <strong>simple moving average (SMA)</strong> averages the last N closes equally. An <strong>EMA</strong> weights recent closes more — it reacts faster and whipsaws more.' }),
        takeaway(['MAs describe the past average — they lag.', 'Common lengths: 20, 50, 200 (habits, not magic).', 'Price above a rising MA ≠ guaranteed long.']),
      );
    },
  },
  {
    title: 'SMA vs EMA: the lag trade-off',
    render(el) {
      el.append(
        h('p', null, 'Same length, different weighting. A 20-period SMA gives each of the last 20 closes 1/20 of the weight. A 20-period EMA gives the newest close the most weight and older closes less and less.'),
        figure(smaEmaFigure(),
          '<strong>Blue</strong> = EMA 20, <strong>green</strong> = SMA 20. When price turns, the EMA (hugging price) bends first; the SMA follows a few candles later. Faster turns also mean more false turns in chop.',
          { label: 'Figure 1' }),
        takeaway([
          'EMA: less lag, more whipsaw. SMA: smoother, later.',
          'Shorter length = faster and noisier; longer length = slower and steadier.',
          'Neither is “better” — pick one, understand its lag, and stay consistent.',
        ]),
      );
    },
    quiz: {
      question: 'Price reverses sharply after a long rise. Which usually turns down first?',
      options: [
        { label: 'The 200-period SMA', value: 0 },
        { label: 'The 20-period SMA', value: 1 },
        { label: 'The 20-period EMA', value: 2 },
        { label: 'They all turn at the same candle', value: 3 },
      ],
      answer: 2,
      explain: 'The <strong>20 EMA</strong> weights the newest closes most, so it reacts first. The 20 SMA follows; the 200 SMA can take weeks to roll over.',
    },
  },
  storyStep({ title: 'MA as a trend filter', story: maStory }),
  {
    title: 'Dynamic support and resistance',
    render(el) {
      const f = dynamicSupportFigure();
      el.append(
        h('p', null, 'In a steady trend, pullbacks often stall near a widely watched average (20, 50 or 200). Because the average moves with price, traders call it ', h('strong', null, 'dynamic'), ' support (or resistance in a downtrend).'),
        figure(f.chart,
          `Green line = 20 SMA. Pullbacks tagged the rising average and closed back above it. Yet in this same chart ${f.closesBelow} candles closed below the average — it is a zone, not a wall.`,
          { label: 'Figure 2' }),
        takeaway([
          'Treat the MA as an area where a reaction is <em>more likely</em>, not a price that must hold.',
          'It works best in clean trends; in ranges price slices through it back and forth.',
          'Put stops beyond structure (the swing low), not a few cents under the line.',
        ]),
      );
    },
  },
  {
    title: 'Crosses',
    render(el) {
      el.append(
        h('p', null, 'A ', h('strong', null, 'golden cross'), ' (50 SMA crossing above 200) and ', h('strong', null, 'death cross'), ' (the opposite) are widely watched. They often fire after a large move is already underway.'),
        takeaway(['Lag means late entries if used alone.', 'Works better as a regime filter with structure.', 'Practice recognizing crosses in Cross Catcher.']),
      );
    },
  },
  {
    title: 'Quick check',
    quiz: {
      question: 'Which statement is most accurate?',
      options: [
        { label: 'MAs lag price; they summarise past averages', value: 0 },
        { label: 'A golden cross is a reliable early signal that a new uptrend is starting', value: 1 },
        { label: 'An EMA has no lag because it weights recent prices more', value: 2 },
        { label: 'Price touching the 50-day MA in an uptrend is a guaranteed bounce', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Lag.</strong> That is the feature and the flaw. An EMA lags less, not zero; crosses tend to come after much of the move; MA “support” fails regularly. Use MAs for context, not prophecy.',
    },
  },
];


export default {
  id: 'moving-averages',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'SMA vs EMA, common lengths, dynamic support/resistance, and golden / death crosses without mysticism.',
      steps,
    });
    return () => shell.destroy();
  },
};
