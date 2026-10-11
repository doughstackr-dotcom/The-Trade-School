// Leaderboards client (v2): strictly opt-in score submission + board fetching.
// Nothing leaves the browser until the member flips on Competitive mode and picks a
// handle; the handle (never the email) is the public identity, stored in their profile.
import { SUPABASE_URL } from '../config.js';
import { supabaseClient } from './access.js';

const HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{1,23}$/;
const BOARD_TTL = 60_000;

// Games that make good weekly events (short, replayable, score-driven).
const EVENT_GAMES = ['pattern-flash', 'trend-spotter', 'cross-catcher', 'fib-sniper', 'trap-or-trade', 'what-next', 'setup-swipe', 'volume-verdict'];

export function validHandle(h) {
  return HANDLE_RE.test(String(h || '').trim());
}

/** ISO-week number (weeks start Monday), for the weekly event rotation. */
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this ISO week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  return 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
}

/** This week's featured event game (stable through the week, rotates yearly). */
export function weeklyEventGame(date = new Date()) {
  return EVENT_GAMES[isoWeek(date) % EVENT_GAMES.length];
}

export function competitiveOn(store) {
  return store?.state?.settings?.competitive === true;
}

/**
 * Enables/disables Competitive mode. Enabling stores the handle on the member's
 * profile (display_name) and the flag locally. → { ok, error? }.
 */
export async function setCompetitive(store, on, handle = null) {
  const client = supabaseClient();
  const session = client ? (await client.auth.getSession()).data?.session : null;
  if (on && !session) return { ok: false, error: 'Sign in first — boards need an account to pin scores to.' };
  if (on) {
    const h = String(handle ?? store.getSetting('handle') ?? '').trim();
    if (!validHandle(h)) return { ok: false, error: 'Pick a handle: 2–24 characters, letters, numbers, spaces, - or _.' };
    if (client) {
      const { error } = await client.from('profiles').upsert({ id: session.user.id, display_name: h });
      if (error) return { ok: false, error: 'Could not save the handle — try again.' };
    }
    store.setSetting('competitive', true);
    store.setSetting('handle', h);
    return { ok: true };
  }
  store.setSetting('competitive', false);
  return { ok: true };
}

const boardCache = new Map();

/** GET a board. → { rows, scope, game, style, weekStart? } | null (offline/error). */
export async function fetchBoard({ game, style = 'arcade', scope = 'all', limit = 10 } = {}) {
  if (!SUPABASE_URL || !game) return null;
  const key = `${game}:${style}:${scope}:${limit}`;
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.at < BOARD_TTL) return hit.data;
  try {
    const url = `${SUPABASE_URL}/functions/v1/leaderboards?game=${encodeURIComponent(game)}&style=${encodeURIComponent(style)}&scope=${scope}&limit=${limit}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    boardCache.set(key, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget score submit after a recorded run — through the leaderboards Edge
 * Function (server-side clamps, handle validation, history pruning). No-ops (in order)
 * when: offline, Competitive mode off, not signed in, or the run scored nothing.
 */
export async function maybeSubmit(store, { gameId, style = 'arcade', score = 0, stars = 0 } = {}) {
  if (!SUPABASE_URL || !competitiveOn(store) || !(score > 0)) return false;
  const client = supabaseClient();
  if (!client?.functions?.invoke) return false;
  try {
    const { data: session } = await client.auth.getSession();
    if (!session?.session) return false;
    const { error } = await client.functions.invoke('leaderboards', {
      body: { game: gameId, style, score: Math.round(score), stars: Math.round(stars) },
    });
    return !error;
  } catch {
    return false;
  }
}
