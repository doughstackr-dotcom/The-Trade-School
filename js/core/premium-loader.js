// Premium module loader (ARCHITECTURE §9.3). With PREMIUM_SOURCE = 'storage', paid lesson and
// game files are not on the public site: they live in the private `premium` Storage bucket as
// <plan>/js/<path> (uploaded by scripts/publish-premium.mjs) and Supabase only serves them to
// members whose access_level() allows it.
//
// loadPremiumModule() downloads a module's source with the member's session, rewrites its
// relative imports (../core/… → absolute site URLs, so the shared kit stays one instance;
// ./sibling.js → that sibling from the bucket, recursively), and imports it from a blob: URL.
// Results are cached for the session; clearPremiumCache() drops them (sign-out, plan change).
//
// rewriteImports() is pure and unit-tested (tests/unit/access.test.mjs).

// import … from '…' · export … from '…' · import '…' · import('…')
const SPECIFIER_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\2/g;
const META_URL_RE = /\bimport\.meta\.url\b/g;

/**
 * Rewrites the import specifiers of one module's source.
 *   moduleUrl: the URL the file would have on the public site (resolves relative specifiers)
 *   isPremium(absUrl) → bool: whether a resolved URL is a premium file (loaded from the bucket)
 *   premiumUrls: Map(absUrl → blob URL) for premium files already loaded
 * Bare specifiers and absolute URLs are left alone; import.meta.url becomes the site URL, so
 * new URL('./x.svg', import.meta.url) still points at the public site.
 * → { code, premiumDeps: [absUrl] }  (premiumDeps: premium files the caller must load first)
 */
export function rewriteImports(source, { moduleUrl, isPremium = () => false, premiumUrls = new Map() } = {}) {
  const premiumDeps = [];
  const code = String(source)
    .replace(SPECIFIER_RE, (all, lead, quote, spec) => {
      if (!/^\.{1,2}\//.test(spec)) return all;              // bare / absolute / data: stay
      const abs = new URL(spec, moduleUrl).href;
      if (isPremium(abs)) {
        if (!premiumDeps.includes(abs)) premiumDeps.push(abs);
        const blob = premiumUrls.get(abs);
        return `${lead}${quote}${blob || abs}${quote}`;
      }
      return `${lead}${quote}${abs}${quote}`;
    })
    .replace(META_URL_RE, JSON.stringify(moduleUrl));
  return { code, premiumDeps };
}

/** Site-relative path of a URL under siteRoot (e.g. 'js/games/fib-sniper.js'), or null. */
export function sitePath(absUrl, siteRoot) {
  const root = siteRoot.endsWith('/') ? siteRoot : `${siteRoot}/`;
  return absUrl.startsWith(root) ? absUrl.slice(root.length).split(/[?#]/)[0] : null;
}

/** Bucket object path for a site path: '<plan>/<site path>'. */
export function bucketPath(plan, path) {
  return `${plan}/${String(path).replace(/^\.?\//, '')}`;
}

const blobUrls = new Map();     // bucket path → Promise<blob URL>
const modules = new Map();      // bucket path → Promise<module>

/** Revokes every blob URL and forgets loaded modules. */
export function clearPremiumCache() {
  for (const p of blobUrls.values()) {
    p.then((u) => {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* ignore */
      }
    }, () => {});
  }
  blobUrls.clear();
  modules.clear();
}

/**
 * Loads a paid module from the premium bucket.
 *   entry: registry entry (its `path`, e.g. './games/fib-sniper.js', is relative to js/)
 *   plan: bucket folder ('beginner' | 'advanced')
 *   download(bucketPath) → Promise<source text> (auth.downloadPremium)
 *   jsRoot: absolute URL of the site's js/ folder; siteRoot: the site root
 * → Promise<module namespace>
 */
export function loadPremiumModule(entry, { plan, download, jsRoot, siteRoot }) {
  const moduleUrl = new URL(entry.path.replace(/^\.\//, ''), jsRoot).href;
  const path = sitePath(moduleUrl, siteRoot);
  if (!path) return Promise.reject(new Error(`Module ${entry.path} is outside the site root.`));
  const key = bucketPath(plan, path);
  if (!modules.has(key)) {
    const p = blobFor(moduleUrl, { plan, download, siteRoot }).then((url) => import(url));
    p.catch(() => modules.delete(key));
    modules.set(key, p);
  }
  return modules.get(key);
}

// A sibling in the same lessons/ or games/ folder is premium (it was uploaded with its module);
// everything else (core, registry, pages, config) is public.
function premiumTest(moduleUrl) {
  const dir = moduleUrl.slice(0, moduleUrl.lastIndexOf('/') + 1);
  return (abs) => abs.startsWith(dir) && /\/js\/(lessons|games)\/[^/]+\.m?js$/.test(abs);
}

function blobFor(moduleUrl, ctx, seen = new Set()) {
  const path = sitePath(moduleUrl, ctx.siteRoot);
  const key = bucketPath(ctx.plan, path);
  if (blobUrls.has(key)) return blobUrls.get(key);
  if (seen.has(key)) return Promise.reject(new Error(`Circular premium import: ${path}`));
  seen.add(key);
  const p = (async () => {
    let source;
    try {
      source = await ctx.download(key);
    } catch (err) {
      // Not in the bucket (e.g. a public sibling): use the site file directly.
      if (seen.size > 1) return moduleUrl;
      throw err;
    }
    const isPremium = premiumTest(moduleUrl);
    const first = rewriteImports(source, { moduleUrl, isPremium });
    const deps = new Map();
    for (const dep of first.premiumDeps) deps.set(dep, await blobFor(dep, ctx, seen));
    const { code } = rewriteImports(source, { moduleUrl, isPremium, premiumUrls: deps });
    const blob = new Blob([`${code}\n//# sourceURL=${moduleUrl}`], { type: 'text/javascript' });
    return URL.createObjectURL(blob);
  })();
  p.catch(() => blobUrls.delete(key));
  blobUrls.set(key, p);
  return p;
}
