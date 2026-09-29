-- The Trade School: accounts, subscriptions, progress sync and premium content access.
--
-- Plans
--   free      – signed-in users without a subscription (first unit + library)
--   beginner  – $19.99/month, unlocks the Beginner tier
--   advanced  – $29.99/month, unlocks Beginner AND Advanced
--
-- Stripe is the billing source of truth. Only the stripe-webhook Edge Function
-- (service role) writes customers/subscriptions; clients can only read their own rows.

-- ---------------------------------------------------------------- helpers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "Users update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- progress
-- One row per user holding the client's progress blob (XP, lessons, games, badges).
-- The client debounces writes, so this stays cheap at scale.
create table public.progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) < 262144),
  updated_at timestamptz not null default now()
);

alter table public.progress enable row level security;

create policy "Users read their own progress"
  on public.progress for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users insert their own progress"
  on public.progress for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users update their own progress"
  on public.progress for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create trigger progress_updated_at
  before update on public.progress
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- stripe customers (server only)
create table public.customers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

alter table public.customers enable row level security;
-- No policies: only the service role (Edge Functions) can read or write.

-- ---------------------------------------------------------------- subscriptions (written by webhook)
create table public.subscriptions (
  id text primary key,                          -- Stripe subscription id (sub_...)
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in (
    'trialing', 'active', 'past_due', 'canceled', 'unpaid',
    'incomplete', 'incomplete_expired', 'paused')),
  plan text not null check (plan in ('beginner', 'advanced')),
  price_id text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_user_id_idx on public.subscriptions (user_id);

alter table public.subscriptions enable row level security;

create policy "Users read their own subscriptions"
  on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- manual access grants
-- For comps, testers and staff. Insert with SQL / the dashboard, e.g.
--   insert into public.access_grants (user_id, plan, note) values ('<uuid>', 'advanced', 'owner');
create table public.access_grants (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  plan text not null check (plan in ('beginner', 'advanced')),
  expires_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

create index access_grants_user_id_idx on public.access_grants (user_id);

alter table public.access_grants enable row level security;

create policy "Users read their own grants"
  on public.access_grants for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- stripe webhook idempotency
create table public.stripe_events (
  id text primary key,                          -- Stripe event id (evt_...)
  type text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
-- No policies: service role only.

-- ---------------------------------------------------------------- lock down direct writes
revoke all on public.customers, public.stripe_events from anon, authenticated;
revoke insert, update, delete on public.subscriptions, public.access_grants from anon, authenticated;
revoke insert, delete on public.profiles from anon, authenticated;
revoke delete on public.progress from anon, authenticated;
revoke all on public.profiles, public.progress, public.subscriptions, public.access_grants from anon;

-- ---------------------------------------------------------------- access level
-- 'advanced' | 'beginner' | 'free' for the calling user. SECURITY INVOKER: it only
-- sees the caller's own rows through RLS, so it cannot be used to probe other users.
create or replace function public.access_level()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.subscriptions s
      where s.user_id = (select auth.uid())
        and s.plan = 'advanced'
        and s.status in ('active', 'trialing', 'past_due'))
      or exists (
      select 1 from public.access_grants g
      where g.user_id = (select auth.uid())
        and g.plan = 'advanced'
        and (g.expires_at is null or g.expires_at > now()))
    then 'advanced'
    when exists (
      select 1 from public.subscriptions s
      where s.user_id = (select auth.uid())
        and s.plan = 'beginner'
        and s.status in ('active', 'trialing', 'past_due'))
      or exists (
      select 1 from public.access_grants g
      where g.user_id = (select auth.uid())
        and g.plan = 'beginner'
        and (g.expires_at is null or g.expires_at > now()))
    then 'beginner'
    else 'free'
  end;
$$;

revoke execute on function public.access_level() from public, anon;
grant execute on function public.access_level() to authenticated;

-- ---------------------------------------------------------------- new user bootstrap
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)), 60)
  )
  on conflict (id) do nothing;

  insert into public.progress (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- premium module storage
-- Paid lesson/game modules can be served from this private bucket instead of the
-- public site (see docs/ACCOUNTS.md). Objects live under beginner/... or advanced/...
insert into storage.buckets (id, name, public)
values ('premium', 'premium', false)
on conflict (id) do nothing;

create policy "Subscribers read premium modules for their plan"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'premium'
    and (
      ((storage.foldername(name))[1] = 'beginner' and public.access_level() in ('beginner', 'advanced'))
      or ((storage.foldername(name))[1] = 'advanced' and public.access_level() = 'advanced')
    )
  );
