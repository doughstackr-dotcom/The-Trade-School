// Setup Playbook (stub) — #playbook lists rule-based setups, #playbook.<setupId> opens one.
// The full page (ARCHITECTURE §12.6) adds a ChartStory animation, textbook and real examples,
// real-sample stats and common mistakes. This stub proves the routes and the layout.
import { h, icon, tierChip } from '../core/ui.js';
import { takeaway, figure } from '../core/lesson-kit.js';

// id = scanner setup kind where one exists (§12.4), so real examples can be looked up by id.
const SETUPS = [
  {
    id: 'hammer', name: 'Hammer at support', tier: 'beginner', bias: 'bullish', kind: 'candle',
    pattern: 'hammer',
    summary: 'After a decline, a candle with a long lower wick closes near its high at a support zone.',
    rules: ['A clear decline into the candle', 'Lower wick at least 2× the body, little or no upper wick', 'At or near a support zone', 'Next candle closes above the hammer high'],
    entry: 'Buy on the close of the confirmation candle.', stop: 'Just below the hammer’s low.', target: 'The next resistance, at least 2R away.',
  },
  {
    id: 'bullish-engulfing', name: 'Bullish engulfing', tier: 'beginner', bias: 'bullish', kind: 'candle',
    pattern: 'bullish-engulfing',
    summary: 'A bullish body completely engulfs the previous bearish body after a pullback.',
    rules: ['A downtrend or a pullback in an uptrend', 'The green body engulfs the prior red body', 'Forms at a level (support, MA, trend line)', 'Above-average volume on the engulfing candle'],
    entry: 'Buy above the engulfing candle’s high.', stop: 'Below the engulfing candle’s low.', target: 'The prior swing high or 2R.',
  },
  {
    id: 'breakout-up', name: 'Breakout and retest', tier: 'advanced', bias: 'bullish', kind: 'chart',
    pattern: 'ascending-triangle',
    summary: 'Price closes above a well-tested resistance on strong volume, then retests it as support.',
    rules: ['Resistance tested at least twice', 'Decisive close above it', 'Breakout volume well above average', 'Pullback holds the old resistance'],
    entry: 'Buy the retest once it holds (or the breakout close for an aggressive entry).', stop: 'Below the retest low.', target: 'The measured move: the pattern height projected from the breakout.',
  },
  {
    id: 'fakeout-up', name: 'Failed breakout (fade)', tier: 'advanced', bias: 'bearish', kind: 'chart',
    pattern: 'ascending-triangle', outcome: 'fail',
    summary: 'Price pokes above resistance on thin volume and closes back inside: the breakout buyers are trapped.',
    rules: ['An obvious level with stops above it', 'The break comes on weak volume', 'A close back inside the range', 'No follow-through on the next candle'],
    entry: 'Sell the close back inside the range.', stop: 'Above the fakeout high.', target: 'The other side of the range.',
  },
  {
    id: 'bull-flag', name: 'Bull flag', tier: 'advanced', bias: 'bullish', kind: 'chart',
    pattern: 'bull-flag',
    summary: 'A sharp rally (the pole) followed by a tight, gently falling consolidation on shrinking volume.',
    rules: ['A strong pole on heavy volume', 'A shallow, orderly pullback', 'Volume dries up in the flag', 'Close above the flag’s upper line'],
    entry: 'Buy the close above the flag.', stop: 'Below the flag’s low.', target: 'The pole’s height projected from the breakout.',
  },
  {
    id: 'double-bottom', name: 'Double bottom', tier: 'advanced', bias: 'bullish', kind: 'chart',
    pattern: 'double-bottom',
    summary: 'Two lows at about the same price, then a close above the peak between them (the neckline).',
    rules: ['A prior downtrend', 'Two lows within about 1–2%', 'Second low on lighter volume', 'Close above the neckline'],
    entry: 'Buy the neckline break or its retest.', stop: 'Below the second low.', target: 'The pattern height projected from the neckline.',
  },
];

function diagram(setup, chartMod, patMod, width = 320, height = 150) {
  if (!chartMod || !patMod) return h('div', { class: 'playbook-card__art-empty' });
  try {
    if (setup.kind === 'candle') {
      const sc = patMod.candleScenario(setup.pattern, { seed: 101, leadIn: 16, after: 4 });
      return chartMod.miniChart(sc.candles, {
        width, height, yPad: 0.16,
        overlays: [{ type: 'box', from: sc.start, to: sc.end, color: setup.bias === 'bullish' ? 'bull' : 'bear' }],
        ariaLabel: `${setup.name} diagram`,
      });
    }
    const sc = patMod.chartScenario(setup.pattern, { seed: 202, count: 96, after: 16, outcome: setup.outcome || 'success' });
    return chartMod.miniChart(sc.candles, {
      width, height, yPad: 0.12,
      overlays: [
        { type: 'hline', price: sc.level, color: 'accent', dashed: true },
        { type: 'marker', idx: sc.breakoutIdx, position: sc.direction < 0 ? 'below' : 'above', shape: 'dot', color: 'accent' },
      ],
      ariaLabel: `${setup.name} diagram`,
    });
  } catch (err) {
    console.error(`[playbook] diagram for ${setup.id} failed:`, err);
    return h('div', { class: 'playbook-card__art-empty' });
  }
}

function listView(root, mods) {
  const cards = SETUPS.map((s) => {
    const art = h('div', { class: 'playbook-card__art', 'aria-hidden': 'true' }, diagram(s, ...mods));
    return h('a', { class: 'playbook-card card card--link', href: `#playbook.${s.id}` },
      art,
      h('div', { class: 'playbook-card__body' },
        h('div', { class: 'row row--sm' }, tierChip(s.tier, { small: true }),
          h('span', { class: `chip chip--sm ${s.bias === 'bullish' ? 'chip--bull' : 'chip--bear'}` }, s.bias === 'bullish' ? 'Long' : 'Short')),
        h('h2', { class: 'playbook-card__title' }, s.name),
        h('p', { class: 'playbook-card__summary' }, s.summary),
        h('span', { class: 'playbook-card__go' }, `${s.rules.length}-point checklist`, icon('arrow-right', { size: 16 }))));
  });
  root.append(h('div', { class: 'container playbook' },
    h('header', { class: 'page-head' },
      h('p', { class: 'eyebrow eyebrow--accent' }, 'Setup Playbook'),
      h('h1', null, 'Exact setups, exact rules'),
      h('p', { class: 'lead' }, 'Each setup is a checklist you can verify on any chart, with an entry, a stop and a target decided before you trade.')),
    h('div', { class: 'playbook__grid' }, cards),
    h('p', { class: 'faint playbook__note' }, 'Coming next: animated walk-throughs, real-market examples and how often each setup worked in the real-data sample.')));
}

function detailView(root, setup, mods) {
  root.append(h('div', { class: 'container container--wide playbook-detail' },
    h('a', { class: 'link-btn', href: '#playbook' }, icon('arrow-left', { size: 16 }), 'All setups'),
    h('header', { class: 'page-head' },
      h('p', { class: 'eyebrow eyebrow--accent' }, 'Setup Playbook'),
      h('h1', null, setup.name),
      h('div', { class: 'row row--sm' }, tierChip(setup.tier),
        h('span', { class: `chip ${setup.bias === 'bullish' ? 'chip--bull' : 'chip--bear'}` }, setup.bias === 'bullish' ? 'Long setup' : 'Short setup')),
      h('p', { class: 'lead' }, setup.summary)),
    figure(diagram(setup, ...mods, 720, 260), 'Textbook example. Real examples and the animated walk-through are coming soon.', { label: 'Diagram' }),
    h('section', { class: 'section--tight' },
      h('h2', { class: 't-22' }, 'Checklist'),
      h('ol', { class: 'playbook-rules' }, setup.rules.map((r, i) => h('li', null, h('span', { class: 'playbook-rules__n mono' }, String(i + 1)), h('span', null, r))))),
    h('dl', { class: 'playbook-plan' },
      h('div', null, h('dt', null, 'Entry'), h('dd', null, setup.entry)),
      h('div', null, h('dt', null, 'Stop'), h('dd', null, setup.stop)),
      h('div', null, h('dt', null, 'Target'), h('dd', null, setup.target))),
    takeaway('Only take the setup when <strong>every</strong> rule is met. A setup with a missing rule is a different, weaker trade.')));
}

export default {
  id: 'playbook',
  async mount(root, ctx) {
    const [chartMod, patMod] = await Promise.all([
      import('../core/chart.js').catch(() => null),
      import('../core/patterns.js').catch(() => null),
    ]);
    const mods = [chartMod, patMod];
    const setup = ctx.param ? SETUPS.find((s) => s.id === ctx.param) : null;
    if (ctx.param && !setup) {
      root.append(h('div', { class: 'container' },
        h('div', { class: 'route-error card' },
          h('p', { class: 'eyebrow' }, 'Setup Playbook'),
          h('h1', { class: 'route-error__title' }, 'Setup not found'),
          h('p', { class: 'muted' }, `There is no setup called “${ctx.param}” yet.`),
          h('a', { class: 'btn btn--primary', href: '#playbook' }, icon('arrow-left'), 'All setups'))));
      return undefined;
    }
    if (setup) detailView(root, setup, mods);
    else listView(root, mods);
    return undefined;
  },
};
