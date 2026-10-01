"use client";

import Link from "next/link";
import { Archive, Inbox, Trash2 } from "lucide-react";
import { toSearchParams, type Filters, type View } from "@/lib/contracts/filters";
import { cn } from "@/lib/utils";

/**
 * All contracts / Archived / Trash.
 *
 * Links rather than buttons, so each is keyboard-reachable, middle-clickable, and
 * cannot have its navigation swallowed by anything else on the row. Switching view
 * drops the search and paging, since neither carries over meaningfully.
 */
const TABS: { view: View; label: string; Icon: typeof Inbox }[] = [
  { view: "live", label: "All contracts", Icon: Inbox },
  { view: "archived", label: "Archived", Icon: Archive },
  { view: "trash", label: "Trash", Icon: Trash2 },
];

export function ViewTabs({
  filters,
  counts,
}: {
  filters: Filters;
  counts: { live: number; archived: number; trash: number };
}) {
  return (
    <nav aria-label="Views" className="flex flex-wrap items-center gap-1">
      {TABS.map(({ view, label, Icon }) => (
        <Link
          key={view}
          href={`/contracts${toSearchParams({
            view,
            layout: filters.layout,
            sort: filters.sort,
          })}`}
          scroll={false}
          aria-current={filters.view === view ? "page" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
            filters.view === view
              ? "bg-primary-subtle font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Icon className="size-3.5 shrink-0" aria-hidden />
          {label}
          <span className="tabular-nums text-xs text-muted-foreground">
            {counts[view]}
          </span>
        </Link>
      ))}
    </nav>
  );
}
