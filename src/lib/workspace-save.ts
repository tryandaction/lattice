import { fastSaveFile } from "@/lib/fast-save";
import { emitVaultChange, emitVaultRename } from "@/lib/plugins/runtime";
import { generateUniqueName, resolveEntry, renameFile as renameFileUtil } from "@/lib/file-operations";
import { getFileExtension } from "@/lib/file-utils";
import type { TabState } from "@/types/layout";
import { useExplorerStore } from "@/stores/explorer-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

export const UNTITLED_MARKDOWN_PATTERN = /^Untitled(?:-\d+)?\.md$/i;

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
  tab: TabState;
  content: string;
  rootHandle: FileSystemDirectoryHandle | null;
  refreshDirectory?: (options?: { silent?: boolean }) => Promise<void>;
}): Promise<TabState> {
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
