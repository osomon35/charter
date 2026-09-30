import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A native <select>. No Radix dependency — the browser's own picker is better
 * on mobile than anything reimplemented, and this app has no need for
 * multi-select or option grouping.
 */
export const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "flex h-9 w-full appearance-none rounded-md border border-input bg-surface px-3 text-sm",
        "bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-9",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23888' stroke-width='1.5'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E\")",
      }}
      {...props}
    />
  ),
);
Select.displayName = "Select";
