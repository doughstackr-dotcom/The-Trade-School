// confluence-risk — full educational lesson (LessonShell + §12.5 helpers).
import { LessonShell, storyStep, compareStep, figure, takeaway } from '../core/lesson-kit.js';
import { h } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { trendSeries, fromPath } from '../core/data.js';
import { sma, closes as closesOf } from '../core/indicators.js';


/** Entry: the first candle after the zone touch at idx that closes above the prior candle's high. */
function triggerAfter(c, idx) {
  for (let i = idx + 1; i < Math.min(c.length, idx + 6); i++) if (c[i].c > c[i - 1].h) return i;
  return Math.min(c.length - 1, idx + 1);
}

function confStory(rng) {
  const ts = trendSeries({ seed: rng.int(1, 1e9), count: 90, direction: 'up', swings: 3 });
  const c = ts.candles;
  // Swings H, L, HH, HL…: the zone is the pullback low (HL) after the first higher high.
  const [, , hh, pb] = ts.swings;
  const lvl = pb.price;
  const trig = triggerAfter(c, pb.idx);
  return {
    candles: c,
    frames: [
      { to: hh.idx + 3, caption: 'HTF uptrend already established — bias long.' },
      { to: pb.idx + 1, title: 'Confluence zone.', caption: 'Pullback into prior support + rising MA area + Fib cluster. Multiple stories, one price.',
        overlays: [{ type: 'hline', price: lvl, color: 'bull', label: 'Zone' }] },
      { to: trig + 2, title: 'Trigger.', caption: 'A candle pattern or break of a micro-level times the entry. Stop goes beyond the zone.',
        overlays: [
          { type: 'marker', idx: trig, position: 'below', text: 'Trigger', color: 'accent' },
        ] },
      { to: c.length, caption: 'Position size = (account risk $) ÷ (entry − stop). Confluence raises quality, not certainty.' },
    ],
  };
}

function confluenceFigure(seed = 11) {
  const ts = trendSeries({ seed, count: 80, direction: 'up', swings: 3 });
  const c = ts.candles;
  const closes = closesOf(c);
  // Swings H, L, HH, HL: the prior high (old resistance → support), the impulse L → HH for the
  // Fib, and the pullback low that lands in that area.
  const [h0, lo, hi, pb] = ts.swings;
  const loIdx = lo.idx, hiIdx = hi.idx;
  const zone = h0.price;
  return miniChart(c, {
    width: 640, height: 200, yPad: 0.12,
    ariaLabel: 'Confluence of support, MA and fib',
    overlays: [
      { type: 'hline', price: zone, color: 'bull', label: 'Support' },
      { type: 'series', values: sma(closes, 20), color: 'ma2' },
      { type: 'fib', a: { idx: loIdx, price: c[loIdx].l }, b: { idx: hiIdx, price: c[hiIdx].h }, ratios: [0.5, 0.618], labels: false, zone: [0.5, 0.618] },
      { type: 'marker', idx: pb.idx, position: 'below', text: 'Zone', color: 'accent' },
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
        const c = ts.candles;
        const pb = ts.swings[3]; // H, L, HH, HL: the pullback low is the zone
        const lvl = pb.price;
        const entry = triggerAfter(c, pb.idx);
        const target = c[entry].c + 2 * (c[entry].c - lvl * 0.998); // stop just beyond the zone
        const hit = c.findIndex((k, i) => i > entry && k.h >= target);
        return {
          candles: c,
          overlays: [
            { type: 'hline', price: lvl, color: 'bull', label: 'Zone' },
            { type: 'marker', idx: entry, position: 'below', text: 'Entry', color: 'accent' },
            { type: 'marker', idx: hit, position: 'above', text: '+2R', color: 'bull' },
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
        // Uptrend, pullback into the zone, a trigger, then a break below the zone (an uptrend
        // trendSeries never breaks its pullback lows, so this path is drawn explicitly).
        const { candles: c, anchors } = fromPath([[0, 100], [0.38, 105], [0.55, 102.6], [0.63, 103.7], [0.85, 101.2], [1, 101.7]], { seed: 18, count: 70 });
        const lvl = anchors[2].price;
        const entry = triggerAfter(c, anchors[2].idx);
        const stopped = c.findIndex((k, i) => i > entry && k.l <= lvl * 0.998);
        return {
          candles: c,
          overlays: [
            { type: 'hline', price: lvl, color: 'bull', label: 'Zone' },
            { type: 'marker', idx: entry, position: 'below', text: 'Entry', color: 'accent' },
            { type: 'marker', idx: stopped, position: 'below', text: 'Stopped −1R', color: 'bear' },
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
