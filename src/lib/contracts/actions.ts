"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContractAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inspectPdf } from "@/lib/pdf-server";
import {
  CONTRACT_STATUSES,
  MAX_UPLOAD_BYTES,
  STORAGE_BUCKET,
  titleFromFileName,
} from "@/lib/contracts/types";

/**
 * Upload is a three-step handshake rather than a single POST:
 *
 *   1. beginUpload  — the server authorizes, creates the rows, and mints
 *      short-lived signed upload URLs.
 *   2. the browser PUTs the bytes straight to Supabase Storage. They never
 *      pass through Vercel, which caps request bodies at ~4.5 MB.
 *   3. finalizeUpload — the server fetches what actually landed and verifies
 *      it: magic bytes, page count, SHA-256. Nothing the client asserted about
 *      the file is trusted or stored.
 *
 * A version stays in state 'pending' until step 3 succeeds, so a half-finished
 * or forged upload is never visible as a real document.
 */

const beginSchema = z.object({
  fileName: z.string().trim().min(1).max(400),
  byteSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

export type BeginUploadResult =
  | {
      ok: true;
      contractId: string;
      versionId: string;
      pdf: { path: string; token: string };
      thumbnail: { path: string; token: string };
    }
  | { ok: false; error: string };

export async function beginUpload(input: {
  fileName: string;
  byteSize: number;
}): Promise<BeginUploadResult> {
  const owner = await requireContractAccess();

  const parsed = beginSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        input.byteSize > MAX_UPLOAD_BYTES
          ? "That file is over the 50 MB limit."
          : "That file could not be accepted.",
    };
  }
  const { fileName, byteSize } = parsed.data;

  const supabase = await createClient();

  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .insert({
      title: titleFromFileName(fileName),
      status: "draft",
      created_by: owner.id,
    })
    .select("id")
    .single();

  if (contractError || !contract) {
    console.error("begin_upload_contract_failed", { message: contractError?.message });
    return { ok: false, error: "Could not create the contract record." };
  }

  // The uploaded name is recorded on the row but never used to build the path,
  // which sidesteps traversal and encoding problems entirely.
  const pdfPath = `${contract.id}/v1/original.pdf`;
  const thumbPath = `${contract.id}/v1/thumbnail.png`;

  const { data: version, error: versionError } = await supabase
    .from("contract_versions")
    .insert({
      contract_id: contract.id,
      version_no: 1,
      kind: "original",
      state: "pending",
      storage_path: pdfPath,
      original_name: fileName.slice(0, 400),
      byte_size: byteSize,
      created_by: owner.id,
    })
    .select("id")
    .single();

  if (versionError || !version) {
    console.error("begin_upload_version_failed", { message: versionError?.message });
    await supabase.from("contracts").delete().eq("id", contract.id);
    return { ok: false, error: "Could not create the version record." };
  }

  const admin = createAdminClient();
  const [pdfTicket, thumbTicket] = await Promise.all([
    admin.storage.from(STORAGE_BUCKET).createSignedUploadUrl(pdfPath),
    admin.storage.from(STORAGE_BUCKET).createSignedUploadUrl(thumbPath),
  ]);

  if (pdfTicket.error || !pdfTicket.data || thumbTicket.error || !thumbTicket.data) {
    console.error("begin_upload_ticket_failed", {
      pdf: pdfTicket.error?.message,
      thumbnail: thumbTicket.error?.message,
    });
    await supabase.from("contracts").delete().eq("id", contract.id);
    return { ok: false, error: "Could not prepare the upload." };
  }

  return {
    ok: true,
    contractId: contract.id,
    versionId: version.id,
    pdf: { path: pdfTicket.data.path, token: pdfTicket.data.token },
    thumbnail: { path: thumbTicket.data.path, token: thumbTicket.data.token },
  };
}

const finalizeSchema = z.object({
  versionId: z.string().uuid(),
  thumbnailUploaded: z.boolean(),
});

export type FinalizeUploadResult =
  | { ok: true; contractId: string; pageCount: number }
  | { ok: false; error: string };

export async function finalizeUpload(input: {
  versionId: string;
  thumbnailUploaded: boolean;
}): Promise<FinalizeUploadResult> {
  await requireContractAccess();

  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request." };
  }
  const { versionId, thumbnailUploaded } = parsed.data;

  const supabase = await createClient();

  const { data: version, error: versionError } = await supabase
    .from("contract_versions")
    .select("id, contract_id, storage_path, state")
    .eq("id", versionId)
    .maybeSingle();

  if (versionError || !version) {
    return { ok: false, error: "That upload is no longer available." };
  }

  const admin = createAdminClient();

  const { data: blob, error: downloadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(version.storage_path);

  if (downloadError || !blob) {
    await failVersion(versionId, "The uploaded file could not be read back.");
    return { ok: false, error: "The upload did not complete. Try again." };
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const inspection = await inspectPdf(bytes);

  if (!inspection.ok) {
    // Reject it properly: the object goes, and so does the contract shell,
    // rather than leaving an unreadable file sitting in the bucket.
    await admin.storage
      .from(STORAGE_BUCKET)
      .remove([version.storage_path, `${version.contract_id}/v1/thumbnail.png`]);
    await supabase.from("contracts").delete().eq("id", version.contract_id);
    return { ok: false, error: inspection.reason };
  }

  const { error: updateError } = await supabase
    .from("contract_versions")
    .update({
      state: "ready",
      page_count: inspection.pageCount,
      byte_size: inspection.byteSize,
      sha256: inspection.sha256,
      thumbnail_path: thumbnailUploaded
        ? `${version.contract_id}/v1/thumbnail.png`
        : null,
      failure_reason: null,
    })
    .eq("id", versionId);

  if (updateError) {
    console.error("finalize_upload_update_failed", { message: updateError.message });
    return { ok: false, error: "Could not record the upload." };
  }

  revalidatePath("/contracts");
  revalidatePath("/dashboard");

  return { ok: true, contractId: version.contract_id, pageCount: inspection.pageCount };
}

async function failVersion(versionId: string, reason: string): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("contract_versions")
    .update({ state: "failed", failure_reason: reason })
    .eq("id", versionId);
}

/** Abandons a contract whose upload never completed. */
export async function abandonUpload(contractId: string): Promise<void> {
  await requireContractAccess();
  if (!z.string().uuid().safeParse(contractId).success) return;

  const supabase = await createClient();
  const admin = createAdminClient();

  await admin.storage
    .from(STORAGE_BUCKET)
    .remove([`${contractId}/v1/original.pdf`, `${contractId}/v1/thumbnail.png`]);
  await supabase.from("contracts").delete().eq("id", contractId);

  revalidatePath("/contracts");
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

const metadataSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  counterparty_name: z.string().trim().max(300).nullable(),
  status: z.enum(CONTRACT_STATUSES),
  notes: z.string().trim().max(20000).nullable(),
  // Plain regex rather than z.string().date(), which is a recent zod addition
  // and not worth depending on when the shape is this simple.
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export type SaveMetadataState = { error?: string; saved?: boolean };

export async function saveContractMetadata(
  _prev: SaveMetadataState,
  formData: FormData,
): Promise<SaveMetadataState> {
  await requireContractAccess();

  const emptyToNull = (value: FormDataEntryValue | null): string | null => {
    const text = typeof value === "string" ? value.trim() : "";
    return text === "" ? null : text;
  };

  const parsed = metadataSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    counterparty_name: emptyToNull(formData.get("counterparty_name")),
    status: formData.get("status"),
    notes: emptyToNull(formData.get("notes")),
    effective_date: emptyToNull(formData.get("effective_date")),
    expiry_date: emptyToNull(formData.get("expiry_date")),
  });

  if (!parsed.success) {
    return { error: "Check the highlighted fields and try again." };
  }

  const { id, ...fields } = parsed.data;

  if (
    fields.effective_date &&
    fields.expiry_date &&
    fields.expiry_date < fields.effective_date
  ) {
    return { error: "The expiry date cannot be before the effective date." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("contracts").update(fields).eq("id", id);

  if (error) {
    console.error("save_metadata_failed", { message: error.message });
    return { error: "Could not save those changes." };
  }

  revalidatePath("/contracts");
  revalidatePath(`/contracts/${id}`);
  revalidatePath("/dashboard");

  return { saved: true };
}

/** Soft delete — Phase 6 adds the Trash view and the 30-day purge. */
export async function softDeleteContract(contractId: string): Promise<void> {
  await requireContractAccess();
  if (!z.string().uuid().safeParse(contractId).success) return;

  const supabase = await createClient();
  await supabase
    .from("contracts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", contractId);

  revalidatePath("/contracts");
  revalidatePath("/dashboard");
}
