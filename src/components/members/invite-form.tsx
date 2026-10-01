"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, UserPlus } from "lucide-react";
import { inviteMember } from "@/lib/members/actions";
import {
  MEMBER_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type MemberRole,
} from "@/lib/members/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

export function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<MemberRole>("sender");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setWarning(null);
    setInviteUrl(null);

    startTransition(async () => {
      const result = await inviteMember({ email, name, role });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEmail("");
      setName("");
      setWarning(result.warning ?? null);
      setInviteUrl(result.inviteUrl ?? null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {warning ? <Alert tone="error">{warning}</Alert> : null}

      {inviteUrl ? (
        <Alert tone="success">
          <p className="font-medium">Invited.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The link below was emailed to them. It is also shown here so an invite that
            does not arrive is never a dead end — it signs them in, so treat it as a
            password.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px]">
              {inviteUrl}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(inviteUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  // Clipboard can be blocked; the text is selectable.
                }
              }}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="them@example.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-name">Name (optional)</Label>
          <Input
            id="invite-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ana Ferreira"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <Select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as MemberRole)}
          >
            {MEMBER_ROLES.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABELS[option]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>

      <Button onClick={submit} disabled={pending || !email.includes("@")}>
        <UserPlus aria-hidden />
        {pending ? "Inviting…" : "Send invite"}
      </Button>
    </div>
  );
}
