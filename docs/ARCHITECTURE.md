# The Trade School — Architecture & Build Spec

An interactive school for trading fundamentals: lessons with animated diagrams, plus
games and simulations, split into a **Beginner** and an **Advanced** tier.

This file is the contract every contributor codes against. If you need to change a
public API described here, update this file in the same change.

---

## 1. Ground rules

- **No build step, no runtime dependencies.** Vanilla ES modules, HTML, CSS, inline SVG.
  The site must run by serving the repo root with any static server
  (`npx http-server -c-1 .` or `python3 -m http.server`). It must also work when every
  file is published side-by-side on a static host (GitHub Pages, claude.ai artifact).
- Only external resource allowed: Google Fonts stylesheet (`fonts.googleapis.com`) with
  real fallback stacks. No CDNs, no images from other hosts, no fetch() to other hosts.
- All pictures, diagrams and animations are drawn in code (SVG, occasionally Canvas).
- All randomness goes through the seeded PRNG in `js/core/rng.js`, so a scenario can be
  replayed from its seed. `Math.random()` is only used to *pick* a seed.
- Browser storage (`localStorage`) is a convenience: every read/write is wrapped in
  `try/catch` and the app works (progress just isn't remembered) when it throws.
- Never use `alert()`, `confirm()`, `prompt()`, `window.open()` or `window.print()`.
- Respect `prefers-reduced-motion`: animations shorten to ~0 and auto-playing loops pause.
- Must work at phone width (≥ 360px) with touch (pointer events, not mouse events),
  and keyboard (visible focus, buttons are `<button>`, games have key shortcuts).
- Educational only. The footer states that nothing here is financial advice.

## 2. File layout

```
index.html                 full HTML document: fonts, css links, <div id="app">, js/main.js
css/tokens.css             design tokens (light on :root, dark via media + [data-theme])
css/base.css               reset, typography scale, layout primitives
css/components.css         buttons, cards, chips, quiz options, toasts, modal, meters, tabs
css/chart.css              .tc-* classes used by js/core/chart.js
js/main.js                 boot: render shell, start router
js/registry.js             curriculum catalogue (PURE DATA, importable from node)
js/core/router.js          hash router
js/core/store.js           progress: XP, levels, completions, badges, settings
js/core/rng.js             seeded PRNG + helpers
js/core/data.js            OHLC generators (random walk, path-following, trends, timeframe aggregation)
js/core/patterns.js        candlestick-pattern + chart-pattern definitions and generators
js/core/indicators.js      SMA, EMA, RSI, MACD, Bollinger, ATR, swings, S/R, fib, crosses, divergence
js/core/chart.js           CandleChart (interactive SVG chart) + miniChart()
js/core/anim.js            tween / sequence helpers, reduced-motion aware
js/core/ui.js              DOM helper h(), toast, modal, confetti, sfx, quiz widgets, icons
js/core/game-kit.js        GameShell: intro → rounds → results, scoring, timer, XP
js/core/lesson-kit.js      LessonShell: step-by-step lesson with nav, quick checks, completion (+ §12.5 step helpers)
js/core/scanner.js         setup scanner: findSetups, realRound, simRound, outcomeOf, describeChart (§12.4)
js/core/market.js          real market candles via the market-data Edge Function; mock fixtures (§12.3)
js/core/story.js           ChartStory: animated, captioned chart walk-throughs (§12.5)
js/pages/home.js           landing: animated hero chart, tier tracks, continue-where-you-left
js/pages/track.js          tier overview (beginner / advanced)
js/pages/library.js        pattern library (candlestick + chart patterns) with diagrams
js/pages/progress.js       XP, level, badges, per-module best scores
js/pages/glossary.js       searchable glossary of terms
js/pages/dev-chart.js      hidden kitchen-sink page exercising every CandleChart feature
js/pages/playbook.js       #playbook Setup Playbook · js/pages/live.js  #live Live Market Lab (§12.6)
js/lessons/<id>.js         one file per lesson (see registry)
js/games/<id>.js           one file per game (see registry)
tests/unit/*.test.mjs      node:test unit tests for js/core (no DOM)
tests/smoke.mjs            Playwright: every route, console errors, screenshots
tests/fixtures/market/     market-data test fixtures (mock mode) + build-fixtures.mjs
tests/visual/              contact sheets: patterns.html (generators), setups.html (scanner)
package.json               scripts only; no dependencies required at runtime
```

Lessons and games may add private helper files next to themselves using the prefix of
their id, e.g. `js/games/trade-simulator-journal.js`. They must not edit files owned by
another module.

## 3. Routing and the module contract

Routes are plain hash tokens (letters, digits, `-`, `_`, `.` only — no slashes, no `=`):

| hash                | page                                  |
|---------------------|---------------------------------------|
| `#home` or empty    | home                                  |
| `#beginner`         | beginner track                        |
| `#advanced`         | advanced track                        |
| `#library`          | pattern library (`#library.<patternId>` opens one pattern) |
| `#progress`         | progress & badges                     |
| `#glossary`         | glossary                              |
| `#l.<lessonId>`     | lesson                                |
| `#g.<gameId>`       | game                                  |
| `#dev-chart`        | chart kitchen sink (not linked in nav)|

Every lesson and game file default-exports:

```js
export default {
  id: 'fib-sniper',                 // must equal the registry id
  mount(root, ctx) {                // root: empty <div> owned by the module
    // build UI inside root
    return () => { /* cleanup: stop timers, rAF, observers, listeners on window */ };
  },
};
```

`ctx` provided by the router:

```js
ctx = {
  store,                // js/core/store.js singleton
  navigate(hash),       // e.g. ctx.navigate('g.fib-sniper')
  entry,                // this module's registry entry
  registry,             // the whole registry module
  seed,                 // number: fresh random seed for this visit
}
```

Pages in `js/pages/` follow the same `{ mount(root, ctx) }` shape.

The router lazy-loads modules with `import()`. If a module fails to load or throws on
mount, the router shows a friendly error card with a "Back to track" button and logs the
error with `console.error` (so the smoke test catches it).

## 4. Registry (`js/registry.js`) — pure data

```js
export const TIERS = [
  { id: 'beginner', title: 'Beginner', subtitle: 'Read the chart', blurb: '…' },
  { id: 'advanced', title: 'Advanced', subtitle: 'Plan the trade', blurb: '…' },
];

// Units pair a lesson with its game(s). Order = recommended learning order.
export const UNITS = [ { id, tier, title, lesson: 'lessonId' | null, games: ['gameId', …] }, … ];

export const LESSONS = [ { id, tier, title, blurb, minutes, topics: [..], path: './lessons/<id>.js' } ];
export const GAMES   = [ { id, tier, title, blurb, minutes, skills: [..], path: './games/<id>.js',
                           kind: 'quiz'|'draw'|'predict'|'simulation'|'calc' } ];
export const BADGES  = [ { id, title, description, icon } ];
export function findEntry(id) { /* lesson or game by id, with .type = 'lesson'|'game' */ }
```

Curriculum (ids are fixed — other contributors rely on them). **v2 added units** (markets & orders,
chart types, volume, breakouts, psychology and new capstone games): §12.8 has the current, complete
unit list; the tables below are the original units, still valid.

**Beginner — "Read the chart"**

| unit | lesson id | game id(s) |
|---|---|---|
| Candlestick anatomy | `candle-anatomy` | `candle-builder` |
| Candlestick patterns | `candle-patterns` | `pattern-flash` |
| Trends & market structure | `trends` | `trend-spotter` |
| Support & resistance | `support-resistance` | `level-hunter` |
| Trend lines & channels | `trendlines` | `trendline-challenge` |
| Moving averages | `moving-averages` | `cross-catcher` |
| Put it together | — | `what-next` (beginner mode) |

**Advanced — "Plan the trade"**

| unit | lesson id | game id(s) |
|---|---|---|
| Reversal & continuation chart patterns | `chart-patterns` | `pattern-detective` |
| Fibonacci retracements & extensions | `fibonacci` | `fib-sniper` |
| Indicators & divergence (RSI, MACD, Bollinger, volume) | `indicators` | `divergence-detective` |
| Multi-timeframe analysis | `multi-timeframe` | `timeframe-stack` |
| Confluence, timing & risk | `confluence-risk` | `risk-manager` |
| Capstone | — | `what-next` (advanced mode), `trade-simulator` |

`what-next` is registered once with `tier: 'both'`; its intro lets the player pick
Beginner or Advanced mode. Track pages list it under both tiers.

## 5. Design system

Palette idea: *chart paper by day, trading desk by night*. Blue-slate neutrals,
**Fibonacci gold** as the single accent, and semantic bull/bear colours that are never
used as decoration.

Fonts (Google Fonts): display **Bricolage Grotesque** (600–800, headings, big numbers),
body **Figtree** (400–700), data **JetBrains Mono** (400–600, prices, tickers, scores).
Fallbacks: `system-ui, -apple-system, "Segoe UI", sans-serif` and
`ui-monospace, SFMono-Regular, Menlo, monospace`.

Tokens (all defined on bare `:root` = light; redefined for dark under
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` and again
under `:root[data-theme="dark"]`, both with `color-scheme: dark`):

| token | light | dark | use |
|---|---|---|---|
| `--bg` | `#F3F5F9` | `#0B1220` | page ground (body background) |
| `--surface` | `#FFFFFF` | `#111A2B` | cards, chart background |
| `--surface-2` | `#E9EDF4` | `#18233A` | insets, hover, option buttons |
| `--line` | `#D5DCE7` | `#26324B` | borders, dividers |
| `--grid` | `#E6EBF2` | `#1B2640` | chart grid |
| `--text` | `#0F1B2D` | `#E7EDF6` | primary text |
| `--text-2` | `#46546B` | `#A5B1C6` | secondary |
| `--text-3` | `#64718A` | `#7F8DA5` | captions, axes (≥ 4.5:1 on `--bg` and `--surface`) |
| `--accent` | `#B7790F` | `#F2B53A` | Fibonacci gold: primary actions, highlights |
| `--accent-ink` | `#FFFFFF` | `#1A1204` | text on accent |
| `--accent-soft` | `#F6E7C8` | `#3A2C10` | accent tints |
| `--bull` | `#0A8F6A` | `#27C990` | up candles, correct |
| `--bull-soft` | `#D5F1E7` | `#0F3A2E` | |
| `--bear` | `#D23F4A` | `#F2646E` | down candles, wrong |
| `--bear-soft` | `#F8DADD` | `#44191E` | |
| `--info` | `#2F66D9` | `#6C9CFF` | neutral annotation, links |
| `--warn` | `#C2610C` | `#FF9F4A` | caution |
| `--support` | `#0A8F6A` | `#27C990` | support lines (alias of bull) |
| `--resistance` | `#D23F4A` | `#F2646E` | resistance lines (alias of bear) |
| `--ma1` | `#2F66D9` | `#6C9CFF` | fast MA |
| `--ma2` | `#B7790F` | `#F2B53A` | slow MA |
| `--ma3` | `#8E44C9` | `#C08BFF` | third MA / signal line |
| `--fib` | `#B7790F` | `#F2B53A` | fib levels |
| `--muted` | `#76839A` | `#6F7D96` | |
| `--focus` | `#2F66D9` | `#8DB3FF` | focus ring |
| `--radius` | `10px` | | cards |
| `--radius-sm` | `6px` | | buttons, chips |
| `--shadow` | subtle 2-layer | deeper | raised cards only |
| `--font-display`, `--font-body`, `--font-mono` | | | |

Type scale: 12 / 14 / 16 (body) / 18 / 22 / 28 / 36 / 48 px. Headings use
`text-wrap: balance`. Prices and scores use `--font-mono` with
`font-variant-numeric: tabular-nums`.

Layout: max content width 1120px, centered, side gutter `16px` minimum
(`padding-inline: max(16px, env(safe-area-inset-left))`). Top app bar is sticky with
`top: env(safe-area-inset-top, 0px)`. Lessons use a reading column (~680px) with charts
allowed to go wider (up to 960px).

Useful component classes (defined in `css/components.css`):
`.btn`, `.btn--primary`, `.btn--ghost`, `.btn--bull`, `.btn--bear`, `.btn--sm`,
`.card`, `.chip`, `.chip--bull`, `.chip--bear`, `.chip--accent`, `.kbd`,
`.option-grid` + `.option` (`.is-correct`, `.is-wrong`, `.is-selected`),
`.callout` (`.callout--tip`, `.callout--warn`), `.meter` (progress bar),
`.tabs` / `.tab`, `.stack` (vertical flex with gap), `.row` (wrapping flex with gap),
`.muted`, `.mono`, `.eyebrow`, `.visually-hidden`.

## 6. Core API

### 6.1 `js/core/rng.js`

```js
export function makeRng(seed)  // → rng object; deterministic (mulberry32). seed: number or string
rng.next()              // [0,1)
rng.float(min, max)
rng.int(min, max)       // inclusive
rng.pick(array)
rng.shuffle(array)      // returns new array
rng.chance(p)           // boolean
rng.gauss(mean=0, sd=1)
rng.sign()              // -1 | 1
rng.fork(label)         // child rng: hash(label) salted with the ORIGINAL seed, so a fork does
                        // not depend on how many numbers the parent already drew
rng.seed                // the normalised uint32 seed            (addition)
rng.weighted(items, weights) / rng.sample(array, n)             (additions)
export function randomSeed()   // uses Math.random, returns uint32
export function hashString(str, salt = 0) / toSeed(seed)        // (additions)
```

### 6.2 `js/core/data.js`

A candle is `{ o, h, l, c, v, t }` (`t` = integer index of the period, `v` = volume).
Every generator guarantees `l <= min(o,c) <= max(o,c) <= h` and positive prices. Opens sit at
(or a hair from) the previous close; gaps are rare; wick lengths are skewed (mostly short,
occasionally long); volume grows with range and with candles that move with the trend.

```js
export function randomWalk({ seed, count = 120, start = 100, drift = 0, vol = 0.012, volume = true })
  // → candles. drift/vol are per-candle fractions. Volatility clusters; ~6% larger candles.

export function fromPath(points, { seed, count = 120, start = 100, noise = 0.35,
                                   wick = 0.6, volume = true, exact = true })
  // points: [[x, price], …] with x in [0, 1] (0 = first candle, 1 = last). Prices are absolute;
  // `start` is the price at x = 0 when the first point is not at x = 0.
  // Closes follow the piecewise-linear path; noise is relative to the path's own per-candle
  // move (Brownian-bridge wiggles + candle-to-candle noise, damped next to waypoints), so a
  // trend leg shows realistic pullbacks and ~20% counter-trend candles while the shape stays clear.
  // With exact = true: an interior waypoint that is a local PEAK of the path gets a candle whose
  // HIGH equals the price and no other candle of its swing — from the previous trough waypoint
  // to the next one — reaches it (troughs: LOW, symmetric), so a labelled peak is the real swing
  // high a trader would mark; every other waypoint ('mid': endpoints, points on a monotonic
  // run) is hit by the CLOSE.
  // → { candles, anchors: [{ idx, price, kind: 'high'|'low'|'mid' }] }  (one per point, input order)
  // Keep waypoints ≥ 4 candles apart; closer peaks/troughs squash the candles between them.

export function trendSeries({ seed, count = 80, start = 100, direction = 'up'|'down'|'range',
                              swings = 4, strength = 1, volume = true })
  // Zig-zag market structure. `swings` = number of swing highs (and of swing lows).
  // 'up': higher highs + higher lows (every high clearly above the last), 'down' mirrored,
  // 'range' oscillates between a ceiling and a floor. Each swing is the exact high/low of its
  // candle, the extreme of all candles between its neighbouring swings, and is found by
  // indicators.swings({left:3,right:3}); labels equal labelStructure() of the swings.
  // → { candles, swings: [{ idx, price, type: 'high'|'low', label: 'HH'|'HL'|'LH'|'LL'|'H'|'L' }] }

export function aggregate(candles, factor, { partial = true } = {})
  // Combine every `factor` consecutive candles into one higher-timeframe candle.
  // o = first.o, c = last.c, h = max h, l = min l, v = sum v, t = index in new series.
  // A trailing incomplete group is kept (the still-forming candle) unless partial = false.

export function addVolume(candles, { seed, base = 1000, trendBoost = true })
  // Causal: bar i's volume depends only on bars 0..max(i, 9), so a different future never
  // changes the volume of candles already shown.
export function scale(candles, factor) / shift(candles, delta)   // pure helpers
export function roundPrice(p, decimals = 2)
// additions:
export function synthesize(closes, { seed, open, scale, wick = 0.6 })  // candles around a close series
export function isValidCandle(c) / reindex(candles, start = 0) / concat(...series)
```

### 6.3 `js/core/patterns.js`

```js
export const CANDLE_PATTERNS = {
  hammer: {
    id: 'hammer', name: 'Hammer', candles: 1,
    bias: 'bullish' | 'bearish' | 'neutral',
    kind: 'reversal' | 'continuation' | 'indecision',
    context: 'downtrend' | 'uptrend' | 'any',    // where it is meaningful
    summary: 'one sentence',
    psychology: 'what buyers/sellers did',
    howToTrade: 'confirmation, entry, stop',
    reliability: 1..3,
    generate(rng, { price, range }) → [candles]  // just the pattern candles (t = 0.., v = 0);
                                                 // price = previous close, range = typical range
    check(candles) → boolean                     // (addition) geometry test on the last N candles
  }, …
};
// Required ids: doji, dragonfly-doji, gravestone-doji, spinning-top, bullish-marubozu,
// bearish-marubozu, hammer, inverted-hammer, hanging-man, shooting-star,
// bullish-engulfing, bearish-engulfing, bullish-harami, bearish-harami, piercing-line,
// dark-cloud-cover, tweezer-top, tweezer-bottom, morning-star, evening-star,
// three-white-soldiers, three-black-crows
// Contexts: bullish reversals → 'downtrend', bearish reversals → 'uptrend', marubozu
// (continuation) → the trend in its own direction, doji / spinning top → 'any'.
// Generators satisfy the textbook definitions for every seed at any price scale (see
// tests/unit/candle-audit.test.mjs): e.g. doji |c−o| ≤ 8% of range; hammer lower wick ≥ 2× body
// and upper wick ≤ 10% of range; engulfing body strictly engulfs the opposite-colour prior body;
// the whole harami candle sits inside the first body; tweezer highs/lows within 0.1% of price AND
// within 4% of the larger candle's range (0.1% alone is most of a candle at FX prices). A
// generated pattern never also satisfies a rival definition (engulfing ≠ tweezer, tweezer ≠
// harami / piercing / dark cloud, …); a dragonfly/gravestone is also a doji by definition.

export function candleScenario(patternId, { seed, leadIn = 14, after = 0, start = 100,
                                            outcome = 'success' | 'fail' })
  // Lead-in trend that matches the pattern's context (downtrend before bullish reversals,
  // uptrend before bearish ones, a trend in the pattern's direction for continuation, any for
  // neutral), then the pattern, then `after` follow-through candles. 'success' moves in the
  // pattern's bias direction and its first candle closes beyond `confirm` — the confirmation
  // level from the pattern's howToTrade text (above a hammer's high, above a harami's first
  // open, below a shooting star's body, …); 'fail' moves against it and, with after ≥ 3, closes
  // beyond the pattern's extreme. Neutral patterns move in a random direction.
  // The lead-in is chosen so that (a) findCandlePatterns / trendBefore see the right context,
  // (b) a reversal pattern prints the extreme of the move (soldiers/crows start from it), and
  // (c) there is exactly one answer: no other instance of the pattern, no recent reversal signal
  // in the same direction, nothing else ending on or straddling into the pattern candles.
  // Lead-in and pattern OHLC are identical for both outcomes and any `after`; only the pattern
  // candle's volume differs (strong on success, weak on fail — a harami's inside day is quiet).
  // Use leadIn >= 6 (shorter lead-ins are too short for trend context).
  // → { candles, start: idx, end: idx,          (inclusive indexes of the pattern)
  //     id, bias, context, trend: 'up'|'down'|'range', outcome, direction: 1|-1,
  //     confirm: price }                        (addition)
// additions:
export const CANDLE_PATTERN_IDS
export function checkCandlePattern(id, candles) → boolean       // geometry only
export function findCandlePatterns(candles, { ids, context = true, lookback = 8 }) → [{ id, start, end }]
export function trendBefore(candles, idx, lookback = 8) → 'up'|'down'|'range'
export const body, span, upperWick, lowerWick, isBull, isBear    // candle geometry helpers

export const CHART_PATTERNS = {
  'head-and-shoulders': {
    id, name, bias, kind: 'reversal'|'continuation', summary, psychology, howToTrade,
    target: 'measured-move rule in words', reliability,
    path(rng) → { points: [[x, price], …], labels: { pointIndex: 'Left shoulder', … },
                   breakoutPoint: index, neckline?: [pointIndexA, pointIndexB],
                   boundaries?: { upper: [i, j], lower: [i, j] },   // (addition) point indexes
                   startPoint, keyStart, direction: 1|-1, measure }  // (additions)
  }, …
};
// Required ids: head-and-shoulders, inverse-head-and-shoulders, double-top,
// double-bottom, triple-top, triple-bottom, rising-wedge, falling-wedge,
// ascending-triangle, descending-triangle, symmetrical-triangle, bull-flag,
// bear-flag, cup-and-handle, rounding-bottom
// symmetrical-triangle has bias 'neutral': each scenario breaks with its prior trend and
// reports the actual bias/direction.
export const CHART_PATTERN_IDS

export function chartScenario(patternId, { seed, count = 110, start = 100, after = 20,
                                           outcome = 'success' | 'fail' })
  // Prior trend + formation + breakout fill the first count − after candles; `after`
  // candles show the outcome. 'success' reaches the measured-move target (often retesting the
  // broken line first; the retest holds — no close back through the broken level); 'fail'
  // breaks out briefly on weak volume, then reverses back through the pattern (a trap, ending
  // at least 0.3 × height back inside). Both outcomes of a seed share identical candles up to
  // and including the breakout candle (only volume from the breakout candle on differs).
  // Guarantees: key points are the real swing extremes (highest high / lowest low between the
  // neighbouring key points); no close beyond the broken line before breakoutIdx and, for
  // triangles / wedges / flags, every close between the two lines (wicks may poke through a
  // little); the breakout candle closes beyond the line by ≥ max(0.3 × average range,
  // 0.05 × height). Volume: fades through the formation (flags: heavy pole, fading flag;
  // cup / saucer: U-shaped, driest at the bottom, quiet handle); each retest of a level
  // (Top 2, Top 3, right shoulder) is lighter than the first; the breakout bar is ≥ 1.35× the
  // formation average on success and below the recent average on a trap.
  // Use count ≥ 90 (the default 110 is right for ~60–80 visible candles on phones).
  // → { candles, patternStart, patternEnd, breakoutIdx,
  //     keyPoints: [{ idx, price, label }],          // labels e.g. 'Left shoulder', 'Head',
  //                                                  // 'Right shoulder', 'Neckline', 'Top 1',
  //                                                  // 'Upper line', 'Flagpole top', 'Cup bottom',
  //                                                  // 'Breakout' (the breakout candle's close)
  //     neckline: { x1, y1, x2, y2 } | null,         // idx/price; from the first key point to
  //                                                  // the breakout. Double top/bottom: the
  //                                                  // horizontal trough/peak level.
  //     boundaries: { upper: {x1,y1,x2,y2}, lower: {x1,y1,x2,y2} } | null,  // triangles,
  //                                                  // wedges, flags; both start at the same x1
  //     target: price, height, level,                // measured move: target = level + dir × height,
  //                                                  // level = broken line's price at breakoutIdx
  //     bias, direction: 1|-1, outcome, reachedTarget, id, name }
  // patternEnd = breakoutIdx − 1 (breakoutIdx = first close beyond the neckline/boundary).
  // Height: H&S head→neckline; double/triple extremes→neckline; triangles/wedges the widest
  // part; flags the pole; cup/rounding bottom the depth below the rim.
```

### 6.4 `js/core/indicators.js`

All series functions return arrays aligned with the input (same length) with `null` during
warm-up.

```js
sma(values, period)            ema(values, period)   // EMA: k = 2/(n+1), seeded with the SMA of
                                                     // the first n values; skips leading nulls
rsi(closes, period = 14)                             // Wilder smoothing
macd(closes, fast = 12, slow = 26, signal = 9) → { macd, signal, hist }   // hist = macd − signal
bollinger(closes, period = 20, mult = 2)       → { mid, upper, lower, width }  // population sd,
                                                     // width = (upper − lower) / mid
atr(candles, period = 14)                            // Wilder; first value = mean of first n TRs
closes(candles) / highs(candles) / lows(candles)     // + opens / volumes / trueRange / rma
swings(candles, { left = 3, right = 3, alternate = false }) → [{ idx, price, type: 'high'|'low' }]
     // ordered by idx; a high is strictly above the `left` bars and ≥ the `right` bars;
     // alternate: merge consecutive same-type swings
labelStructure(swings) → same with label 'HH'|'HL'|'LH'|'LL' (first high/low: 'H'/'L')
trendOf(candles) → 'up'|'down'|'range'         // from swing structure + slope
supportResistance(candles, { tolerance = 0.006, minTouches = 2, left = 2, right = 2 })
  → [{ price, touches, type: 'support'|'resistance'|'both', firstIdx, lastIdx, score }] strongest first
     // clusters swing highs/lows within `tolerance`; ranked by touches + recency
fibLevels(from, to, ratios = [0, .236, .382, .5, .618, .786, 1])
  → [{ ratio, price }]   // from = swing start price, to = swing end price;
                          // retracement ratio r → price = to - (to - from) * r
fibExtensions(from, to, ratios = [1.272, 1.618, 2.618]) → [{ ratio, price }]
                          // price = from + (to − from) × ratio (beyond the swing end)
fibProjection(a, b, c, ratios = [0.618, 1, 1.618])     // (addition) c + (b − a) × ratio
crosses(fast, slow) → [{ idx, type: 'golden'|'death' }]   // golden: fast crosses above slow
divergence(candles, oscillator, { lookback = 40, left = 3, right = 3 })
  → [{ type: 'bullish'|'bearish'|'hidden-bullish'|'hidden-bearish',
       a: { idx, price, value }, b: { idx, price, value } }]
     // consecutive swing lows (highs) of price vs the oscillator extreme within ±2 bars;
     // pairs more than `lookback` bars apart are skipped
linearRegression(points) → { slope, intercept, r2 }   // [[x,y]] | [{x,y}] | [{idx,price}] | numbers
highest(values, period) / lowest(values, period)       // (additions) nulls are ignored
// rsi: a window with no gains and no losses reads 50; only gains → 100; only losses → 0.
// Verified against the StockCharts/Wilder worked example to 0.01 (tests/unit/indicators-reference).
```

### 6.5 `js/core/chart.js` — `CandleChart`

SVG, responsive width (ResizeObserver on the container), fixed height. Re-renders on a
requestAnimationFrame when anything changes (hover only updates the crosshair/legend layer).
Uses `css/chart.css` classes and colour tokens. Importable in node (no DOM at import time).

```js
import { CandleChart, miniChart, candleSVG } from '../core/chart.js';

const chart = new CandleChart(container, {
  candles,                 // required
  height: 340,             // price area incl. the time axis; each pane adds its own height
  slots: null,             // number of x slots; default = candles.length. Use a larger
                           // value to reserve empty space on the right for future candles.
  visible: null,           // draw only the first N candles (default: all)
  autoscale: 'visible',    // 'visible' | 'all' | [min, max] — y-range source. Default
                           // 'visible' so hidden future candles never leak into the scale.
                           // Series/bands are included; other overlays only with { fit: true }.
  yPad: 0.08,              // extra headroom fraction
  showVolume: false,       // bottom ~18% of the price area, coloured by candle direction
  showAxis: true,          // right price axis + bottom index/time axis
  showGrid: true,
  crosshair: true,         // hover/touch crosshair with price readout
  decimals: 2,
  timeLabel: null,         // (idx, candle) => string for the x-axis
  ariaLabel: 'Price chart',
  legend: true,            // (addition) O H L C + change % of hovered/last candle, series values
  showLast: true,          // (addition) last close as a pill on the price axis
  interactive: true,       // (addition) pointer + keyboard interaction; container gets tabindex=0
});
```

Colour arguments accept a **token name** (`'accent' | 'bull' | 'bear' | 'info' | 'warn' |
'support' | 'resistance' | 'ma1' | 'ma2' | 'ma3' | 'fib' | 'muted' | 'text'`) which maps to
`var(--<name>)`, or any literal CSS colour.

Points are always in **data space**: `{ idx, price }` where `idx` may be fractional.

```js
// data
chart.setCandles(candles)                 // keeps overlays
chart.setVisible(n)                       // show first n candles (y-scale eases)
chart.reveal({ to, interval = 160, onStep, grow = true }) → Promise   // animate candles
                                          // appearing one at a time up to index `to` (exclusive);
                                          // each grows open→close; instant with reduced motion
chart.append(candle, { grow = true })     // push one candle (replays / live)
chart.setSlots(n)
chart.visibleCount / chart.candles / chart.layout / chart.overlays / chart.isDrawing  // (additions)

// overlays — every add* returns an id (string); pass { id } to choose one.
// Any overlay: { fit: true } includes it in autoscale; { hidden: true } skips drawing.
chart.addHLine({ price, color = 'accent', label, dashed = false, width = 1.5, from, to,
                 priceTag = true, pane })  // price pill on the axis, label pill at the line's end
                                          // from/to: optional idx range, default full width
chart.addSegment({ a: {idx, price}, b: {idx, price}, color = 'info', width = 2, dashed, label,
                   extend: 'none'|'right'|'left'|'both', arrow = false, pane })
chart.addSeries({ values, color = 'ma1', width = 1.75, label, dashed, opacity })  // e.g. MA;
                                          // labelled series show their value in the legend
chart.addBand({ upper, lower, color = 'info', opacity = 0.12, edges = true })  // e.g. Bollinger
chart.addZone({ from, to, color = 'accent', opacity = 0.14, label, x1, x2 })  // price band
chart.addBox({ from, to, color = 'accent', label, top, bottom, full })  // highlight idx range;
                                          // box hugs those candles' high/low unless top/bottom
                                          // (prices) or full: true (full height) is given
chart.addMarker({ idx, price, position = 'above'|'below'|'at', shape = 'arrow'|'dot'|'ring'|'tag',
                  text, color = 'accent', pane })   // price defaults to high/low/close
chart.addPath({ points: [{idx, price}], color = 'info', width = 2, dots = true,
                labels: ['HH', …] })               // zig-zag / structure; labels above peaks
chart.addFib({ a: {idx, price}, b: {idx, price}, ratios, extensions = [], color = 'fib',
               labels = true, zone: [0.5, 0.618] | null, extend = true })  // retracement tool
               // a = swing start, b = swing end; level r at b − (b − a)·r, extensions at
               // a + (b − a)·r; labels "0.618 · 103.42" as pills at the right edge (ratio only
               // on charts narrower than 520px unless labels: 'full')
chart.addText({ idx, price, text, color = 'text', anchor = 'start'|'middle'|'end', size, pane })
chart.update(id, patch)                   // merge patch into overlay spec and re-render
chart.remove(id)
chart.clearOverlays()                     // does not remove panes
chart.getOverlay(id)                      // copy of the spec (with `type`)

// indicator panes (share the x-scale, stacked under the price area)
chart.addPane({ id, height = 90, title, range: 'auto' | [min, max],
                levels: [{ value, label, color }],
                series: [{ values, color, width }],
                histogram: { values, pos = 'bull', neg = 'bear' }, decimals })
chart.updatePane(id, patch)
chart.removePane(id)
// hlines/segments/markers/texts may target a pane with { pane: 'rsi' } (y = pane value).

// interaction
chart.on('click' | 'hover' | 'leave', fn)   // fn({ idx, price, x, y, candle, pane, exactIdx })
chart.off(event, fn)                        // idx snaps to the nearest candle centre; exactIdx is
                                            // fractional; candle is null for empty slots.
                                            // Touch: the crosshair stays after a tap; 'leave'
                                            // fires on mouse leave or when a touch turns into a scroll.
chart.draw(kind, opts) → Promise<shape|null>
  // kind: 'hline' (one tap / press-drag-release), 'segment' (drag or tap-tap),
  //       'fib' (drag a→b or tap-tap), 'zone' (drag price range)
  // opts: { color, snap: false | 'ohlc' (snap to nearest high/low/open/close within 12px)
  //         | 'candle' (x only), label, extend (segment), dashed (hline),
  //         fib: { …addFib options }, keep = true }
  // Live preview while dragging; touch-action: none on the SVG while drawing (page scroll is
  // otherwise allowed: pan-y). Keyboard: arrows move a cursor (Shift ×5), Enter/Space places a
  // point, Esc cancels.
  // resolves with { kind, a: {idx, price}, b: {idx, price}, price?, from?, to?, id } and leaves
  // the drawing on the chart as an overlay with that id. Resolves null if cancelDraw().
chart.cancelDraw()
chart.setDraggable(id, onChange)          // hline: vertical drag; segment/fib: endpoint handles;
                                          // zone: edge handles. onChange(spec, { phase:
                                          // 'move'|'end', handle }). Pass false to stop.
                                          // Handle hit circles are 28px (44px on coarse pointers);
                                          // an hline can be grabbed anywhere on the line and its
                                          // grip sits mid-line. ↑/↓ on the focused chart nudge
                                          // the last draggable overlay.
chart.setInteractive(enabled)
chart.setAriaLabel(text)                  // (addition)

// coordinates (SVG px relative to the chart's top-left)
chart.idxToX(idx) / chart.xToIdx(x) / chart.priceToY(p) / chart.yToPrice(y)
chart.flash(idx, color = 'accent')        // brief pulse highlight on a candle
chart.destroy()                           // disconnects observers/listeners, removes the SVG

// Keyboard (container focused): ←/→ move the crosshair (Shift ×5, Home/End), Enter emits
// 'click' for that candle, Esc hides it. Screen readers get an aria-live OHLC summary.
```

`miniChart(candles, { width = 160, height = 90, overlays = [], highlight = null,
padding = 6, ariaLabel, yPad }) → SVGSVGElement` — static, axis-less thumbnail for cards,
answer options and the pattern library. `overlays` accepts the same specs as the `add*`
methods with a `type` field (`'hline'|'segment'|'series'|'band'|'zone'|'box'|'marker'|'path'|'fib'|'text'`).
Overlay prices are included in its y-range. `highlight`: idx, `[from, to]` or `{ from, to }`.

`candleSVG({ o, h, l, c }, { width = 60, height = 140, min, max, labels = false,
prices = false, decimals = 2 }) → SVGSVGElement` — a single large candle, used by lessons.
`labels: true` adds callouts (High, Open/Close, Low on the right; Upper wick, Body, Lower wick
brackets on the left) and widens the SVG; `prices: true` appends the prices. The element has
`.update({ o, h, l, c })` to redraw in place.

Also exported: `colorOf(color, fallback)`, `niceStep(raw)`, `niceTicks(min, max, maxTicks)`.

### 6.6 `js/core/anim.js`

```js
export const reducedMotion = () => boolean       // OS setting, or <html data-motion="reduce">
export function tween({ from, to, duration = 400, ease = easeOutCubic, onUpdate, delay = 0 })
  → Promise<boolean>                             // from/to: number | number[] | {k: number};
                                                 // promise.cancel() stops it (resolves false)
export function sleep(ms) → Promise              // resolves immediately with reduced motion
export function sequence(steps) → { play(), stop(), done: Promise }   // steps: () => Promise;
                                                 // done resolves true when all ran, false if stopped
export const ease = { linear, easeOutCubic, easeInOutCubic, easeOutBack }
export function countUp(el, to, { duration, decimals, prefix, suffix, from })
export const now, raf, cancelRaf                 // (additions) rAF with a timer fallback in node
```

### 6.7 `js/core/ui.js`

```js
h(tag, attrs?, ...children) → Element     // attrs: class, style (obj|string), on:{click}, data-*, aria-*
                                          // children: strings, nodes, arrays, null
svg(tag, attrs?, ...children) → SVGElement
toast(message, { type = 'info'|'good'|'bad'|'xp', duration = 2600 })
modal({ title, body: Node|string, actions: [{ label, primary, onClick }] }) → { close }
confetti(originEl?)                       // brief celebratory burst, no-op with reduced motion
sfx.correct() / sfx.wrong() / sfx.tick() / sfx.win() / sfx.click()   // WebAudio; obeys store.settings.sound
icon(name, { size = 18 }) → SVGElement    // line icons: candle, chart, trend-up, trend-down,
   // target, ruler, layers, clock, shield, spark, play, pause, step, restart, check, x,
   // lock, star, star-fill, trophy, book, arrow-left, arrow-right, info, sun, moon, sound, mute
choiceQuiz({ question, options: [{ label, node?, value }], answer, explain, onAnswer })
  → Element                               // accessible option buttons, marks correct/wrong,
                                          // shows explanation, calls onAnswer(correct, value)
explainer(html) → Element                 // styled explanation block after an answer
kbdHint(keys, label) → Element
```

### 6.8 `js/core/game-kit.js` — `GameShell`

Every game uses the shell so they all feel the same:

```js
import { GameShell } from '../core/game-kit.js';

const game = new GameShell(root, ctx, {
  rounds: 10,                               // number of rounds, or null for open-ended
  modes: [{ id: 'beginner', label: 'Beginner' }, { id: 'advanced', label: 'Advanced' }], // optional
  howTo: ['bullet', 'bullet'],              // shown on the intro card
  preview: (el) => {},                      // optional: draw a teaser on the intro card
  maxScore: 1000,                           // used for stars; default rounds * 100
  timer: null | { seconds, perRound: true|false },
  onStart(game, { mode, seed, rng }) {},    // begin: call game.nextRound()
  onRound(game, { round, rng, stage }) {},  // render round `round` (1-based) into `stage`
  onEnd(game, summary) {},                  // optional extra content for results
});

game.stage                   // element for the current round's content (cleared each round)
game.score / game.streak / game.round / game.mode / game.rng
game.award(points, { reason })            // adds points (+ streak bonus if configured)
game.correct(text?, { points = 100 })     // streak++, sfx, feedback banner, award
game.wrong(text?)                         // streak = 0, sfx, feedback banner
game.feedback(nodeOrHtml, type)           // show explanation under the stage
game.nextButton(label = 'Next round')     // shows a Next button that calls nextRound()
game.nextRound()                          // advances or finishes
game.finish()                             // results: score, stars (≥90% 3★, ≥65% 2★, ≥35% 1★),
                                          // best score, XP earned, badges, play again / back
game.timer.start(seconds, onExpire) / .stop() / .remaining
game.onCleanup(fn)                        // register teardown
game.destroy()
```

XP: finishing a game awards `round(score / maxScore * 60) + 10 * stars` XP, saved via
`store.recordGame(id, { score, stars, mode })`. 3★ awards the badge `<gameId>-ace` if defined.

### 6.9 `js/core/lesson-kit.js` — `LessonShell`

```js
import { LessonShell } from '../core/lesson-kit.js';

new LessonShell(root, ctx, {
  intro: 'One-paragraph promise of what you will be able to do.',
  steps: [
    { title: 'What a candle records', render(el, step) { …; return cleanup? } },
    { title: 'Quick check', quiz: { question, options: [...], answer, explain } },
    …
  ],
});
```

Renders: header (tier chip, title, minutes), a step rail (numbered — steps ARE a
sequence), the current step, Back/Next buttons, keyboard ←/→. A step with `quiz` renders a
`choiceQuiz`; Next is enabled after answering. Finishing the last step calls
`store.completeLesson(id)` (+50 XP first time), shows a completion card that links to the
unit's game(s). `step.render` gets `el` (the step body) and may return a cleanup function
that runs when the step changes.

### 6.10 `js/core/store.js`

```js
export const store = {
  state,                                   // { xp, lessons: {id: {done, at}}, games: {id: {best, stars, plays}}, badges: [], settings: { sound, theme } }
  level() → { index, title, min, next, progress }   // levels below
  addXP(n, reason)                         // toast "+n XP"; level-up modal when crossing
  completeLesson(id)
  recordGame(id, { score, stars, mode }) → { isBest, xp, newBadges }
  award(badgeId) → boolean                 // true if newly earned (toast)
  has(badgeId)
  setSetting(key, value)
  on(event, fn) / off(event, fn)           // events: 'change', 'xp', 'level', 'badge'
  reset()
};
LEVELS = Paper Trader (0) · Chart Reader (150) · Swing Spotter (400) · Level Hunter (800)
       · Pattern Pro (1300) · Setup Sniper (2000) · Risk Manager (2900) · Market Wizard (4000)
```

## 7. Content rules

- Accuracy matters more than flash. Definitions follow standard technical-analysis usage
  (Nison for candlesticks, Bulkowski/Edwards & Magee for chart patterns, Wilder for RSI).
- Always teach context and confirmation; never promise that a pattern "always works".
  Games that reveal outcomes include some failed setups and explain why.
- Explanations after each answer say *why*, pointing at the chart (marker, box, line).
- Use realistic but generic prices (around 100, or FX-like 1.0850 with 4 decimals
  where it matters). No real tickers or company names.
- Plain, direct language for beginners; the Advanced tier may use more terms but defines
  them on first use (and they appear in the glossary).
- "Not financial advice" disclaimer lives in the footer and on the simulator.

## 8. Testing

- `npm test` → `node --test "tests/unit/*.test.mjs"` (core modules must not touch the DOM at
  import time). Node 22 does not expand a bare directory, so `tests/unit/index.js` exists to
  make `node --test tests/unit/` work too (node resolves the directory to that file, which
  imports every `*.test.mjs` in one process). The whole suite runs in under 10 s.
- `tests/visual/patterns.html` (serve the repo root, open `/tests/visual/patterns.html`) is a
  contact sheet of every candlestick and chart pattern for several seeds, with key points,
  neckline / boundaries, target and confirmation level drawn in. Query: `?theme=dark`,
  `?only=candle|chart`, `?id=<patternId>`, `?seeds=1,2,3`, `?zoom=6`, `?fail=0`.
- `npm run smoke` → `node tests/smoke.mjs`: starts a static server on a free port, opens
  every route (desktop 1280×800 and phone 390×844, light and dark), fails on any console
  error / page error / failed request, saves screenshots to `tests/screenshots/`
  (git-ignored). `node tests/smoke.mjs g.fib-sniper` checks a single route.
- Playwright is resolved from the local `node_modules` or, failing that, the global npm
  root. Chromium path: `PLAYWRIGHT_BROWSERS_PATH` or `/opt/pw-browsers/chromium`.

## 9. Accounts, subscriptions and access

Backend: Supabase project `the-trade-school` (ref `pedcpgmowqhqgersxxqa`, us-east-1).
Schema: `supabase/migrations/20260927180000_accounts_and_billing.sql` (applied).
Billing: Stripe Checkout + customer portal via Edge Functions in `supabase/functions/`
(deployed: `create-checkout`, `customer-portal`, `stripe-webhook`). Setup steps for the
owner live in `docs/ACCOUNTS.md`.

### 9.1 Plans and what they unlock

| plan | price | unlocks |
|---|---|---|
| (signed out) | — | home, track overviews, pricing, glossary, sign-in pages |
| `free` (account, no subscription) | $0 | + unit 1 (`candle-anatomy`, `candle-builder`), the Pattern Library, progress sync |
| `beginner` | **$19.99 / month** | + every Beginner lesson and game, `what-next` Beginner mode |
| `advanced` | **$29.99 / month** | + everything in Beginner **and** every Advanced lesson and game |

`public.access_level()` (SQL, security invoker) returns `'free' | 'beginner' | 'advanced'`
for the caller from `subscriptions` (status active/trialing/past_due) and `access_grants`.

### 9.2 Browser modules

```
js/config.js         public config: SUPABASE_URL, SUPABASE_KEY (publishable key — safe in
                     the browser), PLANS, FREE_IDS, ACCESS_MODE, PREMIUM_SOURCE
js/vendor/supabase.js  vendored @supabase/supabase-js UMD build (window.supabase), loaded
                     lazily by auth.js — no CDN
js/core/auth.js      session, sign up/in/out, magic link, password reset, access level,
                     checkout + billing portal, 'change' events; mock mode for tests
js/core/access.js    requiredPlan(entry | mode) and canOpen(); lock labels for the UI
js/core/sync.js      merges local progress with the `progress` row and pushes debounced
js/pages/pricing.js  #pricing      plan cards, FAQ, current plan
js/pages/account.js  #account      profile, plan status, manage billing, sign out
js/pages/auth.js     #signin #signup #reset #reset.update
js/pages/paywall.js  rendered by the router in place of a locked lesson/game
js/pages/legal.js    #terms #privacy (drafts for the owner to review)
```

`auth` API:

```js
import { auth } from './core/auth.js';
await auth.ready;                       // session restored (or none)
auth.user          // null | { id, email }
auth.profile       // null | { display_name }
auth.level         // null (signed out) | 'free' | 'beginner' | 'advanced'
auth.mode          // 'supabase' | 'mock' | 'offline' (vendor/network unavailable)
auth.signUp({ email, password, displayName }) → { needsConfirmation }
auth.signIn({ email, password })
auth.signInWithMagicLink(email)
auth.sendPasswordReset(email)
auth.updatePassword(password)
auth.signOut()
auth.refreshAccess() → level
auth.checkout(plan)                     // redirects to Stripe, or resolves { switched }
auth.openBillingPortal()                // redirects to the Stripe customer portal
auth.on('change', fn) / auth.off('change', fn)
```

- PKCE flow (`flowType: 'pkce'`), so email links come back as `?code=…` and never
  collide with the hash router; the `code` param is stripped with `history.replaceState`
  after the exchange. Password recovery lands on `#reset.update`.
- Checkout returns to `?checkout=success#account`; the account page polls
  `refreshAccess()` for up to ~30 s while the webhook lands.
- Mock mode (only on localhost/127.0.0.1): `localStorage['tts-auth-mock']` holds a fake
  user and level so Playwright can exercise every flow without network access.

### 9.3 Enforcement

- `ACCESS_MODE`: `'auto'` (default) enforces plans on real hosts and leaves everything
  open on localhost/127.0.0.1 so development and the smoke test see every module;
  `localStorage['tts-enforce-access'] = '1'` forces enforcement locally for testing.
- The router checks `access.canOpen(entry)` before importing a lesson/game/library page and
  mounts `paywall.js` instead when blocked. `ctx.access` is passed to every module
  (`{ level, can(plan) }`); GameShell modes may declare `requires: 'advanced'` and render
  locked with an upgrade link.
- Client-side checks are UX. Real enforcement is `PREMIUM_SOURCE = 'storage'`: paid module
  files are uploaded to the private `premium` Storage bucket (`beginner/…`, `advanced/…`)
  by `scripts/publish-premium.mjs`, removed from the public site build, and loaded by the
  router through Storage (RLS checks `access_level()`), with relative imports rewritten to
  absolute URLs. This only protects content if the source repository is private.

## 10. Devices

Every page must work on phones (360–430 px, touch), tablets (768–1180 px, touch, portrait
and landscape) and desktops (mouse + keyboard). Rules:

- Pointer events only; hit targets ≥ 44 px on touch; no hover-only information (every
  hover readout also appears on tap).
- Charts size to their container; at tablet widths lessons use a wider chart column.
- `manifest.webmanifest` + icons (SVG, 192, 512, maskable, apple-touch-icon) make the site
  installable to a home screen; `sw.js` caches the static shell (never Supabase requests or
  premium modules) and is only registered on https or localhost.
- The smoke test covers desktop 1280×800, tablet 820×1180 (touch) and phone 390×844
  (touch), light and dark.

## 11. Shell and kit additions (beyond §3–§6)

Everything below is **additive** — the APIs in §3–§6 are unchanged. Use these freely.

### 11.1 Router (`js/core/router.js`)

- Exports: `startRouter(el, { store, onRoute })`, `navigate(hash)`, `parseHash(hash)`,
  `currentRoute()`, `setAccessGate(gate)`.
- `ctx` also carries `route` (`{ key, kind: 'page'|'lesson'|'game'|'notfound', page?, id?,
  tier?, param? }`), `param` (e.g. the pattern id for `#library.<id>`), `access`
  (`{ level, can(plan) }`; everything allowed while no gate is registered) and `blocked`.
- After `mount()` resolves, the route root gets `data-mounted="<route key>"` (the smoke
  test waits for it); failures add `data-route-error`.
- Clicks on `<a href="#…">` are routed through `navigate()` (so links work even where
  `location.hash` is read-only). Add `data-no-route` to opt a link out.
- `setAccessGate({ canOpen(entry, route) → bool|Promise, access, paywallPath? })` wires §9.3:
  when `canOpen` returns false for a lesson, game or library route, the router mounts
  `paywallPath` (default `js/pages/paywall.js`) with the requested `entry` in `ctx` and
  `ctx.blocked = true`. Nothing registers a gate yet; `main.js` should call it once
  `js/core/access.js` exists.

### 11.2 Registry helpers (`js/registry.js`)

Lesson/game entries carry `type`. Unit ids: `u-<lessonId>` plus `u-beginner-capstone` and
`u-advanced-capstone`. Ace badges carry `game`. Helpers: `findTier(id)`, `findBadge(id)`,
`unitsOf(tier)`, `unitOf(id, tier?)`, `learningPath(tier)` → `[{ type, id, unit }]`,
`nextItem(id, tier?)` (Beginner continues into Advanced), `hashFor(id)`, `lessonsOf(tier)`,
`gamesOf(tier)` (includes `'both'`).

### 11.3 Store (`js/core/store.js`)

- Also exports `LEVELS` and `levelFor(xp)`; `level()` additionally returns `number`,
  `nextTitle`, `xp`.
- `state` also has `badgeDates`, `lessonSteps` (`{ id: { step, max } }`), `last`
  (`{ type, id, at }`), `lastTier`, `bestStreak`. `settings.theme` is
  `'system'|'light'|'dark'` and mirrors `localStorage['tts-theme']`.
- `addXP(n, reason, { silent, noModal })`; `completeLesson(id)` → `true` the first time;
  `award(id, { silent })`.
- `recordGame(id, { score, stars, mode, maxScore?, xp?, perfect? })` → `{ isBest, xp,
  newBadges, best }`. Awards XP itself (GameShell passes the §6.8 formula as `xp`),
  `<id>-ace`, `perfect-score`, `first-game`, `explorer` and the XP badges (silently —
  the results screen lists them).
- `isLessonDone(id)`, `gameStats(id)`, `getSetting(k)`, `setLast({ type, id })`,
  `setLastTier(tier)`, `getLessonStep(id)`, `setLessonStep(id, step, max)`,
  `noteStreak(n)`, `tierProgress(tier)` → `{ done, total, pct, lessonsDone, lessonsTotal }`.
- Meta badges (`first-lesson`, `first-game`, graduates, `xp-*`, `explorer`) are awarded
  automatically; level-ups open a modal.

### 11.4 UI kit (`js/core/ui.js`)

- Extra exports: `uid(prefix)`, `reducedMotion()`, `clear(el)`, `starRow(n, { max, size })`,
  `meter(value, { label, size: 'sm'|'lg', tone: 'bull' })` + `setMeter(el, value)`,
  `tierChip(tier, { small })`, `fmt(n, decimals)`, `ICON_NAMES`.
- `h()` attrs also accept `html`, `text`, `dataset`, `ref(el)`, `onClick`-style keys;
  `aria-*` / `data-*` values are stringified (`true` → `"true"`).
- Extra icons: `system home trendline cross eye search flame medal bolt crown compass
  gamepad grid chevron-right chevron-left chevron-down plus minus flag`.
- `toast(msg, { type: 'info'|'good'|'bad'|'xp'|'badge'|'warn', icon })`.
- `modal({ title, body, actions: [{ label, primary, danger, onClick(api) → false keeps it
  open }], dismissible = true, onClose, size: 'wide' })`.
- `sfx.badge()`, `sfx.whoosh()`; repeated calls of the same sound within 120 ms are
  de-duplicated (so `choiceQuiz` + `game.correct()` never double-play).
- `choiceQuiz({ …, sfx = true, columns })`: `answer` may be a predicate; `explain` may be
  `(correct, value) => html|Node`; the returned element has `.choose(index)`. Options with
  `node` render as a visual grid (4 columns, 2 on phones). Keys 1–9 answer the most recently
  created unanswered quiz on screen.
- `explainer(html, type: 'good'|'bad'|'info')`.

### 11.5 GameShell (`js/core/game-kit.js`)

- Stars, XP and "perfect" are computed from **base points** (`game.base`, before the streak
  multiplier) against `maxScore`; `game.score` includes the multiplier.
- `award(points, { reason, bonus })` — `bonus: true` raises the score but not stars/XP.
- `onRound` may return a cleanup function; `game.onRoundCleanup(fn)` does the same.
- `game.hudExtra` is an empty slot in the HUD for game-specific readouts (balance, lives…).
- `game.hideNext()`, `game.clearFeedback()`, `game.start(modeId)`, `game.tier`.
- `nextButton()` stops a per-round clock. Default timeout: per-round → `wrong("Time's up!")`
  + Next; whole-game → `finish()`; override with `opts.onTimeout(game)`.
- Modes may carry `description` (shown under the picker). The default mode for a
  `tier: 'both'` game is the last track page visited.
- `onEnd(game, summary)` may return a Node; `summary` = `{ score, base, maxScore, pct,
  stars, perfect, xp, isBest, best, newBadges, corrects, wrongs, bestStreak, rounds, mode,
  seed, el }` (`el` = the results' extra-content container).
- Without `preview`, the intro shows the game's badge icon.
- Hooks for tests: `[data-action="start" | "next" | "again"]`.
- `correct()` / `wrong()` replace the previous banner only; notes added with `feedback()` stay
  (the banner is always shown first), so `game.correct('Yes!'); game.feedback(why)` and
  `game.feedback(why); game.correct('Yes!')` both work.
- A per-round clock keeps running until `nextButton()` / `nextRound()`. If a round shows an
  animation after the answer before calling `nextButton()`, call `game.timer.stop()` first so
  the clock cannot expire into a second (wrong) verdict.
- Finishing shows the results card **and** an "+N XP" toast (the XP pill in the top bar bumps).
- `mount()` must return `() => game.destroy()`. As a safety net the shell also tears itself
  down (listeners, clock) once its root has left the page.
- Play styles, lives, difficulty and chart sources are built: see §12.1 / §12.2 (they supersede
  the v1 placeholders `style = 'arcade'`, `source = 'textbook'`, `lives = null`).

### 11.6 LessonShell (`js/core/lesson-kit.js`)

- `render(el, step, shell)`; a step with `locked: true` gates Next until the step calls
  `shell.unlock()` (`shell.lock()` re-locks). `shell.next() / back() / go(i) / finish()`.
- Arrow keys are ignored inside `[data-keys="capture"]`, sliders, tab lists and radio
  groups — put `data-keys="capture"` on interactive widgets that use arrows.
- Hooks for tests: `[data-action="next" | "back"]`.
- `shell.destroy()` removes the key listener and runs the current step's cleanup; `mount()`
  must return `() => shell.destroy()` (the shell also self-destructs if its root leaves the page).
- On narrow screens (< 960px) the step rail becomes a sticky one-line progress bar under the
  top bar; the shell scrolls steps into view below it.

### 11.7 Design tokens and classes

- Extra tokens: `--accent-strong`, `--bull-strong`, `--bear-strong` (text-safe on light
  grounds and on the `*-soft` tints), `--btn-primary(-hover)`, `--bull-ink`, `--bear-ink`,
  `--topbar-bg`, `--overlay`, `--radius-lg`, `--shadow-lg`, `--ease-out`, `--ease-back`,
  `--topbar-h`, `--tabbar-h` (height of the bottom tab bar, 0 when the top nav is shown — use
  it for bottom-sticky UI). The primary nav moves to the bottom tab bar below **820px**
  (phones and narrow/portrait tablets); page layouts themselves switch to phone layouts below
  720px.
- Extra classes: `.btn--lg`, `.btn--icon`, `.btn--block`, `.link-btn`, `.card--raised`,
  `.card--inset`, `.card--link`, `.card--flush`, `.chip--sm`, `.chip--outline`,
  `.chip--tier-{beginner|advanced|both}`, `.kbd-hint`, `.stars`, `.explainer(--good|--bad)`,
  `.segmented` (buttons with `aria-checked`/`aria-pressed`), `.field`, `.input`, `.figure`,
  `.chart-frame`, `.legend` + `.legend__item` + `.swatch` (`--c`), `.stat` +
  `.stat__label` + `.stat__value`, `.data-table`, `.table-scroll`, `.up` / `.down`,
  `.container--read` (680px) / `.container--wide` (960px), `.section`, `.section-head`,
  `.lead`, `.faint`, `.prose`, `.t-12 … .t-48`.
- On touch (`pointer: coarse`) buttons and small links get ≥ 44px hit targets.
- `ul`/`ol` elements that have a class lose bullets and padding through a zero-specificity
  `:where()` reset, so a component class can set its own padding. `svg.icon` never shrinks
  inside flex rows.

### 11.8 Smoke test

`node tests/smoke.mjs [routes…] [--desktop] [--tablet] [--phone] [--light|--dark]
[--no-shots] [--no-interact] [--fonts] [--no-storage] [--real-market] [--concurrency=N]`. Routes: every
page, lesson and game in the registry plus `PAGES`, `#playbook.hammer` and `DEV_ENTRIES`. Pages open
with `?market=mock` (§12.3) unless `--real-market`. Viewports: desktop 1280×800,
tablet 820×1180 (touch), phone 390×844 (touch). Google Fonts requests are blocked unless
`--fonts` is given. After the first screenshot it clicks Start (and one answer option) on
games and Next on lessons, then screenshots `<route>-<viewport>-<theme>-play.png`.

`--no-storage` runs every check with `localStorage`/`sessionStorage` methods throwing (as in
some private modes): the app must still render and play; progress just is not remembered.

`npm test` runs `node --test "tests/unit/*.test.mjs"` — Node 22 no longer expands a bare
directory argument, so the glob is spelled out.

## 12. Expansion: play styles, real market data, lesson media

Everything in this section is additive. Owners: see the build plan in each workflow brief.

### 12.1 Play styles (every game, player's choice) — built in `js/core/game-kit.js`

Supersedes the placeholder note at the end of §11.5. Every option below is optional; games
written against §6.8/§11.5 keep working unchanged (they play as Arcade).

```js
new GameShell(root, ctx, {
  // …all §6.8 / §11.5 options…
  styles: ['practice', 'arcade', 'survival'], // default: entry.styles from the registry, else all three
  defaultStyle: 'arcade',                     // first visit only; then the player's last pick for this game
  lives: 3,                                   // Survival lives
  survival: { ramp: 15, stars: [5, 10, 15], clockMin: 0.6 },
  practice: { xp: 0.5 },                      // Practice XP multiplier
  hints: 'practice',                          // Hint button: 'practice' (default) | 'always' | false
  retry: true,                                // Practice "Try again" after a miss
  onRetry(game, ctx) {},                      // optional; default: onRound runs again with the same round rng
  daily: false,                               // default entry.daily (see §12.8)
  sources: ['textbook'],                      // §12.2
});
```

The intro shows a **Style** picker (segmented radios with icon + one-line description, remembered
per game in the store), a **Difficulty** picker (Easy / Normal / Hard, only while Practice is
selected, remembered) and the §12.2 **Charts** picker. With one style (e.g. the Daily Challenge)
there is no Style picker. The facts box and "Your best" line follow the selected style.

| | Practice | Arcade (default) | Survival |
|---|---|---|---|
| rounds | `opts.rounds` | `opts.rounds` | open: `game.rounds === null` until the lives run out |
| clock | none: the shell starts no clock, `game.timer.start()` is a no-op returning `false`, `game.timed === false` | `opts.timer` | `opts.timer`; the shell-managed per-round clock is scaled by `game.clockScale` (1 → 0.6 as difficulty rises) |
| `game.difficulty` | fixed: Easy / Normal / Hard → 0.2 / 0.5 / 0.85 | `(round − 1) / (rounds − 1)` (open-ended: over 15 rounds) | `min(1, (round − 1) / 14)` (`survival.ramp`) |
| hints | Hint button whenever the round called `setHint()`; a hinted round scores at most 50% | — (unless `hints: 'always'`) | — |
| a miss (`wrong()`) | "Try again" appears next to Next: the round replays (same round rng), the miss is forgiven (`wrongs − 1`) and the round scores at most 50% | streak resets | costs a life; at 0 `game.over = true`, Next reads "See results" and `nextRound()` calls `finish()` |
| stars | base points vs `maxScore` (90 / 65 / 35%) | same | rounds survived ≥ 5 / 10 / 15 (`survival.stars`) |
| XP | §6.8 formula × 0.5 | §6.8 formula | `round(min(1, survived / 15) × 60) + 10 × stars` |
| perfect | no misses, hints or retries | as §6.8 | never |

"Rounds survived" = rounds played, minus the round that cost the last life (a game that calls
`finish()` itself counts the current round). Stored as the style's `rounds` (best) — see §12.8.

Game API (additions):

```js
game.style                 // 'practice' | 'arcade' | 'survival' (readable in every hook)
game.styles                // styles offered on the intro
game.level                 // Practice difficulty: 'easy' | 'normal' | 'hard'
game.difficulty            // 0–1, set before onStart and before each onRound (see table)
game.timed                 // false in Practice
game.clockScale            // Survival: 1 → survival.clockMin as difficulty rises (else 1); apply it
                           // yourself if the game runs its own clock
game.lives / game.maxLives // null outside Survival
game.over                  // true once Survival ran out of lives
game.loseLife(n = 1, { silent = false }) → lives left      // Survival only; wrong() calls it
game.setHint(textOrFn)     // this round's hint: HTML string | Node | (game) => either; reset every round
game.hint(text?, { cost = 0.5 }) → Element | null          // shows the hint right under the meta row (the
                           // Hint button), above the stage, and caps the round at 1 − cost; the Practice
                           // Hint button calls game.hint()
game.roundCap              // 1, or 0.5 after a hint / on a retry: multiplies correct() points and
                           // positive non-bonus award() points
game.hintsUsed / game.retries / game.isRetry
game.retryRound()          // what "Try again" calls
game.roundRng              // = the `rng` passed to onRound: game.rng.fork(`round-${round}`). Use it
                           // for round content so Try again (and a replay of the seed) is identical
game.ask({ question, options, answer, explain, hint, points = 100, columns, next = true,
           reveal = true, onAnswer(ok, value) }) → quiz element
   // Standard multiple-choice round: choiceQuiz into the stage, correct()/wrong() with `explain`
   // as the banner, revealSource() for real rounds, then nextButton(). Practice retry, hints,
   // lives and caps all work through it.
```

- `onRound(game, { round, rng, stage, mode, style, difficulty, source, retry })`; it may be
  `async` / return a Promise (a resolved function is the round cleanup; a rejection shows the
  "round failed to load — skip" card). `onStart(game, { mode, seed, rng, style, source, difficulty })`.
- In Survival `game.rounds` is `null`: build rounds on demand from `round` and `difficulty`; never
  index a fixed list by `round` without wrapping (the legacy stubs wrap: `order[(round − 1) %
  order.length]`). Call `wrong()` once per failed round (each call costs a life).
- `summary` (onEnd) also has `style, level, source, survived, bestRounds, isBestRounds, lives,
  hintsUsed, retries, fallbacks, daily ({ first, streak, best, key } | null), overallBest`;
  `best` / `isBest` are for the played style.
- Results: Survival shows **Survived** (hearts) and **Best run**; games with several styles show
  "Your best per style" (`.style-bests`) and a **Change style** button (`data-action="change-style"`).
- DOM hooks: pickers `[data-picker="mode|style|level|source"]` with radio buttons `[data-mode]`,
  `[data-style]`, `[data-level]`, `[data-source]` (←/→ move); `[data-action="hint"]`,
  `[data-action="retry"]`; HUD lives cell `.hud__lives` (heart icons); a meta row `.game__meta`
  under the HUD holds the style / difficulty / mode chips, the source chip and the Hint button.
- Exports: `heartIcon({ size, filled = true, label })` (the Survival heart, drawn in SVG) and
  `styleIcon(styleId, { size, label })` (book / bolt / heart).

### 12.2 Chart sources

GameShell options gain `sources` (subset of `['textbook', 'real']`, default `['textbook']`).
When a game lists `'real'`, the intro shows a Charts picker: **Textbook** (generated, clean
examples) or **Real market** (historical windows from real markets). `game.source` is
readable. Real mode needs a free account; without data (offline, provider down) the shell
falls back to Textbook with a toast.

Real rounds come from `js/core/scanner.js` over candles from `js/core/market.js`:

```js
import { getHistory, SYMBOLS } from '../core/market.js';
import { findSetups, realRound } from '../core/scanner.js';

const round = await realRound(rng, {
  kinds: ['hammer', 'bullish-engulfing'],   // setup kinds (see 12.4)
  intervals: ['1d', '1w'],                   // candidate timeframes (ask getCatalog())
  before: 60, after: 20,                     // candles shown before the decision + revealed after
});
// → { candles, decisionIdx, setup: { kind, start, end, direction, meta },
//     outcome: { move, r, direction: 'up'|'down'|'flat' },
//     symbol, interval, from, to, attribution }   or null if nothing found
```

Real rounds hide the symbol and dates until the answer ("mystery chart"), then reveal
"BTC-USD · 4h · 12 Mar 2026" with the data attribution. Real outcomes are messy: the
explanation says what the textbook read was and what actually happened, and games that
grade predictions on real data grade the **read** (was the setup identified correctly?)
separately from the **outcome**.

GameShell side — built in `js/core/game-kit.js`:

- `sources` defaults to `entry.sources` (registry), else `['textbook']`. With both, the intro shows
  the **Charts** picker (Textbook / Real market), remembered per game. Without a free account
  (`ctx.access.can('free')` is false once an access gate is registered) Real market is locked with
  a sign-in note. `sources: ['real']` (Live Predict) shows no picker, only a "Real market" note.
- `game.sourcePref` is the picked source; `game.source` is the effective one for this run. Starting
  a Real run preflights `market.getCatalog()` + `scanner.js` (7 s); if that fails (offline,
  unconfigured, no module) the run uses textbook charts with a toast.
- `game.realRound(query) → Promise<round | null>`: `scanner.realRound(game.roundRng, query)` (a
  `rng` option overrides it) with a 9 s `timeout`. Resolves `null` straight away on textbook runs,
  and `null` when nothing real is available — render your textbook scenario then; the HUD chip
  reads **Textbook chart**. After 3 failures in a row the rest of the run switches to textbook
  (toast). The clock is paused while it loads and a "Finding a real chart…" indicator shows after
  180 ms (`loadingText`). If the round ends first (Next, Quit, leaving the page) the promise never
  settles, so code after `await` simply does not run. The last real round is `game.real`;
  `game.roundSource` is `'real' | 'textbook'`.
- `game.revealSource(info = game.real, { into, title })` → the standard mystery-chart reveal
  (`.source-reveal`): "Mystery chart revealed · **SPY** S&P 500 ETF · Weekly · 11 Jul 2022", the
  attribution line ("Data: …"), and "Delayed · end of day" / "Test data" flags; the HUD chip then
  shows "SPY · Weekly". `game.ask()` calls it after the answer. Returns `null` on textbook rounds.
- The HUD source chip is honest: a Real run whose rounds never produced a real chart shows
  "Textbook chart" when the round ends.
- Keep real rounds mysterious until the reveal: no dates on the x-axis (`marketTimeLabel`) and no
  symbol in the UI before `revealSource()`. Scanner fakeouts are *decided* on the candle that
  closes back inside; to ask "trap or not" stop the chart at `setup.meta.breakoutIdx`.
- Fallback pattern (verified end to end in mock mode and offline): a real round, else a generated
  one of the same shape from `scanner.simRound()` (§12.4) or your own textbook scenario:

  ```js
  import { simRound } from '../core/scanner.js';
  async onRound(g, { rng, stage, difficulty }) {
    const q = { kinds: ['bull-flag', 'bear-flag'], before: 60, after: 20 };
    const real = await g.realRound(q);          // null on textbook runs / no data (chip: Textbook chart)
    const r = real || simRound(rng, q);          // same shape: candles, decisionIdx, setup, outcome, lead
    // … draw r.candles up to r.decisionIdx + 1, ask, then reveal the rest …
    g.ask({ …, reveal: true });                  // reveals the market only when g.real is set
  }
  ```
  Never pass a `simRound` result to `revealSource()` — it has no market (`symbol: null`, `sim: true`).
- Helpers exported for games, lessons and pages: `loadScanner()`, `loadMarket()` (cached dynamic
  imports), `withTimeout(promise, ms)` (→ value or `null`), `intervalLabel('1w') → 'Weekly'`,
  `formatMarketDate(t, interval) → '11 Jul 2022'` (intraday adds ', 14:05 UTC'),
  `marketTimeLabel(interval)` (a CandleChart `timeLabel` for real candles), `sourceText(info)`
  ("SPY (S&P 500 ETF) · Weekly · 11 Jul 2022 — Data: …") and `sourceReveal(info, { title, compact })`.

### 12.3 Market data (`js/core/market.js` + Edge Function `market-data`)

Providers (server-side, see `docs/MARKET_DATA.md`): **Alpha Vantage** with the owner's key
(end-of-day `1d` and split-adjusted weekly `1w` candles for 12 markets; intraday only on a
paid key), and **Kraken/Coinbase** live crypto adapters that stay OFF until the owner has
written permission (`MARKET_EXCHANGE_FEEDS`). Nothing is fetched in the browser from a
provider; the browser only talks to `market-data`.

```js
import { getCatalog, getCandles, getHistory, subscribeLive, marketStatus } from '../core/market.js';

getCatalog({ refresh = false }) → Promise<{ symbols: [{ id, name, class: 'stock'|'etf'|'fx'|'crypto'|'metal',
    decimals, intervals: ['1d', '1w', …], live: bool, delayed: bool }], status, fallback?, mock? }>
  // Cached for the session (sessionStorage, 30 min). On failure: the 12 default markets (SYMBOLS)
  // with ['1d', '1w'], live: false, status 'offline' (or 'unconfigured') and fallback: true;
  // a failed catalog is re-asked after 60 s.
getCandles({ symbol, interval, limit = 300, end }) → Promise<{ symbol, interval, candles: [{ t, o, h, l, c, v }],
    source, attribution, delayed, stale, status: 'online'|'offline'|'unconfigured', error, mock? }>
  // t = candle open time (ms UTC), oldest first, cleaned (valid OHLC, sorted, one per t). limit ≤ 1000.
  // NEVER throws: on failure candles = [] and status / error say why.
getHistory({ symbol, interval, bars = 1000 }) → same shape; cached for the session, concurrent calls
  // share one request, > 1000 bars are paged backwards; failures are not cached (retry after 20 s).
subscribeLive({ symbol, interval = '1d', bars = 120, stepMs = 3000, seed, form = true }, onUpdate) → unsubscribe()
  // LIVE polling (1m: 10 s … 1d: 5 min) when the catalog marks the symbol live for that interval;
  // otherwise REPLAY of a real stretch of history (the requested interval if the symbol has it, else
  // its finest one): one candle every stepMs, each forming over 4 ticks when form, a new random
  // stretch at the end of the data. onUpdate({ candles, last, status: 'live'|'replay'|'offline',
  // symbol, interval, attribution, delayed, forming, replay?: { index, total, from, at, stepMs,
  // requested, restarted }, mock?, error? }). Pauses while the tab is hidden; offline → retries.
marketStatus() → 'online' | 'offline' | 'unconfigured'   // outcome of the latest request ('online'
  // before any request unless navigator.onLine is false; mock mode counts as online)
marketInfo() → { status, mock, lastError, lastOkAt, cached }      onMarketStatus(fn) → unsubscribe
isMockMode() / setMockMode(on)                                     // localhost + localStorage flag
SYMBOLS                        // the 12 default markets: SPY QQQ GLD AAPL MSFT NVDA TSLA EUR-USD
                               // GBP-USD USD-JPY BTC-USD ETH-USD (decimals: FX 5, USD-JPY 3, else 2)
INTERVALS, INTERVAL_MS, normalizeCandles(list)
intervalLabel('1w') → 'Weekly' ('1d' Daily, '1h' Hourly, '5m' 5 minutes)
formatCandleTime(t, interval) → '12 Mar 2026' (intraday: '12 Mar 2026 14:05 UTC')
axisLabel(t, interval) → '12 Mar' (1d) | 'Mar 26' (1w) | '14:05' (intraday)     // for timeLabel
revealLabel({ symbol, interval, t }) → 'BTC-USD · Weekly · 12 Mar 2026'
configureMarket({ fetch, url, key, mock, fixturesBase, mockStepMs, pollMs, timeoutMs, retryMs, now,
                  document, storage }) / resetMarketCache()        // tests and the dev page only
```

- Transport: `POST ${SUPABASE_URL}/functions/v1/market-data` with JSON and headers `apikey` +
  `Authorization: Bearer <publishable key>`; `SUPABASE_URL` / `SUPABASE_KEY` come from
  `js/config.js` (imported lazily on the first request; built-in project defaults if it is
  missing). 8 s timeout, 2 retries with backoff on network errors / 5xx / 429; no retry on 503
  `{ unconfigured }` or other 4xx.
- Mock mode fixtures (`tests/fixtures/market/`, built by `build-fixtures.mjs` there with
  `realisticMarket`; each file has `_note: 'TEST FIXTURE …'`, `fixture: true` and attribution
  "Test fixture: synthetic candles, not real prices"): `catalog.json` (BTC-USD [1m 5m 1d 1w,
  live], ETH-USD, SPY, EUR-USD [1d 1w]), `<SYMBOL>_1d.json` (500 candles, 00:00 UTC, weekdays only
  for SPY / EUR-USD, ending Fri 25 Sep 2026), `<SYMBOL>_1w.json` (600 candles keyed by Monday; the
  last ~70 weeks aggregate the daily file) for BTC-USD, ETH-USD, SPY, EUR-USD (EUR-USD has v = 0
  like the real FX feed), and `BTC-USD_1m.json` / `BTC-USD_5m.json` (300 candles ending 25 Sep
  2026 20:00 UTC). Intraday fixtures play forward on a mock clock (one candle per `mockStepMs`,
  default 5 s, from 80% of the file) so the live-polling path can be tested. Markets / intervals
  the fixture catalog does not list return `status: 'unconfigured'` without any request.

- Function request (server contract, `supabase/functions/market-data`): POST (or GET with
  query params) `{ symbol, interval, limit ≤ 1000 (default 300), end? }` → `{ symbol, interval,
  candles: [{ t, o, h, l, c, v }], source, attribution, delayed, stale? }` (t = candle open time,
  ms UTC, oldest first; daily candles open at 00:00 UTC, weekly ones on Monday 00:00 UTC).
  POST `{ catalog: true }` (or GET `?catalog=1`) → `{ symbols: [{ id, name, class, decimals,
  intervals, live, delayed, attribution }], status: 'ok' | 'unconfigured' }` (`max-age=300`;
  every known symbol is listed, with `intervals: []` and `attribution: null` when nothing serves
  it; `live` only when a real-time exchange feed serves intraday candles; server decimals: FX 4,
  USD-JPY 2, stocks/ETFs 2). Errors: 400 bad input; 503 `{ unconfigured: true }` when no
  provider is set up for that symbol/interval; 503 `{ quota: true }` when the day's Alpha
  Vantage budget is used up and nothing is cached yet (it resets at 00:00 UTC, so retrying
  sooner is pointless); 502 provider failure with nothing cached. With a cache, failures
  answer 200 `{ stale: true, source: 'cache' }` with `Cache-Control: no-store`.
- Alpha Vantage series are refreshed at most once per candle close (daily: US stocks/ETFs after
  21:30 UTC, FX after 22:30 UTC, crypto after 00:30 UTC; weekly: after Friday's close, crypto
  after Monday 00:30 UTC), whatever the request asks for; everything is served from the cache.
  On the free key, daily history starts ~100 trading days back and grows as the cache keeps
  every day; older daily windows return what the cache has (possibly `[]`) without a provider
  call. Weekly history is complete (20+ years; split-adjusted for stocks). Daily candles are
  not split-adjusted.
- Intervals: `1m 5m 15m 1h 6h 1d 1w`. With only the free Alpha Vantage key, real charts are
  **daily and weekly** — games must ask the catalog which intervals exist and pick from those
  (weekly charts are fine for most pattern/level/trend games; label them "Weekly").
- Every real chart shows the attribution string and "Delayed / end of day" when `delayed`.
- Real data may be missing entirely (no key yet, quota used, offline): callers must fall back
  to textbook/simulated charts without errors.
- `localStorage['tts-market-mock'] = '1'` **or `?market=mock` in the page URL** (both localhost
  only; the URL switch works even when storage throws, and the smoke test uses it) serves
  deterministic fixture candles from `tests/fixtures/market/*.json` (including `1d` and `1w`) so
  games can be tested offline; fixtures are labelled as test data and never shown outside mock mode.
  With neither, a real request goes to the Edge Function (`js/config.js` is imported first; until
  it exists the import 404s and the built-in project defaults are used).

### 12.4 Scanner setup kinds (`js/core/scanner.js`)

`findSetups(candles, { kinds, atr })` returns `[{ kind, start, end, decisionIdx, direction:
'bullish'|'bearish'|'neutral', meta }]`. Kinds:
every `CANDLE_PATTERNS` id (predicates exported from patterns.js as
`CANDLE_RULES[id](candles, i, ctx) → bool`, sharing the same thresholds as the generators,
with trend context from the preceding candles); `trend-up`, `trend-down`, `range`;
`support-bounce`, `resistance-reject`, `breakout-up`, `breakout-down`, `fakeout-up`,
`fakeout-down`; `golden-cross`, `death-cross`; `bullish-divergence`, `bearish-divergence`;
`fib-pullback` (impulse ≥ 3 ATR, pullback ending within 0.382–0.786, meta.ratio);
`double-top`, `double-bottom`, `head-and-shoulders`, `inverse-head-and-shoulders`,
`bull-flag`, `bear-flag`. `outcomeOf(candles, idx, { bars = 20, atr })` → `{ move, r,
direction }` (direction flat when |move| < 1 ATR). Detectors are unit-tested on textbook
scenarios (must find what the generator made) and on noise (few false positives).

Built — exact API:

```js
import { findSetups, outcomeOf, realRound, simRound, describeChart, shiftSetup, SETUP_KINDS, SETUP_KIND_IDS } from '../core/scanner.js';

SETUP_KINDS[kind] → { id, name, direction: 'bullish'|'bearish'|'neutral', group: 'candle'|'trend'|
                      'level'|'ma'|'momentum'|'fib'|'chart', rule }   // rule: the exact criteria in
                                                                     // plain English (for the Playbook)
findSetups(candles, { kinds = SETUP_KIND_IDS, atr, from = 0, to = n − 1, maFast = 50, maSlow = 200,
                      maType = 'sma'|'ema' })
  → [{ kind, start, end, decisionIdx, direction, meta }]   sorted by decisionIdx
  // end === decisionIdx: the setup is DECIDED on that candle's close using candles 0..decisionIdx
  // only (causal — unit-tested by cutting the future off), so everything after it is a fair outcome.
  // from / to only filter which decisions are returned. atr: a precomputed atr(candles, 14) array.
  // ~30 ms for 1500 candles and every kind.
outcomeOf(candles, idx, { bars = 20, atr, direction })
  → { move, r, pct, direction: 'up'|'down'|'flat', bars, maxUp, maxDown, atr, result? } | null
  // move = close[idx + bars] − close[idx] (or the last candle), r / maxUp / maxDown in ATRs,
  // 'flat' when |move| < 1 ATR; with direction ('bullish'|'bearish'|1|−1): result =
  // 'followed'|'failed'|'flat'.
realRound(rng, { kinds = SETUP_KIND_IDS, intervals = ['1d', '1w'], symbols, before = 60, after = 20,
                 bars = 1000, tries = 6 })
  → Promise<{ candles, decisionIdx, setup: { kind, start, end, decisionIdx, direction, meta },
      outcome, symbol, name, interval, decimals, from, to, decisionTime, title, attribution,
      delayed, source, mock, lead } | null>
  // A random catalog market × interval (rng), its history scanned, one setup sampled (kinds
  // weighted evenly) whose whole setup fits in the `before` candles and with `after` candles after
  // it. candles = the window (before + after), decisionIdx = before − 1, setup indexes are
  // window-relative (shiftSetup), lead = up to 250 candles before the window (indicator warm-up:
  // compute MAs over [...lead, ...candles]), title = 'SPY · Weekly · 11 Jul 2022' (decision
  // candle). null when offline / unconfigured / nothing fits — rare kinds (three white soldiers,
  // morning stars) often return null on real data: fall back to textbook rounds.
simRound(rng, { kinds = SETUP_KIND_IDS, before = 60, after = 20, count = 400, tries = 24,
                regime = 'mixed', start = 100, vol = 0.012, outcome, maFast, maSlow, maType })
  → { …realRound's shape…, symbol: null, name: 'Simulated market', interval: null, decimals: 2,
      from: null, to: null, decisionTime: null, title: 'Simulated market', attribution: '',
      delayed: false, source: 'simulated', mock: false, sim: true } | null
  // The OFFLINE TWIN of realRound (synchronous, deterministic for a given rng, 1–10 ms): the same
  // window (decisionIdx = before − 1, window-relative setup, `lead` for warm-up, `outcome`) over a
  // generated market (data.realisticMarket) in which findSetups ITSELF found the setup — genuine by
  // the same rules as a real one. Candle-pattern kinds come from patterns.candleScenario (a lead-in of
  // `before` candles; outcome 'success' | 'fail', default random) and are then confirmed by the
  // scanner. A kind is picked evenly; if no market in `tries` has it, the other kinds are tried.
  // Every kind is found (unit-tested). Use it as the fallback of a real round:
  //   const r = (await game.realRound(q)) || simRound(game.roundRng, q);
  // Never pass it to game.revealSource() / sourceReveal() (there is no market to reveal).
describeChart(candles, { decimals }) → { trend: 'up'|'down'|'range', levels: [{ price, type:
    'support'|'resistance', touches }], recentPatterns: [{ kind, idx, name, direction }],
    ma: { ema20, ema20Slope, priceVsEma20: 'above'|'below', sma50, priceVsSma50 }, rsi, atr, summary }
  // ≤ 2 supports below and ≤ 2 resistances above the last close; recentPatterns = setups decided in
  // the last 10 candles (newest first, trends / ranges excluded); ema20Slope = % change over 5
  // candles; summary = 2–4 plain sentences ("Price is in an uptrend (higher highs and higher lows)
  // and trades above its rising 20-EMA. Nearest support is … RSI 14 is 64, showing upward momentum.").
  // < 20 candles → summary 'Not enough candles yet to read this chart.'
shiftSetup(setup, offset)   // move start / end / decisionIdx and idx, x1, x2, from, to, *Idx in meta
```

`meta` per kind (prices absolute, indexes in the scanned series): always `name`; candle patterns
`{ trend, confirm, stop, high, low, volumeRatio }` (confirm = patterns.js confirmation level);
trends `{ slope, r2, moveAtr, swings }`; range `{ top, bottom, height, heightAtr, touchesTop,
touchesBottom, tops, bottoms }`; support-bounce / resistance-reject `{ level, zone: [lo, hi],
touches, touchIdx, pivots, stop, volumeRatio }`; breakouts `{ level, zone, touches, pivots, stop,
volumeRatio }`; fakeouts `{ level, zone, touches, pivots, breakoutIdx, extremeIdx, stop }` (to
ask "trap or real?" stop the chart at `breakoutIdx`); crosses `{ fast: 'SMA 50', slow: 'SMA 200',
fastPeriod, slowPeriod, type, fastValue, slowValue }`; divergences `{ oscillator: 'RSI 14', a:
{ idx, price, rsi }, b: {…}, stop }`; fib-pullback `{ ratio, nearest, a, b, c ({ idx, price }),
levels: { 0.382, 0.5, 0.618, 0.786 }, impulseAtr, stop, target }`; double top/bottom `{ points:
[P1, trough, P2], neckline (price), height, target, stop, volumeRatio }`; head-and-shoulders
`{ points (5), labels, neckline: { x1, y1, x2, y2 }, height, target, stop, volumeRatio }`; flags
`{ poleStart, poleTop, flag: { from, to }, upper / lower: { x1, y1, x2, y2 }, height, target,
stop, retrace, volumeRatio }`. `volumeRatio` = decision volume ÷ 20-candle average (null when the
market has no volume, e.g. FX).

Rules (conservative; `SETUP_KINDS[kind].rule` has the full text): candle patterns = CANDLE_RULES
(below); trend = 50-candle regression ≥ 5 ATR with R² ≥ 0.5 + two higher highs and higher lows +
EMA 20 > rising EMA 50, reported once per trend; range = 40 candles, 3–8 ATR tall, drift ≤ 1.5 ATR,
≥ 2 swings at the top and at the bottom; levels = clusters of ≥ 2 zigzag (2 ATR) swings within
0.5 ATR that have held (tolerances around a level use the smaller of the current ATR and the ATR
at its last touch, so a volatility spike cannot stretch "near the level"); bounce = tag from ≥ 1 ATR
away + a green close ≥ 0.4 ATR above; breakout
= first close ≥ 0.2 ATR beyond with a ≥ 0.4 ATR body; fakeout = back ≥ 0.25 ATR inside within 15
candles (≤ 5 ATR excursion); crosses = SMA 50 / 200 with no opposite cross in 20 candles, not in
the warm-up; divergence = new swing low vs the lowest swing 5–40 candles earlier, ≥ 1.5 ATR bounce
between, price ≥ 0.25 ATR lower, RSI ≥ 4 higher and < 35 at the first low; fib-pullback = clean
impulse (efficiency ≥ 0.55) ≥ 3 ATR, pullback ≥ 2 candles to 0.382–0.786, turn candle ≥ 0.3 ATR;
double top = peaks 8–80 candles apart within max(0.6 ATR, 25% height), height ≥ 2.5 ATR, break of
the trough within 25 candles; H&S = head ≥ 0.8 ATR above both shoulders, shoulders within 35% of
the head height, neckline troughs within 50% of the head height of each other, and within 25
candles a close beyond BOTH the neckline and every close of the trough before the right shoulder
(a sloping neckline alone can be crossed while price is still inside the pattern); flags = pole
≥ 5 ATR in ≤ 20 candles, flag 4–35 candles retracing ≤ 50%, quieter than the pole, drifting against
the pole at ≤ 0.5 × its pace and retracing more slowly than it advanced (≤ 0.8×: a V-shaped
reversal is not a flag), first close ≥ 0.1 ATR through the flag line (fitted to the flag's own
highs, never rising — the pole top is not part of the fit — and touching the highest; `upper` /
`lower` start at `flag.from`). Measured-move targets (double top, H&S, flags) are the pattern
height from the break; a downward target that would land under 10% of price (a big pole on a
cheap chart) becomes the same percentage move instead, so targets are always positive.
Measured (tests/unit/scanner.test.mjs): textbook chart patterns found at the breakout in 93–100%
of seeds (H&S 96% over 100 seeds), every candleScenario found; on random-walk / simulated noise
≈ 1.5–7 setups per 1000 candles per kind (candle doji / spinning tops are common, as in real
markets).

**Visual review:** `tests/visual/setups.html` (serve the repo root) draws every setup the scanner
finds in the market fixtures, in its realRound window with `annotateSetup()` and the outcome
(`?kind=<id>[,<id>]`, `?group=candle|trend|level|ma|momentum|fib|chart`, `?symbol=`, `?interval=`,
`?per=6`, `?sim=1` for simRound examples, `?theme=dark`). The v2 QA pass used it to tighten the H&S,
flag and level rules above (junk it removed: an inverse H&S "breakout" still below the right peak, a
46% V-shaped counter-rally called a bear flag, a flat pause "breaking" a flag line tilted by the pole
top, a "support touch" 170 points above the level after a spike inflated the ATR, bear-flag targets
below zero); `tests/unit/v2-integration.test.mjs` pins those rules on the fixtures. Detections in
the 8 fixture series after the pass: flags 59 → 40, H&S 20 → 18, support bounces 24 → 19.

### 12.5 Lesson media

`js/core/story.js`:

```js
new ChartStory(container, {
  candles, height = 340, indicators: { ema20: true, rsi: false, volume: true },
  frames: [
    { to: 40, caption: 'Price falls into a zone that held twice before.',
      overlays: [{ type: 'zone', from: 98.2, to: 99.0, label: 'Support' }],
      focus: [28, 40] },                       // idx range to highlight / zoom
    { to: 41, caption: 'A hammer forms: long lower wick, close near the high.',
      overlays: [{ type: 'box', from: 40, to: 40, label: 'Hammer' }] },
    { to: 42, caption: 'Confirmation: the next candle closes above the hammer high.',
      overlays: [{ type: 'marker', idx: 41, position: 'below', text: 'Entry' },
                 { type: 'hline', price: 97.6, color: 'bear', label: 'Stop' },
                 { type: 'hline', price: 103.4, color: 'bull', label: 'Target 2R' }] },
  ],
  autoplay = false, loop = false,
}) // controls: play/pause, step back/forward, scrubber, frame dots, captions (aria-live)
story.goTo(i) / play() / pause() / destroy()
```

Built — exact API (`import { ChartStory } from '../core/story.js'`, styles `.cs*` in css/chart.css):

```js
new ChartStory(container, {
  candles, height = 340, frames, indicators = { ema20, ema50, sma20, sma50, sma200, bb, volume, rsi, macd },
  autoplay = false, loop = false, interval = 3600,   // ms per frame (min 1.6 s + 40 ms per caption char)
  zoom = false,                  // default for frames with a focus (frame.zoom overrides)
  decimals = 2, timeLabel, chartType = 'candles', slots = candles.length,
  yPad = 0.14,                   // headroom so frame markers with text ('Entry', 'Hammer') are not clipped
  ariaLabel = 'Chart story',
  interactive = true,            // hover crosshair on the chart
  onFrame(index, frame),
})
frame = { to,                    // candles shown (exclusive count); forward steps animate the new ones
          caption, title?,       // title is a bold lead-in; the caption bar is aria-live="polite"
          overlays?: [{ type: 'hline'|'segment'|'series'|'band'|'zone'|'box'|'marker'|'path'|'fib'|'text', …add* options }],
          focus?: [from, to],    // candles (and volume) outside are dimmed
          zoom?: bool,           // smoothly zoom the viewport to the focus (+35% padding)
          clear?: bool,          // drop earlier frames' overlays (frames are cumulative otherwise)
          indicators?: {…},      // per-frame overrides, e.g. { rsi: true } from this frame on
          duration?, revealInterval? }
story.goTo(i, { animate = true }) / next() / prev() / play() / pause() / toggle() / destroy()
story.index / story.frame / story.frames / story.playing / story.chart (the CandleChart) / story.root
story.on('frame' | 'play' | 'pause', fn) / off(event, fn)       // frame: fn({ index, frame })
```

- The newest frame's overlays pulse once as they appear (CSS, via overlay `pulse`), earlier ones stay.
- Transport: prev · play/pause (replay at the end) · next, and a scrubber (`role="slider"`) with
  numbered frame dots — click or drag along it. Keys when the story (not its chart) is focused:
  ←/→ (↑/↓), Home/End, Space / k play-pause. The root has `data-keys="capture"` (LessonShell
  ignores its arrows). User navigation pauses autoplay.
- Autoplay only runs while ≥ 35% of the story is on screen and the tab is visible; with reduced
  motion frames change instantly and autoplay does not start by itself (Play still works).

LessonShell step helpers — built in `js/core/lesson-kit.js`. Each returns a plain step object for
`steps: [...]`; extra fields (`quiz`, `locked`, …) are kept, so a helper step can also carry a
quick check. Charts are destroyed when the step changes.

```js
import { LessonShell, storyStep, realExampleStep, checklistStep, compareStep, figure, takeaway,
         addOverlay, lessonRng, textbookExample, annotateSetup } from '../core/lesson-kit.js';

storyStep({ title, story, text, after, height = 340, ...stepFields })
  // story: ChartStory options ({ candles, frames, indicators, autoplay, loop }) or (rng) => options
  // (rng = lessonRng(lesson, 'story:' + title): the same example every visit). text / after:
  // paragraphs before / after (HTML string | Node | array). If story.js cannot load, a static
  // chart with every frame's overlays and the captions as a numbered list is shown instead.
realExampleStep({ title, kinds, intervals = ['1d', '1w'], before = 60, after = 20, text, caption,
                  height = 320, volume = false, annotate(setup, chart, example), fallback(rng),
                  ...stepFields })
  // scanner.realRound(rng, { kinds, intervals, before, after }); skipped when marketStatus() is
  // 'offline' / 'unconfigured'. Shows a "Real market · Weekly" chip, the chart (dates on the axis),
  // the reveal line (symbol · interval · date · attribution · flags) and a "Show another real
  // example" button (data-action="another-example"). No data → fallback(rng) → { candles,
  // decisionIdx, setup, lead? }, default textbookExample(kinds, rng, { scanner, before, after })
  // (every scanner kind has one), labelled "Textbook example". annotate defaults to annotateSetup
  // (below). Candle-pattern examples are zoomed (viewport: 30 candles before the pattern, 12 after)
  // so the one to three pattern candles are readable on phones.
checklistStep({ title, text, example, items, verdict, height = 300, locked = true, ...stepFields })
  // example: { candles, visible?, decimals?, volume?, yPad = 0.14 } | (rng) => that (extra fields
  // are passed to item overlays). items: [{ label, detail?, overlay?: spec | spec[] |
  // (chart, example) => void, to?: idx (reveal candles through idx), pass = true }]. "Check next" /
  // "Check all" (data-action="check-next" | "check-all") or clicking an item ticks it (✓, or ✗ when
  // pass: false) and draws its overlay; when all are checked the verdict shows (default "Valid
  // setup…" / "Not a valid setup: n of m rules met…"; string | Node | (passed, items) => either)
  // and the step unlocks (Next is gated while locked: true).
compareStep({ title, text, left, right, height = 220, after, ...stepFields })
  // left / right: { title, verdict: 'good'|'bad'|'neutral', tag (default Valid / Trap / Example),
  // candles | example: (rng) => { candles, overlays?, visible? }, overlays: [specs], visible,
  // points: [HTML strings], caption, axis = false, volume = false, yPad = 0.12 }.
  // Two cards side by side (stacked below 720px), green / red top rule.

figure(media, caption?, { label: 'Figure 1', credit, wide, className }) → <figure class="lesson-figure">
  // media: an SVG (miniChart, candleSVG, diagrams — stretched to the column width) or any Node;
  // caption: HTML string | Node.
takeaway(content, { title = 'Key takeaway' }) → <aside class="takeaway">
  // content: HTML string | Node | string[] (a bullet list). A gold "Key takeaway" callout.
addOverlay(chart, spec)          // { type: 'hline'|'segment'|'series'|'band'|'zone'|'box'|'marker'|
                                 //   'path'|'fib'|'text', …add* options } or (chart) => void
lessonRng(shellOrId, label)      // deterministic rng per lesson + label
textbookExample(kinds, rng, { scanner = null, before = 60, after = 20 })
                                 // → { candles, decisionIdx, setup, lead?, sim? } (setup in scanner shape,
                                 // meta.name set). Clean generators for candle / chart-pattern ids,
                                 // trend-up/down, range, support-bounce, resistance-reject, breakout-* /
                                 // fakeout-* (triangle scenarios); every other kind (crosses, divergences,
                                 // fib-pullback) via scanner.simRound — pass { scanner } (the module from
                                 // loadScanner() or a static import); without it those kinds return a
                                 // random walk with setup: null.
annotateSetup(setup, chart, example)   // example: { candles, decisionIdx, lead }. Draws what the rule
                                 // looked at, per family: candle patterns → box + dashed "Confirm" line;
                                 // trends → swing path labelled H/L/HH/HL/LH/LL; range → zone + rings on
                                 // the touches; levels → Support/Resistance line from the first touch,
                                 // rings on earlier touches, "Bounce" / "Rejected" / "Breakout" / "Break" +
                                 // "Back inside" markers; crosses → both MAs (warmed up on `lead`) + ring;
                                 // divergences → price segment + an RSI 14 pane with the RSI segment;
                                 // fib-pullback → fib tool (0.5–0.618 zone) + ring with the retracement %;
                                 // flags → pole arrow + flag lines; double tops / H&S → labelled point path
                                 // + neckline (a scanner double top's neckline is a PRICE → hline; H&S /
                                 // textbook necklines are { x1, y1, x2, y2 } → segment). Decision markers
                                 // sit on the side price broke towards. Only finite coordinates are drawn
                                 // (unit-tested for every kind, real and textbook).
```

Use `yPad ≥ 0.14` on charts that carry text markers (the helpers do). A developer demo of every
helper lives at `#l._kit-demo` (localhost only; `DEV_ENTRIES` in the registry).

### 12.6 Pages added

`#playbook` (and `#playbook.<setupId>`): the Setup Playbook — exact, rule-based setups with a
checklist, entry/stop/target rules, a ChartStory animation, textbook and real examples, how
often the setup worked in the real-data sample, and common mistakes. `#live`: Live Market
Lab — live chart with indicator toggles and an automatic plain-English read (trend, nearest
levels, recent candle patterns, MA state, RSI) from the scanner.

Built so far (stubs, owned by their page builders from here on):

- Router: `parseHash('playbook' | 'playbook.<id>')` → `{ kind: 'page', page: 'playbook', param }`,
  `parseHash('live')` → `{ page: 'live' }`; titles "Setup Playbook · …" / "Live Market Lab · …".
  Neither page is behind the access gate (only lessons, games and the library are).
- `js/pages/playbook.js`: a card grid of setups (id = the scanner setup kind where one exists, so
  real examples can be looked up by id), and a detail view with a textbook diagram (`figure`),
  the checklist, an Entry / Stop / Target box and a takeaway. Unknown ids show a "Setup not found"
  card.
- `js/pages/live.js`: a simulated chart until **Connect to market data** is pressed (it never
  fetches on load, except in mock mode where it connects automatically), then
  `market.subscribeLive({ symbol, interval: '1d' })` with a status dot (`live` / `replay` /
  `offline`), a symbol picker and the attribution line.
- Primary nav (`js/main.js`): Beginner · Advanced · **Playbook** · **Live** (with a pulsing
  `.live-dot`) · Library · Progress · Glossary. The phone tab bar (below 820px) shows six items
  (Glossary lives in the footer there); the top nav drops Glossary below 1180px and tightens
  spacing so the wordmark never truncates. The footer links both new pages and reads "Textbook
  charts use generated prices; real-market charts name their data source." A `tier: 'both'` lesson
  or game highlights the track whose units contain it (`tiersOf`), e.g. Live Predict → Advanced;
  only a game in both tracks' units follows the last track visited.

### 12.7 Real data and content rules

§7's "no real tickers" rule applies to **textbook** charts only. Real-market charts show the
real symbol after the reveal plus the provider attribution. Never present a real outcome as
a prediction of the future; stats are "in this sample of N setups".

### 12.8 Curriculum, registry, store and pages (kits v2)

Curriculum (registry `UNITS`, recommended order; ids fixed):

| Beginner unit | lesson | game(s) |
|---|---|---|
| `u-candle-anatomy` Candlestick anatomy | `candle-anatomy` | `candle-builder` |
| `u-chart-basics` Chart types, scales & timeframes | `chart-basics` | `chart-match` (memory) |
| `u-candle-patterns` Candlestick patterns | `candle-patterns` | `pattern-flash` |
| `u-markets-orders` Markets, orders & the spread | `markets-orders` | `order-desk` (simulation) |
| `u-trends` · `u-support-resistance` · `u-trendlines` · `u-moving-averages` | as §4 | as §4 |
| `u-volume` Volume | `volume` | `volume-verdict` (swipe) |
| `u-beginner-capstone` Put it together | — | `what-next`, `setup-swipe` (swipe, tier both), `daily-challenge` (quiz, tier both, daily) |

| Advanced unit | lesson | game(s) |
|---|---|---|
| `u-chart-patterns` · `u-fibonacci` · `u-indicators` · `u-multi-timeframe` | as §4 | as §4 |
| `u-breakouts` Breakouts, fakeouts & liquidity | `breakouts` | `trap-or-trade` (predict) |
| `u-confluence-risk` | `confluence-risk` | `risk-manager` |
| `u-psychology` Trading psychology & your plan | `psychology` | `tilt-control` (story) |
| `u-advanced-capstone` Capstone | — | `what-next`, `trade-simulator`, `live-predict` (live, tier both, sources `['real']`) |

Every new lesson and game has a working stub built on the kits (lessons use `takeaway()`; game
stubs use `game.ask()`, `setHint()`, difficulty-aware question picking that works in Survival, and
Volume Verdict / Live Predict show the `realRound()` → textbook fallback → `revealSource()` flow).

Registry (`js/registry.js`, still pure data):

- Every game entry has `kind` (`quiz | draw | predict | simulation | calc | memory | swipe | story |
  live`), `styles` (subset of `['practice', 'arcade', 'survival']`) and `sources` (subset of
  `['textbook', 'real']`); `daily: true` on `daily-challenge`. Styles: all three except
  `trade-simulator` and `tilt-control` (Practice, Arcade) and `daily-challenge` (Arcade). Sources:
  `['textbook', 'real']` for chart-reading games; `['textbook']` for `candle-builder`,
  `order-desk`, `chart-match`, `daily-challenge`, `tilt-control`; `['real']` for `live-predict`.
- New exports: `STYLES` (`{ id, label, short, blurb, icon }`, icon 'heart' is drawn by
  `styleIcon()`), `DIFFICULTY_LEVELS` (`{ id, label, value }`), `SOURCES`, `GAME_KINDS`
  (`{ id, label, icon }`), `ARCADE_FILTERS` (home chips; `calc` sits under Simulation), `PAGES`
  (`{ id, title, hash, param, path, blurb }` for playbook and live), `DEV_ENTRIES` (routable by
  `findEntry`, never listed in `LESSONS`/`GAMES`/units).
- New helpers: `findStyle(id)`, `findKind(id)`, `findPage(id)`, `stylesOf(idOrEntry)`,
  `sourcesOf(idOrEntry)`, `tiersOf(id)` (tiers whose units contain it). `nextItem()` now follows
  a `'both'` game inside the tier whose units contain it (Live Predict continues in Advanced).
- New badges: `survivor` (15 rounds in a Survival run), `play-your-way` (one game finished in all
  three styles), `daily-streak-7`, plus the `<id>-ace` badge of every new game.

Store (`js/core/store.js`, additive):

```js
store.recordGame(id, { score, stars, mode, maxScore, xp, perfect, style, rounds })
  → { isBest, xp, newBadges, best, style, styleBest, isStyleBest, overallBest, isOverallBest,
      rounds, bestRounds, isBestRounds }
  // Keeps g.best / g.stars / g.plays overall (unchanged) and g.styles[style] = { best, stars, plays,
  // at, rounds?, lastRounds? }. With `style`, isBest / best are that style's; without it they stay
  // overall (legacy) and the run is recorded as 'arcade'. Legacy records count as Arcade.
store.styleStats(id, style = 'arcade') → { best, stars, plays, at, rounds? } | null
store.getGamePref(id, key, fallback = null) / store.setGamePref(id, key, value)
  // remembered intro choices: 'style', 'source', 'level'
store.dailyKey(date?) → 'YYYY-MM-DD'        // LOCAL calendar date (also exported as dailyKey())
store.dailyStatus(date?) → { key, done, score, streak, best, last, alive }
  // streak counts only while the last completion was today or yesterday (else 0)
store.recordDaily({ score, key }) → { first, streak, best, key, newBadges }
  // first completion of a date extends the streak (+1 after yesterday, else 1); replays keep the
  // best score but never change the streak; awards daily-streak-7
```

`state` gains `gamePrefs` and `daily: { last, streak, best, history: { key: score } }` (90 days).

Pages:

- Home: a **Today** row (Daily Challenge card with date, streak and done/not-played status →
  `#g.daily-challenge`; **Live now** card → `#live` with the market status from `market.js` —
  it never fetches, it only reflects `marketStatus()` / mock mode and follows `onMarketStatus`),
  a **Play your way** section (the three styles and their rules), and the arcade with **filter
  chips** (All, Quiz, Draw, Predict, Memory, Swipe, Story, Simulation, Live; `aria-pressed`,
  `data-filter`). Tiles show the kind, the style icons (`.style-icons`) and a "Real charts" /
  "Live data" chip; the wide Trade Simulator tile is always last.
- Track pages list the new units automatically; game items show style icons and the real/live tag.
- Progress: a **Daily streak** stat (links to the challenge) and a games table with the best per
  style (Practice / Arcade score, Survival rounds; "·" when a style is not offered).

Testing notes: `tests/unit/kits-v2.test.mjs` covers registry integrity, per-style bests and the
daily streak. Starting a Real-market run (and therefore `g.live-predict`, which is real-only)
calls the `market-data` function unless mock mode is on; the smoke test therefore opens every page
with `?market=mock` (fixtures, no network; `--real-market` turns that off) and also visits the
PAGES (`#playbook`, `#playbook.hammer`, `#live`) and DEV_ENTRIES (`#l._kit-demo`).


### 12.9 Engine v2: chart types, viewport, candle rules, market simulator

All additive — §6 APIs are unchanged, and existing charts behave exactly as before (every new
option defaults off).

**`js/core/chart.js` — CandleChart additions**

```js
new CandleChart(el, {
  …§6.5 options,
  chartType: 'candles',   // 'candles' | 'ohlc' (bars: left tick = open, right tick = close) |
                          // 'line' (close line + subtle area) | 'heikin-ashi' (computed HA candles;
                          // the legend reads "HA O/H/L/C" and notes "averaged, not traded prices")
  logScale: false,        // log price axis (1-2-5 / 1-1.5-2-3-5-7 ticks per decade; ranges under 8×
                          // use nice linear ticks); falls back to linear while a price is ≤ 0
  pannable: false,        // wheel zoom (anchored at the pointer), trackpad pinch (ctrl + wheel),
                          // shift / horizontal wheel pan, mouse drag pan, one-finger horizontal
                          // drag and two-finger pinch / pan on touch (vertical swipes still scroll
                          // the page; a touch held 300 ms scrubs the crosshair), keys + / − / 0
  wheelZoom: true,        // true: plain wheel zooms (at the zoom limits the page scrolls instead);
                          // 'ctrl': only ctrl / ⌘ + wheel; false: never
  viewport: null,         // [from, to] initial slot range (candle i spans slot [i, i + 1])
  minBars: 10,            // narrowest viewport
  focus: null, focusDim: 0.3,   // [from, to]: dim candles + volume outside (ChartStory)
});
chart.setChartType(type) / chart.chartType
chart.setLogScale(on) / chart.logScale
chart.setViewport(from, to, { animate = false, duration = 450 })  // clamped: ≥ minBars wide, ≤ 5%
                          // empty on the left / 15% on the right; emits 'viewport'
chart.getViewport() → { from, to, first, last, count, total }     // first / last visible candle idx
chart.resetViewport({ animate })        // show everything again (the default)
chart.panBy(slots) / chart.zoomBy(factor > 1 = in, anchorSlot?)
chart.on('viewport', fn)                // fn(getViewport()) after any change (API, wheel, drag, pinch)
chart.setFocus(from, to, { dim }) / chart.setFocus(null) / chart.focus
chart.setVolume(on)                     // toggle the volume bars
chart.drawnCandles                      // the candles as drawn (Heikin-Ashi in that mode)
// Overlay specs also accept: pulse: true (a one-off ~1.3 s attention pulse as it appears; none with
// reduced motion) and className (wraps the overlay in <g class="tc-ov …">).
```

- Only the visible range is drawn (candles, volume, series, bands, pane histograms): a
  150-candle viewport of 1500 candles renders in ≈ 0.5 ms, all 1500 in ≈ 3 ms (desktop Chromium).
- Coordinates (`idxToX`, `xToIdx`, `priceToY`, `yToPrice`, event payloads, drawing tools,
  draggable handles) follow the viewport and the log scale. Autoscale 'visible' uses the candles
  in the viewport. The keyboard crosshair pans the viewport to stay on screen. `append()` keeps
  a viewport that showed the latest candle following new ones (live / replay charts).
- `miniChart(…, { chartType })` supports the same four types. Also exported: `CHART_TYPES`,
  `logTicks(min, max, maxTicks)`, `heikinAshiCandles(candles)`.

**`js/core/patterns.js` — rules for real candles**

```js
CANDLE_THRESHOLDS        // frozen: dojiBody 0.08, shadowTiny 0.08, shadowLong 0.6, spinBodyMin/Max 0.1/0.3,
                         // marubozuBody 0.9, longBody 0.6, hammerBodyMin 0.1, hammerWickRatio 2,
                         // hammerShortWick 0.1, starBody 0.35, soldierWick 0.15, tweezerPct 0.001,
                         // tweezerRange 0.04; rules only: sizeLookback 10, contextLookback 10,
                         // trendMove 1.2, trendNet 0.8, extremeLookback 8, extremeTol 0.1.
                         // The generators, check() and the rules all read these (they cannot drift).
CANDLE_RULES[id](candles, i, ctx?) → boolean   // pattern id COMPLETES on candle i (its last candle),
  // judged from candles 0..i only: the textbook geometry (an engulfing candle may open exactly at
  // the prior close, as 24/7 markets do), a pattern big enough next to the typical range of the 10
  // candles before it (e.g. hammer range ≥ 1×, marubozu body ≥ 1×, doji range ≥ 0.6×), the trend
  // context before it (reversals: the opposite trend; marubozu: its own direction; doji /
  // spinning top: any), and reversals printing the extreme of the prior 8 candles (soldiers /
  // crows: within 0.5 ranges of the prior 10). Needs ≥ 3 candles of history. Volume is never
  // required. ctx: { trend (of the candles BEFORE the pattern's first candle), avgRange }.
contextTrend(candles, i, lookback = 10) → 'up'|'down'|'range'   // candles [i − lookback, i): regression
  // move ≥ 1.2 typical ranges AND net open→close move ≥ 0.8 ranges in the same direction
typicalRange(candles, idx, n = 10)      // mean high − low of the n candles before idx
candleConfirm(id, patternCandles, dir)  // the confirmation level (as candleScenario's `confirm`)
```

Measured: every candleScenario (211,200 in an offline sweep: 300 seeds × 4 price scales × 4
lead-ins × 2 outcomes) is detected at its pattern by its own rule; on random-walk noise each
directional rule fires on ≤ 0.5% of candles (doji ≈ 4%, spinning top ≈ 8% — they are common),
and the hammer / hanging-man (and other same-shape) twins never fire on each other's scenarios
(`tests/unit/candle-rules.test.mjs` prints the rates).

**`js/core/data.js` — `realisticMarket`** (fallback when real data is missing; the simulator)

```js
realisticMarket({ seed, count = 300, start = 100, regime = 'mixed'|'trend'|'range'|'volatile',
                  vol = 0.012, drift = 0, volume = true, gaps = true, decimals = null, info = false })
  → candles  (or { candles, regimes: [{ kind: 'up'|'down'|'range'|'volatile', from, to }] } with info)
```

Markov regime switches (spells of ~20–90 candles; `regime` biases the mix), GARCH(1,1)
volatility clustering around `vol` × the regime's multiplier, Student-t (ν = 5) returns plus rare
jump candles, trends drifting 0.15–0.3 σ per candle, ranges mean-reverting to where they began,
opens at the previous close except occasional gaps (likelier on regime changes), wicks scaled by
current volatility, and volume that rises with volatility, candle size and gaps (higher with
the trend). `drift` adds a per-candle log return (long bull markets for log-scale demos).
Deterministic; valid OHLC for any seed / scale (tests/unit/market-sim.test.mjs).

**`js/core/indicators.js`**

```js
heikinAshi(candles) → candles           // HA values (averaged, not traded prices); v and t kept
zigzag(candles, { atrMult = 2, period = 14, pct = 0, last = false })
  → [{ idx, price, type: 'high'|'low', confirmedIdx }]   // alternating swings that reversed by
  // ≥ max(atrMult × ATR, pct × price); confirmedIdx = the candle that confirmed it (causal);
  // last: true appends the unconfirmed extreme of the current leg (confirmedIdx null)
```

**`#dev-chart`** also exercises: chart types / log scale / pan-zoom on 1500 candles
(`[data-test="viewport-chart"]`, readout `[data-test="vp-readout"]`), a ChartStory, the scanner
on a fixture with every setup marked plus describeChart, and market.js status (mock mode toggle,
live / replay demo — no market-data request is made unless mock mode is on).

### 12.10 Builder notes (read this first)

Practical rules for lesson and game builders, from the v2 integration QA. Everything here is
verified in mock mode, offline and on phone / tablet / desktop.

1. **Start from your stub and keep its shape**: `export default { id, mount(root, ctx) { const game =
   new GameShell(root, ctx, {…}); return () => game.destroy(); } }` (lessons: `new LessonShell` +
   `() => shell.destroy()`). Registry `styles` / `sources` drive the intro pickers; you do not pass them.
2. **Build every round on demand** from `round`, `difficulty` and the round `rng`. Survival has
   `game.rounds === null`, so a fixed question list must wrap or be generated. Use only the `rng`
   passed to `onRound` (= `game.roundRng`) for round content: Practice "Try again" and seed replays
   then show the identical round. Keep non-rng per-round state (a "used questions" set) behind
   `if (!retry)` — see `js/games/trap-or-trade.js`.
3. **Make difficulty real, not cosmetic.** `difficulty` is 0–1 (Practice: fixed 0.2 / 0.5 / 0.85;
   Arcade: ramps across the run; Survival: ramps over 15 rounds). Map it to generator knobs:
   ```js
   const leadIn  = Math.round(30 - 18 * difficulty);                 // less context to read
   const noise   = 0.25 + 0.55 * difficulty;                          // fromPath({ noise }) / realisticMarket({ vol })
   const pool    = difficulty < 0.35 ? EASY : difficulty < 0.7 ? [...EASY, ...MID] : ALL;
   const options = difficulty > 0.6 ? lookalikeOptions : obviousOptions;   // hammer vs hanging man …
   ```
4. **Use `game.ask()` for multiple choice** (it handles correct / wrong, Practice retry and hint caps,
   Survival lives, the real-chart reveal and Next). For custom interactions call `game.correct()` or
   `game.wrong()` **once** per round (each `wrong()` costs a Survival life), then `game.nextButton()`.
5. **Clock**: prefer `timer: { seconds, perRound: true }` — the shell pauses it while real data loads,
   scales it in Survival (`clockScale` 1 → 0.6) and has none in Practice. A game-run clock must check
   `game.timed` and multiply by `game.clockScale`. `timer.stop()` before post-answer animations.
6. **Hints** (`setHint()` every round, or `ask({ hint })`): point at the evidence ("compare the
   breakout volume bar with the ten before it"), never at the answer. A hinted round scores ≤ 50%.
7. **Real rounds with a fallback** — the pattern every chart game should use:
   ```js
   import { simRound } from '../core/scanner.js';
   import { annotateSetup } from '../core/lesson-kit.js';
   import { CandleChart } from '../core/chart.js';
   import { h } from '../core/ui.js';

   async onRound(g, { rng, stage, difficulty }) {
     const q = { kinds: difficulty < 0.5 ? ['bull-flag', 'bear-flag'] : SIX_PATTERNS, before: Math.round(70 - 20 * difficulty), after: 20 };
     const real = await g.realRound(q);           // null on textbook runs or with no data
     const r = real || simRound(rng, q);          // same shape: candles, decisionIdx, setup, outcome, lead
     const host = h('div', { class: 'chart-frame' });
     stage.append(h('p', { class: 'quiz__q' }, 'Which way does this setup point?'), host);
     const chart = new CandleChart(host, { candles: r.candles, visible: r.decisionIdx + 1, slots: r.candles.length,
       height: 300, decimals: r.decimals, yPad: 0.14, ariaLabel: 'Price chart; the next candles are hidden.' });
     g.ask({
       options: [{ label: 'Up', value: 'bullish' }, { label: 'Down', value: 'bearish' }],
       answer: r.setup.direction,
       explain: `<strong>${r.setup.meta.name}</strong>. Next ${r.outcome.bars} candles: ${r.outcome.direction} (${r.outcome.r} ATR).`,
       onAnswer: () => { chart.reveal({ to: r.candles.length, interval: 40 }); annotateSetup(r.setup, chart, r); },
     });
     return () => chart.destroy();
   }
   ```
   `ask()` reveals the market (symbol, date, attribution) only when `g.real` is set; the HUD chip
   says "Textbook chart" on fallback rounds by itself. Never call `revealSource()` for a sim round.
8. **Keep mystery charts honest**: stop at `decisionIdx` (fakeouts: `setup.meta.breakoutIdx`), pass
   `slots: candles.length` so the hidden future keeps its space, no `timeLabel` before the reveal
   (dates give it away), `decimals: r.decimals` (FX has 5). Autoscale is `'visible'` by default, so
   hidden candles never leak into the y-range.
9. **Grade the read, report the outcome.** Real outcomes are noisy: grade whether the setup was read
   correctly; show `r.outcome` (`direction`, `r` in ATRs, `result: 'followed' | 'failed' | 'flat'`) as
   "what happened this time", never as proof. Stats are "in this sample of N setups".
10. **Generator leaks to avoid**: `chartScenario` volume from the breakout candle on — and the
    `candleScenario` pattern candle's volume — hints the outcome (hide volume in predict rounds or
    teach it on purpose); both outcomes of a scenario share candles up to the breakout, so show
    `0..breakoutIdx`, ask, then reveal; hammer vs hanging man differ only by context (thumbnails need the
    lead-in); dragonfly / gravestone are also doji.
11. **Rare kinds**: inverted hammer, morning / evening star and three soldiers / crows are rare in
    real data — `realRound` will often return `null`; weight kinds or rely on the fallback.
    Golden / death crosses need ~220 candles (SMA 50/200): use `r.lead` to warm indicators up —
    `sma(closes([...r.lead, ...r.candles]), 50).slice(r.lead.length)` — or pass `maFast / maSlow /
    maType` to `findSetups` on short textbook charts.
12. **ChartStory from a setup's meta** (live reference: `flagStory` in `js/lessons/_kit-demo.js`):
    ```js
    storyStep({ title: 'A bull flag, step by step', story: (rng) => {
      const ex = textbookExample(['bull-flag'], rng);      // meta: poleStart, poleTop, upper, lower, target
      const m = ex.setup.meta, d = ex.decisionIdx;         // d = the breakout candle
      const line = (l) => ({ type: 'segment', a: { idx: l.x1, price: l.y1 }, b: { idx: l.x2, price: l.y2 }, color: 'accent', dashed: true });
      return { candles: ex.candles, indicators: { volume: true }, frames: [
        { to: m.poleStart.idx + 1, caption: 'A quiet market. Nothing to do yet.' },
        { to: m.poleTop.idx + 1, title: 'The pole.', caption: 'A fast, one-way rally on rising volume.',
          overlays: [{ type: 'segment', a: m.poleStart, b: m.poleTop, color: 'bull', arrow: true, label: 'Pole' }],
          focus: [m.poleStart.idx, m.poleTop.idx] },
        { to: d, title: 'The flag.', caption: 'A gentle drift on shrinking volume.', overlays: [line(m.upper), line(m.lower)],
          focus: [m.poleTop.idx, d - 1], zoom: true },
        { to: d + 1, title: 'Breakout.', caption: 'The first close above the upper line is the entry.',
          overlays: [{ type: 'marker', idx: d, position: 'above', text: 'Entry' }] },
        { to: ex.candles.length, caption: 'Measured move: the pole height from the breakout.',
          overlays: [{ type: 'hline', price: m.target, color: 'bull', label: 'Target' }] },
      ] };
    } })
    ```
    Frames are cumulative (`clear: true` resets), `to` is an exclusive candle count, 4–7 frames with
    one idea each and captions under ~140 characters read best on phones. Leave `autoplay` off in
    lessons (the learner drives); `yPad` defaults to 0.14 so text markers fit.
13. **Lesson helpers do the plumbing**: `realExampleStep({ kinds })` falls back to a labelled
    textbook example for every scanner kind and zooms onto candle patterns; `checklistStep` for "is
    this valid?" (items reveal overlays; a failing rule uses `pass: false`); `compareStep` for good vs
    trap; `figure()` / `takeaway()` for static media. Pass `volume: true` for volume setups.
14. **Charts inside reading pages**: `pannable` charts zoom on a plain wheel — use `wheelZoom: 'ctrl'`
    in lessons; widgets that use arrow keys need `data-keys="capture"`; use `yPad ≥ 0.14` whenever a
    marker or box has text; phones give a chart ~330 px, so show ≤ 80 candles at 260–320 px height.
15. **Clean up**: return `() => chart.destroy()` (and `story.destroy()`, `unsubscribe()`) from `onRound`
    / step `render`. Code after `await game.realRound()` never runs once the round has ended, but
    other awaits are not protected — check `game.state === 'play'` after them.
16. **Labels are honest**: textbook / simulated charts never show a ticker or a date; real charts
    show the symbol, date and attribution only after the answer, plus "Delayed" / "Test data" flags.
17. **Test what you build**: `node tests/smoke.mjs g.<id>` (all viewports × themes, market fixtures
    via `?market=mock`, add `--no-storage`); open `/?market=mock#g.<id>` on a local server to play real
    rounds offline; `tests/visual/setups.html?kind=<id>` shows exactly what the scanner calls a
    `<id>` in the fixtures; generators and scanners are importable in node for unit tests.
