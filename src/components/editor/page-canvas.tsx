"use client";

import { useEffect, useRef, useState } from "react";
import type { PdfDocument, PdfRenderTask } from "@/lib/pdfjs";

/**
 * Renders one page of an already-open PDF to a canvas.
 *
 * Two details matter. pdf.js refuses to run two render tasks against the same
 * canvas, so any in-flight task is cancelled before starting another — this is
 * the usual cause of "Cannot use the same canvas" when zooming quickly. And the
 * canvas is sized in device pixels while being laid out in CSS pixels, so text
 * stays sharp on a retina display.
 */
export function PageCanvas({
  doc,
  pageNumber,
  cssWidth,
  onSize,
}: {
  doc: PdfDocument;
  pageNumber: number;
  /** Laid-out width in CSS pixels; height follows the page's aspect ratio. */
  cssWidth: number;
  onSize?: (size: { width: number; height: number }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<PdfRenderTask | null>(null);
  const [cssHeight, setCssHeight] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      const canvas = canvasRef.current;
      if (!canvas || cssWidth <= 0) return;

      taskRef.current?.cancel();

      const page = await doc.getPage(pageNumber);
      if (cancelled) return;

      const unscaled = page.getViewport({ scale: 1 });
      const cssScale = cssWidth / unscaled.width;
      const height = unscaled.height * cssScale;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: cssScale * dpr });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${height}px`;

      const context = canvas.getContext("2d");
      if (!context) return;

      setCssHeight(height);
      onSize?.({ width: cssWidth, height });

      const task = page.render({ canvasContext: context, viewport });
      taskRef.current = task;

      try {
        await task.promise;
      } catch {
        // A cancelled task is the normal outcome of zooming or paging.
      }
    }

    void render();

    return () => {
      cancelled = true;
      taskRef.current?.cancel();
    };
  }, [doc, pageNumber, cssWidth, onSize]);

  return (
    <canvas
      ref={canvasRef}
      // Blocks the browser's own drag-image behaviour, which otherwise fights
      // every attempt to drag an element across the page.
      onDragStart={(event) => event.preventDefault()}
      style={{ width: cssWidth, height: cssHeight || undefined }}
      className="block bg-white"
    />
  );
}
