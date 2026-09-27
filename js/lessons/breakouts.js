// breakouts — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, compareStep, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
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
      el.append(
        h('p', null, 'Traders watch range highs/lows, pattern boundaries and round numbers. Liquidity (stops) piles just beyond them — so price often pokes through before reversing.'),
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
      el.append(takeaway(['Liquidity grabs are common around obvious highs/lows.', 'Drill decisions in Trap or Trade.']));
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
