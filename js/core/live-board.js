// Shared Live Market Lab UI helpers — hours progress bars, quote cards, compact dashboard board.
// Pure DOM builders (via ui.h); no page lifecycle. Used by js/pages/live.js and the Dashboard.

import { h, icon, svg } from './ui.js';
import {
  getMarketHoursSnapshot,
  assetSessionStatus,
  unifiedTimeline,
  venueForSymbol,
} from './market-hours.js';
import { LIVE_QUOTE_SYMBOLS } from './market.js';

export const POLL_MS = 45_000;
export const HOURS_TICK_MS = 1_000;
export const BOARD_ROTATE_MS = 10_000;
export const BOARD_VISIBLE_MAX = 5;
export const DEFAULT_BOARD = LIVE_QUOTE_SYMBOLS;

export function fmtPrice(n, decimals = 2) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

export function sparklineSvg(values, { up = true } = {}) {
  const vals = (values || []).filter((v) => Number.isFinite(v));
  if (vals.length < 2) {
    return h('span', { class: 'live-spark live-spark--empty', 'aria-hidden': 'true' });
  }
  const w = 96;
  const ht = 36;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * (w - 4) + 2;
    const y = ht - 4 - ((v - min) / span) * (ht - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return svg('svg', {
    class: ['live-spark', up ? 'is-up' : 'is-down'],
    width: w,
    height: ht,
    viewBox: `0 0 ${w} ${ht}`,
    'aria-hidden': 'true',
    focusable: 'false',
  }, svg('polyline', { points: pts, fill: 'none', 'stroke-width': 1.75 }));
}

/**
 * Animated session progress bar for a marketStatus snapshot.
 * Track = local day; each session window is positioned; fill advances with the clock;
 * accent “now” marker follows dayProgress. CSS transitions animate the fill.
 * @param {ReturnType<import('./market-hours.js').marketStatus>} st
 */
export function hoursBarEl(st) {
  const dayMins = 24 * 60;
  const bars = Array.isArray(st?.sessionBars) ? st.sessionBars : [];
  const sessions = bars.map((b) => {
    const left = (b.openMin / dayMins) * 100;
    const width = (Math.max(1, b.closeMin - b.openMin) / dayMins) * 100;
    const fillPct = Math.min(100, Math.max(0, (b.progress || 0) * 100));
    return h('div', {
      class: [
        'live-hours-bar__session',
        b.active && 'is-active',
        b.done && 'is-done',
      ],
      style: `left:${left.toFixed(3)}%;width:${width.toFixed(3)}%`,
      title: `${b.open}–${b.close}`,
    },
      h('div', {
        class: 'live-hours-bar__fill',
        style: `width:${fillPct.toFixed(2)}%`,
      }));
  });

  const nowPct = Math.min(100, Math.max(0, (st?.dayProgress || 0) * 100));
  const first = bars[0];
  const last = bars[bars.length - 1];
  const openLabel = first?.open || '';
  const closeLabel = last?.close || '';

  return h('div', {
    class: 'live-hours-bar',
    role: 'img',
    'aria-label': st?.open
      ? `Session ${Math.round((st.progress || 0) * 100)}% through`
      : 'Session closed',
  },
    h('div', { class: 'live-hours-bar__track' },
      ...sessions,
      h('div', {
        class: 'live-hours-bar__now',
        style: `left:${nowPct.toFixed(3)}%`,
        'aria-hidden': 'true',
      })),
    h('div', { class: 'live-hours-bar__labels faint' },
      h('span', null, openLabel),
      h('span', null, closeLabel)));
}

/** Equity / forex hours card with Open/Closed pill, clock, and animated bars. */
export function hoursCard(st) {
  const sessions = (st.sessions || []).join(', ');
  const boundary = st.boundary?.atLabel || '';
  return h('article', {
    class: [
      'live-hours-card',
      'live-hours-card--bars',
      st.open ? 'is-open' : 'is-closed',
    ],
    'data-market-id': st.id || '',
    'aria-label': `${st.short}: ${st.open ? 'open' : 'closed'}`,
  },
    h('div', { class: 'live-hours-card__head' },
      h('span', { class: 'live-hours-card__name' }, st.short),
      h('span', {
        class: ['live-pill', st.open ? 'live-pill--open' : 'live-pill--closed'],
        'aria-hidden': 'true',
      },
        h('span', { class: 'live-pill__dot' }),
        st.open ? 'Open' : 'Closed')),
    h('p', { class: 'live-hours-card__clock mono' }, st.localTime),
    h('p', { class: 'live-hours-card__tz faint' }, `${st.city} · ${st.tzAbbrev}`),
    h('p', { class: 'live-hours-card__sess faint' }, sessions),
    boundary ? h('p', { class: 'live-hours-card__next faint' }, boundary) : null,
    hoursBarEl(st));
}


/** Update an existing hours card in place so bar fills / now-marker can CSS-transition. */
export function updateHoursCard(el, st) {
  if (!el || !st) return;
  el.classList.toggle('is-open', !!st.open);
  el.classList.toggle('is-closed', !st.open);
  el.setAttribute('aria-label', `${st.short}: ${st.open ? 'open' : 'closed'}`);
  el.dataset.marketId = st.id || '';

  const name = el.querySelector('.live-hours-card__name');
  if (name) name.textContent = st.short;

  const pill = el.querySelector('.live-pill');
  if (pill) {
    pill.classList.toggle('live-pill--open', !!st.open);
    pill.classList.toggle('live-pill--closed', !st.open);
    const label = st.open ? 'Open' : 'Closed';
    // keep the dot span; replace trailing text
    const dot = pill.querySelector('.live-pill__dot');
    pill.textContent = '';
    if (dot) pill.append(dot);
    else pill.append(h('span', { class: 'live-pill__dot' }));
    pill.append(document.createTextNode(label));
  }

  const clock = el.querySelector('.live-hours-card__clock');
  if (clock) clock.textContent = st.localTime || '';

  const tz = el.querySelector('.live-hours-card__tz');
  if (tz) tz.textContent = `${st.city} · ${st.tzAbbrev}`;

  const sess = el.querySelector('.live-hours-card__sess');
  if (sess) sess.textContent = (st.sessions || []).join(', ');

  let next = el.querySelector('.live-hours-card__next');
  const boundary = st.boundary?.atLabel || '';
  if (boundary) {
    if (!next) {
      next = h('p', { class: 'live-hours-card__next faint' });
      const bar = el.querySelector('.live-hours-bar');
      if (bar) el.insertBefore(next, bar);
      else el.append(next);
    }
    next.textContent = boundary;
  } else if (next) {
    next.remove();
  }

  syncHoursBar(el.querySelector('.live-hours-bar'), st);
}

/** Patch fill widths + now marker on an existing bar (preserves CSS transitions). */
export function syncHoursBar(barEl, st) {
  if (!barEl || !st) return;
  const dayMins = 24 * 60;
  const bars = Array.isArray(st.sessionBars) ? st.sessionBars : [];
  const track = barEl.querySelector('.live-hours-bar__track');
  if (!track) return;

  let sessions = [...track.querySelectorAll('.live-hours-bar__session')];
  // Rebuild session shells only when count/windows change
  const sig = bars.map((b) => `${b.open}-${b.close}`).join('|');
  if (barEl.dataset.sessSig !== sig || sessions.length !== bars.length) {
    const nowEl = track.querySelector('.live-hours-bar__now');
    track.querySelectorAll('.live-hours-bar__session').forEach((n) => n.remove());
    for (const b of bars) {
      const left = (b.openMin / dayMins) * 100;
      const width = (Math.max(1, b.closeMin - b.openMin) / dayMins) * 100;
      const sess = h('div', {
        class: 'live-hours-bar__session',
        style: `left:${left.toFixed(3)}%;width:${width.toFixed(3)}%`,
        title: `${b.open}–${b.close}`,
      }, h('div', { class: 'live-hours-bar__fill', style: 'width:0%' }));
      if (nowEl) track.insertBefore(sess, nowEl);
      else track.append(sess);
    }
    barEl.dataset.sessSig = sig;
    sessions = [...track.querySelectorAll('.live-hours-bar__session')];
  }

  bars.forEach((b, i) => {
    const sess = sessions[i];
    if (!sess) return;
    sess.classList.toggle('is-active', !!b.active);
    sess.classList.toggle('is-done', !!b.done);
    const fill = sess.querySelector('.live-hours-bar__fill');
    if (fill) {
      const fillPct = Math.min(100, Math.max(0, (b.progress || 0) * 100));
      fill.style.width = `${fillPct.toFixed(2)}%`;
    }
  });

  const nowPct = Math.min(100, Math.max(0, (st.dayProgress || 0) * 100));
  let now = track.querySelector('.live-hours-bar__now');
  if (!now) {
    now = h('div', { class: 'live-hours-bar__now', 'aria-hidden': 'true' });
    track.append(now);
  }
  now.style.left = `${nowPct.toFixed(3)}%`;

  const labels = barEl.querySelector('.live-hours-bar__labels');
  if (labels && bars.length) {
    const spans = labels.querySelectorAll('span');
    if (spans[0]) spans[0].textContent = bars[0].open;
    if (spans[1]) spans[1].textContent = bars[bars.length - 1].close;
  }

  barEl.setAttribute(
    'aria-label',
    st.open ? `Session ${Math.round((st.progress || 0) * 100)}% through` : 'Session closed',
  );
}

/**
 * Paint or update a grid of hours cards. Reuses DOM when market ids match so fills animate.
 * @param {HTMLElement} container
 * @param {object[]} statuses
 */
export function paintHoursCards(container, statuses) {
  if (!container) return;
  const list = statuses || [];
  const kids = [...container.children];
  const same =
    kids.length === list.length
    && kids.every((el, i) => el.dataset.marketId === (list[i]?.id || ''));
  if (same) {
    list.forEach((st, i) => updateHoursCard(kids[i], st));
    return;
  }
  container.replaceChildren(...list.map((st) => {
    const card = hoursCard(st);
    card.dataset.marketId = st.id || '';
    return card;
  }));
}

export function overlapChip(o) {
  return h('span', {
    class: ['live-overlap', o.active && 'is-active'],
    title: o.blurb,
  },
    h('span', { class: 'live-overlap__dot', 'aria-hidden': 'true' }),
    o.label,
    o.active ? h('span', { class: 'live-overlap__tag' }, 'live') : null);
}

const TIMELINE_TICK_HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

function fmtAxisHour(h) {
  if (h === 0 || h === 24) return '12a';
  if (h === 12) return '12p';
  if (h < 12) return `${h}a`;
  return `${h - 12}p`;
}

/**
 * Mount the unified 24h market-hours timeline shell into `container`.
 * Returns the root `.live-timeline` element for subsequent paint calls.
 * @param {HTMLElement} container
 */
export function mountUnifiedHoursTimeline(container) {
  if (!container) return null;
  const axis = h('div', {
    class: 'live-timeline__axis',
    'aria-hidden': 'true',
  },
    ...TIMELINE_TICK_HOURS.map((hr) => h('span', {
      class: 'live-timeline__tick',
      style: `left:${((hr / 24) * 100).toFixed(3)}%`,
    }, fmtAxisHour(hr))));

  const lanes = h('div', {
    class: 'live-timeline__lanes',
    role: 'list',
    'aria-label': 'Market session lanes',
  });
  const now = h('div', {
    class: 'live-timeline__now',
    'aria-hidden': 'true',
  });
  const body = h('div', { class: 'live-timeline__body' }, lanes, now);
  const context = h('p', { class: 'live-timeline__context' });
  const overlaps = h('div', {
    class: 'live-timeline__overlaps',
    role: 'list',
    'aria-label': 'Session overlaps',
  });
  const note = h('p', { class: 'faint live-hours__note live-timeline__note' });
  const tzLabel = h('span', { class: 'live-timeline__tz faint' });

  const root = h('div', {
    class: 'live-timeline',
    role: 'img',
    'aria-label': 'Unified market hours timeline',
  },
    h('div', { class: 'live-timeline__head row' },
      h('span', { class: 'live-timeline__axis-label faint' }, 'Local day'),
      tzLabel),
    axis,
    body,
    overlaps,
    context,
    note);

  container.replaceChildren(root);
  return root;
}

/**
 * Paint / update a mounted unified timeline (preserves now-line CSS transition).
 * @param {HTMLElement} el root from mountUnifiedHoursTimeline, or a wrapper
 * @param {ReturnType<typeof unifiedTimeline>|ReturnType<typeof getMarketHoursSnapshot>|null} [snapOrData]
 */
export function paintUnifiedHoursTimeline(el, snapOrData) {
  if (!el) return;
  const root = el.classList?.contains('live-timeline')
    ? el
    : el.querySelector?.('.live-timeline');
  if (!root) return;

  const data = snapOrData?.rows
    ? snapOrData
    : unifiedTimeline(
      snapOrData?.at ?? Date.now(),
      snapOrData?.clientTz || snapOrData?.displayTz,
    );

  const tzLabel = root.querySelector('.live-timeline__tz');
  if (tzLabel) {
    tzLabel.textContent = `${data.displayTz} · ${data.displayTzAbbrev}`;
  }

  const lanesHost = root.querySelector('.live-timeline__lanes');
  if (lanesHost) {
    const kids = [...lanesHost.children];
    const same =
      kids.length === data.rows.length
      && kids.every((node, i) => node.dataset.marketId === (data.rows[i]?.id || ''));

    if (!same) {
      lanesHost.replaceChildren(...data.rows.map((row) => timelineLaneEl(row)));
    } else {
      data.rows.forEach((row, i) => updateTimelineLane(kids[i], row));
    }
  }

  const nowEl = root.querySelector('.live-timeline__now');
  if (nowEl) {
    const frac = Math.min(1, Math.max(0, data.nowMin / (24 * 60)));
    nowEl.style.left =
      `calc(var(--timeline-label-w) + (100% - var(--timeline-label-w)) * ${frac.toFixed(5)})`;
  }

  const overlapsHost = root.querySelector('.live-timeline__overlaps');
  if (overlapsHost && Array.isArray(data.overlaps)) {
    overlapsHost.replaceChildren(...data.overlaps.map(overlapChip));
  }

  const contextEl = root.querySelector('.live-timeline__context');
  if (contextEl) contextEl.textContent = data.context || '';

  const noteEl = root.querySelector('.live-timeline__note');
  if (noteEl) {
    noteEl.textContent =
      `Shared ${data.displayTzAbbrev || 'local'} axis (DST-aware). `
      + 'Exchange holidays not tracked — weekends closed for equities & FX sessions.';
  }

  root.setAttribute(
    'aria-label',
    `Market hours timeline in ${data.displayTz}. ${data.context || ''}`.trim(),
  );
}

function timelineLaneEl(row) {
  return h('div', {
    class: [
      'live-timeline__lane',
      row.open && 'is-open',
      row.kind === 'forex' && 'is-forex',
    ],
    role: 'listitem',
    'data-market-id': row.id || '',
    'aria-label': `${row.short}: ${row.open ? 'open' : 'closed'}`,
  },
    h('div', { class: 'live-timeline__label' },
      h('span', { class: 'live-timeline__name' }, row.short),
      h('span', {
        class: ['live-pill', row.open ? 'live-pill--open' : 'live-pill--closed'],
        'aria-hidden': 'true',
      },
        h('span', { class: 'live-pill__dot' }),
        row.open ? 'Open' : 'Closed')),
    h('div', { class: 'live-timeline__track' },
      ...row.segments.map(timelineSegEl)));
}

function timelineSegEl(seg) {
  const left = (seg.startMin / (24 * 60)) * 100;
  const width = (Math.max(0.5, seg.endMin - seg.startMin) / (24 * 60)) * 100;
  return h('div', {
    class: [
      'live-timeline__bar',
      seg.active && 'is-active',
      seg.done && 'is-done',
    ],
    style: `left:${left.toFixed(3)}%;width:${width.toFixed(3)}%`,
    title: seg.label || '',
  });
}

function updateTimelineLane(el, row) {
  if (!el || !row) return;
  el.classList.toggle('is-open', !!row.open);
  el.classList.toggle('is-forex', row.kind === 'forex');
  el.setAttribute('aria-label', `${row.short}: ${row.open ? 'open' : 'closed'}`);

  const name = el.querySelector('.live-timeline__name');
  if (name) name.textContent = row.short;

  const pill = el.querySelector('.live-pill');
  if (pill) {
    pill.classList.toggle('live-pill--open', !!row.open);
    pill.classList.toggle('live-pill--closed', !row.open);
    const dot = pill.querySelector('.live-pill__dot');
    pill.textContent = '';
    if (dot) pill.append(dot);
    else pill.append(h('span', { class: 'live-pill__dot' }));
    pill.append(document.createTextNode(row.open ? 'Open' : 'Closed'));
  }

  const track = el.querySelector('.live-timeline__track');
  if (!track) return;
  const sig = row.segments.map((s) => `${s.startMin.toFixed(1)}-${s.endMin.toFixed(1)}`).join('|');
  if (el.dataset.segSig !== sig) {
    track.replaceChildren(...row.segments.map(timelineSegEl));
    el.dataset.segSig = sig;
    return;
  }
  const bars = [...track.querySelectorAll('.live-timeline__bar')];
  row.segments.forEach((seg, i) => {
    const bar = bars[i];
    if (!bar) return;
    bar.classList.toggle('is-active', !!seg.active);
    bar.classList.toggle('is-done', !!seg.done);
  });
}

/**
 * Filter board quotes to those currently in session (crypto always open).
 * @param {object[]} quotes
 * @param {Date|number} [at]
 */
export function openBoardQuotes(quotes, at = Date.now()) {
  return (quotes || []).filter((q) => q?.symbol && assetSessionStatus(q.symbol, at).open);
}

/**
 * Pick the visible window of open quotes for rotating the Live board.
 * @param {object[]} openQuotes
 * @param {{ offset?: number, max?: number }} [opts]
 */
export function rotateBoardWindow(openQuotes, { offset = 0, max = BOARD_VISIBLE_MAX } = {}) {
  const list = openQuotes || [];
  if (list.length <= max) {
    return { visible: list, offset: 0, rotating: false };
  }
  const start = ((offset % list.length) + list.length) % list.length;
  const visible = [];
  for (let i = 0; i < max; i++) {
    visible.push(list[(start + i) % list.length]);
  }
  return { visible, offset: start, rotating: true };
}

/**
 * Fallback set when no equity/FX floors are open — prefer 24/7 crypto, else all.
 * @param {object[]} allQuotes
 */
export function fallbackBoardQuotes(allQuotes) {
  const list = allQuotes || [];
  const crypto = list.filter((q) => venueForSymbol(q.symbol)?.alwaysOpen);
  return crypto.length ? crypto : list;
}


/**
 * Quote card with optional market open/closed badge (from assetSessionStatus).
 * @param {object} q
 * @param {{ selected?: boolean, onSelect?: (symbol: string) => void, showSession?: boolean }} opts
 */
export function quoteCard(q, { selected = false, onSelect, showSession = false } = {}) {
  const up = (q.change ?? 0) >= 0;
  const dec = q.symbol?.includes('EUR') || q.symbol?.includes('GBP') ? 4 : 2;
  let sessionBadge = null;
  if (showSession && q.symbol) {
    const sess = assetSessionStatus(q.symbol);
    sessionBadge = h('span', {
      class: [
        'live-quote__session',
        'live-pill',
        sess.open ? 'live-pill--open' : 'live-pill--closed',
      ],
      title: sess.note || (sess.open ? 'Market open' : 'Market closed'),
    },
      h('span', { class: 'live-pill__dot' }),
      sess.open ? 'Open' : 'Closed');
  }
  return h('button', {
    type: 'button',
    class: [
      'live-quote',
      'card',
      selected && 'is-selected',
      q.ok === false && 'is-dead',
      showSession && q._sessionOpen === false && 'is-market-closed',
    ],
    'aria-pressed': selected ? 'true' : 'false',
    'aria-label': `${q.name || q.symbol}, ${fmtPrice(q.price, dec)}, ${fmtPct(q.changePct)}`,
    on: onSelect ? { click: () => onSelect(q.symbol) } : undefined,
  },
    h('div', { class: 'live-quote__top' },
      h('span', { class: 'live-quote__sym mono' }, q.symbol),
      sparklineSvg(q.sparkline, { up })),
    h('p', { class: 'live-quote__name faint' }, q.name || q.symbol),
    sessionBadge,
    h('p', { class: ['live-quote__px', 'mono', up ? 'is-up' : 'is-down'] }, fmtPrice(q.price, dec)),
    h('p', { class: ['live-quote__chg', 'mono', up ? 'is-up' : 'is-down'] },
      q.change == null
        ? '—'
        : `${up ? '+' : ''}${fmtPrice(q.change, dec)} (${fmtPct(q.changePct)})`));
}

/**
 * Compact hours strip for Dashboard — NYSE + key FX sessions with bars.
 * @param {ReturnType<getMarketHoursSnapshot>} [snap]
 */
export function compactHoursStrip(snap) {
  const s = snap || getMarketHoursSnapshot();
  const picks = [
    s.equities.find((e) => e.id === 'nyse') || s.equities[0],
    s.equities.find((e) => e.id === 'lse'),
    s.forex.find((e) => e.id === 'fx-london'),
    s.forex.find((e) => e.id === 'fx-newyork'),
  ].filter(Boolean);
  return h('div', {
    class: 'live-hours__grid dash-live__hours',
    role: 'list',
    'aria-label': 'Market hours',
  }, ...picks.map(hoursCard));
}

/**
 * Mount a self-contained Live markets widget into `host` (Dashboard).
 * Polls quotes (~45s), ticks hours every 1s, loads a detail chart for the selected symbol.
 * Returns an unmount/cleanup function.
 * @param {HTMLElement} host
 * @param {{ symbols?: string[] }} [opts]
 */
export function mountLiveMarketsWidget(host, { symbols = DEFAULT_BOARD } = {}) {
  const boardSymbols = [...symbols];
  let selected = boardSymbols[0] || 'SPY';
  let lastQuotes = [];
  let lastFetchedAt = 0;
  let stale = false;
  let delayed = true;
  let unconfigured = false;
  let attribution = '';
  let chart = null;
  let lastCandles = null;
  let pollTimer = null;
  let hoursTimer = null;
  let destroyed = false;
  let chartMod = null;
  let marketMod = null;
  let dataMod = null;

  const statusEl = h('span', { class: 'live-status__text' });
  const dot = h('span', { class: 'live-dot', 'aria-hidden': 'true' });
  const updatedEl = h('span', { class: 'live-updated mono faint' });
  const feedEl = h('span', { class: 'live-feed-badge faint' });
  const board = h('div', {
    class: 'live-board dash-live__board',
    role: 'list',
    'aria-label': 'Market quotes',
  });
  const hoursHost = h('div', { class: 'dash-live__hours-wrap' });
  const chartHost = h('div', { class: 'chart-frame live__chart dash-live__chart' });
  const chartTitle = h('h3', { class: 't-18 dash-live__chart-title' }, 'Daily chart · SPY');
  const attrib = h('p', { class: 'faint live-attrib' });

  const setStatus = (key, text) => {
    statusEl.textContent = text || key;
    dot.dataset.state = key;
  };

  const paintFeed = () => {
    if (unconfigured) {
      feedEl.textContent = 'Feed: not configured';
      feedEl.dataset.kind = 'off';
      return;
    }
    feedEl.textContent = delayed
      ? 'Feed: delayed EOD (Massive free tier)'
      : 'Feed: live';
    feedEl.dataset.kind = delayed ? 'delayed' : 'live';
  };

  const paintUpdated = () => {
    if (!lastFetchedAt) {
      updatedEl.textContent = 'Waiting for quotes…';
      return;
    }
    const label = new Date(lastFetchedAt).toLocaleTimeString(undefined, {
      hour: 'numeric', minute: '2-digit', second: '2-digit',
    });
    updatedEl.textContent = stale ? `Updated ${label} · stale` : `Updated ${label}`;
  };

  const hoursGrid = h('div', {
    class: 'live-hours__grid dash-live__hours',
    role: 'list',
    'aria-label': 'Market hours',
  });
  const hoursNote = h('p', { class: 'faint live-hours__note' });
  hoursHost.append(hoursGrid, hoursNote);

  const paintHours = () => {
    if (destroyed) return;
    const snap = getMarketHoursSnapshot();
    const picks = [
      snap.equities.find((e) => e.id === 'nyse') || snap.equities[0],
      snap.equities.find((e) => e.id === 'lse'),
      snap.forex.find((e) => e.id === 'fx-london'),
      snap.forex.find((e) => e.id === 'fx-newyork'),
    ].filter(Boolean);
    paintHoursCards(hoursGrid, picks);
    hoursNote.textContent = snap.context;
  };

  const paintBoard = () => {
    const list = lastQuotes.length
      ? lastQuotes.map((q) => {
        const sess = assetSessionStatus(q.symbol);
        return { ...q, _sessionOpen: sess.open };
      })
      : boardSymbols.map((id) => ({
        symbol: id, name: id, price: null, change: null, changePct: null,
        sparkline: [], ok: false, _sessionOpen: assetSessionStatus(id).open,
      }));
    board.replaceChildren(...list.map((q) => quoteCard(q, {
      selected: q.symbol === selected,
      showSession: true,
      onSelect: (id) => {
        selected = id;
        paintBoard();
        loadChart(id);
      },
    })));
  };

  const patchChartFromQuote = (q) => {
    if (!chart || !lastCandles?.length || !q || q.ok === false) return;
    if (q.price == null || !Number.isFinite(q.price)) return;
    const last = { ...lastCandles[lastCandles.length - 1] };
    const open = Number.isFinite(q.open) ? q.open : last.o;
    const high = Number.isFinite(q.high)
      ? Math.max(q.high, open, q.price)
      : Math.max(last.h, q.price, open);
    const low = Number.isFinite(q.low)
      ? Math.min(q.low, open, q.price)
      : Math.min(last.l, q.price, open);
    last.o = open;
    last.h = high;
    last.l = low;
    last.c = q.price;
    lastCandles = [...lastCandles.slice(0, -1), last];
    try { chart.setCandles(lastCandles); } catch (err) { console.error(err); }
  };

  const loadChart = async (symbol) => {
    if (!chartMod) return;
    chartTitle.textContent = `Daily chart · ${symbol}`;
    chartHost.classList.add('is-switching');
    let candles = null;
    let note = null;
    if (marketMod?.getCandles) {
      try {
        const res = await marketMod.getCandles({ symbol, interval: '1d', limit: 90 });
        candles = res?.candles?.length ? res.candles : null;
        if (res?.attribution) {
          note = [
            res.attribution,
            res.delayed !== false ? 'Delayed EOD' : null,
            res.stale ? 'stale' : null,
          ].filter(Boolean).join(' · ');
        }
      } catch { candles = null; }
    }
    if (!candles?.length && dataMod && !unconfigured) {
      candles = dataMod.randomWalk({
        seed: symbol.length * 99, count: 90, drift: 0.0003, vol: 0.012,
      });
      note = [attribution, 'Chart: simulated'].filter(Boolean).join(' · ');
    }
    attrib.textContent = [attribution, note].filter(Boolean).join(' · ');
    if (!candles?.length) {
      lastCandles = null;
      chartHost.classList.remove('is-switching');
      return;
    }
    lastCandles = candles;
    const q = lastQuotes.find((x) => x.symbol === symbol && x.ok !== false);
    if (q?.price != null) {
      const last = { ...candles[candles.length - 1] };
      if (Number.isFinite(q.open)) last.o = q.open;
      if (Number.isFinite(q.high)) last.h = Math.max(q.high, last.o, q.price);
      if (Number.isFinite(q.low)) last.l = Math.min(q.low, last.o, q.price);
      last.c = q.price;
      lastCandles = [...candles.slice(0, -1), last];
    }
    if (!chart) {
      chart = new chartMod.CandleChart(chartHost, {
        candles: lastCandles,
        height: 280,
        showVolume: true,
        ariaLabel: `${symbol} daily chart`,
      });
    } else {
      chart.setCandles(lastCandles);
    }
    requestAnimationFrame(() => {
      if (!destroyed) chartHost.classList.remove('is-switching');
    });
  };

  const refreshQuotes = async () => {
    if (destroyed || !marketMod?.getQuotes) {
      setStatus('offline', 'Quotes unavailable');
      return;
    }
    setStatus(
      lastQuotes.some((q) => q.ok) ? (stale ? 'stale' : 'live') : 'connecting',
      lastQuotes.some((q) => q.ok) ? 'Refreshing…' : 'Connecting…',
    );
    try {
      const res = await marketMod.getQuotes({ symbols: boardSymbols });
      if (destroyed) return;
      const quotes = Array.isArray(res.quotes) ? res.quotes : [];
      const anyOk = quotes.some((q) => q.ok);
      unconfigured = !!(res.unconfigured || /MASSIVE_API_KEY/i.test(res.error || ''));
      delayed = res.delayed !== false;
      if (anyOk) {
        lastQuotes = quotes;
        lastFetchedAt = res.fetchedAt || Date.now();
        stale = !!res.stale;
        attribution = res.attribution || '';
        setStatus(
          stale ? 'stale' : 'live',
          stale
            ? 'Live · stale'
            : (delayed ? 'Live · delayed EOD' : 'Live'),
        );
        const sel = quotes.find((q) => q.symbol === selected && q.ok);
        if (sel) patchChartFromQuote(sel);
      } else if (lastQuotes.some((q) => q.ok)) {
        stale = true;
        setStatus('stale', 'Refresh failed — last good quotes');
      } else {
        lastQuotes = quotes.length ? quotes : boardSymbols.map((id) => ({
          symbol: id, name: id, price: null, change: null, changePct: null,
          sparkline: [], ok: false,
        }));
        setStatus(
          'offline',
          unconfigured
            ? 'Configure MASSIVE_API_KEY on market-data'
            : (res.error || 'Quotes unavailable'),
        );
      }
    } catch (err) {
      if (lastQuotes.some((q) => q.ok)) {
        stale = true;
        setStatus('stale', 'Network error — last good quotes');
      } else {
        setStatus('offline', err?.message || 'Network error');
      }
    }
    paintFeed();
    paintUpdated();
    paintBoard();
  };

  host.replaceChildren(
    h('div', { class: 'section-head dash-live__head' },
      h('div', null,
        h('p', { class: 'eyebrow' }, 'Markets'),
        h('h2', { id: 'dash-live-h' }, 'Live markets')),
      h('div', { class: 'dash-live__head-actions row' },
        h('a', { class: 'btn btn--ghost btn--sm', href: '#live' },
          icon('chart', { size: 14 }), 'Full Live lab'))),
    h('p', { class: 'muted dash-live__lead' },
      'Quotes for major ETFs, stocks, Bitcoin and EUR/USD. ',
      'Open/Closed badges follow US equity and FX session hours. ',
      'Free-tier prices are delayed end-of-day — fine for learning, not for live trading.'),
    hoursHost,
    h('div', { class: 'live__bar row dash-live__bar' },
      h('p', { class: 'live-status', role: 'status' }, dot, statusEl),
      feedEl,
      updatedEl),
    board,
    h('section', {
      class: 'live-detail card dash-live__detail',
      'aria-label': 'Selected market chart',
    },
      chartTitle,
      chartHost,
      attrib),
    h('p', { class: 'faint dash-live__footnote' },
      'Educational only — not financial advice. Data via Massive.com (delayed EOD on the free tier).'),
  );

  paintHours();
  paintBoard();
  paintFeed();
  paintUpdated();
  setStatus('connecting', 'Connecting…');

  (async () => {
    const mods = await Promise.all([
      import('./chart.js').catch(() => null),
      import('./data.js').catch(() => null),
      import('./market.js').catch(() => null),
    ]);
    if (destroyed) return;
    chartMod = mods[0];
    dataMod = mods[1];
    marketMod = mods[2];
    await refreshQuotes();
    if (!destroyed) await loadChart(selected);
    if (!destroyed) {
      pollTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        refreshQuotes();
        loadChart(selected);
      }, POLL_MS);
      hoursTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        paintHours();
      }, HOURS_TICK_MS);
    }
  })();

  return () => {
    destroyed = true;
    if (pollTimer) clearInterval(pollTimer);
    if (hoursTimer) clearInterval(hoursTimer);
    try { chart?.destroy(); } catch (err) { console.error(err); }
  };
}
