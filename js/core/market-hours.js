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
      { open: '12:30', close: '15:00' },
    ]),
    note: 'Morning + afternoon (JST); lunch break 11:30–12:30',
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
export function marketStatus(market, at = Date.now()) {
  const date = at instanceof Date ? at : new Date(at);
  const open = isMarketOpen(market, date);
  const boundary = nextBoundary(market, date);
  const local = formatLocalTime(market.tz, date);
  const abbrev = tzAbbrev(market.tz, date);
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
