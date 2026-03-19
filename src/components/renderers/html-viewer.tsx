"use client";

import { startTransition, useState, useMemo, useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import { Code, Eye } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { PaneId } from "@/types/layout";
import { useSelectionContextMenu, type SelectionContextMenuState } from "@/hooks/use-selection-context-menu";
import { createSelectionContext, type SelectionAiMode, type SelectionContext } from "@/lib/ai/selection-context";
import { SelectionContextMenu } from "@/components/ai/selection-context-menu";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";
import { buildBlockSelectionContext } from "@/lib/ai/selection-dom";
import { isMeaningfulSelectionText } from "@/lib/ai/selection-ui";
import { useObjectUrl } from "@/hooks/use-object-url";

interface HTMLViewerProps {
  content: string;
  fileName: string;
  paneId?: PaneId;
  filePath?: string;
}

function buildPositionFromRect(rect: DOMRect | undefined, fallback: DOMRect): { x: number; y: number } {
  if (rect) {
    return {
      x: rect.left + Math.max(12, Math.min(rect.width, 24)),
      y: rect.bottom + 8,
    };
  }

  return {
    x: fallback.left + 16,
    y: fallback.top + 16,
  };
}

/**
 * HTML Viewer component
 * Renders HTML content in a sandboxed iframe with source view toggle.
 */
export function HTMLViewer({ content, fileName, paneId, filePath }: HTMLViewerProps) {
  const [showSource, setShowSource] = useState(false);
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const [iframeMenuState, setIframeMenuState] = useState<SelectionContextMenuState<SelectionContext> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const sanitizedHtml = useMemo(() => {
    return DOMPurify.sanitize(content, {
      FORBID_TAGS: ["script", "style"],
      FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
    });
  }, [content]);

  const previewBlob = useMemo(() => new Blob([sanitizedHtml], { type: "text/html" }), [sanitizedHtml]);
  const blobUrl = useObjectUrl(previewBlob);

  const { menuState: selectionMenuState, closeMenu: closeSelectionMenu } = useSelectionContextMenu(
    containerRef,
    ({ text }) => {
      if (!paneId || !showSource) return null;
      return createSelectionContext({
        sourceKind: "html",
        paneId,
        fileName,
        filePath,
        selectedText: text,
        documentText: content,
      });
    }
  );

  const handleCloseMenu = (options?: { restoreFocus?: boolean }) => {
    closeSelectionMenu(options);
    setIframeMenuState((current) => {
      if (options?.restoreFocus !== false) {
        current?.returnFocusTo?.focus?.();
      }
      return null;
    });
  };

  useEffect(() => {
    if (showSource) {
      startTransition(() => {
        setIframeMenuState(null);
      });
      return;
    }

    const iframe = iframeRef.current;
    if (!iframe) return;

    const attachSelectionRelay = () => {
      const doc = iframe.contentDocument;
      if (!doc) {
        return;
      }

      const openMenu = (mode: "pointer" | "keyboard", event?: MouseEvent | KeyboardEvent) => {
        const selection = iframe.contentWindow?.getSelection();
        const text = selection?.toString().trim() ?? "";
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : undefined;
        const fallbackRect = iframe.getBoundingClientRect();

        if (!paneId) {
          if (mode === "keyboard") {
            event?.preventDefault();
            setIframeMenuState({
              context: null,
              selectedText: text,
              position: buildPositionFromRect(range?.getBoundingClientRect(), fallbackRect),
              disabledReason: "当前 HTML 视图暂不支持 Selection AI。",
              returnFocusTo: iframe,
            });
          }
          return;
        }

        if (!text) {
          if (mode === "keyboard") {
            event?.preventDefault();
            setIframeMenuState({
              context: null,
              selectedText: "",
              position: buildPositionFromRect(range?.getBoundingClientRect(), fallbackRect),
              disabledReason: "先在 HTML 预览中选择一段文本，再打开 Selection AI。",
              returnFocusTo: iframe,
            });
          }
          return;
        }

        if (!isMeaningfulSelectionText(text)) {
          if (mode === "keyboard") {
            event?.preventDefault();
            setIframeMenuState({
              context: null,
              selectedText: text,
              position: buildPositionFromRect(range?.getBoundingClientRect(), fallbackRect),
              disabledReason: "Selection AI 仅在长度至少 3 且包含有效文本内容的选区上启用。",
              returnFocusTo: iframe,
            });
          }
          return;
        }

        const blockContext = buildBlockSelectionContext(selection?.anchorNode ?? event?.target ?? null);
        const context = createSelectionContext({
          sourceKind: "html",
          paneId,
          fileName,
          filePath,
          selectedText: text,
          documentText: content,
          contextText: blockContext.contextText,
          blockLabel: blockContext.blockLabel,
        });

        event?.preventDefault();
        event?.stopPropagation();
        setIframeMenuState({
          context,
          selectedText: text,
          position: buildPositionFromRect(
            range?.getBoundingClientRect(),
            fallbackRect,
          ),
          returnFocusTo: iframe,
        });
      };

      const handleContextMenu = (event: MouseEvent) => {
        openMenu("pointer", event);
      };

      const handleKeyDown = (event: KeyboardEvent) => {
        const isContextMenuKey = event.key === "ContextMenu";
        const isShiftF10 = event.shiftKey && event.key === "F10";
        if (!isContextMenuKey && !isShiftF10) {
          return;
        }

        openMenu("keyboard", event);
      };

      doc.addEventListener("contextmenu", handleContextMenu);
      doc.addEventListener("keydown", handleKeyDown);

      return () => {
        doc.removeEventListener("contextmenu", handleContextMenu);
        doc.removeEventListener("keydown", handleKeyDown);
      };
    };

    const cleanup = attachSelectionRelay();
    iframe.addEventListener("load", attachSelectionRelay);
    return () => {
      cleanup?.();
      iframe.removeEventListener("load", attachSelectionRelay);
    };
  }, [content, fileName, filePath, paneId, showSource]);

  return (
    <div ref={containerRef} className="flex h-full flex-col">
      <SelectionContextMenu
        state={iframeMenuState ?? selectionMenuState}
        onClose={handleCloseMenu}
        onOpenHub={(context, mode, returnFocusTo) => setSelectionHubState({ context, mode, returnFocusTo })}
      />
      <SelectionAiHub
        context={selectionHubState?.context ?? null}
        initialMode={selectionHubState?.mode ?? "chat"}
        returnFocusTo={selectionHubState?.returnFocusTo}
        onClose={() => setSelectionHubState(null)}
      />

      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
        <span className="max-w-xs truncate text-sm text-muted-foreground">
          {fileName}
        </span>

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
          blobUrl ? (
            <iframe
              ref={iframeRef}
              src={blobUrl}
              className="h-full w-full border-0 bg-white"
              sandbox="allow-same-origin"
              title={fileName}
            />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">HTML 预览加载中...</div>
          )
        )}
      </div>
    </div>
  );
}
