import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = 5194;

let phase = 'old';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function html(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>pwa stale worker smoke</title></head><body>${body}</body></html>`;
}

function oldWorker() {
  return `
const CACHE = 'tts-old-fixture';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.put('/js/main.js', new Response("window.__ttsLoadedMain = 'old';", { headers: { 'Content-Type': 'text/javascript' } }))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'DISABLE') {
    event.waitUntil(caches.delete(CACHE));
  }
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname === '/js/main.js') {
    event.respondWith(caches.match('/js/main.js').then((cached) => cached || fetch(event.request)));
  }
});
`;
}

function server() {
  const srv = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      let body;
      let file = '';
      if (url.pathname === '/') {
        body = phase === 'old'
          ? html(`<script>
              navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(() => {
                if (navigator.serviceWorker.controller) window.__oldControlled = true;
                else location.reload();
              });
            </script>`)
          : html(`<script type="module" src="/js/boot.js"></script>`);
      } else if (url.pathname === '/sw.js') {
        body = phase === 'cutover'
          ? (await readFile(path.join(ROOT, 'sw.js'), 'utf8'))
            .replace("const BUILD = 'dev';", "const BUILD = 'secure-cutover-fixture';")
            .replace('const SECURITY_CUTOVER = false;', 'const SECURITY_CUTOVER = true;')
          : oldWorker();
      } else if (url.pathname === '/js/boot.js' || url.pathname === '/js/sw-cleanup.js') {
        file = path.join(ROOT, url.pathname.slice(1));
        body = await readFile(file, 'utf8');
      } else if (url.pathname === '/js/main.js') {
        body = "window.__ttsLoadedMain = 'new';";
      } else if (url.pathname === '/js/pwa.js') {
        body = "window.__ttsLoadedPwa = 'new';";
      } else {
        const filePath = path.join(ROOT, url.pathname.slice(1));
        if (!filePath.startsWith(ROOT)) {
          res.writeHead(403).end('forbidden');
          return;
        }
        try {
          body = await readFile(filePath);
        } catch {
          res.writeHead(404).end('not found');
          return;
        }
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(url.pathname)] || 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500).end(String(err?.message || err));
    }
  });
  return new Promise((resolve) => srv.listen(PORT, '127.0.0.1', () => resolve(srv)));
}

async function runCase({ optedIn }) {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'tts-pwa-fixture-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 900, height: 700 },
  });
  try {
    const page = await context.newPage();
    const base = `http://127.0.0.1:${PORT}/`;
    phase = 'old';
    await page.goto(base);
    await page.waitForFunction(() => window.__oldControlled === true);
    const oldController = await page.evaluate(() => !!navigator.serviceWorker.controller);
    if (!oldController) throw new Error('old worker did not control the fixture page');

    if (optedIn) {
      await page.evaluate(() => localStorage.setItem('tts-sw', '1'));
    } else {
      await page.evaluate(() => localStorage.removeItem('tts-sw'));
    }

    phase = 'new';
    await page.goto(base);
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => window.__ttsLoadedMain === 'new' || window.__ttsLoadedMain === 'old');
    const result = await page.evaluate(async () => ({
      main: window.__ttsLoadedMain,
      pwa: window.__ttsLoadedPwa,
      href: location.href,
      controller: !!navigator.serviceWorker.controller,
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
      cacheNames: await caches.keys(),
    }));

    if (optedIn) {
      if (result.main !== 'old' || result.pwa !== 'new' || !result.controller) {
        throw new Error(`opted-in service worker was not preserved as expected: ${JSON.stringify(result)}`);
      }
      return result;
    }

    if (result.main !== 'new' || result.pwa !== 'new') {
      throw new Error(`fresh boot did not load the repaired module graph: ${JSON.stringify(result)}`);
    }
    if (!result.href.includes('tts-sw-cleared=1')) {
      throw new Error(`cleanup reload marker missing: ${JSON.stringify(result)}`);
    }
    if (result.controller || result.registrations !== 0 || result.cacheNames.some((key) => key.startsWith('tts-'))) {
      throw new Error(`old worker/cache was not cleaned up: ${JSON.stringify(result)}`);
    }
    await page.reload();
    await page.waitForLoadState('networkidle');
    const afterReload = await page.evaluate(() => ({
      main: window.__ttsLoadedMain,
      href: location.href,
      controller: !!navigator.serviceWorker.controller,
    }));
    if (afterReload.main !== 'new' || afterReload.href.split('tts-sw-cleared=1').length !== 2 || afterReload.controller) {
      throw new Error(`cleanup reload loop or stale graph after reload: ${JSON.stringify(afterReload)}`);
    }
    return result;
  } finally {
    await context.close();
  }
}

async function runOptedInSecurityCutoverCase() {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'tts-pwa-cutover-fixture-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 900, height: 700 },
  });
  try {
    const page = await context.newPage();
    const base = `http://127.0.0.1:${PORT}/`;
    phase = 'old';
    await page.goto(base);
    await page.waitForFunction(() => window.__oldControlled === true);
    await page.evaluate(() => {
      localStorage.setItem('tts-sw', '1');
      localStorage.setItem('tts-journal-fixture', JSON.stringify([{ note: 'preserve me' }]));
      sessionStorage.setItem('tts-auth-return-fixture', 'library');
    });

    phase = 'new';
    await page.goto(base);
    await page.waitForFunction(() => window.__ttsLoadedMain === 'old');
    const beforeCutover = await page.evaluate(async () => ({
      main: window.__ttsLoadedMain,
      pwa: window.__ttsLoadedPwa,
      href: location.href,
      controller: !!navigator.serviceWorker.controller,
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
      local: localStorage.getItem('tts-journal-fixture'),
      session: sessionStorage.getItem('tts-auth-return-fixture'),
    }));
    if (beforeCutover.main !== 'old' || beforeCutover.pwa !== 'new' || !beforeCutover.controller) {
      throw new Error(`fixture did not start from opted-in stale graph: ${JSON.stringify(beforeCutover)}`);
    }

    phase = 'cutover';
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg.update();
    });
    await page.waitForURL(/tts-sw-cutover=secure-cutover-fixture/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => window.__ttsLoadedMain === 'new');
    const afterCutover = await page.evaluate(async () => ({
      main: window.__ttsLoadedMain,
      pwa: window.__ttsLoadedPwa,
      href: location.href,
      controller: !!navigator.serviceWorker.controller,
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
      cacheNames: await caches.keys(),
      local: localStorage.getItem('tts-journal-fixture'),
      session: sessionStorage.getItem('tts-auth-return-fixture'),
    }));
    if (afterCutover.main !== 'new' || afterCutover.pwa !== 'new' || !afterCutover.controller) {
      throw new Error(`security cutover did not load fresh modules: ${JSON.stringify(afterCutover)}`);
    }
    if (afterCutover.registrations !== 1 || afterCutover.cacheNames.includes('tts-old-fixture')) {
      throw new Error(`security cutover did not replace old worker/cache: ${JSON.stringify(afterCutover)}`);
    }
    if (!afterCutover.local?.includes('preserve me') || afterCutover.session !== 'library') {
      throw new Error(`security cutover lost auth/journal-like storage: ${JSON.stringify(afterCutover)}`);
    }
    await page.reload();
    await page.waitForLoadState('networkidle');
    const afterReload = await page.evaluate(() => ({
      main: window.__ttsLoadedMain,
      href: location.href,
    }));
    if (afterReload.main !== 'new' || afterReload.href.split('tts-sw-cutover=secure-cutover-fixture').length !== 2) {
      throw new Error(`security cutover loop or stale reload: ${JSON.stringify(afterReload)}`);
    }
    return { beforeCutover, afterCutover, afterReload };
  } finally {
    await context.close();
  }
}

async function main() {
  const srv = await server();
  try {
    const off = await runCase({ optedIn: false });
    const on = await runCase({ optedIn: true });
    const cutover = await runOptedInSecurityCutoverCase();
    console.log(`pwa stale worker smoke passed: off=${JSON.stringify(off)} on=${JSON.stringify(on)} cutover=${JSON.stringify(cutover)}`);
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
