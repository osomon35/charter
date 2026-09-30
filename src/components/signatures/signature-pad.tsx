"use client";

import { useCallback, useEffect, useImperativeHandle, useRef } from "react";

export type SignaturePadHandle = {
  canvas: () => HTMLCanvasElement | null;
  clear: () => void;
  isEmpty: () => boolean;
};

/**
 * Freehand drawing surface.
 *
 * Pointer events rather than mouse or touch, so a trackpad, a mouse and a
 * stylus all work through one code path. Strokes are drawn with quadratic
 * curves between midpoints — joining raw sample points with straight lines
 * produces visibly faceted signatures on a slow drag.
 */
export function SignaturePad({
  ref,
  height = 180,
}: {
  ref?: React.Ref<SignaturePadHandle>;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const previous = useRef<{ x: number; y: number } | null>(null);

  // Backing store in device pixels, layout in CSS pixels, or the ink is blurry.
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Resizing clears the canvas, so preserve what is already drawn.
    const snapshot = dirty.current ? canvas.toDataURL() : null;

    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));

    const context = canvas.getContext("2d");
    if (!context) return;

    context.scale(dpr, dpr);
    context.lineWidth = 2.4;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111827";

    if (snapshot) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height);
      image.src = snapshot;
    }
  }, []);

  useEffect(() => {
    resize();
    const observer = new ResizeObserver(resize);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [resize]);

  useImperativeHandle(ref, () => ({
    canvas: () => canvasRef.current,
    clear: () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      // Reset the transform before clearing, since scale() is still applied.
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.restore();
      dirty.current = false;
    },
    isEmpty: () => !dirty.current,
  }));

  function pointFrom(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ height, touchAction: "none" }}
      className="w-full cursor-crosshair rounded-md border border-border bg-surface"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drawing.current = true;
        const point = pointFrom(event);
        last.current = point;
        previous.current = point;
      }}
      onPointerMove={(event) => {
        if (!drawing.current) return;
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!context || !last.current || !previous.current) return;

        const point = pointFrom(event);
        const midpoint = {
          x: (previous.current.x + point.x) / 2,
          y: (previous.current.y + point.y) / 2,
        };

        context.beginPath();
        context.moveTo(last.current.x, last.current.y);
        context.quadraticCurveTo(previous.current.x, previous.current.y, midpoint.x, midpoint.y);
        context.stroke();

        last.current = midpoint;
        previous.current = point;
        dirty.current = true;
      }}
      onPointerUp={() => {
        drawing.current = false;
        last.current = null;
        previous.current = null;
      }}
      onPointerCancel={() => {
        drawing.current = false;
      }}
    />
  );
}
