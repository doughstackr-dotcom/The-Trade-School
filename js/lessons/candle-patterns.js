// candle-patterns — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, realExampleStep, checklistStep, compareStep, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { candleScenario } from '../core/patterns.js';


function hammerStory(rng) {
  const sc = candleScenario('hammer', { seed: rng.int(1, 1e9), leadIn: 26, after: 8 });
  const { candles } = sc;
  const stop = +(candles[sc.end].l - (candles[sc.end].h - candles[sc.end].l) * 0.15).toFixed(2);
  return {
    candles,
    frames: [
      { to: sc.start, caption: 'Sellers have been in control: lower highs and lower lows.' },
      { to: sc.end + 1, title: 'Hammer.', caption: 'Long lower wick, small body near the high — buyers rejected the lows.',
        overlays: [{ type: 'box', from: sc.start, to: sc.end, color: 'bull', label: 'Hammer' }] },
      { to: sc.end + 2, title: 'Confirmation.', caption: 'A close above the hammer high is the usual confirmation. Stop goes under the wick.',
        overlays: [
          { type: 'marker', idx: sc.end + 1, position: 'below', shape: 'arrow', text: 'Entry', color: 'accent' },
          { type: 'hline', price: stop, color: 'bear', label: 'Stop' },
        ] },
      { to: candles.length, caption: 'Follow-through is never guaranteed. The stop was placed before the entry for that reason.' },
    ],
  };
}

const steps = [
  {
    title: 'Patterns are shorthand',
    render(el) {
      el.append(
        h('p', null, 'A pattern name is a nickname for a shape plus a context. A hammer after a decline is not the same story as the identical shape after a rally (hanging man).'),
        takeaway([
          'Always ask: what was the trend into the candle?',
          'Wait for confirmation when the rulebook says so.',
          'One candle is evidence — not a crystal ball.',
        ]),
      );
    },
  },
  storyStep({ title: 'Hammer, step by step', text: 'Watch context → shape → confirmation → outcome.', story: hammerStory }),
  realExampleStep({
    title: 'Real-market hammers & engulfings',
    text: 'Messier than textbooks. Look for the same rules, not the same picture.',
    kinds: ['hammer', 'bullish-engulfing'],
    intervals: ['1d', '1w'],
  }),
  compareStep({
    title: 'Engulfing: clean vs weak',
    text: 'Same family, different conviction.',
    left: {
      title: 'Strong bullish engulfing',
      verdict: 'good',
      example: () => {
        const sc = candleScenario('bullish-engulfing', { seed: 9, leadIn: 20, after: 6 });
        return { candles: sc.candles, overlays: [{ type: 'box', from: sc.start, to: sc.end, color: 'bull', label: 'Engulfing' }] };
      },
      points: ['After a clear decline', 'Body fully covers prior body', 'Next candle follows through'],
    },
    right: {
      title: 'Weak lookalike',
      verdict: 'bad',
      example: () => {
        const sc = candleScenario('doji', { seed: 9, leadIn: 20, after: 6 });
        return { candles: sc.candles, overlays: [{ type: 'box', from: sc.start, to: sc.end, color: 'accent', label: 'Indecision' }] };
      },
      points: ['No decisive body takeover', 'Could be a pause, not a reverse', 'Do not force a name onto noise'],
    },
  }),
  checklistStep({
    title: 'Validate a hammer',
    example: (rng) => {
      const sc = candleScenario('hammer', { seed: rng.int(1, 1e9), leadIn: 22, after: 4 });
      return { candles: sc.candles, visible: sc.end + 1, sc };
    },
    items: [
      { label: 'After a decline', detail: 'Downtrend into the candle.',
        overlay: (chart, ex) => chart.addSegment({ a: { idx: 0, price: ex.candles[0].h }, b: { idx: ex.sc.start, price: ex.candles[ex.sc.start].l }, color: 'bear', dashed: true, arrow: true }) },
      { label: 'Lower wick ≥ 2× body', detail: 'Rejection of lows.',
        overlay: (chart, ex) => chart.addMarker({ idx: ex.sc.start, position: 'below', shape: 'ring', text: 'Wick', color: 'bull' }) },
      { label: 'Little upper wick', detail: 'Close near the high.',
        overlay: (chart, ex) => chart.addBox({ from: ex.sc.start, to: ex.sc.end, color: 'bull', label: 'Hammer' }) },
    ],
  }),
  {
    title: 'Quick check',
    quiz: {
      question: 'After a decline: small body at the top, long lower wick. Name?',
      options: [
        { label: 'Hammer', value: 0 },
        { label: 'Shooting star', value: 1 },
        { label: 'Gravestone doji', value: 2 },
        { label: 'Bearish engulfing', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Hammer.</strong> Shooting star / gravestone have long upper wicks at highs.',
    },
  },
  {
    title: 'Quick check: context',
    quiz: {
      question: 'A textbook hammer prints in the middle of a choppy range, far from any support. Best read?',
      options: [
        { label: 'Strong buy — a hammer is a bullish reversal signal anywhere', value: 0 },
        { label: 'Buy — the longer the wick, the more certain the reversal', value: 1 },
        { label: 'Low weight: without a prior decline into a level it says little — wait or pass', value: 2 },
        { label: 'Short it — hammers in ranges mean the opposite', value: 3 },
      ],
      answer: 2,
      explain: '<strong>Context decides.</strong> A hammer matters most after a decline into support, confirmed by the next candle. Mid-range, it is mostly noise.',
    },
  },
  {
    title: 'Patterns fail',
    render(el) {
      el.append(
        takeaway([
          'Even textbook patterns fail — size risk as if this one will.',
          'Combine with level and trend (confluence) later in Advanced.',
          'Drill recognition in Pattern Flash.',
        ]),
      );
    },
  },
];


export default {
  id: 'candle-patterns',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'Named candle patterns: hammers, engulfings, stars. Context and confirmation matter more than the name.',
      steps,
    });
    return () => shell.destroy();
  },
};
