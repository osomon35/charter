"use client";

import { useEffect, useRef, useState } from "react";
import { openPdfFromUrl, type PdfDocument } from "@/lib/pdfjs";

/**
 * Renders every page of a PDF to a PNG once, then displays them as images.
 *
 * Why not render into a live canvas, which is the obvious approach: a canvas
 * owned by React has a lifecycle that fights pdf.js. Resizes retrigger renders,
 * RenderTask.cancel() is asynchronous so the next render collides with the one
 * unwinding, and a failure mid-flight leaves a blank element with nothing to show
 * for it. Three separate attempts at making that reliable all failed here.
 *
 * Rendering to a detached canvas and exporting a PNG is the path the contract
 * thumbnails already use, and it demonstrably works. Once a page is an <img>:
 *
 *   * resizing and zooming are pure CSS, so nothing re-renders
 *   * there is no cancellation to race
 *   * a failure is a missing image, which is visible and reportable
 *
 * Pages render one at a time. Concurrent renders through a single pdf.js worker
 * buy nothing and make a failure harder to attribute.
 */
export type PageImage = {
  /** Object URL of the rendered PNG. */
  url: string;
  /** Intrinsic pixel size of that PNG. */
  pxWidth: number;
  pxHeight: number;
  /** The PDF page's own size in points — what pdf-lib will later draw against. */
  ptWidth: number;
  ptHeight: number;
};

export type PageImagesState = {
  pages: (PageImage | null)[];
  rendered: number;
  total: number;
  error: string | null;
};

/** Wide enough to stay sharp when a page fills a large display. */
const RENDER_WIDTH = 1600;

export function usePageImages(doc: PdfDocument | null, pageCount: number): PageImagesState {
  const [state, setState] = useState<PageImagesState>({
    pages: [],
    rendered: 0,
    total: pageCount,
    error: null,
  });

  // Object URLs have to be revoked by hand or the blobs stay alive for the life
  // of the document.
  const urls = useRef<string[]>([]);

  useEffect(() => {
    if (!doc) return;

    let cancelled = false;
    const created: string[] = [];

    setState({ pages: new Array(pageCount).fill(null), rendered: 0, total: pageCount, error: null });

    (async () => {
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        if (cancelled) return;

        try {
          const image = await renderPage(doc, pageNumber);
          if (cancelled) {
            if (image) URL.revokeObjectURL(image.url);
            return;
          }
          if (image) created.push(image.url);

          setState((current) => {
            const pages = [...current.pages];
            pages[pageNumber - 1] = image;
            return {
              ...current,
              pages,
              rendered: current.rendered + 1,
            };
          });
        } catch (err) {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : "Unknown rendering error";
          console.error("page_image_failed", { pageNumber, message });
          setState((current) => ({ ...current, error: message }));
          return;
        }
      }
    })();

    urls.current = created;

    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
      urls.current = [];
    };
  }, [doc, pageCount]);

  return state;
}

async function renderPage(doc: PdfDocument, pageNumber: number): Promise<PageImage | null> {
  const page = await doc.getPage(pageNumber);

  const unscaled = page.getViewport({ scale: 1 });
  const scale = RENDER_WIDTH / unscaled.width;
  const viewport = page.getViewport({ scale });

  // A canvas React never sees, so nothing can resize or unmount it mid-render.
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const context = canvas.getContext("2d");
  if (!context) return null;

  // Contracts are black on white; without this, anything transparent in the page
  // renders dark once the PNG is placed on a light surface.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: context, viewport }).promise;

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/png");
  });

  if (!blob) return null;

  return {
    url: URL.createObjectURL(blob),
    pxWidth: canvas.width,
    pxHeight: canvas.height,
    ptWidth: unscaled.width,
    ptHeight: unscaled.height,
  };
}

/**
 * Opens a PDF and keeps it alive for as long as `key` is unchanged.
 *
 * This exists because getting it wrong is subtle and was costly. The previous
 * version of this logic lived inline in each screen, and the send flow's copy had
 * `doc` in its own dependency array — the state the effect sets. So: open the
 * document, setDoc, `doc` changes, the effect re-runs, and its cleanup destroys
 * the document that was just opened. Every later getPage() then hangs forever
 * against a destroyed document, with nothing thrown and nothing logged.
 *
 * The rule the hook enforces: the effect that opens a resource must never depend
 * on the state it stores that resource in. `key` is the only trigger, and the
 * resolver is read from a ref so an inline arrow cannot retrigger it either.
 */
export function usePdfDocument(
  key: string | null,
  resolveUrl: () => Promise<string>,
): { doc: PdfDocument | null; error: string | null } {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolver = useRef(resolveUrl);
  resolver.current = resolveUrl;

  useEffect(() => {
    if (!key) return;

    let cancelled = false;
    let opened: PdfDocument | null = null;

    setDoc(null);
    setError(null);

    (async () => {
      try {
        const url = await resolver.current();
        const document = await openPdfFromUrl(url);

        if (cancelled) {
          void document.destroy();
          return;
        }

        opened = document;
        setDoc(document);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "The document could not be opened";
        console.error("pdf_open_failed", { key, message });
        setError(message);
      }
    })();

    return () => {
      cancelled = true;
      void opened?.destroy();
    };
  }, [key]);

  return { doc, error };
}
