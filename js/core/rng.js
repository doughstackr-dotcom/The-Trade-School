// Seeded pseudo-random numbers (mulberry32) so every scenario can be replayed from its seed.
// Pure module: no DOM access, importable from node:test.

/** 32-bit string hash (cyrb53-style mix), optionally salted with a numeric seed. */
export function hashString(str, salt = 0) {
  let h1 = 0xdeadbeef ^ salt;
  let h2 = 0x41c6ce57 ^ salt;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ (h2 >>> 1)) >>> 0;
}

/** Normalise any seed-ish value (number, numeric string, string) to a uint32. */
export function toSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return Number.isInteger(seed) ? seed >>> 0 : hashString(String(seed));
  }
  if (typeof seed === 'string' && seed.length) {
    return /^\d+$/.test(seed) ? Number(seed) >>> 0 : hashString(seed);
  }
  return 0x9e3779b9;
}

/**
 * makeRng(seed) → deterministic generator.
 *   next() [0,1) · float(min,max) · int(min,max) inclusive · pick(arr) · shuffle(arr) (new array)
 *   chance(p) · gauss(mean, sd) · sign() · fork(label) · weighted(items, weights) · sample(arr, n)
 * `rng.seed` is the normalised uint32 seed. fork(label) derives a child generator from the
 * ORIGINAL seed and the label, so forks are stable no matter how many numbers were drawn.
 */
export function makeRng(seed) {
  const s0 = toSeed(seed);
  let a = s0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng = {
    seed: s0,
    next,
    float(min = 0, max = 1) {
      return min + (max - min) * next();
    },
    int(min, max) {
      let lo = Math.ceil(Math.min(min, max));
      let hi = Math.floor(Math.max(min, max));
      if (hi < lo) hi = lo;
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    pick(array) {
      if (!array || !array.length) return undefined;
      return array[Math.floor(next() * array.length)];
    },
    shuffle(array) {
      const out = Array.from(array || []);
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    },
    chance(p = 0.5) {
      return next() < p;
    },
    gauss(mean = 0, sd = 1) {
      // Box–Muller; 1 - next() is in (0, 1] so log() is finite.
      const u = 1 - next();
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    sign() {
      return next() < 0.5 ? -1 : 1;
    },
    fork(label = '') {
      return makeRng(hashString(String(label), s0));
    },
    /** Pick an item with probability proportional to its weight. */
    weighted(items, weights) {
      const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
      if (!(total > 0)) return rng.pick(items);
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= Math.max(0, weights[i]);
        if (r < 0) return items[i];
      }
      return items[items.length - 1];
    },
    /** n distinct items (order random). */
    sample(array, n) {
      return rng.shuffle(array).slice(0, Math.max(0, n));
    },
  };
  return rng;
}

/** A fresh uint32 seed. The only place Math.random() is used. */
export function randomSeed() {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
