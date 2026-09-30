"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/lib/contracts/types";
import {
  MAX_SIGNATURE_BYTES,
  SIGNATURE_KINDS,
  SIGNATURE_SOURCES,
  type SignatureRecord,
} from "@/lib/signatures/types";

const uuid = z.string().uuid();

/** PNG files begin with this eight-byte signature. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PNG_MAGIC.length) return false;
  return PNG_MAGIC.every((byte, index) => bytes[index] === byte);
}

export async function listSignatures(): Promise<SignatureRecord[]> {
  await requireOwner();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("signatures")
    .select("id, kind, source, width, height, is_default, created_at")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("list_signatures_failed", { message: error.message });
    return [];
  }

  return (data ?? []) as SignatureRecord[];
}

const saveSchema = z.object({
  kind: z.enum(SIGNATURE_KINDS),
  source: z.enum(SIGNATURE_SOURCES),
  width: z.coerce.number().int().min(1).max(20000),
  height: z.coerce.number().int().min(1).max(20000),
});

export type SaveSignatureResult = { error?: string; savedId?: string };

/**
 * Takes the PNG through the server action body rather than a signed upload URL.
 *
 * A trimmed signature is tens of kilobytes, well inside the action body limit,
 * and routing it through here means the bytes are checked before they are ever
 * stored — magic bytes and size, not a claimed content type.
 */
export async function saveSignature(formData: FormData): Promise<SaveSignatureResult> {
  const owner = await requireOwner();

  const parsed = saveSchema.safeParse({
    kind: formData.get("kind"),
    source: formData.get("source"),
    width: formData.get("width"),
    height: formData.get("height"),
  });

  if (!parsed.success) return { error: "That signature could not be saved." };

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "There is nothing to save yet." };
  }
  if (file.size > MAX_SIGNATURE_BYTES) {
    return { error: "That image is too large." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPng(bytes)) {
    return { error: "Signatures must be PNG images." };
  }

  const path = `signatures/${owner.id}/${crypto.randomUUID()}.png`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(path, bytes, { contentType: "image/png", upsert: false });

  if (uploadError) {
    console.error("signature_upload_failed", { message: uploadError.message });
    return { error: "That signature could not be stored." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("signatures")
    .insert({
      user_id: owner.id,
      kind: parsed.data.kind,
      source: parsed.data.source,
      storage_path: path,
      width: parsed.data.width,
      height: parsed.data.height,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("signature_insert_failed", { message: error?.message });
    await admin.storage.from(STORAGE_BUCKET).remove([path]);
    return { error: "That signature could not be saved." };
  }

  revalidatePath("/settings");
  return { savedId: data.id };
}

export async function deleteSignature(signatureId: string): Promise<void> {
  await requireOwner();
  if (!uuid.safeParse(signatureId).success) return;

  const supabase = await createClient();

  // Read the path through RLS first: that is what proves the row is the
  // caller's before the service-role client removes the object.
  const { data: signature } = await supabase
    .from("signatures")
    .select("storage_path")
    .eq("id", signatureId)
    .maybeSingle();

  if (!signature) return;

  await supabase.from("signatures").delete().eq("id", signatureId);
  await createAdminClient().storage.from(STORAGE_BUCKET).remove([signature.storage_path]);

  revalidatePath("/settings");
}

export async function setDefaultSignature(signatureId: string): Promise<void> {
  const owner = await requireOwner();
  if (!uuid.safeParse(signatureId).success) return;

  const supabase = await createClient();

  const { data: signature } = await supabase
    .from("signatures")
    .select("id, kind")
    .eq("id", signatureId)
    .maybeSingle();

  if (!signature) return;

  // Clear the old default first — a unique partial index enforces one per kind,
  // so setting the new one before clearing would collide.
  await supabase
    .from("signatures")
    .update({ is_default: false })
    .eq("user_id", owner.id)
    .eq("kind", signature.kind);

  await supabase.from("signatures").update({ is_default: true }).eq("id", signatureId);

  revalidatePath("/settings");
}

export type PlaceSignatureResult =
  | { ok: true; assetPath: string; width: number; height: number }
  | { ok: false; error: string };

/**
 * Copies a saved signature into a contract's own asset prefix.
 *
 * The copy is deliberate. Overlay elements only accept paths under the
 * contract's prefix, which is what stops a crafted draft reaching another
 * contract's files; and a document that has been signed should not change
 * because a profile signature was later deleted.
 */
export async function placeSignatureOnContract(input: {
  contractId: string;
  signatureId: string;
}): Promise<PlaceSignatureResult> {
  await requireOwner();

  if (!uuid.safeParse(input.contractId).success || !uuid.safeParse(input.signatureId).success) {
    return { ok: false, error: "Invalid request." };
  }

  const supabase = await createClient();

  const { data: contract } = await supabase
    .from("contracts")
    .select("id")
    .eq("id", input.contractId)
    .maybeSingle();

  if (!contract) return { ok: false, error: "That contract is not available." };

  const { data: signature } = await supabase
    .from("signatures")
    .select("storage_path, width, height")
    .eq("id", input.signatureId)
    .maybeSingle();

  if (!signature) return { ok: false, error: "That signature is not available." };

  const assetPath = `${input.contractId}/assets/${crypto.randomUUID()}.png`;

  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(STORAGE_BUCKET)
    .copy(signature.storage_path, assetPath);

  if (error) {
    console.error("signature_copy_failed", { message: error.message });
    return { ok: false, error: "That signature could not be placed." };
  }

  return {
    ok: true,
    assetPath,
    width: signature.width,
    height: signature.height,
  };
}
