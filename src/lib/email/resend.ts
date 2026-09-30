import "server-only";

import { resolveFrom, type Sender } from "@/lib/email/sender";

/**
 * Minimal Resend client over their REST API.
 *
 * Deliberately not the `resend` npm package: this needs one endpoint, and every
 * dependency added here is a dependency that has to resolve at build time on a
 * machine where nothing can be tested locally.
 */
export type Attachment = {
  filename: string;
  /** Base64-encoded content. */
  content: string;
};

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

const ENDPOINT = "https://api.resend.com/emails";

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

export async function sendEmail(input: {
  to: string[];
  subject: string;
  html: string;
  text: string;
  /** Whose name the mail carries. See resolveFrom for what is actually possible. */
  sender?: Sender | null;
  replyTo?: string;
  attachments?: Attachment[];
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const resolved = resolveFrom(input.sender ?? null);
  const from = resolved.from;
  const replyTo = input.replyTo ?? resolved.replyTo;

  if (!apiKey || !from) {
    return {
      ok: false,
      error:
        "Email is not configured. Set RESEND_API_KEY and EMAIL_FROM, and verify your sending domain in Resend.",
    };
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      }),
    });

    if (!response.ok) {
      // Resend returns a JSON body with a usable message; surface it rather than
      // a bare status, since "domain not verified" is by far the likeliest cause.
      const detail = await response.text();
      console.error("resend_send_failed", { status: response.status, detail });
      return { ok: false, error: `Resend rejected the email (${response.status}): ${detail.slice(0, 300)}` };
    }

    const body = (await response.json()) as { id?: string };
    return { ok: true, id: body.id ?? "unknown" };
  } catch (err) {
    console.error("resend_send_exception", err);
    return { ok: false, error: "Could not reach the email service." };
  }
}
