"use client";

import { memo, useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  CircleAlert,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type { TreeNode, FileNode, DirectoryNode } from "@/types/file-system";
import { isFileNode, isDirectoryNode } from "@/types/file-system";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { resolvePathFromLatticeRoot, useFileSystem } from "@/hooks/use-file-system";
import { getAllPaneIds, findPane } from "@/lib/layout-utils";
import { cn } from "@/lib/utils";
import { ExplorerTreeRow, ExplorerFileIcon as FileIcon } from "./tree-row";
import { FileCompareDialog, type FileCompareDialogInput } from "./file-compare-dialog";
import { FileContextMenu, DeleteConfirmDialog, type FileContextMenuAction } from "./file-context-menu";
import type { EntryKind } from "@/lib/file-operations";
import {
  createPdfItemNote,
  ensurePdfItemWorkspace,
} from "@/lib/pdf-item";
import { generateFileId } from "@/lib/universal-annotation-storage";
import { buildFileFingerprint } from "@/lib/file-identity";
import { useI18n } from "@/hooks/use-i18n";
import { copyToClipboard } from "@/lib/clipboard";
import { EXPLORER_ENTRY_MIME, hasInternalEntryDrop, parseExplorerEntryDrop } from '@/lib/explorer-file-drop';
import { getDesktopHandlePath } from "@/lib/desktop-file-system";
import {
  canUseDesktopOpeners,
  openDesktopPath,
  openDesktopTerminalAtPath,
  revealDesktopPath,
} from "@/lib/desktop-openers";

interface TreeNodeProps {
  node: TreeNode;
  depth: number;
  renderChildren?: boolean;
}

interface DragPayload {
  path: string;
  kind: EntryKind;
}

const EXPLORER_DRAG_MIME = EXPLORER_ENTRY_MIME;

function hasPathPrefix(path: string | null, prefix: string): boolean {
  if (!path) {
    return false;
  }
  return path === prefix || path.startsWith(`${prefix}/`);
}

function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (!hasPathPrefix(path, oldPrefix)) {
    return path;
  }
  return `${newPrefix}${path.slice(oldPrefix.length)}`;
}

function selectFileName(input: HTMLInputElement, fileName: string): void {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex > 0) {
    input.setSelectionRange(0, dotIndex);
    return;
  }
  input.select();
}

function parseDraggedEntry(event: React.DragEvent): DragPayload | null {
  return parseExplorerEntryDrop(event.dataTransfer);
}

function setExplorerClipboardForPath(path: string, kind: EntryKind, mode: "copy" | "cut"): void {
  useExplorerStore.getState().setClipboard({ path, kind, mode });
}

function getRelativeWorkspacePath(path: string, rootName?: string | null): string {
  if (!rootName) {
    return path;
  }

  return path === rootName
    ? ""
    : path.startsWith(`${rootName}/`)
      ? path.slice(rootName.length + 1)
      : path;
}

function getPathParent(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function getSidePaneId(layoutRoot: ReturnType<typeof useWorkspaceStore.getState>["layout"]["root"], activePaneId: string): string | null {
  const paneIds = getAllPaneIds(layoutRoot);
  return paneIds.find((paneId) => paneId !== activePaneId) ?? null;
}

async function runDesktopAction(action: () => Promise<void>, failureMessage: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(failureMessage, error);
    toast.error(failureMessage);
  }
}

async function requestCloudUpload(node: TreeNode, rootHandle: FileSystemDirectoryHandle | null): Promise<void> {
  if (!rootHandle) { toast.error("请先打开本地工作区。"); return; }
  try {
    const { useCloudWorkbenchStore } = await import("@/stores/cloud-workbench-store");
    useCloudWorkbenchStore.getState().requestLocalUpload({ name: node.name, path: node.path, storagePath: resolvePathFromLatticeRoot(node.path), kind: node.kind, handle: node.handle, rootHandle });
  } catch (error) { toast.error(error instanceof Error ? error.message : "无法打开云端上传窗口。"); }
}

function syncExplorerSelectionAfterPathChange(
  oldPath: string,
  newPath: string,
  selectedKind: EntryKind | null
): void {
  const explorerState = useExplorerStore.getState();

  if (hasPathPrefix(explorerState.selectedPath, oldPath)) {
    const nextSelectedPath = replacePathPrefix(explorerState.selectedPath!, oldPath, newPath);
    const nextSelectedKind =
      explorerState.selectedPath === oldPath ? selectedKind : explorerState.selectedKind;
    explorerState.setSelection(nextSelectedPath, nextSelectedKind);
  }

  if (explorerState.renamingPath && hasPathPrefix(explorerState.renamingPath, oldPath)) {
    explorerState.startRenaming(replacePathPrefix(explorerState.renamingPath, oldPath, newPath));
  }

  if (explorerState.clipboard && hasPathPrefix(explorerState.clipboard.path, oldPath)) {
    explorerState.setClipboard({
      ...explorerState.clipboard,
      path: replacePathPrefix(explorerState.clipboard.path, oldPath, newPath),
    });
  }
}

function clearExplorerSelectionForDeletedPath(deletedPath: string): void {
  const explorerState = useExplorerStore.getState();
  if (hasPathPrefix(explorerState.selectedPath, deletedPath)) {
    explorerState.setSelection(null, null);
  }
  if (explorerState.renamingPath && hasPathPrefix(explorerState.renamingPath, deletedPath)) {
    explorerState.stopRenaming();
  }
  if (explorerState.clipboard && hasPathPrefix(explorerState.clipboard.path, deletedPath)) {
    explorerState.clearClipboard();
  }
}

export const TreeNodeComponent = memo(function TreeNodeComponent({ node, depth, renderChildren = true }: TreeNodeProps) {
  if (isFileNode(node)) {
    return <FileNodeComponent node={node} depth={depth} renderChildren={renderChildren} />;
  }

  if (isDirectoryNode(node)) {
    return <DirectoryNodeComponent node={node} depth={depth} renderChildren={renderChildren} />;
  }

  return null;
});

interface FileNodeProps {
  node: FileNode;
  depth: number;
  renderChildren?: boolean;
}

function FileNodeComponent({ node, depth, renderChildren = true }: FileNodeProps) {
  const { t } = useI18n();
  const toggleDirectory = useWorkspaceStore((state) => state.toggleDirectory);
  const openFileInPane = useWorkspaceStore((state) => state.openFileInPane);
  const openFileInLatticePane = useWorkspaceStore((state) => state.openFileInLatticePane);
  const splitPane = useWorkspaceStore((state) => state.splitPane);
  const closeTabsByPath = useWorkspaceStore((state) => state.closeTabsByPath);
  const updateTabPath = useWorkspaceStore((state) => state.updateTabPath);
  const updateTabFile = useWorkspaceStore((state) => state.updateTabFile);
  const updateTabPathPrefix = useWorkspaceStore((state) => state.updateTabPathPrefix);
  const setSelectedDirectoryPath = useWorkspaceStore((state) => state.setSelectedDirectoryPath);
  const workspaceRootHandle = useWorkspaceStore((state) => state.workspaceRootHandle);
  const { openCount, isActiveFile } = useWorkspaceStore(useShallow((state) => {
    const { layout } = state;
    const activePane = findPane(layout.root, layout.activePaneId);
    const activeFilePath = activePane?.tabs[activePane.activeTabIndex]?.filePath;
    const openCount = getAllPaneIds(layout.root).reduce((count, paneId) => {
      const pane = findPane(layout.root, paneId);
      return count + (pane?.tabs.some((tab) => tab.filePath === node.path) ? 1 : 0);
    }, 0);
    return { openCount, isActiveFile: activeFilePath === node.path };
  }));
  const {
    deleteFile,
    renameFile,
    rootHandle,
    hydratePdfVirtualChildren,
    moveEntryIntoPdfItemWorkspace,
  } = useFileSystem({ subscribeToTree: false });
  const isSelected = useExplorerStore((state) => state.selectedPath === node.path);
  const isRenaming = useExplorerStore((state) => state.renamingPath === node.path);
  const isCutItem = useExplorerStore((state) => state.clipboard?.mode === "cut" && state.clipboard.path === node.path);
  const compareSelection = useExplorerStore((state) => state.compareSelection);
  const setSelection = useExplorerStore((state) => state.setSelection);
  const startRenaming = useExplorerStore((state) => state.startRenaming);
  const stopRenaming = useExplorerStore((state) => state.stopRenaming);
  const setCompareSelection = useExplorerStore((state) => state.setCompareSelection);
  const clearCompareSelection = useExplorerStore((state) => state.clearCompareSelection);
  const isDragOver = useExplorerStore((state) => state.dragOverPath === node.path);
  const isDropPending = useExplorerStore((state) => state.dropPendingPath === node.path);
  const setDragOverPath = useExplorerStore((state) => state.setDragOverPath);
  const setDropPendingPath = useExplorerStore((state) => state.setDropPendingPath);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [compareDialog, setCompareDialog] = useState<FileCompareDialogInput | null>(null);
  const [renameValue, setRenameValue] = useState(node.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasChildren = Boolean(node.children?.length || node.canExpandVirtualChildren);
  const childNodes = node.children ?? [];
  const ChevronIcon = node.virtualChildrenState === "loading"
    ? Loader2
    : node.virtualChildrenState === "unavailable"
      ? CircleAlert
      : node.isExpanded ? ChevronDown : ChevronRight;
  const canAcceptPdfItemDrop = node.extension === "pdf" && !node.isVirtual;

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      selectFileName(inputRef.current, node.name);
    }
  }, [isRenaming, node.name]);

  const handleRename = useCallback(async () => {
    const trimmedName = renameValue.trim();
    if (!trimmedName) {
      setRenameError("Name cannot be empty");
      return;
    }

    const result = await renameFile(node.path, trimmedName);
    if (!result.success || !result.path) {
      setRenameError(result.error || "Failed to rename");
      return;
    }

    if (result.handle?.kind === "file") {
      updateTabFile(node.path, result.path, result.handle as FileSystemFileHandle);
    } else {
      updateTabPath(node.path, result.path);
    }
    syncExplorerSelectionAfterPathChange(node.path, result.path, "file");
    stopRenaming();
    setRenameError(null);
  }, [node.path, renameFile, renameValue, stopRenaming, updateTabFile, updateTabPath]);

  const handleDelete = useCallback(async () => {
    closeTabsByPath(node.path);
    const result = await deleteFile(node.path);
    if (result.success) {
      clearExplorerSelectionForDeletedPath(node.path);
      setShowDeleteConfirm(false);
      return;
    }
    console.error("Failed to delete file:", result.error);
  }, [closeTabsByPath, deleteFile, node.path]);

  const ensurePdfWorkspace = useCallback(async () => {
    const latticeRootHandle = workspaceRootHandle ?? rootHandle;
    if (!latticeRootHandle || node.extension !== "pdf" || node.isVirtual) {
      return null;
    }

    const storagePdfPath = resolvePathFromLatticeRoot(node.path);
    const fingerprint = await buildFileFingerprint(node.handle);
    const manifest = await ensurePdfItemWorkspace(latticeRootHandle, generateFileId(storagePdfPath), storagePdfPath, {
      fileFingerprint: fingerprint.fingerprint,
      versionFingerprint: fingerprint.versionFingerprint,
    });
    await hydratePdfVirtualChildren(node.path, { force: true, expand: true });
    const latestTree = useWorkspaceStore.getState().fileTree;
    const latestNode = (function findPdfEntry(current: TreeNode | null): FileNode | null {
      if (!current) return null;
      if (current.kind === "file" && current.path === node.path) {
        return current;
      }
      if (current.kind === "directory") {
        for (const child of current.children) {
          const match = findPdfEntry(child);
          if (match) return match;
        }
      } else if (current.children?.length) {
        for (const child of current.children) {
          const match = findPdfEntry(child);
          if (match) return match;
        }
      }
      return null;
    })(latestTree.root);

    if (latestNode?.children?.length && !latestNode.isExpanded) {
      toggleDirectory(node.path);
    }

    return manifest;
  }, [hydratePdfVirtualChildren, node.extension, node.handle, node.isVirtual, node.path, rootHandle, toggleDirectory, workspaceRootHandle]);

  const handleCreatePdfNote = useCallback(async (type: "note" | "notebook") => {
    const latticeRootHandle = workspaceRootHandle ?? rootHandle;
    if (!latticeRootHandle) {
      return;
    }

    const manifest = await ensurePdfWorkspace();
    if (!manifest) {
      return;
    }

    const baseName = type === "note" ? "Untitled" : "Lab Notebook";
    const created = await createPdfItemNote(latticeRootHandle, manifest, type, baseName);
    await hydratePdfVirtualChildren(node.path, { force: true, expand: true });
    openFileInPane(useWorkspaceStore.getState().layout.activePaneId, created.handle, created.path);
  }, [ensurePdfWorkspace, hydratePdfVirtualChildren, openFileInPane, rootHandle, node.path, workspaceRootHandle]);

  const handleDropIntoPdfItemWorkspace = useCallback(async (dragged: DragPayload) => {
    setDropPendingPath(node.path);
    try {
      const result = await moveEntryIntoPdfItemWorkspace(dragged.path, node.path);
      if (!result.success || !result.path) {
        console.error("Failed to move entry into PDF item workspace:", result.error);
        toast.error(result.error || t("explorer.move.failed"));
        return;
      }

      if (dragged.kind === "file") {
        if (result.handle?.kind === "file") {
          useWorkspaceStore.getState().updateTabFile(dragged.path, result.path, result.handle as FileSystemFileHandle);
        } else {
          useWorkspaceStore.getState().updateTabPath(dragged.path, result.path);
        }
      } else {
        updateTabPathPrefix(dragged.path, result.path);
      }

      syncExplorerSelectionAfterPathChange(dragged.path, result.path, dragged.kind);
      setSelection(result.path, dragged.kind);
      if (dragged.kind === "directory") {
        setSelectedDirectoryPath(result.path);
      }
    } finally {
      if (useExplorerStore.getState().dropPendingPath === node.path) {
        setDropPendingPath(null);
      }
    }
  }, [moveEntryIntoPdfItemWorkspace, node.path, setDropPendingPath, setSelectedDirectoryPath, setSelection, t, updateTabPathPrefix]);

  const handleOpenToSide = useCallback(() => {
    const { layout } = useWorkspaceStore.getState();
    const sidePaneId = getSidePaneId(layout.root, layout.activePaneId);
    const targetPaneId = sidePaneId ?? splitPane(layout.activePaneId, "horizontal");
    if (!targetPaneId) {
      openFileInPane(layout.activePaneId, node.handle, node.path);
      return;
    }
    openFileInPane(targetPaneId, node.handle, node.path);
  }, [node.handle, node.path, openFileInPane, splitPane]);

  const handleOpenInLattice = useCallback(() => {
    openFileInLatticePane(useWorkspaceStore.getState().layout.activePaneId, node.handle, node.path);
  }, [node.handle, node.path, openFileInLatticePane]);

  const handleCopyPath = useCallback(async () => {
    const path = getDesktopHandlePath(node.handle) ?? node.path;
    const copied = await copyToClipboard(path);
    toast[copied ? "success" : "error"](copied ? t("explorer.context.pathCopied") : t("explorer.context.pathCopyFailed"));
  }, [node.handle, node.path, t]);

  const handleCopyRelativePath = useCallback(async () => {
    const relativePath = getRelativeWorkspacePath(node.path, rootHandle?.name);
    const copied = await copyToClipboard(relativePath);
    toast[copied ? "success" : "error"](copied ? t("explorer.context.relativePathCopied") : t("explorer.context.pathCopyFailed"));
  }, [node.path, rootHandle?.name, t]);

  const handleOpenWithDefaultApp = useCallback(() => {
    const desktopPath = getDesktopHandlePath(node.handle);
    if (!desktopPath) {
      toast.error(t("explorer.context.desktopOnly"));
      return;
    }
    void runDesktopAction(
      () => openDesktopPath(desktopPath),
      t("explorer.context.openWithFailed"),
    );
  }, [node.handle, t]);

  const handleRevealInFileExplorer = useCallback(() => {
    const desktopPath = getDesktopHandlePath(node.handle);
    if (!desktopPath) {
      toast.error(t("explorer.context.desktopOnly"));
      return;
    }
    void runDesktopAction(
      () => revealDesktopPath(desktopPath),
      t("explorer.context.revealFailed"),
    );
  }, [node.handle, t]);

  const handleOpenTerminalHere = useCallback(() => {
    const desktopPath = getDesktopHandlePath(node.handle);
    if (!desktopPath) {
      toast.error(t("explorer.context.desktopOnly"));
      return;
    }
    void runDesktopAction(
      () => openDesktopTerminalAtPath(getPathParent(desktopPath)),
      t("explorer.context.openTerminalFailed"),
    );
  }, [node.handle, t]);

  const handleSelectForCompare = useCallback(() => {
    setCompareSelection({
      path: node.path,
      name: node.displayName ?? node.name,
      handle: node.handle,
    });
    toast.success(t("explorer.context.compareSelected"));
  }, [node.displayName, node.handle, node.name, node.path, setCompareSelection, t]);

  const handleCompareWithSelected = useCallback(async () => {
    if (!compareSelection || compareSelection.path === node.path) {
      handleSelectForCompare();
      return;
    }

    const { layout } = useWorkspaceStore.getState();
    const sidePaneId = getSidePaneId(layout.root, layout.activePaneId);
    const targetPaneId = sidePaneId ?? splitPane(layout.activePaneId, "horizontal");
    openFileInPane(layout.activePaneId, compareSelection.handle, compareSelection.path);
    openFileInPane(targetPaneId ?? layout.activePaneId, node.handle, node.path);

    try {
      const [leftFile, rightFile] = await Promise.all([
        compareSelection.handle.getFile(),
        node.handle.getFile(),
      ]);
      const [leftContent, rightContent] = await Promise.all([
        leftFile.text(),
        rightFile.text(),
      ]);
      setCompareDialog({
        leftName: compareSelection.name,
        leftPath: compareSelection.path,
        leftContent,
        rightName: node.displayName ?? node.name,
        rightPath: node.path,
        rightContent,
      });
      clearCompareSelection();
      toast.success(t("explorer.context.compareOpened"));
    } catch (error) {
      console.error("Failed to compare files:", error);
      toast.error(t("explorer.compare.failed"));
    }
  }, [
    clearCompareSelection,
    compareSelection,
    handleSelectForCompare,
    node.displayName,
    node.handle,
    node.name,
    node.path,
    openFileInPane,
    splitPane,
    t,
  ]);

  const fileContextActions = useMemo(() => {
    const desktopActionsDisabled = !canUseDesktopOpeners() || !getDesktopHandlePath(node.handle);
    const actions: FileContextMenuAction[] = [
      {
        label: "上传到云端库…",
        onSelect: () => void requestCloudUpload(node, workspaceRootHandle ?? rootHandle),
      },
      {
        label: t("explorer.context.openToSide"),
        shortcut: "Ctrl+Enter",
        onSelect: handleOpenToSide,
      },
      {
        label: t("explorer.context.openInLattice"),
        onSelect: handleOpenInLattice,
      },
      {
        label: t("explorer.context.openWith"),
        disabled: desktopActionsDisabled,
        onSelect: handleOpenWithDefaultApp,
      },
      {
        label: t("explorer.context.revealInFileExplorer"),
        shortcut: "Shift+Alt+R",
        disabled: desktopActionsDisabled,
        onSelect: handleRevealInFileExplorer,
      },
      {
        label: t("explorer.context.openInIntegratedTerminal"),
        disabled: desktopActionsDisabled,
        onSelect: handleOpenTerminalHere,
      },
      {
        label: compareSelection && compareSelection.path !== node.path
          ? t("explorer.context.compareWithSelected")
          : t("explorer.context.selectForCompare"),
        separatorBefore: true,
        onSelect: handleCompareWithSelected,
      },
      {
        label: t("explorer.context.copyPath"),
        shortcut: "Shift+Alt+C",
        separatorBefore: true,
        onSelect: handleCopyPath,
      },
      {
        label: t("explorer.context.copyRelativePath"),
        shortcut: "Ctrl+K Ctrl+Shift+C",
        onSelect: handleCopyRelativePath,
      },
    ];

    if (node.extension === "pdf" && !node.isVirtual) {
      actions.push(
        {
          label: t("explorer.pdf.newNote"),
          separatorBefore: true,
          onSelect: () => void handleCreatePdfNote("note"),
        },
        {
          label: t("explorer.pdf.newNotebook"),
          onSelect: () => void handleCreatePdfNote("notebook"),
        },
      );
    }

    return actions;
  }, [
    node,
    compareSelection,
    handleCompareWithSelected,
    handleCopyPath,
    handleCopyRelativePath,
    handleCreatePdfNote,
    handleOpenInLattice,
    handleOpenTerminalHere,
    handleOpenToSide,
    handleOpenWithDefaultApp,
    handleRevealInFileExplorer,
    rootHandle,
    workspaceRootHandle,
    t,
  ]);

  const handleRenameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      stopRenaming();
      setRenameError(null);
      setRenameValue(node.name);
    }
  };

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setSelection(node.path, "file");
    setContextMenu({ x: event.clientX, y: event.clientY });
  }, [node.path, setSelection]);

  const handleDragStart = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    const payload = JSON.stringify({ path: node.path, kind: "file" });
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(EXPLORER_DRAG_MIME, payload);
    event.dataTransfer.setData("text/plain", payload);
    setSelection(node.path, "file");
  }, [node.path, setSelection]);

  return (
    <>
      {isRenaming ? (
        <div
          className="flex flex-col px-2 py-0.5"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <div className="flex items-center gap-2">
            <span className="w-4 shrink-0" />
            <FileIcon
              extension={node.extension}
              className="h-4 w-4 shrink-0 text-muted-foreground"
            />
            <input
              ref={inputRef}
              data-explorer-rename-input="true"
              type="text"
              value={renameValue}
              onChange={(event) => {
                setRenameValue(event.target.value);
                setRenameError(null);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                handleRenameKeyDown(event);
              }}
              onBlur={() => void handleRename()}
              className={cn(
                "flex-1 rounded border bg-background px-1 py-0.5 text-sm",
                "focus:outline-none focus:ring-1 focus:ring-primary",
                renameError && "border-destructive focus:ring-destructive"
              )}
            />
          </div>
          {renameError && (
            <span className="ml-6 mt-0.5 text-xs text-destructive">{renameError}</span>
          )}
        </div>
      ) : (
        <ExplorerTreeRow
          as="div"
          depth={depth}
          selected={isSelected || isActiveFile}
          data-explorer-drop-directory={getPathParent(node.path)}
          aria-busy={isDropPending}
          onDragOver={(event) => {
            if (!canAcceptPdfItemDrop) {
              return;
            }

            const dragged = parseDraggedEntry(event);
            if ((!dragged && !hasInternalEntryDrop(event.dataTransfer)) || dragged?.path === node.path || (dragged && hasPathPrefix(node.path, dragged.path))) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            setDragOverPath(node.path);
          }}
          onDragLeave={() => {
            if (isDragOver) {
              setDragOverPath(null);
            }
          }}
          onDrop={(event) => {
            if (!canAcceptPdfItemDrop) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            const dragged = parseDraggedEntry(event);
            setDragOverPath(null);
            if (!dragged || dragged.path === node.path || hasPathPrefix(node.path, dragged.path)) {
              return;
            }

            void handleDropIntoPdfItemWorkspace(dragged);
          }}
          className={cn(
            isDragOver && "bg-primary/10 ring-1 ring-primary/50",
            isDropPending && "animate-pulse bg-primary/15 ring-1 ring-primary/60",
            isCutItem && "opacity-55"
          )}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (
                  node.extension === "pdf" &&
                  !node.isVirtual &&
                  node.canExpandVirtualChildren &&
                  node.virtualChildrenState !== "loading" &&
                  node.virtualChildrenState !== "ready"
                ) {
                  void hydratePdfVirtualChildren(node.path, { expand: true });
                  return;
                }
                toggleDirectory(node.path);
              }}
              className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
              title={node.virtualChildrenState === "unavailable"
                ? t("explorer.pdf.itemWorkspaceUnavailable")
                : node.isExpanded ? t("explorer.pdf.collapseChildren") : t("explorer.pdf.expandChildren")}
            >
              <ChevronIcon className={`h-4 w-4 shrink-0${node.virtualChildrenState === "loading" ? " animate-spin" : ""}${node.virtualChildrenState === "unavailable" ? " text-amber-600" : ""}`} />
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <button
            data-explorer-node="true"
            data-explorer-focus="true"
            onFocus={() => setSelection(node.path, "file")}
            draggable
            onClick={() => {
              setSelection(node.path, "file");
              openFileInPane(useWorkspaceStore.getState().layout.activePaneId, node.handle, node.path);
            }}
            onContextMenu={handleContextMenu}
            onDragStart={handleDragStart}
            onDragEnd={() => setDragOverPath(null)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded px-0 py-0 text-left transition-colors",
              "hover:bg-accent/50 focus:bg-accent focus:outline-none"
            )}
          >
            <FileIcon
              extension={node.extension}
              className="h-4 w-4 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{node.displayName ?? node.name}</span>
            {openCount > 1 && (
              <span className="ml-auto text-xs text-muted-foreground">{openCount}</span>
            )}
          </button>
        </ExplorerTreeRow>
      )}

      {renderChildren && hasChildren && node.isExpanded ? (
        <div className="animate-in fade-in-0 slide-in-from-top-1 duration-150">
          {childNodes.map((child) => (
            <TreeNodeComponent
              key={`${node.path}::${child.path}`}
              node={child}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}

      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          actions={fileContextActions}
          onCopy={() => setExplorerClipboardForPath(node.path, "file", "copy")}
          onCut={() => setExplorerClipboardForPath(node.path, "file", "cut")}
          onRename={() => {
            setContextMenu(null);
            startRenaming(node.path);
            setRenameValue(node.name);
            setRenameError(null);
          }}
          onDelete={() => {
            setContextMenu(null);
            setShowDeleteConfirm(true);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {showDeleteConfirm && (
        <DeleteConfirmDialog
          fileName={node.name}
          onConfirm={() => void handleDelete()}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
      {compareDialog && (
        <FileCompareDialog
          compare={compareDialog}
          onClose={() => setCompareDialog(null)}
        />
      )}
    </>
  );
}

interface DirectoryNodeProps {
  node: DirectoryNode;
  depth: number;
  renderChildren?: boolean;
}

function DirectoryNodeComponent({ node, depth, renderChildren = true }: DirectoryNodeProps) {
  const { t } = useI18n();
  const toggleDirectory = useWorkspaceStore((state) => state.toggleDirectory);
  const setSelectedDirectoryPath = useWorkspaceStore((state) => state.setSelectedDirectoryPath);
  const workspaceRootHandle = useWorkspaceStore((state) => state.workspaceRootHandle);
  const openFileInActivePane = useWorkspaceStore((state) => state.openFileInActivePane);
  const closeTabsByPrefix = useWorkspaceStore((state) => state.closeTabsByPrefix);
  const updateTabPathPrefix = useWorkspaceStore((state) => state.updateTabPathPrefix);
  const {
    createFile,
    createDirectory,
    deleteFile,
    renameFile,
    copyEntry,
    moveEntry,
    openDirectoryAsWorkspace,
    ensureDirectoryExpanded,
    rootHandle,
  } = useFileSystem({ subscribeToTree: false });
  const isSelected = useExplorerStore((state) => state.selectedPath === node.path && state.selectedKind === "directory");
  const isRenaming = useExplorerStore((state) => state.renamingPath === node.path);
  const clipboard = useExplorerStore((state) => state.clipboard);
  const isDragOver = useExplorerStore((state) => state.dragOverPath === node.path);
  const isDropPending = useExplorerStore((state) => state.dropPendingPath === node.path);
  const setSelection = useExplorerStore((state) => state.setSelection);
  const startRenaming = useExplorerStore((state) => state.startRenaming);
  const stopRenaming = useExplorerStore((state) => state.stopRenaming);
  const setClipboard = useExplorerStore((state) => state.setClipboard);
  const clearClipboard = useExplorerStore((state) => state.clearClipboard);
  const setDragOverPath = useExplorerStore((state) => state.setDragOverPath);
  const setDropPendingPath = useExplorerStore((state) => state.setDropPendingPath);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isCutItem = clipboard?.mode === "cut" && clipboard.path === node.path;

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const ensureExpanded = useCallback(() => {
    if (!node.isExpanded) {
      toggleDirectory(node.path);
    }
  }, [node.isExpanded, node.path, toggleDirectory]);

  const handleRename = useCallback(async () => {
    const trimmedName = renameValue.trim();
    if (!trimmedName) {
      setRenameError("Name cannot be empty");
      return;
    }

    const result = await renameFile(node.path, trimmedName);
    if (!result.success || !result.path) {
      setRenameError(result.error || "Failed to rename");
      return;
    }

    updateTabPathPrefix(node.path, result.path);
    syncExplorerSelectionAfterPathChange(node.path, result.path, "directory");
    setSelectedDirectoryPath(result.path);
    stopRenaming();
    setRenameError(null);
  }, [node.path, renameFile, renameValue, setSelectedDirectoryPath, stopRenaming, updateTabPathPrefix]);

  const handleDelete = useCallback(async () => {
    closeTabsByPrefix(node.path);
    const result = await deleteFile(node.path);
    if (result.success) {
      clearExplorerSelectionForDeletedPath(node.path);
      setShowDeleteConfirm(false);
      setSelectedDirectoryPath(null);
      return;
    }
    console.error("Failed to delete directory:", result.error);
  }, [closeTabsByPrefix, deleteFile, node.path, setSelectedDirectoryPath]);

  const handleCreateFile = useCallback(async () => {
    ensureExpanded();
    const result = await createFile("untitled.txt", "file", node.path);
    if (!result.success || !result.handle || !result.path) {
      console.error("Failed to create file:", result.error);
      return;
    }

    setSelection(result.path, "file");
    startRenaming(result.path);
    openFileInActivePane(result.handle, result.path);
  }, [createFile, ensureExpanded, node.path, openFileInActivePane, setSelection, startRenaming]);

  const handleCreateFolder = useCallback(async () => {
    ensureExpanded();
    const result = await createDirectory("New Folder", node.path);
    if (!result.success || !result.path) {
      console.error("Failed to create folder:", result.error);
      return;
    }

    setSelection(result.path, "directory");
    setSelectedDirectoryPath(result.path);
    startRenaming(result.path);
  }, [createDirectory, ensureExpanded, node.path, setSelectedDirectoryPath, setSelection, startRenaming]);

  const handlePaste = useCallback(async () => {
    if (!clipboard) {
      return;
    }

    ensureExpanded();

    const result =
      clipboard.mode === "copy"
        ? await copyEntry(clipboard.path, node.path)
        : await moveEntry(clipboard.path, node.path);

    if (!result.success || !result.path) {
      console.error("Failed to paste entry:", result.error);
      return;
    }

    if (clipboard.mode === "cut") {
      if (clipboard.kind === "file") {
        if (result.handle?.kind === "file") {
          useWorkspaceStore.getState().updateTabFile(clipboard.path, result.path, result.handle as FileSystemFileHandle);
        } else {
          useWorkspaceStore.getState().updateTabPath(clipboard.path, result.path);
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
    ensureExpanded,
    moveEntry,
    node.path,
    setSelectedDirectoryPath,
    setSelection,
    updateTabPathPrefix,
  ]);

  const handleDropMove = useCallback(async (dragged: DragPayload, copy = false) => {
    setDropPendingPath(node.path);
    try {
      const result = await (copy ? copyEntry : moveEntry)(dragged.path, node.path);
      if (!result.success || !result.path) {
        console.error("Failed to move entry:", result.error);
        toast.error(result.error || t("explorer.move.failed"));
        return;
      }

      if (!copy && dragged.kind === "file") {
        if (result.handle?.kind === "file") {
          useWorkspaceStore.getState().updateTabFile(dragged.path, result.path, result.handle as FileSystemFileHandle);
        } else {
          useWorkspaceStore.getState().updateTabPath(dragged.path, result.path);
        }
      } else if (!copy) {
        updateTabPathPrefix(dragged.path, result.path);
      }

      if (!copy) syncExplorerSelectionAfterPathChange(dragged.path, result.path, dragged.kind);
      setSelection(result.path, dragged.kind);
      if (dragged.kind === "directory") {
        setSelectedDirectoryPath(result.path);
      }
    } finally {
      if (useExplorerStore.getState().dropPendingPath === node.path) {
        setDropPendingPath(null);
      }
    }
  }, [copyEntry, moveEntry, node.path, setDropPendingPath, setSelectedDirectoryPath, setSelection, t, updateTabPathPrefix]);

  const handleCopyDirectoryPath = useCallback(async () => {
    const path = getDesktopHandlePath(node.handle) ?? node.path;
    const copied = await copyToClipboard(path);
    toast[copied ? "success" : "error"](copied ? t("explorer.context.pathCopied") : t("explorer.context.pathCopyFailed"));
  }, [node.handle, node.path, t]);

  const handleCopyDirectoryRelativePath = useCallback(async () => {
    const relativePath = getRelativeWorkspacePath(node.path, rootHandle?.name);
    const copied = await copyToClipboard(relativePath);
    toast[copied ? "success" : "error"](copied ? t("explorer.context.relativePathCopied") : t("explorer.context.pathCopyFailed"));
  }, [node.path, rootHandle?.name, t]);

  const handleRevealDirectory = useCallback(() => {
    const desktopPath = getDesktopHandlePath(node.handle);
    if (!desktopPath) {
      toast.error(t("explorer.context.desktopOnly"));
      return;
    }
    void runDesktopAction(
      () => revealDesktopPath(desktopPath),
      t("explorer.context.revealFailed"),
    );
  }, [node.handle, t]);

  const handleOpenDirectoryWithDefaultApp = useCallback(() => {
    const desktopPath = getDesktopHandlePath(node.handle);
    if (!desktopPath) {
      toast.error(t("explorer.context.desktopOnly"));
      return;
    }
    void runDesktopAction(
      () => openDesktopPath(desktopPath),
      t("explorer.context.openWithFailed"),
    );
  }, [node.handle, t]);

  const handleOpenDirectoryTerminal = useCallback(() => {
    const desktopPath = getDesktopHandlePath(node.handle);
    if (!desktopPath) {
      toast.error(t("explorer.context.desktopOnly"));
      return;
    }
    void runDesktopAction(
      () => openDesktopTerminalAtPath(desktopPath),
      t("explorer.context.openTerminalFailed"),
    );
  }, [node.handle, t]);

  const directoryContextActions = useMemo<FileContextMenuAction[]>(() => {
    const desktopActionsDisabled = !canUseDesktopOpeners() || !getDesktopHandlePath(node.handle);
    return [
      {
        label: "上传到云端库…",
        onSelect: () => void requestCloudUpload(node, workspaceRootHandle ?? rootHandle),
      },
      {
        label: t("explorer.context.openWith"),
        disabled: desktopActionsDisabled,
        onSelect: handleOpenDirectoryWithDefaultApp,
      },
      {
        label: t("explorer.context.revealInFileExplorer"),
        shortcut: "Shift+Alt+R",
        disabled: desktopActionsDisabled,
        onSelect: handleRevealDirectory,
      },
      {
        label: t("explorer.context.openInIntegratedTerminal"),
        disabled: desktopActionsDisabled,
        onSelect: handleOpenDirectoryTerminal,
      },
      {
        label: t("explorer.context.copyPath"),
        shortcut: "Shift+Alt+C",
        separatorBefore: true,
        onSelect: handleCopyDirectoryPath,
      },
      {
        label: t("explorer.context.copyRelativePath"),
        shortcut: "Ctrl+K Ctrl+Shift+C",
        onSelect: handleCopyDirectoryRelativePath,
      },
      {
        label: t("explorer.context.openAsWorkspace"),
        separatorBefore: true,
        onSelect: () => void openDirectoryAsWorkspace(node.path),
      },
    ];
  }, [
    node,
    handleCopyDirectoryPath,
    handleCopyDirectoryRelativePath,
    handleOpenDirectoryTerminal,
    handleOpenDirectoryWithDefaultApp,
    handleRevealDirectory,
    openDirectoryAsWorkspace,
    rootHandle,
    workspaceRootHandle,
    t,
  ]);

  const handleRenameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      stopRenaming();
      setRenameError(null);
      setRenameValue(node.name);
    }
  };

  const ChevronIcon = node.isExpanded ? ChevronDown : ChevronRight;
  const FolderIcon = node.isExpanded ? FolderOpen : Folder;

  return (
    <>
      <div>
        {isRenaming ? (
          <div
            className="flex flex-col px-2 py-0.5"
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
          >
            <div className="flex items-center gap-1">
              <ChevronIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                data-explorer-rename-input="true"
                type="text"
                value={renameValue}
                onChange={(event) => {
                  setRenameValue(event.target.value);
                  setRenameError(null);
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  handleRenameKeyDown(event);
                }}
                onBlur={() => void handleRename()}
                className={cn(
                  "flex-1 rounded border bg-background px-1 py-0.5 text-sm",
                  "focus:outline-none focus:ring-1 focus:ring-primary",
                  renameError && "border-destructive focus:ring-destructive"
                )}
              />
            </div>
            {renameError && (
              <span className="ml-10 mt-0.5 text-xs text-destructive">{renameError}</span>
            )}
          </div>
        ) : (
          <ExplorerTreeRow
            depth={depth}
            directory
            data-explorer-drop-directory={node.path}
            selected={isSelected}
            aria-expanded={node.isExpanded}
            onFocus={() => setSelection(node.path, "directory")}
            aria-busy={isDropPending}
            draggable
            onClick={() => {
              setSelection(node.path, "directory");
              setSelectedDirectoryPath(node.path);
              if (node.childrenState !== "ready") {
                void ensureDirectoryExpanded(node.path);
              } else {
                toggleDirectory(node.path);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSelection(node.path, "directory");
              setSelectedDirectoryPath(node.path);
              setContextMenu({ x: event.clientX, y: event.clientY });
            }}
            onDragStart={(event) => {
              const payload = JSON.stringify({ path: node.path, kind: "directory" });
              event.dataTransfer.effectAllowed = "copyMove";
              event.dataTransfer.setData(EXPLORER_DRAG_MIME, payload);
              event.dataTransfer.setData("text/plain", payload);
              setSelection(node.path, "directory");
              setSelectedDirectoryPath(node.path);
            }}
            onDragOver={(event) => {
              const dragged = parseDraggedEntry(event);
              if ((!dragged && !hasInternalEntryDrop(event.dataTransfer)) || dragged && (dragged.path === node.path || hasPathPrefix(node.path, dragged.path))) {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = event.ctrlKey || event.metaKey ? 'copy' : 'move';
              setDragOverPath(node.path);
            }}
            onDragLeave={() => {
              if (isDragOver) {
                setDragOverPath(null);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const dragged = parseDraggedEntry(event);
              setDragOverPath(null);
              if (!dragged || dragged.path === node.path || hasPathPrefix(node.path, dragged.path)) {
                return;
              }

              ensureExpanded();
              void handleDropMove(dragged, event.ctrlKey || event.metaKey);
            }}
            onDragEnd={() => setDragOverPath(null)}
            className={cn(
              "hover:bg-accent/50 focus:bg-accent focus:outline-none",
              isDragOver && "bg-primary/10 ring-1 ring-primary/50",
              isDropPending && "animate-pulse bg-primary/15 ring-1 ring-primary/60",
              isCutItem && "opacity-55"
            )}
          >
            <ChevronIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{node.name}</span>
            {node.childrenState === "loading" ? (
              <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : node.childrenState === "error" ? (
              <CircleAlert className="ml-auto h-3.5 w-3.5 text-destructive" />
            ) : (
              <span className="ml-auto font-scientific text-muted-foreground">
                {node.children.length}
              </span>
            )}
          </ExplorerTreeRow>
        )}

        {renderChildren && node.isExpanded && (
          <div className="animate-in fade-in-0 slide-in-from-top-1 duration-150">
            {node.children.map((child) => (
              <TreeNodeComponent
                key={child.path}
                node={child}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>

      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isDirectory={true}
          canPaste={!!clipboard}
          actions={directoryContextActions}
          onNewFile={() => void handleCreateFile()}
          onNewFolder={() => void handleCreateFolder()}
          onPaste={() => void handlePaste()}
          onCopy={() => setClipboard({ mode: "copy", path: node.path, kind: "directory" })}
          onCut={() => setClipboard({ mode: "cut", path: node.path, kind: "directory" })}
          onRename={() => {
            setContextMenu(null);
            setRenameValue(node.name);
            setRenameError(null);
            startRenaming(node.path);
          }}
          onDelete={() => {
            setContextMenu(null);
            setShowDeleteConfirm(true);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {showDeleteConfirm && (
        <DeleteConfirmDialog
          fileName={node.name}
          itemType="folder"
          onConfirm={() => void handleDelete()}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </>
  );
}
