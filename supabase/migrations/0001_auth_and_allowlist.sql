-- ===========================================================================
-- Charter — Phase 1: owner allowlist, profiles, rate limiting
--
-- Design notes:
--   * Deny by default. Every table gets RLS enabled with no permissive
--     policy for anon, and owner access is gated on public.is_owner().
--   * The allowlist is enforced in three independent places: a BEFORE INSERT
--     trigger on auth.users (so a non-allowlisted address can never become a
--     user, even with a valid magic link), public.is_owner() inside every RLS
--     policy, and a server-side check in the app layer.
--   * Emails are stored lower-cased and compared lower-cased throughout.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Owner allowlist
-- ---------------------------------------------------------------------------
create table if not exists public.owner_allowlist (
  email      text primary key check (email = lower(email) and position('@' in email) > 1),
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.owner_allowlist is
  'Addresses permitted to hold a Charter account. Authority for is_owner().';

alter table public.owner_allowlist enable row level security;
alter table public.owner_allowlist force row level security;

-- >>> EDIT ME: seed your own address(es) here before running.
insert into public.owner_allowlist (email, note)
values ('joao@frameforge.co', 'owner')
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- 2. is_owner() — the predicate every RLS policy is built on
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so policies can read owner_allowlist without that table
-- needing a policy of its own. STABLE so Postgres caches it per statement.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  -- auth.jwt() is Supabase's guarded reader for request.jwt.claims; reading
  -- current_setting() directly and casting to jsonb throws when the setting is
  -- an empty string, which is exactly the unauthenticated case.
  select exists (
    select 1
    from public.owner_allowlist a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and a.email <> ''
  );
$$;

revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated, service_role;

-- Owners may read the allowlist (so the UI can display it); nobody may change
-- it through the API. Edits happen here, in SQL, on purpose.
drop policy if exists "owners read allowlist" on public.owner_allowlist;
create policy "owners read allowlist"
  on public.owner_allowlist for select
  to authenticated
  using (public.is_owner());

-- ---------------------------------------------------------------------------
-- 3. Reject signups from addresses that are not allowlisted
-- ---------------------------------------------------------------------------
create or replace function public.enforce_owner_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not exists (
    select 1 from public.owner_allowlist a where a.email = lower(new.email)
  ) then
    raise exception 'charter: address not permitted'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_owner_allowlist on auth.users;
create trigger enforce_owner_allowlist
  before insert on auth.users
  for each row execute function public.enforce_owner_allowlist();

-- ---------------------------------------------------------------------------
-- 4. Profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null check (email = lower(email)),
  full_name  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists "owners read own profile" on public.profiles;
create policy "owners read own profile"
  on public.profiles for select
  to authenticated
  using (public.is_owner() and id = auth.uid());

drop policy if exists "owners update own profile" on public.profiles;
create policy "owners update own profile"
  on public.profiles for update
  to authenticated
  using (public.is_owner() and id = auth.uid())
  with check (public.is_owner() and id = auth.uid());

-- No insert or delete policy: rows are created by the trigger below and
-- removed by the cascade from auth.users.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(new.email),
    nullif(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Rate limiting (fixed window, in Postgres — no Redis dependency)
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  bucket       text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (bucket, window_start)
);

alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;
-- Deliberately no policies: reachable only via the service role, through
-- consume_rate_limit() below.

create index if not exists rate_limits_window_start_idx
  on public.rate_limits (window_start);

-- Returns true when the call is allowed, false when the bucket is exhausted.
-- Counts the attempt on the way through, so callers must invoke it exactly
-- once per attempt.
create or replace function public.consume_rate_limit(
  p_bucket  text,
  p_limit   integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_window_start timestamptz;
  v_hits integer;
begin
  if p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'charter: invalid rate limit parameters';
  end if;

  -- Snap to a fixed window so concurrent callers contend on one row.
  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits (bucket, window_start, hits)
  values (p_bucket, v_window_start, 1)
  on conflict (bucket, window_start)
    do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public;
revoke all on function public.consume_rate_limit(text, integer, integer) from anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- Housekeeping: drop windows older than a day. Called from the Vercel cron
-- job added in Phase 6.
create or replace function public.prune_rate_limits()
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  delete from public.rate_limits where window_start < now() - interval '1 day';
$$;

revoke all on function public.prune_rate_limits() from public;
revoke all on function public.prune_rate_limits() from anon, authenticated;
grant execute on function public.prune_rate_limits() to service_role;

-- ---------------------------------------------------------------------------
-- 6. Lock down the default grants Supabase hands out
-- ---------------------------------------------------------------------------
revoke all on schema public from anon;
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;

grant usage on schema public to authenticated, service_role;
