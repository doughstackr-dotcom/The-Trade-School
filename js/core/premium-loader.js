// Paid lesson / game modules from the private `premium` Storage bucket (PREMIUM_SOURCE =
// 'storage'; docs/ACCOUNTS.md §10, ARCHITECTURE §9.3).
//
// A storage build (scripts/build.mjs) leaves paid modules out of the public site and turns
// their registry path into 'premium:<object path>' (e.g. 'premium:beginner/lessons/volume.<hash>.js').
// The router hands that object path to loadPremium(), which:
//   1. makes sure the Supabase client is loaded and the visitor is signed in,
//   2. asks Storage for a short-lived signed URL (the bucket's RLS policy checks
//      access_level() — Beginner members may read beginner/…, Advanced members both folders),
//   3. fetches the module text, points its imports at this site ('/js/core/ui.<hash>.js' →
//      '<origin>/js/core/ui.<hash>.js': a module imported from a blob: URL cannot resolve
//      root-relative specifiers) and loads any 'premium:<object path>' dependency the same way,
//   4. imports it from a blob: URL (CSP: script-src 'self' blob:) and revokes the entry's URL.
// Modules are cached for the session; a failure is not cached, so "Try again" re-fetches.
//
// Errors: PremiumAccessError (not signed in, or Storage refused the object — the router then
// refreshes the access level and shows the paywall when the plan no longer covers the route)
// and PremiumLoadError (network / server failure — the router's error card). Neither matches the
// router's stale-chunk check, so a refusal never triggers a reload.
//
// Local testing only (localhost + `?premium=local` in the page URL when this module loads):
// objects are read from /__premium/<object path> instead (tests/smoke.mjs --premium serves
// dist-premium/ there), without Supabase.
import { ensureLoaded, loadedClient } from './access.js';

export const BUCKET = 'premium';
/** Seconds a signed URL stays valid: long enough to start the download, no longer. */
export const SIGNED_URL_TTL = 60;
export const PREMIUM_PREFIX = 'premium:';

// The build's rewritten specifiers (see scripts/build.mjs): root-relative module paths and
// paid → paid 'premium:<object path>' markers, each a complete string literal.
const ABS_SPEC_RE = /(["'`])(\/js\/[A-Za-z0-9_@./-]+\.js)\1/g;
const PREMIUM_SPEC_RE = /(["'`])premium:([A-Za-z0-9_@./-]+\.js)\1/g;
const OBJECT_RE = /^(?:beginner|advanced)\/[A-Za-z0-9_@./-]+\.js$/;

export class PremiumAccessError extends Error {
  /** @param {'signin'|'denied'} code @param {number|null} [status] */
  constructor(message, code, status = null) {
    super(message);
    this.name = 'PremiumAccessError';
    this.code = code;
    this.status = status;
  }
}

export class PremiumLoadError extends Error {
  constructor(message, cause = undefined) {
    super(message);
    this.name = 'PremiumLoadError';
    if (cause) this.cause = cause;
  }
}

function isLocalHost() {
  try {
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
  } catch {
    return false;
  }
}

function localSourceRequested() {
  try {
    return isLocalHost() && new URLSearchParams(location.search).get('premium') === 'local';
  } catch {
    return false;
  }
}

/** Numeric HTTP status of a supabase-js StorageError (status / statusCode), or null. */
function storageStatus(error) {
  const n = Number(error?.status ?? error?.statusCode);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const DENIED = 'Your plan does not include this module.';
const UNREACHABLE = 'Could not download this module. Check your connection and try again.';

/**
 * A loader with injectable dependencies (tests). Defaults are the browser's.
 *   getClient(): Promise<SupabaseClient|null>, fetch, origin, importModule(url),
 *   createObjectURL(blob), revokeObjectURL(url), localBase: URL prefix to read objects from
 *   instead of Storage (local testing), ttl: signed URL lifetime in seconds.
 */
export function createPremiumLoader({
  getClient = async () => {
    await ensureLoaded();
    return loadedClient();
  },
  fetch: fetchFn = (...a) => globalThis.fetch(...a),
  origin = globalThis.location?.origin || '',
  importModule = (url) => import(url),
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url),
  localBase = null,
  ttl = SIGNED_URL_TTL,
} = {}) {
  const modules = new Map(); // object path → Promise<module namespace>
  const depUrls = new Map(); // object path → Promise<blob URL> (dependencies, kept for the session)

  async function signedUrl(objectPath) {
    if (localBase) return `${localBase}${objectPath}`;
    let client;
    try {
      client = await getClient();
    } catch (err) {
      throw new PremiumLoadError(UNREACHABLE, err);
    }
    if (!client?.storage) throw new PremiumLoadError('Member content is not available right now. Please try again later.');
    let session = null;
    try {
      session = (await client.auth.getSession())?.data?.session || null;
    } catch {
      /* treated as signed out */
    }
    if (!session?.user) throw new PremiumAccessError('Sign in to open this module.', 'signin');
    let res;
    try {
      res = await client.storage.from(BUCKET).createSignedUrl(objectPath, ttl);
    } catch (err) {
      throw new PremiumLoadError(UNREACHABLE, err);
    }
    const { data, error } = res || {};
    if (error || !data?.signedUrl) {
      const status = storageStatus(error);
      // 4xx: RLS hides objects the plan does not cover ("Object not found"), or the session expired.
      if (status && status >= 400 && status < 500) throw new PremiumAccessError(DENIED, 'denied', status);
      throw new PremiumLoadError(UNREACHABLE, error);
    }
    return data.signedUrl;
  }

  async function source(objectPath) {
    const url = await signedUrl(objectPath);
    let res;
    try {
      res = await fetchFn(url, { credentials: 'omit', cache: 'no-store' });
    } catch (err) {
      throw new PremiumLoadError(UNREACHABLE, err);
    }
    if (!res.ok) {
      // 4xx: the signed URL was refused or has expired (locally, 401 / 403 stand in for that).
      const refused = res.status === 401 || res.status === 403 || (res.status >= 400 && res.status < 500 && !localBase);
      if (refused) throw new PremiumAccessError(DENIED, 'denied', res.status);
      throw new PremiumLoadError(`${UNREACHABLE} (HTTP ${res.status})`);
    }
    try {
      return await res.text();
    } catch (err) {
      throw new PremiumLoadError(UNREACHABLE, err);
    }
  }

  /** Blob URL of the object's code with its imports resolved; `chain` guards against cycles. */
  async function blobUrl(objectPath, chain) {
    if (!OBJECT_RE.test(objectPath)) throw new PremiumLoadError(`Unknown member module "${objectPath}".`);
    if (chain.includes(objectPath)) throw new PremiumLoadError(`Import cycle between member modules: ${[...chain, objectPath].join(' → ')}`);
    let text = await source(objectPath);
    const deps = [...new Set([...text.matchAll(PREMIUM_SPEC_RE)].map((m) => m[2]))];
    const urls = await Promise.all(deps.map((d) => depUrl(d, [...chain, objectPath])));
    text = text
      .replace(PREMIUM_SPEC_RE, (all, q, dep) => `${q}${urls[deps.indexOf(dep)]}${q}`)
      .replace(ABS_SPEC_RE, (all, q, p) => `${q}${origin}${p}${q}`);
    return createObjectURL(new Blob([text], { type: 'text/javascript' }));
  }

  function depUrl(objectPath, chain) {
    if (!depUrls.has(objectPath)) {
      const p = blobUrl(objectPath, chain);
      depUrls.set(objectPath, p);
      p.catch(() => depUrls.delete(objectPath));
    }
    return depUrls.get(objectPath);
  }

  /** The module namespace of a paid module (cached for the session). */
  function load(objectPath) {
    const key = String(objectPath || '').replace(PREMIUM_PREFIX, '');
    if (!modules.has(key)) {
      const p = (async () => {
        const url = await blobUrl(key, []);
        try {
          return await importModule(url);
        } finally {
          revokeObjectURL(url);
        }
      })();
      modules.set(key, p);
      p.catch(() => modules.delete(key));
    }
    return modules.get(key);
  }

  return { load };
}

let loader = null;

/**
 * Loads a paid module by its bucket object path ('beginner/lessons/volume.<hash>.js', with or
 * without the 'premium:' prefix). Rejects with PremiumAccessError / PremiumLoadError.
 */
export function loadPremium(objectPath) {
  if (!loader) loader = createPremiumLoader(localSourceRequested() ? { localBase: '/__premium/' } : {});
  return loader.load(objectPath);
}

// Decided when the module loads (the smoke test opens each route with ?premium=local).
if (localSourceRequested()) loader = createPremiumLoader({ localBase: '/__premium/' });
