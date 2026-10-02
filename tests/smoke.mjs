#!/usr/bin/env node
// Smoke test: serves the repo, opens every route in Chromium at desktop (1280×800), tablet
// (820×1180, touch) and phone (390×844, touch) sizes in light and dark themes, and fails on
// console errors, page errors, failed requests or horizontal page scroll. Screenshots go to
// tests/screenshots/ (git-ignored).
//
//   node tests/smoke.mjs                 all routes
//   node tests/smoke.mjs g.fib-sniper    one route (args are exact routes or prefixes, e.g. "g.")
//   options: --no-shots  --desktop / --tablet / --phone (combinable)  --light | --dark  --fonts (load Google Fonts;
//            uses $HTTPS_PROXY if set)  --concurrency=N  --no-interact
//            --viewport=a,b (named viewports: desktop, tablet, phone and the extra device sizes
//            phone-small 360×740, phone-landscape 844×390, tablet-768 768×1024,
//            tablet-landscape 1180×820 (touch), desktop-xl 1680×1050; `--viewport=all` = every one)
//            --sw (open pages with ?sw=1 so js/pwa.js registers the service worker on localhost)
//            --site-premium (use public site modules instead of the default mocked edge premium-content path)
//            --no-storage (every localStorage/sessionStorage call throws, as in some private modes)
//            --real-market (do NOT use the offline market fixtures: real-data routes then call the
//            market-data Edge Function, which needs network access to supabase.co)
//
// Market data: by default every page is opened with `?market=mock` (localhost only), so
// js/core/market.js serves tests/fixtures/market/*.json and the run needs no network. Routes: every
// page, lesson and game in js/registry.js, the PAGES (playbook, live), one playbook detail and the
// DEV_ENTRIES (#l._kit-demo).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'tests', 'screenshots');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const IGNORE_HOSTS = /fonts\.googleapis\.com|fonts\.gstatic\.com/;
const INTENTIONALLY_OMITTED_PREMIUM_MODULES = new Set([
  'beginner/lessons/discipline-basics.js',
  'beginner/tools/pre-trade-checklist.js',
  'advanced/tools/journal-review.js',
]);

// ------------------------------------------------------------------ CLI

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : fallback;
};
const filters = args.filter((a) => !a.startsWith('--'));
const noShots = flag('no-shots');
const interact = !flag('no-interact');
const withFonts = flag('fonts');
const noStorage = flag('no-storage');
const realMarket = flag('real-market');
const edgePremium = !flag('site-premium');
const concurrency = Math.max(1, Number(opt('concurrency', 3)) || 3);

const withSW = flag('sw');

// The default run covers these three (ARCHITECTURE §10).
const ALL_VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false },
  { name: 'tablet', viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];
// Extra device sizes, only with --viewport=… (device QA).
const EXTRA_VIEWPORTS = [
  { name: 'phone-small', viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true },
  { name: 'phone-landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
  { name: 'tablet-768', viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true },
  { name: 'tablet-landscape', viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true },
  { name: 'desktop-xl', viewport: { width: 1680, height: 1050 }, isMobile: false, hasTouch: false },
];
const KNOWN_VIEWPORTS = [...ALL_VIEWPORTS, ...EXTRA_VIEWPORTS];
const viewportOpt = opt('viewport', '');
const viewportNames = viewportOpt === 'all' ? KNOWN_VIEWPORTS.map((v) => v.name) : viewportOpt.split(',').map((s) => s.trim()).filter(Boolean);
const unknownViewports = viewportNames.filter((n) => !KNOWN_VIEWPORTS.some((v) => v.name === n));
if (unknownViewports.length) {
  console.error(`Unknown --viewport: ${unknownViewports.join(', ')}. Known: ${KNOWN_VIEWPORTS.map((v) => v.name).join(', ')}, all`);
  process.exit(2);
}
const pickedViewports = KNOWN_VIEWPORTS.filter((v) => flag(v.name) || viewportNames.includes(v.name));
const VIEWPORTS = pickedViewports.length ? pickedViewports : ALL_VIEWPORTS;
const THEMES = ['light', 'dark'].filter((t) => (flag('light') ? t === 'light' : flag('dark') ? t === 'dark' : true));

// ------------------------------------------------------------------ helpers

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const tries = ['playwright'];
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (globalRoot) tries.push(path.join(globalRoot, 'playwright'));
  } catch {
    /* npm not available */
  }
  tries.push('/opt/node22/lib/node_modules/playwright');
  for (const t of tries) {
    try {
      return require(t);
    } catch {
      /* try next */
    }
  }
  throw new Error('Playwright not found. Install it locally (npm i -D playwright) or globally.');
}

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.normalize(path.join(ROOT, rel));
      if (!file.startsWith(ROOT)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      if (edgePremium && rel === '/js/config.js') {
        fs.readFile(file, 'utf8', (err, source) => {
          if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`Not found: ${rel}`);
            return;
          }
          const patched = source.replace(/export const PREMIUM_SOURCE = ['"]site['"];/, 'export const PREMIUM_SOURCE = "edge";');
          res.writeHead(200, {
            'Content-Type': MIME['.js'],
            'Content-Length': Buffer.byteLength(patched),
            'Cache-Control': 'no-store',
          });
          res.end(patched);
        });
        return;
      }
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`Not found: ${rel}`);
          return;
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Content-Length': st.size,
          'Cache-Control': 'no-store',
        });
        fs.createReadStream(file).pipe(res);
      });
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function smokeSession(level = 'beginner') {
  return {
    access_token: `smoke-${level}-token`,
    refresh_token: `smoke-${level}-refresh`,
    user: { id: `smoke-${level}-user`, email: `smoke-${level}@example.test` },
  };
}

function supabaseMockScript() {
  return ({ session, level }) => {
    const client = {
      auth: {
        getSession: async () => ({ data: { session }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        initialize: async () => {},
        signInWithPassword: async () => ({ error: null }),
        signUp: async () => ({ data: { session }, error: null }),
        signOut: async () => ({ error: null }),
      },
      rpc: async (name) => ({ data: name === 'access_level' ? level : null, error: null }),
      from: () => ({
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        order() { return this; },
        limit: async () => ({ data: [{ plan: level, status: 'active' }], error: null }),
      }),
      storage: {
        from: () => ({ download: async () => ({ data: null, error: { message: 'Smoke uses premium-content edge mocks.' } }) }),
      },
    };
    globalThis.supabase = { createClient: () => client };
    try { localStorage.setItem('tts-enforce-access', '1'); } catch { /* storage-disabled smoke covers this separately */ }
  };
}

function representativePremiumModule(storagePath) {
  const id = storagePath.split('/').pop().replace(/\.js$/, '');
  const title = id.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  return `export default {
  id: ${JSON.stringify(id)},
  mount(root, ctx) {
    root.innerHTML = '<div class="container lesson" data-smoke-premium-module=${JSON.stringify(id)}><header class="lesson-hero"><p class="eyebrow">Smoke premium module</p><h1>${title}</h1><p class="lead">Representative private module served by the mocked premium-content edge path.</p></header><button class="btn" data-action="next" type="button">Next</button></div>';
  }
};`;
}

function premiumLocalRel(storagePath) {
  return `js/${String(storagePath || '').replace(/^[^/]+\//, '')}`;
}

async function installPremiumEdgeMock(context, { allow = true } = {}) {
  await context.route('**/functions/v1/premium-content**', async (route) => {
    const reqUrl = new URL(route.request().url());
    const storagePath = reqUrl.searchParams.get('path') || '';
    if (!allow) {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'forbidden' }),
      });
      return;
    }
    const rel = premiumLocalRel(storagePath);
    const local = path.join(ROOT, rel);
    let source = '';
    if (fs.existsSync(local)) {
      source = fs.readFileSync(local, 'utf8');
    } else if (INTENTIONALLY_OMITTED_PREMIUM_MODULES.has(storagePath)) {
      source = representativePremiumModule(storagePath);
    } else {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: `missing smoke premium module: ${storagePath}` }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: source,
    });
  });
}

async function routes() {
  const reg = await import(pathToFileURL(path.join(ROOT, 'js', 'registry.js')).href);
  const all = [
    'home', 'beginner', 'advanced', 'library', 'progress', 'glossary', 'dashboard', 'account', 'dev-chart',
    ...(reg.PAGES || []).map((p) => p.hash),
    ...((reg.PAGES || []).some((p) => p.id === 'playbook') ? ['playbook.hammer'] : []),
    ...reg.LESSONS.map((l) => `l.${l.id}`),
    ...reg.GAMES.map((g) => `g.${g.id}`),
    ...(reg.TOOLS || []).map((t) => `t.${t.id}`),
    ...(reg.DEV_ENTRIES || []).map((e) => `${e.type === 'game' ? 'g' : 'l'}.${e.id}`),
    // accounts (§9): signed out, access open on localhost — these must render without network
    'pricing', 'pricing.advanced', 'account', 'signin', 'signup', 'reset', 'reset.update', 'terms', 'privacy',
  ];
  if (!filters.length) return all;
  return all.filter((r) => filters.some((f) => r === f || r.startsWith(f)));
}

async function overflowReport(page) {
  return page.evaluate(() => {
    // clientWidth, not innerWidth: on touch devices the layout viewport grows to fit wide content,
    // so innerWidth would hide the very overflow we are looking for.
    const iw = document.documentElement.clientWidth || window.innerWidth;
    const sw = document.documentElement.scrollWidth;
    if (sw <= iw) return null;
    const culprits = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > iw + 1 && r.width > 0) {
        const id = el.id ? `#${el.id}` : '';
        const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
        culprits.push(`${el.tagName.toLowerCase()}${id}${cls} (right ${Math.round(r.right)})`);
        if (culprits.length >= 4) break;
      }
    }
    return `horizontal scroll: scrollWidth ${sw} > innerWidth ${iw}; e.g. ${culprits.join(', ')}`;
  });
}

// ------------------------------------------------------------------ main

async function main() {
  const list = await routes();
  if (!list.length) {
    console.error(`No routes match: ${filters.join(' ')}`);
    process.exit(2);
  }
  if (!noShots) fs.mkdirSync(SHOTS, { recursive: true });

  const { chromium } = loadPlaywright();
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  // --fonts behind a proxy: pass it straight to Chromium (which keeps loopback direct).
  const proxy = withFonts ? process.env.HTTPS_PROXY || process.env.https_proxy || '' : '';
  const browser = await chromium.launch({ headless: true, args: proxy ? [`--proxy-server=${proxy}`] : [] });

  const combos = [];
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport: vp.viewport,
        isMobile: vp.isMobile,
        hasTouch: vp.hasTouch,
        colorScheme: theme,
        reducedMotion: 'no-preference',
        ignoreHTTPSErrors: !!proxy,
      });
      if (edgePremium) {
        await context.addInitScript(supabaseMockScript(), { session: smokeSession('advanced'), level: 'advanced' });
        await installPremiumEdgeMock(context);
      }
      if (!withFonts) await context.route(IGNORE_HOSTS, (r) => r.abort());
      if (noStorage) {
        await context.addInitScript(() => {
          const boom = () => {
            throw new DOMException('Storage is disabled (smoke --no-storage)', 'SecurityError');
          };
          for (const m of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) {
            try {
              Object.defineProperty(Storage.prototype, m, { value: boom, configurable: true });
            } catch {
              /* ignore */
            }
          }
        });
      }
      combos.push({ vp, theme, context });
    }
  }

  const tasks = [];
  for (const route of list) for (const c of combos) tasks.push({ route, ...c });

  const failures = [];
  let done = 0;
  const t0 = Date.now();

  async function run(task) {
    const { route, vp, theme, context } = task;
    const label = `${route} [${vp.name}/${theme}]`;
    const errors = [];
    let premiumRequested = false;
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const loc = msg.location()?.url || '';
      if (IGNORE_HOSTS.test(loc) || IGNORE_HOSTS.test(msg.text())) return;
      errors.push(`console.error: ${msg.text()}${loc ? `  (${loc.replace(base, '')})` : ''}`);
    });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('requestfailed', (req) => {
      if (IGNORE_HOSTS.test(req.url())) return;
      errors.push(`request failed: ${req.url().replace(base, '')} (${req.failure()?.errorText || '?'})`);
    });
    page.on('response', (res) => {
      if (res.status() >= 400 && !IGNORE_HOSTS.test(res.url())) errors.push(`HTTP ${res.status()}: ${res.url().replace(base, '')}`);
    });
    page.on('request', (req) => {
      if (req.url().includes('/functions/v1/premium-content')) premiumRequested = true;
    });

    try {
      await page.goto(`${base}/?smoke=${encodeURIComponent(route)}${realMarket ? '' : '&market=mock'}${withSW ? '&sw=1' : ''}#${route}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForSelector(`[data-mounted="${route}"]`, { timeout: 15000 });
      if (withFonts) await page.evaluate(() => document.fonts?.ready).catch(() => {});
      await page.waitForTimeout(800);
      if (await page.$('[data-route-error]')) errors.push('router showed its error card');
      const isPrivateRoute = edgePremium && /^(l|g|t)\./.test(route) && route !== 'g.daily-challenge' && !route.includes('_kit-demo');
      if (isPrivateRoute) {
        if (!premiumRequested) errors.push('private route did not request premium-content edge module');
        const mountedPrivateModule = await page.locator('[data-smoke-premium-module], .lesson, .game, .tool-shell').first().count();
        if (!mountedPrivateModule) errors.push('private route did not mount lesson/game/tool content');
        const blockedSurface = await page.locator('.paywall, .teaser-banner, .teaser-lock, .upgrade-modal').first().count();
        if (blockedSurface) errors.push('authorized private route rendered an upgrade/paywall surface');
      }
      const shotBase = path.join(SHOTS, `${route}-${vp.name}-${theme}${noStorage ? '-nostorage' : ''}`);
      if (!noShots) await page.screenshot({ path: `${shotBase}.png`, fullPage: true });
      const of = await overflowReport(page);
      if (of) errors.push(of);

      if (interact) {
        let acted = false;
        const start = page.locator('[data-action="start"]:visible').first();
        if (await start.count()) {
          await start.click();
          await page.waitForTimeout(500);
          const opt = page.locator('.game__stage .option:visible').first();
          if (await opt.count()) {
            await opt.click();
            await page.waitForTimeout(400);
          }
          acted = true;
        }
        const next = page.locator('.lesson [data-action="next"]:visible:enabled').first();
        if (await next.count()) {
          await next.click();
          await page.waitForTimeout(400);
          acted = true;
        }
        if (acted) {
          if (!noShots) await page.screenshot({ path: `${shotBase}-play.png`, fullPage: true });
          const of2 = await overflowReport(page);
          if (of2) errors.push(`after interaction: ${of2}`);
        }
      }
    } catch (err) {
      errors.push(`exception: ${err.message.split('\n')[0]}`);
    } finally {
      await page.close().catch(() => {});
    }
    done += 1;
    const status = errors.length ? 'FAIL' : 'ok  ';
    console.log(`${status} ${String(done).padStart(3)}/${tasks.length}  ${label}`);
    if (errors.length) failures.push({ label, errors });
  }

  const queue = tasks.slice();
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) await run(queue.shift());
  }));

  if (edgePremium) {
    const deniedContext = await browser.newContext({
      viewport: ALL_VIEWPORTS[0].viewport,
      isMobile: false,
      hasTouch: false,
      colorScheme: 'light',
      reducedMotion: 'no-preference',
      ignoreHTTPSErrors: !!proxy,
    });
    await deniedContext.addInitScript(supabaseMockScript(), { session: smokeSession('free'), level: 'free' });
    await installPremiumEdgeMock(deniedContext, { allow: false });
    if (!withFonts) await deniedContext.route(IGNORE_HOSTS, (r) => r.abort());
    const page = await deniedContext.newPage();
    const deniedErrors = [];
    let edgeRequested = false;
    page.on('console', (msg) => {
      const loc = msg.location()?.url || '';
      if (msg.type() === 'error' && !IGNORE_HOSTS.test(loc) && !IGNORE_HOSTS.test(msg.text())) {
        deniedErrors.push(`console.error: ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => deniedErrors.push(`pageerror: ${err.message}`));
    page.on('request', (req) => {
      if (req.url().includes('/functions/v1/premium-content')) edgeRequested = true;
    });
    try {
      const route = 'l.discipline-basics';
      await page.goto(`${base}/?smoke=${encodeURIComponent(route)}&market=mock#${route}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForSelector(`[data-mounted="${route}"]`, { timeout: 15000 });
      if (await page.$('[data-route-error]')) deniedErrors.push('router showed its error card');
      const hasPaywall = await page.locator('.paywall, .teaser-banner, .teaser-lock, .upgrade-modal').first().count();
      if (!hasPaywall) deniedErrors.push('denied premium lesson did not render a paywall/upgrade surface');
      if (edgeRequested) deniedErrors.push('denied premium lesson requested private edge content');
    } catch (err) {
      deniedErrors.push(`exception: ${err.message.split('\n')[0]}`);
    } finally {
      await page.close().catch(() => {});
      await deniedContext.close().catch(() => {});
    }
    const label = 'l.discipline-basics denied access [desktop/light]';
    if (deniedErrors.length) {
      console.log(`FAIL      ${label}`);
      failures.push({ label, errors: deniedErrors });
    } else {
      console.log(`ok        ${label}`);
    }
  }

  for (const c of combos) await c.context.close();
  await browser.close();
  server.close();

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (failures.length) {
    console.log(`\n${failures.length} of ${tasks.length} checks failed (${secs}s):\n`);
    for (const f of failures) {
      console.log(`✗ ${f.label}`);
      for (const e of [...new Set(f.errors)]) console.log(`    - ${e}`);
    }
    process.exit(1);
  }
  console.log(`\nAll ${tasks.length} checks passed (${secs}s).${noShots ? '' : ` Screenshots: ${path.relative(process.cwd(), SHOTS) || SHOTS}`}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

