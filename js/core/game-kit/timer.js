// Round clock for GameShell: countdown bar, pause/resume on tab visibility, scaled by play style.
// Part of the game kit; import from js/core/game-kit.js, the public facade.

import { sfx } from '../ui.js';

export function createTimer(game) {
  let raf = 0;
  let total = 0;
  let endAt = 0;
  let pausedLeft = null;
  let expire = null;
  let lastTick = null;
  let running = false;

  const render = () => {
    const left = Math.max(0, pausedLeft != null ? pausedLeft : endAt - performance.now());
    const frac = total ? left / total : 0;
    game._timerFill.style.transform = `scaleX(${frac})`;
    game._timerText.textContent = `${Math.ceil(left / 1000)}s`;
    game._timerBar.classList.toggle('is-low', frac <= 0.3);
    return left;
  };

  const loop = () => {
    if (!running || pausedLeft != null) return;
    if (!game._alive()) {
      running = false;
      return;
    }
    const left = render();
    const sec = Math.ceil(left / 1000);
    if (sec <= 3 && sec > 0 && sec !== lastTick) {
      lastTick = sec;
      sfx.tick();
    }
    if (left <= 0) {
      running = false;
      const fn = expire;
      expire = null;
      fn?.();
      return;
    }
    raf = requestAnimationFrame(loop);
  };

  return {
    /** Starts the clock. Returns false (and does nothing) when the style has no clock (Practice). */
    start(seconds, onExpire) {
      this.stop();
      if (!game.timed) {
        game._timerBar.hidden = true;
        return false;
      }
      total = Math.max(0.1, seconds) * 1000;
      endAt = performance.now() + total;
      pausedLeft = null;
      expire = onExpire || null;
      lastTick = null;
      running = true;
      game._timerBar.hidden = false;
      render();
      raf = requestAnimationFrame(loop);
      return true;
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      pausedLeft = null;
    },
    pause() {
      if (!running || pausedLeft != null) return;
      pausedLeft = Math.max(0, endAt - performance.now());
      cancelAnimationFrame(raf);
    },
    resume() {
      if (!running || pausedLeft == null) return;
      endAt = performance.now() + pausedLeft;
      pausedLeft = null;
      raf = requestAnimationFrame(loop);
    },
    hide() {
      this.stop();
      game._timerBar.hidden = true;
    },
    get remaining() {
      if (!running) return 0;
      return Math.max(0, (pausedLeft != null ? pausedLeft : endAt - performance.now()) / 1000);
    },
    get running() {
      return running;
    },
    get paused() {
      return running && pausedLeft != null;
    },
  };
}
