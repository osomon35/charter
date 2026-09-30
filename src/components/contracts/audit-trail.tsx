import { auditLabel } from "@/lib/envelopes/types";
import type { AuditView } from "@/lib/envelopes/queries";

/**
 * The audit trail, newest first.
 *
 * Shows the document hash on every event that had one. That is the part with
 * teeth: it lets anyone confirm afterwards exactly which bytes were viewed,
 * signed or produced, without trusting this application's own records.
 */
export function AuditTrail({ events }: { events: AuditView[] }) {
  if (events.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-muted-foreground">
        Nothing recorded yet. Uploads, sends, views, signatures and declines all appear here.
      </p>
    );
  }

  return (
    <ol className="divide-y divide-border">
      {events.map((event) => (
        <li key={event.id} className="px-5 py-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm font-medium">{auditLabel(event.kind)}</p>
            <time
              dateTime={event.created_at}
              className="text-xs tabular-nums text-muted-foreground"
            >
              {new Date(event.created_at).toLocaleString()}
            </time>
          </div>

          <p className="mt-0.5 text-xs text-muted-foreground">
            {[event.actor, event.ip ? `IP ${event.ip}` : null].filter(Boolean).join(" · ") ||
              "—"}
          </p>

          {event.user_agent ? (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={event.user_agent}>
              {event.user_agent}
            </p>
          ) : null}

          {event.document_sha256 ? (
            <p
              className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
              title={event.document_sha256}
            >
              sha256 {event.document_sha256}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
