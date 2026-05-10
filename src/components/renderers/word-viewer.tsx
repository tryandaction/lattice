"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import mammoth from "mammoth";
import DOMPurify from "dompurify";
import { Loader2, AlertTriangle, Search, ChevronDown, ChevronUp, X } from "lucide-react";
import { useFileSystem } from "@/hooks/use-file-system";
import { useI18n } from "@/hooks/use-i18n";
import { usePersistedViewState } from "@/hooks/use-persisted-view-state";
import { usePaneCommandBar } from "@/hooks/use-pane-command-bar";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { emitVaultChange } from "@/lib/plugins/runtime";
import { buildPersistedFileViewStateKey } from "@/lib/file-view-state";
import type { CommandBarState, PaneId } from "@/types/layout";
import { useSelectionContextMenu } from "@/hooks/use-selection-context-menu";
import { createSelectionContext, type SelectionAiMode, type SelectionContext } from "@/lib/ai/selection-context";
import { SelectionContextMenu } from "@/components/ai/selection-context-menu";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";
import { buildBlockSelectionContext } from "@/lib/ai/selection-dom";

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

/**
 * Word Document Viewer component
 * Renders Word documents (.doc, .docx) using mammoth.js
 * Includes "Import as Note" functionality
 */
export function WordViewer({ content, fileName, paneId, filePath }: WordViewerProps) {
  const { t } = useI18n();
  const isLegacyDoc = /\.doc$/i.test(fileName);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchMatch, setActiveSearchMatch] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { createFile } = useFileSystem();
  const openFileInActivePane = useWorkspaceStore((state) => state.openFileInActivePane);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const workspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const markdownSnapshot = useMemo(() => htmlToMarkdown(htmlContent || ""), [htmlContent]);
  const searchableText = useMemo(() => extractSearchableWordText(htmlContent || ""), [htmlContent]);
  const searchMatches = useMemo(() => findWordMatches(searchableText, searchQuery), [searchableText, searchQuery]);
  const renderedHtml = useMemo(() => {
    if (!htmlContent) {
      return "";
    }
    if (!searchOpen || !searchQuery.trim()) {
      return htmlContent;
    }
    return buildHighlightedWordHtml(htmlContent, searchQuery, activeSearchMatch);
  }, [activeSearchMatch, htmlContent, searchOpen, searchQuery]);
  const persistedViewStateKey = buildPersistedFileViewStateKey({
    kind: "word",
    workspaceKey,
    workspaceRootPath,
    filePath,
    fallbackName: fileName,
  });

  useEffect(() => {
    async function convertDocument() {
      setIsLoading(true);
      setError(null);

      try {
        const result = await mammoth.convertToHtml({ arrayBuffer: content });
        setHtmlContent(result.value);
        setWarnings(result.messages.map((m) => m.message));
      } catch (err) {
        setError(err instanceof Error ? err.message : t("viewer.word.errorDescription"));
      } finally {
        setIsLoading(false);
      }
    }

    convertDocument();
  }, [content, t]);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [searchOpen]);

  useEffect(() => {
    if (activeSearchMatch >= searchMatches.length) {
      setActiveSearchMatch(0);
    }
  }, [activeSearchMatch, searchMatches.length]);

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
    if (!searchOpen || searchMatches.length === 0) {
      return;
    }

    const activeMark = containerRef.current?.querySelector<HTMLElement>(
      `[data-word-search-match-index="${activeSearchMatch}"]`,
    );
    activeMark?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeSearchMatch, searchMatches.length, searchOpen]);

  const goToMatch = useCallback((direction: 1 | -1) => {
    if (searchMatches.length === 0) {
      return;
    }
    setActiveSearchMatch((current) => (current + direction + searchMatches.length) % searchMatches.length);
  }, [searchMatches.length]);

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
          priority: 8,
          group: "secondary",
          onTrigger: () => setSearchOpen(true),
        },
        {
          id: "import-as-note",
          label: isImporting ? t("viewer.word.command.importing") : t("viewer.word.command.import"),
          priority: 10,
          group: "primary",
          disabled: isImporting || !htmlContent,
          onTrigger: () => { void handleImportAsNote(); },
        },
      ],
    };
  }, [
    fileName,
    filePath,
    handleImportAsNote,
    htmlContent,
    isImporting,
    setSearchOpen,
    t,
  ]);

  usePaneCommandBar({
    paneId,
    state: paneId ? commandBarState : null,
  });

  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">{t("viewer.word.loading")}</p>
      </div>
    );
  }

  if (error) {
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
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          <p>{t("viewer.word.readOnly")}</p>
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
                ? searchMatches.length > 0
                  ? `${activeSearchMatch + 1}/${searchMatches.length}`
                  : t("viewer.word.search.noMatch")
                : t("viewer.word.search.noMatch")}
            </span>
            <button
              type="button"
              onClick={() => goToMatch(-1)}
              disabled={searchMatches.length === 0}
              className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
              title={t("viewer.word.search.prevMatch")}
            >
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={() => goToMatch(1)}
              disabled={searchMatches.length === 0}
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

      {warnings.length > 0 && (
        <div className="mx-auto max-w-4xl px-8 pt-4">
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3">
            <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-500">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">{t("viewer.word.warnings")}</span>
            </div>
            <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
              {warnings.slice(0, 5).map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
              {warnings.length > 5 && (
                <li>{t("viewer.word.warnings.more", { count: warnings.length - 5 })}</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* Document content */}
      <div className="mx-auto max-w-4xl p-8">
        <article
          className="prose prose-slate dark:prose-invert max-w-none prose-headings:font-serif prose-p:font-sans prose-p:leading-relaxed prose-table:border-collapse prose-td:border prose-td:border-border prose-td:p-2 prose-th:border prose-th:border-border prose-th:bg-muted prose-th:p-2"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderedHtml || "") }}
        />
      </div>
    </div>
  );
}
