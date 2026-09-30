import { CONTRACT_STATUSES, type ContractStatus } from "@/lib/contracts/types";

/**
 * Dashboard state lives in the URL, not in React.
 *
 * That is what makes a filtered view shareable, bookmarkable, survivable across
 * a reload, and — the practical part — filterable on the server. Holding it in
 * component state would mean fetching every contract and filtering in the
 * browser, which is the thing that stops working first as the list grows.
 */
export const VIEWS = ["live", "archived", "trash"] as const;
export type View = (typeof VIEWS)[number];

export const SORTS = ["recent", "title", "created", "expiry"] as const;
export type Sort = (typeof SORTS)[number];

export const SORT_LABELS: Record<Sort, string> = {
  recent: "Recently updated",
  title: "Title A–Z",
  created: "Newest first",
  expiry: "Expiring soonest",
};

export const LAYOUTS = ["table", "cards"] as const;
export type Layout = (typeof LAYOUTS)[number];

export const PAGE_SIZE = 50;

export type Filters = {
  view: View;
  layout: Layout;
  sort: Sort;
  query: string;
  statuses: ContractStatus[];
  folderId: string | null;
  tagIds: string[];
  from: string | null;
  to: string | null;
  counterparty: string;
  page: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function list(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : value.split(",");
  return raw.map((entry) => entry.trim()).filter(Boolean);
}

export function parseFilters(
  params: Record<string, string | string[] | undefined>,
): Filters {
  const single = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const page = Number.parseInt(single("page") ?? "1", 10);
  const from = single("from");
  const to = single("to");

  return {
    view: oneOf(single("view"), VIEWS, "live"),
    layout: oneOf(single("layout"), LAYOUTS, "table"),
    sort: oneOf(single("sort"), SORTS, "recent"),
    query: (single("q") ?? "").trim().slice(0, 200),
    statuses: list(params.status).filter((value): value is ContractStatus =>
      (CONTRACT_STATUSES as readonly string[]).includes(value),
    ),
    folderId: single("folder") ?? null,
    tagIds: list(params.tag),
    from: from && ISO_DATE.test(from) ? from : null,
    to: to && ISO_DATE.test(to) ? to : null,
    counterparty: (single("counterparty") ?? "").trim().slice(0, 200),
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 500) : 1,
  };
}

/** Serialises back to a query string, omitting anything at its default. */
export function toSearchParams(filters: Partial<Filters>): string {
  const params = new URLSearchParams();

  if (filters.view && filters.view !== "live") params.set("view", filters.view);
  if (filters.layout && filters.layout !== "table") params.set("layout", filters.layout);
  if (filters.sort && filters.sort !== "recent") params.set("sort", filters.sort);
  if (filters.query) params.set("q", filters.query);
  if (filters.statuses?.length) params.set("status", filters.statuses.join(","));
  if (filters.folderId) params.set("folder", filters.folderId);
  if (filters.tagIds?.length) params.set("tag", filters.tagIds.join(","));
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.counterparty) params.set("counterparty", filters.counterparty);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));

  const query = params.toString();
  return query ? `?${query}` : "";
}

/** True when anything narrows the list, so the UI can offer a single reset. */
export function hasActiveFilters(filters: Filters): boolean {
  return Boolean(
    filters.query ||
      filters.statuses.length ||
      filters.folderId ||
      filters.tagIds.length ||
      filters.from ||
      filters.to ||
      filters.counterparty,
  );
}
