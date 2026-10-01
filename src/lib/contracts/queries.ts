import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  ContractRow,
  ContractWithLatest,
  SigningProgress,
  VersionRow,
} from "@/lib/contracts/row-types";

export type {
  ContractRow,
  ContractWithLatest,
  SigningProgress,
  VersionRow,
} from "@/lib/contracts/row-types";

/**
 * Live contracts, newest activity first, for the dashboard's Recent strip.
 *
 * The contracts list itself uses queryContracts in dashboard-queries.ts, which
 * filters and pages in Postgres. This one stays deliberately simple: a short
 * unfiltered slice is all the dashboard shows.
 */
export async function listContracts(): Promise<ContractWithLatest[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contracts")
    .select(
      `id, title, counterparty_name, status, notes,
       effective_date, expiry_date, created_at, updated_at,
       contract_versions (
         id, version_no, kind, state, page_count, byte_size,
         sha256, thumbnail_path, original_name, created_at
       ),
       envelopes ( status, recipients ( status ) )`,
    )
    .is("deleted_at", null)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    // Phase 6 adds paging and filters; until then a ceiling keeps one enormous
    // payload from being the thing that makes the list feel slow.
    .limit(200);

  if (error) {
    console.error("list_contracts_failed", { message: error.message });
    return [];
  }

  type Joined = ContractRow & {
    contract_versions: VersionRow[] | null;
    envelopes: EnvelopeProgressRow[] | null;
  };

  return ((data ?? []) as Joined[]).map(({ contract_versions, envelopes, ...contract }) => ({
    ...contract,
    latest: newestReady(contract_versions),
    signing: progressOf(envelopes),
  }));
}

export async function getContract(id: string): Promise<ContractWithLatest | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contracts")
    .select(
      `id, title, counterparty_name, status, notes,
       effective_date, expiry_date, created_at, updated_at,
       contract_versions (
         id, version_no, kind, state, page_count, byte_size,
         sha256, thumbnail_path, original_name, created_at
       ),
       envelopes ( status, recipients ( status ) )`,
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return null;

  const { contract_versions, envelopes, ...contract } = data as ContractRow & {
    contract_versions: VersionRow[] | null;
    envelopes: EnvelopeProgressRow[] | null;
  };

  return {
    ...contract,
    latest: newestReady(contract_versions),
    signing: progressOf(envelopes),
  };
}

export async function listVersions(contractId: string): Promise<VersionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("contract_versions")
    .select(
      "id, version_no, kind, state, page_count, byte_size, sha256, thumbnail_path, original_name, created_at",
    )
    .eq("contract_id", contractId)
    .order("version_no", { ascending: false });

  return (data ?? []) as VersionRow[];
}

/**
 * Counts per status, derived from a list already in hand.
 *
 * Was a second query against contracts alongside listContracts, fetching the
 * same rows twice for one number each. The dashboard needs both, so it fetches
 * once and counts locally.
 */
export function countByStatus(contracts: ContractWithLatest[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const contract of contracts) {
    counts[contract.status] = (counts[contract.status] ?? 0) + 1;
  }
  return counts;
}

type EnvelopeProgressRow = { status: string; recipients: { status: string }[] | null };

/**
 * Counts signatures across whichever envelope is still live.
 *
 * Only sent and partially_signed envelopes count: a completed one needs no flag,
 * and a voided one's recipients are irrelevant.
 */
function progressOf(envelopes: EnvelopeProgressRow[] | null): SigningProgress | null {
  const live = (envelopes ?? []).filter(
    (envelope) => envelope.status === "sent" || envelope.status === "partially_signed",
  );
  if (live.length === 0) return null;

  const recipients = live.flatMap((envelope) => envelope.recipients ?? []);
  if (recipients.length === 0) return null;

  return {
    signed: recipients.filter((recipient) => recipient.status === "signed").length,
    total: recipients.length,
    declined: recipients.filter((recipient) => recipient.status === "declined").length,
  };
}

function newestReady(versions: VersionRow[] | null): VersionRow | null {
  if (!versions || versions.length === 0) return null;
  const ready = versions.filter((v) => v.state === "ready");
  if (ready.length === 0) return null;
  return ready.reduce((best, v) => (v.version_no > best.version_no ? v : best));
}

/**
 * The version an overlay is edited against: the original upload.
 *
 * Deliberately not the latest version. Flattening renders source + overlay into
 * a new version, so if the overlay were re-based onto its own output every edit
 * would be applied twice — and, worse, elements would become unreachable once
 * baked into pixels. Keeping the source fixed is what makes the editing
 * non-destructive and lets a typo be fixed three versions later.
 */
export async function getSourceVersion(contractId: string): Promise<VersionRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("contract_versions")
    .select(
      "id, version_no, kind, state, page_count, byte_size, sha256, thumbnail_path, original_name, created_at",
    )
    .eq("contract_id", contractId)
    .eq("state", "ready")
    .order("version_no", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (data as VersionRow | null) ?? null;
}

/** Just the tag ids on one contract, for the picker's initial state. */
export async function listAssignedTagIds(contractId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("contract_tags")
    .select("tag_id")
    .eq("contract_id", contractId);

  return ((data ?? []) as { tag_id: string }[]).map((row) => row.tag_id);
}
