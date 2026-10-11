# Contributing to The Trade School

Thanks for wanting to help. This project is a no-build-step, vanilla-JS static site, and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the contract every contribution codes
against — read it before your first change.

## Setup

```sh
npm install        # dev-only dependency: playwright (smoke test)
npm run serve      # static server → http://localhost:5173
```

Node 22 or newer is required (the unit-test loader relies on Node 22's
`node --test` glob behaviour).

## Commands

| Command | What it does |
|---|---|
| `npm test` | Core-module unit tests (no DOM, no browser) |
| `npm run smoke` | Opens every route in Chromium at 3 viewports × 2 themes; fails on console errors, page errors, failed requests or horizontal scroll |
| `npm run test:all` | Both of the above |
| `npm run lint` | ESLint over the site JS |
| `npm run test:functions` | Deno test suites for the Supabase edge functions (needs [Deno](https://deno.com)) |

## Ground rules

- **No build step, no framework, no runtime dependency.** If a change needs a bundler or an
  npm package at runtime, it needs a discussion first.
- **Content lives in `js/lessons/` and `js/games/`.** Each module lazy-loads and default-exports
  `{ id, mount(root, ctx) → cleanup }`, building on the shared `LessonShell` / `GameShell`.
  Start from an existing module and keep its shape; `docs/ARCHITECTURE.md` §12.10 has the
  per-module recipe (difficulty mapping, real rounds, ChartStory frames, cleanup rules).
- **Core engine changes (`js/core/`) need tests.** Add or extend a file in `tests/unit/` —
  pure logic only, no DOM.
- **A11y and the no-JS path are features.** Keep the skip link, labelled controls and the
  `noscript` fallback working.
- **Green before you push.** `npm run test:all` must pass; CI runs the same.

## Reporting bugs

Open an issue with the route (e.g. `#g/fib-sniper`), browser, viewport and what you expected.
Screenshots from `tests/screenshots/` are welcome context.
