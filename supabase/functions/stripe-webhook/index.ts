// Stripe → Supabase subscription sync. Deployed with verify_jwt = false because Stripe
// cannot send a Supabase JWT; every request is authenticated by its Stripe signature.
//
// Stripe events can arrive out of order or more than once, so each handler re-reads the
// subscription from Stripe and upserts its current state (idempotent by design).
import Stripe from 'npm:stripe@17.7.0';
import { admin, planForPrice, stripe, STRIPE_WEBHOOK_SECRET } from '../_shared/common.ts';

const cryptoProvider = Stripe.createSubtleCryptoProvider();

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
]);

async function userIdFor(sub: Stripe.Subscription, hint?: string | null): Promise<string | null> {
  if (sub.metadata?.user_id) return sub.metadata.user_id;
  if (hint) return hint;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const { data } = await admin
    .from('customers')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return data?.user_id ?? null;
}

async function syncSubscription(subscriptionId: string, userHint?: string | null) {
  let userId: string | null = null;
  let customerId = '';
  let written = '';
  // Deliveries run concurrently, so one holding an older snapshot can write after one holding
  // a newer snapshot. Re-read after writing and write again until the row matches Stripe.
  for (let round = 0; round < 3; round++) {
    // items.data[].price is always a full Price object; it is not expandable, and asking to
    // expand it makes Stripe reject the request.
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    userId ??= await userIdFor(sub, userHint);
    if (!userId) throw new Error(`No user for subscription ${sub.id}`);
    customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

    const item = sub.items.data[0];
    const price = item?.price;
    const plan = planForPrice(price?.id);
    if (!plan) throw new Error(`Unknown price ${price?.id} on subscription ${sub.id}`);

    // Newer Stripe API versions moved the billing period onto subscription items.
    // deno-lint-ignore no-explicit-any
    const periodEnd = (sub as any).current_period_end ?? (item as any)?.current_period_end ?? null;

    const row = {
      id: sub.id,
      user_id: userId,
      status: sub.status,
      plan,
      price_id: price!.id,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: sub.cancel_at_period_end,
    };
    const snapshot = JSON.stringify(row);
    if (snapshot === written) break; // what we stored is still Stripe's current state

    const { error } = await admin.from('subscriptions').upsert(row, { onConflict: 'id' });
    if (error) throw error;
    written = snapshot;
  }

  // Keep the customer mapping complete even if checkout started elsewhere. An existing mapping
  // for the user is kept (ON CONFLICT (user_id) DO NOTHING). A customer already mapped to another
  // user is a data problem retrying cannot fix: log it. Any other failure throws so Stripe retries.
  const { error: mapError } = await admin
    .from('customers')
    .upsert({ user_id: userId, stripe_customer_id: customerId }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (mapError) {
    if (mapError.code === '23505') {
      console.warn(`Customer ${customerId} is already mapped to another user; not re-mapped to ${userId}`);
    } else {
      throw mapError;
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!STRIPE_WEBHOOK_SECRET) return new Response('Webhook secret not configured', { status: 503 });

  const signature = req.headers.get('Stripe-Signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  const body = await req.text(); // raw body is required for signature verification
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      STRIPE_WEBHOOK_SECRET,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    console.warn('Rejected webhook with a bad signature', (err as Error).message);
    return new Response('Invalid signature', { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === 'subscription' && session.subscription) {
        const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
        await syncSubscription(subId, session.client_reference_id);
      }
    } else if (SUBSCRIPTION_EVENTS.has(event.type)) {
      const sub = event.data.object as Stripe.Subscription;
      await syncSubscription(sub.id);
    } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice;
      // Webhook payloads use the endpoint's API version: from 2025-03-31 on, the subscription
      // moved from invoice.subscription to invoice.parent.subscription_details.subscription.
      // deno-lint-ignore no-explicit-any
      const ref = invoice.subscription ?? (invoice as any).parent?.subscription_details?.subscription;
      const subId = typeof ref === 'string' ? ref : ref?.id;
      if (subId) await syncSubscription(subId);
    }

    // Audit trail of processed events (duplicates are harmless; a failed write is retried).
    const { error: auditError } = await admin
      .from('stripe_events')
      .upsert({ id: event.id, type: event.type }, { onConflict: 'id', ignoreDuplicates: true });
    if (auditError) throw auditError;
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    // 500 makes Stripe retry with backoff.
    console.error(`Webhook ${event.type} (${event.id}) failed`, err);
    return new Response('Webhook handler failed', { status: 500 });
  }
});
