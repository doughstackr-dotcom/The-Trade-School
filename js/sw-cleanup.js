const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;
const KEY_OPT = 'tts-sw';
export const CLEARED_PARAM = 'tts-sw-cleared';

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function queryFlag() {
  try {
    return new URLSearchParams(location.search).get('sw');
  } catch {
    return null;
  }
}

export function shouldKeepServiceWorker() {
  const flag = queryFlag();
  if (flag === '1') return true;
  if (flag === '0') return false;
  const saved = read(KEY_OPT);
  if (saved === '1') return true;
  if (saved === '0') return false;
  return false;
}

export function workerCleanupUrl() {
  const url = new URL(location.href);
  if (url.searchParams.get(CLEARED_PARAM) === '1') return null;
  url.searchParams.set(CLEARED_PARAM, '1');
  return url.href;
}

export async function clearRegisteredWorkers() {
  if (!('serviceWorker' in navigator)) return false;
  const regs = await navigator.serviceWorker.getRegistrations();
  const workers = [navigator.serviceWorker.controller, ...regs.flatMap((r) => [r.active, r.waiting, r.installing])];
  for (const w of workers) {
    try {
      w?.postMessage({ type: 'DISABLE' });
    } catch {
      /* gone */
    }
  }
  await Promise.all(regs.map((r) => r.unregister()));
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('tts-')).map((k) => caches.delete(k)));
  }
  return regs.length > 0 || !!navigator.serviceWorker.controller;
}

export async function clearStaleWorkerForFreshBoot() {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return false;
  if (shouldKeepServiceWorker()) return false;
  try {
    const cleared = await clearRegisteredWorkers();
    const href = cleared ? workerCleanupUrl() : null;
    if (!href) return false;
    location.replace(href);
    return true;
  } catch {
    const href = workerCleanupUrl();
    if (href) {
      location.replace(href);
      return true;
    }
    return false;
  }
}

export function isLocalHost() {
  return LOCAL_HOST.test(location.hostname);
}
