// Pattern Library — every candlestick and chart pattern with diagram, psychology, how to trade.
import { h, icon } from '../core/ui.js';
import { miniChart } from '../core/chart.js';
import {
  CANDLE_PATTERNS, CHART_PATTERNS, candleScenario, chartScenario,
} from '../core/patterns.js';

const BIAS_TONE = { bullish: 'bull', bearish: 'bear', neutral: 'outline' };

function biasChip(bias) {
  const tone = BIAS_TONE[bias] || 'outline';
  return h('span', { class: ['chip', 'chip--sm', `chip--${tone}`] }, bias || '—');
}

function reliabilityDots(n = 1) {
  const max = 3;
  return h('span', {
    class: 'lib-reli mono',
    title: `Textbook reliability ${n}/${max}`,
    'aria-label': `Reliability ${n} of ${max}`,
  }, '●'.repeat(Math.max(1, Math.min(max, n))) + '○'.repeat(Math.max(0, max - n)));
}

function candleThumb(id) {
  try {
    const sc = candleScenario(id, { seed: hashId(id), leadIn: 14, after: 3 });
    return miniChart(sc.candles, {
      width: 280, height: 120, yPad: 0.14,
      overlays: [{ type: 'box', from: sc.start, to: sc.end, color: sc.bias === 'bearish' ? 'bear' : sc.bias === 'bullish' ? 'bull' : 'accent', label: CANDLE_PATTERNS[id]?.name }],
      ariaLabel: `${CANDLE_PATTERNS[id]?.name || id} example`,
    });
  } catch {
    return h('div', { class: 'lib-thumb-fallback muted' }, 'Diagram unavailable');
  }
}

function chartThumb(id) {
  try {
    const sc = chartScenario(id, { seed: hashId(id), count: 90, after: 12 });
    const candles = sc.candles || [];
    const from = sc.patternStart ?? 0;
    const to = sc.patternEnd ?? Math.min(candles.length - 1, from + 10);
    const overlays = [
      { type: 'box', from, to, color: sc.bias === 'bearish' ? 'bear' : sc.bias === 'bullish' ? 'bull' : 'accent', label: CHART_PATTERNS[id]?.name },
    ];
    const neck = sc.neckline;
    const neckPx = typeof neck === 'number' ? neck : neck?.y1;
    if (Number.isFinite(neckPx)) overlays.push({ type: 'hline', price: neckPx, color: 'accent', dashed: true, label: 'Neckline' });
    return miniChart(candles, {
      width: 320, height: 140, yPad: 0.12, overlays,
      ariaLabel: `${CHART_PATTERNS[id]?.name || id} example`,
    });
  } catch {
    return h('div', { class: 'lib-thumb-fallback muted' }, 'Diagram unavailable');
  }
}

function hashId(id) {
  let hsh = 0;
  for (let i = 0; i < id.length; i++) hsh = (hsh * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(hsh) % 1e9) || 1;
}

function patternCard(p, kind) {
  const href = `#library.${p.id}`;
  return h('article', { class: 'lib-card card', id: `lib-card-${p.id}` },
    h('a', { class: 'lib-card__link', href },
      h('header', { class: 'lib-card__head' },
        h('h3', { class: 'lib-card__title' }, p.name),
        h('div', { class: 'lib-card__meta' }, biasChip(p.bias), reliabilityDots(p.reliability))),
      h('div', { class: 'lib-card__thumb' }, kind === 'candle' ? candleThumb(p.id) : chartThumb(p.id)),
      h('p', { class: 'lib-card__sum' }, p.summary),
      h('p', { class: 'faint lib-card__kind' }, kind === 'candle'
        ? `${p.candles}-candle · ${p.kind} · context: ${p.context}`
        : `${p.kind} · chart pattern`)),
  );
}

function detailView(p, kind, onBack) {
  const thumb = kind === 'candle' ? candleThumb(p.id) : chartThumb(p.id);
  return h('article', { class: 'lib-detail card card--raised', 'aria-labelledby': 'lib-detail-h' },
    h('button', { type: 'button', class: 'btn btn--ghost', on: { click: onBack } }, icon('arrow-left', { size: 14 }), 'All patterns'),
    h('header', { class: 'lib-detail__head' },
      h('p', { class: 'eyebrow' }, kind === 'candle' ? 'Candlestick pattern' : 'Chart pattern'),
      h('h2', { id: 'lib-detail-h' }, p.name),
      h('div', { class: 'row' }, biasChip(p.bias), reliabilityDots(p.reliability),
        kind === 'candle' ? h('span', { class: 'chip chip--sm chip--outline' }, `${p.candles} candle${p.candles > 1 ? 's' : ''}`) : null,
        h('span', { class: 'chip chip--sm chip--outline' }, p.kind))),
    h('div', { class: 'lib-detail__chart' }, thumb),
    h('section', null,
      h('h3', { class: 't-18' }, 'What it looks like'),
      h('p', null, p.summary)),
    h('section', null,
      h('h3', { class: 't-18' }, 'Psychology'),
      h('p', null, p.psychology)),
    h('section', null,
      h('h3', { class: 't-18' }, 'How to trade it'),
      h('p', null, p.howToTrade)),
    p.target ? h('section', null,
      h('h3', { class: 't-18' }, 'Measured target'),
      h('p', null, p.target)) : null,
    kind === 'candle' && p.context
      ? h('p', { class: 'callout callout--tip' }, icon('info', { size: 16 }),
        h('span', null, 'Best context: ', h('strong', null, p.context), '. Shape alone is not a trade — wait for confirmation.'))
      : h('p', { class: 'callout callout--tip' }, icon('info', { size: 16 }),
        h('span', null, 'Educational diagrams only — not financial advice. Patterns fail; always use a stop.')),
    h('p', { class: 'row' },
      kind === 'candle'
        ? h('a', { class: 'btn btn--ghost', href: '#l.candle-patterns' }, 'Candlestick lesson')
        : h('a', { class: 'btn btn--ghost', href: '#l.chart-patterns' }, 'Chart patterns lesson'),
      h('a', { class: 'btn btn--ghost', href: '#playbook' }, 'Setup Playbook')),
  );
}

function filterBar(state, onChange) {
  const kinds = [
    { id: 'all', label: 'All' },
    { id: 'candle', label: 'Candlesticks' },
    { id: 'chart', label: 'Chart patterns' },
  ];
  const biases = [
    { id: 'all', label: 'Any bias' },
    { id: 'bullish', label: 'Bullish' },
    { id: 'bearish', label: 'Bearish' },
    { id: 'neutral', label: 'Neutral' },
  ];
  return h('div', { class: 'lib-filters row', role: 'search' },
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Pattern type' },
      kinds.map((k) => h('button', {
        type: 'button',
        class: ['seg__btn', state.kind === k.id && 'is-active'],
        'aria-pressed': state.kind === k.id ? 'true' : 'false',
        on: { click: () => onChange({ ...state, kind: k.id }) },
      }, k.label))),
    h('label', { class: 'field field--inline' },
      h('span', { class: 'visually-hidden' }, 'Bias'),
      h('select', {
        class: 'input', 'aria-label': 'Filter by bias',
        on: { change: (e) => onChange({ ...state, bias: e.target.value }) },
      }, biases.map((b) => h('option', { value: b.id, selected: state.bias === b.id }, b.label)))),
    h('label', { class: 'field field--inline grow' },
      h('span', { class: 'visually-hidden' }, 'Search'),
      h('input', {
        type: 'search', class: 'input', placeholder: 'Search patterns…', value: state.q,
        'aria-label': 'Search patterns',
        on: { input: (e) => onChange({ ...state, q: e.target.value }) },
      })),
  );
}

export default {
  id: 'library',
  mount(root, ctx) {
    const candles = Object.values(CANDLE_PATTERNS);
    const charts = Object.values(CHART_PATTERNS);
    const total = candles.length + charts.length;
    let state = { kind: 'all', bias: 'all', q: '' };
    const host = h('div', { class: 'container library-page' });

    const showDetail = (id) => {
      const p = CANDLE_PATTERNS[id] || CHART_PATTERNS[id];
      if (!p) {
        renderList();
        return;
      }
      const kind = CANDLE_PATTERNS[id] ? 'candle' : 'chart';
      host.replaceChildren(
        h('header', { class: 'page-head' },
          h('p', { class: 'eyebrow eyebrow--accent' }, 'Reference'),
          h('h1', null, 'Pattern Library')),
        detailView(p, kind, () => {
          ctx.navigate('library');
          renderList();
        }),
      );
      host.querySelector('#lib-detail-h')?.focus?.();
    };

    const matches = () => {
      const q = state.q.trim().toLowerCase();
      const ok = (p, kind) => {
        if (state.kind !== 'all' && state.kind !== kind) return false;
        if (state.bias !== 'all' && p.bias !== state.bias) return false;
        if (!q) return true;
        const hay = `${p.name} ${p.summary} ${p.kind} ${p.bias}`.toLowerCase();
        return hay.includes(q);
      };
      return {
        candles: candles.filter((p) => ok(p, 'candle')),
        charts: charts.filter((p) => ok(p, 'chart')),
      };
    };

    const renderList = () => {
      const { candles: cList, charts: hList } = matches();
      const shown = cList.length + hList.length;
      host.replaceChildren(
        h('header', { class: 'page-head' },
          h('p', { class: 'eyebrow eyebrow--accent' }, 'Reference'),
          h('h1', null, 'Pattern Library'),
          h('p', { class: 'lead' },
            'Every candlestick and chart pattern taught in the school — annotated diagram, the psychology behind it, and how traders typically use it. Educational only, not advice.')),
        h('p', { class: 'muted lib-count' },
          h('strong', { class: 'mono' }, String(shown)), ` of ${total} patterns`,
          ` · ${candles.length} candlestick · ${charts.length} chart`),
        filterBar(state, (next) => { state = next; renderList(); }),
        cList.length ? h('section', { class: 'section section--tight', 'aria-labelledby': 'lib-c-h' },
          h('div', { class: 'section-head' },
            h('div', null, h('p', { class: 'eyebrow' }, `${cList.length} patterns`), h('h2', { id: 'lib-c-h' }, 'Candlestick patterns'))),
          h('div', { class: 'lib-grid' }, cList.map((p) => patternCard(p, 'candle')))) : null,
        hList.length ? h('section', { class: 'section section--tight', 'aria-labelledby': 'lib-h-h' },
          h('div', { class: 'section-head' },
            h('div', null, h('p', { class: 'eyebrow' }, `${hList.length} patterns`), h('h2', { id: 'lib-h-h' }, 'Chart patterns'))),
          h('div', { class: 'lib-grid' }, hList.map((p) => patternCard(p, 'chart')))) : null,
        !shown ? h('p', { class: 'card muted' }, 'No patterns match that filter. Clear search or pick All.') : null,
      );
    };

    root.append(host);
    const param = ctx.param || ctx.route?.param;
    if (param && (CANDLE_PATTERNS[param] || CHART_PATTERNS[param])) showDetail(param);
    else renderList();

    return () => {};
  },
};
