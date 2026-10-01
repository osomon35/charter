export const MEMBER_ROLES = ["admin", "sender", "signer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const ROLE_LABELS: Record<MemberRole, string> = {
  admin: "Admin",
  sender: "Can send",
  signer: "Signs only",
};

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  admin: "Everything, including inviting and removing members.",
  sender: "Upload, edit and send contracts for signature. Cannot manage members.",
  signer: "No access to contracts. Can keep a saved signature and sign documents sent to them.",
};

export const ROLE_CLASSES: Record<MemberRole, string> = {
  admin: "border-primary/30 bg-primary-subtle text-foreground",
  sender: "border-border-strong bg-surface-muted text-foreground",
  signer: "border-border bg-muted text-muted-foreground",
};

export type Member = {
  email: string;
  name: string | null;
  role: MemberRole;
  blockedAt: string | null;
  invitedAt: string | null;
  invitedBy: string | null;
  createdAt: string;
  /** Whether an auth account exists, and when they last used it. */
  hasAccount: boolean;
  lastSignInAt: string | null;
};
