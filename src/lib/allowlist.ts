import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Whether an address may sign in at all.
 *
 * Reads owner_allowlist directly. This used to compare against an OWNER_ALLOWLIST
 * environment variable, which meant two places to maintain, a deploy for every new
 * person, and a silent failure whenever they disagreed — an address permitted by
 * the table but absent from the variable could not log in, and the reverse could
 * log in and then see nothing.
 *
 * The service-role client is used because there is no session yet: this runs
 * before authentication, which is the whole point of it. It reveals nothing — the
 * login route returns the same message either way.
 */
export async function isAllowlisted(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;

  const normalised = email.trim().toLowerCase();
  if (!normalised.includes("@")) return false;

  try {
    const { data, error } = await createAdminClient()
      .from("owner_allowlist")
      .select("email")
      .eq("email", normalised)
      .is("blocked_at", null)
      .maybeSingle();

    if (error) {
      console.error("allowlist_lookup_failed", { message: error.message });
      // Fail closed: an unreachable roster must not become an open door.
      return false;
    }

    return Boolean(data);
  } catch (err) {
    console.error("allowlist_lookup_exception", err);
    return false;
  }
}
