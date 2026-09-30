-- ===========================================================================
-- Charter — Phase 5: envelopes, recipients, fields, audit trail
--
-- Every table here is owner-only under RLS. Signers have no database identity
-- and no anon policy grants them anything: the signer route resolves a hashed
-- token with the service-role client and then acts on exactly the rows that
-- token proves it may touch. That is the whole authorization model for
-- unauthenticated signing, and it lives in application code on purpose —
-- a policy cannot express "this bearer token maps to this one recipient row".
--
-- Geometry columns are double precision rather than numeric so PostgREST
-- returns them as JSON numbers; numeric arrives as a string and would silently
-- break the coordinate maths.
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'send_routing') then
    create type public.send_routing as enum ('parallel', 'sequential');
  end if;
  if not exists (select 1 from pg_type where typname = 'envelope_status') then
    create type public.envelope_status as enum
      ('draft', 'sent', 'partially_signed', 'completed', 'declined', 'expired', 'voided');
  end if;
  if not exists (select 1 from pg_type where typname = 'recipient_status') then
    create type public.recipient_status as enum
      ('pending', 'sent', 'viewed', 'signed', 'declined');
  end if;
  if not exists (select 1 from pg_type where typname = 'field_type') then
    create type public.field_type as enum
      ('signature', 'initials', 'date_signed', 'text', 'checkbox');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Envelopes — one send of one contract
-- ---------------------------------------------------------------------------
create table if not exists public.envelopes (
  id                uuid primary key default gen_random_uuid(),
  contract_id       uuid not null references public.contracts (id) on delete cascade,
  -- The exact version recipients are shown. Fixed at send time so the hash in
  -- the audit trail refers to something that cannot change underneath them.
  source_version_id uuid not null references public.contract_versions (id),
  final_version_id  uuid references public.contract_versions (id),
  routing           public.send_routing not null default 'parallel',
  status            public.envelope_status not null default 'draft',
  subject           text,
  message           text,
  expires_at        timestamptz,
  sent_at           timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null
);

create index if not exists envelopes_contract_idx on public.envelopes (contract_id, created_at desc);
create index if not exists envelopes_status_idx   on public.envelopes (status);

alter table public.envelopes enable row level security;
drop policy if exists "owners all envelopes" on public.envelopes;
create policy "owners all envelopes" on public.envelopes for all
  to authenticated using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- Recipients
-- ---------------------------------------------------------------------------
create table if not exists public.recipients (
  id               uuid primary key default gen_random_uuid(),
  envelope_id      uuid not null references public.envelopes (id) on delete cascade,
  name             text not null check (length(trim(name)) between 1 and 200),
  email            text not null check (email = lower(email) and position('@' in email) > 1),
  role             text,
  -- Signing order for sequential routing; ignored when parallel.
  order_index      integer not null default 0,
  status           public.recipient_status not null default 'pending',

  -- HMAC-SHA256 of the link token, keyed with SIGNER_TOKEN_PEPPER. The token
  -- itself is never stored and never logged, so a database leak alone does not
  -- yield a working link, and a short token cannot be brute-forced offline
  -- without the pepper.
  token_hash       text unique,
  token_expires_at timestamptz,

  consented_at     timestamptz,
  signed_at        timestamptz,
  declined_at      timestamptz,
  decline_reason   text,
  last_viewed_at   timestamptz,
  notified_at      timestamptz,
  reminder_count   integer not null default 0,
  created_at       timestamptz not null default now(),

  unique (envelope_id, email)
);

create index if not exists recipients_envelope_idx on public.recipients (envelope_id, order_index);
create index if not exists recipients_token_idx    on public.recipients (token_hash);

alter table public.recipients enable row level security;
drop policy if exists "owners all recipients" on public.recipients;
create policy "owners all recipients" on public.recipients for all
  to authenticated using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- Fields — each assigned to exactly one recipient
-- ---------------------------------------------------------------------------
create table if not exists public.fields (
  id               uuid primary key default gen_random_uuid(),
  envelope_id      uuid not null references public.envelopes (id) on delete cascade,
  recipient_id     uuid not null references public.recipients (id) on delete cascade,
  type             public.field_type not null,
  page             integer not null check (page >= 1),
  x                double precision not null,
  y                double precision not null,
  w                double precision not null check (w > 0),
  h                double precision not null check (h > 0),
  required         boolean not null default true,
  label            text,
  order_index      integer not null default 0,

  value_text       text,
  value_bool       boolean,
  value_asset_path text,
  filled_at        timestamptz,

  created_at       timestamptz not null default now()
);

create index if not exists fields_envelope_idx  on public.fields (envelope_id, page, order_index);
create index if not exists fields_recipient_idx on public.fields (recipient_id);

alter table public.fields enable row level security;
drop policy if exists "owners all fields" on public.fields;
create policy "owners all fields" on public.fields for all
  to authenticated using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------
-- Append-only by intent: there is no update or delete policy, so even the owner
-- cannot quietly rewrite history through the API. The document hash recorded on
-- each event is what lets anyone confirm afterwards which bytes were involved.
create table if not exists public.audit_events (
  id               uuid primary key default gen_random_uuid(),
  contract_id      uuid not null references public.contracts (id) on delete cascade,
  envelope_id      uuid references public.envelopes (id) on delete set null,
  recipient_id     uuid references public.recipients (id) on delete set null,
  kind             text not null check (length(kind) between 1 and 40),
  actor            text,
  ip               text,
  user_agent       text,
  document_sha256  text check (document_sha256 is null or document_sha256 ~ '^[0-9a-f]{64}$'),
  detail           jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists audit_events_contract_idx on public.audit_events (contract_id, created_at);
create index if not exists audit_events_envelope_idx on public.audit_events (envelope_id, created_at);

alter table public.audit_events enable row level security;

drop policy if exists "owners read audit"   on public.audit_events;
create policy "owners read audit" on public.audit_events for select
  to authenticated using (public.is_owner());

drop policy if exists "owners insert audit" on public.audit_events;
create policy "owners insert audit" on public.audit_events for insert
  to authenticated with check (public.is_owner());

notify pgrst, 'reload schema';
