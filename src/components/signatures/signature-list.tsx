"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star, Trash2 } from "lucide-react";
import { deleteSignature, setDefaultSignature } from "@/lib/signatures/actions";
import { KIND_LABELS, type SignatureRecord } from "@/lib/signatures/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function SignatureList({ signatures }: { signatures: SignatureRecord[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (signatures.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-muted-foreground">
        No signatures yet. Create one above and it will be available on every document.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {signatures.map((signature) => (
        <li key={signature.id} className="flex items-center gap-4 px-5 py-4">
          <div className="flex h-14 w-32 shrink-0 items-center justify-center rounded border border-border bg-surface p-1.5">
            {/* Proxied through our own authorized route. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/signatures/${signature.id}`}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{KIND_LABELS[signature.kind]}</span>
              {signature.is_default ? (
                <Badge className="border-primary/25 bg-primary-subtle text-foreground">
                  Default
                </Badge>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {signature.source} · {signature.width}×{signature.height} ·{" "}
              {new Date(signature.created_at).toLocaleDateString()}
            </p>
          </div>

          <button
            type="button"
            disabled={pending || signature.is_default}
            onClick={() =>
              startTransition(async () => {
                await setDefaultSignature(signature.id);
                router.refresh();
              })
            }
            title={signature.is_default ? "Already the default" : "Make default"}
            className={cn(
              "rounded-md p-2 transition-colors disabled:opacity-30",
              "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Star className="size-4" aria-hidden />
          </button>

          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await deleteSignature(signature.id);
                router.refresh();
              })
            }
            title="Delete"
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive-subtle hover:text-destructive disabled:opacity-30"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
