import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { auditLabel } from "@/lib/envelopes/types";

/**
 * Appends a certificate of completion to a finished document.
 *
 * The point of the page is that the document carries its own evidence: who
 * signed, when, from where, and the SHA-256 of the bytes at each stage. Anyone
 * holding the PDF can check the hashes without access to this system, which is
 * what makes a simple electronic signature defensible under ESIGN and eIDAS.
 *
 * Paginates rather than truncating — an audit trail that silently drops rows
 * once it gets long would be worse than no certificate at all.
 */
export type CertificateInput = {
  documentTitle: string;
  envelopeId: string;
  routing: string;
  completedAt: string;
  sourceSha256: string | null;
  recipients: {
    name: string;
    email: string;
    role: string | null;
    status: string;
    signedAt: string | null;
    ip: string | null;
    userAgent: string | null;
    consentedAt: string | null;
  }[];
  events: {
    kind: string;
    actor: string | null;
    createdAt: string;
    ip: string | null;
    documentSha256: string | null;
  }[];
};

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const INK = rgb(0.12, 0.14, 0.19);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.86, 0.88, 0.9);

export async function appendCertificate(
  pdfBytes: Uint8Array,
  input: CertificateInput,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  let page = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  const ensure = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - MARGIN;
    }
  };

  const line = (
    text: string,
    options?: { size?: number; font?: typeof regular; color?: typeof INK; gap?: number },
  ) => {
    const size = options?.size ?? 9.5;
    const font = options?.font ?? regular;
    ensure(size + 6);
    // Standard fonts are WinAnsi-encoded and pdf-lib throws on anything outside
    // it, so anything exotic is replaced rather than taking down the whole save.
    page.drawText(sanitize(text), { x: MARGIN, y, size, font, color: options?.color ?? INK });
    y -= size + (options?.gap ?? 4);
  };

  const rule = () => {
    ensure(14);
    page.drawLine({
      start: { x: MARGIN, y: y + 4 },
      end: { x: PAGE.width - MARGIN, y: y + 4 },
      thickness: 0.6,
      color: RULE,
    });
    y -= 12;
  };

  // --- header --------------------------------------------------------------
  line("Certificate of completion", { size: 17, font: bold, gap: 8 });
  line(input.documentTitle, { size: 11, font: bold, gap: 10 });
  line(`Completed ${formatStamp(input.completedAt)}`, { color: MUTED });
  line(`Envelope ${input.envelopeId}`, { color: MUTED, size: 8.5, font: mono });
  line(`Routing: ${input.routing}`, { color: MUTED });
  rule();

  // --- signers -------------------------------------------------------------
  line("Signers", { size: 11, font: bold, gap: 8 });

  for (const recipient of input.recipients) {
    ensure(64);
    line(`${recipient.name}  <${recipient.email}>`, { size: 10, font: bold, gap: 3 });
    if (recipient.role) line(`Role: ${recipient.role}`, { color: MUTED, gap: 3 });
    line(`Status: ${recipient.status}`, { color: MUTED, gap: 3 });
    if (recipient.consentedAt) {
      line(`Consented to sign electronically: ${formatStamp(recipient.consentedAt)}`, {
        color: MUTED,
        gap: 3,
      });
    }
    if (recipient.signedAt) {
      line(`Signed: ${formatStamp(recipient.signedAt)}`, { color: MUTED, gap: 3 });
    }
    if (recipient.ip) line(`IP address: ${recipient.ip}`, { color: MUTED, gap: 3 });
    if (recipient.userAgent) {
      for (const part of wrap(recipient.userAgent, 92)) {
        line(part, { color: MUTED, size: 8, gap: 2 });
      }
    }
    y -= 6;
  }

  rule();

  // --- hashes --------------------------------------------------------------
  line("Document fingerprints (SHA-256)", { size: 11, font: bold, gap: 8 });
  line(
    "These identify the exact bytes involved at each stage. A single changed byte produces a",
    { color: MUTED, gap: 3 },
  );
  line("completely different value, so they can be used to verify nothing has been altered.", {
    color: MUTED,
    gap: 8,
  });

  if (input.sourceSha256) {
    line("Document as presented for signature:", { size: 9, gap: 3 });
    line(input.sourceSha256, { font: mono, size: 8.5, gap: 8 });
  }
  line("The fingerprint of this completed file is included in the notification email.", {
    color: MUTED,
    size: 8.5,
    gap: 8,
  });

  rule();

  // --- audit trail ---------------------------------------------------------
  line("Audit trail", { size: 11, font: bold, gap: 8 });

  for (const event of input.events) {
    ensure(26);
    line(`${formatStamp(event.createdAt)}  ${auditLabel(event.kind)}`, { size: 9, gap: 3 });
    const meta = [event.actor, event.ip ? `IP ${event.ip}` : null]
      .filter(Boolean)
      .join("  ·  ");
    if (meta) line(meta, { color: MUTED, size: 8, gap: 2 });
    if (event.documentSha256) {
      line(`sha256 ${event.documentSha256}`, { color: MUTED, size: 7.5, font: mono, gap: 2 });
    }
    y -= 3;
  }

  rule();

  for (const part of wrap(
    "Signatures in this document are simple electronic signatures. Their validity rests on the " +
      "signer's demonstrated intent to sign, captured through an explicit consent step before any " +
      "field could be completed, together with the audit trail above. This is consistent with the " +
      "US ESIGN Act and with simple electronic signatures under EU eIDAS (Regulation 910/2014). It " +
      "is not an advanced or qualified electronic signature, and this is not a notarisation service.",
    98,
  )) {
    line(part, { color: MUTED, size: 8, gap: 2 });
  }

  return await doc.save();
}

function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

function wrap(text: string, chars: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (candidate.length <= chars) {
      line = candidate;
    } else {
      if (line) out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

/** Replaces anything the WinAnsi standard fonts cannot encode. */
function sanitize(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}
