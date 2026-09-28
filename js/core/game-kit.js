// GameShell: shared intro → rounds → results flow so every game feels the same.
// Scoring: game.correct() adds points × streak multiplier (streak ≥ 3 → ×1.5, ≥ 6 → ×2).
// Stars, XP and "perfect" use the base points (before the streak bonus) against maxScore.
//
// Play styles (ARCHITECTURE §12.1): the intro offers Practice (no clock, hints, retries, half XP,
// player-chosen difficulty), Arcade (fixed rounds, clock, streaks) and Survival (3 lives, rounds
// until they run out, difficulty ramps). Chart sources (§12.2): Textbook or Real market, with
// game.realRound() / game.revealSource() for "mystery chart" rounds and a textbook fallback.
//
// Public facade. The kit lives in js/core/game-kit/:
//   shell.js          GameShell flow + public API (award, correct, ask, realRound, finish…)
//   shell-view.js     GameShell intro / HUD / results DOM (prototype mixin)
//   timer.js          round clock
//   real-data.js      lazy scanner / market loaders, withTimeout
//   labels.js         heart / style icons, market date labels, source reveal card
//   question-bank.js  QuestionBank, bankOptions, explainChoice, bindSwipeCard, trackAnswer
//   util.js           shared constants and small helpers
// Import from this file; the split is an implementation detail.

import { GameShell } from './game-kit/shell.js';

export { GameShell };
export { withTimeout, loadScanner, loadMarket } from './game-kit/real-data.js';
export {
  heartIcon, styleIcon, intervalLabel, formatMarketDate, marketTimeLabel, sourceText, sourceReveal,
} from './game-kit/labels.js';
export { QuestionBank, bankOptions, explainChoice, bindSwipeCard, trackAnswer } from './game-kit/question-bank.js';

export default GameShell;
