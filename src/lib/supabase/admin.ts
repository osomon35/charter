import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";

/**
 * Service-role client. Bypasses RLS entirely, so every call site must do its
 * own authorization first. Use it only for work the user's own session
 * genuinely cannot do: rate-limit accounting, and (from Phase 5) signer-token
 * lookups where there is no authenticated user at all.
 */
export function createAdminClient() {
  return createSupabaseClient(publicEnv.supabaseUrl, serverEnv().serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
