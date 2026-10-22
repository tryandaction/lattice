import { fastSaveFile } from "@/lib/fast-save";
import { emitVaultChange, emitVaultRename } from "@/lib/plugins/runtime";
import { generateUniqueName, resolveEntry, renameFile as renameFileUtil } from "@/lib/file-operations";
import { getFileExtension } from "@/lib/file-utils";
import type { CloudFileTabState, FileTabState } from "@/types/layout";
import { saveCloudFileTab } from "@/lib/shared-library/workbench-source";
import { useExplorerStore } from "@/stores/explorer-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import type { LayoutNode } from "@/types/layout";

/** Complete the exact saved snapshot; later keystrokes and moved tabs remain dirty. */
export function acknowledgeWorkspaceTabSave(tabId: string, savedContent: string): void {
  useContentCacheStore.getState().markAsSaved(tabId, savedContent);
  const dirty = useContentCacheStore.getState().hasUnsavedChanges(tabId);
  const workspace = useWorkspaceStore.getState();
  const visit = (node: LayoutNode) => {
    if (node.type === "split") { node.children.forEach(visit); return; }
    const index = node.tabs.findIndex(tab => tab.id === tabId);
    if (index >= 0) workspace.setTabDirty(node.id, index, dirty);
  };
  visit(workspace.layout.root);
}

export const UNTITLED_MARKDOWN_PATTERN = /^Untitled(?:-\d+)?\.md$/i;
const cloudSaveTails = new Map<string, Promise<unknown>>();

export function extractMarkdownTitle(content: string): string | null {
  const normalized = content.startsWith("---\n")
    ? (() => {
        const endIndex = content.indexOf("\n---", 4);
        return endIndex >= 0 ? content.slice(endIndex + 4) : content;
      })()
    : content;

  const headingMatch = normalized.match(/^#\s+(.+?)\s*$/m);
  const title = headingMatch?.[1]?.trim();
  return title ? title : null;
}

export async function saveWorkspaceTabContent(input: {
  tab: FileTabState | CloudFileTabState;
  content: string;
  rootHandle: FileSystemDirectoryHandle | null;
  refreshDirectory?: (options?: { silent?: boolean }) => Promise<void>;
}): Promise<FileTabState | CloudFileTabState> {
  if (input.tab.kind === "cloud-file") {
    const tab = input.tab;
    const previous = cloudSaveTails.get(tab.cloud.resourceId);
    const operation = (previous ?? Promise.resolve()).catch(() => {}).then(async () => {
      let current = tab;
      const visit = (node: LayoutNode) => {
        if (node.type === "split") node.children.forEach(visit);
        else {
          const match = node.tabs.find(candidate => candidate.id === tab.id);
          if (match?.kind === "cloud-file") current = match;
        }
      };
      visit(useWorkspaceStore.getState().layout.root);
      const saved = await saveCloudFileTab(current, input.content);
      useWorkspaceStore.getState().updateCloudTab(saved.id, { cloud: saved.cloud, fileName: saved.fileName });
      return saved;
    });
    cloudSaveTails.set(tab.cloud.resourceId, operation);
    try { return await operation; }
    finally { if (cloudSaveTails.get(tab.cloud.resourceId) === operation) cloudSaveTails.delete(tab.cloud.resourceId); }
  }
  await fastSaveFile(input.tab.fileHandle, input.content);

  let persistedTab = input.tab;
  if (
    input.rootHandle &&
    getFileExtension(input.tab.fileName) === "md" &&
    UNTITLED_MARKDOWN_PATTERN.test(input.tab.fileName)
  ) {
    const title = extractMarkdownTitle(input.content);
    if (title) {
      const resolvedEntry = await resolveEntry(input.rootHandle, input.tab.filePath);
      if (resolvedEntry?.kind === "file") {
        const parentHandle = resolvedEntry.parentHandle;
        const uniqueName = await generateUniqueName(parentHandle, title, ".md");
        if (uniqueName !== input.tab.fileName) {
          const renameResult = await renameFileUtil(parentHandle, resolvedEntry.name, uniqueName);
          if (renameResult.success && renameResult.handle) {
            const nextPath = `${input.tab.filePath.slice(0, Math.max(0, input.tab.filePath.length - input.tab.fileName.length))}${uniqueName}`;
            useWorkspaceStore.getState().updateTabFile(input.tab.filePath, nextPath, renameResult.handle);
            const selectedPath = useExplorerStore.getState().selectedPath;
            if (selectedPath === input.tab.filePath) {
              useExplorerStore.getState().setSelection(nextPath, "file");
            }
            emitVaultRename(input.tab.filePath, nextPath);
            if (input.refreshDirectory) {
              await input.refreshDirectory({ silent: true });
            }
            persistedTab = {
              ...input.tab,
              fileHandle: renameResult.handle,
              fileName: uniqueName,
              filePath: nextPath,
            };
          }
        }
      }
    }
  }

  emitVaultChange(persistedTab.filePath);
  return persistedTab;
}
