"use client";

import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { CommandBarAction, CommandBarState, PaneId } from "@/types/layout";
import { useI18n } from "@/hooks/use-i18n";
import { useSelectionContextMenu, type SelectionContextMenuState } from "@/hooks/use-selection-context-menu";
import { usePaneCommandBar } from "@/hooks/use-pane-command-bar";
import { createSelectionContext, type SelectionAiMode, type SelectionContext } from "@/lib/ai/selection-context";
import { SelectionContextMenu } from "@/components/ai/selection-context-menu";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";
import { buildBlockSelectionContext } from "@/lib/ai/selection-dom";
import { isMeaningfulSelectionText } from "@/lib/ai/selection-ui";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { buildPersistedFileViewStateKey } from "@/lib/file-view-state";
import { usePersistedViewState } from "@/hooks/use-persisted-view-state";
import { buildHtmlPreviewDocument } from "@/lib/html-preview";
import { getDesktopPreviewPath, resolveDesktopPreviewUrl } from "@/lib/desktop-preview";
import { navigateLink } from "@/lib/link-router/navigate-link";
import { findClosestAnchorHref, shouldOpenLinkExternally } from "@/lib/link-router/link-click";
import { CodeEditorViewer } from "@/components/renderers/code-editor-viewer";

interface HTMLViewerProps {
  content: string;
  fileName: string;
  paneId: PaneId;
  filePath: string;
  fileHandle?: FileSystemFileHandle;
  rootHandle?: FileSystemDirectoryHandle | null;
  onContentChange?: (content: string) => void;
  onSave?: () => Promise<void>;
  tabId?: string;
  executionScopeId?: string;
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

export function HTMLViewer({
  content,
  fileName,
  paneId,
  filePath,
  fileHandle,
  rootHandle,
  onContentChange,
  onSave,
  tabId,
  executionScopeId,
}: HTMLViewerProps) {
  const { t } = useI18n();
  const [showSource, setShowSource] = useState(false);
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const [iframeMenuState, setIframeMenuState] = useState<SelectionContextMenuState<SelectionContext> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const workspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const persistedViewStateKey = buildPersistedFileViewStateKey({
    kind: "html",
    workspaceKey,
    workspaceRootPath,
    filePath,
    fallbackName: fileName,
  });
  const previewBaseUrl = useMemo(() => {
    const desktopPreviewPath = getDesktopPreviewPath(fileHandle);
    return desktopPreviewPath ? resolveDesktopPreviewUrl(desktopPreviewPath) : null;
  }, [fileHandle]);
  const previewDocument = useMemo(
    () => buildHtmlPreviewDocument({
      html: content,
      baseHref: previewBaseUrl,
    }),
    [content, previewBaseUrl],
  );
  const canEditSource = Boolean(onContentChange && onSave && tabId && executionScopeId);

  const { menuState: selectionMenuState, closeMenu: closeSelectionMenu } = useSelectionContextMenu(
    containerRef,
    ({ text }) => {
      if (showSource) {
        return null;
      }
      return createSelectionContext({
        sourceKind: "html",
        paneId,
        fileName,
        filePath,
        selectedText: text,
        documentText: content,
      });
    },
  );

  const commandActions = useMemo<CommandBarAction[]>(() => ([
    {
      id: "preview",
      label: t("viewer.html.preview"),
      priority: 10,
      group: "primary",
      disabled: !showSource,
      onTrigger: () => setShowSource(false),
    },
    {
      id: "source",
      label: t("viewer.html.source"),
      priority: 11,
      group: "primary",
      disabled: showSource,
      onTrigger: () => setShowSource(true),
    },
  ]), [showSource, t]);

  const previewCommandBarState = useMemo<CommandBarState>(() => ({
    breadcrumbs: filePath.split("/").filter(Boolean).map((segment) => ({ label: segment })),
    actions: commandActions,
  }), [commandActions, filePath]);

  usePaneCommandBar({
    paneId,
    state: !showSource || !canEditSource ? previewCommandBarState : null,
  });

  usePersistedViewState({
    storageKey: persistedViewStateKey,
    containerRef,
    viewState: { showSource },
    applyViewState: (persisted) => {
      if (typeof persisted?.showSource === "boolean") {
        setShowSource(persisted.showSource);
      }
    },
  });

  const handleCloseMenu = useCallback((options?: { restoreFocus?: boolean }) => {
    closeSelectionMenu(options);
    setIframeMenuState((current) => {
      if (options?.restoreFocus !== false) {
        current?.returnFocusTo?.focus?.();
      }
      return null;
    });
  }, [closeSelectionMenu]);

  useEffect(() => {
    if (showSource || iframeMenuState) {
      return;
    }

    const iframe = iframeRef.current;
    if (!iframe) {
      return;
    }

    let cleanup: (() => void) | undefined;
    const attachFrameInteractions = () => {
      const doc = iframe.contentDocument;
      if (!doc) {
        return;
      }

      const openMenu = (mode: "pointer" | "keyboard", event?: MouseEvent | KeyboardEvent) => {
        const selection = iframe.contentWindow?.getSelection();
        const text = selection?.toString().trim() ?? "";
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : undefined;
        const fallbackRect = iframe.getBoundingClientRect();

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
          position: buildPositionFromRect(range?.getBoundingClientRect(), fallbackRect),
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

      const handleAnchorNavigation = (event: MouseEvent) => {
        const href = findClosestAnchorHref(event.target);
        if (!href) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        void navigateLink(href, {
          paneId,
          rootHandle,
          currentFilePath: filePath,
          externalUrlMode: shouldOpenLinkExternally(event) ? "external" : "internal",
        });
      };

      doc.addEventListener("contextmenu", handleContextMenu);
      doc.addEventListener("keydown", handleKeyDown);
      doc.addEventListener("click", handleAnchorNavigation, true);
      doc.addEventListener("auxclick", handleAnchorNavigation, true);

      cleanup = () => {
        doc.removeEventListener("contextmenu", handleContextMenu);
        doc.removeEventListener("keydown", handleKeyDown);
        doc.removeEventListener("click", handleAnchorNavigation, true);
        doc.removeEventListener("auxclick", handleAnchorNavigation, true);
      };
    };

    const handleLoad = () => {
      cleanup?.();
      attachFrameInteractions();
    };

    attachFrameInteractions();
    iframe.addEventListener("load", handleLoad);
    return () => {
      cleanup?.();
      iframe.removeEventListener("load", handleLoad);
    };
  }, [content, fileName, filePath, iframeMenuState, paneId, rootHandle, showSource]);

  const sourceViewer = canEditSource && tabId && executionScopeId
    ? (
      <CodeEditorViewer
        content={content}
        fileName={fileName}
        onContentChange={onContentChange}
        onSave={onSave}
        paneId={paneId}
        tabId={tabId}
        filePath={filePath}
        executionScopeId={executionScopeId}
        extraCommandActions={commandActions}
      />
    )
    : (
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
    );

  return (
    <div ref={containerRef} className="flex h-full flex-col">
      {!showSource ? (
        <>
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
        </>
      ) : null}

      <div className="flex-1 overflow-auto">
        {showSource ? sourceViewer : (
          <iframe
            ref={iframeRef}
            srcDoc={previewDocument}
            className="h-full w-full border-0 bg-white"
            sandbox="allow-same-origin"
            title={fileName}
          />
        )}
      </div>
    </div>
  );
}
