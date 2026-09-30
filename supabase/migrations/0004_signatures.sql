-- ===========================================================================
-- Charter — Phase 4: reusable signatures and initials
--
-- Every signature is stored as a trimmed PNG, whichever way it was created —
-- drawn, typed in a handwriting face, or uploaded. That keeps one code path
-- through flattening (pdf-lib embeds a PNG) and avoids vendoring a font file
-- plus @pdf-lib/fontkit just to render a typed name.
--
-- They live in the existing private contracts bucket under a signatures/<user>
-- prefix, so the bucket's policies already cover them and placing one onto a
-- document is a same-bucket copy rather than a download and re-upload.
-- ===========================================================================

create table if not exists public.signatures (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('signature', 'initials')),
  source       text not null check (source in ('drawn', 'typed', 'uploaded')),
  storage_path text not null unique,
  width        integer not null check (width  between 1 and 20000),
  height       integer not null check (height between 1 and 20000),
  is_default   boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists signatures_user_idx on public.signatures (user_id, kind, created_at desc);

-- At most one default per kind, per person.
create unique index if not exists signatures_one_default_per_kind
  on public.signatures (user_id, kind)
  where is_default;

alter table public.signatures enable row level security;

-- Scoped to the row's owner as well as to is_owner(): two allowlisted people
-- must not see each other's signature images.
drop policy if exists "owners read own signatures" on public.signatures;
create policy "owners read own signatures"
  on public.signatures for select
  to authenticated
  using (public.is_owner() and user_id = auth.uid());

drop policy if exists "owners insert own signatures" on public.signatures;
create policy "owners insert own signatures"
  on public.signatures for insert
  to authenticated
  with check (public.is_owner() and user_id = auth.uid());

drop policy if exists "owners update own signatures" on public.signatures;
create policy "owners update own signatures"
  on public.signatures for update
  to authenticated
  using (public.is_owner() and user_id = auth.uid())
  with check (public.is_owner() and user_id = auth.uid());

drop policy if exists "owners delete own signatures" on public.signatures;
create policy "owners delete own signatures"
  on public.signatures for delete
  to authenticated
  using (public.is_owner() and user_id = auth.uid());
