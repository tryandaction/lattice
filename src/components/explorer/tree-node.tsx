"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  Code,
  Image as ImageIcon,
  File,
  Presentation,
  BookOpen,
} from "lucide-react";
import type { TreeNode, FileNode, DirectoryNode } from "@/types/file-system";
import { isFileNode, isDirectoryNode } from "@/types/file-system";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { useFileSystem } from "@/hooks/use-file-system";
import { getAllPaneIds, findPane } from "@/lib/layout-utils";
import { cn } from "@/lib/utils";
import { FileContextMenu, DeleteConfirmDialog } from "./file-context-menu";
import { resolveEntry, type EntryKind } from "@/lib/file-operations";
import {
  createPdfItemNote,
  ensurePdfItemWorkspace,
  syncPdfAnnotationsMarkdown,
  syncPdfOverviewMarkdown,
} from "@/lib/pdf-item";
import { generateFileId, loadAnnotationsFromDisk } from "@/lib/universal-annotation-storage";
import { getBacklinksForAnnotation, scanWorkspaceMarkdownBacklinks } from "@/lib/annotation-backlinks";

interface TreeNodeProps {
  node: TreeNode;
  depth: number;
}

interface DragPayload {
  path: string;
  kind: EntryKind;
}

const EXPLORER_DRAG_MIME = "application/x-lattice-explorer-entry";

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
  const raw = event.dataTransfer.getData(EXPLORER_DRAG_MIME);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as DragPayload;
    if (!parsed.path || (parsed.kind !== "file" && parsed.kind !== "directory")) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function setExplorerClipboardForPath(path: string, kind: EntryKind, mode: "copy" | "cut"): void {
  useExplorerStore.getState().setClipboard({ path, kind, mode });
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

function FileIcon({
  extension,
  className,
}: {
  extension: string;
  className?: string;
}) {
  const normalizedExt = extension.toLowerCase();

  if (normalizedExt === "pdf" || normalizedExt === "txt") {
    return <FileText className={className} />;
  }
  if (normalizedExt === "ppt" || normalizedExt === "pptx") {
    return <Presentation className={className} />;
  }
  if (normalizedExt === "md") {
    return <FileCode className={className} />;
  }
  if (normalizedExt === "py") {
    return <Code className={className} />;
  }
  if (normalizedExt === "ipynb") {
    return <BookOpen className={className} />;
  }
  if (normalizedExt === "png" || normalizedExt === "jpg" || normalizedExt === "jpeg") {
    return <ImageIcon className={className} />;
  }
  return <File className={className} />;
}

export function TreeNodeComponent({ node, depth }: TreeNodeProps) {
  if (isFileNode(node)) {
    return <FileNodeComponent node={node} depth={depth} />;
  }

  if (isDirectoryNode(node)) {
    return <DirectoryNodeComponent node={node} depth={depth} />;
  }

  return null;
}

interface FileNodeProps {
  node: FileNode;
  depth: number;
}

function FileNodeComponent({ node, depth }: FileNodeProps) {
  const toggleDirectory = useWorkspaceStore((state) => state.toggleDirectory);
  const openFileInPane = useWorkspaceStore((state) => state.openFileInPane);
  const closeTabsByPath = useWorkspaceStore((state) => state.closeTabsByPath);
  const updateTabPath = useWorkspaceStore((state) => state.updateTabPath);
  const layout = useWorkspaceStore((state) => state.layout);
  const { deleteFile, renameFile, refreshDirectory, rootHandle } = useFileSystem();
  const selectedPath = useExplorerStore((state) => state.selectedPath);
  const renamingPath = useExplorerStore((state) => state.renamingPath);
  const clipboard = useExplorerStore((state) => state.clipboard);
  const setSelection = useExplorerStore((state) => state.setSelection);
  const startRenaming = useExplorerStore((state) => state.startRenaming);
  const stopRenaming = useExplorerStore((state) => state.stopRenaming);
  const dragOverPath = useExplorerStore((state) => state.dragOverPath);
  const setDragOverPath = useExplorerStore((state) => state.setDragOverPath);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isRenaming = renamingPath === node.path;
  const isSelected = selectedPath === node.path;
  const isCutItem = clipboard?.mode === "cut" && clipboard.path === node.path;
  const hasChildren = Boolean(node.children?.length);
  const ChevronIcon = node.isExpanded ? ChevronDown : ChevronRight;

  const { openCount, isActiveFile } = useMemo(() => {
    const paneIds = getAllPaneIds(layout.root);
    let count = 0;
    let activeFilePath: string | null = null;

    const activePane = findPane(layout.root, layout.activePaneId);
    if (activePane && activePane.activeTabIndex >= 0 && activePane.activeTabIndex < activePane.tabs.length) {
      activeFilePath = activePane.tabs[activePane.activeTabIndex]?.filePath ?? null;
    }

    for (const paneId of paneIds) {
      const pane = findPane(layout.root, paneId);
      if (pane?.tabs.some((tab) => tab.filePath === node.path)) {
        count += 1;
      }
    }

    return {
      openCount: count,
      isActiveFile: activeFilePath === node.path,
    };
  }, [layout.activePaneId, layout.root, node.path]);

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

    updateTabPath(node.path, result.path);
    syncExplorerSelectionAfterPathChange(node.path, result.path, "file");
    stopRenaming();
    setRenameError(null);
  }, [node.path, renameFile, renameValue, stopRenaming, updateTabPath]);

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
    if (!rootHandle || node.extension !== "pdf" || node.isVirtual) {
      return null;
    }

    const manifest = await ensurePdfItemWorkspace(rootHandle, generateFileId(node.path), node.path);
    await refreshDirectory({ silent: true });
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
  }, [node.extension, node.isVirtual, node.path, refreshDirectory, rootHandle, toggleDirectory]);

  const handleOpenPdfOverview = useCallback(async () => {
    if (!rootHandle) {
      return;
    }

    const manifest = await ensurePdfWorkspace();
    if (!manifest) {
      return;
    }

    const entry = await resolveEntry(rootHandle, manifest.overviewPath);
    if (entry?.kind === "file") {
      openFileInPane(layout.activePaneId, entry.handle as FileSystemFileHandle, manifest.overviewPath);
    }
  }, [ensurePdfWorkspace, layout.activePaneId, openFileInPane, rootHandle]);

  const handleCreatePdfNote = useCallback(async (type: "note" | "notebook") => {
    if (!rootHandle) {
      return;
    }

    const manifest = await ensurePdfWorkspace();
    if (!manifest) {
      return;
    }

    const baseName = type === "note" ? "Reading Note" : "Lab Notebook";
    const created = await createPdfItemNote(rootHandle, manifest, type, baseName);
    const annotationsFile = await loadAnnotationsFromDisk(manifest.itemId, rootHandle, "pdf");
    await syncPdfOverviewMarkdown(rootHandle, manifest, node.name, annotationsFile.annotations);
    await refreshDirectory({ silent: true });
    openFileInPane(layout.activePaneId, created.handle, created.path);
  }, [ensurePdfWorkspace, layout.activePaneId, node.name, openFileInPane, refreshDirectory, rootHandle]);

  const handleRebuildPdfAnnotationIndex = useCallback(async () => {
    if (!rootHandle) {
      return;
    }

    const manifest = await ensurePdfWorkspace();
    if (!manifest) {
      return;
    }

    const annotationsFile = await loadAnnotationsFromDisk(manifest.itemId, rootHandle, "pdf");
    await scanWorkspaceMarkdownBacklinks(rootHandle);
    const backlinksByAnnotation = Object.fromEntries(
      annotationsFile.annotations
        .filter((annotation) => annotation.target.type === "pdf")
        .map((annotation) => [annotation.id, getBacklinksForAnnotation(annotation.id)]),
    );
    const annotationResult = await syncPdfAnnotationsMarkdown(
      rootHandle,
      manifest,
      node.name,
      annotationsFile.annotations,
      backlinksByAnnotation,
    );
    await syncPdfOverviewMarkdown(rootHandle, annotationResult.manifest, node.name, annotationsFile.annotations);
    await refreshDirectory({ silent: true });
  }, [ensurePdfWorkspace, node.name, refreshDirectory, rootHandle]);

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
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify({ path: node.path, kind: "file" }));
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
              type="text"
              value={renameValue}
              onChange={(event) => {
                setRenameValue(event.target.value);
                setRenameError(null);
              }}
              onKeyDown={handleRenameKeyDown}
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
        <div
          className={cn(
            "flex w-full items-center gap-2 px-2 py-1 text-left text-sm transition-colors",
            (isSelected || isActiveFile) && "bg-accent",
            dragOverPath === node.path && "ring-1 ring-primary/50",
            isCutItem && "opacity-55"
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleDirectory(node.path);
              }}
              className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
              title={node.isExpanded ? "折叠条目子项" : "展开条目子项"}
            >
              <ChevronIcon className="h-4 w-4 shrink-0" />
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <button
            draggable
            onClick={() => {
              setSelection(node.path, "file");
              openFileInPane(layout.activePaneId, node.handle, node.path);
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
            {node.badgeLabel ? (
              <span className="ml-2 shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                {node.badgeLabel}
              </span>
            ) : null}
            {openCount > 1 && (
              <span className="ml-auto text-xs text-muted-foreground">{openCount}</span>
            )}
          </button>
        </div>
      )}

      {hasChildren && node.isExpanded ? (
        <div className="animate-in fade-in-0 slide-in-from-top-1 duration-150">
          {node.children!.map((child) => (
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
          actions={node.extension === "pdf" && !node.isVirtual ? [
            { label: "打开 PDF 概览", onSelect: () => void handleOpenPdfOverview() },
            { label: "新建阅读笔记", onSelect: () => void handleCreatePdfNote("note") },
            { label: "新建 Notebook", onSelect: () => void handleCreatePdfNote("notebook") },
            { label: "重建批注索引", onSelect: () => void handleRebuildPdfAnnotationIndex() },
          ] : undefined}
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
    </>
  );
}

interface DirectoryNodeProps {
  node: DirectoryNode;
  depth: number;
}

function DirectoryNodeComponent({ node, depth }: DirectoryNodeProps) {
  const toggleDirectory = useWorkspaceStore((state) => state.toggleDirectory);
  const setSelectedDirectoryPath = useWorkspaceStore((state) => state.setSelectedDirectoryPath);
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
  } = useFileSystem();
  const selectedPath = useExplorerStore((state) => state.selectedPath);
  const selectedKind = useExplorerStore((state) => state.selectedKind);
  const renamingPath = useExplorerStore((state) => state.renamingPath);
  const clipboard = useExplorerStore((state) => state.clipboard);
  const dragOverPath = useExplorerStore((state) => state.dragOverPath);
  const setSelection = useExplorerStore((state) => state.setSelection);
  const startRenaming = useExplorerStore((state) => state.startRenaming);
  const stopRenaming = useExplorerStore((state) => state.stopRenaming);
  const setClipboard = useExplorerStore((state) => state.setClipboard);
  const clearClipboard = useExplorerStore((state) => state.clearClipboard);
  const setDragOverPath = useExplorerStore((state) => state.setDragOverPath);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isRenaming = renamingPath === node.path;
  const isSelected = selectedPath === node.path && selectedKind === "directory";
  const isCutItem = clipboard?.mode === "cut" && clipboard.path === node.path;
  const isDragOver = dragOverPath === node.path;

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
        useWorkspaceStore.getState().updateTabPath(clipboard.path, result.path);
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

  const handleDropMove = useCallback(async (dragged: DragPayload) => {
    const result = await moveEntry(dragged.path, node.path);
    if (!result.success || !result.path) {
      console.error("Failed to move entry:", result.error);
      return;
    }

    if (dragged.kind === "file") {
      useWorkspaceStore.getState().updateTabPath(dragged.path, result.path);
    } else {
      updateTabPathPrefix(dragged.path, result.path);
    }

    syncExplorerSelectionAfterPathChange(dragged.path, result.path, dragged.kind);
    setSelection(result.path, dragged.kind);
    if (dragged.kind === "directory") {
      setSelectedDirectoryPath(result.path);
    }
  }, [moveEntry, node.path, setSelectedDirectoryPath, setSelection, updateTabPathPrefix]);

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
                type="text"
                value={renameValue}
                onChange={(event) => {
                  setRenameValue(event.target.value);
                  setRenameError(null);
                }}
                onKeyDown={handleRenameKeyDown}
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
          <button
            draggable
            onClick={() => {
              setSelection(node.path, "directory");
              setSelectedDirectoryPath(node.path);
              toggleDirectory(node.path);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSelection(node.path, "directory");
              setSelectedDirectoryPath(node.path);
              setContextMenu({ x: event.clientX, y: event.clientY });
            }}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify({ path: node.path, kind: "directory" }));
              setSelection(node.path, "directory");
              setSelectedDirectoryPath(node.path);
            }}
            onDragOver={(event) => {
              const dragged = parseDraggedEntry(event);
              if (!dragged || dragged.path === node.path || hasPathPrefix(node.path, dragged.path)) {
                return;
              }

              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOverPath(node.path);
            }}
            onDragLeave={() => {
              if (dragOverPath === node.path) {
                setDragOverPath(null);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              const dragged = parseDraggedEntry(event);
              setDragOverPath(null);
              if (!dragged || dragged.path === node.path || hasPathPrefix(node.path, dragged.path)) {
                return;
              }

              ensureExpanded();
              void handleDropMove(dragged);
            }}
            onDragEnd={() => setDragOverPath(null)}
            className={cn(
              "flex w-full items-center gap-1 px-2 py-1 text-left text-sm transition-colors",
              "hover:bg-accent/50 focus:bg-accent focus:outline-none",
              isSelected && "bg-accent/70",
              isDragOver && "bg-primary/10 ring-1 ring-primary/50",
              isCutItem && "opacity-55"
            )}
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
          >
            <ChevronIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{node.name}</span>
            <span className="ml-auto font-scientific text-muted-foreground">
              {node.children.length}
            </span>
          </button>
        )}

        {node.isExpanded && (
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
