"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Clock, GripVertical, PenLine, RotateCcw, X } from "lucide-react";
import { formatBytes } from "@/lib/contracts/types";
import type { DashboardContract, TagRow } from "@/lib/contracts/row-types";
import {
  COLUMN_DRAG_TYPE,
  COLUMN_LABELS,
  useColumnConfig,
  type ColumnKey,
} from "@/components/dashboard/columns";
import { StatusCell } from "@/components/dashboard/status-cell";
import { TagCell } from "@/components/dashboard/tag-cell";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The contracts list, as a CSS grid rather than a table.
 *
 * A table was the obvious choice and the wrong one. Even with table-layout: fixed
 * and width: 100%, a table whose column widths exceed the space available still
 * overflows, so the list scrolled sideways no matter what the widths said. Grid
 * columns in fr units are ratios of whatever room there is, so the row cannot be
 * wider than its container — overflow is structurally impossible rather than
 * merely discouraged.
 *
 * Every cell needs min-w-0, or long text sets a minimum content width and
 * reintroduces the exact problem.
 */
const ROW_HEIGHT = "min-h-[72px]";

export function ContractTable({
  contracts,
  selected,
  onToggle,
  onToggleAll,
  tags,
}: {
  contracts: DashboardContract[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  tags: TagRow[];
}) {
  const { config, move, resize, reset } = useColumnConfig();
  const [draggingColumn, setDraggingColumn] = useState<ColumnKey | null>(null);
  const [dropColumn, setDropColumn] = useState<ColumnKey | null>(null);
  const resizing = useRef<{ key: ColumnKey; startX: number; startWidth: number } | null>(null);

  const allSelected = contracts.length > 0 && selected.size === contracts.length;

  // 40px for the checkbox, 1fr-weighted middle, 72px for the action.
  const template = `40px ${config.order
    .map((key) => `minmax(0, ${config.widths[key]}fr)`)
    .join(" ")} 72px`;

  function startResize(event: React.PointerEvent, key: ColumnKey) {
    event.preventDefault();
    event.stopPropagation();

    const row = (event.currentTarget as HTMLElement).closest("[data-grid-row]");
    const rowWidth = row?.getBoundingClientRect().width ?? 1000;

    resizing.current = { key, startX: event.clientX, startWidth: config.widths[key] };

    function onMove(moveEvent: PointerEvent) {
      const state = resizing.current;
      if (!state) return;
      // Pixels dragged converted to fr, scaled by the total so a drag moves the
      // boundary roughly the distance the pointer moved.
      const total = Object.values(config.widths).reduce((sum, width) => sum + width, 0);
      const perPixel = total / Math.max(rowWidth, 1);
      resize(state.key, state.startWidth + (moveEvent.clientX - state.startX) * perPixel);
    }

    function onUp() {
      resizing.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function acceptColumn(event: React.DragEvent): boolean {
    if (!Array.from(event.dataTransfer.types).includes(COLUMN_DRAG_TYPE)) return false;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    return true;
  }

  return (
    <div className="space-y-1.5">
      <div className="overflow-hidden rounded-lg border border-border">
        {/* --- header --- */}
        <div
          data-grid-row
          role="row"
          style={{ gridTemplateColumns: template }}
          className="grid items-center gap-2 border-b border-border bg-surface-muted px-3 py-2"
        >
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onToggleAll}
            aria-label="Select all"
            className="size-3.5 accent-[color:var(--primary)]"
          />

          {config.order.map((key) => (
            <div
              key={key}
              role="columnheader"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(COLUMN_DRAG_TYPE, key);
                // A standard type as well, or the drag does not start in every
                // browser. Never read.
                event.dataTransfer.setData("text/plain", key);
                event.dataTransfer.effectAllowed = "move";
                setDraggingColumn(key);
              }}
              onDragEnd={() => {
                setDraggingColumn(null);
                setDropColumn(null);
              }}
              onDragEnter={(event) => acceptColumn(event) && setDropColumn(key)}
              onDragOver={(event) => acceptColumn(event) && setDropColumn(key)}
              onDragLeave={() => setDropColumn((c) => (c === key ? null : c))}
              onDrop={(event) => {
                const from = event.dataTransfer.getData(COLUMN_DRAG_TYPE);
                if (!from) return;
                event.preventDefault();
                move(from as ColumnKey, key);
                setDraggingColumn(null);
                setDropColumn(null);
              }}
              className={cn(
                "group relative flex min-w-0 cursor-grab select-none items-center gap-1 rounded px-1 py-1 text-xs font-medium text-muted-foreground",
                draggingColumn === key ? "opacity-40" : "",
                dropColumn === key && draggingColumn !== key
                  ? "bg-primary-subtle text-foreground"
                  : "",
              )}
            >
              <GripVertical
                className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
                aria-hidden
              />
              <span className="truncate">{COLUMN_LABELS[key]}</span>

              <span
                onPointerDown={(event) => startResize(event, key)}
                onDragStart={(event) => event.preventDefault()}
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${COLUMN_LABELS[key]}`}
                className="absolute -right-1.5 top-0 z-10 h-full w-3 cursor-col-resize before:absolute before:left-1/2 before:top-1/4 before:h-1/2 before:w-px before:bg-border-strong before:opacity-0 hover:before:opacity-100"
              />
            </div>
          ))}

          <span />
        </div>

        {/* --- rows --- */}
        {contracts.map((contract) => (
          <div
            key={contract.id}
            role="row"
            style={{ gridTemplateColumns: template }}
            className={cn(
              "grid items-center gap-2 border-b border-border px-3 py-3 last:border-0 transition-colors",
              ROW_HEIGHT,
              selected.has(contract.id) ? "bg-primary-subtle" : "hover:bg-surface-muted",
            )}
          >
            <input
              type="checkbox"
              checked={selected.has(contract.id)}
              onChange={() => onToggle(contract.id)}
              aria-label={`Select ${contract.title}`}
              className="size-3.5 accent-[color:var(--primary)]"
            />

            {config.order.map((key) => (
              <div key={key} className="min-w-0">
                <Cell contract={contract} column={key} tags={tags} />
              </div>
            ))}

            <div className="min-w-0">
              {contract.latest ? (
                <Link
                  href={`/editor/${contract.id}`}
                  aria-label={`Edit ${contract.title}`}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <PenLine className="size-3" aria-hidden />
                  Edit
                </Link>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={reset}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <RotateCcw className="size-3" aria-hidden />
        Reset columns
      </button>
    </div>
  );
}

function Cell({
  contract,
  column,
  tags,
}: {
  contract: DashboardContract;
  column: ColumnKey;
  tags: TagRow[];
}) {
  switch (column) {
    case "title":
      return (
        <>
          <Link
            href={`/contracts/${contract.id}`}
            className="block truncate text-[15px] font-medium leading-snug hover:underline"
          >
            {contract.title}
          </Link>
          <span className="block truncate text-xs text-muted-foreground">
            {contract.latest
              ? `${contract.latest.page_count ?? "?"} pages · ${formatBytes(contract.latest.byte_size)}`
              : "No file"}
          </span>
        </>
      );

    case "counterparty":
      return (
        <span className="block truncate text-sm text-muted-foreground">
          {contract.counterparty_name ?? "—"}
        </span>
      );

    case "status":
      return (
        <div className="flex min-w-0 flex-col items-start gap-1">
          <StatusCell contractId={contract.id} status={contract.status} />
          <SigningFlag contract={contract} />
        </div>
      );

    case "tags":
      return <TagCell contractId={contract.id} allTags={tags} assigned={contract.tags} />;

    case "updated":
      return (
        <span className="block truncate text-xs tabular-nums text-muted-foreground">
          {new Date(contract.updated_at).toLocaleDateString()}
        </span>
      );
  }
}

function SigningFlag({ contract }: { contract: DashboardContract }) {
  const { signing } = contract;
  if (!signing) return null;

  if (signing.declined > 0) {
    return (
      <Badge className="gap-1 border-destructive/40 bg-destructive-subtle text-destructive">
        <X className="size-3" aria-hidden />
        Declined
      </Badge>
    );
  }
  if (signing.signed < signing.total) {
    return (
      <Badge className="gap-1 border-warning/40 bg-warning/10 text-foreground">
        <Clock className="size-3" aria-hidden />
        {signing.signed}/{signing.total} signed
      </Badge>
    );
  }
  return null;
}
