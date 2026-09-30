import type { EnvelopeStatus, RecipientStatus, Routing } from "@/lib/envelopes/types";

/**
 * Shapes the envelope queries return and the client components render. Kept out
 * of the query module so a client import cannot pull in `server-only`.
 */

export type RecipientView = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  order_index: number;
  status: RecipientStatus;
  signed_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  last_viewed_at: string | null;
  reminder_count: number;
};

export type EnvelopeView = {
  id: string;
  status: EnvelopeStatus;
  routing: Routing;
  message: string | null;
  expires_at: string | null;
  sent_at: string | null;
  completed_at: string | null;
  final_version_id: string | null;
  reminder_after_days: number | null;
  last_reminder_at: string | null;
  recipients: RecipientView[];
  field_count: number;
};

export type AuditView = {
  id: string;
  kind: string;
  actor: string | null;
  ip: string | null;
  user_agent: string | null;
  document_sha256: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};
