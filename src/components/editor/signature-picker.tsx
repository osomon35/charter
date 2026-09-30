"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PenTool } from "lucide-react";
import { listSignatures } from "@/lib/signatures/actions";
import { KIND_LABELS, type SignatureRecord } from "@/lib/signatures/types";
import { cn } from "@/lib/utils";

/**
 * Dropdown of the owner's saved signatures.
 *
 * Fetched when first opened rather than with the editor: most editing sessions
 * never place a signature, and the list is cheap to load on demand.
 */
export function SignaturePicker({
  onPick,
  disabled,
}: {
  onPick: (signature: SignatureRecord) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [signatures, setSignatures] = useState<SignatureRecord[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || signatures) return;
    let cancelled = false;
    void (async () => {
      const rows = await listSignatures();
      if (!cancelled) setSignatures(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, signatures]);

  // Close on an outside click or Escape, the two things a popover must do.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        title="Place a signature"
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
          open
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
          disabled ? "opacity-40" : "",
        )}
      >
        <PenTool className="size-3.5" aria-hidden />
        <span className="hidden lg:inline">Signature</span>
      </button>

      {open ? (
        <div className="absolute left-1/2 top-full z-40 mt-2 w-64 -translate-x-1/2 rounded-lg border border-border bg-surface p-1.5 shadow-md">
          {signatures === null ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">Loading…</p>
          ) : signatures.length === 0 ? (
            <div className="px-2 py-3">
              <p className="text-xs text-muted-foreground">
                No signatures saved yet.
              </p>
              <Link
                href="/settings"
                className="mt-2 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                Create one in Settings
              </Link>
            </div>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {signatures.map((signature) => (
                <li key={signature.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(signature);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
                  >
                    <span className="flex h-9 w-20 shrink-0 items-center justify-center rounded border border-border bg-surface p-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/signatures/${signature.id}`}
                        alt=""
                        className="max-h-full max-w-full object-contain"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium">
                        {KIND_LABELS[signature.kind]}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {signature.is_default ? "Default" : signature.source}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
