"use client";

import { useCallback, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toSearchParams, type Filters } from "@/lib/contracts/filters";

/**
 * Writes filter changes back into the URL.
 *
 * The URL is the single source of truth, so a control never holds its own copy
 * of a value — it reads the current filters and pushes a new set. Any change
 * except paging resets to page 1, since page 4 of a different filter is
 * meaningless and usually empty.
 */
export function useFilters(current: Filters) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = useCallback(
    (patch: Partial<Filters>) => {
      const next: Filters = {
        ...current,
        ...patch,
        page: patch.page ?? 1,
      };
      startTransition(() => {
        router.push(`/contracts${toSearchParams(next)}`, { scroll: false });
      });
    },
    [current, router],
  );

  const reset = useCallback(() => {
    startTransition(() => {
      router.push(
        `/contracts${toSearchParams({ view: current.view, layout: current.layout })}`,
        { scroll: false },
      );
    });
  }, [current.view, current.layout, router]);

  return { update, reset, pending, params };
}
