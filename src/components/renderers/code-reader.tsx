"use client";

import { useEffect, useRef, useState } from "react";
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
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import { isSameWorkspacePath } from "@/lib/link-router/path-utils";
import { resolveCodeReference } from "@/lib/reference-navigation";
import { findReferenceTextRange } from "@/lib/reference-text-range";
import { flashReferenceRange, flashReferenceTarget } from "@/lib/reference-target-flash";

function renderedQuoteRange(root: HTMLElement, quote: string): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Array<{ node: Text; from: number; to: number }> = [];
  let text = "";
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest(".react-syntax-highlighter-line-number")) continue;
    const from = text.length;
    text += node.data;
    nodes.push({ node, from, to: text.length });
  }
  const match = findReferenceTextRange(text, quote);
  if (!match) return null;
  const first = nodes.find((entry) => entry.to > match.from);
  const last = nodes.find((entry) => entry.to >= match.to);
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, match.from - first.from);
  range.setEnd(last.node, match.to - last.from);
  return range;
}

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
  const referenceFlashCleanupRef = useRef<(() => void) | null>(null);
  const pendingNavigation = useLinkNavigationStore((state) => paneId ? state.pendingByPane[paneId] : undefined);
  const completePendingNavigation = useLinkNavigationStore((state) => state.completePendingNavigation);
  useEffect(() => () => referenceFlashCleanupRef.current?.(), []);
  useEffect(() => {
    if (!paneId || !pendingNavigation || !isSameWorkspacePath(pendingNavigation.filePath, filePath ?? fileName)) return;
    referenceFlashCleanupRef.current?.();
    referenceFlashCleanupRef.current = null;
    const resolution = resolveCodeReference(pendingNavigation.target, content.split(/\r?\n/).length, content);
    if (!resolution) return;
    const line = resolution.status === "success" && resolution.line
      ? containerRef.current?.querySelector<HTMLElement>(`[data-code-line="${resolution.line}"]`) : null;
    if (resolution.status !== "success" || !line) {
      completePendingNavigation(paneId, pendingNavigation.requestId, { status: "quote_not_found" });
      return;
    }
    const code = containerRef.current?.querySelector<HTMLElement>("pre > code");
    const range = pendingNavigation.target.type === "workspace_text" && code
      ? renderedQuoteRange(code, pendingNavigation.target.snippet) : null;
    if (resolution.range && !range) {
      completePendingNavigation(paneId, pendingNavigation.requestId, { status: "quote_not_found" });
      return;
    }
    line.scrollIntoView({ block: "center" });
    referenceFlashCleanupRef.current = range ? flashReferenceRange(range) : flashReferenceTarget(line);
    completePendingNavigation(paneId, pendingNavigation.requestId, { status: referenceFlashCleanupRef.current ? "success" : "quote_not_found" });
  }, [completePendingNavigation, content, fileName, filePath, paneId, pendingNavigation]);
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
          showInlineLineNumbers={false}
          wrapLines
          lineProps={(lineNumber) => ({ className: "code-source-line", "data-code-line": lineNumber })}
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
