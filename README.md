# The Trade School

Learn trading fundamentals by playing. The Trade School is a static website of short
interactive lessons and hands-on games that teach you to read a price chart: candlesticks,
support and resistance, trend lines, chart patterns, Fibonacci, moving averages, indicators,
multi-timeframe analysis and risk management.

Everything is drawn in the browser (SVG), every price is generated from a seeded random
walk, and your progress (XP, levels, stars, badges) is saved locally in your browser.

> **Educational simulations only — not financial advice.** No real markets, tickers or
> money are involved. Nothing here says a pattern "always works"; the games include failed
> setups on purpose.

## Curriculum

Two tracks. Each unit pairs a lesson with a game that drills the same skill.

### Beginner — *Read the chart*

| # | Unit | Lesson | Game |
|---|------|--------|------|
| 1 | Candlestick anatomy | Anatomy of a candlestick | **Candle Builder** — build the candle a story describes |
| 2 | Candlestick patterns | Candlestick patterns | **Pattern Flash** — name the pattern before the clock runs out |
| 3 | Trends & market structure | Trends & market structure | **Trend Spotter** — call the trend, tag HH / HL / LH / LL |
| 4 | Support & resistance | Support & resistance | **Level Hunter** — place the levels, call bounce or break |
| 5 | Trend lines & channels | Trend lines & channels | **Trendline Challenge** — draw the line that best fits the swings |
| 6 | Moving averages | Moving averages | **Cross Catcher** — catch golden and death crosses on a replay |
| 7 | Put it together | — | **What Happens Next?** (Beginner mode) — predict the move |

### Advanced — *Plan the trade*

| # | Unit | Lesson | Game |
|---|------|--------|------|
| 1 | Reversal & continuation chart patterns | Reversal & continuation patterns | **Pattern Detective** — identify it, mark the neckline and target |
| 2 | Fibonacci retracements & extensions | Fibonacci retracements & extensions | **Fib Sniper** — anchor the swing, pick the bounce level |
| 3 | Indicators & divergence | Indicators & divergence (RSI, MACD, Bollinger, volume) | **Divergence Detective** — spot divergence before the turn |
| 4 | Multi-timeframe analysis | Multi-timeframe analysis | **Timeframe Stack** — trade only when the timeframes agree |
| 5 | Confluence, timing & risk | Confluence, timing & risk | **Risk Manager** — size positions, place stops and targets |
| 6 | Capstone | — | **What Happens Next?** (Advanced mode) and **Trade Simulator** — replay a market bar by bar |

Also included: a searchable **glossary** (85+ terms), a **pattern library**, and a
**progress** page with levels (Paper Trader → Market Wizard), badges and best scores.

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

## Tests

```sh
npm test                 # node --test "tests/unit/*.test.mjs" — core-module unit tests (no DOM)
npm run smoke            # node tests/smoke.mjs     — every route in Chromium
```

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
  pages/              home, track, library, progress, glossary, dev-chart
  lessons/<id>.js     one module per lesson
  games/<id>.js       one module per game
tests/
  unit/               node:test unit tests
  smoke.mjs           Playwright smoke test
docs/ARCHITECTURE.md  the build contract: routes, module API, design system, core APIs
```

Every lesson and game is a lazy-loaded ES module that default-exports
`{ id, mount(root, ctx) → cleanup }`, and builds on the shared `LessonShell` / `GameShell`
so they all look and behave the same. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Design

*Chart paper by day, trading desk by night.* Blue-slate neutrals, Fibonacci gold as the single
accent, and green/red reserved for meaning (up/down, correct/wrong). Type is Bricolage
Grotesque for headings, Figtree for text and JetBrains Mono for prices and scores. The site
works at 360px wide with touch, is fully keyboard-driven (games take number keys and Enter,
lessons take ← / →), and respects reduced-motion settings.
