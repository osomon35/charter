"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal popover: a trigger and a panel anchored under it.
 *
 * Hand-rolled rather than Radix because the only behaviours needed are closing
 * on an outside click and on Escape, and every dependency here has to resolve at
 * build time on a machine where nothing can be run locally.
 */
export function Popover({
  trigger,
  children,
  align = "start",
  className,
}: {
  trigger: (open: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        // Stops the row's drag from starting when the trigger is pressed.
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
        className="block w-full text-left"
      >
        {trigger(open)}
      </button>

      {open ? (
        <div
          className={cn(
            "absolute top-full z-40 mt-1 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-md",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
