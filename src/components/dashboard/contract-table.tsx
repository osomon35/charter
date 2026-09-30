"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Clock, GripVertical, PenLine, RotateCcw, X } from "lucide-react";
import {
  STATUS_CLASSES,
  STATUS_LABELS,
  TAG_COLOR_CLASSES,
  formatBytes,
} from "@/lib/contracts/types";
import type { DashboardContract } from "@/lib/contracts/row-types";
import {
  COLUMN_LABELS,
  useColumnConfig,
  type ColumnKey,
} from "@/components/dashboard/columns";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The contracts table, with reorderable and resizable columns.
 *
 * table-layout: fixed plus a <colgroup> is what makes explicit widths actually
 * hold — with the default auto layout the browser negotiates its own and every
 * drag would be ignored.
 */
export function ContractTable({
  contracts,
  selected,
  onToggle,
  onToggleAll,
  dragPayload,
}: {
  contracts: DashboardContract[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  dragPayload: (id: string) => string;
}) {
  const { config, move, resize, reset } = useColumnConfig();
  const [draggingColumn, setDraggingColumn] = useState<ColumnKey | null>(null);
  const [dropColumn, setDropColumn] = useState<ColumnKey | null>(null);
  const resizing = useRef<{ key: ColumnKey; startX: number; startWidth: number } | null>(null);

  const allSelected = contracts.length > 0 && selected.size === contracts.length;
  const totalWidth =
    config.order.reduce((sum, key) => sum + config.widths[key], 0) + 36 + 80;

  function startResize(event: React.PointerEvent, key: ColumnKey) {
    // stopPropagation, or the header's own drag starts and the resize never runs.
    event.preventDefault();
    event.stopPropagation();

    resizing.current = { key, startX: event.clientX, startWidth: config.widths[key] };

    function onMove(moveEvent: PointerEvent) {
      const state = resizing.current;
      if (!state) return;
      resize(state.key, state.startWidth + (moveEvent.clientX - state.startX));
    }

    function onUp() {
      resizing.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table
          className="border-collapse text-sm"
          style={{ tableLayout: "fixed", width: Math.max(totalWidth, 640) }}
        >
          <colgroup>
            <col style={{ width: 36 }} />
            {config.order.map((key) => (
              <col key={key} style={{ width: config.widths[key] }} />
            ))}
            <col style={{ width: 80 }} />
          </colgroup>

          <thead>
            <tr className="border-b border-border bg-surface-muted text-left">
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleAll}
                  aria-label="Select all"
                  className="size-3.5 accent-[color:var(--primary)]"
                />
              </th>

              {config.order.map((key) => (
                <th
                  key={key}
                  scope="col"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("application/x-charter-column", key);
                    event.dataTransfer.effectAllowed = "move";
                    setDraggingColumn(key);
                  }}
                  onDragEnd={() => {
                    setDraggingColumn(null);
                    setDropColumn(null);
                  }}
                  onDragOver={(event) => {
                    // Only react to a column drag, so dragging a contract row
                    // across the header does nothing.
                    if (!event.dataTransfer.types.includes("application/x-charter-column")) {
                      return;
                    }
                    event.preventDefault();
                    setDropColumn(key);
                  }}
                  onDragLeave={() =>
                    setDropColumn((current) => (current === key ? null : current))
                  }
                  onDrop={(event) => {
                    const from = event.dataTransfer.getData("application/x-charter-column");
                    if (!from) return;
                    event.preventDefault();
                    move(from as ColumnKey, key);
                    setDraggingColumn(null);
                    setDropColumn(null);
                  }}
                  className={cn(
                    "group relative cursor-grab select-none px-2 py-2 text-xs font-medium text-muted-foreground",
                    draggingColumn === key ? "opacity-40" : "",
                    dropColumn === key && draggingColumn !== key
                      ? "bg-primary-subtle text-foreground"
                      : "",
                  )}
                >
                  <span className="flex items-center gap-1">
                    <GripVertical
                      className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
                      aria-hidden
                    />
                    <span className="truncate">{COLUMN_LABELS[key]}</span>
                  </span>

                  {/* Sits over the cell boundary so the grab area is where the
                      eye expects it, not inside one column or the other. */}
                  <span
                    onPointerDown={(event) => startResize(event, key)}
                    onDragStart={(event) => event.preventDefault()}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${COLUMN_LABELS[key]}`}
                    className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize before:absolute before:left-1/2 before:top-1/4 before:h-1/2 before:w-px before:bg-border-strong before:opacity-0 hover:before:opacity-100"
                  />
                </th>
              ))}

              <th className="px-2 py-2" />
            </tr>
          </thead>

          <tbody>
            {contracts.map((contract) => (
              <tr
                key={contract.id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    "application/x-charter-contracts",
                    dragPayload(contract.id),
                  );
                  event.dataTransfer.effectAllowed = "move";
                }}
                className={cn(
                  "border-b border-border last:border-0 transition-colors",
                  selected.has(contract.id) ? "bg-primary-subtle" : "hover:bg-surface-muted",
                )}
              >
                <td className="px-3 py-2.5 align-top">
                  <input
                    type="checkbox"
                    checked={selected.has(contract.id)}
                    onChange={() => onToggle(contract.id)}
                    aria-label={`Select ${contract.title}`}
                    className="size-3.5 accent-[color:var(--primary)]"
                  />
                </td>

                {config.order.map((key) => (
                  <td key={key} className="overflow-hidden px-2 py-2.5 align-top">
                    <Cell contract={contract} column={key} />
                  </td>
                ))}

                <td className="px-2 py-2.5 align-top">
                  {contract.latest ? (
                    <Link
                      href={`/editor/${contract.id}`}
                      draggable={false}
                      aria-label={`Edit ${contract.title}`}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <PenLine className="size-3" aria-hidden />
                      Edit
                    </Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
}: {
  contract: DashboardContract;
  column: ColumnKey;
}) {
  switch (column) {
    case "title":
      return (
        <>
          <Link
            href={`/contracts/${contract.id}`}
            draggable={false}
            className="block truncate font-medium hover:underline"
          >
            {contract.title}
          </Link>
          <span className="block truncate text-xs text-muted-foreground">
            {contract.latest
              ? `${contract.latest.page_count ?? "?"}p · ${formatBytes(contract.latest.byte_size)}`
              : "No file"}
          </span>
        </>
      );

    case "counterparty":
      return (
        <span className="block truncate text-muted-foreground">
          {contract.counterparty_name ?? "—"}
        </span>
      );

    case "status":
      return (
        <div className="flex flex-col items-start gap-1">
          <Badge className={STATUS_CLASSES[contract.status]}>
            {STATUS_LABELS[contract.status]}
          </Badge>
          <SigningFlag contract={contract} />
        </div>
      );

    case "tags":
      return (
        <div className="flex flex-wrap gap-1">
          {contract.tags.map((tag) => (
            <Badge key={tag.id} className={TAG_COLOR_CLASSES[tag.color]}>
              {tag.name}
            </Badge>
          ))}
        </div>
      );

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
