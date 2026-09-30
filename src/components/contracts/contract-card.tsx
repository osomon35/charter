import Link from "next/link";
import { Clock, FileText, PenLine, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_CLASSES, STATUS_LABELS, formatBytes } from "@/lib/contracts/types";
import type { ContractWithLatest } from "@/lib/contracts/queries";
import { DeleteContractButton } from "@/components/contracts/delete-contract-button";

export function ContractCard({ contract }: { contract: ContractWithLatest }) {
  const { latest, signing } = contract;

  return (
    <div className="group relative rounded-lg border border-border bg-surface transition-colors hover:border-border-strong">
      {/* A full-card link beneath the controls, rather than a <Link> wrapping
          them — a button nested inside an anchor is invalid and unclickable. */}
      <Link
        href={`/contracts/${contract.id}`}
        aria-label={contract.title}
        className="absolute inset-0 z-10 rounded-lg"
      />

      <div className="relative z-0 flex gap-4 p-4">
        <div className="flex h-24 w-[4.5rem] shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-surface-muted">
          {latest?.thumbnail_path ? (
            /* Proxied through our own authorized route, so next/image's loader
               cannot help — a plain img is correct here. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/versions/${latest.id}/thumbnail`}
              alt=""
              className="h-full w-full object-cover object-top"
              loading="lazy"
            />
          ) : (
            <FileText className="size-5 text-muted-foreground" aria-hidden />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate pr-16 text-sm font-medium">{contract.title}</h3>

          <p className="mt-1 truncate text-sm text-muted-foreground">
            {contract.counterparty_name ?? "No counterparty set"}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge className={STATUS_CLASSES[contract.status]}>
              {STATUS_LABELS[contract.status]}
            </Badge>

            {/* Waiting on someone is the thing worth spotting from across the
                dashboard, so it gets its own badge rather than being buried in
                the status word. */}
            {signing && signing.declined > 0 ? (
              <Badge className="gap-1 border-destructive/40 bg-destructive-subtle text-destructive">
                <X className="size-3" aria-hidden />
                Declined
              </Badge>
            ) : signing && signing.signed < signing.total ? (
              <Badge className="gap-1 border-warning/40 bg-warning/10 text-foreground">
                <Clock className="size-3" aria-hidden />
                {signing.signed} of {signing.total} signed
              </Badge>
            ) : null}

            <span className="text-xs text-muted-foreground">
              {latest
                ? `${latest.page_count ?? "?"} page${latest.page_count === 1 ? "" : "s"} · ${formatBytes(latest.byte_size)}`
                : "No file"}
            </span>
          </div>
        </div>
      </div>

      {/* Revealed on hover, and on keyboard focus so it is not mouse-only. */}
      <div className="absolute right-2 top-2 z-20 flex items-center gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Link
          href={`/editor/${contract.id}`}
          className="flex h-6 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <PenLine className="size-3" aria-hidden />
          Sign
        </Link>
        <DeleteContractButton contractId={contract.id} title={contract.title} />
      </div>
    </div>
  );
}
