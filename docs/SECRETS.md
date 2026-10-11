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
| `SITE_URL` | checkout / portal return URLs | `https://example.com/The-Trade-School/` |
| `ALLOWED_ORIGINS` | optional CORS extras | `http://localhost:5173` |
| `SUPABASE_SERVICE_ROLE_KEY` | auto-provided to every Edge Function (with `SUPABASE_URL`, `SUPABASE_ANON_KEY`) — do not set it (the CLI rejects `SUPABASE_*` names) and never ship it | — |
| `ALPHAVANTAGE_API_KEY` (or `ALPHA_VANTAGE_API_KEY`) | `market-data` Alpha Vantage candles; if both are set, `ALPHAVANTAGE_API_KEY` is used | `XXXXXXXX` |
| `MASSIVE_API_KEY` | `market-data` Live Lab quotes (Massive.com) | `XXXXXXXX` |

Until Stripe secrets are present, the site shows **“Subscriptions not open yet”** on subscribe / billing buttons.

---

## 2. Supabase Auth / SMTP

Configure in Dashboard → Authentication (not Edge secrets):

| Setting | Purpose |
|---|---|
| Site URL + Redirect URLs | PKCE return to `#account` / hash routes |
| Email confirmations | Keep on for production |
| Custom SMTP (Resend, Postmark, SendGrid, SES, Brevo, …) | **Required before public launch** — built-in mail only reaches project team members |
| Optional Google OAuth | Reduces email friction |

SMTP credentials stay in the Supabase Auth SMTP form (host, port, user, password) — never in git.

---

## 3. Stripe Dashboard

| Item | Notes |
|---|---|
| Products + prices | Beginner / Advanced monthly; lookup keys `beginner_monthly` / `advanced_monthly` |
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
| `PREMIUM_SOURCE = 'site'` | Lessons/games load from the public static site (**current**) |
| `PREMIUM_SOURCE = 'storage'` | Planned: paid modules load from private Storage paths `beginner/…` and `advanced/…` (see ACCOUNTS.md §10). **Not implemented in the current client** — the flag has no effect and `scripts/publish-premium.mjs` does not exist. |

Client checks are UX. Until the storage mode is rebuilt, nothing else protects paid content.

---

## 5. Local reference only

Copy `.env.example` → `.env` for local notes or CLIs. **Do not** import `.env` into the static frontend. The browser only needs the publishable Supabase key already in `js/config.js`.

---

## 6. Rotation / incident

1. Roll Stripe secret + webhook secret; update Supabase secrets.  
2. Roll service-role key if exposed; never ship it to browsers.  
3. Invalidate sessions if Auth keys change.  
4. Confirm `stripe-webhook` logs show accepted events after rotation.
