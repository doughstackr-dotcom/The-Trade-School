// support-resistance — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, checklistStep, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { chartScenario } from '../core/patterns.js';


function levelStory(rng) {
  const sc = chartScenario('double-bottom', { seed: rng.int(1, 1e9), count: 90, after: 14, outcome: 'success' });
  const c = sc.candles;
  // Support is the two bottoms; sc.level is the neckline (the peak between them) above.
  const [b1, b2] = sc.keyPoints.filter((k) => /^Bottom/.test(k.label));
  const lvl = Math.min(b1.price, b2.price);
  return {
    candles: c,
    frames: [
      { to: b1.idx + 3, caption: 'Price falls into a level where buyers previously appeared.' },
      { to: b2.idx + 3, title: 'Support holds.', caption: 'A second test finds buyers again. Two touches define a zone, not a single tick.',
        overlays: [{ type: 'hline', price: lvl, color: 'bull', label: 'Support' }] },
      { to: sc.breakoutIdx + 1, title: 'Break of the neckline.', caption: 'Resistance above gives way. Old resistance can flip to support on a retest.',
        overlays: [
          { type: 'hline', price: sc.level, color: 'accent', dashed: true, label: 'Neckline' },
          { type: 'marker', idx: sc.breakoutIdx, position: 'above', text: 'Break', color: 'accent' },
        ] },
      { to: c.length, caption: 'Levels fail. Trade the reaction you planned — never assume a zone is sacred.' },
    ],
  };
}

const steps = [
  {
    title: 'Zones, not laser lines',
    render(el) {
      el.append(
        h('p', null, 'Support is where buying interest has shown up; resistance is where selling interest has shown up. Draw ', h('strong', null, 'zones'), ' that cover the wicks and bodies that matter.'),
        takeaway(['More touches = more watched — and sometimes more likely to break when they finally go.', 'Round numbers attract orders.', 'A broken support often becomes resistance (and vice versa).']),
      );
    },
  },
  storyStep({ title: 'Support, retest mindset', story: levelStory }),
  checklistStep({
    title: 'Is this a usable level?',
    example: (rng) => {
      const sc = chartScenario('double-bottom', { seed: rng.int(1, 1e9), count: 88, after: 10 });
      // The zone is the two bottoms (sc.level is the neckline above them).
      const sup = Math.min(...sc.keyPoints.filter((k) => /^Bottom/.test(k.label)).map((k) => k.price));
      return { candles: sc.candles, visible: Math.min(sc.breakoutIdx, sc.candles.length - 1), sc, sup };
    },
    items: [
      { label: 'At least two clear reactions', detail: 'Bounces or rejections at similar prices.',
        overlay: (chart, ex) => chart.addHLine({ price: ex.sup, color: 'accent', dashed: true, label: 'Zone' }) },
      { label: 'Visible on your trading timeframe', detail: 'A 1-minute blip is not daily support.',
        overlay: () => {} },
      { label: 'You know what invalidates it', detail: 'A close through the zone ends the idea.',
        overlay: (chart, ex) => chart.addHLine({ price: ex.sup * 0.99, color: 'bear', dashed: true, label: 'Invalid' }) },
    ],
  }),
  {
    title: 'Quick check',
    quiz: {
      question: 'Price closes clearly through support on rising volume. Best next idea?',
      options: [
        { label: 'Treat the old support as potential resistance; wait for a reaction', value: 0 },
        { label: 'Buy immediately because it must bounce back', value: 1 },
        { label: 'Delete the level and never use levels again', value: 2 },
        { label: 'Double size with no stop', value: 3 },
      ],
      answer: 0,
      explain: '<strong>Role reversal.</strong> Broken support often acts as resistance on the way back. Plan the retest; do not blindly fade or chase.',
    },
  },
  {
    title: 'Caveats',
    render(el) {
      el.append(takeaway(['Crowded levels can stop-run before reversing.', 'Practice marking zones in Level Hunter.', 'Combine with trend in later units.']));
    },
  },
];


export default {
  id: 'support-resistance',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'Support and resistance as zones where orders cluster — tests, flips, and why round numbers matter.',
      steps,
    });
    return () => shell.destroy();
  },
};
