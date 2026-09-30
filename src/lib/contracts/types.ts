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
