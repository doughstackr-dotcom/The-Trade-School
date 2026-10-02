import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = 5174;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500).end(String(err?.message || err));
    }
  });
  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

async function installMockSupabase(page) {
  await page.addInitScript(() => {
    let session = null;
    let authCb = null;
    let authLock = false;
    let rejectedOnce = false;
    window.__authCallCount = 0;
    window.__authCallbackPromiseCount = 0;
    window.__authLockedEntitlementReadCount = 0;
    window.__resetCallCount = 0;
    window.__resetRedirectTo = '';
    window.__updatePasswordCount = 0;
    function emitAuth(event, next) {
      authLock = true;
      try {
        const result = authCb?.(event, next);
        if (result && typeof result.then === 'function') window.__authCallbackPromiseCount += 1;
        return result;
      } finally {
        authLock = false;
      }
    }
    localStorage.setItem('tts-enforce-access', '1');
    localStorage.removeItem('tts-progress-v1');
    window.supabase = {
      createClient() {
        return {
          auth: {
            getSession: async () => ({ data: { session } }),
            onAuthStateChange: (cb) => {
              authCb = cb;
              return { data: { subscription: { unsubscribe() {} } } };
            },
            initialize: async () => {
              if (new URLSearchParams(location.search).has('code')) {
                session = { access_token: 'recovery-token', user: { id: 'u1', email: 'ray@example.test' } };
                if (authCb) emitAuth('PASSWORD_RECOVERY', session);
              }
              return { error: null };
            },
            signInWithPassword: async ({ email }) => {
              window.__authCallCount += 1;
              if (email.includes('reject') && !rejectedOnce) {
                rejectedOnce = true;
                throw new Error('Temporary auth outage');
              }
              session = { access_token: 'test-token', user: { id: 'u1', email } };
              if (authCb) emitAuth('SIGNED_IN', session);
              return { data: { session }, error: null };
            },
            signUp: async ({ email }) => {
              if (email.includes('verify')) return { data: { session: null }, error: null };
              session = { access_token: 'test-token', user: { id: 'u1', email } };
              if (authCb) emitAuth('SIGNED_IN', session);
              return { data: { session }, error: null };
            },
            signOut: async () => {
              session = null;
              if (authCb) emitAuth('SIGNED_OUT', null);
              return { error: null };
            },
            resetPasswordForEmail: async (_email, options) => {
              window.__resetCallCount += 1;
              window.__resetRedirectTo = options?.redirectTo || '';
              return { data: {}, error: null };
            },
            updateUser: async () => {
              window.__updatePasswordCount += 1;
              return { data: { user: session?.user || null }, error: null };
            },
          },
          rpc: async () => {
            if (authLock) window.__authLockedEntitlementReadCount += 1;
            return { data: 'free', error: null };
          },
          from: () => ({
            select: () => ({
              eq: () => ({
                in: () => ({
                  order: () => ({ limit: async () => ({ data: [], error: null }) }),
                }),
              }),
            }),
          }),
          functions: { invoke: async () => ({ data: { error: 'checkout disabled in test' }, error: null }) },
        };
      },
    };
  });
}

async function verifyBundledSupabase(browser) {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8">');
  await page.addScriptTag({ path: path.join(ROOT, 'js/vendor/supabase.js') });
  const result = await page.evaluate(async () => {
    const events = [];
    const client = window.supabase.createClient(
      'https://pedcpgmowqhqgersxxqa.supabase.co',
      'sb_publishable_fdwgGDrO0soyNdS0jOprcw_MJxIL0rC',
      {
        auth: {
          flowType: 'pkce',
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: true,
          skipAutoInitialize: true,
        },
        global: {
          fetch: async () => new Response('{}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        },
      },
    );
    client.auth.onAuthStateChange((event, session) => {
      events.push({ event, hasSession: !!session });
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const beforeInitialize = events.length;
    const init = await Promise.race([
      client.auth.initialize().then((value) => ({ settled: true, value })),
      new Promise((resolve) => setTimeout(() => resolve({ settled: false }), 1000)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 25));
    return {
      hasCreateClient: typeof window.supabase.createClient === 'function',
      hasInitialize: typeof client.auth.initialize === 'function',
      beforeInitialize,
      settled: init.settled,
      events,
    };
  });
  await page.close();
  if (!result.hasCreateClient || !result.hasInitialize) throw new Error('bundled Supabase vendor did not expose expected auth APIs');
  if (!result.settled) throw new Error('bundled Supabase auth.initialize did not settle');
}

async function main() {
  const server = await localServer();
  const browser = await chromium.launch({ headless: true });
  try {
    await verifyBundledSupabase(browser);

    const exempt = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await installMockSupabase(exempt);
    await exempt.goto(`http://127.0.0.1:${PORT}/#home`);
    await exempt.getByRole('dialog', { name: /Create your free account/i }).waitFor();
    await exempt.goto(`http://127.0.0.1:${PORT}/#account`);
    await exempt.locator('.modal').waitFor({ state: 'detached' });
    await exempt.getByRole('heading', { name: 'Sign in' }).waitFor();
    if (await exempt.locator('#app').evaluate((app) => app.hasAttribute('inert'))) throw new Error('auth modal left app inert on account route');
    await exempt.goto(`http://127.0.0.1:${PORT}/#home`);
    await exempt.getByRole('dialog', { name: /Create your free account/i }).waitFor();
    await exempt.goto(`http://127.0.0.1:${PORT}/#privacy`);
    await exempt.locator('.modal').waitFor({ state: 'detached' });
    await exempt.waitForSelector('[data-mounted="privacy"]');
    if (await exempt.locator('#app').evaluate((app) => app.hasAttribute('inert'))) throw new Error('auth modal left app inert on legal route');

    const retry = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await installMockSupabase(retry);
    await retry.goto(`http://127.0.0.1:${PORT}/#home`);
    await retry.getByRole('dialog', { name: /Create your free account/i }).waitFor();
    await retry.getByRole('tab', { name: 'Sign in' }).click();
    await retry.getByLabel('Email').fill('reject@example.test');
    await retry.getByLabel('Password').fill('secret123');
    await retry.getByRole('button', { name: /^Sign in$/ }).click();
    await retry.getByRole('dialog').getByRole('status').filter({ hasText: 'Temporary auth outage' }).waitFor();
    await retry.getByLabel('Email').fill('ray@example.test');
    await retry.getByRole('button', { name: /^Sign in$/ }).click();
    await retry.locator('.modal').waitFor({ state: 'detached' });
    if ((await retry.evaluate(() => window.__authCallCount)) !== 2) throw new Error('auth retry was not attempted after rejection');
    if ((await retry.evaluate(() => window.__authCallbackPromiseCount)) !== 0) throw new Error('auth callback returned a Promise during sign-in');
    if ((await retry.evaluate(() => window.__authLockedEntitlementReadCount)) !== 0) throw new Error('sign-in entitlement read ran while Supabase auth lock was held');

    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await installMockSupabase(page);

    await page.goto(`http://127.0.0.1:${PORT}/#l.candle-anatomy`);
    await page.getByRole('dialog', { name: /Create your free account/i }).waitFor();
    await page.getByRole('tab', { name: 'Sign in' }).click();
    await page.getByLabel('Email').fill('ray@example.test');
    await page.getByLabel('Password').fill('secret123');
    await page.getByRole('button', { name: /^Sign in$/ }).click();
    await page.getByRole('dialog', { name: /Upgrade|access needed/i }).waitFor();
    if (new URL(page.url()).hash !== '#l.candle-anatomy') throw new Error('sign-in did not return to intended route');
    await page.locator('button', { hasText: 'Checkout testing pending' }).first().waitFor();
    if (!(await page.locator('button', { hasText: 'Checkout testing pending' }).first().evaluate((button) => button.disabled))) {
      throw new Error('checkout was not disabled in paid-route modal');
    }
    await page.goto(`http://127.0.0.1:${PORT}/#account`);
    await page.waitForFunction(() => document.querySelectorAll('.modal').length === 0);
    if (await page.locator('#app').evaluate((app) => app.hasAttribute('inert'))) throw new Error('upgrade modal left app inert after navigation');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('heading', { name: 'Sign in' }).waitFor();
    if (await page.getByRole('dialog').count()) throw new Error('account route should not show auth modal after logout');
    await page.goto(`http://127.0.0.1:${PORT}/#home`);
    await page.getByRole('dialog', { name: /Create your free account/i }).waitFor();

    const verify = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await installMockSupabase(verify);
    await verify.goto(`http://127.0.0.1:${PORT}/#home`);
    await verify.getByRole('dialog', { name: /Create your free account/i }).waitFor();
    await verify.getByLabel('Email').fill('verify@example.test');
    await verify.getByLabel('Password', { exact: true }).fill('secret123');
    await verify.getByLabel('Confirm password').fill('secret123');
    await verify.getByRole('button', { name: /^Create account$/ }).click();
    await verify.getByText('Check your email to confirm, then sign in.').waitFor();
    await verify.getByRole('dialog', { name: /Sign in to continue/i }).waitFor();

    const recovery = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await installMockSupabase(recovery);
    await recovery.goto(`http://127.0.0.1:${PORT}/?code=recovery-code`);
    await recovery.waitForSelector('[data-mounted="account.recovery"]');
    if (new URL(recovery.url()).hash !== '#account.recovery') throw new Error('PKCE recovery callback did not route to account recovery');
    if (await recovery.getByRole('dialog').count()) throw new Error('password recovery callback should not show auth gate');
    await recovery.getByRole('heading', { name: 'Update password' }).waitFor();
    await recovery.getByLabel('New password', { exact: true }).fill('newsecret123');
    await recovery.getByLabel('Confirm new password').fill('newsecret123');
    await recovery.getByRole('button', { name: 'Update password' }).click();
    await recovery.getByText('Password updated.').waitFor();
    if ((await recovery.evaluate(() => window.__updatePasswordCount)) !== 1) throw new Error('update password was not called');
    if ((await recovery.evaluate(() => window.__authCallbackPromiseCount)) !== 0) throw new Error('auth callback returned a Promise during PKCE recovery');
    if ((await recovery.evaluate(() => window.__authLockedEntitlementReadCount)) !== 0) throw new Error('entitlement read ran while Supabase auth lock was held');

    const reset = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await installMockSupabase(reset);
    await reset.goto(`http://127.0.0.1:${PORT}/#reset`);
    await reset.getByRole('heading', { name: 'Reset password' }).waitFor();
    await reset.getByLabel('Email').fill('ray@example.test');
    await reset.getByRole('button', { name: 'Send recovery link' }).click();
    await reset.getByText('Check your email for the password recovery link.').waitFor();
    if ((await reset.evaluate(() => window.__resetCallCount)) !== 1) throw new Error('reset email was not requested');
    const redirectTo = await reset.evaluate(() => window.__resetRedirectTo);
    if (!redirectTo.endsWith('/#account.recovery')) throw new Error(`reset redirect was not the explicit recovery route: ${redirectTo}`);

    console.log('auth-gate smoke passed (mocked Supabase; no live auth/Stripe calls)');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
