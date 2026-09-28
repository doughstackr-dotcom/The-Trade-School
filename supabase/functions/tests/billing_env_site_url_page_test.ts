// SITE_URL pasted as a page address (mixed case host, index.html, query, hash) and no
// ALLOWED_ORIGINS: it is normalised to the site base, and localhost is not trusted.
import { assertEquals } from 'jsr:@std/assert@1';
import { configureEnv, fnRequest, installHarness, loadFunction, LOCAL_ORIGIN, SITE_ORIGIN, SITE_URL } from './billing_fakes.ts';

configureEnv({ SITE_URL: 'https://Example.GitHub.io/The-Trade-School/index.html?utm_source=x#pricing', ALLOWED_ORIGINS: null });
const h = installHarness();
const checkout = await loadFunction('create-checkout');
const common = await import('../_shared/common.ts');

Deno.test('page-style SITE_URL is normalised to the base', () => {
  assertEquals(common.SITE_URL, SITE_URL);
  assertEquals(common.returnBase(`${SITE_URL}index.html`), SITE_URL);
  assertEquals(common.returnBase(`${LOCAL_ORIGIN}/`), SITE_URL);
});

Deno.test('without ALLOWED_ORIGINS only the site origin is echoed and used for redirects', async () => {
  const pre = await checkout(fnRequest('fn', { method: 'OPTIONS', origin: LOCAL_ORIGIN }));
  assertEquals(pre.headers.get('Access-Control-Allow-Origin'), SITE_ORIGIN);
  await pre.body?.cancel();

  const user = h.auth.addUser();
  const res = await checkout(fnRequest('fn', { origin: SITE_ORIGIN, token: user.token, body: { plan: 'advanced', returnTo: `${LOCAL_ORIGIN}/` } }));
  assertEquals(res.status, 200, await res.clone().text());
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), SITE_ORIGIN);
  await res.body?.cancel();
  const session = h.stripe.checkoutSessions.at(-1);
  assertEquals(session.success_url, `${SITE_URL}account?checkout=success`);
  assertEquals(session.cancel_url, `${SITE_URL}?checkout=cancel#pricing`);
});
