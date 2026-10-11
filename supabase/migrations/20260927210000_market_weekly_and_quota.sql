-- Weekly candles + a per-provider daily request budget for market-data.
--
-- Alpha Vantage's free key allows 25 requests per day for the whole site, so every upstream
-- call first takes one unit of budget atomically; when the budget is spent the function
-- serves cached candles only.

alter table public.market_candles drop constraint if exists market_candles_interval_check;
alter table public.market_candles
  add constraint market_candles_interval_check
  check (interval in ('1m', '5m', '15m', '1h', '6h', '1d', '1w'));

create table public.market_quota (
  provider text not null,
  day date not null default (now() at time zone 'utc')::date,
  used integer not null default 0,
  primary key (provider, day)
);

alter table public.market_quota enable row level security;
revoke all on public.market_quota from anon, authenticated;

-- Returns true and counts the call if `provider` has budget left today (UTC).
create or replace function public.take_market_quota(p_provider text, p_daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
begin
  insert into public.market_quota (provider, day, used)
  values (p_provider, (now() at time zone 'utc')::date, 1)
  on conflict (provider, day) do update
    set used = public.market_quota.used + 1
    where public.market_quota.used < p_daily_limit
  returning used into v_used;
  return v_used is not null;
end;
$$;

revoke execute on function public.take_market_quota(text, integer) from public, anon, authenticated;
grant execute on function public.take_market_quota(text, integer) to service_role;
