// Market hours / session schedule for the Live page.
// Pure module (no DOM). Client-side clock + IANA timezones → DST-aware open/closed.
// Weekends only for holidays; exchange holidays are not tracked (educational).

/** @typedef {'equity' | 'forex'} MarketKind */
/**
 * @typedef {object} MarketDef
 * @property {string} id
 * @property {string} name
 * @property {string} short
 * @property {MarketKind} kind
 * @property {string} tz IANA timezone
 * @property {string} city Label for the clock
 * @property {{ open: string, close: string }[]} sessions Local HH:MM windows (Mon–Fri)
 * @property {string} [note]
 */

/** @type {readonly MarketDef[]} */
export const EQUITY_MARKETS = Object.freeze([
  Object.freeze({
    id: 'nyse',
    name: 'New York Stock Exchange',
    short: 'NYSE',
    kind: 'equity',
    tz: 'America/New_York',
    city: 'New York',
    sessions: Object.freeze([{ open: '09:30', close: '16:00' }]),
    note: 'Regular session (ET)',
  }),
  Object.freeze({
    id: 'nasdaq',
    name: 'NASDAQ',
    short: 'NASDAQ',
    kind: 'equity',
    tz: 'America/New_York',
    city: 'New York',
    sessions: Object.freeze([{ open: '09:30', close: '16:00' }]),
    note: 'Regular session (ET)',
  }),
  Object.freeze({
    id: 'lse',
    name: 'London Stock Exchange',
    short: 'LSE',
    kind: 'equity',
    tz: 'Europe/London',
    city: 'London',
    sessions: Object.freeze([{ open: '08:00', close: '16:30' }]),
    note: 'Regular session (UK)',
  }),
  Object.freeze({
    id: 'tse',
    name: 'Tokyo Stock Exchange',
    short: 'TSE',
    kind: 'equity',
    tz: 'Asia/Tokyo',
    city: 'Tokyo',
    sessions: Object.freeze([
      { open: '09:00', close: '11:30' },
      { open: '12:30', close: '15:30' },
    ]),
    note: 'Morning + afternoon (JST); lunch break 11:30–12:30; close 15:30',
  }),
]);

/** Major forex sessions (common educational windows in each session’s local zone). */
export const FOREX_SESSIONS = Object.freeze([
  Object.freeze({
    id: 'fx-sydney',
    name: 'Sydney',
    short: 'Sydney',
    kind: 'forex',
    tz: 'Australia/Sydney',
    city: 'Sydney',
    sessions: Object.freeze([{ open: '07:00', close: '16:00' }]),
    note: 'Asia-Pacific open',
  }),
  Object.freeze({
    id: 'fx-tokyo',
    name: 'Tokyo',
    short: 'Tokyo',
    kind: 'forex',
    tz: 'Asia/Tokyo',
    city: 'Tokyo',
    sessions: Object.freeze([{ open: '09:00', close: '18:00' }]),
    note: 'Asia session',
  }),
  Object.freeze({
    id: 'fx-london',
    name: 'London',
    short: 'London',
    kind: 'forex',
    tz: 'Europe/London',
    city: 'London',
    sessions: Object.freeze([{ open: '08:00', close: '17:00' }]),
    note: 'Europe session — highest FX volume',
  }),
  Object.freeze({
    id: 'fx-newyork',
    name: 'New York',
    short: 'New York',
    kind: 'forex',
    tz: 'America/New_York',
    city: 'New York',
    sessions: Object.freeze([{ open: '08:00', close: '17:00' }]),
    note: 'US session',
  }),
]);

export const ALL_MARKETS = Object.freeze([...EQUITY_MARKETS, ...FOREX_SESSIONS]);

const PARTS_OPTS = {
  timeZone: 'UTC',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
};

const cache = new Map(); // tz → DateTimeFormat

function formatter(tz) {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { ...PARTS_OPTS, timeZone: tz });
    cache.set(tz, f);
  }
  return f;
}

/**
 * Local wall-clock parts for `date` in `tz`.
 * @returns {{ weekday: string, hour: number, minute: number, second: number, minutes: number }}
 */
export function zonedParts(date, tz) {
  const parts = formatter(tz).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const second = Number(get('second'));
  return {
    weekday: get('weekday') || '',
    hour,
    minute,
    second,
    minutes: hour * 60 + minute,
  };
}

/** Parse "HH:MM" → minutes from midnight. */
export function parseHm(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  return h * 60 + m;
}

const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

/**
 * Whether a market is open at `date` (default now).
 * Equities & listed forex sessions: Mon–Fri within session windows.
 * @param {MarketDef} market
 * @param {Date|number} [at]
 */
export function isMarketOpen(market, at = Date.now()) {
  const date = at instanceof Date ? at : new Date(at);
  const { weekday, minutes } = zonedParts(date, market.tz);
  if (!WEEKDAYS.has(weekday)) return false;
  return market.sessions.some((s) => {
    const open = parseHm(s.open);
    const close = parseHm(s.close);
    return minutes >= open && minutes < close;
  });
}

/**
 * Next open or close boundary in the market’s local zone (approximate; skips to next weekday).
 * @returns {{ kind: 'open'|'close', atLabel: string, localHm: string } | null}
 */
export function nextBoundary(market, at = Date.now()) {
  const date = at instanceof Date ? at : new Date(at);
  const open = isMarketOpen(market, date);
  const { weekday, minutes } = zonedParts(date, market.tz);
  if (open) {
    // Next close among sessions that currently contain `minutes`
    let closeHm = null;
    let closeMin = Infinity;
    for (const s of market.sessions) {
      const o = parseHm(s.open);
      const c = parseHm(s.close);
      if (minutes >= o && minutes < c && c < closeMin) {
        closeMin = c;
        closeHm = s.close;
      }
    }
    return closeHm
      ? { kind: 'close', atLabel: `Closes ${closeHm} ${tzAbbrev(market.tz, date)}`, localHm: closeHm }
      : null;
  }
  // Find next open today, else first open next weekday
  if (WEEKDAYS.has(weekday)) {
    for (const s of market.sessions) {
      const o = parseHm(s.open);
      if (minutes < o) {
        return { kind: 'open', atLabel: `Opens ${s.open} ${tzAbbrev(market.tz, date)}`, localHm: s.open };
      }
    }
  }
  const first = market.sessions[0];
  return first
    ? { kind: 'open', atLabel: `Opens ${first.open} ${tzAbbrev(market.tz, date)} (next session day)`, localHm: first.open }
    : null;
}

/** Short timezone abbreviation (e.g. EDT, BST, JST) for display. */
export function tzAbbrev(tz, at = Date.now()) {
  const date = at instanceof Date ? at : new Date(at);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
      hour: 'numeric',
    }).formatToParts(date);
    return parts.find((p) => p.type === 'timeZoneName')?.value || tz;
  } catch {
    return tz;
  }
}

/** Format local time in a zone as "h:mm:ss a" (or 24h-ish with short zone). */
export function formatLocalTime(tz, at = Date.now(), { withSeconds = true } = {}) {
  const date = at instanceof Date ? at : new Date(at);
  const opts = {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
  };
  if (withSeconds) opts.second = '2-digit';
  return new Intl.DateTimeFormat('en-US', opts).format(date);
}

/**
 * Snapshot for one market.
 * @param {MarketDef} market
 * @param {Date|number} [at]
 */
/**
 * Progress through each session window for bar UI.
 * @returns {{ open: string, close: string, openMin: number, closeMin: number, progress: number, active: boolean, done: boolean }[]}
 */
export function sessionProgressBars(market, at = Date.now()) {
  const date = at instanceof Date ? at : new Date(at);
  const { weekday, minutes, second } = zonedParts(date, market.tz);
  const weekdayOk = WEEKDAYS.has(weekday);
  const fracMin = minutes + (Number.isFinite(second) ? second / 60 : 0);
  return market.sessions.map((s) => {
    const openMin = parseHm(s.open);
    const closeMin = parseHm(s.close);
    const span = Math.max(1, closeMin - openMin);
    let progress = 0;
    let active = false;
    let done = false;
    if (weekdayOk) {
      if (fracMin >= closeMin) {
        progress = 1;
        done = true;
      } else if (fracMin >= openMin) {
        progress = Math.min(1, Math.max(0, (fracMin - openMin) / span));
        active = true;
      }
    }
    return {
      open: s.open,
      close: s.close,
      openMin,
      closeMin,
      progress,
      active,
      done,
    };
  });
}

/** Overall 0–1 fill across today's sessions (weighted by duration) for a single progress bar. */
export function overallSessionProgress(market, at = Date.now()) {
  const bars = sessionProgressBars(market, at);
  if (!bars.length) return 0;
  let weighted = 0;
  let total = 0;
  for (const b of bars) {
    const span = Math.max(1, b.closeMin - b.openMin);
    total += span;
    weighted += span * b.progress;
  }
  return total ? weighted / total : 0;
}

export function marketStatus(market, at = Date.now()) {
  const date = at instanceof Date ? at : new Date(at);
  const open = isMarketOpen(market, date);
  const boundary = nextBoundary(market, date);
  const local = formatLocalTime(market.tz, date);
  const abbrev = tzAbbrev(market.tz, date);
  const { minutes, second } = zonedParts(date, market.tz);
  const dayProgress = Math.min(1, Math.max(0, (minutes + second / 60) / (24 * 60)));
  const sessionBars = sessionProgressBars(market, date);
  return {
    id: market.id,
    name: market.name,
    short: market.short,
    kind: market.kind,
    city: market.city,
    tz: market.tz,
    tzAbbrev: abbrev,
    open,
    localTime: local,
    sessions: market.sessions.map((s) => `${s.open}–${s.close}`),
    note: market.note || '',
    boundary,
    dayProgress,
    sessionBars,
    progress: overallSessionProgress(market, date),
  };
}

/**
 * Overlap definitions (forex session pairs commonly taught).
 * @type {readonly { id: string, a: string, b: string, label: string, blurb: string }[]}
 */
export const OVERLAPS = Object.freeze([
  Object.freeze({
    id: 'sydney-tokyo',
    a: 'fx-sydney',
    b: 'fx-tokyo',
    label: 'Sydney–Tokyo',
    blurb: 'Quiet Asia handoff; AUD and JPY pairs often active.',
  }),
  Object.freeze({
    id: 'tokyo-london',
    a: 'fx-tokyo',
    b: 'fx-london',
    label: 'Tokyo–London',
    blurb: 'Europe opens into Asia close; EUR/JPY and GBP/JPY watch.',
  }),
  Object.freeze({
    id: 'london-ny',
    a: 'fx-london',
    b: 'fx-newyork',
    label: 'London–New York',
    blurb: 'Busiest FX overlap — tightest spreads, most volume.',
  }),
]);

/**
 * Full live snapshot: equities, forex sessions, active overlaps, brief context.
 * @param {Date|number} [at]
 */
export function getMarketHoursSnapshot(at = Date.now()) {
  const date = at instanceof Date ? at : new Date(at);
  const equities = EQUITY_MARKETS.map((m) => marketStatus(m, date));
  const forex = FOREX_SESSIONS.map((m) => marketStatus(m, date));
  const byId = new Map([...equities, ...forex].map((s) => [s.id, s]));

  const activeForex = forex.filter((s) => s.open).map((s) => s.short);
  const activeEquities = equities.filter((s) => s.open).map((s) => s.short);

  const overlaps = OVERLAPS.map((o) => {
    const a = byId.get(o.a);
    const b = byId.get(o.b);
    const active = !!(a?.open && b?.open);
    return { ...o, active, aOpen: !!a?.open, bOpen: !!b?.open };
  });

  let context = '';
  const liveOverlap = overlaps.find((o) => o.active);
  if (liveOverlap) {
    context = `${liveOverlap.label} overlap is live. ${liveOverlap.blurb}`;
  } else if (activeForex.length) {
    context = `Forex: ${activeForex.join(', ')} session${activeForex.length > 1 ? 's' : ''} open.`;
  } else if (activeEquities.length) {
    context = `Equities open: ${activeEquities.join(', ')}.`;
  } else {
    context = 'Major equity floors and listed FX sessions are closed right now (weekend or overnight).';
  }

  return {
    at: date.getTime(),
    equities,
    forex,
    overlaps,
    activeForex,
    activeEquities,
    context,
    clientTz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
  };
}

/** US equity / ETF symbols → NYSE/NASDAQ regular hours (educational). */
const US_EQUITY_SYMBOLS = new Set([
  'SPY', 'QQQ', 'IWM', 'DIA', 'GLD',
  'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'AMD',
]);

/** Crypto treated as always-on for session badges. */
const CRYPTO_SYMBOLS = new Set(['BTC-USD', 'ETH-USD', 'BTC', 'ETH']);

/**
 * Map a quote symbol to a MarketDef (or a synthetic crypto venue).
 * Equities → NASDAQ (same regular hours as NYSE); FX → London FX session as primary;
 * crypto → always-open stub.
 * @param {string} symbol
 * @returns {MarketDef & { alwaysOpen?: boolean }}
 */
export function venueForSymbol(symbol) {
  const id = String(symbol || '').toUpperCase().trim();
  if (CRYPTO_SYMBOLS.has(id) || id.startsWith('BTC') || id.startsWith('ETH')) {
    return Object.freeze({
      id: 'crypto',
      name: 'Crypto (24/7)',
      short: 'Crypto',
      kind: /** @type {MarketKind} */ ('equity'),
      tz: 'UTC',
      city: 'Global',
      sessions: Object.freeze([{ open: '00:00', close: '23:59' }]),
      note: 'Crypto trades around the clock',
      alwaysOpen: true,
    });
  }
  if (
    id.includes('EUR') || id.includes('GBP') || id.includes('JPY')
    || id.includes('AUD') || id.includes('CAD') || id.includes('CHF')
    || (id.includes('-') && !US_EQUITY_SYMBOLS.has(id) && !CRYPTO_SYMBOLS.has(id))
  ) {
    return FOREX_SESSIONS.find((m) => m.id === 'fx-london') || FOREX_SESSIONS[0];
  }
  // Default: US listed equity / ETF
  return EQUITY_MARKETS.find((m) => m.id === 'nasdaq') || EQUITY_MARKETS[0];
}

/**
 * Open/closed (+ progress) for a quote symbol at `at`.
 * Forex pairs are open when any major FX session is live; crypto is always open.
 * @param {string} symbol
 * @param {Date|number} [at]
 */
export function assetSessionStatus(symbol, at = Date.now()) {
  const venue = venueForSymbol(symbol);
  if (venue.alwaysOpen) {
    const date = at instanceof Date ? at : new Date(at);
    return {
      ...marketStatus(
        { ...venue, sessions: [{ open: '00:00', close: '23:59' }] },
        date,
      ),
      open: true,
      short: venue.short,
      name: venue.name,
      kind: 'crypto',
      note: venue.note || '',
      progress: 1,
      sessionBars: [{
        open: '00:00', close: '23:59', openMin: 0, closeMin: 23 * 60 + 59,
        progress: ((zonedParts(date, 'UTC').minutes) / (24 * 60)),
        active: true, done: false,
      }],
    };
  }
  if (venue.kind === 'forex') {
    const snap = getMarketHoursSnapshot(at);
    const primary = snap.forex.find((s) => s.id === venue.id) || snap.forex[0];
    const anyOpen = snap.activeForex.length > 0;
    return {
      ...primary,
      open: anyOpen,
      short: anyOpen ? `FX · ${snap.activeForex.join('/')}` : 'FX',
      name: 'Forex sessions',
      note: anyOpen
        ? `Major session(s) open: ${snap.activeForex.join(', ')}`
        : 'No major FX session open',
    };
  }
  return marketStatus(venue, at);
}

/* ── Unified 24h timeline (display-tz lanes) ─────────────────────────────── */

const YMD_OPTS = { year: 'numeric', month: '2-digit', day: '2-digit' };
const ymdCache = new Map();

function ymdFormatter(tz) {
  let f = ymdCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...YMD_OPTS });
    ymdCache.set(tz, f);
  }
  return f;
}

/** Calendar Y-M-D for `date` in `tz` (en-CA → YYYY-MM-DD). */
export function zonedYmd(date, tz) {
  const s = ymdFormatter(tz).format(date instanceof Date ? date : new Date(date));
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

/** Add `delta` calendar days to a Y-M-D triple (UTC arithmetic; date-only). */
export function addCalendarDays(y, m, d, delta) {
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/**
 * Convert a wall-clock civil time in `tz` to a UTC Date (DST-aware iterative fix).
 * @param {number} y
 * @param {number} m 1–12
 * @param {number} d
 * @param {string|number} hm "HH:MM" or minutes from midnight
 * @param {string} tz IANA
 */
export function wallTimeToUtc(y, m, d, hm, tz) {
  const minutes = typeof hm === 'number' ? hm : parseHm(hm);
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  let utcMs = Date.UTC(y, m - 1, d, hour, minute, 0);
  for (let i = 0; i < 4; i++) {
    const asOf = new Date(utcMs);
    const parts = zonedParts(asOf, tz);
    const ymd = zonedYmd(asOf, tz);
    const asLocalMs = Date.UTC(ymd.y, ymd.m - 1, ymd.d, parts.hour, parts.minute, parts.second || 0);
    const desiredMs = Date.UTC(y, m - 1, d, hour, minute, 0);
    const diff = desiredMs - asLocalMs;
    if (diff === 0) break;
    utcMs += diff;
  }
  return new Date(utcMs);
}

/** Start of the calendar day containing `date` in `tz`, as UTC Date. */
export function startOfDayUtc(date, tz) {
  const { y, m, d } = zonedYmd(date, tz);
  return wallTimeToUtc(y, m, d, 0, tz);
}

/**
 * Session windows for one market on a civil day, mapped onto a display-tz day axis.
 * Splits lunch into separate segments; clips to [0, 1440]; handles overnight local
 * sessions (open ≥ close) as two segments.
 * @returns {{ startMin: number, endMin: number, active: boolean, done: boolean, label: string }[]}
 */
export function marketSegmentsOnDisplayDay(market, at, displayTz, dayStart, dayEnd) {
  const date = at instanceof Date ? at : new Date(at);
  const nowMs = date.getTime();
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();
  const dayLen = dayEndMs - dayStartMs;
  /** @type {{ startMin: number, endMin: number, active: boolean, done: boolean, label: string }[]} */
  const out = [];

  const baseYmd = zonedYmd(date, market.tz);
  for (const delta of [-1, 0, 1]) {
    const { y, m, d } = addCalendarDays(baseYmd.y, baseYmd.m, baseYmd.d, delta);
    const noon = wallTimeToUtc(y, m, d, 12 * 60, market.tz);
    const weekday = zonedParts(noon, market.tz).weekday;
    if (!WEEKDAYS.has(weekday)) continue;

    for (const s of market.sessions) {
      const openMin = parseHm(s.open);
      const closeMin = parseHm(s.close);
      /** @type {{ open: number, close: number, label: string }[]} */
      const windows = [];
      if (closeMin > openMin) {
        windows.push({ open: openMin, close: closeMin, label: `${s.open}–${s.close}` });
      } else {
        // Midnight wrap in market-local time
        windows.push({ open: openMin, close: 24 * 60, label: `${s.open}–24:00` });
        if (closeMin > 0) {
          windows.push({ open: 0, close: closeMin, label: `00:00–${s.close}` });
        }
      }

      for (const w of windows) {
        const openUtc = wallTimeToUtc(y, m, d, w.open, market.tz);
        let closeUtc = wallTimeToUtc(y, m, d, w.close === 24 * 60 ? 0 : w.close, market.tz);
        if (w.close === 24 * 60) {
          const next = addCalendarDays(y, m, d, 1);
          closeUtc = wallTimeToUtc(next.y, next.m, next.d, 0, market.tz);
        } else if (closeUtc <= openUtc) {
          const next = addCalendarDays(y, m, d, 1);
          closeUtc = wallTimeToUtc(next.y, next.m, next.d, w.close, market.tz);
        }

        const startMs = Math.max(openUtc.getTime(), dayStartMs);
        const endMs = Math.min(closeUtc.getTime(), dayEndMs);
        if (endMs <= startMs) continue;

        const startMin = ((startMs - dayStartMs) / dayLen) * (24 * 60);
        const endMin = ((endMs - dayStartMs) / dayLen) * (24 * 60);
        const active = nowMs >= openUtc.getTime() && nowMs < closeUtc.getTime();
        const done = nowMs >= closeUtc.getTime();
        out.push({
          startMin: Math.max(0, Math.min(1440, startMin)),
          endMin: Math.max(0, Math.min(1440, endMin)),
          active,
          done,
          label: w.label,
        });
      }
    }
  }

  // Dedupe near-identical segments (float noise / overlapping day probes)
  out.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const deduped = [];
  for (const seg of out) {
    const prev = deduped[deduped.length - 1];
    if (
      prev
      && Math.abs(prev.startMin - seg.startMin) < 0.5
      && Math.abs(prev.endMin - seg.endMin) < 0.5
    ) {
      prev.active = prev.active || seg.active;
      prev.done = prev.done && seg.done;
      continue;
    }
    deduped.push(seg);
  }
  return deduped;
}

/**
 * Unified market-hours timeline: one lane per equity + forex venue on a shared
 * 24h axis in `displayTz` (defaults to the viewer's local zone / clientTz).
 *
 * @param {Date|number} [at]
 * @param {string} [displayTz]
 * @returns {{
 *   at: number,
 *   displayTz: string,
 *   displayTzAbbrev: string,
 *   nowMin: number,
 *   context: string,
 *   overlaps: ReturnType<typeof getMarketHoursSnapshot>['overlaps'],
 *   activeEquities: string[],
 *   activeForex: string[],
 *   rows: {
 *     id: string, short: string, name: string, kind: MarketKind,
 *     city: string, tz: string, tzAbbrev: string, open: boolean,
 *     segments: { startMin: number, endMin: number, active: boolean, done: boolean, label: string }[]
 *   }[]
 * }}
 */
export function unifiedTimeline(at = Date.now(), displayTz) {
  const date = at instanceof Date ? at : new Date(at);
  const tz = displayTz
    || (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone)
    || 'UTC';
  const dayStart = startOfDayUtc(date, tz);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const dayLen = dayEnd.getTime() - dayStart.getTime();
  const nowMin = Math.min(1440, Math.max(0, ((date.getTime() - dayStart.getTime()) / dayLen) * (24 * 60)));

  const snap = getMarketHoursSnapshot(date);
  const markets = [...EQUITY_MARKETS, ...FOREX_SESSIONS];
  const rows = markets.map((market) => {
    const st = marketStatus(market, date);
    return {
      id: market.id,
      short: market.short,
      name: market.name,
      kind: market.kind,
      city: market.city,
      tz: market.tz,
      tzAbbrev: st.tzAbbrev,
      open: st.open,
      segments: marketSegmentsOnDisplayDay(market, date, tz, dayStart, dayEnd),
    };
  });

  return {
    at: date.getTime(),
    displayTz: tz,
    displayTzAbbrev: tzAbbrev(tz, date),
    nowMin,
    context: snap.context,
    overlaps: snap.overlaps,
    activeEquities: snap.activeEquities,
    activeForex: snap.activeForex,
    rows,
  };
}
