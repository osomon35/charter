"use client";

/**
 * Single place where pdf.js is loaded and configured.
 *
 * The worker URL is derived from the library's own version so a dependency bump
 * cannot leave the two mismatched — that combination fails with errors that
 * look nothing like a version problem.
 */
type Pdfjs = typeof import("pdfjs-dist");

let cached: Promise<Pdfjs> | null = null;

export function loadPdfjs(): Promise<Pdfjs> {
  cached ??= (async () => {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc =
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    return pdfjs;
  })();
  return cached;
}

/**
 * Types derived from the module rather than imported by name.
 *
 * pdfjs-dist's type entry point has moved its re-exports around between
 * versions, so `import type { PDFDocumentProxy, RenderTask }` is a build-time
 * gamble. Deriving them from getDocument's own signature cannot go stale.
 */
export type PdfDocument = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;
export type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;
export type PdfRenderTask = ReturnType<PdfPage["render"]>;

/**
 * Opens a PDF from a URL by fetching the bytes first.
 *
 * Deliberately not `getDocument({ url })`. That makes pdf.js fetch the file
 * itself using HTTP range requests, and against Supabase Storage the initial
 * request succeeds — so getDocument resolves and the document looks open — while
 * the subsequent range reads never complete, because the CORS response does not
 * expose the headers pdf.js needs. The result is a document whose pages hang
 * forever in render() with no error anywhere.
 *
 * One plain fetch and `{ data }` is the path the contract thumbnails already use,
 * and the only one that has ever worked here. A contract PDF is capped at 50 MB,
 * so holding it in memory is not a concern.
 */
export async function openPdfFromUrl(url: string): Promise<PdfDocument> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch the document (${response.status})`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error("The document came back empty");
  }

  const pdfjs = await loadPdfjs();
  return await pdfjs.getDocument({ data: bytes }).promise;
}
