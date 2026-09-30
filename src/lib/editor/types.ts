/**
 * Overlay elements.
 *
 * Geometry is normalized: x, y, w and h are fractions of the page's width and
 * height, with the origin at the page's top-left. That is the one decision the
 * whole editor rests on — the canvas renders at whatever scale the viewport
 * suggests, and pdf-lib later writes at the page's true point size, and neither
 * needs to know anything about the other.
 *
 * Font size is the exception: it is in PDF points, because that is what pdf-lib
 * takes and what makes text look right next to the document's own type. The
 * canvas multiplies it by the current render scale.
 */

export const FONT_FAMILIES = ["helvetica", "times", "courier"] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const FONT_FAMILY_LABELS: Record<FontFamily, string> = {
  helvetica: "Helvetica",
  times: "Times",
  courier: "Courier",
};

/** CSS stacks that approximate the PDF standard fonts on screen. */
export const FONT_FAMILY_CSS: Record<FontFamily, string> = {
  helvetica: "Helvetica, Arial, sans-serif",
  times: "'Times New Roman', Times, serif",
  courier: "'Courier New', Courier, monospace",
};

export const TEXT_ALIGNMENTS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNMENTS)[number];

export type ElementBase = {
  id: string;
  /** 1-based page number. */
  page: number;
  /** All four are fractions of page size, origin top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Locked elements cannot be dragged, resized, retyped or deleted — a guard
   * against nudging something already positioned, not a permission. Always
   * reversible from the inspector.
   */
  locked?: boolean;
};

export type TextElement = ElementBase & {
  type: "text";
  text: string;
  fontFamily: FontFamily;
  /** PDF points. */
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
  align: TextAlign;
};

/**
 * An opaque rectangle. Cover the original text with one of these and type over
 * it — the point of the overlay approach. Never claims to remove the text
 * underneath from the file, which is why it is not called "redaction".
 */
export type WhiteoutElement = ElementBase & {
  type: "whiteout";
  fill: string;
};

export type CheckElement = ElementBase & {
  type: "check";
  color: string;
};

export type ImageElement = ElementBase & {
  type: "image";
  /** Path inside the private contracts bucket. */
  assetPath: string;
  /** Intrinsic pixel size, kept so the aspect ratio can be restored. */
  naturalWidth: number;
  naturalHeight: number;
};

export type OverlayElement =
  | TextElement
  | WhiteoutElement
  | CheckElement
  | ImageElement;

export type ElementType = OverlayElement["type"];

export const DEFAULT_TEXT_COLOR = "#111827";
export const DEFAULT_WHITEOUT_FILL = "#ffffff";

export function isTextLike(element: OverlayElement): element is TextElement {
  return element.type === "text";
}

/** Sensible starting geometry, in normalized units, for a newly placed element. */
export function newElement(
  type: ElementType,
  page: number,
  at: { x: number; y: number },
  extras?: Partial<ImageElement>,
): OverlayElement {
  const id = crypto.randomUUID();
  const base = { id, page, x: at.x, y: at.y, locked: false };

  switch (type) {
    case "text":
      return {
        ...base,
        type: "text",
        w: 0.32,
        h: 0.035,
        text: "Text",
        fontFamily: "helvetica",
        fontSize: 12,
        bold: false,
        italic: false,
        color: DEFAULT_TEXT_COLOR,
        align: "left",
      };
    case "whiteout":
      return { ...base, type: "whiteout", w: 0.3, h: 0.03, fill: DEFAULT_WHITEOUT_FILL };
    case "check":
      return { ...base, type: "check", w: 0.028, h: 0.02, color: DEFAULT_TEXT_COLOR };
    case "image": {
      const naturalWidth = extras?.naturalWidth ?? 300;
      const naturalHeight = extras?.naturalHeight ?? 120;
      const w = 0.25;
      return {
        ...base,
        type: "image",
        w,
        // Keep the aspect ratio. Pages are taller than wide, so the height
        // fraction has to be scaled by the page's own ratio; A4 is close enough
        // for an initial placement and the user can resize.
        h: (w * (naturalHeight / naturalWidth)) / 1.414,
        assetPath: extras?.assetPath ?? "",
        naturalWidth,
        naturalHeight,
      };
    }
  }
}

/** Today's date, formatted the way a signed document usually shows it. */
export function todayLabel(): string {
  return new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
