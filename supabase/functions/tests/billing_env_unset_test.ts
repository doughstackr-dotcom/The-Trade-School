// Billing functions before the owner has set any Stripe secrets or SITE_URL: they must
// answer 503 with a readable message and never touch Auth, the database or Stripe.
import { assertEquals, assertMatch } from 'jsr:@std/assert@1';
import { configureEnv, fnRequest, installHarness, loadFunction, makeEvent, SITE_ORIGIN, webhookRequest } from './billing_fakes.ts';

configureEnv({
  STRIPE_SECRET_KEY: null,
  STRIPE_WEBHOOK_SECRET: null,
  STRIPE_PRICE_BEGINNER: null,
  STRIPE_PRICE_ADVANCED: null,
  SITE_URL: null,
  ALLOWED_ORIGINS: null,
});
const h = installHarness();
const checkout = await loadFunction('create-checkout');
const portal = await loadFunction('customer-portal');
const webhook = await loadFunction('stripe-webhook');
const common = await import('../_shared/common.ts');

Deno.test('env unset: billingConfigured() is false and returnBase has nothing to fall back to', () => {
  assertEquals(common.billingConfigured(), false);
  assertEquals(common.SITE_URL, '');
  assertEquals(common.returnBase('https://evil.example/'), '');
});

Deno.test('env unset: create-checkout / customer-portal → 503 with a message the browser can read', async () => {
  const user = h.auth.addUser();
  for (const [fn, re] of [[checkout, /not open yet/], [portal, /not open yet/]] as const) {
    const res = await fn(fnRequest('fn', { token: user.token, body: { plan: 'beginner' } }));
    assertEquals(res.status, 503);
    assertMatch((await res.json()).error, re);
    // No SITE_URL to pin CORS to: '*' lets the site show the message.
    assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
    const pre = await fn(fnRequest('fn', { method: 'OPTIONS', origin: SITE_ORIGIN }));
    assertEquals(pre.status, 200);
    await pre.body?.cancel();
  }
  assertEquals(h.auth.calls, 0);
  assertEquals(h.db.requests.length, 0);
  assertEquals(h.stripe.requests.length, 0);
});

Deno.test('env unset: webhook → 503 so Stripe keeps retrying until the secret is configured', async () => {
  const res = await webhook(await webhookRequest(makeEvent('customer.subscription.updated', { id: 'sub_x' }), { secret: 'whsec_any' }));
  assertEquals(res.status, 503);
  await res.body?.cancel();
  assertEquals(h.db.requests.length, 0);
  assertEquals(h.stripe.requests.length, 0);
});
