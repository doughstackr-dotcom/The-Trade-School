// Setup Playbook — rule-based setups with checklist + Home-hero-style playback on detail.
// List is difficulty-sectioned setup cards only; process guides live inside each card detail.
import { h, icon, tierChip } from '../core/ui.js';
import { takeaway, figure } from '../core/lesson-kit.js';
import { mountPatternPlayback } from '../core/pattern-playback.js';
import {
  DIFFICULTIES,
  SETUPS,
  RISK_RULES,
  ENTRY_EXIT_FRAMEWORKS,
  TRADE_CHECKLISTS,
  SCENARIOS,
  difficultyMeta,
  setupById,
} from '../core/playbook-data.js';
import { CANDLE_PATTERNS, CHART_PATTERNS } from '../core/patterns.js';
import { toolsTeaser } from '../core/teaser.js';
import * as access from '../core/access.js';

/** Shown on every setup card and detail page. */
const EXAMPLE_NOTE = 'Educational example — not a recommendation.';

/** Primary entry/exit framework id by trade difficulty; time-stop is always appended. */
const FRAMEWORK_BY_DIFFICULTY = {
  easy: 'confirm-close',
  medium: 'break-retest',
  hard: 'fade-trap',
};

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

function patternMeta(setup) {
  const map = setup.kind === 'candle' ? CANDLE_PATTERNS : CHART_PATTERNS;
  return map[setup.pattern] || { name: setup.pattern, bias: setup.bias };
}

/** Clean pattern silhouette / focused thumb — shown at the bottom of each setup card. */
function patternViz(setup, chartMod, patMod) {
  if (!chartMod || !patMod) return h('div', { class: 'playbook-card__pattern-empty' });
  try {
    if (setup.kind === 'candle') {
      const sc = patMod.candleScenario(setup.pattern, { seed: 101 + setup.id.length, leadIn: 0, after: 0 });
      const candles = sc.candles.slice(sc.start, sc.end + 1);
      const n = Math.max(1, candles.length);
      const width = n === 1 ? 120 : n === 2 ? 160 : 200;
      return chartMod.miniChart(candles, {
        width,
        height: 96,
        padding: 16,
        yPad: 0.28,
        overlays: [],
        ariaLabel: `${patternMeta(setup).name} pattern`,
      });
    }
    const sc = patMod.chartScenario(setup.pattern, {
      seed: 202 + setup.id.length,
      count: 72,
      after: 10,
      outcome: setup.outcome || 'success',
    });
    const from = sc.patternStart ?? Math.max(0, (sc.breakoutIdx || sc.candles.length - 1) - 24);
    const to = sc.patternEnd ?? Math.min(sc.candles.length - 1, (sc.breakoutIdx || sc.candles.length - 1) + 4);
    const overlays = [
      {
        type: 'box',
        from,
        to,
        color: setup.bias === 'bullish' ? 'bull' : setup.bias === 'bearish' ? 'bear' : 'accent',
      },
    ];
    if (Number.isFinite(sc.level)) {
      overlays.push({ type: 'hline', price: sc.level, color: 'accent', dashed: true });
    }
    return chartMod.miniChart(sc.candles, {
      width: 280,
      height: 100,
      yPad: 0.14,
      overlays,
      ariaLabel: `${patternMeta(setup).name} pattern`,
    });
  } catch (err) {
    console.error(`[playbook] pattern viz for ${setup.id} failed:`, err);
    return h('div', { class: 'playbook-card__pattern-empty' });
  }
}

function setupCard(s, mods) {
  const art = h('div', { class: 'playbook-card__art', 'aria-hidden': 'true' }, diagram(s, ...mods));
  const meta = patternMeta(s);
  const patternBlock = h('div', { class: 'playbook-card__pattern' },
    h('div', { class: 'playbook-card__pattern-head' },
      h('span', { class: 'playbook-card__pattern-kicker faint' }, 'Pattern'),
      h('span', { class: 'playbook-card__pattern-name' }, meta.name),
      h('span', { class: 'chip chip--sm chip--outline' }, s.kind === 'candle' ? 'Candle' : 'Chart')),
    h('div', { class: 'playbook-card__pattern-art', 'aria-hidden': 'true' }, patternViz(s, ...mods)));
  return h('a', { class: 'playbook-card card card--link', href: `/playbook/${s.id}` },
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
      h('p', { class: 'playbook-card__note faint t-12' }, EXAMPLE_NOTE),
      h('span', { class: 'playbook-card__go' }, `${s.rules.length}-point checklist`, icon('arrow-right', { size: 16 }))),
    patternBlock);
}

function scrollToId(id) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Difficulty jump chips only — guide content lives inside each setup detail. */
function jumpNav() {
  return h('nav', { class: 'playbook-jump', 'aria-label': 'Jump to difficulty' },
    ...DIFFICULTIES.map((d) => {
      const n = SETUPS.filter((s) => s.difficulty === d.id).length;
      return h('button', {
        type: 'button',
        class: 'playbook-jump__link',
        onClick: () => scrollToId(`playbook-diff-${d.id}`),
      }, d.label, h('span', { class: 'playbook-jump__n' }, String(n)));
    }));
}

function setupSections(mods) {
  return DIFFICULTIES.map((d) => {
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
}

function listView(root, mods) {
  root.append(h('div', { class: 'container playbook' },
    h('header', { class: 'page-head' },
      h('p', { class: 'eyebrow eyebrow--accent' }, 'Setup Playbook'),
      h('h1', null, 'Exact setups, exact rules'),
      h('p', { class: 'lead' },
        'Each setup is a checklist you can verify on any chart, with an entry, a stop and a target decided before you trade. ',
        'Open a card for the stepped simulation, entry/exit frameworks, checklists, risk rules and any scenario walkthrough for that setup.')),
    jumpNav(),
    h('header', { class: 'playbook-setups-head page-head' },
      h('p', { class: 'eyebrow' }, 'Setups by difficulty'),
      h('h2', { class: 't-22', id: 'playbook-setups-h' }, 'The playbook cards'),
      h('p', { class: 'muted' },
        'Grouped by trade difficulty — Easy, Medium, Hard. Each card shows the contextual diagram up top and the clean pattern silhouette at the bottom. Process guides live inside each card.')),
    ...setupSections(mods),
    h('p', { class: 'faint playbook__note' },
      'Simulations are educational — not live signals or financial advice. ',
      'Setups are framed as day- or swing-trade examples on hourly to daily charts. On shorter timeframes, spread, fees and slippage take a bigger share of each R — include them. ',
      'Curriculum Beginner/Advanced chips mark lesson track; Easy/Medium/Hard mark how hard the trade is to execute. ',
      'All catalog patterns appear on at least one setup card.')));
}

function checklistBlock(spec) {
  return h('article', { class: 'card playbook-checklist' },
    h('header', { class: 'playbook-checklist__head' },
      h('h3', { class: 'playbook-checklist__title' }, spec.title),
      h('p', { class: 'muted' }, spec.blurb)),
    h('ol', { class: 'playbook-rules playbook-rules--check' },
      spec.items.map((item, i) => h('li', null,
        h('span', { class: 'playbook-rules__n mono' }, String(i + 1)),
        h('span', null, item)))));
}

function frameworkCard(fw, { primary = false } = {}) {
  return h('article', { class: ['card', 'playbook-framework', primary && 'playbook-framework--primary'] },
    h('header', { class: 'playbook-framework__head' },
      h('div', { class: 'row row--sm' },
        h('h3', { class: 'playbook-framework__title' }, fw.title),
        primary ? h('span', { class: 'chip chip--sm chip--outline' }, 'Primary for this setup') : null),
      h('p', { class: 'muted playbook-framework__when' }, fw.when)),
    h('dl', { class: 'playbook-plan playbook-plan--framework' },
      h('div', null, h('dt', null, 'Entry'), h('dd', null, fw.entry)),
      h('div', null, h('dt', null, 'Stop'), h('dd', null, fw.stop)),
      h('div', null, h('dt', null, 'Exit'), h('dd', null, fw.exit))));
}

function accordion(summaryLabel, bodyNodes, { open = false, className = '' } = {}) {
  const el = h('details', {
    class: ['playbook-accordion', className].filter(Boolean).join(' '),
    open: open || undefined,
  },
    h('summary', { class: 'playbook-accordion__summary' }, summaryLabel),
    h('div', { class: 'playbook-accordion__body' }, ...bodyNodes));
  return el;
}

function frameworksForSetup(setup) {
  const primaryId = FRAMEWORK_BY_DIFFICULTY[setup.difficulty] || 'confirm-close';
  const primary = ENTRY_EXIT_FRAMEWORKS.find((fw) => fw.id === primaryId);
  const timeStop = ENTRY_EXIT_FRAMEWORKS.find((fw) => fw.id === 'time-stop');
  const nodes = [];
  if (primary) nodes.push(frameworkCard(primary, { primary: true }));
  if (timeStop) {
    nodes.push(h('p', { class: 'playbook-detail-guide__note muted' },
      h('strong', null, `${timeStop.title}: `),
      timeStop.stop, ' ', timeStop.exit));
  }
  return nodes;
}

function scenarioBlock(sc) {
  return h('article', { class: 'card playbook-scenario' },
    h('header', { class: 'playbook-scenario__head' },
      h('div', { class: 'row row--sm' }, difficultyChip(sc.difficulty, { small: true })),
      h('h3', { class: 'playbook-scenario__title' }, sc.title)),
    h('ol', { class: 'playbook-scenario__steps' },
      sc.steps.map((step, i) => h('li', null,
        h('span', { class: 'playbook-scenario__n mono' }, String(i + 1)),
        h('span', null, step)))),
    h('p', { class: 'playbook-scenario__lesson' },
      h('strong', null, 'Takeaway: '), sc.lesson));
}

function detailGuides(setup) {
  const scenarios = SCENARIOS.filter((s) => s.setupId === setup.id);
  const scenarioBody = scenarios.length
    ? scenarios.map((sc) => scenarioBlock(sc))
    : [h('p', { class: 'faint playbook-detail-guide__empty' }, 'No dedicated scenario yet for this setup.')];

  return h('section', {
    class: 'section--tight playbook-detail-guides',
    'aria-label': 'Process guides for this setup',
  },
    h('div', { class: 'section-head' },
      h('div', null,
        h('p', { class: 'eyebrow' }, 'Process'),
        h('h2', { class: 't-22' }, 'Guides for this setup')),
      h('p', { class: 'muted' },
        'Expand for the matching entry/exit framework, pre/post checklists, scenario walkthrough and risk reminder.')),
    accordion(
      h('span', null, 'Entry / exit framework', h('span', { class: 'playbook-accordion__hint muted' }, 'for this difficulty')),
      [
        h('p', { class: 'muted playbook-detail-guide__blurb' },
          'Primary framework matched to this setup’s trade difficulty, plus a short time-stop note.'),
        h('div', { class: 'playbook-frameworks playbook-frameworks--detail' }, ...frameworksForSetup(setup)),
      ],
      { open: false, className: 'playbook-accordion--frameworks' },
    ),
    accordion(
      h('span', null, 'Pre-trade & post-trade checklists'),
      [
        h('p', { class: 'muted playbook-detail-guide__blurb' },
          'Same process tools for every trade — gate the order, then close the loop.'),
        h('div', { class: 'playbook-checklists playbook-checklists--detail' },
          checklistBlock(TRADE_CHECKLISTS.pre),
          checklistBlock(TRADE_CHECKLISTS.post)),
      ],
      { className: 'playbook-accordion--checklists' },
    ),
    accordion(
      h('span', null, 'Scenario walkthrough',
        h('span', { class: 'playbook-accordion__hint muted' },
          scenarios.length ? `${scenarios.length}` : 'none yet')),
      scenarioBody,
      { className: 'playbook-accordion--scenarios' },
    ),
    accordion(
      h('span', null, 'Risk rules reminder',
        h('span', { class: 'playbook-accordion__hint muted' }, `${RISK_RULES.length} rules`)),
      [
        h('p', { class: 'muted playbook-detail-guide__blurb' },
          'Survival rules that sit above any single setup. Practice them in sims before you size up.'),
        h('ul', { class: 'playbook-risk-compact' },
          RISK_RULES.map((r) => h('li', null,
            h('strong', null, r.title),
            h('span', { class: 'muted' }, r.body)))),
        h('p', { class: 'callout callout--warn playbook-disclaimer', role: 'note' },
          icon('info', { size: 16 }),
          h('span', null,
            'Educational only — not financial advice. These rules are study aids for simulations, not instructions to trade real capital.')),
      ],
      { className: 'playbook-accordion--risk' },
    ));
}

function detailView(root, setup, mods) {
  const simHost = h('div', { class: 'playbook-sim', 'data-keys': 'capture' });
  const diff = difficultyMeta(setup.difficulty);
  root.append(h('div', { class: 'container container--wide playbook-detail' },
    h('a', { class: 'link-btn', href: '/playbook' }, icon('arrow-left', { size: 16 }), 'All setups'),
    h('header', { class: 'page-head' },
      h('p', { class: 'eyebrow eyebrow--accent' }, 'Setup Playbook'),
      h('h1', null, setup.name),
      h('div', { class: 'row row--sm' },
        difficultyChip(setup.difficulty),
        tierChip(setup.tier),
        h('span', { class: `chip ${setup.bias === 'bullish' ? 'chip--bull' : setup.bias === 'bearish' ? 'chip--bear' : 'chip--outline'}` },
          setup.bias === 'bullish' ? 'Long setup' : setup.bias === 'bearish' ? 'Short setup' : 'Indecision / break')),
      h('p', { class: 'muted playbook-detail__diff' }, `Trade difficulty: ${diff.label} — ${diff.blurb}`),
      h('p', { class: 'lead' }, setup.summary),
      h('p', { class: 'faint t-12 playbook-detail__note' }, EXAMPLE_NOTE)),
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
    takeaway('Only take the setup when <strong>every</strong> rule is met. A setup with a missing rule is a different, weaker trade.'),
    detailGuides(setup)));

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
      interval: setup.kind === 'candle' ? '1H' : '1D',
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
    const setup = ctx.param ? setupById(ctx.param) : null;
    if (ctx.param && !setup) {
      root.append(h('div', { class: 'container' },
        h('div', { class: 'route-error card' },
          h('p', { class: 'eyebrow' }, 'Setup Playbook'),
          h('h1', { class: 'route-error__title' }, 'Setup not found'),
          h('p', { class: 'muted' }, `There is no setup called “${ctx.param}” yet.`),
          h('a', { class: 'btn btn--primary', href: '/playbook' }, icon('arrow-left'), 'All setups'))));
      return undefined;
    }
    const gate = toolsTeaser('Setup Playbook');
    if (gate.locked) {
      access.rememberReturn(setup ? `playbook.${setup.id}` : 'playbook');
      const host = h('div', { class: 'playbook-teaser-host' });
      root.append(h('div', { class: 'container' }, gate.banner), gate.wrap(host));
      // Always show the list teaser when locked (even for detail deep-links).
      listView(host, mods);
      const unsub = access.onChange(() => {
        const nowLocked = access.isEnforcing() && !access.hasPaidAccess();
        if (nowLocked === gate.locked) return;
        try { ctx.navigate(ctx.route?.key || 'playbook'); } catch { /* ignore */ }
      });
      return () => { unsub?.(); };
    }
    if (setup) return detailView(root, setup, mods);
    listView(root, mods);
    return undefined;
  },
};
