"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Clock, FileText, Trash2, Undo2, X } from "lucide-react";
import {
  bulkArchive,
  bulkDelete,
  bulkRestore,
  bulkTag,
} from "@/lib/contracts/organise-actions";
import {
  STATUS_CLASSES,
  STATUS_LABELS,
  TAG_COLOR_CLASSES,
} from "@/lib/contracts/types";
import type { DashboardContract, TagRow } from "@/lib/contracts/row-types";
import type { Filters } from "@/lib/contracts/filters";
import { ContractTable } from "@/components/dashboard/contract-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * The contract list, in either layout, with selection and bulk actions.
 *
 * Selection is by id rather than by index so it survives the list reordering or
 * a row disappearing after an action. Rows are draggable so they can be dropped
 * onto a folder in the sidebar; the drag carries whatever is selected, or just
 * the row under the pointer if nothing is.
 */
export function ContractList({
  contracts,
  filters,
  tags,
}: {
  contracts: DashboardContract[];
  filters: Filters;
  tags: TagRow[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const allSelected = contracts.length > 0 && selected.size === contracts.length;
  const inTrash = filters.view === "trash";

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await work();
      setError(result.ok ? null : (result.error ?? "That did not work."));
      if (result.ok) setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {selected.size > 0 ? (
        <BulkBar
          count={selected.size}
          inTrash={inTrash}
          tags={tags}
          pending={pending}
          onClear={() => setSelected(new Set())}
          onTag={(tagId, add) => run(() => bulkTag({ contractIds: [...selected], tagId, add }))}
          onArchive={(archived) =>
            run(() => bulkArchive({ contractIds: [...selected], archived }))
          }
          onDelete={() => run(() => bulkDelete([...selected]))}
          onRestore={() => run(() => bulkRestore([...selected]))}
        />
      ) : null}

      {filters.layout === "cards" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {contracts.map((contract) => (
            <CardRow
              key={contract.id}
              contract={contract}
              selected={selected.has(contract.id)}
              onToggle={() => toggle(contract.id)}
            />
          ))}
        </div>
      ) : (
        <ContractTable
          contracts={contracts}
          selected={selected}
          onToggle={toggle}
          onToggleAll={() =>
            setSelected(allSelected ? new Set() : new Set(contracts.map((c) => c.id)))
          }
          tags={tags}
        />
      )}
    </div>
  );
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

function CardRow({
  contract,
  selected,
  onToggle,
}: {
  contract: DashboardContract;
  selected: boolean;
  onToggle: () => void;
}) {
  const { latest } = contract;

  return (
    <div
      className={cn(
        "group relative rounded-lg border bg-surface transition-colors",
        selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-border-strong",
      )}
    >
      <Link
        href={`/contracts/${contract.id}`}
        aria-label={contract.title}
        className="absolute inset-0 z-10 rounded-lg"
      />

      <div className="relative z-0 flex gap-4 p-4">
        <div className="flex h-24 w-[4.5rem] shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-surface-muted">
          {latest?.thumbnail_path ? (
            /* Served by our own authorized route, so next/image cannot help. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/versions/${latest.id}/thumbnail`}
              alt=""
              width={72}
              height={96}
              className="h-full w-full object-cover object-top"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <FileText className="size-5 text-muted-foreground" aria-hidden />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate pr-8 text-sm font-medium">{contract.title}</h3>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {contract.counterparty_name ?? "No counterparty set"}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Badge className={STATUS_CLASSES[contract.status]}>
              {STATUS_LABELS[contract.status]}
            </Badge>
            <SigningFlag contract={contract} />
            {contract.tags.map((tag) => (
              <Badge key={tag.id} className={TAG_COLOR_CLASSES[tag.color]}>
                {tag.name}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <label className="absolute right-2.5 top-2.5 z-20 flex cursor-pointer items-center">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${contract.title}`}
          className="size-3.5 accent-[color:var(--primary)]"
        />
      </label>
    </div>
  );
}

function BulkBar({
  count,
  inTrash,
  tags,
  pending,
  onClear,
  onTag,
  onArchive,
  onDelete,
  onRestore,
}: {
  count: number;
  inTrash: boolean;
  tags: TagRow[];
  pending: boolean;
  onClear: () => void;
  onTag: (tagId: string, add: boolean) => void;
  onArchive: (archived: boolean) => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2.5 shadow-sm">
      <span className="px-1 text-sm font-medium tabular-nums">{count} selected</span>

      {inTrash ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={onRestore}>
          <Undo2 aria-hidden />
          Restore
        </Button>
      ) : (
        <>
          {tags.length > 0 ? (
            <Select
              aria-label="Apply tag"
              defaultValue=""
              disabled={pending}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) return;
                const [action, tagId] = value.split(":");
                if (tagId) onTag(tagId, action === "add");
                event.target.value = "";
              }}
              className="w-auto min-w-36"
            >
              <option value="">Tag…</option>
              {tags.map((tag) => (
                <option key={`add-${tag.id}`} value={`add:${tag.id}`}>
                  Add {tag.name}
                </option>
              ))}
              {tags.map((tag) => (
                <option key={`remove-${tag.id}`} value={`remove:${tag.id}`}>
                  Remove {tag.name}
                </option>
              ))}
            </Select>
          ) : null}

          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => onArchive(true)}
          >
            <Archive aria-hidden />
            Archive
          </Button>

          <Button variant="outline" size="sm" disabled={pending} onClick={onDelete}>
            <Trash2 aria-hidden />
            Delete
          </Button>
        </>
      )}

      {!inTrash ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => onArchive(false)}
          title="Only does anything to already-archived contracts"
        >
          <ArchiveRestore aria-hidden />
          Unarchive
        </Button>
      ) : null}

      <Button variant="ghost" size="sm" onClick={onClear} className="ml-auto">
        <X aria-hidden />
        Clear
      </Button>
    </div>
  );
}
