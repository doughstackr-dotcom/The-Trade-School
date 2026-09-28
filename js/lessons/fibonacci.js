// fibonacci — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, compareStep, figure, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';


function fibStory(rng) {
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: 90, direction: 'up', swings: 3 });
  const c = ts.candles;
  const loIdx = 15, hiIdx = 55;
  const lo = c[loIdx].l, hi = c[hiIdx].h;
  const r618 = hi - (hi - lo) * 0.618;
  const r382 = hi - (hi - lo) * 0.382;
  return {
    candles: c,
    frames: [
      { to: hiIdx + 1, caption: 'Mark a clear swing low to swing high — the impulse you care about.',
        overlays: [{ type: 'segment', a: { idx: loIdx, price: lo }, b: { idx: hiIdx, price: hi }, color: 'bull', arrow: true, label: 'Swing' }] },
      { to: hiIdx + 20, title: 'Retracement map.', caption: '38.2% and 61.8% are commonly watched pullback zones — habits, not laws.',
        overlays: [
          { type: 'hline', price: r382, color: 'accent', dashed: true, label: '38.2%' },
          { type: 'hline', price: r618, color: 'accent', dashed: true, label: '61.8%' },
        ] },
      { to: c.length, caption: 'Extensions (1.272, 1.618…) project take-profit ideas beyond the swing. Always pair with structure.' },
    ],
  };
}

/** Pick a clear completed impulse (swing low → later swing high) from trendSeries swings. */
function impulseSwing(ts) {
  const lows = (ts.swings || []).filter((s) => s.type === 'low');
  const highs = (ts.swings || []).filter((s) => s.type === 'high');
  for (const lo of lows) {
    const hi = highs.find((h) => h.idx > lo.idx && h.price > lo.price);
    if (hi) return { loIdx: lo.idx, hiIdx: hi.idx, loPrice: lo.price, hiPrice: hi.price };
  }
  // Fallback: candle extremes in the first two-thirds of the series.
  const c = ts.candles;
  let loIdx = 0;
  let hiIdx = 0;
  const end = Math.max(2, Math.floor(c.length * 0.7));
  for (let i = 1; i < end; i++) {
    if (c[i].l < c[loIdx].l) loIdx = i;
    if (c[i].h > c[hiIdx].h) hiIdx = i;
  }
  if (hiIdx <= loIdx) hiIdx = Math.min(c.length - 1, loIdx + 10);
  return { loIdx, hiIdx, loPrice: c[loIdx].l, hiPrice: c[hiIdx].h };
}

function fibFigure(seed, _loIdx, _hiIdx, { width = 640, height = 200 } = {}) {
  // Seed picks the series; swing anchors come from trendSeries.swings (not fixed candle indexes —
  // hard-coded 12→42 on seed 21 was not a real low→high, so levels floated off the impulse).
  const ts = trendSeries({ seed, count: 72, direction: 'up', swings: 3 });
  const c = ts.candles;
  const { loIdx, hiIdx, loPrice, hiPrice } = impulseSwing(ts);
  const a = { idx: loIdx, price: loPrice };
  const b = { idx: hiIdx, price: hiPrice };
  return miniChart(c, {
    width, height, yPad: 0.12,
    ariaLabel: 'Fibonacci retracement on an upswing',
    overlays: [
      { type: 'fib', a, b, ratios: [0, 0.382, 0.5, 0.618, 1], zone: [0.5, 0.618], labels: true },
      { type: 'marker', idx: loIdx, position: 'below', text: 'Low', color: 'bull' },
      { type: 'marker', idx: hiIdx, position: 'above', text: 'High', color: 'bull' },
    ],
  });
}

/** Quiz schematic: swing 50 → 60 so 61.8% lands at 53.82. */
function quizFibSchematic() {
  const lo = 50, hi = 60;
  const r618 = hi - (hi - lo) * 0.618; // 53.82
  const r382 = hi - (hi - lo) * 0.382; // 56.18
  const candles = [];
  let px = lo;
  for (let i = 0; i < 48; i++) {
    let target;
    if (i < 20) target = lo + (hi - lo) * (i / 19);
    else if (i < 34) target = hi - (hi - r618) * ((i - 20) / 14);
    else target = r618 + (hi - r618) * 0.35 * ((i - 34) / 14);
    const o = px;
    const c = target + (i % 3 === 0 ? 0.15 : -0.1);
    const h = Math.max(o, c) + 0.25;
    const l = Math.min(o, c) - 0.25;
    candles.push({ o, h, l, c, v: 1000 + i * 10, t: i });
    px = c;
  }
  candles[0] = { ...candles[0], l: lo, o: lo + 0.2, c: lo + 0.4 };
  candles[19] = { ...candles[19], h: hi, c: hi - 0.15, o: hi - 0.5 };
  return miniChart(candles, {
    width: 640, height: 190, yPad: 0.14,
    ariaLabel: 'Swing 50 to 60 with 61.8 percent at 53.82',
    overlays: [
      { type: 'segment', a: { idx: 0, price: lo }, b: { idx: 19, price: hi }, color: 'bull', arrow: true, label: '50 → 60' },
      { type: 'hline', price: r382, color: 'accent', dashed: true, label: '38.2% 56.18' },
      { type: 'hline', price: r618, color: 'bear', label: '61.8% 53.82' },
    ],
  });
}

const steps = [
  {
    title: 'Ratios traders watch',
    render(el) {
      el.append(
        h('p', null, 'Common retracements: 23.6%, 38.2%, 50%, 61.8%, 78.6%. They are popular because many people place orders there — a self-fulfilling habit, not sacred geometry.'),
        figure(
          fibFigure(21, 12, 42),
          'Anchor low → high on a completed impulse. Pullback zones hang under the high in an uptrend.',
          { label: 'Figure 1' },
        ),
        takeaway(['Anchor on a clear completed swing.', 'In an uptrend, measure low → high; pullback levels hang below the high.', 'Confluence with a level or MA beats a lone Fib.']),
      );
    },
  },
  storyStep({ title: 'Anchoring a pullback', story: fibStory }),
  {
    title: 'Quick check',
    render(el) {
      el.append(
        figure(
          quizFibSchematic(),
          'Range = 10. 61.8% of 10 = 6.18. From the high: 60 − 6.18 = <strong>53.82</strong>.',
          { label: 'Figure' },
        ),
      );
    },
    quiz: {
      question: 'Swing low 50, swing high 60. Where is the 61.8% retracement?',
      options: [
        { label: '53.82', value: 0 },
        { label: '56.18', value: 1 },
        { label: '55.00', value: 2 },
        { label: '61.80', value: 3 },
      ],
      answer: 0,
      explain: 'Range 10 × 0.618 = 6.18. From the high: 60 − 6.18 = <strong>53.82</strong>. (56.18 is 38.2%.)',
    },
  },
  {
    title: 'Quick check: zones, not magic',
    quiz: {
      question: 'Why do many traders treat Fibonacci levels as zones rather than exact prices?',
      options: [
        { label: 'Price is mathematically attracted to 61.8%', value: 0 },
        { label: 'Levels depend on which swing you anchor, and price rarely turns to the cent', value: 1 },
        { label: 'Fibonacci levels only work on weekly charts', value: 2 },
        { label: 'A level only counts when three ratios line up exactly', value: 3 },
      ],
      answer: 1,
      explain: 'Different anchors give different levels, and reactions happen <strong>around</strong> them. Fib areas are most useful where they overlap other evidence, like prior support.',
    },
  },
  compareStep({
    title: 'Caveats',
    text: 'Wrong swing = wrong map. Drill the habit of picking the impulse you actually care about.',
    left: {
      title: 'Clear impulse',
      verdict: 'good',
      tag: 'Valid anchor',
      example: () => {
        const ts = trendSeries({ seed: 8, count: 70, direction: 'up', swings: 3 });
        const loIdx = 10, hiIdx = 40;
        return {
          candles: ts.candles,
          overlays: [
            { type: 'fib', a: { idx: loIdx, price: ts.candles[loIdx].l }, b: { idx: hiIdx, price: ts.candles[hiIdx].h }, ratios: [0, 0.382, 0.618, 1], labels: false },
            { type: 'marker', idx: loIdx, position: 'below', text: 'A', color: 'bull' },
            { type: 'marker', idx: hiIdx, position: 'above', text: 'B', color: 'bull' },
          ],
        };
      },
      points: ['Obvious swing low → swing high', 'Levels land near structure', 'Safe to plan a pullback'],
    },
    right: {
      title: 'Noise swing',
      verdict: 'bad',
      tag: 'Trap map',
      example: () => {
        const ts = trendSeries({ seed: 8, count: 70, direction: 'up', swings: 4 });
        const loIdx = 28, hiIdx = 34;
        return {
          candles: ts.candles,
          overlays: [
            { type: 'fib', a: { idx: loIdx, price: ts.candles[loIdx].l }, b: { idx: hiIdx, price: ts.candles[hiIdx].h }, ratios: [0, 0.382, 0.618, 1], labels: false },
            { type: 'marker', idx: loIdx, position: 'below', text: '?', color: 'bear' },
            { type: 'marker', idx: hiIdx, position: 'above', text: '?', color: 'bear' },
          ],
        };
      },
      points: ['Tiny wiggle, not the impulse', 'Levels float in empty space', 'Never size up on a lone Fib touch'],
    },
    after: () => takeaway(['Wrong swing = wrong map.', 'Drill in Fib Sniper.', 'Never size up just because a Fib “touches”.']),
  }),
];


export default {
  id: 'fibonacci',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'Fibonacci retracements and extensions: anchoring swings, key ratios, and confluence — without mysticism.',
      steps,
    });
    return () => shell.destroy();
  },
};
