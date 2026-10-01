import type { Metadata } from "next";
import { requireContractAccess } from "@/lib/auth";
import { parseFilters, hasActiveFilters } from "@/lib/contracts/filters";
import { listTags, queryContracts, viewCounts } from "@/lib/contracts/dashboard-queries";
import { PageHeader, EmptyState } from "@/components/shell/page-header";
import { Uploader } from "@/components/upload/uploader";
import { Toolbar } from "@/components/dashboard/toolbar";
import { ViewTabs } from "@/components/dashboard/view-tabs";
import { ContractList } from "@/components/dashboard/contract-list";
import { Pagination } from "@/components/dashboard/pagination";

export const metadata: Metadata = { title: "Contracts" };

const VIEW_COPY = {
  live: {
    title: "Contracts",
    description:
      "Drop a PDF to add it. The original is stored untouched — edits and signatures create new versions.",
  },
  archived: {
    title: "Archived",
    description: "Out of the main list but fully intact. Unarchive any of them at any time.",
  },
  trash: {
    title: "Trash",
    description:
      "Deleted contracts, kept for 30 days and then purged along with their stored files. Restore anything here before then.",
  },
} as const;

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireContractAccess();

  const filters = parseFilters(await searchParams);

  // Three round trips in parallel: the filtered page, the tag list, the counts.
  const [page, tags, counts] = await Promise.all([
    queryContracts(filters),
    listTags(),
    viewCounts(),
  ]);

  const copy = VIEW_COPY[filters.view];
  const filtered = hasActiveFilters(filters);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={copy.title} description={copy.description} />

      <div className="space-y-5">
        <ViewTabs filters={filters} counts={counts} />

        <Toolbar filters={filters} />

        {filters.view === "live" ? <Uploader compact /> : null}

        {page.rows.length === 0 ? (
          <EmptyState
            title={
              filtered
                ? "Nothing matches that search"
                : filters.view === "trash"
                  ? "Trash is empty"
                  : filters.view === "archived"
                    ? "Nothing archived"
                    : "No contracts yet"
            }
            description={
              filtered
                ? "Try a different search term, or clear it to see everything again."
                : filters.view === "live"
                  ? "Upload a PDF and it will appear here with its page count and a preview of the first page."
                  : "Contracts you archive or delete will show up here."
            }
          />
        ) : (
          <>
            <ContractList contracts={page.rows} filters={filters} tags={tags} />
            <Pagination filters={filters} total={page.total} pageCount={page.pageCount} />
          </>
        )}
      </div>
    </div>
  );
}
