// Partially configured billing (the Advanced price ID was not set): checkout and portal stay
// closed (503), while the webhook keeps syncing subscriptions, using the price lookup key.
import { assertEquals } from 'jsr:@std/assert@1';
import { configureEnv, fnRequest, installHarness, loadFunction, makeEvent, PRICE_ADVANCED, webhookRequest } from './billing_fakes.ts';

configureEnv({ STRIPE_PRICE_ADVANCED: null });
const h = installHarness();
const checkout = await loadFunction('create-checkout');
const portal = await loadFunction('customer-portal');
const webhook = await loadFunction('stripe-webhook');

Deno.test('missing advanced price: create-checkout and customer-portal → 503 before any work', async () => {
  const user = h.auth.addUser();
  for (const fn of [checkout, portal]) {
    const res = await fn(fnRequest('fn', { token: user.token, body: { plan: 'beginner' } }));
    assertEquals(res.status, 503);
    await res.body?.cancel();
  }
  assertEquals(h.stripe.requests.length, 0);
  assertEquals(h.db.requests.length, 0);
});

Deno.test('missing advanced price: webhook still maps the advanced price by lookup key', async () => {
  const user = h.auth.addUser();
  const cus = h.stripe.createCustomer(user.email, { user_id: user.id });
  const sub = h.stripe.createSubscription({ customer: cus.id, price: PRICE_ADVANCED, metadata: { user_id: user.id } });
  const event = makeEvent('customer.subscription.created', h.stripe.render(sub, '2025-02-24.acacia'));
  const res = await webhook(await webhookRequest(event));
  assertEquals(res.status, 200, await res.text());
  const rows = h.db.rows('subscriptions').filter((r) => r.user_id === user.id);
  assertEquals(rows.map((r) => [r.plan, r.price_id]), [['advanced', PRICE_ADVANCED]]);
});
