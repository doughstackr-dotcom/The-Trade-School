// trends — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, realExampleStep, figure, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';


function structureStory(rng) {
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: 80, direction: 'up', swings: 4 });
  const c = ts.candles;
  // Labels sit on the series' real swings: the first higher low, the next higher high and higher low.
  const a = ts.swings.find((s) => s.label === 'HL').idx;
  const b = ts.swings.find((s) => s.label === 'HH' && s.idx > a).idx;
  const d = ts.swings.find((s) => s.label === 'HL' && s.idx > b).idx;
  return {
    candles: c,
    frames: [
      { to: a + 1, caption: 'A swing low forms. In an uptrend we expect the next low to hold above this one.' },
      { to: b + 1, title: 'Higher high.', caption: 'Buyers push a new high. Structure: higher high after a higher low.',
        overlays: [
          { type: 'marker', idx: a, position: 'below', text: 'HL', color: 'bull' },
          { type: 'marker', idx: b, position: 'above', text: 'HH', color: 'bull' },
        ] },
      { to: d + 1, caption: 'Another higher low. Until a lower low breaks the structure, the bias stays up.',
        overlays: [
          { type: 'marker', idx: a, position: 'below', text: 'HL', color: 'bull' },
          { type: 'marker', idx: b, position: 'above', text: 'HH', color: 'bull' },
          { type: 'marker', idx: d, position: 'below', text: 'HL', color: 'bull' },
        ] },
      { to: c.length, caption: 'Trends end when structure breaks: a decisive lower low after a series of higher lows (or the mirror for downtrends).' },
    ],
  };
}

const steps = [
  {
    title: 'What is a trend?',
    render(el) {
      const ts = trendSeries({ seed: 3, count: 60, direction: 'up', swings: 3 });
      el.append(
        h('p', null, 'An ', h('strong', null, 'uptrend'), ' prints higher highs and higher lows. A ', h('strong', null, 'downtrend'), ' prints lower highs and lower lows. Everything else is a ', h('strong', null, 'range'), ' or transition.'),
        figure(miniChart(ts.candles, { width: 640, height: 200, ariaLabel: 'Uptrend with swings' }),
          'Swing points define structure. Connect them before you invent a story.', { label: 'Figure 1' }),
        takeaway(['Structure first, indicators second.', 'Ranges chop — shrink size or stand aside.', 'One broken swing does not always end the trend; wait for confirmation.']),
      );
    },
  },
  storyStep({ title: 'Building an uptrend', story: structureStory }),
  realExampleStep({
    title: 'Real trend examples',
    kinds: ['trend-up', 'trend-down'],
    intervals: ['1d', '1w'],
    caption: 'Real trends are jagged. Judge the sequence of swings, not perfection.',
  }),
  {
    title: 'Quick check',
    quiz: {
      question: 'Price makes a lower high then breaks the prior swing low on a closing basis. Best read?',
      options: [
        { label: 'Uptrend structure is breaking — bias shifts down or to caution', value: 0 },
        { label: 'Guaranteed new long-term bull market', value: 1 },
        { label: 'Trends never end', value: 2 },
        { label: 'Ignore closes; only wicks matter', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Structure break.</strong> A lower high plus a close below the prior low is classic trend damage. Not a prophecy — a change in bias.',
    },
  },
  {
    title: 'Caveats',
    render(el) {
      el.append(takeaway([
        'Labels are approximate; two traders may mark different swings.',
        'News gaps can smash structure overnight.',
        'Practise in Trend Spotter.',
      ]));
    },
  },
];


export default {
  id: 'trends',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'Uptrends, downtrends and ranges: higher highs / higher lows, and why structure beats a single moving average.',
      steps,
    });
    return () => shell.destroy();
  },
};
