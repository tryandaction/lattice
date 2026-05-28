"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import type { CommandBarState, PaneId } from "@/types/layout";
import { usePaneCommandBar } from "@/hooks/use-pane-command-bar";
import { buildHtmlPreviewDocument, extractHtmlDocumentTitle } from "@/lib/html-preview";
import { openExternalUrl } from "@/lib/link-router/open-external";
import { findClosestAnchorHref, shouldOpenLinkExternally } from "@/lib/link-router/link-click";
import { canOpenUrlInternally, deriveWebDocumentName, loadWebDocument } from "@/lib/web-document";
import { navigateLink } from "@/lib/link-router/navigate-link";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { isTauriHost } from "@/lib/storage-adapter";
import { DesktopNativeWebviewPane } from "@/components/renderers/desktop-native-webview-pane";

interface WebViewerProps {
  url: string;
  fileName: string;
  paneId: PaneId;
  tabId: string;
  isActive?: boolean;
}

interface LoadedWebDocument {
  finalUrl: string;
  contentType?: string | null;
  body: string;
  title: string | null;
}

export function WebViewer(props: WebViewerProps) {
  if (isTauriHost()) {
    return (
      <DesktopNativeWebviewPane
        paneId={props.paneId}
        tabId={props.tabId}
        fileName={props.fileName}
        url={props.url}
        isActive={props.isActive ?? true}
      />
    );
  }

  return <WebViewerInner key={`${props.tabId}:${props.url}`} {...props} />;
}

function WebViewerInner({ url, fileName, paneId, tabId }: WebViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const updateWebTab = useWorkspaceStore((state) => state.updateWebTab);
  const reloadWebTab = useWorkspaceStore((state) => state.reloadWebTab);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [documentState, setDocumentState] = useState<LoadedWebDocument | null>(null);

  useEffect(() => {
    let cancelled = false;

    void loadWebDocument(url)
      .then((snapshot) => {
        if (cancelled) {
          return;
        }
        const title = extractHtmlDocumentTitle(snapshot.body);
        const nextState: LoadedWebDocument = {
          finalUrl: snapshot.finalUrl,
          contentType: snapshot.contentType,
          body: snapshot.body,
          title,
        };
        setDocumentState(nextState);
        setError(null);
        updateWebTab(paneId, tabId, {
          url: snapshot.finalUrl,
          fileName: deriveWebDocumentName(snapshot.finalUrl, title ?? fileName),
          pageTitle: title,
        });
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Failed to load webpage.");
        setDocumentState(null);
      });

    return () => {
      cancelled = true;
    };
  }, [fileName, paneId, reloadToken, tabId, updateWebTab, url]);

  const previewDocument = useMemo(() => (
    documentState
      ? buildHtmlPreviewDocument({
          html: documentState.body,
          baseHref: documentState.finalUrl,
          contentType: documentState.contentType,
        })
      : ""
  ), [documentState]);

  const activeUrl = documentState?.finalUrl ?? url;
  const commandBarState = useMemo<CommandBarState>(() => {
    let breadcrumbs = [fileName];
    try {
      const parsed = new URL(activeUrl);
      breadcrumbs = [parsed.hostname || parsed.protocol.replace(":", ""), ...parsed.pathname.split("/").filter(Boolean)];
    } catch {
      breadcrumbs = [fileName];
    }

    return {
      breadcrumbs: breadcrumbs.map((segment) => ({ label: segment })),
      actions: [
        {
          id: "reload",
          label: "刷新",
          priority: 10,
          group: "primary",
          onTrigger: () => {
            reloadWebTab(paneId, tabId);
            setReloadToken((current) => current + 1);
          },
        },
        {
          id: "open-external",
          label: "浏览器打开",
          priority: 20,
          group: "secondary",
          disabled: !documentState?.finalUrl,
          onTrigger: () => {
            if (documentState?.finalUrl) {
              void openExternalUrl(documentState.finalUrl);
            }
          },
        },
      ],
    };
  }, [activeUrl, documentState?.finalUrl, fileName, paneId, reloadWebTab, tabId]);

  usePaneCommandBar({
    paneId,
    state: commandBarState,
  });

  useEffect(() => {
    const iframe = iframeRef.current;
    const finalUrl = documentState?.finalUrl;
    if (!iframe || !finalUrl) {
      return;
    }

    let cleanup: (() => void) | undefined;
    const attachNavigation = () => {
      const doc = iframe.contentDocument;
      if (!doc) {
        return;
      }

      const handleAnchorClick = (event: MouseEvent) => {
        const rawHref = findClosestAnchorHref(event.target);
        if (!rawHref || rawHref.startsWith("#")) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        let resolvedHref = rawHref;
        try {
          resolvedHref = new URL(rawHref, finalUrl).toString();
        } catch {
          resolvedHref = rawHref;
        }

        if (!shouldOpenLinkExternally(event) && canOpenUrlInternally(resolvedHref)) {
          updateWebTab(paneId, tabId, {
            url: resolvedHref,
            fileName: deriveWebDocumentName(resolvedHref),
            pageTitle: null,
          });
          return;
        }

        void navigateLink(resolvedHref, {
          paneId,
          currentFilePath: finalUrl,
          externalUrlMode: "external",
        });
      };

      doc.addEventListener("click", handleAnchorClick, true);
      doc.addEventListener("auxclick", handleAnchorClick, true);
      cleanup = () => {
        doc.removeEventListener("click", handleAnchorClick, true);
        doc.removeEventListener("auxclick", handleAnchorClick, true);
      };
    };

    const handleLoad = () => {
      cleanup?.();
      attachNavigation();
    };

    attachNavigation();
    iframe.addEventListener("load", handleLoad);
    return () => {
      cleanup?.();
      iframe.removeEventListener("load", handleLoad);
    };
  }, [documentState?.finalUrl, paneId, tabId, updateWebTab]);

  if (!documentState && !error) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>正在加载网页...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">网页加载失败</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-background">
      <iframe
        ref={iframeRef}
        srcDoc={previewDocument}
        className="h-full w-full border-0 bg-white"
        sandbox="allow-same-origin"
        title={documentState?.title ?? fileName}
      />
    </div>
  );
}

export default WebViewer;
