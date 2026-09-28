// Access control (ARCHITECTURE §9): Supabase session + access_level, FREE_IDS, plan unlocks.
// Client-side gating is UX; PREMIUM_SOURCE='storage' is the real content lock (see docs/SECRETS.md).
import {
  SUPABASE_URL, SUPABASE_KEY, PLANS, FREE_IDS, ACCESS_MODE, PREMIUM_SOURCE,
} from '../config.js';

const VENDOR_SRC = new URL('../vendor/supabase.js', import.meta.url).href;
const LEVELS = ['free', 'beginner', 'advanced'];
const listeners = new Set();

let client = null;
let vendorP = null;
let session = null;
let level = null; // null = signed out; 'free' | 'beginner' | 'advanced'
let mode = 'offline'; // 'supabase' | 'offline'

function isLocalHost() {
  try {
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
  } catch {
    return false;
  }
}

function forceEnforceLocally() {
  try {
    return globalThis.localStorage?.getItem('tts-enforce-access') === '1';
  } catch {
    return false;
  }
}

/** Whether the gate should block unpaid modules right now. */
export function isEnforcing() {
  if (ACCESS_MODE === 'open') return false;
  if (ACCESS_MODE === 'enforce') return true;
  // auto
  if (isLocalHost() && !forceEnforceLocally()) return false;
  return true;
}

function emit() {
  const snap = snapshot();
  for (const fn of [...listeners]) {
    try { fn(snap); } catch (err) { console.error(err); }
  }
}

function snapshot() {
  return {
    level,
    session,
    mode,
    user: session?.user ? { id: session.user.id, email: session.user.email || null } : null,
    enforcing: isEnforcing(),
    premiumSource: PREMIUM_SOURCE,
  };
}

function loadVendor() {
  if (globalThis.supabase?.createClient) return Promise.resolve(globalThis.supabase);
  if (vendorP) return vendorP;
  vendorP = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-tts-supabase]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(globalThis.supabase));
      existing.addEventListener('error', () => reject(new Error('Failed to load supabase vendor')));
      if (globalThis.supabase?.createClient) resolve(globalThis.supabase);
      return;
    }
    const s = document.createElement('script');
    s.src = VENDOR_SRC;
    s.async = true;
    s.dataset.ttsSupabase = '1';
    s.onload = () => {
      if (globalThis.supabase?.createClient) resolve(globalThis.supabase);
      else reject(new Error('supabase vendor loaded without createClient'));
    };
    s.onerror = () => reject(new Error('Failed to load supabase vendor'));
    document.head.appendChild(s);
  }).catch((err) => {
    console.warn('[access] vendor unavailable:', err?.message || err);
    vendorP = null;
    return null;
  });
  return vendorP;
}

async function getClient() {
  if (client) return client;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    mode = 'offline';
    return null;
  }
  const sb = await loadVendor();
  if (!sb?.createClient) {
    mode = 'offline';
    return null;
  }
  try {
    client = sb.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    mode = 'supabase';
    return client;
  } catch (err) {
    console.warn('[access] createClient failed:', err?.message || err);
    mode = 'offline';
    return null;
  }
}

async function fetchAccessLevel(c) {
  if (!c) return null;
  try {
    const { data, error } = await c.rpc('access_level');
    if (error) throw error;
    const v = typeof data === 'string' ? data : data?.access_level || data;
    if (LEVELS.includes(v)) return v;
  } catch (err) {
    console.warn('[access] access_level RPC failed:', err?.message || err);
  }
  // Fallback: subscriptions table (active / trialing / past_due)
  try {
    const uid = session?.user?.id;
    if (!uid) return 'free';
    const { data, error } = await c.from('subscriptions')
      .select('plan, status')
      .eq('user_id', uid)
      .in('status', ['active', 'trialing', 'past_due'])
      .order('updated_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const plan = data?.[0]?.plan;
    if (plan === 'advanced' || plan === 'beginner') return plan;
    return 'free';
  } catch (err) {
    console.warn('[access] subscriptions fallback failed:', err?.message || err);
    return session?.user ? 'free' : null;
  }
}

async function refresh() {
  const c = await getClient();
  if (!c) {
    session = null;
    level = null;
    emit();
    return snapshot();
  }
  try {
    const { data } = await c.auth.getSession();
    session = data?.session || null;
  } catch {
    session = null;
  }
  if (session?.user) level = await fetchAccessLevel(c) || 'free';
  else level = null;
  emit();
  return snapshot();
}

/** Resolves once the first session/access check finishes. */
export const ready = ((async () => {
  await refresh();
  const c = client;
  if (c?.auth?.onAuthStateChange) {
    c.auth.onAuthStateChange(async (_event, next) => {
      session = next || null;
      if (session?.user) level = await fetchAccessLevel(c) || 'free';
      else level = null;
      emit();
    });
  }
  return snapshot();
})());

export function getAccess() {
  return snapshot();
}

export function onChange(fn) {
  if (typeof fn === 'function') listeners.add(fn);
  return () => listeners.delete(fn);
}

export function can(plan) {
  if (!plan || plan === 'free') return true;
  if (!isEnforcing()) return true;
  if (!level) return false;
  if (level === 'advanced') return true;
  if (level === 'beginner') return plan === 'beginner' || plan === 'free';
  return false;
}

/**
 * Plan required for a registry entry (lesson/game) or a mode string.
 * Free ids and unsigned public pages → 'free'.
 * Beginner-tier modules → 'beginner'; advanced / both-tier paid → 'advanced'.
 */
export function requiredPlan(entryOrMode) {
  if (!entryOrMode) return 'free';
  if (typeof entryOrMode === 'string') {
    if (entryOrMode === 'advanced') return 'advanced';
    if (entryOrMode === 'beginner') return 'beginner';
    return 'free';
  }
  const id = entryOrMode.id;
  if (id && FREE_IDS.includes(id)) return 'free';
  const tier = entryOrMode.tier;
  if (tier === 'advanced') return 'advanced';
  if (tier === 'beginner') return 'beginner';
  if (tier === 'both') return 'beginner'; // shared games need at least Beginner when gated
  return 'free';
}

/** Pages anyone may open without a session (home, dashboard, tools, auth).
 *  library / glossary / playbook stay routable so unpaid & anonymous visitors see
 *  in-page teasers; full interaction requires hasPaidAccess() (see pages).
 *  Platforms stays fully public with no teaser lock.
 */
export const PUBLIC_PAGES = Object.freeze([
  'home', 'account', 'paywall',
  'dashboard', 'progress', // #progress aliases to dashboard
  'library', 'glossary', 'playbook', 'live', 'platforms', 'affiliate', // #affiliate → platforms
  'dev-chart',
]);

/** Tool pages that mount for everyone but self-gate full content behind a paid plan. */
export const TEASER_PAGES = Object.freeze(['library', 'glossary', 'playbook']);

/**
 * True when the user may use paid tool pages (Library, Playbook, Glossary) and
 * paid curriculum beyond FREE_IDS. When not enforcing (local open mode), always true.
 * Requires a signed-in Beginner or Advanced subscription while enforcing.
 */
export function hasPaidAccess() {
  if (!isEnforcing()) return true;
  return can('beginner');
}

const RETURN_KEY = 'tts-return-hash';

/** Remember where an unsigned visitor was headed before sign-up / sign-in. */
export function rememberReturn(hash) {
  const token = String(hash || '').replace(/^#/, '').trim();
  if (!token) return;
  // Never bounce back into auth / marketing surfaces.
  if (token === 'home' || token === 'account' || token.startsWith('account.')
      || token === 'paywall') return;
  try { globalThis.sessionStorage?.setItem(RETURN_KEY, token); } catch { /* private mode */ }
}

/** Read and clear the stored return hash (or null). */
export function consumeReturn() {
  try {
    const v = globalThis.sessionStorage?.getItem(RETURN_KEY);
    globalThis.sessionStorage?.removeItem(RETURN_KEY);
    return v || null;
  } catch {
    return null;
  }
}

export function peekReturn() {
  try { return globalThis.sessionStorage?.getItem(RETURN_KEY) || null; } catch { return null; }
}

/**
 * True for Beginner / Advanced lessons/games (tier beginner|advanced|both).
 * Only these are auth-gated; Home, Dashboard, Library, Playbook, Live, Glossary, Platforms stay public.
 */
export function isCurriculumGated(entry, route = null) {
  // Standalone track pages are gone; #beginner / #advanced land on public Dashboard.
  const kind = route?.kind || entry?.type;
  if (kind === 'lesson' || kind === 'game') {
    const tier = entry?.tier;
    if (tier === 'beginner' || tier === 'advanced' || tier === 'both') return true;
    // Unknown lesson/game id — keep gated rather than leaking paid modules.
    if (!entry) return true;
  }
  return false;
}

/**
 * True when the current user may open this route.
 * When ACCESS_MODE enforces: Home / Dashboard / Library / Playbook / Live / Glossary / Platforms stay
 * open; Beginner + Advanced lessons/games need a signed-in session.
 * Signed-in free members still need the right plan for paid modules (FREE_IDS stay free).
 */
export function canOpen(entry, route = null) {
  if (!isEnforcing()) return true;
  const page = route?.page || (entry?.type === 'page' ? entry.id : null);
  if (page && PUBLIC_PAGES.includes(page)) return true;

  // Do not newly lock non-curriculum pages (Playbook, Live, Library, Glossary, …).
  if (!isCurriculumGated(entry, route)) return true;

  // Beginner / Advanced lessons and games: need a session first.
  if (!session?.user) return false;

  const need = requiredPlan(entry);
  if (need === 'free') return true;
  return can(need);
}

export function lockLabel(entry) {
  const need = requiredPlan(entry);
  if (need === 'free') return null;
  const plan = PLANS[need];
  return plan ? `${plan.name} plan` : 'Paid plan';
}

/** ctx.access shape expected by the router and modules. */
export function accessInfo() {
  return {
    level,
    can,
    requiredPlan,
    lockLabel,
    user: session?.user ? { id: session.user.id, email: session.user.email || null } : null,
    mode,
    enforcing: isEnforcing(),
    refresh,
  };
}

export async function signIn({ email, password }) {
  const c = await getClient();
  if (!c) return { ok: false, error: 'Subscriptions not open yet' };
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  await refresh();
  return { ok: true };
}

export async function signUp({ email, password, displayName }) {
  const c = await getClient();
  if (!c) return { ok: false, error: 'Subscriptions not open yet' };
  const { data, error } = await c.auth.signUp({
    email,
    password,
    options: { data: displayName ? { display_name: displayName } : undefined },
  });
  if (error) return { ok: false, error: error.message };
  await refresh();
  return { ok: true, needsConfirmation: !data?.session };
}

export async function signOut() {
  const c = await getClient();
  if (c) {
    try { await c.auth.signOut(); } catch { /* ignore */ }
  }
  session = null;
  level = null;
  emit();
}

/** Starts Stripe Checkout via Edge Function. Returns { ok, error } or redirects. */
export async function checkout(plan) {
  const c = await getClient();
  if (!c || !session) return { ok: false, error: 'Sign in to subscribe' };
  if (!PLANS[plan]) return { ok: false, error: 'Unknown plan' };
  try {
    const { data, error } = await c.functions.invoke('create-checkout', { body: { plan } });
    if (error) throw error;
    if (data?.url) {
      location.href = data.url;
      return { ok: true };
    }
    if (data?.switched) {
      await refresh();
      return { ok: true, switched: true };
    }
    return { ok: false, error: data?.error || 'Subscriptions not open yet' };
  } catch (err) {
    const msg = err?.message || String(err);
    if (/not open|not configured|Failed to send|FunctionsFetchError|FunctionsHttpError/i.test(msg)) {
      return { ok: false, error: 'Subscriptions not open yet' };
    }
    return { ok: false, error: msg };
  }
}

/** Opens the Stripe customer portal. */
export async function openBillingPortal() {
  const c = await getClient();
  if (!c || !session) return { ok: false, error: 'Sign in to manage billing' };
  try {
    const { data, error } = await c.functions.invoke('customer-portal', { body: {} });
    if (error) throw error;
    if (data?.url) {
      location.href = data.url;
      return { ok: true };
    }
    return { ok: false, error: data?.error || 'Subscriptions not open yet' };
  } catch (err) {
    const msg = err?.message || String(err);
    if (/not open|not configured|Failed to send|FunctionsFetchError|FunctionsHttpError/i.test(msg)) {
      return { ok: false, error: 'Subscriptions not open yet' };
    }
    return { ok: false, error: msg };
  }
}

export { FREE_IDS, PLANS, ACCESS_MODE, PREMIUM_SOURCE };

export default {
  ready, getAccess, onChange, can, canOpen, requiredPlan, lockLabel, accessInfo,
  signIn, signUp, signOut, checkout, openBillingPortal, refresh, isEnforcing, PUBLIC_PAGES,
  TEASER_PAGES, hasPaidAccess,
  rememberReturn, consumeReturn, peekReturn, isCurriculumGated,
};
