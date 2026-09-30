"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/lib/contracts/types";
import { inspectPdf, sha256Hex } from "@/lib/pdf-server";
import { flattenOverlay, type ImageAsset } from "@/lib/editor/flatten";
import { overlaySchema } from "@/lib/editor/schema";
import { newElement, todayLabel, type OverlayElement } from "@/lib/editor/types";
import { recordAudit, requestFingerprint } from "@/lib/envelopes/audit";
import { appendCertificate } from "@/lib/envelopes/certificate";
import { consume, clientIp } from "@/lib/rate-limit";
import { resolveSignerToken, nextSequentialRecipient } from "@/lib/envelopes/signer";
import { generateToken, hashToken } from "@/lib/envelopes/tokens";
import { notifyRecipient } from "@/lib/envelopes/send-actions";
import { sendEmail } from "@/lib/email/resend";
import { completedNotice, declinedNotice } from "@/lib/email/templates";
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
        (envelopeRow?.contracts as unknown as { title: string } | null)?.title ?? "your document";

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
    await sendEmail({ to: [owner], subject: mail.subject, html: mail.html, text: mail.text });
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

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/**
 * Bakes every recipient's fields into a final version and appends the
 * certificate.
 *
 * Fields are converted into the same overlay elements the Phase 3 editor uses,
 * so flattening goes through one tested path rather than a second drawing
 * implementation. The envelope's frozen source version is the input, so what is
 * produced corresponds exactly to what signers were shown.
 */
export async function completeEnvelope(envelopeId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: envelope } = await admin
    .from("envelopes")
    .select("id, contract_id, source_version_id, routing, status, contracts(title)")
    .eq("id", envelopeId)
    .maybeSingle();

  if (!envelope || envelope.status === "completed") return;

  const { data: source } = await admin
    .from("contract_versions")
    .select("id, storage_path, sha256, version_no")
    .eq("id", envelope.source_version_id)
    .maybeSingle();

  if (!source) {
    console.error("complete_missing_source", { envelopeId });
    return;
  }

  const { data: blob, error: downloadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(source.storage_path);

  if (downloadError || !blob) {
    console.error("complete_download_failed", { envelopeId, message: downloadError?.message });
    return;
  }

  const { data: fieldRows } = await admin
    .from("fields")
    .select("type, page, x, y, w, h, value_text, value_bool, value_asset_path, filled_at")
    .eq("envelope_id", envelopeId);

  const { elements, assetPaths } = fieldsToElements(
    (fieldRows ?? []) as FieldRow[],
  );

  const assets: ImageAsset[] = [];
  for (const path of assetPaths) {
    const { data } = await admin.storage.from(STORAGE_BUCKET).download(path);
    if (data) {
      assets.push({
        path,
        bytes: new Uint8Array(await data.arrayBuffer()),
        contentType: "image/png",
      });
    }
  }

  // Validate through the same schema the editor's own drafts go through.
  const validated = overlaySchema.safeParse(elements);
  if (!validated.success) {
    console.error("complete_elements_invalid", { envelopeId, issue: validated.error.issues[0] });
    return;
  }

  let output: Uint8Array;
  try {
    output = await flattenOverlay(
      new Uint8Array(await blob.arrayBuffer()),
      validated.data,
      assets,
    );
  } catch (err) {
    console.error("complete_flatten_failed", { envelopeId, err });
    return;
  }

  // --- certificate ---------------------------------------------------------
  const { data: recipients } = await admin
    .from("recipients")
    .select("name, email, role, status, signed_at, consented_at, order_index")
    .eq("envelope_id", envelopeId)
    .order("order_index", { ascending: true });

  const { data: events } = await admin
    .from("audit_events")
    .select("kind, actor, created_at, ip, user_agent, document_sha256, recipient_id")
    .eq("envelope_id", envelopeId)
    .order("created_at", { ascending: true });

  const eventList = (events ?? []) as {
    kind: string;
    actor: string | null;
    created_at: string;
    ip: string | null;
    user_agent: string | null;
    document_sha256: string | null;
    recipient_id: string | null;
  }[];

  const completedAt = new Date().toISOString();

  try {
    output = await appendCertificate(output, {
      documentTitle:
        (envelope.contracts as unknown as { title: string } | null)?.title ?? "Document",
      envelopeId,
      routing: envelope.routing,
      completedAt,
      sourceSha256: source.sha256,
      recipients: ((recipients ?? []) as {
        name: string;
        email: string;
        role: string | null;
        status: string;
        signed_at: string | null;
        consented_at: string | null;
      }[]).map((recipient) => {
        // Attribute the IP and agent from that recipient's own signing event.
        const signed = eventList.find(
          (event) => event.kind === "signed" && event.actor === recipient.email,
        );
        return {
          name: recipient.name,
          email: recipient.email,
          role: recipient.role,
          status: recipient.status,
          signedAt: recipient.signed_at,
          consentedAt: recipient.consented_at,
          ip: signed?.ip ?? null,
          userAgent: signed?.user_agent ?? null,
        };
      }),
      events: eventList.map((event) => ({
        kind: event.kind,
        actor: event.actor,
        createdAt: event.created_at,
        ip: event.ip,
        documentSha256: event.document_sha256,
      })),
    });
  } catch (err) {
    console.error("complete_certificate_failed", { envelopeId, err });
    // Press on: a signed document without a certificate page still beats none.
  }

  const inspection = await inspectPdf(output);
  if (!inspection.ok) {
    console.error("complete_output_invalid", { envelopeId, reason: inspection.reason });
    return;
  }

  const { data: highest } = await admin
    .from("contract_versions")
    .select("version_no")
    .eq("contract_id", envelope.contract_id)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  const versionNo = (highest?.version_no ?? source.version_no) + 1;
  const path = `${envelope.contract_id}/v${versionNo}/signed.pdf`;
  const finalHash = sha256Hex(output);

  const { error: uploadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(path, output, { contentType: "application/pdf", upsert: true });

  if (uploadError) {
    console.error("complete_upload_failed", { envelopeId, message: uploadError.message });
    return;
  }

  const { data: version } = await admin
    .from("contract_versions")
    .insert({
      contract_id: envelope.contract_id,
      version_no: versionNo,
      kind: "signed",
      state: "ready",
      storage_path: path,
      original_name: `signed-v${versionNo}.pdf`,
      byte_size: inspection.byteSize,
      page_count: inspection.pageCount,
      sha256: finalHash,
    })
    .select("id")
    .single();

  await admin
    .from("envelopes")
    .update({
      status: "completed",
      completed_at: completedAt,
      final_version_id: version?.id ?? null,
    })
    .eq("id", envelopeId);

  await admin
    .from("contracts")
    .update({ status: "completed" })
    .eq("id", envelope.contract_id);

  await recordAudit({
    contractId: envelope.contract_id,
    envelopeId,
    kind: "completed",
    actor: "system",
    documentSha256: finalHash,
    detail: { version_no: versionNo },
  });

  // --- email everyone the signed copy --------------------------------------
  const title = (envelope.contracts as unknown as { title: string } | null)?.title ?? "Document";
  const names = ((recipients ?? []) as { name: string }[]).map((r) => r.name);
  const addresses = [
    ...new Set([
      ...((recipients ?? []) as { email: string }[]).map((r) => r.email),
      ...(process.env.OWNER_ALLOWLIST?.split(",").map((e) => e.trim().toLowerCase()) ?? []),
    ]),
  ].filter(Boolean);

  const mail = completedNotice({
    documentTitle: title,
    recipientNames: names,
    finalSha256: finalHash,
  });

  await sendEmail({
    to: addresses,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    attachments: [
      {
        filename: `${safeFilename(title)}-signed.pdf`,
        content: Buffer.from(output).toString("base64"),
      },
    ],
  });
}

type FieldRow = {
  type: FieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value_text: string | null;
  value_bool: boolean | null;
  value_asset_path: string | null;
  filled_at: string | null;
};

/**
 * Turns filled fields into overlay elements.
 *
 * Reusing the editor's element model means completion draws through exactly the
 * code path that has already been exercised by every manual edit, rather than a
 * parallel implementation that could disagree about coordinates.
 */
function fieldsToElements(fields: FieldRow[]): {
  elements: OverlayElement[];
  assetPaths: string[];
} {
  const elements: OverlayElement[] = [];
  const assetPaths: string[] = [];

  for (const field of fields) {
    const box = { x: field.x, y: field.y };

    switch (field.type) {
      case "signature":
      case "initials": {
        if (!field.value_asset_path) break;
        assetPaths.push(field.value_asset_path);
        const element = newElement("image", field.page, box, {
          assetPath: field.value_asset_path,
        });
        elements.push({ ...element, w: field.w, h: field.h, locked: true } as OverlayElement);
        break;
      }

      case "checkbox": {
        if (field.value_bool !== true) break;
        const element = newElement("check", field.page, box);
        elements.push({ ...element, w: field.w, h: field.h, locked: true } as OverlayElement);
        break;
      }

      case "date_signed":
      case "text": {
        const text = field.value_text?.trim() || (field.type === "date_signed" ? todayLabel() : "");
        if (!text) break;
        const element = newElement("text", field.page, box);
        if (element.type !== "text") break;
        elements.push({
          ...element,
          w: field.w,
          h: field.h,
          text,
          // Sized to the field box rather than the editor default, so a signer's
          // entry cannot overflow the space the owner allotted it.
          fontSize: Math.max(7, Math.min(16, field.h * 700)),
          locked: true,
        });
        break;
      }
    }
  }

  return { elements, assetPaths: [...new Set(assetPaths)] };
}

function safeFilename(title: string): string {
  return title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "document";
}
