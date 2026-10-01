"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Plus, Send, Trash2, X } from "lucide-react";
import { openPdfFromUrl, type PdfDocument } from "@/lib/pdfjs";
import { usePageImages } from "@/lib/pdf-pages";
import { PageImageView } from "@/components/editor/page-image";
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
  ownerName,
  ownerEmail,
}: {
  contractId: string;
  contractTitle: string;
  versionId: string;
  pageCount: number;
  ownerName: string;
  ownerEmail: string;
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
  const [reminderDays, setReminderDays] = useState<number | null>(null);

  const [activeRecipient, setActiveRecipient] = useState(0);
  const [tool, setTool] = useState<FieldType>("signature");
  const [selfSigning, setSelfSigning] = useState(false);

  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [width, setWidth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [links, setLinks] = useState<{ email: string; url: string }[]>([]);

  // Rendered once per page, up front, then displayed as images — see usePageImages.
  const { pages, rendered, total, error: renderError } = usePageImages(doc, pageCount);

  const viewportRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  // A ref, not the busy state: setBusy does not take effect until the next
  // render, so a fast second click would otherwise slip past a disabled button.
  const sending = useRef(false);
  // When the last real drag ended. A drag that finishes over the page also fires
  // a click, which would otherwise place a duplicate where the field was
  // dropped. A timestamp rather than a flag, because a drag ending off-page
  // produces no click and a flag would stay set and eat the next real one.
  const dragEndedAt = useRef(0);

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
        opened = await openPdfFromUrl(signed.url);
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

  function toggleSelfSigning(on: boolean) {
    setSelfSigning(on);

    if (on) {
      setRecipients((current) =>
        current.some(
          (recipient) => recipient.email.trim().toLowerCase() === ownerEmail.toLowerCase(),
        )
          ? current
          : [
              ...current,
              {
                id: crypto.randomUUID(),
                name: ownerName,
                email: ownerEmail,
                role: "Me",
              },
            ],
      );
      return;
    }

    const mineIds = new Set(
      recipients
        .filter(
          (recipient) => recipient.email.trim().toLowerCase() === ownerEmail.toLowerCase(),
        )
        .map((recipient) => recipient.id),
    );

    setFields((current) => current.filter((field) => !mineIds.has(field.recipientId)));
    setRecipients((current) => {
      const rest = current.filter((recipient) => !mineIds.has(recipient.id));
      // Never leave the list empty, or there is nothing to type into.
      return rest.length > 0
        ? rest
        : [{ id: crypto.randomUUID(), name: "", email: "", role: "" }];
    });
    setActiveRecipient(0);
  }

  function removeRecipient(id: string) {
    setRecipients((current) => current.filter((recipient) => recipient.id !== id));
    // Fields belonging to a removed recipient go with them, or the send would
    // reference someone who no longer exists.
    setFields((current) => current.filter((field) => field.recipientId !== id));
    setActiveRecipient(0);
  }

  // --- fields --------------------------------------------------------------
  function placeField(event: React.MouseEvent<HTMLDivElement>, pageNumber: number) {
    // A drag that ends over the page also fires a click here. Without this, every
    // repositioned field left a duplicate behind where the drag finished.
    if (Date.now() - dragEndedAt.current < 250) return;

    const target = validRecipients[activeRecipient] ?? recipients[activeRecipient];
    if (!target) return;

    const rect = event.currentTarget.getBoundingClientRect();
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
        page: pageNumber,
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
    const pageNode = (event.currentTarget as HTMLElement).parentElement;
    if (!field || !pageNode) return;

    event.preventDefault();
    event.stopPropagation();

    const rect = pageNode.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { x: field.x, y: field.y };
    let moved = false;

    function onMove(moveEvent: PointerEvent) {
      if (Math.abs(moveEvent.clientX - startX) > 2 || Math.abs(moveEvent.clientY - startY) > 2) {
        moved = true;
      }
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
      // Only for an actual drag; a plain click on a field should not affect the
      // page's own handler.
      if (moved) dragEndedAt.current = Date.now();
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
      reminderAfterDays: reminderDays,
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

      {/* Only scroll here outside the field step. Nesting this scroller inside
          the step's own meant the inner column's width changed when the outer
          scrollbar appeared, which restarted every page render. */}
      <div
        className={cn(
          "min-h-0 flex-1",
          step === "fields" ? "overflow-hidden" : "overflow-y-auto",
        )}
      >
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

            <label className="mt-6 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-surface p-4 text-sm">
              <input
                type="checkbox"
                checked={selfSigning}
                onChange={(event) => toggleSelfSigning(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[color:var(--primary)]"
              />
              <span className="min-w-0">
                <span className="block font-medium">I am also signing</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Adds you as a recipient so you can place your own fields. You get a
                  signing link by email like everyone else, and your signature is recorded
                  in the audit trail the same way.
                </span>
              </span>
            </label>

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
              {/* Always present, not only on failure: placing fields against a
                  document you cannot read is the worst case here, and one click to
                  the real PDF removes that possibility entirely. */}
              <a
                href={`/api/versions/${versionId}/file`}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-4 flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="size-3 shrink-0" aria-hidden />
                Open PDF in a new tab
              </a>

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

            <div
              ref={viewportRef}
              // scrollbar-gutter keeps the column width from changing when the
              // scrollbar appears; that wobble used to restart the canvas render
              // on every frame and leave the page blank.
              style={{ scrollbarGutter: "stable" }}
              className="min-w-0 flex-1 overflow-y-auto bg-surface-muted p-8"
            >
              {renderError ? (
                <Alert tone="error" className="mb-4">
                  <p className="font-medium">The document could not be rendered here.</p>
                  <p className="mt-1 text-xs">
                    {renderError} — open the PDF in a new tab from the panel on the left, and
                    send me this message.
                  </p>
                </Alert>
              ) : null}

              {doc && rendered < total ? (
                <p className="mb-3 text-center text-xs text-muted-foreground">
                  Rendering pages… {rendered} of {total}
                </p>
              ) : null}

              {doc ? (
                <div className="mx-auto flex flex-col items-center gap-6">
                  {Array.from({ length: pageCount }, (_, index) => index + 1).map(
                    (pageNumber) => (
                      <div key={pageNumber} className="w-full">
                        <p className="mb-1.5 text-center text-[11px] tabular-nums text-muted-foreground">
                          Page {pageNumber} of {pageCount}
                        </p>
                        <div
                          onClick={(event) => placeField(event, pageNumber)}
                          className="relative mx-auto cursor-crosshair bg-white shadow-sm ring-1 ring-border"
                          style={{ width }}
                        >
                          <PageImageView
                            image={pages[pageNumber - 1] ?? null}
                            pageNumber={pageNumber}
                            width={width}
                          />

                          {fields
                            .filter((field) => field.page === pageNumber)
                            .map((field) => {
                              const index = validRecipients.findIndex(
                                (recipient) => recipient.id === field.recipientId,
                              );
                              const color = recipientColor(Math.max(0, index));
                              return (
                                <div
                                  key={field.id}
                                  onPointerDown={(event) => dragField(event, field.id)}
                                  onClick={(event) => event.stopPropagation()}
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
                      </div>
                    ),
                  )}
                </div>
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  Opening document…
                </p>
              )}
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

            <div className="mt-6 space-y-2">
              <Label htmlFor="reminder">Automatic reminders</Label>
              <Select
                id="reminder"
                value={reminderDays === null ? "" : String(reminderDays)}
                onChange={(event) =>
                  setReminderDays(event.target.value ? Number(event.target.value) : null)
                }
              >
                <option value="">Off — I will nudge manually</option>
                {[2, 3, 5, 7, 14].map((days) => (
                  <option key={days} value={days}>
                    Every {days} days until they respond
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                A reminder issues a fresh link and invalidates the previous one, since tokens
                are stored hashed and the original cannot be re-sent.
              </p>
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
