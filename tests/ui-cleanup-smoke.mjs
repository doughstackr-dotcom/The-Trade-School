import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = 5189;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

function localServer() {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${PORT}`).pathname);
      let file = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
      if (!file.startsWith(ROOT)) {
        res.writeHead(403).end();
        return;
      }
      try {
        const st = await stat(file);
        if (!st.isFile()) file = path.join(ROOT, 'index.html');
      } catch {
        file = path.join(ROOT, 'index.html');
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(await readFile(file));
    } catch (err) {
      res.writeHead(500).end(String(err?.message || err));
    }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function installMockSupabase(page, { signedIn = false } = {}) {
  await page.addInitScript(({ signedIn }) => {
    localStorage.setItem('tts-enforce-access', '1');
    const session = signedIn
      ? { user: { email: 'simpleais@example.test', id: 'mock-user' }, access_token: 'mock-token' }
      : null;
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
  }, { signedIn });
}

async function main() {
  const server = await localServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const base = `http://127.0.0.1:${PORT}/`;

    const home = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await installMockSupabase(home);
    await home.goto(`${base}#home`);
    await home.waitForSelector('[data-mounted="home"]');
    await home.locator('.hero__ctas [data-auth-return="beginner"]').click();
    await home.waitForSelector('[data-mounted="account.signup"]');
    const remembered = await home.evaluate(() => sessionStorage.getItem('tts-return-hash'));
    if (remembered !== 'beginner') throw new Error('homepage hero did not remember beginner return');
    await home.screenshot({ path: 'test-artifacts/home-account-signup-after.png', fullPage: true });
    await home.close();

    const platforms = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await platforms.goto(`${base}#platforms`);
    await platforms.waitForSelector('[data-mounted="platforms"]');
    const order = await platforms.locator('.aff-section__title').evaluateAll((els) => els.map((e) => e.textContent.trim()));
    if (order.indexOf('Binary Options') === -1
        || order.indexOf('Coming soon') === -1
        || order.indexOf('Binary Options') > order.indexOf('Coming soon')) {
      throw new Error('Binary Options section is not above Coming soon');
    }
    const pocketHref = await platforms.locator('#aff-pocket-option a.aff-row__cta').getAttribute('href');
    if (pocketHref !== 'https://pocket-friends.co/r/zs9a40s5v6') throw new Error('Pocket Option href changed');
    const pocketRel = await platforms.locator('#aff-pocket-option a.aff-row__cta').getAttribute('rel');
    if (!/sponsored/.test(pocketRel || '')) throw new Error('Pocket Option sponsored rel missing');
    if (await platforms.locator('.aff-disclaimer').count()) throw new Error('bottom affiliate disclosure still present');
    if (await platforms.getByText('at no extra cost to you').count()) throw new Error('unconfirmed no-extra-cost copy still visible');
    const notes = await platforms.locator('.aff-row__note').count();
    if (notes < 5) throw new Error('referral notes missing from live partner links');
    await platforms.screenshot({ path: 'test-artifacts/platforms-binary-options-after.png', fullPage: true });
    await platforms.close();

    const live = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await live.goto(`${base}#live`);
    await live.waitForSelector('[data-mounted="live"]');
    await live.getByRole('heading', { name: 'Market hours' }).first().waitFor();
    if (await live.locator('.live-board, .live-detail, .live-ticker, .live__bar').count()) {
      throw new Error('live quote/chart UI still rendered');
    }
    await live.locator('.live-timeline').waitFor();
    await live.screenshot({ path: 'test-artifacts/live-market-hours-only-after.png', fullPage: true });
    await live.close();

    const nav = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await nav.goto(`${base}#dashboard`);
    await nav.waitForSelector('[data-mounted="dashboard"]');
    const topLabels = await nav.locator('.nav').innerText();
    const tabLabels = await nav.locator('.tabbar').innerText();
    const footerLabels = await nav.locator('.footer__links').innerText();
    if (/Tools|Glossary/.test(topLabels)) throw new Error(`removed item still in top nav: ${topLabels}`);
    if (/Tools|Glossary/.test(tabLabels)) throw new Error(`removed item still in mobile tab nav: ${tabLabels}`);
    if (!/Glossary/.test(footerLabels) || /Tools/.test(footerLabels)) throw new Error(`footer nav mismatch: ${footerLabels}`);
    await nav.screenshot({ path: 'test-artifacts/dashboard-nav-after.png', fullPage: true });
    await nav.close();

    const legacyTools = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await legacyTools.goto(`${base}#tools`);
    await legacyTools.waitForSelector('[data-mounted="tools"]');
    if (await legacyTools.getByRole('heading', { name: 'Tools' }).count()) throw new Error('#tools rendered the removed Tools page');
    if (!(await legacyTools.getByRole('heading', { name: /Your school hub|Welcome, guest/i }).count())) {
      throw new Error('#tools did not land on Dashboard content');
    }
    await legacyTools.goto(`${base}#t.pre-trade-checklist`);
    await legacyTools.waitForSelector('[data-mounted="t.pre-trade-checklist"]');
    if (await legacyTools.locator('.tools-page').count()) throw new Error('tool deep link rendered removed Tools page content');
    if (!(await legacyTools.getByRole('heading', { name: /Your school hub|Welcome, guest/i }).count())) {
      throw new Error('tool deep link did not land on Dashboard content');
    }
    await legacyTools.close();

    const library = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await installMockSupabase(library);
    await library.goto(`${base}#library`);
    await library.waitForSelector('[data-mounted="library"]');
    await library.locator('.library-teaser-banner').waitFor();
    const centered = await library.locator('.library-teaser-banner').evaluate((el) => {
      const styles = getComputedStyle(el);
      const actions = el.querySelector('.teaser-banner__actions');
      return {
        text: styles.textAlign,
        justify: styles.justifyContent,
        action: getComputedStyle(actions).justifyContent,
      };
    });
    if (centered.text !== 'center' || centered.justify !== 'center' || centered.action !== 'center') {
      throw new Error('library teaser banner is not centered');
    }
    await library.screenshot({ path: 'test-artifacts/library-centered-banner-after.png', fullPage: true });
    await library.close();

    const libraryWide = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await installMockSupabase(libraryWide, { signedIn: true });
    await libraryWide.goto(`${base}#library`);
    await libraryWide.waitForSelector('[data-mounted="library"]');
    const wideBanner = await libraryWide.locator('.library-teaser-banner').evaluate((el) => {
      const banner = el.getBoundingClientRect();
      const actions = el.querySelector('.teaser-banner__actions').getBoundingClientRect();
      const copy = el.querySelector('.teaser-banner__copy').getBoundingClientRect();
      const viewportCenter = window.innerWidth / 2;
      const bannerCenter = banner.left + banner.width / 2;
      return {
        centered: Math.abs(viewportCenter - bannerCenter) < 2,
        separated: copy.right + 24 <= actions.left,
        inViewport: banner.left >= 0 && banner.right <= window.innerWidth,
      };
    });
    if (!wideBanner.centered || !wideBanner.separated || !wideBanner.inViewport) {
      throw new Error(`wide library banner layout failed: ${JSON.stringify(wideBanner)}`);
    }
    await libraryWide.screenshot({ path: 'test-artifacts/library-wide-banner-after.png', fullPage: true });
    await libraryWide.close();

    const lockedLesson = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await installMockSupabase(lockedLesson, { signedIn: true });
    await lockedLesson.goto(`${base}#l.candle-anatomy`);
    await lockedLesson.waitForSelector('[data-mounted="l.candle-anatomy"]');
    await lockedLesson.getByRole('dialog', { name: 'Upgrade to unlock' }).waitFor();
    await lockedLesson.waitForTimeout(300);
    const modalLayout = await lockedLesson.locator('.upgrade-modal__plans').evaluate((el) => {
      const plans = [...el.querySelectorAll('.plan-card')].map((card) => {
        const rect = card.getBoundingClientRect();
        const overflowing = [...card.querySelectorAll('*')].some((child) => {
          const childRect = child.getBoundingClientRect();
          return childRect.right > rect.right + 1 || childRect.left < rect.left - 1;
        });
        return { width: rect.width, overflowing };
      });
      return {
        columns: getComputedStyle(el).gridTemplateColumns.split(' ').length,
        plans,
        copy: document.body.textContent,
      };
    });
    if (modalLayout.columns !== 2 || modalLayout.plans.some((p) => p.width < 260 || p.overflowing)) {
      throw new Error(`upgrade modal plan layout failed: ${JSON.stringify(modalLayout.plans)}`);
    }
    if (!modalLayout.copy.includes('Payments are temporarily unavailable.')) {
      throw new Error('upgrade modal still has internal payment-unavailable copy');
    }
    await lockedLesson.screenshot({ path: 'test-artifacts/upgrade-modal-wide-after.png', fullPage: true });
    await lockedLesson.setViewportSize({ width: 390, height: 844 });
    await lockedLesson.reload();
    await lockedLesson.waitForSelector('[data-mounted="l.candle-anatomy"]');
    await lockedLesson.getByRole('dialog', { name: 'Upgrade to unlock' }).waitFor();
    await lockedLesson.waitForTimeout(300);
    const mobileColumns = await lockedLesson.locator('.upgrade-modal__plans').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    if (mobileColumns !== 1) throw new Error('upgrade modal plans did not stack on mobile');
    await lockedLesson.close();

    console.log('targeted UI cleanup checks passed');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
