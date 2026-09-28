// trends — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, realExampleStep, figure, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';


function structureStory(rng) {
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: 80, direction: 'up', swings: 4 });
  const c = ts.candles;
  const a = 18, b = 38, d = 58;
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
        { label: 'Buy the dip — every pullback in an uptrend is an opportunity', value: 1 },
        { label: 'Nothing has changed until a moving-average crossover confirms it', value: 2 },
        { label: 'The uptrend holds as long as the all-time high has not been broken', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Structure break.</strong> A lower high plus a close below the prior low is classic trend damage. Not a prophecy — a change in bias.',
    },
  },
  {
    title: 'Quick check: label the swings',
    quiz: {
      question: 'Swing lows at 90, 94 and 97; swing highs at 100, 105 and 109. What is the structure?',
      options: [
        { label: 'A range — price keeps returning to similar levels', value: 0 },
        { label: 'An uptrend — higher highs and higher lows', value: 1 },
        { label: 'A downtrend — each high is followed by a low', value: 2 },
        { label: 'Impossible to say without an indicator', value: 3 },
      ],
      answer: 1,
      explain: 'Each high and each low is above the one before: <strong>higher highs and higher lows</strong>. Structure alone is enough to call it — no indicator needed.',
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
