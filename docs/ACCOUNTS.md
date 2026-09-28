# Accounts & subscriptions — owner setup

The Trade School uses **Supabase** for accounts, progress sync and access control, and
**Stripe** for the two monthly subscriptions.

| plan | price | unlocks |
|---|---|---|
| Free account | $0 | Unit 1 (Candlestick anatomy + Candle Builder), Pattern Library, progress sync |
| Beginner | **$19.99 / month** | Every Beginner lesson and game |
| Advanced | **$29.99 / month** | Everything in Beginner **plus** every Advanced lesson and game |

Supabase project: **the-trade-school** · ref `pedcpgmowqhqgersxxqa` · region us-east-1 ·
API URL `https://pedcpgmowqhqgersxxqa.supabase.co`.

Already done for you:

- Database schema, row-level security and the `access_level()` function
  (`supabase/migrations/20260927180000_accounts_and_billing.sql`).
- Edge Functions deployed: `create-checkout`, `customer-portal`, `stripe-webhook`
  (`supabase/functions/`).
- A private `premium` Storage bucket that only paying members can read.

What you need to do is below. Do it in Stripe **test mode** first, then repeat the Stripe
parts in live mode when you launch. Never paste secret keys into chat, code or GitHub —
they only go into the Supabase dashboard.

---

## 1. Create the two products in Stripe

Stripe Dashboard → **Product catalog → Add product**:

1. **The Trade School — Beginner**: recurring, **$19.99 USD / month**. Under the price's
   advanced options set the lookup key `beginner_monthly`.
2. **The Trade School — Advanced**: recurring, **$29.99 USD / month**, lookup key
   `advanced_monthly`.

Copy each **price ID** (starts with `price_`).

The functions grant a plan **only for these exact price IDs** (the `STRIPE_PRICE_*` secrets in
step 4). Lookup keys are just labels: a subscription on any other price — a new price after a
price change, a test price, a legacy price — is not mapped to a plan, and its webhook events
fail (500) so Stripe keeps retrying them. So when you change a price, update
`STRIPE_PRICE_BEGINNER` / `STRIPE_PRICE_ADVANCED` **before** moving anyone onto it, then resend
any failed webhook events (Stripe → Developers → Webhooks → the event → Resend).

## 2. Turn on the customer portal

Stripe Dashboard → **Settings → Billing → Customer portal**:

- Allow customers to **update payment methods**, **view invoice history** and **cancel
  subscriptions** (choose "cancel at end of billing period").
- Under **Subscriptions → Customers can switch plans**, add both products/prices so members
  can move between Beginner and Advanced. Proration: "Prorate charges and credits".
- Save. The site's "Manage billing" button opens this portal.

### 2a. Limit customers to one subscription

Stripe Dashboard → **Settings → Payments → Checkout and Payment Links** (in some accounts:
**Settings → Checkout**) → **Subscriptions** → turn on **Limit customers to one
subscription**. Save.

With this on, Stripe itself stops a customer who already has an active subscription from
completing a second Checkout (it sends them to the customer portal instead). It is the
backstop behind `create-checkout`'s own protections:

- a repeated click (or a retried request) reuses one Checkout Session: sessions are created
  with a Stripe idempotency key per user, plan and 5-minute window, and an **open** session for
  the same plan is resumed instead of a new one being created;
- choosing the other plan while a session is still open expires the old session, so the two
  can't both be paid;
- an **incomplete** subscription (first payment not finished) for the same plan sends the
  member to its unpaid invoice; for the other plan, or while the payment is still processing,
  the request answers 409 with a message instead of starting a second subscription.

## 3. Add the webhook

Stripe Dashboard → **Developers → Webhooks → Add endpoint**:

- Endpoint URL: `https://pedcpgmowqhqgersxxqa.supabase.co/functions/v1/stripe-webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`,
  `invoice.payment_failed`.
- Copy the **signing secret** (starts with `whsec_`).

## 4. Add the secrets to Supabase

Supabase Dashboard → project **the-trade-school** → **Edge Functions → Secrets**
(or `supabase secrets set --project-ref pedcpgmowqhqgersxxqa NAME=value`):

| name | value |
|---|---|
| `STRIPE_SECRET_KEY` | your Stripe secret key (`sk_test_…` now, `sk_live_…` at launch) |
| `STRIPE_WEBHOOK_SECRET` | the `whsec_…` signing secret from step 3 |
| `STRIPE_PRICE_BEGINNER` | the Beginner `price_…` ID |
| `STRIPE_PRICE_ADVANCED` | the Advanced `price_…` ID |
| `SITE_URL` | your public site address, e.g. `https://doughstackr-dotcom.github.io/The-Trade-School/` or your own domain |
| `ALLOWED_ORIGINS` | optional, comma separated extra origins, e.g. `http://localhost:5173` for local testing |

Until these are set, the subscribe buttons show "Subscriptions are not open yet".

CORS: the billing functions answer browsers only on `SITE_URL`'s origin and the
`ALLOWED_ORIGINS`. Without `SITE_URL` they send no `Access-Control-Allow-Origin` header at all
(never `*`), so the browser can't read the reply and the site shows "Subscriptions not open
yet". To try checkout from `npm run serve`, add `http://localhost:5173` to `ALLOWED_ORIGINS`
(and to the Auth redirect URLs, step 5).

### 4a. Database migrations

Apply every file in `supabase/migrations/` in order (`supabase db push`, or paste each new file
into the SQL Editor). Hardening migrations added after the first setup:

| migration | what it does |
|---|---|
| `20260928090000_profiles_column_update_grant.sql` | signed-in users can update only `display_name` on their own profile (column grant; the own-row policy stays) |
| `20260928090100_api_rate_limits.sql` | per-IP rate limit table + `take_rate_limit()` used by `market-data` (see [MARKET_DATA.md](./MARKET_DATA.md)) |

## 5. Auth settings in Supabase

Supabase Dashboard → **Authentication**:

1. **URL Configuration** → Site URL = your `SITE_URL` (`https://thetradeschool.online`).
   Redirect URLs: add `https://thetradeschool.online/**` (covers `/account`, where sign-up
   confirmation emails return with `?code=…`) and `http://localhost:5173/**`. The site uses
   clean paths (`/account`, `/games/…`), not `#…` hash routes.
2. **Sign In / Providers → Email**: keep **Confirm email** on.
3. **Emails → SMTP Settings**: connect a real email provider (Resend, Postmark, SendGrid,
   Amazon SES, Brevo…). **This is required before launch.** Supabase's built-in sender only
   delivers to members of your Supabase team and is heavily rate-limited, so without custom
   SMTP the public cannot confirm their accounts. After connecting SMTP, raise the email rate
   limit under **Rate Limits** to match your expected sign-ups per hour.
4. Optional: **Google** sign-in under Providers (needs a Google Cloud OAuth client), which
   also avoids email confirmation friction on phones.

## 6. Give yourself (and testers) access without paying

Supabase Dashboard → **SQL Editor**, after you have signed up on the site:

```sql
insert into public.access_grants (user_id, plan, note)
select id, 'advanced', 'owner' from auth.users where email = 'you@example.com';
```

Grants can expire: add `expires_at = now() + interval '30 days'`.

## 7. Test the flow (test mode)

1. Sign up on the site, confirm the email, sign in.
2. Open an Advanced lesson → the paywall appears → choose **Beginner** → pay with Stripe's
   test card `4242 4242 4242 4242`, any future date, any CVC.
3. You return to **Account**, which shows "Unlocking…" and flips to **Beginner** within a
   few seconds (the webhook updates the database).
4. Choose **Upgrade to Advanced** → the plan switches with proration, Advanced unlocks.
5. **Manage billing** → cancel → the plan stays active until the period ends.
6. Check Supabase → Table editor → `subscriptions`, and Edge Functions → Logs if anything
   looks off.

## 8. Going live

- Stripe: switch to live mode, recreate the two products (or copy them), create the live
  webhook, and replace all four `STRIPE_*` secrets with live values.
- Supabase: the project is on the **Free** plan. Free projects can be paused after a week of
  low activity and have lower limits; upgrade the organization to a paid plan before real
  customers depend on it (Supabase Dashboard → Organization → Billing). Turn on backups.
- Custom SMTP (step 5.3) must be configured.
- Add your legal pages: the site ships draft Terms and Privacy pages (`/terms`, `/privacy`)
  that you must review with a professional before charging customers. Stripe also requires a
  visible refund/cancellation policy.
- **Clear test-mode billing rows** before switching Stripe to live keys (test customer ids
  don't exist in live mode), in the SQL Editor:
  `delete from public.subscriptions; delete from public.customers; delete from public.stripe_events;`
  (only do this at launch, before any real customer has paid).
- **Deleting a member** in Supabase does not cancel their Stripe subscription. Cancel it in
  Stripe first (Customers → the customer → Cancel subscription), then delete the user.
- After the first real test purchase, open Supabase → Edge Functions → `stripe-webhook` →
  Logs and confirm events show "received" with no errors; resend any failed event from
  Stripe → Developers → Webhooks → the event → Resend.

## 9. Scaling notes

- The site itself is static files, so any CDN host (GitHub Pages, Cloudflare Pages,
  Netlify, Vercel) serves unlimited visitors cheaply.
- The only per-user backend traffic is sign-in, one access-level check per session,
  and progress sync, which is debounced into one small row per user.
- Every table uses row-level security keyed on the user's id with an index, so checks stay
  fast as the user count grows.
- Stripe webhooks are idempotent: repeated or out-of-order events re-read the subscription
  from Stripe and write its current state. Any failed database write (subscription,
  customer mapping, event log) answers 500, so Stripe retries the event with backoff.

## 10. Protecting paid content (recommended before launch)

The subscription check in the browser controls what members see, but the lesson and game
code is still downloadable from the public site, and this GitHub repository is **public**,
so anyone can read it. To make paid content genuinely private:

1. Make the GitHub repository private (and deploy with a host that supports private repos,
   e.g. Cloudflare Pages, Netlify or Vercel — GitHub Pages needs a paid GitHub plan for
   private repos).
2. Set `PREMIUM_SOURCE = 'storage'` in `js/config.js`.
3. Run `SUPABASE_SERVICE_ROLE_KEY=… node scripts/publish-premium.mjs` on each deploy. It
   uploads the paid modules to the private `premium` bucket, and the deploy build leaves them
   out of the public files. The site then downloads them only for members whose plan allows
   it; Supabase checks `access_level()` on every download.
