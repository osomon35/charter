"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContractAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CONTRACT_STATUSES, TAG_COLORS } from "@/lib/contracts/types";

/**
 * Tags and bulk operations.
 *
 * Every mutation calls requireOwner() first and then relies on RLS for the rows
 * themselves — an id belonging to someone else simply matches nothing. Ids are
 * validated as UUIDs before use so a malformed one fails cleanly rather than
 * producing a Postgres error the caller can read.
 */

const uuid = z.string().uuid();
const uuidList = z.array(uuid).min(1).max(500);

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Narrow return types, not the union.
 *
 * Typed as ActionResult, fail() could not be returned from an action with a
 * richer success shape — createTag returns the new id, and the union's bare
 * `{ ok: true }` is not assignable to that. The precise types are assignable
 * everywhere the union is.
 */
function ok(): { ok: true } {
  return { ok: true };
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function refresh() {
  revalidatePath("/contracts");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export type CreateTagResult = { ok: true; id: string } | { ok: false; error: string };

export async function createTag(input: {
  name: string;
  color: string;
}): Promise<CreateTagResult> {
  await requireContractAccess();

  const parsed = z
    .object({
      name: z.string().trim().min(1).max(60),
      color: z.enum(TAG_COLORS),
    })
    .safeParse(input);

  if (!parsed.success) return fail("Give the tag a name and a colour.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tags")
    .insert(parsed.data)
    .select("id")
    .single();

  if (error || !data) {
    // A unique index on lower(name) enforces this; the raw message is unhelpful.
    if (error?.code === "23505") return fail("A tag with that name already exists.");
    return fail(`Could not create the tag: ${error?.message ?? "unknown"}`);
  }

  refresh();
  revalidatePath("/settings");
  return { ok: true, id: data.id };
}

export async function deleteTag(id: string): Promise<ActionResult> {
  await requireContractAccess();
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
  await requireContractAccess();

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

export async function setContractStatus(input: {
  contractId: string;
  status: string;
}): Promise<ActionResult> {
  await requireContractAccess();

  if (!uuid.safeParse(input.contractId).success) return fail("Invalid contract.");
  const status = z.enum(CONTRACT_STATUSES).safeParse(input.status);
  if (!status.success) return fail("Unknown status.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("contracts")
    .update({ status: status.data })
    .eq("id", input.contractId);

  if (error) return fail(`Could not change the status: ${error.message}`);

  refresh();
  revalidatePath(`/contracts/${input.contractId}`);
  return ok();
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

export async function bulkTag(input: {
  contractIds: string[];
  tagId: string;
  add: boolean;
}): Promise<ActionResult> {
  await requireContractAccess();

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
  await requireContractAccess();

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
  await requireContractAccess();

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
  await requireContractAccess();

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
