// Installable-app support (ARCHITECTURE §10). Loaded by index.html after js/main.js.
//
// - Registers sw.js only where it can work: a secure context (https, or localhost when opted
//   in), top-level (never inside an iframe / sandboxed artifact, where registration fails),
//   and not switched off. On localhost the worker is OFF unless you open the site once with
//   `?sw=1` (remembered in localStorage 'tts-sw'), so development and the smoke test always
//   load fresh files. `?sw=0` unregisters it and clears its caches (on any host).
// - "Install app": when the browser fires beforeinstallprompt, a small pill appears on the home
//   page (dismissible, stays hidden for 30 days) and an "Install app" button joins the footer
//   links. iOS Safari has no prompt, so its footer button explains Share → Add to Home Screen.
// - "Update available — Reload": shown when a new worker is waiting; Reload asks it to take
//   over (SKIP_WAITING) and reloads once it controls the page.
// <html data-sw="…"> records the outcome for tests: registered | off | unsupported | framed | error.
import { h, svg, icon, modal, toast } from './core/ui.js';

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;
const KEY_OPT = 'tts-sw';
const KEY_DISMISS = 'tts-install-dismissed';
const DISMISS_MS = 30 * 24 * 3600 * 1000;
const UPDATE_CHECK_MS = 30 * 60 * 1000;

let deferredPrompt = null;
let registration = null;
let reloadRequested = false;
let updateBar = null;
let installPill = null;
let footerBtn = null;
let lastUpdateCheck = 0;

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the choice is just not remembered */
  }
}

function setState(state) {
  try {
    document.documentElement.dataset.sw = state;
  } catch {
    /* ignore */
  }
}

/** True inside an iframe (or when we cannot even ask, e.g. a cross-origin sandbox). */
export function isFramed() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** True when running as an installed app (home-screen / standalone window). */
export function isStandalone() {
  try {
    if (navigator.standalone === true) return true;
    return ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay']
      .some((m) => matchMedia(`(display-mode: ${m})`).matches);
  } catch {
    return false;
  }
}

function isIOS() {
  const ua = navigator.userAgent || '';
  return /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
}

function queryFlag() {
  try {
    return new URLSearchParams(location.search).get('sw');
  } catch {
    return null;
  }
}

/** Why the service worker will or will not be registered here. */
export function swDecision() {
  if (isFramed()) return 'framed';
  let origin = 'null';
  try {
    origin = location.origin;
  } catch {
    /* sandboxed */
  }
  if (origin === 'null' || !('serviceWorker' in navigator) || !window.isSecureContext) return 'unsupported';
  const local = LOCAL_HOST.test(location.hostname);
  if (location.protocol !== 'https:' && !local) return 'unsupported';
  const flag = queryFlag();
  if (flag === '0') return 'off';
  if (flag === '1') return 'on';
  const saved = read(KEY_OPT);
  if (saved === '0') return 'off';
  if (local) return saved === '1' ? 'on' : 'off';
  return 'on';
}

async function unregisterAll() {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    // A worker keeps controlling this page after unregister(): tell it to stop caching first.
    for (const w of [navigator.serviceWorker.controller, ...regs.flatMap((r) => [r.active, r.waiting, r.installing])]) {
      try {
        w?.postMessage({ type: 'DISABLE' });
      } catch {
        /* gone */
      }
    }
    await Promise.all(regs.map((r) => r.unregister()));
    if (typeof caches === 'undefined') return;
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('tts-')).map((k) => caches.delete(k)));
  } catch {
    /* nothing registered */
  }
}

// ------------------------------------------------------------------ update toast

function showUpdate(worker) {
  if (!worker) return;
  if (updateBar) {
    updateBar._worker = worker;
    return;
  }
  const reload = h('button', {
    type: 'button',
    class: 'btn btn--primary btn--sm pwa-bar__reload',
    'data-action': 'pwa-reload',
    on: {
      click: () => {
        reloadRequested = true;
        reload.disabled = true;
        const w = updateBar?._worker || worker;
        try {
          w.postMessage({ type: 'SKIP_WAITING' });
        } catch {
          /* worker gone */
        }
        // controllerchange normally reloads us; this is the safety net.
        setTimeout(() => location.reload(), 4000);
      },
    },
  }, icon('restart', { size: 16 }), 'Reload');
  const close = h('button', {
    type: 'button',
    class: 'pwa-bar__close',
    'aria-label': 'Dismiss: update on the next visit',
    title: 'Later',
    on: { click: hideUpdate },
  }, icon('x', { size: 16 }));
  updateBar = h('div', { class: 'pwa-bar', role: 'status', 'aria-live': 'polite', 'data-pwa': 'update' },
    h('span', { class: 'pwa-bar__icon', 'aria-hidden': 'true' }, icon('spark', { size: 16 })),
    h('span', { class: 'pwa-bar__msg' }, h('strong', null, 'Update available'), h('span', { class: 'pwa-bar__sub' }, ' — reload to get the latest lessons.')),
    reload, close);
  updateBar._worker = worker;
  document.body.append(updateBar);
  document.body.classList.add('has-pwa-bar');
  requestAnimationFrame(() => updateBar?.classList.add('is-in'));
}

function hideUpdate() {
  if (!updateBar) return;
  const el = updateBar;
  updateBar = null;
  document.body.classList.remove('has-pwa-bar');
  el.classList.remove('is-in');
  setTimeout(() => el.remove(), 250);
}

function watchRegistration(reg) {
  if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    if (!w) return;
    w.addEventListener('statechange', () => {
      // "installed" with a controller = an update is waiting (first installs have no controller).
      if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w);
    });
  });
}

function checkForUpdate() {
  if (!registration || Date.now() - lastUpdateCheck < UPDATE_CHECK_MS) return;
  lastUpdateCheck = Date.now();
  registration.update().catch(() => {});
}

async function register() {
  try {
    const url = new URL('../sw.js', import.meta.url);
    const scope = new URL('../', import.meta.url);
    registration = await navigator.serviceWorker.register(url.href, { scope: scope.pathname, updateViaCache: 'none' });
    lastUpdateCheck = Date.now();
    setState('registered');
    watchRegistration(registration);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadRequested) {
        reloadRequested = false;
        location.reload();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
  } catch (err) {
    // The site works without it; keep the console quiet (no console.error).
    setState('error');
    console.info('[pwa] service worker not registered:', err && err.message ? err.message : err);
  }
}

// ------------------------------------------------------------------ install

function downloadIcon(size = 18) {
  return svg('svg', { class: 'icon', width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { d: 'M12 4v11' }),
    svg('path', { d: 'M7.5 10.5 12 15l4.5-4.5' }),
    svg('path', { d: 'M5 19h14' }));
}

function dismissedRecently() {
  const t = Number(read(KEY_DISMISS));
  return Number.isFinite(t) && t > 0 && Date.now() - t < DISMISS_MS;
}

function iosHelp() {
  const steps = h('ol', { class: 'pwa-steps' },
    h('li', null, 'Tap the ', h('strong', null, 'Share'), ' button (the square with an arrow) in the browser toolbar.'),
    h('li', null, 'Scroll down and choose ', h('strong', null, 'Add to Home Screen'), '.'),
    h('li', null, 'Tap ', h('strong', null, 'Add'), '. The Trade School opens full screen from your home screen.'));
  modal({
    title: 'Install The Trade School',
    body: h('div', { class: 'stack stack--sm' }, h('p', { class: 'muted' }, 'Add the school to your home screen to open it like an app.'), steps),
    actions: [{ label: 'Got it', primary: true }],
  });
}

async function promptInstall() {
  if (!deferredPrompt) {
    if (isIOS()) iosHelp();
    return;
  }
  const evt = deferredPrompt;
  deferredPrompt = null; // a prompt can be shown only once
  try {
    await evt.prompt();
    const choice = await evt.userChoice;
    if (choice && choice.outcome === 'dismissed') write(KEY_DISMISS, String(Date.now()));
  } catch {
    /* the browser refused (e.g. not triggered by a click) */
  }
  renderInstall();
}

function renderInstall() {
  const standalone = isStandalone();
  const canPrompt = !!deferredPrompt && !standalone;
  const ios = !standalone && isIOS() && !deferredPrompt;

  // Floating pill: only with a real prompt, not recently dismissed; CSS shows it on home only.
  if (canPrompt && !dismissedRecently()) {
    if (!installPill) {
      installPill = h('div', { class: 'pwa-install', 'data-pwa': 'install' },
        h('button', { type: 'button', class: 'pwa-install__btn', 'data-action': 'pwa-install', on: { click: promptInstall } }, downloadIcon(18), h('span', null, 'Install app')),
        h('button', {
          type: 'button',
          class: 'pwa-install__close',
          'aria-label': 'Not now (hide the install button)',
          title: 'Not now',
          on: {
            click: () => {
              write(KEY_DISMISS, String(Date.now()));
              installPill?.remove();
              installPill = null;
            },
          },
        }, icon('x', { size: 16 })));
      document.body.append(installPill);
    }
  } else if (installPill) {
    installPill.remove();
    installPill = null;
  }

  // Footer button: always available while installing is possible (prompt or iOS instructions).
  const links = document.querySelector('.footer__links');
  if ((canPrompt || ios) && links) {
    if (!footerBtn) {
      footerBtn = h('button', { type: 'button', class: 'footer__install', 'data-action': 'pwa-install-footer', on: { click: promptInstall } }, downloadIcon(16), 'Install app');
    }
    if (!footerBtn.isConnected) links.append(footerBtn);
  } else if (footerBtn) {
    footerBtn.remove();
    footerBtn = null;
  }
}

function initInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own, unobtrusive button instead of the mini-infobar
    deferredPrompt = e;
    renderInstall();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    renderInstall();
    toast('Installed — find The Trade School on your home screen or app list.', { type: 'good', duration: 4000 });
  });
  try {
    matchMedia('(display-mode: standalone)').addEventListener('change', () => {
      document.documentElement.classList.toggle('is-standalone', isStandalone());
      renderInstall();
    });
  } catch {
    /* old browsers */
  }
  document.documentElement.classList.toggle('is-standalone', isStandalone());
  // iOS: the footer button (instructions) as soon as the shell exists.
  if (isIOS()) renderInstall();
}

// ------------------------------------------------------------------ boot

function boot() {
  try {
    initInstall();
  } catch (err) {
    console.info('[pwa] install UI unavailable:', err && err.message ? err.message : err);
  }
  const decision = swDecision();
  const flag = queryFlag();
  if (flag === '1') write(KEY_OPT, '1');
  if (decision === 'off') {
    setState('off');
    if (flag === '0') write(KEY_OPT, LOCAL_HOST.test(location.hostname) ? null : '0');
    // Switched off (or never opted in on localhost): remove any worker / caches left behind.
    unregisterAll();
    return;
  }
  if (decision !== 'on') {
    setState(decision);
    return;
  }
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', () => register(), { once: true });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') boot();
