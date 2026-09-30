"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { STORAGE_BUCKET } from "@/lib/contracts/types";
import { recordAudit } from "@/lib/envelopes/audit";
import { FIELD_TYPES, ROUTINGS } from "@/lib/envelopes/types";
import { DEFAULT_EXPIRY_DAYS, expiryFromNow, generateToken, hashToken } from "@/lib/envelopes/tokens";
import { notifyRecipient } from "@/lib/envelopes/notify";
import { flattenToNewVersion } from "@/lib/editor/actions";
import { overlaySchema } from "@/lib/editor/schema";

const recipientSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.string().trim().max(120).optional().default(""),
});

const fieldSchema = z.object({
  recipientIndex: z.number().int().min(0).max(49),
  type: z.enum(FIELD_TYPES),
  page: z.number().int().min(1).max(2000),
  x: z.number().min(-0.2).max(1.2),
  y: z.number().min(-0.2).max(1.2),
  w: z.number().min(0.005).max(1.5),
  h: z.number().min(0.005).max(1.5),
  required: z.boolean(),
  label: z.string().trim().max(120).optional(),
});

const sendSchema = z.object({
  contractId: z.string().uuid(),
  routing: z.enum(ROUTINGS),
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().max(4000).optional(),
  expiryDays: z.number().int().min(1).max(365).default(DEFAULT_EXPIRY_DAYS),
  recipients: z.array(recipientSchema).min(1).max(50),
  fields: z.array(fieldSchema).max(500),
});

export type SendResult =
  | {
      ok: true;
      envelopeId: string;
      notified: number;
      warnings: string[];
      /**
       * Only populated when REVEAL_SIGNING_LINKS is "true" — a development
       * escape hatch for testing before a sending domain has been verified.
       * These are live credentials: anyone holding one can sign as that
       * recipient, so the flag must not be set in production.
       */
      links: { email: string; url: string }[];
    }
  | { ok: false; error: string };

/**
 * Creates an envelope and sends it.
 *
 * Order matters and is deliberate:
 *
 *   1. Any unflattened editor draft is baked into a new version first, so the
 *      version recipients are shown includes the owner's own edits. That
 *      version id is then frozen on the envelope — the hash in the audit trail
 *      has to refer to bytes that cannot change underneath a signer.
 *   2. Recipients and fields are written.
 *   3. Tokens are minted and emails sent. Sequential routing notifies only the
 *      first recipient; the rest are notified as each one signs.
 *
 * A failed email does not roll the envelope back: the rows are correct and the
 * owner can nudge. Losing the whole send because one address bounced would be
 * worse.
 */
export async function createAndSendEnvelope(input: unknown): Promise<SendResult> {
  const owner = await requireOwner();

  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Those details are not valid." };
  }
  const { contractId, routing, subject, message, expiryDays, recipients, fields } = parsed.data;

  // Every field must belong to a recipient that exists in this request.
  for (const field of fields) {
    if (field.recipientIndex >= recipients.length) {
      return { ok: false, error: "A field is assigned to a recipient that no longer exists." };
    }
  }

  const emails = new Set(recipients.map((r) => r.email));
  if (emails.size !== recipients.length) {
    return { ok: false, error: "Each recipient needs a different email address." };
  }

  const supabase = await createClient();

  const { data: contract } = await supabase
    .from("contracts")
    .select("id, title")
    .eq("id", contractId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!contract) return { ok: false, error: "That contract is not available." };

  // One live envelope per contract. Without this, a double-clicked Send button
  // creates two of everything — two sets of links, two emails per recipient, and
  // an audit trail that reads as though the document was sent twice, because it
  // was. Cancelling the existing request is the deliberate way to resend.
  const { data: active } = await supabase
    .from("envelopes")
    .select("id, status, sent_at")
    .eq("contract_id", contractId)
    .in("status", ["sent", "partially_signed"])
    .limit(1)
    .maybeSingle();

  if (active) {
    return {
      ok: false,
      error:
        "This contract already has a signature request out. Cancel it on the contract page before sending again.",
    };
  }

  // --- 1. settle on the exact version recipients will see ------------------
  const sourceVersionId = await settleSourceVersion(contractId);
  if (!sourceVersionId) {
    return { ok: false, error: "This contract has no readable version to send." };
  }

  const { data: sourceVersion } = await supabase
    .from("contract_versions")
    .select("id, sha256")
    .eq("id", sourceVersionId)
    .maybeSingle();

  const expiresAt = expiryFromNow(expiryDays);

  const { data: envelope, error: envelopeError } = await supabase
    .from("envelopes")
    .insert({
      contract_id: contractId,
      source_version_id: sourceVersionId,
      routing,
      status: "sent",
      subject: subject || `Please sign: ${contract.title}`,
      message: message || null,
      expires_at: expiresAt,
      sent_at: new Date().toISOString(),
      created_by: owner.id,
    })
    .select("id")
    .single();

  if (envelopeError || !envelope) {
    return { ok: false, error: `Could not create the envelope: ${envelopeError?.message ?? "unknown"}` };
  }

  // --- 2. recipients, with their tokens ------------------------------------
  const tokens = new Map<string, string>();
  const recipientIds: string[] = [];

  for (const [index, recipient] of recipients.entries()) {
    const token = generateToken();

    const { data: row, error } = await supabase
      .from("recipients")
      .insert({
        envelope_id: envelope.id,
        name: recipient.name,
        email: recipient.email,
        role: recipient.role || null,
        order_index: index,
        status: "pending",
        token_hash: hashToken(token),
        token_expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (error || !row) {
      return { ok: false, error: `Could not add ${recipient.email}: ${error?.message ?? "unknown"}` };
    }

    recipientIds.push(row.id);
    tokens.set(row.id, token);
  }

  // --- 3. fields -----------------------------------------------------------
  if (fields.length > 0) {
    const rows = fields.map((field, index) => ({
      envelope_id: envelope.id,
      recipient_id: recipientIds[field.recipientIndex],
      type: field.type,
      page: field.page,
      x: field.x,
      y: field.y,
      w: field.w,
      h: field.h,
      required: field.required,
      label: field.label || null,
      order_index: index,
    }));

    const { error } = await supabase.from("fields").insert(rows);
    if (error) {
      return { ok: false, error: `Could not save the fields: ${error.message}` };
    }
  }

  // --- 4. notify -----------------------------------------------------------
  // Parallel: everyone now. Sequential: only the first, then one at a time.
  const toNotify = routing === "sequential" ? recipientIds.slice(0, 1) : recipientIds;

  const warnings: string[] = [];
  const links: { email: string; url: string }[] = [];
  const reveal = process.env.REVEAL_SIGNING_LINKS === "true";
  let notified = 0;

  for (const recipientId of toNotify) {
    const token = tokens.get(recipientId);
    const recipient = recipients[recipientIds.indexOf(recipientId)];
    if (!token || !recipient) continue;

    const result = await notifyRecipient({
      recipientId,
      token,
      name: recipient.name,
      email: recipient.email,
      senderName: owner.fullName ?? owner.email,
      documentTitle: contract.title,
      message: message ?? null,
      expiresAt,
    });

    if (result.ok) notified += 1;
    else warnings.push(`${recipient.email}: ${result.error}`);

    if (reveal) {
      links.push({ email: recipient.email, url: `${publicEnv.appUrl}/sign/${token}` });
    }
  }

  await recordAudit({
    contractId,
    envelopeId: envelope.id,
    kind: "sent",
    actor: owner.email,
    documentSha256: sourceVersion?.sha256 ?? null,
    detail: {
      routing,
      recipients: recipients.map((r) => r.email),
      fields: fields.length,
      expires_at: expiresAt,
    },
  });

  await supabase.from("contracts").update({ status: "sent" }).eq("id", contractId);

  revalidatePath(`/contracts/${contractId}`);
  revalidatePath("/contracts");
  revalidatePath("/dashboard");

  return { ok: true, envelopeId: envelope.id, notified, warnings, links };
}

/**
 * Bakes any pending editor draft, then returns the version to send.
 *
 * Sending a contract whose overlay is still a draft would show recipients a
 * document without the owner's own edits, so the draft is flattened first.
 */
async function settleSourceVersion(contractId: string): Promise<string | null> {
  const supabase = await createClient();

  const { data: overlay } = await supabase
    .from("contract_overlays")
    .select("elements, base_version_id")
    .eq("contract_id", contractId)
    .maybeSingle();

  const parsed = overlaySchema.safeParse(overlay?.elements ?? []);

  if (parsed.success && parsed.data.length > 0 && overlay?.base_version_id) {
    const flattened = await flattenToNewVersion({
      contractId,
      baseVersionId: overlay.base_version_id,
      elements: parsed.data,
    });
    if (flattened.ok) return flattened.versionId;
    // Fall through: better to send the latest good version than to refuse.
  }

  const { data: latest } = await supabase
    .from("contract_versions")
    .select("id")
    .eq("contract_id", contractId)
    .eq("state", "ready")
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  return latest?.id ?? null;
}

/** Re-sends the link to a pending recipient. A new token is not minted. */
export async function nudgeRecipient(
  recipientId: string,
): Promise<{ ok: true; url?: string } | { ok: false; error: string }> {
  const owner = await requireOwner();
  if (!z.string().uuid().safeParse(recipientId).success) {
    return { ok: false, error: "Invalid request." };
  }

  // A nudge cannot reissue the link: the token is hashed and unrecoverable by
  // design, so re-sending means minting a new one and invalidating the old.
  const supabase = await createClient();
  const { data: recipient } = await supabase
    .from("recipients")
    .select(
      "id, name, email, status, envelope_id, reminder_count, envelopes(contract_id, message, expires_at, status, contracts(title))",
    )
    .eq("id", recipientId)
    .maybeSingle();

  if (!recipient) return { ok: false, error: "That recipient is not available." };
  if (recipient.status === "signed" || recipient.status === "declined") {
    return { ok: false, error: "That recipient has already responded." };
  }

  const envelope = recipient.envelopes as unknown as {
    contract_id: string;
    message: string | null;
    expires_at: string | null;
    status: string;
    contracts: { title: string } | null;
  } | null;

  if (!envelope || (envelope.status !== "sent" && envelope.status !== "partially_signed")) {
    return { ok: false, error: "That envelope is no longer active." };
  }

  const token = generateToken();
  await supabase
    .from("recipients")
    .update({
      token_hash: hashToken(token),
      token_expires_at: envelope.expires_at,
      reminder_count: recipient.reminder_count + 1,
    })
    .eq("id", recipientId);

  const result = await notifyRecipient({
    recipientId,
    token,
    name: recipient.name,
    email: recipient.email,
    senderName: owner.fullName ?? owner.email,
    documentTitle: envelope.contracts?.title ?? "your document",
    message: envelope.message,
    expiresAt: envelope.expires_at,
  });

  if (!result.ok) {
    // The new token is already stored, so surface it when revealing is on —
    // otherwise a failed nudge would leave an unreachable link.
    if (process.env.REVEAL_SIGNING_LINKS === "true") {
      console.warn("nudge_email_failed_link_revealed", { recipientId });
    }
    return result;
  }

  await recordAudit({
    contractId: envelope.contract_id,
    envelopeId: recipient.envelope_id,
    recipientId,
    kind: "reminded",
    actor: owner.email,
    detail: { email: recipient.email },
  });

  revalidatePath(`/contracts/${envelope.contract_id}`);
  return {
    ok: true,
    ...(process.env.REVEAL_SIGNING_LINKS === "true"
      ? { url: `${publicEnv.appUrl}/sign/${token}` }
      : {}),
  };
}

/** Cancels an envelope. Existing links stop working immediately. */
export async function voidEnvelope(envelopeId: string): Promise<void> {
  const owner = await requireOwner();
  if (!z.string().uuid().safeParse(envelopeId).success) return;

  const supabase = await createClient();
  const { data: envelope } = await supabase
    .from("envelopes")
    .select("id, contract_id")
    .eq("id", envelopeId)
    .maybeSingle();

  if (!envelope) return;

  await supabase.from("envelopes").update({ status: "voided" }).eq("id", envelopeId);
  // Clearing the hashes is what actually revokes the links.
  await supabase
    .from("recipients")
    .update({ token_hash: null })
    .eq("envelope_id", envelopeId)
    .neq("status", "signed");

  await recordAudit({
    contractId: envelope.contract_id,
    envelopeId,
    kind: "voided",
    actor: owner.email,
  });

  revalidatePath(`/contracts/${envelope.contract_id}`);
}

/** Signed URL for the owner's own preview while placing fields. */
export async function getSendPreviewUrl(
  versionId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireOwner();
  if (!z.string().uuid().safeParse(versionId).success) {
    return { ok: false, error: "Invalid request." };
  }

  const supabase = await createClient();
  const { data: version } = await supabase
    .from("contract_versions")
    .select("storage_path, state")
    .eq("id", versionId)
    .maybeSingle();

  if (!version || version.state !== "ready") {
    return { ok: false, error: "That document is not available." };
  }

  const { data, error } = await createAdminClient()
    .storage.from(STORAGE_BUCKET)
    .createSignedUrl(version.storage_path, 900);

  if (error || !data) return { ok: false, error: "Could not open that document." };
  return { ok: true, url: data.signedUrl };
}
