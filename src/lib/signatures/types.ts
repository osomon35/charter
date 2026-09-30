export const SIGNATURE_KINDS = ["signature", "initials"] as const;
export type SignatureKind = (typeof SIGNATURE_KINDS)[number];

export const SIGNATURE_SOURCES = ["drawn", "typed", "uploaded"] as const;
export type SignatureSource = (typeof SIGNATURE_SOURCES)[number];

export const KIND_LABELS: Record<SignatureKind, string> = {
  signature: "Signature",
  initials: "Initials",
};

export type SignatureRecord = {
  id: string;
  kind: SignatureKind;
  source: SignatureSource;
  width: number;
  height: number;
  is_default: boolean;
  created_at: string;
};

/** Generous for a trimmed PNG; anything larger is a sign something is wrong. */
export const MAX_SIGNATURE_BYTES = 1024 * 1024;
