import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  AuditView,
  EnvelopeView,
  RecipientView,
} from "@/lib/envelopes/view-types";

export type { AuditView, EnvelopeView, RecipientView } from "@/lib/envelopes/view-types";

export async function listEnvelopes(contractId: string): Promise<EnvelopeView[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("envelopes")
    .select(
      `id, status, routing, message, expires_at, sent_at, completed_at, final_version_id,
       reminder_after_days, last_reminder_at,
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
