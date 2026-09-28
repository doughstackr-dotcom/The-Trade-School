// multi-timeframe — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, compareStep, figure, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
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
  compareStep({
    title: 'Top down',
    text: () => h('p', null,
      'Decide direction on a ', h('strong', null, 'higher timeframe'),
      ', refine location on an intermediate one, and time entry on a ',
      h('strong', null, 'lower timeframe'), '.'),
    left: {
      title: 'Higher TF bias',
      verdict: 'good',
      tag: 'Weekly / daily',
      example: () => {
        const ts = trendSeries({ seed: 6, count: 60, direction: 'up', swings: 3 });
        return {
          candles: ts.candles,
          overlays: [
            { type: 'marker', idx: 18, position: 'below', text: 'HL', color: 'bull' },
            { type: 'marker', idx: 32, position: 'above', text: 'HH', color: 'bull' },
            { type: 'marker', idx: 48, position: 'below', text: 'HL', color: 'bull' },
          ],
        };
      },
      points: ['Clear higher highs / higher lows', 'Sets the directional bias', 'Do not invent shorts against this without an HTF break'],
    },
    right: {
      title: 'Lower TF timing',
      verdict: 'neutral',
      tag: 'Intraday',
      example: () => {
        const ts = trendSeries({ seed: 14, count: 60, direction: 'range', swings: 5 });
        return {
          candles: ts.candles,
          overlays: [
            { type: 'marker', idx: 40, position: 'above', text: 'Looks toppy', color: 'bear' },
            { type: 'marker', idx: 52, position: 'below', text: 'Pullback buy', color: 'accent' },
          ],
        };
      },
      points: ['Noisy; often just a pullback', 'Times the entry, does not rewrite bias', 'Same market, different question'],
    },
    after: () => takeaway(['HTF bias first.', 'Do not invent a short on LTF against a strong HTF uptrend without a clear HTF break.', 'Same market, different questions per clock.']),
  }),
  storyStep({ title: 'Bias then trigger', story: mtfStory }),
  {
    title: 'Quick check',
    render(el) {
      const htf = trendSeries({ seed: 3, count: 48, direction: 'up', swings: 3 });
      const ltf = trendSeries({ seed: 11, count: 48, direction: 'down', swings: 2 });
      el.append(
        h('div', { class: 'compare' },
          h('div', { class: 'compare__side compare__side--neutral' },
            h('div', { class: 'compare__head' },
              h('span', { class: 'chip chip--sm chip--bull' }, 'HTF'),
              h('h3', { class: 'compare__title' }, 'Weekly uptrend')),
            figure(
              miniChart(htf.candles, {
                width: 320, height: 150, yPad: 0.12,
                ariaLabel: 'Weekly uptrend',
                overlays: [{ type: 'marker', idx: 40, position: 'above', text: 'Bias long', color: 'bull' }],
              }),
              '',
            ),
          ),
          h('div', { class: 'compare__side compare__side--neutral' },
            h('div', { class: 'compare__head' },
              h('span', { class: 'chip chip--sm chip--bear' }, 'LTF'),
              h('h3', { class: 'compare__title' }, '5-min looks toppy')),
            figure(
              miniChart(ltf.candles, {
                width: 320, height: 150, yPad: 0.12,
                ariaLabel: 'Lower timeframe pullback',
                overlays: [{ type: 'marker', idx: 36, position: 'above', text: 'Pullback?', color: 'accent' }],
              }),
              '',
            ),
          ),
        ),
        h('p', { class: 'figure__caption' }, 'Default: favour pullback longs or wait — respect the weekly bias.'),
      );
    },
    quiz: {
      question: 'Weekly chart is a clean uptrend; 5-minute chart looks toppy. Best default?',
      options: [
        { label: 'Favour pullback longs or wait — respect the weekly bias', value: 0 },
        { label: 'Short the 5-minute top — the lowest timeframe is the most current information', value: 1 },
        { label: 'Close the weekly chart — it is too slow to matter for entries', value: 2 },
        { label: 'Buy at market now — the weekly trend guarantees the dip gets bought', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Respect HTF.</strong> A toppy LTF often is just a pullback in a larger uptrend.',
    },
  },
  {
    title: 'Quick check: alignment',
    quiz: {
      question: 'Daily trend is up; the 1-hour chart pulls back into daily support; the 5-minute chart just made a higher low. What does this alignment give you?',
      options: [
        { label: 'A guaranteed winner, because all three timeframes agree', value: 0 },
        { label: 'A short, because the 1-hour chart is falling', value: 1 },
        { label: 'A long idea with direction, location and a trigger — still sized with a stop', value: 2 },
        { label: 'Nothing — timeframes should never be combined', value: 3 },
      ],
      answer: 2,
      explain: 'Direction from the higher timeframe, <strong>location</strong> from the middle one, <strong>timing</strong> from the lower one. Alignment improves the setup; it does not remove the need for a stop.',
    },
  },
  compareStep({
    title: 'Caveats',
    text: 'Too many timeframes = analysis paralysis. Stack two or three — then stop adding clocks.',
    left: {
      title: 'Aligned stack',
      verdict: 'good',
      tag: 'Tradeable',
      example: () => {
        const ts = trendSeries({ seed: 5, count: 70, direction: 'up', swings: 3 });
        return {
          candles: ts.candles,
          overlays: [
            { type: 'marker', idx: 50, position: 'below', text: 'HTF+LTF long', color: 'bull' },
          ],
        };
      },
      points: ['HTF bias and LTF trigger agree', 'Normal size is justified', 'Practice stacking in Timeframe Stack'],
    },
    right: {
      title: 'Conflict',
      verdict: 'bad',
      tag: 'Stand aside',
      example: () => {
        const ts = trendSeries({ seed: 15, count: 70, direction: 'range', swings: 4 });
        return {
          candles: ts.candles,
          overlays: [
            { type: 'marker', idx: 30, position: 'above', text: 'HTF up', color: 'bull' },
            { type: 'marker', idx: 55, position: 'above', text: 'LTF short?', color: 'bear' },
          ],
        };
      },
      points: ['Clocks disagree', 'Shrink size or pass', 'Passing is a position'],
    },
    after: () => takeaway(['Too many timeframes = analysis paralysis.', 'Practice stacking in Timeframe Stack.']),
  }),
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
