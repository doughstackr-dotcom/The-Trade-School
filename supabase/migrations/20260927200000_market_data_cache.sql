-- Market data cache for the market-data Edge Function.
--
-- Candles fetched from public providers are stored here so that thousands of learners
-- share one upstream request per (symbol, interval) per refresh window. Only the Edge
-- Function (service role) reads and writes these tables; browsers go through the function.

create table public.market_candles (
  symbol text not null,
  interval text not null check (interval in ('1m', '5m', '15m', '1h', '6h', '1d')),
  t timestamptz not null,                      -- candle open time (UTC)
  o double precision not null,
  h double precision not null,
  l double precision not null,
  c double precision not null,
  v double precision not null default 0,
  primary key (symbol, interval, t),
  check (l <= least(o, c) and greatest(o, c) <= h and l > 0)
);

create table public.market_fetches (
  symbol text not null,
  interval text not null,
  fetched_at timestamptz not null default now(),  -- last successful upstream refresh of the latest candles
  oldest_complete timestamptz,                    -- history is known complete back to here
  source text,
  primary key (symbol, interval)
);

alter table public.market_candles enable row level security;
alter table public.market_fetches enable row level security;
-- No policies: service role only.
revoke all on public.market_candles, public.market_fetches from anon, authenticated;

-- Keep the high-frequency intervals from growing without bound.
create or replace function public.prune_market_candles()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.market_candles
  where (interval = '1m' and t < now() - interval '3 days')
     or (interval = '5m' and t < now() - interval '30 days')
     or (interval = '15m' and t < now() - interval '120 days');
$$;

revoke execute on function public.prune_market_candles() from public, anon, authenticated;
grant execute on function public.prune_market_candles() to service_role;
