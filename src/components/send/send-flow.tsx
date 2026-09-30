"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Send, Trash2, X } from "lucide-react";
import { loadPdfjs, type PdfDocument } from "@/lib/pdfjs";
import { PageCanvas } from "@/components/editor/page-canvas";
import { createAndSendEnvelope, getSendPreviewUrl } from "@/lib/envelopes/send-actions";
import {
  FIELD_LABELS,
  FIELD_SIZES,
  FIELD_TYPES,
  recipientColor,
  ROUTINGS,
  type FieldDraft,
  type FieldType,
  type RecipientDraft,
  type Routing,
} from "@/lib/envelopes/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { RevealedLinks } from "@/components/send/revealed-links";
import { cn } from "@/lib/utils";

type Step = "recipients" | "fields" | "review";

const STEPS: { step: Step; label: string }[] = [
  { step: "recipients", label: "Recipients" },
  { step: "fields", label: "Fields" },
  { step: "review", label: "Review & send" },
];

/**
 * Three steps, in this order for a reason: a field cannot be assigned before the
 * people exist, and the send cannot be reviewed before the fields do. Each step
 * only blocks on what the next one genuinely needs.
 */
export function SendFlow({
  contractId,
  contractTitle,
  versionId,
  pageCount,
}: {
  contractId: string;
  contractTitle: string;
  versionId: string;
  pageCount: number;
}) {
  const router = useRouter();

  const [step, setStep] = useState<Step>("recipients");
  const [recipients, setRecipients] = useState<RecipientDraft[]>([
    { id: crypto.randomUUID(), name: "", email: "", role: "" },
  ]);
  const [fields, setFields] = useState<FieldDraft[]>([]);
  const [routing, setRouting] = useState<Routing>("parallel");
  const [message, setMessage] = useState("");
  const [expiryDays, setExpiryDays] = useState(30);

  const [activeRecipient, setActiveRecipient] = useState(0);
  const [tool, setTool] = useState<FieldType>("signature");
  const [page, setPage] = useState(1);

  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [width, setWidth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [links, setLinks] = useState<{ email: string; url: string }[]>([]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  // A ref, not the busy state: setBusy does not take effect until the next
  // render, so a fast second click would otherwise slip past a disabled button.
  const sending = useRef(false);

  // --- document ------------------------------------------------------------
  useEffect(() => {
    if (step !== "fields" || doc) return;
    let cancelled = false;
    let opened: PdfDocument | null = null;

    (async () => {
      const signed = await getSendPreviewUrl(versionId);
      if (!signed.ok) {
        setError(signed.error);
        return;
      }
      try {
        const pdfjs = await loadPdfjs();
        opened = await pdfjs.getDocument({ url: signed.url }).promise;
        if (cancelled) {
          await opened.destroy();
          return;
        }
        setDoc(opened);
      } catch (err) {
        console.error("send_preview_failed", err);
        setError("The document could not be opened.");
      }
    })();

    return () => {
      cancelled = true;
      void opened?.destroy();
    };
  }, [step, doc, versionId]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const measure = () => setWidth(Math.max(240, Math.min(node.clientWidth - 64, 900)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [step]);

  // --- recipients ----------------------------------------------------------
  const validRecipients = recipients.filter(
    (recipient) => recipient.name.trim() && /.+@.+\..+/.test(recipient.email.trim()),
  );

  function patchRecipient(id: string, patch: Partial<RecipientDraft>) {
    setRecipients((current) =>
      current.map((recipient) => (recipient.id === id ? { ...recipient, ...patch } : recipient)),
    );
  }

  function removeRecipient(id: string) {
    setRecipients((current) => current.filter((recipient) => recipient.id !== id));
    // Fields belonging to a removed recipient go with them, or the send would
    // reference someone who no longer exists.
    setFields((current) => current.filter((field) => field.recipientId !== id));
    setActiveRecipient(0);
  }

  // --- fields --------------------------------------------------------------
  function placeField(event: React.MouseEvent<HTMLDivElement>) {
    const target = recipients[activeRecipient];
    if (!target || !pageRef.current) return;

    const rect = pageRef.current.getBoundingClientRect();
    const size = FIELD_SIZES[tool];

    // Centre the field on the click, which is where the eye expects it.
    const x = (event.clientX - rect.left) / rect.width - size.w / 2;
    const y = (event.clientY - rect.top) / rect.height - size.h / 2;

    setFields((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        recipientId: target.id,
        type: tool,
        page,
        x: Math.max(0, Math.min(1 - size.w, x)),
        y: Math.max(0, Math.min(1 - size.h, y)),
        w: size.w,
        h: size.h,
        required: true,
      },
    ]);
  }

  function dragField(event: React.PointerEvent, fieldId: string) {
    const field = fields.find((item) => item.id === fieldId);
    if (!field || !pageRef.current) return;

    event.preventDefault();
    event.stopPropagation();

    const rect = pageRef.current.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { x: field.x, y: field.y };

    function onMove(moveEvent: PointerEvent) {
      const x = origin.x + (moveEvent.clientX - startX) / rect.width;
      const y = origin.y + (moveEvent.clientY - startY) / rect.height;
      setFields((current) =>
        current.map((item) =>
          item.id === fieldId
            ? {
                ...item,
                x: Math.max(0, Math.min(1 - item.w, x)),
                y: Math.max(0, Math.min(1 - item.h, y)),
              }
            : item,
        ),
      );
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // --- send ----------------------------------------------------------------
  async function send() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setWarnings([]);

    const indexOf = new Map(validRecipients.map((recipient, index) => [recipient.id, index]));

    const result = await createAndSendEnvelope({
      contractId,
      routing,
      message: message.trim() || undefined,
      expiryDays,
      recipients: validRecipients.map((recipient) => ({
        name: recipient.name.trim(),
        email: recipient.email.trim().toLowerCase(),
        role: recipient.role.trim(),
      })),
      fields: fields
        .filter((field) => indexOf.has(field.recipientId))
        .map((field) => ({
          recipientIndex: indexOf.get(field.recipientId) ?? 0,
          type: field.type,
          page: field.page,
          x: field.x,
          y: field.y,
          w: field.w,
          h: field.h,
          required: field.required,
          label: field.label,
        })),
    });

    setBusy(false);
    sending.current = false;

    if (!result.ok) {
      setError(result.error);
      return;
    }

    // Stay on the page when there is something the owner still needs to see:
    // failed deliveries, or revealed links they have to copy.
    if (result.warnings.length > 0 || result.links.length > 0) {
      setWarnings(result.warnings);
      setLinks(result.links);
      return;
    }

    router.push(`/contracts/${contractId}`);
  }

  const canContinue =
    step === "recipients" ? validRecipients.length > 0 : step === "fields" ? true : true;

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3">
        <Link
          href={`/contracts/${contractId}`}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          <span className="hidden sm:inline">Back</span>
        </Link>

        <span className="hidden min-w-0 truncate text-sm font-medium md:block">
          Send “{contractTitle}” for signature
        </span>

        <nav className="mx-auto flex items-center gap-1" aria-label="Steps">
          {STEPS.map((entry, index) => (
            <button
              key={entry.step}
              type="button"
              onClick={() => setStep(entry.step)}
              disabled={index > 0 && validRecipients.length === 0}
              aria-current={step === entry.step ? "step" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40",
                step === entry.step
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {index + 1}. {entry.label}
            </button>
          ))}
        </nav>

        {step !== "review" ? (
          <Button
            size="sm"
            disabled={!canContinue}
            onClick={() => setStep(step === "recipients" ? "fields" : "review")}
          >
            Continue
          </Button>
        ) : (
          <Button size="sm" onClick={send} disabled={busy || validRecipients.length === 0}>
            <Send aria-hidden />
            {busy ? "Sending…" : "Send"}
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="mx-auto max-w-2xl px-6 pt-6">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}

        {links.length > 0 ? (
          <div className="mx-auto max-w-2xl px-6 pt-6">
            <RevealedLinks links={links} />
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => router.push(`/contracts/${contractId}`)}
            >
              Done — go to contract
            </Button>
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div className="mx-auto max-w-2xl px-6 pt-6">
            <Alert tone="error">
              <p className="font-medium">Sent, but some emails did not go out:</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <p className="mt-2">
                The signing links are valid — nudge those recipients from the contract page
                once email is working.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => router.push(`/contracts/${contractId}`)}
              >
                Go to contract
              </Button>
            </Alert>
          </div>
        ) : null}

        {/* --- step 1 --- */}
        {step === "recipients" ? (
          <div className="mx-auto max-w-2xl px-6 py-8">
            <h1 className="text-lg font-semibold tracking-tight">Who needs to sign?</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Each person gets their own private link. They do not need an account.
            </p>

            <div className="mt-6 space-y-3">
              {recipients.map((recipient, index) => (
                <div
                  key={recipient.id}
                  className="rounded-lg border border-border bg-surface p-4"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <span
                        aria-hidden
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: recipientColor(index) }}
                      />
                      {routing === "sequential" ? `Signs ${ordinal(index + 1)}` : "Recipient"}
                    </span>
                    {recipients.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeRecipient(recipient.id)}
                        className="rounded-md p-1 text-muted-foreground hover:bg-destructive-subtle hover:text-destructive"
                        aria-label="Remove recipient"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`name-${recipient.id}`}>Name</Label>
                      <Input
                        id={`name-${recipient.id}`}
                        value={recipient.name}
                        onChange={(event) =>
                          patchRecipient(recipient.id, { name: event.target.value })
                        }
                        placeholder="Ana Ferreira"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`email-${recipient.id}`}>Email</Label>
                      <Input
                        id={`email-${recipient.id}`}
                        type="email"
                        value={recipient.email}
                        onChange={(event) =>
                          patchRecipient(recipient.id, { email: event.target.value })
                        }
                        placeholder="ana@example.com"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`role-${recipient.id}`}>Role (optional)</Label>
                      <Input
                        id={`role-${recipient.id}`}
                        value={recipient.role}
                        onChange={(event) =>
                          patchRecipient(recipient.id, { role: event.target.value })
                        }
                        placeholder="Client"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() =>
                setRecipients((current) => [
                  ...current,
                  { id: crypto.randomUUID(), name: "", email: "", role: "" },
                ])
              }
            >
              <Plus aria-hidden />
              Add recipient
            </Button>

            <div className="mt-8 space-y-2">
              <Label htmlFor="routing">Signing order</Label>
              <Select
                id="routing"
                value={routing}
                onChange={(event) => setRouting(event.target.value as Routing)}
              >
                {ROUTINGS.map((option) => (
                  <option key={option} value={option}>
                    {option === "parallel"
                      ? "Everyone at once"
                      : "One at a time, in the order above"}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                {routing === "parallel"
                  ? "All recipients are emailed immediately and can sign in any order."
                  : "Only the first is emailed now. Each next person is notified when the one before them signs."}
              </p>
            </div>
          </div>
        ) : null}

        {/* --- step 2 --- */}
        {step === "fields" ? (
          <div className="flex h-full min-h-0">
            <div className="w-56 shrink-0 overflow-y-auto border-r border-border bg-surface p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Placing for
              </p>
              <div className="space-y-1">
                {validRecipients.map((recipient, index) => (
                  <button
                    key={recipient.id}
                    type="button"
                    onClick={() => setActiveRecipient(index)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors",
                      activeRecipient === index
                        ? "bg-primary-subtle font-medium"
                        : "hover:bg-muted",
                    )}
                  >
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: recipientColor(index) }}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {recipient.name || recipient.email}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {fields.filter((field) => field.recipientId === recipient.id).length}
                    </span>
                  </button>
                ))}
              </div>

              <p className="mb-2 mt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Field
              </p>
              <div className="space-y-1">
                {FIELD_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setTool(type)}
                    className={cn(
                      "w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      tool === type ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                    )}
                  >
                    {FIELD_LABELS[type]}
                  </button>
                ))}
              </div>

              <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
                Click the page to place a field for the selected person. Drag to move it.
              </p>
            </div>

            <div ref={viewportRef} className="min-w-0 flex-1 overflow-auto bg-surface-muted p-8">
              {doc ? (
                <div
                  ref={pageRef}
                  onClick={placeField}
                  className="relative mx-auto cursor-crosshair shadow-sm ring-1 ring-border"
                  style={{ width }}
                >
                  <PageCanvas doc={doc} pageNumber={page} cssWidth={width} />

                  {fields
                    .filter((field) => field.page === page)
                    .map((field) => {
                      const index = validRecipients.findIndex(
                        (recipient) => recipient.id === field.recipientId,
                      );
                      const color = recipientColor(Math.max(0, index));
                      return (
                        <div
                          key={field.id}
                          onPointerDown={(event) => dragField(event, field.id)}
                          style={{
                            left: `${field.x * 100}%`,
                            top: `${field.y * 100}%`,
                            width: `${field.w * 100}%`,
                            height: `${field.h * 100}%`,
                            borderColor: color,
                            backgroundColor: `${color}1a`,
                          }}
                          className="group absolute flex cursor-move items-center justify-center rounded-[3px] border-2"
                        >
                          <span
                            className="truncate px-1 text-[10px] font-medium"
                            style={{ color }}
                          >
                            {FIELD_LABELS[field.type]}
                          </span>
                          <button
                            type="button"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              setFields((current) =>
                                current.filter((item) => item.id !== field.id),
                              );
                            }}
                            aria-label="Remove field"
                            className="absolute -right-2 -top-2 hidden size-4 items-center justify-center rounded-full border border-border bg-surface group-hover:flex"
                          >
                            <Trash2 className="size-2.5 text-destructive" aria-hidden />
                          </button>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  Opening document…
                </p>
              )}

              <div className="mt-6 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
                <span className="text-xs tabular-nums text-muted-foreground">
                  Page {page} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                  disabled={page >= pageCount}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                >
                  <ChevronRight className="size-4" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* --- step 3 --- */}
        {step === "review" ? (
          <div className="mx-auto max-w-2xl px-6 py-8">
            <h1 className="text-lg font-semibold tracking-tight">Review and send</h1>

            <div className="mt-6 space-y-2">
              <Label htmlFor="message">Message (optional)</Label>
              <Textarea
                id="message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Anything the signers should know before they open it."
                rows={4}
              />
            </div>

            <div className="mt-6 space-y-2">
              <Label htmlFor="expiry">Links expire after</Label>
              <Select
                id="expiry"
                value={String(expiryDays)}
                onChange={(event) => setExpiryDays(Number(event.target.value))}
              >
                {[7, 14, 30, 60, 90].map((days) => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </Select>
            </div>

            <div className="mt-8 rounded-lg border border-border bg-surface">
              <div className="border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {validRecipients.length} recipient{validRecipients.length === 1 ? "" : "s"} ·{" "}
                {routing === "parallel" ? "all at once" : "one at a time"}
              </div>
              <ul className="divide-y divide-border">
                {validRecipients.map((recipient, index) => {
                  const count = fields.filter(
                    (field) => field.recipientId === recipient.id,
                  ).length;
                  return (
                    <li key={recipient.id} className="flex items-center gap-3 px-4 py-3">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: recipientColor(index) }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{recipient.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {recipient.email}
                          {recipient.role ? ` · ${recipient.role}` : ""}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          count === 0 ? "text-warning" : "text-muted-foreground",
                        )}
                      >
                        {count} field{count === 1 ? "" : "s"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {fields.length === 0 ? (
              <Alert className="mt-4">
                No fields placed. Recipients will be able to review the document and confirm,
                but there will be nothing for them to fill in and nothing to bake into the
                signed copy.
              </Alert>
            ) : null}

            <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
              Any unflattened edits are baked into a new version before sending, so recipients
              see exactly what you see. That version is then frozen for this envelope.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `${n}${suffix}`;
}
