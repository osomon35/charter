/**
 * App-layer mirror of the database owner_allowlist table.
 *
 * The database is the real authority — public.is_owner() backs every RLS
 * policy, and a trigger on auth.users refuses to create a non-allowlisted
 * account at all. This copy exists so the login route can reject an address
 * before it ever reaches Supabase Auth, which keeps a stranger from learning
 * anything from timing or from a differently-worded provider error.
 *
 * Keep the two in sync: the same addresses in OWNER_ALLOWLIST and in the
 * migration's seed insert.
 */
export function allowlistedEmails(): ReadonlySet<string> {
  const raw = process.env.OWNER_ALLOWLIST ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}

export function isAllowlisted(email: string | null | undefined): boolean {
  if (!email) return false;
  return allowlistedEmails().has(email.trim().toLowerCase());
}
