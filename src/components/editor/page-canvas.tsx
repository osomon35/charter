"use client";

import { useEffect, useRef, useState } from "react";
import type { PdfDocument, PdfRenderTask } from "@/lib/pdfjs";

/**
 * Renders one page of an already-open PDF to a canvas.
 *
 * Three things here were learned the hard way:
 *
 * 1. RenderTask.cancel() is asynchronous. Calling it and immediately starting
 *    another render on the same canvas makes pdf.js throw "Cannot use the same
 *    canvas during multiple render operations", and the page stays blank forever.
 *    The previous task's promise has to be awaited — it rejects — before the next
 *    render begins.
 *
 * 2. A bare catch around that promise hides exactly this failure. Cancellation is
 *    distinguished by name and ignored; anything else is reported, so a blank page
 *    is never silent again.
 *
 * 3. The canvas is sized in device pixels but laid out in CSS pixels, or text is
 *    soft on a retina display.
 *
 * Widths are also quantised: a scrolling column's width can wobble by a
 * scrollbar, and repainting on every wobble is how a page never finishes.
 */
const WIDTH_STEP = 8;

export function PageCanvas({
  doc,
  pageNumber,
  cssWidth,
  onSize,
  onError,
}: {
  doc: PdfDocument;
  pageNumber: number;
  /** Laid-out width in CSS pixels; height follows the page's aspect ratio. */
  cssWidth: number;
  onSize?: (size: { width: number; height: number }) => void;
  onError?: (message: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<PdfRenderTask | null>(null);
  const paintedRef = useRef<string | null>(null);
  const [cssHeight, setCssHeight] = useState(0);
  const [failed, setFailed] = useState(false);

  // Callbacks in a ref, not in the dependency list: a parent passing an inline
  // arrow would otherwise re-run the whole render on every one of its renders.
  const callbacks = useRef({ onSize, onError });
  callbacks.current = { onSize, onError };

  const targetWidth = Math.round(cssWidth / WIDTH_STEP) * WIDTH_STEP;

  useEffect(() => {
    let cancelled = false;

    async function render() {
      const canvas = canvasRef.current;
      if (!canvas || targetWidth <= 0) return;

      const key = `${pageNumber}@${targetWidth}`;
      if (paintedRef.current === key) return;

      // Wait for any previous task to actually finish unwinding. cancel() only
      // asks; the promise settling is what frees the canvas.
      const previous = taskRef.current;
      if (previous) {
        previous.cancel();
        try {
          await previous.promise;
        } catch {
          // Expected: that is what cancelling does.
        }
        taskRef.current = null;
      }
      if (cancelled) return;

      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;

        const unscaled = page.getViewport({ scale: 1 });
        const cssScale = targetWidth / unscaled.width;
        const height = unscaled.height * cssScale;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale * dpr });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${targetWidth}px`;
        canvas.style.height = `${height}px`;

        const context = canvas.getContext("2d");
        if (!context) return;

        setCssHeight(height);
        callbacks.current.onSize?.({ width: targetWidth, height });

        const task = page.render({ canvasContext: context, viewport });
        taskRef.current = task;

        await task.promise;

        if (!cancelled) {
          paintedRef.current = key;
          setFailed(false);
        }
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        // pdf.js names its cancellation this way; everything else is a real fault.
        if (name === "RenderingCancelledException" || cancelled) return;

        const message = err instanceof Error ? err.message : "Unknown rendering error";
        console.error("page_render_failed", { pageNumber, message });
        setFailed(true);
        callbacks.current.onError?.(message);
      }
    }

    void render();

    return () => {
      cancelled = true;
      paintedRef.current = null;
      taskRef.current?.cancel();
    };
  }, [doc, pageNumber, targetWidth]);

  if (failed) {
    return (
      <div
        style={{ width: targetWidth || undefined, minHeight: 240 }}
        className="flex items-center justify-center bg-surface-muted p-6 text-center text-xs text-muted-foreground"
      >
        Page {pageNumber} could not be rendered. Open the PDF directly to read it.
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      // Blocks the browser's own drag-image behaviour, which otherwise fights
      // every attempt to drag an element across the page.
      onDragStart={(event) => event.preventDefault()}
      style={{ width: targetWidth || undefined, height: cssHeight || undefined }}
      className="block bg-white"
    />
  );
}
