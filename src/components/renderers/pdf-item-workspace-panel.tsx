"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BookOpenText, FilePlus2, FolderOpen, NotebookPen, RefreshCw, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFileSystem } from "@/hooks/use-file-system";
import { useWorkspaceStore, type PaneId } from "@/stores/workspace-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { emitVaultChange } from "@/lib/plugins/runtime";
import {
  createPdfItemNote,
  ensurePdfItemWorkspace,
  listPdfItemNotes,
  loadPdfItemManifest,
  syncPdfAnnotationsMarkdown,
  syncPdfOverviewMarkdown,
  type PdfItemManifest,
  type PdfItemNoteSummary,
} from "@/lib/pdf-item";
import { getBacklinksForAnnotation, scanWorkspaceMarkdownBacklinks } from "@/lib/annotation-backlinks";
import { getParentPath, resolveEntry, resolveDirectoryHandle } from "@/lib/file-operations";
import type { AnnotationItem } from "@/types/universal-annotation";
import type { FileNode, TreeNode } from "@/types/file-system";

interface PdfItemWorkspacePanelProps {
  rootHandle: FileSystemDirectoryHandle;
  fileId: string;
  fileName: string;
  filePath: string;
  paneId: PaneId;
  annotations: AnnotationItem[];
}

function noteLabel(type: PdfItemNoteSummary["type"]) {
  switch (type) {
    case "overview":
      return "概览";
    case "annotation-note":
      return "批注";
    case "notebook":
      return "Notebook";
    case "note":
    default:
      return "Markdown";
  }
}

function ActionIconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8 rounded-md border border-border bg-background/90"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      {children}
    </Button>
  );
}

export function PdfItemWorkspacePanel({
  rootHandle,
  fileId,
  fileName,
  filePath,
  paneId,
  annotations,
}: PdfItemWorkspacePanelProps) {
  const { refreshDirectory } = useFileSystem();
  const activePaneId = useWorkspaceStore((state) => state.layout.activePaneId);
  const splitPane = useWorkspaceStore((state) => state.splitPane);
  const openFileInPane = useWorkspaceStore((state) => state.openFileInPane);
  const toggleDirectory = useWorkspaceStore((state) => state.toggleDirectory);
  const setSelectedDirectoryPath = useWorkspaceStore((state) => state.setSelectedDirectoryPath);
  const [manifest, setManifest] = useState<PdfItemManifest | null>(null);
  const [notes, setNotes] = useState<PdfItemNoteSummary[]>([]);
  const [itemFolderExists, setItemFolderExists] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pdfAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.target.type === "pdf"),
    [annotations],
  );

  const loadItemState = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const nextManifest = await loadPdfItemManifest(rootHandle, fileId, filePath);
      const directoryHandle = await resolveDirectoryHandle(rootHandle, nextManifest.itemFolderPath);
      const nextNotes = directoryHandle ? await listPdfItemNotes(rootHandle, nextManifest) : [];
      setManifest(nextManifest);
      setItemFolderExists(Boolean(directoryHandle));
      setNotes(nextNotes);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [fileId, filePath, rootHandle]);

  const findTreeNodeByPath = useCallback((node: TreeNode | null, targetPath: string): TreeNode | null => {
    if (!node) {
      return null;
    }

    if (node.path === targetPath) {
      return node;
    }

    if (node.kind === "directory") {
      for (const child of node.children) {
        const match = findTreeNodeByPath(child, targetPath);
        if (match) {
          return match;
        }
      }
      return null;
    }

    if (node.children?.length) {
      for (const child of node.children) {
        const match = findTreeNodeByPath(child, targetPath);
        if (match) {
          return match;
        }
      }
    }

    return null;
  }, []);

  const revealPdfEntry = useCallback((expandChildren = false) => {
    useExplorerStore.getState().setSelection(filePath, "file");
    setSelectedDirectoryPath(getParentPath(filePath));

    const latestFileTree = useWorkspaceStore.getState().fileTree;
    const pdfNode = findTreeNodeByPath(latestFileTree.root, filePath) as FileNode | null;
    if (expandChildren && pdfNode?.children?.length && !pdfNode.isExpanded) {
      toggleDirectory(filePath);
    }
  }, [filePath, findTreeNodeByPath, setSelectedDirectoryPath, toggleDirectory]);

  useEffect(() => {
    void loadItemState();
  }, [loadItemState]);

  const openHandleNearPdf = useCallback((handle: FileSystemFileHandle, path: string) => {
    const targetPaneId = activePaneId === paneId
      ? (splitPane(paneId, "horizontal") ?? activePaneId)
      : activePaneId;
    openFileInPane(targetPaneId, handle, path);
  }, [activePaneId, openFileInPane, paneId, splitPane]);

  const ensureWorkspace = useCallback(async () => {
    const currentManifest = await ensurePdfItemWorkspace(rootHandle, fileId, filePath);
    setManifest(currentManifest);
    setItemFolderExists(true);
    await refreshDirectory({ silent: true });
    return currentManifest;
  }, [fileId, filePath, refreshDirectory, rootHandle]);

  const runAction = useCallback(async (actionId: string, task: (resolvedManifest: PdfItemManifest) => Promise<void>) => {
    setBusyAction(actionId);
    setError(null);
    try {
      const resolvedManifest = await ensureWorkspace();
      await task(resolvedManifest);
      await loadItemState();
      revealPdfEntry(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusyAction(null);
    }
  }, [ensureWorkspace, loadItemState, revealPdfEntry]);

  const handleCreateNote = useCallback((type: "note" | "notebook") => {
    const baseName = type === "note" ? "Reading Note" : "Lab Notebook";
    void runAction(type === "note" ? "create-note" : "create-notebook", async (resolvedManifest) => {
      const result = await createPdfItemNote(rootHandle, resolvedManifest, type, baseName);
      const overviewResult = await syncPdfOverviewMarkdown(rootHandle, resolvedManifest, fileName, pdfAnnotations);
      emitVaultChange(result.path);
      emitVaultChange(overviewResult.path);
      setManifest(overviewResult.manifest);
      await refreshDirectory({ silent: true });
      openHandleNearPdf(result.handle, result.path);
    });
  }, [fileName, openHandleNearPdf, pdfAnnotations, refreshDirectory, rootHandle, runAction]);

  const handleSyncAnnotations = useCallback(() => {
    void runAction("sync-annotations", async (resolvedManifest) => {
      await scanWorkspaceMarkdownBacklinks(rootHandle);
      const backlinksByAnnotation = Object.fromEntries(
        pdfAnnotations.map((annotation) => [annotation.id, getBacklinksForAnnotation(annotation.id)]),
      );
      const result = await syncPdfAnnotationsMarkdown(
        rootHandle,
        resolvedManifest,
        fileName,
        pdfAnnotations,
        backlinksByAnnotation,
      );
      const overviewResult = await syncPdfOverviewMarkdown(rootHandle, result.manifest, fileName, pdfAnnotations);
      emitVaultChange(result.path);
      emitVaultChange(overviewResult.path);
      setManifest(overviewResult.manifest);
      await refreshDirectory({ silent: true });
      openHandleNearPdf(result.handle, result.path);
    });
  }, [fileName, openHandleNearPdf, pdfAnnotations, refreshDirectory, rootHandle, runAction]);

  const handleOpenNote = useCallback(async (notePath: string) => {
    setBusyAction(`open:${notePath}`);
    setError(null);
    try {
      const entry = await resolveEntry(rootHandle, notePath);
      if (!entry || entry.kind !== "file") {
        throw new Error(`无法打开文件：${notePath}`);
      }
      openHandleNearPdf(entry.handle as FileSystemFileHandle, notePath);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    } finally {
      setBusyAction(null);
    }
  }, [openHandleNearPdf, rootHandle]);

  const handleRevealFolder = useCallback(() => {
    if (!manifest) {
      return;
    }
    revealPdfEntry(true);
  }, [manifest, revealPdfEntry]);

  const handleOpenOverview = useCallback(() => {
    const overview = notes.find((note) => note.type === "overview");
    if (overview) {
      void handleOpenNote(overview.path);
    }
  }, [handleOpenNote, notes]);

  const actionsDisabled = Boolean(busyAction);

  return (
    <section className="shrink-0 border-b border-border bg-background px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            PDF Workspace
          </div>
          <div className="truncate text-[11px] text-foreground">{fileName}</div>
        </div>
        <div className="flex items-center gap-1">
          <ActionIconButton
            title={itemFolderExists ? "刷新条目工作区" : "创建条目目录"}
            onClick={() => void runAction("ensure-item", async () => {})}
            disabled={actionsDisabled}
          >
            <RefreshCw className={`h-4 w-4 ${busyAction === "ensure-item" ? "animate-spin" : ""}`} />
          </ActionIconButton>
          <ActionIconButton
            title="打开概览"
            onClick={handleOpenOverview}
            disabled={!notes.some((note) => note.type === "overview") || actionsDisabled}
          >
            <BookOpenText className="h-4 w-4" />
          </ActionIconButton>
          <ActionIconButton
            title="新建阅读笔记"
            onClick={() => handleCreateNote("note")}
            disabled={actionsDisabled}
          >
            <FilePlus2 className="h-4 w-4" />
          </ActionIconButton>
          <ActionIconButton
            title="新建 Notebook"
            onClick={() => handleCreateNote("notebook")}
            disabled={actionsDisabled}
          >
            <NotebookPen className="h-4 w-4" />
          </ActionIconButton>
          <ActionIconButton
            title="重建批注索引"
            onClick={handleSyncAnnotations}
            disabled={actionsDisabled}
          >
            <ScrollText className="h-4 w-4" />
          </ActionIconButton>
          <ActionIconButton
            title="在 Explorer 定位"
            onClick={handleRevealFolder}
            disabled={!manifest || actionsDisabled}
          >
            <FolderOpen className="h-4 w-4" />
          </ActionIconButton>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5">
          {itemFolderExists ? "条目目录已建立" : "条目目录未建立"}
        </span>
        <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5">
          {pdfAnnotations.length} 条批注
        </span>
        <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5">
          {notes.length} 个关联文件
        </span>
      </div>

      <div className="mt-1 truncate text-[10px] text-muted-foreground" title={manifest?.itemFolderPath ?? undefined}>
        {manifest?.itemFolderPath ?? "正在准备条目目录..."}
      </div>

      {error ? (
        <div className="mt-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <div className="mt-1 text-[10px] text-muted-foreground">正在读取条目文件...</div>
      ) : null}

      {!isLoading && notes.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
          {notes.slice(0, 3).map((note) => (
            <button
              key={note.path}
              type="button"
              onClick={() => void handleOpenNote(note.path)}
              className="rounded border border-border bg-muted/30 px-1.5 py-0.5 transition-colors hover:bg-muted"
              title={`${noteLabel(note.type)} · ${note.path}`}
            >
              {noteLabel(note.type)}
            </button>
          ))}
          {notes.length > 3 ? <span className="px-1 py-0.5">+{notes.length - 3}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

export default PdfItemWorkspacePanel;
