"use client";

/**
 * Drag payload helpers.
 *
 * HTML5 drag-and-drop fails silently in three specific ways, and the folder drop
 * hit all of them:
 *
 *   1. A drag carrying only a custom MIME type does not start in every browser.
 *      At least one standard type — text/plain — has to be set, or dragstart
 *      produces nothing usable and no drop ever follows.
 *   2. dragover must call preventDefault to mark the element a drop target, and
 *      so must dragenter in some browsers.
 *   3. dropEffect must be set during dragover. Without it the cursor shows
 *      "no drop" and the drop event never fires, even though dragover ran.
 *
 * Centralising it means no drop target can be written that forgets one.
 */
export const CONTRACT_DRAG_TYPE = "application/x-charter-contracts";
export const FOLDER_DRAG_TYPE = "application/x-charter-folder";
export const COLUMN_DRAG_TYPE = "application/x-charter-column";

export function startContractDrag(event: React.DragEvent, ids: string): void {
  event.dataTransfer.setData(CONTRACT_DRAG_TYPE, ids);
  // The standard type is what makes the drag valid at all; it is never read.
  event.dataTransfer.setData("text/plain", ids);
  event.dataTransfer.effectAllowed = "move";
}

export function startFolderDrag(event: React.DragEvent, folderId: string): void {
  event.dataTransfer.setData(FOLDER_DRAG_TYPE, folderId);
  event.dataTransfer.setData("text/plain", folderId);
  event.dataTransfer.effectAllowed = "move";
}

/** True when the drag in flight is something a folder can accept. */
export function carriesDroppable(event: React.DragEvent): boolean {
  const types = Array.from(event.dataTransfer.types);
  return types.includes(CONTRACT_DRAG_TYPE) || types.includes(FOLDER_DRAG_TYPE);
}

/**
 * Marks an element as accepting the drag. Call from BOTH dragenter and dragover.
 *
 * getData is deliberately not called here — during a drag it returns an empty
 * string for security, so the drag's types are the only thing readable until
 * drop. That is why acceptance is decided by type and the payload is read later.
 */
export function acceptDrag(event: React.DragEvent): boolean {
  if (!carriesDroppable(event)) return false;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  return true;
}

export type DropPayload =
  | { kind: "contracts"; ids: string[] }
  | { kind: "folder"; id: string }
  | null;

export function readDrop(event: React.DragEvent): DropPayload {
  const contracts = event.dataTransfer.getData(CONTRACT_DRAG_TYPE);
  if (contracts) {
    const ids = contracts.split(",").map((id) => id.trim()).filter(Boolean);
    return ids.length > 0 ? { kind: "contracts", ids } : null;
  }

  const folder = event.dataTransfer.getData(FOLDER_DRAG_TYPE);
  return folder ? { kind: "folder", id: folder } : null;
}
