"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, FileText, PenLine, ShieldCheck } from "lucide-react";
import { loadPdfjs, type PdfDocument } from "@/lib/pdfjs";
import { PageCanvas } from "@/components/editor/page-canvas";
import { SignatureCapture } from "@/components/signer/signature-capture";
import {
  declineToSign,
  recordConsent,
  recordSignerView,
  submitSignature,
} from "@/lib/envelopes/signer-actions";
import { FIELD_LABELS, type SignerField } from "@/lib/envelopes/types";
import { todayLabel } from "@/lib/editor/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type Filled = {
  text?: string;
  checked?: boolean;
  assetPath?: string;
  assetWidth?: number;
  assetHeight?: number;
  previewUrl?: string;
};

type Phase = "consent" | "filling" | "done" | "declined";

/**
 * The signer's whole experience.
 *
 * Ordered as consent, then fill, then submit, because that order is the point:
 * intent has to be captured before anything can be entered, and it is the thing
 * that makes a simple electronic signature stand up. The consent step is
 * therefore a gate, not a checkbox at the bottom of a form.
 *
 * Every page renders at once rather than one at a time — a signer needs to read
 * the whole document, and paging through it is friction on the screen where
 * friction costs most.
 */
export function SignerExperience({
  token,
  documentTitle,
  senderMessage,
  recipientName,
  pageCount,
  fields,
  alreadyConsented,
}: {
  token: string;
  documentTitle: string;
  senderMessage: string | null;
  recipientName: string;
  pageCount: number;
  fields: SignerField[];
  alreadyConsented: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(alreadyConsented ? "filling" : "consent");
  const [agreed, setAgreed] = useState(alreadyConsented);
  const [values, setValues] = useState<Record<string, Filled>>(() => {
    const initial: Record<string, Filled> = {};
    for (const field of fields) {
      if (field.type === "date_signed") initial[field.id] = { text: todayLabel() };
    }
    return initial;
  });
  const [capturing, setCapturing] = useState<SignerField | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  // --- open the document ---------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let opened: PdfDocument | null = null;

    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        opened = await pdfjs.getDocument({ url: `/api/sign/${token}/file` }).promise;
        if (cancelled) {
          await opened.destroy();
          return;
        }
        setDoc(opened);
      } catch (err) {
        console.error("signer_open_failed", err);
        setError("The document could not be loaded. Please reload the page.");
      }
    })();

    return () => {
      cancelled = true;
      void opened?.destroy();
    };
  }, [token]);

  // Record the view once, for the audit trail.
  useEffect(() => {
    void recordSignerView(token);
  }, [token]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const measure = () => setPageWidth(Math.min(node.clientWidth - 8, 900));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const required = useMemo(() => fields.filter((field) => field.required), [fields]);

  const isFilled = useCallback(
    (field: SignerField) => {
      const value = values[field.id];
      if (!value) return false;
      switch (field.type) {
        case "signature":
        case "initials":
          return Boolean(value.assetPath);
        case "checkbox":
          return value.checked === true;
        default:
          return Boolean(value.text?.trim());
      }
    },
    [values],
  );

  const remaining = required.filter((field) => !isFilled(field));
  const nextField = remaining[0] ?? null;

  /** Scrolls the next unfilled required field into view and focuses it. */
  function goToNext() {
    if (!nextField) return;
    setActiveId(nextField.id);
    const node = fieldRefs.current[nextField.id];
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (nextField.type === "text") {
      setTimeout(() => node?.querySelector("input")?.focus(), 400);
    }
  }

  async function consent() {
    setBusy(true);
    const result = await recordConsent(token);
    setBusy(false);
    if (!result.ok) {
      setError("This signing link is no longer valid.");
      return;
    }
    setPhase("filling");
  }

  async function submit() {
    if (remaining.length > 0) {
      setError(`${remaining.length} required field${remaining.length === 1 ? "" : "s"} still to complete.`);
      goToNext();
      return;
    }

    setBusy(true);
    setError(null);

    const payload = fields.map((field) => {
      const value = values[field.id] ?? {};
      return {
        fieldId: field.id,
        text: value.text?.trim() ?? null,
        checked: value.checked ?? null,
        assetPath: value.assetPath ?? null,
      };
    });

    const result = await submitSignature({ token, values: payload });
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPhase("done");
  }

  async function decline() {
    setBusy(true);
    setError(null);
    const result = await declineToSign({ token, reason: declineReason });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPhase("declined");
  }

  // --- terminal states -----------------------------------------------------
  if (phase === "done") {
    return (
      <Outcome
        icon={<Check className="size-5" aria-hidden />}
        title="Signed"
        body="Thank you. Everyone will receive a copy by email once all parties have signed, with a certificate of completion attached."
      />
    );
  }

  if (phase === "declined") {
    return (
      <Outcome
        title="Declined"
        body="You have declined to sign this document. The sender has been told, along with the reason you gave."
      />
    );
  }

  return (
    <div className="min-h-dvh bg-surface-muted pb-32">
      {/* --- header --- */}
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">{documentTitle}</p>
            <p className="truncate text-xs leading-tight text-muted-foreground">
              For {recipientName} · {pageCount} page{pageCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {error ? (
          <Alert tone="error" className="mb-4">
            {error}
          </Alert>
        ) : null}

        <p className="mb-4 text-xs text-muted-foreground">
          Trouble reading it here?{" "}
          <a
            href={`/api/sign/${token}/file`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Open the PDF in a new tab
          </a>
          .
        </p>

        {senderMessage ? (
          <div className="mb-6 rounded-lg border border-border bg-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Message from the sender
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{senderMessage}</p>
          </div>
        ) : null}

        {/* --- consent gate --- */}
        {phase === "consent" ? (
          <div className="mb-6 rounded-lg border border-border bg-surface p-5">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold tracking-tight">
                  Before you sign
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Read the document below. Signing it electronically here creates a legally
                  binding simple electronic signature under the US ESIGN Act and EU eIDAS. Your
                  name, email, IP address, and the time of each action are recorded in an audit
                  trail attached to the finished document.
                </p>

                <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(event) => setAgreed(event.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-[color:var(--primary)]"
                  />
                  <span>
                    I agree to sign this document electronically and to the record described
                    above.
                  </span>
                </label>

                <Button onClick={consent} disabled={!agreed || busy} className="mt-4">
                  {busy ? "One moment…" : "Continue"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* --- document --- */}
        <div ref={viewportRef} className="space-y-4">
          {doc
            ? Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                <SignerPage
                  key={pageNumber}
                  doc={doc}
                  pageNumber={pageNumber}
                  width={pageWidth}
                  interactive={phase === "filling"}
                  onRenderError={() =>
                    setError(
                      "Part of this document could not be displayed. Open it with the link below before signing.",
                    )
                  }
                  fields={fields.filter((field) => field.page === pageNumber)}
                  values={values}
                  activeId={activeId}
                  registerRef={(id, node) => {
                    fieldRefs.current[id] = node;
                  }}
                  onActivate={(field) => {
                    setActiveId(field.id);
                    if (field.type === "signature" || field.type === "initials") {
                      setCapturing(field);
                    }
                  }}
                  onText={(field, text) =>
                    setValues((current) => ({
                      ...current,
                      [field.id]: { ...current[field.id], text },
                    }))
                  }
                  onToggle={(field, checked) =>
                    setValues((current) => ({
                      ...current,
                      [field.id]: { ...current[field.id], checked },
                    }))
                  }
                />
              ))
            : (
              <div className="rounded-lg border border-border bg-surface px-6 py-16 text-center text-sm text-muted-foreground">
                Loading document…
              </div>
            )}
        </div>
      </main>

      {/* --- action bar --- */}
      {phase === "filling" ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-tight">
                {remaining.length === 0
                  ? "All required fields complete"
                  : `${remaining.length} field${remaining.length === 1 ? "" : "s"} to complete`}
              </p>
              <button
                type="button"
                onClick={() => setDeclining((current) => !current)}
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                Decline to sign
              </button>
            </div>

            {nextField ? (
              <Button variant="outline" onClick={goToNext}>
                <ChevronDown aria-hidden />
                Next: {FIELD_LABELS[nextField.type]}
              </Button>
            ) : null}

            <Button onClick={submit} disabled={busy || remaining.length > 0}>
              {busy ? "Submitting…" : "Finish signing"}
            </Button>
          </div>

          {declining ? (
            <div className="mx-auto max-w-4xl border-t border-border px-4 py-4">
              <p className="text-sm font-medium">Decline to sign</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The sender will be told, along with your reason. This cannot be undone.
              </p>
              <Textarea
                value={declineReason}
                onChange={(event) => setDeclineReason(event.target.value)}
                placeholder="Why are you declining?"
                rows={3}
                className="mt-3"
              />
              <div className="mt-3 flex gap-2">
                <Button
                  variant="destructive"
                  onClick={decline}
                  disabled={busy || declineReason.trim().length < 3}
                >
                  Decline
                </Button>
                <Button variant="ghost" onClick={() => setDeclining(false)} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* --- signature capture sheet --- */}
      {capturing ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6">
          <div className="w-full max-w-md rounded-t-xl border border-border bg-surface p-5 sm:rounded-xl">
            <h2 className="text-[15px] font-semibold tracking-tight">
              {capturing.type === "initials" ? "Add your initials" : "Add your signature"}
            </h2>
            <p className="mt-1 mb-4 text-sm text-muted-foreground">
              Draw it, or type your name and we will render it.
            </p>
            <SignatureCapture
              token={token}
              kind={capturing.type === "initials" ? "initials" : "signature"}
              onCancel={() => setCapturing(null)}
              onCaptured={(result) => {
                setValues((current) => ({
                  ...current,
                  [capturing.id]: {
                    ...current[capturing.id],
                    assetPath: result.path,
                    assetWidth: result.width,
                    assetHeight: result.height,
                    previewUrl: result.previewUrl,
                  },
                }));
                setCapturing(null);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** One page, with this recipient's fields laid over it in normalized position. */
function SignerPage({
  doc,
  pageNumber,
  width,
  interactive,
  onRenderError,
  fields,
  values,
  activeId,
  registerRef,
  onActivate,
  onText,
  onToggle,
}: {
  doc: PdfDocument;
  pageNumber: number;
  width: number;
  interactive: boolean;
  onRenderError: (message: string) => void;
  fields: SignerField[];
  values: Record<string, Filled>;
  activeId: string | null;
  registerRef: (id: string, node: HTMLElement | null) => void;
  onActivate: (field: SignerField) => void;
  onText: (field: SignerField, text: string) => void;
  onToggle: (field: SignerField, checked: boolean) => void;
}) {
  return (
    <div
      className="relative mx-auto overflow-hidden rounded-lg border border-border bg-white shadow-sm"
      style={{ width: width || undefined }}
    >
      <PageCanvas
        doc={doc}
        pageNumber={pageNumber}
        cssWidth={width}
        onError={onRenderError}
      />

      {fields.map((field) => {
        const value = values[field.id] ?? {};
        const active = activeId === field.id;
        const filled =
          field.type === "signature" || field.type === "initials"
            ? Boolean(value.assetPath)
            : field.type === "checkbox"
              ? value.checked === true
              : Boolean(value.text?.trim());

        return (
          <div
            key={field.id}
            ref={(node) => registerRef(field.id, node)}
            style={{
              left: `${field.x * 100}%`,
              top: `${field.y * 100}%`,
              width: `${field.w * 100}%`,
              height: `${field.h * 100}%`,
            }}
            className={cn(
              "absolute flex items-center justify-center rounded-[3px] transition-colors",
              !interactive
                ? "border border-dashed border-primary/30"
                : filled
                  ? "border border-success/40 bg-success/5"
                  : active
                    ? "border-2 border-primary bg-primary-subtle"
                    : "border border-primary/60 bg-primary-subtle/60 hover:bg-primary-subtle",
            )}
          >
            {field.type === "signature" || field.type === "initials" ? (
              <button
                type="button"
                disabled={!interactive}
                onClick={() => onActivate(field)}
                className="flex h-full w-full items-center justify-center gap-1 px-1"
              >
                {value.previewUrl ? (
                  /* A blob URL for the image this signer just drew. */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={value.previewUrl}
                    alt=""
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <>
                    <PenLine className="size-3 shrink-0 text-primary" aria-hidden />
                    <span className="truncate text-[10px] font-medium text-primary">
                      {field.type === "initials" ? "Initials" : "Sign"}
                    </span>
                  </>
                )}
              </button>
            ) : null}

            {field.type === "checkbox" ? (
              <input
                type="checkbox"
                disabled={!interactive}
                checked={value.checked === true}
                onChange={(event) => onToggle(field, event.target.checked)}
                aria-label={field.label ?? "Checkbox"}
                className="size-full cursor-pointer accent-[color:var(--primary)]"
              />
            ) : null}

            {field.type === "date_signed" ? (
              /* Filled automatically and not editable: the date signed is
                 evidence, and one the signer could retype would not be. */
              <span className="w-full truncate px-1 text-[11px] font-medium text-[#111827]">
                {value.text ?? todayLabel()}
              </span>
            ) : null}

            {field.type === "text" ? (
              <Input
                disabled={!interactive}
                value={value.text ?? ""}
                onChange={(event) => onText(field, event.target.value)}
                onFocus={() => onActivate(field)}
                placeholder={field.label ?? FIELD_LABELS[field.type]}
                className="h-full w-full rounded-[3px] border-0 bg-transparent px-1 text-[11px] text-[#111827] placeholder:text-[#9ca3af] shadow-none"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Outcome({
  icon,
  title,
  body,
}: {
  icon?: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        {icon ? (
          <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-full border border-border bg-surface text-success">
            {icon}
          </div>
        ) : null}
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
        <p className="mt-10 text-xs leading-relaxed text-muted-foreground">
          This was a simple electronic signature under ESIGN and eIDAS, evidenced by your
          consent and by the audit trail attached to the document. It is not a qualified or
          notarised signature.
        </p>
      </div>
    </main>
  );
}
