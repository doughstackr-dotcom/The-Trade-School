// History API router. URLs are clean paths (/, /dashboard, /games, /games/<gameId>,
// /lessons/<lessonId>, /library(/<id>), /playbook(/<setupId>), /glossary, /platforms, /live,
// /account(/signup), /privacy, /terms, /refunds; /dev-chart on localhost only). Internally a route
// is a short token ('dashboard', 'g.fib-sniper', 'l.fibonacci' …, the old hash routes); see
// ./routes.js for the token <-> path mapping. Old hash URLs (#l.fibonacci) are rewritten to paths.
// Modules are lazy-loaded with import() and follow the { mount(root, ctx) → cleanup } contract.
import * as registry from '../registry.js';
import { h, icon } from './ui.js';
import {
  parseToken, tokenToPath, pathToToken, legacyHashToken, canonicalPath, SITE_ORIGIN,
} from './routes.js';

const PAGE_PATHS = {
  home: '../pages/home.js',
  library: '../pages/library.js',
  // progress aliases to the merged dashboard (Progress visual shell + track panels).
  progress: '../pages/progress.js',
  glossary: '../pages/glossary.js',
  platforms: '../pages/affiliate.js',
  playbook: '../pages/playbook.js',
  live: '../pages/live.js',
  games: '../pages/games.js',
  dashboard: '../pages/progress.js',
  account: '../pages/account.js',
  paywall: '../pages/paywall.js',
  privacy: '../pages/legal.js',
  terms: '../pages/legal.js',
  refunds: '../pages/legal.js',
  'dev-chart': '../pages/dev-chart.js',
};

const SITE = 'The Trade School';

// Dev-only routes (/dev-chart, DEV_ENTRIES such as /lessons/_kit-demo) open on localhost only,
// and never from a production build (scripts/build.mjs defines globalThis.__TTS_DIST__ and
// leaves the dev modules out of dist/).
function devRoutesEnabled() {
  if (globalThis.__TTS_DIST__) return false;
  try {
    const n = location.hostname;
    return n === 'localhost' || n === '127.0.0.1' || n === '::1' || n === '[::1]';
  } catch {
    return false;
  }
}

const PAGE_DESCRIPTIONS = {
  library: 'Visual pattern library: every candlestick and chart pattern with an annotated example, what it means and how to trade it.',
  glossary: 'Plain-English trading glossary: candlesticks, support and resistance, indicators, orders and risk terms, each linked to its lesson.',
  platforms: 'Trading platforms and tools we partner with, with clear affiliate disclosures.',
  playbook: 'Rule-based trading setups with a checklist, entry, stop and target, animated walk-throughs and real examples.',
  live: 'Live Market Lab: a live chart with indicator toggles and a plain-English read of trend, levels and patterns.',
  games: 'Trading games: practise reading charts in practice, arcade and survival modes. One free daily challenge.',
  dashboard: 'Your dashboard: Beginner and Advanced tracks, progress, XP, badges and what to learn next.',
  account: 'Sign in or create a free account at The Trade School.',
  paywall: 'Plans and pricing for The Trade School.',
  privacy: 'Privacy Policy of The Trade School.',
  terms: 'Terms of Service of The Trade School.',
  refunds: 'Refund & Cancellation Policy of The Trade School.',
};
let defaultDescription = null;

/** Sets <link rel=canonical>, og:url, the meta description and robots for a route. */
function setHeadMeta(route, entry) {
  try {
    const head = document.head;
    const find = (sel, tag, attrs) => {
      let el = head.querySelector(sel);
      if (!el && tag) {
        el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        head.appendChild(el);
      }
      return el;
    };
    const desc = find('meta[name="description"]', 'meta', { name: 'description' });
    if (defaultDescription == null) defaultDescription = desc.getAttribute('content') || '';
    const text = (route.kind === 'lesson' || route.kind === 'game')
      ? entry?.blurb
      : route.kind === 'page' ? PAGE_DESCRIPTIONS[route.page] : null;
    desc.setAttribute('content', text || defaultDescription);

    const path = canonicalPath(route);
    const url = `${SITE_ORIGIN}${path || '/'}`;
    find('link[rel="canonical"]', 'link', { rel: 'canonical' }).setAttribute('href', url);
    find('meta[property="og:url"]')?.setAttribute('content', url);

    // Keep search engines on real content: not-found, account and paywall pages are noindex.
    const noindex = !path || (route.kind === 'page' && (route.page === 'account' || route.page === 'paywall'));
    const robots = noindex ? find('meta[name="robots"]', 'meta', { name: 'robots' }) : find('meta[name="robots"]');
    if (robots && noindex) robots.setAttribute('content', 'noindex');
    else robots?.remove();
  } catch {
    /* head metadata is best-effort */
  }
}

/** True for a failed dynamic import() (network error / missing file, e.g. after a redeploy). */
function isChunkLoadError(err) {
  const msg = String(err?.message || err || '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg);
}

const RELOAD_KEY = 'tts-chunk-reload';

/**
 * Stale deploy: an open page asked for a module file the new deploy no longer has. Reload once
 * to pick up the new index.html; the sessionStorage flag stops a reload loop (no storage → no
 * reload). Returns true when a reload was started.
 */
function reloadOnceForStaleChunk() {
  try {
    const ss = globalThis.sessionStorage;
    if (!ss || ss.getItem(RELOAD_KEY)) return false;
    ss.setItem(RELOAD_KEY, String(Date.now()));
    location.reload();
    return true;
  } catch {
    return false;
  }
}

function clearReloadFlag() {
  try {
    globalThis.sessionStorage?.removeItem(RELOAD_KEY);
  } catch {
    /* ignore */
  }
}

let outlet = null;
let storeRef = null;
let onRouteCb = null;
let current = null;
let cleanup = null;
let renderToken = 0;
let fallbackToken = null; // used when the History API is blocked (e.g. sandboxed frames)
let started = false;

// Optional access gate (ARCHITECTURE §9.3). Inert until something registers one, so the
// router has no dependency on the accounts modules.
const OPEN_ACCESS = Object.freeze({ level: null, can: () => true });
let gate = null;

/**
 * Registers the access gate: { canOpen(entry, route) → boolean | Promise<boolean>,
 * access: { level, can(plan), user? } | () => that,
 * paywallPath?: URL string of the page module to mount for signed-in users who lack the plan
 * (default '../pages/paywall.js'),
 * onUnauthenticated?(route, entry)?: called when an unsigned visitor hits a gated route —
 * typically store a return hash and navigate to account sign-up }.
 * Pass null to remove it. Re-renders the current route.
 */
export function setAccessGate(next) {
  gate = next || null;
  // A gate swap re-renders the same route in place (e.g. once the session is known): keep
  // focus where it is, like the initial render, so the skip link stays the first Tab stop.
  if (outlet && started) render(currentToken(), { initial: true });
}

function accessInfo() {
  if (!gate) return OPEN_ACCESS;
  try {
    const a = typeof gate.access === 'function' ? gate.access() : gate.access;
    return a || OPEN_ACCESS;
  } catch {
    return OPEN_ACCESS;
  }
}

/** Parses a route token (or an old '#token' hash) into a route descriptor. */
export const parseHash = parseToken;

function titleFor(route, entry) {
  if (route.kind === 'lesson' || route.kind === 'game') return entry ? `${entry.title} · ${SITE}` : SITE;
  switch (route.page) {
    case 'home': return `${SITE} — Learn to read the market`;
    case 'library': return `Pattern Library · ${SITE}`;
    case 'glossary': return `Glossary · ${SITE}`;
    case 'platforms': return `Platforms · ${SITE}`;
    case 'playbook': return `Setup Playbook · ${SITE}`;
    case 'live': return `Live Market Lab · ${SITE}`;
    case 'games': return `Games · ${SITE}`;
    case 'dashboard': return `Dashboard · ${SITE}`;
    case 'account': return `Account · ${SITE}`;
    case 'paywall': return `Unlock · ${SITE}`;
    case 'privacy': return `Privacy Policy · ${SITE}`;
    case 'terms': return `Terms of Service · ${SITE}`;
    case 'refunds': return `Refund & Cancellation Policy · ${SITE}`;
    case 'dev-chart': return `Chart kitchen sink · ${SITE}`;
    default: return `Not found · ${SITE}`;
  }
}

function currentToken() {
  if (fallbackToken != null) return fallbackToken;
  try {
    return pathToToken(location.pathname);
  } catch {
    return 'home';
  }
}

function newSeed() {
  return (Math.floor(Math.random() * 4294967296) >>> 0) || 1;
}

function backTarget(route, entry) {
  if (entry && (entry.tier === 'beginner' || entry.tier === 'advanced' || entry.tier === 'both')) {
    return 'dashboard';
  }
  if (route.section === 'beginner' || route.section === 'advanced') return 'dashboard';
  if (route.tier) return 'dashboard';
  return 'home';
}

function errorCard(route, entry, err, retry) {
  const back = backTarget(route, entry);
  const backLabel = back === 'home' ? 'Back to home' : 'Back to Dashboard';
  return h('div', { class: 'container' },
    h('div', { class: 'route-error card', role: 'alert' },
      h('div', { class: 'route-error__icon', 'aria-hidden': 'true' }, icon('info', { size: 28 })),
      h('h1', { class: 'route-error__title' }, 'This page hit a snag'),
      h('p', { class: 'muted' }, 'Something went wrong while loading it. Your progress is safe. Try again, or head back and pick something else.'),
      err ? h('p', { class: 'route-error__detail mono' }, String(err && err.message ? err.message : err)) : null,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn--primary', on: { click: () => navigate(back) } }, icon('arrow-left'), backLabel),
        h('button', { type: 'button', class: 'btn', on: { click: retry } }, icon('restart'), 'Try again'))));
}

function notFoundCard(route) {
  return h('div', { class: 'container' },
    h('div', { class: 'route-error card' },
      h('p', { class: 'eyebrow' }, '404 · no candles here'),
      h('h1', { class: 'route-error__title' }, 'That page is off the chart'),
      h('p', { class: 'muted' }, `We couldn't find “${route.key}”. It may have moved.`),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn--primary', on: { click: () => navigate('home') } }, icon('home'), 'Go home'),
        h('button', { type: 'button', class: 'btn', on: { click: () => navigate('dashboard') } }, 'Dashboard'))));
}

function skeleton() {
  return h('div', { class: 'container route-loading', 'aria-busy': 'true', 'aria-label': 'Loading' },
    h('div', { class: 'skeleton skeleton--title' }),
    h('div', { class: 'skeleton skeleton--line' }),
    h('div', { class: 'skeleton skeleton--block' }));
}

function runCleanup() {
  if (!cleanup) return;
  const fn = cleanup;
  cleanup = null;
  try {
    fn();
  } catch (err) {
    console.error('[router] cleanup failed:', err);
  }
}

let retries = 0;

async function render(token, { initial = false, retry = false } = {}) {
  if (!outlet) return;
  let route = parseToken(token);
  const devOnly = (route.kind === 'page' && route.page === 'dev-chart') || !!(route.id && registry.findEntry(route.id)?.dev);
  if (devOnly && !devRoutesEnabled()) route = { key: route.key, kind: 'notfound' };
  const my = ++renderToken;
  runCleanup();
  current = route;

  const root = h('div', { class: `route route--${route.kind === 'page' ? route.page : route.kind}`, 'data-route': route.key });
  outlet.replaceChildren(root);
  try {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  } catch {
    window.scrollTo(0, 0);
  }

  let entry = null;
  let path = null;
  if (route.kind === 'lesson' || route.kind === 'game') {
    entry = registry.findEntry(route.id);
    if (entry && entry.type === route.kind) {
      path = new URL('../' + entry.path.replace(/^\.\//, ''), import.meta.url).href;
    } else entry = null;
  } else if (route.kind === 'page') {
    path = PAGE_PATHS[route.page]
      ? new URL(PAGE_PATHS[route.page], import.meta.url).href
      : null;
  }

  document.title = titleFor(route, entry);
  setHeadMeta(route, entry);
  try {
    onRouteCb?.(route, entry);
  } catch (err) {
    console.error(err);
  }

  if (!path) {
    root.append(notFoundCard(route));
    root.setAttribute('data-mounted', route.key);
    return;
  }

  // Access gate: paid lessons/games show the paywall teaser (visible to unsigned + unpaid).
  // Optional gate.onUnauthenticated may still redirect, but the default shell leaves the
  // paywall mounted so teasers are never hidden behind a hard login wall.
  let blocked = false;
  if (gate) {
    try {
      blocked = !(await gate.canOpen(entry, route));
    } catch (err) {
      console.error('[router] access check failed:', err);
    }
    if (my !== renderToken) return;
    if (blocked) {
      const a = accessInfo();
      const signedIn = !!(a && a.user);
      if (!signedIn && typeof gate.onUnauthenticated === 'function') {
        try { gate.onUnauthenticated(route, entry); } catch (err) { console.error(err); }
        return;
      }
      path = new URL(gate.paywallPath || '../pages/paywall.js', import.meta.url).href;
    }
  }

  if (!blocked && entry && (route.kind === 'lesson' || route.kind === 'game')) {
    storeRef?.setLast?.({ type: route.kind, id: entry.id });
  }

  const loadingTimer = setTimeout(() => {
    if (my === renderToken && !root.childElementCount) root.append(skeleton());
  }, 180);

  try {
    // "Try again" re-fetches the page module itself (a failed or broken import is cached by URL);
    // shared core modules keep their URLs, so they stay single instances.
    const mod = await import(retry ? `${path}?retry=${++retries}` : path);
    if (my !== renderToken) return;
    const def = mod.default;
    if (!def || typeof def.mount !== 'function') throw new Error(`Module for "${route.key}" has no default export with mount().`);
    clearTimeout(loadingTimer);
    root.replaceChildren();
    const ctx = {
      store: storeRef,
      navigate,
      entry,
      registry,
      seed: newSeed(),
      route,
      param: route.param ?? null,
      access: accessInfo(),
      blocked,
    };
    let result = def.mount(root, ctx);
    if (result && typeof result.then === 'function') result = await result;
    if (my !== renderToken) {
      if (typeof result === 'function') {
        try {
          result();
        } catch (err) {
          console.error(err);
        }
      }
      return;
    }
    cleanup = typeof result === 'function' ? result : null;
    clearReloadFlag();
    root.setAttribute('data-mounted', route.key);
    if (!initial) {
      const main = document.getElementById('main');
      main?.focus({ preventScroll: true });
    }
  } catch (err) {
    clearTimeout(loadingTimer);
    if (my !== renderToken) return;
    if (!retry && isChunkLoadError(err) && reloadOnceForStaleChunk()) return;
    console.error(`[router] Failed to load route "${route.key}":`, err);
    root.replaceChildren(errorCard(route, entry, err, () => render(currentToken(), { retry: true })));
    root.setAttribute('data-mounted', route.key);
    root.setAttribute('data-route-error', '1');
  }
}

/** Route token for a navigate() target: a token ('g.fib-sniper'), an old hash ('#dashboard') or a path ('/games'). */
function toToken(target) {
  const t = String(target || '').trim();
  if (t.startsWith('/')) return pathToToken(t.split(/[?#]/)[0]);
  return t.replace(/^#/, '') || 'home';
}

function setUrl(url, replace = false) {
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
}

/**
 * Navigate to a route: navigate('g.fib-sniper'), navigate('/games/fib-sniper') or an old
 * '#g.fib-sniper'. Navigating to the current route re-renders it. Works even if the History
 * API is blocked.
 */
export function navigate(target) {
  const token = toToken(target);
  const path = tokenToPath(token);
  if (fallbackToken == null) {
    try {
      if (location.pathname === path) {
        if (location.hash) setUrl(path + location.search, true);
        render(token);
        return;
      }
      // Games always back out to the Games hub: if we are opening a game from
      // somewhere else (Beginner track, home arcade, etc.), rewrite the current
      // history entry to /games first so browser Back lands on Games, not the entry page.
      if (token.startsWith('g.')) {
        const cur = currentToken();
        if (cur !== 'games' && !cur.startsWith('g.')) {
          try { setUrl('/games', true); } catch { /* ignore */ }
        }
      }
      setUrl(path);
      render(token);
      return;
    } catch {
      /* History API blocked: fall through */
    }
  }
  fallbackToken = token;
  render(token);
}

export function currentRoute() {
  return current;
}

/** Same-origin page link → router navigation. In-page anchors (#main, #pricing) and files are left alone. */
function onLinkClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target?.closest?.('a[href]');
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download') || a.hasAttribute('data-no-route')) return;
  const href = a.getAttribute('href');
  if (!href || href === '#') return;
  if (href.startsWith('#')) {
    // An old-style route link (#dashboard) is still routed; other fragments scroll as usual.
    const legacy = legacyHashToken(href);
    if (!legacy) return;
    e.preventDefault();
    navigate(legacy);
    return;
  }
  let url;
  try {
    url = new URL(a.href, location.href);
  } catch {
    return;
  }
  if (url.origin !== location.origin) return;
  if (/\.[a-z0-9]+$/i.test(url.pathname)) return; // a real file (/og-image.png, /sitemap.xml)
  if (url.hash && url.pathname === location.pathname) return; // fragment on this page
  e.preventDefault();
  navigate(url.pathname);
}

/** Rewrites an old hash URL (#l.fibonacci) to its path; true when it did. */
function upgradeLegacyHash() {
  let token = null;
  try {
    token = legacyHashToken(location.hash);
  } catch {
    return false;
  }
  if (!token) return false;
  try {
    setUrl(tokenToPath(token) + location.search, true);
  } catch {
    fallbackToken = token;
  }
  return true;
}

function onUrlChange() {
  if (upgradeLegacyHash()) {
    render(currentToken());
    return;
  }
  fallbackToken = null;
  const token = currentToken();
  // A fragment jump on the same page (#pricing) fires popstate / hashchange too: no remount.
  if (current && parseToken(token).key === current.key) return;
  render(token);
}

/** Boots the router into `el`. onRoute(route, entry) runs before each page mounts. */
export function startRouter(el, { store, onRoute } = {}) {
  outlet = el;
  storeRef = store;
  onRouteCb = onRoute || null;
  if (started) return;
  started = true;
  upgradeLegacyHash();
  window.addEventListener('popstate', onUrlChange);
  window.addEventListener('hashchange', onUrlChange);
  document.addEventListener('click', onLinkClick);
  render(currentToken(), { initial: true });
}
