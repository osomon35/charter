/**
 * Renders page 1 of a PDF to a PNG, in the browser.
 *
 * Deliberately client-side: rasterising a page on Vercel means pdf.js plus
 * node-canvas native bindings, which is slow to cold-start and fragile to
 * build. The browser already has a renderer.
 *
 * Everything here is best-effort. A thumbnail is decoration — if pdf.js fails
 * to load, or the PDF is encrypted, or the worker is blocked, we return null
 * and the upload carries on without one.
 */

const THUMBNAIL_WIDTH = 480;

export async function renderFirstPageThumbnail(file: File): Promise<Blob | null> {
  try {
    const pdfjs = await import("pdfjs-dist");

    // The worker must match the library version exactly. Deriving the URL from
    // the imported version means a dependency bump cannot silently mismatch.
    pdfjs.GlobalWorkerOptions.workerSrc =
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data: bytes }).promise;

    try {
      const page = await doc.getPage(1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = THUMBNAIL_WIDTH / baseViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      const context = canvas.getContext("2d");
      if (!context) return null;

      // Contracts are black on white; without this, transparent areas render
      // dark in the list view.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: context, viewport }).promise;

      return await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/png");
      });
    } finally {
      await doc.destroy();
    }
  } catch (err) {
    console.warn("thumbnail_render_failed", err);
    return null;
  }
}
