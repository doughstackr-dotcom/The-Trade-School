// volume — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, compareStep, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { chartScenario } from '../core/patterns.js';


function volStory(rng) {
  const sc = chartScenario('ascending-triangle', { seed: rng.int(1, 1e9), count: 96, after: 16, outcome: 'success' });
  return {
    candles: sc.candles,
    indicators: { volume: true },
    frames: [
      { to: sc.breakoutIdx - 5, caption: 'Coiling under resistance. Watch whether volume shrinks in the coil (interest resting).' },
      { to: sc.breakoutIdx + 1, title: 'Break on volume.', caption: 'A real breakout usually expands participation. Thin breaks are suspects.',
        overlays: [
          { type: 'hline', price: sc.level, color: 'resistance', dashed: true, label: 'Level' },
          { type: 'marker', idx: sc.breakoutIdx, position: 'above', text: 'Break', color: 'accent' },
        ] },
      { to: sc.candles.length, caption: 'Even strong volume can fail. Volume is evidence of participation — not a promise.' },
    ],
  };
}

const steps = [
  {
    title: 'Fuel behind the move',
    render(el) {
      el.append(
        h('p', null, 'Volume estimates how much changed hands. Rising price on rising volume = healthier participation than rising price on dying volume.'),
        takeaway(['Breakouts prefer above-average volume.', 'Dry-ups often appear in flags and coils.', 'FX volume is tick/proxy volume — interpret cautiously.']),
      );
    },
  },
  storyStep({ title: 'Volume on a breakout', story: volStory }),
  compareStep({
    title: 'Confirm vs trap',
    left: {
      title: 'Confirmed break', verdict: 'good', volume: true,
      example: () => {
        const sc = chartScenario('ascending-triangle', { seed: 11, count: 96, after: 16, outcome: 'success' });
        return { candles: sc.candles, overlays: [{ type: 'hline', price: sc.level, color: 'resistance', dashed: true }, { type: 'marker', idx: sc.breakoutIdx, position: 'above', shape: 'dot', color: 'accent' }] };
      },
      points: ['Volume expands on the break', 'Close clears the level', 'Follow-through holds'],
    },
    right: {
      title: 'Thin fakeout', verdict: 'bad', volume: true,
      example: () => {
        const sc = chartScenario('ascending-triangle', { seed: 11, count: 96, after: 16, outcome: 'fail' });
        return { candles: sc.candles, overlays: [{ type: 'hline', price: sc.level, color: 'resistance', dashed: true }, { type: 'marker', idx: sc.breakoutIdx, position: 'above', shape: 'dot', color: 'accent' }] };
      },
      points: ['Break on weak volume', 'Close back inside', 'Trapped breakout buyers'],
    },
  }),
  {
    title: 'Quick check',
    quiz: {
      question: 'A breakout closes above resistance on the lowest volume of the month. Best read?',
      options: [
        { label: 'Treat with suspicion — wait for confirmation', value: 0 },
        { label: 'Buy full size — low volume means there is little selling pressure', value: 1 },
        { label: 'Ignore it — volume only matters for day traders', value: 2 },
        { label: 'Short immediately — low-volume breakouts always fail', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Suspicion.</strong> Thin participation means fewer buyers joined. Wait or fade only with a plan — do not blindly size up.',
    },
  },
  {
    title: 'Quick check: climax',
    quiz: {
      question: 'After a long rally, the biggest-volume candle in months prints with a long upper wick. What is a common read?',
      options: [
        { label: 'Record volume always means the trend will keep going', value: 0 },
        { label: 'Buyers are certain to push higher next session', value: 1 },
        { label: 'Possible buying climax — watch whether price fails to make new highs', value: 2 },
        { label: 'Volume says nothing at the top of a move', value: 3 },
      ],
      answer: 2,
      explain: 'Huge volume with a rejection wick late in a move can mark <strong>exhaustion</strong>: late buyers meet heavy selling. It is a warning, not a guarantee — confirm with structure.',
    },
  },
  {
    title: 'Caveats',
    render(el) {
      el.append(takeaway(['Climax volume can mark exhaustion as well as breakouts.', 'Drill in Volume Verdict.', 'Always pair volume with price structure.']));
    },
  },
];


export default {
  id: 'volume',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'Volume as participation: confirming breakouts, spotting thin traps, and reading climax vs dry-up.',
      steps,
    });
    return () => shell.destroy();
  },
};
