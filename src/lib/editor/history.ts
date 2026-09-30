import type { OverlayElement } from "@/lib/editor/types";

/**
 * Undo/redo over whole snapshots of the element list.
 *
 * Snapshots rather than inverse operations: the lists are small (tens of
 * elements), and every edit path — drag, resize, retype, recolour, delete —
 * then gets undo for free instead of each needing its own inverse.
 *
 * Commits happen at gesture boundaries, not per pointer move, so one drag is
 * one undo step.
 */
export type HistoryState = {
  past: OverlayElement[][];
  present: OverlayElement[];
  future: OverlayElement[][];
};

const LIMIT = 100;

export function initHistory(elements: OverlayElement[]): HistoryState {
  return { past: [], present: elements, future: [] };
}

export function commit(state: HistoryState, next: OverlayElement[]): HistoryState {
  if (next === state.present) return state;
  return {
    past: [...state.past, state.present].slice(-LIMIT),
    present: next,
    future: [],
  };
}

/** Changes the present without recording a step — for in-progress drags. */
export function replace(state: HistoryState, next: OverlayElement[]): HistoryState {
  return { ...state, present: next };
}

export function undo(state: HistoryState): HistoryState {
  const previous = state.past[state.past.length - 1];
  if (!previous) return state;
  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future].slice(0, LIMIT),
  };
}

export function redo(state: HistoryState): HistoryState {
  const next = state.future[0];
  if (!next) return state;
  return {
    past: [...state.past, state.present].slice(-LIMIT),
    present: next,
    future: state.future.slice(1),
  };
}

export const canUndo = (state: HistoryState) => state.past.length > 0;
export const canRedo = (state: HistoryState) => state.future.length > 0;
