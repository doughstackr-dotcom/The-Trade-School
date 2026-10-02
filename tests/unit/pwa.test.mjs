// Installable app (ARCHITECTURE §10): manifest, icons, index.html head, the service worker's
// caching policy (run in a vm with stubbed worker globals) and the Pages deploy workflow.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

/** Width × height from a PNG's IHDR chunk. */
function pngSize(p) {
  const b = fs.readFileSync(path.join(ROOT, p));
  assert.equal(b.toString('ascii', 1, 4), 'PNG', `${p} is not a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('manifest: valid, relative to the site, installable icons (any + maskable) that exist at their sizes', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'The Trade School');
  assert.ok(m.short_name && m.short_name.length <= 12, 'short_name fits under a home-screen icon');
  assert.equal(m.display, 'standalone');
  for (const k of ['start_url', 'scope', 'id']) assert.ok(m[k].startsWith('./'), `${k} must be relative (GitHub Pages sub-path)`);
  assert.match(m.background_color, /^#[0-9A-F]{6}$/i);
  assert.match(m.theme_color, /^#[0-9A-F]{6}$/i);
  const pngs = m.icons.filter((i) => i.type === 'image/png');
  for (const i of pngs) {
    assert.ok(exists(i.src), `missing ${i.src}`);
    const [w, h] = pngSize(i.src);
    assert.equal(`${w}x${h}`, i.sizes, `${i.src} size`);
  }
  assert.ok(pngs.some((i) => i.sizes === '192x192' && i.purpose === 'any'), '192 any');
  assert.ok(pngs.some((i) => i.sizes === '512x512' && i.purpose === 'any'), '512 any');
  assert.ok(pngs.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'), '512 maskable');
  assert.ok(m.icons.some((i) => i.type === 'image/svg+xml' && exists(i.src)), 'svg icon');
  for (const s of m.shortcuts || []) assert.match(s.url, /^\.\/#[a-z.-]+$/, `shortcut ${s.name}`);
  assert.deepEqual(pngSize('icons/apple-touch-icon-180.png'), [180, 180]);
  assert.deepEqual(pngSize('icons/favicon-32.png'), [32, 32]);
});

test('index.html: manifest, icons, theme colours for light and dark, home-screen metas, boot loader', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /rel="apple-touch-icon" href="icons\/apple-touch-icon-180\.png"/);
  assert.match(html, /<link rel="icon" href="[^"]+"/, 'a favicon (the site uses an inline SVG data URI)');
  assert.match(html, /name="theme-color" content="#F3F5F9" media="\(prefers-color-scheme: light\)"/);
  assert.match(html, /name="theme-color" content="#0B1220" media="\(prefers-color-scheme: dark\)"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /name="apple-mobile-web-app-status-bar-style"/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /<script type="module" src="js\/boot\.js"><\/script>/);
  assert.equal(html.includes('src="js/main.js"'), false, 'main.js is imported by boot.js after stale-worker cleanup');
  assert.equal(html.includes('src="js/pwa.js"'), false, 'pwa.js is imported by boot.js after stale-worker cleanup');
});

test('boot.js: clears an unwanted existing worker before importing the app', () => {
  const boot = read('js/boot.js');
  const cleanup = read('js/sw-cleanup.js');
  assert.match(boot, /clearStaleWorkerForFreshBoot/);
  assert.match(boot, /new URL\(import\.meta\.url\)\.search/);
  assert.match(boot, /await import\(`\.\/main\.js\$\{moduleVersion\}`\)/);
  assert.match(boot, /await import\(`\.\/pwa\.js\$\{moduleVersion\}`\)/);
  assert.match(cleanup, /export const CLEARED_PARAM = 'tts-sw-cleared';/);
  assert.match(cleanup, /navigator\.serviceWorker\.controller/);
  assert.match(cleanup, /w\?\.postMessage\(\{ type: 'DISABLE' \}\)/);
  assert.match(cleanup, /k\.startsWith\('tts-'\)/);
  assert.match(cleanup, /location\.replace\(href\)/);
  assert.match(cleanup, /flag === '1'/, 'explicit ?sw=1 keeps offline mode');
  assert.match(cleanup, /saved === '1'/, 'saved offline preference keeps offline mode');
});

/** Loads sw.js in a vm with stubbed service-worker globals; returns its listeners. */
function loadWorker(scope = 'https://example.github.io/The-Trade-School/', transform = (src) => src, overrides = {}) {
  const listeners = {};
  const clients = overrides.clients || { claim: async () => {} };
  const self = {
    location: new URL('sw.js', scope),
    registration: { scope, navigationPreload: null },
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    skipWaiting: () => {},
    clients,
  };
  const caches = overrides.caches || { has: async () => false, match: async () => undefined, keys: async () => [], open: async () => ({ put: async () => {} }), delete: async () => true };
  const fetch = async () => {
    throw new TypeError('offline (test)');
  };
  const ctx = vm.createContext({ self, caches, fetch, URL, Request: class { constructor(u, o) { this.url = u; Object.assign(this, o); } }, Response: class {}, Promise, setTimeout, clearTimeout, Set, console });
  vm.runInContext(transform(read('sw.js')), ctx, { filename: 'sw.js' });
  return { listeners, ctx };
}

async function runExtendable(listener, event = {}) {
  const waits = [];
  listener({
    ...event,
    waitUntil(p) { waits.push(Promise.resolve(p)); },
  });
  await Promise.all(waits);
}

function fetchEvent(url, { mode = 'no-cors', method = 'GET', headers = {} } = {}) {
  const h = new Map(Object.entries(headers));
  const ev = {
    request: { url, mode, method, headers: { has: (k) => h.has(k.toLowerCase()) } },
    handled: false,
    respondWith(p) {
      this.handled = true;
      Promise.resolve(p).catch(() => {}); // the stubbed network is offline
    },
    waitUntil() {},
  };
  return ev;
}

test('sw.js: handles same-origin navigations and static assets; never cross-origin, premium/, blob:, POST, ranges or ?queries', () => {
  const base = 'https://example.github.io/The-Trade-School/';
  const { listeners } = loadWorker(base);
  for (const t of ['install', 'activate', 'fetch', 'message']) assert.equal(typeof listeners[t], 'function', `${t} listener`);
  const handled = (url, opts) => {
    const ev = fetchEvent(url, opts);
    listeners.fetch(ev);
    return ev.handled;
  };
  // handled
  assert.equal(handled(`${base}`, { mode: 'navigate' }), true, 'navigation');
  assert.equal(handled(`${base}?checkout=success`, { mode: 'navigate' }), true, 'navigation with a query (Stripe return)');
  assert.equal(handled(`${base}js/core/chart.js`), true, 'module');
  assert.equal(handled(`${base}css/components.css`), true, 'css');
  assert.equal(handled(`${base}icons/icon-192.png`), true, 'icon');
  assert.equal(handled(`${base}js/lessons/fibonacci.js`), true, 'lesson (runtime cache)');
  // never handled
  assert.equal(handled('https://pedcpgmowqhqgersxxqa.supabase.co/rest/v1/progress'), false, 'Supabase');
  assert.equal(handled('https://pedcpgmowqhqgersxxqa.supabase.co/storage/v1/object/premium/beginner/x.js'), false, 'premium storage');
  assert.equal(handled('https://checkout.stripe.com/c/pay/x', { mode: 'navigate' }), false, 'Stripe');
  assert.equal(handled('https://fonts.gstatic.com/s/figtree/v1/x.woff2'), false, 'Google Fonts');
  assert.equal(handled(`${base}premium/advanced/fib-sniper.js`), false, 'same-origin premium/ path');
  assert.equal(handled(`${base}js/premium/x.js`), false, 'nested premium/ path');
  assert.equal(handled(`blob:${base}1234-5678`), false, 'blob:');
  assert.equal(handled(`${base}js/core/ui.js?retry=2`), false, 'query string');
  assert.equal(handled(`${base}js/core/ui.js`, { method: 'POST' }), false, 'POST');
  assert.equal(handled(`${base}media/clip.mp4`, { headers: { range: 'bytes=0-' } }), false, 'range');
  assert.equal(handled(`${base}sw.js`), false, 'the worker itself');
});

test('sw.js: storage-cutover paid module paths are explicitly not cacheable', () => {
  const base = 'https://example.github.io/The-Trade-School/';
  const { listeners } = loadWorker(base, (src) => src.replace(
    'const NEVER_CACHE_PATHS = [];',
    'const NEVER_CACHE_PATHS = ["js/lessons/candle-anatomy.js","js/games/fib-sniper.js"];',
  ));
  const handled = (url, opts) => {
    const ev = fetchEvent(url, opts);
    listeners.fetch(ev);
    return ev.handled;
  };
  assert.equal(handled(`${base}js/lessons/candle-anatomy.js`), false, 'removed paid lesson');
  assert.equal(handled(`${base}js/games/fib-sniper.js`), false, 'removed paid game');
  assert.equal(handled(`${base}js/games/daily-challenge.js`), true, 'free game remains cacheable');
  assert.equal(handled(`${base}js/core/router.js`), true, 'public core remains cacheable');
});

test('sw.js: storage cutover activates immediately and reloads existing online clients once', async () => {
  const base = 'https://example.github.io/The-Trade-School/';
  const navigated = [];
  let claimed = false;
  const clients = [
    { url: `${base}#l.candle-anatomy`, navigate: async (url) => { navigated.push(url); } },
    { url: `${base}?checkout=success#account`, navigate: async (url) => { navigated.push(url); } },
    { url: `${base}?tts-sw-cutover=secure-1#home`, navigate: async (url) => { navigated.push(url); } },
  ];
  const deleted = [];
  const { listeners } = loadWorker(base, (src) => src
    .replace("const BUILD = 'dev';", "const BUILD = 'secure-1';")
    .replace('const SECURITY_CUTOVER = false;', 'const SECURITY_CUTOVER = true;'), {
    caches: {
      keys: async () => ['tts-v1-old', 'tts-v1-secure-1', 'other'],
      delete: async (key) => { deleted.push(key); return true; },
    },
    clients: {
      claim: async () => { claimed = true; },
      matchAll: async () => clients,
    },
  });
  await runExtendable(listeners.activate);
  assert.equal(claimed, true);
  assert.deepEqual(deleted, ['tts-v1-old']);
  assert.equal(navigated.length, 2);
  assert.ok(navigated.every((url) => url.includes('tts-sw-cutover=secure-1')));
  assert.ok(navigated.some((url) => url.endsWith('#l.candle-anatomy')));
  assert.ok(navigated.some((url) => url.endsWith('#account')));
});

test('sw.js: version stamp placeholder, required shell files exist, module graph parser finds main.js imports', () => {
  const src = read('sw.js').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
  assert.match(src, /const BUILD = 'dev';/, 'the deploy workflow replaces this exact text');
  assert.match(src, /const CACHE = `\$\{PREFIX\}\$\{VERSION\}-\$\{BUILD\}`/);
  assert.match(src, /const NEVER_CACHE_PATHS = \[\];/, 'storage build fills this with removed paid public module paths');
  assert.match(src, /const SECURITY_CUTOVER = false;/, 'storage build flips this for the one-time private-content cutover');
  const core = vm.runInNewContext(`${src.match(/const CORE = \[[\s\S]*?\];/)[0]}; CORE`);
  for (const p of core) if (p !== './') assert.ok(exists(p), `CORE file missing: ${p} (the worker would not install)`);
  const installStart = src.indexOf("addEventListener('install'");
  const activateStart = src.indexOf("addEventListener('activate'");
  const installSrc = src.slice(installStart, activateStart);
  assert.match(installSrc, /if \(SECURITY_CUTOVER\) await self\.skipWaiting\(\);/, 'only storage security cutovers skip waiting on install');
  assert.match(installSrc, /done\.delete\(new URL\('js\/boot\.js'/, 'boot entry is walked from the module graph');
  assert.match(installSrc, /done\.delete\(new URL\('js\/main\.js'/, 'boot-imported main.js is walked from the module graph');
  assert.match(installSrc, /done\.delete\(new URL\('js\/pwa\.js'/, 'boot-imported pwa.js is walked from the module graph');
  assert.match(installSrc, /precacheModuleGraph\(cache, \['js\/boot\.js', 'js\/main\.js', 'js\/pwa\.js'\]/, 'template dynamic imports are seeded explicitly');
  const moduleImports = vm.runInNewContext(`${src.match(/function moduleImports[\s\S]*?\n}\n/)[0]}; moduleImports`);
  const mainFound = moduleImports(read('js/main.js'));
  assert.ok(mainFound.includes('./core/router.js') && mainFound.includes('./core/store.js'), JSON.stringify(mainFound));
  for (const spec of mainFound) assert.ok(exists(path.join('js', spec)), `main.js imports a missing file: ${spec}`);
  assert.deepEqual([...moduleImports("import './a.js';\nexport { x } from '../b.js';\nimport {\n  q,\n} from './c.js';\nconst d = import('./d.js');")].sort(), ['../b.js', './a.js', './c.js', './d.js']);
});

test('pwa.js imports cleanly in node (no DOM at import time)', async () => {
  const mod = await import('../../js/pwa.js');
  assert.equal(typeof mod.swDecision, 'function');
  assert.equal(typeof mod.isStandalone, 'function');
});
