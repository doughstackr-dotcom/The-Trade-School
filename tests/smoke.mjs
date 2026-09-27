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
//            --no-storage (every localStorage/sessionStorage call throws, as in some private modes)
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
};

const IGNORE_HOSTS = /fonts\.googleapis\.com|fonts\.gstatic\.com/;

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
const concurrency = Math.max(1, Number(opt('concurrency', 3)) || 3);

const ALL_VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false },
  { name: 'tablet', viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];
const pickedViewports = ALL_VIEWPORTS.filter((v) => flag(v.name));
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

async function routes() {
  const reg = await import(pathToFileURL(path.join(ROOT, 'js', 'registry.js')).href);
  const all = [
    'home', 'beginner', 'advanced', 'library', 'progress', 'glossary', 'dev-chart',
    ...reg.LESSONS.map((l) => `l.${l.id}`),
    ...reg.GAMES.map((g) => `g.${g.id}`),
  ];
  if (!filters.length) return all;
  return all.filter((r) => filters.some((f) => r === f || r.startsWith(f)));
}

async function overflowReport(page) {
  return page.evaluate(() => {
    const iw = window.innerWidth;
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

    try {
      await page.goto(`${base}/?smoke=${encodeURIComponent(route)}#${route}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForSelector(`[data-mounted="${route}"]`, { timeout: 15000 });
      if (withFonts) await page.evaluate(() => document.fonts?.ready).catch(() => {});
      await page.waitForTimeout(800);
      if (await page.$('[data-route-error]')) errors.push('router showed its error card');
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
