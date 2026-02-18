"use client";

import { useState, useEffect, useCallback } from "react";
import mammoth from "mammoth";
import DOMPurify from "dompurify";
import { Loader2, AlertTriangle, FileText } from "lucide-react";
import { useFileSystem } from "@/hooks/use-file-system";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { emitVaultChange } from "@/lib/plugins/runtime";

interface WordViewerProps {
  content: ArrayBuffer;
  fileName: string;
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
export function WordViewer({ content, fileName }: WordViewerProps) {
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const { createFile } = useFileSystem();
  const openFileInActivePane = useWorkspaceStore((state) => state.openFileInActivePane);

  useEffect(() => {
    async function convertDocument() {
      setIsLoading(true);
      setError(null);

      try {
        const result = await mammoth.convertToHtml({ arrayBuffer: content });
        setHtmlContent(result.value);
        setWarnings(result.messages.map((m) => m.message));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to convert document");
      } finally {
        setIsLoading(false);
      }
    }

    convertDocument();
  }, [content]);

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

  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">Converting document...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <p className="text-destructive">Error: {error}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          The document could not be converted.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {/* File header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-muted/90 px-4 py-2 backdrop-blur">
        <span className="text-sm font-medium text-foreground">{fileName}</span>
        
        {/* Import as Note button */}
        <button
          onClick={handleImportAsNote}
          disabled={isImporting || !htmlContent}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isImporting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Importing...</span>
            </>
          ) : (
            <>
              <FileText className="h-4 w-4" />
              <span>Import as Note</span>
            </>
          )}
        </button>
      </div>

      {/* Read-only notice */}
      <div className="mx-auto max-w-4xl px-8 pt-4">
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          <p>
            This document is read-only. Click <strong>Import as Note</strong> to create an editable Markdown version.
          </p>
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="mx-auto max-w-4xl px-8 pt-4">
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3">
            <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-500">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">Conversion warnings</span>
            </div>
            <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
              {warnings.slice(0, 5).map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
              {warnings.length > 5 && (
                <li>...and {warnings.length - 5} more warnings</li>
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
