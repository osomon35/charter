import "server-only";

/**
 * Email bodies as plain strings.
 *
 * Inline styles only, a table for layout, no external CSS and no images: that is
 * what survives Outlook, Gmail's stripping, and dark-mode inversion. Every mail
 * also goes out with a text alternative — a signing request that lands in spam
 * because it is HTML-only defeats the whole feature.
 */

const ACCENT = "#3b5b92";
const INK = "#1f2430";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";

function shell(body: string, footer: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f7f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${BORDER};border-radius:8px;">
<tr><td style="padding:28px 28px 8px 28px;font:600 15px/1.4 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:${INK};">
Charter
</td></tr>
<tr><td style="padding:0 28px 28px 28px;font:400 15px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:${INK};">
${body}
</td></tr>
<tr><td style="padding:16px 28px 24px 28px;border-top:1px solid ${BORDER};font:400 12px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:${MUTED};">
${footer}
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
<tr><td style="border-radius:6px;background:${ACCENT};">
<a href="${href}" style="display:inline-block;padding:12px 22px;font:600 14px/1 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;">${label}</a>
</td></tr></table>`;
}

const LEGAL_FOOTER =
  "Signing electronically here relies on your intent to sign and on a recorded audit trail — " +
  "a simple electronic signature under the US ESIGN Act and EU eIDAS. It is not a qualified " +
  "or notarised signature. If you were not expecting this, do not sign it, and reply to let " +
  "the sender know.";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function signatureRequest(input: {
  recipientName: string;
  senderName: string;
  documentTitle: string;
  message?: string | null;
  url: string;
  expiresAt: string | null;
}): { subject: string; html: string; text: string } {
  const title = escapeHtml(input.documentTitle);
  const expiry = input.expiresAt
    ? new Date(input.expiresAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  const note = input.message?.trim()
    ? `<p style="margin:0 0 16px 0;padding:12px 14px;background:#f6f7f9;border-radius:6px;white-space:pre-wrap;">${escapeHtml(
        input.message.trim(),
      )}</p>`
    : "";

  const html = shell(
    `<p style="margin:0 0 16px 0;">Hello ${escapeHtml(input.recipientName)},</p>
<p style="margin:0 0 16px 0;">${escapeHtml(input.senderName)} has asked you to sign <strong>${title}</strong>.</p>
${note}
${button(input.url, "Review and sign")}
<p style="margin:0;color:${MUTED};font-size:13px;">
This link is unique to you${expiry ? ` and expires on ${expiry}` : ""}. Please do not forward it.
</p>`,
    LEGAL_FOOTER,
  );

  const text = [
    `Hello ${input.recipientName},`,
    "",
    `${input.senderName} has asked you to sign "${input.documentTitle}".`,
    ...(input.message?.trim() ? ["", input.message.trim()] : []),
    "",
    "Review and sign:",
    input.url,
    "",
    `This link is unique to you${expiry ? ` and expires on ${expiry}` : ""}. Please do not forward it.`,
    "",
    LEGAL_FOOTER,
  ].join("\n");

  return { subject: `Please sign: ${input.documentTitle}`, html, text };
}

export function completedNotice(input: {
  documentTitle: string;
  recipientNames: string[];
  finalSha256: string;
}): { subject: string; html: string; text: string } {
  const title = escapeHtml(input.documentTitle);
  const who = input.recipientNames.map(escapeHtml).join(", ");

  const html = shell(
    `<p style="margin:0 0 16px 0;">
<strong>${title}</strong> has been signed by everyone and is attached to this email.
</p>
<p style="margin:0 0 16px 0;">Signed by: ${who}.</p>
<p style="margin:0 0 6px 0;color:${MUTED};font-size:13px;">
The attached PDF ends with a certificate of completion listing every action taken, with
timestamps. Its SHA-256 fingerprint is:
</p>
<p style="margin:0;font:400 12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:${INK};word-break:break-all;">
${input.finalSha256}
</p>`,
    "Keep this email and its attachment as your record of the agreement.",
  );

  const text = [
    `"${input.documentTitle}" has been signed by everyone and is attached.`,
    "",
    `Signed by: ${input.recipientNames.join(", ")}.`,
    "",
    "The attached PDF ends with a certificate of completion listing every action taken.",
    `SHA-256: ${input.finalSha256}`,
  ].join("\n");

  return { subject: `Signed: ${input.documentTitle}`, html, text };
}

export function declinedNotice(input: {
  documentTitle: string;
  recipientName: string;
  reason: string;
}): { subject: string; html: string; text: string } {
  const html = shell(
    `<p style="margin:0 0 16px 0;">
<strong>${escapeHtml(input.recipientName)}</strong> declined to sign
<strong>${escapeHtml(input.documentTitle)}</strong>.
</p>
<p style="margin:0 0 6px 0;color:${MUTED};font-size:13px;">Reason given:</p>
<p style="margin:0;padding:12px 14px;background:#f6f7f9;border-radius:6px;white-space:pre-wrap;">${escapeHtml(
      input.reason,
    )}</p>`,
    "No further signing requests have been sent for this document.",
  );

  const text = [
    `${input.recipientName} declined to sign "${input.documentTitle}".`,
    "",
    "Reason given:",
    input.reason,
  ].join("\n");

  return { subject: `Declined: ${input.documentTitle}`, html, text };
}
