"use client";

import { useEffect } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/**
 * Catches render and data-fetch errors in the app routes.
 *
 * Shows nothing about what went wrong. A stack trace or a Postgres message on
 * this screen would be a gift to anyone probing, and the useful copy is already
 * in the server logs — the digest is the handle for finding it there.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("app_error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          That page could not be loaded. Nothing has been changed.
        </p>

        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className={buttonVariants({ variant: "default", size: "sm" })}
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Dashboard
          </Link>
        </div>

        {error.digest ? (
          <p className="mt-6 font-mono text-[11px] text-muted-foreground">
            ref {error.digest}
          </p>
        ) : null}
      </div>
    </main>
  );
}
