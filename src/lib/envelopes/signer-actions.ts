"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/lib/contracts/types";
import { recordAudit } from "@/lib/envelopes/audit";
import { embedOne } from "@/lib/supabase/embed";
import { consume, clientIp } from "@/lib/rate-limit";
import { resolveSignerToken, nextSequentialRecipient } from "@/lib/envelopes/signer";
import { generateToken, hashToken } from "@/lib/envelopes/tokens";
import { notifyRecipient } from "@/lib/envelopes/notify";
import { completeEnvelope } from "@/lib/envelopes/complete";
import { sendEmail } from "@/lib/email/resend";
import { ownerSender } from "@/lib/email/sender";
import { declinedNotice } from "@/lib/email/templates";
import type { FieldType } from "@/lib/envelopes/types";

/**
 * Everything a signer can do.
 *
 * All of it is token-scoped: each action re-resolves the token rather than
 * trusting any identifier the client sends, so a recipient can only ever fill
 * their own fields. Nothing here accepts a recipient id or field id without
 * checking it against the rows that token owns.
 */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_SIGNATURE_BYTES = 1024 * 1024;

async function limitSigner(token: string): Promise<boolean> {
  const ip = await clientIp();
  // Per-IP and per-token: the public route is the one thing on this deployment
  // that anyone on the internet can reach.
  const [byIp, byToken] = await Promise.all([
    consume(`sign:ip:${ip}`, 60, 600),
    consume(`sign:token:${hashToken(token).slice(0, 32)}`, 40, 600),
  ]);
  return byIp.ok && byToken.ok;
}

export async function recordSignerView(
  token: string,
): Promise<{ ok: boolean }> {
  if (!(await limitSigner(token))) return { ok: false };

  const lookup = await resolveSignerToken(token);
  if (!lookup.ok) return { ok: false };

  const { recipient, envelope, document } = lookup.context;
  const admin = createAdminClient();

  await admin
    .from("recipients")
    .update({
      last_viewed_at: new Date().toISOString(),
      // Do not walk a status backwards from signed or declined.
      ...(recipient.status === "pending" || recipient.status === "sent"
        ? { status: "viewed" }
        : {}),
    })
    .eq("id", recipient.id);

  await recordAudit({
    contractId: envelope.contractId,
    envelopeId: envelope.id,
    recipientId: recipient.id,
    kind: "viewed",
    actor: recipient.email,
    documentSha256: document.sha256,
  });

  return { ok: true };
}

export async function recordConsent(token: string): Promise<{ ok: boolean }> {
  if (!(await limitSigner(token))) return { ok: false };

  const lookup = await resolveSignerToken(token);
  if (!lookup.ok) return { ok: false };

  const { recipient, envelope } = lookup.context;
  if (recipient.consentedAt) return { ok: true };

  await createAdminClient()
    .from("recipients")
    .update({ consented_at: new Date().toISOString() })
    .eq("id", recipient.id);

  // Recorded separately from signing because consent is the thing that makes an
  // electronic signature stand up: it evidences intent, before any field was
  // filled.
  await recordAudit({
    contractId: envelope.contractId,
    envelopeId: envelope.id,
    recipientId: recipient.id,
    kind: "consented",
    actor: recipient.email,
  });

  return { ok: true };
}

/** Stores a signature or initials PNG drawn by the signer. */
export async function uploadSignerImage(
  formData: FormData,
): Promise<{ ok: true; path: string; width: number; height: number } | { ok: false; error: string }> {
  const token = String(formData.get("token") ?? "");
  if (!(await limitSigner(token))) return { ok: false, error: "Too many attempts. Try again shortly." };

  const lookup = await resolveSignerToken(token);
  if (!lookup.ok) return { ok: false, error: "This signing link is no longer valid." };

  const file = formData.get("image");
  if (!(file instanceof Blob) || file.size === 0) {
    return { ok: false, error: "Nothing to save." };
  }
  if (file.size > MAX_SIGNATURE_BYTES) {
    return { ok: false, error: "That image is too large." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!PNG_MAGIC.every((byte, index) => bytes[index] === byte)) {
    return { ok: false, error: "Signatures must be PNG images." };
  }

  const width = Number(formData.get("width"));
  const height = Number(formData.get("height"));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return { ok: false, error: "That image is not valid." };
  }

  const { envelope, recipient } = lookup.context;
  // Path derived from the token's own rows, never from client input.
  const path = `${envelope.contractId}/signer/${recipient.id}/${crypto.randomUUID()}.png`;

  const { error } = await createAdminClient()
    .storage.from(STORAGE_BUCKET)
    .upload(path, bytes, { contentType: "image/png", upsert: false });

  if (error) {
    console.error("signer_image_upload_failed", { message: error.message });
    return { ok: false, error: "That signature could not be stored." };
  }

  return { ok: true, path, width: Math.round(width), height: Math.round(height) };
}

const valueSchema = z.object({
  fieldId: z.string().uuid(),
  text: z.string().max(2000).nullable(),
  checked: z.boolean().nullable(),
  assetPath: z.string().max(400).nullable(),
});

export type SubmitResult =
  | { ok: true; completed: boolean }
  | { ok: false; error: string };

export async function submitSignature(input: {
  token: string;
  values: unknown;
}): Promise<SubmitResult> {
  if (!(await limitSigner(input.token))) {
    return { ok: false, error: "Too many attempts. Try again shortly." };
  }

  const lookup = await resolveSignerToken(input.token);
  if (!lookup.ok) return { ok: false, error: "This signing link is no longer valid." };

  const { recipient, envelope, document, fields } = lookup.context;

  if (!recipient.consentedAt) {
    return { ok: false, error: "Please agree to sign electronically first." };
  }

  const parsed = z.array(valueSchema).max(500).safeParse(input.values);
  if (!parsed.success) return { ok: false, error: "Those entries are not valid." };

  const byId = new Map(fields.map((field) => [field.id, field]));
  const admin = createAdminClient();
  const now = new Date().toISOString();

  for (const value of parsed.data) {
    const field = byId.get(value.fieldId);
    // Silently ignoring an unknown id rather than erroring: it can only be
    // another recipient's field or a stale one, and neither is the signer's
    // problem to resolve.
    if (!field) continue;

    if (value.assetPath && !value.assetPath.startsWith(`${envelope.contractId}/signer/${recipient.id}/`)) {
      return { ok: false, error: "A signature on this document is not valid." };
    }

    await admin
      .from("fields")
      .update({
        value_text: value.text,
        value_bool: value.checked,
        value_asset_path: value.assetPath,
        filled_at: now,
      })
      .eq("id", field.id)
      .eq("recipient_id", recipient.id);
  }

  // Re-read rather than trusting the write-through, then enforce required.
  const { data: saved } = await admin
    .from("fields")
    .select("id, type, required, value_text, value_bool, value_asset_path")
    .eq("recipient_id", recipient.id);

  const missing = ((saved ?? []) as {
    type: FieldType;
    required: boolean;
    value_text: string | null;
    value_bool: boolean | null;
    value_asset_path: string | null;
  }[]).filter((field) => field.required && !hasValue(field));

  if (missing.length > 0) {
    return { ok: false, error: `${missing.length} required field(s) still need completing.` };
  }

  await admin
    .from("recipients")
    .update({ status: "signed", signed_at: now, token_hash: null })
    .eq("id", recipient.id);

  await recordAudit({
    contractId: envelope.contractId,
    envelopeId: envelope.id,
    recipientId: recipient.id,
    kind: "signed",
    actor: recipient.email,
    documentSha256: document.sha256,
    detail: { fields: (saved ?? []).length },
  });

  // Everyone done?
  const { data: all } = await admin
    .from("recipients")
    .select("id, status")
    .eq("envelope_id", envelope.id);

  const list = (all ?? []) as { id: string; status: string }[];
  const everyoneSigned = list.length > 0 && list.every((row) => row.status === "signed");

  if (everyoneSigned) {
    await completeEnvelope(envelope.id);
    return { ok: true, completed: true };
  }

  await admin
    .from("envelopes")
    .update({ status: "partially_signed" })
    .eq("id", envelope.id);
  await admin
    .from("contracts")
    .update({ status: "partially_signed" })
    .eq("id", envelope.contractId);

  // Sequential: the next person is only notified now, not at send time.
  if (envelope.routing === "sequential") {
    const next = await nextSequentialRecipient(envelope.id);
    if (next) {
      const { data: envelopeRow } = await admin
        .from("envelopes")
        .select("message, expires_at, contracts(title)")
        .eq("id", envelope.id)
        .maybeSingle();

      const title =
        embedOne<{ title: string }>(envelopeRow?.contracts as unknown)?.title ??
        "your document";

      const nextToken = generateToken();
      await admin
        .from("recipients")
        .update({ token_hash: hashToken(nextToken), token_expires_at: envelopeRow?.expires_at ?? null })
        .eq("id", next.id);

      await notifyRecipient({
        recipientId: next.id,
        token: nextToken,
        name: next.name,
        email: next.email,
        senderName: "Charter",
        documentTitle: title,
        message: envelopeRow?.message ?? null,
        expiresAt: envelopeRow?.expires_at ?? null,
      });
    }
  }

  return { ok: true, completed: false };
}

export async function declineToSign(input: {
  token: string;
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await limitSigner(input.token))) {
    return { ok: false, error: "Too many attempts. Try again shortly." };
  }

  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 2000) {
    return { ok: false, error: "Please give a short reason." };
  }

  const lookup = await resolveSignerToken(input.token);
  if (!lookup.ok) return { ok: false, error: "This signing link is no longer valid." };

  const { recipient, envelope, document } = lookup.context;
  const admin = createAdminClient();

  await admin
    .from("recipients")
    .update({
      status: "declined",
      declined_at: new Date().toISOString(),
      decline_reason: reason,
      token_hash: null,
    })
    .eq("id", recipient.id);

  await admin.from("envelopes").update({ status: "declined" }).eq("id", envelope.id);
  await admin.from("contracts").update({ status: "declined" }).eq("id", envelope.contractId);

  // Every remaining link is revoked: one decline stops the envelope.
  await admin
    .from("recipients")
    .update({ token_hash: null })
    .eq("envelope_id", envelope.id)
    .neq("status", "signed");

  await recordAudit({
    contractId: envelope.contractId,
    envelopeId: envelope.id,
    recipientId: recipient.id,
    kind: "declined",
    actor: recipient.email,
    documentSha256: document.sha256,
    detail: { reason },
  });

  const owner = process.env.OWNER_ALLOWLIST?.split(",")[0]?.trim();
  if (owner) {
    const mail = declinedNotice({
      documentTitle: document.title,
      recipientName: recipient.name,
      reason,
    });
    await sendEmail({
      to: [owner],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      sender: await ownerSender(),
    });
  }

  return { ok: true };
}

function hasValue(field: {
  type: FieldType;
  value_text: string | null;
  value_bool: boolean | null;
  value_asset_path: string | null;
}): boolean {
  switch (field.type) {
    case "signature":
    case "initials":
      return Boolean(field.value_asset_path);
    case "checkbox":
      return field.value_bool === true;
    case "date_signed":
    case "text":
      return Boolean(field.value_text?.trim());
  }
}
