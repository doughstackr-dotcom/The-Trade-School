# Deploying The Trade School (V2)

Current state: **main holds V2** (quiet theme, world-map hub, opt-in leaderboards).
Old v1 is preserved on `archive/main-pre-v2`. Production `https://the-trade-school.pages.dev`
still serves v1 at commit `798e06c` until the next Cloudflare deploy below.

## Route A — Cloudflare Pages Git integration (recommended, auto-deploys)

1. Cloudflare dashboard → Workers & Pages → the-trade-school → Settings → Git/Builds.
2. Connect the GitHub repo `doughstackr-dotcom/The-Trade-School`, branch `main`.
3. Build command: **none** · Output directory: `/`.
4. Save → Cloudflare builds and serves main on every push.

## Route B — Wrangler from this machine (one-off)

```
npx wrangler login          # opens the browser; sign in to the Cloudflare account
npx wrangler pages deploy . --project-name=the-trade-school --branch=main --commit-dirty=true
```

Windows note: stamp the service-worker cache first so returning visitors get the new build:

```
powershell -Command "(Get-Content sw.js -Raw) -replace \"const BUILD = 'dev'\", '\"const BUILD = \"%GITSHA%\"'\" | Set-Content sw.js"
```

(`%GITSHA%` = the commit sha; revert to `'dev'` after deploy or leave — CI does not stamp it.)

## Post-deploy checklist

1. `https://the-trade-school.pages.dev/` renders the V2 home (map hero, not the old dashboard).
2. DevTools → Application → Service workers: cache name shows `tts-v1-<commit-sha>`.
3. `js/core/mascot.js` and `js/pages/shop.js` now return **404** (they were removed in V2).
4. Pricing page shows **$19.99 / $29.99** (matches the live Stripe price objects).
5. Sign-up works (Supabase auth), subscribe buttons behave per Supabase secrets.

## Monetization status (what actually earns)

- **Subscriptions**: Supabase `pedcpgmowqhqgersxxqa` + Stripe products/prices already created
  (see `docs/ACCOUNTS.md`). Site shows "Subscriptions not open yet" until the four
  `STRIPE_*` secrets + `SITE_URL` are set on the Supabase Edge Functions.
- **Before public launch** (from `docs/ACCOUNTS.md` §8): custom SMTP in Supabase Auth
  (otherwise confirmation emails never leave the team), Terms/Privacy live (they exist in V2),
  Stripe live-mode keys at launch, and Supabase plan upgrade before real customers depend on it.
- **Merch**: Printify shops (`28855609`, `25656179`) are managed by the station crew; the site
  itself has no store page in V2 by design.

## Local dev

```
npm run serve     # http-server on :5173
npm test          # 207 unit tests
npm run smoke     # 372 rendered route checks (Chromium, phone/tablet/desktop × light/dark)
npm run lint      # eslint
```

Access checks auto-open on localhost; they enforce on real hosts (`js/config.js` → `ACCESS_MODE`).
