import { useContentCacheStore } from "@/stores/content-cache-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { isFileTabState, type FileTabState, type LayoutNode } from "@/types/layout";
import { notifyWorkspaceFileChanged } from "./workspace-file-revisions";
import { getFileExtension, isBinaryFile } from "./file-utils";
import { resolveWorkspaceRenamedPath } from "./workspace-live-sync";

export function getOpenWorkspaceFiles(node: LayoutNode): FileTabState[] {
  return node.type === "pane" ? node.tabs.filter(isFileTabState) : node.children.flatMap(getOpenWorkspaceFiles);
}

/** No dirty draft or saved editor position is discarded by external events. */
export function invalidateCleanWorkspaceFiles(paths?: readonly string[]): string[] {
  const cache = useContentCacheStore.getState();
  const next = new Map(cache.cache);
  const updated: string[] = [];
  for (const tab of getOpenWorkspaceFiles(useWorkspaceStore.getState().layout.root)) {
    if (paths && !paths.some(path => tab.filePath === path || tab.filePath.startsWith(path + "/"))) continue;
    if (tab.isDirty || cache.hasUnsavedChanges(tab.id)) continue;
    next.delete(tab.id);
    updated.push(tab.id);
  }
  if (updated.length) {
    useContentCacheStore.setState({ cache: next });
    updated.forEach(notifyWorkspaceFileChanged);
  }
  return updated;
}

export async function refreshCleanWorkspaceFile(
  tab: FileTabState,
  current: () => boolean,
): Promise<boolean> {
  const stillClean = () => current() && !useContentCacheStore.getState().hasUnsavedChanges(tab.id)
    && getOpenWorkspaceFiles(useWorkspaceStore.getState().layout.root).some(candidate => candidate.id === tab.id
      && candidate.fileHandle === tab.fileHandle && candidate.filePath === tab.filePath && !candidate.isDirty);
  if (!stillClean()) return false;
  try {
    if (isBinaryFile(getFileExtension(tab.fileName))) {
      invalidateCleanWorkspaceFiles([tab.filePath]);
      return true;
    }
    const file = await tab.fileHandle.getFile();
    if (!stillClean()) return false;
    const text = await file.text();
    if (!stillClean()) return false;
    const cache = useContentCacheStore.getState();
    if (cache.getContent(tab.id)?.content === text) return false;
    cache.setContent(tab.id, text, text);
    notifyWorkspaceFileChanged(tab.id);
    return true;
  } catch { return false; }
}

export async function relocateCleanWorkspaceFiles(
  root: FileSystemDirectoryHandle,
  from: string,
  to: string,
  current: () => boolean,
): Promise<void> {
  return relocateCleanWorkspaceFilesForRenames(root, [{ from, to }], current);
}

export async function relocateCleanWorkspaceFilesForRenames(
  root: FileSystemDirectoryHandle,
  renames: readonly { from: string; to: string }[],
  current: () => boolean,
): Promise<void> {
  const original = getOpenWorkspaceFiles(useWorkspaceStore.getState().layout.root);
  const paths = [...new Set(original.map(tab => tab.filePath))];
  const updates = new Map<string, { original: FileTabState; path: string; handle: FileSystemFileHandle }>();
  for (const oldPath of paths) {
    const nextPath = resolveWorkspaceRenamedPath(oldPath, renames);
    if (nextPath === oldPath) continue;
    const snapshots = original.filter(tab => tab.filePath === oldPath);
    const clean = () => current() && getOpenWorkspaceFiles(useWorkspaceStore.getState().layout.root)
      .filter(tab => tab.filePath === oldPath).every(tab => !tab.isDirty && !useContentCacheStore.getState().hasUnsavedChanges(tab.id));
    if (!clean()) continue;
    const parts = nextPath.slice(root.name.length + 1).split("/");
    if (!nextPath.startsWith(root.name + "/") || parts.some(part => !part || part === "..")) continue;
    try {
      let directory = root;
      for (const name of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(name);
      const handle = await directory.getFileHandle(parts[parts.length - 1]);
      if (clean()) snapshots.forEach(tab => updates.set(tab.id, { original: tab, path: nextPath, handle }));
    } catch { /* An unresolved move leaves the old editor available. */ }
  }
  if (!current() || !updates.size) return;
  // Apply against original tab identities together: intermediate names may no
  // longer exist, and sequential path updates can rebind a swapped file twice.
  const relocate = (node: LayoutNode): LayoutNode => {
    if (node.type !== 'pane') return { ...node, children: node.children.map(relocate) };
    const tabs = node.tabs.map(tab => {
      const update = updates.get(tab.id);
      return update && isFileTabState(tab) && tab.filePath === update.original.filePath
        && tab.fileHandle === update.original.fileHandle && !tab.isDirty
        && !useContentCacheStore.getState().hasUnsavedChanges(tab.id)
        ? { ...tab, filePath: update.path, fileName: update.path.split('/').pop()!, fileHandle: update.handle } : tab;
    });
    return tabs.some((tab, index) => tab !== node.tabs[index]) ? { ...node, tabs } : node;
  };
  useWorkspaceStore.setState(state => ({ layout: { ...state.layout, root: relocate(state.layout.root) } }));
}
