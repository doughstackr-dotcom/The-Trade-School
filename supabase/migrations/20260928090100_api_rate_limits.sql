-- Per-client request rate limits for public Edge Functions (market-data).
--
-- market-data is public (verify_jwt = false), so without a limit one client could make the
-- function hammer the database and spend the shared upstream budgets (public.market_quota).
-- Edge Function instances are short-lived and many, so the counter lives in the database:
-- one row per (key, fixed window), counted atomically.
--
-- Keys are chosen by the function (e.g. 'market-data:ip:<sha-256 of the client IP>'), so no
-- raw IP address is stored. Rows older than a day are pruned opportunistically.

create table public.api_rate_limits (
  key text not null check (char_length(key) <= 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

create index api_rate_limits_window_start_idx on public.api_rate_limits (window_start);

alter table public.api_rate_limits enable row level security;
-- No policies: service role only.
revoke all on public.api_rate_limits from anon, authenticated;

-- Counts one request for `p_key` in the current `p_window_seconds` window and returns true
-- while the window has room (at most `p_limit` requests); false once it is full (rejected
-- requests are not counted). Atomic: concurrent callers serialise on the row.
create or replace function public.take_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_key is null or p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'take_rate_limit: invalid arguments';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.api_rate_limits as r (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update
    set hits = r.hits + 1
    where r.hits < p_limit
  returning hits into v_hits;

  -- Keep the table small: about 1 call in 1000 removes windows older than a day.
  if random() < 0.001 then
    delete from public.api_rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_hits is not null;
end;
$$;

revoke execute on function public.take_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.take_rate_limit(text, integer, integer) to service_role;
