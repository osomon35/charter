"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { softDeleteContract } from "@/lib/contracts/actions";
import { cn } from "@/lib/utils";

/**
 * Two-step rather than a browser confirm(): one stray click should not remove a
 * contract, but a modal is too heavy for a card action.
 *
 * The delete is soft — the row keeps its data and gains a deleted_at stamp, so
 * Phase 6's Trash can restore it. Nothing is destroyed here.
 */
export function DeleteContractButton({
  contractId,
  title,
}: {
  contractId: string;
  title: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function remove() {
    startTransition(async () => {
      await softDeleteContract(contractId);
      router.refresh();
    });
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-0.5 shadow-sm">
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="rounded-[5px] px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive-subtle disabled:opacity-50"
        >
          {pending ? "Removing…" : "Delete"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-[5px] px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      aria-label={`Delete ${title}`}
      className={cn(
        "flex size-6 items-center justify-center rounded-md border border-border bg-surface",
        "text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive",
      )}
    >
      <X className="size-3.5" aria-hidden />
    </button>
  );
}
