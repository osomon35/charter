"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Mail, RotateCcw, Trash2 } from "lucide-react";
import {
  removeMember,
  resendInvite,
  setMemberBlocked,
  setMemberRole,
} from "@/lib/members/actions";
import {
  MEMBER_ROLES,
  ROLE_CLASSES,
  ROLE_LABELS,
  type Member,
  type MemberRole,
} from "@/lib/members/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export function MemberList({
  members,
  currentEmail,
}: {
  members: Member[];
  currentEmail: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  function run(work: () => Promise<{ ok: boolean; error?: string; warning?: string }>) {
    startTransition(async () => {
      const result = await work();
      setMessage(result.ok ? (result.warning ?? null) : (result.error ?? "That did not work."));
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {message ? <Alert tone="error">{message}</Alert> : null}

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {members.map((member) => {
          const isSelf = member.email === currentEmail.toLowerCase();
          const blocked = Boolean(member.blockedAt);

          return (
            <li
              key={member.email}
              className={cn(
                "flex flex-wrap items-center gap-3 bg-surface px-4 py-3",
                blocked ? "opacity-60" : "",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span className="truncate">{member.name ?? member.email}</span>
                  {isSelf ? (
                    <Badge className="border-border bg-muted text-muted-foreground">You</Badge>
                  ) : null}
                  {blocked ? (
                    <Badge className="border-destructive/40 bg-destructive-subtle text-destructive">
                      Blocked
                    </Badge>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {!member.hasAccount
                    ? "Invited, has not signed in yet"
                    : member.lastSignInAt
                      ? `Last signed in ${new Date(member.lastSignInAt).toLocaleDateString()}`
                      : "Account created, never signed in"}
                </p>
              </div>

              {/* Role is a dropdown rather than a dialog: it is the thing changed
                  most often, and a confirmation step for a reversible change is
                  friction without benefit. */}
              {isSelf ? (
                <Badge className={ROLE_CLASSES[member.role]}>{ROLE_LABELS[member.role]}</Badge>
              ) : (
                <Select
                  aria-label={`Role for ${member.email}`}
                  value={member.role}
                  disabled={pending || blocked}
                  onChange={(event) =>
                    run(() =>
                      setMemberRole({
                        email: member.email,
                        role: event.target.value as MemberRole,
                      }),
                    )
                  }
                  className="w-auto min-w-32"
                >
                  {MEMBER_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </Select>
              )}

              <div className="flex items-center gap-1">
                {!blocked ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    title="Send them a fresh sign-in link"
                    onClick={() => run(() => resendInvite(member.email))}
                  >
                    <Mail aria-hidden />
                    <span className="hidden sm:inline">Resend</span>
                  </Button>
                ) : null}

                {!isSelf ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    title={blocked ? "Restore access" : "Revoke access immediately"}
                    onClick={() =>
                      run(() => setMemberBlocked({ email: member.email, blocked: !blocked }))
                    }
                  >
                    {blocked ? <RotateCcw aria-hidden /> : <Ban aria-hidden />}
                    <span className="hidden sm:inline">{blocked ? "Unblock" : "Block"}</span>
                  </Button>
                ) : null}

                {!isSelf ? (
                  confirmRemove === member.email ? (
                    <span className="flex items-center gap-1">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          setConfirmRemove(null);
                          run(() => removeMember(member.email));
                        }}
                      >
                        Remove
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmRemove(null)}
                      >
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      title="Remove them and delete their account"
                      onClick={() => setConfirmRemove(member.email)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Blocking ends access on their next request and keeps them visible in the audit trail,
        which is usually what you want. Removing deletes their account as well, and is for an
        address added by mistake.
      </p>
    </div>
  );
}
