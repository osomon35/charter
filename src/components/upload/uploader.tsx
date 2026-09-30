"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileText, Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { renderFirstPageThumbnail } from "@/lib/thumbnail";
import { beginUpload, finalizeUpload } from "@/lib/contracts/actions";
import { MAX_UPLOAD_BYTES, STORAGE_BUCKET, formatBytes } from "@/lib/contracts/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ItemStatus = "queued" | "uploading" | "verifying" | "done" | "error";

type QueueItem = {
  key: string;
  name: string;
  size: number;
  status: ItemStatus;
  progress: number;
  error?: string;
  contractId?: string;
};

const STATUS_TEXT: Record<ItemStatus, string> = {
  queued: "Queued",
  uploading: "Uploading",
  verifying: "Checking",
  done: "Added",
  error: "Failed",
};

let keySeed = 0;

export function Uploader() {
  const router = useRouter();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Nested dragenter/dragleave events fire constantly; counting them is the
  // only reliable way to know when the pointer has truly left the zone.
  const dragDepth = useRef(0);

  const patch = useCallback((key: string, next: Partial<QueueItem>) => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...next } : item)),
    );
  }, []);

  const upload = useCallback(
    async (file: File, key: string) => {
      patch(key, { status: "uploading", progress: 5 });

      const ticket = await beginUpload({ fileName: file.name, byteSize: file.size });
      if (!ticket.ok) {
        patch(key, { status: "error", error: ticket.error });
        return;
      }

      const supabase = createClient();

      // Straight to Supabase Storage. These bytes never touch the app server,
      // which has a ~4.5 MB request cap on Vercel.
      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .uploadToSignedUrl(ticket.pdf.path, ticket.pdf.token, file, {
          contentType: "application/pdf",
        });

      if (uploadError) {
        patch(key, { status: "error", error: "The upload failed. Try again." });
        return;
      }

      patch(key, { progress: 65, status: "verifying" });

      // Best effort. A missing thumbnail costs a preview tile, nothing more.
      let thumbnailUploaded = false;
      const thumbnail = await renderFirstPageThumbnail(file);
      if (thumbnail) {
        const { error: thumbError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .uploadToSignedUrl(ticket.thumbnail.path, ticket.thumbnail.token, thumbnail, {
            contentType: "image/png",
          });
        thumbnailUploaded = !thumbError;
      }

      patch(key, { progress: 85 });

      const result = await finalizeUpload({
        versionId: ticket.versionId,
        thumbnailUploaded,
      });

      if (!result.ok) {
        patch(key, { status: "error", error: result.error });
        return;
      }

      patch(key, {
        status: "done",
        progress: 100,
        contractId: result.contractId,
      });
      router.refresh();
    },
    [patch, router],
  );

  const accept = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files);
      if (incoming.length === 0) return;

      const queued: QueueItem[] = incoming.map((file) => {
        keySeed += 1;
        const key = `f${keySeed}`;

        // Cheap client-side screening for immediate feedback. The server
        // re-checks the real bytes either way.
        let error: string | undefined;
        if (file.size > MAX_UPLOAD_BYTES) {
          error = "Over the 50 MB limit.";
        } else if (file.size === 0) {
          error = "That file is empty.";
        } else if (
          file.type !== "application/pdf" &&
          !file.name.toLowerCase().endsWith(".pdf")
        ) {
          error = "Only PDFs can be uploaded.";
        }

        return {
          key,
          name: file.name,
          size: file.size,
          status: error ? "error" : "queued",
          progress: 0,
          error,
        };
      });

      setItems((current) => [...queued, ...current]);

      // Sequential, not parallel: several large PDFs at once starve each other
      // and make every progress bar crawl.
      void (async () => {
        for (const [index, file] of incoming.entries()) {
          const item = queued[index];
          if (!item || item.status === "error") continue;
          await upload(file, item.key);
        }
      })();
    },
    [upload],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (event.dataTransfer?.files?.length) {
        accept(event.dataTransfer.files);
      }
    },
    [accept],
  );

  const pending = items.filter((item) => item.status !== "done" && item.status !== "error");

  return (
    <div className="space-y-4">
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragging(false);
          }
        }}
        onDrop={onDrop}
        className={cn(
          "rounded-lg border border-dashed px-6 py-12 text-center transition-colors",
          dragging
            ? "border-primary bg-primary-subtle"
            : "border-border-strong bg-surface-muted",
        )}
      >
        <Upload className="mx-auto mb-3 size-5 text-muted-foreground" aria-hidden />
        <p className="text-[15px] font-medium">Drop PDFs here</p>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
          Or choose files from your computer. Up to 50 MB each.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => inputRef.current?.click()}
        >
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) accept(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {items.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-3 bg-surface px-4 py-3">
              {item.status === "done" ? (
                <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
              ) : item.status === "error" ? (
                <X className="size-4 shrink-0 text-destructive" aria-hidden />
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {item.error ?? `${STATUS_TEXT[item.status]} · ${formatBytes(item.size)}`}
                </p>
                {item.status === "uploading" || item.status === "verifying" ? (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                ) : null}
              </div>

              {item.status === "done" && item.contractId ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push(`/contracts/${item.contractId}`)}
                >
                  Open
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {pending.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {pending.length} file{pending.length === 1 ? "" : "s"} still working. Leaving this
          page will cancel them.
        </p>
      ) : null}
    </div>
  );
}
