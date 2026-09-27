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

// SITE_URL is the public site's base URL (it may include a path, e.g. a GitHub Pages
// project site). ALLOWED_ORIGINS (comma separated) adds extra origins such as
// http://localhost:5173 that may call the functions and receive redirects.
export const SITE_URL = normalizeBase(env('SITE_URL'));
const SITE_ORIGIN = originOf(SITE_URL);
const ALLOWED_ORIGINS = env('ALLOWED_ORIGINS')
  .split(',')
  .map((o) => originOf(o.trim()))
  .filter(Boolean);

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** Absolute base URL ending in '/', without query or hash. '' if invalid. */
function normalizeBase(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    if (!u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/[^/]*\.html?$/, '/') || '/';
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    return u.toString();
  } catch {
    return '';
  }
}

const isAllowedOrigin = (origin: string) =>
  Boolean(origin) && (origin === SITE_ORIGIN || ALLOWED_ORIGINS.includes(origin));

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
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : SITE_ORIGIN || '*',
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
