"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import mammoth from "mammoth";
import DOMPurify from "dompurify";
import { Loader2, AlertTriangle } from "lucide-react";
import { useFileSystem } from "@/hooks/use-file-system";
import { useI18n } from "@/hooks/use-i18n";
import { usePersistedViewState } from "@/hooks/use-persisted-view-state";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { emitVaultChange } from "@/lib/plugins/runtime";
import { buildPersistedFileViewStateKey } from "@/lib/file-view-state";
import type { PaneId } from "@/types/layout";
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

/**
 * Word Document Viewer component
 * Renders Word documents (.doc, .docx) using mammoth.js
 * Includes "Import as Note" functionality
 */
export function WordViewer({ content, fileName, paneId, filePath }: WordViewerProps) {
  const { t } = useI18n();
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
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

  const { createFile } = useFileSystem();
  const openFileInActivePane = useWorkspaceStore((state) => state.openFileInActivePane);
  const setCommandBarState = useWorkspaceStore((state) => state.setCommandBarState);
  const clearCommandBarState = useWorkspaceStore((state) => state.clearCommandBarState);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const markdownSnapshot = useMemo(() => htmlToMarkdown(htmlContent || ""), [htmlContent]);
  const persistedViewStateKey = buildPersistedFileViewStateKey({
    kind: "word",
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

  useEffect(() => {
    if (!paneId) {
      return;
    }

    const breadcrumbs = (filePath ?? fileName).split("/").filter(Boolean).map((segment) => ({ label: segment }));
    setCommandBarState(paneId, {
      breadcrumbs,
      actions: [
        {
          id: "import-as-note",
          label: isImporting ? t("viewer.word.command.importing") : t("viewer.word.command.import"),
          priority: 10,
          group: "primary",
          disabled: isImporting || !htmlContent,
          onTrigger: () => { void handleImportAsNote(); },
        },
      ],
    });

    return () => clearCommandBarState(paneId);
  }, [
    clearCommandBarState,
    fileName,
    filePath,
    handleImportAsNote,
    htmlContent,
    isImporting,
    paneId,
    setCommandBarState,
    t,
  ]);

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
    <div ref={containerRef} className="h-full overflow-auto">
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

      {/* Warnings */}
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
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(htmlContent || "") }}
        />
      </div>
    </div>
  );
}
