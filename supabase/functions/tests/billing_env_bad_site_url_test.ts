// SITE_URL typed without a scheme (a likely setup mistake): billing must stay closed
// rather than build relative / broken Stripe redirect URLs.
import { assertEquals } from 'jsr:@std/assert@1';
import { configureEnv, fnRequest, installHarness, loadFunction } from './billing_fakes.ts';

configureEnv({ SITE_URL: 'example.github.io/The-Trade-School/' });
const h = installHarness();
const checkout = await loadFunction('create-checkout');
const common = await import('../_shared/common.ts');

Deno.test('scheme-less SITE_URL: billing is treated as not configured (503)', async () => {
  assertEquals(common.SITE_URL, '');
  assertEquals(common.billingConfigured(), false);
  const user = h.auth.addUser();
  const res = await checkout(fnRequest('fn', { token: user.token, body: { plan: 'beginner', returnTo: 'http://localhost:5173/' } }));
  assertEquals(res.status, 503);
  await res.body?.cancel();
  assertEquals(h.stripe.requests.length, 0);
});
