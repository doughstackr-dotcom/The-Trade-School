import { PREMIUM_SOURCE, SUPABASE_URL, SUPABASE_KEY } from '../config.js';
import { getClient, requiredPlan } from './access.js';

const moduleCache = new Map();
const objectUrls = new Set();
let cacheEpoch = 0;

const PUBLIC_JS_BASE = new URL('../', import.meta.url).href;

function cleanPath(path) {
  return String(path || '').replace(/^\.\//, '').replace(/^js\//, '');
}

export function premiumStoragePath(entry) {
  const rel = cleanPath(entry?.path);
  if (!entry || !rel || rel.startsWith('../') || rel.includes('/../')) return null;
  const plan = requiredPlan(entry);
  if (plan !== 'beginner' && plan !== 'advanced') return null;
  return `${plan}/${rel}`;
}

export function shouldLoadFromPremiumStorage(entry, access, source = PREMIUM_SOURCE) {
  if (source !== 'storage' && source !== 'edge') return false;
  if (!access?.enforcing) return false;
  return Boolean(premiumStoragePath(entry));
}

function publicUrlFor(specifier, sourcePath) {
  const sourceDir = sourcePath.replace(/[^/]*$/, '');
  return new URL(specifier, `${PUBLIC_JS_BASE}${sourceDir}`).href;
}

function sameFolderStoragePath(specifier, sourceStoragePath) {
  if (!specifier.startsWith('./')) return null;
  const dir = sourceStoragePath.replace(/[^/]*$/, '');
  const next = `${dir}${specifier.slice(2)}`;
  if (next.includes('/../') || next.includes('/./')) return null;
  return next;
}

function createObjectModuleUrl(source) {
  const blob = new Blob([source], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

function entitlementKey(access) {
  const userId = access?.user?.id;
  const level = access?.level || 'free';
  return userId ? `${userId}:${level}` : null;
}

function cacheKey(scope, storagePath) {
  return `${scope}:${storagePath}`;
}

function storageError(message) {
  const err = new Error(message);
  err.name = 'PremiumModuleError';
  return err;
}

async function downloadPremiumSource(client, storagePath) {
  const { data, error } = await client.storage.from('premium').download(storagePath);
  if (error) throw storageError(error.message || `Could not download ${storagePath}`);
  if (!data) throw storageError(`Missing premium module ${storagePath}`);
  return await data.text();
}

async function downloadPremiumSourceFromEdge(client, storagePath) {
  const url = edgeUrlFor(storagePath);
  if (!url) throw storageError('Premium module edge endpoint is unavailable.');
  const { data } = await client.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw storageError('Sign in to open this premium module.');
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      apikey: SUPABASE_KEY,
      accept: 'text/javascript',
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    let code = '';
    try { code = (await res.json())?.error || ''; } catch { /* text or empty */ }
    throw storageError(code || `Could not download ${storagePath}`);
  }
  return await res.text();
}

function edgeUrlFor(storagePath) {
  if (!SUPABASE_URL) return null;
  const url = new URL('/functions/v1/premium-content', SUPABASE_URL);
  url.searchParams.set('path', storagePath);
  return url.href;
}

async function rewriteImports(source, storagePath, sourcePath, client, scope, epoch, stack, transport = 'storage') {
  const imports = [];
  const re = /\b(from\s*['"]|import\s*['"]|import\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\)?)/g;
  let match;
  while ((match = re.exec(source))) {
    imports.push({
      start: match.index,
      end: re.lastIndex,
      before: match[1],
      specifier: match[2],
      after: match[3],
    });
  }
  if (!imports.length) return source;

  let out = '';
  let pos = 0;
  for (const item of imports) {
    let nextUrl;
    const privatePath = sameFolderStoragePath(item.specifier, storagePath);
    if (privatePath) {
      nextUrl = await loadStorageModule(client, privatePath, cleanPath(privatePath.replace(/^[^/]+\//, '')), scope, epoch, stack, transport);
    } else {
      nextUrl = publicUrlFor(item.specifier, sourcePath);
    }
    out += source.slice(pos, item.start);
    out += `${item.before}${nextUrl}${item.after}`;
    pos = item.end;
  }
  out += source.slice(pos);
  return out;
}

function assertFresh(epoch) {
  if (epoch !== cacheEpoch) throw storageError('Premium module access changed. Reload this module.');
}

async function loadStorageModule(client, storagePath, sourcePath, scope = 'test', epoch = cacheEpoch, stack = [], transport = 'storage') {
  assertFresh(epoch);
  const key = cacheKey(scope, storagePath);
  if (stack.includes(storagePath)) {
    throw storageError(`Circular premium module import: ${[...stack, storagePath].join(' -> ')}`);
  }
  if (moduleCache.has(key)) return moduleCache.get(key);
  const pending = (async () => {
    const source = transport === 'edge'
      ? await downloadPremiumSourceFromEdge(client, storagePath)
      : await downloadPremiumSource(client, storagePath);
    assertFresh(epoch);
    const rewritten = await rewriteImports(source, storagePath, sourcePath, client, scope, epoch, [...stack, storagePath], transport);
    assertFresh(epoch);
    const url = createObjectModuleUrl(rewritten);
    if (epoch !== cacheEpoch) {
      URL.revokeObjectURL(url);
      objectUrls.delete(url);
      throw storageError('Premium module access changed. Reload this module.');
    }
    return url;
  })();
  moduleCache.set(key, pending);
  try {
    return await pending;
  } catch (err) {
    if (moduleCache.get(key) === pending) moduleCache.delete(key);
    throw err;
  }
}

async function resolvePremiumModuleUrlWithSource(entry, access, source, options = {}) {
  if (!shouldLoadFromPremiumStorage(entry, access, source)) return null;
  if (!access?.user) throw storageError('Sign in to open this premium module.');
  const storagePath = premiumStoragePath(entry);
  const scope = entitlementKey(access);
  if (!scope) throw storageError('Sign in to open this premium module.');
  if (options.bust) clearPremiumModuleCache();
  const client = options.client || await getClient();
  if (!client) throw storageError('Premium module storage is unavailable.');
  const epoch = cacheEpoch;
  return await loadStorageModule(client, storagePath, cleanPath(entry.path), scope, epoch, [], source);
}

export async function resolvePremiumModuleUrl(entry, access, options = {}) {
  return resolvePremiumModuleUrlWithSource(entry, access, PREMIUM_SOURCE, options);
}

export function clearPremiumModuleCache() {
  cacheEpoch += 1;
  moduleCache.clear();
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
}

export const testInternals = {
  moduleCache,
  objectUrls,
  cleanPath,
  premiumStoragePath,
  publicUrlFor,
  sameFolderStoragePath,
  entitlementKey,
  cacheKey,
  get cacheEpoch() { return cacheEpoch; },
  loadStorageModule,
  downloadPremiumSourceFromEdge,
  resolvePremiumModuleUrlWithSource,
  rewriteImports,
};
