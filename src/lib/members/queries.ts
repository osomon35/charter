import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Member, MemberRole } from "@/lib/members/types";

/**
 * The roster, joined against the accounts that actually exist.
 *
 * Two sources because they answer different questions: owner_allowlist says who is
 * permitted, auth.users says who has signed in. A permitted address with no
 * account has been invited but never accepted; an account whose address is no
 * longer permitted can read nothing, and is worth seeing.
 */
export async function listMembers(): Promise<Member[]> {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("owner_allowlist")
    .select("email, name, role, blocked_at, invited_at, invited_by, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("list_members_failed", { message: error.message });
    return [];
  }

  const accounts = new Map<string, string | null>();
  try {
    // auth.users is unreachable through a user's own session, by design.
    const { data } = await createAdminClient().auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    for (const user of data?.users ?? []) {
      if (user.email) accounts.set(user.email.toLowerCase(), user.last_sign_in_at ?? null);
    }
  } catch (err) {
    console.error("list_accounts_failed", err);
  }

  type Row = {
    email: string;
    name: string | null;
    role: MemberRole;
    blocked_at: string | null;
    invited_at: string | null;
    invited_by: string | null;
    created_at: string;
  };

  return ((rows ?? []) as Row[]).map((row) => ({
    email: row.email,
    name: row.name,
    role: row.role,
    blockedAt: row.blocked_at,
    invitedAt: row.invited_at,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    hasAccount: accounts.has(row.email),
    lastSignInAt: accounts.get(row.email) ?? null,
  }));
}

/** Accounts with no roster entry. They can read nothing, but should not exist. */
export async function listOrphanAccounts(): Promise<string[]> {
  const supabase = await createClient();
  const { data: rows } = await supabase.from("owner_allowlist").select("email");
  const permitted = new Set(((rows ?? []) as { email: string }[]).map((row) => row.email));

  try {
    const { data } = await createAdminClient().auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    return (data?.users ?? [])
      .map((user) => (user.email ?? "").toLowerCase())
      .filter((email) => email && !permitted.has(email));
  } catch {
    return [];
  }
}
