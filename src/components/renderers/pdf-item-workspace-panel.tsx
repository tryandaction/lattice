"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenText, FilePlus2, FolderOpen, NotebookPen, RefreshCw, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFileSystem } from "@/hooks/use-file-system";
import { useWorkspaceStore, type PaneId } from "@/stores/workspace-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { emitVaultChange } from "@/lib/plugins/runtime";
import {
  createPdfItemNote,
  ensurePdfItemFolder,
  listPdfItemNotes,
  loadPdfItemManifest,
  savePdfItemManifest,
  syncPdfAnnotationsMarkdown,
  type PdfItemManifest,
  type PdfItemNoteSummary,
} from "@/lib/pdf-item";
import { resolveEntry, resolveDirectoryHandle } from "@/lib/file-operations";
import type { AnnotationItem } from "@/types/universal-annotation";

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
    case "annotation-note":
      return "批注";
    case "notebook":
      return "Notebook";
    case "note":
    default:
      return "Markdown";
  }
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
    const currentManifest = manifest ?? await loadPdfItemManifest(rootHandle, fileId, filePath);
    await ensurePdfItemFolder(rootHandle, currentManifest);
    await savePdfItemManifest(rootHandle, currentManifest);
    setManifest(currentManifest);
    setItemFolderExists(true);
    await refreshDirectory({ silent: true });
    return currentManifest;
  }, [fileId, filePath, manifest, refreshDirectory, rootHandle]);

  const runAction = useCallback(async (actionId: string, task: (resolvedManifest: PdfItemManifest) => Promise<void>) => {
    setBusyAction(actionId);
    setError(null);
    try {
      const resolvedManifest = await ensureWorkspace();
      await task(resolvedManifest);
      await loadItemState();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusyAction(null);
    }
  }, [ensureWorkspace, loadItemState]);

  const handleCreateNote = useCallback((type: "note" | "notebook") => {
    const baseName = type === "note" ? "Reading Note" : "Lab Notebook";
    void runAction(type === "note" ? "create-note" : "create-notebook", async (resolvedManifest) => {
      const result = await createPdfItemNote(rootHandle, resolvedManifest, type, baseName);
      emitVaultChange(result.path);
      await refreshDirectory({ silent: true });
      openHandleNearPdf(result.handle, result.path);
    });
  }, [openHandleNearPdf, refreshDirectory, rootHandle, runAction]);

  const handleSyncAnnotations = useCallback(() => {
    void runAction("sync-annotations", async (resolvedManifest) => {
      const result = await syncPdfAnnotationsMarkdown(rootHandle, resolvedManifest, fileName, pdfAnnotations);
      emitVaultChange(result.path);
      setManifest(result.manifest);
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
    setSelectedDirectoryPath(manifest.itemFolderPath);
    useExplorerStore.getState().setSelection(manifest.itemFolderPath, "directory");
  }, [manifest, setSelectedDirectoryPath]);

  const actionsDisabled = Boolean(busyAction);

  return (
    <section className="border-b border-border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">条目工作区</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            将 PDF 作为条目管理，关联阅读笔记、Notebook 和批注 Markdown。
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => void loadItemState()}
          disabled={actionsDisabled}
          title="刷新条目状态"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busyAction === "refresh" ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="mt-3 rounded-lg border border-border bg-background/80 p-2 text-xs">
        <div className="font-medium text-foreground">{fileName}</div>
        <div className="mt-1 break-all text-muted-foreground">{manifest?.itemFolderPath ?? "正在准备条目目录..."}</div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span>{itemFolderExists ? "条目目录已建立" : "条目目录未建立"}</span>
          <span>{pdfAnnotations.length} 条 PDF 批注</span>
          <span>{notes.length} 个关联文件</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => void runAction("ensure-item", async () => {})}
          disabled={actionsDisabled}
        >
          <BookOpenText className="mr-1.5 h-3.5 w-3.5" />
          {itemFolderExists ? "条目已就绪" : "创建条目目录"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => handleCreateNote("note")}
          disabled={actionsDisabled}
        >
          <FilePlus2 className="mr-1.5 h-3.5 w-3.5" />
          新建 Markdown 笔记
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => handleCreateNote("notebook")}
          disabled={actionsDisabled}
        >
          <NotebookPen className="mr-1.5 h-3.5 w-3.5" />
          新建 Notebook
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={handleSyncAnnotations}
          disabled={actionsDisabled}
        >
          <ScrollText className="mr-1.5 h-3.5 w-3.5" />
          同步批注 Markdown
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={handleRevealFolder}
          disabled={!manifest || actionsDisabled}
        >
          <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
          在 Explorer 定位
        </Button>
      </div>

      {error ? (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        {isLoading ? (
          <div className="text-xs text-muted-foreground">正在读取条目文件...</div>
        ) : notes.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
            还没有关联文件。可以直接在此创建 Markdown 阅读笔记、Notebook，或同步批注为 Markdown。
          </div>
        ) : (
          notes.map((note) => (
            <button
              key={note.path}
              type="button"
              onClick={() => void handleOpenNote(note.path)}
              className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/40"
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-foreground">{note.fileName}</div>
                <div className="truncate text-[11px] text-muted-foreground">{note.path}</div>
              </div>
              <span className="ml-3 shrink-0 rounded bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                {noteLabel(note.type)}
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

export default PdfItemWorkspacePanel;
