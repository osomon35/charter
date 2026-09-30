import "server-only";

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type {
  FontFamily,
  OverlayElement,
  TextElement,
} from "@/lib/editor/types";

/**
 * Bakes overlay elements into a new PDF.
 *
 * Coordinate systems differ and this is the only place that matters: elements
 * are normalized with the origin top-left, PDF user space has its origin at the
 * bottom-left. Every element's y is converted once, here.
 *
 * The input bytes are never mutated — pdf-lib writes a new document, which is
 * what lets version 1 keep its original hash forever.
 */

/** pdf-lib re-exports its colour type inconsistently across versions. */
type RGB = ReturnType<typeof rgb>;

type FontSet = Record<string, PDFFont>;

const FONT_KEYS: Record<FontFamily, Record<string, StandardFonts>> = {
  helvetica: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    bolditalic: StandardFonts.HelveticaBoldOblique,
  },
  times: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
    italic: StandardFonts.TimesRomanItalic,
    bolditalic: StandardFonts.TimesRomanBoldItalic,
  },
  courier: {
    regular: StandardFonts.Courier,
    bold: StandardFonts.CourierBold,
    italic: StandardFonts.CourierOblique,
    bolditalic: StandardFonts.CourierBoldOblique,
  },
};

export type ImageAsset = { path: string; bytes: Uint8Array; contentType: string };

export async function flattenOverlay(
  baseBytes: Uint8Array,
  elements: OverlayElement[],
  assets: ImageAsset[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(baseBytes, { ignoreEncryption: true });
  const pages = doc.getPages();

  // Fonts and images are embedded once and reused; embedding per element would
  // duplicate the same font programme a dozen times in the output.
  const fonts: FontSet = {};
  const getFont = async (family: FontFamily, bold: boolean, italic: boolean) => {
    const weight = bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "regular";
    const key = `${family}:${weight}`;
    const standard = FONT_KEYS[family][weight] ?? StandardFonts.Helvetica;
    fonts[key] ??= await doc.embedFont(standard);
    return fonts[key];
  };

  const images = new Map<string, Awaited<ReturnType<typeof doc.embedPng>>>();
  for (const asset of assets) {
    try {
      images.set(
        asset.path,
        asset.contentType === "image/jpeg"
          ? await doc.embedJpg(asset.bytes)
          : await doc.embedPng(asset.bytes),
      );
    } catch (err) {
      console.error("flatten_image_embed_failed", { path: asset.path, err });
    }
  }

  // Stable order so overlapping elements stack the same way every time.
  const ordered = [...elements].sort((a, b) => a.page - b.page);

  for (const element of ordered) {
    const page = pages[element.page - 1];
    if (!page) continue;

    const { width, height } = page.getSize();
    const box = {
      x: element.x * width,
      // Normalized y measures down from the top; PDF measures up from the
      // bottom, and the rectangle is anchored at its lower-left corner.
      y: height - element.y * height - element.h * height,
      w: element.w * width,
      h: element.h * height,
    };

    switch (element.type) {
      case "whiteout":
        page.drawRectangle({
          x: box.x,
          y: box.y,
          width: box.w,
          height: box.h,
          color: parseColor(element.fill),
        });
        break;

      case "text":
        await drawText(page, element, box, getFont);
        break;

      case "check":
        drawCheck(page, box, parseColor(element.color));
        break;

      case "image": {
        const image = images.get(element.assetPath);
        if (!image) break;
        page.drawImage(image, {
          x: box.x,
          y: box.y,
          width: box.w,
          height: box.h,
        });
        break;
      }
    }
  }

  return await doc.save();
}

async function drawText(
  page: PDFPage,
  element: TextElement,
  box: { x: number; y: number; w: number; h: number },
  getFont: (family: FontFamily, bold: boolean, italic: boolean) => Promise<PDFFont>,
): Promise<void> {
  const font = await getFont(element.fontFamily, element.bold, element.italic);
  const size = element.fontSize;
  const lineHeight = size * 1.2;

  const lines = wrapText(element.text, font, size, box.w);

  lines.forEach((line, index) => {
    // Baseline of the first line sits one line-height below the box top, which
    // is what makes on-screen and flattened text land in the same place.
    const y = box.y + box.h - lineHeight * (index + 1) + (lineHeight - size) / 2;
    const lineWidth = font.widthOfTextAtSize(line, size);

    let x = box.x;
    if (element.align === "center") x = box.x + (box.w - lineWidth) / 2;
    if (element.align === "right") x = box.x + box.w - lineWidth;

    page.drawText(line, { x, y, size, font, color: parseColor(element.color) });
  });
}

/**
 * Greedy word wrap measured with the real embedded font, so what the flattened
 * PDF shows matches what the editor showed.
 */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];

  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      out.push("");
      continue;
    }

    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (safeWidth(font, candidate, size) <= maxWidth || line === "") {
        line = candidate;
      } else {
        out.push(line);
        line = word;
      }
    }
    if (line !== "") out.push(line);
  }

  return out.length > 0 ? out : [""];
}

/**
 * The standard PDF fonts use WinAnsi encoding and pdf-lib throws on characters
 * outside it. Measuring defensively keeps an em dash or a curly quote from
 * taking down the whole flatten.
 */
function safeWidth(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.55;
  }
}

function drawCheck(page: PDFPage, box: { x: number; y: number; w: number; h: number }, color: RGB) {
  // A tick drawn as two lines rather than a glyph, so it needs no font and
  // scales cleanly to whatever box the user dragged.
  const thickness = Math.max(1, Math.min(box.w, box.h) * 0.16);
  page.drawLine({
    start: { x: box.x + box.w * 0.1, y: box.y + box.h * 0.5 },
    end: { x: box.x + box.w * 0.4, y: box.y + box.h * 0.18 },
    thickness,
    color,
  });
  page.drawLine({
    start: { x: box.x + box.w * 0.4, y: box.y + box.h * 0.18 },
    end: { x: box.x + box.w * 0.92, y: box.y + box.h * 0.85 },
    thickness,
    color,
  });
}

/** #rrggbb (or #rgb) to pdf-lib's 0–1 RGB. Falls back to black. */
export function parseColor(input: string): RGB {
  const hex = input.trim().replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) return rgb(0, 0, 0);

  return rgb(
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  );
}
