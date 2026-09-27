// Real market candles for games, lessons and the Live Market Lab (ARCHITECTURE §12.3).
// The browser only talks to the Supabase Edge Function `market-data` (never to a provider).
// Nothing here throws into callers: missing data comes back as empty candles with a status, so
// every caller can fall back to textbook / simulated charts.
// Pure module at import time (no DOM access), so node:test can import it.

import { makeRng, randomSeed } from './rng.js';

export const DEFAULT_SUPABASE_URL = 'https://pedcpgmowqhqgersxxqa.supabase.co';
export const DEFAULT_SUPABASE_KEY = 'sb_publishable_fdwgGDrO0soyNdS0jOprcw_MJxIL0rC';
export const INTERVALS = ['1m', '5m', '15m', '1h', '6h', '1d', '1w'];
export const INTERVAL_MS = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '6h': 21_600_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};
const INTERVAL_LABELS = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': 'Hourly',
  '6h': '6 hours',
  '1d': 'Daily',
  '1w': 'Weekly',
};
const MOCK_KEY = 'tts-market-mock';
const CATALOG_KEY = 'tts-market-catalog';
const TIMEOUT_MS = 8000;
const RETRY_MS = [700, 2000];
const MAX_LIMIT = 1000;
const FIXTURE_ATTRIBUTION = 'Test fixture: synthetic candles, not real prices';

const def = (id, name, cls, decimals) => ({ id, name, class: cls, decimals, intervals: ['1d', '1w'], live: false, delayed: true });
/** The 12 markets the free Alpha Vantage key covers (end-of-day and weekly candles). */
export const SYMBOLS = Object.freeze([
  def('SPY', 'S&P 500 ETF', 'etf', 2),
  def('QQQ', 'Nasdaq-100 ETF', 'etf', 2),
  def('GLD', 'Gold ETF', 'etf', 2),
  def('AAPL', 'Apple', 'stock', 2),
  def('MSFT', 'Microsoft', 'stock', 2),
  def('NVDA', 'NVIDIA', 'stock', 2),
  def('TSLA', 'Tesla', 'stock', 2),
  def('EUR-USD', 'Euro / US dollar', 'fx', 5),
  def('GBP-USD', 'British pound / US dollar', 'fx', 5),
  def('USD-JPY', 'US dollar / Japanese yen', 'fx', 3),
  def('BTC-USD', 'Bitcoin', 'crypto', 2),
  def('ETH-USD', 'Ethereum', 'crypto', 2),
].map(Object.freeze));

// ---------------------------------------------------------------------------------------------
// State + configuration
// ---------------------------------------------------------------------------------------------

const override = {}; // configureMarket() — tests and the dev page
const fixtureCache = new Map(); // fixture name → Promise<json|null>
const state = {
  status: null,
  lastError: null,
  lastOkAt: 0,
  catalogP: null,
  catalogAt: 0,
  catalogFailed: false,
  history: new Map(), // key → result (successful only)
  inflight: new Map(), // key → Promise
  failedAt: new Map(), // key → time of the last failed history load
  listeners: new Set(),
  configP: null,
  loadedAt: Date.now(),
};

/**
 * configureMarket({ fetch, url, key, mock, fixturesBase, mockStepMs, storage }) — overrides for
 * tests and the dev page (pass undefined to clear one). Also resets the caches.
 */
export function configureMarket(opts = {}) {
  for (const [k, v] of Object.entries(opts)) {
    if (v === undefined) delete override[k];
    else override[k] = v;
  }
  resetMarketCache();
}

/** Forget cached catalog, history and status (the next call fetches again). */
export function resetMarketCache() {
  state.catalogP = null;
  state.catalogAt = 0;
  state.history.clear();
  state.inflight.clear();
  state.failedAt.clear();
  state.configP = null;
  state.status = null;
  state.lastError = null;
  state.loadedAt = nowMs();
  fixtureCache.clear();
}

const fetchFn = () => override.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
const nowMs = () => (typeof override.now === 'function' ? override.now() : Date.now());
function storage(kind = 'localStorage') {
  if (override.storage) return override.storage;
  try {
    return globalThis[kind] || null;
  } catch {
    return null;
  }
}
function storeGet(key, kind) {
  try {
    return storage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function storeSet(key, value, kind) {
  try {
    storage(kind)?.setItem(key, value);
  } catch {
    /* storage is a convenience */
  }
}

function isLocalHost() {
  try {
    const h = globalThis.location?.hostname || '';
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
  } catch {
    return false;
  }
}

/** `?market=mock` in the page URL (the smoke test uses it: it works even when storage throws). */
function urlMock() {
  try {
    return /[?&]market=mock(?:&|$)/.test(globalThis.location?.search || '');
  } catch {
    return false;
  }
}

/**
 * Mock mode, localhost only: localStorage['tts-market-mock'] === '1' or `?market=mock` in the URL
 * (or configureMarket({ mock }) in tests).
 */
export function isMockMode() {
  if (override.mock != null) return !!override.mock;
  return isLocalHost() && (storeGet(MOCK_KEY) === '1' || urlMock());
}

/** Turn mock mode on/off for this browser (localhost only; takes effect for new requests). */
export function setMockMode(on) {
  try {
    if (on) storage()?.setItem(MOCK_KEY, '1');
    else storage()?.removeItem(MOCK_KEY);
  } catch {
    /* ignore */
  }
  resetMarketCache();
}

function loadConfig() {
  if (!state.configP) {
    state.configP = (async () => {
      let url = DEFAULT_SUPABASE_URL;
      let key = DEFAULT_SUPABASE_KEY;
      if (!override.url || !override.key) {
        try {
          const m = await import('../config.js');
          url = m.SUPABASE_URL || m.default?.SUPABASE_URL || url;
          key = m.SUPABASE_KEY || m.default?.SUPABASE_KEY || key;
        } catch {
          /* no js/config.js yet: built-in project defaults */
        }
      }
      return { url: String(override.url || url).replace(/\/+$/, ''), key: override.key || key };
    })();
  }
  return state.configP;
}

function setStatus(status, error = null) {
  const prev = state.status;
  state.status = status;
  if (status === 'online') {
    state.lastOkAt = nowMs();
    state.lastError = null;
  } else if (error) state.lastError = String(error);
  if (prev !== status) {
    for (const fn of state.listeners) {
      try {
        fn(status);
      } catch (err) {
        console.error(err);
      }
    }
  }
}

/**
 * marketStatus() → 'online' | 'offline' | 'unconfigured' — the outcome of the most recent request
 * ('unconfigured' = the function has no provider for it yet). Before any request: 'offline' when
 * the browser reports no network, otherwise 'online'. Mock mode counts as 'online'.
 */
export function marketStatus() {
  if (state.status) return state.status;
  try {
    if (globalThis.navigator && globalThis.navigator.onLine === false) return 'offline';
  } catch {
    /* ignore */
  }
  return 'online';
}

/** Details for status bars and the dev page. */
export function marketInfo() {
  return { status: marketStatus(), mock: isMockMode(), lastError: state.lastError, lastOkAt: state.lastOkAt || null, cached: [...state.history.keys()] };
}

/** onMarketStatus(fn) → unsubscribe; fn(status) runs whenever marketStatus() changes. */
export function onMarketStatus(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

// ---------------------------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------------------------

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** POST JSON to the market-data function → { kind: 'ok'|'unconfigured'|'error'|'offline', data, status }. */
async function callFunction(body, { retries = RETRY_MS.length } = {}) {
  const f = fetchFn();
  if (!f) return { kind: 'offline', error: 'fetch unavailable' };
  const { url, key } = await loadConfig();
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl?.abort(), override.timeoutMs || TIMEOUT_MS);
    try {
      const res = await f(`${url}/functions/v1/market-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: ctrl?.signal,
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (res.ok) return { kind: 'ok', data, status: res.status };
      if (res.status === 503 && data && data.unconfigured) return { kind: 'unconfigured', data, status: 503 };
      lastErr = (data && data.error) || `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) return { kind: 'error', data, status: res.status, error: lastErr };
    } catch (err) {
      lastErr = err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || String(err);
    } finally {
      clearTimeout(timer);
    }
    try {
      if (globalThis.navigator && globalThis.navigator.onLine === false) break;
    } catch {
      /* ignore */
    }
    if (attempt < retries) await wait((override.retryMs || RETRY_MS)[attempt] * (0.85 + Math.random() * 0.3));
  }
  return { kind: 'offline', error: lastErr };
}

function fixtureUrl(name) {
  const file = `${name.replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
  if (override.fixturesBase) return `${String(override.fixturesBase).replace(/\/?$/, '/')}${file}`;
  return new URL(`../../tests/fixtures/market/${file}`, import.meta.url).href;
}

/** Fixture JSON (mock mode only) or null. */
function loadFixture(name) {
  if (!fixtureCache.has(name)) {
    fixtureCache.set(
      name,
      (async () => {
        const f = fetchFn();
        if (!f) return null;
        try {
          const res = await f(fixtureUrl(name));
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      })(),
    );
  }
  return fixtureCache.get(name);
}

/** Clean provider candles: numbers, valid OHLC, oldest first, one candle per timestamp. */
export function normalizeCandles(list) {
  const byT = new Map();
  for (const r of Array.isArray(list) ? list : []) {
    if (!r) continue;
    const t = Number(r.t);
    const o = Number(r.o);
    const h = Number(r.h);
    const l = Number(r.l);
    const c = Number(r.c);
    const v = Number(r.v);
    if (![t, o, h, l, c].every(Number.isFinite) || o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;
    byT.set(t, { t, o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v: Number.isFinite(v) && v >= 0 ? v : 0 });
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------------------------

const DEFAULT_DECIMALS = { fx: 5, crypto: 2, stock: 2, etf: 2, metal: 2 };

function normalizeCatalog(raw, status, extra = {}) {
  const list = Array.isArray(raw?.symbols) ? raw.symbols : [];
  const symbols = [];
  for (const s of list) {
    if (!s || typeof s.id !== 'string') continue;
    const base = SYMBOLS.find((d) => d.id === s.id) || {};
    const intervals = (Array.isArray(s.intervals) ? s.intervals : base.intervals || []).filter((i) => INTERVALS.includes(i));
    if (!intervals.length) continue;
    const cls = s.class || base.class || 'stock';
    symbols.push({
      ...s,
      id: s.id,
      name: s.name || base.name || s.id,
      class: cls,
      decimals: Number.isInteger(s.decimals) ? s.decimals : base.decimals ?? DEFAULT_DECIMALS[cls] ?? 2,
      intervals: INTERVALS.filter((i) => intervals.includes(i)),
      live: !!s.live,
      delayed: s.delayed != null ? !!s.delayed : !s.live,
    });
  }
  return { symbols, status: symbols.length ? status : 'unconfigured', ...extra };
}

/** Conservative catalog when the function cannot be asked: the 12 markets, daily + weekly. */
function fallbackCatalog(status) {
  return { symbols: SYMBOLS.map((s) => ({ ...s, intervals: [...s.intervals] })), status, fallback: true };
}

/**
 * getCatalog({ refresh }) → { symbols: [{ id, name, class, decimals, intervals, live, delayed }], status }
 * Cached for the session. On failure: the default 12 markets with ['1d', '1w'] and status
 * 'offline' (or 'unconfigured'); a failed catalog is retried after a minute.
 */
export function getCatalog({ refresh = false } = {}) {
  const stale = state.catalogP && state.catalogFailed && nowMs() - state.catalogAt > 60_000;
  if (!state.catalogP || refresh || stale) {
    state.catalogAt = nowMs();
    state.catalogFailed = false;
    state.catalogP = loadCatalog().catch((err) => {
      state.catalogFailed = true;
      setStatus('offline', err);
      return fallbackCatalog('offline');
    });
  }
  return state.catalogP;
}

async function loadCatalog() {
  if (isMockMode()) {
    const f = await loadFixture('catalog');
    if (f) {
      setStatus('online');
      return normalizeCatalog(f, 'online', { mock: true });
    }
    state.catalogFailed = true;
    return fallbackCatalog('offline');
  }
  const cached = storeGet(CATALOG_KEY, 'sessionStorage');
  if (cached) {
    try {
      const c = JSON.parse(cached);
      if (c && Array.isArray(c.symbols) && nowMs() - (c.at || 0) < 30 * 60_000) return normalizeCatalog(c, 'online');
    } catch {
      /* ignore */
    }
  }
  const r = await callFunction({ catalog: true }, { retries: 1 });
  if (r.kind === 'ok' && Array.isArray(r.data?.symbols)) {
    setStatus('online');
    const cat = normalizeCatalog(r.data, 'online');
    storeSet(CATALOG_KEY, JSON.stringify({ symbols: cat.symbols, at: nowMs() }), 'sessionStorage');
    return cat;
  }
  state.catalogFailed = true;
  if (r.kind === 'unconfigured') {
    setStatus('unconfigured', r.data?.error);
    return fallbackCatalog('unconfigured');
  }
  setStatus(r.kind === 'error' ? marketStatus() : 'offline', r.error);
  return fallbackCatalog('offline');
}

// ---------------------------------------------------------------------------------------------
// Candles
// ---------------------------------------------------------------------------------------------

const emptyResult = (symbol, interval, status, error) => ({
  symbol, interval, candles: [], source: null, attribution: '', delayed: true, stale: false, status, error: error || null,
});

/** Intraday fixtures play forward in (mock) real time: one candle per mockStepMs from 80%. */
function mockCursor(total, interval) {
  if (!['1m', '5m', '15m', '1h'].includes(interval)) return total;
  const step = override.mockStepMs || 5000;
  const first = Math.floor(total * 0.8);
  return Math.min(total, first + Math.floor((nowMs() - state.loadedAt) / step));
}

/**
 * getCandles({ symbol, interval, limit = 300, end }) → { symbol, interval, candles: [{ t, o, h, l, c, v }],
 *   source, attribution, delayed, stale, status: 'online'|'offline'|'unconfigured', error, mock? }
 * t = candle open time (ms UTC), oldest first. `end` (ms) asks for the candles ending at that time.
 * Never throws: on failure candles is [] and status says why.
 */
export async function getCandles({ symbol, interval, limit = 300, end } = {}) {
  const sym = String(symbol || '').toUpperCase();
  if (!sym || !INTERVALS.includes(interval)) return emptyResult(sym, interval, 'unconfigured', 'unknown symbol or interval');
  const lim = Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(limit) || 300)));
  try {
    if (isMockMode()) {
      // Only symbols / intervals the fixture catalog lists have a file (so nothing 404s).
      const cat = await getCatalog();
      if (!cat.symbols.some((s) => s.id === sym && s.intervals.includes(interval))) return emptyResult(sym, interval, 'unconfigured', 'no fixture');
      const f = await loadFixture(`${sym}_${interval}`);
      if (!f) return emptyResult(sym, interval, 'unconfigured', 'no fixture');
      let cs = normalizeCandles(f.candles);
      cs = cs.slice(0, mockCursor(cs.length, interval));
      if (end != null && Number.isFinite(Number(end))) cs = cs.filter((k) => k.t <= Number(end));
      setStatus('online');
      return {
        symbol: sym, interval, candles: cs.slice(-lim), source: 'fixture', attribution: f.attribution || FIXTURE_ATTRIBUTION,
        delayed: true, stale: false, status: 'online', error: null, mock: true,
      };
    }
    const body = { symbol: sym, interval, limit: lim };
    if (end != null && Number.isFinite(Number(end))) body.end = Number(end);
    const r = await callFunction(body);
    if (r.kind === 'ok' && r.data && Array.isArray(r.data.candles)) {
      setStatus('online');
      return {
        symbol: sym, interval, candles: normalizeCandles(r.data.candles).slice(-lim), source: r.data.source || null,
        attribution: r.data.attribution || '', delayed: !!r.data.delayed, stale: !!r.data.stale, status: 'online', error: null,
      };
    }
    if (r.kind === 'unconfigured') {
      setStatus('unconfigured', r.data?.error);
      return emptyResult(sym, interval, 'unconfigured', r.data?.error);
    }
    if (r.kind === 'error') return emptyResult(sym, interval, marketStatus(), r.error);
    setStatus('offline', r.error);
    return emptyResult(sym, interval, 'offline', r.error);
  } catch (err) {
    return emptyResult(sym, interval, 'offline', err?.message || String(err));
  }
}

/**
 * getHistory({ symbol, interval, bars = 1000 }) → same shape as getCandles, cached for the
 * session. Concurrent calls share one request; more than 1000 bars are fetched in pages.
 * Failures are not cached (a new call retries, at most every 20 s).
 */
export function getHistory({ symbol, interval, bars = 1000 } = {}) {
  const sym = String(symbol || '').toUpperCase();
  const want = Math.max(1, Math.floor(Number(bars) || 1000));
  const key = `${isMockMode() ? 'mock:' : ''}${sym}|${interval}`;
  const hit = state.history.get(key);
  if (hit && (hit.candles.length >= want || hit.complete)) return Promise.resolve({ ...hit, candles: hit.candles.slice(-want) });
  const failed = state.failedAt.get(key);
  if (failed && nowMs() - failed.at < 20_000) return Promise.resolve({ ...failed.result });
  const fKey = `${key}|${want}`;
  if (state.inflight.has(fKey)) return state.inflight.get(fKey);
  const p = (async () => {
    let res = await getCandles({ symbol: sym, interval, limit: Math.min(want, MAX_LIMIT) });
    let complete = res.candles.length < Math.min(want, MAX_LIMIT);
    // Page backwards for long histories.
    while (res.status === 'online' && !complete && res.candles.length < want && !res.mock) {
      const older = await getCandles({ symbol: sym, interval, limit: Math.min(MAX_LIMIT, want - res.candles.length), end: res.candles[0].t - 1 });
      if (older.status !== 'online' || !older.candles.length) {
        complete = older.status === 'online';
        break;
      }
      res = { ...res, candles: normalizeCandles([...older.candles, ...res.candles]) };
      if (older.candles.length < MAX_LIMIT) complete = true;
    }
    if (res.mock) complete = true;
    if (res.status === 'online' && res.candles.length) {
      const entry = { ...res, complete };
      state.history.set(key, entry);
      state.failedAt.delete(key);
      return { ...entry, candles: entry.candles.slice(-want) };
    }
    state.failedAt.set(key, { at: nowMs(), result: res });
    return res;
  })().finally(() => state.inflight.delete(fKey));
  state.inflight.set(fKey, p);
  return p;
}

// ---------------------------------------------------------------------------------------------
// Live / replay
// ---------------------------------------------------------------------------------------------

const POLL_MS = { '1m': 10_000, '5m': 20_000, '15m': 30_000, '1h': 60_000, '6h': 300_000, '1d': 300_000, '1w': 600_000 };

function onVisibility(fn) {
  const doc = override.document || (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.addEventListener !== 'function') return { hidden: () => false, off: () => {} };
  const h = () => fn(!!doc.hidden);
  doc.addEventListener('visibilitychange', h);
  return { hidden: () => !!doc.hidden, off: () => doc.removeEventListener('visibilitychange', h) };
}

/**
 * subscribeLive({ symbol, interval, bars = 120, stepMs = 3000, seed, form = true }, onUpdate) → unsubscribe
 * Live polling when the catalog marks the symbol live for that interval; otherwise REPLAY: a real
 * historical stretch played forward in real time, one candle every `stepMs` (each candle forms in
 * a few ticks when `form`), jumping to another stretch at the end of the data.
 * onUpdate({ candles, last, status: 'live'|'replay'|'offline', symbol, interval, attribution,
 *            delayed, forming, replay?: { index, total, from, at, stepMs, requested } , mock? })
 * Pauses while the tab is hidden. Never throws; with no data it reports 'offline' and retries.
 */
export function subscribeLive({ symbol, interval = '1d', bars = 120, stepMs = 3000, seed, form = true } = {}, onUpdate = () => {}) {
  const sym = String(symbol || '').toUpperCase();
  let stopped = false;
  let timer = null;
  let paused = false;
  let tick = null; // the function to run when the timer fires / the tab becomes visible
  const emit = (u) => {
    if (stopped) return;
    try {
      onUpdate(u);
    } catch (err) {
      console.error(err);
    }
  };
  const schedule = (fn, ms) => {
    clearTimeout(timer);
    tick = fn;
    if (stopped || paused) return;
    timer = setTimeout(() => {
      timer = null;
      if (!stopped && !paused) fn();
    }, ms);
  };
  const vis = onVisibility((hidden) => {
    paused = hidden;
    if (hidden) clearTimeout(timer);
    else if (tick && !stopped) schedule(tick, 50);
  });
  paused = vis.hidden();

  const offline = (err, retryMs, again) => {
    emit({ candles: [], last: null, status: 'offline', symbol: sym, interval, attribution: '', delayed: true, forming: false, error: err || null });
    schedule(again, retryMs);
  };

  async function startLive(meta) {
    let lastKey = '';
    let fails = 0;
    const poll = async () => {
      const r = await getCandles({ symbol: sym, interval, limit: bars });
      if (stopped) return;
      if (r.status !== 'online' || !r.candles.length) {
        fails++;
        emit({ candles: [], last: null, status: 'offline', symbol: sym, interval, attribution: r.attribution, delayed: true, forming: false, error: r.error });
        schedule(poll, Math.min(60_000, (POLL_MS[interval] || 30_000) * 2 ** Math.min(fails, 3)));
        return;
      }
      fails = 0;
      const last = r.candles[r.candles.length - 1];
      const k = `${r.candles.length}|${last.t}|${last.c}|${last.h}|${last.l}`;
      if (k !== lastKey) {
        lastKey = k;
        emit({ candles: r.candles, last, status: 'live', symbol: sym, interval, attribution: r.attribution, delayed: !!meta?.delayed, forming: true, mock: r.mock || undefined });
      }
      schedule(poll, override.pollMs || POLL_MS[interval] || 30_000);
    };
    await poll();
  }

  async function startReplay(cat, meta) {
    // Replay the requested interval when it exists for this symbol, else the finest available.
    const avail = meta ? meta.intervals : ['1d', '1w'];
    const iv = avail.includes(interval) ? interval : avail[0] || '1d';
    const hist = await getHistory({ symbol: sym, interval: iv, bars: MAX_LIMIT });
    if (stopped) return;
    const all = hist.candles || [];
    if (hist.status !== 'online' || all.length < 30) {
      offline(hist.error || 'no history', 30_000, () => startReplay(cat, meta));
      return;
    }
    const rng = makeRng(seed ?? randomSeed());
    const show = Math.max(10, Math.min(bars, all.length - 20));
    const pickStart = () => rng.int(show, Math.max(show, all.length - Math.min(60, all.length - show)));
    let idx = pickStart(); // next candle to reveal
    let sub = 0;
    const ticks = form ? 4 : 1;
    const view = () => all.slice(Math.max(0, idx - show), idx);
    const send = (candles, forming, restarted = false) => {
      const last = candles[candles.length - 1] || null;
      emit({
        candles, last, status: 'replay', symbol: sym, interval: iv, attribution: hist.attribution, delayed: true, forming,
        replay: { index: idx, total: all.length, from: all[Math.max(0, idx - show)]?.t ?? null, at: last?.t ?? null, stepMs, requested: interval, restarted },
        mock: hist.mock || undefined,
      });
    };
    send(view(), false, false);
    const step = () => {
      if (idx >= all.length) {
        idx = pickStart();
        sub = 0;
        send(view(), false, true);
        schedule(step, stepMs);
        return;
      }
      const k = all[idx];
      sub++;
      if (sub < ticks) {
        // A forming candle: from the open towards the close, touching the wicks on the way.
        const f = sub / ticks;
        const c = k.o + (k.c - k.o) * f;
        const partial = { ...k, c, h: Math.max(k.o, c, k.o + (k.h - k.o) * Math.min(1, f * 1.4)), l: Math.min(k.o, c, k.o + (k.l - k.o) * Math.min(1, f * 1.4)), v: Math.round((k.v || 0) * f) };
        send([...view(), partial], true);
        schedule(step, stepMs / ticks);
        return;
      }
      sub = 0;
      idx++;
      send(view(), false);
      schedule(step, stepMs / ticks);
    };
    schedule(step, stepMs / ticks);
  }

  (async () => {
    try {
      const cat = await getCatalog();
      if (stopped) return;
      const meta = cat.symbols.find((s) => s.id === sym) || null;
      const live = !!(meta && meta.live && meta.intervals.includes(interval) && cat.status === 'online');
      if (live) await startLive(meta);
      else await startReplay(cat, meta);
    } catch (err) {
      offline(err?.message || String(err), 30_000, () => {});
    }
  })();

  return () => {
    stopped = true;
    clearTimeout(timer);
    vis.off();
  };
}

// ---------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------

/** '1d' → 'Daily', '1w' → 'Weekly', '1h' → 'Hourly', '5m' → '5 minutes'. */
export function intervalLabel(interval) {
  return INTERVAL_LABELS[interval] || String(interval || '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Candle time → '12 Mar 2026' (daily / weekly) or '12 Mar 2026 14:05 UTC' (intraday). */
export function formatCandleTime(t, interval = '1d') {
  const d = new Date(Number(t));
  if (!Number.isFinite(d.getTime())) return '';
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (interval === '1d' || interval === '1w') return day;
  return `${day} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

/** Short axis label for a candle time: '12 Mar' (daily), 'Mar 26' (weekly), '14:05' (intraday). */
export function axisLabel(t, interval = '1d') {
  const d = new Date(Number(t));
  if (!Number.isFinite(d.getTime())) return '';
  if (interval === '1w') return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
  if (interval === '1d') return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** 'BTC-USD · Weekly · 12 Mar 2026' — the reveal line of a real-market round. */
export function revealLabel({ symbol, interval, t }) {
  return [symbol, intervalLabel(interval), t != null ? formatCandleTime(t, interval) : null].filter(Boolean).join(' · ');
}
