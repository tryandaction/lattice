"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronDown, ChevronRight, Copy, FileIcon, FilePlus2, FolderOpen, NotebookPen, Trash2 } from "lucide-react";
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
  fileFingerprint?: string | null;
  versionFingerprint?: string | null;
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
    case "directory":
      return "Folder";
    case "file":
      return "File";
    case "annotation-note":
      return t("pdf.workspace.note.annotation");
    case "notebook":
      return t("pdf.workspace.note.notebook");
    case "note":
    default:
      return t("pdf.workspace.note.markdown");
  }
}

function entryDisplayName(entry: PdfItemNoteSummary): string {
  return entry.fileName || entry.path.split("/").pop() || entry.path;
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

function getAncestorDirectoryPaths(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const ancestors: string[] = [];
  for (let index = 1; index <= parts.length; index += 1) {
    ancestors.push(parts.slice(0, index).join("/"));
  }
  return ancestors;
}

function findTreeNodeByPath(node: TreeNode | null, targetPath: string): TreeNode | null {
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
}

export function PdfItemWorkspacePanel({
  rootHandle,
  documentId,
  fileFingerprint = null,
  versionFingerprint = null,
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
  const [entries, setEntries] = useState<PdfItemNoteSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedEntryPaths, setExpandedEntryPaths] = useState<Set<string>>(() => new Set());
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [summary, setSummary] = useState<PdfBibliographicSummary | null>(null);
  const [enrichment, setEnrichment] = useState<PdfBibliographicEnrichment | null>(null);
  const [currentManifest, setCurrentManifest] = useState<PdfItemManifest | null>(initialManifest);

  const pdfAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.target.type === "pdf"),
    [annotations],
  );
  const originalPdfPath = useMemo(() => {
    const paths = currentManifest?.knownPdfPaths ?? [];
    return paths.find((path) => path !== filePath) ?? null;
  }, [currentManifest?.knownPdfPaths, filePath]);
  const visibleEntries = useMemo(() => entries.filter((entry) => {
    if (!entry.path) {
      return false;
    }
    let parentPath = getParentPath(entry.path);
    while (parentPath && parentPath !== currentManifest?.itemFolderPath) {
      if (!expandedEntryPaths.has(parentPath)) {
        return false;
      }
      parentPath = getParentPath(parentPath);
    }
    return true;
  }), [currentManifest?.itemFolderPath, entries, expandedEntryPaths]);

  const loadItemState = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const nextManifest = await loadPdfItemManifest(rootHandle, generateFileId(filePath), filePath, {
        documentId: documentId ?? initialManifest?.itemId ?? null,
        fileFingerprint: fileFingerprint ?? initialManifest?.fileFingerprint ?? null,
        versionFingerprint: versionFingerprint ?? initialManifest?.versionFingerprint ?? null,
      });
      const resolvedManifest = initialManifest ?? nextManifest;
      const directoryHandle = await resolveDirectoryHandle(rootHandle, resolvedManifest.itemFolderPath);
      const nextEntries = directoryHandle ? await listPdfItemNotes(rootHandle, resolvedManifest) : [];
      setCurrentManifest(resolvedManifest);
      setEntries(nextEntries);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [documentId, fileFingerprint, filePath, initialManifest, rootHandle, versionFingerprint]);

  const revealPdfEntry = useCallback((expandChildren = false) => {
    useExplorerStore.getState().setSelection(filePath, "file");
    const parentPath = getParentPath(filePath);
    setSelectedDirectoryPath(parentPath || null);

    const latestFileTree = useWorkspaceStore.getState().fileTree;
    for (const ancestorPath of getAncestorDirectoryPaths(parentPath)) {
      const ancestorNode = findTreeNodeByPath(latestFileTree.root, ancestorPath);
      if (ancestorNode?.kind === "directory" && !ancestorNode.isExpanded) {
        toggleDirectory(ancestorPath);
      }
    }

    const pdfNode = findTreeNodeByPath(latestFileTree.root, filePath) as FileNode | null;
    if (expandChildren && pdfNode?.children?.length && !pdfNode.isExpanded) {
      toggleDirectory(filePath);
    }
  }, [filePath, setSelectedDirectoryPath, toggleDirectory]);

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
      fileFingerprint: fileFingerprint ?? initialManifest?.fileFingerprint ?? null,
      versionFingerprint: versionFingerprint ?? initialManifest?.versionFingerprint ?? null,
    });
    setCurrentManifest(currentManifest);
    await refreshDirectory({ silent: true });
    return currentManifest;
  }, [documentId, fileFingerprint, filePath, initialManifest?.fileFingerprint, initialManifest?.itemId, initialManifest?.versionFingerprint, refreshDirectory, rootHandle, versionFingerprint]);

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

  const handleOpenEntry = useCallback(async (entry: PdfItemNoteSummary) => {
    setBusyAction(`open:${entry.path}`);
    setError(null);
    try {
      if (entry.type === "directory") {
        setSelectedDirectoryPath(entry.path);
        setExpandedEntryPaths((current) => {
          const next = new Set(current);
          if (next.has(entry.path)) {
            next.delete(entry.path);
          } else {
            next.add(entry.path);
          }
          return next;
        });
        return;
      }
      const resolvedEntry = await resolveEntry(rootHandle, entry.path);
      if (!resolvedEntry || resolvedEntry.kind !== "file") {
        throw new Error(t("pdf.workspace.error.open", { path: entry.path }));
      }
      openHandleNearPdf(resolvedEntry.handle as FileSystemFileHandle, entry.path);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    } finally {
      setBusyAction(null);
    }
  }, [openHandleNearPdf, rootHandle, setSelectedDirectoryPath, t]);

  const handleDeleteNote = useCallback(async (note: PdfItemNoteSummary) => {
    if (note.type === "annotation-note" || note.type === "directory") {
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
    revealPdfEntry(true);
  }, [revealPdfEntry]);

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

    const title = enrichment?.title ?? summary.title;
    const authors = enrichment?.authors ?? summary.authors;
    const year = enrichment?.year ?? summary.year;
    const doi = enrichment?.doi ?? summary.doi;
    const arxivId = enrichment?.arxivId ?? summary.arxivId;
    const subject = enrichment?.subject ?? summary.subject;
    const metadataLines = [
      `- Source PDF: [${fileName}](${filePath})`,
      `- PDF path: \`${filePath}\``,
      year ? `- Year: ${year}` : null,
      authors.length > 0 ? `- Authors: ${authors.join(", ")}` : null,
      summary.pageCount ? `- Pages: ${summary.pageCount}` : null,
      `- Annotations: ${pdfAnnotations.length}`,
      `- Related files: ${entries.length}`,
      doi ? `- DOI: [${doi}](https://doi.org/${doi})` : null,
      arxivId ? `- arXiv: [${arxivId}](https://arxiv.org/abs/${arxivId})` : null,
      subject ? `- Subject: ${subject}` : null,
      enrichment?.venue ? `- Venue: ${enrichment.venue}` : null,
    ].filter(Boolean);
    const lines = [
      `# ${title}`,
      "",
      ...metadataLines,
      enrichment?.abstract ? ["", "## Abstract", "", enrichment.abstract].join("\n") : null,
    ].filter(Boolean).join("\n");

    await copyToClipboard(lines);
    setCopyMenuOpen(false);
  }, [enrichment, entries.length, fileName, filePath, pdfAnnotations.length, summary]);

  const handleCopyCitation = useCallback(async () => {
    if (!summary) {
      return;
    }
    await copyToClipboard(buildSimpleCitation({ summary, enrichment }));
    setCopyMenuOpen(false);
  }, [enrichment, summary]);

  const handleCopyBibtex = useCallback(async () => {
    if (!summary) {
      return;
    }
    await copyToClipboard(buildSimpleBibtex({ fileName, summary, enrichment }));
    setCopyMenuOpen(false);
  }, [enrichment, fileName, summary]);

  const actionsDisabled = Boolean(busyAction);

  return (
    <section className="shrink-0 border-b border-border bg-background/95 px-2 py-1.5">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setIsExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent/40"
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("pdf.workspace.title")}
            </div>
            <div className="min-w-0 flex-1 truncate text-[11px] text-foreground">{fileName}</div>
            <span className="shrink-0 rounded border border-border bg-muted/35 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {isAnnotationsLoading
                ? t("workbench.annotations.loading")
                : t("pdf.workspace.count.annotations", { count: pdfAnnotations.length })}
            </span>
            <span className="shrink-0 rounded border border-border bg-muted/35 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {t("pdf.workspace.count.notes", { count: entries.length })}
            </span>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
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
            disabled={actionsDisabled}
          >
            <FolderOpen className="h-4 w-4" />
          </ActionIconButton>
          {summary ? (
            <div className="relative">
              <ActionIconButton
                title={t("pdf.workspace.meta.copy")}
                onClick={() => setCopyMenuOpen((open) => !open)}
                disabled={actionsDisabled}
              >
                <Copy className="h-4 w-4" />
              </ActionIconButton>
              {copyMenuOpen ? (
                <div className="absolute right-0 top-9 z-20 min-w-36 rounded-md border border-border bg-popover p-1 text-xs text-popover-foreground shadow-lg">
                  <button
                    type="button"
                    onClick={() => void handleCopySummary()}
                    className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent"
                  >
                    {t("pdf.workspace.meta.copy")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyCitation()}
                    className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent"
                  >
                    {t("pdf.workspace.meta.copyCitation")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyBibtex()}
                    className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent"
                  >
                    {t("pdf.workspace.meta.copyBibtex")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {isExpanded ? (
        <>
          {currentManifest ? (
            <div className="mt-1.5 rounded-md border border-border bg-muted/15 px-2 py-1.5 text-[10px] leading-5 text-muted-foreground">
              <div className="truncate">
                <span className="font-medium text-foreground">Current PDF:</span> {filePath}
              </div>
              {originalPdfPath ? (
                <div className="truncate">
                  <span className="font-medium text-foreground">Original PDF:</span> {originalPdfPath}
                </div>
              ) : null}
              <div className="truncate">
                <span className="font-medium text-foreground">Item workspace:</span> {currentManifest.itemFolderPath}
              </div>
            </div>
          ) : null}

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

          {!isLoading && visibleEntries.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
              {visibleEntries.map((note) => {
                const isDirectoryExpanded = note.type === "directory" && expandedEntryPaths.has(note.path);
                return (
                <div
                  key={note.path}
                  className="inline-flex items-center rounded border border-border bg-muted/30 transition-colors hover:bg-muted"
                  style={{ marginLeft: `${Math.min(note.depth ?? 0, 4) * 8}px` }}
                >
                  <button
                    type="button"
                    onClick={() => void handleOpenEntry(note)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5"
                    title={`${noteLabel(note.type, t)} ${note.path}`}
                  >
                    {note.type === "directory" ? (
                      isDirectoryExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
                    ) : note.type === "file" ? (
                      <FileIcon className="h-3 w-3" />
                    ) : null}
                    <span>{entryDisplayName(note)}</span>
                  </button>
                  {note.type !== "annotation-note" && note.type !== "directory" ? (
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
              );
              })}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default PdfItemWorkspacePanel;
