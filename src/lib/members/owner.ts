import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who to notify, and who outgoing mail comes from.
 *
 * Reads owner_allowlist rather than an environment variable. These run from a
 * signer's request — completion, declines, sequential hand-offs — where there is
 * no authenticated owner to satisfy RLS, hence the service-role client.
 */
export async function adminEmails(): Promise<string[]> {
  try {
    const { data } = await createAdminClient()
      .from("owner_allowlist")
      .select("email")
      .eq("role", "admin")
      .is("blocked_at", null)
      .order("created_at", { ascending: true });

    return ((data ?? []) as { email: string }[]).map((row) => row.email);
  } catch (err) {
    console.error("admin_emails_failed", err);
    return [];
  }
}

/**
 * The longest-standing admin. Used as the sender identity and as the person a
 * decline is reported to when no more specific recipient applies.
 */
export async function primaryAdmin(): Promise<{ email: string; name: string | null } | null> {
  try {
    const { data } = await createAdminClient()
      .from("owner_allowlist")
      .select("email, name")
      .eq("role", "admin")
      .is("blocked_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    return data ? { email: data.email, name: data.name } : null;
  } catch {
    return null;
  }
}
