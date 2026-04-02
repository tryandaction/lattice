"use client";

import { useCallback } from "react";
import type { DirectoryNode } from "@/types/file-system";
import { useExplorerStore } from "@/stores/explorer-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useFileSystem } from "@/hooks/use-file-system";
import { getParentPath } from "@/lib/file-operations";
import { TreeNodeComponent } from "./tree-node";

interface TreeViewProps {
  root: DirectoryNode;
}

/**
 * Tree View component that renders the file tree
 * Starts from the root directory node
 */
export function TreeView({ root }: TreeViewProps) {
  const { copyEntry, moveEntry } = useFileSystem();
  const setSelectedDirectoryPath = useWorkspaceStore((state) => state.setSelectedDirectoryPath);
  const updateTabPath = useWorkspaceStore((state) => state.updateTabPath);
  const updateTabPathPrefix = useWorkspaceStore((state) => state.updateTabPathPrefix);
  const selectedPath = useExplorerStore((state) => state.selectedPath);
  const selectedKind = useExplorerStore((state) => state.selectedKind);
  const clipboard = useExplorerStore((state) => state.clipboard);
  const setClipboard = useExplorerStore((state) => state.setClipboard);
  const setSelection = useExplorerStore((state) => state.setSelection);
  const startRenaming = useExplorerStore((state) => state.startRenaming);
  const clearClipboard = useExplorerStore((state) => state.clearClipboard);

  const handlePaste = useCallback(async () => {
    if (!clipboard) {
      return;
    }

    const targetDirectoryPath =
      selectedPath && selectedKind === "directory"
        ? selectedPath
        : selectedPath
          ? getParentPath(selectedPath)
          : root.path;

    const result =
      clipboard.mode === "copy"
        ? await copyEntry(clipboard.path, targetDirectoryPath)
        : await moveEntry(clipboard.path, targetDirectoryPath);

    if (!result.success || !result.path) {
      console.error("Failed to paste entry:", result.error);
      return;
    }

    if (clipboard.mode === "cut") {
      if (clipboard.kind === "file") {
        updateTabPath(clipboard.path, result.path);
      } else {
        updateTabPathPrefix(clipboard.path, result.path);
      }
      clearClipboard();
    }

    setSelection(result.path, clipboard.kind);
    if (clipboard.kind === "directory") {
      setSelectedDirectoryPath(result.path);
    }
  }, [
    clearClipboard,
    clipboard,
    copyEntry,
    moveEntry,
    root.path,
    selectedKind,
    selectedPath,
    setSelectedDirectoryPath,
    setSelection,
    updateTabPath,
    updateTabPathPrefix,
  ]);

  return (
    <div
      className="py-2 focus:outline-none"
      tabIndex={0}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target?.isContentEditable
        ) {
          return;
        }

        if (!selectedPath || !selectedKind) {
          return;
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
          event.preventDefault();
          setClipboard({ mode: "copy", path: selectedPath, kind: selectedKind });
          return;
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x") {
          event.preventDefault();
          setClipboard({ mode: "cut", path: selectedPath, kind: selectedKind });
          return;
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
          event.preventDefault();
          void handlePaste();
          return;
        }

        if (event.key === "F2") {
          event.preventDefault();
          startRenaming(selectedPath);
        }
      }}
    >
      <TreeNodeComponent node={root} depth={0} />
    </div>
  );
}
