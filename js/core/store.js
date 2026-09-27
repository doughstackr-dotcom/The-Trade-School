// Progress store: XP, levels, lesson completions, game bests, badges and settings.
// Persisted to localStorage under 'tts-progress-v1'. Every storage access is wrapped in
// try/catch; when storage is unavailable the app keeps working from memory.
import { LESSONS, GAMES, findBadge, learningPath } from '../registry.js';
import { toast, modal, h, icon } from './ui.js';

const KEY = 'tts-progress-v1';
const THEME_KEY = 'tts-theme';

export const LEVELS = [
  { title: 'Paper Trader', min: 0 },
  { title: 'Chart Reader', min: 150 },
  { title: 'Swing Spotter', min: 400 },
  { title: 'Level Hunter', min: 800 },
  { title: 'Pattern Pro', min: 1300 },
  { title: 'Setup Sniper', min: 2000 },
  { title: 'Risk Manager', min: 2900 },
  { title: 'Market Wizard', min: 4000 },
];

function defaults(settings) {
  return {
    v: 1,
    xp: 0,
    lessons: {},          // id -> { done, at }
    games: {},            // id -> { best, stars, plays, at, modes: { modeId: best } }
    badges: [],           // badge ids, in the order earned
    badgeDates: {},       // id -> timestamp
    lessonSteps: {},      // id -> { step, max }  (resume position)
    last: null,           // { type: 'lesson'|'game', id, at }  ("Continue where you left off")
    lastTier: null,       // 'beginner' | 'advanced' — last track page visited
    bestStreak: 0,
    settings: { sound: true, theme: 'system', ...(settings || {}) },
  };
}

function readTheme() {
  try {
    const t = globalThis.localStorage?.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

function load() {
  const base = defaults();
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        Object.assign(base, saved);
        base.settings = { ...defaults().settings, ...(saved.settings || {}) };
        for (const k of ['lessons', 'games', 'badgeDates', 'lessonSteps']) {
          if (!base[k] || typeof base[k] !== 'object') base[k] = {};
        }
        if (!Array.isArray(base.badges)) base.badges = [];
        base.xp = Number.isFinite(base.xp) ? base.xp : 0;
      }
    }
  } catch {
    /* corrupted or blocked storage: start fresh in memory */
  }
  base.settings.theme = readTheme();
  return base;
}

let state = load();
const listeners = new Map();
let collecting = null; // array while recordGame collects newly earned badges

function save() {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked: progress stays in memory */
  }
}

function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(payload, state);
    } catch (err) {
      console.error(err);
    }
  }
}

function changed() {
  save();
  emit('change', state);
}

export function levelFor(xp) {
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].min) index = i;
  const cur = LEVELS[index];
  const nextLevel = LEVELS[index + 1] || null;
  const next = nextLevel ? nextLevel.min : null;
  const progress = next == null ? 1 : Math.max(0, Math.min(1, (xp - cur.min) / (next - cur.min)));
  return { index, number: index + 1, title: cur.title, min: cur.min, next, nextTitle: nextLevel?.title || null, progress, xp };
}

function showLevelUp(lv) {
  if (typeof document === 'undefined') return;
  const body = h('div', { class: 'levelup' },
    h('div', { class: 'levelup__badge', 'aria-hidden': 'true' }, icon('crown', { size: 34 })),
    h('p', { class: 'levelup__num mono' }, `Level ${lv.number}`),
    h('p', { class: 'levelup__title' }, lv.title),
    h('p', { class: 'muted' }, lv.next
      ? `Next up: ${lv.nextTitle} at ${lv.next.toLocaleString()} XP.`
      : 'You reached the top level. Keep practising — the market never stops teaching.'),
  );
  setTimeout(() => {
    modal({ title: 'Level up!', body, actions: [{ label: 'Keep going', primary: true }] });
  }, 650);
}

function tierLessonsDone(tier) {
  const list = LESSONS.filter((l) => l.tier === tier);
  return list.length > 0 && list.every((l) => state.lessons[l.id]?.done);
}

function checkMetaBadges(silent) {
  const opts = { silent };
  if (Object.values(state.lessons).some((l) => l?.done)) store.award('first-lesson', opts);
  if (Object.values(state.games).some((g) => g?.plays > 0)) store.award('first-game', opts);
  if (tierLessonsDone('beginner')) store.award('beginner-graduate', opts);
  if (tierLessonsDone('advanced')) store.award('advanced-graduate', opts);
  if (state.xp >= 1000) store.award('xp-1000', opts);
  if (state.xp >= 4000) store.award('xp-4000', opts);
  if (GAMES.every((g) => state.games[g.id]?.plays > 0)) store.award('explorer', opts);
}

export const store = {
  get state() {
    return state;
  },

  level(xp = state.xp) {
    return levelFor(xp);
  },

  /** Add XP. opts.silent suppresses the "+n XP" toast (the level-up modal still shows). */
  addXP(n, reason = '', opts = {}) {
    const amount = Math.max(0, Math.round(Number(n) || 0));
    if (!amount) return 0;
    const before = levelFor(state.xp);
    state.xp += amount;
    const after = levelFor(state.xp);
    if (!opts.silent) toast(`+${amount} XP${reason ? ` · ${reason}` : ''}`, { type: 'xp' });
    emit('xp', { amount, total: state.xp, reason });
    if (after.index > before.index) {
      emit('level', after);
      if (!opts.noModal) showLevelUp(after);
    }
    checkMetaBadges(opts.silent);
    changed();
    return amount;
  },

  isLessonDone(id) {
    return !!state.lessons[id]?.done;
  },

  /** Marks a lesson done. First completion awards 50 XP. Returns true the first time. */
  completeLesson(id, opts = {}) {
    if (state.lessons[id]?.done) {
      state.lessons[id].at = Date.now();
      changed();
      return false;
    }
    state.lessons[id] = { done: true, at: Date.now() };
    this.addXP(50, 'Lesson complete', opts);
    checkMetaBadges(opts.silent);
    changed();
    return true;
  },

  gameStats(id) {
    return state.games[id] || null;
  },

  /**
   * Records a finished game. XP = opts.xp if given, else round(min(1, score/maxScore)*60) + 10*stars.
   * Awards first-game, <id>-ace (3 stars), perfect-score (opts.perfect), explorer and XP badges.
   * Badges earned here are silent (the results screen lists them) → { isBest, xp, newBadges, best }.
   */
  recordGame(id, { score = 0, stars = 0, mode = null, maxScore = null, xp = null, perfect = false } = {}) {
    const g = state.games[id] || (state.games[id] = { best: 0, stars: 0, plays: 0 });
    const isBest = g.plays === 0 ? score > 0 : score > g.best;
    g.plays = (g.plays || 0) + 1;
    g.best = Math.max(g.best || 0, score);
    g.stars = Math.max(g.stars || 0, stars);
    g.at = Date.now();
    if (mode) {
      g.modes = g.modes || {};
      g.modes[mode] = Math.max(g.modes[mode] || 0, score);
    }
    const gained = xp != null
      ? Math.round(xp)
      : Math.round((maxScore ? Math.min(1, score / maxScore) : 0) * 60) + 10 * stars;

    collecting = [];
    let newBadges = [];
    try {
      if (stars >= 3 && findBadge(`${id}-ace`)) this.award(`${id}-ace`, { silent: true });
      if (perfect) this.award('perfect-score', { silent: true });
      this.addXP(gained, '', { silent: true });
      checkMetaBadges(true);
    } finally {
      newBadges = collecting;
      collecting = null;
    }
    changed();
    return { isBest, xp: gained, newBadges, best: g.best };
  },

  /** Awards a badge. Returns true if newly earned (toasts unless opts.silent). */
  award(badgeId, opts = {}) {
    if (!badgeId || state.badges.includes(badgeId)) return false;
    const badge = findBadge(badgeId);
    if (!badge) return false;
    state.badges.push(badgeId);
    state.badgeDates[badgeId] = Date.now();
    if (collecting) collecting.push(badgeId);
    if (!opts.silent) toast(`Badge earned: ${badge.title}`, { type: 'badge', icon: badge.icon });
    emit('badge', badge);
    changed();
    return true;
  },

  has(badgeId) {
    return state.badges.includes(badgeId);
  },

  getSetting(key) {
    return state.settings[key];
  },

  setSetting(key, value) {
    state.settings[key] = value;
    if (key === 'theme') {
      try {
        if (value === 'light' || value === 'dark') globalThis.localStorage?.setItem(THEME_KEY, value);
        else globalThis.localStorage?.removeItem(THEME_KEY);
      } catch {
        /* ignore */
      }
    }
    changed();
  },

  /** Remember the last lesson/game visited (for "Continue where you left off"). */
  setLast(item) {
    if (!item || !item.id) return;
    state.last = { type: item.type, id: item.id, at: Date.now() };
    save();
  },

  setLastTier(tier) {
    if (tier !== 'beginner' && tier !== 'advanced') return;
    state.lastTier = tier;
    save();
  },

  getLessonStep(id) {
    return state.lessonSteps[id] || { step: 0, max: 0 };
  },

  setLessonStep(id, step, max) {
    const prev = state.lessonSteps[id] || { step: 0, max: 0 };
    state.lessonSteps[id] = { step, max: Math.max(prev.max || 0, max ?? step) };
    save();
  },

  noteStreak(n) {
    if (n > (state.bestStreak || 0)) {
      state.bestStreak = n;
      save();
    }
  },

  /** Completion of a tier: lessons done + games with at least one star. */
  tierProgress(tier) {
    const path = learningPath(tier);
    let done = 0;
    for (const p of path) {
      if (p.type === 'lesson' ? state.lessons[p.id]?.done : (state.games[p.id]?.stars || 0) >= 1) done++;
    }
    const lessons = path.filter((p) => p.type === 'lesson');
    return {
      done,
      total: path.length,
      pct: path.length ? done / path.length : 0,
      lessonsDone: lessons.filter((p) => state.lessons[p.id]?.done).length,
      lessonsTotal: lessons.length,
    };
  },

  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => this.off(event, fn);
  },

  off(event, fn) {
    listeners.get(event)?.delete(fn);
  },

  /** Wipes progress (keeps sound/theme settings). */
  reset() {
    state = defaults(state.settings);
    changed();
    emit('xp', { amount: 0, total: 0, reason: 'reset' });
  },
};

// Keep several open tabs in sync.
try {
  globalThis.addEventListener?.('storage', (e) => {
    if (e.key !== KEY) return;
    state = load();
    emit('change', state);
  });
} catch {
  /* not in a browser */
}

export default store;
