import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { sendEmail } from "@/lib/email/resend";
import { ownerSender } from "@/lib/email/sender";
import { signatureRequest } from "@/lib/email/templates";

/**
 * Emails one recipient their unique link and marks them notified.
 *
 * Deliberately NOT a server action. Every export from a "use server" module is a
 * public HTTP endpoint, and this one takes a destination address, a subject and a
 * message body — exported from an action file it was an open mail relay through
 * the project's own Resend account, usable by anyone who could reach the app.
 * It is called only from createAndSendEnvelope, nudgeRecipient and the
 * sequential hand-off, each of which authorises first.
 */
export async function notifyRecipient(input: {
  recipientId: string;
  token: string;
  name: string;
  email: string;
  senderName: string;
  documentTitle: string;
  message: string | null;
  expiresAt: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = `${publicEnv.appUrl}/sign/${input.token}`;

  const mail = signatureRequest({
    recipientName: input.name,
    senderName: input.senderName,
    documentTitle: input.documentTitle,
    message: input.message,
    url,
    expiresAt: input.expiresAt,
  });

  const sent = await sendEmail({
    to: [input.email],
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    // Recipients should see a person, not the software.
    sender: await ownerSender(),
  });

  if (!sent.ok) return { ok: false, error: sent.error };

  // Service role: this also runs from the signer flow, where there is no
  // authenticated owner to satisfy RLS.
  await createAdminClient()
    .from("recipients")
    .update({ status: "sent", notified_at: new Date().toISOString() })
    .eq("id", input.recipientId);

  return { ok: true };
}
