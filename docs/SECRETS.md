# Secrets checklist

Operational secrets for The Trade School. **Never commit real values.**  
Full setup narrative: [ACCOUNTS.md](./ACCOUNTS.md). Market data: [MARKET_DATA.md](./MARKET_DATA.md).

Public browser config lives in `js/config.js` (`SUPABASE_URL`, publishable `SUPABASE_KEY`, `PLANS`, `FREE_IDS`, `ACCESS_MODE`, `PREMIUM_SOURCE`). Everything below belongs in **Supabase Edge Function secrets**, **Stripe Dashboard**, or **local `.env`** (see `.env.example`) — not in the repo.

---

## 1. Supabase Edge Function secrets

Set via Dashboard → Edge Functions → Secrets, or:

`supabase secrets set --project-ref <ref> NAME=value`

| Secret name | Used by | Example shape (fake) |
|---|---|---|
| `STRIPE_SECRET_KEY` | `create-checkout`, `customer-portal`, `stripe-webhook` | `sk_test_…` / `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` | `whsec_…` |
| `STRIPE_PRICE_BEGINNER` | checkout | `price_…` |
| `STRIPE_PRICE_ADVANCED` | checkout | `price_…` |
| `SITE_URL` | checkout / portal return URLs; CORS origin for **all** functions incl. `market-data` (required — without it no browser origin but loopback / `ALLOWED_ORIGINS` gets a CORS header) | `https://example.com/The-Trade-School/` |
| `ALLOWED_ORIGINS` | optional CORS extras (billing needs `http://localhost:5173` here for local checkout tests; `market-data` already allows loopback origins) | `http://localhost:5173` |
| `SUPABASE_SERVICE_ROLE_KEY` | deploy scripts / admin only | `eyJ…` (server only) |
| `ALPHAVANTAGE_API_KEY` | `market-data` function (if enabled) | `XXXXXXXX` |
| `MASSIVE_API_KEY` | `market-data` Live Lab quotes (Massive.com) | `XXXXXXXX` |
| `MASSIVE_DAILY_LIMIT` | optional, `market-data`: Massive calls per UTC day, site-wide (default 2000) | `2000` |
| `MARKET_DATA_RATE_LIMIT` | optional, `market-data`: requests per client IP per minute (default 120, `0` = off) | `120` |

Until Stripe secrets are present, the site shows **“Subscriptions not open yet”** on subscribe / billing buttons.

---

## 2. Supabase Auth / SMTP

Configure in Dashboard → Authentication (not Edge secrets):

| Setting | Purpose |
|---|---|
| Site URL + Redirect URLs | Site URL `https://thetradeschool.online`; Redirect URLs must include `https://thetradeschool.online/account` (sign-up confirmation returns there with `?code=`, PKCE) — add `http://localhost:5173/account` for local testing |
| Email confirmations | Keep on for production |
| Custom SMTP (Resend, Postmark, SendGrid, SES, Brevo, …) | **Required before public launch** — built-in mail only reaches project team members |
| Optional Google OAuth | Reduces email friction |

SMTP credentials stay in the Supabase Auth SMTP form (host, port, user, password) — never in git.

---

## 3. Stripe Dashboard

| Item | Notes |
|---|---|
| Products + prices | Beginner / Advanced monthly; lookup keys `beginner_monthly` / `advanced_monthly` (labels only — plans are granted by the exact `STRIPE_PRICE_*` IDs) |
| Checkout settings | **Limit customers to one subscription** on (Settings → Payments → Checkout and Payment Links; see ACCOUNTS.md §2a) |
| Customer portal | Update payment method, cancel at period end, switch plans |
| Webhook endpoint | `https://<project>.supabase.co/functions/v1/stripe-webhook` |
| Events | `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`, … |

Test with card `4242 4242 4242 4242`. Rotate to **live** keys only at launch (see ACCOUNTS.md §8).

---

## 4. Access gating (client)

| Config (`js/config.js`) | Meaning |
|---|---|
| `ACCESS_MODE = 'auto'` | Enforce on real hosts; open on localhost (override with `localStorage['tts-enforce-access']='1'`) |
| `ACCESS_MODE = 'enforce' \| 'open'` | Force on / off |
| `FREE_IDS` | Modules open without a paid plan |
| `PREMIUM_SOURCE = 'site'` | Lessons/games load from the public static site (the default build) |
| `PREMIUM_SOURCE = 'storage'` | Set by the build, not by editing the file: `PREMIUM_SOURCE=storage npm run build` (Vercel env var). Paid modules then load from private Storage paths `beginner/…` and `advanced/…`, uploaded by `scripts/publish-premium.mjs` with `SUPABASE_SERVICE_ROLE_KEY` from the environment or the GitHub Action's repository secrets (see ACCOUNTS.md §10). |

Client checks are UX. Storage + RLS is the real content lock.

---

## 5. Local reference only

Copy `.env.example` → `.env` for local notes or CLIs. **Do not** import `.env` into the static frontend. The browser only needs the publishable Supabase key already in `js/config.js`.

---

## 6. Rotation / incident

1. Roll Stripe secret + webhook secret; update Supabase secrets.  
2. Roll service-role key if exposed; never ship it to browsers.  
3. Invalidate sessions if Auth keys change.  
4. Confirm `stripe-webhook` logs show accepted events after rotation.
