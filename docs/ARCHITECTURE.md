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
export function makeRng(seed)  // → rng object; deterministic (mulberry32)
rng.next()              // [0,1)
rng.float(min, max)
rng.int(min, max)       // inclusive
rng.pick(array)
rng.shuffle(array)      // returns new array
rng.chance(p)           // boolean
rng.gauss(mean=0, sd=1)
rng.sign()              // -1 | 1
rng.fork(label)         // child rng derived from this seed + label
export function randomSeed()   // uses Math.random, returns uint32
```

### 6.2 `js/core/data.js`

A candle is `{ o, h, l, c, v, t }` (`t` = integer index of the period, `v` = volume).
Every generator guarantees `l <= min(o,c) <= max(o,c) <= h` and positive prices.

```js
export function randomWalk({ seed, count = 120, start = 100, drift = 0, vol = 0.012, volume = true })
  // → candles. drift/vol are per-candle fractions.

export function fromPath(points, { seed, count = 120, start = 100, noise = 0.35,
                                   wick = 0.6, volume = true, exact = true })
  // points: [[x, price], …] with x in [0, 1] (0 = first candle, 1 = last).
  // Closes follow the piecewise-linear path; noise is relative to the average
  // absolute move per candle. With exact = true the candle at each waypoint
  // touches the waypoint price exactly with its HIGH (local peak) or LOW (local trough).
  // → { candles, anchors: [{ idx, price, kind: 'high'|'low'|'mid' }] }  (one per point)

export function trendSeries({ seed, count = 80, start = 100, direction = 'up'|'down'|'range',
                              swings = 4, strength = 1 })
  // Zig-zag market structure: 'up' makes higher highs + higher lows, etc.
  // → { candles, swings: [{ idx, price, type: 'high'|'low', label: 'HH'|'HL'|'LH'|'LL'|'H'|'L' }] }

export function aggregate(candles, factor)
  // Combine every `factor` consecutive candles into one higher-timeframe candle.
  // o = first.o, c = last.c, h = max h, l = min l, v = sum v, t = index in new series.

export function addVolume(candles, { seed, base = 1000, trendBoost = true })
export function scale(candles, factor) / shift(candles, delta)   // pure helpers
export function roundPrice(p, decimals = 2)
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
    generate(rng, { price, range }) → [candles]  // just the pattern candles
  }, …
};
// Required ids: doji, dragonfly-doji, gravestone-doji, spinning-top, bullish-marubozu,
// bearish-marubozu, hammer, inverted-hammer, hanging-man, shooting-star,
// bullish-engulfing, bearish-engulfing, bullish-harami, bearish-harami, piercing-line,
// dark-cloud-cover, tweezer-top, tweezer-bottom, morning-star, evening-star,
// three-white-soldiers, three-black-crows

export function candleScenario(patternId, { seed, leadIn = 14, after = 0, start = 100 })
  // Lead-in trend that matches the pattern's context, then the pattern, then `after`
  // follow-through candles (in the pattern's bias direction for reversal patterns).
  // → { candles, start: idx, end: idx }   (inclusive indexes of the pattern)

export const CHART_PATTERNS = {
  'head-and-shoulders': {
    id, name, bias, kind: 'reversal'|'continuation', summary, psychology, howToTrade,
    target: 'measured-move rule in words', reliability,
    path(rng) → { points: [[x, price], …], labels: { pointIndex: 'Left shoulder', … },
                   breakoutPoint: index, neckline?: [pointIndexA, pointIndexB] }
  }, …
};
// Required ids: head-and-shoulders, inverse-head-and-shoulders, double-top,
// double-bottom, triple-top, triple-bottom, rising-wedge, falling-wedge,
// ascending-triangle, descending-triangle, symmetrical-triangle, bull-flag,
// bear-flag, cup-and-handle, rounding-bottom

export function chartScenario(patternId, { seed, count = 110, start = 100, after = 20 })
  // → { candles, patternStart, patternEnd, breakoutIdx,
  //     keyPoints: [{ idx, price, label }],
  //     neckline: { x1, y1, x2, y2 } | null,         // idx/price coordinates
  //     target: price | null, bias }
```

### 6.4 `js/core/indicators.js`

All series functions return arrays aligned with the input (same length) with `null` during
warm-up.

```js
sma(values, period)            ema(values, period)
rsi(closes, period = 14)
macd(closes, fast = 12, slow = 26, signal = 9) → { macd, signal, hist }
bollinger(closes, period = 20, mult = 2)       → { mid, upper, lower, width }
atr(candles, period = 14)
closes(candles) / highs(candles) / lows(candles)
swings(candles, { left = 3, right = 3 }) → [{ idx, price, type: 'high'|'low' }]  // ordered by idx
labelStructure(swings) → same with label 'HH'|'HL'|'LH'|'LL' (first high/low: 'H'/'L')
trendOf(candles) → 'up'|'down'|'range'         // from swing structure + slope
supportResistance(candles, { tolerance = 0.006, minTouches = 2 })
  → [{ price, touches, type: 'support'|'resistance'|'both', firstIdx, lastIdx }] strongest first
fibLevels(from, to, ratios = [0, .236, .382, .5, .618, .786, 1])
  → [{ ratio, price }]   // from = swing start price, to = swing end price;
                          // retracement ratio r → price = to - (to - from) * r
fibExtensions(from, to, ratios = [1.272, 1.618, 2.618]) → [{ ratio, price }]
crosses(fast, slow) → [{ idx, type: 'golden'|'death' }]   // golden: fast crosses above slow
divergence(candles, oscillator, { lookback = 40 }) → [{ type: 'bullish'|'bearish'|'hidden-bullish'|'hidden-bearish', a: {idx}, b: {idx} }]
linearRegression(points) → { slope, intercept }
```

### 6.5 `js/core/chart.js` — `CandleChart`

SVG, responsive width (ResizeObserver on the container), fixed height. Re-renders on a
requestAnimationFrame when anything changes. Uses `css/chart.css` classes and colour tokens.

```js
import { CandleChart, miniChart } from '../core/chart.js';

const chart = new CandleChart(container, {
  candles,                 // required
  height: 340,
  slots: null,             // number of x slots; default = candles.length. Use a larger
                           // value to reserve empty space on the right for future candles.
  visible: null,           // draw only the first N candles (default: all)
  autoscale: 'visible',    // 'visible' | 'all' | [min, max] — y-range source. Default
                           // 'visible' so hidden future candles never leak into the scale.
  yPad: 0.08,              // extra headroom fraction
  showVolume: false,
  showAxis: true,          // right price axis + bottom index/time axis
  showGrid: true,
  crosshair: true,         // hover/touch crosshair with price readout
  decimals: 2,
  timeLabel: null,         // (idx, candle) => string for the x-axis
  ariaLabel: 'Price chart',
});
```

Colour arguments accept a **token name** (`'accent' | 'bull' | 'bear' | 'info' | 'warn' |
'support' | 'resistance' | 'ma1' | 'ma2' | 'ma3' | 'fib' | 'muted' | 'text'`) which maps to
`var(--<name>)`, or any literal CSS colour.

Points are always in **data space**: `{ idx, price }` where `idx` may be fractional.

```js
// data
chart.setCandles(candles)                 // keeps overlays
chart.setVisible(n)                       // show first n candles
chart.reveal({ to, interval = 160, onStep, grow = true }) → Promise   // animate candles
                                          // appearing one at a time up to index `to` (exclusive)
chart.append(candle)                      // push one candle (replays / live)
chart.setSlots(n)

// overlays — every add* returns an id (string); pass { id } to choose one.
chart.addHLine({ price, color = 'accent', label, dashed = false, width = 1.5, from, to })
                                          // from/to: optional idx range, default full width
chart.addSegment({ a: {idx, price}, b: {idx, price}, color, width = 2, dashed, label,
                   extend: 'none'|'right'|'left'|'both' })
chart.addSeries({ values, color = 'ma1', width = 1.75, label })   // e.g. moving average
chart.addBand({ upper, lower, color = 'info', opacity = 0.12 })    // e.g. Bollinger fill
chart.addZone({ from, to, color = 'accent', opacity = 0.14, label, x1, x2 })  // price band
chart.addBox({ from, to, color = 'accent', label })               // highlight idx range
chart.addMarker({ idx, price, position = 'above'|'below'|'at', shape = 'arrow'|'dot'|'ring'|'tag',
                  text, color = 'accent' })
chart.addPath({ points: [{idx, price}], color = 'info', width = 2, dots = true,
                labels: ['HH', …] })                               // zig-zag / structure
chart.addFib({ a: {idx, price}, b: {idx, price}, ratios, extensions = [], color = 'fib',
               labels = true, zone: [0.5, 0.618] | null })         // retracement tool
chart.addText({ idx, price, text, color = 'text', anchor = 'start'|'middle'|'end' })
chart.update(id, patch)                   // merge patch into overlay spec and re-render
chart.remove(id)
chart.clearOverlays()                     // does not remove panes
chart.getOverlay(id)

// indicator panes (share the x-scale, stacked under the price area)
chart.addPane({ id, height = 90, title, range: 'auto' | [min, max],
                levels: [{ value, label, color }],
                series: [{ values, color, width }],
                histogram: { values, pos = 'bull', neg = 'bear' } })
chart.updatePane(id, patch)
chart.removePane(id)
// segments/markers/texts may target a pane with { pane: 'rsi' } (y = pane value).

// interaction
chart.on('click' | 'hover' | 'leave', fn)   // fn({ idx, price, x, y, candle, pane })
chart.off(event, fn)
chart.draw(kind, opts) → Promise<shape|null>
  // kind: 'hline' (one tap), 'segment' (drag or tap-tap), 'fib' (drag a→b),
  //       'zone' (drag price range)
  // opts: { color, snap: false | 'ohlc' (snap to nearest high/low/open/close within 12px) }
  // resolves with { kind, a: {idx, price}, b: {idx, price}, price?, id } and leaves the
  // drawing on the chart as an overlay with that id. Resolves null if cancelDraw().
chart.cancelDraw()
chart.setDraggable(id, onChange)          // hline: vertical drag; segment/fib: endpoint handles
chart.setInteractive(enabled)

// coordinates
chart.idxToX(idx) / chart.xToIdx(x) / chart.priceToY(p) / chart.yToPrice(y)
chart.flash(idx, color = 'accent')        // brief pulse highlight on a candle
chart.destroy()
```

`miniChart(candles, { width = 160, height = 90, overlays = [], highlight = null,
padding = 6 }) → SVGSVGElement` — static, axis-less thumbnail for cards, answer options
and the pattern library. `overlays` accepts the same specs as the `add*` methods with a
`type` field (`'hline'|'segment'|'series'|'zone'|'box'|'marker'|'path'|'fib'`).

`candleSVG({ o, h, l, c }, { width = 60, height = 140, min, max }) → SVGSVGElement` — a
single large candle, used by lessons.

### 6.6 `js/core/anim.js`

```js
export const reducedMotion = () => boolean
export function tween({ from, to, duration = 400, ease = easeOutCubic, onUpdate }) → Promise
export function sleep(ms) → Promise              // resolves immediately with reduced motion
export function sequence(steps) → { play(), stop(), done: Promise }   // steps: () => Promise
export const ease = { linear, easeOutCubic, easeInOutCubic, easeOutBack }
export function countUp(el, to, { duration, decimals, prefix, suffix })
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

- `npm test` → `node --test tests/unit/` (core modules must not touch the DOM at import time).
- `npm run smoke` → `node tests/smoke.mjs`: starts a static server on a free port, opens
  every route (desktop 1280×800 and phone 390×844, light and dark), fails on any console
  error / page error / failed request, saves screenshots to `tests/screenshots/`
  (git-ignored). `node tests/smoke.mjs g.fib-sniper` checks a single route.
- Playwright is resolved from the local `node_modules` or, failing that, the global npm
  root. Chromium path: `PLAYWRIGHT_BROWSERS_PATH` or `/opt/pw-browsers/chromium`.
