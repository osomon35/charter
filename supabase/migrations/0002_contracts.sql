-- ===========================================================================
-- Charter — Phase 2: folders, tags, contracts, versions, private storage
--
-- Same conventions as 0001: RLS enabled but never FORCEd, every policy gated
-- on public.is_owner(), nothing touching auth.users.
--
-- The original upload is never mutated. Every edit or signature in later
-- phases appends a new row to contract_versions; version 1 stays byte-for-byte
-- as it arrived, which is what makes the sha256 column meaningful.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'contract_status') then
    create type public.contract_status as enum (
      'draft', 'sent', 'partially_signed', 'completed', 'declined', 'expired'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'version_kind') then
    create type public.version_kind as enum ('original', 'edited', 'signed');
  end if;

  if not exists (select 1 from pg_type where typname = 'upload_state') then
    create type public.upload_state as enum ('pending', 'ready', 'failed');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Folders — nestable
-- ---------------------------------------------------------------------------
create table if not exists public.folders (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid references public.folders (id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists folders_parent_id_idx on public.folders (parent_id);

alter table public.folders enable row level security;

drop policy if exists "owners all folders" on public.folders;
create policy "owners all folders"
  on public.folders for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- A folder cannot become its own ancestor.
create or replace function public.folders_no_cycle()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_ancestor uuid := new.parent_id;
  v_depth int := 0;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'charter: a folder cannot be its own parent';
  end if;

  while v_ancestor is not null loop
    v_depth := v_depth + 1;
    if v_ancestor = new.id then
      raise exception 'charter: that move would create a folder cycle';
    end if;
    if v_depth > 64 then
      raise exception 'charter: folder nesting too deep';
    end if;
    select parent_id into v_ancestor from public.folders where id = v_ancestor;
  end loop;

  return new;
end;
$$;

drop trigger if exists folders_no_cycle on public.folders;
create trigger folders_no_cycle
  before insert or update of parent_id on public.folders
  for each row execute function public.folders_no_cycle();

-- ---------------------------------------------------------------------------
-- 3. Tags
-- ---------------------------------------------------------------------------
create table if not exists public.tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 60),
  color      text not null default 'slate'
             check (color in ('slate','blue','green','amber','red','violet','teal','pink')),
  created_at timestamptz not null default now()
);

create unique index if not exists tags_name_key on public.tags (lower(name));

alter table public.tags enable row level security;

drop policy if exists "owners all tags" on public.tags;
create policy "owners all tags"
  on public.tags for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- 4. Contracts
-- ---------------------------------------------------------------------------
create table if not exists public.contracts (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (length(trim(title)) between 1 and 300),
  counterparty_name text,
  status            public.contract_status not null default 'draft',
  folder_id         uuid references public.folders (id) on delete set null,
  notes             text,
  effective_date    date,
  expiry_date       date,
  archived_at       timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null,

  -- Full-text search over the fields that live on this row. Tags are joined
  -- separately, so Phase 6 searches this column and the tag names as a union.
  search_vector tsvector generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(counterparty_name, '') || ' ' ||
      coalesce(notes, '')
    )
  ) stored
);

create index if not exists contracts_search_idx  on public.contracts using gin (search_vector);
create index if not exists contracts_status_idx  on public.contracts (status);
create index if not exists contracts_folder_idx  on public.contracts (folder_id);
create index if not exists contracts_live_idx    on public.contracts (updated_at desc)
  where deleted_at is null and archived_at is null;

alter table public.contracts enable row level security;

drop policy if exists "owners all contracts" on public.contracts;
create policy "owners all contracts"
  on public.contracts for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

drop trigger if exists contracts_touch_updated_at on public.contracts;
create trigger contracts_touch_updated_at
  before update on public.contracts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Contract ↔ tag join
-- ---------------------------------------------------------------------------
create table if not exists public.contract_tags (
  contract_id uuid not null references public.contracts (id) on delete cascade,
  tag_id      uuid not null references public.tags (id) on delete cascade,
  primary key (contract_id, tag_id)
);

create index if not exists contract_tags_tag_idx on public.contract_tags (tag_id);

alter table public.contract_tags enable row level security;

drop policy if exists "owners all contract_tags" on public.contract_tags;
create policy "owners all contract_tags"
  on public.contract_tags for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- 6. Versions
-- ---------------------------------------------------------------------------
create table if not exists public.contract_versions (
  id             uuid primary key default gen_random_uuid(),
  contract_id    uuid not null references public.contracts (id) on delete cascade,
  version_no     integer not null check (version_no >= 1),
  kind           public.version_kind not null default 'original',
  state          public.upload_state not null default 'pending',

  storage_path   text not null,
  thumbnail_path text,

  original_name  text,
  byte_size      bigint check (byte_size is null or byte_size > 0),
  page_count     integer check (page_count is null or page_count >= 1),
  -- Hex SHA-256 of the exact bytes in storage. The anchor for the audit trail.
  sha256         text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),

  failure_reason text,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users (id) on delete set null,

  unique (contract_id, version_no),
  unique (storage_path)
);

create index if not exists contract_versions_contract_idx
  on public.contract_versions (contract_id, version_no desc);

alter table public.contract_versions enable row level security;

drop policy if exists "owners all contract_versions" on public.contract_versions;
create policy "owners all contract_versions"
  on public.contract_versions for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- Convenience: the newest ready version of each contract.
create or replace view public.contract_latest_version
with (security_invoker = true) as
  select v.*
  from public.contract_versions v
  where v.state = 'ready'
    and v.version_no = (
      select max(v2.version_no)
      from public.contract_versions v2
      where v2.contract_id = v.contract_id and v2.state = 'ready'
    );

-- ---------------------------------------------------------------------------
-- 7. Private storage bucket
-- ---------------------------------------------------------------------------
-- 50 MB cap, enforced again in the app before an upload URL is handed out.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contracts', 'contracts', false, 52428800, array['application/pdf', 'image/png'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Only owners touch this bucket, and only ever through signed URLs minted by
-- the server. There is no public read path.
drop policy if exists "owners read contracts bucket"   on storage.objects;
create policy "owners read contracts bucket"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'contracts' and public.is_owner());

drop policy if exists "owners insert contracts bucket" on storage.objects;
create policy "owners insert contracts bucket"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'contracts' and public.is_owner());

drop policy if exists "owners update contracts bucket" on storage.objects;
create policy "owners update contracts bucket"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'contracts' and public.is_owner())
  with check (bucket_id = 'contracts' and public.is_owner());

drop policy if exists "owners delete contracts bucket" on storage.objects;
create policy "owners delete contracts bucket"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'contracts' and public.is_owner());
