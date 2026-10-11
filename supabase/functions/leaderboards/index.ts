// Opt-in leaderboards for The Trade School v2.
//
// GET  ?game=<gameId>&style=arcade&scope=all|week&limit=10
//      → { game, style, scope, rows: [{ rank, handle, score, stars, at, you }], weekStart? }
//      Public (anon ok). `you` flags the caller's own rows when authed.
//      Without ?game: → { games: [gameId…] } (ids that have entries).
// POST { game, style, score, stars } (auth required)
//      → { ok: true, best } — clamps score/stars, validates game + style + handle,
//      inserts the entry and prunes the member's history to the newest 10 rows per
//      (game, style). Handles come from the member's stored competition handle via
//      profiles.display_name (set by the client when Competitive mode is enabled).
//
// Deployed with verify_jwt = false so anonymous GETs work; POST requires a bearer
// session, which is checked here (the write RLS also enforces ownership).
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const env = (name: string) => Deno.env.get(name) ?? '';
const URL_ = env('SUPABASE_URL');
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY');
const ANON = env('SUPABASE_ANON_KEY');

// js/registry.js game ids — the insert whitelist.
const GAMES = new Set([
  'order-desk', 'candle-builder', 'chart-match', 'pattern-flash', 'trend-spotter',
  'level-hunter', 'trendline-challenge', 'cross-catcher', 'volume-verdict',
  'what-next', 'setup-swipe', 'daily-challenge', 'pattern-detective', 'fib-sniper',
  'divergence-detective', 'timeframe-stack', 'trap-or-trade', 'risk-manager',
  'tilt-control', 'trade-simulator', 'live-predict',
]);
const STYLES = new Set(['practice', 'arcade', 'survival']);
const MAX_SCORE = 250_000; // far above any legitimate run (stage bests stay well under 10k)
const KEEP_PER_BOARD = 10;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

function serviceClient() {
  if (!URL_ || !SERVICE) return null;
  return createClient(URL_, SERVICE, { auth: { persistSession: false } });
}

function weekStart(d = new Date()) {
  // ISO weeks start Monday 00:00 UTC.
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d);
  monday.setUTCDate(monday.getUTCDate() - day);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString();
}

async function callerId(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ') || !URL_ || !ANON) return null;
  const scoped = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data } = await scoped.auth.getUser(auth.slice(7).trim());
  return data?.user?.id ?? null;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const admin = serviceClient();
  if (!admin) return json(503, { error: 'leaderboards are not configured' });

  try {
    if (req.method === 'GET') {
      const game = url.searchParams.get('game');
      if (!game) {
        const { data } = await admin
          .from('leaderboard_entries')
          .select('game_id')
          .limit(1000);
        const games = [...new Set((data ?? []).map((r: { game_id: string }) => r.game_id))];
        return json(200, { games });
      }
      if (!GAMES.has(game)) return json(400, { error: 'unknown game' });
      const style = url.searchParams.get('style') ?? 'arcade';
      if (!STYLES.has(style)) return json(400, { error: 'unknown style' });
      const scope = url.searchParams.get('scope') === 'week' ? 'week' : 'all';
      const limit = Math.min(50, Math.max(3, Number(url.searchParams.get('limit')) || 10));
      const you = await callerId(req);

      const since = scope === 'week' ? weekStart() : null;
      let query = admin
        .from('leaderboard_best')
        .select('user_id, handle, score, stars, created_at')
        .eq('game_id', game)
        .eq('style', style);
      const entries = since ? await query.gte('created_at', since).limit(500) : await query.limit(500);
      if (entries.error) return json(502, { error: 'board unavailable' });
      const rows = (entries.data ?? [])
        .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
        .slice(0, limit)
        .map((r: { user_id: string; handle: string; score: number; stars: number; created_at: string }, i: number) => ({
          rank: i + 1,
          handle: r.handle,
          score: r.score,
          stars: r.stars,
          at: r.created_at,
          you: you ? r.user_id === you : false,
        }));
      return json(200, { game, style, scope, weekStart: since, rows });
    }

    if (req.method === 'POST') {
      const you = await callerId(req);
      if (!you) return json(401, { error: 'sign in to submit scores' });
      const body = await req.json().catch(() => null);
      const game = String(body?.game ?? '');
      const style = String(body?.style ?? 'arcade');
      if (!GAMES.has(game) || !STYLES.has(style)) return json(400, { error: 'unknown game or style' });
      const score = Math.max(0, Math.min(MAX_SCORE, Math.round(Number(body?.score) || 0)));
      const stars = Math.max(0, Math.min(3, Math.round(Number(body?.stars) || 0)));

      // Handle: the member's stored display_name (set when Competitive mode was enabled).
      const { data: profile } = await admin.from('profiles').select('display_name').eq('id', you).maybeSingle();
      const handle = String(profile?.display_name ?? '').trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{1,23}$/.test(handle)) {
        return json(422, { error: 'choose a handle before competing' });
      }

      const { error } = await admin.from('leaderboard_entries').insert({
        user_id: you,
        handle,
        game_id: game,
        style,
        score,
        stars,
      });
      if (error) return json(500, { error: 'could not save the score' });

      // Prune: keep only the newest KEEP_PER_BOARD rows for this member + board.
      const { data: mine } = await admin
        .from('leaderboard_entries')
        .select('id')
        .eq('user_id', you)
        .eq('game_id', game)
        .eq('style', style)
        .order('created_at', { ascending: false })
        .limit(200);
      const stale = (mine ?? []).slice(KEEP_PER_BOARD).map((r: { id: number }) => r.id);
      if (stale.length) await admin.from('leaderboard_entries').delete().in('id', stale);

      const { data: best } = await admin
        .from('leaderboard_best')
        .select('score')
        .eq('user_id', you)
        .eq('game_id', game)
        .eq('style', style)
        .maybeSingle();
      return json(200, { ok: true, best: best?.score ?? score });
    }

    return json(405, { error: 'method not allowed' });
  } catch (err) {
    console.error('[leaderboards]', err);
    return json(500, { error: 'leaderboards hiccup' });
  }
});
