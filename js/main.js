// Boot: render the app shell (top bar, phone tab bar, footer) and start the router.
import { store } from './core/store.js';
import { startRouter, navigate, setAccessGate, currentState, currentRoute, refresh } from './core/router.js';
import { h, svg, icon, sfx, toast } from './core/ui.js';
import { findEntry, tiersOf } from './registry.js';
import { auth } from './core/auth.js';
import { startSync } from './core/sync.js';
import { makeAccess, requiredPlan, canOpen, browserAccessMode, premiumFolder, planChipLabel } from './core/access.js';
import { PREMIUM_SOURCE } from './config.js';

// tab: false keeps an item out of the phone tab bar (it stays in the top nav and the footer);
// wide: only in the top nav from 1180px (narrower top navs drop it; the footer keeps it).
const NAV = [
  { hash: 'beginner', label: 'Beginner', icon: 'candle' },
  { hash: 'advanced', label: 'Advanced', icon: 'target' },
  { hash: 'playbook', label: 'Playbook', icon: 'flag' },
  { hash: 'live', label: 'Live', icon: 'bolt', live: true },
  { hash: 'library', label: 'Library', icon: 'layers' },
  { hash: 'progress', label: 'Progress', icon: 'trophy' },
  { hash: 'glossary', label: 'Glossary', icon: 'book', tab: false, wide: true },
];

/** Small pulsing dot marking the Live Market Lab link. */
function liveDot() {
  return h('span', { class: 'live-dot', 'aria-hidden': 'true' });
}

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
    if (['library', 'progress', 'glossary', 'playbook', 'live'].includes(route.page)) return route.page;
    return null;
  }
  if ((route.kind === 'lesson' || route.kind === 'game') && entry) {
    if (entry.tier === 'both') {
      // A 'both' game that sits in one track's units (e.g. Live Predict) belongs to that track.
      const tiers = tiersOf(entry.id);
      return tiers.length === 1 ? tiers[0] : store.state.lastTier || 'beginner';
    }
    return entry.tier;
  }
  return null;
}

function buildShell(app) {
  const navLinks = [];
  const tabLinks = [];

  const topNav = h('nav', { class: 'nav', 'aria-label': 'Primary' },
    NAV.map((n) => {
      const a = h('a', { class: ['nav__link', n.wide && 'nav__link--wide', n.live && 'nav__link--live'], href: `#${n.hash}`, 'data-nav': n.hash },
        n.live ? liveDot() : null, h('span', null, n.label));
      navLinks.push(a);
      return a;
    }));

  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Primary', style: { '--tabs': NAV.filter((n) => n.tab !== false).length } },
    NAV.filter((n) => n.tab !== false).map((n) => {
      const a = h('a', { class: ['tabbar__link', n.live && 'tabbar__link--live'], href: `#${n.hash}`, 'data-nav': n.hash },
        h('span', { class: 'tabbar__icon' }, icon(n.icon, { size: 22 }), n.live ? liveDot() : null), h('span', null, n.label));
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
  const soundBtn = h('button', { type: 'button', class: 'icon-btn topbar__sound', on: { click: () => {
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
      h('div', { class: 'topbar__tools' }, xpPill, soundBtn, themeBtn, accountArea())));

  const footer = h('footer', { class: 'footer' },
    h('div', { class: 'container footer__inner' },
      h('div', { class: 'footer__brand' },
        brandMark(22),
        h('p', null, h('strong', null, 'Educational simulations only — not financial advice.'), ' Textbook charts use generated prices; real-market charts name their data source.')),
      h('nav', { class: 'footer__links', 'aria-label': 'Footer' },
        h('a', { href: '#beginner' }, 'Beginner'),
        h('a', { href: '#advanced' }, 'Advanced'),
        h('a', { href: '#playbook' }, 'Playbook'),
        h('a', { href: '#live' }, 'Live Market Lab'),
        h('a', { href: '#library' }, 'Library'),
        h('a', { href: '#glossary' }, 'Glossary'),
        h('a', { href: '#progress' }, 'Progress'),
        h('a', { href: '#pricing' }, 'Pricing'),
        h('a', { href: '#terms' }, 'Terms'),
        h('a', { href: '#privacy' }, 'Privacy'))));

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

// ------------------------------------------------------------------ accounts (§9)

/** A person glyph for the signed-out account button (phones). */
function personIcon(size = 20) {
  return svg('svg', { class: 'icon', width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'aria-hidden': 'true', focusable: 'false' },
    svg('circle', { cx: 12, cy: 8.5, r: 3.8 }),
    svg('path', { d: 'M4.5 20c1.3-3.7 4.1-5.6 7.5-5.6s6.2 1.9 7.5 5.6' }));
}

/** Remember where the member was, so signing in brings them back. */
function rememberHere() {
  const r = currentRoute();
  if (r?.key) auth.setReturnTo(r.key);
}

/**
 * Header account area. Signed out: "Sign in" + "Start free" (a person button with the same
 * choices on phones). Signed in: an avatar button opening a small menu (name, email, plan,
 * Account, Pricing/Upgrade, Sign out). Menu: Enter/Space/↓ open, ↑/↓/Home/End move, Esc closes.
 */
function accountArea() {
  const slot = h('div', { class: 'acct-slot' });
  const menuId = 'acct-menu';
  let menu = null;
  let trigger = null;

  const items = () => (menu ? [...menu.querySelectorAll('[role^="menuitem"]')].filter((el) => el.getClientRects().length > 0) : []);
  function openMenu(focus = 'first') {
    if (!menu || !trigger) return;
    menu.querySelector('.acct-menu__item--sound')?.sync?.();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    slot.classList.add('is-open');
    const list = items();
    (focus === 'last' ? list[list.length - 1] : list[0])?.focus();
    document.addEventListener('pointerdown', onOutside, true);
  }
  function closeMenu(refocus = false) {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
    slot.classList.remove('is-open');
    document.removeEventListener('pointerdown', onOutside, true);
    if (refocus) trigger?.focus();
  }
  function onOutside(e) {
    if (!slot.contains(e.target)) closeMenu(false);
  }
  function onTriggerKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (menu.hidden) openMenu('first');
      else closeMenu(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu('last');
    } else if (e.key === 'Escape') closeMenu(true);
  }
  function onMenuKey(e) {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1) + list.length) % list.length];
      n?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === 'Tab') {
      closeMenu(false);
    }
  }
  function item(label, { href, onClick, iconName, action }) {
    const attrs = { role: 'menuitem', class: 'acct-menu__item', tabindex: '-1', 'data-action': action };
    const kids = [iconName ? icon(iconName, { size: 16 }) : null, h('span', null, label)];
    const el = href
      ? h('a', { ...attrs, href, on: { click: () => closeMenu(false) } }, kids)
      : h('button', { ...attrs, type: 'button', on: { click: (e) => {
        closeMenu(false);
        onClick?.(e);
      } } }, kids);
    return el;
  }

  // On narrow top bars the sound toggle lives in this menu (css/account.css hides the icon).
  function soundItem() {
    const on = () => store.state.settings.sound !== false;
    const el = h('button', {
      type: 'button', role: 'menuitemcheckbox', class: 'acct-menu__item acct-menu__item--sound', tabindex: '-1', 'data-action': 'menu-sound',
      on: { click: (e) => {
        e.stopPropagation();          // keep the menu open: it is a toggle
        store.setSetting('sound', !on());
        el.sync();
        sfx.click();
      } },
    });
    el.sync = () => {
      el.setAttribute('aria-checked', String(on()));
      el.replaceChildren(icon(on() ? 'sound' : 'mute', { size: 16 }), h('span', null, on() ? 'Sound effects: on' : 'Sound effects: off'));
    };
    el.sync();
    return el;
  }

  function render() {
    const wasOpen = menu && !menu.hidden;
    closeMenu(false);
    slot.replaceChildren();
    const user = auth.user;
    if (!user && auth.restoring) {
      // A stored session is being restored: hold the space without flashing "Sign in".
      slot.dataset.state = 'pending';
      document.documentElement.dataset.auth = 'pending';
      trigger = null;
      menu = null;
      slot.append(h('span', { class: 'avatar-btn acct-pending', 'aria-hidden': 'true' }, h('span', { class: 'avatar avatar--sm' })));
      return;
    }
    slot.dataset.state = user ? 'in' : 'out';
    document.documentElement.dataset.auth = user ? 'in' : 'out';
    if (!user) {
      trigger = h('button', {
        type: 'button', class: 'icon-btn acct-compact', 'aria-label': 'Account: sign in or create a free account',
        'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': menuId,
        on: { click: () => (menu.hidden ? openMenu('first') : closeMenu(true)), keydown: onTriggerKey },
      }, personIcon(20));
      menu = h('div', { class: 'acct-menu', id: menuId, role: 'menu', 'aria-label': 'Account', hidden: true, on: { keydown: onMenuKey } },
        item('Sign in', { href: '#signin', iconName: 'arrow-right', action: 'menu-signin' }),
        item('Create free account', { href: '#signup', iconName: 'plus', action: 'menu-signup' }),
        item('Plans & pricing', { href: '#pricing', iconName: 'star', action: 'menu-pricing' }),
        soundItem());
      menu.addEventListener('click', (e) => {
        if (e.target.closest('[href="#signin"], [href="#signup"]')) rememberHere();
      });
      slot.append(
        h('a', { class: 'btn btn--ghost btn--sm acct-signin', href: '#signin', 'data-action': 'header-signin', on: { click: rememberHere } }, 'Sign in'),
        h('a', { class: 'btn btn--primary btn--sm acct-start', href: '#signup', 'data-action': 'header-signup', on: { click: rememberHere } }, 'Start free'),
        trigger, menu);
      return;
    }
    const name = auth.displayName;
    const lv = auth.level;
    const chipText = planChipLabel(lv);
    trigger = h('button', {
      type: 'button', class: 'avatar-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': menuId,
      'aria-label': `Account menu: ${name}${chipText ? `, ${chipText}` : ''}`, 'data-action': 'account-menu',
      on: { click: () => (menu.hidden ? openMenu('first') : closeMenu(true)), keydown: onTriggerKey },
    }, h('span', { class: 'avatar avatar--sm', 'aria-hidden': 'true' }, (name.trim()[0] || '?').toUpperCase()));
    menu = h('div', { class: 'acct-menu', id: menuId, role: 'menu', 'aria-label': 'Account', hidden: true, on: { keydown: onMenuKey } },
      h('div', { class: 'acct-menu__head', role: 'none' },
        h('span', { class: 'avatar avatar--md', 'aria-hidden': 'true' }, (name.trim()[0] || '?').toUpperCase()),
        h('span', { class: 'acct-menu__who' },
          h('strong', { class: 'acct-menu__name' }, name),
          h('span', { class: 'acct-menu__email' }, user.email),
          chipText ? h('span', { class: ['chip', 'chip--sm', 'plan-chip', `plan-chip--${lv}`] }, chipText) : null)),
      item('Account', { href: '#account', iconName: 'shield', action: 'menu-account' }),
      item(lv === 'advanced' ? 'Plans & pricing' : lv === 'beginner' ? 'Upgrade to Advanced' : 'Upgrade', { href: lv === 'beginner' ? '#pricing.advanced' : '#pricing', iconName: 'star', action: 'menu-pricing' }),
      soundItem(),
      item('Sign out', { iconName: 'arrow-left', action: 'menu-signout', onClick: async () => {
        try {
          await auth.signOut();
          toast('Signed out. Your progress is saved in your account.', { type: 'info' });
          const r = currentRoute();
          if (r?.page === 'account') navigate('home');
        } catch (err) {
          toast(err?.message || 'Could not sign out.', { type: 'bad' });
        }
      } }));
    slot.append(trigger, menu);
    if (wasOpen) openMenu('first');
  }

  render();
  let last = '';
  auth.on('change', () => {
    const key = `${auth.user?.id || ''}|${auth.level || ''}|${auth.displayName}|${auth.restoring}`;
    if (key === last) return;
    last = key;
    render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu && !menu.hidden) closeMenu(true);
  });
  window.addEventListener('hashchange', () => closeMenu(false));
  return slot;
}

/** Registers the access gate (§9.3), progress sync and the auth → router glue. */
function setupAccounts() {
  auth.init();
  const enforce = browserAccessMode() === 'enforce';
  document.documentElement.dataset.access = enforce ? 'enforce' : 'open';
  const access = makeAccess(() => auth.level, { enforce, signedIn: () => !!auth.user });
  const targetOf = (entry, route) => (route.kind === 'lesson' || route.kind === 'game' ? entry : route);
  let premiumUsed = false;

  setAccessGate({
    access,
    async canOpen(entry, route) {
      if (!enforce) return true;
      const target = targetOf(entry, route);
      if (!requiredPlan(target)) return true;
      await auth.ready;
      return canOpen(target, auth.level);
    },
    loadModule: PREMIUM_SOURCE === 'storage' ? async (entry) => {
      const plan = premiumFolder(entry);
      if (!plan || !auth.user || auth.mode !== 'supabase') return null;
      try {
        const { loadPremiumModule } = await import('./core/premium-loader.js');
        premiumUsed = true;
        return await loadPremiumModule(entry, {
          plan,
          download: (path) => auth.downloadPremium(path),
          jsRoot: new URL('./', import.meta.url).href,
          siteRoot: new URL('../', import.meta.url).href,
        });
      } catch (err) {
        console.warn(`[premium] ${entry.id}: loading the site copy instead:`, err?.message || err);
        return null;
      }
    } : undefined,
  });

  startSync({ store, auth });
  auth.on('recovery', () => navigate('reset.update'));

  // When the member's plan changes, re-render what depends on it: pages that show lock chips,
  // and a lesson / game whose paywall state flipped (a game in progress is otherwise left alone).
  let lastLevel = auth.level;
  let lastUser = auth.user?.id || null;
  auth.on('change', () => {
    const lv = auth.level;
    const who = auth.user?.id || null;
    if (lv === lastLevel && who === lastUser) return;
    lastLevel = lv;
    lastUser = who;
    if (!who && premiumUsed) import('./core/premium-loader.js').then((m) => m.clearPremiumCache()).catch(() => {});
    if (!enforce) return;
    const { route, entry, blocked } = currentState();
    if (!route) return;
    if (route.kind === 'lesson' || route.kind === 'game') {
      if (canOpen(targetOf(entry, route), lv) === blocked) refresh();
    } else if (route.kind === 'page' && ['home', 'track', 'library', 'playbook', 'live'].includes(route.page)) {
      refresh();
    }
  });
}

function boot() {
  const app = document.getElementById('app');
  if (!app) return;
  applyTheme(store.state.settings.theme);
  setupAccounts();
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
