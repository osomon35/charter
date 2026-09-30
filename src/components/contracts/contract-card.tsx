import Link from "next/link";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_CLASSES, STATUS_LABELS, formatBytes } from "@/lib/contracts/types";
import type { ContractWithLatest } from "@/lib/contracts/queries";

export function ContractCard({ contract }: { contract: ContractWithLatest }) {
  const { latest } = contract;

  return (
    <Link
      href={`/contracts/${contract.id}`}
      className="group flex gap-4 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong"
    >
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
        <div className="flex items-start justify-between gap-3">
          <h3 className="truncate text-sm font-medium">{contract.title}</h3>
          <Badge className={STATUS_CLASSES[contract.status]}>
            {STATUS_LABELS[contract.status]}
          </Badge>
        </div>

        <p className="mt-1 truncate text-sm text-muted-foreground">
          {contract.counterparty_name ?? "No counterparty set"}
        </p>

        <p className="mt-3 text-xs text-muted-foreground">
          {latest
            ? `${latest.page_count ?? "?"} page${latest.page_count === 1 ? "" : "s"} · ${formatBytes(latest.byte_size)}`
            : "No file"}
        </p>
      </div>
    </Link>
  );
}
