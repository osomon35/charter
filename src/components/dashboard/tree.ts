import type { FolderNode } from "@/lib/contracts/row-types";

/**
 * Client-side copy of the tree flattener.
 *
 * dashboard-queries.ts is `server-only`, so importing its helper into a client
 * component would be a build error. The shape is small enough that duplicating
 * the walk beats restructuring the module boundary.
 */
export function flattenTreeClient(nodes: FolderNode[]): FolderNode[] {
  return nodes.flatMap((node) => [node, ...flattenTreeClient(node.children)]);
}
