// chart-patterns — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, realExampleStep, takeaway, textbookExample } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';


function flagStory(rng) {
  const ex = textbookExample(['bull-flag'], rng);
  const m = ex.setup.meta;
  const d = ex.decisionIdx;
  const line = (l) => ({ type: 'segment', a: { idx: l.x1, price: l.y1 }, b: { idx: l.x2, price: l.y2 }, color: 'accent', dashed: true });
  const stop = Math.min(...ex.candles.slice(m.poleTop.idx, d).map((k) => k.l));
  return {
    candles: ex.candles,
    indicators: { volume: true },
    frames: [
      { to: m.poleStart.idx + 1, caption: 'Quiet tape before the impulse.' },
      { to: m.poleTop.idx + 1, title: 'The pole.', caption: 'A fast one-way rally — the measured-move reference.',
        overlays: [{ type: 'segment', a: m.poleStart, b: m.poleTop, color: 'bull', arrow: true, label: 'Pole' }],
        focus: [m.poleStart.idx, m.poleTop.idx] },
      { to: d, title: 'The flag.', caption: 'Gentle counter-drift on lighter volume.',
        overlays: [line(m.upper), line(m.lower)], focus: [m.poleTop.idx, d - 1], zoom: true },
      { to: d + 1, title: 'Breakout.', caption: 'Close above the flag; stop under the flag low.',
        overlays: [
          { type: 'marker', idx: d, position: 'above', text: 'Entry', color: 'accent' },
          { type: 'hline', price: stop, color: 'bear', label: 'Stop' },
        ] },
      { to: ex.candles.length, caption: 'Target ≈ pole height added to the break. Many flags never get there.',
        overlays: [{ type: 'hline', price: m.target, color: 'bull', label: 'Target' }] },
    ],
  };
}

const steps = [
  {
    title: 'Continuation vs reversal',
    render(el) {
      el.append(
        h('p', null, 'Flags and pennants usually ', h('strong', null, 'continue'), ' the prior trend. Double tops / head & shoulders usually try to ', h('strong', null, 'reverse'), ' it. Triangles can go either way — trade the break.'),
        takeaway(['Name the pattern only after the break that confirms it.', 'Measured moves are guidelines.', 'Failed patterns often travel far the other way.']),
      );
    },
  },
  storyStep({ title: 'Bull flag walk-through', story: flagStory }),
  realExampleStep({
    title: 'Real chart patterns',
    kinds: ['bull-flag', 'bear-flag', 'double-top', 'double-bottom'],
    intervals: ['1d', '1w'],
  }),
  {
    title: 'Quick check',
    quiz: {
      question: 'Head at 110, neckline at 100, close below neckline. Measured target?',
      options: [
        { label: '90', value: 0 },
        { label: '110', value: 1 },
        { label: '105', value: 2 },
        { label: '80', value: 3 },
      ],
      answer: 0,
      explain: 'Height = 10. Project down from the break: 100 − 10 = <strong>90</strong>.',
    },
  },
  {
    title: 'Caveats',
    render(el) {
      el.append(takeaway(['Patterns are common knowledge — expect stop runs.', 'Practice in Pattern Detective.', 'Risk the plan, not the cartoon target.']));
    },
  },
];


export default {
  id: 'chart-patterns',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'Classic chart patterns: flags, triangles, double tops/bottoms, head and shoulders — with measured moves and failure modes.',
      steps,
    });
    return () => shell.destroy();
  },
};
