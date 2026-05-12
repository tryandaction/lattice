"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties } from "react";
import mammoth from "mammoth";
import { renderAsync as renderDocxAsync } from "docx-preview";
import DOMPurify from "dompurify";
import { Loader2, AlertTriangle, Search, ChevronDown, ChevronUp, X, FilePenLine, RefreshCw } from "lucide-react";
import { useFileSystem } from "@/hooks/use-file-system";
import { useI18n } from "@/hooks/use-i18n";
import { usePersistedViewState } from "@/hooks/use-persisted-view-state";
import { usePaneCommandBar } from "@/hooks/use-pane-command-bar";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { emitVaultChange } from "@/lib/plugins/runtime";
import { buildPersistedFileViewStateKey } from "@/lib/file-view-state";
import { openSystemPath } from "@/lib/link-router/open-external";
import { resolveWorkspaceFilePath } from "@/lib/runner/path-utils";
import { readDesktopFileBytes } from "@/lib/desktop-file-system";
import type { CommandBarState, PaneId } from "@/types/layout";
import { useSelectionContextMenu } from "@/hooks/use-selection-context-menu";
import { createSelectionContext, type SelectionAiMode, type SelectionContext } from "@/lib/ai/selection-context";
import { SelectionContextMenu } from "@/components/ai/selection-context-menu";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";
import { buildBlockSelectionContext } from "@/lib/ai/selection-dom";

const WORD_ZOOM_MIN = 0.35;
const WORD_ZOOM_MAX = 2;
const WORD_ZOOM_STEP = 0.1;
const WORD_FIT_WIDTH_GUTTER = 56;

type WordPreviewMode = "docx" | "semantic";
type WordZoomMode = "fit-width" | "actual";

interface WordViewerProps {
  content: ArrayBuffer;
  fileName: string;
  paneId?: PaneId;
  filePath?: string;
}

/**
 * Convert HTML to basic Markdown
 */
function htmlToMarkdown(html: string): string {
  let markdown = html;
  
  // Convert headings
  markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n");
  markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n");
  markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n");
  markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n\n");
  markdown = markdown.replace(/<h5[^>]*>(.*?)<\/h5>/gi, "##### $1\n\n");
  markdown = markdown.replace(/<h6[^>]*>(.*?)<\/h6>/gi, "###### $1\n\n");
  
  // Convert bold and italic
  markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**");
  markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**");
  markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*");
  markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*");
  
  // Convert lists
  markdown = markdown.replace(/<ul[^>]*>/gi, "\n");
  markdown = markdown.replace(/<\/ul>/gi, "\n");
  markdown = markdown.replace(/<ol[^>]*>/gi, "\n");
  markdown = markdown.replace(/<\/ol>/gi, "\n");
  markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n");
  
  // Convert paragraphs
  markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n");
  
  // Convert line breaks
  markdown = markdown.replace(/<br\s*\/?>/gi, "\n");
  
  // Remove remaining HTML tags
  markdown = markdown.replace(/<[^>]+>/g, "");
  
  // Decode HTML entities
  markdown = markdown.replace(/&nbsp;/g, " ");
  markdown = markdown.replace(/&amp;/g, "&");
  markdown = markdown.replace(/&lt;/g, "<");
  markdown = markdown.replace(/&gt;/g, ">");
  markdown = markdown.replace(/&quot;/g, '"');
  
  // Clean up extra whitespace
  markdown = markdown.replace(/\n{3,}/g, "\n\n");
  markdown = markdown.trim();
  
  return markdown;
}

function extractSearchableWordText(html: string): string {
  if (!html.trim()) {
    return "";
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

function extractContainerText(container: HTMLElement | null): string {
  return (container?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function clampWordZoom(value: number): number {
  return Math.min(WORD_ZOOM_MAX, Math.max(WORD_ZOOM_MIN, value));
}

function parseCssLengthToPx(value: string): number {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(px|pt|in|cm|mm)?$/i);
  if (!match) {
    return 0;
  }

  const amount = Number.parseFloat(match[1]);
  const unit = match[2]?.toLowerCase() ?? "px";
  switch (unit) {
    case "pt":
      return amount * (96 / 72);
    case "in":
      return amount * 96;
    case "cm":
      return amount * (96 / 2.54);
    case "mm":
      return amount * (96 / 25.4);
    case "px":
    default:
      return amount;
  }
}

function measureDocxPageWidth(page: HTMLElement | null): number {
  if (!page) {
    return 0;
  }

  if (page.offsetWidth > 0) {
    return page.offsetWidth;
  }

  const inlineWidth = parseCssLengthToPx(page.style.width);
  if (inlineWidth > 0) {
    return inlineWidth;
  }

  const computedWidth = parseCssLengthToPx(window.getComputedStyle(page).width);
  if (computedWidth > 0) {
    return computedWidth;
  }

  return page.getBoundingClientRect().width;
}

function findWordMatches(text: string, query: string): number[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  const haystack = text.toLowerCase();
  const matches: number[] = [];
  let index = 0;

  while ((index = haystack.indexOf(needle, index)) !== -1) {
    matches.push(index);
    index += needle.length;
  }

  return matches;
}

function buildHighlightedWordHtml(html: string, query: string, activeIndex: number): string {
  const trimmed = query.trim();
  if (!trimmed) {
    return html;
  }

  const lowerNeedle = trimmed.toLowerCase();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent?.trim()) {
        return NodeFilter.FILTER_SKIP;
      }
      const parent = (node.parentElement ?? null);
      if (parent && ["SCRIPT", "STYLE", "MARK"].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }

  let matchIndex = 0;
  for (const node of nodes) {
    const text = node.textContent ?? "";
    const lowerText = text.toLowerCase();
    let searchIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let changed = false;

    while ((searchIndex = lowerText.indexOf(lowerNeedle, searchIndex)) !== -1) {
      changed = true;
      if (searchIndex > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, searchIndex)));
      }

      const mark = document.createElement("mark");
      mark.setAttribute("data-word-search-match-index", String(matchIndex));
      mark.className = matchIndex === activeIndex
        ? "rounded bg-primary/30 px-0.5 text-foreground ring-1 ring-primary/50"
        : "rounded bg-primary/15 px-0.5 text-foreground";
      mark.textContent = text.slice(searchIndex, searchIndex + trimmed.length);
      fragment.appendChild(mark);

      lastIndex = searchIndex + trimmed.length;
      searchIndex = lastIndex;
      matchIndex += 1;
    }

    if (!changed) {
      continue;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    node.parentNode?.replaceChild(fragment, node);
  }

  return doc.body.innerHTML;
}

function clearWordSearchMarks(root: HTMLElement | null): void {
  if (!root) {
    return;
  }

  root.querySelectorAll("mark[data-word-search-match-index]").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) {
      return;
    }
    parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    parent.normalize();
  });
}

function highlightWordPreviewMatches(root: HTMLElement | null, query: string, activeIndex: number): number {
  if (!root) {
    return 0;
  }

  clearWordSearchMarks(root);
  const trimmed = query.trim();
  if (!trimmed) {
    return 0;
  }

  const lowerNeedle = trimmed.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent?.trim()) {
        return NodeFilter.FILTER_SKIP;
      }
      const parent = node instanceof Text ? node.parentElement : null;
      if (parent && ["SCRIPT", "STYLE", "MARK"].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }

  let matchIndex = 0;
  for (const node of nodes) {
    const text = node.textContent ?? "";
    const lowerText = text.toLowerCase();
    let searchIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let changed = false;

    while ((searchIndex = lowerText.indexOf(lowerNeedle, searchIndex)) !== -1) {
      changed = true;
      if (searchIndex > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, searchIndex)));
      }

      const mark = document.createElement("mark");
      mark.setAttribute("data-word-search-match-index", String(matchIndex));
      mark.className = matchIndex === activeIndex
        ? "word-search-match word-search-match-active"
        : "word-search-match";
      mark.textContent = text.slice(searchIndex, searchIndex + trimmed.length);
      fragment.appendChild(mark);

      lastIndex = searchIndex + trimmed.length;
      searchIndex = lastIndex;
      matchIndex += 1;
    }

    if (!changed) {
      continue;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    node.parentNode?.replaceChild(fragment, node);
  }

  return matchIndex;
}

/**
 * Word Document Viewer component
 * Renders DOCX files with a layout-focused preview and keeps semantic HTML for search/import.
 */
export function WordViewer({ content, fileName, paneId, filePath }: WordViewerProps) {
  const { t } = useI18n();
  const isLegacyDoc = /\.doc$/i.test(fileName);
  const [documentContent, setDocumentContent] = useState(content);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<WordPreviewMode>("docx");
  const [zoomMode, setZoomMode] = useState<WordZoomMode>("fit-width");
  const [manualZoom, setManualZoom] = useState(1);
  const [fitWidthZoom, setFitWidthZoom] = useState(1);
  const [previewSearchMatchCount, setPreviewSearchMatchCount] = useState(0);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchMatch, setActiveSearchMatch] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReloadingFromDisk, setIsReloadingFromDisk] = useState(false);
  const [lastReloadedAt, setLastReloadedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const docxViewportRef = useRef<HTMLDivElement>(null);
  const docxPreviewRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tRef = useRef(t);

  const { createFile } = useFileSystem();
  const openFileInActivePane = useWorkspaceStore((state) => state.openFileInActivePane);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const rootHandleName = useWorkspaceStore((state) => state.rootHandle?.name ?? null);
  const workspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const absoluteFilePath = useMemo(() => (
    filePath ? resolveWorkspaceFilePath(workspaceRootPath, filePath, rootHandleName) : null
  ), [filePath, rootHandleName, workspaceRootPath]);
  const markdownSnapshot = useMemo(() => htmlToMarkdown(htmlContent || ""), [htmlContent]);
  const searchableText = useMemo(() => extractSearchableWordText(htmlContent || ""), [htmlContent]);
  const searchMatches = useMemo(() => findWordMatches(searchableText, searchQuery), [searchableText, searchQuery]);
  const effectiveSearchMatchCount = previewMode === "docx" ? previewSearchMatchCount : searchMatches.length;
  const currentZoom = previewMode === "docx"
    ? clampWordZoom(zoomMode === "fit-width" ? fitWidthZoom : manualZoom)
    : 1;
  const zoomPercent = Math.round(currentZoom * 100);
  const renderedHtml = useMemo(() => {
    if (!htmlContent) {
      return "";
    }
    if (!searchOpen || !searchQuery.trim()) {
      return htmlContent;
    }
    return buildHighlightedWordHtml(htmlContent, searchQuery, activeSearchMatch);
  }, [activeSearchMatch, htmlContent, searchOpen, searchQuery]);
  const visibleWarnings = previewMode === "semantic" || diagnosticsOpen || isLegacyDoc
    ? warnings
    : [];
  const hiddenDiagnosticsCount = warnings.length - visibleWarnings.length;
  const docxPreviewStyle = {
    "--word-docx-zoom": currentZoom,
  } as CSSProperties;
  const updateFitWidthZoom = useCallback(() => {
    if (previewMode !== "docx") {
      return;
    }

    const viewportWidth = docxViewportRef.current?.clientWidth ?? 0;
    const firstPage = docxPreviewRef.current?.querySelector<HTMLElement>("section.lattice-docx") ?? null;
    const pageWidth = measureDocxPageWidth(firstPage);
    if (viewportWidth <= 0 || pageWidth <= 0) {
      return;
    }

    const availableWidth = Math.max(240, viewportWidth - WORD_FIT_WIDTH_GUTTER);
    setFitWidthZoom(clampWordZoom(Math.min(1, availableWidth / pageWidth)));
  }, [previewMode]);
  const persistedViewStateKey = buildPersistedFileViewStateKey({
    kind: "word",
    workspaceKey,
    workspaceRootPath,
    filePath,
    fallbackName: fileName,
  });

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    setDocumentContent(content);
    setLastReloadedAt(null);
  }, [content]);

  useEffect(() => {
    let disposed = false;

    async function convertDocument() {
      setIsLoading(true);
      setError(null);
      setPreviewMode("docx");
      setPreviewSearchMatchCount(0);
      setFitWidthZoom(1);
      setDiagnosticsOpen(false);
      setWarnings([]);
      setHtmlContent(null);
      if (docxPreviewRef.current) {
        docxPreviewRef.current.innerHTML = "";
      }

      try {
        let renderedHighFidelityPreview = false;
        if (isLegacyDoc) {
          setPreviewMode("semantic");
          setWarnings((current) => [
            ...current,
            tRef.current("viewer.word.legacyWarning"),
          ]);
        } else {
          const target = docxPreviewRef.current;
          if (!target) {
            throw new Error("Word preview container is not ready.");
          }

          try {
            await renderDocxAsync(documentContent.slice(0), target, target, {
              className: "lattice-docx",
              inWrapper: true,
              ignoreWidth: false,
              ignoreHeight: false,
              ignoreFonts: false,
              breakPages: true,
              ignoreLastRenderedPageBreak: false,
              experimental: true,
              renderHeaders: true,
              renderFooters: true,
              renderFootnotes: true,
              renderEndnotes: true,
              renderComments: false,
              renderAltChunks: true,
              useBase64URL: false,
            });
            renderedHighFidelityPreview = true;
            if (!disposed) {
              setPreviewMode("docx");
              window.requestAnimationFrame(updateFitWidthZoom);
            }
          } catch (previewError) {
            if (!disposed) {
              console.warn("[WordViewer] High-fidelity DOCX preview failed; falling back to semantic HTML.", previewError);
              setPreviewMode("semantic");
              setWarnings((current) => [
                ...current,
                tRef.current("viewer.word.previewFallback"),
              ]);
            }
          }
        }

        try {
          const result = await mammoth.convertToHtml({ arrayBuffer: documentContent });
          if (disposed) {
            return;
          }
          const safeHtml = result.value || `<p>${extractContainerText(docxPreviewRef.current)}</p>`;
          setHtmlContent(safeHtml);
          const semanticMessages = result.messages.map((m) => m.message);
          if (semanticMessages.length > 0) {
            setWarnings((current) => [
              ...current,
              ...semanticMessages,
            ]);
          }
        } catch (semanticError) {
          if (disposed) {
            return;
          }

          const previewText = extractContainerText(docxPreviewRef.current);
          if (renderedHighFidelityPreview && previewText) {
            setHtmlContent(`<p>${previewText}</p>`);
            setWarnings((current) => [
              ...current,
              tRef.current("viewer.word.semanticFallback"),
            ]);
            return;
          }

          throw semanticError;
        }
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : tRef.current("viewer.word.errorDescription"));
        }
      } finally {
        if (!disposed) {
          setIsLoading(false);
        }
      }
    }

    convertDocument();
    return () => {
      disposed = true;
    };
  }, [documentContent, isLegacyDoc, updateFitWidthZoom]);

  useEffect(() => {
    if (previewMode !== "docx") {
      return;
    }

    updateFitWidthZoom();
    const viewport = docxViewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateFitWidthZoom);
      return () => window.removeEventListener("resize", updateFitWidthZoom);
    }

    const observer = new ResizeObserver(() => updateFitWidthZoom());
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [previewMode, updateFitWidthZoom]);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [searchOpen]);

  useEffect(() => {
    if (activeSearchMatch >= effectiveSearchMatchCount) {
      setActiveSearchMatch(0);
    }
  }, [activeSearchMatch, effectiveSearchMatchCount]);

  useEffect(() => {
    if (previewMode !== "docx") {
      return;
    }

    const count = highlightWordPreviewMatches(
      docxPreviewRef.current,
      searchOpen ? searchQuery : "",
      activeSearchMatch,
    );
    setPreviewSearchMatchCount(count);

    if (!searchOpen || count === 0) {
      return;
    }

    const activeMark = docxPreviewRef.current?.querySelector<HTMLElement>(
      `[data-word-search-match-index="${activeSearchMatch}"]`,
    );
    activeMark?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeSearchMatch, previewMode, searchOpen, searchQuery]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!searchOpen || previewMode === "docx" || searchMatches.length === 0) {
      return;
    }

    const activeMark = containerRef.current?.querySelector<HTMLElement>(
      `[data-word-search-match-index="${activeSearchMatch}"]`,
    );
    activeMark?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeSearchMatch, previewMode, searchMatches.length, searchOpen]);

  const goToMatch = useCallback((direction: 1 | -1) => {
    if (effectiveSearchMatchCount === 0) {
      return;
    }
    setActiveSearchMatch((current) => (current + direction + effectiveSearchMatchCount) % effectiveSearchMatchCount);
  }, [effectiveSearchMatchCount]);

  /**
   * Import the document as a Markdown note
   */
  const handleImportAsNote = useCallback(async () => {
    if (!htmlContent) return;

    setIsImporting(true);
    try {
      // Convert HTML to Markdown
      const markdown = htmlToMarkdown(htmlContent);
      
      // Generate filename from original
      const baseName = fileName.replace(/\.docx?$/i, "");
      
      // Create the new file
      const result = await createFile(baseName, "note");
      
      if (result.success && result.handle && result.path) {
        // Write the markdown content
        const writable = await result.handle.createWritable();
        await writable.write(`# ${baseName}\n\n${markdown}`);
        await writable.close();
        emitVaultChange(result.path);
        
        // Open the new file
        openFileInActivePane(result.handle, result.path);
      }
    } catch (err) {
      console.error("Failed to import document:", err);
    } finally {
      setIsImporting(false);
    }
  }, [htmlContent, fileName, createFile, openFileInActivePane]);

  const handleOpenInSystemEditor = useCallback(async () => {
    if (!absoluteFilePath) {
      return;
    }

    try {
      await openSystemPath(absoluteFilePath);
    } catch (err) {
      console.error("Failed to open document in the system editor:", err);
    }
  }, [absoluteFilePath]);

  const handleReloadFromDisk = useCallback(async () => {
    if (!absoluteFilePath) {
      return;
    }

    setIsReloadingFromDisk(true);
    try {
      const bytes = await readDesktopFileBytes(absoluteFilePath);
      const nextContent = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      setDocumentContent(nextContent);
      setLastReloadedAt(Date.now());
    } catch (err) {
      console.error("Failed to reload Word document from disk:", err);
      setWarnings((current) => [
        ...current,
        tRef.current("viewer.word.reload.failed"),
      ]);
      setDiagnosticsOpen(true);
    } finally {
      setIsReloadingFromDisk(false);
    }
  }, [absoluteFilePath]);

  const handleFitWidth = useCallback(() => {
    setZoomMode("fit-width");
    updateFitWidthZoom();
  }, [updateFitWidthZoom]);

  const handleActualSize = useCallback(() => {
    setZoomMode("actual");
    setManualZoom(1);
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoomMode("actual");
    setManualZoom(clampWordZoom(currentZoom + WORD_ZOOM_STEP));
  }, [currentZoom]);

  const handleZoomOut = useCallback(() => {
    setZoomMode("actual");
    setManualZoom(clampWordZoom(currentZoom - WORD_ZOOM_STEP));
  }, [currentZoom]);

  const { menuState: selectionMenuState, closeMenu: closeSelectionMenu } = useSelectionContextMenu(
    containerRef,
    ({ text, eventTarget }) => {
      if (!paneId) return null;
      const blockContext = buildBlockSelectionContext(eventTarget);
      return createSelectionContext({
        sourceKind: "word",
        paneId,
        fileName,
        filePath,
        selectedText: text,
        documentText: markdownSnapshot,
        contextText: blockContext.contextText,
        blockLabel: blockContext.blockLabel,
      });
    }
  );

  usePersistedViewState({
    storageKey: persistedViewStateKey,
    containerRef,
  });

  const commandBarState = useMemo<CommandBarState>(() => {
    const breadcrumbs = (filePath ?? fileName).split("/").filter(Boolean).map((segment) => ({ label: segment }));
    return {
      breadcrumbs,
      actions: [
        {
          id: "search",
          label: t("viewer.word.search.open"),
          icon: "search",
          priority: 6,
          group: "secondary",
          onTrigger: () => setSearchOpen(true),
        },
        {
          id: "fit-width",
          label: t("viewer.word.command.fitWidth"),
          icon: "arrow-left-right",
          priority: 7,
          group: "secondary",
          active: previewMode === "docx" && zoomMode === "fit-width",
          disabled: previewMode !== "docx",
          onTrigger: handleFitWidth,
        },
        {
          id: "actual-size",
          label: t("viewer.word.command.actualSize"),
          icon: "maximize-2",
          priority: 8,
          group: "secondary",
          active: previewMode === "docx" && zoomMode === "actual" && Math.abs(currentZoom - 1) < 0.01,
          disabled: previewMode !== "docx",
          onTrigger: handleActualSize,
        },
        {
          id: "zoom-out",
          label: t("viewer.word.command.zoomOut", { percent: zoomPercent }),
          icon: "zoom-out",
          priority: 9,
          group: "secondary",
          disabled: previewMode !== "docx" || currentZoom <= WORD_ZOOM_MIN + 0.01,
          onTrigger: handleZoomOut,
        },
        {
          id: "zoom-in",
          label: t("viewer.word.command.zoomIn", { percent: zoomPercent }),
          icon: "zoom-in",
          priority: 10,
          group: "secondary",
          disabled: previewMode !== "docx" || currentZoom >= WORD_ZOOM_MAX - 0.01,
          onTrigger: handleZoomIn,
        },
        {
          id: "open-system-editor",
          label: t("viewer.word.command.openSystemEditor"),
          icon: "file-pen-line",
          priority: 11,
          group: "secondary",
          disabled: !absoluteFilePath,
          onTrigger: () => { void handleOpenInSystemEditor(); },
        },
        {
          id: "reload-from-disk",
          label: isReloadingFromDisk ? t("viewer.word.command.reloading") : t("viewer.word.command.reloadFromDisk"),
          icon: "rotate-ccw",
          priority: 12,
          group: "secondary",
          disabled: !absoluteFilePath || isReloadingFromDisk,
          onTrigger: () => { void handleReloadFromDisk(); },
        },
        {
          id: "import-as-note",
          label: isImporting ? t("viewer.word.command.importing") : t("viewer.word.command.import"),
          icon: "file-output",
          priority: 13,
          group: "primary",
          disabled: isImporting || !htmlContent,
          onTrigger: () => { void handleImportAsNote(); },
        },
      ],
    };
  }, [
    fileName,
    filePath,
    absoluteFilePath,
    currentZoom,
    handleActualSize,
    handleFitWidth,
    handleImportAsNote,
    handleOpenInSystemEditor,
    handleReloadFromDisk,
    handleZoomIn,
    handleZoomOut,
    htmlContent,
    isImporting,
    isReloadingFromDisk,
    previewMode,
    setSearchOpen,
    t,
    zoomMode,
    zoomPercent,
  ]);

  usePaneCommandBar({
    paneId,
    state: paneId ? commandBarState : null,
  });

  if (error && !isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <p className="text-destructive">{t("viewer.word.error", { error })}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("viewer.word.errorDescription")}
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full overflow-auto">
      {isLoading ? (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/90 p-8 backdrop-blur-sm">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">{t("viewer.word.loading")}</p>
        </div>
      ) : null}
      <SelectionContextMenu
        state={selectionMenuState}
        onClose={closeSelectionMenu}
        onOpenHub={(context, mode, returnFocusTo) => setSelectionHubState({ context, mode, returnFocusTo })}
      />
      <SelectionAiHub
        context={selectionHubState?.context ?? null}
        initialMode={selectionHubState?.mode ?? "chat"}
        returnFocusTo={selectionHubState?.returnFocusTo}
        onClose={() => setSelectionHubState(null)}
      />

      {/* Read-only notice */}
      <div className="mx-auto max-w-4xl px-8 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          <p>{t("viewer.word.readOnly")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {hiddenDiagnosticsCount > 0 ? (
              <button
                type="button"
                onClick={() => setDiagnosticsOpen((current) => !current)}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
              >
                {diagnosticsOpen
                  ? t("viewer.word.diagnostics.hide")
                  : t("viewer.word.diagnostics.show", { count: hiddenDiagnosticsCount })}
              </button>
            ) : null}
            {previewMode === "docx" ? (
              <span className="rounded-md bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
                {zoomMode === "fit-width"
                  ? t("viewer.word.zoom.fitWidth", { percent: zoomPercent })
                  : t("viewer.word.zoom.actual", { percent: zoomPercent })}
              </span>
            ) : null}
            {lastReloadedAt ? (
              <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                {t("viewer.word.reload.lastReloaded")}
              </span>
            ) : null}
            {absoluteFilePath ? (
              <button
                type="button"
                onClick={() => { void handleReloadFromDisk(); }}
                disabled={isReloadingFromDisk}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                <RefreshCw className={isReloadingFromDisk ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                {isReloadingFromDisk ? t("viewer.word.command.reloading") : t("viewer.word.command.reloadFromDisk")}
              </button>
            ) : null}
            {absoluteFilePath ? (
              <button
                type="button"
                onClick={() => { void handleOpenInSystemEditor(); }}
                className="inline-flex items-center gap-1 rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background hover:bg-foreground/90"
              >
                <FilePenLine className="h-3.5 w-3.5" />
                {t("viewer.word.command.openSystemEditor")}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-8 pt-3">
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/10 p-3 text-xs leading-relaxed text-muted-foreground">
          <div className="font-medium text-sky-700 dark:text-sky-300">
            {t("viewer.word.professional.title")}
          </div>
          <p className="mt-1">
            {t("viewer.word.professional.description")}
          </p>
        </div>
      </div>

      {searchOpen ? (
        <div className="sticky top-2 z-40 mx-auto flex max-w-4xl justify-end px-8 pt-2">
          <div className="flex w-full max-w-md items-center gap-1 rounded-lg border border-border bg-background/95 px-2 py-2 shadow-lg backdrop-blur-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setActiveSearchMatch(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  goToMatch(event.shiftKey ? -1 : 1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setSearchOpen(false);
                  setSearchQuery("");
                  setActiveSearchMatch(0);
                }
              }}
              placeholder={t("viewer.word.search.placeholder")}
              className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <span className="whitespace-nowrap text-[10px] text-muted-foreground">
              {searchQuery.trim()
                ? effectiveSearchMatchCount > 0
                  ? `${activeSearchMatch + 1}/${effectiveSearchMatchCount}`
                  : t("viewer.word.search.noMatch")
                : t("viewer.word.search.noMatch")}
            </span>
            <button
              type="button"
              onClick={() => goToMatch(-1)}
              disabled={effectiveSearchMatchCount === 0}
              className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
              title={t("viewer.word.search.prevMatch")}
            >
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={() => goToMatch(1)}
              disabled={effectiveSearchMatchCount === 0}
              className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
              title={t("viewer.word.search.nextMatch")}
            >
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchOpen(false);
                setSearchQuery("");
                setActiveSearchMatch(0);
              }}
              className="rounded p-0.5 hover:bg-accent"
              title={t("viewer.word.search.close")}
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Warnings */}
      {isLegacyDoc && (
        <div className="mx-auto max-w-4xl px-8 pt-4">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-muted-foreground">
            <p>{t("viewer.word.legacyWarning")}</p>
          </div>
        </div>
      )}

      {visibleWarnings.length > 0 && (
        <div className="mx-auto max-w-4xl px-8 pt-4">
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3">
            <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-500">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">
                {previewMode === "docx" ? t("viewer.word.diagnostics.title") : t("viewer.word.warnings")}
              </span>
            </div>
            <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
              {visibleWarnings.slice(0, 5).map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
              {visibleWarnings.length > 5 && (
                <li>{t("viewer.word.warnings.more", { count: visibleWarnings.length - 5 })}</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* Document content */}
      <div
        ref={docxViewportRef}
        className={previewMode === "docx" ? "word-fidelity-stage px-4 py-6 sm:px-8" : "mx-auto max-w-4xl p-8"}
      >
        <div className={previewMode === "docx" ? "word-docx-scale-shell" : "hidden"} style={docxPreviewStyle}>
          <div
            ref={docxPreviewRef}
            data-testid="word-docx-preview"
            className="word-docx-preview document-container"
          />
        </div>
        <article
          data-testid="word-semantic-preview"
          className={previewMode === "semantic"
            ? "prose prose-slate dark:prose-invert max-w-none prose-headings:font-serif prose-p:font-sans prose-p:leading-relaxed prose-table:border-collapse prose-td:border prose-td:border-border prose-td:p-2 prose-th:border prose-th:border-border prose-th:bg-muted prose-th:p-2"
            : "hidden"}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderedHtml || "") }}
        />
      </div>
    </div>
  );
}
