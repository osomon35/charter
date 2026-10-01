"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutGrid, Rows3, Search, X } from "lucide-react";
import { SORTS, SORT_LABELS, type Filters } from "@/lib/contracts/filters";
import { useFilters } from "@/components/dashboard/use-filters";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Search, sort, layout. Nothing else.
 *
 * The filter panel that used to live here is gone: status and tags are edited and
 * read inline on each row, folders are the sidebar, and archive/trash are views.
 * A panel duplicating all of that was a second place to look for the same
 * answers. Search still runs in Postgres across title, counterparty and notes.
 */
export function Toolbar({ filters }: { filters: Filters }) {
  const { update } = useFilters(filters);
  const [draft, setDraft] = useState(filters.query);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the box in step when the URL changes from elsewhere — the back button,
  // or a cleared search.
  useEffect(() => setDraft(filters.query), [filters.query]);

  function onType(value: string) {
    setDraft(value);
    // One history entry per search, not per keystroke.
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => update({ query: value.trim() }), 350);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={draft}
          onChange={(event) => onType(event.target.value)}
          placeholder="Search titles, counterparties and notes"
          aria-label="Search contracts"
          className="pl-8"
        />
        {draft ? (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              update({ query: "" });
            }}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>

      <Select
        value={filters.sort}
        onChange={(event) => update({ sort: event.target.value as Filters["sort"] })}
        aria-label="Sort"
        className="w-auto min-w-44"
      >
        {SORTS.map((sort) => (
          <option key={sort} value={sort}>
            {SORT_LABELS[sort]}
          </option>
        ))}
      </Select>

      <div className="flex gap-0.5 rounded-md border border-border bg-surface-muted p-0.5">
        <button
          type="button"
          onClick={() => update({ layout: "table", page: filters.page })}
          aria-pressed={filters.layout === "table"}
          title="Table"
          className={cn(
            "rounded-[5px] p-1.5",
            filters.layout === "table" ? "bg-surface shadow-sm" : "text-muted-foreground",
          )}
        >
          <Rows3 className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => update({ layout: "cards", page: filters.page })}
          aria-pressed={filters.layout === "cards"}
          title="Cards"
          className={cn(
            "rounded-[5px] p-1.5",
            filters.layout === "cards" ? "bg-surface shadow-sm" : "text-muted-foreground",
          )}
        >
          <LayoutGrid className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
