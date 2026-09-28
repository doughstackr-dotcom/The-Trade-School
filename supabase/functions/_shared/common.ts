// Shared helpers for The Trade School Edge Functions.
import Stripe from 'npm:stripe@17.7.0';
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.117.2';
import { isAllowedOrigin, originOf, SITE_ORIGIN } from './cors.ts';

export type Plan = 'beginner' | 'advanced';

const env = (name: string) => Deno.env.get(name) ?? '';

export const SUPABASE_URL = env('SUPABASE_URL');
export const SUPABASE_ANON_KEY = env('SUPABASE_ANON_KEY');
export const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

export const STRIPE_SECRET_KEY = env('STRIPE_SECRET_KEY');
export const STRIPE_WEBHOOK_SECRET = env('STRIPE_WEBHOOK_SECRET');
export const PRICE_IDS: Record<Plan, string> = {
  beginner: env('STRIPE_PRICE_BEGINNER'),
  advanced: env('STRIPE_PRICE_ADVANCED'),
};

// SITE_URL is the public site's base URL (it may include a path, e.g. a GitHub Pages
// project site). ALLOWED_ORIGINS (comma separated) adds extra origins such as
// http://localhost:5173 that may call the functions and receive redirects (see cors.ts).
export const SITE_URL = normalizeBase(env('SITE_URL'));

/** Absolute http(s) base URL ending in '/', without credentials, query or hash. '' if invalid. */
function normalizeBase(url: string): string {
  try {
    const u = new URL(url);
    // blob:https://site/… reports the site's origin but is not a page Stripe can redirect to.
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    u.username = '';
    u.password = '';
    u.search = '';
    u.hash = '';
    if (!u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/[^/]*\.html?$/, '/') || '/';
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    return u.toString();
  } catch {
    return '';
  }
}

export const billingConfigured = () =>
  Boolean(STRIPE_SECRET_KEY && PRICE_IDS.beginner && PRICE_IDS.advanced && SITE_URL);

export const stripe = new Stripe(STRIPE_SECRET_KEY || 'sk_unset', {
  httpClient: Stripe.createFetchHttpClient(),
});

export const admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * CORS for the billing functions: an allow-listed origin is echoed; any other origin gets the
 * site's own origin (which its browser rejects). Without SITE_URL there is nothing to pin to,
 * so no Access-Control-Allow-Origin is sent at all (never '*').
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allow = isAllowedOrigin(origin) ? origin : SITE_ORIGIN;
  return {
    ...(allow ? { 'Access-Control-Allow-Origin': allow } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

/**
 * Base URL (ending in '/') to send the member back to after Stripe. The client may pass
 * its own base (location.origin + location.pathname) as `returnTo`; it is used only when
 * its origin is allow-listed, otherwise SITE_URL is used. Prevents open redirects.
 */
export function returnBase(requested: unknown): string {
  if (typeof requested === 'string') {
    const base = normalizeBase(requested);
    if (base && isAllowedOrigin(originOf(base))) return base;
  }
  return SITE_URL;
}

/** Resolve the signed-in user from the request's bearer token, or null. */
export async function requireUser(req: Request): Promise<User | null> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

/**
 * The plan a Stripe price grants: only the exact configured price IDs count. Lookup keys are
 * not trusted (any price in the account could carry a matching prefix, e.g. a cheaper test or
 * legacy price). After a price change, update STRIPE_PRICE_* before moving subscribers.
 */
export function planForPrice(priceId: string | null | undefined): Plan | null {
  if (priceId && PRICE_IDS.advanced && priceId === PRICE_IDS.advanced) return 'advanced';
  if (priceId && PRICE_IDS.beginner && priceId === PRICE_IDS.beginner) return 'beginner';
  return null;
}

export async function findCustomerId(userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('customers')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.stripe_customer_id ?? null;
}
