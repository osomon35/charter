"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Upload } from "lucide-react";
import { SignaturePad, type SignaturePadHandle } from "@/components/signatures/signature-pad";
import { renderTypedSignature, trimToPng } from "@/lib/signatures/trim";
import { saveSignature } from "@/lib/signatures/actions";
import {
  KIND_LABELS,
  MAX_SIGNATURE_BYTES,
  SIGNATURE_KINDS,
  type SignatureKind,
  type SignatureSource,
} from "@/lib/signatures/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type Mode = "draw" | "type" | "upload";

const MODES: { mode: Mode; label: string }[] = [
  { mode: "draw", label: "Draw" },
  { mode: "type", label: "Type" },
  { mode: "upload", label: "Upload" },
];

export function SignatureCreator({ fontClass }: { fontClass: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("draw");
  const [kind, setKind] = useState<SignatureKind>("signature");
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const padRef = useRef<SignaturePadHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function persist(blob: Blob, width: number, height: number, source: SignatureSource) {
    const formData = new FormData();
    formData.append("image", blob, "signature.png");
    formData.append("kind", kind);
    formData.append("source", source);
    formData.append("width", String(width));
    formData.append("height", String(height));

    const result = await saveSignature(formData);
    if (result.error) {
      setMessage(result.error);
      return;
    }

    setMessage(null);
    padRef.current?.clear();
    setTyped("");
    router.refresh();
  }

  function saveDrawn() {
    const canvas = padRef.current?.canvas();
    if (!canvas || padRef.current?.isEmpty()) {
      setMessage("Draw something first.");
      return;
    }

    startTransition(async () => {
      // Trimmed before upload: an untrimmed signature carries a wide
      // transparent margin that becomes part of its box on the page.
      const trimmed = await trimToPng(canvas);
      if (!trimmed) {
        setMessage("Nothing was drawn.");
        return;
      }
      await persist(trimmed.blob, trimmed.width, trimmed.height, "drawn");
    });
  }

  function saveTyped() {
    if (typed.trim() === "") {
      setMessage("Type your name first.");
      return;
    }

    startTransition(async () => {
      const rendered = await renderTypedSignature(typed, fontClass);
      if (!rendered) {
        setMessage("That could not be rendered.");
        return;
      }
      await persist(rendered.blob, rendered.width, rendered.height, "typed");
    });
  }

  function saveUploaded(file: File) {
    if (file.size > MAX_SIGNATURE_BYTES) {
      setMessage("That file is over 1 MB.");
      return;
    }
    if (file.type !== "image/png") {
      setMessage("Upload a PNG with a transparent background.");
      return;
    }

    startTransition(async () => {
      const size = await readSize(file);
      await persist(file, size.width, size.height, "uploaded");
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-0.5 rounded-md border border-border bg-surface-muted p-0.5">
          {MODES.map((option) => (
            <button
              key={option.mode}
              type="button"
              onClick={() => setMode(option.mode)}
              aria-pressed={mode === option.mode}
              className={cn(
                "rounded-[5px] px-3 py-1.5 text-sm transition-colors",
                mode === option.mode
                  ? "bg-surface font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex gap-0.5 rounded-md border border-border bg-surface-muted p-0.5">
          {SIGNATURE_KINDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setKind(option)}
              aria-pressed={kind === option}
              className={cn(
                "rounded-[5px] px-3 py-1.5 text-sm transition-colors",
                kind === option
                  ? "bg-surface font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {KIND_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      {message ? <Alert tone="error">{message}</Alert> : null}

      {mode === "draw" ? (
        <div className="space-y-3">
          <SignaturePad ref={padRef} />
          <div className="flex items-center gap-2">
            <Button onClick={saveDrawn} disabled={pending} size="sm">
              <Check aria-hidden />
              {pending ? "Saving…" : `Save ${KIND_LABELS[kind].toLowerCase()}`}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                padRef.current?.clear();
                setMessage(null);
              }}
            >
              Clear
            </Button>
            <span className="text-xs text-muted-foreground">
              Blank space is trimmed automatically.
            </span>
          </div>
        </div>
      ) : null}

      {mode === "type" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="typed">Your name</Label>
            <Input
              id="typed"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={kind === "initials" ? "JB" : "Joao Bernardo"}
              maxLength={60}
            />
          </div>

          <div className="flex min-h-28 items-center justify-center rounded-md border border-border bg-surface px-4">
            <span
              className={cn("text-5xl leading-tight", fontClass)}
              style={{ fontFamily: "var(--font-caveat), cursive" }}
            >
              {typed.trim() || "Preview"}
            </span>
          </div>

          <Button onClick={saveTyped} disabled={pending} size="sm">
            <Check aria-hidden />
            {pending ? "Saving…" : `Save ${KIND_LABELS[kind].toLowerCase()}`}
          </Button>
        </div>
      ) : null}

      {mode === "upload" ? (
        <div className="space-y-3">
          <div className="rounded-md border border-dashed border-border-strong bg-surface-muted px-6 py-10 text-center">
            <Upload className="mx-auto mb-3 size-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">Upload a PNG</p>
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
              A transparent background works best — a white one will cover whatever it is
              placed over.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              disabled={pending}
              onClick={() => fileRef.current?.click()}
            >
              Choose file
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) saveUploaded(file);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function readSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve({ width: 400, height: 160 });
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}
