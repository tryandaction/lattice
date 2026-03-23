"use client";

import { useRef, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { getLanguageForExtension, getFileExtension } from "@/lib/file-utils";
import type { PaneId } from "@/types/layout";
import { useSelectionContextMenu } from "@/hooks/use-selection-context-menu";
import { createSelectionContext, type SelectionAiMode, type SelectionContext } from "@/lib/ai/selection-context";
import { SelectionContextMenu } from "@/components/ai/selection-context-menu";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";
import { HorizontalScrollStrip } from "@/components/ui/horizontal-scroll-strip";

interface CodeReaderProps {
  content: string;
  fileName: string;
  paneId?: PaneId;
  filePath?: string;
}

/**
 * Code Reader component
 * Displays source code with syntax highlighting and line numbers
 */
export function CodeReader({ content, fileName, paneId, filePath }: CodeReaderProps) {
  const extension = getFileExtension(fileName);
  const language = getLanguageForExtension(extension);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const { menuState: selectionMenuState, closeMenu: closeSelectionMenu } = useSelectionContextMenu(
    containerRef,
    ({ text }) => {
      if (!paneId) return null;
      return createSelectionContext({
        sourceKind: "code",
        paneId,
        fileName,
        filePath,
        selectedText: text,
        documentText: content,
      });
    }
  );

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
      {/* File header */}
      <HorizontalScrollStrip
        className="sticky top-0 z-10 border-b border-border bg-muted/90 backdrop-blur"
        viewportClassName="px-4 py-2"
        contentClassName="min-w-full w-max justify-between gap-3"
        ariaLabel={`${fileName} 只读代码栏`}
      >
        <div className="flex shrink-0 items-center gap-2">
          <span className="max-w-[24rem] truncate text-sm font-medium text-foreground">{fileName}</span>
          <span className="text-xs text-muted-foreground">({language})</span>
        </div>
      </HorizontalScrollStrip>

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
