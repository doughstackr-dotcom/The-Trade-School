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
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] });
  const userId = await userIdFor(sub, userHint);
  if (!userId) throw new Error(`No user for subscription ${sub.id}`);

  const item = sub.items.data[0];
  const price = item?.price;
  const plan = planForPrice(price?.id, price?.lookup_key);
  if (!plan) throw new Error(`Unknown price ${price?.id} on subscription ${sub.id}`);

  // Newer Stripe API versions moved the billing period onto subscription items.
  // deno-lint-ignore no-explicit-any
  const periodEnd = (sub as any).current_period_end ?? (item as any)?.current_period_end ?? null;

  const { error } = await admin.from('subscriptions').upsert(
    {
      id: sub.id,
      user_id: userId,
      status: sub.status,
      plan,
      price_id: price!.id,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: sub.cancel_at_period_end,
    },
    { onConflict: 'id' },
  );
  if (error) throw error;

  // Keep the customer mapping complete even if checkout started elsewhere.
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  await admin
    .from('customers')
    .upsert({ user_id: userId, stripe_customer_id: customerId }, { onConflict: 'user_id', ignoreDuplicates: true });
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
      const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
      if (subId) await syncSubscription(subId);
    }

    // Audit trail of processed events (duplicates are harmless).
    await admin.from('stripe_events').upsert({ id: event.id, type: event.type }, { onConflict: 'id', ignoreDuplicates: true });
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
