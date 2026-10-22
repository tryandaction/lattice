"use client";

import { useCallback, useMemo, useRef } from "react";
import type { DirectoryNode } from "@/types/file-system";
import { useExplorerStore } from "@/stores/explorer-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useFileSystem } from "@/hooks/use-file-system";
import { getParentPath } from "@/lib/file-operations";
import { SourceTreeNode } from "./source-tree-node";
import type { ExplorerSourceAdapter } from "./explorer-source";
import { handleTreeNavigation } from "./tree-row";
import { collectVisibleLocalTreeRows, LOCAL_TREE_WINDOW_THRESHOLD, WindowedLocalTree, type WindowedLocalTreeHandle } from './windowed-local-tree';

type TreeViewProps = { root: DirectoryNode; source?: never } | { source: ExplorerSourceAdapter; root?: never };

/**
 * Tree View component that renders the file tree
 * Starts from the root directory node
 */
export function TreeView(props: TreeViewProps) {
  if (props.source) return <div role="tree" aria-label={props.source.label} className="py-2 focus:outline-none" tabIndex={0} onKeyDown={handleTreeNavigation}>
    {props.source.root ? <SourceTreeNode node={props.source.root} source={props.source} depth={0} /> : null}
  </div>;
  return <LocalTreeView root={props.root} />;
}

function LocalTreeView({ root }: { root: DirectoryNode }) {
  const visibleRows = useMemo(() => collectVisibleLocalTreeRows(root), [root]);
  const windowedTree = useRef<WindowedLocalTreeHandle>(null);
  const { copyEntry, moveEntry } = useFileSystem({ subscribeToTree: false });
  const setSelectedDirectoryPath = useWorkspaceStore((state) => state.setSelectedDirectoryPath);
  const updateTabPath = useWorkspaceStore((state) => state.updateTabPath);
  const updateTabFile = useWorkspaceStore((state) => state.updateTabFile);
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
        if (result.handle?.kind === "file") {
          updateTabFile(clipboard.path, result.path, result.handle as FileSystemFileHandle);
        } else {
          updateTabPath(clipboard.path, result.path);
        }
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
    updateTabFile,
    updateTabPath,
    updateTabPathPrefix,
  ]);

  return (
    <div
      role="tree"
      aria-label={root.name}
      className="py-2 focus:outline-none"
      tabIndex={0}
      onKeyDown={(event) => {
        // A virtual tree navigates the complete logical list, including rows not mounted yet.
        if (visibleRows.length > LOCAL_TREE_WINDOW_THRESHOLD && event.target === event.currentTarget) {
          if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            windowedTree.current?.navigate(event.key);
            return;
          }
        }
        if (handleTreeNavigation(event)) return;
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
      <WindowedLocalTree ref={windowedTree} rows={visibleRows}/>
    </div>
  );
}
