import "server-only";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Appends to the audit trail.
 *
 * Written with the service-role client because signers have no database
 * identity and audit_events has no anon policy — and because an audit row must
 * be recorded even when the action it describes was performed by someone who can
 * write nothing else.
 *
 * Failures are logged and swallowed. An audit write must never be the reason a
 * signature fails to record; a missing row is recoverable, a lost signature is
 * not.
 */
export type AuditInput = {
  contractId: string;
  envelopeId?: string | null;
  recipientId?: string | null;
  kind: string;
  actor?: string | null;
  documentSha256?: string | null;
  detail?: Record<string, unknown> | null;
};

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const { ip, userAgent } = await requestFingerprint();

    const { error } = await createAdminClient()
      .from("audit_events")
      .insert({
        contract_id: input.contractId,
        envelope_id: input.envelopeId ?? null,
        recipient_id: input.recipientId ?? null,
        kind: input.kind,
        actor: input.actor ?? null,
        ip,
        user_agent: userAgent,
        document_sha256: input.documentSha256 ?? null,
        detail: input.detail ?? null,
      });

    if (error) console.error("audit_insert_failed", { kind: input.kind, message: error.message });
  } catch (err) {
    console.error("audit_exception", { kind: input.kind, err });
  }
}

/**
 * IP and user agent for the audit row.
 *
 * On Vercel x-forwarded-for is set by the platform and its first entry is the
 * real client. Recorded as evidence of what happened, never used to decide
 * whether a request is allowed.
 */
export async function requestFingerprint(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || null;
    const userAgent = h.get("user-agent")?.slice(0, 500) ?? null;
    return { ip, userAgent };
  } catch {
    return { ip: null, userAgent: null };
  }
}
