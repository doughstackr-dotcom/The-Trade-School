// Boot: render the app shell (top bar, phone tab bar, footer) and start the router.
import { store } from './core/store.js';
import { startRouter, navigate, setAccessGate } from './core/router.js';
import * as access from './core/access.js';
import { h, svg, icon, sfx } from './core/ui.js';
import { findEntry } from './registry.js';
import { tokenToPath } from './core/routes.js';

// tab: false keeps an item out of the phone tab bar (it stays in the top nav and the footer);
// wide: shown as its own top-nav link from 1500px; from 960–1499px it moves into the "More"
// menu so the full wordmark always fits; below 960px it lives in the footer only.
const NAV = [
  { hash: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { hash: 'games', label: 'Games', icon: 'gamepad' },
  { hash: 'playbook', label: 'Playbook', icon: 'flag' },
  { hash: 'live', label: 'Live', icon: 'bolt', live: true },
  { hash: 'library', label: 'Library', icon: 'layers' },
  { hash: 'glossary', label: 'Glossary', icon: 'book', tab: false, wide: true },
  { hash: 'platforms', label: 'Platforms', icon: 'spark', tab: false, wide: true },
];

/** Small pulsing dot marking the Live Market Lab link. */
function liveDot() {
  return h('span', { class: 'live-dot', 'aria-hidden': 'true' });
}

const THEMES = ['system', 'light', 'dark'];
const THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' };
const THEME_ICON = { system: 'system', light: 'sun', dark: 'moon' };

/** Brand mark: a hollow bear candle and a filled bull candle (theme accent). */
export function brandMark(size = 28) {
  return svg('svg', { class: 'brand__mark', width: size, height: size, viewBox: '0 0 28 28', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { class: 'brand__wick brand__wick--bear', d: 'M9 4v5M9 21v3' }),
    svg('rect', { class: 'brand__body brand__body--bear', x: 5.5, y: 9, width: 7, height: 12, rx: 1.6 }),
    svg('path', { class: 'brand__wick brand__wick--bull', d: 'M19 2.5v4.5M19 19v5' }),
    svg('rect', { class: 'brand__body brand__body--bull', x: 15.5, y: 7, width: 7, height: 12, rx: 1.6 }));
}

function effectiveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(pref) {
  const root = document.documentElement;
  if (pref === 'light' || pref === 'dark') root.setAttribute('data-theme', pref);
  else root.removeAttribute('data-theme');
  const color = effectiveTheme(pref) === 'dark' ? '#0B1220' : '#F3F5F9';
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color));
}

function navKeyFor(route) {
  if (!route) return null;
  if (route.kind === 'page') {
    // Legacy /beginner and /advanced land on dashboard with a section.
    if (route.page === 'dashboard' || route.page === 'progress') return 'dashboard';
    if (['library', 'glossary', 'playbook', 'live', 'games', 'account', 'platforms'].includes(route.page)) return route.page;
    return null;
  }
  if (route.kind === 'game') return 'games';
  // Lessons highlight Dashboard (track nav entries removed).
  if (route.kind === 'lesson') return 'dashboard';
  return null;
}


const RISK_DISCLAIMER =
  'This is not financial advice. The Trade School is educational material only. Trade at your own risk.';

/** Site-wide risk disclaimer (marquee). Sticky at the top of the viewport above the top nav. */
function riskTicker() {
  // Even count: first half === second half so translateX(-50%) loops seamlessly.
  // Enough copies to cover wide viewports without a visible gap.
  const COPIES = 8;
  const segments = Array.from({ length: COPIES }, (_, i) =>
    h('p', {
      class: 'risk-ticker__text',
      ...(i === 0 ? {} : { 'aria-hidden': 'true' }),
    }, RISK_DISCLAIMER));
  // role="note" (not "alert"): the disclaimer is static, so screen readers should read it once
  // in page order rather than announce it assertively; the duplicate copies are aria-hidden.
  return h('aside', {
    class: 'risk-ticker',
    role: 'note',
    'aria-label': 'Risk and educational disclaimer',
  },
    h('div', { class: 'risk-ticker__track' }, ...segments));
}

function buildShell(app) {
  const navLinks = [];
  const tabLinks = [];

  const moreItems = NAV.filter((n) => n.wide);
  const moreLinks = moreItems.map((n) => {
    const a = h('a', { class: 'nav-more__link', href: tokenToPath(n.hash), 'data-nav': n.hash },
      icon(n.icon, { size: 16 }), h('span', null, n.label));
    navLinks.push(a);
    return a;
  });
  const moreSummary = h('summary', { class: 'nav__link nav-more__summary' },
    h('span', null, 'More'), icon('chevron-down', { size: 14 }));
  const more = moreItems.length
    ? h('details', { class: 'nav-more' },
      moreSummary,
      h('div', { class: 'nav-more__menu' }, moreLinks))
    : null;
  const closeMore = () => { if (more) more.open = false; };
  if (more) {
    more.addEventListener('click', (e) => { if (e.target.closest('a')) closeMore(); });
    more.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && more.open) {
        closeMore();
        moreSummary.focus();
      }
    });
    document.addEventListener('click', (e) => { if (more.open && !more.contains(e.target)) closeMore(); });
    more.addEventListener('focusout', (e) => { if (more.open && !more.contains(e.relatedTarget)) closeMore(); });
  }

  const topNav = h('nav', { class: 'nav', 'aria-label': 'Primary' },
    NAV.map((n) => {
      const a = h('a', { class: ['nav__link', n.wide && 'nav__link--wide', n.live && 'nav__link--live'], href: tokenToPath(n.hash), 'data-nav': n.hash },
        n.live ? liveDot() : null, h('span', null, n.label));
      navLinks.push(a);
      return a;
    }),
    more);

  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Primary', style: { '--tabs': NAV.filter((n) => n.tab !== false).length } },
    NAV.filter((n) => n.tab !== false).map((n) => {
      const a = h('a', { class: ['tabbar__link', n.live && 'tabbar__link--live'], href: tokenToPath(n.hash), 'data-nav': n.hash },
        h('span', { class: 'tabbar__icon' }, icon(n.icon, { size: 22 }), n.live ? liveDot() : null), h('span', null, n.label));
      tabLinks.push(a);
      return a;
    }));

  // XP pill
  const lvNum = h('span', { class: 'xp-pill__lv mono' });
  const lvTitle = h('span', { class: 'xp-pill__title' });
  const lvFill = h('span', { class: 'xp-pill__fill' });
  const xpPill = h('a', { class: 'xp-pill', href: '/dashboard' }, lvNum, lvTitle, h('span', { class: 'xp-pill__meter', 'aria-hidden': 'true' }, lvFill));

  function renderXP(bump = false) {
    const lv = store.level();
    lvNum.textContent = `Lv ${lv.number}`;
    lvTitle.textContent = lv.title;
    lvFill.style.width = `${Math.round(lv.progress * 100)}%`;
    const toNext = lv.next != null ? `, ${lv.next - lv.xp} XP to ${lv.nextTitle}` : '';
    xpPill.setAttribute('aria-label', `Level ${lv.number}, ${lv.title}. ${lv.xp} XP${toNext}. View dashboard.`);
    xpPill.title = `${lv.xp.toLocaleString()} XP${lv.next != null ? ` · ${(lv.next - lv.xp).toLocaleString()} to ${lv.nextTitle}` : ''}`;
    if (bump) {
      xpPill.classList.remove('is-bump');
      void xpPill.offsetWidth;
      xpPill.classList.add('is-bump');
    }
  }

  // Sound toggle
  const soundBtn = h('button', { type: 'button', class: 'icon-btn', on: { click: () => {
    store.setSetting('sound', !store.state.settings.sound);
    renderSound();
    sfx.click();
  } } });
  function renderSound() {
    const on = store.state.settings.sound !== false;
    soundBtn.replaceChildren(icon(on ? 'sound' : 'mute', { size: 20 }));
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.setAttribute('aria-label', on ? 'Sound effects on' : 'Sound effects off');
    soundBtn.title = on ? 'Sound on' : 'Sound off';
  }

  // Theme toggle: system → light → dark
  const themeBtn = h('button', { type: 'button', class: 'icon-btn', on: { click: () => {
    const cur = store.state.settings.theme || 'system';
    const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    store.setSetting('theme', next);
    applyTheme(next);
    renderTheme();
  } } });
  function renderTheme() {
    const cur = store.state.settings.theme || 'system';
    const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    themeBtn.replaceChildren(icon(THEME_ICON[cur], { size: 20 }));
    themeBtn.setAttribute('aria-label', `Theme: ${THEME_LABEL[cur]}. Switch to ${THEME_LABEL[next]}.`);
    themeBtn.title = `Theme: ${THEME_LABEL[cur]}`;
  }

  const main = h('main', { id: 'main', class: 'main', tabindex: '-1' });

  // Real link (works without JS semantics, shows in link lists). The click handler moves focus
  // to <main> without adding "#main" to the URL.
  const skip = h('a', {
    class: 'skip-link',
    href: '#main',
    'data-no-route': '',
    on: {
      click: (e) => {
        e.preventDefault();
        main.focus({ preventScroll: true });
        main.scrollIntoView({ block: 'start' });
      },
    },
  }, 'Skip to content');

  // Sign in / Sign up (or Account when signed in) — always visible in the header.
  const authBtn = h('a', {
    class: 'btn btn--ghost btn--sm topbar__auth',
    href: '/account',
    'data-auth': 'out',
  }, icon('lock', { size: 14 }), 'Sign in');

  function renderAuth() {
    const a = access.getAccess();
    if (a.user) {
      const label = (a.user.email && a.user.email.split('@')[0]) || 'Account';
      authBtn.setAttribute('href', '/account');
      authBtn.dataset.auth = 'in';
      authBtn.replaceChildren(icon('lock', { size: 14 }), label);
      authBtn.setAttribute('aria-label', `Account (${a.user.email || 'signed in'})`);
      authBtn.title = a.user.email || 'Account';
    } else {
      authBtn.setAttribute('href', '/account');
      authBtn.dataset.auth = 'out';
      authBtn.replaceChildren(icon('lock', { size: 14 }), 'Sign in');
      authBtn.setAttribute('aria-label', 'Sign in or sign up');
      authBtn.title = 'Sign in / Sign up';
    }
  }

  const header = h('header', { class: 'topbar' },
    h('div', { class: 'container topbar__inner' },
      h('a', { class: 'brand', href: '/', 'aria-label': 'The Trade School — home' },
        brandMark(28),
        // Two parts so phones can stack the full name on two lines instead of truncating it.
        h('span', { class: 'brand__word' },
          h('span', { class: 'brand__line' }, 'The Trade'), ' ',
          h('span', { class: 'brand__line' }, 'School'))),
      topNav,
      h('div', { class: 'topbar__tools' }, xpPill, authBtn, soundBtn, themeBtn)));

  const footer = h('footer', { class: 'footer' },
    h('div', { class: 'container footer__inner' },
      h('div', { class: 'footer__brand' },
        brandMark(22),
        h('p', null, h('strong', null, 'Educational simulations only — not financial advice.'), ' Textbook charts use generated prices; real-market charts name their data source.')),
      h('nav', { class: 'footer__links', 'aria-label': 'Footer' },
        h('a', { href: '/dashboard' }, 'Dashboard'),
        h('a', { href: '/games' }, 'Games'),
        h('a', { href: '/playbook' }, 'Playbook'),
        h('a', { href: '/live' }, 'Live Market Lab'),
        h('a', { href: '/library' }, 'Library'),
        h('a', { href: '/glossary' }, 'Glossary'),
        h('a', { href: '/platforms' }, 'Platforms'),
        h('a', { href: '/account' }, 'Account')),
      h('nav', { class: 'footer__legal', 'aria-label': 'Legal' },
        h('a', { href: '/privacy' }, 'Privacy'),
        h('a', { href: '/terms' }, 'Terms'),
        h('a', { href: '/refunds' }, 'Refunds'))));

  app.replaceChildren(skip, riskTicker(), header, main, footer, tabbar);
  app.classList.add('app');

  renderXP();
  renderSound();
  renderTheme();
  renderAuth();
  store.on('xp', () => renderXP(true));
  store.on('change', () => {
    renderXP();
    renderSound();
  });
  access.onChange(() => renderAuth());
  // Post-login return: when a visitor signs in after being sent to /account from a paywall
  // (access.rememberReturn), take them back to where they were headed.
  let wasSignedIn = !!access.getAccess().user;
  access.onChange((snap) => {
    const now = !!snap?.user;
    if (now && !wasSignedIn) {
      const ret = access.consumeReturn();
      if (ret) navigate(ret);
    }
    wasSignedIn = now;
  });
  access.ready.then(() => renderAuth()).catch(() => {});

  function setActive(route, entry) {
    const key = navKeyFor(route, entry);
    for (const a of [...navLinks, ...tabLinks]) {
      const on = a.dataset.nav === key;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    document.body.dataset.route = route.kind === 'page' ? route.page : route.kind;
    moreSummary.classList.toggle('is-active', moreItems.some((n) => n.hash === key));
    closeMore();
  }

  return { main, setActive };
}

// ------------------------------------------------------------------ analytics
// Vercel Web Analytics (cookieless). Injected only on real hosts so local dev and tests do not
// 404 on /_vercel/insights/script.js. Auto-tracking is off: routes are reported from onRoute
// below via the documented window.va('pageview', { route, path }) queue (same as
// @vercel/analytics' pageview()), so each view carries a route pattern (/games/[id]) and is
// counted once even when the access gate re-renders it.
function isLocalHost() {
  try {
    const n = location.hostname;
    return n === 'localhost' || n === '127.0.0.1' || n === '::1' || n === '[::1]' || n === '';
  } catch {
    return true;
  }
}

const analyticsOn = !isLocalHost();
let lastTrackedPath = null; // the access gate re-renders the current route; count it once

function injectAnalytics() {
  if (!analyticsOn) return;
  try {
    if (!window.va) {
      window.va = function va(...params) {
        (window.vaq = window.vaq || []).push(params);
      };
    }
    const src = '/_vercel/insights/script.js';
    if (document.head.querySelector(`script[src="${src}"]`)) return;
    const s = document.createElement('script');
    s.src = src;
    s.defer = true;
    s.dataset.disableAutoTrack = '1';
    document.head.appendChild(s);
  } catch {
    /* analytics is optional */
  }
}

/** Route pattern + URL path of a route (no ids in `route`, no query/hash noise in `path`). */
function trackPageview(route) {
  if (!analyticsOn || typeof window.va !== 'function' || !route) return;
  let pattern;
  let path;
  if (route.kind === 'notfound') {
    pattern = '/not-found';
    path = '/not-found';
  } else if (route.kind === 'lesson' || route.kind === 'game') {
    const prefix = route.kind === 'lesson' ? 'lessons' : 'games';
    pattern = `/${prefix}/[id]`;
    path = tokenToPath(route.key);
  } else {
    pattern = route.page === 'home' ? '/' : `/${route.page}${route.param ? '/[param]' : ''}`;
    path = tokenToPath(route.key);
  }
  if (path === lastTrackedPath) return;
  lastTrackedPath = path;
  try {
    window.va('pageview', { route: pattern, path });
  } catch {
    /* ignore */
  }
}

function boot() {
  const app = document.getElementById('app');
  if (!app) return;
  applyTheme(store.state.settings.theme);
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(store.state.settings.theme));
  } catch {
    /* old browsers */
  }
  const shell = buildShell(app);
  injectAnalytics();
  // Access gate (ARCHITECTURE §9.3): blocks paid modules when ACCESS_MODE enforces.
  function wireGate() {
    setAccessGate({
      canOpen: (entry, route) => access.canOpen(entry, route),
      access: () => access.accessInfo(),
      paywallPath: new URL('./pages/paywall.js', import.meta.url).href,
      // No onUnauthenticated redirect: unsigned visitors see the paywall teaser
      // (plans + sign-in CTA) instead of a hard hide-behind-login wall.
    });
  }
  wireGate();
  access.ready.then(() => {
    /* re-render current route once session/level is known */
    wireGate();
  }).catch(() => { /* offline / missing vendor */ });
  startRouter(shell.main, {
    store,
    onRoute: (route, entry) => {
      shell.setActive(route, entry || (route.id ? findEntry(route.id) : null));
      trackPageview(route);
    },
  });
}

boot();

export { navigate };
