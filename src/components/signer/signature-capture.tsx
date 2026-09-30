"use client";

import { useRef, useState } from "react";
import { SignaturePad, type SignaturePadHandle } from "@/components/signatures/signature-pad";
import { renderTypedSignature, trimToPng } from "@/lib/signatures/trim";
import { uploadSignerImage } from "@/lib/envelopes/signer-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * Signature capture for someone with no account.
 *
 * Draw or type only — no upload. A signer on a phone has nothing useful to
 * upload, and the extra option is one more decision on the screen that matters
 * most.
 */
export function SignatureCapture({
  token,
  kind,
  onCaptured,
  onCancel,
}: {
  token: string;
  kind: "signature" | "initials";
  onCaptured: (result: {
    path: string;
    width: number;
    height: number;
    previewUrl: string;
  }) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const padRef = useRef<SignaturePadHandle>(null);

  async function persist(blob: Blob, width: number, height: number) {
    const formData = new FormData();
    formData.append("token", token);
    formData.append("image", blob, "signature.png");
    formData.append("width", String(width));
    formData.append("height", String(height));

    const result = await uploadSignerImage(formData);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Preview straight from the blob in hand. Fetching it back would mean an
    // endpoint that accepts a storage path from the client, which is exactly
    // the kind of handle not worth exposing on a public route.
    onCaptured({
      path: result.path,
      width: result.width,
      height: result.height,
      previewUrl: URL.createObjectURL(blob),
    });
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "draw") {
        const canvas = padRef.current?.canvas();
        if (!canvas || padRef.current?.isEmpty()) {
          setError("Draw your signature first.");
          return;
        }
        const trimmed = await trimToPng(canvas);
        if (!trimmed) {
          setError("Nothing was drawn.");
          return;
        }
        await persist(trimmed.blob, trimmed.width, trimmed.height);
      } else {
        if (typed.trim() === "") {
          setError("Type your name first.");
          return;
        }
        const rendered = await renderTypedSignature(typed, "font-caveat");
        if (!rendered) {
          setError("That could not be rendered.");
          return;
        }
        await persist(rendered.blob, rendered.width, rendered.height);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-0.5 rounded-md border border-border bg-surface-muted p-0.5">
        {(["draw", "type"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setMode(option)}
            aria-pressed={mode === option}
            className={cn(
              "flex-1 rounded-[5px] px-3 py-2 text-sm capitalize transition-colors",
              mode === option
                ? "bg-surface font-medium text-foreground shadow-sm"
                : "text-muted-foreground",
            )}
          >
            {option}
          </button>
        ))}
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {mode === "draw" ? (
        <div className="space-y-2">
          {/* White regardless of theme: this is the ink that goes on the page. */}
          <SignaturePad ref={padRef} height={160} />
          <button
            type="button"
            onClick={() => padRef.current?.clear()}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={kind === "initials" ? "Your initials" : "Your full name"}
            maxLength={60}
            autoFocus
          />
          <div className="flex min-h-24 items-center justify-center rounded-md border border-border bg-white px-4">
            <span
              className="font-caveat text-4xl text-[#111827]"
              style={{ fontFamily: "var(--font-caveat), cursive" }}
            >
              {typed.trim() || "Preview"}
            </span>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={apply} disabled={busy} className="flex-1">
          {busy ? "Applying…" : "Apply"}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
