-- ===========================================================================
-- Charter — move pre-existing tables out of the way
--
-- This database already contained tables named contracts and contract_versions
-- (and a function enforce_email_allowlist) from some earlier use. `create table
-- if not exists` adopts such a table silently: no error, but the columns the
-- app expects are absent, which surfaced as "column search_vector does not
-- exist" and then "column version_no does not exist".
--
-- Rather than drop them, each is moved to a timestamped backup schema.
-- `alter table ... set schema` carries the table's indexes and constraints with
-- it, which frees those names in public too — renaming the table alone would
-- not, and the next `create index` would collide.
--
-- Nothing is deleted. Recover anything wanted with:
--   select * from pre_charter_<timestamp>.contracts;
-- and drop the schema once satisfied it holds nothing of value.
-- ===========================================================================

do $$
declare
  backup_schema text := 'pre_charter_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');
  t text;
  moved int := 0;
begin
  execute format('create schema if not exists %I', backup_schema);

  -- The view is ours and always disposable.
  execute 'drop view if exists public.contract_latest_version';

  -- Children before parents, so foreign keys travel intact.
  for t in
    select unnest(array['contract_tags', 'contract_versions', 'contracts', 'tags', 'folders'])
  loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then
      execute format('alter table public.%I set schema %I', t, backup_schema);
      moved := moved + 1;
      raise notice 'moved public.% to %', t, backup_schema;
    end if;
  end loop;

  if moved = 0 then
    raise notice 'nothing to move; public was already clear';
  else
    raise notice '% table(s) moved to %', moved, backup_schema;
  end if;
end;
$$;
