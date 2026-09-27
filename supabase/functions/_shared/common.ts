// Shared helpers for The Trade School Edge Functions.
import Stripe from 'npm:stripe@17.7.0';
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.117.2';

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

// SITE_URL is where Stripe sends people back to. ALLOWED_ORIGINS (comma separated)
// lets extra origins such as http://localhost:5173 use their own origin instead.
export const SITE_URL = env('SITE_URL').replace(/\/+$/, '');
const ALLOWED_ORIGINS = env('ALLOWED_ORIGINS')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

export const billingConfigured = () =>
  Boolean(STRIPE_SECRET_KEY && PRICE_IDS.beginner && PRICE_IDS.advanced && SITE_URL);

export const stripe = new Stripe(STRIPE_SECRET_KEY || 'sk_unset', {
  httpClient: Stripe.createFetchHttpClient(),
});

export const admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = origin && (origin === SITE_URL || ALLOWED_ORIGINS.includes(origin));
  return {
    'Access-Control-Allow-Origin': allowed ? origin : SITE_URL || '*',
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

/** The site origin to redirect back to: the caller's origin when allow-listed, else SITE_URL. */
export function returnOrigin(req: Request): string {
  const origin = (req.headers.get('Origin') ?? '').replace(/\/+$/, '');
  if (origin && (origin === SITE_URL || ALLOWED_ORIGINS.includes(origin))) return origin;
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

export function planForPrice(priceId: string | null | undefined, lookupKey?: string | null): Plan | null {
  if (priceId && priceId === PRICE_IDS.advanced) return 'advanced';
  if (priceId && priceId === PRICE_IDS.beginner) return 'beginner';
  if (lookupKey?.startsWith('advanced')) return 'advanced';
  if (lookupKey?.startsWith('beginner')) return 'beginner';
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
