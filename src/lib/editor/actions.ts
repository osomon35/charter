"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inspectPdf, sha256Hex } from "@/lib/pdf-server";
import { STORAGE_BUCKET } from "@/lib/contracts/types";
import { overlaySchema } from "@/lib/editor/schema";
import { flattenOverlay, type ImageAsset } from "@/lib/editor/flatten";
import type { OverlayElement } from "@/lib/editor/types";

const uuid = z.string().uuid();

/** A short-lived URL the browser can hand straight to pdf.js. */
const VIEW_URL_TTL_SECONDS = 900;

export async function getVersionUrl(
  versionId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireOwner();
  if (!uuid.safeParse(versionId).success) return { ok: false, error: "Invalid request." };

  const supabase = await createClient();
  const { data: version } = await supabase
    .from("contract_versions")
    .select("storage_path, state")
    .eq("id", versionId)
    .maybeSingle();

  if (!version || version.state !== "ready") {
    return { ok: false, error: "That document is not available." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(version.storage_path, VIEW_URL_TTL_SECONDS);

  if (error || !data) return { ok: false, error: "Could not open that document." };
  return { ok: true, url: data.signedUrl };
}

// ---------------------------------------------------------------------------
// Draft persistence
// ---------------------------------------------------------------------------

export async function saveOverlay(input: {
  contractId: string;
  baseVersionId: string;
  elements: unknown;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireOwner();

  if (!uuid.safeParse(input.contractId).success || !uuid.safeParse(input.baseVersionId).success) {
    return { ok: false, error: "Invalid request." };
  }

  const parsed = overlaySchema.safeParse(input.elements);
  if (!parsed.success) {
    return { ok: false, error: "Some elements could not be saved." };
  }

  // Image paths are capabilities: confine them to this contract's own prefix so
  // a crafted draft cannot pull another contract's file into a flatten.
  for (const element of parsed.data) {
    if (element.type === "image" && !element.assetPath.startsWith(`${input.contractId}/`)) {
      return { ok: false, error: "An image on this document is not valid." };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("contract_overlays").upsert(
    {
      contract_id: input.contractId,
      base_version_id: input.baseVersionId,
      elements: parsed.data,
    },
    { onConflict: "contract_id" },
  );

  if (error) {
    console.error("save_overlay_failed", { message: error.message });
    return { ok: false, error: "Could not save your changes." };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Image assets
// ---------------------------------------------------------------------------

export async function beginImageUpload(input: {
  contractId: string;
  contentType: string;
}): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  await requireOwner();

  if (!uuid.safeParse(input.contractId).success) {
    return { ok: false, error: "Invalid request." };
  }
  if (input.contentType !== "image/png" && input.contentType !== "image/jpeg") {
    return { ok: false, error: "Images must be PNG or JPEG." };
  }

  const extension = input.contentType === "image/jpeg" ? "jpg" : "png";
  const path = `${input.contractId}/assets/${crypto.randomUUID()}.${extension}`;

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) return { ok: false, error: "Could not prepare the upload." };
  return { ok: true, path: data.path, token: data.token };
}

export async function getAssetUrl(
  contractId: string,
  assetPath: string,
): Promise<string | null> {
  await requireOwner();
  if (!uuid.safeParse(contractId).success) return null;
  if (!assetPath.startsWith(`${contractId}/`)) return null;

  const admin = createAdminClient();
  const { data } = await admin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(assetPath, VIEW_URL_TTL_SECONDS);

  return data?.signedUrl ?? null;
}

// ---------------------------------------------------------------------------
// Flatten
// ---------------------------------------------------------------------------

export type FlattenResult =
  | { ok: true; versionId: string; versionNo: number }
  | { ok: false; error: string };

/**
 * Writes a new version with the overlay baked in.
 *
 * The base version is read, never written. The output becomes version N+1 with
 * kind 'edited', gets its own SHA-256, and the draft is cleared — so the editor
 * reopens on top of the flattened result rather than re-applying the same
 * elements twice.
 */
export async function flattenToNewVersion(input: {
  contractId: string;
  baseVersionId: string;
  elements: unknown;
}): Promise<FlattenResult> {
  const owner = await requireOwner();

  if (!uuid.safeParse(input.contractId).success || !uuid.safeParse(input.baseVersionId).success) {
    return { ok: false, error: "Invalid request." };
  }

  const parsed = overlaySchema.safeParse(input.elements);
  if (!parsed.success) {
    return { ok: false, error: "Some elements on this document are not valid." };
  }
  if (parsed.data.length === 0) {
    return { ok: false, error: "There is nothing to flatten yet." };
  }

  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: base } = await supabase
    .from("contract_versions")
    .select("id, contract_id, storage_path, state, version_no")
    .eq("id", input.baseVersionId)
    .maybeSingle();

  if (!base || base.state !== "ready" || base.contract_id !== input.contractId) {
    return { ok: false, error: "That document is not available." };
  }

  const { data: blob, error: downloadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(base.storage_path);

  if (downloadError || !blob) {
    return { ok: false, error: "Could not read the document." };
  }

  const assets = await loadImageAssets(input.contractId, parsed.data);

  let output: Uint8Array;
  try {
    output = await flattenOverlay(new Uint8Array(await blob.arrayBuffer()), parsed.data, assets);
  } catch (err) {
    console.error("flatten_failed", { message: err instanceof Error ? err.message : "unknown" });
    return { ok: false, error: "The document could not be flattened." };
  }

  // Verify our own output before recording it, exactly as an upload is verified.
  const inspection = await inspectPdf(output);
  if (!inspection.ok) {
    console.error("flatten_output_invalid", { reason: inspection.reason });
    return { ok: false, error: "The flattened document failed its own check." };
  }

  const { data: highest } = await supabase
    .from("contract_versions")
    .select("version_no")
    .eq("contract_id", input.contractId)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  const versionNo = (highest?.version_no ?? base.version_no) + 1;
  const path = `${input.contractId}/v${versionNo}/flattened.pdf`;

  const { error: uploadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(path, output, { contentType: "application/pdf", upsert: true });

  if (uploadError) {
    console.error("flatten_upload_failed", { message: uploadError.message });
    return { ok: false, error: "Could not store the new version." };
  }

  const { data: version, error: insertError } = await supabase
    .from("contract_versions")
    .insert({
      contract_id: input.contractId,
      version_no: versionNo,
      kind: "edited",
      state: "ready",
      storage_path: path,
      original_name: `version-${versionNo}.pdf`,
      byte_size: inspection.byteSize,
      page_count: inspection.pageCount,
      sha256: sha256Hex(output),
      created_by: owner.id,
    })
    .select("id")
    .single();

  if (insertError || !version) {
    console.error("flatten_insert_failed", { message: insertError?.message });
    await admin.storage.from(STORAGE_BUCKET).remove([path]);
    return { ok: false, error: "Could not record the new version." };
  }

  // The draft has been applied; leaving it would double up on the next edit.
  await supabase
    .from("contract_overlays")
    .update({ elements: [], base_version_id: version.id })
    .eq("contract_id", input.contractId);

  revalidatePath(`/contracts/${input.contractId}`);
  revalidatePath("/contracts");

  return { ok: true, versionId: version.id, versionNo };
}

async function loadImageAssets(
  contractId: string,
  elements: OverlayElement[],
): Promise<ImageAsset[]> {
  const paths = [
    ...new Set(
      elements
        .filter((element) => element.type === "image")
        .map((element) => (element.type === "image" ? element.assetPath : ""))
        .filter((path) => path.startsWith(`${contractId}/`)),
    ),
  ];

  if (paths.length === 0) return [];

  const admin = createAdminClient();
  const assets: ImageAsset[] = [];

  for (const path of paths) {
    const { data, error } = await admin.storage.from(STORAGE_BUCKET).download(path);
    if (error || !data) continue;
    assets.push({
      path,
      bytes: new Uint8Array(await data.arrayBuffer()),
      contentType: path.endsWith(".jpg") || path.endsWith(".jpeg") ? "image/jpeg" : "image/png",
    });
  }

  return assets;
}
