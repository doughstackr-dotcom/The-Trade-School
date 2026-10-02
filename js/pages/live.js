// Live Market Lab - #live. Current market-hours timeline only.
import { h } from '../core/ui.js';
import { getMarketHoursSnapshot, unifiedTimeline } from '../core/market-hours.js';
import {
  HOURS_TICK_MS,
  mountUnifiedHoursTimeline,
  paintUnifiedHoursTimeline,
} from '../core/live-board.js';

export default {
  id: 'live',
  mount(root) {
    let hoursTimer = null;
    let destroyed = false;

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
        h('p', { class: 'eyebrow eyebrow--accent' }, 'Live Market Lab'),
        h('h1', null, 'Market hours'),
        h('p', { class: 'lead' },
          'Current global trading sessions at a glance. Beginner-friendly - learn when major markets are open before you practice reading charts.')),

      h('section', { class: 'live-hours card', 'aria-label': 'Market hours timeline' },
        h('div', { class: 'live-hours__head row' },
          h('h2', { class: 't-18' }, 'Market hours'),
          h('span', { class: 'live-hours__live row' },
            h('span', { class: 'live-dot', 'data-state': 'live', 'aria-hidden': 'true' }),
            h('span', { class: 'faint' }, 'Live schedule'))),
        hoursHost),

      h('p', { class: 'faint' }, 'Educational only - not financial advice.')));

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
