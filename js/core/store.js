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
    games: {},            // id -> { best, stars, plays, at, modes: { modeId: best }, lastStyle,
                          //        styles: { styleId: { best, stars, plays, at, rounds?, lastRounds? } } }
    badges: [],           // badge ids, in the order earned
    badgeDates: {},       // id -> timestamp
    lessonSteps: {},      // id -> { step, max }  (resume position)
    last: null,           // { type: 'lesson'|'game', id, at }  ("Continue where you left off")
    lastTier: null,       // 'beginner' | 'advanced' — last track page visited
    bestStreak: 0,
    gamePrefs: {},        // id -> { style, source, level, mode }  (remembered intro choices)
    daily: { last: null, streak: 0, best: 0, history: {} },   // Daily Challenge (local dates)
    settings: { sound: true, theme: 'system', ...(settings || {}) },
  };
}

// ---------------------------------------------------------------- daily challenge dates
// Daily keys are LOCAL calendar dates ('YYYY-MM-DD'): everyone on the same date gets the same
// challenge, and a streak continues when the previous completion was on the previous date.

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function dailyKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function shiftKey(key, days) {
  const [y, m, d] = String(key).split('-').map(Number);
  if (!y || !m || !d) return null;
  return dailyKey(new Date(y, m - 1, d + days));
}

/** Legacy game records (before play styles) count as Arcade. Mutates and returns g.styles. */
function stylesOf(g) {
  if (!g) return {};
  if (!g.styles || typeof g.styles !== 'object') {
    g.styles = g.plays ? { arcade: { best: g.best || 0, stars: g.stars || 0, plays: g.plays || 0, at: g.at || null } } : {};
  }
  return g.styles;
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
        for (const k of ['lessons', 'games', 'badgeDates', 'lessonSteps', 'gamePrefs']) {
          if (!base[k] || typeof base[k] !== 'object') base[k] = {};
        }
        const dd = defaults().daily;
        base.daily = base.daily && typeof base.daily === 'object' ? { ...dd, ...base.daily } : dd;
        if (!base.daily.history || typeof base.daily.history !== 'object') base.daily.history = {};
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
  const allStyles = Object.values(state.games).some((g) => {
    const st = g?.styles;
    return !!st && ['practice', 'arcade', 'survival'].every((k) => st[k]?.plays > 0);
  });
  if (allStyles) store.award('play-your-way', opts);
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

  /** Per-style record of a game ({ best, stars, plays, at, rounds? }) or null. Legacy plays count as 'arcade'. */
  styleStats(id, style = 'arcade') {
    const g = state.games[id];
    if (!g) return null;
    return stylesOf(g)[style] || null;
  },

  /**
   * Records a finished game. XP = opts.xp if given, else round(min(1, score/maxScore)*60) + 10*stars.
   * Awards first-game, <id>-ace (3 stars), perfect-score (opts.perfect), explorer, survivor,
   * play-your-way and XP badges. Badges earned here are silent (the results screen lists them).
   * opts.style ('practice'|'arcade'|'survival', default 'arcade') keeps a best per (game, style);
   * opts.rounds (survival: rounds survived) keeps the best rounds for that style.
   * → { isBest, xp, newBadges, best, style, styleBest, isStyleBest, overallBest, isOverallBest,
   *     rounds, bestRounds, isBestRounds }
   * When opts.style is given, isBest/best refer to that style; without it they are overall (legacy).
   */
  recordGame(id, { score = 0, stars = 0, mode = null, maxScore = null, xp = null, perfect = false, style = null, rounds = null } = {}) {
    const g = state.games[id] || (state.games[id] = { best: 0, stars: 0, plays: 0 });
    const styles = stylesOf(g);
    const st = style || 'arcade';
    const s = styles[st] || (styles[st] = { best: 0, stars: 0, plays: 0 });
    const isOverallBest = g.plays === 0 ? score > 0 : score > g.best;
    const isStyleBest = s.plays === 0 ? score > 0 : score > s.best;
    g.plays = (g.plays || 0) + 1;
    g.best = Math.max(g.best || 0, score);
    g.stars = Math.max(g.stars || 0, stars);
    g.at = Date.now();
    g.lastStyle = st;
    s.plays = (s.plays || 0) + 1;
    s.best = Math.max(s.best || 0, score);
    s.stars = Math.max(s.stars || 0, stars);
    s.at = g.at;
    let isBestRounds = false;
    if (rounds != null && Number.isFinite(rounds)) {
      isBestRounds = rounds > (s.rounds || 0);
      s.rounds = Math.max(s.rounds || 0, rounds);
      s.lastRounds = rounds;
    }
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
      if (st === 'survival' && (rounds || 0) >= 15) this.award('survivor', { silent: true });
      this.addXP(gained, '', { silent: true });
      checkMetaBadges(true);
    } finally {
      newBadges = collecting;
      collecting = null;
    }
    changed();
    const scoped = style != null;
    return {
      isBest: scoped ? isStyleBest : isOverallBest,
      xp: gained,
      newBadges,
      best: scoped ? s.best : g.best,
      style: st,
      styleBest: s.best,
      isStyleBest,
      overallBest: g.best,
      isOverallBest,
      rounds: rounds ?? null,
      bestRounds: s.rounds ?? null,
      isBestRounds,
    };
  },

  /** Remembered intro choice for a game (style, source, level, mode…). */
  getGamePref(id, key, fallback = null) {
    const v = state.gamePrefs?.[id]?.[key];
    return v === undefined || v === null ? fallback : v;
  },

  setGamePref(id, key, value) {
    if (!id || !key) return;
    if (!state.gamePrefs || typeof state.gamePrefs !== 'object') state.gamePrefs = {};
    const p = state.gamePrefs[id] || (state.gamePrefs[id] = {});
    if (p[key] === value) return;
    p[key] = value;
    save();
  },

  /** Today's Daily Challenge key ('YYYY-MM-DD', local date). */
  dailyKey(date) {
    return dailyKey(date);
  },

  /**
   * → { key, done, score, streak, best, last, alive }. `streak` is the current streak: it only
   * counts while the last completion was today or yesterday (otherwise 0); `best` is the record.
   */
  dailyStatus(date) {
    const key = dailyKey(date);
    const d = state.daily || {};
    const alive = d.last === key || d.last === shiftKey(key, -1);
    const done = d.last === key || d.history?.[key] != null;
    return {
      key,
      done,
      score: d.history?.[key] ?? null,
      streak: alive ? d.streak || 0 : 0,
      best: d.best || 0,
      last: d.last || null,
      alive,
    };
  },

  /**
   * Records today's Daily Challenge. Only the first completion of a date counts for the streak.
   * Awards 'daily-streak-7' (silently when called inside recordGame's collection, else toasts).
   * → { first, streak, best, key, newBadges }
   */
  recordDaily({ score = 0, key = null } = {}) {
    const k = key || dailyKey();
    if (!state.daily || typeof state.daily !== 'object') state.daily = defaults().daily;
    const d = state.daily;
    if (!d.history || typeof d.history !== 'object') d.history = {};
    if (d.history[k] != null || d.last === k) {
      d.history[k] = Math.max(d.history[k] ?? 0, score);
      save();
      return { first: false, streak: d.streak || 0, best: d.best || 0, key: k, newBadges: [] };
    }
    d.streak = d.last === shiftKey(k, -1) ? (d.streak || 0) + 1 : 1;
    d.best = Math.max(d.best || 0, d.streak);
    d.last = k;
    d.history[k] = score;
    const keys = Object.keys(d.history).sort();
    for (const old of keys.slice(0, Math.max(0, keys.length - 90))) delete d.history[old];
    const newBadges = [];
    if (d.streak >= 7 && this.award('daily-streak-7', { silent: true })) newBadges.push('daily-streak-7');
    changed();
    return { first: true, streak: d.streak, best: d.best, key: k, newBadges };
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
