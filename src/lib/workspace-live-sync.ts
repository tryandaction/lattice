import type { DirectoryNode, TreeNode } from "@/types/file-system";

export interface WorkspaceFileChange {
  watchId: string;
  paths: string[];
  renames?: Array<{ from: string; to: string }>;
  rescan?: boolean;
}

const parent = (path: string) => path.slice(0, path.lastIndexOf("/"));
const within = (path: string, ancestor: string) => path === ancestor || path.startsWith(ancestor + "/");

export function resolveWorkspaceRenamedPath(path: string, renames: readonly { from: string; to: string }[]): string {
  return renames.reduce((current, move) => within(current, move.from)
    ? move.to + current.slice(move.from.length) : current, path);
}

export function shouldRefreshWorkspaceSnapshot(previous: string | undefined, next: string, explicitEvent: boolean, binary: boolean): boolean {
  // A first metadata observation establishes a baseline. Reopening the same PDF
  // immediately would cancel its ongoing identity/annotation initialization.
  return previous === undefined ? explicitEvent || !binary : previous !== next;
}

/** Reconcile visible branches only, retaining row/handle identity when unchanged. */
export async function reconcileVisibleDirectory(
  node: DirectoryNode,
  read: (directory: DirectoryNode) => Promise<TreeNode[]>,
  changedPaths?: readonly string[],
  current: () => boolean = () => true,
): Promise<DirectoryNode> {
  if (!current()) return node;
  const affected = !changedPaths || changedPaths.some(path => within(path, node.path));
  if (!affected) return node;
  // A collapsed branch is intentionally kept opaque. Its existing children and
  // loading state remain stable until the user expands it.
  if (!node.isExpanded) return node.childrenState !== "idle" ? { ...node, childrenState: "idle" } : node;
  const readSelf = !changedPaths || changedPaths.some(path => path === node.path || parent(path) === node.path);
  let fresh = node.children;
  if (readSelf) {
    try {
      fresh = await read(node);
    } catch {
      if (!current()) return node;
      // Native change events are edge-triggered; retry one transient directory
      // read failure so a single failed event does not leave the branch stale.
      await new Promise(resolve => setTimeout(resolve, 100));
      if (!current()) return node;
      try { fresh = await read(node); } catch { return node; }
    }
    if (!current()) return node;
  }
  const previous = new Map(node.children.map(child => [child.path, child]));
  const merged: TreeNode[] = [];
  for (const child of fresh) {
    if (!current()) return node;
    const old = previous.get(child.path);
    let candidate = old?.kind === child.kind ? old : child;
    if (candidate.kind === "directory") {
      candidate = await reconcileVisibleDirectory(candidate, read, changedPaths, current);
    }
    merged.push(candidate);
  }
  if (merged.length === node.children.length && merged.every((child, index) => child === node.children[index])) return node;
  return { ...node, children: merged, childrenState: "ready" };
}

/** Keep queued events bounded and prevent an older root from publishing later. */
export function createWorkspaceChangePump(
  refresh: (paths: string[] | undefined, renames: Array<{ from: string; to: string }>) => Promise<void>,
  delay = 250,
) {
  let disposed = false, running = false, pending = false, rescan = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const paths = new Set<string>();
  let renames: Array<{ from: string; to: string }> = [];
  const flush = async () => {
    if (disposed || running || !pending) return;
    running = true;
    const batch = rescan ? undefined : [...paths];
    const moves = renames;
    pending = false; rescan = false; paths.clear(); renames = [];
    try { await refresh(batch, moves); } finally {
      running = false;
      if (!disposed && pending) schedule();
    }
  };
  const schedule = () => {
    if (disposed || timer || running) return;
    timer = setTimeout(() => { timer = null; void flush().catch(() => {}); }, delay);
  };
  return {
    request(next?: readonly string[], moves: Array<{ from: string; to: string }> = []) {
      if (disposed) return;
      pending = true;
      if (!next || next.length > 512 || paths.size + next.length > 512) rescan = true;
      else next.forEach(path => paths.add(path));
      renames.push(...moves.slice(0, Math.max(0, 128 - renames.length)));
      schedule();
    },
    dispose() { disposed = true; if (timer) clearTimeout(timer); paths.clear(); renames = []; },
  };
}
