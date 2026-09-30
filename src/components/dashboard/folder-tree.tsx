"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Folder, FolderOpen, Inbox, Pencil, Plus, Trash2 } from "lucide-react";
import {
  bulkMove,
  createFolder,
  deleteFolder,
  moveFolder,
  renameFolder,
} from "@/lib/contracts/organise-actions";
import type { FolderNode } from "@/lib/contracts/row-types";
import type { Filters } from "@/lib/contracts/filters";
import { useFilters } from "@/components/dashboard/use-filters";
import { Input } from "@/components/ui/input";
import {
  acceptDrag,
  readDrop,
  startFolderDrag,
} from "@/components/dashboard/dnd";
import { cn } from "@/lib/utils";

/**
 * Nestable folders with drag-and-drop.
 *
 * Two kinds of thing get dropped here, and they are told apart by the drag's
 * data types: contract ids (from the table or a card) move into the folder, and
 * a folder id re-parents that folder. Using the dataTransfer type rather than a
 * shared module variable means a drag started in another tab cannot confuse it.
 */
export function FolderTree({
  folders,
  filters,
  counts,
}: {
  folders: FolderNode[];
  filters: Filters;
  counts: { live: number; archived: number; trash: number };
}) {
  const router = useRouter();
  const { update } = useFilters(filters);
  const [pending, startTransition] = useTransition();
  const [creatingUnder, setCreatingUnder] = useState<string | null | undefined>(undefined);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDrop(event: React.DragEvent, folderId: string | null) {
    event.preventDefault();
    setDropTarget(null);

    // Read synchronously: dataTransfer is neutered once the event handler returns.
    const payload = readDrop(event);
    if (!payload) return;

    startTransition(async () => {
      if (payload.kind === "contracts") {
        const result = await bulkMove({ contractIds: payload.ids, folderId });
        if (!result.ok) setError(result.error);
      } else if (payload.id !== folderId) {
        const result = await moveFolder({ id: payload.id, parentId: folderId });
        if (!result.ok) setError(result.error);
      }
      router.refresh();
    });
  }

  /** Shared by every drop zone so none can forget one of the three requirements. */
  function dropZoneProps(folderId: string | null, key: string) {
    return {
      onDragEnter: (event: React.DragEvent) => {
        if (acceptDrag(event)) setDropTarget(key);
      },
      onDragOver: (event: React.DragEvent) => {
        if (acceptDrag(event)) setDropTarget(key);
      },
      onDragLeave: () => setDropTarget((current) => (current === key ? null : current)),
      onDrop: (event: React.DragEvent) => handleDrop(event, folderId),
    };
  }

  function renderNode(node: FolderNode) {
    const isOpen = expanded.has(node.id);
    const selected = filters.folderId === node.id;
    const hasChildren = node.children.length > 0;

    return (
      <li key={node.id}>
        <div
          draggable
          onDragStart={(event) => startFolderDrag(event, node.id)}
          {...dropZoneProps(node.id, node.id)}
          style={{ paddingLeft: `${node.depth * 12 + 6}px` }}
          className={cn(
            "group flex items-center gap-1 rounded-md py-1 pr-1 text-sm transition-colors",
            selected ? "bg-primary-subtle font-medium" : "hover:bg-muted",
            dropTarget === node.id ? "ring-1 ring-primary" : "",
          )}
        >
          <button
            type="button"
            onClick={() => hasChildren && toggle(node.id)}
            aria-label={hasChildren ? (isOpen ? "Collapse" : "Expand") : undefined}
            className={cn("shrink-0 rounded p-0.5", hasChildren ? "" : "invisible")}
          >
            <ChevronRight
              className={cn("size-3 transition-transform", isOpen ? "rotate-90" : "")}
              aria-hidden
            />
          </button>

          {renaming === node.id ? (
            <RenameField
              initial={node.name}
              onDone={() => setRenaming(null)}
              folderId={node.id}
            />
          ) : (
            <>
              <button
                type="button"
                onClick={() => update({ folderId: selected ? null : node.id })}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                {isOpen ? (
                  <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="truncate">{node.name}</span>
              </button>

              <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                <IconButton label="New subfolder" onClick={() => setCreatingUnder(node.id)}>
                  <Plus className="size-3" aria-hidden />
                </IconButton>
                <IconButton label="Rename" onClick={() => setRenaming(node.id)}>
                  <Pencil className="size-3" aria-hidden />
                </IconButton>
                <IconButton
                  label="Delete folder"
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteFolder(node.id);
                      if (!result.ok) setError(result.error);
                      router.refresh();
                    })
                  }
                >
                  <Trash2 className="size-3 text-destructive" aria-hidden />
                </IconButton>
              </span>
            </>
          )}
        </div>

        {creatingUnder === node.id ? (
          <div style={{ paddingLeft: `${(node.depth + 1) * 12 + 24}px` }} className="py-1">
            <CreateField parentId={node.id} onDone={() => setCreatingUnder(undefined)} />
          </div>
        ) : null}

        {isOpen && hasChildren ? (
          <ul>{node.children.map((child) => renderNode(child))}</ul>
        ) : null}
      </li>
    );
  }

  return (
    <div className="space-y-4">
      {/* --- views --- */}
      <nav aria-label="Views" className="space-y-0.5">
        {(
          [
            { view: "live" as const, label: "All contracts", count: counts.live },
            { view: "archived" as const, label: "Archived", count: counts.archived },
            { view: "trash" as const, label: "Trash", count: counts.trash },
          ]
        ).map((entry) => (
          <button
            key={entry.view}
            type="button"
            onClick={() => update({ view: entry.view, folderId: null })}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
              filters.view === entry.view
                ? "bg-primary-subtle font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Inbox className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>
            <span className="tabular-nums text-xs text-muted-foreground">{entry.count}</span>
          </button>
        ))}
      </nav>

      {/* --- folders --- */}
      <div>
        <div className="mb-1 flex items-center justify-between px-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Folders
          </span>
          <IconButton label="New folder" onClick={() => setCreatingUnder(null)}>
            <Plus className="size-3" aria-hidden />
          </IconButton>
        </div>

        {error ? (
          <p className="px-2 pb-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <div
          {...dropZoneProps(null, "__root__")}
          className={cn(
            "rounded-md border border-dashed px-2 py-1.5 text-xs transition-colors",
            dropTarget === "__root__"
              ? "border-primary bg-primary-subtle text-foreground"
              : "border-transparent text-muted-foreground",
          )}
        >
          Drop here to remove from a folder
        </div>

        {creatingUnder === null ? (
          <div className="px-1 py-1">
            <CreateField parentId={null} onDone={() => setCreatingUnder(undefined)} />
          </div>
        ) : null}

        <ul className={cn("mt-1", pending ? "opacity-60" : "")}>
          {folders.map((node) => renderNode(node))}
        </ul>

        {folders.length === 0 && creatingUnder === undefined ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No folders yet. Create one, then drag contracts into it.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

function CreateField({
  parentId,
  onDone,
}: {
  parentId: string | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  // Enter submits and then the field loses focus, which fires onBlur and submits
  // a second time — two identical folders. A ref, not state, because both events
  // land in the same tick and a state update would not be visible to the second.
  const submitted = useRef(false);

  function submit() {
    if (submitted.current) return;
    submitted.current = true;

    if (!name.trim()) {
      onDone();
      return;
    }
    startTransition(async () => {
      await createFolder({ name, parentId });
      router.refresh();
      onDone();
    });
  }

  return (
    <Input
      autoFocus
      value={name}
      disabled={pending}
      onChange={(event) => setName(event.target.value)}
      onBlur={submit}
      onKeyDown={(event) => {
        if (event.key === "Enter") submit();
        if (event.key === "Escape") onDone();
      }}
      placeholder="Folder name"
      className="h-7 text-xs"
    />
  );
}

function RenameField({
  folderId,
  initial,
  onDone,
}: {
  folderId: string;
  initial: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [pending, startTransition] = useTransition();
  // Same double-submit as CreateField: Enter, then the blur behind it.
  const submitted = useRef(false);

  function submit() {
    if (submitted.current) return;
    submitted.current = true;

    if (!name.trim() || name === initial) {
      onDone();
      return;
    }
    startTransition(async () => {
      await renameFolder({ id: folderId, name });
      router.refresh();
      onDone();
    });
  }

  return (
    <Input
      autoFocus
      value={name}
      disabled={pending}
      onChange={(event) => setName(event.target.value)}
      onBlur={submit}
      onKeyDown={(event) => {
        if (event.key === "Enter") submit();
        if (event.key === "Escape") onDone();
      }}
      className="h-7 text-xs"
    />
  );
}
