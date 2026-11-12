// Live Market Lab — #live. A live market-hours timeline plus a short history of markets.
// Market hours are computed locally; this page makes no quote or chart requests.
import { h } from '../core/ui.js';
import { getMarketHoursSnapshot, unifiedTimeline } from '../core/market-hours.js';
import {
  HOURS_TICK_MS,
  mountUnifiedHoursTimeline,
  paintUnifiedHoursTimeline,
} from '../core/live-board.js';

const MARKET_HISTORY = [
  {
    date: 'Before 1000 BCE',
    title: 'Ancient marketplaces',
    text: 'Farmers and merchants met in bazaars, agoras and forums to trade grain, salt, cloth and metal. Standard weights, coins and written contracts made prices easier to agree and trades easier to settle.',
  },
  {
    date: '1602',
    title: 'The first tradable shares',
    text: 'The Dutch East India Company raised capital by selling shares. Amsterdam’s exchange gave those shares a secondary market, creating one of the first modern stock markets.',
  },
  {
    date: '1792',
    title: 'The Buttonwood Agreement',
    text: 'Twenty-four brokers met under a buttonwood tree on Wall Street and agreed to trade securities with one another. Their compact became the New York Stock Exchange.',
  },
  {
    date: '1848',
    title: 'Futures take root',
    text: 'Chicago merchants formed the Board of Trade to bring order to grain trading. It later standardized futures contracts so farmers and buyers could lock in a price for later delivery.',
  },
  {
    date: '1933–34',
    title: 'Rules after the crash',
    text: 'After the 1929 crash and the Great Depression, the United States required securities disclosure and created the SEC. Many modern investor protections grew out of those failures.',
  },
  {
    date: '1971–2009',
    title: 'Screens and 24/7 markets',
    text: 'Nasdaq opened as the first fully electronic US stock market in 1971. Screens gradually replaced trading floors, and Bitcoin introduced a round-the-clock market in 2009.',
  },
];

function historySection() {
  return h('section', { class: 'market-history', 'aria-labelledby': 'market-history-h' },
    h('div', { class: 'section-head' },
      h('div', null,
        h('p', { class: 'eyebrow eyebrow--accent' }, 'Market history'),
        h('h2', { id: 'market-history-h' }, 'How markets began')),
      h('p', { class: 'muted' }, 'Six turning points in how buyers and sellers meet.')),
    h('ol', { class: 'history-grid' },
      ...MARKET_HISTORY.map((item) => h('li', { class: 'history-stop' },
        h('span', { class: 'history-stop__date' }, item.date),
        h('h3', { class: 'history-stop__title' }, item.title),
        h('p', { class: 'history-stop__text' }, item.text)))),
    h('aside', { class: 'history-note' },
      h('h3', { class: 'history-note__title' }, 'The through-line'),
      h('p', { class: 'history-note__text' },
        'The tools have changed — from clay tablets to matching engines — but the job of a market has not: bring buyers and sellers together and let them discover a price. Liquidity, information and emotion still decide who trades, and when.')));
}

export default {
  id: 'live',
  mount(root) {
    let destroyed = false;
    let hoursTimer = null;

    const hoursHost = h('div', { class: 'live-hours__timeline-host' });
    const timelineRoot = mountUnifiedHoursTimeline(hoursHost);

    const paintHours = () => {
      if (destroyed) return;
      const snap = getMarketHoursSnapshot();
      const data = unifiedTimeline(snap.at, snap.clientTz);
      paintUnifiedHoursTimeline(timelineRoot, data);
    };

    root.append(h('div', { class: 'container live' },
      h('header', { class: 'page-head' },
        h('p', { class: 'eyebrow eyebrow--accent' }, 'Markets · Hours & history'),
        h('h1', null, 'The market day — and how it began'),
        h('p', { class: 'lead' },
          'See which major market centres are open right now, then trace the ideas that turned local bazaars into a global, nearly continuous marketplace.')),

      h('section', { class: 'live-hours card', 'aria-label': 'Market hours timeline' },
        h('div', { class: 'live-hours__head row' },
          h('h2', { class: 't-18' }, 'Market hours'),
          h('span', { class: 'live-hours__live row' },
            h('span', { class: 'live-dot', 'data-state': 'live', 'aria-hidden': 'true' }),
            h('span', { class: 'faint' }, 'Live schedule'))),
        hoursHost),

      historySection(),

      h('p', { class: 'faint live-disclaimer' }, 'Educational only — not financial advice.')));

    paintHours();
    hoursTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      paintHours();
    }, HOURS_TICK_MS);

    return () => {
      destroyed = true;
      if (hoursTimer) clearInterval(hoursTimer);
    };
  },
};
