# The Trade School

Learn trading fundamentals by playing. The Trade School is a static website of short
interactive lessons and hands-on games that teach you to read a price chart: candlesticks,
support and resistance, trend lines, chart patterns, Fibonacci, moving averages, indicators,
multi-timeframe analysis and risk management.

Everything is drawn in the browser (SVG). Textbook charts are generated from seeded random
walks; games and lessons that offer **Real market** charts use historical candles served by the
site's `market-data` function (see [`docs/MARKET_DATA.md`](docs/MARKET_DATA.md)), always labelled
with the market, date and data source. Your progress (XP, levels, stars, badges) is saved locally
in your browser and, when you are signed in, synced to your account across devices.

> **Educational only — not financial advice.** No money is involved, and real-market charts
> are past data, never a prediction. Nothing here says a pattern "always works"; the games
> include failed setups on purpose.

## Dashboard & access

- **`#dashboard`** — lessons by unit, every game with skills/scores, XP summary, and shortcuts into Practice / Playbook / Live Lab.
- **`#account`** — sign in, plan status, Stripe checkout / billing portal (shows “Subscriptions not open yet” until secrets are set).
- Access gating: `js/core/access.js` + router `setAccessGate`. Free ids (`FREE_IDS` in `js/config.js`): the Daily Challenge and the Risk & position sizing lesson. See `docs/SECRETS.md`.


## Curriculum

Two tracks. Each unit pairs a lesson with a game that drills the same skill.

### Beginner — *Read the chart*

| # | Unit | Lesson | Game |
|---|------|--------|------|
| 1 | Candlestick anatomy | Anatomy of a candlestick | **Candle Builder** — build the candle a story describes |
| 2 | Chart types, scales & timeframes | Chart types, scales and timeframes | **Chart Match** — flip cards to match candles, chart types and patterns |
| 3 | Risk & position sizing | Risk & position sizing (1% guideline, size from the stop, R, expectancy, drawdown, leverage & margin, costs) | **Risk Manager** — size positions, place stops and targets (Advanced-tier game, also paired here) |
| 4 | Candlestick patterns | Candlestick patterns | **Pattern Flash** — name the pattern before the clock runs out |
| 5 | Trends & market structure | Trends & market structure | **Trend Spotter** — call the trend, tag HH / HL / LH / LL |
| 6 | Support & resistance | Support & resistance | **Level Hunter** — place the levels, call bounce or break |
| 7 | Trend lines & channels | Trend lines & channels | **Trendline Challenge** — draw the line that best fits the swings |
| 8 | Moving averages | Moving averages (SMA vs EMA lag, dynamic support, crosses) | **Cross Catcher** — catch golden and death crosses on a replay |
| 9 | Volume | Volume: the fuel behind moves | **Volume Verdict** — swipe: does volume confirm the move, or is it a trap? |
| 10 | Markets, orders & the spread | Markets, orders and the spread (incl. stop-limit, trailing stops, time in force, gaps) | **Order Desk** — fill client orders on a live price ladder |
| 11 | Put it together | — | **What Happens Next?** (Beginner mode), **Setup Swipe** — take or skip rapid-fire setups, **Daily Challenge** — five questions a day, keep your streak |

### Advanced — *Plan the trade*

| # | Unit | Lesson | Game |
|---|------|--------|------|
| 1 | Reversal & continuation chart patterns | Reversal & continuation patterns | **Pattern Detective** — identify it, mark the neckline and target |
| 2 | Fibonacci retracements & extensions | Fibonacci retracements & extensions | **Fib Sniper** — anchor the swing, pick the bounce level |
| 3 | Indicators & divergence | Indicators & divergence (RSI, MACD, Bollinger, volume) | **Divergence Detective** — spot divergence before the turn |
| 4 | Multi-timeframe analysis | Multi-timeframe analysis | **Timeframe Stack** — trade only when the timeframes agree |
| 5 | Breakouts, fakeouts & liquidity | Breakouts, fakeouts and liquidity | **Trap or Trade** — trade the break, fade the trap, or wait for the retest |
| 6 | Confluence, timing & risk | Confluence, timing & risk (builds on Beginner risk: ATR-based stops, backtesting and its pitfalls) | **Risk Manager** — size positions, place stops and targets |
| 7 | Trading psychology & your plan | Trading psychology and your plan (incl. trading journal & reviews) | **Tilt Control** — a branching trading day full of temptations |
| 8 | Capstone | — | **What Happens Next?** (Advanced mode), **Trade Simulator** — replay a market bar by bar, **Live Predict** — call the next candles on a live or replayed real chart |

### Play your way

Every game offers up to three styles, chosen on its start screen and remembered per game:
**Practice** (no clock, hints, retries, pick Easy / Normal / Hard, half XP), **Arcade** (fixed
rounds, a clock and streak multipliers) and **Survival** (three lives, rounds get harder until
they run out; stars at 5, 10 and 15 rounds survived). Games that support it also let you switch
between **Textbook** charts (clean generated examples) and **Real market** charts (historical
windows from real markets, with the symbol and date revealed after you answer).

Also included: a searchable **glossary** (85+ terms), a **pattern library**, the **Setup
Playbook** (`#playbook`: rule-based setups with a checklist, entry, stop and target), the **Live
Market Lab** (`#live`), and a **progress** page with levels (Paper Trader → Market Wizard),
badges, best scores per play style and your Daily Challenge streak.

## Run it locally

There is no build step and no runtime dependency. Serve the repository root with any static
server and open it in a browser:

```sh
npm run serve            # npx http-server -c-1 -p 5173 .   → http://localhost:5173
# or
python3 -m http.server 5173
```

Opening `index.html` straight from the file system will not work, because browsers block
ES-module imports from `file://` URLs.

## Deploy (static host)

This is **vanilla JS with native `import()`** — not Vite. There is no `vite.config`, no
`dist/` folder, and no hashed route chunks. A host that runs `vite build` or looks for
`/assets/index-*.js` will 404 every lazy route.

For Vercel (free tier): import the repo, Framework Preset **Other**, leave Build Command
empty, Output Directory `.` (or rely on the included `vercel.json`). Deploy the feature
branch as a static site. Attach the custom domain `thetradeschool.online` in Vercel → Project → Domains.

SEO files use the site's domain `https://thetradeschool.online` — if the domain changes, update
the canonical / `og:url` / `og:image` / `twitter:image` tags and JSON-LD in
`index.html`, the `Sitemap:` line in `robots.txt`, and `sitemap.xml`.

Basic browsing works without env vars. Real-market charts need the Supabase `market-data`
edge function + Alpha Vantage secret; auth/subscribe need Stripe + SMTP (see `docs/SECRETS.md`).


## Tests

```sh
npm run lint             # ESLint over the site JS
npm test                 # node --test "tests/unit/*.test.mjs" — core-module unit tests (no DOM)
npm run smoke            # node tests/smoke.mjs     — every route in Chromium
npm run test:all         # lint + unit + smoke — must pass before pushing (CI runs the same)
npm run test:functions   # Deno tests for the Supabase edge functions (needs Deno installed)
```

CI (`.github/workflows/ci.yml`) runs lint + unit tests and the smoke suite on every push and
pull request.

The smoke test starts its own static server, opens every page, lesson and game at desktop
(1280×800), tablet (820×1180) and phone (390×844) sizes in light and dark themes, clicks through the first
screen (Start / Next), and fails on console errors, page errors, failed requests or horizontal
scrolling. Screenshots land in `tests/screenshots/` (git-ignored).

```sh
node tests/smoke.mjs g.fib-sniper      # one route (prefixes work too: "g." = every game)
node tests/smoke.mjs --phone --dark    # one viewport / theme
node tests/smoke.mjs --no-shots        # skip screenshots
node tests/smoke.mjs --fonts           # load Google Fonts (uses $HTTPS_PROXY if set)
node tests/smoke.mjs --no-storage      # every localStorage call throws (private-mode check)
```

Playwright is resolved from a local `node_modules` or the global npm root; it is only needed
for the smoke test.

## Project structure

```
index.html            HTML shell: fonts, stylesheets, <div id="app">, js/main.js
css/
  tokens.css          design tokens (light on :root, dark via media query + [data-theme])
  base.css            reset, type scale, layout primitives
  components.css      buttons, chips, quiz options, toasts, modal, game/lesson shells, pages
  chart.css           chart styles
js/
  main.js             app shell (top bar, phone tab bar, footer) + router start
  registry.js         curriculum catalogue: tiers, units, lessons, games, badges (pure data)
  core/               router, store, ui kit, game-kit, lesson-kit, chart engine, data, indicators
  pages/              home, track, library, progress, glossary, playbook, live, dev-chart
  lessons/<id>.js     one module per lesson
  games/<id>.js       one module per game
tests/
  unit/               node:test unit tests
  smoke.mjs           Playwright smoke test
  fixtures/           offline market fixtures (synthetic candles, labelled as such)
supabase/
  functions/          Deno edge functions: market-data proxy, billing (see docs/ACCOUNTS.md)
  migrations/         accounts, subscriptions and billing schema
docs/
  ARCHITECTURE.md     the build contract: routes, module API, design system, core APIs
  ACCOUNTS.md         owner guide: Supabase, Stripe and premium-module setup
  MARKET_DATA.md      the market-data function: sources, budget, caching
```

Every lesson and game is a lazy-loaded ES module that default-exports
`{ id, mount(root, ctx) → cleanup }`, and builds on the shared `LessonShell` / `GameShell`
so they all look and behave the same. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Design

*Chart paper by day, trading desk by night.* Blue-slate neutrals, Fibonacci gold as the single
accent, and green/red reserved for meaning (up/down, correct/wrong). Type is Bricolage
Grotesque for headings, Figtree for text and JetBrains Mono for prices and scores. The site
works at 360px wide with touch, is fully keyboard-driven (games take number keys and Enter,
lessons take ← / →), and respects reduced-motion settings.

## License

[MIT](LICENSE). Educational content only — nothing here is financial advice.
