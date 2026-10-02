import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const PORT = 5196;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

let activeDist = '';

async function buildRelease(name, sha, { securityCutover = true } = {}) {
  await execFileAsync(process.execPath, ['scripts/cloudflare-build.mjs'], {
    cwd: ROOT,
    env: { ...process.env, GITHUB_SHA: sha, TTS_PREMIUM_SOURCE: 'edge', TTS_SECURITY_CUTOVER: securityCutover ? '1' : '0' },
  });
  const out = path.join(os.tmpdir(), `tts-${name}-${Date.now()}`);
  await cp(path.join(ROOT, 'dist'), out, { recursive: true });
  return out;
}

async function makeOldRelease(dist) {
  await cp(path.join(ROOT, 'patch-base', 'css', 'components.css'), path.join(dist, 'css', 'components.css'));
  await writeFile(path.join(dist, 'js', 'pages', 'affiliate.js'), oldAffiliateModule());
  await writeFile(path.join(dist, 'js', 'pages', 'library.js'), oldLibraryModule());
  await writeFile(path.join(dist, 'js', 'pages', 'live.js'), oldLiveModule());
  await stripVersions(dist);
}

function oldAffiliateModule() {
  return `
export default { id: 'platforms', mount(root) {
  root.innerHTML = '<div class="container"><section class="aff-section"><h2 class="aff-section__title">Brokers & apps</h2><div id="aff-pocket-option">Pocket Option</div></section><section class="aff-section"><h2 class="aff-section__title">Funded accounts</h2></section><section class="aff-section"><h2 class="aff-section__title">Coming soon</h2></section><p class="aff-disclaimer">The Trade School may earn a commission at no extra cost to you.</p></div>';
  return () => {};
} };`;
}

function oldLibraryModule() {
  return `
export default { id: 'library', mount(root) {
  root.innerHTML = '<div class="teaser-banner library-teaser-banner" style="text-align:left"><div class="teaser-banner__copy"><h2>Pattern Library locked</h2><p>Old left warning</p></div><div class="teaser-banner__actions"><a class="btn" href="#paywall">View plans</a></div></div>';
  return () => {};
} };`;
}

function oldLiveModule() {
  return `
export default { id: 'live', mount(root) {
  root.innerHTML = '<div class="container live"><h1>Live Market Lab</h1><section class="live-board"><h2>Daily chart</h2></section><div class="live-detail"></div></div>';
  return () => {};
} };`;
}

async function stripVersions(dir) {
  for (const file of await walk(dir)) {
    if (!/\.(?:html|js|css)$/.test(file)) continue;
    const src = await readFile(file, 'utf8');
    const next = src.replace(/\?v=old-release/g, '');
    if (next !== src) await writeFile(file, next);
  }
}

async function walk(dir) {
  const fs = await import('node:fs/promises');
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

function server() {
  const srv = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      let file = path.join(activeDist, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(activeDist)) {
        res.writeHead(403).end();
        return;
      }
      try {
        const st = await stat(file);
        if (!st.isFile()) file = path.join(activeDist, 'index.html');
      } catch {
        file = path.join(activeDist, 'index.html');
      }
      const ext = path.extname(file);
      const cacheControl = /\.(?:js|css)$/.test(file)
        ? 'public, max-age=31536000'
        : 'no-cache';
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': cacheControl,
      });
      res.end(await readFile(file));
    } catch (err) {
      res.writeHead(500).end(String(err?.message || err));
    }
  });
  return new Promise((resolve) => srv.listen(PORT, '127.0.0.1', () => resolve(srv)));
}

async function sectionOrder(page) {
  return page.locator('.aff-section__title').evaluateAll((els) => els.map((el) => el.textContent.trim()));
}

async function assertNewRelease(page) {
  const base = `http://127.0.0.1:${PORT}/`;

  await page.goto(base);
  await page.waitForFunction(() => document.documentElement.dataset.release === 'new-release');

  await page.goto(`${base}#platforms`);
  await page.waitForSelector('[data-mounted="platforms"]');
  const order = await sectionOrder(page);
  if (order.indexOf('Binary Options') === -1 || order.indexOf('Binary Options') > order.indexOf('Coming soon')) {
    throw new Error(`new Platforms section order is stale: ${JSON.stringify(order)}`);
  }
  if (await page.locator('.aff-disclaimer').count()) throw new Error('new Platforms still has old bottom affiliate disclosure');
  if (await page.getByText('at no extra cost to you').count()) throw new Error('new Platforms still has old no-extra-cost copy');

  await page.goto(`${base}#library`);
  await page.waitForSelector('[data-mounted="library"]');
  const banner = await page.locator('.library-teaser-banner').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const actions = el.querySelector('.teaser-banner__actions');
    const copy = el.querySelector('.teaser-banner__copy');
    return {
      centered: Math.abs((rect.left + rect.width / 2) - window.innerWidth / 2) < 2,
      text: getComputedStyle(el).textAlign,
      action: getComputedStyle(actions).justifyContent,
      separated: copy.getBoundingClientRect().bottom + 8 <= actions.getBoundingClientRect().top,
      left: rect.left,
      width: rect.width,
    };
  });
  if (!banner.centered || banner.text !== 'center' || banner.action !== 'center' || !banner.separated) {
    throw new Error(`new Library banner is not centered: ${JSON.stringify(banner)}`);
  }

  await page.goto(`${base}#live`);
  await page.waitForSelector('[data-mounted="live"]');
  await page.getByRole('heading', { name: 'Market hours' }).first().waitFor();
  if (await page.locator('.live-board, .live-detail, .live-ticker, .live__bar').count()) {
    throw new Error('new Live still rendered old daily chart/live-board UI');
  }
}

async function main() {
  const oldDist = await buildRelease('old', 'old-release', { securityCutover: false });
  await makeOldRelease(oldDist);
  const newDist = await buildRelease('new', 'new-release', { securityCutover: true });
  const accessSource = await readFile(path.join(newDist, 'js', 'core', 'access.js'), 'utf8');
  if (!/vendor\/supabase\.js/.test(accessSource) || !/searchParams\.set\('v', RELEASE_VERSION\)/.test(accessSource)) {
    throw new Error('built access.js does not propagate the release version to the Supabase vendor script');
  }
  const srv = await server();
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'tts-release-profile-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 1920, height: 1080 },
  });
  try {
    await context.addInitScript(() => {
      localStorage.setItem('tts-enforce-access', '1');
      const session = { user: { email: 'simpleais@example.test', id: 'mock-user' }, access_token: 'mock-token' };
      window.supabase = {
        createClient() {
          return {
            auth: {
              getSession: async () => ({ data: { session } }),
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
              initialize: async () => ({ error: null }),
            },
            rpc: async () => ({ data: 'free', error: null }),
            from: () => ({
              select: () => ({
                eq: () => ({
                  in: () => ({
                    order: () => ({ limit: async () => ({ data: [], error: null }) }),
                  }),
                }),
              }),
            }),
            functions: { invoke: async () => ({ data: {}, error: null }) },
          };
        },
      };
    });
    activeDist = oldDist;
    const page = await context.newPage();
    const base = `http://127.0.0.1:${PORT}/`;
    await page.goto(base);
    await page.evaluate(() => {
      localStorage.setItem('tts-sw', '1');
      localStorage.setItem('tts-journal-release-fixture', JSON.stringify([{ note: 'keep user data' }]));
      sessionStorage.setItem('tts-auth-release-fixture', 'account');
    });
    await page.goto(`${base}#platforms`);
    await page.waitForSelector('[data-mounted="platforms"]');
    const oldOrder = await sectionOrder(page);
    if (oldOrder.indexOf('Binary Options') !== -1 && oldOrder.indexOf('Binary Options') < oldOrder.indexOf('Coming soon')) {
      throw new Error(`old fixture unexpectedly already has new Platforms order: ${JSON.stringify(oldOrder)}`);
    }
    await page.goto(`${base}#library`);
    await page.waitForSelector('[data-mounted="library"]');
    await page.goto(`${base}#live`);
    await page.waitForSelector('[data-mounted="live"]');

    activeDist = newDist;
    await assertNewRelease(page);
    const storage = await page.evaluate(() => ({
      local: localStorage.getItem('tts-journal-release-fixture'),
      session: sessionStorage.getItem('tts-auth-release-fixture'),
      release: document.documentElement.dataset.release,
      scripts: [...document.scripts].map((script) => script.src).filter(Boolean),
      styles: [...document.styleSheets].map((sheet) => sheet.href).filter(Boolean),
    }));
    if (!storage.local?.includes('keep user data') || storage.session !== 'account') {
      throw new Error(`release switch lost user storage: ${JSON.stringify(storage)}`);
    }
    if (storage.release !== 'new-release') throw new Error(`new release id missing from DOM: ${JSON.stringify(storage)}`);
    if (!storage.scripts.some((src) => src.includes('js/boot.js?v=new-release'))) {
      throw new Error(`versioned boot script missing: ${JSON.stringify(storage.scripts)}`);
    }
    const localStyles = storage.styles.filter((href) => href.startsWith(base));
    if (!localStyles.every((href) => href.includes('?v=new-release'))) {
      throw new Error(`unversioned stylesheet loaded: ${JSON.stringify(storage.styles)}`);
    }
    console.log(`release versioning smoke passed: oldOrder=${JSON.stringify(oldOrder)} storage=${JSON.stringify(storage)}`);
  } finally {
    await context.close();
    await new Promise((resolve) => srv.close(resolve));
    await rm(oldDist, { recursive: true, force: true });
    await rm(newDist, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
