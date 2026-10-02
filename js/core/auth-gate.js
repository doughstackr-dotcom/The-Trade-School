// Auth-first gate: signed-out visitors see a sign-in / sign-up dialog before
// route content while the existing Supabase access module remains the source of truth.
import { h, icon, modal, toast } from './ui.js';
import * as access from './access.js';

const EXEMPT_PAGES = new Set(['account', 'privacy', 'terms', 'help', 'reset', 'dev-chart']);
const PROGRESS_KEY = 'tts-progress-v1';

let gate = null;
let gateRouteKey = '';
let navigateRef = null;
let routeRef = null;
let pending = false;

function tokenFromRoute(route) {
  if (!route) return 'home';
  return route.key || route.page || 'home';
}

function isAuthExempt(route) {
  if (!route) return false;
  if (route.kind === 'notfound') return true;
  if (route.kind === 'page') {
    if (EXEMPT_PAGES.has(route.page)) return true;
    if (String(route.key || '').startsWith('account.')) return true;
  }
  return false;
}

function authTitle(mode) {
  return mode === 'signin' ? 'Sign in to continue' : 'Create your free account';
}

function authLead(mode, route) {
  if (mode === 'signin') return 'Use your Trade School account to keep going.';
  if (route?.kind === 'lesson' || route?.kind === 'game' || route?.kind === 'tool') {
    return 'Accounts are free. After you sign in, free modules open right away and paid modules show the right upgrade option.';
  }
  return 'Create a free account to enter The Trade School. The Daily Challenge and free lessons open after sign-in.';
}

function markWelcomed() {
  try {
    const raw = globalThis.localStorage?.getItem(PROGRESS_KEY);
    const state = raw ? JSON.parse(raw) : { v: 1 };
    state.settings = { ...(state.settings || {}), welcomed: true };
    globalThis.localStorage?.setItem(PROGRESS_KEY, JSON.stringify(state));
  } catch {
    /* storage may be blocked; the auth flow still succeeds */
  }
}

function form(mode, route, api, setMode, notice = '') {
  const status = h('p', { class: 'auth-gate__status muted', role: 'status', 'aria-live': 'polite' }, notice);
  const email = h('input', {
    class: 'input',
    type: 'email',
    name: 'email',
    required: true,
    autocomplete: 'email',
    'aria-label': 'Email',
  });
  const password = h('input', {
    class: 'input',
    type: 'password',
    name: 'password',
    required: true,
    minlength: '6',
    autocomplete: mode === 'signin' ? 'current-password' : 'new-password',
    'aria-label': 'Password',
  });
  const displayName = h('input', {
    class: 'input',
    type: 'text',
    name: 'displayName',
    autocomplete: 'nickname',
    placeholder: 'Optional',
    'aria-label': 'Display name',
  });
  const confirm = h('input', {
    class: 'input',
    type: 'password',
    name: 'confirm',
    required: mode === 'signup',
    minlength: '6',
    autocomplete: 'new-password',
    'aria-label': 'Confirm password',
  });

  const node = h('div', { class: 'auth-gate' },
    h('p', { class: 'auth-gate__lead' }, authLead(mode, route)),
    h('div', { class: 'segmented auth-gate__tabs', role: 'tablist', 'aria-label': 'Authentication mode' },
      h('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(mode === 'signup'),
        on: { click: () => setMode('signup') },
      }, 'Create account'),
      h('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(mode === 'signin'),
        on: { click: () => setMode('signin') },
      }, 'Sign in')),
    h('form', {
      class: 'auth-gate__form',
      on: {
        submit: async (event) => {
          event.preventDefault();
          if (pending) return;
          pending = true;
          const fd = new FormData(event.currentTarget);
          const passwordValue = String(fd.get('password') || '');
          if (mode === 'signup' && passwordValue !== String(fd.get('confirm') || '')) {
            status.textContent = 'Passwords do not match.';
            toast('Passwords do not match', { type: 'warn' });
            pending = false;
            return;
          }
          status.textContent = mode === 'signin' ? 'Signing in.' : 'Creating account.';
          markWelcomed();
          try {
            const res = mode === 'signin'
              ? await access.signIn({
                email: String(fd.get('email') || '').trim(),
                password: passwordValue,
              })
              : await access.signUp({
                email: String(fd.get('email') || '').trim(),
                password: passwordValue,
                displayName: String(fd.get('displayName') || '').trim() || undefined,
              });
            if (!res.ok) {
              status.textContent = res.error || 'Authentication failed.';
              toast(res.error || 'Authentication failed', { type: 'warn', duration: 5000 });
              return;
            }
            if (res.needsConfirmation) {
              status.textContent = 'Check your email to confirm, then sign in.';
              toast('Confirm your email to finish sign-up', { type: 'info', duration: 6000 });
              setMode('signin', 'Check your email to confirm, then sign in.');
              return;
            }
            toast(mode === 'signin' ? 'Signed in' : 'Account created', { type: 'info' });
            api.close();
            const ret = access.consumeReturn();
            if (ret) navigateRef?.(ret);
          } catch (err) {
            const message = err?.message || 'Authentication failed. Check your connection and try again.';
            status.textContent = message;
            toast(message, { type: 'warn', duration: 5000 });
          } finally {
            pending = false;
          }
        },
      },
    },
    mode === 'signup'
      ? h('label', { class: 'field' }, h('span', null, 'Display name'), displayName)
      : null,
    h('label', { class: 'field' }, h('span', null, 'Email'), email),
    h('label', { class: 'field' }, h('span', null, 'Password'), password),
    mode === 'signup'
      ? h('label', { class: 'field' }, h('span', null, 'Confirm password'), confirm)
      : null,
    h('button', { type: 'submit', class: 'btn btn--primary btn--block' },
      icon('lock', { size: 15 }),
      mode === 'signin' ? 'Sign in' : 'Create account'),
    status),
    h('p', { class: 'auth-gate__foot muted' },
      mode === 'signin' ? 'New here?' : 'Already have an account?',
      ' ',
      h('button', {
        type: 'button',
        class: 'link-btn',
        on: { click: () => setMode(mode === 'signin' ? 'signup' : 'signin') },
      }, mode === 'signin' ? 'Create account' : 'Sign in')));

  queueMicrotask(() => email.focus?.({ preventScroll: true }));
  return node;
}

function openGate(route, { mode = 'signup' } = {}) {
  if (gate || access.getAccess().user || !access.isEnforcing() || isAuthExempt(route)) return;
  const token = tokenFromRoute(route);
  access.rememberReturn(token);
  gateRouteKey = token;
  let currentMode = mode;
  let currentNotice = '';
  let api = null;
  const bodyHost = h('div');
  const setMode = (next, notice = '') => {
    currentMode = next === 'signin' ? 'signin' : 'signup';
    currentNotice = notice;
    if (api?.el) {
      const title = api.el.querySelector('.modal__title');
      if (title) title.textContent = authTitle(currentMode);
    }
    bodyHost.replaceChildren(form(currentMode, route, api, setMode, currentNotice));
  };
  api = modal({
    title: authTitle(currentMode),
    body: bodyHost,
    actions: [],
    dismissible: false,
    size: 'sm',
    onClose: () => {
      if (gate === api) gate = null;
      gateRouteKey = '';
    },
  });
  gate = api;
  setMode(currentMode);
}

function syncGate() {
  const route = routeRef?.();
  document.body.classList.remove('auth-gate-pending');
  if (!access.isEnforcing() || access.getAccess().user) {
    gate?.close?.();
    return;
  }
  if (isAuthExempt(route)) {
    gate?.close?.();
    return;
  }
  if (gate && gateRouteKey === tokenFromRoute(route)) return;
  if (gate) gate.close();
  openGate(route, { mode: 'signup' });
}

export function installAuthGate({ navigate, currentRoute }) {
  navigateRef = navigate;
  routeRef = currentRoute;
  if (access.isEnforcing()) document.body.classList.add('auth-gate-pending');
  access.ready.then(syncGate).catch(syncGate);
  access.onChange(syncGate);
  window.addEventListener('hashchange', () => queueMicrotask(syncGate));
  return {
    open(route, opts) {
      document.body.classList.remove('auth-gate-pending');
      openGate(route || routeRef?.(), opts);
    },
    sync: syncGate,
  };
}
