"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";
import { createTag, setContractTags } from "@/lib/contracts/organise-actions";
import {
  TAG_COLORS,
  TAG_COLOR_CLASSES,
  TAG_SWATCHES,
  type TagColor,
} from "@/lib/contracts/types";
import type { TagRow } from "@/lib/contracts/row-types";
import { Popover } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Click a row's tags to change them, and create a new tag without leaving.
 *
 * Creating in place is the point: tagging usually reveals the tag you needed, and
 * sending someone to a separate screen to make it loses the thought. createTag
 * returns the new id so it can be applied to this contract at once, which is
 * always why it was being created.
 */
export function TagCell({
  contractId,
  allTags,
  assigned,
}: {
  contractId: string;
  allTags: TagRow[];
  assigned: TagRow[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(assigned.map((tag) => tag.id));
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<TagColor>("slate");
  const [error, setError] = useState<string | null>(null);

  const shown = allTags.filter((tag) => selected.includes(tag.id));

  function save(next: string[]) {
    setSelected(next);
    startTransition(async () => {
      await setContractTags({ contractId, tagIds: next });
      router.refresh();
    });
  }

  function addNew() {
    const name = newName.trim();
    if (!name) return;

    startTransition(async () => {
      const result = await createTag({ name, color: newColor });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNewName("");
      setError(null);

      // Apply it straight away — creating a tag from a row is never idle curiosity.
      const next = [...selected, result.id];
      setSelected(next);
      await setContractTags({ contractId, tagIds: next });
      router.refresh();
    });
  }

  return (
    <Popover
      align="end"
      className="w-64"
      trigger={() => (
        <span
          className={cn(
            "flex min-h-6 flex-wrap items-center gap-1 rounded-md px-1 py-0.5",
            "cursor-pointer hover:bg-muted",
            pending ? "opacity-60" : "",
          )}
        >
          {shown.length > 0 ? (
            shown.map((tag) => (
              <Badge key={tag.id} className={TAG_COLOR_CLASSES[tag.color]}>
                {tag.name}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">Add tags</span>
          )}
        </span>
      )}
    >
      {() => (
        <div className="space-y-2">
          {allTags.length > 0 ? (
            <ul className="max-h-56 overflow-y-auto">
              {allTags.map((tag) => {
                const active = selected.includes(tag.id);
                return (
                  <li key={tag.id}>
                    <button
                      type="button"
                      onClick={() =>
                        save(
                          active
                            ? selected.filter((id) => id !== tag.id)
                            : [...selected, tag.id],
                        )
                      }
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                    >
                      <Check
                        className={cn("size-3 shrink-0", active ? "" : "invisible")}
                        aria-hidden
                      />
                      <Badge className={TAG_COLOR_CLASSES[tag.color]}>{tag.name}</Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="space-y-2 border-t border-border p-2">
            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addNew();
                }
              }}
              placeholder="New tag name"
              maxLength={60}
              className="h-7 text-xs"
            />

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                {TAG_COLORS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setNewColor(option)}
                    aria-label={option}
                    aria-pressed={newColor === option}
                    style={{ backgroundColor: TAG_SWATCHES[option] }}
                    className={cn(
                      "size-4 rounded-full border transition-transform",
                      newColor === option
                        ? "scale-110 border-foreground"
                        : "border-transparent opacity-70",
                    )}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={addNew}
                disabled={pending || !newName.trim()}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
              >
                <Plus className="size-3" aria-hidden />
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </Popover>
  );
}
