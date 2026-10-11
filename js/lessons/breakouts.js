// breakouts — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, compareStep, figure, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { chartScenario } from '../core/patterns.js';


function brkStory(rng) {
  const sc = chartScenario('ascending-triangle', { seed: rng.int(1, 1e9), count: 96, after: 18, outcome: 'success' });
  return {
    candles: sc.candles,
    indicators: { volume: true },
    frames: [
      { to: sc.breakoutIdx, caption: 'Compressed under resistance. Stops often rest just beyond the obvious line.' },
      { to: sc.breakoutIdx + 1, title: 'Break.', caption: 'A decisive close beyond the level beats a brief wick poke.',
        overlays: [
          { type: 'hline', price: sc.level, color: 'resistance', dashed: true },
          { type: 'marker', idx: sc.breakoutIdx, position: 'above', text: 'Close', color: 'accent' },
        ] },
      { to: sc.candles.length, caption: 'Retest of the broken level is optional confirmation. Fakeouts close back inside and trap chasers.' },
    ],
  };
}

const steps = [
  {
    title: 'Anatomy of a break',
    render(el) {
      const sc = chartScenario('ascending-triangle', { seed: 4, count: 96, after: 14, outcome: 'success' });
      el.append(
        h('p', null, 'Traders watch range highs/lows, pattern boundaries and round numbers. Liquidity (stops) piles just beyond them — so price often pokes through before reversing.'),
        figure(
          miniChart(sc.candles, {
            width: 640, height: 200, yPad: 0.12,
            ariaLabel: 'Ascending triangle breakout anatomy',
            overlays: [
              { type: 'hline', price: sc.level, color: 'resistance', dashed: true, label: 'Level' },
              { type: 'marker', idx: sc.breakoutIdx, position: 'above', text: 'Close beyond', color: 'accent' },
              ...(sc.boundaries?.lower ? [{
                type: 'segment',
                a: { idx: sc.boundaries.lower.x1, price: sc.boundaries.lower.y1 },
                b: { idx: sc.boundaries.lower.x2, price: sc.boundaries.lower.y2 },
                color: 'bull', dashed: true,
              }] : []),
            ],
          }),
          'Prefer a decisive <strong>close</strong> beyond the level over a wick poke. Stops often rest just outside the obvious line.',
          { label: 'Figure 1' },
        ),
        takeaway(['Prefer closes beyond the level over wicks.', 'Volume helps filter thin probes.', 'Have a plan for retest vs failed break.']),
      );
    },
  },
  storyStep({ title: 'Break and follow-through', story: brkStory }),
  compareStep({
    title: 'Breakout vs fakeout',
    left: {
      title: 'Confirmed', verdict: 'good', volume: true,
      example: () => {
        const sc = chartScenario('ascending-triangle', { seed: 7, count: 96, after: 16, outcome: 'success' });
        return { candles: sc.candles, overlays: [{ type: 'hline', price: sc.level, color: 'resistance', dashed: true }, { type: 'marker', idx: sc.breakoutIdx, position: 'above', shape: 'dot', color: 'accent' }] };
      },
      points: ['Close clears level', 'Volume expands', 'Holds on pullback'],
    },
    right: {
      title: 'Fakeout', verdict: 'bad', volume: true,
      example: () => {
        const sc = chartScenario('ascending-triangle', { seed: 7, count: 96, after: 16, outcome: 'fail' });
        return { candles: sc.candles, overlays: [{ type: 'hline', price: sc.level, color: 'resistance', dashed: true }, { type: 'marker', idx: sc.breakoutIdx, position: 'above', shape: 'dot', color: 'accent' }] };
      },
      points: ['Wick or weak close', 'Thin volume', 'Closes back inside'],
    },
  }),
  {
    title: 'Quick check',
    render(el) {
      const sc = chartScenario('ascending-triangle', { seed: 7, count: 96, after: 16, outcome: 'fail' });
      el.append(
        figure(
          miniChart(sc.candles, {
            width: 640, height: 190, yPad: 0.12,
            ariaLabel: 'Failed breakout trap',
            overlays: [
              { type: 'hline', price: sc.level, color: 'resistance', dashed: true, label: 'Resistance' },
              { type: 'marker', idx: sc.breakoutIdx, position: 'above', text: 'Spike', color: 'bear' },
              { type: 'marker', idx: Math.min(sc.candles.length - 1, sc.breakoutIdx + 8), position: 'below', text: 'Back inside', color: 'accent' },
            ],
          }),
          'Spike above resistance, close back below — classic trap / failed break.',
          { label: 'Figure' },
        ),
      );
    },
    quiz: {
      question: 'Price spikes above resistance but closes back below on heavy volume. Read?',
      options: [
        { label: 'Likely trap — fade or stand aside per plan', value: 0 },
        { label: 'Always buy the close', value: 1 },
        { label: 'Ignore volume and location', value: 2 },
        { label: 'Guaranteed short squeeze higher', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Trap / failed break.</strong> Close back inside on volume often traps breakout buyers.',
    },
  },
  {
    title: 'Caveats',
    render(el) {
      const sc = chartScenario('ascending-triangle', { seed: 21, count: 96, after: 18, outcome: 'fail' });
      el.append(
        figure(
          miniChart(sc.candles, {
            width: 640, height: 200, yPad: 0.12,
            ariaLabel: 'Liquidity grab beyond resistance',
            overlays: [
              { type: 'hline', price: sc.level, color: 'resistance', dashed: true, label: 'Obvious high' },
              { type: 'marker', idx: sc.breakoutIdx, position: 'above', text: 'Stop run', color: 'bear' },
              { type: 'box', from: sc.breakoutIdx - 1, to: sc.breakoutIdx + 2, color: 'bear', label: 'Liquidity' },
            ],
          }),
          'Liquidity grabs are common around obvious highs/lows — price pokes the stops, then reverses.',
          { label: 'Figure' },
        ),
        takeaway(['Liquidity grabs are common around obvious highs/lows.', 'Drill decisions in Trap or Trade.']),
      );
    },
  },
];


export default {
  id: 'breakouts',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'Breakouts, fakeouts and liquidity grabs: closes vs wicks, volume, retests and stop hunts.',
      steps,
    });
    return () => shell.destroy();
  },
};
