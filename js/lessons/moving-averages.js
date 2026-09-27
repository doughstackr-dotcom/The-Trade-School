// moving-averages — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { trendSeries } from '../core/data.js';


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
  storyStep({ title: 'MA as a trend filter', story: maStory }),
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
        { label: 'A 200-day MA predicts next week’s close', value: 1 },
        { label: 'EMA never whipsaws', value: 2 },
        { label: 'Crosses always mark exact tops and bottoms', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Lag.</strong> That is the feature and the flaw. Use MAs for context, not prophecy.',
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
