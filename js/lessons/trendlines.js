// trendlines — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { trendSeries } from '../core/data.js';
import { atr } from '../core/indicators.js';


// The line joins two consecutive swing lows with no close below it; the next swing low comes back
// to within 0.35 ATR of it (a real third touch). Series are drawn until one qualifies.
function touchLine(ts) {
  const c = ts.candles;
  const A = atr(c, 14);
  const lows = ts.swings.filter((s) => s.type === 'low');
  for (let k = 0; k + 2 < lows.length; k++) {
    const [s1, s2, s3] = lows.slice(k, k + 3);
    const at = (i) => s1.price + (s2.price - s1.price) * ((i - s1.idx) / (s2.idx - s1.idx));
    let clean = true;
    for (let i = s1.idx + 1; i <= s3.idx; i++) if (c[i].c < at(i)) clean = false;
    const gap = (s3.price - at(s3.idx)) / (A[s3.idx] || 1);
    if (clean && gap > -0.1 && gap < 0.35) return { i1: s1.idx, i2: s2.idx, i3: s3.idx, p1: s1.price, p2: s2.price };
  }
  return null;
}

function channelStory(rng) {
  let ts = null;
  let line = null;
  for (let t = 0; t < 80 && !line; t++) {
    ts = trendSeries({ seed: rng.int(1, 1e9), count: 85, direction: 'up', swings: 4 });
    line = touchLine(ts);
  }
  const c = ts.candles;
  const lows = ts.swings.filter((s) => s.type === 'low');
  const { i1, i2, i3, p1, p2 } = line || { i1: lows[0].idx, i2: lows[1].idx, i3: lows[2].idx, p1: lows[0].price, p2: lows[1].price };
  return {
    candles: c,
    frames: [
      { to: i2 + 1, caption: 'Two higher lows give you a candidate rising line.',
        overlays: [{ type: 'segment', a: { idx: i1, price: p1 }, b: { idx: i2, price: p2 }, color: 'accent', label: 'Trend line' }] },
      { to: i3 + 1, title: 'Third touch.', caption: 'A third reaction adds confidence. Channels add a parallel on the other side.',
        overlays: [
          { type: 'segment', a: { idx: i1, price: p1 }, b: { idx: i3, price: p1 + (p2 - p1) * ((i3 - i1) / (i2 - i1)) }, color: 'accent' },
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
