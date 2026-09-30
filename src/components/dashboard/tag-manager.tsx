"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createTag, deleteTag } from "@/lib/contracts/organise-actions";
import {
  TAG_COLORS,
  TAG_COLOR_CLASSES,
  TAG_SWATCHES,
  type TagColor,
} from "@/lib/contracts/types";
import type { TagRow } from "@/lib/contracts/row-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export function TagManager({ tags }: { tags: TagRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("slate");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    if (!name.trim()) return;
    startTransition(async () => {
      const result = await createTag({ name, color });
      if (result.ok) {
        setName("");
        setError(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag.id} className="flex items-center gap-1">
              <Badge className={TAG_COLOR_CLASSES[tag.color]}>{tag.name}</Badge>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await deleteTag(tag.id);
                    router.refresh();
                  })
                }
                aria-label={`Delete ${tag.name}`}
                className="rounded p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No tags yet. They are shared across every contract, so a handful goes a long way.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <div className="min-w-40 flex-1 space-y-2">
          <Label htmlFor="tag-name">New tag</Label>
          <Input
            id="tag-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && add()}
            placeholder="Retainer"
            maxLength={60}
          />
        </div>

        <div className="space-y-2">
          <Label>Colour</Label>
          <div className="flex items-center gap-1.5">
            {TAG_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setColor(option)}
                aria-label={option}
                aria-pressed={color === option}
                style={{ backgroundColor: TAG_SWATCHES[option] }}
                className={cn(
                  "size-6 rounded-full border transition-transform",
                  color === option
                    ? "scale-110 border-foreground"
                    : "border-transparent opacity-70",
                )}
              />
            ))}
          </div>
        </div>

        <Button size="sm" onClick={add} disabled={pending || !name.trim()}>
          <Plus aria-hidden />
          Add tag
        </Button>
      </div>
    </div>
  );
}
