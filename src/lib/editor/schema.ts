import { z } from "zod";
import { FONT_FAMILIES, TEXT_ALIGNMENTS } from "@/lib/editor/types";

/**
 * Validation for anything arriving from the browser.
 *
 * The overlay is a blob of client-authored JSON that later gets drawn into a
 * PDF, so it is parsed strictly rather than trusted: coordinates clamped to the
 * page, font size bounded, colours matched against a hex pattern. Without this
 * a hand-crafted request could ask pdf-lib to draw at absurd coordinates or
 * with a colour string it will throw on.
 */

const normalized = z.number().min(-0.5).max(1.5);
const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);

const base = {
  id: z.string().min(1).max(64),
  page: z.number().int().min(1).max(2000),
  x: normalized,
  y: normalized,
  w: z.number().min(0.001).max(2),
  h: z.number().min(0.001).max(2),
  locked: z.boolean().optional(),
};

export const elementSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("text"),
    text: z.string().max(5000),
    fontFamily: z.enum(FONT_FAMILIES),
    fontSize: z.number().min(4).max(200),
    bold: z.boolean(),
    italic: z.boolean(),
    color: hexColor,
    align: z.enum(TEXT_ALIGNMENTS),
  }),
  z.object({
    ...base,
    type: z.literal("whiteout"),
    fill: hexColor,
  }),
  z.object({
    ...base,
    type: z.literal("check"),
    color: hexColor,
  }),
  z.object({
    ...base,
    type: z.literal("image"),
    // Must stay inside this contract's own prefix; checked again against the
    // contract id in the action, since a path is a capability here.
    assetPath: z.string().min(1).max(400),
    naturalWidth: z.number().int().min(1).max(20000),
    naturalHeight: z.number().int().min(1).max(20000),
  }),
]);

export const overlaySchema = z.array(elementSchema).max(500);
