import "server-only";

import { required } from "@/lib/env";

/**
 * Secrets. The `server-only` import makes importing this from a client
 * component a build error rather than a silent leak.
 */
export function serverEnv() {
  return {
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY),
  };
}
