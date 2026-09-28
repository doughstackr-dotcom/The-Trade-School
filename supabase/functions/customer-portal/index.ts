// POST { returnTo?: string } (Authorization: Bearer <user access token>) → { url } of the Stripe customer
// portal, where members update their card, switch plans, see invoices or cancel.
import {
  billingConfigured,
  corsHeaders,
  findCustomerId,
  json,
  requireUser,
  returnBase,
  stripe,
} from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405);

  if (!billingConfigured()) {
    return json(req, { error: 'Billing is not open yet.' }, 503);
  }

  try {
    const user = await requireUser(req);
    if (!user) return json(req, { error: 'Sign in to manage billing.' }, 401);

    const customerId = await findCustomerId(user.id);
    if (!customerId) {
      return json(req, { error: 'You have no billing history yet. Choose a plan first.' }, 404);
    }

    const body = await req.json().catch(() => ({}));
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${returnBase(body?.returnTo)}account`,
    });
    return json(req, { url: portal.url });
  } catch (err) {
    console.error('customer-portal failed', err);
    return json(req, { error: 'The billing page could not open. Please try again.' }, 500);
  }
});
