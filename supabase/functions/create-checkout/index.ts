// POST { plan: 'beginner' | 'advanced', returnTo?: string }  (Authorization: Bearer <user access token>)
//
// - No subscription yet      → creates a Stripe Checkout session, returns { url }
//                              (an open session for the same plan is resumed instead, see below)
// - Unpaid (incomplete) subscription for that plan → returns { url, resumed: true } for its invoice
// - Already on that plan     → returns { url } for the Stripe customer portal
// - On the other plan        → switches the existing subscription's price with
//                              proration, returns { switched: true, plan }
import Stripe from 'npm:stripe@17.7.0';
import {
  admin,
  billingConfigured,
  corsHeaders,
  findCustomerId,
  json,
  planForPrice,
  PRICE_IDS,
  requireUser,
  returnBase,
  stripe,
  type Plan,
} from '../_shared/common.ts';

const ACTIVE = ['active', 'trialing', 'past_due'];
/**
 * Checkout Session creates in the same window share a Stripe idempotency key, so a double or
 * triple click (or a retried request) yields one session instead of several.
 */
const IDEMPOTENCY_WINDOW_MS = 5 * 60_000;

const PLAN_NAMES: Record<Plan, string> = { beginner: 'Beginner', advanced: 'Advanced' };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Idempotency key for creating this user's Checkout Session: the same for every request with
 * the same parameters in the same short time window. It also covers the open sessions seen
 * just before, so that once a session has been expired (plan changed) a new key is used and
 * Stripe does not replay the expired session.
 */
async function checkoutKey(userId: string, plan: Plan, price: string, base: string, seen: string[]): Promise<string> {
  const bucket = Math.floor(Date.now() / IDEMPOTENCY_WINDOW_MS);
  const digest = await sha256Hex([plan, price, base, bucket, ...[...seen].sort()].join('|'));
  return `tts-checkout-${userId}-${digest.slice(0, 32)}`;
}

type Resume = { url: string; resumed: true } | { conflict: string } | { seen: string[] };

/**
 * Anything already in progress for this customer that must be finished instead of starting a
 * second subscription:
 *   * an unpaid (incomplete) subscription: same plan → pay its open invoice; other plan → 409;
 *   * an open Checkout Session: same plan → resume it; other plan → expire it (so the two can't
 *     both be paid) and start a new one.
 */
async function resumable(customerId: string, plan: Plan): Promise<Resume> {
  const incomplete = await stripe.subscriptions.list({
    customer: customerId,
    status: 'incomplete',
    expand: ['data.latest_invoice'],
    limit: 10,
  });
  for (const sub of incomplete.data) {
    const pending = planForPrice(sub.items.data[0]?.price?.id) ?? (sub.metadata?.plan as Plan | undefined);
    const invoice = typeof sub.latest_invoice === 'object' ? sub.latest_invoice : null;
    const payable = invoice?.status === 'open' && invoice.hosted_invoice_url;
    if (pending === plan && payable) return { url: invoice!.hosted_invoice_url!, resumed: true };
    return {
      conflict: pending && pending !== plan
        ? `Your ${PLAN_NAMES[pending]} subscription payment is still pending. Finish it, or wait for it to expire, before choosing another plan.`
        : 'Your last subscription payment is still processing. Please try again in a few minutes.',
    };
  }

  const open = await stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 10 });
  const seen = open.data.map((s) => s.id);
  for (const s of open.data) {
    if (s.mode !== 'subscription') continue;
    if (s.metadata?.plan === plan && s.url) return { url: s.url, resumed: true };
  }
  for (const s of open.data) {
    if (s.mode !== 'subscription') continue;
    try {
      await stripe.checkout.sessions.expire(s.id);
    } catch (err) {
      // Completed or expired meanwhile: nothing left to cancel.
      if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) throw err;
      console.warn(`Could not expire checkout session ${s.id}: ${(err as Error).message}`);
    }
  }
  return { seen };
}

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

    // Resume what is already in progress rather than opening a second way to subscribe.
    const resume = await resumable(customerId, plan);
    if ('conflict' in resume) return json(req, { error: resume.conflict }, 409);
    if ('url' in resume) return json(req, resume);

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        client_reference_id: user.id,
        line_items: [{ price, quantity: 1 }],
        metadata: { user_id: user.id, plan },
        subscription_data: { metadata: { user_id: user.id, plan } },
        allow_promotion_codes: true,
        success_url: `${base}?checkout=success#account`,
        cancel_url: `${base}?checkout=cancel#pricing`,
      },
      { idempotencyKey: await checkoutKey(user.id, plan, price, base, resume.seen) },
    );

    return json(req, { url: session.url });
  } catch (err) {
    console.error('create-checkout failed', err);
    return json(req, { error: 'Checkout could not start. Please try again.' }, 500);
  }
});
