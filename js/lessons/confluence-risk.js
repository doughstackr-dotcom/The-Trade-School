// confluence-risk — full educational lesson (LessonShell + §12.5 helpers).
// Builds on the Beginner risk-basics lesson (sizing, R, expectancy): adds confluence, ATR-based
// stops and testing an idea (backtest / forward test) before trusting it.
import { LessonShell, storyStep, compareStep, figure, takeaway } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';
import { sma, atr as atrOf, closes as closesOf } from '../core/indicators.js';


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
  const ts = trendSeries({ seed: 2, count: 56, start: 40, direction: 'up', swings: 2 });
  // Illustrative: lines are labelled with the quiz numbers (entry 40 / stop 38 / target 44) and drawn
  // at those relative distances around the chart's own close.
  const px = ts.candles[40].c;
  const unit = px * 0.05;
  return miniChart(ts.candles, {
    width: 640, height: 190, yPad: 0.16,
    ariaLabel: 'Entry stop and 2R target for position sizing',
    overlays: [
      { type: 'hline', price: px, color: 'accent', label: 'Entry 40' },
      { type: 'hline', price: px - unit, color: 'bear', label: 'Stop 38 (−1R)' },
      { type: 'hline', price: px + unit * 2, color: 'bull', label: 'Target 44 (+2R)' },
      { type: 'marker', idx: 40, position: 'below', text: '100 sh', color: 'accent' },
    ],
  });
}

/** Structure stop vs a 2×ATR stop on the same entry. Prices are computed from the chart. */
function atrStopFigure() {
  const ts = trendSeries({ seed: 5, count: 70, start: 40, direction: 'up', swings: 3 });
  const c = ts.candles;
  const a = atrOf(c, 14);
  const i = 50;
  const entry = c[i].c;
  const atrStop = entry - 2 * a[i];
  let swingLow = Infinity;
  for (let k = i - 10; k <= i; k++) swingLow = Math.min(swingLow, c[k].l);
  return {
    atr: a[i], entry, atrStop, swingLow,
    chart: miniChart(c, {
      width: 640, height: 200, yPad: 0.14,
      ariaLabel: 'Entry with a 2 ATR stop and a structure stop below the recent swing low',
      overlays: [
        { type: 'hline', price: entry, color: 'accent', label: `Entry ${entry.toFixed(2)}` },
        { type: 'hline', price: atrStop, color: 'bear', dashed: true, label: `2×ATR ${atrStop.toFixed(2)}` },
        { type: 'hline', price: swingLow, color: 'bear', label: `Below swing low ${swingLow.toFixed(2)}` },
        { type: 'marker', idx: i, position: 'above', text: 'Entry', color: 'accent' },
      ],
    }),
  };
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
    title: 'Sizing recap',
    render(el) {
      el.append(
        h('p', null, 'The Beginner unit “Risk & position sizing” covers the maths in full: risk per trade, size from the stop, R-multiples, expectancy and drawdowns. The short version: ',
          h('strong', null, 'size = risk $ ÷ (entry − stop)'), '.'),
        figure(
          riskMathFigure(),
          '$20,000 account, 1% risk → $200. Entry 40, stop 38 → $2 per share → <strong>100 shares</strong>. The +2R target frames whether the setup is worth taking.',
          { label: 'Figure' },
        ),
        takeaway(['Confluence decides <em>whether</em> to trade; the stop decides <em>how much</em>.', 'Expectancy = win% × avg win − loss% × avg loss, judged over many trades.']),
      );
    },
    quiz: {
      question: 'Account $20,000, risk 1%. Entry 40.00, stop 38.00. Size?',
      options: [
        { label: '5 shares — $200 ÷ the $40 entry price', value: 0 },
        { label: '200 shares', value: 1 },
        { label: '100 shares', value: 2 },
        { label: '500 shares — $20,000 ÷ $40', value: 3 },
      ],
      answer: 2,
      explain: '1% = $200. Risk per share = $2. $200 ÷ $2 = <strong>100 shares</strong>. (200 shares risks 2%; dividing by the entry price or the whole account ignores the stop.)',
    },
  },
  {
    title: 'ATR-based stops',
    render(el) {
      const f = atrStopFigure();
      el.append(
        h('p', null,
          h('strong', null, 'ATR'), ' (Average True Range) measures how far price typically moves per candle. An ATR stop sits a multiple of ATR from entry (1.5–3× is common), so it is wider in wild markets and tighter in quiet ones — instead of a fixed number of cents that ignores volatility.'),
        figure(f.chart,
          `ATR(14) ≈ ${f.atr.toFixed(2)}. A 2×ATR stop sits at ${f.atrStop.toFixed(2)}; a structure stop below the recent swing low sits at ${f.swingLow.toFixed(2)}. Whichever you choose, size the position from that distance.`,
          { label: 'Figure' }),
        h('p', null,
          'ATR does not know where your idea is wrong — structure does. Many traders use ATR as a sanity check: a stop within about 1 ATR of entry is easily hit by normal noise; a structure stop many ATRs away may call for a smaller position or a pass. ',
          'A ', h('strong', null, 'trailing'), ' ATR stop (moved up as price rises, never down) is one common way to manage a trend without guessing the top.'),
        takeaway([
          'Wider ATR stop → smaller position, same dollar risk.',
          'Combine them: stop beyond structure, then check it is at least about 1 ATR away.',
          'ATR changes over time; recompute it rather than reusing an old number.',
        ]),
      );
    },
    quiz: {
      question: 'ATR(14) doubles after a news shock. You keep 1% risk and a 2×ATR stop. What should happen to your position size?',
      options: [
        { label: 'Double it — bigger moves mean bigger profits', value: 0 },
        { label: 'Roughly halve it — the stop is twice as far away', value: 1 },
        { label: 'Keep it and tighten the stop to 1×ATR instead', value: 2 },
        { label: 'Keep it — ATR only affects the target', value: 3 },
      ],
      answer: 1,
      explain: 'Size = risk $ ÷ stop distance. The stop distance doubled, so size should <strong>roughly halve</strong> to keep the same dollar risk. Tightening the stop instead puts it inside normal noise.',
    },
  },
  {
    title: 'Test the idea before trusting it',
    render(el) {
      el.append(
        h('p', null,
          'A ', h('strong', null, 'backtest'), ' applies fixed rules to past data to see how they would have done. A ',
          h('strong', null, 'forward test'), ' (paper trading, or very small size) runs the same rules on new data as it arrives. Both estimate expectancy; neither guarantees it.'),
        h('ul', { class: 'lesson-list' },
          h('li', null, h('strong', null, 'Overfitting'), ' — tuning rules until they fit the past perfectly. Many tweaks plus few trades gives a curve that describes noise. Keep rules simple and check them on data you did not tune on.'),
          h('li', null, h('strong', null, 'Look-ahead bias'), ' — using information that was not available at the time, such as a candle’s close to decide an entry during that candle, or data revised later.'),
          h('li', null, h('strong', null, 'Survivorship bias'), ' — testing only on today’s index members or coins that still exist. The ones that failed drop out of the sample and flatter the results.'),
          h('li', null, h('strong', null, 'Missing costs'), ' — ignoring spread, fees and slippage can turn a small positive edge negative.'),
          h('li', null, h('strong', null, 'Small samples'), ' — 20 trades say very little. Look for many trades across different market conditions.'),
        ),
        h('div', { class: 'callout callout--tip' }, icon('info'),
          h('p', null, 'Past results, real or simulated, do not guarantee future results. A test that looks too good usually has a bias hiding in it.')),
        takeaway(['Write the rules first, then test — not the other way round.', 'Forward-test before risking meaningful money.', 'Journal live results in R and compare them with the test.']),
      );
    },
    quiz: {
      question: 'After 40 rounds of tweaking, a strategy shows a 90% win rate on two years of data. What is the most likely explanation?',
      options: [
        { label: 'A durable edge — time to scale up', value: 0 },
        { label: 'Two years of data is enough to prove it works', value: 1 },
        { label: 'A 90% win rate guarantees positive expectancy', value: 2 },
        { label: 'Overfitting (maybe look-ahead or missing costs too) — test on unseen data', value: 3 },
      ],
      answer: 3,
      explain: 'Many tweaks on one data set usually fit noise. <strong>Test on data you did not tune on</strong>, include costs and check for look-ahead — and remember win rate alone says nothing about expectancy.',
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
      intro: 'Stack independent reasons (confluence), time your entry, place stops with structure and ATR, and test an idea before trusting it — building on the Beginner risk & sizing unit.',
      steps,
    });
    return () => shell.destroy();
  },
};
