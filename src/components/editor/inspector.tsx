"use client";

import { Lock, Unlock } from "lucide-react";
import {
  FONT_FAMILIES,
  FONT_FAMILY_LABELS,
  TEXT_ALIGNMENTS,
  type OverlayElement,
} from "@/lib/editor/types";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const SWATCHES = ["#111827", "#1d4ed8", "#b91c1c", "#047857", "#ffffff"] as const;

/** Properties panel for the selected element. Empty state when nothing is selected. */
export function Inspector({
  element,
  lockedCount,
  onChange,
  onDelete,
  onDuplicate,
  onUnlockAll,
}: {
  element: OverlayElement | null;
  lockedCount: number;
  onChange: (patch: Partial<OverlayElement>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onUnlockAll: () => void;
}) {
  if (!element) {
    return (
      <div className="space-y-4 px-4 py-6">
        <p className="text-sm text-muted-foreground">
          Select an element to change it, or pick a tool above and click the page to place
          one.
        </p>
        {lockedCount > 0 ? (
          <Button variant="outline" size="sm" className="w-full" onClick={onUnlockAll}>
            <Unlock aria-hidden />
            Unlock all ({lockedCount})
          </Button>
        ) : null}
      </div>
    );
  }

  const locked = element.locked === true;

  return (
    <div className="space-y-5 p-4">
      <Button
        variant={locked ? "default" : "outline"}
        size="sm"
        className="w-full"
        onClick={() => onChange({ locked: !locked })}
      >
        {locked ? <Lock aria-hidden /> : <Unlock aria-hidden />}
        {locked ? "Locked — click to unlock" : "Lock position"}
      </Button>
      {element.type === "text" && !locked ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="font">Font</Label>
            <Select
              id="font"
              value={element.fontFamily}
              onChange={(event) =>
                onChange({ fontFamily: event.target.value as (typeof FONT_FAMILIES)[number] })
              }
            >
              {FONT_FAMILIES.map((family) => (
                <option key={family} value={family}>
                  {FONT_FAMILY_LABELS[family]}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="size">Size (pt)</Label>
              <Input
                id="size"
                type="number"
                min={4}
                max={200}
                value={element.fontSize}
                onChange={(event) =>
                  onChange({ fontSize: clampNumber(event.target.value, 4, 200, 12) })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="align">Align</Label>
              <Select
                id="align"
                value={element.align}
                onChange={(event) =>
                  onChange({ align: event.target.value as (typeof TEXT_ALIGNMENTS)[number] })
                }
              >
                {TEXT_ALIGNMENTS.map((align) => (
                  <option key={align} value={align}>
                    {align[0]?.toUpperCase()}
                    {align.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant={element.bold ? "default" : "outline"}
              size="sm"
              className="flex-1 font-bold"
              onClick={() => onChange({ bold: !element.bold })}
            >
              B
            </Button>
            <Button
              variant={element.italic ? "default" : "outline"}
              size="sm"
              className="flex-1 italic"
              onClick={() => onChange({ italic: !element.italic })}
            >
              I
            </Button>
          </div>
        </>
      ) : null}

      {element.type !== "image" && !locked ? (
        <div className="space-y-2">
          <Label>{element.type === "whiteout" ? "Fill" : "Colour"}</Label>
          <div className="flex items-center gap-2">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={swatch}
                onClick={() =>
                  onChange(
                    element.type === "whiteout" ? { fill: swatch } : { color: swatch },
                  )
                }
                style={{ backgroundColor: swatch }}
                className="size-6 rounded border border-border-strong"
              />
            ))}
            <input
              type="color"
              aria-label="Custom colour"
              value={element.type === "whiteout" ? element.fill : element.color}
              onChange={(event) =>
                onChange(
                  element.type === "whiteout"
                    ? { fill: event.target.value }
                    : { color: event.target.value },
                )
              }
              className="size-6 cursor-pointer rounded border border-border-strong bg-transparent p-0"
            />
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
        <span>x {(element.x * 100).toFixed(1)}%</span>
        <span>y {(element.y * 100).toFixed(1)}%</span>
        <span>w {(element.w * 100).toFixed(1)}%</span>
        <span>h {(element.h * 100).toFixed(1)}%</span>
      </div>

      <div className="flex gap-2 border-t border-border pt-4">
        <Button variant="outline" size="sm" className="flex-1" onClick={onDuplicate}>
          Duplicate
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={locked}
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

function clampNumber(raw: string, min: number, max: number, fallback: number): number {
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
