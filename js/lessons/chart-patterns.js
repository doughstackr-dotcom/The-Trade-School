// chart-patterns — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, realExampleStep, compareStep, figure, takeaway, textbookExample } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { chartScenario } from '../core/patterns.js';
import { fromPath } from '../core/data.js';


function patternOverlays(sc, { markers = true } = {}) {
  const ov = [];
  if (sc.neckline && Number.isFinite(sc.neckline.x1)) {
    ov.push({
      type: 'segment',
      a: { idx: sc.neckline.x1, price: sc.neckline.y1 },
      b: { idx: sc.neckline.x2, price: sc.neckline.y2 },
      color: 'accent', dashed: true, label: 'Neckline',
    });
  }
  if (sc.boundaries) {
    for (const side of ['upper', 'lower']) {
      const b = sc.boundaries[side];
      if (!b) continue;
      ov.push({
        type: 'segment',
        a: { idx: b.x1, price: b.y1 },
        b: { idx: b.x2, price: b.y2 },
        color: 'accent', dashed: true,
      });
    }
  }
  if (markers) {
    for (const k of sc.keyPoints || []) {
      if (/^breakout$/i.test(k.label) || /^flag$/i.test(k.label) || /^neckline$/i.test(k.label)) continue;
      const below = /low|bottom|trough|start/i.test(k.label);
      ov.push({
        type: 'marker', idx: k.idx, position: below ? 'below' : 'above',
        text: k.label.replace(/^Flagpole /, ''), color: 'accent',
      });
    }
  }
  if (sc.breakoutIdx != null) {
    ov.push({ type: 'marker', idx: sc.breakoutIdx, position: 'above', shape: 'dot', color: 'accent' });
  }
  return ov;
}

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

/** Schematic H&S matching the quiz numbers (head 110, neck 100 → target 90). */
function measuredMoveSchematic() {
  const { candles, anchors } = fromPath(
    [[0, 100], [0.18, 108], [0.3, 100], [0.48, 110], [0.62, 100], [0.76, 107], [0.84, 99.5], [1, 90]],
    { seed: 5, count: 44, exact: true, noise: 0.2, wick: 0.45 },
  );
  const head = anchors[3];
  return miniChart(candles, {
    width: 640, height: 200, yPad: 0.14,
    ariaLabel: 'Head and shoulders measured move to 90',
    overlays: [
      { type: 'marker', idx: anchors[1].idx, position: 'above', text: 'LS', color: 'accent' },
      { type: 'marker', idx: head.idx, position: 'above', text: 'Head 110', color: 'bear' },
      { type: 'marker', idx: anchors[5].idx, position: 'above', text: 'RS', color: 'accent' },
      { type: 'hline', price: 100, color: 'accent', dashed: true, label: 'Neck 100' },
      { type: 'hline', price: 90, color: 'bear', label: 'Target 90' },
      { type: 'marker', idx: anchors[6].idx, position: 'below', text: 'Break', color: 'accent' },
    ],
  });
}

const steps = [
  compareStep({
    title: 'Continuation vs reversal',
    text: () => h('p', null,
      'Flags and pennants usually ', h('strong', null, 'continue'),
      ' the prior trend. Double tops / head & shoulders usually try to ',
      h('strong', null, 'reverse'),
      ' it. Triangles can go either way — trade the break.'),
    left: {
      title: 'Bull flag',
      verdict: 'neutral',
      tag: 'Continuation',
      example: () => {
        const sc = chartScenario('bull-flag', { seed: 12, count: 90, after: 14, outcome: 'success' });
        return { candles: sc.candles, overlays: patternOverlays(sc) };
      },
      points: [
        'Sharp pole, then a gentle counter-drift',
        'Break resumes the <strong>same</strong> direction',
        'Target ≈ pole height from the break',
      ],
    },
    right: {
      title: 'Double top',
      verdict: 'neutral',
      tag: 'Reversal',
      example: () => {
        const sc = chartScenario('double-top', { seed: 12, count: 90, after: 14, outcome: 'success' });
        return { candles: sc.candles, overlays: patternOverlays(sc) };
      },
      points: [
        'Two peaks near the same high (an “M”)',
        'Close below the neckline tries to <strong>flip</strong> the trend',
        'Target ≈ peak-to-neck height down',
      ],
    },
    after: () => takeaway([
      'Name the pattern only after the break that confirms it.',
      'Measured moves are guidelines.',
      'Failed patterns often travel far the other way.',
    ]),
  }),
  storyStep({ title: 'Bull flag walk-through', story: flagStory }),
  realExampleStep({
    title: 'Real chart patterns',
    kinds: ['bull-flag', 'bear-flag', 'double-top', 'double-bottom'],
    intervals: ['1d', '1w'],
  }),
  {
    title: 'Quick check',
    render(el) {
      el.append(
        figure(
          measuredMoveSchematic(),
          'Height = head − neckline = 10. Project that distance down from the break: <strong>100 − 10 = 90</strong>.',
          { label: 'Figure' },
        ),
      );
    },
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
    title: 'Quick check: confirmation',
    quiz: {
      question: 'A head and shoulders has formed, but price has not closed below the neckline yet. Best stance?',
      options: [
        { label: 'Short now — the pattern is complete once the right shoulder forms', value: 0 },
        { label: 'Buy — the right shoulder is a higher low', value: 1 },
        { label: 'Short now and aim for twice the pattern height', value: 2 },
        { label: 'Treat it as a potential pattern until a close below the neckline', value: 3 },
      ],
      answer: 3,
      explain: 'Until the neckline breaks, it is only a <strong>potential</strong> pattern — many resolve higher instead. Measured-move targets are rough guides, not promises.',
    },
  },
  {
    title: 'Caveats',
    render(el) {
      const sc = chartScenario('bull-flag', { seed: 19, count: 90, after: 16, outcome: 'fail' });
      el.append(
        figure(
          miniChart(sc.candles, {
            width: 640, height: 200, yPad: 0.12,
            ariaLabel: 'Failed bull flag breakout',
            overlays: [
              ...patternOverlays(sc, { markers: false }),
              { type: 'marker', idx: sc.breakoutIdx, position: 'above', text: 'Fake break', color: 'bear' },
              { type: 'hline', price: sc.target, color: 'bull', dashed: true, label: 'Missed target' },
            ],
          }),
          'Same shape, failed follow-through. Patterns are common knowledge — expect stop runs when the break reverses.',
          { label: 'Figure' },
        ),
        takeaway(['Patterns are common knowledge — expect stop runs.', 'Practice in Pattern Detective.', 'Risk the plan, not the cartoon target.']),
      );
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
