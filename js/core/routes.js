// Route tokens <-> clean URL paths. PURE (no DOM, no imports): importable from node tests.
//
// The router works on short route tokens — 'home', 'dashboard', 'l.<lessonId>', 'g.<gameId>',
// 'library.<id>', 'playbook.<id>', 'account.<mode>' … — which are also the old hash routes
// (#dashboard, #l.fibonacci). URLs use real paths:
//
//   home            /                     l.<id>         /lessons/<id>
//   <page>          /<page>               g.<id>         /games/<id>
//   library.<id>    /library/<id>         playbook.<id>  /playbook/<id>
//   account.<mode>  /account/<mode>
//
// Old hash links (#l.fibonacci, #dashboard) are still understood: see legacyHashToken().

/** Production origin: canonical links, social cards and the sitemap point here. */
export const SITE_ORIGIN = 'https://thetradeschool.online';

const PAGE_TOKENS = new Set([
  'glossary', 'platforms', 'live', 'games', 'dashboard', 'paywall', 'dev-chart',
  'privacy', 'terms', 'refunds',
]);

// token prefix ↔ first path segment
const PREFIXES = [
  ['l.', 'lessons'],
  ['g.', 'games'],
  ['library.', 'library'],
  ['playbook.', 'playbook'],
  ['account.', 'account'],
];

/** Parses a route token (with or without a leading '#') into a route descriptor. */
export function parseToken(hash) {
  let token = String(hash || '').replace(/^#/, '');
  try {
    token = decodeURIComponent(token);
  } catch {
    /* keep raw */
  }
  token = token.trim();
  if (!token || token === 'home') return { key: 'home', kind: 'page', page: 'home' };
  // Legacy track routes → unified Dashboard hub (scroll to section on mount).
  if (token === 'beginner' || token === 'advanced') {
    return { key: token, kind: 'page', page: 'dashboard', section: token };
  }
  if (token === 'library' || token.startsWith('library.')) {
    return { key: token, kind: 'page', page: 'library', param: token.slice('library.'.length) || null };
  }
  if (token === 'playbook' || token.startsWith('playbook.')) {
    return { key: token, kind: 'page', page: 'playbook', param: token.slice('playbook.'.length) || null };
  }
  // progress is an alias of dashboard (merged progress + curriculum page).
  if (token === 'progress') return { key: 'progress', kind: 'page', page: 'dashboard' };
  // affiliate is an alias of platforms (renamed partners page).
  if (token === 'affiliate') return { key: 'affiliate', kind: 'page', page: 'platforms' };
  if (token === 'account' || token.startsWith('account.')) {
    return { key: token, kind: 'page', page: 'account', param: token.slice('account.'.length) || null };
  }
  if (PAGE_TOKENS.has(token)) return { key: token, kind: 'page', page: token };
  if (token.startsWith('l.')) return { key: token, kind: 'lesson', id: token.slice(2) };
  if (token.startsWith('g.')) return { key: token, kind: 'game', id: token.slice(2) };
  return { key: token, kind: 'notfound' };
}

/** URL path for a route token: 'l.fibonacci' → '/lessons/fibonacci', 'home' → '/'. */
export function tokenToPath(token) {
  const t = String(token || '').replace(/^#/, '').trim();
  if (!t || t === 'home') return '/';
  for (const [prefix, segment] of PREFIXES) {
    if (t.startsWith(prefix) && t.length > prefix.length) {
      return `/${segment}/${encodeURIComponent(t.slice(prefix.length))}`;
    }
  }
  return `/${t.split('/').map(encodeURIComponent).join('/')}`;
}

/** Route token for a URL path: '/games/fib-sniper' → 'g.fib-sniper', '/' → 'home'. */
export function pathToToken(pathname) {
  const segs = String(pathname || '/').split('/').filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  if (!segs.length || (segs.length === 1 && segs[0] === 'index.html')) return 'home';
  if (segs.length === 2) {
    const hit = PREFIXES.find(([, segment]) => segment === segs[0]);
    if (hit) return hit[0] + segs[1];
  }
  return segs.join('/');
}

/**
 * The route token of an old-style hash URL (#l.fibonacci, #dashboard), or null for anything
 * else: in-page anchors (#main, #pricing) and Supabase auth callbacks (#access_token=…).
 */
export function legacyHashToken(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw || raw.includes('=') || raw.includes('/')) return null;
  const route = parseToken(raw);
  return route.kind === 'notfound' ? null : route.key;
}

/** Canonical path of a route (aliases collapse onto the page they show). */
export function canonicalPath(route) {
  if (!route || route.kind === 'notfound') return null;
  if (route.kind === 'page') {
    if (route.page === 'dashboard') return '/dashboard';
    if (route.page === 'platforms') return '/platforms';
  }
  return tokenToPath(route.key);
}
