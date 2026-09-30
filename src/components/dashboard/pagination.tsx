"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZE, type Filters } from "@/lib/contracts/filters";
import { useFilters } from "@/components/dashboard/use-filters";

export function Pagination({
  filters,
  total,
  pageCount,
}: {
  filters: Filters;
  total: number;
  pageCount: number;
}) {
  const { update, pending } = useFilters(filters);

  if (total === 0) return null;

  const first = (filters.page - 1) * PAGE_SIZE + 1;
  const last = Math.min(filters.page * PAGE_SIZE, total);

  return (
    <div className="flex items-center justify-between gap-4 pt-1">
      <p className="text-xs tabular-nums text-muted-foreground">
        {first}–{last} of {total}
      </p>

      {pageCount > 1 ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={filters.page <= 1 || pending}
            onClick={() => update({ page: filters.page - 1 })}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {filters.page} / {pageCount}
          </span>
          <button
            type="button"
            disabled={filters.page >= pageCount || pending}
            onClick={() => update({ page: filters.page + 1 })}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
            aria-label="Next page"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
