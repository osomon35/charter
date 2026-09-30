import "server-only";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export type RateLimitResult =
  /** Under the limit — proceed. */
  | { ok: true }
  /** Over the limit. */
  | { ok: false; reason: "limited" }
  /** The accounting call itself failed; we refuse rather than skip the limit. */
  | { ok: false; reason: "unavailable" };

/**
 * Fixed-window rate limit backed by Postgres (see consume_rate_limit in
 * supabase/migrations). Counts the attempt, so call it exactly once per
 * attempt.
 *
 * Fails closed. The two failure reasons are kept apart so a misconfigured
 * service-role key surfaces as "temporarily unavailable" rather than
 * masquerading as a rate limit and sending you hunting in the wrong place.
 */
export async function consume(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("consume_rate_limit", {
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error("rate_limit_rpc_failed", { bucket, message: error.message });
      return { ok: false, reason: "unavailable" };
    }
    return data === true ? { ok: true } : { ok: false, reason: "limited" };
  } catch (err) {
    console.error("rate_limit_unavailable", {
      bucket,
      message: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, reason: "unavailable" };
  }
}

/** Worst outcome across several buckets, so one exhausted bucket blocks. */
export function worst(...results: RateLimitResult[]): RateLimitResult {
  const unavailable = results.find((r) => !r.ok && r.reason === "unavailable");
  if (unavailable) return unavailable;
  const limited = results.find((r) => !r.ok);
  return limited ?? { ok: true };
}

/**
 * Best-effort client IP. On Vercel x-forwarded-for is set by the platform and
 * its first entry is the real client. Never trusted for authorization — only
 * for bucketing and the audit trail.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() ?? "unknown";
}
