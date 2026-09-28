// GameShell shared constants and small helpers (result lines, streak multiplier, number tween).
// Part of the game kit; import from js/core/game-kit.js, the public facade.

import { fmt, reducedMotion } from '../ui.js';
import { STYLES, DIFFICULTY_LEVELS } from '../../registry.js';

export const STAR_LINES = [
  ['Keep practising', 'Every pro started here. Review the lesson and run it back.'],
  ['Good start', 'You are reading the chart. Tighten up and go again.'],
  ['Solid trading', 'Consistent reads. One more run for the third star?'],
  ['Outstanding', 'Sharp, fast and accurate. That is a three-star read.'],
];

export const SURVIVAL_LINES = [
  ['Out of lives', 'Every run teaches something. Go again and push further.'],
  ['Still standing', 'You made it past the warm-up. The rounds only get harder from here.'],
  ['Hard to knock out', 'Deep into the run. One more push for the third star.'],
  ['Unbreakable', 'The market threw everything at you. That is a three-star run.'],
];

export const STYLE_IDS = STYLES.map((s) => s.id);
export const LEVEL_VALUE = Object.fromEntries(DIFFICULTY_LEVELS.map((l) => [l.id, l.value]));
export const SURVIVAL_DEFAULTS = { ramp: 15, stars: [5, 10, 15], clockMin: 0.6 };
export const REAL_FAILS_BEFORE_SWITCH = 3;

export function isTypingTarget(t) {
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export function multiplierFor(streak) {
  if (streak >= 6) return 2;
  if (streak >= 3) return 1.5;
  return 1;
}

export function animateNumber(el, from, to, duration = 450) {
  if (reducedMotion() || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (t < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
