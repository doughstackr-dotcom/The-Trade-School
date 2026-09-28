// Cross-device progress sync for signed-in users (public.progress: one row per user holding the
// progress blob as `data` jsonb; RLS limits each user to their own row).
//
//   sign-in      → pull the account's copy, mergeProgress() it with this device, save locally and
//                  push the merged result back when it differs
//   any save     → debounced push (upsert) of the local progress
//   tab hidden   → pending push is flushed; tab visible again (after a while) or back online
//                  → pull + merge again, so a second device's progress shows up
//
// Automatic, nothing to opt into. It never blocks the UI (all work is async and every failure is
// swallowed with a console warning), does nothing while signed out or offline, and never loads the
// Supabase vendor bundle itself: it only uses the client access.js has already loaded for the
// signed-in session. Device-specific `settings` (sound, theme) are not uploaded.
import { store as defaultStore, mergeProgress } from './store.js';
import * as defaultAccess from './access.js';

/** localStorage key: id of the account whose progress this device's save belongs to. */
export const OWNER_KEY = 'tts-progress-user';
export const PUSH_DEBOUNCE_MS = 4000;
/** Re-pull when the tab becomes visible again at most this often. */
export const REPULL_MS = 60_000;
/** Stay under the table's pg_column_size(data) < 256 KiB check. */
const MAX_BYTES = 240_000;

/** The part of a save that is synced: everything except device-specific settings. */
export function syncable(state) {
  if (!state || typeof state !== 'object') return null;
  const { settings: _settings, ...rest } = state;
  return rest;
}

/** JSON with object keys sorted, so equal progress compares equal regardless of key order. */
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableStringify(x))).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

const same = (a, b) => stableStringify(syncable(a)) === stableStringify(syncable(b));

/**
 * Builds a sync controller. Everything is injectable for tests:
 *   store    { state, replace(next), on(event, fn) }
 *   access   { getAccess() → { user: { id } | null }, onChange(fn), loadedClient() → supabase | null }
 *   storage  localStorage-like (owner key); timers { setTimeout, clearTimeout }; now() → ms
 * → { start(), stop(), pull(), flush(), status() }
 */
export function createProgressSync({
  store = defaultStore,
  access = defaultAccess,
  storage = globalThis.localStorage,
  timers = globalThis,
  now = () => Date.now(),
  debounceMs = PUSH_DEBOUNCE_MS,
  repullMs = REPULL_MS,
  doc = typeof document !== 'undefined' ? document : null,
  win = typeof window !== 'undefined' ? window : null,
} = {}) {
  let uid = null; // signed-in user being synced
  let ready = false; // pulled + merged for `uid`; pushing is allowed
  let gen = 0; // bumps on every user change, so late responses for a previous user are dropped
  let timer = null;
  let dirty = false;
  let applying = false; // store.replace() from a pull: do not echo it back as a local change
  let lastPull = 0;
  let pulling = null;
  const offs = [];

  const warn = (what, err) => console.warn(`[progress-sync] ${what}:`, err?.message || err);

  function readOwner() {
    try { return storage?.getItem(OWNER_KEY) || null; } catch { return null; }
  }
  function writeOwner(id) {
    try { storage?.setItem(OWNER_KEY, id); } catch { /* storage blocked: merge next time too */ }
  }

  function clearTimer() {
    if (timer) timers.clearTimeout(timer);
    timer = null;
  }

  function schedulePush() {
    if (applying || !uid) return;
    dirty = true;
    if (!ready) return;
    clearTimer();
    timer = timers.setTimeout(() => {
      timer = null;
      push();
    }, debounceMs);
  }

  async function push() {
    clearTimer();
    const client = access.loadedClient?.();
    const user = uid;
    const myGen = gen;
    if (!client || !user || !ready) return false;
    const data = syncable(store.state);
    let json;
    try { json = JSON.stringify(data); } catch (err) { warn('serialise', err); return false; }
    if (json.length > MAX_BYTES) {
      warn('push skipped', `progress is ${json.length} bytes`);
      return false;
    }
    dirty = false;
    try {
      const { error } = await client.from('progress').upsert({ user_id: user, data }, { onConflict: 'user_id' });
      if (error) throw error;
      return true;
    } catch (err) {
      if (myGen === gen) dirty = true; // retried on the next change, when visible again or online
      warn('push failed', err);
      return false;
    }
  }

  function pull() {
    if (pulling) return pulling;
    pulling = doPull().finally(() => {
      pulling = null;
    });
    return pulling;
  }

  async function doPull() {
    const client = access.loadedClient?.();
    const user = uid;
    const myGen = gen;
    if (!client || !user) return false;
    lastPull = now();
    let remote = null;
    try {
      const { data, error } = await client.from('progress').select('data').eq('user_id', user).maybeSingle();
      if (error) throw error;
      remote = data?.data && typeof data.data === 'object' ? data.data : null;
    } catch (err) {
      warn('pull failed', err);
      return false;
    }
    if (myGen !== gen || user !== uid) return false;

    // A different account used this device last: start from the cloud copy instead of merging
    // that account's progress into this one. A device with no owner (guest progress) merges it in.
    const owner = readOwner();
    const local = owner && owner !== user ? null : store.state;
    const merged = remote ? mergeProgress(local, remote) : local;
    if (remote && !merged) {
      // Cloud copy is from a newer build: leave both sides alone until this tab updates.
      warn('pull skipped', 'progress was saved by a newer version of the app');
      return false;
    }
    const next = merged || {};
    if (!same(store.state, next)) {
      applying = true;
      try { store.replace(next); } catch (err) { warn('apply', err); } finally { applying = false; }
    }
    writeOwner(user);
    ready = true;
    // Push unless the cloud copy already holds exactly this (compared in its filled-out form).
    if (!remote || dirty || !same(store.state, mergeProgress(null, remote))) await push();
    return true;
  }

  function onAccess(snap) {
    const next = snap?.user?.id || null;
    if (next === uid) return;
    gen++;
    clearTimer();
    uid = next;
    ready = false;
    dirty = false;
    if (uid) pull();
  }

  function onVisibility() {
    if (!uid) return;
    if (doc?.hidden) {
      if (timer || dirty) push();
    } else if (!ready || now() - lastPull >= repullMs) {
      pull();
    }
  }

  function onOnline() {
    if (!uid) return;
    if (!ready) pull();
    else if (dirty) push();
  }

  return {
    start() {
      offs.push(store.on('save', () => schedulePush()));
      offs.push(access.onChange((snap) => onAccess(snap)));
      if (doc?.addEventListener) {
        doc.addEventListener('visibilitychange', onVisibility);
        offs.push(() => doc.removeEventListener('visibilitychange', onVisibility));
      }
      if (win?.addEventListener) {
        win.addEventListener('online', onOnline);
        offs.push(() => win.removeEventListener('online', onOnline));
      }
      onAccess(access.getAccess());
      return this;
    },
    stop() {
      clearTimer();
      for (const off of offs.splice(0)) {
        try { off?.(); } catch { /* ignore */ }
      }
      gen++;
      uid = null;
      ready = false;
    },
    pull,
    flush: () => push(),
    status: () => ({ uid, ready, dirty, pending: !!timer }),
  };
}

let running = null;

/** Starts the app-wide sync once (js/main.js). Safe to call more than once. */
export function startProgressSync() {
  if (!running) {
    try {
      running = createProgressSync().start();
    } catch (err) {
      console.warn('[progress-sync] not started:', err?.message || err);
    }
  }
  return running;
}

export default startProgressSync;
