// Real-market plumbing for games: lazy scanner/market loaders and a promise timeout.
// scanner.js / market.js are loaded on demand so textbook-only pages never fetch them.
// Part of the game kit; import from js/core/game-kit.js, the public facade.

/** Resolves with the promise's value, or `null` after `ms` (rejections pass through). */
export function withTimeout(promise, ms) {
  let timer = 0;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

let scannerPromise = null;
let marketPromise = null;

/** import('../scanner.js'), cached; a failed import is retried next time. */
export function loadScanner() {
  if (!scannerPromise) {
    scannerPromise = import('../scanner.js').catch((err) => {
      scannerPromise = null;
      throw err;
    });
  }
  return scannerPromise;
}

/** import('../market.js'), cached; a failed import is retried next time. */
export function loadMarket() {
  if (!marketPromise) {
    marketPromise = import('../market.js').catch((err) => {
      marketPromise = null;
      throw err;
    });
  }
  return marketPromise;
}
