// Public site configuration. Everything here is safe to ship to browsers.
// Secrets (Stripe keys, Alpha Vantage key, service-role key) live only in Supabase secrets.

// Supabase project "the-trade-school" (us-east-1). The publishable key is designed to be
// public; row-level security protects the data.
export const SUPABASE_URL = 'https://pedcpgmowqhqgersxxqa.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_fdwgGDrO0soyNdS0jOprcw_MJxIL0rC';

// Subscription plans (prices in USD per month). Advanced includes everything in Beginner.
export const PLANS = {
  beginner: { id: 'beginner', name: 'Beginner', price: 19.99, currency: 'USD', interval: 'month', unlocks: ['beginner'] },
  advanced: { id: 'advanced', name: 'Advanced', price: 29.99, currency: 'USD', interval: 'month', unlocks: ['beginner', 'advanced'] },
};

// Exactly one free game for signed-in members without a paid plan (Games page hook).
// Every other lesson/game needs Beginner or Advanced. See docs / access tests.
export const FREE_IDS = ['daily-challenge'];

// 'auto' enforces plans on real hosts and leaves everything open on localhost so
// development and tests see every module; 'open' | 'enforce' force one behaviour.
export const ACCESS_MODE = 'auto';

// 'site' loads lesson/game code from the public site; 'storage' loads paid modules from
// the private Supabase Storage bucket (see docs/ACCOUNTS.md §10).
export const PREMIUM_SOURCE = 'site';
// When set to 'storage', paid modules load from the private Supabase Storage bucket
// paths beginner/<file> and advanced/<file> (see docs/ACCOUNTS.md §10 and docs/SECRETS.md).

// Owner-specific values used by the Privacy Policy, Terms of Service and Refund Policy
// pages (js/pages/legal.js). Keep them all here. A null contactEmail / jurisdiction still
// renders (with neutral fallback wording) but shows a notice on localhost and warns in the
// console so it gets filled in before launch. The legal text is a template: have it
// reviewed by a qualified lawyer for your business before relying on it.
export const LEGAL = {
  businessName: 'The Trade School',
  contactEmail: 'simpleais@outlook.com',
  jurisdiction: 'California, USA',
  effectiveDate: '2026-09-28', // ISO date the current versions take effect
};
