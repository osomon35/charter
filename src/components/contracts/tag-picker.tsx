"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setContractTags } from "@/lib/contracts/organise-actions";
import { TAG_COLOR_CLASSES } from "@/lib/contracts/types";
import type { TagRow } from "@/lib/contracts/row-types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Toggles tags on one contract. Saves on each click — there is no Save button
 *  because there is nothing else on the control to get wrong. */
export function TagPicker({
  contractId,
  allTags,
  assigned,
}: {
  contractId: string;
  allTags: TagRow[];
  assigned: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(assigned);
  const [pending, startTransition] = useTransition();

  if (allTags.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No tags exist yet. Create some under Manage tags on the contracts list.
      </p>
    );
  }

  function toggle(tagId: string) {
    const next = selected.includes(tagId)
      ? selected.filter((entry) => entry !== tagId)
      : [...selected, tagId];

    // Optimistic: the click reads as instant and the server call is a formality
    // that only ever confirms it.
    setSelected(next);
    startTransition(async () => {
      await setContractTags({ contractId, tagIds: next });
      router.refresh();
    });
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", pending ? "opacity-70" : "")}>
      {allTags.map((tag) => {
        const active = selected.includes(tag.id);
        return (
          <button key={tag.id} type="button" onClick={() => toggle(tag.id)} aria-pressed={active}>
            <Badge
              className={cn(
                TAG_COLOR_CLASSES[tag.color],
                active ? "ring-1 ring-primary" : "opacity-50",
              )}
            >
              {tag.name}
            </Badge>
          </button>
        );
      })}
    </div>
  );
}
