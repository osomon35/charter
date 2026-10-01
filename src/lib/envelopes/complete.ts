import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/lib/contracts/types";
import { inspectPdf, sha256Hex } from "@/lib/pdf-server";
import { flattenOverlay, type ImageAsset } from "@/lib/editor/flatten";
import { overlaySchema } from "@/lib/editor/schema";
import { newElement, todayLabel, type OverlayElement } from "@/lib/editor/types";
import { recordAudit } from "@/lib/envelopes/audit";
import { embedOne } from "@/lib/supabase/embed";
import { appendCertificate } from "@/lib/envelopes/certificate";
import { sendEmail } from "@/lib/email/resend";
import { ownerSender } from "@/lib/email/sender";
import { adminEmails } from "@/lib/members/owner";
import { completedNotice } from "@/lib/email/templates";
import type { FieldType } from "@/lib/envelopes/types";

/**
 * Finalising an envelope.
 *
 * Deliberately NOT a server action. Every export from a "use server" module is a
 * public HTTP endpoint, and this function takes an envelope id and completes it —
 * exported from an action file it would let anyone holding an id force
 * completion, bypassing the requirement that every recipient has actually
 * signed. It is only ever called from submitSignature, which has already proved
 * a valid signer token.
 */
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
      documentTitle: embedOne<{ title: string }>(envelope.contracts as unknown)?.title ?? "Document",
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
  const title =
    embedOne<{ title: string }>(envelope.contracts as unknown)?.title ??
    "Document";
  const names = ((recipients ?? []) as { name: string }[]).map((r) => r.name);
  const addresses = [
    ...new Set([
      ...((recipients ?? []) as { email: string }[]).map((r) => r.email),
      ...(await adminEmails()),
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
    sender: await ownerSender(),
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
