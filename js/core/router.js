// Hash router. Routes are plain tokens: #home, #beginner, #advanced, #library(.<id>),
// #progress, #glossary, #playbook(.<setupId>), #live, #l.<lessonId>, #g.<gameId>, #dev-chart,
// and the account pages #pricing(.<plan>), #account, #signin, #signup, #reset, #reset.update,
// #terms, #privacy.
// Modules are lazy-loaded with import() and follow the { mount(root, ctx) → cleanup } contract.
import * as registry from '../registry.js';
import { h, icon } from './ui.js';

const PAGE_PATHS = {
  home: '../pages/home.js',
  track: '../pages/track.js',
  library: '../pages/library.js',
  progress: '../pages/progress.js',
  glossary: '../pages/glossary.js',
  playbook: '../pages/playbook.js',
  live: '../pages/live.js',
  'dev-chart': '../pages/dev-chart.js',
  // accounts (§9)
  pricing: '../pages/pricing.js',
  account: '../pages/account.js',
  auth: '../pages/auth.js',        // #signin #signup #reset #reset.update
  legal: '../pages/legal.js',      // #terms #privacy
};

const AUTH_ROUTES = ['signin', 'signup', 'reset', 'reset.update'];

const SITE = 'The Trade School';

let outlet = null;
let storeRef = null;
let onRouteCb = null;
let current = null;
let cleanup = null;
let renderToken = 0;
let fallbackHash = null; // used when writing location.hash is blocked
let started = false;
let currentBlocked = false;
let currentEntry = null;

// Optional access gate (ARCHITECTURE §9.3). Inert until something registers one, so the
// router has no dependency on the accounts modules.
const OPEN_ACCESS = Object.freeze({ level: null, can: () => true });
let gate = null;

/**
 * Registers the access gate: { canOpen(entry, route) → boolean | Promise<boolean> (asked for
 * every lesson, game and page route; public pages answer true), access: { level, can(plan), … }
 * | () => that (→ ctx.access), paywallPath?: URL string of the page module to mount instead of a
 * blocked route (default '../pages/paywall.js'), loadModule?(entry, route, url) → Promise<module>
 * | null (loads a paid lesson/game itself, e.g. from premium storage; null → import(url)) }.
 * Pass null to remove it. Re-renders the current route.
 */
export function setAccessGate(next) {
  gate = next || null;
  if (outlet && started) render(currentHash());
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

/** Parses a hash (with or without '#') into a route descriptor. */
export function parseHash(hash) {
  let token = String(hash || '').replace(/^#/, '');
  try {
    token = decodeURIComponent(token);
  } catch {
    /* keep raw */
  }
  token = token.trim();
  if (!token || token === 'home') return { key: 'home', kind: 'page', page: 'home' };
  if (token === 'beginner' || token === 'advanced') return { key: token, kind: 'page', page: 'track', tier: token };
  if (token === 'library' || token.startsWith('library.')) {
    return { key: token, kind: 'page', page: 'library', param: token.slice('library.'.length) || null };
  }
  if (token === 'playbook' || token.startsWith('playbook.')) {
    return { key: token, kind: 'page', page: 'playbook', param: token.slice('playbook.'.length) || null };
  }
  if (token === 'progress' || token === 'glossary' || token === 'live' || token === 'dev-chart') return { key: token, kind: 'page', page: token };
  if (token === 'pricing' || token.startsWith('pricing.')) {
    return { key: token, kind: 'page', page: 'pricing', param: token.slice('pricing.'.length) || null };
  }
  if (token === 'account') return { key: token, kind: 'page', page: 'account' };
  if (AUTH_ROUTES.includes(token)) return { key: token, kind: 'page', page: 'auth', param: token };
  if (token === 'terms' || token === 'privacy') return { key: token, kind: 'page', page: 'legal', param: token };
  if (token.startsWith('l.')) return { key: token, kind: 'lesson', id: token.slice(2) };
  if (token.startsWith('g.')) return { key: token, kind: 'game', id: token.slice(2) };
  return { key: token, kind: 'notfound' };
}

function titleFor(route, entry) {
  if (route.kind === 'lesson' || route.kind === 'game') return entry ? `${entry.title} · ${SITE}` : SITE;
  switch (route.page) {
    case 'home': return `${SITE} — Learn to read the market`;
    case 'track': return `${entry ? entry.title : 'Track'} · ${SITE}`;
    case 'library': return `Pattern Library · ${SITE}`;
    case 'progress': return `Your progress · ${SITE}`;
    case 'glossary': return `Glossary · ${SITE}`;
    case 'playbook': return `Setup Playbook · ${SITE}`;
    case 'live': return `Live Market Lab · ${SITE}`;
    case 'dev-chart': return `Chart kitchen sink · ${SITE}`;
    case 'pricing': return `Plans & pricing · ${SITE}`;
    case 'account': return `Your account · ${SITE}`;
    case 'auth': return `${{ signin: 'Sign in', signup: 'Create your free account', reset: 'Reset your password', 'reset.update': 'Choose a new password' }[route.param] || 'Account'} · ${SITE}`;
    case 'legal': return `${route.param === 'privacy' ? 'Privacy policy' : 'Terms of service'} · ${SITE}`;
    default: return `Not found · ${SITE}`;
  }
}

function currentHash() {
  if (fallbackHash != null) return fallbackHash;
  try {
    return location.hash;
  } catch {
    return '';
  }
}

function newSeed() {
  return (Math.floor(Math.random() * 4294967296) >>> 0) || 1;
}

function backTarget(route, entry) {
  if (entry && (entry.tier === 'beginner' || entry.tier === 'advanced')) return entry.tier;
  if (entry && entry.tier === 'both') return storeRef?.state?.lastTier || 'beginner';
  if (route.tier) return route.tier;
  return 'home';
}

function errorCard(route, entry, err, retry) {
  const back = backTarget(route, entry);
  const backLabel = back === 'home' ? 'Back to home' : `Back to ${back === 'advanced' ? 'Advanced' : 'Beginner'} track`;
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
        h('button', { type: 'button', class: 'btn', on: { click: () => navigate('beginner') } }, 'Beginner track'))));
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

async function render(hash, { initial = false, retry = false } = {}) {
  if (!outlet) return;
  const route = parseHash(hash);
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
    path = new URL(PAGE_PATHS[route.page], import.meta.url).href;
    if (route.page === 'track') entry = registry.findTier(route.tier);
  }

  document.title = titleFor(route, entry);
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

  // Blocked by the access gate → mount the paywall page instead (entry stays the requested one).
  // Every lesson, game and page is asked; the gate answers true straight away for public pages.
  let blocked = false;
  if (gate && (route.kind === 'lesson' || route.kind === 'game' || route.kind === 'page')) {
    try {
      blocked = !(await gate.canOpen(entry, route));
    } catch (err) {
      console.error('[router] access check failed:', err);
    }
    if (my !== renderToken) return;
    if (blocked) path = new URL(gate.paywallPath || '../pages/paywall.js', import.meta.url).href;
  }
  currentBlocked = blocked;
  currentEntry = entry;

  if (!blocked && entry && (route.kind === 'lesson' || route.kind === 'game')) {
    storeRef?.setLast?.({ type: route.kind, id: entry.id });
  }

  const loadingTimer = setTimeout(() => {
    if (my === renderToken && !root.childElementCount) root.append(skeleton());
  }, 180);

  try {
    // "Try again" re-fetches the page module itself (a failed or broken import is cached by URL);
    // shared core modules keep their URLs, so they stay single instances.
    // The gate may load paid modules itself (PREMIUM_SOURCE 'storage', §9.3); null → import().
    let mod = null;
    if (!blocked && gate?.loadModule && entry && (route.kind === 'lesson' || route.kind === 'game')) {
      mod = await gate.loadModule(entry, route, path);
      if (my !== renderToken) return;
    }
    if (!mod) mod = await import(retry ? `${path}?retry=${++retries}` : path);
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
    root.setAttribute('data-mounted', route.key);
    if (!initial) {
      const main = document.getElementById('main');
      main?.focus({ preventScroll: true });
    }
  } catch (err) {
    clearTimeout(loadingTimer);
    if (my !== renderToken) return;
    console.error(`[router] Failed to load route "${route.key}":`, err);
    root.replaceChildren(errorCard(route, entry, err, () => render(currentHash(), { retry: true })));
    root.setAttribute('data-mounted', route.key);
    root.setAttribute('data-route-error', '1');
  }
}

/** Navigate to a hash token, e.g. navigate('g.fib-sniper'). Works even if location.hash is read-only. */
export function navigate(hash) {
  const token = String(hash || '').replace(/^#/, '') || 'home';
  const target = `#${token}`;
  let ok = false;
  if (fallbackHash == null) {
    try {
      if (location.hash === target) {
        render(target);
        return;
      }
      location.hash = target;
      ok = location.hash === target;
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    fallbackHash = target;
    render(target);
  }
}

export function currentRoute() {
  return current;
}

/** { route, entry, blocked } of the page on screen (blocked: the paywall stands in for it). */
export function currentState() {
  return { route: current, entry: currentEntry, blocked: currentBlocked };
}

/** Re-renders the current route (e.g. after the member's plan changed). */
export function refresh() {
  if (outlet && started) render(currentHash());
}

function onLinkClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target?.closest?.('a[href^="#"]');
  if (!a || a.target === '_blank' || a.hasAttribute('data-no-route')) return;
  const href = a.getAttribute('href');
  if (!href || href === '#') return;
  e.preventDefault();
  navigate(href.slice(1));
}

/** Boots the router into `el`. onRoute(route, entry) runs before each page mounts. */
export function startRouter(el, { store, onRoute } = {}) {
  outlet = el;
  storeRef = store;
  onRouteCb = onRoute || null;
  if (started) return;
  started = true;
  window.addEventListener('hashchange', () => {
    fallbackHash = null;
    render(currentHash());
  });
  document.addEventListener('click', onLinkClick);
  render(currentHash(), { initial: true });
}
