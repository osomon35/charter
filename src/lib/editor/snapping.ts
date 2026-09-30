import type { OverlayElement } from "@/lib/editor/types";

/**
 * Alignment snapping, in normalized units.
 *
 * The threshold is given in pixels and converted, so snapping feels the same
 * strength at every zoom level — a fixed normalized tolerance would grab
 * aggressively when zoomed in and not at all when zoomed out.
 */
export type Guide = { axis: "x" | "y"; at: number };

export type SnapResult = {
  x: number;
  y: number;
  guides: Guide[];
};

const THRESHOLD_PX = 6;

export function snapPosition(
  moving: { x: number; y: number; w: number; h: number },
  others: OverlayElement[],
  pageSizePx: { width: number; height: number },
): SnapResult {
  const tolX = THRESHOLD_PX / pageSizePx.width;
  const tolY = THRESHOLD_PX / pageSizePx.height;

  // Candidate lines to snap to, per axis: the page's own edges and centre,
  // plus every other element's edges and centre.
  const xLines = [0, 0.5, 1];
  const yLines = [0, 0.5, 1];

  for (const other of others) {
    xLines.push(other.x, other.x + other.w / 2, other.x + other.w);
    yLines.push(other.y, other.y + other.h / 2, other.y + other.h);
  }

  const guides: Guide[] = [];

  const x = snapAxis(moving.x, moving.w, xLines, tolX, (at) =>
    guides.push({ axis: "x", at }),
  );
  const y = snapAxis(moving.y, moving.h, yLines, tolY, (at) =>
    guides.push({ axis: "y", at }),
  );

  return { x, y, guides };
}

/**
 * Tries the element's leading edge, centre and trailing edge against every
 * candidate line and takes the closest match.
 */
function snapAxis(
  start: number,
  size: number,
  lines: number[],
  tolerance: number,
  onSnap: (at: number) => void,
): number {
  const anchors = [
    { offset: 0, value: start },
    { offset: size / 2, value: start + size / 2 },
    { offset: size, value: start + size },
  ];

  let best: { start: number; line: number; distance: number } | null = null;

  for (const anchor of anchors) {
    for (const line of lines) {
      const distance = Math.abs(anchor.value - line);
      if (distance <= tolerance && (!best || distance < best.distance)) {
        best = { start: line - anchor.offset, line, distance };
      }
    }
  }

  if (!best) return start;
  onSnap(best.line);
  return best.start;
}

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
