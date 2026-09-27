// confluence-risk — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { trendSeries } from '../core/data.js';


function confStory(rng) {
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: 90, direction: 'up', swings: 3 });
  const c = ts.candles;
  const lvl = c[50].l;
  return {
    candles: c,
    frames: [
      { to: 45, caption: 'HTF uptrend already established — bias long.' },
      { to: 60, title: 'Confluence zone.', caption: 'Pullback into prior support + rising MA area + Fib cluster. Multiple stories, one price.',
        overlays: [{ type: 'hline', price: lvl, color: 'bull', label: 'Zone' }] },
      { to: 70, title: 'Trigger.', caption: 'A candle pattern or break of a micro-level times the entry. Stop goes beyond the zone.',
        overlays: [
          { type: 'hline', price: lvl, color: 'bull', label: 'Zone' },
          { type: 'marker', idx: 68, position: 'below', text: 'Trigger', color: 'accent' },
        ] },
      { to: c.length, caption: 'Position size = (account risk $) ÷ (entry − stop). Confluence raises quality, not certainty.' },
    ],
  };
}

const steps = [
  {
    title: 'What confluence means',
    render(el) {
      el.append(
        h('p', null, 'Confluence = several ', h('strong', null, 'independent'), ' tools pointing at the same idea (trend + level + trigger). Correlated copies of the same idea (five MAs) are not confluence.'),
        takeaway(['Quality over quantity of signals.', 'Still require a stop and a size rule.', 'No confluence? Passing is a position.']),
      );
    },
  },
  storyStep({ title: 'Bias → zone → trigger → size', story: confStory }),
  {
    title: 'Risk math',
    render(el) {
      el.append(
        h('p', null, 'Example: $20,000 account, 1% risk → $200. Entry 40, stop 38 → $2 risk/share → ', h('strong', null, '100 shares'), '.'),
        takeaway(['Risk % first; size second.', 'Reward:risk (e.g. 2R+) frames whether a setup is worth taking.', 'Expectancy = win%×avg win − loss%×avg loss.']),
      );
    },
  },
  {
    title: 'Quick check',
    quiz: {
      question: 'Account $20,000, risk 1%. Entry 40.00, stop 38.00. Size?',
      options: [
        { label: '100 shares', value: 0 },
        { label: '200 shares', value: 1 },
        { label: '50 shares', value: 2 },
        { label: '500 shares', value: 3 },
      ],
      answer: 0,
      explain: '1% = $200. Risk/share = $2. $200 ÷ $2 = <strong>100 shares</strong>.',
    },
  },
  {
    title: 'Caveats',
    render(el) {
      el.append(takeaway(['Perfect confluence can still lose.', 'Drill sizing in Risk Manager.']));
    },
  },
];


export default {
  id: 'confluence-risk',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'Stack independent reasons (confluence), time your entry, and size risk so a loss is planned — never random.',
      steps,
    });
    return () => shell.destroy();
  },
};
