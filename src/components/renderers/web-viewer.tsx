"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
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
import { WebAddressBar } from "./web-address-bar";
import { useI18n } from "@/hooks/use-i18n";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface WebViewerProps { url: string; fileName: string; paneId: PaneId; tabId: string; isActive?: boolean }
interface Preview { url: string; html: string; title: string | null; direct: boolean; revision: number }
interface NavigationHistory { entries: string[]; index: number }
// Transient per-tab navigation survives tab switches; no page bodies or credentials are persisted.
const histories = new Map<string, NavigationHistory>();
function remember(tabId: string, value: NavigationHistory) {
  histories.delete(tabId); histories.set(tabId, value);
  if (histories.size > 100) histories.delete(histories.keys().next().value!);
  return value;
}

function PreviewFrame({ preview, iframeRef, visible, onLoad, onError, title }: { preview: Preview | null; iframeRef: RefObject<HTMLIFrameElement | null>; visible: boolean; onLoad: () => void; onError: () => void; title: string }) {
  if (!preview) return null;
  return <iframe key={preview.direct ? preview.revision : "preview"} ref={iframeRef} {...(preview.direct ? { src: preview.url } : { srcDoc: preview.html })} onLoad={onLoad} onError={onError} className={cn("absolute inset-0 h-full w-full border-0 bg-white", visible ? "opacity-100" : "pointer-events-none opacity-0")} sandbox={preview.direct ? "allow-scripts allow-forms allow-popups" : "allow-same-origin"} referrerPolicy="no-referrer" title={preview.title ?? title} />;
}

export function WebViewer(props: WebViewerProps) {
  if (isTauriHost()) return <DesktopNativeWebviewPane {...props} isActive={props.isActive ?? true} />;
  return <WebViewerInner key={props.tabId} {...props} />;
}

function WebViewerInner({ url, fileName, paneId, tabId }: WebViewerProps) {
  const { t: translate } = useI18n();
  const updateWebTab = useWorkspaceStore(state => state.updateWebTab);
  const [history, setHistory] = useState<NavigationHistory>(() => histories.get(tabId) ?? { entries: [url], index: 0 });
  const historyRef = useRef(history);
  const commitHistory = useCallback((next: NavigationHistory) => {
    historyRef.current = remember(tabId, next); setHistory(next);
  }, [tabId]);
  const recordNavigation = useCallback((nextUrl: string, replace = false) => {
    const current = historyRef.current;
    if (current.entries[current.index] === nextUrl) return;
    const entries = replace ? [...current.entries] : current.entries.slice(0, current.index + 1);
    if (replace) entries[current.index] = nextUrl; else entries.push(nextUrl);
    const bounded = entries.slice(-50);
    commitHistory({ entries: bounded, index: replace ? current.index : bounded.length - 1 });
  }, [commitHistory]);
  const navigate = useCallback((nextUrl: string) => {
    if (!canOpenUrlInternally(nextUrl)) return;
    recordNavigation(nextUrl);
    updateWebTab(paneId, tabId, { url: nextUrl, fileName: deriveWebDocumentName(nextUrl), pageTitle: null });
  }, [paneId, recordNavigation, tabId, updateWebTab]);
  const step = useCallback((delta: number) => {
    const current = historyRef.current, index = current.index + delta;
    if (index < 0 || index >= current.entries.length) return;
    commitHistory({ entries: current.entries, index });
    updateWebTab(paneId, tabId, { url: current.entries[index], fileName: deriveWebDocumentName(current.entries[index]), pageTitle: null });
  }, [commitHistory, paneId, tabId, updateWebTab]);

  const [reloadToken, setReloadToken] = useState(0);
  const [pending, setPending] = useState<Preview | null>(null);
  const [active, setActive] = useState<Preview | null>(null);
  const [activeIndex, setActiveIndex] = useState<0 | 1>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const frameA = useRef<HTMLIFrameElement>(null), frameB = useRef<HTMLIFrameElement>(null);
  const generation = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const displayedPreviewRef = useRef<Preview | null>(null);
  const resolvedRequest = useRef<{ url: string; reload: number } | null>(null);
  const stop = useCallback(() => {
    generation.current++; abortRef.current?.abort(); setPending(null); setLoading(false); setStopped(true);
  }, []);
  const reload = useCallback(() => { setReloadToken(value => value + 1); }, []);

  useEffect(() => {
    if (resolvedRequest.current?.url === url && resolvedRequest.current.reload === reloadToken) {
      // Returning while a newer request is pending reuses the displayed page.
      // A redirect echo before first paint must leave its pending frame intact.
      let cancelled = false;
      if (displayedPreviewRef.current?.url === url) queueMicrotask(() => {
        if (cancelled) return;
        setPending(null); setLoading(false); setError(null); setStopped(false);
      });
      return () => { cancelled = true; };
    }
    recordNavigation(url);
    const request = ++generation.current, controller = new AbortController();
    let cancelled = false;
    abortRef.current = controller;
    setLoading(true); setError(null); setStopped(false); setPending(null);
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      if (cancelled || request !== generation.current) return;
      timedOut = true; controller.abort(); generation.current++; setLoading(false); setPending(null); setError(t("viewer.web.error.requestTimeout"));
    }, 20000);
    void loadWebDocument(url, controller.signal).then(snapshot => {
      if (cancelled || request !== generation.current) return;
      const finalUrl = canOpenUrlInternally(snapshot.finalUrl) ? snapshot.finalUrl : url;
      const title = extractHtmlDocumentTitle(snapshot.body);
      const html = buildHtmlPreviewDocument({ html: snapshot.body, baseHref: finalUrl, contentType: snapshot.contentType });
      // The store echo of a redirect is metadata, not another navigation request.
      resolvedRequest.current = { url: finalUrl, reload: reloadToken };
      recordNavigation(finalUrl, true);
      setPending({ url: finalUrl, html, title, direct: false, revision: request });
      updateWebTab(paneId, tabId, { url: finalUrl, fileName: deriveWebDocumentName(finalUrl, title), pageTitle: title });
    }).catch(reason => {
      if (cancelled || request !== generation.current || timedOut || controller.signal.aborted) return;
      if (reason instanceof Error && /HTTP \d+/.test(reason.message)) {
        setLoading(false); setError(t("viewer.web.error.http", { status: reason.message.match(/HTTP (\d+)/)?.[1] ?? "?" })); return;
      }
      // CORS does not decide whether a site allows framing. Keep a clear limitation notice.
      setPending({ url, html: "", title: null, direct: true, revision: request });
    }).finally(() => window.clearTimeout(timeout));
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timeout); };
  }, [paneId, recordNavigation, reloadToken, tabId, updateWebTab, url]);

  // A frame load event is not guaranteed (CSP/network failure), so never wait forever.
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      setPending(null); setLoading(false); setError(t("viewer.web.error.frameTimeout"));
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [pending]);
  const pendingIndex = pending ? (activeIndex === 0 ? 1 : 0) : null;
  const promote = (index: 0 | 1) => {
    if (!pending || index !== pendingIndex) return;
    displayedPreviewRef.current = pending;
    setActive(pending); setActiveIndex(index); setPending(null); setLoading(false); setError(null);
  };
  const frameError = (index: 0 | 1) => {
    if (index === pendingIndex) { setPending(null); setLoading(false); setError(t("viewer.web.error.frameFailed")); }
  };

  useEffect(() => {
    const iframe = (activeIndex === 0 ? frameA : frameB).current;
    if (!iframe || !active || active.direct) return;
    const doc = iframe.contentDocument;
    if (!doc) return;
    const handleAnchor = (event: MouseEvent) => {
      const href = findClosestAnchorHref(event.target);
      if (!href || href.startsWith("#")) return;
      event.preventDefault(); event.stopPropagation();
      let resolved = href; try { resolved = new URL(href, active.url).href; } catch { /* Link router handles invalid targets. */ }
      if (!shouldOpenLinkExternally(event) && canOpenUrlInternally(resolved)) navigate(resolved);
      else void navigateLink(resolved, { paneId, currentFilePath: active.url, externalUrlMode: "external" });
    };
    doc.addEventListener("click", handleAnchor, true); doc.addEventListener("auxclick", handleAnchor, true);
    return () => { doc.removeEventListener("click", handleAnchor, true); doc.removeEventListener("auxclick", handleAnchor, true); };
  }, [active, activeIndex, frameA, frameB, navigate, paneId]);

  const commandBar = useMemo<CommandBarState>(() => ({
    breadcrumbs: [{ label: fileName }],
    actions: [],
  }), [fileName]);
  usePaneCommandBar({ paneId, state: commandBar });

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <WebAddressBar url={url} onNavigate={navigate} onBack={() => step(-1)} onForward={() => step(1)} canGoBack={history.index > 0} canGoForward={history.index < history.entries.length - 1} onReload={reload} loading={loading} onStop={stop} onExternal={() => void openExternalUrl(url)} />
      {(pending?.direct || active?.direct) && <div className="shrink-0 border-b px-3 py-1 text-xs text-muted-foreground">{translate("viewer.web.embedNotice")}</div>}
      {error && <div role="alert" className="flex shrink-0 items-center gap-2 border-b bg-background px-3 py-2 text-xs"><AlertCircle className="h-4 w-4 shrink-0 text-destructive" /><span>{error}</span><button type="button" className="shrink-0 underline" onClick={reload}>{translate("viewer.web.retry")}</button></div>}
      {stopped && <div role="status" className="px-3 py-1 text-xs text-muted-foreground">{translate("viewer.web.stopped")}</div>}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-background" aria-busy={loading}>
        <PreviewFrame preview={activeIndex === 0 ? active : pending} iframeRef={frameA} visible={activeIndex === 0} onLoad={() => promote(0)} onError={() => frameError(0)} title={fileName} />
        <PreviewFrame preview={activeIndex === 1 ? active : pending} iframeRef={frameB} visible={activeIndex === 1} onLoad={() => promote(1)} onError={() => frameError(1)} title={fileName} />
        {loading && <div role="status" className={cn("pointer-events-none absolute z-10 flex items-center gap-2 text-xs text-muted-foreground", active ? "right-3 top-3 rounded border bg-background/95 px-2 py-1 shadow-sm" : "inset-0 justify-center bg-background")}><Loader2 className="h-4 w-4 animate-spin" />{translate("viewer.web.loading.page")}</div>}
        {!loading && !active && !pending && !error && !stopped && <div className="p-4 text-sm text-muted-foreground">{translate("viewer.web.empty")}</div>}
      </div>
    </div>
  );
}

export default WebViewer;
