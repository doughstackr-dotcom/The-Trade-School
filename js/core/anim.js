// Tween / sequence helpers. Reduced-motion aware. No DOM access at import time.

const hasRaf = () => typeof requestAnimationFrame === 'function';
export const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
export const raf = (fn) => (hasRaf() ? requestAnimationFrame(fn) : setTimeout(() => fn(now()), 16));
export const cancelRaf = (id) => {
  if (id == null) return;
  if (hasRaf()) cancelAnimationFrame(id);
  else clearTimeout(id);
};

/**
 * True when the user prefers reduced motion (OS setting), or when the app sets
 * <html data-motion="reduce"> (in-app setting).
 */
export const reducedMotion = () => {
  try {
    if (typeof document !== 'undefined' && document.documentElement?.dataset?.motion === 'reduce') return true;
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

const linear = (t) => t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const ease = { linear, easeOutCubic, easeInOutCubic, easeOutBack };

function lerpFn(from, to) {
  if (Array.isArray(from)) return (p) => from.map((f, i) => f + ((to?.[i] ?? f) - f) * p);
  if (from && typeof from === 'object') {
    const keys = Object.keys(from);
    return (p) => {
      const out = {};
      for (const k of keys) out[k] = from[k] + ((to?.[k] ?? from[k]) - from[k]) * p;
      return out;
    };
  }
  return (p) => from + (to - from) * p;
}

/**
 * tween({ from, to, duration = 400, ease, onUpdate }) → Promise<boolean>
 * from/to may be numbers, arrays of numbers or flat objects of numbers.
 * onUpdate(value, progress) runs every frame. The promise resolves true when finished,
 * false when cancelled via promise.cancel(). With reduced motion it jumps to the end.
 */
export function tween({ from = 0, to = 1, duration = 400, ease: fn = easeOutCubic, onUpdate, delay = 0 } = {}) {
  const lerp = lerpFn(from, to);
  let id = null;
  let timer = null;
  let done = false;
  let resolveP;
  const promise = new Promise((resolve) => {
    resolveP = resolve;
  });
  const finish = (ok) => {
    if (done) return;
    done = true;
    cancelRaf(id);
    clearTimeout(timer);
    resolveP(ok);
  };
  promise.cancel = () => finish(false);

  if (reducedMotion() || !(duration > 0)) {
    try {
      onUpdate?.(lerp(1), 1);
    } finally {
      finish(true);
    }
    return promise;
  }

  const begin = () => {
    const t0 = now();
    const frame = () => {
      if (done) return;
      const p = Math.min(1, (now() - t0) / duration);
      onUpdate?.(lerp(fn(p)), p);
      if (p >= 1) finish(true);
      else id = raf(frame);
    };
    onUpdate?.(lerp(0), 0);
    id = raf(frame);
  };
  if (delay > 0) timer = setTimeout(begin, delay);
  else begin();
  return promise;
}

/** Resolves after `ms` (immediately with reduced motion). */
export function sleep(ms) {
  if (reducedMotion() || !(ms > 0)) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * sequence(steps) → { play(), stop(), done }
 * steps are functions returning a Promise (or nothing). play() runs them in order and
 * returns `done`; stop() halts before the next step and resolves `done` with false.
 * `done` resolves true when every step ran.
 */
export function sequence(steps = []) {
  let started = false;
  let stopped = false;
  let settled = false;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const settle = (v) => {
    if (settled) return;
    settled = true;
    resolveDone(v);
  };
  const run = async () => {
    for (const step of steps) {
      if (stopped) return;
      try {
        await step();
      } catch (err) {
        console.error(err);
        stopped = true;
        settle(false);
        return;
      }
    }
    settle(!stopped);
  };
  return {
    play() {
      if (!started && !stopped) {
        started = true;
        run();
      }
      return done;
    },
    stop() {
      stopped = true;
      settle(false);
    },
    get stopped() {
      return stopped;
    },
    done,
  };
}

function formatNumber(v, decimals) {
  const n = Number(v);
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Animate an element's text from `from` (default: its current number, else 0) to `to`. */
export function countUp(el, to, { duration = 700, decimals = 0, prefix = '', suffix = '', from } = {}) {
  if (!el) return Promise.resolve(false);
  let start = from;
  if (start == null) {
    const parsed = parseFloat(String(el.textContent || '').replace(/[^0-9.+-]/g, ''));
    start = Number.isFinite(parsed) ? parsed : 0;
  }
  return tween({
    from: start,
    to,
    duration,
    ease: easeOutCubic,
    onUpdate: (v) => {
      el.textContent = `${prefix}${formatNumber(v, decimals)}${suffix}`;
    },
  });
}
