"use client";

/**
 * Crops a canvas to its non-transparent content, then exports a PNG.
 *
 * A signature drawn with a finger or trackpad almost never fills the pad, so
 * without this the saved image carries a wide transparent margin. That margin
 * then becomes part of the element's box on the page, and the visible ink ends
 * up floating somewhere in the middle of a box the user carefully positioned.
 */
export type TrimmedImage = { blob: Blob; width: number; height: number } | null;

const PADDING = 8;

export async function trimToPng(source: HTMLCanvasElement): Promise<TrimmedImage> {
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  const { width, height } = source;
  if (width === 0 || height === 0) return null;

  const { data } = context.getImageData(0, 0, width, height);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  // Alpha only: the ink colour is irrelevant, and anything drawn at all counts.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3] ?? 0;
      if (alpha > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Nothing drawn.
  if (maxX < 0 || maxY < 0) return null;

  const left = Math.max(0, minX - PADDING);
  const top = Math.max(0, minY - PADDING);
  const cropWidth = Math.min(width, maxX + PADDING + 1) - left;
  const cropHeight = Math.min(height, maxY + PADDING + 1) - top;

  const output = document.createElement("canvas");
  output.width = cropWidth;
  output.height = cropHeight;

  const outputContext = output.getContext("2d");
  if (!outputContext) return null;

  outputContext.drawImage(
    source,
    left,
    top,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight,
  );

  const blob = await new Promise<Blob | null>((resolve) => {
    output.toBlob((result) => resolve(result), "image/png");
  });

  return blob ? { blob, width: cropWidth, height: cropHeight } : null;
}

/**
 * Renders typed text in the handwriting face to a transparent canvas.
 *
 * The family is read from a probe element rather than hard-coded, because
 * next/font rewrites the family name at build time — and the font has to be
 * loaded before canvas will use it, hence the fonts.ready wait.
 */
export async function renderTypedSignature(
  text: string,
  fontVariableClass: string,
): Promise<TrimmedImage> {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  const probe = document.createElement("span");
  probe.className = fontVariableClass;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.fontFamily = "var(--font-caveat), cursive";
  probe.textContent = trimmed;
  document.body.appendChild(probe);
  const family = getComputedStyle(probe).fontFamily;
  document.body.removeChild(probe);

  try {
    await document.fonts.ready;
  } catch {
    // Proceed with whatever is available; a fallback face still reads as a name.
  }

  const fontSize = 96;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.font = `${fontSize}px ${family}`;
  const metrics = context.measureText(trimmed);

  canvas.width = Math.ceil(metrics.width + fontSize);
  canvas.height = Math.ceil(fontSize * 2);

  const draw = canvas.getContext("2d");
  if (!draw) return null;

  draw.font = `${fontSize}px ${family}`;
  draw.fillStyle = "#111827";
  draw.textBaseline = "middle";
  draw.fillText(trimmed, fontSize / 2, canvas.height / 2);

  return await trimToPng(canvas);
}
