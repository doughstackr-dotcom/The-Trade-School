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
export const FREE_IDS = ['candle-anatomy', 'candle-builder', 'daily-challenge', 'markets-orders', 'order-desk'];

// 'auto' enforces plans on real hosts and leaves everything open on localhost so
// development and tests see every module; 'open' | 'enforce' force one behaviour.
export const ACCESS_MODE = 'auto';

// 'site' loads lesson/game code from the public site; 'storage' loads paid modules from
// the private Supabase Storage bucket (see docs/ACCOUNTS.md §10).
export const PREMIUM_SOURCE = 'site';
// When set to 'storage', paid modules load from the private Supabase Storage bucket
// paths beginner/<file> and advanced/<file> (see docs/ACCOUNTS.md §10 and docs/SECRETS.md).
