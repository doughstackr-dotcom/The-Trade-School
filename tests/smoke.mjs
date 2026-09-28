#!/usr/bin/env node
// Smoke test: serves the repo, opens every route in Chromium at desktop (1280×800), tablet
// (820×1180, touch) and phone (390×844, touch) sizes in light and dark themes, and fails on
// console errors, page errors, Content-Security-Policy violations, failed requests or horizontal
// page scroll. Routes are opened by their URL path (/games/fib-sniper); a few extra checks make
// sure old hash URLs (#l.risk-basics) are rewritten to paths and that in-app links navigate with
// the History API (Back included). Screenshots go to tests/screenshots/ (git-ignored).
//
//   node tests/smoke.mjs                 all routes
//   node tests/smoke.mjs g.fib-sniper    one route (args are exact route tokens or prefixes, e.g. "g.";
//                                        "legacy" selects the hash-redirect / navigation checks)
//   node tests/smoke.mjs --dist          test the production build: serves dist/ (run `npm run build`
//                                        first) with the headers of vercel.json, CSP included, via
//                                        scripts/serve.mjs; dev-only routes are skipped (not shipped)
//   options: --no-shots  --desktop / --tablet / --phone (combinable)  --light | --dark  --fonts (load Google Fonts;
//            uses $HTTPS_PROXY if set)  --concurrency=N  --no-interact
//            --no-storage (every localStorage/sessionStorage call throws, as in some private modes)
//            --real-market (do NOT use the offline market fixtures: real-data routes then call the
//            market-data Edge Function, which needs network access to supabase.co)
//   node tests/smoke.mjs --premium       test a PREMIUM_SOURCE=storage build (implies --dist; run
//                                        `PREMIUM_SOURCE=storage npm run build` first): checks that
//                                        paid modules are absent from dist/ and free ones present,
//                                        then serves dist-premium/ at /__premium/ and opens pages
//                                        with ?premium=local, so js/core/premium-loader.js imports
//                                        every paid route from a blob: URL under the real CSP
//                                        (no Supabase: the signed-URL step is skipped on localhost);
//                                        plus "premium-refused": a 403 for a paid module shows
//                                        the error card once, without reloading
//
// Market data: by default every page is opened with `?market=mock` (localhost only), so
// js/core/market.js serves tests/fixtures/market/*.json and the run needs no network (with --dist the
// fixtures are served next to dist/, as they are not part of the build). Routes: every page, lesson
// and game in js/registry.js, the PAGES (playbook, live), one playbook detail and the DEV_ENTRIES
// (/lessons/_kit-demo).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { startServer } from '../scripts/serve.mjs';
import { tokenToPath } from '../js/core/routes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'tests', 'screenshots');

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
const realMarket = flag('real-market');
const premium = flag('premium');
const dist = flag('dist') || premium;
const DIST = path.join(ROOT, 'dist');
const DIST_PREMIUM = path.join(ROOT, 'dist-premium');
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

async function routes() {
  const reg = await import(pathToFileURL(path.join(ROOT, 'js', 'registry.js')).href);
  const all = [
    'home', 'beginner', 'advanced', 'library', 'progress', 'glossary', 'dashboard', 'account',
    ...(dist ? [] : ['dev-chart']), // dev-only modules are not in dist/
    'privacy', 'terms', 'refunds',
    ...(reg.PAGES || []).map((p) => p.hash),
    ...((reg.PAGES || []).some((p) => p.id === 'playbook') ? ['playbook.hammer'] : []),
    ...reg.LESSONS.map((l) => `l.${l.id}`),
    ...reg.GAMES.map((g) => `g.${g.id}`),
    ...(dist ? [] : (reg.DEV_ENTRIES || []).map((e) => `${e.type === 'game' ? 'g' : 'l'}.${e.id}`)),
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

// Old hash URLs must land on the same page under its path; then an in-app link and Back.
const LEGACY_CHECKS = [
  { hash: '#l.risk-basics', token: 'l.risk-basics', path: '/lessons/risk-basics' },
  { hash: '#g.daily-challenge', token: 'g.daily-challenge', path: '/games/daily-challenge' },
  { hash: '#dashboard', token: 'dashboard', path: '/dashboard', clickNav: 'games' },
  { hash: '#account.signup', token: 'account.signup', path: '/account/signup' },
  // In-page anchor (Stripe's checkout cancel URL): stays on home and scrolls to the section.
  { hash: '#pricing', token: 'home', path: '/', anchor: true },
];

async function legacyCheck(page, base, query, check, errors) {
  await page.goto(`${base}/${query}${check.hash}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector(`[data-mounted="${check.token}"]`, { timeout: 15000 });
  const where = await page.evaluate(() => ({ path: location.pathname, hash: location.hash }));
  if (check.anchor) {
    await page.waitForTimeout(300);
    const pos = await page.evaluate((id) => ({ y: window.scrollY, top: document.getElementById(id)?.getBoundingClientRect().top }), check.hash.slice(1));
    if (where.path !== check.path || where.hash !== check.hash) errors.push(`${check.hash} should stay on ${check.path}${check.hash}, got ${where.path}${where.hash}`);
    // (the sticky header + scroll-margin keep the section a little below the top edge)
    if (pos.top == null || pos.y < 100 || pos.top < 0 || pos.top > 400) errors.push(`${check.hash} section not scrolled into view (scrollY ${pos.y}, top ${pos.top})`);
    return;
  }
  if (where.path !== check.path || where.hash) errors.push(`${check.hash} should become ${check.path}, got ${where.path}${where.hash}`);
  const canonical = await page.getAttribute('link[rel="canonical"]', 'href');
  if (!canonical?.endsWith(check.path)) errors.push(`canonical link is ${canonical}, expected …${check.path}`);
  if (!check.clickNav) return;
  // History API navigation: a nav link, then Back.
  await page.locator(`.nav a[data-nav="${check.clickNav}"], .tabbar a[data-nav="${check.clickNav}"]`).locator('visible=true').first().click();
  await page.waitForSelector(`[data-mounted="${check.clickNav}"]`, { timeout: 15000 });
  const after = await page.evaluate(() => location.pathname);
  if (after !== tokenToPath(check.clickNav)) errors.push(`nav link went to ${after}`);
  await page.goBack();
  await page.waitForSelector(`[data-mounted="${check.token}"]`, { timeout: 15000 });
}

/**
 * --premium: the build must be a storage build, paid modules absent from dist/, free ones and the
 * shared chunks present. Returns the route tokens of paid lessons / games.
 */
async function checkPremiumBuild() {
  const file = path.join(DIST_PREMIUM, 'premium-manifest.json');
  if (!fs.existsSync(file)) {
    console.error('dist-premium/premium-manifest.json not found: run `PREMIUM_SOURCE=storage npm run build` first.');
    process.exit(2);
  }
  const objects = JSON.parse(fs.readFileSync(file, 'utf8')).objects;
  const assets = JSON.parse(fs.readFileSync(path.join(DIST, 'asset-manifest.json'), 'utf8'));
  const paidSources = new Set(Object.values(objects));
  const reg = await import(pathToFileURL(path.join(ROOT, 'js', 'registry.js')).href);
  const { FREE_IDS } = await import(pathToFileURL(path.join(ROOT, 'js', 'config.js')).href);
  const problems = [];
  const paid = new Set();
  for (const e of [...reg.LESSONS, ...reg.GAMES]) {
    const rel = `js/${e.path.replace(/^\.\//, '')}`;
    const token = `${e.type === 'game' ? 'g' : 'l'}.${e.id}`;
    if (FREE_IDS.includes(e.id)) {
      if (!assets[rel] || !fs.existsSync(path.join(DIST, assets[rel]))) problems.push(`free ${rel} missing from dist/`);
      if (paidSources.has(rel)) problems.push(`free ${rel} is in dist-premium/`);
    } else {
      paid.add(token);
      if (assets[rel]) problems.push(`paid ${rel} is in dist/ (${assets[rel]})`);
      if (!paidSources.has(rel)) problems.push(`paid ${rel} missing from dist-premium/`);
    }
  }
  for (const f of fs.readdirSync(DIST, { recursive: true }).map(String)) {
    const rel = f.split(path.sep).join('/').replace(/\.[0-9a-f]{10}\.js$/, '.js');
    if (paidSources.has(rel)) problems.push(`paid ${rel} is in dist/ (${f})`);
  }
  const cfg = assets['js/config.js'] && fs.readFileSync(path.join(DIST, assets['js/config.js']), 'utf8');
  if (!/PREMIUM_SOURCE="storage"/.test(cfg || '')) problems.push('dist/ config is not PREMIUM_SOURCE="storage"');
  if (problems.length) {
    console.error(`Premium build check failed:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`Premium build: ${paidSources.size} paid files only in dist-premium/, ${FREE_IDS.length} free modules in dist/.`);
  return paid;
}

/**
 * --premium: Storage refuses a paid module (403). On localhost nothing is enforced, so the plan
 * still "covers" it: the router must show its error card with a neutral message, once — never
 * reload (a reload loop on refusals would be the bug).
 */
async function refusedCheck(page, url, token, errors) {
  let navigations = 0;
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) navigations += 1;
  });
  await page.route('**/__premium/**', (r) => r.fulfill({ status: 403, contentType: 'text/plain', body: 'refused' }));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector(`[data-mounted="${token}"][data-route-error]`, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const text = (await page.textContent('.route-error')) || '';
  if (!/not available right now/.test(text)) errors.push(`refused module: unexpected error card: ${text.trim().slice(0, 160)}`);
  if (navigations !== 1) errors.push(`refused module: page navigated ${navigations} times (reload loop?)`);
}

// ------------------------------------------------------------------ main

async function main() {
  const list = await routes();
  if (!list.length && !filters.includes('legacy') && !filters.includes('premium-refused')) {
    console.error(`No routes match: ${filters.join(' ')}`);
    process.exit(2);
  }
  if (!noShots) fs.mkdirSync(SHOTS, { recursive: true });

  if (dist && !fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('dist/index.html not found: run `npm run build` first.');
    process.exit(2);
  }
  const paidRoutes = premium ? await checkPremiumBuild() : new Set();
  const { chromium } = loadPlaywright();
  const overlay = { '/tests/fixtures/': path.join(ROOT, 'tests', 'fixtures') };
  if (premium) overlay['/__premium/'] = DIST_PREMIUM;
  const { server, port } = await startServer(dist ? { dir: DIST, vercel: true, overlay } : { dir: ROOT });
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
      // Collect Content-Security-Policy violations (also reported for requests that are aborted).
      await context.addInitScript(() => {
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (e) => {
          window.__cspViolations.push(`${e.effectiveDirective} blocked ${e.blockedURI || 'inline'}${e.sourceFile ? ` (${e.sourceFile}:${e.lineNumber})` : ''}`);
        });
      });
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
  if (!filters.length || filters.includes('legacy')) {
    for (const check of LEGACY_CHECKS) tasks.push({ route: check.hash, legacy: check, ...combos[0] });
  }
  if (premium && (!filters.length || filters.includes('premium-refused'))) {
    tasks.push({ route: 'premium-refused', refused: 'l.fibonacci', ...combos[0] });
  }

  const failures = [];
  let done = 0;
  const t0 = Date.now();

  async function run(task) {
    const { route, vp, theme, context, legacy, refused } = task;
    const label = `${legacy ? `legacy ${route}` : route} [${vp.name}/${theme}]`;
    const errors = [];
    // The refused-module check expects a 403 and the router's logged failure: it is judged by
    // its own assertions (CSP violations still count).
    const sink = refused ? [] : errors;
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const loc = msg.location()?.url || '';
      const csp = /Content Security Policy/i.test(msg.text());
      if (!csp && (IGNORE_HOSTS.test(loc) || IGNORE_HOSTS.test(msg.text()))) return;
      sink.push(`console.error: ${msg.text()}${loc ? `  (${loc.replace(base, '')})` : ''}`);
    });
    page.on('pageerror', (err) => sink.push(`pageerror: ${err.message}`));
    page.on('requestfailed', (req) => {
      if (IGNORE_HOSTS.test(req.url())) return;
      sink.push(`request failed: ${req.url().replace(base, '')} (${req.failure()?.errorText || '?'})`);
    });
    page.on('response', (res) => {
      if (res.status() >= 400 && !IGNORE_HOSTS.test(res.url())) sink.push(`HTTP ${res.status()}: ${res.url().replace(base, '')}`);
    });

    const query = `?smoke=${encodeURIComponent(route)}${realMarket ? '' : '&market=mock'}${premium ? '&premium=local' : ''}`;
    let premiumHits = 0;
    if (premium) page.on('response', (res) => { if (res.url().startsWith(`${base}/__premium/`) && res.ok()) premiumHits += 1; });
    try {
      if (refused) await refusedCheck(page, `${base}${tokenToPath(refused)}${query}`, refused, errors);
      else if (legacy) await legacyCheck(page, base, query, legacy, errors);
      else await routeCheck(page, `${base}${tokenToPath(route)}${query}`, task, errors);
      if (!legacy && !refused && paidRoutes.has(route) && !premiumHits) errors.push('paid route did not load its module from /__premium/');
    } catch (err) {
      errors.push(`exception: ${err.message.split('\n')[0]}`);
    } finally {
      const csp = await page.evaluate(() => window.__cspViolations || []).catch(() => []);
      for (const v of csp) errors.push(`CSP violation: ${v}`);
      await page.close().catch(() => {});
    }
    done += 1;
    const status = errors.length ? 'FAIL' : 'ok  ';
    console.log(`${status} ${String(done).padStart(3)}/${tasks.length}  ${label}`);
    if (errors.length) failures.push({ label, errors });
  }

  async function routeCheck(page, url, { route, vp, theme }, errors) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
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
