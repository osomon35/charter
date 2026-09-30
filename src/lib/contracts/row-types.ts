import type { ContractStatus, TagColor } from "@/lib/contracts/types";

/**
 * Row shapes shared between the server queries that produce them and the client
 * components that render them.
 *
 * Deliberately its own module with no `server-only` marker. These types used to
 * live beside the queries, which meant every client component imported a type
 * from a server-only file — erased at compile time and therefore harmless, but
 * one future value import away from a build failure whose error message says
 * nothing about the real cause.
 */

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

/**
 * How far a live signature request has got. Null when nothing is out for
 * signature — which is different from "nobody has signed", and the dashboard
 * needs to tell those apart.
 */
export type SigningProgress = {
  signed: number;
  total: number;
  declined: number;
};

export type ContractWithLatest = ContractRow & {
  latest: VersionRow | null;
  signing: SigningProgress | null;
};

export type FolderRow = {
  id: string;
  parent_id: string | null;
  name: string;
};

export type FolderNode = FolderRow & { children: FolderNode[]; depth: number };

export type TagRow = {
  id: string;
  name: string;
  color: TagColor;
};

export type DashboardContract = {
  id: string;
  title: string;
  counterparty_name: string | null;
  status: ContractStatus;
  folder_id: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  updated_at: string;
  created_at: string;
  archived_at: string | null;
  deleted_at: string | null;
  latest: VersionRow | null;
  signing: SigningProgress | null;
  tags: TagRow[];
};

export type ContractPage = {
  rows: DashboardContract[];
  total: number;
  page: number;
  pageCount: number;
};
