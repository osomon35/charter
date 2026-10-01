"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { deleteOrphanAccount } from "@/lib/members/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Accounts that exist with no roster entry.
 *
 * They can read nothing — every policy is gated on the roster — but their
 * existence means Supabase signups were open at some point, which is worth
 * knowing and worth cleaning up.
 */
export function OrphanAccounts({ emails }: { emails: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (emails.length === 0) return null;

  return (
    <Alert tone="error">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium">
            {emails.length} account{emails.length === 1 ? "" : "s"} exist that{" "}
            {emails.length === 1 ? "is" : "are"} not a member.
          </p>
          <p className="mt-1 text-xs">
            They can read nothing, but their existence means signups were open in Supabase at
            some point. Turn that off under Authentication → Sign In / Providers, then delete
            them here.
          </p>

          {error ? <p className="mt-2 text-xs">{error}</p> : null}

          <ul className="mt-2 space-y-1">
            {emails.map((email) => (
              <li key={email} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{email}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteOrphanAccount(email);
                      setError(result.ok ? null : result.error);
                      router.refresh();
                    })
                  }
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Alert>
  );
}
