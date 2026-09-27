// Setup Playbook — rule-based setups with checklist + Home-hero-style playback on detail.
// List keeps static miniChart thumbs; detail keeps the diagram and ADDS a stepped simulation.
// List is sectioned by trading difficulty (Easy / Medium / Hard), separate from curriculum tier.
import { h, icon, tierChip } from '../core/ui.js';
import { takeaway, figure } from '../core/lesson-kit.js';
import { mountPatternPlayback } from '../core/pattern-playback.js';

const DIFFICULTIES = [
  { id: 'easy', label: 'Easy', blurb: 'High-clarity candle reversals at levels — clean single-idea scalps.' },
  { id: 'medium', label: 'Medium', blurb: 'Weaker candles that need confirmation, plus straightforward chart continuations.' },
  { id: 'hard', label: 'Hard', blurb: 'Trap / fade trades and multi-leg or confluence setups.' },
];

// id = scanner setup kind where one exists (§12.4), so real examples can be looked up by id.
// Candle pattern ids must exist in CANDLE_PATTERNS / candleScenario.
const SETUPS = [
  // —— Easy: simple, high-clarity candle reversals at levels ——
  {
    id: 'hammer', name: 'Hammer at support', tier: 'beginner', difficulty: 'easy', bias: 'bullish', kind: 'candle',
    pattern: 'hammer', fib: true,
    summary: 'After a decline, a candle with a long lower wick closes near its high at a support zone — classic long scalp trigger.',
    rules: [
      'A clear decline into the candle',
      'Lower wick at least 2× the body, little or no upper wick',
      'At or near a support zone or Fib golden pocket',
      'Next candle closes above the hammer high',
    ],
    entry: 'Buy on the close of the confirmation candle (or a tick above the hammer high).',
    stop: 'Just below the hammer’s low — tight for scalps.',
    target: '1.5–2R or the next micro resistance.',
  },
  {
    id: 'shooting-star', name: 'Shooting star scalp', tier: 'beginner', difficulty: 'easy', bias: 'bearish', kind: 'candle',
    pattern: 'shooting-star', fib: true,
    summary: 'After a short-term rally, a small body with a long upper wick rejects the high — fade with a stop above the wick.',
    rules: [
      'Prior up-push into resistance or Fib of the last decline',
      'Upper wick ≥ 2× body, little lower wick',
      'Next candle closes below the star’s body (ideally below its low)',
      'Skip if higher-timeframe trend is violently bullish',
    ],
    entry: 'Sell the confirmation close below the star.',
    stop: 'A few ticks above the upper wick.',
    target: '1.5–2R or next micro support.',
  },
  {
    id: 'bullish-engulfing', name: 'Bullish engulfing', tier: 'beginner', difficulty: 'easy', bias: 'bullish', kind: 'candle',
    pattern: 'bullish-engulfing', fib: true,
    summary: 'A bullish body completely engulfs the previous bearish body after a pullback — strong scalp long when it prints at a level.',
    rules: [
      'A downtrend or a pullback in an uptrend',
      'The green body engulfs the prior red body',
      'Forms at a level (support, MA, Fib 50–61.8%, trend line)',
      'Above-average volume on the engulfing candle',
    ],
    entry: 'Buy above the engulfing candle’s high (or on its close for aggressive scalps).',
    stop: 'Below the engulfing candle’s low.',
    target: '1.5–2R or the prior swing high.',
  },
  {
    id: 'bearish-engulfing', name: 'Bearish engulfing', tier: 'beginner', difficulty: 'easy', bias: 'bearish', kind: 'candle',
    pattern: 'bearish-engulfing', fib: true,
    summary: 'A bearish body engulfs the prior bullish body after a rally — short scalp with stop above the pattern high.',
    rules: [
      'Uptrend or bounce into resistance',
      'Red body fully engulfs the prior green body',
      'At resistance / Fib / session high',
      'Prefer expanding volume on the engulfing bar',
    ],
    entry: 'Sell below the engulfing low (or on the close).',
    stop: 'Above the engulfing high.',
    target: '1.5–2R or prior micro swing low.',
  },
  {
    id: 'dragonfly-doji', name: 'Dragonfly doji scalp', tier: 'beginner', difficulty: 'easy', bias: 'bullish', kind: 'candle',
    pattern: 'dragonfly-doji', fib: true,
    summary: 'Long lower wick, open/high/close near the top after a dip — buyers absorbed the sell. Scalp the reclaim.',
    rules: [
      'Short-term decline or flush into support / Fib 50–61.8%',
      'Open, high and close clustered at the top of a long lower wick',
      'Next candle closes above the dragonfly high',
      'Volume on the reclaim is not thinner than the flush',
    ],
    entry: 'Buy the close above the dragonfly high (or a 1-tick break).',
    stop: 'Just below the long wick low.',
    target: '1.5–2R or prior micro swing high.',
  },
  {
    id: 'gravestone-doji', name: 'Gravestone doji scalp', tier: 'beginner', difficulty: 'easy', bias: 'bearish', kind: 'candle',
    pattern: 'gravestone-doji', fib: true,
    summary: 'Long upper wick with open/low/close at the bottom after a pop — sellers rejected the high. Scalp the failure.',
    rules: [
      'Short-term rally into resistance / Fib retracement of the last drop',
      'Open, low and close clustered at the bottom of a long upper wick',
      'Next candle closes below the gravestone low',
      'Avoid if a strong trend day is still expanding higher',
    ],
    entry: 'Sell the close below the gravestone low.',
    stop: 'Just above the upper wick high.',
    target: '1.5–2R or prior micro swing low.',
  },
  // —— Medium: weaker / confirmation-needed candles + straightforward chart continuation ——
  {
    id: 'doji', name: 'Doji pause (scalp)', tier: 'beginner', difficulty: 'medium', bias: 'neutral', kind: 'candle',
    pattern: 'doji', fib: true,
    summary: 'On a short timeframe, a doji at a micro level flags indecision — trade only the break of its range with a tight stop.',
    rules: [
      'Clear prior push into a level (VWAP, prior high/low, or session open)',
      'Doji body ≤ ~8% of its range',
      'Wait for the next candle to close beyond the doji high (long) or low (short)',
      'Skip if the doji is mid-range with no level',
    ],
    entry: 'Buy/sell the confirmation close beyond the doji extreme.',
    stop: 'A few ticks beyond the opposite wick — scalp-tight.',
    target: '1–1.5R or the next micro swing; take profit quick.',
  },
  {
    id: 'inverted-hammer', name: 'Inverted hammer scalp', tier: 'beginner', difficulty: 'medium', bias: 'bullish', kind: 'candle',
    pattern: 'inverted-hammer',
    summary: 'After a dip, a long upper wick with a small body near the low shows buyers probing — weaker than a hammer; demand confirmation.',
    rules: [
      'Short-term decline into a level',
      'Long upper wick, small body near the low',
      'Next candle closes above the inverted hammer high',
      'Prefer confluence with support or VWAP',
    ],
    entry: 'Buy only after a close above the pattern high.',
    stop: 'Below the pattern low.',
    target: '1–2R; take profit at the first micro resistance.',
  },
  {
    id: 'bullish-harami', name: 'Bullish harami scalp', tier: 'beginner', difficulty: 'medium', bias: 'bullish', kind: 'candle',
    pattern: 'bullish-harami',
    summary: 'A small green body inside a large red body after a selloff — momentum stall. Scalp only with a break of the mother candle.',
    rules: [
      'Clear short-term decline',
      'Small green body inside the prior long red body',
      'Wait for a close above the mother candle’s open',
      'Stop stays below the pattern low',
    ],
    entry: 'Buy the close above the first candle’s open.',
    stop: 'Below the pattern low (tight).',
    target: '1–2R; harami is weaker — bank quick.',
  },
  {
    id: 'bearish-harami', name: 'Bearish harami scalp', tier: 'beginner', difficulty: 'medium', bias: 'bearish', kind: 'candle',
    pattern: 'bearish-harami',
    summary: 'A small red body inside a large green body after a rally — stall warning. Short the break of the mother candle.',
    rules: [
      'Clear short-term rally',
      'Small red body inside the prior long green body',
      'Wait for a close below the mother candle’s open',
      'Stop above the pattern high',
    ],
    entry: 'Sell the close below the first candle’s open.',
    stop: 'Above the pattern high.',
    target: '1–2R; take profit at the first micro support.',
  },
  {
    id: 'bull-flag', name: 'Bull flag', tier: 'advanced', difficulty: 'medium', bias: 'bullish', kind: 'chart',
    pattern: 'bull-flag',
    summary: 'A sharp rally (the pole) followed by a tight, gently falling consolidation on shrinking volume.',
    rules: ['A strong pole on heavy volume', 'A shallow, orderly pullback', 'Volume dries up in the flag', 'Close above the flag’s upper line'],
    entry: 'Buy the close above the flag.', stop: 'Below the flag’s low.', target: 'The pole’s height projected from the breakout.',
  },
  {
    id: 'double-bottom', name: 'Double bottom', tier: 'advanced', difficulty: 'medium', bias: 'bullish', kind: 'chart',
    pattern: 'double-bottom',
    summary: 'Two lows at about the same price, then a close above the peak between them (the neckline).',
    rules: ['A prior downtrend', 'Two lows within about 1–2%', 'Second low on lighter volume', 'Close above the neckline'],
    entry: 'Buy the neckline break or its retest.', stop: 'Below the second low.', target: 'The pattern height projected from the neckline.',
  },
  {
    id: 'breakout-up', name: 'Breakout and retest', tier: 'advanced', difficulty: 'medium', bias: 'bullish', kind: 'chart',
    pattern: 'ascending-triangle',
    summary: 'Price closes above a well-tested resistance on strong volume, then retests it as support.',
    rules: ['Resistance tested at least twice', 'Decisive close above it', 'Breakout volume well above average', 'Pullback holds the old resistance'],
    entry: 'Buy the retest once it holds (or the breakout close for an aggressive entry).', stop: 'Below the retest low.', target: 'The measured move: the pattern height projected from the breakout.',
  },
  // —— Hard: trap / fade and multi-leg / confluence ——
  {
    id: 'fakeout-up', name: 'Failed breakout (fade)', tier: 'advanced', difficulty: 'hard', bias: 'bearish', kind: 'chart',
    pattern: 'ascending-triangle', outcome: 'fail',
    summary: 'Price pokes above resistance on thin volume and closes back inside: the breakout buyers are trapped.',
    rules: ['An obvious level with stops above it', 'The break comes on weak volume', 'A close back inside the range', 'No follow-through on the next candle'],
    entry: 'Sell the close back inside the range.', stop: 'Above the fakeout high.', target: 'The other side of the range.',
  },
  {
    id: 'head-and-shoulders', name: 'Head and shoulders', tier: 'advanced', difficulty: 'hard', bias: 'bearish', kind: 'chart',
    pattern: 'head-and-shoulders',
    summary: 'Three-push top: left shoulder, higher head, lower right shoulder — short the neckline break when volume confirms the fail.',
    rules: [
      'Prior uptrend into the pattern',
      'Head clearly higher than both shoulders',
      'Right shoulder fails to reclaim the head high',
      'Close below the neckline with expanding volume',
    ],
    entry: 'Sell the neckline break or its retest from below.',
    stop: 'Above the right shoulder high (or the head for wider risk).',
    target: 'Pattern height (head to neckline) projected down from the break.',
  },
  {
    id: 'rising-wedge', name: 'Rising wedge fade', tier: 'advanced', difficulty: 'hard', bias: 'bearish', kind: 'chart',
    pattern: 'rising-wedge',
    summary: 'Higher highs and higher lows that converge — momentum is fading. Fade the breakdown when support of the wedge gives way.',
    rules: [
      'Both trend lines slope up and converge',
      'Volume contracts into the apex',
      'A decisive close below the lower wedge line',
      'Prefer confluence with resistance / Fib of the prior swing',
    ],
    entry: 'Sell the close below the lower wedge line (or the retest).',
    stop: 'Above the most recent swing high inside the wedge.',
    target: 'The start of the wedge or the measured height of the pattern.',
  },
];

function difficultyMeta(id) {
  return DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[0];
}

function difficultyChip(difficulty, { small = false } = {}) {
  const meta = difficultyMeta(difficulty);
  return h('span', {
    class: ['chip', `chip--difficulty-${meta.id}`, small && 'chip--sm'],
    title: `Trade difficulty: ${meta.label}`,
  }, meta.label);
}

function diagram(setup, chartMod, patMod, width = 320, height = 150) {
  if (!chartMod || !patMod) return h('div', { class: 'playbook-card__art-empty' });
  try {
    if (setup.kind === 'candle') {
      const sc = patMod.candleScenario(setup.pattern, { seed: 101, leadIn: 16, after: 4 });
      return chartMod.miniChart(sc.candles, {
        width, height, yPad: 0.16,
        overlays: [{ type: 'box', from: sc.start, to: sc.end, color: setup.bias === 'bullish' ? 'bull' : setup.bias === 'bearish' ? 'bear' : 'accent' }],
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

function setupCard(s, mods) {
  const art = h('div', { class: 'playbook-card__art', 'aria-hidden': 'true' }, diagram(s, ...mods));
  return h('a', { class: 'playbook-card card card--link', href: `#playbook.${s.id}` },
    art,
    h('div', { class: 'playbook-card__body' },
      h('div', { class: 'row row--sm' },
        difficultyChip(s.difficulty, { small: true }),
        tierChip(s.tier, { small: true }),
        h('span', { class: `chip chip--sm ${s.bias === 'bullish' ? 'chip--bull' : s.bias === 'bearish' ? 'chip--bear' : 'chip--outline'}` },
          s.bias === 'bullish' ? 'Long' : s.bias === 'bearish' ? 'Short' : 'Watch'),
        h('span', { class: 'chip chip--sm chip--outline playbook-card__play' }, icon('play', { size: 12 }), ' Sim')),
      h('h2', { class: 'playbook-card__title' }, s.name),
      h('p', { class: 'playbook-card__summary' }, s.summary),
      h('span', { class: 'playbook-card__go' }, `${s.rules.length}-point checklist`, icon('arrow-right', { size: 16 }))));
}

function listView(root, mods) {
  const jump = h('nav', { class: 'playbook-jump', 'aria-label': 'Jump to difficulty' },
    DIFFICULTIES.map((d) => {
      const n = SETUPS.filter((s) => s.difficulty === d.id).length;
      return h('button', {
        type: 'button',
        class: 'playbook-jump__link',
        onClick: () => {
          const el = document.getElementById(`playbook-diff-${d.id}`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      }, d.label, h('span', { class: 'playbook-jump__n' }, String(n)));
    }));

  const sections = DIFFICULTIES.map((d) => {
    const items = SETUPS.filter((s) => s.difficulty === d.id);
    return h('section', {
      class: 'playbook-section',
      id: `playbook-diff-${d.id}`,
      'aria-labelledby': `playbook-diff-h-${d.id}`,
    },
      h('header', { class: 'playbook-section__head' },
        h('div', { class: 'playbook-section__title-row' },
          difficultyChip(d.id),
          h('h2', { id: `playbook-diff-h-${d.id}`, class: 'playbook-section__title' }, d.label),
          h('span', { class: 'playbook-section__count muted' }, `${items.length} setup${items.length === 1 ? '' : 's'}`)),
        h('p', { class: 'playbook-section__blurb muted' }, d.blurb)),
      h('div', { class: 'playbook__grid' }, items.map((s) => setupCard(s, mods))));
  });

  root.append(h('div', { class: 'container playbook' },
    h('header', { class: 'page-head' },
      h('p', { class: 'eyebrow eyebrow--accent' }, 'Setup Playbook'),
      h('h1', null, 'Exact setups, exact rules'),
      h('p', { class: 'lead' }, 'Each setup is a checklist you can verify on any chart, with an entry, a stop and a target decided before you trade. Grouped by trade difficulty — Easy, Medium, Hard. Open a card for the stepped simulation.')),
    jump,
    ...sections,
    h('p', { class: 'faint playbook__note' }, 'Simulations are educational — not live signals. Japanese candle setups below are framed for short-timeframe scalps with tight stops. Curriculum Beginner/Advanced chips mark lesson track; Easy/Medium/Hard mark how hard the trade is to execute.')));
}

function detailView(root, setup, mods) {
  const simHost = h('div', { class: 'playbook-sim', 'data-keys': 'capture' });
  const diff = difficultyMeta(setup.difficulty);
  root.append(h('div', { class: 'container container--wide playbook-detail' },
    h('a', { class: 'link-btn', href: '#playbook' }, icon('arrow-left', { size: 16 }), 'All setups'),
    h('header', { class: 'page-head' },
      h('p', { class: 'eyebrow eyebrow--accent' }, 'Setup Playbook'),
      h('h1', null, setup.name),
      h('div', { class: 'row row--sm' },
        difficultyChip(setup.difficulty),
        tierChip(setup.tier),
        h('span', { class: `chip ${setup.bias === 'bullish' ? 'chip--bull' : setup.bias === 'bearish' ? 'chip--bear' : 'chip--outline'}` },
          setup.bias === 'bullish' ? 'Long setup' : setup.bias === 'bearish' ? 'Short setup' : 'Indecision / break')),
      h('p', { class: 'muted playbook-detail__diff' }, `Trade difficulty: ${diff.label} — ${diff.blurb}`),
      h('p', { class: 'lead' }, setup.summary)),
    figure(diagram(setup, ...mods, 720, 260), 'Textbook snapshot of the completed setup.', { label: 'Diagram' }),
    h('section', { class: 'section--tight playbook-sim-section', 'aria-labelledby': 'playbook-sim-h' },
      h('div', { class: 'section-head' },
        h('div', null,
          h('p', { class: 'eyebrow' }, 'Interactive'),
          h('h2', { id: 'playbook-sim-h', class: 't-22' }, 'Walk-through simulation')),
        h('p', { class: 'muted' }, 'Same teaching chart style as the home page: candles reveal step by step with Entry, Stop and Target marked.')),
      simHost),
    h('section', { class: 'section--tight' },
      h('h2', { class: 't-22' }, 'Checklist'),
      h('ol', { class: 'playbook-rules' }, setup.rules.map((r, i) => h('li', null, h('span', { class: 'playbook-rules__n mono' }, String(i + 1)), h('span', null, r))))),
    h('dl', { class: 'playbook-plan' },
      h('div', null, h('dt', null, 'Entry'), h('dd', null, setup.entry)),
      h('div', null, h('dt', null, 'Stop'), h('dd', null, setup.stop)),
      h('div', null, h('dt', null, 'Target'), h('dd', null, setup.target))),
    takeaway('Only take the setup when <strong>every</strong> rule is met. A setup with a missing rule is a different, weaker trade.')));

  let playback = null;
  try {
    playback = mountPatternPlayback(simHost, {
      kind: setup.kind,
      patternId: setup.pattern,
      bias: setup.bias === 'neutral' ? undefined : setup.bias,
      seed: setup.kind === 'candle' ? 101 + setup.id.length : 202 + setup.id.length,
      outcome: setup.outcome || 'success',
      fib: !!setup.fib,
      height: 300,
      autoplay: false,
      interval: setup.kind === 'candle' ? '5M' : '1H',
    });
  } catch (err) {
    console.error('[playbook] playback failed:', err);
    simHost.append(h('p', { class: 'callout callout--warn' }, 'Simulation failed to load.'));
  }
  return () => {
    try { playback?.destroy?.(); } catch (err) { console.error(err); }
  };
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
    if (setup) return detailView(root, setup, mods);
    listView(root, mods);
    return undefined;
  },
};
