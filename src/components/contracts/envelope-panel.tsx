"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Bell, Check, Clock, Eye, X } from "lucide-react";
import { nudgeRecipient, voidEnvelope } from "@/lib/envelopes/send-actions";
import {
  RECIPIENT_STATUS_LABELS,
  recipientColor,
  type RecipientStatus,
} from "@/lib/envelopes/types";
import type { EnvelopeView } from "@/lib/envelopes/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

const STATUS_ICONS: Record<RecipientStatus, typeof Check> = {
  pending: Clock,
  sent: Bell,
  viewed: Eye,
  signed: Check,
  declined: X,
};

export function EnvelopePanel({ envelope }: { envelope: EnvelopeView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const active = envelope.status === "sent" || envelope.status === "partially_signed";

  return (
    <div className="space-y-3">
      {message ? <Alert tone="error">{message}</Alert> : null}

      {revealed ? (
        <Alert>
          <p className="font-medium">New signing link</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Shown because REVEAL_SIGNING_LINKS is enabled. It replaces the previous link.
          </p>
          <code className="mt-2 block truncate rounded bg-muted px-2 py-1 font-mono text-[11px]">
            {revealed}
          </code>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge className="border-border bg-muted text-muted-foreground">
          {envelope.status.replace(/_/g, " ")}
        </Badge>
        <span>{envelope.routing === "sequential" ? "One at a time" : "All at once"}</span>
        <span>·</span>
        <span>{envelope.field_count} fields</span>
        {envelope.expires_at ? (
          <>
            <span>·</span>
            <span>Expires {new Date(envelope.expires_at).toLocaleDateString()}</span>
          </>
        ) : null}
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {envelope.recipients.map((recipient, index) => {
          const Icon = STATUS_ICONS[recipient.status];
          return (
            <li key={recipient.id} className="flex items-center gap-3 bg-surface px-4 py-3">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: recipientColor(index) }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {recipient.name}
                  {recipient.role ? (
                    <span className="ml-2 font-normal text-muted-foreground">
                      {recipient.role}
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">{recipient.email}</p>
                {recipient.decline_reason ? (
                  <p className="mt-1 text-xs text-destructive">
                    Declined: {recipient.decline_reason}
                  </p>
                ) : null}
              </div>

              <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="size-3.5" aria-hidden />
                <span className="hidden sm:inline">
                  {RECIPIENT_STATUS_LABELS[recipient.status]}
                </span>
              </span>

              {active && recipient.status !== "signed" && recipient.status !== "declined" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await nudgeRecipient(recipient.id);
                      setMessage(result.ok ? null : result.error);
                      setRevealed(result.ok ? (result.url ?? null) : null);
                      router.refresh();
                    })
                  }
                  title="Send the link again"
                >
                  Nudge
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {active ? (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await voidEnvelope(envelope.id);
                router.refresh();
              })
            }
          >
            <Ban aria-hidden />
            Cancel this request
          </Button>
          <span className="text-xs text-muted-foreground">
            Revokes every outstanding link immediately.
          </span>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Nudging issues a fresh link and invalidates the previous one — tokens are stored
        hashed, so the original cannot be re-sent.
      </p>
    </div>
  );
}
