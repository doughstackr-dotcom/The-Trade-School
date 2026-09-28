// confluence-risk — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, compareStep, figure, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';
import { sma, closes as closesOf } from '../core/indicators.js';


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

function confluenceFigure(seed = 11) {
  const ts = trendSeries({ seed, count: 80, direction: 'up', swings: 3 });
  const c = ts.candles;
  const closes = closesOf(c);
  const loIdx = 12, hiIdx = 45;
  const zone = c[52].l;
  return miniChart(c, {
    width: 640, height: 200, yPad: 0.12,
    ariaLabel: 'Confluence of support, MA and fib',
    overlays: [
      { type: 'hline', price: zone, color: 'bull', label: 'Support' },
      { type: 'series', values: sma(closes, 20), color: 'ma2' },
      { type: 'fib', a: { idx: loIdx, price: c[loIdx].l }, b: { idx: hiIdx, price: c[hiIdx].h }, ratios: [0.5, 0.618], labels: false, zone: [0.5, 0.618] },
      { type: 'marker', idx: 55, position: 'below', text: 'Zone', color: 'accent' },
    ],
  });
}

function riskMathFigure() {
  const ts = trendSeries({ seed: 2, count: 56, direction: 'up', swings: 2 });
  // HLines are labelled to match the quiz numbers (entry 40 / stop 38 / target 44).
  return miniChart(ts.candles, {
    width: 640, height: 190, yPad: 0.16,
    ariaLabel: 'Entry stop and 2R target for position sizing',
    overlays: [
      { type: 'hline', price: ts.candles[40]?.c ?? entry, color: 'accent', label: 'Entry 40' },
      { type: 'hline', price: (ts.candles[40]?.c ?? entry) - 2, color: 'bear', label: 'Stop 38 (−1R)' },
      { type: 'hline', price: (ts.candles[40]?.c ?? entry) + 4, color: 'bull', label: 'Target 44 (+2R)' },
      { type: 'marker', idx: 40, position: 'below', text: '100 sh', color: 'accent' },
    ],
  });
}

const steps = [
  {
    title: 'What confluence means',
    render(el) {
      el.append(
        h('p', null, 'Confluence = several ', h('strong', null, 'independent'), ' tools pointing at the same idea (trend + level + trigger). Correlated copies of the same idea (five MAs) are not confluence.'),
        figure(
          confluenceFigure(),
          'Trend + prior support + rising MA + Fib cluster in one price area — independent stories, one zone.',
          { label: 'Figure 1' },
        ),
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
        figure(
          riskMathFigure(),
          'Size = risk $ ÷ (entry − stop). Here $200 ÷ $2 = 100 shares. Target at +2R frames whether the setup is worth taking.',
          { label: 'Figure' },
        ),
        takeaway(['Risk % first; size second.', 'Reward:risk (e.g. 2R+) frames whether a setup is worth taking.', 'Expectancy = win%×avg win − loss%×avg loss.']),
      );
    },
  },
  {
    title: 'Quick check',
    render(el) {
      el.append(
        figure(
          riskMathFigure(),
          '$20,000 × 1% = $200 risk. $2 per share → <strong>100 shares</strong>.',
          { label: 'Figure' },
        ),
      );
    },
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
  compareStep({
    title: 'Caveats',
    text: 'Perfect confluence can still lose. Size so a loss is planned — never random.',
    left: {
      title: 'Confluence works',
      verdict: 'good',
      tag: 'Process win',
      example: () => {
        const ts = trendSeries({ seed: 7, count: 70, direction: 'up', swings: 3 });
        const lvl = ts.candles[40].l;
        return {
          candles: ts.candles,
          overlays: [
            { type: 'hline', price: lvl, color: 'bull', label: 'Zone' },
            { type: 'marker', idx: 45, position: 'below', text: 'Entry', color: 'accent' },
            { type: 'marker', idx: 65, position: 'above', text: '+2R', color: 'bull' },
          ],
        };
      },
      points: ['Independent reasons lined up', 'Stop beyond the zone', 'Outcome favourable — still sized at 1R'],
    },
    right: {
      title: 'Confluence fails',
      verdict: 'bad',
      tag: 'Planned loss',
      example: () => {
        const ts = trendSeries({ seed: 18, count: 70, direction: 'up', swings: 3 });
        const lvl = ts.candles[42].l;
        return {
          candles: ts.candles,
          overlays: [
            { type: 'hline', price: lvl, color: 'bull', label: 'Zone' },
            { type: 'marker', idx: 48, position: 'below', text: 'Entry', color: 'accent' },
            { type: 'marker', idx: 58, position: 'below', text: 'Stopped −1R', color: 'bear' },
          ],
        };
      },
      points: ['Same checklist, opposite result', 'Loss capped at planned risk', 'Drill sizing in Risk Manager'],
    },
    after: () => takeaway(['Perfect confluence can still lose.', 'Drill sizing in Risk Manager.']),
  }),
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
