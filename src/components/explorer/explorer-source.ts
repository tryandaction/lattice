/** Rendering data only. Source IDs are never paths or local filesystem handles. */
export interface ExplorerSourceNode {
  id: string;
  name: string;
  kind: "file" | "directory";
  extension?: string;
  children?: ExplorerSourceNode[];
  isExpanded?: boolean;
  childrenState?: "idle" | "loading" | "ready" | "error";
  error?: string;
}

export type ExplorerCreateKind = "note" | "notebook" | "file" | "directory";
type Operation = void | Promise<unknown>;

/** Explicit operation boundary for a source that is not the local filesystem. */
export interface ExplorerSourceAdapter {
  id: string;
  label: string;
  root: ExplorerSourceNode | null;
  selectedId: string | null;
  loading: boolean;
  error?: string | null;
  readOnly?: boolean;
  select(node: ExplorerSourceNode): void;
  toggle(node: ExplorerSourceNode): Operation;
  open(node: ExplorerSourceNode): Operation;
  refresh(): Operation;
  rename?(node: ExplorerSourceNode, name: string): Operation;
  remove?(node: ExplorerSourceNode): Operation;
  create?(kind: ExplorerCreateKind, parent: ExplorerSourceNode): Operation;
  upload?(files: File[], parent: ExplorerSourceNode): Operation;
  move?(node: ExplorerSourceNode, parent: ExplorerSourceNode): Operation;
  download?(node: ExplorerSourceNode): Operation;
}

export function findSourceNode(root: ExplorerSourceNode | null, id: string | null): ExplorerSourceNode | null {
  if (!root || !id) return null;
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const result = findSourceNode(child, id);
    if (result) return result;
  }
  return null;
}

export function sourceCreationTarget(root: ExplorerSourceNode | null, selectedId: string | null): ExplorerSourceNode | null {
  if (!root) return null;
  if (root.id === selectedId && root.kind === "directory") return root;
  for (const child of root.children ?? []) {
    if (child.id === selectedId) return child.kind === "directory" ? child : root;
    if (findSourceNode(child, selectedId)) return sourceCreationTarget(child, selectedId);
  }
  return root.kind === "directory" ? root : null;
}
