"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutGrid, Rows3, Search, SlidersHorizontal, X } from "lucide-react";
import {
  SORTS,
  SORT_LABELS,
  hasActiveFilters,
  type Filters,
} from "@/lib/contracts/filters";
import {
  CONTRACT_STATUSES,
  STATUS_LABELS,
  TAG_COLOR_CLASSES,
} from "@/lib/contracts/types";
import type { FolderNode, TagRow } from "@/lib/contracts/row-types";
import { flattenTreeClient } from "@/components/dashboard/tree";
import { useFilters } from "@/components/dashboard/use-filters";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function Toolbar({
  filters,
  folders,
  tags,
}: {
  filters: Filters;
  folders: FolderNode[];
  tags: TagRow[];
}) {
  const { update, reset, pending } = useFilters(filters);
  const [open, setOpen] = useState(hasActiveFilters(filters) && !filters.query);
  const [draft, setDraft] = useState(filters.query);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the box in step when the URL changes from elsewhere — a cleared filter
  // chip, or the browser back button.
  useEffect(() => setDraft(filters.query), [filters.query]);

  // Typing should not push a history entry per keystroke.
  function onType(value: string) {
    setDraft(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => update({ query: value.trim() }), 350);
  }

  const flatFolders = flattenTreeClient(folders);

  return (
    <div className="space-y-3">
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

        <Button
          variant={open ? "default" : "outline"}
          size="sm"
          onClick={() => setOpen((current) => !current)}
        >
          <SlidersHorizontal aria-hidden />
          Filters
        </Button>

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

      {open ? (
        <div className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>Status</Label>
            <div className="flex flex-wrap gap-1.5">
              {CONTRACT_STATUSES.map((status) => {
                const active = filters.statuses.includes(status);
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() =>
                      update({
                        statuses: active
                          ? filters.statuses.filter((entry) => entry !== status)
                          : [...filters.statuses, status],
                      })
                    }
                    aria-pressed={active}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs transition-colors",
                      active
                        ? "border-primary bg-primary-subtle font-medium"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {STATUS_LABELS[status]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="filter-folder">Folder</Label>
            <Select
              id="filter-folder"
              value={filters.folderId ?? ""}
              onChange={(event) => update({ folderId: event.target.value || null })}
            >
              <option value="">Any folder</option>
              {flatFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {"— ".repeat(folder.depth)}
                  {folder.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="filter-counterparty">Counterparty</Label>
            <Input
              id="filter-counterparty"
              defaultValue={filters.counterparty}
              placeholder="Any"
              onBlur={(event) => {
                if (event.target.value.trim() !== filters.counterparty) {
                  update({ counterparty: event.target.value.trim() });
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Effective date</Label>
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={filters.from ?? ""}
                aria-label="From"
                onChange={(event) => update({ from: event.target.value || null })}
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={filters.to ?? ""}
                aria-label="To"
                onChange={(event) => update({ to: event.target.value || null })}
              />
            </div>
          </div>

          {tags.length > 0 ? (
            <div className="space-y-2 sm:col-span-2 lg:col-span-4">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const active = filters.tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() =>
                        update({
                          tagIds: active
                            ? filters.tagIds.filter((entry) => entry !== tag.id)
                            : [...filters.tagIds, tag.id],
                        })
                      }
                      aria-pressed={active}
                    >
                      <Badge
                        className={cn(
                          TAG_COLOR_CLASSES[tag.color],
                          active ? "ring-1 ring-primary" : "opacity-70",
                        )}
                      >
                        {tag.name}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {hasActiveFilters(filters) ? (
            <div className="sm:col-span-2 lg:col-span-4">
              <Button variant="ghost" size="sm" onClick={reset} disabled={pending}>
                <X aria-hidden />
                Clear all filters
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
