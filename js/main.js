// Boot: render the app shell (top bar, phone tab bar, footer) and start the router.
import { store } from './core/store.js';
import { startRouter, navigate } from './core/router.js';
import { h, svg, icon, sfx } from './core/ui.js';
import { findEntry } from './registry.js';

const NAV = [
  { hash: 'beginner', label: 'Beginner', icon: 'candle' },
  { hash: 'advanced', label: 'Advanced', icon: 'target' },
  { hash: 'library', label: 'Library', icon: 'layers' },
  { hash: 'progress', label: 'Progress', icon: 'trophy' },
  { hash: 'glossary', label: 'Glossary', icon: 'book' },
];

const THEMES = ['system', 'light', 'dark'];
const THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' };
const THEME_ICON = { system: 'system', light: 'sun', dark: 'moon' };

/** Brand mark: a hollow bear candle and a gold bull candle. */
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

function navKeyFor(route, entry) {
  if (!route) return null;
  if (route.kind === 'page') {
    if (route.page === 'track') return route.tier;
    if (route.page === 'library' || route.page === 'progress' || route.page === 'glossary') return route.page;
    return null;
  }
  if ((route.kind === 'lesson' || route.kind === 'game') && entry) {
    if (entry.tier === 'both') return store.state.lastTier || 'beginner';
    return entry.tier;
  }
  return null;
}

function buildShell(app) {
  const navLinks = [];
  const tabLinks = [];

  const topNav = h('nav', { class: 'nav', 'aria-label': 'Primary' },
    NAV.map((n) => {
      const a = h('a', { class: 'nav__link', href: `#${n.hash}`, 'data-nav': n.hash }, h('span', null, n.label));
      navLinks.push(a);
      return a;
    }));

  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Primary' },
    NAV.map((n) => {
      const a = h('a', { class: 'tabbar__link', href: `#${n.hash}`, 'data-nav': n.hash }, icon(n.icon, { size: 22 }), h('span', null, n.label));
      tabLinks.push(a);
      return a;
    }));

  // XP pill
  const lvNum = h('span', { class: 'xp-pill__lv mono' });
  const lvTitle = h('span', { class: 'xp-pill__title' });
  const lvFill = h('span', { class: 'xp-pill__fill' });
  const xpPill = h('a', { class: 'xp-pill', href: '#progress' }, lvNum, lvTitle, h('span', { class: 'xp-pill__meter', 'aria-hidden': 'true' }, lvFill));

  function renderXP(bump = false) {
    const lv = store.level();
    lvNum.textContent = `Lv ${lv.number}`;
    lvTitle.textContent = lv.title;
    lvFill.style.width = `${Math.round(lv.progress * 100)}%`;
    const toNext = lv.next != null ? `, ${lv.next - lv.xp} XP to ${lv.nextTitle}` : '';
    xpPill.setAttribute('aria-label', `Level ${lv.number}, ${lv.title}. ${lv.xp} XP${toNext}. View progress.`);
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

  const skip = h('button', { type: 'button', class: 'skip-link', on: { click: () => main.focus() } }, 'Skip to content');

  const header = h('header', { class: 'topbar' },
    h('div', { class: 'container topbar__inner' },
      h('a', { class: 'brand', href: '#home', 'aria-label': 'The Trade School — home' },
        brandMark(28),
        h('span', { class: 'brand__word' }, 'The Trade School')),
      topNav,
      h('div', { class: 'topbar__tools' }, xpPill, soundBtn, themeBtn)));

  const footer = h('footer', { class: 'footer' },
    h('div', { class: 'container footer__inner' },
      h('div', { class: 'footer__brand' },
        brandMark(22),
        h('p', null, h('strong', null, 'Educational simulations only — not financial advice.'), ' All prices are generated.')),
      h('nav', { class: 'footer__links', 'aria-label': 'Footer' },
        h('a', { href: '#beginner' }, 'Beginner'),
        h('a', { href: '#advanced' }, 'Advanced'),
        h('a', { href: '#library' }, 'Library'),
        h('a', { href: '#glossary' }, 'Glossary'),
        h('a', { href: '#progress' }, 'Progress'))));

  app.replaceChildren(skip, header, main, footer, tabbar);
  app.classList.add('app');

  renderXP();
  renderSound();
  renderTheme();
  store.on('xp', () => renderXP(true));
  store.on('change', () => {
    renderXP();
    renderSound();
  });

  function setActive(route, entry) {
    const key = navKeyFor(route, entry);
    for (const a of [...navLinks, ...tabLinks]) {
      const on = a.dataset.nav === key;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    document.body.dataset.route = route.kind === 'page' ? route.page : route.kind;
  }

  return { main, setActive };
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
  startRouter(shell.main, {
    store,
    onRoute: (route, entry) => {
      shell.setActive(route, entry || (route.id ? findEntry(route.id) : null));
    },
  });
}

boot();

export { navigate };
