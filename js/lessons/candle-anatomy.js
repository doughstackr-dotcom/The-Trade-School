// Anatomy of a candlestick — OHLC, body, wicks, and what colour really means.
import { LessonShell, storyStep, checklistStep, figure, takeaway } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { candleScenario } from '../core/patterns.js';

function anatomyStory(rng) {
  const sc = candleScenario('hammer', { seed: rng.int(1, 1e9), leadIn: 20, after: 6 });
  const { candles } = sc;
  const i = sc.start;
  const c = candles[i];
  return {
    candles,
    frames: [
      { to: i, caption: 'Price has been falling. One period is about to tell a story in four numbers: open, high, low, close.' },
      {
        to: i + 1,
        title: 'Open → close.',
        caption: 'The body spans open to close. Green/white usually means close > open; red/black means close < open.',
        overlays: [{ type: 'box', from: i, to: i, color: 'bull', label: 'Body' }],
        focus: [Math.max(0, i - 4), i],
        zoom: true,
      },
      {
        to: i + 1,
        title: 'The wicks.',
        caption: `High ${c.h.toFixed(2)}, low ${c.l.toFixed(2)}. Wicks are prices that traded and were rejected before the close.`,
        overlays: [
          { type: 'marker', idx: i, position: 'below', shape: 'ring', text: 'Long lower wick', color: 'bull' },
          { type: 'hline', price: c.h, color: 'accent', dashed: true, label: 'High' },
          { type: 'hline', price: c.l, color: 'accent', dashed: true, label: 'Low' },
        ],
      },
      { to: candles.length, caption: 'One candle is a summary of a fight. Context (trend, level) decides whether that fight matters.' },
    ],
  };
}

export default {
  id: 'candle-anatomy',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'Every candle compresses open, high, low and close into a body and two wicks. Learn to read that story before chasing patterns.',
      steps: [
        {
          title: 'Four numbers, one picture',
          render(el) {
            const sc = candleScenario('doji', { seed: 11, leadIn: 16, after: 3 });
            el.append(
              h('p', { html: 'A candlestick plots <strong>OHLC</strong> for one period (1 minute, 1 day, 1 week — same idea).' }),
              figure(
                miniChart(sc.candles, {
                  width: 640, height: 220, yPad: 0.16,
                  overlays: [{ type: 'box', from: sc.start, to: sc.end, color: 'accent', label: 'Doji' }],
                  ariaLabel: 'Chart ending in a doji candle',
                }),
                'When open ≈ close, the body shrinks into a doji: a period of indecision.',
                { label: 'Figure 1' },
              ),
              takeaway([
                'Body = distance between open and close.',
                'Upper wick = high − max(open, close); lower wick = min(open, close) − low.',
                'Colour is convention — always confirm with the numbers if a chart theme flips.',
              ]),
            );
          },
        },
        storyStep({
          title: 'Reading a single candle',
          text: 'Step through a hammer after a decline. Notice body vs wick.',
          story: anatomyStory,
        }),
        checklistStep({
          title: 'Is this candle a hammer shape?',
          text: 'Tick each rule. Shape alone is not a trade — context comes next.',
          example: (rng) => {
            const sc = candleScenario('hammer', { seed: rng.int(1, 1e9), leadIn: 22, after: 4 });
            return { candles: sc.candles, visible: sc.end + 1, sc };
          },
          items: [
            {
              label: 'It appears after a decline',
              detail: 'Lower highs / lower lows into the candle.',
              overlay: (chart, ex) => chart.addSegment({
                a: { idx: Math.max(0, ex.sc.start - 12), price: ex.candles[Math.max(0, ex.sc.start - 12)].h },
                b: { idx: ex.sc.start, price: ex.candles[ex.sc.start].l },
                color: 'bear', arrow: true, dashed: true, label: 'Decline',
              }),
            },
            {
              label: 'Lower wick at least 2× the body',
              detail: 'Buyers rejected the lows hard.',
              overlay: (chart, ex) => chart.addMarker({ idx: ex.sc.start, position: 'below', shape: 'ring', text: 'Long wick', color: 'bull' }),
            },
            {
              label: 'Little or no upper wick',
              detail: 'Close sits near the high of the period.',
              overlay: (chart, ex) => chart.addBox({ from: ex.sc.start, to: ex.sc.end, color: 'bull', label: 'Hammer' }),
            },
          ],
        }),
        {
          title: 'Quick check',
          quiz: {
            question: 'Open 100, high 101, low 95, close 96. How long is the upper wick?',
            options: [
              { label: '1 point', value: 0 },
              { label: '5 points', value: 1 },
              { label: '4 points', value: 2 },
              { label: '6 points', value: 3 },
            ],
            answer: 0,
            explain: 'Bearish candle: top of body is the open (100). Upper wick = high − open = 101 − 100 = <strong>1</strong>.',
          },
        },
        {
          title: 'Quick check: reading the wick',
          quiz: {
            question: 'A candle opens at 50.00, trades down to 47.00, and closes at 49.80 near its high of 50.10. What does the long lower wick tell you?',
            options: [
              { label: 'Sellers controlled the whole period', value: 0 },
              { label: 'Price dipped to 47 but buyers pushed it most of the way back before the close', value: 1 },
              { label: 'It is a bullish candle because the wick is long', value: 2 },
              { label: 'The period closed at its low of 47', value: 3 },
            ],
            answer: 1,
            explain: 'The lower wick marks prices that were <strong>visited and rejected</strong>. The body is still small and red (close 49.80 below open 50.00), so the period ended slightly lower — the wick shows the fight, the body shows the result.',
          },
        },
        {
          title: 'What candles cannot tell you',
          render(el) {
            el.append(
              h('p', null, 'A candle hides the path inside the period: it does not show whether the high came before the low.'),
              takeaway([
                'Same OHLC can come from very different intra-period paths.',
                'Patterns fail — treat candles as evidence, not prophecy.',
                'Next: build candles yourself in Candle Builder, then learn named patterns.',
              ]),
              h('div', { class: 'callout callout--tip' }, icon('info'),
                h('p', null, 'On lower timeframes, noise dominates. Many readers prefer daily candles for structure and use intraday only for timing.')),
            );
          },
        },
      ],
    });
    return () => shell.destroy();
  },
};
