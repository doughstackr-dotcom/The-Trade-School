// POST { plan: 'beginner' | 'advanced', returnTo?: string }  (Authorization: Bearer <user access token>)
//
// - No subscription yet      → creates a Stripe Checkout session, returns { url }
// - Already on that plan     → returns { url } for the Stripe customer portal
// - On the other plan        → switches the existing subscription's price with
//                              proration, returns { switched: true, plan }
import {
  admin,
  billingConfigured,
  corsHeaders,
  findCustomerId,
  json,
  PRICE_IDS,
  requireUser,
  returnBase,
  stripe,
  type Plan,
} from '../_shared/common.ts';

const ACTIVE = ['active', 'trialing', 'past_due'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405);

  if (!billingConfigured()) {
    return json(req, { error: 'Subscriptions are not open yet. Please try again soon.' }, 503);
  }

  try {
    const user = await requireUser(req);
    if (!user) return json(req, { error: 'Sign in to subscribe.' }, 401);

    const body = await req.json().catch(() => ({}));
    const plan = body?.plan as Plan;
    if (plan !== 'beginner' && plan !== 'advanced') {
      return json(req, { error: 'Choose the Beginner or Advanced plan.' }, 400);
    }
    const price = PRICE_IDS[plan];
    const base = returnBase(body?.returnTo);

    // Existing live subscription? Switch or manage instead of creating a second one.
    const { data: current, error: subError } = await admin
      .from('subscriptions')
      .select('id, plan, status')
      .eq('user_id', user.id)
      .in('status', ACTIVE)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subError) throw subError;

    if (current) {
      if (current.plan === plan) {
        // Already on this plan: manage it in the portal. If the customers row is missing, use
        // the subscription's own customer rather than "switching" to the same price.
        let customerId = await findCustomerId(user.id);
        if (!customerId) {
          const existing = await stripe.subscriptions.retrieve(current.id);
          customerId = typeof existing.customer === 'string' ? existing.customer : existing.customer.id;
        }
        const portal = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: `${base}#account`,
        });
        return json(req, { url: portal.url });
      }
      const sub = await stripe.subscriptions.retrieve(current.id);
      const item = sub.items.data[0];
      await stripe.subscriptions.update(current.id, {
        items: [{ id: item.id, price }],
        proration_behavior: 'create_prorations',
        cancel_at_period_end: false,
        metadata: { ...sub.metadata, user_id: user.id, plan },
      });
      // The webhook updates the database; tell the client to refresh its access level.
      return json(req, { switched: true, plan });
    }

    // Find or create the Stripe customer for this user.
    let customerId = await findCustomerId(user.id);
    if (!customerId) {
      const customer = await stripe.customers.create(
        { email: user.email ?? undefined, metadata: { user_id: user.id } },
        { idempotencyKey: `tts-customer-${user.id}` },
      );
      customerId = customer.id;
      const { error: upsertError } = await admin
        .from('customers')
        .upsert({ user_id: user.id, stripe_customer_id: customerId }, { onConflict: 'user_id' });
      if (upsertError) throw upsertError;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      subscription_data: { metadata: { user_id: user.id, plan } },
      allow_promotion_codes: true,
      success_url: `${base}?checkout=success#account`,
      cancel_url: `${base}?checkout=cancel#pricing`,
    });

    return json(req, { url: session.url });
  } catch (err) {
    console.error('create-checkout failed', err);
    return json(req, { error: 'Checkout could not start. Please try again.' }, 500);
  }
});
