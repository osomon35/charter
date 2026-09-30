export const FIELD_TYPES = [
  "signature",
  "initials",
  "date_signed",
  "text",
  "checkbox",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_LABELS: Record<FieldType, string> = {
  signature: "Signature",
  initials: "Initials",
  date_signed: "Date signed",
  text: "Text",
  checkbox: "Checkbox",
};

/** Starting size for a placed field, as a fraction of the page. */
export const FIELD_SIZES: Record<FieldType, { w: number; h: number }> = {
  signature: { w: 0.26, h: 0.055 },
  initials: { w: 0.09, h: 0.045 },
  date_signed: { w: 0.18, h: 0.028 },
  text: { w: 0.24, h: 0.028 },
  checkbox: { w: 0.026, h: 0.018 },
};

export const ROUTINGS = ["parallel", "sequential"] as const;
export type Routing = (typeof ROUTINGS)[number];

export const RECIPIENT_STATUSES = [
  "pending",
  "sent",
  "viewed",
  "signed",
  "declined",
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export const ENVELOPE_STATUSES = [
  "draft",
  "sent",
  "partially_signed",
  "completed",
  "declined",
  "expired",
  "voided",
] as const;
export type EnvelopeStatus = (typeof ENVELOPE_STATUSES)[number];

export const RECIPIENT_STATUS_LABELS: Record<RecipientStatus, string> = {
  pending: "Not yet notified",
  sent: "Sent",
  viewed: "Viewed",
  signed: "Signed",
  declined: "Declined",
};

/** Badge classes per recipient status. Signed reads as done at a glance. */
export const RECIPIENT_STATUS_CLASSES: Record<RecipientStatus, string> = {
  pending: "border-border bg-muted text-muted-foreground",
  sent: "border-border-strong bg-surface-muted text-foreground",
  viewed: "border-primary/25 bg-primary-subtle text-foreground",
  signed: "border-success/40 bg-success/10 text-success",
  declined: "border-destructive/40 bg-destructive-subtle text-destructive",
};

/** Distinct colours so each recipient's fields are tellable apart at a glance. */
export const RECIPIENT_COLORS = [
  "#3b5b92",
  "#8a5a2b",
  "#2f6b4f",
  "#7a3b62",
  "#2b6070",
  "#7a4a2b",
] as const;

export function recipientColor(index: number): string {
  return RECIPIENT_COLORS[index % RECIPIENT_COLORS.length] ?? "#3b5b92";
}

export type FieldDraft = {
  id: string;
  recipientId: string;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
  label?: string;
};

export type RecipientDraft = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type SignerField = {
  id: string;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
  label: string | null;
  value_text: string | null;
  value_bool: boolean | null;
  value_asset_path: string | null;
  filled_at: string | null;
};

/** What the audit trail calls each thing that can happen. */
export const AUDIT_KINDS = {
  uploaded: "Document uploaded",
  flattened: "Version created",
  sent: "Sent for signature",
  reminded: "Reminder sent",
  viewed: "Document viewed",
  consented: "Consented to sign electronically",
  signed: "Signed",
  declined: "Declined to sign",
  completed: "Completed",
  expired: "Expired",
  voided: "Voided",
} as const;

export function auditLabel(kind: string): string {
  return (AUDIT_KINDS as Record<string, string>)[kind] ?? kind;
}
