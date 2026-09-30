-- ===========================================================================
-- Charter — Phase 6: dashboard support
--
-- Most of what this phase needs already exists: folders and tags came in with
-- 0002, along with contracts.archived_at, contracts.deleted_at and the generated
-- search_vector. What is left is auto-reminders and the indexes the archive and
-- trash views want.
-- ===========================================================================

-- Auto-reminders. Per envelope rather than global: how patient to be depends on
-- the document, and a global default would be wrong for most of them.
alter table public.envelopes
  add column if not exists reminder_after_days integer
    check (reminder_after_days is null or reminder_after_days between 1 and 90);

alter table public.envelopes
  add column if not exists last_reminder_at timestamptz;

-- The main list is already covered by contracts_live_idx. These two are for the
-- other two views, which would otherwise scan the table.
create index if not exists contracts_archived_idx
  on public.contracts (archived_at desc)
  where deleted_at is null and archived_at is not null;

create index if not exists contracts_deleted_idx
  on public.contracts (deleted_at desc)
  where deleted_at is not null;

-- Counterparty filtering is a prefix/contains match, so it needs trigrams to be
-- indexable at all. Cheap to add now; the alternative is a sequential scan that
-- only starts hurting once it is too late to notice.
create extension if not exists pg_trgm with schema public;

create index if not exists contracts_counterparty_trgm_idx
  on public.contracts using gin (counterparty_name public.gin_trgm_ops);

notify pgrst, 'reload schema';
