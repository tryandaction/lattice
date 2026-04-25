"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, FilePlus2, FolderOpen, NotebookPen, Trash2 } from "lucide-react";
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
  type PdfItemManifest,
  type PdfItemNoteSummary,
} from "@/lib/pdf-item";
import { getParentPath, resolveEntry, resolveDirectoryHandle } from "@/lib/file-operations";
import type { AnnotationItem } from "@/types/universal-annotation";
import type { FileNode, TreeNode } from "@/types/file-system";
import { useI18n } from "@/hooks/use-i18n";
import { generateFileId } from "@/lib/universal-annotation-storage";

interface PdfItemWorkspacePanelProps {
  rootHandle: FileSystemDirectoryHandle;
  documentId?: string | null;
  fileName: string;
  filePath: string;
  paneId: PaneId;
  annotations: AnnotationItem[];
  manifest?: PdfItemManifest | null;
}

function noteLabel(type: PdfItemNoteSummary["type"], t: ReturnType<typeof useI18n>["t"]) {
  switch (type) {
    case "annotation-note":
      return t("pdf.workspace.note.annotation");
    case "notebook":
      return t("pdf.workspace.note.notebook");
    case "note":
    default:
      return t("pdf.workspace.note.markdown");
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
  documentId,
  fileName,
  filePath,
  paneId,
  annotations,
  manifest: initialManifest = null,
}: PdfItemWorkspacePanelProps) {
  const { t } = useI18n();
  const { deleteFile, refreshDirectory } = useFileSystem();
  const activePaneId = useWorkspaceStore((state) => state.layout.activePaneId);
  const closeTabsByPath = useWorkspaceStore((state) => state.closeTabsByPath);
  const splitPane = useWorkspaceStore((state) => state.splitPane);
  const openFileInPane = useWorkspaceStore((state) => state.openFileInPane);
  const toggleDirectory = useWorkspaceStore((state) => state.toggleDirectory);
  const setSelectedDirectoryPath = useWorkspaceStore((state) => state.setSelectedDirectoryPath);
  const [manifest, setManifest] = useState<PdfItemManifest | null>(initialManifest);
  const [notes, setNotes] = useState<PdfItemNoteSummary[]>([]);
  const [itemFolderExists, setItemFolderExists] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const pdfAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.target.type === "pdf"),
    [annotations],
  );

  const loadItemState = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const nextManifest = await loadPdfItemManifest(rootHandle, generateFileId(filePath), filePath, {
        documentId: documentId ?? initialManifest?.itemId ?? null,
      });
      const resolvedManifest = initialManifest ?? nextManifest;
      const directoryHandle = await resolveDirectoryHandle(rootHandle, resolvedManifest.itemFolderPath);
      const nextNotes = directoryHandle ? await listPdfItemNotes(rootHandle, resolvedManifest) : [];
      setManifest(resolvedManifest);
      setItemFolderExists(Boolean(directoryHandle));
      setNotes(nextNotes);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [documentId, filePath, initialManifest, rootHandle]);

  useEffect(() => {
    setManifest(initialManifest);
  }, [initialManifest]);

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
    if (!isExpanded) {
      return;
    }
    void loadItemState();
  }, [isExpanded, loadItemState]);

  const openHandleNearPdf = useCallback((handle: FileSystemFileHandle, path: string) => {
    const targetPaneId = activePaneId === paneId
      ? (splitPane(paneId, "horizontal") ?? activePaneId)
      : activePaneId;
    openFileInPane(targetPaneId, handle, path);
  }, [activePaneId, openFileInPane, paneId, splitPane]);

  const ensureWorkspace = useCallback(async () => {
    const currentManifest = await ensurePdfItemWorkspace(rootHandle, generateFileId(filePath), filePath, {
      documentId: documentId ?? initialManifest?.itemId ?? null,
    });
    setManifest(currentManifest);
    setItemFolderExists(true);
    await refreshDirectory({ silent: true });
    return currentManifest;
  }, [documentId, filePath, initialManifest?.itemId, refreshDirectory, rootHandle]);

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
    const baseName = type === "note" ? "Untitled" : "Lab Notebook";
    void runAction(type === "note" ? "create-note" : "create-notebook", async (resolvedManifest) => {
      const result = await createPdfItemNote(rootHandle, resolvedManifest, type, baseName);
      emitVaultChange(result.path);
      await refreshDirectory({ silent: true });
      openHandleNearPdf(result.handle, result.path);
    });
  }, [openHandleNearPdf, refreshDirectory, rootHandle, runAction]);

  const handleOpenNote = useCallback(async (notePath: string) => {
    setBusyAction(`open:${notePath}`);
    setError(null);
    try {
      const entry = await resolveEntry(rootHandle, notePath);
      if (!entry || entry.kind !== "file") {
        throw new Error(t("pdf.workspace.error.open", { path: notePath }));
      }
      openHandleNearPdf(entry.handle as FileSystemFileHandle, notePath);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    } finally {
      setBusyAction(null);
    }
  }, [openHandleNearPdf, rootHandle, t]);

  const handleDeleteNote = useCallback(async (note: PdfItemNoteSummary) => {
    if (note.type === "annotation-note") {
      return;
    }

    setBusyAction(`delete:${note.path}`);
    setError(null);
    try {
      closeTabsByPath(note.path);
      const result = await deleteFile(note.path);
      if (!result.success) {
        throw new Error(result.error || t("common.error"));
      }
      await loadItemState();
      revealPdfEntry(true);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setBusyAction(null);
    }
  }, [closeTabsByPath, deleteFile, loadItemState, revealPdfEntry, t]);

  const handleRevealFolder = useCallback(() => {
    if (!manifest) {
      return;
    }
    revealPdfEntry(true);
  }, [manifest, revealPdfEntry]);

  const actionsDisabled = Boolean(busyAction);

  return (
    <section className="shrink-0 border-b border-border bg-background/95 px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => setIsExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent/40"
        >
          {isExpanded ? (
            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("pdf.workspace.title")}
            </div>
            <div className="truncate text-[11px] text-foreground">{fileName}</div>
          </div>
        </button>
        <div className="flex items-center gap-1">
          <ActionIconButton
            title={t("pdf.workspace.action.newNote")}
            onClick={() => handleCreateNote("note")}
            disabled={actionsDisabled}
          >
            <FilePlus2 className="h-4 w-4" />
          </ActionIconButton>
          <ActionIconButton
            title={t("pdf.workspace.action.newNotebook")}
            onClick={() => handleCreateNote("notebook")}
            disabled={actionsDisabled}
          >
            <NotebookPen className="h-4 w-4" />
          </ActionIconButton>
          <ActionIconButton
            title={t("pdf.workspace.action.reveal")}
            onClick={handleRevealFolder}
            disabled={actionsDisabled || (!manifest && !itemFolderExists)}
          >
            <FolderOpen className="h-4 w-4" />
          </ActionIconButton>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5">
          {t("pdf.workspace.count.annotations", { count: pdfAnnotations.length })}
        </span>
        <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5">
          {t("pdf.workspace.count.notes", { count: notes.length })}
        </span>
      </div>

      {isExpanded ? (
        <>
          {error ? (
            <div className="mt-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
              {error}
            </div>
          ) : null}

          {isLoading ? (
            <div className="mt-1 text-[10px] text-muted-foreground">{t("pdf.workspace.loading")}</div>
          ) : null}

          {!isLoading && notes.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
              {notes.map((note) => (
                <div
                  key={note.path}
                  className="inline-flex items-center rounded border border-border bg-muted/30 transition-colors hover:bg-muted"
                >
                  <button
                    type="button"
                    onClick={() => void handleOpenNote(note.path)}
                    className="px-1.5 py-0.5"
                    title={`${noteLabel(note.type, t)} ${note.path}`}
                  >
                    {noteLabel(note.type, t)}
                  </button>
                  {note.type !== "annotation-note" ? (
                    <button
                      type="button"
                      onClick={() => void handleDeleteNote(note)}
                      className="border-l border-border/80 px-1 py-0.5 text-muted-foreground transition-colors hover:text-destructive"
                      title={t("common.delete")}
                      aria-label={`${t("common.delete")} ${note.path}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default PdfItemWorkspacePanel;
