// trendlines — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { trendSeries } from '../core/data.js';


function channelStory(rng) {
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: 85, direction: 'up', swings: 4 });
  const c = ts.candles;
  const i1 = 12, i2 = 40, i3 = 65;
  const p1 = c[i1].l, p2 = c[i2].l;
  return {
    candles: c,
    frames: [
      { to: i2 + 1, caption: 'Two higher lows give you a candidate rising line.',
        overlays: [{ type: 'segment', a: { idx: i1, price: p1 }, b: { idx: i2, price: p2 }, color: 'accent', label: 'Trend line' }] },
      { to: i3 + 1, title: 'Third touch.', caption: 'A third reaction adds confidence. Channels add a parallel on the other side.',
        overlays: [
          { type: 'segment', a: { idx: i1, price: p1 }, b: { idx: i3, price: p2 + (p2 - p1) * ((i3 - i1) / (i2 - i1)) }, color: 'accent' },
          { type: 'marker', idx: i3, position: 'above', text: 'Reaction', color: 'bull' },
        ] },
      { to: c.length, caption: 'A close beyond the line is a warning, not an automatic reverse. Wait for structure confirmation.' },
    ],
  };
}

const steps = [
  {
    title: 'Drawing rules',
    render(el) {
      el.append(
        h('p', null, 'Connect swing lows in an uptrend (or swing highs in a downtrend). Need ', h('strong', null, 'two points'), ' to draw; a ', h('strong', null, 'third touch'), ' validates.'),
        takeaway(['Do not force a line through noise.', 'Prefer closes or consistent wick edges — be consistent.', 'Steeper lines break more often.']),
      );
    },
  },
  storyStep({ title: 'Line to channel', story: channelStory }),
  {
    title: 'Quick check',
    quiz: {
      question: 'A rising trend line has two touches only. Price dips to it. Best stance?',
      options: [
        { label: 'Treat it as a candidate — smaller size or wait for the third touch / confirmation', value: 0 },
        { label: 'All-in: two points are sacred', value: 1 },
        { label: 'Never use trend lines', value: 2 },
        { label: 'Move the line so the dip looks perfect', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Candidate only.</strong> Two-point lines are provisional. Third touches and structure confirm.',
    },
  },
  {
    title: 'Breaks and fakeouts',
    render(el) {
      el.append(takeaway([
        'Intraday wicks beyond a daily line often mean little.',
        'Combine line breaks with level breaks for better odds.',
        'Drill in Trendline Challenge.',
      ]));
    },
  },
];


export default {
  id: 'trendlines',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'Trend lines and channels: two points minimum, three for confidence, and when a break is real.',
      steps,
    });
    return () => shell.destroy();
  },
};
