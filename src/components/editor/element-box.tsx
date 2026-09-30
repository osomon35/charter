"use client";

import { useRef } from "react";
import { Lock } from "lucide-react";
import {
  FONT_FAMILY_CSS,
  type OverlayElement,
} from "@/lib/editor/types";
import { cn } from "@/lib/utils";

export type DragKind = "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLES: { kind: DragKind; className: string; cursor: string }[] = [
  { kind: "nw", className: "-left-1 -top-1", cursor: "nwse-resize" },
  { kind: "n", className: "left-1/2 -top-1 -translate-x-1/2", cursor: "ns-resize" },
  { kind: "ne", className: "-right-1 -top-1", cursor: "nesw-resize" },
  { kind: "e", className: "-right-1 top-1/2 -translate-y-1/2", cursor: "ew-resize" },
  { kind: "se", className: "-right-1 -bottom-1", cursor: "nwse-resize" },
  { kind: "s", className: "left-1/2 -bottom-1 -translate-x-1/2", cursor: "ns-resize" },
  { kind: "sw", className: "-left-1 -bottom-1", cursor: "nesw-resize" },
  { kind: "w", className: "-left-1 top-1/2 -translate-y-1/2", cursor: "ew-resize" },
];

/**
 * One placed element, positioned in percentages of the page box.
 *
 * Percentages rather than pixels: the parent is exactly the rendered page, so
 * the same normalized numbers that go into the database lay the element out at
 * any zoom with no conversion and no drift.
 */
export function ElementBox({
  element,
  selected,
  scale,
  imageUrl,
  onPointerDownOn,
  onSelect,
  onTextChange,
}: {
  element: OverlayElement;
  selected: boolean;
  /** Rendered page width in CSS px divided by page width in points. */
  scale: number;
  imageUrl?: string;
  onPointerDownOn: (event: React.PointerEvent, kind: DragKind) => void;
  onSelect: () => void;
  onTextChange?: (text: string) => void;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const locked = element.locked === true;

  return (
    <div
      role="presentation"
      onPointerDown={(event) => {
        // Still selectable when locked — that is how it gets unlocked.
        onSelect();
        if (locked) return;
        // Typing inside a selected text box must not start a drag.
        const target = event.target as HTMLElement;
        if (target.tagName === "TEXTAREA") return;
        onPointerDownOn(event, "move");
      }}
      style={{
        left: `${element.x * 100}%`,
        top: `${element.y * 100}%`,
        width: `${element.w * 100}%`,
        height: `${element.h * 100}%`,
      }}
      className={cn(
        "absolute select-none",
        locked ? "cursor-default" : "cursor-move",
        selected
          ? locked
            ? "outline outline-2 outline-muted-foreground"
            : "outline outline-2 outline-primary"
          : "outline outline-1 outline-primary/25",
      )}
    >
      {element.type === "whiteout" ? (
        <div className="h-full w-full" style={{ backgroundColor: element.fill }} />
      ) : null}

      {element.type === "check" ? (
        <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
          <path
            d="M3 12.5 9 19 21 5"
            fill="none"
            stroke={element.color}
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}

      {element.type === "image" ? (
        imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="h-full w-full object-fill" draggable={false} />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted text-[10px] text-muted-foreground">
            Image
          </div>
        )
      ) : null}

      {element.type === "text" ? (
        <textarea
          ref={textRef}
          value={element.text}
          onChange={(event) => onTextChange?.(event.target.value)}
          readOnly={locked}
          spellCheck={false}
          className="h-full w-full resize-none border-0 bg-transparent p-0 outline-none"
          style={{
            fontFamily: FONT_FAMILY_CSS[element.fontFamily],
            // fontSize is stored in PDF points; multiplying by the render scale
            // is what keeps screen and flattened output in agreement.
            fontSize: `${element.fontSize * scale}px`,
            lineHeight: 1.2,
            fontWeight: element.bold ? 700 : 400,
            fontStyle: element.italic ? "italic" : "normal",
            color: element.color,
            textAlign: element.align,
            cursor: locked ? "default" : selected ? "text" : "move",
          }}
        />
      ) : null}

      {selected && locked ? (
        <span
          aria-hidden
          title="Locked"
          className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full border border-border bg-surface"
        >
          <Lock className="size-2.5 text-muted-foreground" />
        </span>
      ) : null}

      {selected && !locked
        ? HANDLES.map((handle) => (
            <span
              key={handle.kind}
              onPointerDown={(event) => {
                event.stopPropagation();
                onPointerDownOn(event, handle.kind);
              }}
              style={{ cursor: handle.cursor }}
              className={cn(
                "absolute size-2 rounded-sm border border-primary bg-surface",
                handle.className,
              )}
            />
          ))
        : null}
    </div>
  );
}
