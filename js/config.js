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

// Lessons and games open to any signed-in member, no subscription needed.
// Owner's choice: unit 1 (candlestick anatomy) free; Daily Challenge free as a daily hook.
export const FREE_IDS = ['candle-anatomy', 'candle-builder', 'daily-challenge'];

// 'auto' enforces plans on real hosts and leaves everything open on localhost so
// development and tests see every module; 'open' | 'enforce' force one behaviour.
export const ACCESS_MODE = 'auto';

// 'site' loads lesson/game code from the public site; 'storage' loads paid modules from
// the private Supabase Storage bucket (see docs/ACCOUNTS.md §10).
export const PREMIUM_SOURCE = 'site';

// ---------------------------------------------------------------- access rules (§9)
// Everything the owner may want to change about who can open what lives here; js/core/access.js
// turns these rules plus each registry entry's `tier` into the plan a page needs.
//   null       → public (anyone, signed out included)
//   'account'  → any signed-in member (free account)
//   'beginner' → Beginner or Advanced plan
//   'advanced' → Advanced plan
// Lessons and games follow their registry tier: 'beginner' → 'beginner', 'advanced' →
// 'advanced', 'both' → BOTH_TIER_MODES[mode] (the Beginner mode when no mode is given).
// FREE_IDS (above) override the tier with 'account'.

// Stand-alone pages that need an account or a plan. Every other page is public.
export const PAGE_PLANS = {
  library: 'account',   // Pattern Library (#library, #library.<patternId>)
  playbook: 'account',  // Setup Playbook: the page shows each setup's tier inside (ctx.access)
  live: 'beginner',     // Live Market Lab
};

// Modes of 'both'-tier games (GameShell modes). A mode may also declare `requires` itself.
export const BOTH_TIER_MODES = { beginner: 'beginner', advanced: 'advanced' };

// Premium Storage bucket used when PREMIUM_SOURCE = 'storage' (objects: <plan>/js/<path>).
export const PREMIUM_BUCKET = 'premium';

// Shown on the legal pages. Leave '' until you have a support address; the pages then show a
// clearly marked placeholder.
export const CONTACT_EMAIL = '';
