import "server-only";

import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";

/** Every PDF begins with these five bytes. Extensions are not evidence. */
const PDF_MAGIC = "%PDF-";

export type PdfInspection =
  | { ok: true; pageCount: number; sha256: string; byteSize: number }
  | { ok: false; reason: string };

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Verifies the bytes really are a PDF and reports what is inside.
 *
 * Runs against the object already in storage, never against anything the
 * client claims, so a forged page count or content type gets nowhere.
 */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  if (bytes.byteLength === 0) {
    return { ok: false, reason: "The file is empty." };
  }

  const header = new TextDecoder("latin1").decode(bytes.subarray(0, PDF_MAGIC.length));
  if (header !== PDF_MAGIC) {
    return { ok: false, reason: "That file is not a PDF." };
  }

  let pageCount: number;
  try {
    // ignoreEncryption: plenty of real contracts carry an owner password that
    // restricts editing but not reading. We only need the page count here.
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    pageCount = doc.getPageCount();
  } catch {
    return { ok: false, reason: "That PDF could not be read — it may be corrupt." };
  }

  if (pageCount < 1) {
    return { ok: false, reason: "That PDF has no pages." };
  }

  return {
    ok: true,
    pageCount,
    sha256: sha256Hex(bytes),
    byteSize: bytes.byteLength,
  };
}
