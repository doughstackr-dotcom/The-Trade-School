// Progress sync (ARCHITECTURE §9.2): merges the device's progress with the member's `progress`
// row, then pushes changes (debounced 3 s, and when the tab is hidden). Never blocks the UI.
//
// - Signing in pulls progress.data, merges it with the local progress (mergeProgress below) and
//   writes the result locally and remotely. The progress a device had before its first sign-in
//   ("anonymous" progress) is kept aside and merged into the account.
// - Signing out flushes a pending push, clears the synced copy from the device and restores the
//   anonymous progress, so the next person on a shared device never sees the member's progress.
// - Pushes use optimistic concurrency on updated_at: if another device wrote in between, the row
//   is pulled, merged and pushed again. Failures retry with exponential backoff (5 s … 5 min).
//
// mergeProgress / pickSynced are pure and unit-tested (tests/unit/access.test.mjs).

const META_KEY = 'tts-sync-v1';           // { userId, base, updatedAt, at } of the last sync
const ANON_KEY = 'tts-progress-anon';     // device progress from before the first sign-in
const PUSH_DEBOUNCE_MS = 3000;
const PULL_THROTTLE_MS = 120000;          // re-pull on focus at most every 2 minutes
const BACKOFF_MIN_MS = 5000;
const BACKOFF_MAX_MS = 300000;

/** Fields that travel to the account. Settings (theme, sound) and lastTier stay on the device. */
export const SYNC_FIELDS = ['xp', 'lessons', 'games', 'badges', 'badgeDates', 'lessonSteps', 'last', 'bestStreak', 'daily', 'gamePrefs'];

const isObj = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
const num = (x) => (Number.isFinite(x) ? x : 0);
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/** The synced part of a store state (a deep copy; missing fields are left out). */
export function pickSynced(state) {
  const out = { v: 1 };
  if (!isObj(state)) return out;
  for (const k of SYNC_FIELDS) if (state[k] !== undefined) out[k] = clone(state[k]);
  return out;
}

/** Counter merge: with a common base, local + remote − base (both sides' new plays); else the sum. */
function counter(a, b, base) {
  const x = num(a);
  const y = num(b);
  if (base == null) return x + y;
  const z = num(base);
  return Math.max(x, y, x + y - z);
}

function newer(a, b) {
  if (!isObj(a)) return isObj(b) ? clone(b) : null;
  if (!isObj(b)) return clone(a);
  return num(b.at) > num(a.at) ? clone(b) : clone(a);
}

function mergeStyle(a = {}, b = {}, base) {
  const out = {
    best: Math.max(num(a.best), num(b.best)),
    stars: Math.max(num(a.stars), num(b.stars)),
    plays: counter(a.plays, b.plays, base ? base.plays : null),
    at: Math.max(num(a.at), num(b.at)) || null,
  };
  if (a.rounds != null || b.rounds != null) out.rounds = Math.max(num(a.rounds), num(b.rounds));
  const last = num(b.at) > num(a.at) ? b : a;
  const lastRounds = last.lastRounds ?? a.lastRounds ?? b.lastRounds;
  if (lastRounds != null) out.lastRounds = lastRounds;
  return out;
}

function mergeGame(a, b, base) {
  if (!isObj(a)) return clone(b);
  if (!isObj(b)) return clone(a);
  const hasBase = isObj(base);
  const out = {
    ...clone(num(b.at) > num(a.at) ? a : b),   // unknown extra fields: prefer the newer side (spread last)
    ...clone(num(b.at) > num(a.at) ? b : a),
    best: Math.max(num(a.best), num(b.best)),
    stars: Math.max(num(a.stars), num(b.stars)),
    plays: counter(a.plays, b.plays, hasBase ? base.plays : null),
    at: Math.max(num(a.at), num(b.at)) || null,
  };
  if (isObj(a.modes) || isObj(b.modes)) {
    const modes = {};
    for (const k of new Set([...Object.keys(a.modes || {}), ...Object.keys(b.modes || {})])) {
      modes[k] = Math.max(num(a.modes?.[k]), num(b.modes?.[k]));
    }
    out.modes = modes;
  }
  if (isObj(a.styles) || isObj(b.styles)) {
    const styles = {};
    const sa = a.styles || {};
    const sb = b.styles || {};
    for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
      if (!isObj(sa[k])) styles[k] = clone(sb[k]);
      else if (!isObj(sb[k])) styles[k] = clone(sa[k]);
      else styles[k] = mergeStyle(sa[k], sb[k], hasBase && isObj(base.styles?.[k]) ? base.styles[k] : null);
    }
    out.styles = styles;
  }
  return out;
}

/** Consecutive local-date keys ending at `last` present in history. */
function streakFrom(history, last) {
  if (!last || !isObj(history)) return 0;
  let n = 0;
  let [y, m, d] = String(last).split('-').map(Number);
  if (!y || !m || !d) return 0;
  for (let i = 0; i < 400; i++) {
    const dt = new Date(y, m - 1, d - i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    if (history[key] == null) break;
    n++;
  }
  return n;
}

function mergeDaily(a, b) {
  const A = isObj(a) ? a : {};
  const B = isObj(b) ? b : {};
  const history = {};
  for (const src of [A.history, B.history]) {
    if (!isObj(src)) continue;
    for (const [k, v] of Object.entries(src)) history[k] = Math.max(history[k] ?? -Infinity, num(v));
  }
  const keys = Object.keys(history).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - 90))) delete history[old];
  const lastA = A.last || null;
  const lastB = B.last || null;
  const last = [lastA, lastB].filter(Boolean).sort().pop() || null;
  // The streak ending on the latest day: the stored streak of the side that played it (it may
  // be longer than the 90 days of history), or longer if the other device's days chain onto it.
  const stored = Math.max(lastA === last ? num(A.streak) : 0, lastB === last ? num(B.streak) : 0);
  const streak = last ? Math.max(stored, streakFrom(history, last)) : 0;
  return { last, streak, best: Math.max(num(A.best), num(B.best), streak), history };
}

/**
 * Merges two synced progress objects (local = this device, remote = the account's row, base = the
 * last state both agreed on, or null).
 * xp = max · lessons: union (done wins, latest time) · games: per id max best / stars, plays summed
 * sensibly (with a base: local + remote − base; without: local + remote) · badges: union (earliest
 * date) · lessonSteps: furthest · last: newest · daily: history union, streak recomputed ·
 * gamePrefs: local wins, missing ones from remote. → a synced object (pickSynced shape, v: 1).
 */
export function mergeProgress(local, remote, base = null) {
  const L = isObj(local) ? local : {};
  const R = isObj(remote) ? remote : {};
  const B = isObj(base) ? base : null;
  const out = { v: 1 };

  out.xp = Math.max(num(L.xp), num(R.xp));

  const lessons = {};
  for (const k of new Set([...Object.keys(L.lessons || {}), ...Object.keys(R.lessons || {})])) {
    const a = L.lessons?.[k];
    const b = R.lessons?.[k];
    lessons[k] = { done: !!(a?.done || b?.done), at: Math.max(num(a?.at), num(b?.at)) || null };
  }
  out.lessons = lessons;

  const games = {};
  for (const k of new Set([...Object.keys(L.games || {}), ...Object.keys(R.games || {})])) {
    games[k] = mergeGame(L.games?.[k], R.games?.[k], B?.games?.[k]);
  }
  out.games = games;

  const dates = {};
  for (const src of [R.badgeDates, L.badgeDates]) {
    if (!isObj(src)) continue;
    for (const [k, v] of Object.entries(src)) dates[k] = dates[k] ? Math.min(dates[k], num(v) || dates[k]) : num(v) || null;
  }
  const badges = [...new Set([...(Array.isArray(R.badges) ? R.badges : []), ...(Array.isArray(L.badges) ? L.badges : [])])];
  badges.sort((x, y) => (num(dates[x]) || Infinity) - (num(dates[y]) || Infinity));
  out.badges = badges;
  out.badgeDates = dates;

  const steps = {};
  for (const k of new Set([...Object.keys(L.lessonSteps || {}), ...Object.keys(R.lessonSteps || {})])) {
    const a = L.lessonSteps?.[k];
    const b = R.lessonSteps?.[k];
    const pick = !a ? b : !b ? a : num(b.max) > num(a.max) ? b : a;
    steps[k] = { step: num(pick?.step), max: Math.max(num(a?.max), num(b?.max)) };
  }
  out.lessonSteps = steps;

  out.last = newer(L.last, R.last);
  out.bestStreak = Math.max(num(L.bestStreak), num(R.bestStreak));
  out.daily = mergeDaily(L.daily, R.daily);

  const prefs = clone(isObj(R.gamePrefs) ? R.gamePrefs : {});
  for (const [id, p] of Object.entries(isObj(L.gamePrefs) ? L.gamePrefs : {})) prefs[id] = { ...(prefs[id] || {}), ...clone(p) };
  out.gamePrefs = prefs;
  return out;
}

/** Stable stringify (sorted keys) for "did anything change?" checks. */
export function stableKey(x) {
  if (Array.isArray(x)) return `[${x.map(stableKey).join(',')}]`;
  if (isObj(x)) return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stableKey(x[k])}`).join(',')}}`;
  return JSON.stringify(x ?? null);
}

// ---------------------------------------------------------------- runtime

function readJSON(key) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeJSON(key, value) {
  try {
    if (value == null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: sync still works for this page view */
  }
}

/**
 * Starts syncing `store` with the signed-in member's progress row through `auth`.
 * → { status, on(fn), off(fn), syncNow(), stop() }
 * status: { state: 'local' | 'syncing' | 'synced' | 'error' | 'offline', at, retryAt, error }
 */
let active = null;

/** The running sync (for the account page's status), or null before startSync(). */
export function getSync() {
  return active;
}

export function startSync({ store, auth }) {
  const listeners = new Set();
  let status = { state: 'local', at: null, retryAt: null, error: null };
  let userId = null;
  let ready = false;          // first pull finished for userId
  let dirty = false;
  let timer = null;
  let retryTimer = null;
  let failures = 0;
  let running = null;         // in-flight sync promise
  let applying = false;       // true while we write merged progress into the store
  let lastPull = 0;
  let stopped = false;

  const setStatus = (patch) => {
    status = { ...status, ...patch };
    for (const fn of [...listeners]) {
      try {
        fn(status);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const meta = () => readJSON(META_KEY);

  function clearTimers() {
    clearTimeout(timer);
    clearTimeout(retryTimer);
    timer = null;
    retryTimer = null;
  }

  function schedulePush(delay = PUSH_DEBOUNCE_MS) {
    if (!userId || !ready || stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => run('push'), delay);
  }

  function onSave() {
    if (applying || !userId) return;
    dirty = true;
    if (ready && !retryTimer) schedulePush();
  }

  async function pullMerge(uid) {
    const m = meta();
    const base = m && m.userId === uid ? m.base : null;
    const row = await auth.progress.get();
    if (uid !== userId) return null;
    const remote = row?.data || {};
    const local = pickSynced(store.state);
    const merged = mergeProgress(local, remote, base);
    if (stableKey(merged) !== stableKey(pickSynced(store.state))) {
      applying = true;
      try {
        store.replaceState({ ...store.snapshot(), ...merged }, { reason: 'sync' });
      } finally {
        applying = false;
      }
    }
    lastPull = Date.now();
    return { row, remote, merged };
  }

  async function push(uid, expected) {
    const data = pickSynced(store.state);
    const res = await auth.progress.put(data, expected);
    if (res?.conflict) return { conflict: true };
    writeJSON(META_KEY, { userId: uid, base: data, updatedAt: res?.updated_at || null, at: Date.now() });
    return { ok: true };
  }

  /** kind: 'pull' (pull, merge, push if needed) | 'push' */
  function run(kind = 'push') {
    if (running) {
      // Coalesce: another run follows the current one.
      if (kind === 'pull') running.then(() => run('pull'));
      else dirty = true;
      return running;
    }
    const uid = userId;
    if (!uid || stopped) return Promise.resolve();
    clearTimeout(timer);
    timer = null;
    running = (async () => {
      setStatus({ state: 'syncing', error: null });
      try {
        let m = meta();
        let expected = m && m.userId === uid ? m.updatedAt : null;
        if (kind === 'pull' || !ready || !expected) {
          const r = await pullMerge(uid);
          if (!r) return;
          expected = r.row?.updated_at || null;
          ready = true;
          if (r.row && stableKey(r.merged) === stableKey(pickSynced(r.remote))) {
            // Remote already has everything: remember it as the common base, no write needed.
            writeJSON(META_KEY, { userId: uid, base: pickSynced(r.remote), updatedAt: expected, at: Date.now() });
            if (!dirty) {
              failures = 0;
              setStatus({ state: 'synced', at: Date.now(), retryAt: null });
              return;
            }
          }
        }
        dirty = false;
        let res = await push(uid, expected);
        if (res.conflict) {
          // Another device wrote since our last sync: pull, merge and try once more.
          const r = await pullMerge(uid);
          if (!r) return;
          res = await push(uid, r.row?.updated_at || null);
          if (res.conflict) throw new Error('Progress changed on another device while saving.');
        }
        failures = 0;
        setStatus({ state: 'synced', at: Date.now(), retryAt: null, error: null });
      } catch (err) {
        if (uid !== userId) return;
        dirty = true;
        failures += 1;
        const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (failures - 1));
        const retryAt = Date.now() + delay;
        setStatus({ state: auth.mode === 'offline' ? 'offline' : 'error', retryAt, error: err?.message || String(err) });
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          run(ready ? 'push' : 'pull');
        }, delay);
      }
    })().finally(() => {
      running = null;
      if (dirty && userId === uid && ready && !retryTimer && !stopped) schedulePush();
    });
    return running;
  }

  /** Before signing out: push anything pending (best effort, 4 s max). */
  async function flush() {
    if (!userId || !ready) return;
    if (!dirty && !timer) return;
    await Promise.race([run('push'), new Promise((r) => setTimeout(r, 4000))]).catch(() => {});
  }

  /** The member is gone (signed out / expired): restore the device's anonymous progress. */
  function detach() {
    clearTimers();
    const m = meta();
    const anon = readJSON(ANON_KEY);
    writeJSON(META_KEY, null);
    writeJSON(ANON_KEY, null);
    ready = false;
    dirty = false;
    failures = 0;
    if (m?.userId) {
      applying = true;
      try {
        store.replaceState(anon && typeof anon === 'object' ? anon : {}, { reason: 'signout' });
      } finally {
        applying = false;
      }
    }
  }

  function attach(uid) {
    const m = meta();
    if (m?.userId && m.userId !== uid) detach();          // another member's copy is still here
    if (!meta()?.userId) writeJSON(ANON_KEY, pickSynced(store.state));  // keep anonymous progress aside
    userId = uid;
    ready = false;
    failures = 0;
    run('pull');
  }

  function onAuth() {
    if (stopped) return;
    const uid = auth.user?.id || null;
    if (uid === userId) return;
    if (!uid) {
      userId = null;
      detach();
      setStatus({ state: auth.mode === 'offline' ? 'offline' : 'local', at: null, retryAt: null, error: null });
      return;
    }
    attach(uid);
  }

  function onVisibility() {
    if (!userId || stopped) return;
    if (document.visibilityState === 'hidden') {
      if (dirty || timer) run('push');
    } else if (Date.now() - lastPull > PULL_THROTTLE_MS && ready) {
      run('pull');
    }
  }
  const onPageHide = () => {
    if (userId && (dirty || timer)) run('push');
  };

  store.on('save', onSave);
  auth.on('change', onAuth);
  auth.addSignOutHook?.(flush);
  try {
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
  } catch {
    /* not in a browser */
  }
  // A member already signed in (session restored before sync started).
  Promise.resolve(auth.ready).then(onAuth, onAuth);

  active = {
    get status() {
      return status;
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    off(fn) {
      listeners.delete(fn);
    },
    syncNow() {
      return run('pull');
    },
    flush,
    stop() {
      stopped = true;
      clearTimers();
      store.off('save', onSave);
      auth.off('change', onAuth);
      try {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', onPageHide);
      } catch {
        /* ignore */
      }
      if (active === api) active = null;
    },
  };
  const api = active;
  return api;
}
