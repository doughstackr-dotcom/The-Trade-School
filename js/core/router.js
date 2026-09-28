// Hash router. Routes are plain tokens: #home, #library(.<id>),
// #dashboard (#progress aliases here; #beginner / #advanced redirect here with section),
// #glossary, #platforms (#affiliate aliases here), #playbook(.<setupId>), #games, #live,
// #l.<lessonId>, #g.<gameId>, #dev-chart.
// Modules are lazy-loaded with import() and follow the { mount(root, ctx) → cleanup } contract.
import * as registry from '../registry.js';
import { h, icon } from './ui.js';

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
  'dev-chart': '../pages/dev-chart.js',
};

const SITE = 'The Trade School';

let outlet = null;
let storeRef = null;
let onRouteCb = null;
let current = null;
let cleanup = null;
let renderToken = 0;
let fallbackHash = null; // used when writing location.hash is blocked
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
  // Legacy track hashes → unified Dashboard hub (scroll to section on mount).
  if (token === 'beginner' || token === 'advanced') {
    return { key: token, kind: 'page', page: 'dashboard', section: token };
  }
  if (token === 'library' || token.startsWith('library.')) {
    return { key: token, kind: 'page', page: 'library', param: token.slice('library.'.length) || null };
  }
  if (token === 'playbook' || token.startsWith('playbook.')) {
    return { key: token, kind: 'page', page: 'playbook', param: token.slice('playbook.'.length) || null };
  }
  // #progress is an alias of #dashboard (merged progress + curriculum page).
  if (token === 'progress') return { key: 'progress', kind: 'page', page: 'dashboard' };
  // #affiliate is an alias of #platforms (renamed partners page).
  if (token === 'affiliate') return { key: 'affiliate', kind: 'page', page: 'platforms' };
  // Older accounts hashes (Stripe cancel_url #pricing, GameShell upgrade / sign-in links) alias Unlock and Account.
  if (token === 'pricing' || token.startsWith('pricing.')) return { key: token, kind: 'page', page: 'paywall' };
  if (token === 'signin' || token === 'signup') return { key: token, kind: 'page', page: 'account', param: token === 'signup' ? 'signup' : null };
  // Supabase Auth redirect fragments (#error=…, #access_token=…) open Account instead of echoing on the 404 card.
  if (/(^|&)(access_token|error|error_code|error_description)=/.test(token)) return { key: 'account', kind: 'page', page: 'account' };
  if (token === 'account' || token.startsWith('account.')) {
    return { key: token, kind: 'page', page: 'account', param: token.slice('account.'.length) || null };
  }
  if (token === 'glossary' || token === 'platforms' || token === 'live' || token === 'games' || token === 'dashboard' || token === 'paywall' || token === 'dev-chart') return { key: token, kind: 'page', page: token };
  if (token.startsWith('l.')) return { key: token, kind: 'lesson', id: token.slice(2) };
  if (token.startsWith('g.')) return { key: token, kind: 'game', id: token.slice(2) };
  return { key: token, kind: 'notfound' };
}

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
    case 'dev-chart': return `Chart kitchen sink · ${SITE}`;
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
    path = PAGE_PATHS[route.page]
      ? new URL(PAGE_PATHS[route.page], import.meta.url).href
      : null;
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
      // Games always back out to the Games hub: if we are opening a game from
      // somewhere else (Beginner track, home arcade, etc.), rewrite the current
      // history entry to #games first so browser Back lands on Games, not the entry page.
      if (token.startsWith('g.')) {
        const cur = (location.hash || '#home').replace(/^#/, '') || 'home';
        if (cur !== 'games' && !cur.startsWith('g.')) {
          try { history.replaceState(null, '', '#games'); } catch { /* ignore */ }
        }
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
