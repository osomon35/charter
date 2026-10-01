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

const setupSchema = z
  .object({
    fullName: z.string().trim().min(1, "Enter your name").max(200),
    password: z.string().min(10, "Use at least 10 characters").max(200),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    message: "Those passwords do not match",
    path: ["confirm"],
  });

export type SetupState = { error?: string; done?: boolean };

/**
 * Finishes an invited member's setup.
 *
 * They arrive here already signed in — the invite link was verified by the auth
 * callback — so this is not a signup in the usual sense; the account exists and the
 * session is live. What is missing is a password, because the account was created
 * by an admin with one nobody knows, and a name, because recipients see it.
 *
 * Without this step the only way back in is another emailed link, which is a poor
 * way to run an account someone uses daily.
 */
export async function completeSetup(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  const owner = await requireOwner();

  const parsed = setupSchema.safeParse({
    fullName: formData.get("fullName"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check those details." };
  }

  const supabase = await createClient();

  // updateUser acts on the signed-in user, so it cannot set anyone else's
  // password even if the form were tampered with.
  const { error: passwordError } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (passwordError) {
    return { error: `Could not set the password: ${passwordError.message}` };
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName })
    .eq("id", owner.id);

  if (profileError) {
    console.error("setup_profile_failed", { message: profileError.message });
  }

  // The roster carries the name too, so Members shows something useful.
  await supabase
    .from("owner_allowlist")
    .update({ name: parsed.data.fullName })
    .eq("email", owner.email.toLowerCase());

  revalidatePath("/settings");
  revalidatePath("/members");

  return { done: true };
}
