// Adversarial tests for the billing Edge Functions: _shared/common.ts, create-checkout,
// customer-portal and stripe-webhook, against in-memory fakes of PostgREST, Supabase Auth
// and the Stripe API (see billing_fakes.ts). No network access is used.
//
// Run from the repository root (the billing_env_*_test.ts files cover other environments):
//   deno test --no-config --node-modules-dir=none --allow-env --allow-read=supabase \
//     --allow-net=127.0.0.1 'supabase/functions/tests/billing*test.ts'
// BILLING_TEST_VERBOSE=1 prints the functions' console output; BILLING_FAKE_LENIENT_EXPAND=1
// makes the fake Stripe accept any expand[] path.
// deno-lint-ignore-file no-explicit-any

import { assert, assertEquals, assertExists, assertMatch, assertNotEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import {
  ANON_KEY,
  configureEnv,
  type FakeUser,
  fnRequest,
  installHarness,
  loadFunction,
  LOCAL_ORIGIN,
  logs,
  makeEvent,
  PREVIEW_ORIGIN,
  PRICE_ADVANCED,
  PRICE_BEGINNER,
  schemaFacts,
  signatureFor,
  SITE_ORIGIN,
  SITE_URL,
  SUPABASE_URL,
  WEBHOOK_SECRET,
  webhookRequest,
} from './billing_fakes.ts';

configureEnv();
const h = installHarness();
const checkout = await loadFunction('create-checkout');
const portal = await loadFunction('customer-portal');
const webhook = await loadFunction('stripe-webhook');
const common = await import('../_shared/common.ts');

// ------------------------------------------------------------------ helpers
type Fn = (req: Request) => Promise<Response>;

async function call(fn: Fn, opts: Parameters<typeof fnRequest>[1] = {}) {
  const res = await fn(fnRequest('fn', opts));
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch { /* plain text */ }
  return { res, body };
}

async function deliver(event: unknown, opts: Parameters<typeof webhookRequest>[1] = {}) {
  const res = await webhook(await webhookRequest(event, opts));
  return { status: res.status, text: await res.text() };
}

const priceFor = (plan: 'beginner' | 'advanced') => (plan === 'advanced' ? PRICE_ADVANCED : PRICE_BEGINNER);
const customersOf = (user: FakeUser) => h.db.rows('customers').filter((r) => r.user_id === user.id);
const subsOf = (user: FakeUser) => h.db.rows('subscriptions').filter((r) => r.user_id === user.id);
const stripeCustomersOf = (user: FakeUser) => [...h.stripe.customers.values()].filter((c) => c.metadata?.user_id === user.id);
const sessionsOf = (user: FakeUser) => h.stripe.checkoutSessions.filter((s) => s.client_reference_id === user.id);
const eventRow = (id: string) => h.db.rows('stripe_events').find((r) => r.id === id);
const isoFromUnix = (s: number) => new Date(s * 1000).toISOString();
const logsSince = (n: number) => logs.slice(n).map((l) => `${l.level}: ${l.text}`).join('\n');

/** A member with a Stripe customer + subscription and the matching database rows. */
function seedSubscriber(
  plan: 'beginner' | 'advanced',
  status = 'active',
  opts: { customerRow?: boolean; subscriptionRow?: boolean } = {},
) {
  const user = h.auth.addUser();
  const cus = h.stripe.createCustomer(user.email, { user_id: user.id });
  const sub = h.stripe.createSubscription({ customer: cus.id, price: priceFor(plan), status, metadata: { user_id: user.id, plan } });
  if (opts.customerRow !== false) h.db.seed('customers', { user_id: user.id, stripe_customer_id: cus.id });
  if (opts.subscriptionRow !== false) {
    h.db.seed('subscriptions', {
      id: sub.id,
      user_id: user.id,
      status,
      plan,
      price_id: priceFor(plan),
      current_period_end: isoFromUnix(sub.current_period_end),
      cancel_at_period_end: false,
    });
  }
  return { user, cus, sub };
}

/** Subscription event payload as Stripe would send it (current state of the subscription). */
const subEvent = (type: string, subId: string, opts: { id?: string } = {}) =>
  makeEvent(type, h.stripe.render(h.stripe.subscriptions.get(subId)!, '2025-02-24.acacia'), opts);

// ================================================================== harness fidelity
// The fakes are driven through the real supabase-js client to make sure they behave like
// PostgREST for every call shape the functions use.
Deno.test('harness: fake PostgREST honours upsert / unique / check / FK / maybeSingle semantics', async () => {
  const a = h.auth.addUser();
  const b = h.auth.addUser();
  const db = common.admin;
  assertEquals((await db.from('customers').upsert({ user_id: a.id, stripe_customer_id: 'cus_fid_a' }, { onConflict: 'user_id' })).error, null);
  assertEquals((await db.from('customers').upsert({ user_id: a.id, stripe_customer_id: 'cus_fid_a2' }, { onConflict: 'user_id' })).error, null);
  assertEquals(customersOf(a).map((c) => c.stripe_customer_id), ['cus_fid_a2'], 'merge-duplicates updates the row');
  await db.from('customers').upsert({ user_id: a.id, stripe_customer_id: 'cus_fid_a3' }, { onConflict: 'user_id', ignoreDuplicates: true });
  assertEquals(customersOf(a).map((c) => c.stripe_customer_id), ['cus_fid_a2'], 'ignore-duplicates keeps the row');
  const dup = await db.from('customers').upsert({ user_id: b.id, stripe_customer_id: 'cus_fid_a2' }, { onConflict: 'user_id' });
  assertEquals(dup.error?.code, '23505', 'other unique constraints still apply');
  const dupIgnored = await db.from('customers').upsert({ user_id: b.id, stripe_customer_id: 'cus_fid_a2' }, { onConflict: 'user_id', ignoreDuplicates: true });
  assertEquals(dupIgnored.error?.code, '23505', 'DO NOTHING only covers the arbiter');
  assertEquals((await db.from('customers').upsert({ user_id: b.id, stripe_customer_id: 'x' }, { onConflict: 'created_at' })).error?.code, '42P10');

  const base = { user_id: a.id, plan: 'beginner', price_id: 'p' };
  assertEquals((await db.from('subscriptions').insert({ ...base, id: 'sub_fid0', status: 'bogus' })).error?.code, '23514');
  assertEquals((await db.from('subscriptions').insert({ ...base, id: 'sub_fid0', status: 'active', user_id: crypto.randomUUID() })).error?.code, '23503');
  assertEquals((await db.from('subscriptions').insert({ ...base, id: 'sub_fid0', status: 'active', user_id: 'not-a-uuid' })).error?.code, '22P02');
  assertEquals((await db.from('subscriptions').insert({ ...base, id: 'sub_fid0', status: 'active', nope: 1 })).error?.code, 'PGRST204');
  assertEquals(
    (await db.from('subscriptions').insert([{ ...base, id: 'sub_fid1', status: 'active' }, { ...base, id: 'sub_fid2', status: 'canceled', plan: 'advanced' }])).error,
    null,
  );
  const live = await db.from('subscriptions').select('id, plan, status').eq('user_id', a.id).in('status', ['active', 'trialing', 'past_due'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  assertEquals(live.data, { id: 'sub_fid1', plan: 'beginner', status: 'active' });
  const newest = await db.from('subscriptions').select('id').eq('user_id', a.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  assertEquals(newest.data, { id: 'sub_fid2' });
  assertEquals((await db.from('subscriptions').select('id').eq('user_id', a.id).maybeSingle()).error?.code, 'PGRST116');
  const none = await db.from('subscriptions').select('id').eq('user_id', b.id).maybeSingle();
  assertEquals([none.data, none.error], [null, null]);
  assertEquals((await db.from('subscriptions').select('nope').eq('user_id', a.id)).error?.code, '42703');
  const upd = await db.from('subscriptions').update({ status: 'past_due' }).eq('id', 'sub_fid1').select('status, updated_at, created_at');
  assertEquals(upd.data?.[0].status, 'past_due');
  assert(upd.data![0].updated_at > upd.data![0].created_at, 'updated_at trigger');

  // access_level() over RPC as the signed-in user (SECURITY INVOKER: the caller's rows only).
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${a.token}` } },
  });
  assertEquals((await asUser.rpc('access_level')).data, 'beginner');
  await db.from('access_grants').insert({ user_id: a.id, plan: 'advanced', expires_at: new Date(Date.now() - 1000).toISOString() });
  assertEquals((await asUser.rpc('access_level')).data, 'beginner', 'expired grant ignored');
  await db.from('access_grants').insert({ user_id: a.id, plan: 'advanced', note: 'tester' });
  assertEquals((await asUser.rpc('access_level')).data, 'advanced');
});

// ================================================================== CORS
Deno.test('CORS: preflight from the SITE_URL origin (sub-path site) and ALLOWED_ORIGINS is echoed', async () => {
  for (const fn of [checkout, portal]) {
    for (const origin of [SITE_ORIGIN, LOCAL_ORIGIN, PREVIEW_ORIGIN]) {
      const { res } = await call(fn, { method: 'OPTIONS', origin });
      assertEquals(res.status, 200);
      assertEquals(res.headers.get('Access-Control-Allow-Origin'), origin);
      assertEquals(res.headers.get('Vary'), 'Origin');
      assertStringIncludes(res.headers.get('Access-Control-Allow-Methods')!, 'POST');
      const allowed = res.headers.get('Access-Control-Allow-Headers')!.toLowerCase();
      for (const header of ['authorization', 'apikey', 'content-type', 'x-client-info']) assertStringIncludes(allowed, header);
    }
  }
});

Deno.test('CORS: disallowed origins never get themselves (or *) back', async () => {
  const bad = [
    'https://evil.example',
    'https://example.github.io.evil.example',
    'http://example.github.io', // scheme differs from SITE_URL
    'https://example.github.io:8443',
    'http://localhost:5174',
    'null',
    '',
  ];
  for (const fn of [checkout, portal]) {
    for (const origin of bad) {
      const { res } = await call(fn, { method: 'OPTIONS', origin });
      assertEquals(res.headers.get('Access-Control-Allow-Origin'), SITE_ORIGIN, `origin ${origin}`);
    }
  }
});

Deno.test('CORS: error responses (401, 405) carry CORS headers so the browser can read them', async () => {
  const user = h.auth.addUser();
  for (const fn of [checkout, portal]) {
    const noAuth = await call(fn, { origin: LOCAL_ORIGIN, body: { plan: 'beginner' } });
    assertEquals(noAuth.res.status, 401);
    assertEquals(noAuth.res.headers.get('Access-Control-Allow-Origin'), LOCAL_ORIGIN);
    assertEquals(noAuth.res.headers.get('Content-Type'), 'application/json');
    const get = await call(fn, { method: 'GET', origin: SITE_ORIGIN, token: user.token });
    assertEquals(get.res.status, 405);
    assertEquals(get.res.headers.get('Access-Control-Allow-Origin'), SITE_ORIGIN);
  }
});

// ================================================================== returnTo handling
Deno.test('returnBase: allow-listed bases are normalised and used; everything else falls back to SITE_URL', () => {
  assertEquals(common.SITE_URL, SITE_URL);
  const cases: [unknown, string][] = [
    [SITE_URL, SITE_URL],
    [`${SITE_URL}index.html`, SITE_URL],
    [`${SITE_URL}index.html?ref=nav#pricing`, SITE_URL],
    [`${SITE_URL}?checkout=cancel#pricing`, SITE_URL],
    ['https://example.github.io/The-Trade-School', SITE_URL],
    ['https://EXAMPLE.github.io:443/The-Trade-School/', SITE_URL],
    [`${LOCAL_ORIGIN}/`, `${LOCAL_ORIGIN}/`],
    [`${LOCAL_ORIGIN}/index.html`, `${LOCAL_ORIGIN}/`],
    [`${LOCAL_ORIGIN}`, `${LOCAL_ORIGIN}/`],
    [`${PREVIEW_ORIGIN}/app/index.html#x`, `${PREVIEW_ORIGIN}/app/`],
    // foreign / dangerous → SITE_URL
    ['https://evil.example/The-Trade-School/', SITE_URL],
    ['https://example.github.io.evil.example/', SITE_URL],
    ['http://example.github.io/The-Trade-School/', SITE_URL],
    ['//evil.example/', SITE_URL],
    ['/The-Trade-School/', SITE_URL],
    ['javascript:alert(document.cookie)', SITE_URL],
    ['JavaScript://example.github.io/%0Aalert(1)', SITE_URL],
    ['data:text/html,<script>alert(1)</script>', SITE_URL],
    ['blob:https://example.github.io/3f1c1c9e-1f7a-4b0e-9f7c-1f2e3d4c5b6a', SITE_URL],
    ['blob:http://localhost:5173/3f1c1c9e-1f7a-4b0e-9f7c-1f2e3d4c5b6a', SITE_URL],
    ['not a url', SITE_URL],
    ['', SITE_URL],
    [42, SITE_URL],
    [null, SITE_URL],
    [undefined, SITE_URL],
    [{ toString: () => SITE_URL }, SITE_URL],
    [['https://evil.example/'], SITE_URL],
  ];
  for (const [input, expected] of cases) {
    assertEquals(common.returnBase(input), expected, `returnBase(${Deno.inspect(input)})`);
  }
});

Deno.test('returnBase: credentials in an allow-listed URL are dropped', () => {
  const base = common.returnBase('https://attacker:pw@example.github.io/The-Trade-School/');
  assertEquals(new URL(base).username, '');
  assertEquals(new URL(base).password, '');
  assertEquals(new URL(base).origin, SITE_ORIGIN);
});

// ================================================================== auth + input validation
Deno.test('auth: missing, empty, malformed or unknown bearer tokens get 401 and touch nothing', async () => {
  const gone = h.auth.addUser();
  h.auth.deleteUser(gone.id);
  const stripeBefore = h.stripe.requests.length;
  const dbBefore = h.db.requests.length;
  const variants: Parameters<typeof fnRequest>[1][] = [
    { body: { plan: 'beginner' } },
    { authorization: '', body: { plan: 'beginner' } },
    { authorization: 'Bearer ', body: { plan: 'beginner' } },
    { authorization: 'Bearer not-a-real-token', body: { plan: 'beginner' } },
    { authorization: 'Basic dXNlcjpwYXNz', body: { plan: 'beginner' } },
    { token: gone.token, body: { plan: 'beginner' } },
    { token: 'bogus', body: { plan: 'nonsense' } }, // auth is checked before the plan
  ];
  for (const fn of [checkout, portal]) {
    for (const v of variants) {
      const { res, body } = await call(fn, v);
      assertEquals(res.status, 401, Deno.inspect(v));
      assertMatch(body.error, /Sign in/);
    }
  }
  assertEquals(h.stripe.requests.length, stripeBefore);
  assertEquals(h.db.requests.length, dbBefore);
});

Deno.test('create-checkout: bad plan or body → 400 without calling Stripe', async () => {
  const user = h.auth.addUser();
  const before = h.stripe.requests.length;
  const bodies: Parameters<typeof fnRequest>[1][] = [
    { body: {} },
    { body: { plan: 'pro' } },
    { body: { plan: 'Beginner' } },
    { body: { plan: ['beginner'] } },
    { body: { plan: '__proto__' } },
    { body: { plan: 'constructor' } },
    { rawBody: 'not json' },
    { rawBody: '' },
    { rawBody: 'null' },
    { rawBody: '"beginner"' },
  ];
  for (const b of bodies) {
    const { res, body } = await call(checkout, { token: user.token, ...b });
    assertEquals(res.status, 400, Deno.inspect(b));
    assertMatch(body.error, /Beginner or Advanced/);
  }
  assertEquals(h.stripe.requests.length, before);
  assertEquals(customersOf(user).length, 0);
});

// ================================================================== create-checkout: new customers
Deno.test('create-checkout: new user → one Stripe customer, customers row, correct Checkout Session', async () => {
  const user = h.auth.addUser('new.member@example.com');
  const { res, body } = await call(checkout, {
    token: user.token,
    body: { plan: 'beginner', returnTo: `${SITE_URL}index.html?ref=paywall#pricing` },
  });
  assertEquals(res.status, 200, Deno.inspect(body));
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), SITE_ORIGIN);

  const creates = h.stripe.calls('POST', '/v1/customers').filter((r) => r.params.metadata?.user_id === user.id);
  assertEquals(creates.length, 1);
  assertEquals(creates[0].idempotencyKey, `tts-customer-${user.id}`);
  assertEquals(creates[0].params.email, 'new.member@example.com');
  const [cus] = stripeCustomersOf(user);
  assertEquals(customersOf(user).map((r) => r.stripe_customer_id), [cus.id]);

  const [session] = sessionsOf(user);
  assertEquals(body, { url: session.url });
  assertEquals(session.mode, 'subscription');
  assertEquals(session.customer, cus.id);
  assertEquals(session.client_reference_id, user.id);
  assertEquals(session.line_items, [{ price: PRICE_BEGINNER, quantity: '1' }]);
  assertEquals(session.subscription_data, { metadata: { user_id: user.id, plan: 'beginner' } });
  assertEquals(session.success_url, `${SITE_URL}?checkout=success#account`);
  assertEquals(session.cancel_url, `${SITE_URL}?checkout=cancel#pricing`);
  assertEquals(session.allow_promotion_codes, 'true');
});

Deno.test('create-checkout: advanced plan uses the advanced price; localhost returnTo is honoured; foreign one is not', async () => {
  const user = h.auth.addUser();
  const a = await call(checkout, { origin: LOCAL_ORIGIN, token: user.token, body: { plan: 'advanced', returnTo: `${LOCAL_ORIGIN}/index.html` } });
  assertEquals(a.res.status, 200);
  assertEquals(a.res.headers.get('Access-Control-Allow-Origin'), LOCAL_ORIGIN);
  let session = sessionsOf(user).at(-1);
  assertEquals(session.line_items[0].price, PRICE_ADVANCED);
  assertEquals(session.subscription_data.metadata.plan, 'advanced');
  assertEquals(session.success_url, `${LOCAL_ORIGIN}/?checkout=success#account`);
  assertEquals(session.cancel_url, `${LOCAL_ORIGIN}/?checkout=cancel#pricing`);

  for (const returnTo of ['https://evil.example/', 'javascript:alert(1)', 'blob:https://example.github.io/x', '%%%']) {
    const other = h.auth.addUser(); // a fresh user: the first one's open session would be resumed
    const b = await call(checkout, { token: other.token, body: { plan: 'advanced', returnTo } });
    assertEquals(b.res.status, 200, `${returnTo}: ${Deno.inspect(b.body)}`);
    session = sessionsOf(other).at(-1);
    assertEquals(session.success_url, `${SITE_URL}?checkout=success#account`, returnTo);
  }
  // Only ever one customer for this user.
  assertEquals(stripeCustomersOf(user).length, 1);
  assertEquals(customersOf(user).length, 1);
});

Deno.test('create-checkout: returning user (abandoned checkout) reuses the customer', async () => {
  const user = h.auth.addUser();
  assertEquals((await call(checkout, { token: user.token, body: { plan: 'beginner' } })).res.status, 200);
  const createsBefore = h.stripe.calls('POST', '/v1/customers').length;
  assertEquals((await call(checkout, { token: user.token, body: { plan: 'advanced' } })).res.status, 200);
  assertEquals(h.stripe.calls('POST', '/v1/customers').length, createsBefore);
  const sessions = sessionsOf(user);
  assertEquals(sessions.length, 2);
  assertEquals(sessions[0].customer, sessions[1].customer);
  // The abandoned Beginner session was expired, so the two can never both be paid.
  assertEquals(sessions.map((s) => s.status), ['expired', 'open']);
});

Deno.test('create-checkout: concurrent double/triple click → still one Stripe customer and one customers row', async () => {
  const user = h.auth.addUser();
  const stats = { ...h.stripe.idempotencyStats };
  const results = await Promise.all([
    call(checkout, { token: user.token, body: { plan: 'beginner' } }),
    call(checkout, { token: user.token, body: { plan: 'beginner' } }),
    call(checkout, { token: user.token, body: { plan: 'beginner' } }),
  ]);
  for (const r of results) assertEquals(r.res.status, 200, Deno.inspect(r.body));
  assertEquals(stripeCustomersOf(user).length, 1);
  assertEquals(customersOf(user).length, 1);
  const customers = new Set(sessionsOf(user).map((s) => s.customer));
  assertEquals([...customers], [stripeCustomersOf(user)[0].id]);
  // The losers of the race were answered by Stripe's idempotency layer (409 in flight → retried).
  const creates = h.stripe.calls('POST', '/v1/customers').filter((r) => r.idempotencyKey === `tts-customer-${user.id}`);
  assert(creates.length >= 3, `expected the racing creates to reach Stripe, got ${creates.length}`);
  assert(h.stripe.idempotencyStats.inFlightConflicts > stats.inFlightConflicts, 'the race hit an in-flight idempotency key');
  assert(h.stripe.idempotencyStats.replays > stats.replays, 'the SDK retried and got the replayed customer');
});

Deno.test('create-checkout: DB write failure after creating the customer → 500, and the retry reuses the same customer', async () => {
  const user = h.auth.addUser();
  const n = logs.length;
  h.db.failNext('POST', 'customers');
  const first = await call(checkout, { token: user.token, body: { plan: 'beginner' } });
  assertEquals(first.res.status, 500);
  assertEquals(first.body, { error: 'Checkout could not start. Please try again.' });
  assertStringIncludes(logsSince(n), 'create-checkout failed');
  assertEquals(sessionsOf(user).length, 0);

  const second = await call(checkout, { token: user.token, body: { plan: 'beginner' } });
  assertEquals(second.res.status, 200);
  assertEquals(stripeCustomersOf(user).length, 1);
  assertEquals(customersOf(user).length, 1);
});

Deno.test('create-checkout: canceled / expired / unpaid history does not block a new checkout', async () => {
  // ('incomplete' is resumable instead, see the tests below.)
  for (const status of ['canceled', 'incomplete_expired', 'unpaid', 'paused']) {
    const { user, cus } = seedSubscriber('advanced', status);
    const { res, body } = await call(checkout, { token: user.token, body: { plan: 'beginner' } });
    assertEquals(res.status, 200, `${status}: ${Deno.inspect(body)}`);
    const session = sessionsOf(user).at(-1);
    assertExists(session, status);
    assertEquals(session.customer, cus.id, status);
    assertEquals(stripeCustomersOf(user).length, 1, status);
  }
});

// ================================================================== create-checkout: duplicate protection
const checkoutCreates = (user: FakeUser) =>
  h.stripe.calls('POST', '/v1/checkout/sessions').filter((r) => r.params.client_reference_id === user.id);

Deno.test('create-checkout: a second click resumes the open session for that plan (no new session)', async () => {
  const user = h.auth.addUser();
  const first = await call(checkout, { token: user.token, body: { plan: 'beginner' } });
  assertEquals(first.res.status, 200);
  const second = await call(checkout, { token: user.token, body: { plan: 'beginner' } });
  assertEquals(second.res.status, 200);
  assertEquals(second.body, { url: first.body.url, resumed: true });
  assertEquals(sessionsOf(user).length, 1);
  assertEquals(checkoutCreates(user).length, 1);
  assertEquals(sessionsOf(user)[0].metadata, { user_id: user.id, plan: 'beginner' });
});

Deno.test('create-checkout: concurrent double/triple click → one Checkout Session (idempotency key)', async () => {
  const user = h.auth.addUser();
  const cus = h.stripe.createCustomer(user.email, { user_id: user.id });
  h.db.seed('customers', { user_id: user.id, stripe_customer_id: cus.id });
  const results = await Promise.all([1, 2, 3].map(() => call(checkout, { token: user.token, body: { plan: 'advanced' } })));
  for (const r of results) assertEquals(r.res.status, 200, Deno.inspect(r.body));
  assertEquals(new Set(results.map((r) => r.body.url)).size, 1, 'every click gets the same session');
  assertEquals(sessionsOf(user).length, 1);
  const keys = checkoutCreates(user).map((r) => r.idempotencyKey);
  assert(keys.length >= 1);
  assertEquals(new Set(keys).size, 1, 'all creates used one key');
  assertMatch(keys[0]!, new RegExp(`^tts-checkout-${user.id}-[0-9a-f]{32}$`));
});

Deno.test('create-checkout: the idempotency key changes with the time window, plan and return base', async () => {
  const user = h.auth.addUser();
  const keyFor = async (plan: string, returnTo?: string) => {
    const before = checkoutCreates(user).length;
    // Expire whatever is open so the next request has to create.
    for (const s of sessionsOf(user)) if (s.status === 'open') s.status = 'expired';
    const r = await call(checkout, { token: user.token, body: { plan, returnTo } });
    assertEquals(r.res.status, 200, Deno.inspect(r.body));
    assertEquals(checkoutCreates(user).length, before + 1);
    return checkoutCreates(user).at(-1)!.idempotencyKey;
  };
  const a = await keyFor('beginner');
  const b = await keyFor('advanced');
  const c = await keyFor('beginner', `${LOCAL_ORIGIN}/`);
  assertEquals(new Set([a, b, c]).size, 3);
  // Same parameters in the same window → same key: Stripe replays the first session.
  const replays = h.stripe.idempotencyStats.replays;
  assertEquals(await keyFor('beginner'), a);
  assert(h.stripe.idempotencyStats.replays > replays);
  // …but never across windows.
  const realNow = Date.now;
  Date.now = () => realNow() + 10 * 60_000;
  try {
    assertNotEquals(await keyFor('beginner'), a);
  } finally {
    Date.now = realNow;
  }
});

Deno.test('create-checkout: switching plan mid-checkout expires the other session; switching back never replays an expired one', async () => {
  const user = h.auth.addUser();
  const b1 = await call(checkout, { token: user.token, body: { plan: 'beginner' } });
  const a1 = await call(checkout, { token: user.token, body: { plan: 'advanced' } });
  const b2 = await call(checkout, { token: user.token, body: { plan: 'beginner' } });
  for (const r of [b1, a1, b2]) assertEquals(r.res.status, 200, Deno.inspect(r.body));
  const sessions = sessionsOf(user);
  assertEquals(sessions.map((s) => [s.metadata.plan, s.status]), [['beginner', 'expired'], ['advanced', 'expired'], ['beginner', 'open']]);
  assertEquals(b2.body.url, sessions[2].url);
  assertNotEquals(b2.body.url, b1.body.url);
  // Only the open one can still be paid.
  h.stripe.completeCheckout(sessions[2].id);
  let threw = false;
  try {
    h.stripe.completeCheckout(sessions[1].id);
  } catch {
    threw = true;
  }
  assert(threw, 'an expired session cannot be completed');
});

Deno.test('create-checkout: an unpaid (incomplete) subscription for the same plan resumes its invoice', async () => {
  const { user, sub } = seedSubscriber('beginner', 'incomplete');
  const r = await call(checkout, { token: user.token, body: { plan: 'beginner' } });
  assertEquals(r.res.status, 200, Deno.inspect(r.body));
  assertEquals(r.body, { url: sub.invoice.hosted_invoice_url, resumed: true });
  assertEquals(sessionsOf(user).length, 0);
  assertEquals(h.stripe.calls('GET', '/v1/subscriptions').at(-1)!.params.expand, ['data.latest_invoice']);
});

Deno.test('create-checkout: an incomplete subscription for the other plan (or still processing) → 409, no new session', async () => {
  const { user } = seedSubscriber('advanced', 'incomplete');
  const r = await call(checkout, { token: user.token, body: { plan: 'beginner' } });
  assertEquals(r.res.status, 409);
  assertMatch(r.body.error, /Advanced subscription payment is still pending/);
  assertEquals(sessionsOf(user).length, 0);

  const other = seedSubscriber('beginner', 'incomplete');
  other.sub.invoice.status = 'draft'; // payment processing: nothing to pay right now
  const p = await call(checkout, { token: other.user.token, body: { plan: 'beginner' } });
  assertEquals(p.res.status, 409);
  assertMatch(p.body.error, /still processing/);
  assertEquals(sessionsOf(other.user).length, 0);
});

Deno.test('create-checkout: Stripe list failure → 500 and no session is created', async () => {
  const { user } = seedSubscriber('beginner', 'canceled');
  // Enough failures to outlast the SDK's own retries.
  for (let i = 0; i < 5; i++) h.stripe.failNext('GET', /^\/v1\/checkout\/sessions$/, 500, 'api_error', 'boom');
  const r = await call(checkout, { token: user.token, body: { plan: 'beginner' } });
  h.stripe.failures = [];
  assertEquals(r.res.status, 500);
  assertEquals(sessionsOf(user).length, 0);
});

// ================================================================== create-checkout: existing members
Deno.test('create-checkout: member asking for their current plan gets the billing portal (active/trialing/past_due)', async () => {
  for (const status of ['active', 'trialing', 'past_due']) {
    const { user, cus, sub } = seedSubscriber('beginner', status);
    const { res, body } = await call(checkout, { token: user.token, body: { plan: 'beginner', returnTo: `${LOCAL_ORIGIN}/` } });
    assertEquals(res.status, 200, status);
    const ps = h.stripe.portalSessions.at(-1);
    assertEquals(body, { url: ps.url });
    assertEquals(ps.customer, cus.id);
    assertEquals(ps.return_url, `${LOCAL_ORIGIN}/#account`);
    assertEquals(sessionsOf(user).length, 0, 'no new checkout');
    assertEquals(h.stripe.subscriptions.get(sub.id)!.updates.length, 0, 'no subscription change');
  }
});

Deno.test('create-checkout: beginner → advanced switches the subscription price with proration (no new checkout)', async () => {
  const { user, sub } = seedSubscriber('beginner');
  h.stripe.subscriptions.get(sub.id)!.cancel_at_period_end = true; // member had scheduled a cancel
  h.stripe.subscriptions.get(sub.id)!.metadata.extra = 'kept';
  const customersBefore = h.stripe.customers.size;
  const { res, body } = await call(checkout, { token: user.token, body: { plan: 'advanced' } });
  assertEquals(res.status, 200, Deno.inspect(body));
  assertEquals(body, { switched: true, plan: 'advanced' });

  const stored = h.stripe.subscriptions.get(sub.id)!;
  assertEquals(stored.updates.length, 1);
  const upd = stored.updates[0];
  assertEquals(upd.items, [{ id: stored.items[0].id, price: PRICE_ADVANCED }]);
  assertEquals(upd.proration_behavior, 'create_prorations');
  assertEquals(upd.cancel_at_period_end, 'false');
  assertEquals(stored.items.length, 1, 'price replaced, not a second item');
  assertEquals(stored.items[0].price, PRICE_ADVANCED);
  assertEquals(stored.cancel_at_period_end, false);
  assertEquals(stored.metadata, { user_id: user.id, plan: 'advanced', extra: 'kept' });
  assertEquals(sessionsOf(user).length, 0);
  assertEquals(h.stripe.customers.size, customersBefore);

  // The webhook then brings the database (and access level) in line.
  assertEquals(h.db.accessLevel(user.id), 'beginner');
  const r = await deliver(subEvent('customer.subscription.updated', sub.id));
  assertEquals(r.status, 200, r.text);
  const [row] = subsOf(user);
  assertEquals(row.plan, 'advanced');
  assertEquals(row.price_id, PRICE_ADVANCED);
  assertEquals(row.cancel_at_period_end, false);
  assertEquals(h.db.accessLevel(user.id), 'advanced');
});

Deno.test('create-checkout: advanced → beginner downgrade also switches in place', async () => {
  const { user, sub } = seedSubscriber('advanced', 'past_due');
  const { res, body } = await call(checkout, { token: user.token, body: { plan: 'beginner' } });
  assertEquals(res.status, 200);
  assertEquals(body, { switched: true, plan: 'beginner' });
  assertEquals(h.stripe.subscriptions.get(sub.id)!.items[0].price, PRICE_BEGINNER);
});

Deno.test('create-checkout: newest live subscription wins when there are several rows', async () => {
  const { user, cus } = seedSubscriber('advanced', 'canceled');
  const live = h.stripe.createSubscription({ customer: cus.id, price: PRICE_BEGINNER, metadata: { user_id: user.id } });
  h.db.seed('subscriptions', { id: live.id, user_id: user.id, status: 'active', plan: 'beginner', price_id: PRICE_BEGINNER });
  const { body } = await call(checkout, { token: user.token, body: { plan: 'advanced' } });
  assertEquals(body, { switched: true, plan: 'advanced' });
  assertEquals(h.stripe.subscriptions.get(live.id)!.items[0].price, PRICE_ADVANCED);
});

Deno.test('create-checkout: same plan but customers row missing → portal for the subscription\'s customer, not a fake "switch"', async () => {
  const { user, cus, sub } = seedSubscriber('beginner', 'active', { customerRow: false });
  const { res, body } = await call(checkout, { token: user.token, body: { plan: 'beginner' } });
  assertEquals(res.status, 200, Deno.inspect(body));
  assertEquals(h.stripe.subscriptions.get(sub.id)!.updates.length, 0, 'must not "switch" to the plan the member already has');
  const ps = h.stripe.portalSessions.at(-1);
  assertEquals(body, { url: ps.url });
  assertEquals(ps.customer, cus.id);
});

Deno.test('create-checkout: DB says active but Stripe says canceled → 500 (no duplicate checkout), logged', async () => {
  const { user, sub } = seedSubscriber('beginner', 'active');
  h.stripe.setStatus(sub.id, 'canceled');
  const n = logs.length;
  const { res } = await call(checkout, { token: user.token, body: { plan: 'advanced' } });
  assertEquals(res.status, 500);
  assertStringIncludes(logsSince(n), 'create-checkout failed');
  assertEquals(sessionsOf(user).length, 0);
});

// ================================================================== customer-portal
Deno.test('customer-portal: never-subscribed user → 404 and no Stripe call', async () => {
  const user = h.auth.addUser();
  const before = h.stripe.requests.length;
  const { res, body } = await call(portal, { token: user.token, body: {} });
  assertEquals(res.status, 404);
  assertMatch(body.error, /no billing history/);
  assertEquals(h.stripe.requests.length, before);
});

Deno.test('customer-portal: member gets a portal URL; return_url follows returnTo rules', async () => {
  const { user, cus } = seedSubscriber('advanced');
  const cases: [unknown, string][] = [
    [`${SITE_URL}index.html`, `${SITE_URL}#account`],
    [`${LOCAL_ORIGIN}/`, `${LOCAL_ORIGIN}/#account`],
    ['https://evil.example/', `${SITE_URL}#account`],
    ['javascript:alert(1)', `${SITE_URL}#account`],
    [undefined, `${SITE_URL}#account`],
  ];
  for (const [returnTo, expected] of cases) {
    const { res, body } = await call(portal, { token: user.token, body: { returnTo } });
    assertEquals(res.status, 200);
    const ps = h.stripe.portalSessions.at(-1);
    assertEquals(body, { url: ps.url });
    assertEquals(ps.customer, cus.id);
    assertEquals(ps.return_url, expected, String(returnTo));
  }
  // Malformed body is tolerated.
  const raw = await call(portal, { token: user.token, rawBody: '{oops' });
  assertEquals(raw.res.status, 200);
  assertEquals(h.stripe.portalSessions.at(-1).return_url, `${SITE_URL}#account`);
});

Deno.test('customer-portal: Stripe error → 500 with a friendly message, logged', async () => {
  const { user } = seedSubscriber('beginner');
  h.stripe.failNext('POST', /billing_portal/, 400, 'invalid_request_error', 'No configuration provided');
  const n = logs.length;
  const { res, body } = await call(portal, { token: user.token, body: {} });
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'The billing page could not open. Please try again.' });
  assertStringIncludes(logsSince(n), 'customer-portal failed');
});

// ================================================================== webhook: authentication
Deno.test('webhook: missing / invalid / expired / tampered signatures → 400, nothing written', async () => {
  const { user, sub } = seedSubscriber('beginner', 'active', { subscriptionRow: false });
  const event = subEvent('customer.subscription.created', sub.id);
  const payload = JSON.stringify(event);
  const good = await signatureFor(payload);
  const old = await signatureFor(payload, { timestamp: Math.floor(Date.now() / 1000) - 10 * 60 });
  const wrong = await signatureFor(payload, { secret: 'whsec_wrong' });
  const retrieveBefore = h.stripe.calls('GET', /^\/v1\/subscriptions\//).length;

  const variants: [string, Parameters<typeof webhookRequest>[1]][] = [
    ['missing', { signature: null }],
    ['empty', { signature: '' }],
    ['garbage', { signature: 'garbage' }],
    ['wrong secret', { signature: wrong }],
    ['expired (10 min old)', { signature: old }],
    ['tampered body', { signature: good, body: payload.replace(user.id, crypto.randomUUID()) }],
    ['v0 scheme only', { signature: good.replace('v1=', 'v0=') }],
  ];
  for (const [name, opts] of variants) {
    const r = await deliver(payload, opts);
    assertEquals(r.status, 400, name);
  }
  assertEquals(subsOf(user).length, 0);
  assertEquals(eventRow(event.id), undefined);
  assertEquals(h.stripe.calls('GET', /^\/v1\/subscriptions\//).length, retrieveBefore);

  // Secret rotation: a header carrying an old and the current signature is accepted.
  const rotated = `${good},v1=${'0'.repeat(64)}`;
  assertEquals((await deliver(payload, { signature: rotated })).status, 200);
  assertEquals(subsOf(user).length, 1);
});

Deno.test('webhook: non-POST → 405', async () => {
  const res = await webhook(new Request('http://functions.local/stripe-webhook', { method: 'GET' }));
  assertEquals(res.status, 405);
  await res.body?.cancel();
});

// ================================================================== webhook: checkout + user resolution
Deno.test('webhook: full checkout flow → subscriptions row (plan from price, status, period end), access level', async () => {
  const user = h.auth.addUser();
  await call(checkout, { token: user.token, body: { plan: 'advanced' } });
  const [session] = sessionsOf(user);
  const { session: completed, subscription } = h.stripe.completeCheckout(session.id);
  const event = makeEvent('checkout.session.completed', completed);
  const r = await deliver(event);
  assertEquals(r.status, 200, r.text);
  assertEquals(JSON.parse(r.text), { received: true });

  const [row] = subsOf(user);
  assertEquals(row.id, subscription.id);
  assertEquals(row.status, 'active');
  assertEquals(row.plan, 'advanced');
  assertEquals(row.price_id, PRICE_ADVANCED);
  assertEquals(row.current_period_end, isoFromUnix(subscription.current_period_end));
  assertEquals(row.cancel_at_period_end, false);
  assertEquals(customersOf(user).map((c) => c.stripe_customer_id), [session.customer]);
  assertEquals(eventRow(event.id)?.type, 'checkout.session.completed');
  assertEquals(h.db.accessLevel(user.id), 'advanced');

  // The handler re-read the subscription from Stripe (no non-expandable expand params).
  const retrieves = h.stripe.calls('GET', `/v1/subscriptions/${subscription.id}`);
  assert(retrieves.length >= 1);
});

Deno.test('webhook: user resolved from client_reference_id when the subscription has no metadata', async () => {
  const user = h.auth.addUser();
  const cus = h.stripe.createCustomer(user.email); // created outside create-checkout: no metadata, no customers row
  const sub = h.stripe.createSubscription({ customer: cus.id, price: PRICE_BEGINNER });
  const session = { id: 'cs_test_manual', object: 'checkout.session', mode: 'subscription', customer: cus.id, client_reference_id: user.id, subscription: sub.id };
  const r = await deliver(makeEvent('checkout.session.completed', session));
  assertEquals(r.status, 200, r.text);
  assertEquals(subsOf(user).map((s) => [s.id, s.plan, s.status]), [[sub.id, 'beginner', 'active']]);
  assertEquals(customersOf(user).map((c) => c.stripe_customer_id), [cus.id], 'webhook completes the customer mapping');
});

Deno.test('webhook: user resolved via the customers table when there is no metadata or hint', async () => {
  const user = h.auth.addUser();
  const cus = h.stripe.createCustomer(user.email);
  h.db.seed('customers', { user_id: user.id, stripe_customer_id: cus.id });
  const sub = h.stripe.createSubscription({ customer: cus.id, price: PRICE_ADVANCED });
  const r = await deliver(subEvent('customer.subscription.created', sub.id));
  assertEquals(r.status, 200, r.text);
  assertEquals(subsOf(user).map((s) => s.plan), ['advanced']);
});

Deno.test('webhook: metadata user beats client_reference_id', async () => {
  const owner = h.auth.addUser();
  const other = h.auth.addUser();
  const cus = h.stripe.createCustomer(owner.email, { user_id: owner.id });
  const sub = h.stripe.createSubscription({ customer: cus.id, price: PRICE_BEGINNER, metadata: { user_id: owner.id } });
  const session = { id: 'cs_test_x', object: 'checkout.session', mode: 'subscription', customer: cus.id, client_reference_id: other.id, subscription: sub.id };
  assertEquals((await deliver(makeEvent('checkout.session.completed', session))).status, 200);
  assertEquals(subsOf(owner).length, 1);
  assertEquals(subsOf(other).length, 0);
});

Deno.test('webhook: subscription with no resolvable user → 500 (Stripe retries), logged, not recorded', async () => {
  const cus = h.stripe.createCustomer('stranger@example.com');
  const sub = h.stripe.createSubscription({ customer: cus.id, price: PRICE_BEGINNER });
  const event = subEvent('customer.subscription.created', sub.id);
  const n = logs.length;
  const r = await deliver(event);
  assertEquals(r.status, 500);
  assertStringIncludes(logsSince(n), `No user for subscription ${sub.id}`);
  assertEquals(eventRow(event.id), undefined);
  assertEquals(h.db.rows('subscriptions').filter((s) => s.id === sub.id).length, 0);
});

Deno.test('webhook: checkout.session.completed in payment mode / without subscription is ignored', async () => {
  const before = h.db.rows('subscriptions').length;
  const retrieves = h.stripe.calls('GET', /^\/v1\/subscriptions\//).length;
  const e1 = makeEvent('checkout.session.completed', { id: 'cs_pay', object: 'checkout.session', mode: 'payment', subscription: null });
  const e2 = makeEvent('checkout.session.completed', { id: 'cs_sub', object: 'checkout.session', mode: 'subscription', subscription: null });
  assertEquals((await deliver(e1)).status, 200);
  assertEquals((await deliver(e2)).status, 200);
  assertEquals(h.db.rows('subscriptions').length, before);
  assertEquals(h.stripe.calls('GET', /^\/v1\/subscriptions\//).length, retrieves);
});

Deno.test('webhook: expanded subscription object on the session is handled', async () => {
  const { user, sub } = seedSubscriber('beginner', 'active', { subscriptionRow: false });
  const session = { id: 'cs_exp', object: 'checkout.session', mode: 'subscription', client_reference_id: user.id, subscription: h.stripe.render(sub, '2025-02-24.acacia') };
  assertEquals((await deliver(makeEvent('checkout.session.completed', session))).status, 200);
  assertEquals(subsOf(user).length, 1);
});

Deno.test('webhook: multibyte payloads verify (signature is over the raw UTF-8 body)', async () => {
  const { user, sub } = seedSubscriber('beginner', 'active', { subscriptionRow: false });
  const object = { ...h.stripe.render(sub, '2025-02-24.acacia'), description: 'José – Überweisung 🚀 日本語' };
  const r = await deliver(makeEvent('customer.subscription.created', object));
  assertEquals(r.status, 200, r.text);
  assertEquals(subsOf(user).length, 1);
});

Deno.test('webhook: customer-mapping conflicts never fail the subscription sync', async () => {
  // (a) the user is already mapped to an older customer; (b) the customer is mapped to someone else.
  const { user, sub } = seedSubscriber('beginner', 'active', { subscriptionRow: false });
  const otherCus = h.stripe.createCustomer(user.email);
  const sub2 = h.stripe.createSubscription({ customer: otherCus.id, price: PRICE_ADVANCED, metadata: { user_id: user.id } });
  assertEquals((await deliver(subEvent('customer.subscription.created', sub2.id))).status, 200);
  assertEquals(customersOf(user).length, 1, 'existing mapping kept');

  const intruder = h.auth.addUser();
  const taken = h.stripe.createSubscription({ customer: sub.customer, price: PRICE_BEGINNER, metadata: { user_id: intruder.id } });
  assertEquals((await deliver(subEvent('customer.subscription.created', taken.id))).status, 200);
  assertEquals(subsOf(intruder).length, 1);
  assertEquals(customersOf(intruder).length, 0, 'a customer already mapped to another user is not re-mapped');
});

Deno.test('webhook: a failed customers mapping write → 500 so Stripe retries; the retry completes it', async () => {
  const { user, sub } = seedSubscriber('beginner', 'active', { customerRow: false, subscriptionRow: false });
  const event = subEvent('customer.subscription.created', sub.id);
  h.db.failNext('POST', 'customers');
  const n = logs.length;
  assertEquals((await deliver(event)).status, 500);
  assertStringIncludes(logsSince(n), event.id);
  assertEquals(eventRow(event.id), undefined, 'not recorded as processed');
  assertEquals((await deliver(event)).status, 200);
  assertEquals(customersOf(user).map((r) => r.stripe_customer_id), [sub.customer]);
  assertExists(eventRow(event.id));
});

Deno.test('webhook: a failed stripe_events write → 500 (retried; the sync itself is idempotent)', async () => {
  const { user, sub } = seedSubscriber('beginner', 'active', { subscriptionRow: false });
  const event = subEvent('customer.subscription.created', sub.id);
  h.db.failNext('POST', 'stripe_events');
  assertEquals((await deliver(event)).status, 500);
  assertEquals((await deliver(event)).status, 200);
  assertEquals(subsOf(user).length, 1);
  assertExists(eventRow(event.id));
});

// ================================================================== webhook: period end, plan mapping
Deno.test('webhook: period end read from the item when the API version has no top-level current_period_end', async () => {
  const { user, sub } = seedSubscriber('beginner', 'active', { subscriptionRow: false });
  h.stripe.forceVersion = '2025-08-27.basil';
  try {
    const r = await deliver(subEvent('customer.subscription.created', sub.id));
    assertEquals(r.status, 200, r.text);
  } finally {
    h.stripe.forceVersion = null;
  }
  assertEquals(subsOf(user)[0].current_period_end, isoFromUnix(sub.current_period_end));
});

Deno.test('webhook: a price that is not configured is never mapped by its lookup key prefix → 500, nothing written', async () => {
  // Any price in the account can carry a key like "advanced…": only STRIPE_PRICE_* grant a plan.
  h.stripe.addPrice('price_advanced_2027', 'advanced_monthly_2027', 3499);
  h.stripe.addPrice('price_cheap_test', 'advanced_monthly', 100);
  for (const price of ['price_advanced_2027', 'price_cheap_test']) {
    const { user, sub } = seedSubscriber('advanced', 'active', { subscriptionRow: false });
    h.stripe.setPrice(sub.id, price);
    const n = logs.length;
    assertEquals((await deliver(subEvent('customer.subscription.created', sub.id))).status, 500, price);
    assertStringIncludes(logsSince(n), `Unknown price ${price}`);
    assertEquals(subsOf(user).length, 0, price);
  }
  assertEquals(common.planForPrice(PRICE_ADVANCED), 'advanced');
  assertEquals(common.planForPrice(PRICE_BEGINNER), 'beginner');
  for (const bad of ['', null, undefined, 'advanced_monthly', 'beginner', `${PRICE_ADVANCED} `]) {
    assertEquals(common.planForPrice(bad as string), null, String(bad));
  }
});

Deno.test('webhook: unknown price → 500 so Stripe retries, logged, nothing written', async () => {
  h.stripe.addPrice('price_mystery', null, 100);
  const { user, sub } = seedSubscriber('beginner', 'active', { subscriptionRow: false });
  h.stripe.setPrice(sub.id, 'price_mystery');
  const event = subEvent('customer.subscription.created', sub.id);
  const n = logs.length;
  const r = await deliver(event);
  assertEquals(r.status, 500);
  const logged = logsSince(n);
  assertStringIncludes(logged, 'Unknown price price_mystery');
  assertStringIncludes(logged, event.id);
  assertEquals(subsOf(user).length, 0);
  assertEquals(eventRow(event.id), undefined);
});

// ================================================================== webhook: lifecycle
Deno.test('webhook: subscription.updated plan switch and subscription.deleted → canceled', async () => {
  const { user, sub } = seedSubscriber('beginner');
  h.stripe.setPrice(sub.id, PRICE_ADVANCED);
  assertEquals((await deliver(subEvent('customer.subscription.updated', sub.id))).status, 200);
  assertEquals(subsOf(user).map((s) => [s.plan, s.status]), [['advanced', 'active']]);

  h.stripe.subscriptions.get(sub.id)!.cancel_at_period_end = true;
  assertEquals((await deliver(subEvent('customer.subscription.updated', sub.id))).status, 200);
  assertEquals(subsOf(user)[0].cancel_at_period_end, true);
  assertEquals(h.db.accessLevel(user.id), 'advanced', 'still active until period end');

  h.stripe.setStatus(sub.id, 'canceled');
  assertEquals((await deliver(subEvent('customer.subscription.deleted', sub.id))).status, 200);
  assertEquals(subsOf(user).map((s) => [s.plan, s.status]), [['advanced', 'canceled']]);
  assertEquals(h.db.accessLevel(user.id), 'free');
});

Deno.test('webhook: out-of-order and duplicate events end in Stripe\'s final state', async () => {
  const user = h.auth.addUser();
  await call(checkout, { token: user.token, body: { plan: 'beginner' } });
  const { session, subscription: sub } = h.stripe.completeCheckout(sessionsOf(user)[0].id);
  const completed = makeEvent('checkout.session.completed', session);
  const created = subEvent('customer.subscription.created', sub.id);
  const paid = makeEvent('invoice.paid', { id: 'in_1', object: 'invoice', subscription: sub.id, customer: sub.customer });
  // Member upgrades, then cancels immediately.
  h.stripe.setPrice(sub.id, PRICE_ADVANCED);
  const updated = subEvent('customer.subscription.updated', sub.id);
  h.stripe.setStatus(sub.id, 'canceled');
  const deleted = subEvent('customer.subscription.deleted', sub.id);

  // Deleted first, then stale events, then duplicates (Stripe retries).
  for (const e of [deleted, created, completed, paid, updated, deleted, completed, created]) {
    const r = await deliver(e);
    assertEquals(r.status, 200, `${e.type}: ${r.text}`);
    assertEquals(subsOf(user).map((s) => [s.status, s.plan]), [['canceled', 'advanced']], `after ${e.type}`);
  }
  assertEquals(subsOf(user).length, 1);
  assertEquals(h.db.rows('stripe_events').filter((r) => [completed.id, created.id, paid.id, updated.id, deleted.id].includes(r.id)).length, 5);
  assertEquals(h.db.accessLevel(user.id), 'free');
});

Deno.test('webhook: concurrent deliveries of the same events converge', async () => {
  const { user, sub } = seedSubscriber('beginner', 'active', { subscriptionRow: false });
  const created = subEvent('customer.subscription.created', sub.id);
  const results = await Promise.all([deliver(created), deliver(created), deliver(subEvent('customer.subscription.updated', sub.id))]);
  for (const r of results) assertEquals(r.status, 200, r.text);
  assertEquals(subsOf(user).length, 1);
  assertEquals(h.db.rows('stripe_events').filter((r) => r.id === created.id).length, 1);
});

Deno.test('webhook: a slow delivery holding an older snapshot cannot overwrite a newer one (plan)', async () => {
  const { user, sub } = seedSubscriber('beginner', 'active', { subscriptionRow: false });
  const gate = h.db.gate('POST', 'subscriptions');
  const slow = deliver(subEvent('customer.subscription.created', sub.id)); // reads "beginner", then its write stalls
  await gate.arrived;
  h.stripe.setPrice(sub.id, PRICE_ADVANCED); // member upgrades meanwhile
  const fast = await deliver(subEvent('customer.subscription.updated', sub.id));
  assertEquals(fast.status, 200, fast.text);
  assertEquals(subsOf(user).map((s) => s.plan), ['advanced']);
  gate.open();
  assertEquals((await slow).status, 200);
  assertEquals(subsOf(user).map((s) => [s.plan, s.price_id]), [['advanced', PRICE_ADVANCED]]);
  assertEquals(h.db.accessLevel(user.id), 'advanced');
});

Deno.test('webhook: a paying member is not locked out by a stale "incomplete" snapshot written late', async () => {
  const { user, sub } = seedSubscriber('beginner', 'incomplete', { subscriptionRow: false });
  const gate = h.db.gate('POST', 'subscriptions');
  const slow = deliver(subEvent('customer.subscription.created', sub.id)); // snapshot: incomplete
  await gate.arrived;
  h.stripe.setStatus(sub.id, 'active'); // first invoice paid
  assertEquals((await deliver(subEvent('customer.subscription.updated', sub.id))).status, 200);
  gate.open();
  assertEquals((await slow).status, 200);
  assertEquals(subsOf(user).map((s) => s.status), ['active']);
  assertEquals(h.db.accessLevel(user.id), 'beginner');
});

Deno.test('webhook: invoice.payment_failed → past_due (legacy invoice.subscription shape)', async () => {
  const { user, sub } = seedSubscriber('beginner');
  h.stripe.setStatus(sub.id, 'past_due');
  const invoice = { id: 'in_legacy', object: 'invoice', customer: sub.customer, subscription: sub.id, status: 'open' };
  const r = await deliver(makeEvent('invoice.payment_failed', invoice));
  assertEquals(r.status, 200, r.text);
  assertEquals(subsOf(user)[0].status, 'past_due');
  assertEquals(h.db.accessLevel(user.id), 'beginner', 'past_due keeps access during dunning');

  h.stripe.setStatus(sub.id, 'active');
  assertEquals((await deliver(makeEvent('invoice.paid', { ...invoice, status: 'paid' }))).status, 200);
  assertEquals(subsOf(user)[0].status, 'active');
});

Deno.test('webhook: invoice events from newer API versions (parent.subscription_details) are synced', async () => {
  const { user, sub } = seedSubscriber('advanced');
  h.stripe.setStatus(sub.id, 'past_due');
  const invoice = {
    id: 'in_basil',
    object: 'invoice',
    customer: sub.customer,
    status: 'open',
    parent: { type: 'subscription_details', quote_details: null, subscription_details: { metadata: {}, subscription: sub.id } },
  };
  const r = await deliver(makeEvent('invoice.payment_failed', invoice, { apiVersion: '2025-08-27.basil' }));
  assertEquals(r.status, 200, r.text);
  assertEquals(subsOf(user)[0].status, 'past_due');

  h.stripe.setStatus(sub.id, 'unpaid');
  assertEquals((await deliver(makeEvent('invoice.payment_failed', invoice, { apiVersion: '2025-08-27.basil' }))).status, 200);
  assertEquals(subsOf(user)[0].status, 'unpaid');
  assertEquals(h.db.accessLevel(user.id), 'free');
});

Deno.test('webhook: invoice without a subscription and unhandled event types are acknowledged', async () => {
  const retrieves = h.stripe.calls('GET', /^\/v1\/subscriptions\//).length;
  const one = makeEvent('invoice.paid', { id: 'in_oneoff', object: 'invoice', subscription: null, parent: null });
  const other = makeEvent('customer.created', { id: 'cus_x', object: 'customer' });
  for (const e of [one, other]) {
    const r = await deliver(e);
    assertEquals(r.status, 200);
    assertEquals(eventRow(e.id)?.type, e.type);
  }
  assertEquals(h.stripe.calls('GET', /^\/v1\/subscriptions\//).length, retrieves);
});

Deno.test('webhook: database failure → 500 so Stripe retries; retry succeeds', async () => {
  const { user, sub } = seedSubscriber('beginner', 'active', { subscriptionRow: false });
  const event = subEvent('customer.subscription.created', sub.id);
  h.db.failNext('POST', 'subscriptions');
  assertEquals((await deliver(event)).status, 500);
  assertEquals(eventRow(event.id), undefined);
  assertEquals((await deliver(event)).status, 200);
  assertEquals(subsOf(user).length, 1);
});

Deno.test('webhook: Stripe API failure while re-reading → 500 (retry)', async () => {
  const { sub } = seedSubscriber('beginner', 'active', { subscriptionRow: false });
  h.stripe.failNext('GET', new RegExp(sub.id), 404, 'invalid_request_error', 'No such subscription');
  assertEquals((await deliver(subEvent('customer.subscription.updated', sub.id))).status, 500);
});

// ================================================================== schema ↔ code semantics
// Stripe.Subscription.Status in stripe@17.7.0 (types/Subscriptions.d.ts).
const STRIPE_STATUSES = ['active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'paused', 'trialing', 'unpaid'];

Deno.test('schema: every Stripe status the webhook can write passes the CHECK constraint', () => {
  const { subscriptionStatuses, plans } = schemaFacts();
  assertEquals([...subscriptionStatuses].sort(), [...STRIPE_STATUSES].sort());
  assertEquals([...plans].sort(), ['advanced', 'beginner']);
});

Deno.test('schema: access_level() statuses match create-checkout\'s notion of a live subscription', async () => {
  const { accessLists, subscriptionStatuses } = schemaFacts();
  for (const list of accessLists) assertEquals(list, accessLists[0], 'both branches of access_level() use the same statuses');
  const src = await Deno.readTextFile(new URL('../create-checkout/index.ts', import.meta.url));
  const m = src.match(/const ACTIVE = \[([^\]]*)\]/);
  assertExists(m, 'ACTIVE list in create-checkout');
  const active = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assertEquals([...active].sort(), [...accessLists[0]].sort());
  for (const s of accessLists[0]) assert(subscriptionStatuses.includes(s));
});

Deno.test('schema: webhook-written status → access_level() for every Stripe status', async () => {
  const { accessLists } = schemaFacts();
  for (const plan of ['beginner', 'advanced'] as const) {
    for (const status of STRIPE_STATUSES) {
      const { user, sub } = seedSubscriber(plan, 'active', { subscriptionRow: false });
      h.stripe.setStatus(sub.id, status);
      const r = await deliver(subEvent('customer.subscription.updated', sub.id));
      assertEquals(r.status, 200, `${status}: ${r.text}`);
      assertEquals(subsOf(user)[0].status, status);
      const expected = accessLists[0].includes(status) ? plan : 'free';
      assertEquals(h.db.accessLevel(user.id), expected, `${plan}/${status}`);
    }
  }
});

Deno.test('no request escaped to the real network', async () => {
  const { blockedRequests } = await import('./billing_fakes.ts');
  assertEquals(blockedRequests, []);
  assertNotEquals(h.auth.calls, 0);
  assertEquals(WEBHOOK_SECRET.startsWith('whsec_'), true);
});
