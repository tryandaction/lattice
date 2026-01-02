"use client";

import { useState, useMemo } from "react";
import DOMPurify from "dompurify";
import { Code, Eye } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface HTMLViewerProps {
  content: string;
  fileName: string;
}

/**
 * HTML Viewer component
 * Renders HTML content in a sandboxed iframe with source view toggle
 */
export function HTMLViewer({ content, fileName }: HTMLViewerProps) {
  const [showSource, setShowSource] = useState(false);

  // Sanitize HTML to prevent XSS
  const sanitizedHtml = useMemo(() => {
    return DOMPurify.sanitize(content, {
      FORBID_TAGS: ["script", "style"],
      FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
    });
  }, [content]);

  // Create blob URL for iframe
  const blobUrl = useMemo(() => {
    const blob = new Blob([sanitizedHtml], { type: "text/html" });
    return URL.createObjectURL(blob);
  }, [sanitizedHtml]);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
        <span className="text-sm text-muted-foreground truncate max-w-xs">
          {fileName}
        </span>

        {/* View toggle */}
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          <button
            onClick={() => setShowSource(false)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-sm transition-colors ${
              !showSource
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted"
            }`}
            title="Preview"
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
          <button
            onClick={() => setShowSource(true)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-sm transition-colors ${
              showSource
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted"
            }`}
            title="Source"
          >
            <Code className="h-3 w-3" />
            Source
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {showSource ? (
          <div className="p-4">
            <SyntaxHighlighter
              language="html"
              style={oneDark}
              showLineNumbers
              customStyle={{
                margin: 0,
                borderRadius: "0.5rem",
                fontSize: "0.875rem",
              }}
            >
              {content}
            </SyntaxHighlighter>
          </div>
        ) : (
          <iframe
            src={blobUrl}
            className="h-full w-full border-0 bg-white"
            sandbox="allow-same-origin"
            title={fileName}
          />
        )}
      </div>
    </div>
  );
}
