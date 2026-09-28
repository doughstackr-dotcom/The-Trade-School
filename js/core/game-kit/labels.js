// Game icons and labels: hearts, play-style icons, market interval/date labels and the
// "mystery chart revealed" source card. Part of the game kit; import from js/core/game-kit.js.

import { h, svg, icon } from '../ui.js';
import { findStyle } from '../../registry.js';

const HEART = 'M12 20.5s-7.3-4.5-8.9-9.1C2 8.1 4.2 4.8 7.5 4.8c1.9 0 3.4 1 4.5 2.5 1.1-1.5 2.6-2.5 4.5-2.5 3.3 0 5.5 3.3 4.4 6.6-1.6 4.6-8.9 9.1-8.9 9.1z';

/** Heart line icon (filled by default) — Survival lives. Same sizing contract as ui.icon(). */
export function heartIcon({ size = 18, filled = true, label = null, class: cls = '' } = {}) {
  return svg('svg', {
    class: `icon icon--heart${cls ? ' ' + cls : ''}`,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: filled ? 'currentColor' : 'none',
    stroke: 'currentColor',
    'stroke-width': 1.75,
    'stroke-linejoin': 'round',
    focusable: 'false',
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }),
  }, svg('path', { d: HEART }));
}

/** Icon for a play style: practice → book, arcade → bolt, survival → heart. */
export function styleIcon(styleId, { size = 18, label = null } = {}) {
  if (styleId === 'survival') return heartIcon({ size, label });
  return icon(findStyle(styleId)?.icon || 'gamepad', { size, label });
}

// Same wording as market.js intervalLabel().
const INTERVAL_LABEL = {
  '1m': '1 minute', '5m': '5 minutes', '15m': '15 minutes', '30m': '30 minutes',
  '1h': 'Hourly', '4h': '4 hours', '6h': '6 hours', '1d': 'Daily', '1w': 'Weekly', '1M': 'Monthly',
};

/** '1d' → 'Daily', '1w' → 'Weekly', '1h' → 'Hourly', … (unknown values pass through). */
export function intervalLabel(interval) {
  return INTERVAL_LABEL[interval] || (interval ? String(interval) : '');
}

function toDate(t) {
  if (t == null || t === '') return null;
  if (t instanceof Date) return Number.isNaN(t.getTime()) ? null : t;
  if (typeof t === 'number') {
    if (t > 1e11) return new Date(t); // ms
    if (t > 1e8) return new Date(t * 1000); // seconds
    return null; // a candle index, not a time
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** '12 Mar 2026' (UTC); intraday intervals add ', 14:00 UTC'. '' when t is not a timestamp. */
export function formatMarketDate(t, interval = '1d') {
  const d = toDate(t);
  if (!d) return '';
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (/^\d+[mh]$/.test(String(interval || ''))) {
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${day}, ${hh}:${mm} UTC`;
  }
  return day;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * CandleChart `timeLabel` for real candles (t = ms UTC): '12 Mar' (daily), 'Mar 26' (weekly),
 * '14:05' (intraday). Do not use it on a mystery chart before the reveal — dates give it away.
 */
export function marketTimeLabel(interval = '1d') {
  return (idx, candle) => {
    const d = toDate(candle?.t);
    if (!d) return '';
    if (interval === '1w' || interval === '1M') return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
    if (interval === '1d') return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };
}

function attributionText(a) {
  if (!a) return '';
  const t = String(a).trim();
  return /^(market\s+)?data\b|^source\b|^prices?\b/i.test(t) ? t : `Data: ${t}`;
}

function isTestData(info) {
  return !!(info && (info.mock || info.fixture || info.test || /fixture|mock|test/i.test(String(info.source || ''))));
}

/** "BTC-USD · Daily · 12 Mar 2026 — Data: Coinbase" for a real round / example ({ symbol,
 * interval, candles, decisionIdx, from, to, attribution }). The date is the decision candle's. */
export function sourceText(info) {
  if (!info) return '';
  const when = info.candles?.[info.decisionIdx]?.t ?? info.to ?? info.from ?? info.candles?.[info.candles.length - 1]?.t;
  const main = [info.name && info.name !== info.symbol ? `${info.symbol} (${info.name})` : info.symbol, intervalLabel(info.interval), formatMarketDate(when, info.interval)]
    .filter(Boolean).join(' · ');
  const attr = attributionText(info.attribution);
  return attr ? `${main} — ${attr}` : main;
}

/**
 * The standard "mystery chart" reveal: eyebrow + "SYMBOL · Daily · 12 Mar 2026" + attribution,
 * plus "Delayed · end of day" and "Test data" flags. → Element (.source-reveal).
 */
export function sourceReveal(info, { title = 'Mystery chart revealed', compact = false } = {}) {
  if (!info) return null;
  const when = info.candles?.[info.decisionIdx]?.t ?? info.to ?? info.from ?? info.candles?.[info.candles.length - 1]?.t;
  const date = formatMarketDate(when, info.interval);
  const flags = [
    info.delayed ? h('span', { class: 'chip chip--sm chip--outline' }, icon('clock', { size: 12 }), 'Delayed · end of day') : null,
    isTestData(info) ? h('span', { class: 'chip chip--sm chip--outline source-reveal__test' }, 'Test data') : null,
  ].filter(Boolean);
  return h('div', { class: ['source-reveal', compact && 'source-reveal--compact'], role: 'note', 'aria-label': `${title}: ${sourceText(info)}` },
    h('span', { class: 'source-reveal__icon', 'aria-hidden': 'true' }, icon('eye', { size: 18 })),
    h('div', { class: 'source-reveal__body' },
      title ? h('span', { class: 'source-reveal__eyebrow' }, title) : null,
      h('span', { class: 'source-reveal__line' },
        h('strong', { class: 'mono' }, info.symbol || 'Real market'),
        info.name && info.name !== info.symbol ? h('span', { class: 'source-reveal__name' }, info.name) : null,
        info.interval ? h('span', { class: 'source-reveal__sep', 'aria-hidden': 'true' }, '·') : null,
        info.interval ? h('span', null, intervalLabel(info.interval)) : null,
        date ? h('span', { class: 'source-reveal__sep', 'aria-hidden': 'true' }, '·') : null,
        date ? h('span', { class: 'mono' }, date) : null),
      h('span', { class: 'source-reveal__attr' }, attributionText(info.attribution) || 'Real market data'),
      flags.length ? h('span', { class: 'source-reveal__flags' }, flags) : null));
}
