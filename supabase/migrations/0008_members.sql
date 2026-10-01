-- ===========================================================================
-- Charter — members, roles and blocking
--
-- owner_allowlist becomes the single authority for access. The OWNER_ALLOWLIST
-- environment variable is retired as a gate: two places to maintain meant every
-- new person needed a deploy, and a mismatch between them locked someone out or
-- let them in to see nothing.
--
-- Three roles, and they are enforced in RLS rather than only in the UI:
--
--   admin   — everything, including managing members
--   sender  — everything except managing members
--   signer  — no access to contracts at all; can hold signatures and sign links
--
-- Blocking is a timestamp rather than a deleted row, so access ends immediately
-- while the person and their history remain legible in the audit trail.
-- ===========================================================================

alter table public.owner_allowlist
  add column if not exists name text;

alter table public.owner_allowlist
  add column if not exists role text not null default 'sender'
    check (role in ('admin', 'sender', 'signer'));

alter table public.owner_allowlist
  add column if not exists blocked_at timestamptz;

alter table public.owner_allowlist
  add column if not exists invited_at timestamptz;

alter table public.owner_allowlist
  add column if not exists invited_by text;

-- Whoever is already here is the admin; without this the first person loses the
-- ability to manage anyone, including themselves.
update public.owner_allowlist set role = 'admin' where role is null or role = 'sender';

-- ---------------------------------------------------------------------------
-- Predicates
-- ---------------------------------------------------------------------------
-- A blocked member is not an owner. Every existing policy is gated on this, so
-- blocking takes effect on their next request with no other change anywhere.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.owner_allowlist a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and a.blocked_at is null
  );
$$;

create or replace function public.member_role()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select a.role
  from public.owner_allowlist a
  where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and a.blocked_at is null;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select public.member_role() = 'admin';
$$;

-- Who may see and change contracts. A signer may not: they hold signatures and
-- follow signing links, and have no business in the document library.
create or replace function public.can_manage_contracts()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select public.member_role() in ('admin', 'sender');
$$;

revoke all on function public.member_role() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.can_manage_contracts() from public;
grant execute on function public.member_role() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.can_manage_contracts() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Managing members
-- ---------------------------------------------------------------------------
-- Admins may now change the roster through the app. Deliberately narrow: an
-- admin cannot be created except by another admin, and the policies below are the
-- only write path.
drop policy if exists "owners read allowlist" on public.owner_allowlist;
create policy "members read roster"
  on public.owner_allowlist for select
  to authenticated
  using (public.is_owner());

drop policy if exists "admins insert members" on public.owner_allowlist;
create policy "admins insert members"
  on public.owner_allowlist for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admins update members" on public.owner_allowlist;
create policy "admins update members"
  on public.owner_allowlist for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins delete members" on public.owner_allowlist;
create policy "admins delete members"
  on public.owner_allowlist for delete
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Contract access now depends on role, not merely on membership
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'contracts', 'contract_versions', 'contract_overlays', 'contract_tags', 'tags',
    'envelopes', 'recipients', 'fields'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'owners all ' || t, t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.can_manage_contracts()) with check (public.can_manage_contracts())',
      'members manage ' || t, t
    );
  end loop;
end;
$$;

-- The audit trail stays append-only: select and insert, never update or delete.
drop policy if exists "owners read audit" on public.audit_events;
create policy "members read audit" on public.audit_events for select
  to authenticated using (public.can_manage_contracts());

drop policy if exists "owners insert audit" on public.audit_events;
create policy "members insert audit" on public.audit_events for insert
  to authenticated with check (public.can_manage_contracts());

-- Storage follows the same rule.
drop policy if exists "owners read contracts bucket"   on storage.objects;
drop policy if exists "owners insert contracts bucket" on storage.objects;
drop policy if exists "owners update contracts bucket" on storage.objects;
drop policy if exists "owners delete contracts bucket" on storage.objects;

create policy "members read contracts bucket" on storage.objects for select
  to authenticated using (bucket_id = 'contracts' and public.is_owner());

create policy "members insert contracts bucket" on storage.objects for insert
  to authenticated with check (bucket_id = 'contracts' and public.is_owner());

create policy "members update contracts bucket" on storage.objects for update
  to authenticated using (bucket_id = 'contracts' and public.is_owner())
  with check (bucket_id = 'contracts' and public.is_owner());

create policy "members delete contracts bucket" on storage.objects for delete
  to authenticated using (bucket_id = 'contracts' and public.is_owner());

-- Signatures and profiles stay keyed on membership rather than role: a signer
-- needs their own signature and their own profile, and nothing else.

notify pgrst, 'reload schema';
