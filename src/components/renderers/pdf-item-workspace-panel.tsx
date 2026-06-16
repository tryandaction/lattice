"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
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
import { extractPdfBibliographicSummary, type PdfBibliographicSummary } from "@/lib/pdf-metadata";
import {
  buildSimpleBibtex,
  buildSimpleCitation,
  enrichPdfBibliography,
  type PdfBibliographicEnrichment,
} from "@/lib/pdf-bibliography-enrichment";
import { openExternalUrl } from "@/lib/link-router/open-external";
import { copyToClipboard } from "@/lib/clipboard";

interface PdfItemWorkspacePanelProps {
  rootHandle: FileSystemDirectoryHandle;
  documentId?: string | null;
  fileName: string;
  filePath: string;
  paneId: PaneId;
  annotations: AnnotationItem[];
  isAnnotationsLoading?: boolean;
  manifest?: PdfItemManifest | null;
  pdfDocument?: PDFDocumentProxy | null;
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
  isAnnotationsLoading = false,
  manifest: initialManifest = null,
  pdfDocument = null,
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
  const [summary, setSummary] = useState<PdfBibliographicSummary | null>(null);
  const [enrichment, setEnrichment] = useState<PdfBibliographicEnrichment | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    if (!pdfDocument) {
      setSummary(null);
      setEnrichment(null);
      return;
    }

    void extractPdfBibliographicSummary({
      pdfDocument,
      fileName,
    }).then((nextSummary) => {
      if (!cancelled) {
        setSummary(nextSummary);
        void enrichPdfBibliography(nextSummary).then((nextEnrichment) => {
          if (!cancelled) {
            setEnrichment(nextEnrichment);
          }
        }).catch(() => {
          if (!cancelled) {
            setEnrichment(null);
          }
        });
      }
    }).catch(() => {
      if (!cancelled) {
        setSummary(null);
        setEnrichment(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fileName, pdfDocument]);

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

  const handleOpenDoi = useCallback(async (doi: string) => {
    await openExternalUrl(`https://doi.org/${doi}`);
  }, []);

  const handleOpenArxiv = useCallback(async (arxivId: string) => {
    await openExternalUrl(`https://arxiv.org/abs/${arxivId}`);
  }, []);

  const handleCopySummary = useCallback(async () => {
    if (!summary) {
      return;
    }

    const lines = [
      enrichment?.title ?? summary.title,
      (enrichment?.authors ?? summary.authors).length > 0 ? `Authors: ${(enrichment?.authors ?? summary.authors).join(", ")}` : null,
      (enrichment?.year ?? summary.year) ? `Year: ${enrichment?.year ?? summary.year}` : null,
      (enrichment?.doi ?? summary.doi) ? `DOI: ${enrichment?.doi ?? summary.doi}` : null,
      (enrichment?.arxivId ?? summary.arxivId) ? `arXiv: ${enrichment?.arxivId ?? summary.arxivId}` : null,
      (enrichment?.subject ?? summary.subject) ? `Subject: ${enrichment?.subject ?? summary.subject}` : null,
      enrichment?.venue ? `Venue: ${enrichment.venue}` : null,
      enrichment?.abstract ? `Abstract: ${enrichment.abstract}` : null,
    ].filter(Boolean).join("\n");

    await copyToClipboard(lines);
  }, [enrichment, summary]);

  const handleCopyCitation = useCallback(async () => {
    if (!summary) {
      return;
    }
    await copyToClipboard(buildSimpleCitation({ summary, enrichment }));
  }, [enrichment, summary]);

  const handleCopyBibtex = useCallback(async () => {
    if (!summary) {
      return;
    }
    await copyToClipboard(buildSimpleBibtex({ fileName, summary, enrichment }));
  }, [enrichment, fileName, summary]);

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
          {isAnnotationsLoading
            ? t("workbench.annotations.loading")
            : t("pdf.workspace.count.annotations", { count: pdfAnnotations.length })}
        </span>
        <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5">
          {t("pdf.workspace.count.notes", { count: notes.length })}
        </span>
        {summary ? (
          <button
            type="button"
            onClick={() => void handleCopySummary()}
            className="rounded border border-border bg-muted/40 px-1.5 py-0.5 transition-colors hover:bg-muted"
          >
            {t("pdf.workspace.meta.copy")}
          </button>
        ) : null}
        {summary ? (
          <button
            type="button"
            onClick={() => void handleCopyCitation()}
            className="rounded border border-border bg-muted/40 px-1.5 py-0.5 transition-colors hover:bg-muted"
          >
            {t("pdf.workspace.meta.copyCitation")}
          </button>
        ) : null}
        {summary ? (
          <button
            type="button"
            onClick={() => void handleCopyBibtex()}
            className="rounded border border-border bg-muted/40 px-1.5 py-0.5 transition-colors hover:bg-muted"
          >
            {t("pdf.workspace.meta.copyBibtex")}
          </button>
        ) : null}
      </div>

      {isExpanded ? (
        <>
          {summary ? (
            <div className="mt-2 rounded-md border border-border bg-muted/20 px-2 py-2 text-[11px] text-muted-foreground">
              <div className="font-medium text-foreground truncate">{enrichment?.title ?? summary.title}</div>
              {(enrichment?.authors ?? summary.authors).length > 0 ? <div className="mt-1"><span className="font-medium">{t("pdf.workspace.meta.authors")}:</span> {(enrichment?.authors ?? summary.authors).join(", ")}</div> : null}
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(enrichment?.year ?? summary.year) ? <span className="rounded border border-border bg-background/80 px-1.5 py-0.5">{t("pdf.workspace.meta.year")} {enrichment?.year ?? summary.year}</span> : null}
                {summary.pageCount ? <span className="rounded border border-border bg-background/80 px-1.5 py-0.5">{t("pdf.workspace.meta.pages")} {summary.pageCount}</span> : null}
                {(enrichment?.doi ?? summary.doi) ? (
                  <button
                    type="button"
                    onClick={() => void handleOpenDoi((enrichment?.doi ?? summary.doi)!)}
                    className="rounded border border-border bg-background/80 px-1.5 py-0.5 text-left transition-colors hover:bg-muted"
                  >
                    DOI {enrichment?.doi ?? summary.doi}
                  </button>
                ) : null}
                {(enrichment?.arxivId ?? summary.arxivId) ? (
                  <button
                    type="button"
                    onClick={() => void handleOpenArxiv((enrichment?.arxivId ?? summary.arxivId)!)}
                    className="rounded border border-border bg-background/80 px-1.5 py-0.5 text-left transition-colors hover:bg-muted"
                  >
                    arXiv {enrichment?.arxivId ?? summary.arxivId}
                  </button>
                ) : null}
                {enrichment?.venue ? <span className="rounded border border-border bg-background/80 px-1.5 py-0.5">{enrichment.venue}</span> : null}
              </div>
              {(enrichment?.subject ?? summary.subject) ? <div className="mt-1 truncate"><span className="font-medium">{t("pdf.workspace.meta.subject")}:</span> {enrichment?.subject ?? summary.subject}</div> : null}
              {(enrichment?.keywords ?? summary.keywords).length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(enrichment?.keywords ?? summary.keywords).slice(0, 6).map((keyword) => (
                    <span key={keyword} className="rounded bg-background/80 px-1.5 py-0.5">{keyword}</span>
                  ))}
                </div>
              ) : null}
              {enrichment?.abstract ? (
                <div className="mt-2 line-clamp-4 text-[10px] leading-5 text-muted-foreground">
                  {enrichment.abstract}
                </div>
              ) : null}
            </div>
          ) : null}

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
