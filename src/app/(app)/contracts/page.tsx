import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { parseFilters, hasActiveFilters } from "@/lib/contracts/filters";
import {
  listFolders,
  listTags,
  queryContracts,
  viewCounts,
} from "@/lib/contracts/dashboard-queries";
import { PageHeader, EmptyState } from "@/components/shell/page-header";
import { Uploader } from "@/components/upload/uploader";
import { Toolbar } from "@/components/dashboard/toolbar";
import { FolderTree } from "@/components/dashboard/folder-tree";
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
  await requireOwner();

  const filters = parseFilters(await searchParams);

  // One round trip each, in parallel: the folder tree, the tag list, the view
  // counts, and the filtered page itself.
  const [page, folders, tags, counts] = await Promise.all([
    queryContracts(filters),
    listFolders(),
    listTags(),
    viewCounts(),
  ]);

  const copy = VIEW_COPY[filters.view];
  const filtered = hasActiveFilters(filters);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={copy.title} description={copy.description} />

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="w-full shrink-0 lg:w-56">
          <FolderTree folders={folders} filters={filters} counts={counts} />
        </aside>

        <div className="min-w-0 flex-1 space-y-5">
          <Toolbar filters={filters} />

          {filters.view === "live" ? <Uploader compact /> : null}

          {page.rows.length === 0 ? (
            <EmptyState
              title={
                filtered
                  ? "Nothing matches those filters"
                  : filters.view === "trash"
                    ? "Trash is empty"
                    : filters.view === "archived"
                      ? "Nothing archived"
                      : "No contracts yet"
              }
              description={
                filtered
                  ? "Try widening the search, or clear the filters to see everything again."
                  : filters.view === "live"
                    ? "Once you upload a PDF it will appear here with its page count and a preview of the first page."
                    : "Contracts you archive or delete will show up here."
              }
            />
          ) : (
            <>
              <ContractList
                contracts={page.rows}
                filters={filters}
                folders={folders}
                tags={tags}
              />
              <Pagination
                filters={filters}
                total={page.total}
                pageCount={page.pageCount}
              />
            </>
          )}

        </div>
      </div>
    </div>
  );
}
