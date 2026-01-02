"use client";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { getLanguageForExtension, getFileExtension } from "@/lib/file-utils";

interface CodeReaderProps {
  content: string;
  fileName: string;
}

/**
 * Code Reader component
 * Displays source code with syntax highlighting and line numbers
 */
export function CodeReader({ content, fileName }: CodeReaderProps) {
  const extension = getFileExtension(fileName);
  const language = getLanguageForExtension(extension);

  return (
    <div className="h-full overflow-auto">
      {/* File header */}
      <div className="sticky top-0 z-10 border-b border-border bg-muted/90 px-4 py-2 backdrop-blur">
        <span className="text-sm font-medium text-foreground">{fileName}</span>
        <span className="ml-2 text-xs text-muted-foreground">({language})</span>
      </div>

      {/* Code content */}
      <div className="p-4">
        <SyntaxHighlighter
          language={language}
          style={oneDark}
          showLineNumbers
          wrapLines
          customStyle={{
            margin: 0,
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            lineHeight: "1.5",
          }}
          lineNumberStyle={{
            minWidth: "3em",
            paddingRight: "1em",
            color: "#6b7280",
            userSelect: "none",
          }}
        >
          {content}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
