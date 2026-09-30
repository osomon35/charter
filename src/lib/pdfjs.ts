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
