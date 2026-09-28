// UI toolkit: DOM helpers, toasts, accessible modal, confetti, synthesized sound effects,
// line icons and quiz widgets. Nothing here touches the DOM at import time.
import { store } from './store.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const BOOL_PROPS = new Set(['disabled', 'hidden', 'checked', 'selected', 'readonly', 'required', 'multiple', 'open', 'inert', 'autofocus']);

let uidCounter = 0;
export function uid(prefix = 'tts') {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

export function reducedMotion() {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
  } catch {
    return false;
  }
}

function isAttrs(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x) && !(typeof Node !== 'undefined' && x instanceof Node);
}

function appendChildren(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (typeof c === 'string' || typeof c === 'number') el.append(document.createTextNode(String(c)));
    else el.append(c);
  }
}

function applyAttrs(el, attrs, isSvg) {
  if (!attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key.startsWith('aria-') || key.startsWith('data-')) {
      el.setAttribute(key, String(value));
      continue;
    }
    if (value === false) continue;
    if (key === 'class' || key === 'className') {
      const cls = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
      if (cls) el.setAttribute('class', cls);
    } else if (key === 'style') {
      if (typeof value === 'string') el.style.cssText = value;
      else
        for (const [k, v] of Object.entries(value)) {
          if (v == null) continue;
          if (k.startsWith('--') || k.includes('-')) el.style.setProperty(k, String(v));
          else el.style[k] = v;
        }
    } else if (key === 'on') {
      for (const [ev, fn] of Object.entries(value)) if (fn) el.addEventListener(ev, fn);
    } else if (/^on[A-Z]/.test(key) && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') {
      el.innerHTML = value;
    } else if (key === 'text') {
      el.textContent = value;
    } else if (key === 'dataset') {
      for (const [k, v] of Object.entries(value)) if (v != null) el.dataset[k] = v;
    } else if (key === 'ref' && typeof value === 'function') {
      value(el);
    } else if (!isSvg && (key === 'value' || key === 'checked' || key === 'selected') && key in el) {
      el[key] = value;
      if (key === 'value') el.setAttribute('value', value);
    } else if (value === true || (BOOL_PROPS.has(key) && value)) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

/** h('button', { class: 'btn', on: { click } }, 'Label') */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (isAttrs(attrs)) applyAttrs(el, attrs, false);
  else children.unshift(attrs);
  appendChildren(el, children);
  return el;
}

/** svg('path', { d: 'M0 0L10 10' }) — SVG namespace element. */
export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (isAttrs(attrs)) applyAttrs(el, attrs, true);
  else children.unshift(attrs);
  appendChildren(el, children);
  return el;
}

export function clear(el) {
  if (el) el.replaceChildren();
  return el;
}

// ------------------------------------------------------------------ icons
// 24×24 line icons, 1.75px stroke. Tokens: 'M…' path, 'F:M…' filled path,
// 'c:cx,cy,r' circle, 'C:cx,cy,r' filled circle, 'r:x,y,w,h,rx' rect.
const STAR = 'M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z';
const SPEAKER = 'M4 9.5h3.5L12 5.5v13l-4.5-4H4z';
const ICONS = {
  candle: ['r:8.5,7,7,10,1.2', 'M12 3v4', 'M12 17v4'],
  chart: ['M4 4v16h16', 'M7.5 14.5l3.5-4 3 2.5 5-6'],
  'trend-up': ['M3 17l6-6 4 4 8-8', 'M15 7h6v6'],
  'trend-down': ['M3 7l6 6 4-4 8 8', 'M15 17h6v-6'],
  target: ['c:12,12,8.5', 'c:12,12,4.5', 'C:12,12,1.2'],
  ruler: ['M3.5 16.5L16.5 3.5l4 4-13 13z', 'M6.5 13.5l1.8 1.8', 'M9.5 10.5l2.5 2.5', 'M12.5 7.5l1.8 1.8'],
  layers: ['M12 3.5l8.5 4.5-8.5 4.5-8.5-4.5z', 'M3.5 12l8.5 4.5 8.5-4.5', 'M3.5 16l8.5 4.5 8.5-4.5'],
  clock: ['c:12,12,8.5', 'M12 7.5V12l3 2'],
  shield: ['M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z', 'M9 12l2 2 4-4'],
  spark: ['M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z', 'M18.5 16v4', 'M16.5 18h4'],
  play: ['M7.5 5v14l11-7z'],
  pause: ['M8.5 5.5v13', 'M15.5 5.5v13'],
  step: ['M6 5.5v13l9-6.5z', 'M18 5.5v13'],
  restart: ['M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5', 'M3.5 3.5v5h5'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  x: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  lock: ['r:5,10.5,14,10,2', 'M8 10.5V7.5a4 4 0 0 1 8 0v3'],
  star: [STAR],
  'star-fill': ['F:' + STAR],
  trophy: ['M7.5 4h9v5a4.5 4.5 0 0 1-9 0z', 'M7.5 6H4.5v1.5a3 3 0 0 0 3 3', 'M16.5 6h3v1.5a3 3 0 0 1-3 3', 'M12 13.5v3.5', 'M8.5 20.5h7', 'M9.5 17h5v3.5h-5z'],
  book: ['M12 6.5C10.2 5.2 7.4 4.5 3.5 4.8v13.5c3.9-.3 6.7.4 8.5 1.7 1.8-1.3 4.6-2 8.5-1.7V4.8c-3.9-.3-6.7.4-8.5 1.7z', 'M12 6.5V20'],
  'arrow-left': ['M19 12H5', 'M11 6l-6 6 6 6'],
  'arrow-right': ['M5 12h14', 'M13 6l6 6-6 6'],
  info: ['c:12,12,8.5', 'M12 11v5.5', 'M12 7.7v.1'],
  sun: ['c:12,12,4', 'M12 2.5v2', 'M12 19.5v2', 'M2.5 12h2', 'M19.5 12h2', 'M5.3 5.3l1.4 1.4', 'M17.3 17.3l1.4 1.4', 'M5.3 18.7l1.4-1.4', 'M17.3 6.7l1.4-1.4'],
  moon: ['M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z'],
  sound: [SPEAKER, 'M15.5 9a4 4 0 0 1 0 6', 'M18 6.5a7.5 7.5 0 0 1 0 11'],
  mute: [SPEAKER, 'M16 9.5l5 5', 'M21 9.5l-5 5'],
  // extras
  system: ['c:12,12,8.5', 'F:M12 3.5a8.5 8.5 0 0 1 0 17z'],
  home: ['M4 11l8-6.5 8 6.5', 'M6 9.5V20h12V9.5', 'M10 20v-5h4v5'],
  trendline: ['M3.5 18.5l17-11', 'c:7,16.2,1.7', 'c:15,11,1.7'],
  cross: ['M3 17c5 0 7-10 18-10', 'M3 8c6 0 9 9 18 9'],
  eye: ['M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z', 'c:12,12,2.8'],
  search: ['c:10.5,10.5,6', 'M15 15l5.5 5.5'],
  flame: ['M12 21c3.6 0 6-2.4 6-5.8 0-3.3-2.1-5.2-3.6-7.2-.4 1.8-1.4 2.8-2.4 3.2.3-2.9-.9-5.9-3.4-7.7.2 2.8-1.3 4.6-2.5 6.3C5.1 11.4 6 13.6 6 15.2 6 18.6 8.4 21 12 21z'],
  medal: ['c:12,15,5.5', 'M8.5 3.5l2 6.3', 'M15.5 3.5l-2 6.3', 'M11 14l1.3-1v4.8'],
  bolt: ['M13 3L5 13.5h6L10.5 21 19 10.5h-6z'],
  crown: ['M4 8l4 4 4-6 4 6 4-4-1.5 10h-13z', 'M5.5 20.5h13'],
  compass: ['c:12,12,8.5', 'M15.5 8.5l-2 5-5 2 2-5z'],
  gamepad: ['M7 8h10a4 4 0 0 1 4 4v1.5a3.5 3.5 0 0 1-6.3 2.1L14 14.5h-4l-.7 1.1A3.5 3.5 0 0 1 3 13.5V12a4 4 0 0 1 4-4z', 'M8 10.5v3', 'M6.5 12h3', 'C:15.5,11,1', 'C:17.5,13,1'],
  grid: ['r:4,4,7,7,1.5', 'r:13,4,7,7,1.5', 'r:4,13,7,7,1.5', 'r:13,13,7,7,1.5'],
  'chevron-right': ['M9.5 6l6 6-6 6'],
  'chevron-left': ['M14.5 6l-6 6 6 6'],
  'chevron-down': ['M6 9.5l6 6 6-6'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  flag: ['M5 21V4', 'M5 4.5h11l-2 4 2 4H5'],
};

export const ICON_NAMES = Object.keys(ICONS);

export function icon(name, { size = 18, label = null, class: cls = '' } = {}) {
  const parts = ICONS[name] || ICONS.info;
  const el = svg('svg', {
    class: `icon icon--${name}${cls ? ' ' + cls : ''}`,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.75,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    focusable: 'false',
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }),
  });
  for (const p of parts) {
    if (p.startsWith('F:')) el.append(svg('path', { d: p.slice(2), fill: 'currentColor', stroke: 'none' }));
    else if (p.startsWith('c:') || p.startsWith('C:')) {
      const [cx, cy, r] = p.slice(2).split(',');
      el.append(svg('circle', { cx, cy, r, ...(p[0] === 'C' ? { fill: 'currentColor', stroke: 'none' } : {}) }));
    } else if (p.startsWith('r:')) {
      const [x, y, width, height, rx] = p.slice(2).split(',');
      el.append(svg('rect', { x, y, width, height, rx }));
    } else el.append(svg('path', { d: p }));
  }
  return el;
}

// ------------------------------------------------------------------ small widgets

/** Row of 3 stars; `n` filled. */
export function starRow(n = 0, { max = 3, size = 16, label = true } = {}) {
  const el = h('span', { class: 'stars', ...(label ? { role: 'img', 'aria-label': `${n} of ${max} stars` } : {}) });
  for (let i = 0; i < max; i++) {
    const on = i < n;
    const ic = icon(on ? 'star-fill' : 'star', { size });
    ic.classList.add(on ? 'star--on' : 'star--off');
    el.append(ic);
  }
  return el;
}

/** Progress meter (0..1). */
export function meter(value = 0, { label = '', size = '', tone = '' } = {}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return h('div', {
    class: ['meter', size && `meter--${size}`, tone && `meter--${tone}`],
    role: 'progressbar',
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': pct,
    ...(label ? { 'aria-label': label } : {}),
  }, h('span', { class: 'meter__fill', style: { width: `${pct}%` } }));
}

export function setMeter(el, value) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  el.setAttribute('aria-valuenow', pct);
  const fill = el.querySelector('.meter__fill');
  if (fill) fill.style.width = `${pct}%`;
}

export function tierChip(tier, { small = false } = {}) {
  const label = tier === 'both' ? 'All levels' : tier === 'advanced' ? 'Advanced' : 'Beginner';
  return h('span', { class: ['chip', `chip--tier-${tier}`, small && 'chip--sm'] }, label);
}

export function fmt(n, decimals = 0) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function kbdHint(keys, label = '') {
  const list = Array.isArray(keys) ? keys : [keys];
  return h('span', { class: 'kbd-hint' },
    list.map((k) => h('kbd', { class: 'kbd' }, k)),
    label ? h('span', { class: 'kbd-hint__label' }, label) : null);
}

export function explainer(html, type = '') {
  const el = h('div', { class: ['explainer', type && `explainer--${type}`] });
  if (html == null) return el;
  if (typeof html === 'string') el.innerHTML = html;
  else el.append(html);
  return el;
}

// ------------------------------------------------------------------ toasts

let toastStack = null;
function getToastStack() {
  if (!toastStack || !toastStack.isConnected) {
    toastStack = h('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' });
    document.body.append(toastStack);
  }
  return toastStack;
}

const TOAST_ICONS = { info: 'info', good: 'check', bad: 'x', xp: 'spark', badge: 'trophy', warn: 'info' };

export function toast(message, { type = 'info', duration = 2600, icon: iconName = null } = {}) {
  if (typeof document === 'undefined') return null;
  const stack = getToastStack();
  const el = h('div', { class: `toast toast--${type}` },
    h('span', { class: 'toast__icon' }, icon(iconName || TOAST_ICONS[type] || 'info', { size: 16 })),
    h('span', { class: 'toast__msg' }, message));
  stack.append(el);
  while (stack.children.length > 4) stack.firstElementChild.remove();
  requestAnimationFrame(() => el.classList.add('is-in'));
  let done = false;
  const dismiss = () => {
    if (done) return;
    done = true;
    el.classList.remove('is-in');
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 260);
  };
  setTimeout(dismiss, duration);
  el.addEventListener('click', dismiss);
  return { dismiss };
}

// ------------------------------------------------------------------ modal

let openModals = 0;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function modal({ title = '', body = '', actions = [{ label: 'OK', primary: true }], dismissible = true, onClose = null, size = '' } = {}) {
  const previous = document.activeElement;
  const titleId = uid('modal-title');
  let closed = false;

  const api = { close, el: null };
  const backdrop = h('div', { class: 'modal-backdrop' });
  const actionBtns = (actions || []).map((a) =>
    h('button', {
      type: 'button',
      class: ['btn', a.primary ? 'btn--primary' : a.danger ? 'btn--bear' : 'btn--ghost'],
      on: {
        click: () => {
          const r = a.onClick ? a.onClick(api) : undefined;
          if (r !== false) close();
        },
      },
    }, a.label));
  const dialog = h('div', { class: ['modal', size && `modal--${size}`], role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    h('div', { class: 'modal__head' },
      h('h2', { class: 'modal__title', id: titleId }, title),
      dismissible ? h('button', { type: 'button', class: 'btn btn--ghost btn--icon modal__close', 'aria-label': 'Close', on: { click: () => close() } }, icon('x')) : null),
    h('div', { class: 'modal__body' }, typeof body === 'string' ? h('p', null, body) : body),
    actionBtns.length ? h('div', { class: 'modal__actions' }, actionBtns) : null);
  api.el = dialog;
  backdrop.append(dialog);

  function onKey(e) {
    if (e.key === 'Escape' && dismissible) {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!items.length) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    }
    // Keep page-level shortcuts (games, lessons) from firing under the modal.
    if (!['Tab', 'Enter', ' '].includes(e.key)) e.stopPropagation();
  }

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.classList.add('is-out');
    setTimeout(() => backdrop.remove(), reducedMotion() ? 0 : 180);
    openModals = Math.max(0, openModals - 1);
    if (!openModals) {
      document.body.classList.remove('has-modal');
      document.getElementById('app')?.removeAttribute('inert');
    }
    if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
    onClose?.();
  }

  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop && dismissible) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  openModals += 1;
  document.body.classList.add('has-modal');
  document.getElementById('app')?.setAttribute('inert', '');
  requestAnimationFrame(() => {
    backdrop.classList.add('is-in');
    const target = dialog.querySelector('.btn--primary') || dialog.querySelector(FOCUSABLE) || dialog;
    target.focus({ preventScroll: true });
  });
  return api;
}

// ------------------------------------------------------------------ confetti

function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

export function confetti(originEl = null) {
  if (typeof document === 'undefined' || reducedMotion()) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = h('canvas', { class: 'confetti-canvas', 'aria-hidden': 'true' });
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  document.body.append(canvas);
  const c2d = canvas.getContext('2d');
  if (!c2d) {
    canvas.remove();
    return;
  }
  c2d.scale(dpr, dpr);
  let ox = W / 2;
  let oy = H / 3;
  if (originEl?.getBoundingClientRect) {
    const r = originEl.getBoundingClientRect();
    ox = r.left + r.width / 2;
    oy = r.top + r.height / 2;
  }
  const colors = [cssVar('--accent', '#0A8F6A'), cssVar('--bull', '#27C990'), cssVar('--accent-soft', '#D5F1E7'), cssVar('--bear', '#D23F4A')];
  const parts = Array.from({ length: 110 }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25;
    const sp = 5 + Math.random() * 9;
    return {
      x: ox, y: oy,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
      w: 5 + Math.random() * 6, h: 3 + Math.random() * 5,
      c: colors[(Math.random() * colors.length) | 0],
      round: Math.random() < 0.3,
    };
  });
  const start = performance.now();
  const LIFE = 1700;
  function frame(now) {
    const t = now - start;
    c2d.clearRect(0, 0, W, H);
    const fade = t > LIFE - 450 ? Math.max(0, (LIFE - t) / 450) : 1;
    for (const p of parts) {
      p.vy += 0.28;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      c2d.save();
      c2d.globalAlpha = fade;
      c2d.translate(p.x, p.y);
      c2d.rotate(p.r);
      c2d.fillStyle = p.c;
      if (p.round) {
        c2d.beginPath();
        c2d.arc(0, 0, p.h / 1.4, 0, Math.PI * 2);
        c2d.fill();
      } else c2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      c2d.restore();
    }
    if (t < LIFE) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ sound (WebAudio, synthesized)

let actx = null;
let master = null;
let activated = false;
const lastPlayed = {};

if (typeof window !== 'undefined') {
  const mark = () => {
    activated = true;
  };
  window.addEventListener('pointerdown', mark, { capture: true, passive: true });
  window.addEventListener('keydown', mark, { capture: true });
}

function soundOn() {
  try {
    return store.state.settings.sound !== false;
  } catch {
    return true;
  }
}

function audio() {
  if (!activated && !globalThis.navigator?.userActivation?.hasBeenActive) return null;
  if (!actx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try {
      actx = new AC();
      master = actx.createGain();
      master.gain.value = 0.7;
      master.connect(actx.destination);
    } catch {
      actx = null;
      return null;
    }
  }
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}

// notes: [freq, startOffset, duration, wave, gain, slideTo]
function play(name, notes) {
  if (!soundOn()) return;
  const now = performance.now();
  if (lastPlayed[name] && now - lastPlayed[name] < 120) return; // de-dupe double triggers
  lastPlayed[name] = now;
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + 0.01;
  for (const [freq, off = 0, dur = 0.12, wave = 'sine', gain = 0.12, slide = null] of notes) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t0 + off);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t0 + off + dur);
    g.gain.setValueAtTime(0.0001, t0 + off);
    g.gain.linearRampToValueAtTime(gain, t0 + off + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0 + off);
    osc.stop(t0 + off + dur + 0.02);
  }
}

export const sfx = {
  correct: () => play('correct', [[659.25, 0, 0.1, 'triangle', 0.16], [987.77, 0.075, 0.2, 'triangle', 0.14]]),
  wrong: () => play('wrong', [[293.66, 0, 0.13, 'triangle', 0.16, 261.63], [220, 0.1, 0.22, 'triangle', 0.14, 196]]),
  tick: () => play('tick', [[1320, 0, 0.035, 'sine', 0.05]]),
  click: () => play('click', [[880, 0, 0.03, 'sine', 0.05]]),
  win: () => play('win', [[523.25, 0, 0.14, 'triangle', 0.13], [659.25, 0.09, 0.14, 'triangle', 0.13], [783.99, 0.18, 0.14, 'triangle', 0.13], [1046.5, 0.27, 0.42, 'triangle', 0.13]]),
  badge: () => play('badge', [[783.99, 0, 0.12, 'sine', 0.12], [1174.66, 0.08, 0.3, 'sine', 0.1]]),
  whoosh: () => play('whoosh', [[400, 0, 0.18, 'sine', 0.05, 900]]),
};

// ------------------------------------------------------------------ quiz

// Registry for the 1–9 keyboard shortcut. Entries are weak references to quiz roots, so a quiz
// whose DOM was detached (route change, next question) can be garbage-collected; dead or
// finished-and-detached entries are pruned whenever a new quiz registers and on each digit key.
let activeQuizzes = [];
let quizKeysBound = false;

const weakRef = (el) => (typeof WeakRef === 'function' ? new WeakRef(el) : { deref: () => el });

/**
 * Drop registry entries whose quiz is gone (collected) or answered and no longer in the DOM.
 * Unanswered quizzes that are merely not attached yet are kept. Pure: returns a new array.
 * @param {Array<{ deref: () => any }>} refs
 */
export function pruneQuizRegistry(refs) {
  return (refs || []).filter((ref) => {
    const el = ref?.deref?.();
    if (!el) return false;
    return el.isConnected || !el._quiz?.answered();
  });
}

function bindQuizKeys() {
  if (quizKeysBound || typeof document === 'undefined') return;
  quizKeysBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (document.body.classList.contains('has-modal')) return;
    if (!/^[1-9]$/.test(e.key)) return;
    activeQuizzes = pruneQuizRegistry(activeQuizzes);
    for (let i = activeQuizzes.length - 1; i >= 0; i--) {
      const el = activeQuizzes[i].deref();
      if (!el?.isConnected || el._quiz.answered()) continue;
      const idx = Number(e.key) - 1;
      if (idx < el._quiz.count) {
        e.preventDefault();
        el.choose(idx);
      }
      return;
    }
  });
}

/**
 * Multiple-choice question with accessible option buttons.
 * options: [{ label, node?, value }]; answer: value or (value) => boolean.
 * explain: string (HTML) | Node | (correct, value) => string|Node.
 * Keyboard: 1–9 pick an option. Marks correct/wrong with colour and an icon.
 */
export function choiceQuiz({ question = '', options = [], answer, explain = null, onAnswer = null, sfx: withSfx = true, columns = null } = {}) {
  let answered = false;
  const isRight = typeof answer === 'function' ? answer : (v) => v === answer;
  const qId = uid('quiz-q');
  const visual = options.some((o) => o.node);
  const root = h('div', { class: 'quiz' });
  if (question) root.append(h('div', { class: 'quiz__q', id: qId }, question));
  const grid = h('div', {
    class: ['option-grid', visual && 'option-grid--visual'],
    role: 'group',
    ...(question ? { 'aria-labelledby': qId } : { 'aria-label': 'Answer options' }),
    ...(columns ? { style: { '--cols': columns } } : {}),
  });
  const status = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const explainHost = h('div', { class: 'quiz__explain' });

  const buttons = options.map((opt, i) =>
    h('button', {
      type: 'button',
      class: 'option',
      'data-value': String(opt.value),
      on: { click: () => choose(i) },
    },
    i < 9 ? h('span', { class: 'option__key', 'aria-hidden': 'true' }, String(i + 1)) : null,
    opt.node ? h('span', { class: 'option__media' }, opt.node) : null,
    h('span', { class: 'option__label' }, opt.label),
    h('span', { class: 'option__mark', 'aria-hidden': 'true' })));
  grid.append(...buttons);
  root.append(grid, status, explainHost);

  function choose(i) {
    if (answered) return;
    answered = true;
    const opt = options[i];
    const correct = !!isRight(opt.value);
    root.classList.add('is-answered');
    buttons.forEach((b, j) => {
      b.setAttribute('aria-disabled', 'true');
      b.classList.add('is-locked');
      const right = !!isRight(options[j].value);
      const mark = b.querySelector('.option__mark');
      if (j === i) {
        b.classList.add('is-selected', correct ? 'is-correct' : 'is-wrong');
        b.setAttribute('aria-pressed', 'true');
        mark.append(icon(correct ? 'check' : 'x', { size: 18 }));
      } else if (right) {
        b.classList.add('is-correct', 'is-reveal');
        mark.append(icon('check', { size: 18 }));
      } else b.classList.add('is-dim');
    });
    const rightOpt = options.find((o) => isRight(o.value));
    status.textContent = correct ? 'Correct.' : `Not quite. The answer is ${rightOpt ? rightOpt.label : 'shown'}.`;
    if (withSfx) (correct ? sfx.correct : sfx.wrong)();
    let ex = typeof explain === 'function' ? explain(correct, opt.value) : explain;
    if (ex != null && ex !== '') {
      explainHost.append(explainer(ex, correct ? 'good' : 'bad'));
    }
    onAnswer?.(correct, opt.value);
  }

  root.choose = choose;
  root._quiz = { answered: () => answered, count: Math.min(9, options.length) };
  activeQuizzes = pruneQuizRegistry(activeQuizzes);
  activeQuizzes.push(weakRef(root));
  bindQuizKeys();
  return root;
}
