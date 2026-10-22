"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { isTauriHost } from "@/lib/storage-adapter";
import type { CommandBarState } from "@/types/layout";
import { usePaneCommandBar } from "@/hooks/use-pane-command-bar";
import { useI18n } from "@/hooks/use-i18n";
import { openExternalUrl } from "@/lib/link-router/open-external";
import { copyToClipboard } from "@/lib/clipboard";
import { WebAddressBar } from "./web-address-bar";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  ensureDesktopWebview,
  getDesktopWebviewLabelForTab,
  getDesktopWebviewState,
  goBackDesktopWebview,
  goForwardDesktopWebview,
  hideDesktopWebview,
  listenDesktopWebviewDownload,
  listenDesktopWebviewNewWindow,
  reloadDesktopWebview,
  showDesktopWebview,
  updateDesktopWebviewRect,
  type DesktopNativeWebviewSnapshot,
  type DesktopWebviewRect,
} from "@/lib/desktop-webview";

interface DesktopNativeWebviewPaneProps {
  paneId: string;
  tabId: string;
  fileName: string;
  url: string;
  isActive: boolean;
}

function rectEquals(left: DesktopWebviewRect | null, right: DesktopWebviewRect | null): boolean {
  if (!left || !right) {
    return false;
  }

  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function buildBreadcrumbs(fileName: string, url: string): Array<{ label: string }> {
  try {
    const parsed = new URL(url);
    return [
      { label: parsed.hostname || parsed.protocol.replace(":", "") },
      ...parsed.pathname.split("/").filter(Boolean).map((segment) => ({ label: segment })),
    ];
  } catch {
    return [{ label: fileName }];
  }
}

function buildDisplayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname}${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

const DESKTOP_WEBVIEW_SAFE_ZONE_SELECTOR = '[data-desktop-webview-safe-zone="true"]';

export function DesktopNativeWebviewPane({
  paneId,
  tabId,
  fileName,
  url,
  isActive,
}: DesktopNativeWebviewPaneProps) {
  const { t } = useI18n();
  const anchorRef = useRef<HTMLDivElement>(null);
  const requestVersionRef = useRef(0);
  const lastRequestedUrlRef = useRef<string | null>(null);
  const observedUrlRef = useRef<string | null>(null);
  const mountingRef = useRef(false);
  const mountedRef = useRef(true);
  const updateWebTab = useWorkspaceStore((state) => state.updateWebTab);
  const openWebUrlInPane = useWorkspaceStore((state) => state.openWebUrlInPane);
  const [rect, setRect] = useState<DesktopWebviewRect | null>(null);
  const [snapshot, setSnapshot] = useState<DesktopNativeWebviewSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = useMemo(() => getDesktopWebviewLabelForTab(tabId), [tabId]);
  const activeUrl = url;
  const activeTitle = snapshot?.title ?? null;
  const status = snapshot?.status ?? "idle";
  const displayUrl = buildDisplayUrl(activeUrl);
  const retryMount = () => {
    lastRequestedUrlRef.current = null; observedUrlRef.current = null;
    setError(null); setSnapshot(null); setRect(current => current ? { ...current } : current);
  };

  const commandBarState = useMemo<CommandBarState>(() => ({
    breadcrumbs: buildBreadcrumbs(fileName, activeUrl),
    actions: [
      {
        id: "copy-url",
        label: t("viewer.web.command.copyUrl"),
        tooltip: t("viewer.web.command.copyUrlDetail", { url: activeUrl }),
        icon: "globe",
        priority: 14,
        group: "utility",
        disabled: status === "mounting",
        onTrigger: () => {
          void copyToClipboard(activeUrl).then((copied) => {
            if (copied) {
              toast.success(t("viewer.web.toast.urlCopied"), {
                description: displayUrl,
              });
              return;
            }

            toast.error(t("viewer.web.toast.copyUrlFailed"), {
              description: displayUrl,
            });
          });
        },
      },
    ],
  }), [activeUrl, displayUrl, fileName, status, t]);

  usePaneCommandBar({
    paneId,
    state: commandBarState,
  });

  useLayoutEffect(() => {
    if (!isTauriHost()) {
      return;
    }

    const element = anchorRef.current;
    if (!element) {
      return;
    }

    let frameId = 0;
    const measure = () => {
      frameId = 0;
      const bounds = element.getBoundingClientRect();
      const nextRect = {
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
      };
      setRect((current) => (rectEquals(current, nextRect) ? current : nextRect));
    };

    const scheduleMeasure = () => {
      if (frameId !== 0) {
        return;
      }
      frameId = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(element);
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

  useEffect(() => {
    if (!isTauriHost() || !rect || rect.width < 2 || rect.height < 2 || !isActive) {
      return;
    }
    // Bounds/title/polling updates are not navigation requests. A redirect echo
    // must not send the child back to the address preceding its own navigation.
    if (observedUrlRef.current === url || (mountingRef.current && lastRequestedUrlRef.current === url)) return;

    const requestVersion = ++requestVersionRef.current;
    lastRequestedUrlRef.current = url;
    mountingRef.current = true;

    void ensureDesktopWebview({
      label,
      windowLabel: "main",
      url,
      rect,
      visible: true,
      focus: true,
    })
      .then((nextSnapshot) => {
        if (requestVersionRef.current !== requestVersion) {
          if (!mountedRef.current) void hideDesktopWebview(label).catch(() => {});
          return;
        }
        if (!nextSnapshot) {
          return;
        }
        setSnapshot(nextSnapshot);
        observedUrlRef.current = nextSnapshot.currentUrl || url;
        if (nextSnapshot.status === "error") {
          setError(nextSnapshot.lastError || "Failed to create desktop webview.");
          return;
        }
        setError(null);
        updateWebTab(paneId, tabId, {
          url: nextSnapshot.currentUrl || url,
          ...(nextSnapshot.title?.trim() ? { fileName: nextSnapshot.title.trim() } : {}),
          pageTitle: nextSnapshot.title,
        });
      })
      .catch((nextError) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Failed to create desktop webview.");
        lastRequestedUrlRef.current = null;
      }).finally(() => {
        if (requestVersionRef.current === requestVersion) mountingRef.current = false;
      });
  }, [isActive, label, paneId, rect, tabId, updateWebTab, url]);

  useEffect(() => {
    if (!isTauriHost() || !rect || status !== "ready") {
      return;
    }

    void updateDesktopWebviewRect(label, rect).catch(() => {});
  }, [label, rect, status]);

  useEffect(() => {
    if (!isTauriHost() || status !== "ready") {
      return;
    }

    if (isActive) {
      void showDesktopWebview(label).catch(() => {});
      return;
    }

    void hideDesktopWebview(label).catch(() => {});
  }, [isActive, label, status]);

  useEffect(() => {
    if (!isTauriHost()) {
      return;
    }

    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestVersionRef.current += 1;
      void hideDesktopWebview(label).catch(() => {});
    };
  }, [label]);

  useEffect(() => {
    if (!isTauriHost() || !isActive || status !== "ready") {
      return;
    }

    let occluded = false;
    const applyOcclusion = (nextOccluded: boolean) => {
      if (occluded === nextOccluded) {
        return;
      }
      occluded = nextOccluded;
      if (nextOccluded) {
        void hideDesktopWebview(label).catch(() => {});
      } else {
        void showDesktopWebview(label).catch(() => {});
      }
    };

    const handleSafeZoneCheck = (target: EventTarget | null) => {
      const element = target instanceof Element ? target : null;
      const insideSafeZone = Boolean(element?.closest(DESKTOP_WEBVIEW_SAFE_ZONE_SELECTOR));
      applyOcclusion(insideSafeZone);
    };

    const handlePointerMove = (event: PointerEvent) => {
      handleSafeZoneCheck(event.target);
    };

    const handleFocusIn = (event: FocusEvent) => {
      handleSafeZoneCheck(event.target);
    };

    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("pointerdown", handlePointerMove, true);
    document.addEventListener("focusin", handleFocusIn, true);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove, true);
      document.removeEventListener("pointerdown", handlePointerMove, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      if (occluded && isActive) {
        void showDesktopWebview(label).catch(() => {});
      }
    };
  }, [isActive, label, status]);

  useEffect(() => {
    if (!isTauriHost()) {
      return;
    }

    let disposed = false;
    let disposeNewWindow: (() => void) | null = null;
    let disposeDownload: (() => void) | null = null;

    void listenDesktopWebviewNewWindow((event) => {
      if (event.label !== label || !event.url) {
        return;
      }
      openWebUrlInPane(paneId, event.url);
    }).then((unlisten) => {
      if (disposed) unlisten(); else disposeNewWindow = unlisten;
    });

    void listenDesktopWebviewDownload((event) => {
      if (event.label !== label) {
        return;
      }
      if (event.phase === "requested") {
        toast.message(t("viewer.web.toast.downloadStarted"), {
          description: event.url,
        });
        return;
      }

      toast[event.success ? "success" : "error"](
        event.success ? t("viewer.web.toast.downloadCompleted") : t("viewer.web.toast.downloadFailed"),
        {
          description: event.path || event.url,
        },
      );
    }).then((unlisten) => {
      if (disposed) unlisten(); else disposeDownload = unlisten;
    });

    return () => {
      disposed = true;
      disposeNewWindow?.();
      disposeDownload?.();
    };
  }, [label, openWebUrlInPane, paneId, t]);

  useEffect(() => {
    if (!isTauriHost() || !isActive) {
      return;
    }

    let cancelled = false;
    let syncing = false;
    const syncState = async () => {
      if (syncing || mountingRef.current || !lastRequestedUrlRef.current) return;
      syncing = true;
      const requestVersion = requestVersionRef.current;
      try {
        const nextSnapshot = await getDesktopWebviewState(label);
        if (cancelled || requestVersionRef.current !== requestVersion || !nextSnapshot) {
          return;
        }
        setSnapshot((current) => {
          if (
            current?.currentUrl === nextSnapshot.currentUrl &&
            current?.title === nextSnapshot.title &&
            current?.status === nextSnapshot.status &&
            current?.lastError === nextSnapshot.lastError
          ) {
            return current;
          }
          return nextSnapshot;
        });
        if (nextSnapshot.status === "error") {
          setError(nextSnapshot.lastError || "Failed to create desktop webview.");
          return;
        }
        if (nextSnapshot.status === "ready") {
          setError(null);
          observedUrlRef.current = nextSnapshot.currentUrl || url;
          updateWebTab(paneId, tabId, {
            url: nextSnapshot.currentUrl || url,
            ...(nextSnapshot.title?.trim() ? { fileName: nextSnapshot.title.trim() } : {}),
            pageTitle: nextSnapshot.title,
          });
        }
      } catch {
        // Ignore transient polling failures while navigating.
      } finally { syncing = false; }
    };

    void syncState();
    const intervalId = window.setInterval(() => {
      void syncState();
    }, 300);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isActive, label, paneId, tabId, updateWebTab, url]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <WebAddressBar url={url} onNavigate={nextUrl => updateWebTab(paneId, tabId, { url: nextUrl, pageTitle: null })} onBack={() => { void goBackDesktopWebview(label).catch(() => {}); }} onForward={() => { void goForwardDesktopWebview(label).catch(() => {}); }} onReload={() => { void reloadDesktopWebview(label).catch(retryMount); }} onExternal={() => void openExternalUrl(url)} canGoBack={status === "ready"} canGoForward={status === "ready"} />
      <div ref={anchorRef} className="relative min-h-0 w-full flex-1 overflow-hidden bg-background">
      {status !== "ready" && !error ? (
        <div className="flex h-full items-center justify-center bg-background">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{status === "mounting" ? t("viewer.web.loading.mounting") : t("viewer.web.loading.preparing")}</span>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{t("viewer.web.error.startFailed")}</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      ) : null}
      {status === "ready" && activeTitle ? (
        <div className="sr-only" aria-hidden="true">{activeTitle}</div>
      ) : null}
      </div>
    </div>
  );
}

export default DesktopNativeWebviewPane;
