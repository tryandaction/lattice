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
import { useWorkspaceStore } from "@/stores/workspace-store";
import { buildPersistedFileViewStateKey } from "@/lib/file-view-state";
import { usePersistedViewState } from "@/hooks/use-persisted-view-state";

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
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const workspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const persistedViewStateKey = buildPersistedFileViewStateKey({
    kind: "code-reader",
    workspaceKey,
    workspaceRootPath,
    filePath,
    fallbackName: fileName,
  });
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

  usePersistedViewState({
    storageKey: persistedViewStateKey,
    containerRef,
  });

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
      {/* Code content */}
      <div className="p-4 pt-5">
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
