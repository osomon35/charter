-- ===========================================================================
-- Charter — Phase 1: owner allowlist, profiles, rate limiting
--
-- Consolidated and idempotent. Safe to re-run.
--
-- Two mistakes from the first draft are deliberately absent:
--
--   * No FORCE ROW LEVEL SECURITY. FORCE applies RLS to the table owner too,
--     which locks out the SECURITY DEFINER functions that are the only things
--     permitted to write these rows. Plain ENABLE already denies anon and
--     authenticated everything not granted by a policy below.
--
--   * No triggers on auth.users. Supabase reports any exception raised there
--     as the opaque "Database error creating new user" and aborts the whole
--     signup, which makes that table a bad place for a guard. The allowlist is
--     enforced by is_owner() in every RLS policy and by requireOwner() in the
--     app, and the profile row is created by the app on first sign-in.
--
--   * No revokes against the anon role either. RLS with no anon policy already
--     denies everything; schema-level revokes only risk interfering with
--     Supabase's own internals.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Owner allowlist — the authority for who may hold an account
-- ---------------------------------------------------------------------------
create table if not exists public.owner_allowlist (
  email      text primary key check (email = lower(email) and position('@' in email) > 1),
  note       text,
  created_at timestamptz not null default now()
);

alter table public.owner_allowlist enable row level security;

-- >>> EDIT ME: this must match the address you sign in with, lower-cased.
insert into public.owner_allowlist (email, note)
values ('joao@frameforge.co', 'owner')
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- 2. is_owner() — the predicate every policy below is built on
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so policies can consult owner_allowlist without that table
-- needing a policy of its own. STABLE so it is evaluated once per statement.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  -- auth.jwt() is Supabase's guarded reader for the request's claims. Reading
  -- current_setting('request.jwt.claims') and casting to jsonb throws when the
  -- setting is an empty string, which is exactly the unauthenticated case.
  select exists (
    select 1
    from public.owner_allowlist a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated, service_role;

-- Owners may read the allowlist; no one may change it through the API.
drop policy if exists "owners read allowlist" on public.owner_allowlist;
create policy "owners read allowlist"
  on public.owner_allowlist for select
  to authenticated
  using (public.is_owner());

-- ---------------------------------------------------------------------------
-- 3. Profiles — created by the app on first sign-in
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null check (email = lower(email)),
  full_name  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "owners read own profile" on public.profiles;
create policy "owners read own profile"
  on public.profiles for select
  to authenticated
  using (public.is_owner() and id = auth.uid());

drop policy if exists "owners insert own profile" on public.profiles;
create policy "owners insert own profile"
  on public.profiles for insert
  to authenticated
  with check (public.is_owner() and id = auth.uid());

drop policy if exists "owners update own profile" on public.profiles;
create policy "owners update own profile"
  on public.profiles for update
  to authenticated
  using (public.is_owner() and id = auth.uid())
  with check (public.is_owner() and id = auth.uid());

-- No delete policy: rows go away with the auth.users cascade.

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
-- 4. Rate limiting — fixed window, in Postgres, no Redis dependency
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  bucket       text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (bucket, window_start)
);

alter table public.rate_limits enable row level security;
-- No policies at all: reachable only through consume_rate_limit() below.

create index if not exists rate_limits_window_start_idx
  on public.rate_limits (window_start);

-- True when the call is allowed, false when the bucket is exhausted. Counts
-- the attempt on the way through, so call it exactly once per attempt.
create or replace function public.consume_rate_limit(
  p_bucket         text,
  p_limit          integer,
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

  -- Snap to a fixed window so concurrent callers contend on a single row.
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
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- Housekeeping, wired to a cron job in Phase 6.
create or replace function public.prune_rate_limits()
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  delete from public.rate_limits where window_start < now() - interval '1 day';
$$;

revoke all on function public.prune_rate_limits() from public;
grant execute on function public.prune_rate_limits() to service_role;
