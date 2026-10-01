import { CheckCircle2, TriangleAlert } from "lucide-react";
import type { AccessReport } from "@/lib/access/report";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

/**
 * A plain answer to "who can get in".
 *
 * Shows all three sources rather than a single summary, because the useful
 * information is where they disagree — and a dashboard that merely said "1 user"
 * would hide exactly the cases worth seeing.
 */
export function AccessPanel({ report }: { report: AccessReport }) {
  const consistent =
    report.missingFromEnv.length === 0 &&
    report.missingFromTable.length === 0 &&
    report.strangers.length === 0;

  return (
    <div className="space-y-5">
      {consistent ? (
        <Alert tone="success" className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <span>
            Access is consistent. {report.tableAllowlist.length} allowlisted{" "}
            {report.tableAllowlist.length === 1 ? "address" : "addresses"},{" "}
            {report.accounts.length} {report.accounts.length === 1 ? "account" : "accounts"},
            and no account exists that is not allowlisted.
          </span>
        </Alert>
      ) : null}

      {report.strangers.length > 0 ? (
        <Alert tone="error" className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">
              {report.strangers.length} account
              {report.strangers.length === 1 ? "" : "s"} exist that{" "}
              {report.strangers.length === 1 ? "is" : "are"} not allowlisted.
            </p>
            <p className="mt-1 text-xs">
              They can read nothing — every policy is gated on the allowlist — but their
              existence means signups were open at some point. Turn signups off in Supabase
              (Authentication → Sign In / Providers) and delete them from Authentication →
              Users.
            </p>
            <ul className="mt-2 space-y-0.5 font-mono text-xs">
              {report.strangers.map((account) => (
                <li key={account.email}>{account.email}</li>
              ))}
            </ul>
          </div>
        </Alert>
      ) : null}

      {report.missingFromEnv.length > 0 ? (
        <Alert tone="error">
          <p className="font-medium">
            Allowlisted in the database but missing from OWNER_ALLOWLIST.
          </p>
          <p className="mt-1 text-xs">
            These addresses cannot log in: the login route refuses them before Supabase is
            reached. Add them to the environment variable in Vercel and redeploy.
          </p>
          <ul className="mt-2 space-y-0.5 font-mono text-xs">
            {report.missingFromEnv.map((email) => (
              <li key={email}>{email}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {report.missingFromTable.length > 0 ? (
        <Alert tone="error">
          <p className="font-medium">
            In OWNER_ALLOWLIST but missing from the database.
          </p>
          <p className="mt-1 text-xs">
            These addresses can log in and will then see nothing, because every policy reads
            the table. Add them to owner_allowlist, or remove them from the variable.
          </p>
          <ul className="mt-2 space-y-0.5 font-mono text-xs">
            {report.missingFromTable.map((email) => (
              <li key={email}>{email}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Allowlisted addresses
        </p>
        {report.tableAllowlist.length === 0 ? (
          <p className="text-sm text-destructive">
            The allowlist is empty, which locks everyone out including you.
          </p>
        ) : (
          <ul className="space-y-1">
            {report.tableAllowlist.map((email) => (
              <li key={email} className="font-mono text-xs">
                {email}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Edited in SQL on purpose — there is no policy allowing it to be changed through the
          app, so a bug in the app cannot grant anyone access.
        </p>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Accounts
        </p>

        {report.accountsError ? (
          <p className="text-sm text-muted-foreground">
            Could not list accounts: {report.accountsError}
          </p>
        ) : report.accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accounts exist yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {report.accounts.map((account) => (
              <li key={account.email} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {account.email}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {account.lastSignInAt
                    ? `last in ${new Date(account.lastSignInAt).toLocaleDateString()}`
                    : "never signed in"}
                </span>
                <Badge
                  className={
                    account.allowlisted
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-destructive/40 bg-destructive-subtle text-destructive"
                  }
                >
                  {account.allowlisted ? "Allowed" : "Not allowed"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
