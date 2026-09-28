// Access rules (ARCHITECTURE §9): which plan a lesson, game, game mode or page needs, and
// whether a member level may open it. PURE: no DOM, no network, importable from node.
//
// The rules come from js/config.js (FREE_IDS, PAGE_PLANS, BOTH_TIER_MODES, ACCESS_MODE) plus
// each registry entry's `tier`, so new lessons and games follow automatically.
//
//   required plan  null (public) < 'account' (free account) < 'beginner' < 'advanced'
//   member level   null (signed out) < 'free' < 'beginner' < 'advanced'
import { FREE_IDS, ACCESS_MODE, PAGE_PLANS, BOTH_TIER_MODES, PLANS } from '../config.js';
import { LESSONS, GAMES, PAGES, findEntry, findPage } from '../registry.js';

/** Rank of a member level or a required plan. Signed out / public = 0. */
export const PLAN_RANK = Object.freeze({ none: 0, account: 1, free: 1, beginner: 2, advanced: 3 });

/** Member levels returned by the access_level() RPC. */
export const MEMBER_LEVELS = Object.freeze(['free', 'beginner', 'advanced']);

/** Paid plans, cheapest first. */
export const PAID_PLANS = Object.freeze(['beginner', 'advanced']);

/** Chip text for what an item needs ("Free" = a free account). */
export const PLAN_LABELS = Object.freeze({ account: 'Free', free: 'Free', beginner: 'Beginner plan', advanced: 'Advanced plan' });

/** Short names of member levels. */
export const LEVEL_LABELS = Object.freeze({ none: 'Signed out', free: 'Free', beginner: 'Beginner', advanced: 'Advanced' });

const PAGE_TITLES = { library: 'Pattern Library', playbook: 'Setup Playbook', live: 'Live Market Lab' };
const PAGE_BLURBS = {
  library: 'Every candlestick and chart pattern with a diagram, the psychology behind it and how traders confirm it.',
};

/** Rank of a level / plan name (unknown or null → 0). */
export function rankOf(levelOrPlan) {
  if (levelOrPlan == null) return 0;
  return PLAN_RANK[levelOrPlan] ?? 0;
}

/** Normalises anything level-like to null | 'free' | 'beginner' | 'advanced'. */
export function normalizeLevel(level) {
  return MEMBER_LEVELS.includes(level) ? level : level == null ? null : 'free';
}

/** The plan a content tier needs: 'beginner' | 'advanced' (| null for unknown tiers). */
export function planForTier(tier, { mode = null } = {}) {
  if (tier === 'beginner') return 'beginner';
  if (tier === 'advanced') return 'advanced';
  if (tier === 'both') return BOTH_TIER_MODES[mode] || BOTH_TIER_MODES.beginner || 'beginner';
  return null;
}

function resolveTarget(target) {
  if (target == null) return null;
  if (typeof target === 'string') {
    const e = findEntry(target);
    if (e) return e;
    if (PAGE_PLANS[target] !== undefined || findPage(target)) return { type: 'page', id: target };
    return null;
  }
  if (target.kind === 'lesson' || target.kind === 'game') return findEntry(target.id) || null; // a route
  if (target.kind === 'page') return { type: 'page', id: target.page };                        // a route
  if (target.kind === 'notfound') return null;
  return target;
}

/**
 * The plan needed to open a lesson, game (optionally one of its modes) or page.
 * target: registry entry | id | route ({ kind, id | page }) | { type: 'page', id }.
 * → null (public) | 'account' | 'beginner' | 'advanced'
 */
export function requiredPlan(target, { mode = null } = {}) {
  const e = resolveTarget(target);
  if (!e) return null;
  if (e.type === 'page') return PAGE_PLANS[e.id] ?? null;
  if (e.dev) return null;                       // developer demos (localhost only)
  if (FREE_IDS.includes(e.id)) return 'account';
  if (e.type !== 'lesson' && e.type !== 'game') return null;
  return planForTier(e.tier, { mode }) || 'account';
}

/** The plan a GameShell mode needs: the mode's own `requires`, else the rule for its game. */
export function modeRequirement(entry, modeOrId) {
  const m = typeof modeOrId === 'string' ? { id: modeOrId } : modeOrId || {};
  if (m.requires) return m.requires === 'free' ? 'account' : m.requires;
  return requiredPlan(entry, { mode: m.id || null });
}

/** True when a member level satisfies a required plan. */
export function levelSatisfies(level, plan) {
  return rankOf(normalizeLevel(level)) >= rankOf(plan);
}

/**
 * May `level` open `target`? opts.mode: a game mode; opts.enforce = false opens everything
 * (ACCESS_MODE 'open' / localhost).
 */
export function canOpen(target, level, { mode = null, enforce = true } = {}) {
  if (!enforce) return true;
  return levelSatisfies(level, requiredPlan(target, { mode }));
}

/** The paid plan to buy for a requirement (null for public / free-account items). */
export function planToBuy(required) {
  return required === 'beginner' || required === 'advanced' ? required : null;
}

/**
 * Why `level` cannot open `target`, or null when it can.
 * → { required, plan, reason: 'signin' | 'subscribe' | 'upgrade' }
 *   signin: signed out (free-account items and paid ones: create an account first)
 *   subscribe: signed in on the free level, needs a plan
 *   upgrade: on Beginner, needs Advanced
 */
export function blockReason(target, level, opts = {}) {
  if (canOpen(target, level, opts)) return null;
  const required = requiredPlan(target, opts);
  const lv = normalizeLevel(level);
  const plan = planToBuy(required);
  const reason = lv == null ? 'signin' : lv === 'beginner' && plan === 'advanced' ? 'upgrade' : 'subscribe';
  return { required, plan, reason };
}

/** Chip text for a requirement: 'Free' | 'Beginner plan' | 'Advanced plan' | null (public). */
export function lockLabel(required) {
  return required ? PLAN_LABELS[required] || null : null;
}

/** 'Signed out' | 'Free' | 'Beginner' | 'Advanced' */
export function levelLabel(level) {
  const lv = normalizeLevel(level);
  return LEVEL_LABELS[lv || 'none'];
}

/** Chip text for a member's plan: 'Free plan' | 'Beginner plan' | 'Advanced plan' | null. */
export function planChipLabel(level) {
  const lv = normalizeLevel(level);
  if (!lv) return null;
  return lv === 'free' ? 'Free plan' : PLAN_LABELS[lv];
}

/**
 * The call to action on a plan card for a member level.
 * → { action: 'signup' | 'subscribe' | 'upgrade' | 'manage' | 'included', label, current }
 */
export function planCta(plan, level) {
  const lv = normalizeLevel(level);
  const name = PLANS[plan]?.name || plan;
  if (!lv) return { action: 'signup', label: `Start with ${name}`, current: false };
  if (lv === plan) return { action: 'manage', label: 'Manage billing', current: true };
  if (rankOf(lv) > rankOf(plan)) return { action: 'included', label: 'Included in your plan', current: false };
  if (lv === 'beginner' && plan === 'advanced') return { action: 'upgrade', label: 'Upgrade to Advanced', current: false };
  return { action: 'subscribe', label: `Subscribe to ${name}`, current: false };
}

/** Where a locked item's upgrade link goes: '#signup' for free-account items, else '#pricing.<plan>'. */
export function upgradeHash(required, level) {
  const plan = planToBuy(required);
  if (!plan) return normalizeLevel(level) ? '#account' : '#signup';
  return `#pricing.${plan}`;
}

// ---------------------------------------------------------------- enforcement mode

/** localhost / 127.0.0.1 / ::1 (development and tests). */
export function isLocalHost(hostname) {
  const hn = String(hostname || '').toLowerCase();
  return hn === 'localhost' || hn === '127.0.0.1' || hn === '::1' || hn === '[::1]';
}

/**
 * ACCESS_MODE resolution → 'open' | 'enforce'.
 * 'auto': open on localhost (so development and the smoke test see every module) unless
 * localStorage['tts-enforce-access'] === '1'; enforced on every other host.
 */
export function resolveAccessMode({ mode = ACCESS_MODE, hostname = '', enforceFlag = null } = {}) {
  if (mode === 'open') return 'open';
  if (mode === 'enforce') return 'enforce';
  if (!isLocalHost(hostname)) return 'enforce';
  return enforceFlag === '1' ? 'enforce' : 'open';
}

/** Reads the browser's hostname and the local override (safe in node and with blocked storage). */
export function browserAccessMode() {
  let hostname = '';
  let flag = null;
  try {
    hostname = globalThis.location?.hostname || '';
  } catch {
    hostname = '';
  }
  try {
    flag = globalThis.localStorage?.getItem('tts-enforce-access') ?? null;
  } catch {
    flag = null;
  }
  return resolveAccessMode({ hostname, enforceFlag: flag });
}

/**
 * The `ctx.access` object modules receive. `getLevel` may be a function (live value) or a level.
 * { level, enforced, signedIn, can(plan), canOpen(target, opts), requiredPlan(target, opts),
 *   modeRequirement(entry, mode), canTier(tier), lockLabel(plan), upgradeHash(plan) }
 */
export function makeAccess(getLevel, { enforce = true, signedIn = null } = {}) {
  const read = () => normalizeLevel(typeof getLevel === 'function' ? getLevel() : getLevel);
  return {
    get level() {
      return read();
    },
    get signedIn() {
      if (typeof signedIn === 'function') return !!signedIn();
      return signedIn == null ? read() != null : !!signedIn;
    },
    enforced: !!enforce,
    /** plan: null | 'free' | 'account' | 'beginner' | 'advanced' */
    can(plan) {
      return !enforce || levelSatisfies(read(), plan === 'free' ? 'account' : plan);
    },
    canOpen(target, opts = {}) {
      return canOpen(target, read(), { ...opts, enforce });
    },
    requiredPlan(target, opts) {
      return requiredPlan(target, opts);
    },
    modeRequirement(entry, mode) {
      return modeRequirement(entry, mode);
    },
    /** For content inside a page (e.g. a Beginner or Advanced playbook setup). */
    canTier(tier, opts) {
      const plan = planForTier(tier, opts);
      return !enforce || !plan || levelSatisfies(read(), plan);
    },
    lockLabel,
    upgradeHash(plan) {
      return upgradeHash(plan, read());
    },
  };
}

// ---------------------------------------------------------------- what each plan unlocks

const titleOf = (e) => e.title;

/**
 * Exactly what a plan adds on top of the plan below it, generated from the registry.
 * plan: 'account' | 'beginner' | 'advanced'
 * → { lessons: [entry], games: [entry], modes: [{ game: entry, mode }], pages: [{ id, title }], extras: [string] }
 */
export function unlocksFor(plan) {
  const want = plan === 'free' ? 'account' : plan;
  const lessons = LESSONS.filter((l) => requiredPlan(l) === want);
  const games = GAMES.filter((g) => requiredPlan(g) === want);
  // 'both'-tier games whose Advanced mode needs a higher plan than the game itself.
  const modes = [];
  for (const g of GAMES) {
    if (g.tier !== 'both' || FREE_IDS.includes(g.id)) continue;
    for (const m of Object.keys(BOTH_TIER_MODES)) {
      const need = requiredPlan(g, { mode: m });
      if (need === want && need !== requiredPlan(g)) modes.push({ game: g, mode: m });
    }
  }
  const pages = Object.entries(PAGE_PLANS)
    .filter(([, p]) => p === want)
    .map(([id]) => ({ id, title: findPage(id)?.title || PAGE_TITLES[id] || id }));
  const extras = [];
  if (want === 'account') {
    extras.push('Progress saved to your account and synced across devices');
  }
  if (want === 'beginner') {
    if (PAGE_PLANS.playbook === 'account') extras.push('Beginner setups in the Setup Playbook');
  }
  if (want === 'advanced') {
    if (PAGE_PLANS.playbook === 'account') extras.push('Advanced setups in the Setup Playbook');
    if (FREE_IDS.includes('daily-challenge')) extras.push('Daily Challenge with mixed Beginner and Advanced questions');
  }
  return { lessons, games, modes, pages, extras };
}

/** Plain-text list lines for a plan (used by the pricing page and tests). */
export function unlockLines(plan) {
  const u = unlocksFor(plan);
  const lines = [];
  if (u.lessons.length) lines.push(`${u.lessons.length} lesson${u.lessons.length === 1 ? '' : 's'}: ${u.lessons.map(titleOf).join(', ')}`);
  if (u.games.length) lines.push(`${u.games.length} game${u.games.length === 1 ? '' : 's'}: ${u.games.map(titleOf).join(', ')}`);
  if (u.modes.length) lines.push(`${cap(u.modes[0].mode)} mode of ${u.modes.map((m) => m.game.title).join(', ')}`);
  for (const p of u.pages) lines.push(p.title);
  lines.push(...u.extras);
  return lines;
}

function cap(s) {
  return String(s).charAt(0).toUpperCase() + String(s).slice(1);
}

/**
 * A lockable target described for the paywall.
 * → { kind: 'lesson' | 'game' | 'page', id, title, blurb, tier, required, entry }
 */
export function describeTarget(target) {
  const e = resolveTarget(target);
  if (!e) return null;
  if (e.type === 'page') {
    const p = findPage(e.id);
    return {
      kind: 'page', id: e.id, title: p?.title || PAGE_TITLES[e.id] || e.id,
      blurb: p?.blurb || PAGE_BLURBS[e.id] || '', tier: null, required: requiredPlan(e), entry: null,
    };
  }
  return { kind: e.type, id: e.id, title: e.title, blurb: e.blurb || '', tier: e.tier, required: requiredPlan(e), entry: e };
}

/** Folder in the premium bucket for an entry's module ('beginner' | 'advanced'), or null if public. */
export function premiumFolder(target) {
  const need = requiredPlan(target);
  return need === 'beginner' || need === 'advanced' ? need : null;
}

/** Every registry page id with its rule (for docs and tests). */
export function pageRules() {
  const ids = new Set([...Object.keys(PAGE_PLANS), ...PAGES.map((p) => p.id)]);
  return [...ids].map((id) => ({ id, required: PAGE_PLANS[id] ?? null }));
}
