import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { EnvelopeStatus, RecipientStatus, Routing } from "@/lib/envelopes/types";

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

export async function listEnvelopes(contractId: string): Promise<EnvelopeView[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("envelopes")
    .select(
      `id, status, routing, message, expires_at, sent_at, completed_at, final_version_id,
       recipients ( id, name, email, role, order_index, status, signed_at, declined_at,
                    decline_reason, last_viewed_at, reminder_count ),
       fields ( id )`,
    )
    .eq("contract_id", contractId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("list_envelopes_failed", { message: error.message });
    return [];
  }

  type Joined = Omit<EnvelopeView, "recipients" | "field_count"> & {
    recipients: RecipientView[] | null;
    fields: { id: string }[] | null;
  };

  return ((data ?? []) as Joined[]).map(({ recipients, fields, ...envelope }) => ({
    ...envelope,
    recipients: [...(recipients ?? [])].sort((a, b) => a.order_index - b.order_index),
    field_count: fields?.length ?? 0,
  }));
}

export async function listAudit(contractId: string): Promise<AuditView[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("audit_events")
    .select("id, kind, actor, ip, user_agent, document_sha256, detail, created_at")
    .eq("contract_id", contractId)
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    console.error("list_audit_failed", { message: error.message });
    return [];
  }

  return (data ?? []) as AuditView[];
}
