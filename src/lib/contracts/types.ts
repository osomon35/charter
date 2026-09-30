export const CONTRACT_STATUSES = [
  "draft",
  "sent",
  "partially_signed",
  "completed",
  "declined",
  "expired",
] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const STATUS_LABELS: Record<ContractStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_signed: "Partially signed",
  completed: "Completed",
  declined: "Declined",
  expired: "Expired",
};

/** Tailwind classes per status. Muted by design — no status shouts. */
export const STATUS_CLASSES: Record<ContractStatus, string> = {
  draft: "border-border bg-muted text-muted-foreground",
  sent: "border-primary/25 bg-primary-subtle text-foreground",
  partially_signed: "border-warning/30 bg-surface-muted text-foreground",
  completed: "border-success/30 bg-surface-muted text-foreground",
  declined: "border-destructive/30 bg-destructive-subtle text-foreground",
  expired: "border-border-strong bg-muted text-muted-foreground",
};

/**
 * Tag colours are a fixed set, matched by a CHECK constraint on the tags table.
 * A free-form colour would mean validating arbitrary CSS on the way in and
 * having no way to keep the palette coherent.
 */
export const TAG_COLORS = [
  "slate",
  "blue",
  "green",
  "amber",
  "red",
  "violet",
  "teal",
  "pink",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

/** Border/background/text per tag colour, in both themes. */
export const TAG_COLOR_CLASSES: Record<TagColor, string> = {
  slate: "border-border-strong bg-muted text-muted-foreground",
  blue: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  red: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  teal: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  pink: "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-300",
};

/** Swatch colour for pickers, where a background alone has to read. */
export const TAG_SWATCHES: Record<TagColor, string> = {
  slate: "#64748b",
  blue: "#3b82f6",
  green: "#10b981",
  amber: "#f59e0b",
  red: "#ef4444",
  violet: "#8b5cf6",
  teal: "#14b8a6",
  pink: "#ec4899",
};

export const STORAGE_BUCKET = "contracts";

/** Hard cap, mirrored on the bucket in the migration. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const suffix = units[unit] ?? "GB";
  return `${value.toFixed(value < 10 ? 1 : 0)} ${suffix}`;
}

/** "Master Services Agreement.pdf" -> "Master Services Agreement" */
export function titleFromFileName(fileName: string): string {
  const stem = fileName.replace(/\.pdf$/i, "").trim();
  const cleaned = stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "Untitled contract").slice(0, 300);
}
