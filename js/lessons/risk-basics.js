// risk-basics — Beginner: risk per trade, position sizing, R, expectancy, drawdown, leverage, costs.
// The Advanced confluence-risk lesson builds on this one (confluence, ATR stops, backtesting).
import { LessonShell, figure, takeaway } from '../core/lesson-kit.js';
import { h, icon } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import { trendSeries } from '../core/data.js';

const usd = (n, d = 0) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const pct = (n, d = 1) => `${(n * 100).toFixed(d)}%`;

/** Small data table (rows of cells; first row = header). Numbers right-aligned via .num. */
function table(caption, head, rows) {
  return h('div', { class: 'table-scroll card card--flush' },
    h('table', { class: 'data-table' },
      h('caption', { class: 'visually-hidden' }, caption),
      h('thead', null, h('tr', null, head.map((c, i) => h('th', { scope: 'col', class: i ? 'num' : null }, c)))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h('td', { class: i ? 'num mono' : null }, c)))))));
}

function disclaimer() {
  return h('div', { class: 'callout callout--tip' }, icon('info'),
    h('p', null, 'Educational examples with made-up numbers — not financial advice. Real accounts add fees, taxes, gaps and broker rules.'));
}

/**
 * Entry / stop / target drawn on a generated uptrend. Prices and share counts are computed from
 * the chart itself, so the labels always match the lines.
 */
function sizingFigure({ seed = 2, account = 10000, riskPct = 0.01, stopBack = 12 } = {}) {
  const ts = trendSeries({ seed, count: 56, start: 50, direction: 'up', swings: 2 });
  const c = ts.candles;
  const i = 40;
  const entry = c[i].c;
  let stop = Infinity;
  for (let k = i - stopBack; k <= i; k++) stop = Math.min(stop, c[k].l);
  stop -= (entry - stop) * 0.1; // a little room beyond the recent swing low
  const perShare = entry - stop;
  const riskUsd = account * riskPct;
  const shares = Math.floor(riskUsd / perShare);
  const target = entry + perShare * 2;
  const chart = miniChart(c, {
    width: 640, height: 200, yPad: 0.16,
    ariaLabel: 'Entry, stop below the recent swing low and a 2R target',
    overlays: [
      { type: 'hline', price: entry, color: 'accent', label: `Entry ${entry.toFixed(2)}` },
      { type: 'hline', price: stop, color: 'bear', label: `Stop ${stop.toFixed(2)} (−1R)` },
      { type: 'hline', price: target, color: 'bull', label: `Target ${target.toFixed(2)} (+2R)` },
      { type: 'marker', idx: i, position: 'below', text: `${shares} sh`, color: 'accent' },
    ],
  });
  return { chart, entry, stop, perShare, riskUsd, shares, account, riskPct };
}

const steps = [
  {
    title: 'Why risk comes before setups',
    render(el) {
      const keep = (r, n) => 1 - (1 - r) ** n;
      el.append(
        h('p', null,
          'Every trade needs a ', h('strong', null, 'stop'), ': the price where your idea is proven wrong and you get out. ',
          'The distance from entry to stop is the most you plan to lose on that trade. You decide it ', h('em', null, 'before'), ' you enter.'),
        h('p', null,
          'A common learner guideline is the ', h('strong', null, '1% rule'),
          ': risk no more than about 1% of the account on any one trade (many practise with 0.25–1%). It is a habit, not a law — the point is that no single loss, or run of losses, can knock you out.'),
        table('Account lost after a run of full losses at different risk levels',
          ['Risk / trade', '5 losses', '8 losses', '10 losses'],
          [0.01, 0.02, 0.05, 0.1].map((r) => [pct(r, 0), `−${pct(keep(r, 5))}`, `−${pct(keep(r, 8))}`, `−${pct(keep(r, 10))}`])),
        takeaway([
          'Losing streaks are normal, even for sound approaches.',
          'At 1% risk, ten losses in a row cost under 10%. At 10% risk, the same streak costs about two thirds of the account.',
          'You cannot control whether a trade wins. You can control how much it costs when it does not.',
        ]),
        disclaimer(),
      );
    },
  },
  {
    title: 'From stop distance to position size',
    render(el) {
      const f = sizingFigure();
      el.append(
        h('p', { html: '<strong>Position size = (account × risk %) ÷ (entry − stop)</strong>. The stop comes from the chart; the size comes from the stop — never the other way round.' }),
        figure(f.chart,
          `${usd(f.account)} × ${pct(f.riskPct, 0)} = ${usd(f.riskUsd)} risk. Entry ${f.entry.toFixed(2)} − stop ${f.stop.toFixed(2)} = ${usd(f.perShare, 2)} per share → ${usd(f.riskUsd)} ÷ ${usd(f.perShare, 2)} ≈ <strong>${f.shares} shares</strong> (rounded down).`,
          { label: 'Figure 1' }),
        h('p', null, 'Worked examples, all on a $10,000 account risking 1% ($100):'),
        table('Position size for different stop distances',
          ['Entry → stop', 'Risk per share', 'Shares', 'Position value'],
          [
            ['50.00 → 48.00', '$2.00', '50', '$2,500'],
            ['50.00 → 45.00', '$5.00', '20', '$1,000'],
            ['50.00 → 49.50', '$0.50', '200', '$10,000'],
          ]),
        takeaway([
          'Wider stop → fewer shares. Tighter stop → more shares. The dollar risk stays the same.',
          'Always round the share count <strong>down</strong>.',
          'Notice the last row: a tight stop asks for a position worth the whole account. That is the next step.',
        ]),
      );
    },
  },
  {
    title: 'Quick check: size it',
    quiz: {
      question: 'Account $5,000, risk 1% per trade. Entry 25.00, stop 24.50. How many shares?',
      options: [
        { label: '2 shares', value: 0 },
        { label: '200 shares', value: 1 },
        { label: '100 shares', value: 2 },
        { label: '1,000 shares', value: 3 },
      ],
      answer: 2,
      explain: '1% of $5,000 = $50. Risk per share = 25.00 − 24.50 = $0.50. $50 ÷ $0.50 = <strong>100 shares</strong>. '
        + '(2 shares divides the risk by the <em>price</em>; 200 risks 2%; 1,000 risks 10%.)',
    },
  },
  {
    title: 'Cap the position — and count the costs',
    render(el) {
      el.append(
        h('p', null,
          'Stop-based sizing has a blind spot: very tight stops produce very large positions. Many traders add a second cap on ',
          h('strong', null, 'position value'), ' (for example, no single position above a set share of the account) and take whichever size is smaller. ',
          'A tight stop also does not protect you from a ', h('strong', null, 'gap'), ': if price opens far below your stop, the stop fills at the open, not at your price.'),
        h('p', null,
          h('strong', null, 'Portfolio heat'), ' is the total you would lose if every open position hit its stop at once. Five open trades at 1% each is 5% heat — and if they are correlated (all tech longs, say), they can all stop out together.'),
        h('p', null,
          'Costs come out of every trade: the ', h('strong', null, 'spread'), ' (buy at the ask, sell at the bid), ',
          h('strong', null, 'commissions / fees'), ' and ', h('strong', null, 'slippage'), ' (fills worse than expected, common on stops and in fast markets). ',
          'Example: 200 shares with a 4-cent spread costs about $8 per round trip before fees — 8% of a $100 risk. The tighter the stop and the shorter the timeframe, the bigger the bite.'),
        takeaway([
          'Take the smaller of the stop-based size and your position-value cap.',
          'Add up open risk (portfolio heat); correlated positions count as one bigger bet.',
          'Estimate spread + fees + slippage in R before the trade. If costs eat a large slice of 1R, the setup may not be worth it.',
        ]),
      );
    },
  },
  {
    title: 'R-multiples: one ruler for every trade',
    render(el) {
      el.append(
        h('p', { html: '<strong>R</strong> is the amount you planned to risk on a trade. Measuring results in R makes trades comparable, whatever the price or share count.' }),
        table('Trade outcomes expressed in R (1R = $100)',
          ['Trade', 'Result $', 'Result in R'],
          [
            ['Stopped out as planned', '−$100', '−1R'],
            ['Hit the 2R target', '+$200', '+2R'],
            ['Exited early at a small gain', '+$50', '+0.5R'],
            ['Gap through the stop', '−$160', '−1.6R'],
          ]),
        takeaway([
          'A planned loss is −1R. Losses bigger than −1R (gaps, slippage, moving the stop) are warning signs worth journaling.',
          'Write the target in R before entering: “risking 1R to make 2R”.',
        ]),
      );
    },
  },
  {
    title: 'Win rate vs reward:risk → expectancy',
    render(el) {
      const exp = (w, win, loss = 1) => w * win - (1 - w) * loss;
      const fmt = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}R`;
      el.append(
        h('p', { html: '<strong>Expectancy</strong> = (win rate × average win) − (loss rate × average loss). It is the average result per trade, in R, over many trades.' }),
        table('Expectancy for different win rates and average wins (average loss 1R, before costs)',
          ['Win rate · average win', 'Expectancy per trade'],
          [
            ['60% · +0.5R', fmt(exp(0.6, 0.5))],
            ['50% · +1R', fmt(exp(0.5, 1))],
            ['40% · +2R', fmt(exp(0.4, 2))],
            ['30% · +3R', fmt(exp(0.3, 3))],
          ]),
        h('p', null,
          'Break-even win rate = 1 ÷ (1 + reward:risk). At 1:1 you need to win 50% of the time; at 2:1 about 33%; at 3:1 about 25% — ',
          h('em', null, 'before'), ' costs, which push every break-even point higher.'),
        takeaway([
          'A high win rate with small wins can still lose money. A low win rate with bigger wins can still make money.',
          'Expectancy from 20 trades is mostly noise; you need a large sample before trusting it.',
          'Real average wins are usually smaller than planned targets (early exits, partial fills, costs).',
        ]),
      );
    },
  },
  {
    title: 'Quick check: expectancy',
    quiz: {
      question: 'You win 40% of trades. Average win +1.5R, average loss −1R. What is the expectancy?',
      options: [
        { label: '+0.6R per trade — 40% × 1.5R', value: 0 },
        { label: 'About 0R — break-even before costs, negative after', value: 1 },
        { label: '+0.5R per trade — the wins are bigger than the losses', value: 2 },
        { label: '−0.6R per trade — you lose more often than you win', value: 3 },
      ],
      answer: 1,
      explain: '0.40 × 1.5R − 0.60 × 1R = 0.60R − 0.60R = <strong>0R</strong>. Spread, fees and slippage then make it slightly negative. Win rate and payoff only mean something <em>together</em>.',
    },
  },
  {
    title: 'Drawdown math and risk of ruin',
    render(el) {
      const need = (l) => l / (1 - l);
      el.append(
        h('p', null, 'A ', h('strong', null, 'drawdown'), ' is the fall from an account peak to a later low. Losses and recoveries are not symmetrical: the deeper the hole, the harder the climb.'),
        table('Gain needed to recover from a drawdown',
          ['Drawdown', 'Gain needed to get back'],
          [0.1, 0.2, 0.3, 0.5, 0.75].map((l) => [`−${pct(l, 0)}`, `+${pct(need(l))}`])),
        h('p', null,
          h('strong', null, 'Risk of ruin'), ' is the chance of losing so much that you cannot (or will not) keep going. You do not need the maths to get the intuition: streaks are longer than people expect. ',
          'With independent coin-flip trades (50% win rate), a run of 6+ losses somewhere in 100 trades happens more often than not (about 55% of the time). At a 40% win rate, a run of 8+ losses shows up about half the time.'),
        takeaway([
          '−50% needs +100% just to get back to where you started.',
          'Small risk per trade keeps a normal losing streak a dent, not a crater.',
          'Size for the streak you have not seen yet.',
        ]),
      );
    },
  },
  {
    title: 'Leverage and margin',
    render(el) {
      el.append(
        h('p', null,
          h('strong', null, 'Leverage'), ' lets you control a position bigger than your cash. With 5:1 leverage, $2,000 of your money (the ',
          h('strong', null, 'margin'), ') controls a $10,000 position. It magnifies gains and losses equally:'),
        table('Effect of a price move on a $2,000 margin controlling $10,000 (5:1)',
          ['Price move', 'P&L', 'Change in your $2,000'],
          [
            ['+5%', '+$500', '+25%'],
            ['−5%', '−$500', '−25%'],
            ['−10%', '−$1,000', '−50%'],
            ['−20%', '−$2,000', '−100%'],
          ]),
        h('p', null,
          'If your equity drops below the broker’s ', h('strong', null, 'maintenance margin'), ' requirement you get a ', h('strong', null, 'margin call'),
          ': add money or the broker can close positions for you — often at a bad moment and at market prices. In some products (futures, CFDs, short selling) losses can exceed what you deposited. Rules differ by broker, product and country.'),
        takeaway([
          'Leverage does not change the right position size — your stop and risk % still decide it.',
          'Available leverage is a limit, not a target.',
          'Treat a margin call as a sign the position was too large for the account.',
        ]),
      );
    },
  },
  {
    title: 'Quick check: leverage',
    quiz: {
      question: 'You open a position at 10:1 leverage. Price moves 5% against you. Ignoring fees, what happened to the margin you put up?',
      options: [
        { label: 'It fell 5% — the same as the price', value: 0 },
        { label: 'Nothing yet — the loss only counts when you close', value: 1 },
        { label: 'It fell 0.5% — leverage spreads the move out', value: 2 },
        { label: 'It fell about 50%', value: 3 },
      ],
      answer: 3,
      explain: 'At 10:1 the position is 10× your margin, so a 5% move is 10 × 5% = <strong>50% of your margin</strong>. Open losses are real: they count toward margin calls before you close.',
    },
  },
  {
    title: 'Your risk rules on one card',
    render(el) {
      el.append(
        h('ul', { class: 'lesson-list' },
          h('li', null, 'Stop first: where is the idea wrong?'),
          h('li', null, 'Risk a small, fixed % per trade (many learners use 0.25–1%).'),
          h('li', null, 'Size = risk $ ÷ stop distance, rounded down, capped by position value.'),
          h('li', null, 'Know your total open risk (portfolio heat) and a daily loss limit.'),
          h('li', null, 'Count spread, fees and slippage; beware gaps and leverage.'),
          h('li', null, 'Judge results in R over many trades, not one.'),
        ),
        takeaway([
          'Practise the arithmetic in <strong>Risk Manager</strong> — Practice mode has no clock and gives hints.',
          'The Advanced unit “Confluence, timing & risk” builds on this with ATR-based stops and testing an idea before trusting it.',
        ]),
        disclaimer(),
      );
    },
  },
];

export default {
  id: 'risk-basics',
  mount(root, ctx) {
    const shell = new LessonShell(root, ctx, {
      intro: 'Before any pattern or indicator: decide how much you can lose, size the position from your stop, and understand R, expectancy, drawdowns, leverage and trading costs.',
      steps,
    });
    return () => shell.destroy();
  },
};
