-- The Trade School v2: opt-in leaderboards for game scores.
--
-- Strictly opt-in: the client only submits when the member has enabled Competitive
-- mode and chosen a handle. Handles (not emails) are the public identity. Clients can
-- insert only their own rows; everyone (anon included) can read the boards. The Edge
-- Function (service role) clamps scores and prunes each member's history.

-- ---------------------------------------------------------------- entries
create table public.leaderboard_entries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  handle text not null check (public.valid_handle(handle)),
  game_id text not null check (char_length(game_id) <= 64),
  style text not null default 'arcade' check (style in ('practice', 'arcade', 'survival')),
  score bigint not null check (score >= 0 and score <= 250000),
  stars smallint not null default 0 check (stars between 0 and 3),
  created_at timestamptz not null default now()
);

create index leaderboard_board_idx on public.leaderboard_entries (game_id, style, score desc, created_at desc);
create index leaderboard_user_idx on public.leaderboard_entries (user_id, game_id, style, created_at desc);

create or replace function public.valid_handle(h text)
returns boolean
language sql
immutable
as $$
  select h ~ '^[A-Za-z0-9][A-Za-z0-9 _-]{1,23}$'
$$;

-- ---------------------------------------------------------------- row level security
alter table public.leaderboard_entries enable row level security;

create policy "Leaderboards are public to read"
  on public.leaderboard_entries for select
  to anon, authenticated
  using (true);

create policy "Members insert their own entries"
  on public.leaderboard_entries for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- No client update/delete: pruning is the Edge Function's job (service role).

-- Competitive mode stores the member's public handle in profiles.display_name; the
-- accounts migration shipped select/update policies only, so the first-time upsert
-- needs an insert policy too.
create policy "Users insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------- best-per-member view
create view public.leaderboard_best as
select distinct on (user_id, game_id, style)
  user_id, handle, game_id, style, score, stars, created_at
from public.leaderboard_entries
order by user_id, game_id, style, score desc, created_at desc;
