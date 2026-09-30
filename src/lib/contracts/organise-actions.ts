"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TAG_COLORS } from "@/lib/contracts/types";

/**
 * Folders, tags, and bulk operations.
 *
 * Every mutation calls requireOwner() first and then relies on RLS for the rows
 * themselves — an id belonging to someone else simply matches nothing. Ids are
 * validated as UUIDs before use so a malformed one fails cleanly rather than
 * producing a Postgres error the caller can read.
 */

const uuid = z.string().uuid();
const uuidList = z.array(uuid).min(1).max(500);

export type ActionResult = { ok: true } | { ok: false; error: string };

function ok(): ActionResult {
  return { ok: true };
}

function fail(error: string): ActionResult {
  return { ok: false, error };
}

function refresh() {
  revalidatePath("/contracts");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

const folderNameSchema = z.string().trim().min(1).max(120);

export async function createFolder(input: {
  name: string;
  parentId: string | null;
}): Promise<ActionResult> {
  await requireOwner();

  const name = folderNameSchema.safeParse(input.name);
  if (!name.success) return fail("Give the folder a name.");
  if (input.parentId && !uuid.safeParse(input.parentId).success) {
    return fail("Invalid parent folder.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("folders")
    .insert({ name: name.data, parent_id: input.parentId });

  if (error) return fail(`Could not create the folder: ${error.message}`);
  refresh();
  return ok();
}

export async function renameFolder(input: {
  id: string;
  name: string;
}): Promise<ActionResult> {
  await requireOwner();

  if (!uuid.safeParse(input.id).success) return fail("Invalid folder.");
  const name = folderNameSchema.safeParse(input.name);
  if (!name.success) return fail("Give the folder a name.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("folders")
    .update({ name: name.data })
    .eq("id", input.id);

  if (error) return fail(`Could not rename the folder: ${error.message}`);
  refresh();
  return ok();
}

export async function moveFolder(input: {
  id: string;
  parentId: string | null;
}): Promise<ActionResult> {
  await requireOwner();

  if (!uuid.safeParse(input.id).success) return fail("Invalid folder.");
  if (input.parentId && !uuid.safeParse(input.parentId).success) {
    return fail("Invalid destination.");
  }
  if (input.parentId === input.id) return fail("A folder cannot contain itself.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("folders")
    .update({ parent_id: input.parentId })
    .eq("id", input.id);

  // The cycle guard is a database trigger, so its message is the authoritative
  // one — a deep move that would create a loop is refused there, not here.
  if (error) return fail(error.message.replace(/^charter: /, ""));
  refresh();
  return ok();
}

/**
 * Deletes a folder. Its subfolders go with it (ON DELETE CASCADE), but the
 * contracts inside do not — their folder_id is set to null, so deleting a folder
 * never destroys an agreement.
 */
export async function deleteFolder(id: string): Promise<ActionResult> {
  await requireOwner();
  if (!uuid.safeParse(id).success) return fail("Invalid folder.");

  const supabase = await createClient();
  const { error } = await supabase.from("folders").delete().eq("id", id);

  if (error) return fail(`Could not delete the folder: ${error.message}`);
  refresh();
  return ok();
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export async function createTag(input: {
  name: string;
  color: string;
}): Promise<ActionResult> {
  await requireOwner();

  const parsed = z
    .object({
      name: z.string().trim().min(1).max(60),
      color: z.enum(TAG_COLORS),
    })
    .safeParse(input);

  if (!parsed.success) return fail("Give the tag a name and a colour.");

  const supabase = await createClient();
  const { error } = await supabase.from("tags").insert(parsed.data);

  if (error) {
    // A unique index on lower(name) enforces this; the raw message is unhelpful.
    if (error.code === "23505") return fail("A tag with that name already exists.");
    return fail(`Could not create the tag: ${error.message}`);
  }

  refresh();
  revalidatePath("/settings");
  return ok();
}

export async function deleteTag(id: string): Promise<ActionResult> {
  await requireOwner();
  if (!uuid.safeParse(id).success) return fail("Invalid tag.");

  const supabase = await createClient();
  // contract_tags cascades, so this unassigns everywhere rather than orphaning.
  const { error } = await supabase.from("tags").delete().eq("id", id);

  if (error) return fail(`Could not delete the tag: ${error.message}`);
  refresh();
  revalidatePath("/settings");
  return ok();
}

export async function setContractTags(input: {
  contractId: string;
  tagIds: string[];
}): Promise<ActionResult> {
  await requireOwner();

  if (!uuid.safeParse(input.contractId).success) return fail("Invalid contract.");
  const tags = z.array(uuid).max(50).safeParse(input.tagIds);
  if (!tags.success) return fail("Invalid tags.");

  const supabase = await createClient();

  // Replace rather than diff: the set is tiny and a diff would be more code with
  // more ways to go wrong.
  await supabase.from("contract_tags").delete().eq("contract_id", input.contractId);

  if (tags.data.length > 0) {
    const { error } = await supabase.from("contract_tags").insert(
      tags.data.map((tagId) => ({ contract_id: input.contractId, tag_id: tagId })),
    );
    if (error) return fail(`Could not save tags: ${error.message}`);
  }

  refresh();
  revalidatePath(`/contracts/${input.contractId}`);
  return ok();
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

export async function bulkMove(input: {
  contractIds: string[];
  folderId: string | null;
}): Promise<ActionResult> {
  await requireOwner();

  const ids = uuidList.safeParse(input.contractIds);
  if (!ids.success) return fail("Nothing selected.");
  if (input.folderId && !uuid.safeParse(input.folderId).success) {
    return fail("Invalid destination.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("contracts")
    .update({ folder_id: input.folderId })
    .in("id", ids.data);

  if (error) return fail(`Could not move: ${error.message}`);
  refresh();
  return ok();
}

export async function bulkTag(input: {
  contractIds: string[];
  tagId: string;
  add: boolean;
}): Promise<ActionResult> {
  await requireOwner();

  const ids = uuidList.safeParse(input.contractIds);
  if (!ids.success) return fail("Nothing selected.");
  if (!uuid.safeParse(input.tagId).success) return fail("Invalid tag.");

  const supabase = await createClient();

  if (!input.add) {
    const { error } = await supabase
      .from("contract_tags")
      .delete()
      .eq("tag_id", input.tagId)
      .in("contract_id", ids.data);
    if (error) return fail(`Could not remove the tag: ${error.message}`);
  } else {
    // upsert, because some of the selection may already carry the tag and the
    // primary key would otherwise reject the whole batch.
    const { error } = await supabase.from("contract_tags").upsert(
      ids.data.map((contractId) => ({ contract_id: contractId, tag_id: input.tagId })),
      { onConflict: "contract_id,tag_id", ignoreDuplicates: true },
    );
    if (error) return fail(`Could not apply the tag: ${error.message}`);
  }

  refresh();
  return ok();
}

export async function bulkArchive(input: {
  contractIds: string[];
  archived: boolean;
}): Promise<ActionResult> {
  await requireOwner();

  const ids = uuidList.safeParse(input.contractIds);
  if (!ids.success) return fail("Nothing selected.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("contracts")
    .update({ archived_at: input.archived ? new Date().toISOString() : null })
    .in("id", ids.data);

  if (error) return fail(`Could not archive: ${error.message}`);
  refresh();
  return ok();
}

/** Soft delete. The nightly cron purges anything older than 30 days. */
export async function bulkDelete(contractIds: string[]): Promise<ActionResult> {
  await requireOwner();

  const ids = uuidList.safeParse(contractIds);
  if (!ids.success) return fail("Nothing selected.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("contracts")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", ids.data);

  if (error) return fail(`Could not delete: ${error.message}`);
  refresh();
  return ok();
}

export async function bulkRestore(contractIds: string[]): Promise<ActionResult> {
  await requireOwner();

  const ids = uuidList.safeParse(contractIds);
  if (!ids.success) return fail("Nothing selected.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("contracts")
    .update({ deleted_at: null })
    .in("id", ids.data);

  if (error) return fail(`Could not restore: ${error.message}`);
  refresh();
  return ok();
}
