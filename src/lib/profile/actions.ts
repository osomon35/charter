"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ fullName: z.string().trim().max(200) });

export type SaveProfileState = { error?: string; saved?: boolean };

/**
 * The display name matters beyond the sidebar: it is what recipients see in the
 * From line of a signing request, and what the certificate of completion names
 * as the sender.
 */
export async function saveDisplayName(
  _prev: SaveProfileState,
  formData: FormData,
): Promise<SaveProfileState> {
  const owner = await requireOwner();

  const parsed = schema.safeParse({ fullName: formData.get("fullName") });
  if (!parsed.success) return { error: "That name is too long." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName || null })
    .eq("id", owner.id);

  if (error) {
    console.error("save_display_name_failed", { message: error.message });
    return { error: `Could not save: ${error.message}` };
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { saved: true };
}
