import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who can actually get in.
 *
 * Access rests on three things that are maintained separately, and a mismatch
 * between them is the failure mode worth catching before pointing a real domain
 * at this:
 *
 *   1. public.owner_allowlist — the authority. is_owner() reads it, and every RLS
 *      policy is gated on is_owner(), so this is what decides whether a session
 *      can read a single row.
 *   2. OWNER_ALLOWLIST — the app-layer mirror, used to refuse a login before
 *      Supabase is involved. If it is missing an address the table has, that
 *      person cannot log in even though the database would permit them; if it has
 *      one the table does not, they can log in and then see nothing.
 *   3. auth.users — accounts that exist. The anon key is public by design, so
 *      anyone can call Supabase Auth directly; the only thing preventing an
 *      account being created is the signup setting in the Supabase dashboard.
 *      An account here that is not allowlisted reads nothing — RLS refuses it —
 *      but its existence means signups were open at some point.
 */
export type AccountRow = {
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  allowlisted: boolean;
};

export type AccessReport = {
  tableAllowlist: string[];
  envAllowlist: string[];
  /** In the table but not the environment variable: cannot log in. */
  missingFromEnv: string[];
  /** In the environment variable but not the table: logs in, then sees nothing. */
  missingFromTable: string[];
  accounts: AccountRow[];
  /** Accounts that exist but are not allowlisted. */
  strangers: AccountRow[];
  accountsError: string | null;
};

export async function getAccessReport(): Promise<AccessReport> {
  const supabase = await createClient();

  // Read through RLS: the policy already restricts this to owners, so a
  // non-owner reaching here would get an empty list rather than the roster.
  const { data: rows } = await supabase
    .from("owner_allowlist")
    .select("email")
    .order("email", { ascending: true });

  const tableAllowlist = ((rows ?? []) as { email: string }[]).map((row) => row.email);

  const envAllowlist = (process.env.OWNER_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .sort();

  const envSet = new Set(envAllowlist);
  const tableSet = new Set(tableAllowlist);

  let accounts: AccountRow[] = [];
  let accountsError: string | null = null;

  try {
    // Listing accounts needs the service role; there is no way to see auth.users
    // through a user's own session, which is the point.
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });

    if (error) {
      accountsError = error.message;
    } else {
      accounts = data.users
        .map((user) => {
          const email = (user.email ?? "").toLowerCase();
          return {
            email,
            createdAt: user.created_at,
            lastSignInAt: user.last_sign_in_at ?? null,
            allowlisted: tableSet.has(email),
          };
        })
        .sort((a, b) => a.email.localeCompare(b.email));
    }
  } catch (err) {
    accountsError = err instanceof Error ? err.message : "Could not list accounts";
  }

  return {
    tableAllowlist,
    envAllowlist,
    missingFromEnv: tableAllowlist.filter((email) => !envSet.has(email)),
    missingFromTable: envAllowlist.filter((email) => !tableSet.has(email)),
    accounts,
    strangers: accounts.filter((account) => !account.allowlisted),
    accountsError,
  };
}
