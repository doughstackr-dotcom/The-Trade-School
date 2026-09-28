// Partially configured billing (the Advanced price ID was not set): checkout and portal stay
// closed (503). The webhook keeps syncing Beginner subscriptions; an Advanced one is never
// granted from its lookup key alone — it gets 500 so Stripe retries once the price is set.
import { assertEquals } from 'jsr:@std/assert@1';
import {
  configureEnv,
  fnRequest,
  installHarness,
  loadFunction,
  makeEvent,
  PRICE_ADVANCED,
  PRICE_BEGINNER,
  webhookRequest,
} from './billing_fakes.ts';

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

Deno.test('missing advanced price: webhook syncs beginner, but never grants advanced by lookup key (500 → retry)', async () => {
  const user = h.auth.addUser();
  const cus = h.stripe.createCustomer(user.email, { user_id: user.id });
  const beginner = h.stripe.createSubscription({ customer: cus.id, price: PRICE_BEGINNER, metadata: { user_id: user.id } });
  const ok = await webhook(await webhookRequest(makeEvent('customer.subscription.created', h.stripe.render(beginner, '2025-02-24.acacia'))));
  assertEquals(ok.status, 200, await ok.text());

  const advanced = h.stripe.createSubscription({ customer: cus.id, price: PRICE_ADVANCED, metadata: { user_id: user.id } });
  const res = await webhook(await webhookRequest(makeEvent('customer.subscription.created', h.stripe.render(advanced, '2025-02-24.acacia'))));
  assertEquals(res.status, 500, 'lookup key advanced_monthly is not trusted');
  await res.body?.cancel();
  const rows = h.db.rows('subscriptions').filter((r) => r.user_id === user.id);
  assertEquals(rows.map((r) => [r.plan, r.price_id]), [['beginner', PRICE_BEGINNER]]);
});
