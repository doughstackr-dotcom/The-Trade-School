/* The Trade School — service worker (ARCHITECTURE §10).
 *
 * - Versioned cache: `tts-<VERSION>-<BUILD>`. The deploy workflow stamps BUILD with the commit, so
 *   every deploy installs a new worker, which waits until the page asks it to take over (the
 *   "Update available — Reload" toast in js/pwa.js). Old caches are deleted on activate.
 * - Precache: the app shell (index.html, css, js/main.js, js/core, js/pages, registry, config,
 *   icons, manifest) plus every same-origin stylesheet / script that index.html links. Only the
 *   core of the shell must succeed; the rest is best effort, so a missing optional file never
 *   blocks the install.
 * - Navigations: network first (fresh HTML after every deploy), falling back to the cached
 *   index.html when offline or when the network takes too long.
 * - Same-origin static assets: cache first + stale-while-revalidate (served from the cache, then
 *   refreshed in the background for the next visit).
 * - Never cached: cross-origin requests (Supabase, Stripe, market data; Google Fonts use the
 *   browser cache), anything under a premium/ path, blob:/data: URLs, non-GET requests, range
 *   requests and URLs with a query string (e.g. the router's ?retry=… re-imports).
 */

const VERSION = 'v1';
const BUILD = 'dev'; // replaced with the commit SHA by .github/workflows/pages.yml
const PREFIX = 'tts-';
const CACHE = `${PREFIX}${VERSION}-${BUILD}`;
const NAV_TIMEOUT_MS = 6000;

// The shell must precache or the install fails (and the old worker keeps serving).
const CORE = [
  './',
  'css/tokens.css',
  'css/base.css',
  'css/components.css',
  'css/chart.css',
  'js/main.js',
  'js/pwa.js',
  'js/registry.js',
  'js/core/router.js',
  'js/core/store.js',
  'js/core/ui.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
];

// Best effort: fetched on install, skipped quietly when missing. The module graph of js/main.js
// is walked on install as well (see precacheModuleGraph), so this list mainly covers the pages the
// router imports by computed URL. Lessons and games are cached the first time they are opened
// (runtime cache), never precached.
const OPTIONAL = [
  'js/config.js',
  'js/core/anim.js',
  'js/core/chart.js',
  'js/core/data.js',
  'js/core/game-kit.js',
  'js/core/indicators.js',
  'js/core/lesson-kit.js',
  'js/core/market.js',
  'js/core/patterns.js',
  'js/core/rng.js',
  'js/core/scanner.js',
  'js/core/story.js',
  'js/core/access.js',
  'js/pages/home.js',
  'js/pages/library.js',
  'js/pages/progress.js',
  'js/pages/glossary.js',
  'js/pages/playbook.js',
  'js/pages/live.js',
  'js/pages/account.js',
  'js/pages/paywall.js',
  'js/pages/dashboard.js',
  'js/pages/games.js',
  'js/pages/affiliate.js',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon-180.png',
  'icons/favicon-32.png',
];

const STATIC_EXT = /\.(?:js|mjs|css|json|webmanifest|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|otf|txt)$/i;
const PREMIUM = /(?:^|\/)premium\//i;

const scopeUrl = () => new URL('./', self.registration ? self.registration.scope : self.location.href);
const shellKey = () => scopeUrl().href;

function freshRequest(path) {
  return new Request(new URL(path, scopeUrl()).href, { cache: 'reload', credentials: 'same-origin' });
}

/** A redirected response cannot answer a navigation in some browsers: copy it into a clean one. */
async function clean(res) {
  if (!res || !res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** Same-origin stylesheets and scripts linked from index.html (e.g. a css file added later). */
function linkedAssets(html) {
  const out = new Set();
  const re = /\s(?:href|src)=["']([^"':?#]+\.(?:css|js))["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const p = m[1].replace(/^\.\//, '');
    if (!p.startsWith('/') && !PREMIUM.test(p)) out.add(p);
  }
  return [...out];
}

/** Relative module specifiers of static imports, re-exports and literal dynamic imports. */
function moduleImports(code) {
  const out = new Set();
  const patterns = [
    /(?:^|[\s;}])(?:import|export)\s[^'"`;]*?\sfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g,
    /(?:^|[\s;}])import\s*['"](\.{1,2}\/[^'"]+)['"]/g,
    /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(code))) out.add(m[1]);
  }
  return [...out];
}

async function precacheOne(cache, url) {
  const res = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
  if (!res.ok || res.type !== 'basic') throw new Error(`${res.status} ${url}`);
  await cache.put(url, res.clone());
  return res;
}

/**
 * Walks the static module graph from the entry scripts (breadth first, same origin, never
 * premium/), caching every module on the way — so whatever js/main.js imports today is in the
 * shell without keeping a list in sync. Best effort: a module that fails is skipped.
 */
async function precacheModuleGraph(cache, entries, done) {
  let level = entries.map((p) => new URL(p, scopeUrl()).href);
  for (let depth = 0; depth < 8 && level.length; depth++) {
    const next = [];
    await Promise.all(level.map(async (url) => {
      if (done.has(url)) return;
      done.add(url);
      try {
        const res = await precacheOne(cache, url);
        for (const spec of moduleImports(await res.text())) {
          const child = new URL(spec, url);
          if (child.origin === self.location.origin && !PREMIUM.test(child.pathname) && /\.m?js$/.test(child.pathname)) next.push(child.href);
        }
      } catch {
        /* skip */
      }
    }));
    level = next;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // The shell document first (clean copy), then the rest of the core atomically.
    const shell = await clean(await fetch(freshRequest('./')));
    if (!shell.ok) throw new Error(`shell ${shell.status}`);
    const html = await shell.clone().text();
    await cache.put(shellKey(), shell);
    await cache.addAll(CORE.filter((p) => p !== './').map(freshRequest));
    // Everything the entry scripts import, then the optional list and index.html's other links.
    const done = new Set(CORE.map((p) => new URL(p, scopeUrl()).href));
    done.delete(new URL('js/main.js', scopeUrl()).href);
    done.delete(new URL('js/pwa.js', scopeUrl()).href);
    await precacheModuleGraph(cache, ['js/main.js', 'js/pwa.js'], done);
    const extra = [...new Set([...OPTIONAL, ...linkedAssets(html)])]
      .map((p) => new URL(p, scopeUrl()).href)
      .filter((u) => !done.has(u));
    await Promise.all(extra.map((u) => precacheOne(cache, u).catch(() => {})));
    // No skipWaiting() here: an update waits until the page asks (js/pwa.js update toast).
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try {
        await self.registration.navigationPreload.enable();
      } catch {
        /* unsupported */
      }
    }
    await self.clients.claim();
  })());
});

// Set by the page's ?sw=0 switch: stop touching the caches while this worker still controls pages.
let disabled = false;

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  else if (data.type === 'DISABLE') {
    disabled = true;
    const sweep = () => caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX)).map((k) => caches.delete(k))));
    // Sweep again once in-flight fetches have settled.
    event.waitUntil(sweep().then(() => new Promise((r) => setTimeout(r, 1500))).then(sweep));
  }
  else if (data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION, build: BUILD, cache: CACHE });
  }
});

function cacheable(url, request) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false; // blob:, data:, chrome-extension:
  if (url.origin !== self.location.origin) return false; // Supabase, Stripe, market data, fonts
  if (PREMIUM.test(url.pathname)) return false;
  if (request.headers.has('range')) return false;
  if (url.pathname.endsWith('/sw.js')) return false;
  return true;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (disabled || request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (!cacheable(url, request)) return; // not handled: the browser does its normal fetch

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(event, url));
    return;
  }
  if (url.search || !STATIC_EXT.test(url.pathname)) return;
  event.respondWith(staleWhileRevalidate(event));
});

function isShellPath(url) {
  const scope = scopeUrl().pathname;
  return url.pathname === scope || url.pathname === `${scope}index.html`;
}

/** Reads never create a cache (caches.match with cacheName), so a cleared cache stays cleared. */
function readCache(request) {
  return caches.match(request, { cacheName: CACHE, ignoreVary: true });
}

async function writeCache(request, response) {
  if (disabled || !(await caches.has(CACHE))) return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response);
}

async function networkFirst(event, url) {
  const cached = await readCache(shellKey());
  const network = (async () => {
    const preload = await event.preloadResponse;
    const res = preload || await fetch(event.request);
    if (res && res.ok && res.type === 'basic' && isShellPath(url)) {
      const copy = await clean(res.clone());
      event.waitUntil(writeCache(shellKey(), copy).catch(() => {}));
    }
    return res;
  })();
  if (!cached) {
    // Nothing to fall back to yet: plain network.
    return network;
  }
  // Keep the network promise from ever rejecting unhandled once we stop waiting on it.
  network.catch(() => {});
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), NAV_TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([network, timeout]);
    if (res && (res.ok || res.status < 500 || !isShellPath(url))) return res;
  } catch {
    /* offline */
  } finally {
    clearTimeout(timer);
  }
  return cached;
}

async function staleWhileRevalidate(event) {
  const request = event.request;
  const cached = await readCache(request);
  const update = fetch(request).then(async (res) => {
    if (res && res.ok && res.type === 'basic') await writeCache(request, res.clone()).catch(() => {});
    return res;
  });
  if (cached) {
    event.waitUntil(update.catch(() => {}));
    return cached;
  }
  return update; // a network failure rejects, exactly as it would without a service worker
}
