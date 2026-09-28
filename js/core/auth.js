// Accounts (ARCHITECTURE §9.2): session, sign up / in / out, magic link, password reset, access
// level, Stripe checkout + billing portal, profile, and the progress row used by sync.js.
//
// Modes (auth.mode):
//   'supabase' — the real backend. js/vendor/supabase.js (UMD, window.supabase) is loaded lazily
//                with a <script> tag, only when there is a stored session, an email-link ?code=,
//                or when a page needs it (auth.prepare()). Anonymous visitors never download it.
//   'mock'     — localhost only, when localStorage['tts-auth-mock'] is set: the same API against a
//                fake backend kept in that key (users, progress, subscriptions, a test inbox),
//                with an in-page "Test checkout" sheet. Lets Playwright exercise every flow offline.
//   'offline'  — the vendor script could not load: the public site keeps working, account
//                features say so.
//
// Nothing here touches the DOM at import time; main.js calls auth.init() before the router starts
// (it reads ?code= / ?checkout= / auth errors from the URL first).
import { SUPABASE_URL, SUPABASE_KEY, PLANS, PREMIUM_BUCKET } from '../config.js';
import { normalizeLevel, rankOf, isLocalHost, levelSatisfies } from './access.js';

const SESSION_KEY = 'tts-auth';                 // supabase-js storageKey
const MOCK_DB_KEY = 'tts-auth-mock';            // mock backend (localhost only)
const MOCK_SESSION_KEY = 'tts-auth-mock-session';
const LEVEL_CACHE_KEY = 'tts-access-cache';     // sessionStorage { userId, level, at }
const LEVEL_LAST_KEY = 'tts-access-last';       // localStorage  { userId, level } (fallback only)
const RETURN_KEY = 'tts-return-to';             // localStorage  { route, at }
const CHECKOUT_PLAN_KEY = 'tts-checkout-plan';  // localStorage  { plan, at }

const FOCUS_THROTTLE_MS = 60000;
const LEVEL_CACHE_MS = 10 * 60000;
const LEVEL_TIMEOUT_MS = 8000;
const UNLOCK_POLL_MS = 2000;
const UNLOCK_TIMEOUT_MS = 30000;
const RETURN_TTL_MS = 2 * 3600000;

// ---------------------------------------------------------------- small helpers

function store(kind) {
  try {
    return kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage;
  } catch {
    return null;
  }
}
function getItem(key, kind = 'local') {
  try {
    return store(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function setItem(key, value, kind = 'local') {
  try {
    if (value == null) store(kind)?.removeItem(key);
    else store(kind)?.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}
function getJSON(key, kind) {
  try {
    const raw = getItem(key, kind);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
const setJSON = (key, value, kind) => setItem(key, value == null ? null : JSON.stringify(value), kind);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, message = 'The request timed out.') {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      t = setTimeout(() => rej(Object.assign(new Error(message), { name: 'TimeoutError' })), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

function hostname() {
  try {
    return globalThis.location?.hostname || '';
  } catch {
    return '';
  }
}

/** The site's base URL (origin + path, no query or hash) — where emails and Stripe return to. */
export function siteBase() {
  try {
    return location.origin + location.pathname;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- errors

export class AuthError extends Error {
  constructor(message, code = 'failed', { status = null, cause = null } = {}) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

export const MESSAGES = {
  network: 'We could not reach the account server. Check your connection and try again.',
  offline: 'Accounts are unavailable right now. The free lessons and games still work; try again in a little while.',
  invalid_credentials: 'That email and password do not match. Try again, or reset your password.',
  email_not_confirmed: 'Please confirm your email address first: open the link we sent when you signed up.',
  rate_limited: 'Too many attempts. Please wait a minute and try again.',
  weak_password: 'Choose a stronger password: at least 8 characters, ideally a mix of letters, numbers and symbols.',
  user_exists: 'An account with this email already exists. Sign in instead.',
  no_account: 'No account uses that email yet. Create a free account first.',
  same_password: 'Your new password must be different from your current one.',
  invalid_email: 'Enter a valid email address.',
  session: 'Your session has expired. Please sign in again.',
  link_expired: 'This link has expired or was already used. Request a new one.',
  unconfigured: 'Subscriptions are not open yet. Please try again soon.',
  no_billing: 'You have no billing history yet. Choose a plan first.',
  failed: 'Something went wrong. Please try again.',
};

/** Maps a Supabase / network / function error to an AuthError with a friendly message. */
export function friendlyError(err, fallback = MESSAGES.failed) {
  if (err instanceof AuthError) return err;
  const code = String(err?.code || err?.error_code || '').toLowerCase();
  const name = String(err?.name || '');
  const msg = String(err?.message || err?.error_description || err || '');
  const status = Number(err?.status) || null;
  const make = (key, c = key) => new AuthError(MESSAGES[key], c, { status, cause: err });
  if (name === 'AuthRetryableFetchError' || name === 'FunctionsFetchError' || name === 'TimeoutError' || name === 'StorageUnknownError'
    || /failed to fetch|networkerror|network request failed|fetch failed|load failed|timed out/i.test(msg) || status === 0) return make('network');
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return make('invalid_credentials');
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) return make('email_not_confirmed');
  if (status === 429 || /rate_limit|over_.*limit/.test(code) || /rate limit|too many requests|security purposes/i.test(msg)) return make('rate_limited');
  if (code === 'weak_password' || name === 'AuthWeakPasswordError' || /password should|password is too weak|weak password/i.test(msg)) {
    const reasons = Array.isArray(err?.reasons) ? err.reasons : [];
    const extra = reasons.includes('pwned') ? ' That password has appeared in a data breach; pick another.' : '';
    return new AuthError(MESSAGES.weak_password + extra, 'weak_password', { status, cause: err });
  }
  if (code === 'user_already_exists' || code === 'email_exists' || /already registered|already exists/i.test(msg)) return make('user_exists');
  if (code === 'otp_disabled' || /signups not allowed for otp|user not found/i.test(msg)) return make('no_account');
  if (code === 'same_password' || /different from the old password/i.test(msg)) return make('same_password');
  if (code === 'email_address_invalid' || code === 'validation_failed' || /unable to validate email|invalid format|invalid email/i.test(msg)) return make('invalid_email');
  if (code === 'otp_expired' || /expired|invalid or has expired/i.test(msg)) return make('link_expired');
  if (name === 'AuthSessionMissingError' || /session_not_found|refresh_token/.test(code) || /session missing|jwt expired|invalid jwt/i.test(msg)) return make('session');
  return new AuthError(fallback, code || 'failed', { status, cause: err });
}

// ---------------------------------------------------------------- vendor loading

let vendorPromise = null;

/** Loads js/vendor/supabase.js once with a <script> tag → window.supabase. */
function loadVendor() {
  if (globalThis.supabase?.createClient) return Promise.resolve(globalThis.supabase);
  if (vendorPromise) return vendorPromise;
  vendorPromise = new Promise((resolve, reject) => {
    const src = new URL('../vendor/supabase.js', import.meta.url).href;
    let s = document.querySelector('script[data-vendor="supabase"]');
    if (!s) {
      s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.dataset.vendor = 'supabase';
      document.head.append(s);
    }
    s.addEventListener('load', () => (globalThis.supabase?.createClient ? resolve(globalThis.supabase) : reject(new Error('js/vendor/supabase.js did not define window.supabase'))), { once: true });
    s.addEventListener('error', () => {
      s.remove();
      reject(new Error('Could not load js/vendor/supabase.js'));
    }, { once: true });
  });
  vendorPromise.catch(() => {
    vendorPromise = null;   // allow a retry later
  });
  return vendorPromise;
}

// ---------------------------------------------------------------- backends
// Both return the same shape; `auth` never talks to Supabase directly.

function toUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email || '',
    displayName: u.user_metadata?.display_name || u.displayName || '',
    createdAt: u.created_at || null,
    confirmed: !!(u.email_confirmed_at || u.confirmed_at || u.confirmed),
  };
}

async function functionError(error) {
  // supabase-js: FunctionsHttpError carries the Response in error.context.
  const res = error?.context;
  let status = Number(res?.status) || null;
  let body = null;
  if (res && typeof res.json === 'function') {
    try {
      body = await res.clone().json();
    } catch {
      body = null;
    }
  }
  if (error?.name === 'FunctionsFetchError') return new AuthError(MESSAGES.network, 'network', { cause: error });
  if (error?.name === 'FunctionsRelayError') status = status || 502;
  return httpError(status, body, error);
}

function httpError(status, body, cause) {
  const text = body?.error || null;
  if (status === 503) return new AuthError(text || MESSAGES.unconfigured, 'unconfigured', { status, cause });
  if (status === 401) return new AuthError('Please sign in again to continue.', 'signin', { status, cause });
  if (status === 404) return new AuthError(text || MESSAGES.no_billing, 'no-billing', { status, cause });
  if (status === 400) return new AuthError(text || MESSAGES.failed, 'invalid', { status, cause });
  return new AuthError(text || MESSAGES.failed, 'failed', { status, cause });
}

function removeLocalSession() {
  setItem(SESSION_KEY, null);
  setItem(`${SESSION_KEY}-code-verifier`, null);
  setItem(`${SESSION_KEY}-user`, null);
}

function supabaseBackend(sb) {
  const client = sb.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
      storageKey: SESSION_KEY,
    },
  });
  const check = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  return {
    kind: 'supabase',
    client,
    onAuthEvent(fn) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        // Never await other supabase calls inside this callback (supabase-js holds a lock).
        setTimeout(() => fn(event, session), 0);
      });
      return () => data?.subscription?.unsubscribe();
    },
    async getSession() {
      return check(await client.auth.getSession()).session || null;
    },
    async signUp({ email, password, displayName, redirectTo }) {
      const data = check(await client.auth.signUp({ email, password, options: { data: { display_name: displayName }, emailRedirectTo: redirectTo } }));
      return { session: data.session || null, user: data.user || null };
    },
    async signIn({ email, password }) {
      return check(await client.auth.signInWithPassword({ email, password })).session;
    },
    async magicLink({ email, redirectTo }) {
      check(await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } }));
    },
    async resend({ email, redirectTo }) {
      check(await client.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo } }));
    },
    async resetPassword({ email, redirectTo }) {
      check(await client.auth.resetPasswordForEmail(email, { redirectTo }));
    },
    async updatePassword(password) {
      return check(await client.auth.updateUser({ password })).user;
    },
    async signOut() {
      // 'local' signs out this device only. If the request fails (offline), drop the stored session
      // anyway so the member is signed out here.
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) removeLocalSession();
      return !!error;
    },
    async accessLevel() {
      return check(await client.rpc('access_level'));
    },
    async getProfile(uid) {
      return check(await client.from('profiles').select('display_name').eq('id', uid).maybeSingle());
    },
    async updateProfile(uid, { displayName }) {
      return check(await client.from('profiles').update({ display_name: displayName }).eq('id', uid).select('display_name').single());
    },
    async billing(uid) {
      const subs = check(await client.from('subscriptions')
        .select('id, status, plan, current_period_end, cancel_at_period_end, created_at')
        .eq('user_id', uid).order('created_at', { ascending: false }).limit(5)) || [];
      const grants = check(await client.from('access_grants').select('plan, expires_at').eq('user_id', uid)) || [];
      return { subscriptions: subs, grants };
    },
    async getProgress(uid) {
      return check(await client.from('progress').select('data, updated_at').eq('user_id', uid).maybeSingle());
    },
    async putProgress(uid, data, expected) {
      if (expected) {
        const rows = check(await client.from('progress').update({ data }).eq('user_id', uid).eq('updated_at', expected).select('updated_at'));
        if (rows?.length) return { updated_at: rows[0].updated_at };
        return { conflict: true };
      }
      const row = check(await client.from('progress').upsert({ user_id: uid, data }, { onConflict: 'user_id' }).select('updated_at').single());
      return { updated_at: row?.updated_at || null };
    },
    async invoke(name, body) {
      const session = check(await client.auth.getSession()).session;
      if (!session?.access_token) throw new AuthError('Please sign in again to continue.', 'signin', { status: 401 });
      const { data, error } = await client.functions.invoke(name, { body, headers: { Authorization: `Bearer ${session.access_token}` } });
      if (error) throw await functionError(error);
      return data;
    },
    async download(path) {
      const blob = check(await client.storage.from(PREMIUM_BUCKET).download(path));
      return blob.text();
    },
  };
}

// ---------------------------------------------------------------- mock backend (localhost only)

const MOCK_DEFAULT_CONFIG = { latencyMs: 180, webhookDelayMs: 2500, billing: true, confirm: true };

function mockBackend() {
  const listeners = new Set();
  const read = () => {
    let db = null;
    try {
      const raw = getItem(MOCK_DB_KEY);
      db = raw && raw.trim().startsWith('{') ? JSON.parse(raw) : null;
    } catch {
      db = null;
    }
    db = db && typeof db === 'object' ? db : {};
    db.v = 1;
    for (const k of ['users', 'progress', 'subscriptions', 'grants', 'links', 'customers']) if (!db[k] || typeof db[k] !== 'object') db[k] = {};
    if (!Array.isArray(db.outbox)) db.outbox = [];
    db.config = { ...MOCK_DEFAULT_CONFIG, ...(db.config || {}) };
    return db;
  };
  const write = (db) => setJSON(MOCK_DB_KEY, db);
  const latency = () => sleep(read().config.latencyMs);
  const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
  const newId = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
  const iso = (t) => new Date(t).toISOString();
  const emit = (event, session) => {
    for (const fn of [...listeners]) setTimeout(() => fn(event, session), 0);
  };
  const sessionFor = (db, uid) => {
    const u = db.users[uid];
    if (!u) return null;
    return {
      access_token: `mock-token-${uid}`,
      user: { id: u.id, email: u.email, user_metadata: { display_name: u.display_name }, email_confirmed_at: u.confirmed ? u.confirmedAt || u.created_at : null, created_at: u.created_at },
    };
  };
  const currentUid = () => getJSON(MOCK_SESSION_KEY)?.userId || null;
  const requireUid = () => {
    const uid = currentUid();
    if (!uid || !read().users[uid]) throw fail('session_not_found', 'Auth session missing!', 401);
    return uid;
  };
  const findByEmail = (db, email) => Object.values(db.users).find((u) => u.email === String(email).trim().toLowerCase()) || null;
  const mail = (db, { to, type, hash }) => {
    const token = newId('link');
    db.links[token] = { type, userId: findByEmail(db, to)?.id || null, at: Date.now() };
    const link = `${siteBase()}?code=mock_${token}#${hash}`;
    db.outbox.push({ to, type, link, at: Date.now() });
    db.outbox = db.outbox.slice(-10);
    return link;
  };
  const ACTIVE = ['active', 'trialing', 'past_due'];
  const settle = (db, uid) => {
    // Simulated webhook: plan changes become visible after config.webhookDelayMs.
    const s = db.subscriptions[uid];
    if (s?.pending && Date.now() >= s.pending.at) {
      Object.assign(s, s.pending.patch);
      delete s.pending;
    }
    return s || null;
  };
  const levelOf = (db, uid) => {
    const s = settle(db, uid);
    let lv = 'free';
    const bump = (plan) => {
      if (rankOf(plan) > rankOf(lv)) lv = plan;
    };
    if (s && ACTIVE.includes(s.status) && s.plan) bump(s.plan);
    for (const g of db.grants[uid] || []) if (!g.expires_at || Date.parse(g.expires_at) > Date.now()) bump(g.plan);
    return lv;
  };

  return {
    kind: 'mock',
    onAuthEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Consumes a mock email link (?code=mock_<token>) → { event, session } | throws. */
    async exchange(code) {
      await latency();
      const db = read();
      const token = String(code).replace(/^mock_/, '');
      const link = db.links[token];
      if (!link || !db.users[link.userId]) throw fail('otp_expired', 'Email link is invalid or has expired', 403);
      delete db.links[token];
      const u = db.users[link.userId];
      if (!u.confirmed) {
        u.confirmed = true;
        u.confirmedAt = iso(Date.now());
      }
      write(db);
      setJSON(MOCK_SESSION_KEY, { userId: u.id, at: Date.now() });
      const session = sessionFor(db, u.id);
      return { event: link.type === 'recovery' ? 'PASSWORD_RECOVERY' : 'SIGNED_IN', session };
    },
    async getSession() {
      const db = read();
      const uid = currentUid();
      return uid && db.users[uid] ? sessionFor(db, uid) : null;
    },
    async signUp({ email, password, displayName }) {
      await latency();
      const db = read();
      const addr = String(email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) throw fail('email_address_invalid', 'Unable to validate email address: invalid format');
      if (String(password || '').length < 8) throw fail('weak_password', 'Password should be at least 8 characters.', 422);
      if (findByEmail(db, addr)) {
        // Like Supabase with confirmations on: no error, no session (no account enumeration).
        return { session: null, user: null };
      }
      const id = newId('user');
      db.users[id] = { id, email: addr, password, display_name: String(displayName || '').slice(0, 60) || addr.split('@')[0], confirmed: !db.config.confirm, created_at: iso(Date.now()) };
      db.progress[id] = { data: {}, updated_at: iso(Date.now()) };
      if (db.config.confirm) {
        mail(db, { to: addr, type: 'signup', hash: 'account' });
        write(db);
        return { session: null, user: { id, email: addr } };
      }
      write(db);
      setJSON(MOCK_SESSION_KEY, { userId: id, at: Date.now() });
      const session = sessionFor(db, id);
      emit('SIGNED_IN', session);
      return { session, user: session.user };
    },
    async signIn({ email, password }) {
      await latency();
      const db = read();
      const u = findByEmail(db, email);
      if (!u || u.password !== password) throw fail('invalid_credentials', 'Invalid login credentials');
      if (!u.confirmed) throw fail('email_not_confirmed', 'Email not confirmed');
      setJSON(MOCK_SESSION_KEY, { userId: u.id, at: Date.now() });
      const session = sessionFor(db, u.id);
      emit('SIGNED_IN', session);
      return session;
    },
    async magicLink({ email }) {
      await latency();
      const db = read();
      if (!findByEmail(db, email)) throw fail('otp_disabled', 'Signups not allowed for otp', 422);
      mail(db, { to: String(email).trim().toLowerCase(), type: 'magiclink', hash: 'account' });
      write(db);
    },
    async resend({ email }) {
      await latency();
      const db = read();
      const u = findByEmail(db, email);
      if (u && !u.confirmed) {
        mail(db, { to: u.email, type: 'signup', hash: 'account' });
        write(db);
      }
    },
    async resetPassword({ email }) {
      await latency();
      const db = read();
      if (findByEmail(db, email)) {
        mail(db, { to: String(email).trim().toLowerCase(), type: 'recovery', hash: 'reset.update' });
        write(db);
      }
    },
    async updatePassword(password) {
      await latency();
      const uid = requireUid();
      const db = read();
      if (String(password || '').length < 8) throw fail('weak_password', 'Password should be at least 8 characters.', 422);
      if (db.users[uid].password === password) throw fail('same_password', 'New password should be different from the old password.', 422);
      db.users[uid].password = password;
      write(db);
      const session = sessionFor(db, uid);
      emit('USER_UPDATED', session);
      return session.user;
    },
    async signOut() {
      await latency();
      setJSON(MOCK_SESSION_KEY, null);
      emit('SIGNED_OUT', null);
      return false;
    },
    async accessLevel() {
      await latency();
      const uid = requireUid();
      const db = read();
      const lv = levelOf(db, uid);
      write(db);
      return lv;
    },
    async getProfile(uid) {
      await latency();
      const u = read().users[uid];
      return u ? { display_name: u.display_name } : null;
    },
    async updateProfile(uid, { displayName }) {
      await latency();
      const db = read();
      if (!db.users[uid]) throw fail('session_not_found', 'Auth session missing!', 401);
      db.users[uid].display_name = displayName;
      write(db);
      return { display_name: displayName };
    },
    async billing(uid) {
      await latency();
      const db = read();
      const s = settle(db, uid);
      write(db);
      const sub = s ? { id: s.id, status: s.status, plan: s.plan, current_period_end: s.current_period_end, cancel_at_period_end: !!s.cancel_at_period_end, created_at: s.created_at } : null;
      return { subscriptions: sub ? [sub] : [], grants: (db.grants[uid] || []).map((g) => ({ plan: g.plan, expires_at: g.expires_at || null })) };
    },
    async getProgress(uid) {
      await latency();
      return read().progress[uid] || null;
    },
    async putProgress(uid, data, expected) {
      await latency();
      const db = read();
      const row = db.progress[uid];
      if (expected && (!row || row.updated_at !== expected)) return { conflict: true };
      // updated_at always moves forward (two writes in the same millisecond still differ).
      const prev = row ? Date.parse(row.updated_at) || 0 : 0;
      const updated_at = iso(Math.max(Date.now(), prev + 1));
      db.progress[uid] = { data, updated_at };
      write(db);
      return { updated_at };
    },
    async invoke(name, body) {
      await latency();
      const uid = requireUid();
      const db = read();
      if (!db.config.billing) {
        throw httpError(503, { error: name === 'customer-portal' ? 'Billing is not open yet.' : MESSAGES.unconfigured });
      }
      if (name === 'create-checkout') {
        const plan = body?.plan;
        if (plan !== 'beginner' && plan !== 'advanced') throw httpError(400, { error: 'Choose the Beginner or Advanced plan.' });
        const s = settle(db, uid);
        if (s && ACTIVE.includes(s.status)) {
          if (s.plan === plan && !s.pending) return { url: 'mock:portal' };
          s.pending = { at: Date.now() + db.config.webhookDelayMs, patch: { plan, cancel_at_period_end: false } };
          write(db);
          return { switched: true, plan };
        }
        return { url: `mock:checkout:${plan}` };
      }
      if (name === 'customer-portal') {
        if (!db.customers[uid]) throw httpError(404, { error: MESSAGES.no_billing });
        return { url: 'mock:portal' };
      }
      throw httpError(404, { error: 'Unknown function.' });
    },
    async download() {
      throw fail('not_found', 'Mock mode has no premium bucket', 404);
    },
    // ---- test helpers used by the in-page sheets and tests
    completeCheckout(plan) {
      const uid = currentUid();
      const db = read();
      if (!uid || !db.users[uid]) return;
      db.customers[uid] = true;
      const now = Date.now();
      db.subscriptions[uid] = {
        id: newId('sub'), status: 'incomplete', plan, created_at: iso(now), cancel_at_period_end: false,
        current_period_end: iso(now + 30 * 86400000),
        pending: { at: now + db.config.webhookDelayMs, patch: { status: 'active' } },
      };
      write(db);
    },
    portalAction(action, plan) {
      const uid = currentUid();
      const db = read();
      const s = settle(db, uid);
      if (!s) return;
      if (action === 'cancel') s.cancel_at_period_end = true;
      if (action === 'resume') s.cancel_at_period_end = false;
      if (action === 'past_due') s.status = 'past_due';
      if (action === 'paid') s.status = 'active';
      if (action === 'end') s.status = 'canceled';
      if (action === 'switch' && plan) s.pending = { at: Date.now() + db.config.webhookDelayMs, patch: { plan } };
      write(db);
    },
    subscription() {
      const uid = currentUid();
      const db = read();
      return uid ? settle(db, uid) : null;
    },
    inbox(email) {
      const db = read();
      const to = String(email || '').trim().toLowerCase();
      return db.outbox.filter((m) => !to || m.to === to).slice().reverse();
    },
  };
}

// ---------------------------------------------------------------- the auth singleton

const listeners = new Map();

function emit(event, detail) {
  for (const fn of [...(listeners.get(event) || [])]) {
    try {
      fn(detail);
    } catch (err) {
      console.error(err);
    }
  }
}

let backend = null;
let clientPromise = null;
let initPromise = null;
let applyPromise = Promise.resolve();
let mode = 'supabase';
let user = null;
let profile = null;
let level = null;
let levelKnown = false;
let levelAt = 0;
let levelInflight = null;
let levelError = null;
let flash = null;
let checkoutReturn = null;
let linkSignIn = false;
let urlCode = null;
let unlock = null;
let redirecting = false;
let unlockTimer = null;
let restoring = false;
const signOutHooks = new Set();

function change(reason) {
  emit('change', { reason });
}

function isMockEnabled() {
  return isLocalHost(hostname()) && getItem(MOCK_DB_KEY) != null;
}

/** Reads (and strips) ?checkout= and auth errors from the URL before the router starts. */
function captureUrl() {
  let url;
  try {
    url = new URL(location.href);
  } catch {
    return;
  }
  const q = url.searchParams;
  let dirty = false;
  const co = q.get('checkout');
  if (co) {
    checkoutReturn = co === 'success' ? 'success' : co === 'cancel' ? 'cancel' : null;
    q.delete('checkout');
    dirty = true;
  }
  // Auth errors come back as query params (PKCE) or, from older links, in the hash.
  let errParams = null;
  if (q.get('error') || q.get('error_description') || q.get('error_code')) {
    errParams = { error: q.get('error'), error_code: q.get('error_code'), error_description: q.get('error_description') };
    ['error', 'error_code', 'error_description'].forEach((k) => q.delete(k));
    dirty = true;
  }
  const hash = url.hash.replace(/^#/, '');
  if (/(^|&)(error|error_description|error_code)=/.test(hash)) {
    const hp = new URLSearchParams(hash);
    errParams = { error: hp.get('error'), error_code: hp.get('error_code'), error_description: hp.get('error_description') };
    url.hash = '#signin';
    dirty = true;
  }
  if (errParams) {
    const e = friendlyError({ code: errParams.error_code, message: errParams.error_description || errParams.error || '' }, 'That email link did not work. Request a new one.');
    flash = { tone: 'bad', text: e.message };
  }
  urlCode = q.get('code');
  if (dirty) stripUrl(url);
}

function stripUrl(url) {
  try {
    history.replaceState(history.state, '', url.toString());
  } catch {
    /* sandboxed: leave the URL */
  }
}

function stripCodeParam() {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has('code')) return;
    url.searchParams.delete('code');
    stripUrl(url);
  } catch {
    /* ignore */
  }
}

function cachedLevel(uid) {
  const c = getJSON(LEVEL_CACHE_KEY, 'session');
  if (c && c.userId === uid && Date.now() - (c.at || 0) < LEVEL_CACHE_MS) return normalizeLevel(c.level);
  return null;
}

function rememberLevel(uid, lv) {
  setJSON(LEVEL_CACHE_KEY, { userId: uid, level: lv, at: Date.now() }, 'session');
  setJSON(LEVEL_LAST_KEY, { userId: uid, level: lv });
}

function setLevel(lv, reason = 'level') {
  const next = user ? normalizeLevel(lv) || 'free' : null;
  if (next === level) return;
  level = next;
  change(reason);
}

async function applySession(session, { reason = 'session' } = {}) {
  const next = toUser(session?.user);
  const prevId = user?.id || null;
  if (!next) {
    if (!prevId) return;
    user = null;
    profile = null;
    level = null;
    levelKnown = false;
    levelAt = 0;
    levelError = null;
    setItem(LEVEL_CACHE_KEY, null, 'session');
    stopUnlock();
    change('signout');
    return;
  }
  if (prevId === next.id) {
    user = { ...user, ...next, displayName: next.displayName || user.displayName };
    change(reason);
    return;
  }
  user = next;
  profile = null;
  levelError = null;
  const cached = cachedLevel(next.id);
  const last = getJSON(LEVEL_LAST_KEY);
  levelKnown = cached != null;
  levelAt = cached != null ? Date.now() : 0;
  level = cached || (last?.userId === next.id ? normalizeLevel(last.level) : null) || 'free';
  change(reason);
  const work = Promise.all([
    cached ? Promise.resolve(level) : refreshAccess({ force: true }),
    loadProfile(),
  ]).catch(() => {});
  applyPromise = work;
  await work;
  if (cached) refreshAccess({ force: false });   // quietly confirm a cached level (throttled)
}

async function loadProfile() {
  if (!user || !backend) return;
  const uid = user.id;
  try {
    const p = await withTimeout(backend.getProfile(uid), LEVEL_TIMEOUT_MS);
    if (user?.id !== uid) return;
    profile = p ? { display_name: p.display_name || '' } : { display_name: user.displayName || '' };
    change('profile');
  } catch (err) {
    console.warn('[auth] profile unavailable:', err?.message || err);
  }
}

async function onBackendEvent(event, session) {
  switch (event) {
    case 'SIGNED_IN':
    case 'INITIAL_SESSION':
      if (session) await applySession(session, { reason: 'signin' });
      break;
    case 'SIGNED_OUT':
      await applySession(null);
      break;
    case 'TOKEN_REFRESHED':
    case 'USER_UPDATED':
      if (session) await applySession(session, { reason: event === 'USER_UPDATED' ? 'user' : 'token' });
      break;
    case 'PASSWORD_RECOVERY':
      if (session) await applySession(session, { reason: 'recovery' });
      emit('recovery', {});
      break;
    default:
      break;
  }
}

async function startBackend() {
  backend.onAuthEvent((event, session) => {
    onBackendEvent(event, session).catch((err) => console.error('[auth]', err));
  });
  if (backend.kind === 'mock' && urlCode && /^mock_/.test(urlCode)) {
    try {
      const { event, session } = await backend.exchange(urlCode);
      linkSignIn = true;
      stripCodeParam();
      await applySession(session, { reason: 'signin' });
      if (event === 'PASSWORD_RECOVERY') emit('recovery', {});
      else flash = { tone: 'good', text: 'You are signed in. Welcome!' };
    } catch (err) {
      stripCodeParam();
      flash = { tone: 'bad', text: friendlyError(err).message };
    }
    urlCode = null;
  }
  const session = await withTimeout(backend.getSession(), 15000).catch((err) => {
    console.warn('[auth] session restore failed:', err?.message || err);
    return null;
  });
  if (urlCode) {
    // supabase-js exchanged the code already (and stripped it) — or could not: the code verifier
    // lives in the browser that asked for the link.
    const stillThere = (() => {
      try {
        return new URL(location.href).searchParams.has('code');
      } catch {
        return false;
      }
    })();
    if (session && !stillThere) {
      linkSignIn = true;
      flash = { tone: 'good', text: 'You are signed in. Welcome!' };
    } else if (stillThere) {
      stripCodeParam();
      if (!session) {
        flash = {
          tone: 'info',
          text: 'Your email link worked, but this browser could not finish signing you in (it was opened in a different browser from the one that asked for it). If you were confirming your email, it is confirmed: sign in below.',
        };
      }
    }
    urlCode = null;
  }
  await applySession(session, { reason: 'restore' });
}

/** Creates the backend when needed (vendor load for Supabase). Throws AuthError('offline'). */
function ensureClient() {
  if (backend) return Promise.resolve(backend);
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    try {
      if (isMockEnabled()) {
        mode = 'mock';
        backend = mockBackend();
      } else {
        const sb = await loadVendor();
        backend = supabaseBackend(sb);
        mode = 'supabase';
      }
      await startBackend();
      change('mode');
      return backend;
    } catch (err) {
      backend = null;
      if (mode !== 'mock') mode = 'offline';
      console.warn('[auth] accounts unavailable:', err?.message || err);
      change('mode');
      throw new AuthError(MESSAGES.offline, 'offline', { cause: err });
    } finally {
      clientPromise = null;
    }
  })();
  return clientPromise;
}

async function requireBackend() {
  try {
    return await ensureClient();
  } catch (err) {
    throw friendlyError(err);
  }
}

async function requireUser() {
  await auth.ready;
  if (!user) throw new AuthError('Please sign in first.', 'signin', { status: 401 });
  return requireBackend();
}

function onFocus() {
  if (!user || !backend) return;
  if (document.visibilityState === 'hidden') return;
  refreshAccess({ force: false });
}

/** Re-reads the access level. force: skip the once-a-minute throttle. → level */
function refreshAccess({ force = false } = {}) {
  if (!user || !backend) return Promise.resolve(level);
  if (!force && levelAt && Date.now() - levelAt < FOCUS_THROTTLE_MS) return Promise.resolve(level);
  if (levelInflight) return levelInflight;
  const uid = user.id;
  levelInflight = (async () => {
    try {
      const lv = normalizeLevel(await withTimeout(backend.accessLevel(), LEVEL_TIMEOUT_MS)) || 'free';
      if (user?.id !== uid) return level;
      levelAt = Date.now();
      levelKnown = true;
      levelError = null;
      rememberLevel(uid, lv);
      setLevel(lv);
    } catch (err) {
      levelAt = Date.now();          // throttle retries too
      levelError = friendlyError(err);
      console.warn('[auth] access level unavailable:', err?.message || err);
      change('level-error');
    } finally {
      levelInflight = null;
    }
    return level;
  })();
  return levelInflight;
}

function stopUnlock() {
  clearTimeout(unlockTimer);
  unlockTimer = null;
  if (unlock?.state === 'polling') unlock = null;
}

/**
 * Polls refreshAccess() every 2 s for up to 30 s after a checkout or a plan switch, until the
 * level reaches `expected` (or rises above `from`). auth.unlock tracks it; while it runs,
 * auth.billingBusy is true and every Subscribe / Upgrade button is disabled.
 */
function startUnlock({ expected = null, source = 'checkout' } = {}) {
  clearTimeout(unlockTimer);
  const from = level;
  const startedAt = Date.now();
  unlock = { state: 'polling', plan: expected, from, source, startedAt, level };
  change('unlock');
  const reached = () => (expected ? levelSatisfies(level, expected) && (source !== 'switch' || level === expected) : rankOf(level) > rankOf(from) || level === 'beginner' || level === 'advanced');
  const tick = async () => {
    if (!unlock || unlock.startedAt !== startedAt) return;
    if (!user) {
      unlock = { ...unlock, state: 'signin' };
      change('unlock');
      return;
    }
    await refreshAccess({ force: true });
    if (!unlock || unlock.startedAt !== startedAt) return;
    if (reached()) {
      unlock = { ...unlock, state: 'done', level };
      setItem(CHECKOUT_PLAN_KEY, null);
      change('unlock');
      emit('unlocked', { level, plan: expected, source });
      return;
    }
    if (Date.now() - startedAt >= UNLOCK_TIMEOUT_MS) {
      unlock = { ...unlock, state: 'slow', level };
      change('unlock');
      return;
    }
    unlockTimer = setTimeout(tick, UNLOCK_POLL_MS);
  };
  tick();
}

async function openUrl(url) {
  if (url.startsWith('mock:')) {
    await mockSheet(url);
    return;
  }
  location.assign(url);
}

// In-page stand-ins for Stripe Checkout and the customer portal (mock mode only).
async function mockSheet(url) {
  const ui = await import('./ui.js');
  const { h, modal, icon } = ui;
  const base = siteBase();
  if (url.startsWith('mock:checkout:')) {
    const plan = url.slice('mock:checkout:'.length);
    const p = PLANS[plan];
    const price = `$${p.price.toFixed(2)}`;
    return new Promise((resolve) => {
      let paid = false;
      modal({
        title: 'Test checkout',
        size: 'wide',
        body: h('div', { class: 'mock-sheet stack' },
          h('p', { class: 'chip chip--accent' }, icon('info', { size: 14 }), 'Test mode: no real payment is taken'),
          h('div', { class: 'mock-sheet__line' },
            h('span', null, `The Trade School: ${p.name}`),
            h('strong', { class: 'mono' }, `${price} / month`)),
          h('div', { class: 'mock-sheet__card mono', 'aria-label': 'Test card 4242 4242 4242 4242' }, '4242 4242 4242 4242 · 12/34 · 123'),
          h('p', { class: 'faint t-14' }, 'On the live site this step is Stripe Checkout. Card details never touch our servers.')),
        actions: [
          { label: 'Cancel', onClick: () => {
            paid = false;
          } },
          { label: `Pay ${price} (test)`, primary: true, onClick: () => {
            paid = true;
            backend.completeCheckout(plan);
          } },
        ],
        onClose: () => {
          location.assign(paid ? `${base}?checkout=success#account` : `${base}?checkout=cancel#pricing`);
          resolve();
        },
      });
    });
  }
  // mock:portal
  const s = backend.subscription();
  return new Promise((resolve) => {
    const other = s?.plan === 'advanced' ? 'beginner' : 'advanced';
    const act = (a, plan) => () => {
      backend.portalAction(a, plan);
    };
    modal({
      title: 'Test billing portal',
      size: 'wide',
      body: h('div', { class: 'mock-sheet stack' },
        h('p', { class: 'chip chip--accent' }, icon('info', { size: 14 }), 'Test mode: this stands in for the Stripe customer portal'),
        s ? h('p', null, `Plan: ${PLANS[s.plan]?.name || s.plan} · status ${s.status}${s.cancel_at_period_end ? ' · cancels at period end' : ''}`) : h('p', null, 'No subscription.')),
      actions: s ? [
        s.cancel_at_period_end ? { label: 'Resume subscription', onClick: act('resume') } : { label: 'Cancel at period end', onClick: act('cancel') },
        { label: `Switch to ${PLANS[other].name}`, onClick: act('switch', other) },
        s.status === 'past_due' ? { label: 'Pay overdue invoice', onClick: act('paid') } : { label: 'Simulate failed payment', onClick: act('past_due') },
        { label: 'Return to site', primary: true },
      ] : [{ label: 'Return to site', primary: true }],
      onClose: () => {
        refreshAccess({ force: true });
        change('billing');
        resolve();
      },
    });
  });
}

// ---------------------------------------------------------------- public API

export const auth = {
  /** Resolves once the session is restored (or known to be absent) and its level is known. */
  get ready() {
    return (initPromise || this.init()).then(() => applyPromise).then(() => undefined, () => undefined);
  },
  get user() {
    return user;
  },
  get profile() {
    return profile;
  },
  /** null (signed out) | 'free' | 'beginner' | 'advanced' */
  get level() {
    return user ? level || 'free' : null;
  },
  get levelKnown() {
    return !!user && levelKnown;
  },
  get levelError() {
    return levelError;
  },
  get mode() {
    return mode;
  },
  get isMock() {
    return mode === 'mock';
  },
  /** True while a stored session is being restored at boot (the header shows a placeholder). */
  get restoring() {
    return restoring;
  },
  /** Name to greet the member with (profile → sign-up name → email prefix). */
  get displayName() {
    if (!user) return '';
    return profile?.display_name || user.displayName || (user.email || '').split('@')[0] || 'Member';
  },
  /** The checkout return flow: { state: 'polling' | 'done' | 'slow' | 'signin', plan, from, level, source } | null */
  get unlock() {
    return unlock;
  },
  /** True while a payment or plan switch is being confirmed (or we are redirecting to Stripe). */
  get billingBusy() {
    return redirecting || unlock?.state === 'polling';
  },
  /** 'success' | 'cancel' | null — Stripe's ?checkout= return value (read once per kind). */
  consumeCheckoutReturn(kind) {
    if (checkoutReturn !== kind) return false;
    checkoutReturn = null;
    return true;
  },
  peekCheckoutReturn() {
    return checkoutReturn;
  },
  /** A one-off message from an email link or URL error: { tone: 'good'|'bad'|'info', text } | null */
  consumeFlash() {
    const f = flash;
    flash = null;
    return f;
  },
  /** True once after a sign-in that came from an email link (confirmation / magic link). */
  consumeLinkSignIn() {
    const v = linkSignIn;
    linkSignIn = false;
    return v;
  },

  /** Boots auth (call once, before the router starts). Safe to call again. */
  init() {
    if (initPromise) return initPromise;
    captureUrl();
    if (isMockEnabled()) mode = 'mock';
    const eager = mode === 'mock' || getItem(SESSION_KEY) != null || !!urlCode;
    restoring = eager;
    initPromise = (async () => {
      if (eager) {
        try {
          await ensureClient();
        } catch {
          /* offline: the public site keeps working */
        }
        await applyPromise.catch(() => {});
        restoring = false;
        change('ready');
      }
      if (checkoutReturn === 'success') {
        const saved = getJSON(CHECKOUT_PLAN_KEY);
        const expected = saved && Date.now() - (saved.at || 0) < 3600000 ? saved.plan : null;
        if (user) startUnlock({ expected, source: 'checkout' });
        else unlock = { state: 'signin', plan: expected, from: null, source: 'checkout', startedAt: Date.now(), level: null };
      }
    })();
    try {
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onFocus);
      // Back from Stripe with the browser's back button (page restored from the bfcache).
      window.addEventListener('pageshow', (e) => {
        if (e.persisted && redirecting) {
          redirecting = false;
          change('redirect');
        }
      });
    } catch {
      /* not in a browser */
    }
    return initPromise;
  },

  /** Makes sure the account backend is loaded (pages with forms call this on mount). → mode */
  async prepare() {
    try {
      await ensureClient();
    } catch {
      /* mode is 'offline' */
    }
    return mode;
  },

  /** Is the account server reachable enough to show forms? */
  get available() {
    return mode !== 'offline';
  },

  async signUp({ email, password, displayName }) {
    const b = await requireBackend();
    try {
      const { session } = await b.signUp({
        email: String(email || '').trim(),
        password,
        displayName: String(displayName || '').trim().slice(0, 60),
        redirectTo: `${siteBase()}#account`,
      });
      if (session) await applySession(session, { reason: 'signin' });
      return { needsConfirmation: !session };
    } catch (err) {
      throw friendlyError(err);
    }
  },

  async signIn({ email, password }) {
    const b = await requireBackend();
    try {
      const session = await b.signIn({ email: String(email || '').trim(), password });
      await applySession(session, { reason: 'signin' });
      return { user };
    } catch (err) {
      throw friendlyError(err);
    }
  },

  async signInWithMagicLink(email) {
    const b = await requireBackend();
    try {
      await b.magicLink({ email: String(email || '').trim(), redirectTo: `${siteBase()}#account` });
    } catch (err) {
      throw friendlyError(err);
    }
  },

  async resendConfirmation(email) {
    const b = await requireBackend();
    try {
      await b.resend({ email: String(email || '').trim(), redirectTo: `${siteBase()}#account` });
    } catch (err) {
      throw friendlyError(err);
    }
  },

  async sendPasswordReset(email) {
    const b = await requireBackend();
    try {
      await b.resetPassword({ email: String(email || '').trim(), redirectTo: `${siteBase()}#reset.update` });
    } catch (err) {
      throw friendlyError(err);
    }
  },

  async updatePassword(password) {
    const b = await requireUser();
    try {
      await b.updatePassword(password);
    } catch (err) {
      throw friendlyError(err);
    }
  },

  async updateProfile({ displayName }) {
    const b = await requireUser();
    const name = String(displayName || '').trim().slice(0, 60);
    if (!name) throw new AuthError('Enter a display name.', 'invalid');
    try {
      const p = await b.updateProfile(user.id, { displayName: name });
      profile = { display_name: p?.display_name ?? name };
      change('profile');
      return profile;
    } catch (err) {
      throw friendlyError(err);
    }
  },

  /** Signs this device out. Pending progress is pushed first; the synced copy is then cleared. */
  async signOut() {
    if (!user) return;
    for (const fn of [...signOutHooks]) {
      try {
        await fn();
      } catch (err) {
        console.warn('[auth] sign-out hook failed:', err);
      }
    }
    try {
      if (backend) await withTimeout(backend.signOut(), 8000);
    } catch (err) {
      console.warn('[auth] sign-out request failed; signing out locally:', err?.message || err);
      if (mode !== 'mock') removeLocalSession();
      else setItem(MOCK_SESSION_KEY, null);
    }
    setItem(CHECKOUT_PLAN_KEY, null);
    await applySession(null);
  },

  /** Registers fn() to run (awaited) before signing out, e.g. sync's final push. */
  addSignOutHook(fn) {
    signOutHooks.add(fn);
    return () => signOutHooks.delete(fn);
  },

  /** Re-reads the access level (throttled to once a minute unless force). → level */
  refreshAccess(opts) {
    return refreshAccess(opts).then(() => auth.level);
  },

  /**
   * Starts Stripe Checkout for a plan. Redirects (→ { redirected: true }); a member already on
   * the other plan is switched with proration (→ { switched: true, plan }, then polled).
   * Throws AuthError: 'signin' | 'unconfigured' (503: billing not set up) | 'busy' | 'network' | 'failed'.
   */
  async checkout(plan) {
    if (!PLANS[plan]) throw new AuthError('Choose the Beginner or Advanced plan.', 'invalid');
    if (this.billingBusy) throw new AuthError('Your last payment is still being confirmed. Give it a few seconds.', 'busy');
    const b = await requireUser();
    let data;
    try {
      data = await b.invoke('create-checkout', { plan, returnTo: siteBase() });
    } catch (err) {
      throw friendlyError(err, 'Checkout could not start. Please try again.');
    }
    if (data?.switched) {
      const to = data.plan || plan;
      startUnlock({ expected: to, source: 'switch' });
      return { switched: true, plan: to };
    }
    if (data?.url) {
      setJSON(CHECKOUT_PLAN_KEY, { plan, at: Date.now() });
      if (!data.url.startsWith('mock:')) {
        redirecting = true;
        change('redirect');
      }
      await openUrl(data.url);
      return { redirected: true };
    }
    throw new AuthError(data?.error || 'Checkout could not start. Please try again.', 'failed');
  },

  /** Opens the Stripe customer portal (card, invoices, cancel, switch plan). */
  async openBillingPortal() {
    const b = await requireUser();
    let data;
    try {
      data = await b.invoke('customer-portal', { returnTo: siteBase() });
    } catch (err) {
      throw friendlyError(err, 'The billing page could not open. Please try again.');
    }
    if (!data?.url) throw new AuthError(data?.error || 'The billing page could not open. Please try again.', 'failed');
    if (!data.url.startsWith('mock:')) {
      redirecting = true;
      change('redirect');
    }
    await openUrl(data.url);
    return { redirected: true };
  },

  /**
   * The member's subscription and grants for the account page.
   * → { subscription: row | null, grants: [{ plan, expires_at }] }
   */
  async getBilling() {
    const b = await requireUser();
    try {
      const { subscriptions, grants } = await withTimeout(b.billing(user.id), LEVEL_TIMEOUT_MS);
      const live = subscriptions.find((s) => ['active', 'trialing', 'past_due'].includes(s.status));
      const now = Date.now();
      return { subscription: live || subscriptions[0] || null, grants: grants.filter((g) => !g.expires_at || Date.parse(g.expires_at) > now) };
    } catch (err) {
      throw friendlyError(err);
    }
  },

  /** The progress row (used by js/core/sync.js). */
  progress: {
    async get() {
      const b = await requireUser();
      return b.getProgress(user.id);
    },
    async put(data, expected) {
      const b = await requireUser();
      return b.putProgress(user.id, data, expected);
    },
  },

  /** Downloads a file from the private premium bucket as text (premium-loader.js). */
  async downloadPremium(path) {
    const b = await requireUser();
    return b.download(path);
  },

  // ---- "take me back to what I wanted" after signing in or paying
  setReturnTo(route) {
    const r = String(route || '').replace(/^#/, '');
    if (!r || /^(signin|signup|reset|account|pricing)(\.|$)/.test(r)) return;
    setJSON(RETURN_KEY, { route: r, at: Date.now() });
  },
  peekReturnTo() {
    const r = getJSON(RETURN_KEY);
    return r && Date.now() - (r.at || 0) < RETURN_TTL_MS ? r.route : null;
  },
  takeReturnTo() {
    const r = this.peekReturnTo();
    setItem(RETURN_KEY, null);
    return r;
  },

  /** Mock-mode helpers for the test inbox on the auth pages (null outside mock mode). */
  get mock() {
    if (mode !== 'mock' || !backend) return null;
    return { inbox: (email) => backend.inbox(email) };
  },

  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => this.off(event, fn);
  },
  off(event, fn) {
    listeners.get(event)?.delete(fn);
  },
};

export default auth;
