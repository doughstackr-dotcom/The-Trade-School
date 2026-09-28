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
        { label: 'Buy full size — any two swing lows make a confirmed trend line', value: 1 },
        { label: 'Buy with a stop a few cents under the line, since it must hold', value: 2 },
        { label: 'Redraw the line through the dip’s wick so it still counts as a touch', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Candidate only.</strong> Any two points make a line; a third reaction and the surrounding structure are what give it weight. Redrawing lines to fit each new wick hides the information you need.',
    },
  },
  {
    title: 'Drawing consistently',
    render(el) {
      el.append(
        h('ul', { class: 'lesson-list' },
          h('li', null, h('strong', null, 'Wicks or bodies?'), ' Either can work; pick one method and use it every time. Mixing them lets you draw whatever line you want to see.'),
          h('li', null, h('strong', null, 'Angle matters.'), ' Very steep lines (a parabolic run) break quickly and often; shallower lines tend to last longer but give later signals.'),
          h('li', null, h('strong', null, 'Scale matters.'), ' Over big moves, a line on a log chart and a line on a linear chart touch different points. Check both on long-term charts.'),
          h('li', null, h('strong', null, 'Timeframe matters.'), ' A line on the daily chart outweighs one drawn on 5-minute candles.'),
        ),
        takeaway([
          'A line is a hypothesis about where buyers (or sellers) have been stepping in.',
          'If you keep redrawing it, the market is telling you the line is not there.',
        ]),
      );
    },
  },
  {
    title: 'Breaks and fakeouts',
    render(el) {
      el.append(
        h('p', null, 'A trend-line break says the trend has lost its pace — not necessarily that it has reversed. Price often breaks a rising line and then drifts sideways, or retests the line from below before deciding.'),
        takeaway([
          'Intraday wicks beyond a daily line often mean little; a close beyond it says more.',
          'A line break plus a break of the last swing low (structure) is a stronger warning than either alone.',
          'Drill in Trendline Challenge.',
        ]),
      );
    },
    quiz: {
      question: 'Price closes below a rising trend line but is still above its last higher low. Best read?',
      options: [
        { label: 'The uptrend has reversed — go short now', value: 0 },
        { label: 'Add to the long — most trend-line breaks are fakeouts', value: 1 },
        { label: 'Momentum has slowed; watch the last higher low and any retest of the line', value: 2 },
        { label: 'Redraw the line under the new low so the trend stays intact', value: 3 },
      ],
      answer: 2,
      explain: 'A line break is a <strong>warning</strong>. The uptrend structure only breaks when the last higher low goes; until then it may be a pause, a range or a retest.',
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
