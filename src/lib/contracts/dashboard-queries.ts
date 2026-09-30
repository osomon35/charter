import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type {
  ContractPage,
  DashboardContract,
  FolderNode,
  FolderRow,
  TagRow,
  VersionRow,
} from "@/lib/contracts/row-types";

export type {
  ContractPage,
  DashboardContract,
  FolderNode,
  FolderRow,
  TagRow,
} from "@/lib/contracts/row-types";
import { PAGE_SIZE, type Filters } from "@/lib/contracts/filters";
import { embedOne } from "@/lib/supabase/embed";

const SELECT = `
  id, title, counterparty_name, status, folder_id, effective_date, expiry_date,
  created_at, updated_at, archived_at, deleted_at,
  contract_versions (
    id, version_no, kind, state, page_count, byte_size,
    sha256, thumbnail_path, original_name, created_at
  ),
  envelopes ( status, recipients ( status ) ),
  contract_tags ( tags ( id, name, color ) )
`;

/**
 * The dashboard's one query.
 *
 * Every filter is applied in Postgres, and the count comes back with the page,
 * so the browser never receives rows it will not show. Doing any of this client
 * side is the thing that stops working first as the list grows.
 */
export async function queryContracts(filters: Filters): Promise<ContractPage> {
  const supabase = await createClient();

  // Tag filtering runs as its own lookup rather than an inner-join embed.
  //
  // The embed version needed a second select string built with .replace(), which
  // makes it non-literal — supabase-js then cannot derive a row type from it, and
  // the two builders end up with incompatible types. It also meant applying every
  // other filter twice. One extra small query, only when tags are actually
  // filtered on, costs less than either.
  //
  // Several tags mean "carries any of these", which is what the inner join did.
  let tagMatchedIds: string[] | null = null;

  if (filters.tagIds.length > 0) {
    const { data: joins } = await supabase
      .from("contract_tags")
      .select("contract_id")
      .in("tag_id", filters.tagIds);

    tagMatchedIds = [
      ...new Set(((joins ?? []) as { contract_id: string }[]).map((row) => row.contract_id)),
    ];

    // No contract carries those tags, so nothing can match. Returning early
    // avoids sending an empty IN list, which Postgres treats as always-false but
    // PostgREST renders awkwardly.
    if (tagMatchedIds.length === 0) {
      return { rows: [], total: 0, page: 1, pageCount: 1 };
    }
  }

  let request = supabase.from("contracts").select(SELECT, { count: "exact" });

  // Views are mutually exclusive states, not filters that stack.
  if (filters.view === "live") {
    request = request.is("deleted_at", null).is("archived_at", null);
  } else if (filters.view === "archived") {
    request = request.is("deleted_at", null).not("archived_at", "is", null);
  } else {
    request = request.not("deleted_at", "is", null);
  }

  if (tagMatchedIds) request = request.in("id", tagMatchedIds);
  if (filters.statuses.length > 0) request = request.in("status", filters.statuses);
  if (filters.folderId) request = request.eq("folder_id", filters.folderId);
  if (filters.counterparty) {
    request = request.ilike("counterparty_name", `%${filters.counterparty}%`);
  }
  if (filters.from) request = request.gte("effective_date", filters.from);
  if (filters.to) request = request.lte("effective_date", filters.to);

  if (filters.query) {
    // websearch_to_tsquery tolerates whatever a person actually types — bare
    // words, quoted phrases, a stray "or" — where plainto_tsquery would choke and
    // to_tsquery would reject it outright.
    request = request.textSearch("search_vector", filters.query, {
      type: "websearch",
      config: "english",
    });
  }

  // Ordering goes into a new binding rather than back into `request`.
  // .order() returns a transform builder, and the filter builder the reassignment
  // is typed against extends it — so the assignment is backwards and will not
  // type-check. A ternary keeps one consistent type throughout.
  const ordered =
    filters.sort === "title"
      ? request.order("title", { ascending: true })
      : filters.sort === "created"
        ? request.order("created_at", { ascending: false })
        : filters.sort === "expiry"
          ? // nullsFirst false: no expiry date is not "expiring soonest".
            request.order("expiry_date", { ascending: true, nullsFirst: false })
          : request.order("updated_at", { ascending: false });

  const offset = (filters.page - 1) * PAGE_SIZE;
  const { data, error, count } = await ordered.range(offset, offset + PAGE_SIZE - 1);

  if (error) {
    console.error("query_contracts_failed", { message: error.message });
    return { rows: [], total: 0, page: 1, pageCount: 1 };
  }

  const total = count ?? 0;

  return {
    rows: (data ?? []).map(shape),
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

type RawRow = Omit<DashboardContract, "latest" | "signing" | "tags"> & {
  contract_versions: VersionRow[] | null;
  envelopes: { status: string; recipients: { status: string }[] | null }[] | null;
  // `tags` inside the join row is a to-one embed, so PostgREST sends an object
  // while supabase-js types it as an array — embedOne below accepts either.
  contract_tags: { tags: unknown }[] | null;
};

function shape(raw: unknown): DashboardContract {
  const row = raw as RawRow;
  const { contract_versions, envelopes, contract_tags, ...contract } = row;

  const ready = (contract_versions ?? []).filter((version) => version.state === "ready");
  const latest =
    ready.length > 0
      ? ready.reduce((best, version) => (version.version_no > best.version_no ? version : best))
      : null;

  const live = (envelopes ?? []).filter(
    (envelope) => envelope.status === "sent" || envelope.status === "partially_signed",
  );
  const recipients = live.flatMap((envelope) => envelope.recipients ?? []);

  return {
    ...contract,
    latest,
    signing:
      recipients.length > 0
        ? {
            signed: recipients.filter((r) => r.status === "signed").length,
            total: recipients.length,
            declined: recipients.filter((r) => r.status === "declined").length,
          }
        : null,
    tags: (contract_tags ?? [])
      .map((join) => embedOne<TagRow>(join.tags))
      .filter((tag): tag is TagRow => Boolean(tag)),
  };
}

// ---------------------------------------------------------------------------
// Sidebar data
// ---------------------------------------------------------------------------

/** Cached per request: the shell and the page both want these. */
export const listFolders = cache(async (): Promise<FolderNode[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("folders")
    .select("id, parent_id, name")
    .order("name", { ascending: true });

  return buildTree((data ?? []) as FolderRow[]);
});

export const listTags = cache(async (): Promise<TagRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tags")
    .select("id, name, color")
    .order("name", { ascending: true });

  return (data ?? []) as TagRow[];
});

/**
 * Counts for the view tabs and status chips.
 *
 * Deliberately three head-only requests rather than fetching rows: the numbers
 * are all that is needed, and PostgREST can return a count without a body.
 */
export const viewCounts = cache(
  async (): Promise<{ live: number; archived: number; trash: number }> => {
    const supabase = await createClient();

    const [live, archived, trash] = await Promise.all([
      supabase
        .from("contracts")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .is("archived_at", null),
      supabase
        .from("contracts")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .not("archived_at", "is", null),
      supabase
        .from("contracts")
        .select("id", { count: "exact", head: true })
        .not("deleted_at", "is", null),
    ]);

    return {
      live: live.count ?? 0,
      archived: archived.count ?? 0,
      trash: trash.count ?? 0,
    };
  },
);

/** Flat rows to a nested tree, with depth for indentation. */
function buildTree(rows: FolderRow[]): FolderNode[] {
  const byId = new Map<string, FolderNode>();
  for (const row of rows) byId.set(row.id, { ...row, children: [], depth: 0 });

  const roots: FolderNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const assignDepth = (nodes: FolderNode[], depth: number) => {
    for (const node of nodes) {
      node.depth = depth;
      assignDepth(node.children, depth + 1);
    }
  };
  assignDepth(roots, 0);

  return roots;
}

/** Depth-first flatten, for rendering a tree as a list. */
export function flattenTree(nodes: FolderNode[]): FolderNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}
