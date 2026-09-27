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
js/core/lesson-kit.js      LessonShell: step-by-step lesson with nav, quick checks, completion
js/pages/home.js           landing: animated hero chart, tier tracks, continue-where-you-left
js/pages/track.js          tier overview (beginner / advanced)
js/pages/library.js        pattern library (candlestick + chart patterns) with diagrams
js/pages/progress.js       XP, level, badges, per-module best scores
js/pages/glossary.js       searchable glossary of terms
js/pages/dev-chart.js      hidden kitchen-sink page exercising every CandleChart feature
js/lessons/<id>.js         one file per lesson (see registry)
js/games/<id>.js           one file per game (see registry)
tests/unit/*.test.mjs      node:test unit tests for js/core (no DOM)
tests/smoke.mjs            Playwright: every route, console errors, screenshots
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

Curriculum (ids are fixed — other contributors rely on them):

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
| `--text-3` | `#76839A` | `#6F7D96` | captions, axes |
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
  // HIGH equals the price and no candle within ±3 bars reaches it (troughs: LOW, symmetric);
  // every other waypoint ('mid': endpoints, points on a monotonic run) is hit by the CLOSE.
  // → { candles, anchors: [{ idx, price, kind: 'high'|'low'|'mid' }] }  (one per point, input order)
  // Keep waypoints ≥ 4 candles apart; closer peaks/troughs squash the candles between them.

export function trendSeries({ seed, count = 80, start = 100, direction = 'up'|'down'|'range',
                              swings = 4, strength = 1, volume = true })
  // Zig-zag market structure. `swings` = number of swing highs (and of swing lows).
  // 'up': higher highs + higher lows (every high clearly above the last), 'down' mirrored,
  // 'range' oscillates between a ceiling and a floor. Each swing is the exact high/low of its
  // candle, the extreme within ±3 bars, and is found by indicators.swings({left:3,right:3}).
  // → { candles, swings: [{ idx, price, type: 'high'|'low', label: 'HH'|'HL'|'LH'|'LL'|'H'|'L' }] }

export function aggregate(candles, factor, { partial = true } = {})
  // Combine every `factor` consecutive candles into one higher-timeframe candle.
  // o = first.o, c = last.c, h = max h, l = min l, v = sum v, t = index in new series.
  // A trailing incomplete group is kept (the still-forming candle) unless partial = false.

export function addVolume(candles, { seed, base = 1000, trendBoost = true })
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
// Generators satisfy the textbook definitions for every seed (see tests/unit/patterns.test.mjs):
// e.g. doji |c−o| ≤ 8% of range; hammer lower wick ≥ 2× body and upper wick ≤ 10% of range;
// engulfing body strictly engulfs the opposite-colour prior body; tweezer highs/lows within 0.1%.

export function candleScenario(patternId, { seed, leadIn = 14, after = 0, start = 100,
                                            outcome = 'success' | 'fail' })
  // Lead-in trend that matches the pattern's context (downtrend before bullish reversals,
  // uptrend before bearish ones, a trend in the pattern's direction for continuation, any for
  // neutral), then the pattern, then `after` follow-through candles. 'success' moves in the
  // pattern's bias direction (first candle confirms); 'fail' moves against it and, with
  // after ≥ 3, closes beyond the pattern's extreme. Neutral patterns move in a random direction.
  // → { candles, start: idx, end: idx,          (inclusive indexes of the pattern)
  //     id, bias, context, trend: 'up'|'down'|'range', outcome, direction: 1|-1 }
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
  // broken line first); 'fail' breaks out briefly on weak volume, then reverses back through
  // the pattern (a trap). Volume fades during the formation and expands on real breakouts.
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
highest(values, period) / lowest(values, period)       // (additions)
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
                                          // Handles have ≥ 28px touch targets; ↑/↓ on the focused
                                          // chart nudge the last draggable overlay.
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
  import time). Node 22 does not accept a bare directory (`node --test tests/unit/` fails with
  MODULE_NOT_FOUND); the quoted glob is expanded by node itself, so it also works on Windows.
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

### 11.6 LessonShell (`js/core/lesson-kit.js`)

- `render(el, step, shell)`; a step with `locked: true` gates Next until the step calls
  `shell.unlock()` (`shell.lock()` re-locks). `shell.next() / back() / go(i) / finish()`.
- Arrow keys are ignored inside `[data-keys="capture"]`, sliders, tab lists and radio
  groups — put `data-keys="capture"` on interactive widgets that use arrows.
- Hooks for tests: `[data-action="next" | "back"]`.

### 11.7 Design tokens and classes

- Extra tokens: `--accent-strong`, `--bull-strong`, `--bear-strong` (text-safe on light
  grounds and on the `*-soft` tints), `--btn-primary(-hover)`, `--bull-ink`, `--bear-ink`,
  `--topbar-bg`, `--overlay`, `--radius-lg`, `--shadow-lg`, `--ease-out`, `--ease-back`,
  `--topbar-h`, `--tabbar-h` (height of the phone tab bar, 0 on desktop — use it for
  bottom-sticky UI).
- Extra classes: `.btn--lg`, `.btn--icon`, `.btn--block`, `.link-btn`, `.card--raised`,
  `.card--inset`, `.card--link`, `.card--flush`, `.chip--sm`, `.chip--outline`,
  `.chip--tier-{beginner|advanced|both}`, `.kbd-hint`, `.stars`, `.explainer(--good|--bad)`,
  `.segmented` (buttons with `aria-checked`/`aria-pressed`), `.field`, `.input`, `.figure`,
  `.chart-frame`, `.legend` + `.legend__item` + `.swatch` (`--c`), `.stat` +
  `.stat__label` + `.stat__value`, `.data-table`, `.table-scroll`, `.up` / `.down`,
  `.container--read` (680px) / `.container--wide` (960px), `.section`, `.section-head`,
  `.lead`, `.faint`, `.prose`, `.t-12 … .t-48`.
- On touch (`pointer: coarse`) buttons and small links get ≥ 44px hit targets.

### 11.8 Smoke test

`node tests/smoke.mjs [routes…] [--desktop] [--tablet] [--phone] [--light|--dark]
[--no-shots] [--no-interact] [--fonts] [--concurrency=N]`. Viewports: desktop 1280×800,
tablet 820×1180 (touch), phone 390×844 (touch). Google Fonts requests are blocked unless
`--fonts` is given. After the first screenshot it clicks Start (and one answer option) on
games and Next on lessons, then screenshots `<route>-<viewport>-<theme>-play.png`.

`npm test` runs `node --test "tests/unit/*.test.mjs"` — Node 22 no longer expands a bare
directory argument, so the glob is spelled out.

## 12. Expansion: play styles, real market data, lesson media

Everything in this section is additive. Owners: see the build plan in each workflow brief.

### 12.1 Play styles (every game, player's choice)

GameShell options gain `styles` (default `['practice', 'arcade', 'survival']`) and the intro
shows a Style picker (segmented control, remembered per game in the store):

| style | rules |
|---|---|
| `practice` | no clock, **Hint** button (`game.hint(text, { cost })` shows a clue, the round then earns at most 50%), full explanations, retry a round, no stars/XP penalty but XP ×0.5 |
| `arcade` (default) | the game's own clock/speed bonus/streak multiplier as in §6.8 |
| `survival` | 3 lives (`game.lives`), no fixed round count: rounds continue until lives run out, difficulty ramps via `game.difficulty` (0→1 over ~15 rounds); score = survived rounds × points; own best score per style |

`game.style` is readable in every hook. `game.wrong()` costs a life in survival and ends the
game at 0. Games must make round generation depend on `game.difficulty` (0–1) so survival
ramps. Best scores are stored per `(gameId, style)`.

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
  intervals: ['1h', '1d'],                   // candidate timeframes
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

### 12.3 Market data (`js/core/market.js` + Edge Function `market-data`)

```js
export const SYMBOLS = [{ id: 'BTC-USD', name: 'Bitcoin', class: 'crypto', decimals: 2 }, …];
export async function getCandles({ symbol, interval, limit = 300, end }) → { candles, source, attribution, delayed }
export async function getHistory({ symbol, interval, bars = 1000 }) → same, cached for the session
export function subscribeLive({ symbol, interval }, onUpdate) → unsubscribe   // polling (and a
   // browser-direct public WebSocket when the provider allows it) with a last-price tick
export function marketStatus() → 'online' | 'offline' | 'unconfigured'
```

- Intervals: `1m 5m 15m 1h 6h 1d`. Candles are `{ t (ms epoch UTC), o, h, l, c, v }`, oldest
  first; `t` is converted to the chart's index-based `t` by the caller.
- The browser calls the Supabase Edge Function `market-data` (public, no sign-in needed for
  the data itself), which fetches from free providers server-side, stores candles in the
  `market_candles` table and throttles upstream calls per `(symbol, interval)`, so traffic
  scales with symbols, not with users.
- `localStorage['tts-market-mock'] = '1'` (localhost only) serves deterministic fixture
  candles from `tests/fixtures/market/*.json` so games can be tested offline.

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

LessonShell step helpers (in lesson-kit.js): `storyStep({ title, story, text })`,
`realExampleStep({ title, kinds, intervals, annotate(setup, chart) })` (fetches a real
instance via scanner, falls back to a textbook scenario, shows symbol/date/attribution),
`checklistStep({ title, items, example })` (an interactive "is this a valid setup?"
checklist that ticks items as their overlays appear), `compareStep({ left, right })`
(side-by-side good vs bad example).

### 12.6 Pages added

`#playbook` (and `#playbook.<setupId>`): the Setup Playbook — exact, rule-based setups with a
checklist, entry/stop/target rules, a ChartStory animation, textbook and real examples, how
often the setup worked in the real-data sample, and common mistakes. `#live`: Live Market
Lab — live chart with indicator toggles and an automatic plain-English read (trend, nearest
levels, recent candle patterns, MA state, RSI) from the scanner.

### 12.7 Real data and content rules

§7's "no real tickers" rule applies to **textbook** charts only. Real-market charts show the
real symbol after the reveal plus the provider attribution. Never present a real outcome as
a prediction of the future; stats are "in this sample of N setups".
