"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { sendEmail } from "@/lib/email/resend";
import { ownerSender } from "@/lib/email/sender";
import { memberInvite } from "@/lib/email/templates";
import { MEMBER_ROLES } from "@/lib/members/types";

/**
 * Member management.
 *
 * Every action requires an admin, and the database agrees: owner_allowlist's write
 * policies are gated on is_admin(), so a bug here still cannot hand out access.
 *
 * Roster changes take effect on the member's next request — is_owner() and
 * member_role() read the table on every policy evaluation, so there is no cache to
 * wait on and no session to invalidate.
 */
const emailSchema = z.string().trim().toLowerCase().email().max(320);

export type MemberResult =
  | { ok: true; inviteUrl?: string; warning?: string }
  | { ok: false; error: string };

export async function inviteMember(input: {
  email: string;
  name: string;
  role: string;
}): Promise<MemberResult> {
  const admin = await requireAdmin();

  const parsed = z
    .object({
      email: emailSchema,
      name: z.string().trim().max(200),
      role: z.enum(MEMBER_ROLES),
    })
    .safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: "Give a valid email address and a role." };
  }
  const { email, name, role } = parsed.data;

  const supabase = await createClient();

  const { error: insertError } = await supabase.from("owner_allowlist").insert({
    email,
    name: name || null,
    role,
    invited_at: new Date().toISOString(),
    invited_by: admin.email,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return { ok: false, error: "That address is already a member." };
    }
    return { ok: false, error: `Could not add them: ${insertError.message}` };
  }

  // The account and the sign-in link come from Supabase's admin API, so nothing
  // depends on Supabase's own email settings — the link is sent through Resend
  // with the rest of this app's mail.
  const service = createAdminClient();
  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo: `${publicEnv.appUrl}/auth/callback` },
  });

  if (linkError || !link?.properties?.action_link) {
    // The roster entry stands; they simply have no link yet. Say so rather than
    // rolling back, because removing them would lose the role just chosen.
    return {
      ok: true,
      warning: `Added, but the invite link could not be created: ${linkError?.message ?? "unknown"}. Use Resend invite again once that is resolved.`,
    };
  }

  const inviteUrl = link.properties.action_link;

  const mail = memberInvite({
    name: name || email,
    inviterName: admin.fullName ?? admin.email,
    url: inviteUrl,
  });

  const sent = await sendEmail({
    to: [email],
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    sender: await ownerSender(),
  });

  revalidatePath("/members");

  // The link is always returned to the admin who created it: email is the normal
  // path, but an undeliverable invite should not leave a member unable to get in.
  return sent.ok
    ? { ok: true, inviteUrl }
    : { ok: true, inviteUrl, warning: `Added, but the email failed: ${sent.error}` };
}

export async function resendInvite(email: string): Promise<MemberResult> {
  const admin = await requireAdmin();

  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: "Invalid address." };

  const supabase = await createClient();
  const { data: member } = await supabase
    .from("owner_allowlist")
    .select("email, name, blocked_at")
    .eq("email", parsed.data)
    .maybeSingle();

  if (!member) return { ok: false, error: "They are not a member." };
  if (member.blocked_at) return { ok: false, error: "They are blocked. Unblock them first." };

  const service = createAdminClient();

  // magiclink for an existing account, invite for one that was never accepted.
  const { data: existing } = await service.auth.admin.listUsers({ page: 1, perPage: 200 });
  const hasAccount = (existing?.users ?? []).some(
    (user) => user.email?.toLowerCase() === parsed.data,
  );

  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: hasAccount ? "magiclink" : "invite",
    email: parsed.data,
    options: { redirectTo: `${publicEnv.appUrl}/auth/callback` },
  });

  if (linkError || !link?.properties?.action_link) {
    return { ok: false, error: `Could not create a link: ${linkError?.message ?? "unknown"}` };
  }

  const inviteUrl = link.properties.action_link;

  const mail = memberInvite({
    name: member.name || parsed.data,
    inviterName: admin.fullName ?? admin.email,
    url: inviteUrl,
  });

  const sent = await sendEmail({
    to: [parsed.data],
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    sender: await ownerSender(),
  });

  await supabase
    .from("owner_allowlist")
    .update({ invited_at: new Date().toISOString() })
    .eq("email", parsed.data);

  revalidatePath("/members");

  return sent.ok
    ? { ok: true, inviteUrl }
    : { ok: true, inviteUrl, warning: `The email failed: ${sent.error}` };
}

export async function setMemberRole(input: {
  email: string;
  role: string;
}): Promise<MemberResult> {
  const admin = await requireAdmin();

  const parsed = z
    .object({ email: emailSchema, role: z.enum(MEMBER_ROLES) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  // An admin demoting themselves could leave nobody able to manage members.
  if (parsed.data.email === admin.email.toLowerCase() && parsed.data.role !== "admin") {
    return {
      ok: false,
      error: "Promote someone else to admin before changing your own role.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("owner_allowlist")
    .update({ role: parsed.data.role })
    .eq("email", parsed.data.email);

  if (error) return { ok: false, error: `Could not change the role: ${error.message}` };

  revalidatePath("/members");
  return { ok: true };
}

export async function setMemberBlocked(input: {
  email: string;
  blocked: boolean;
}): Promise<MemberResult> {
  const admin = await requireAdmin();

  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) return { ok: false, error: "Invalid address." };

  if (parsed.data === admin.email.toLowerCase()) {
    return { ok: false, error: "You cannot block yourself." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("owner_allowlist")
    .update({ blocked_at: input.blocked ? new Date().toISOString() : null })
    .eq("email", parsed.data);

  if (error) return { ok: false, error: `Could not update them: ${error.message}` };

  revalidatePath("/members");
  return { ok: true };
}

/**
 * Removes a member and their account.
 *
 * Blocking is usually the better move — it ends access immediately while leaving
 * the person legible in the audit trail. Removal is here for an address added by
 * mistake. Audit rows record the email as text, so history survives either way.
 */
export async function removeMember(email: string): Promise<MemberResult> {
  const admin = await requireAdmin();

  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: "Invalid address." };

  if (parsed.data === admin.email.toLowerCase()) {
    return { ok: false, error: "You cannot remove yourself." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("owner_allowlist")
    .delete()
    .eq("email", parsed.data);

  if (error) return { ok: false, error: `Could not remove them: ${error.message}` };

  // Delete the account too, or it lingers able to sign in and see nothing.
  try {
    const service = createAdminClient();
    const { data } = await service.auth.admin.listUsers({ page: 1, perPage: 200 });
    const account = (data?.users ?? []).find(
      (user) => user.email?.toLowerCase() === parsed.data,
    );
    if (account) await service.auth.admin.deleteUser(account.id);
  } catch (err) {
    console.error("remove_member_account_failed", err);
    revalidatePath("/members");
    return {
      ok: true,
      warning:
        "Removed from the roster, but their Supabase account could not be deleted. They can no longer read anything; delete it under Authentication → Users.",
    };
  }

  revalidatePath("/members");
  return { ok: true };
}

/** Deletes an account that has no roster entry. */
export async function deleteOrphanAccount(email: string): Promise<MemberResult> {
  await requireAdmin();

  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: "Invalid address." };

  const supabase = await createClient();
  const { data: member } = await supabase
    .from("owner_allowlist")
    .select("email")
    .eq("email", parsed.data)
    .maybeSingle();

  // Refuse if they are on the roster: that is a removal, not an orphan cleanup.
  if (member) return { ok: false, error: "They are a member. Remove them instead." };

  try {
    const service = createAdminClient();
    const { data } = await service.auth.admin.listUsers({ page: 1, perPage: 200 });
    const account = (data?.users ?? []).find(
      (user) => user.email?.toLowerCase() === parsed.data,
    );
    if (account) await service.auth.admin.deleteUser(account.id);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not delete that account.",
    };
  }

  revalidatePath("/members");
  return { ok: true };
}

/** Used by the shell to decide what to show. */
export async function currentRole(): Promise<string> {
  const owner = await requireOwner();
  return owner.role;
}
