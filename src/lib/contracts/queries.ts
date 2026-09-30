import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ContractStatus } from "@/lib/contracts/types";

export type ContractRow = {
  id: string;
  title: string;
  counterparty_name: string | null;
  status: ContractStatus;
  folder_id: string | null;
  notes: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  updated_at: string;
  created_at: string;
};

export type VersionRow = {
  id: string;
  version_no: number;
  kind: "original" | "edited" | "signed";
  state: "pending" | "ready" | "failed";
  page_count: number | null;
  byte_size: number | null;
  sha256: string | null;
  thumbnail_path: string | null;
  original_name: string | null;
  created_at: string;
};

export type ContractWithLatest = ContractRow & {
  latest: VersionRow | null;
};

/**
 * Live contracts, newest activity first. "Live" excludes archived and
 * soft-deleted rows; Phase 6 adds the views that show those.
 */
export async function listContracts(): Promise<ContractWithLatest[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contracts")
    .select(
      `id, title, counterparty_name, status, folder_id, notes,
       effective_date, expiry_date, created_at, updated_at,
       contract_versions (
         id, version_no, kind, state, page_count, byte_size,
         sha256, thumbnail_path, original_name, created_at
       )`,
    )
    .is("deleted_at", null)
    .is("archived_at", null)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("list_contracts_failed", { message: error.message });
    return [];
  }

  type Joined = ContractRow & { contract_versions: VersionRow[] | null };

  return ((data ?? []) as Joined[]).map(({ contract_versions, ...contract }) => ({
    ...contract,
    latest: newestReady(contract_versions),
  }));
}

export async function getContract(id: string): Promise<ContractWithLatest | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contracts")
    .select(
      `id, title, counterparty_name, status, folder_id, notes,
       effective_date, expiry_date, created_at, updated_at,
       contract_versions (
         id, version_no, kind, state, page_count, byte_size,
         sha256, thumbnail_path, original_name, created_at
       )`,
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return null;

  const { contract_versions, ...contract } = data as ContractRow & {
    contract_versions: VersionRow[] | null;
  };

  return { ...contract, latest: newestReady(contract_versions) };
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

/** Counts per status, for the dashboard tiles. */
export async function statusCounts(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("contracts")
    .select("status")
    .is("deleted_at", null)
    .is("archived_at", null);

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { status: string }[]) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}

function newestReady(versions: VersionRow[] | null): VersionRow | null {
  if (!versions || versions.length === 0) return null;
  const ready = versions.filter((v) => v.state === "ready");
  if (ready.length === 0) return null;
  return ready.reduce((best, v) => (v.version_no > best.version_no ? v : best));
}
