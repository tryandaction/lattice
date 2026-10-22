"use client";

import { useMemo, useEffect, useRef, useState, useCallback, useContext } from "react";
import { AssetSourceContext, type AsyncAssetResolver } from '@/lib/asset-source-context';
import { Loader2 } from "lucide-react";
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
import { resolveHtmlWorkspaceAssets } from "@/lib/html-workspace-assets";
import { shouldLetHtmlPreviewHandleAnchor } from "@/lib/html-navigation";
import { getDesktopPreviewPath, resolveDesktopPreviewUrl } from "@/lib/desktop-preview";
import { navigateLinkWithFeedback } from "@/lib/link-router/navigate-link-with-feedback";
import { findClosestAnchorHref, shouldOpenLinkExternally } from "@/lib/link-router/link-click";
import { CodeEditorViewer } from "@/components/renderers/code-editor-viewer";
import { cn } from "@/lib/utils";

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
  asyncAssetResolver?: AsyncAssetResolver;
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
  asyncAssetResolver,
}: HTMLViewerProps) {
  const assetSource = useContext(AssetSourceContext);
  const assetResolver = asyncAssetResolver ?? assetSource?.resolveAsset;
  const { t } = useI18n();
  const [showSource, setShowSource] = useState(false);
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const [iframeMenuState, setIframeMenuState] = useState<SelectionContextMenuState<SelectionContext> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameARef = useRef<HTMLIFrameElement>(null);
  const frameBRef = useRef<HTMLIFrameElement>(null);
  const [activeFrameIndex, setActiveFrameIndex] = useState<0 | 1>(0);
  const [activePreviewDocument, setActivePreviewDocument] = useState("");
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
  const [workspacePreview, setWorkspacePreview] = useState<{ content: string; filePath: string; root?: FileSystemDirectoryHandle | null; resolver?: AsyncAssetResolver; html: string } | null>(null);
  useEffect(() => {
    if (previewBaseUrl || !rootHandle && !assetResolver) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void resolveHtmlWorkspaceAssets(content, filePath, rootHandle, assetResolver).then((result) => {
      if (cancelled) { result.dispose(); return; }
      dispose = result.dispose;
      setWorkspacePreview({ content, filePath, root: rootHandle, resolver: assetResolver, html: result.html });
    }).catch(() => {});
    return () => { cancelled = true; dispose?.(); };
  }, [content, filePath, previewBaseUrl, rootHandle, assetResolver]);
  const resolvedHtml = workspacePreview?.content === content && workspacePreview.filePath === filePath && workspacePreview.root === rootHandle && workspacePreview.resolver === assetResolver
    ? workspacePreview.html : content;
  const previewDocument = useMemo(
    () => buildHtmlPreviewDocument({
      html: resolvedHtml,
      baseHref: previewBaseUrl,
    }),
    [resolvedHtml, previewBaseUrl],
  );
  const canEditSource = Boolean(onContentChange && onSave && tabId && executionScopeId);
  const activeIframeRef = activeFrameIndex === 0 ? frameARef : frameBRef;
  const pendingPreviewDocument = previewDocument && previewDocument !== activePreviewDocument
    ? previewDocument
    : "";
  const loadingFrameIndex: 0 | 1 | null = pendingPreviewDocument
    ? (activeFrameIndex === 0 ? 1 : 0)
    : null;
  const frameDocs: [string, string] = activeFrameIndex === 0
    ? [activePreviewDocument, pendingPreviewDocument]
    : [pendingPreviewDocument, activePreviewDocument];

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

  const handlePreviewFrameLoad = useCallback((frameIndex: 0 | 1) => {
    if (frameIndex !== loadingFrameIndex || !pendingPreviewDocument) {
      return;
    }
    setActivePreviewDocument(pendingPreviewDocument);
    setActiveFrameIndex(frameIndex);
  }, [loadingFrameIndex, pendingPreviewDocument]);

  useEffect(() => {
    if (showSource || iframeMenuState) {
      return;
    }

    const iframe = activeIframeRef.current;
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

        if (shouldLetHtmlPreviewHandleAnchor(href)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        void navigateLinkWithFeedback(href, {
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
  }, [activeFrameIndex, activeIframeRef, content, fileName, filePath, iframeMenuState, paneId, rootHandle, showSource]);

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

      <div className="relative flex-1 overflow-auto">
        {showSource ? sourceViewer : (
          <>
            <iframe
              ref={frameARef}
              srcDoc={frameDocs[0]}
              onLoad={() => handlePreviewFrameLoad(0)}
              className={cn(
                "absolute inset-0 h-full w-full border-0 bg-white",
                activeFrameIndex === 0 ? "opacity-100" : "pointer-events-none opacity-0",
              )}
              sandbox="allow-same-origin"
              title={fileName}
            />
            <iframe
              ref={frameBRef}
              srcDoc={frameDocs[1]}
              onLoad={() => handlePreviewFrameLoad(1)}
              className={cn(
                "absolute inset-0 h-full w-full border-0 bg-white",
                activeFrameIndex === 1 ? "opacity-100" : "pointer-events-none opacity-0",
              )}
              sandbox="allow-same-origin"
              title={fileName}
            />
            {loadingFrameIndex !== null ? (
              <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-2 rounded-md border border-border bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>{t("viewer.loading.preparing")}</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
