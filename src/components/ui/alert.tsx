import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "info" | "error" | "success";

const tones: Record<Tone, string> = {
  info: "border-border bg-surface-muted text-foreground",
  error: "border-destructive/30 bg-destructive-subtle text-foreground",
  success: "border-success/30 bg-surface-muted text-foreground",
};

export function Alert({
  tone = "info",
  className,
  ...props
}: React.ComponentProps<"div"> & { tone?: Tone }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-md border px-3 py-2.5 text-sm", tones[tone], className)}
      {...props}
    />
  );
}
