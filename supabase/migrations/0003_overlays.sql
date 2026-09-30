-- ===========================================================================
-- Charter — Phase 3: overlay drafts for the PDF editor
--
-- One draft per contract. Elements are stored as JSON with normalized
-- coordinates (0–1 of page width/height) so a draft survives any zoom level
-- and any render scale — the canvas and pdf-lib agree on where things go
-- without either knowing the other's pixel dimensions.
--
-- Flattening reads this draft, bakes it into a new contract_versions row, and
-- clears it. The base version is never touched.
-- ===========================================================================

create table if not exists public.contract_overlays (
  contract_id     uuid primary key references public.contracts (id) on delete cascade,
  base_version_id uuid references public.contract_versions (id) on delete set null,
  elements        jsonb not null default '[]'::jsonb,
  updated_at      timestamptz not null default now(),
  constraint contract_overlays_elements_is_array
    check (jsonb_typeof(elements) = 'array')
);

alter table public.contract_overlays enable row level security;

drop policy if exists "owners all overlays" on public.contract_overlays;
create policy "owners all overlays"
  on public.contract_overlays for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

drop trigger if exists contract_overlays_touch_updated_at on public.contract_overlays;
create trigger contract_overlays_touch_updated_at
  before update on public.contract_overlays
  for each row execute function public.touch_updated_at();

-- Images placed on a page are uploaded to the same private bucket.
update storage.buckets
   set allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg']
 where id = 'contracts';
