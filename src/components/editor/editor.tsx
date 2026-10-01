"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Image as ImageIcon,
  Minus,
  Plus,
  Redo2,
  Square,
  Type,
  Undo2,
} from "lucide-react";
import { loadPdfjs, type PdfDocument } from "@/lib/pdfjs";
import { createClient } from "@/lib/supabase/client";
import {
  beginImageUpload,
  flattenToNewVersion,
  getAssetUrl,
  getVersionUrl,
  saveOverlay,
} from "@/lib/editor/actions";
import {
  newElement,
  todayLabel,
  type ElementType,
  type OverlayElement,
} from "@/lib/editor/types";
import {
  canRedo,
  canUndo,
  commit,
  initHistory,
  redo,
  replace,
  undo,
  type HistoryState,
} from "@/lib/editor/history";
import { clamp01, snapPosition, type Guide } from "@/lib/editor/snapping";
import { STORAGE_BUCKET } from "@/lib/contracts/types";
import { placeSignatureOnContract } from "@/lib/signatures/actions";
import type { SignatureRecord } from "@/lib/signatures/types";
import { usePageImages } from "@/lib/pdf-pages";
import { PageImageView } from "@/components/editor/page-image";
import { ElementBox, type DragKind } from "@/components/editor/element-box";
import { Inspector } from "@/components/editor/inspector";
import { SignaturePicker } from "@/components/editor/signature-picker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Tool = ElementType | "date" | null;

const MIN_SIZE = 0.004;

const TOOLS: { tool: Exclude<Tool, null>; label: string; Icon: typeof Type }[] = [
  { tool: "text", label: "Text", Icon: Type },
  { tool: "whiteout", label: "White-out", Icon: Square },
  { tool: "check", label: "Check", Icon: Check },
  { tool: "date", label: "Date", Icon: CalendarDays },
  { tool: "image", label: "Image", Icon: ImageIcon },
];

export function Editor({
  contractId,
  contractTitle,
  versionId,
  sourceVersionNo,
  latestVersionNo,
  pageCount,
  initialElements,
}: {
  contractId: string;
  contractTitle: string;
  /** The original upload. Overlays always render against this, never the latest. */
  versionId: string;
  sourceVersionNo: number;
  latestVersionNo: number;
  pageCount: number;
  initialElements: OverlayElement[];
}) {
  const router = useRouter();

  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryState>(() => initHistory(initialElements));
  const [guides, setGuides] = useState<Guide[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});

  const { pages, rendered, total, error: renderError } = usePageImages(doc, pageCount);

  /** The page currently shown, with its pixel and point dimensions. */
  const current = pages[page - 1] ?? null;
  const pointWidth = current?.ptWidth ?? 612;
  const pointHeight = current?.ptHeight ?? 792;

  const viewportRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const elements = history.present;
  const selected = elements.find((element) => element.id === selectedId) ?? null;
  const onThisPage = useMemo(
    () => elements.filter((element) => element.page === page),
    [elements, page],
  );
  const lockedCount = useMemo(
    () => elements.filter((element) => element.locked === true).length,
    [elements],
  );


  // --- open the document -------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let opened: PdfDocument | null = null;

    (async () => {
      const signed = await getVersionUrl(versionId);
      if (!signed.ok) {
        setLoadError(signed.error);
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
        console.error("editor_open_failed", err);
        setLoadError("This document could not be opened for editing.");
      }
    })();

    return () => {
      cancelled = true;
      void opened?.destroy();
    };
  }, [versionId]);

  // --- resolve signed URLs for placed images -----------------------------
  useEffect(() => {
    const missing = [
      ...new Set(
        elements
          .filter((element) => element.type === "image")
          .map((element) => (element.type === "image" ? element.assetPath : ""))
          .filter((path) => path && !assetUrls[path]),
      ),
    ];
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      const resolved: Record<string, string> = {};
      for (const path of missing) {
        const url = await getAssetUrl(contractId, path);
        if (url) resolved[path] = url;
      }
      if (!cancelled && Object.keys(resolved).length > 0) {
        setAssetUrls((current) => ({ ...current, ...resolved }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [elements, assetUrls, contractId]);

  // --- fit to the viewport, then apply zoom ------------------------------
  const [fitWidth, setFitWidth] = useState(0);
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;

    const measure = () => {
      // 48px of breathing room either side, and never wider than the page's own
      // aspect ratio allows in the available height.
      const available = node.clientWidth - 96;
      const byHeight = ((node.clientHeight - 96) * pointWidth) / pointHeight;
      setFitWidth(Math.max(240, Math.min(available, byHeight, 1400)));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [pointWidth, pointHeight]);

  const cssWidth = Math.round(fitWidth * zoom);
  // Points to CSS pixels. Font sizes are stored in points, so this is what the
  // on-screen text has to be multiplied by to match the flattened output. Derived
  // from the laid-out width rather than measured, now that the page is an image
  // whose displayed width is exactly what CSS was told.
  const scale = cssWidth > 0 ? cssWidth / pointWidth : 1;

  // --- editing primitives ------------------------------------------------
  const commitElements = useCallback((next: OverlayElement[]) => {
    setHistory((current) => commit(current, next));
  }, []);

  const unlockAll = useCallback(() => {
    commitElements(elements.map((element) => ({ ...element, locked: false })));
  }, [elements, commitElements]);

  const patchSelected = useCallback(
    (patch: Partial<OverlayElement>) => {
      if (!selectedId) return;
      commitElements(
        elements.map((element) =>
          element.id === selectedId ? ({ ...element, ...patch } as OverlayElement) : element,
        ),
      );
    },
    [selectedId, elements, commitElements],
  );

  const setText = useCallback(
    (id: string, text: string) => {
      // Typing replaces the present rather than pushing a step per keystroke;
      // the drag/blur boundaries are what create undo points.
      setHistory((current) =>
        replace(
          current,
          current.present.map((element) =>
            element.id === id && element.type === "text" && element.locked !== true
              ? { ...element, text }
              : element,
          ),
        ),
      );
    },
    [],
  );

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    const target = elements.find((element) => element.id === selectedId);
    if (!target || target.locked === true) return;
    commitElements(elements.filter((element) => element.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, elements, commitElements]);

  const duplicateSelected = useCallback(() => {
    if (!selected) return;
    const copy = {
      ...selected,
      id: crypto.randomUUID(),
      x: clamp01(selected.x + 0.02),
      y: clamp01(selected.y + 0.02),
    } as OverlayElement;
    commitElements([...elements, copy]);
    setSelectedId(copy.id);
  }, [selected, elements, commitElements]);

  // --- placing ------------------------------------------------------------
  function placeAt(event: React.MouseEvent<HTMLDivElement>) {
    if (!tool || !pageRef.current) return;

    const rect = pageRef.current.getBoundingClientRect();
    const at = {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };

    if (tool === "image") {
      imageInputRef.current?.click();
      return;
    }

    const created =
      tool === "date"
        ? { ...newElement("text", page, at), text: todayLabel() }
        : newElement(tool, page, at);

    commitElements([...elements, created as OverlayElement]);
    setSelectedId(created.id);
    setTool(null);
  }

  async function addImage(file: File) {
    setBusy(true);
    setStatus("Uploading image…");
    try {
      const ticket = await beginImageUpload({ contractId, contentType: file.type });
      if (!ticket.ok) {
        setStatus(ticket.error);
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });

      if (error) {
        setStatus("That image could not be uploaded.");
        return;
      }

      const size = await readImageSize(file);
      const created = newElement("image", page, { x: 0.1, y: 0.1 }, {
        assetPath: ticket.path,
        naturalWidth: size.width,
        naturalHeight: size.height,
      });

      commitElements([...elements, created]);
      setSelectedId(created.id);
      setTool(null);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function placeSignature(signature: SignatureRecord) {
    setBusy(true);
    setStatus("Placing signature…");
    try {
      // The signature is copied into this contract's own asset prefix, so the
      // document keeps working if the profile signature is later deleted.
      const placed = await placeSignatureOnContract({
        contractId,
        signatureId: signature.id,
      });

      if (!placed.ok) {
        setStatus(placed.error);
        return;
      }

      const created = newElement("image", page, { x: 0.12, y: 0.62 }, {
        assetPath: placed.assetPath,
        naturalWidth: placed.width,
        naturalHeight: placed.height,
      });

      commitElements([...elements, created]);
      setSelectedId(created.id);
      setTool(null);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  // --- drag and resize ----------------------------------------------------
  function startGesture(event: React.PointerEvent, id: string, kind: DragKind) {
    const target = elements.find((element) => element.id === id);
    if (!target || target.locked === true || !pageRef.current) return;

    event.preventDefault();
    const rect = pageRef.current.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { x: target.x, y: target.y, w: target.w, h: target.h };
    const others = elements.filter((element) => element.page === page && element.id !== id);

    // Pointer capture keeps the gesture alive when the cursor leaves the box,
    // which happens constantly when resizing from a small handle.
    const node = event.currentTarget as HTMLElement;
    node.setPointerCapture(event.pointerId);

    let latest = origin;

    function onMove(moveEvent: PointerEvent) {
      const dx = (moveEvent.clientX - startX) / rect.width;
      const dy = (moveEvent.clientY - startY) / rect.height;

      let next = { ...origin };

      if (kind === "move") {
        next.x = origin.x + dx;
        next.y = origin.y + dy;

        if (!moveEvent.altKey) {
          const snapped = snapPosition({ ...next }, others, {
            width: rect.width,
            height: rect.height,
          });
          next.x = snapped.x;
          next.y = snapped.y;
          setGuides(snapped.guides);
        } else {
          setGuides([]);
        }
      } else {
        next = resize(origin, kind, dx, dy);
        setGuides([]);
      }

      latest = next;
      setHistory((current) =>
        replace(
          current,
          current.present.map((element) =>
            element.id === id ? ({ ...element, ...next } as OverlayElement) : element,
          ),
        ),
      );
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setGuides([]);
      // One undo step per gesture, recorded at the end.
      setHistory((current) =>
        commit(
          { ...current, present: elements },
          current.present.map((element) =>
            element.id === id ? ({ ...element, ...latest } as OverlayElement) : element,
          ),
        ),
      );
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // --- keyboard -----------------------------------------------------------
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const editingText =
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement instanceof HTMLInputElement;

      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setHistory((current) => (event.shiftKey ? redo(current) : undo(current)));
        return;
      }

      if (editingText) return;

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        deleteSelected();
        return;
      }

      if (event.key === "Escape") {
        setTool(null);
        setSelectedId(null);
        return;
      }

      // Arrow nudges: 1pt normally, 10 with shift.
      const selectedLocked =
        elements.find((element) => element.id === selectedId)?.locked === true;

      if (selectedId && !selectedLocked && event.key.startsWith("Arrow")) {
        event.preventDefault();
        const step = (event.shiftKey ? 10 : 1) / pointWidth;
        const stepY = (event.shiftKey ? 10 : 1) / pointHeight;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -stepY : event.key === "ArrowDown" ? stepY : 0;
        commitElements(
          elements.map((element) =>
            element.id === selectedId
              ? { ...element, x: element.x + dx, y: element.y + dy }
              : element,
          ),
        );
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelected, selectedId, elements, commitElements, pointWidth, pointHeight]);

  // --- persistence --------------------------------------------------------
  async function save() {
    setBusy(true);
    setStatus("Saving…");
    const result = await saveOverlay({ contractId, baseVersionId: versionId, elements });
    setStatus(result.ok ? "Saved" : result.error);
    setBusy(false);
  }

  async function flatten() {
    setBusy(true);
    setStatus("Flattening…");
    const result = await flattenToNewVersion({
      contractId,
      baseVersionId: versionId,
      elements,
    });

    if (!result.ok) {
      setStatus(result.error);
      setBusy(false);
      return;
    }

    setStatus(`Saved as version ${result.versionNo}`);
    router.push(`/contracts/${contractId}`);
  }

  // Autosave, quietly, a couple of seconds after the last change.
  useEffect(() => {
    if (elements === initialElements) return;
    const timer = setTimeout(() => {
      void saveOverlay({ contractId, baseVersionId: versionId, elements });
    }, 2000);
    return () => clearTimeout(timer);
  }, [elements, initialElements, contractId, versionId]);

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* --- top bar --- */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3">
        <Link
          href={`/contracts/${contractId}`}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          <span className="hidden sm:inline">Back</span>
        </Link>

        <div className="hidden min-w-0 md:block">
          <span className="block truncate text-sm font-medium leading-tight">
            {contractTitle}
          </span>
          <span className="block truncate text-[11px] leading-tight text-muted-foreground">
            {latestVersionNo > sourceVersionNo
              ? `Editing on v${sourceVersionNo} · latest is v${latestVersionNo} · flatten makes v${latestVersionNo + 1}`
              : `Editing on v${sourceVersionNo} · flatten makes v${sourceVersionNo + 1}`}
          </span>
        </div>

        <div className="mx-auto flex items-center gap-1">
          {TOOLS.map(({ tool: value, label, Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTool(tool === value ? null : value)}
              title={label}
              aria-pressed={tool === value}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                tool === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              <span className="hidden lg:inline">{label}</span>
            </button>
          ))}

          <SignaturePicker onPick={placeSignature} disabled={busy} />

          <span className="mx-1 h-5 w-px bg-border" />

          <button
            type="button"
            onClick={() => setHistory(undo)}
            disabled={!canUndo(history)}
            title="Undo"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            <Undo2 className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setHistory(redo)}
            disabled={!canRedo(history)}
            title="Redo"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            <Redo2 className="size-4" aria-hidden />
          </button>
        </div>

        {status ? (
          <span className="hidden text-xs text-muted-foreground sm:inline">{status}</span>
        ) : null}

        <Button variant="outline" size="sm" onClick={save} disabled={busy}>
          Save draft
        </Button>
        <Button size="sm" onClick={flatten} disabled={busy || elements.length === 0}>
          Flatten
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* --- page --- */}
        <div
          ref={viewportRef}
          className="relative min-w-0 flex-1 overflow-auto bg-surface-muted"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setSelectedId(null);
          }}
        >
          {loadError ? (
            <p className="p-10 text-sm text-destructive">{loadError}</p>
          ) : renderError ? (
            <div className="p-10 text-sm">
              <p className="text-destructive">This document could not be rendered.</p>
              <p className="mt-1 text-xs text-muted-foreground">{renderError}</p>
              <a
                href={`/api/versions/${versionId}/file`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-xs underline underline-offset-2"
              >
                Open the PDF in a new tab
              </a>
            </div>
          ) : !doc ? (
            <p className="p-10 text-sm text-muted-foreground">Opening document…</p>
          ) : (
            <div className="flex min-h-full items-start justify-center p-12">
              <div
                ref={pageRef}
                onClick={placeAt}
                className={cn(
                  "relative shadow-sm ring-1 ring-border",
                  tool ? "cursor-crosshair" : "cursor-default",
                )}
                style={{ width: cssWidth }}
              >
                <PageImageView image={current} pageNumber={page} width={cssWidth} />

                {onThisPage.map((element) => (
                  <ElementBox
                    key={element.id}
                    element={element}
                    selected={element.id === selectedId}
                    scale={scale}
                    imageUrl={
                      element.type === "image" ? assetUrls[element.assetPath] : undefined
                    }
                    onSelect={() => setSelectedId(element.id)}
                    onPointerDownOn={(event, kind) => startGesture(event, element.id, kind)}
                    onTextChange={(text) => setText(element.id, text)}
                  />
                ))}

                {guides.map((guide, index) => (
                  <span
                    key={`${guide.axis}-${index}`}
                    aria-hidden
                    className="pointer-events-none absolute bg-primary/70"
                    style={
                      guide.axis === "x"
                        ? { left: `${guide.at * 100}%`, top: 0, bottom: 0, width: 1 }
                        : { top: `${guide.at * 100}%`, left: 0, right: 0, height: 1 }
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* --- inspector --- */}
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-border bg-surface lg:block">
          <Inspector
            element={selected}
            lockedCount={lockedCount}
            onChange={patchSelected}
            onDelete={deleteSelected}
            onDuplicate={duplicateSelected}
            onUnlockAll={unlockAll}
          />
        </aside>
      </div>

      {/* --- bottom bar --- */}
      <footer className="flex h-12 shrink-0 items-center justify-between gap-4 border-t border-border px-4">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
            title="Previous page"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="min-w-20 text-center text-xs tabular-nums text-muted-foreground">
            Page {page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            disabled={page >= pageCount}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
            title="Next page"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>

        <span className="text-xs text-muted-foreground">
          {rendered < total ? `Rendering ${rendered}/${total}` : null}
          {rendered < total ? " · " : ""}
          {elements.length} element{elements.length === 1 ? "" : "s"}
        </span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
            title="Zoom out"
          >
            <Minus className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="min-w-14 rounded-md px-1 text-xs tabular-nums text-muted-foreground hover:bg-muted"
            title="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.1) * 10) / 10))}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
            title="Zoom in"
          >
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
      </footer>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void addImage(file);
        }}
      />
    </div>
  );
}

/** Applies a resize handle's drag to a box, keeping it above a minimum size. */
function resize(
  origin: { x: number; y: number; w: number; h: number },
  kind: DragKind,
  dx: number,
  dy: number,
): { x: number; y: number; w: number; h: number } {
  const next = { ...origin };

  if (kind.includes("e")) next.w = Math.max(MIN_SIZE, origin.w + dx);
  if (kind.includes("s")) next.h = Math.max(MIN_SIZE, origin.h + dy);

  if (kind.includes("w")) {
    const w = Math.max(MIN_SIZE, origin.w - dx);
    next.x = origin.x + (origin.w - w);
    next.w = w;
  }
  if (kind.includes("n")) {
    const h = Math.max(MIN_SIZE, origin.h - dy);
    next.y = origin.y + (origin.h - h);
    next.h = h;
  }

  return next;
}

function readImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve({ width: 300, height: 120 });
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}
