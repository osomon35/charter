"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Column order and widths for the contracts table.
 *
 * Kept in localStorage rather than the URL: this is how one person likes their
 * table, not a view worth sharing, and putting it in the query string would make
 * every link carry layout noise.
 *
 * The select checkbox and the row action stay pinned either side and are not part
 * of the model — reordering them has no meaning, and a zero-width checkbox column
 * would be a trap.
 */
export const COLUMN_KEYS = [
  "title",
  "counterparty",
  "status",
  "tags",
  "updated",
] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  title: "Title",
  counterparty: "Counterparty",
  status: "Status",
  tags: "Tags",
  updated: "Updated",
};

/**
 * Proportions, not pixels.
 *
 * The list is a CSS grid whose columns are fr units, so these numbers become
 * ratios and the row can never be wider than its container. A fixed-layout table
 * could still overflow when its column widths exceeded the available space, which
 * is exactly what it did.
 */
export const DEFAULT_WIDTHS: Record<ColumnKey, number> = {
  title: 280,
  counterparty: 170,
  status: 140,
  tags: 180,
  updated: 110,
};

export const MIN_WIDTH = 60;
export const MAX_WIDTH = 600;

const STORAGE_KEY = "charter-contract-columns";

/** Drag type for column reordering. Its own type so nothing else is mistaken for it. */
export const COLUMN_DRAG_TYPE = "application/x-charter-column";

export type ColumnConfig = {
  order: ColumnKey[];
  widths: Record<ColumnKey, number>;
};

const DEFAULTS: ColumnConfig = { order: [...COLUMN_KEYS], widths: { ...DEFAULT_WIDTHS } };

function sanitise(raw: unknown): ColumnConfig {
  if (!raw || typeof raw !== "object") return DEFAULTS;
  const value = raw as Partial<ColumnConfig>;

  // Rebuild rather than trust: a stored order from an older version may be
  // missing a column or naming one that no longer exists, and a table with a
  // vanished column is worse than a reset one.
  const stored = Array.isArray(value.order) ? value.order : [];
  const known = stored.filter((key): key is ColumnKey =>
    (COLUMN_KEYS as readonly string[]).includes(key),
  );
  const order = [...new Set([...known, ...COLUMN_KEYS])];

  const widths = { ...DEFAULT_WIDTHS };
  for (const key of COLUMN_KEYS) {
    const width = value.widths?.[key];
    if (typeof width === "number" && Number.isFinite(width)) {
      widths[key] = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
    }
  }

  return { order, widths };
}

export function useColumnConfig() {
  // Starts at the defaults so the server and the first client render agree;
  // anything stored is applied after mount.
  const [config, setConfig] = useState<ColumnConfig>(DEFAULTS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setConfig(sanitise(JSON.parse(raw)));
    } catch {
      // Blocked storage or malformed JSON: the defaults are perfectly usable.
    }
  }, []);

  const persist = useCallback((next: ColumnConfig) => {
    setConfig(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The layout just will not survive a reload.
    }
  }, []);

  const move = useCallback(
    (from: ColumnKey, to: ColumnKey) => {
      if (from === to) return;
      setConfig((current) => {
        const order = [...current.order];
        const fromIndex = order.indexOf(from);
        const toIndex = order.indexOf(to);
        if (fromIndex < 0 || toIndex < 0) return current;

        order.splice(fromIndex, 1);
        order.splice(toIndex, 0, from);

        const next = { ...current, order };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [],
  );

  const resize = useCallback((key: ColumnKey, width: number) => {
    setConfig((current) => {
      const next = {
        ...current,
        widths: {
          ...current.widths,
          [key]: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width))),
        },
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => persist(DEFAULTS), [persist]);

  return { config, move, resize, reset };
}
