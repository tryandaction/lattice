"use client";

import { useState, useCallback, useMemo, useRef, useEffect, memo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ZoomIn, ZoomOut, Loader2, Search, List, Maximize2, ArrowLeftRight, Highlighter } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PdfSearchOverlay } from "./pdf-search-overlay";
import { PdfOutlineSidebar } from "./pdf-outline-sidebar";
import { useI18n } from "@/hooks/use-i18n";
import { useObjectUrl } from "@/hooks/use-object-url";
import { isTauriHost } from "@/lib/storage-adapter";
import { buildPersistedFileViewStateKey, loadPersistedFileViewState, savePersistedFileViewState } from "@/lib/file-view-state";
import { captureRelativeScrollPosition, restoreRelativeScrollPosition, type ScrollContainerLike } from "@/lib/pdf-view-state";
import {
  DEFAULT_PDF_VIEWER_VIEW_STATE,
  buildViewerVisiblePageSeed,
  getPdfViewerViewStateKey,
  readPdfViewerViewState,
  type PdfFitMode,
  type PdfViewerViewState,
} from "@/lib/pdf-viewer-position-state";
import type { BinaryViewerContent } from "@/types/viewer-content";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Configure PDF.js worker
const _workerUrl = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
pdfjs.GlobalWorkerOptions.workerSrc = _workerUrl;

// ── Desktop freeze diagnostic probes ──────────────────────────────────
// These will print to the Tauri devtools console so we can see exactly
// what is slow.  Remove after the freeze is fixed.
interface PDFViewerProps {
  source: BinaryViewerContent;
  documentId: string;
  fileName: string;
  fileHandle?: FileSystemFileHandle | null;
  paneId?: string;
  canAnnotate?: boolean;
  hasPersistedAnnotations?: boolean;
  onRequestAnnotationMode?: () => void;
}

declare global {
  interface Window {
    __latticeActivePdfPaneId?: string;
  }
}

/**
 * Number of pages to render above/below the visible viewport.
 * Keeps scrolling smooth without rendering the entire document.
 */
const PAGE_BUFFER = 2;

/** Placeholder height (px) for pages that haven't been measured yet */
const ESTIMATED_PAGE_HEIGHT = 842;
/** Placeholder width (px) */
const ESTIMATED_PAGE_WIDTH = 595;

const pdfViewerViewStateByKey = new Map<string, PdfViewerViewState>();
const pdfViewerZoomStateByPaneKey = new Map<string, Pick<PdfViewerViewState, "scale" | "fitMode">>();

function getCachedPdfViewerViewState(key: string): PdfViewerViewState {
  return pdfViewerViewStateByKey.get(key) ?? DEFAULT_PDF_VIEWER_VIEW_STATE;
}

function getCachedPdfViewerZoomState(paneId: string | undefined): Pick<PdfViewerViewState, "scale" | "fitMode"> | null {
  return paneId ? pdfViewerZoomStateByPaneKey.get(paneId) ?? null : null;
}

function findPrimaryVisibleViewerPage(container: HTMLElement): number | null {
  const containerRect = container.getBoundingClientRect();
  const pages = Array.from(container.querySelectorAll<HTMLElement>("[data-page-number]"));
  let best: { pageNumber: number; score: number } | null = null;

  for (const page of pages) {
    const pageNumber = Number(page.dataset.pageNumber ?? "");
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      continue;
    }

    const rect = page.getBoundingClientRect();
    const visibleTop = Math.max(rect.top, containerRect.top);
    const visibleBottom = Math.min(rect.bottom, containerRect.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    const distanceFromAnchor = Math.abs(rect.top - (containerRect.top + containerRect.height * 0.2));
    const score = visibleHeight * 10000 - distanceFromAnchor;
    if (!best || score > best.score) {
      best = { pageNumber, score };
    }
  }

  return best?.pageNumber ?? null;
}

// --- Virtualized page wrapper ---------------------------------------------------

interface VirtualPageProps {
  pageNumber: number;
  scale: number;
  devicePixelRatio?: number;
  isVisible: boolean;
  measuredHeight: number | null;
  measuredWidth: number | null;
  onMeasure: (pageNumber: number, width: number, height: number) => void;
  observer: IntersectionObserver | null;
}

/**
 * Renders a single PDF page only when it's near the viewport.
 * When off-screen, renders a lightweight placeholder of the correct size.
 */
const VirtualPage = memo(function VirtualPage({
  pageNumber,
  scale,
  devicePixelRatio,
  isVisible,
  measuredHeight,
  measuredWidth,
  onMeasure,
  observer,
}: VirtualPageProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Register with IntersectionObserver
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !observer) return;
    observer.observe(el);
    return () => observer.unobserve(el);
  }, [observer]);

  const placeholderW = measuredWidth ? measuredWidth * scale : ESTIMATED_PAGE_WIDTH * scale;
  const placeholderH = measuredHeight ? measuredHeight * scale : ESTIMATED_PAGE_HEIGHT * scale;

  const handlePageLoad = useCallback(
    (page: { width: number; height: number; getViewport?: (options: { scale: number }) => { width: number; height: number } }) => {
      const baseViewport = typeof page.getViewport === "function"
        ? page.getViewport({ scale: 1 })
        : page;
      onMeasure(pageNumber, baseViewport.width, baseViewport.height);
    },
    [onMeasure, pageNumber],
  );

  return (
    <div
      ref={sentinelRef}
      data-page-number={pageNumber}
      style={{ minHeight: placeholderH, minWidth: placeholderW }}
    >
      {isVisible ? (
        <Page
          pageNumber={pageNumber}
          scale={scale}
          devicePixelRatio={devicePixelRatio}
          className="shadow-lg"
          renderTextLayer={true}
          renderAnnotationLayer={true}
          onLoadSuccess={handlePageLoad}
          loading={
            <div
              className="flex items-center justify-center bg-white shadow-lg"
              style={{ width: placeholderW, height: placeholderH }}
            >
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          }
        />
      ) : (
        <div
          className="flex items-center justify-center bg-white/60 shadow-lg"
          style={{ width: placeholderW, height: placeholderH }}
        />
      )}
    </div>
  );
});

// --- Main PDF Viewer with virtualization ----------------------------------------

/**
 * PDF Document Viewer component
 * Uses IntersectionObserver to only render pages near the viewport.
 */
export function PDFViewer(props: PDFViewerProps) {
  const viewerKey = props.paneId ?? "default";
  return <PDFViewerInner key={viewerKey} {...props} />;
}

function PDFViewerInner({
  source,
  documentId,
  fileName,
  fileHandle,
  paneId,
  canAnnotate = false,
  hasPersistedAnnotations = false,
  onRequestAnnotationMode,
}: PDFViewerProps) {
  const { t } = useI18n();
  const isDesktopRuntime = isTauriHost();
  const documentKey = useMemo(
    () => `${paneId ?? "default"}:${documentId}`,
    [documentId, paneId],
  );
  const viewStateKey = useMemo(
    () => getPdfViewerViewStateKey(paneId, documentId),
    [documentId, paneId],
  );
  const persistedViewStateKey = useMemo(
    () => buildPersistedFileViewStateKey({
      kind: "pdf-viewer",
      filePath: documentId,
      fallbackName: fileName,
    }),
    [documentId, fileName],
  );
  const initialViewState = useMemo(() => ({
    ...getCachedPdfViewerViewState(viewStateKey),
    ...getCachedPdfViewerZoomState(paneId),
  }), [paneId, viewStateKey]);

  // ── Diagnostic: log mount time and worker status ──
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(() => initialViewState.scale);
  const [error, setError] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState<string>(() => String(initialViewState.currentPage ?? 1));
  const [searchOpen, setSearchOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [fitMode, setFitMode] = useState<PdfFitMode>(() => initialViewState.fitMode);
  const [pageWidth, setPageWidth] = useState(612);
  const [pageHeight, setPageHeight] = useState(792);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const restoreViewStateRef = useRef<PdfViewerViewState>(initialViewState);
  const hasRestoredViewStateRef = useRef(false);
  const persistTimeoutRef = useRef<number | null>(null);
  const lastPersistSignatureRef = useRef<string | null>(null);

  // Track which pages are near the viewport
  const [visiblePages, setVisiblePages] = useState<Set<number>>(() => buildViewerVisiblePageSeed(initialViewState.currentPage ?? 1));
  // Track measured page dimensions (unscaled) — use state so render can read it
  const [pageDimensions, setPageDimensions] = useState<Map<number, { w: number; h: number }>>(new Map());

  // IntersectionObserver: marks pages as visible when within rootMargin
  const [pageObserver, setPageObserver] = useState<IntersectionObserver | null>(null);
  const pageDevicePixelRatio = useMemo(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const runtimeDpr = window.devicePixelRatio || 1;
    return isDesktopRuntime ? Math.min(runtimeDpr, 2) : runtimeDpr;
  }, [isDesktopRuntime]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const entry of entries) {
            const el = entry.target as HTMLElement;
            const pageNum = Number(el.dataset.pageNumber);
            if (!pageNum) continue;
            if (entry.isIntersecting) {
              if (!next.has(pageNum)) { next.add(pageNum); changed = true; }
            } else {
              if (next.has(pageNum)) { next.delete(pageNum); changed = true; }
            }
          }
          return changed ? next : prev;
        });
      },
      {
        root: scrollContainerRef.current,
        // Render pages 1500px above/below viewport for smooth scrolling
        rootMargin: "1500px 0px 1500px 0px",
        threshold: 0,
      },
    );
    setPageObserver(observer);
    return () => {
      observer.disconnect();
      setPageObserver((current) => (current === observer ? null : current));
    };
  }, []);

  // Memoize the file data to prevent unnecessary reloads
  const isDesktopUrlSource = source.kind === "desktop-url";
  const fileDataSource = isDesktopUrlSource ? source.url : source.data;
  const pdfBlob = useMemo(() => (
    isDesktopUrlSource ? null : new Blob([(fileDataSource as ArrayBuffer).slice(0)], { type: "application/pdf" })
  ), [fileDataSource, isDesktopUrlSource]);
  const objectUrl = useObjectUrl(pdfBlob);
  const fileData = useMemo(() => (
    isDesktopUrlSource
      ? fileDataSource
      : objectUrl
  ), [fileDataSource, isDesktopUrlSource, objectUrl]);

  const captureCurrentViewState = useCallback((): PdfViewerViewState => {
    const container = scrollContainerRef.current;
    const currentPage = container
      ? findPrimaryVisibleViewerPage(container) ?? restoreViewStateRef.current.currentPage ?? 1
      : restoreViewStateRef.current.currentPage ?? 1;
    const relativeScroll = container
      ? captureRelativeScrollPosition(container)
      : restoreViewStateRef.current.relativeScroll;

    return {
      scale,
      fitMode,
      scrollTop: container?.scrollTop ?? restoreViewStateRef.current.scrollTop ?? 0,
      scrollLeft: container?.scrollLeft ?? restoreViewStateRef.current.scrollLeft ?? 0,
      currentPage,
      relativeScroll,
    };
  }, [fitMode, scale]);

  const persistViewStateNow = useCallback(() => {
    const nextState = captureCurrentViewState();
    const signature = [
      nextState.scale.toFixed(4),
      nextState.fitMode,
      Math.round(nextState.scrollTop ?? 0),
      Math.round(nextState.scrollLeft ?? 0),
      nextState.currentPage ?? 1,
      nextState.relativeScroll?.topRatio.toFixed(4) ?? "0",
      nextState.relativeScroll?.leftRatio.toFixed(4) ?? "0",
    ].join("|");

    restoreViewStateRef.current = nextState;
    pdfViewerViewStateByKey.set(viewStateKey, nextState);
    setPageInput(String(nextState.currentPage ?? 1));
    if (lastPersistSignatureRef.current === signature) {
      return;
    }
    lastPersistSignatureRef.current = signature;
    void savePersistedFileViewState(persistedViewStateKey, {
      cursorPosition: nextState.currentPage ?? 1,
      scrollTop: nextState.scrollTop ?? 0,
      scrollLeft: nextState.scrollLeft ?? 0,
      viewState: {
        pdfViewer: nextState,
      },
    });
  }, [captureCurrentViewState, persistedViewStateKey, viewStateKey]);

  const cacheViewStateNow = useCallback((nextState: Partial<PdfViewerViewState>) => {
    const currentState = captureCurrentViewState();
    const cachedState = {
      ...currentState,
      ...nextState,
    };
    restoreViewStateRef.current = cachedState;
    pdfViewerViewStateByKey.set(viewStateKey, cachedState);
    if (paneId && typeof cachedState.scale === "number") {
      pdfViewerZoomStateByPaneKey.set(paneId, {
        scale: cachedState.scale,
        fitMode: cachedState.fitMode,
      });
    }
  }, [captureCurrentViewState, paneId, viewStateKey]);

  const schedulePersistViewState = useCallback((delay = 250) => {
    if (persistTimeoutRef.current !== null) {
      window.clearTimeout(persistTimeoutRef.current);
    }
    persistTimeoutRef.current = window.setTimeout(() => {
      persistTimeoutRef.current = null;
      persistViewStateNow();
    }, delay);
  }, [persistViewStateNow]);

  useEffect(() => {
    const cachedState = {
      ...getCachedPdfViewerViewState(viewStateKey),
      ...getCachedPdfViewerZoomState(paneId),
    };
    restoreViewStateRef.current = cachedState;
    hasRestoredViewStateRef.current = false;
    lastPersistSignatureRef.current = null;
    setNumPages(0);
    setError(null);
    setPdfDoc(null);
    setScale(cachedState.scale);
    setFitMode(cachedState.fitMode);
    setPageInput(String(cachedState.currentPage ?? 1));
    setVisiblePages(buildViewerVisiblePageSeed(cachedState.currentPage ?? 1));
    setPageDimensions(new Map());
    setPageWidth(612);
    setPageHeight(792);
  }, [documentKey, paneId, viewStateKey]);

  useEffect(() => {
    let cancelled = false;
    void loadPersistedFileViewState(persistedViewStateKey).then((persistedState) => {
      if (cancelled || !persistedState) {
        return;
      }

      const persistedViewerState = readPdfViewerViewState(persistedState.viewState?.pdfViewer);
      if (!persistedViewerState) {
        return;
      }

      const paneZoomState = getCachedPdfViewerZoomState(paneId);
      const viewerState = {
        ...persistedViewerState,
        ...paneZoomState,
      };
      restoreViewStateRef.current = viewerState;
      pdfViewerViewStateByKey.set(viewStateKey, viewerState);
      setScale(viewerState.scale);
      setFitMode(viewerState.fitMode);
      setPageInput(String(persistedViewerState.currentPage ?? 1));
      setVisiblePages(buildViewerVisiblePageSeed(persistedViewerState.currentPage ?? 1));
    });

    return () => {
      cancelled = true;
    };
  }, [persistedViewStateKey, paneId, viewStateKey]);

  const onDocumentLoadSuccess = useCallback((pdf: { numPages: number }) => {
    setNumPages(pdf.numPages);
    setError(null);
    setPdfDoc(pdf as unknown as PDFDocumentProxy);
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(err.message || "Failed to load PDF");
  }, []);

  useEffect(() => {
    if (numPages <= 0 || hasRestoredViewStateRef.current) {
      return;
    }

    let frameId = 0;
    let attemptsLeft = 80;
    const restore = () => {
      const container = scrollContainerRef.current;
      if (!container) {
        attemptsLeft -= 1;
        if (attemptsLeft > 0) {
          frameId = window.requestAnimationFrame(restore);
        }
        return;
      }

      const state = restoreViewStateRef.current;
      if (state.currentPage) {
        setVisiblePages((previous) => {
          const next = new Set(previous);
          for (const page of buildViewerVisiblePageSeed(state.currentPage ?? 1)) {
            next.add(page);
          }
          return next;
        });
      }

      const hasScrollableLayout = container.scrollHeight > container.clientHeight || container.scrollWidth > container.clientWidth;
      if (!hasScrollableLayout) {
        attemptsLeft -= 1;
        if (attemptsLeft > 0) {
          frameId = window.requestAnimationFrame(restore);
        }
        return;
      }

      if (state.relativeScroll) {
        restoreRelativeScrollPosition(container as ScrollContainerLike, state.relativeScroll);
      } else if (typeof state.scrollTop === "number" || typeof state.scrollLeft === "number") {
        container.scrollTo({
          top: state.scrollTop ?? 0,
          left: state.scrollLeft ?? 0,
          behavior: "auto",
        });
      }
      hasRestoredViewStateRef.current = true;
      schedulePersistViewState(400);
    };

    frameId = window.requestAnimationFrame(() => {
      frameId = window.requestAnimationFrame(restore);
    });
    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [numPages, schedulePersistViewState]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    let rafId = 0;
    const handleScroll = () => {
      if (!hasRestoredViewStateRef.current) {
        return;
      }
      if (rafId) {
        return;
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        restoreViewStateRef.current = captureCurrentViewState();
        schedulePersistViewState();
      });
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
      }
      persistViewStateNow();
    };
  }, [captureCurrentViewState, persistViewStateNow, schedulePersistViewState]);

  useEffect(() => {
    if (hasRestoredViewStateRef.current) {
      schedulePersistViewState(160);
    }
  }, [fitMode, scale, schedulePersistViewState]);

  useEffect(() => {
    const flush = () => persistViewStateNow();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };

    window.addEventListener("blur", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [persistViewStateNow]);

  // Fit mode: recalculate scale when container resizes or fitMode changes
  useEffect(() => {
    if (fitMode === 'manual' || !scrollContainerRef.current || pageWidth === 0) return;
    const container = scrollContainerRef.current;
    const update = () => {
      const cw = container.clientWidth - 32;
      const ch = container.clientHeight - 32;
      const nextScale = fitMode === 'width'
        ? Math.max(0.5, Math.min(3.0, cw / pageWidth))
        : Math.max(0.5, Math.min(3.0, Math.min(cw / pageWidth, ch / pageHeight)));

      setScale((previous) => Math.abs(previous - nextScale) < 0.01 ? previous : nextScale);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, [fitMode, pageWidth, pageHeight]);

  const handlePageMeasure = useCallback((pageNumber: number, w: number, h: number) => {
    setPageDimensions((prev) => {
      const existing = prev.get(pageNumber);
      if (existing && Math.abs(existing.w - w) < 0.5 && Math.abs(existing.h - h) < 0.5) {
        return prev; // No change
      }
      const next = new Map(prev);
      next.set(pageNumber, { w, h });
      return next;
    });
    // Use first page dimensions for fit-mode calculations
    if (pageNumber === 1) {
      setPageWidth(w);
      setPageHeight(h);
    }
  }, []);

  // Compute which pages should be rendered (visible + buffer)
  const renderedPages = useMemo(() => {
    const rendered = new Set<number>();
    for (const p of visiblePages) {
      for (let i = p - PAGE_BUFFER; i <= p + PAGE_BUFFER; i++) {
        if (i >= 1 && i <= numPages) rendered.add(i);
      }
    }
    return rendered;
  }, [visiblePages, numPages]);

  const zoomIn = () => {
    setFitMode('manual');
    setScale((prev) => {
      const nextScale = Math.min(prev + 0.25, 3.0);
      cacheViewStateNow({ fitMode: 'manual', scale: nextScale });
      schedulePersistViewState(0);
      return nextScale;
    });
  };

  const zoomOut = () => {
    setFitMode('manual');
    setScale((prev) => {
      const nextScale = Math.max(prev - 0.25, 0.5);
      cacheViewStateNow({ fitMode: 'manual', scale: nextScale });
      schedulePersistViewState(0);
      return nextScale;
    });
  };

  const markPaneActive = useCallback(() => {
    if (paneId) {
      window.__latticeActivePdfPaneId = paneId;
    }
  }, [paneId]);

  const jumpToPage = useCallback((pageNum: number) => {
    if (pageNum < 1 || pageNum > numPages) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    // Find the sentinel element for the target page
    const sentinel = container.querySelector(`[data-page-number="${pageNum}"]`);
    if (sentinel) {
      sentinel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [numPages]);

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value);
  };

  const handlePageInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const pageNum = parseInt(pageInput, 10);
      if (!isNaN(pageNum)) {
        jumpToPage(pageNum);
      }
    }
  };

  const handlePageInputBlur = () => {
    const pageNum = parseInt(pageInput, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      setPageInput("1");
    } else if (pageNum > numPages && numPages > 0) {
      setPageInput(String(numPages));
    }
  };

  // Ctrl+F to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!paneId) {
      return;
    }

    const handler = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || window.__latticeActivePdfPaneId !== paneId) {
        return;
      }

      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        zoomIn();
        return;
      }

      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomOut();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [paneId]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <p className="text-destructive">Error loading PDF: {error}</p>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col"
      data-testid={paneId ? `pdf-pane-${paneId}` : "pdf-viewer"}
      onMouseEnter={markPaneActive}
      onFocusCapture={markPaneActive}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
        <span className="text-sm text-muted-foreground truncate max-w-xs">
          {fileName}
        </span>

        <div className="flex items-center gap-4">
          {/* Page navigation */}
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">Page</span>
            <input
              type="text"
              value={pageInput}
              onChange={handlePageInputChange}
              onKeyDown={handlePageInputKeyDown}
              onBlur={handlePageInputBlur}
              className="w-12 rounded border border-border bg-background px-2 py-0.5 text-center text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              title="Enter page number and press Enter to jump"
            />
            <span className="text-sm text-muted-foreground">of {numPages}</span>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={zoomOut}
              disabled={scale <= 0.5}
              className="rounded p-1 hover:bg-muted disabled:opacity-50"
              title={t('pdf.zoomOut')}
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="min-w-[4rem] text-center text-sm">
              {Math.round(scale * 100)}%
            </span>
            {paneId ? (
              <span className="sr-only" data-testid={`pdf-zoom-label-${paneId}`}>
                {Math.round(scale * 100)}%
              </span>
            ) : null}
            <button
              onClick={zoomIn}
              disabled={scale >= 3.0}
              className="rounded p-1 hover:bg-muted disabled:opacity-50"
              title={t('pdf.zoomIn')}
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              onClick={() => setFitMode(fitMode === 'width' ? 'manual' : 'width')}
              className={`rounded p-1 hover:bg-muted ${fitMode === 'width' ? 'bg-muted' : ''}`}
              title={t('pdf.fitWidth')}
            >
              <ArrowLeftRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => setFitMode(fitMode === 'page' ? 'manual' : 'page')}
              className={`rounded p-1 hover:bg-muted ${fitMode === 'page' ? 'bg-muted' : ''}`}
              title={t('pdf.fitPage')}
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>

          {/* Search button */}
          <button
            onClick={() => setSearchOpen(true)}
            className="rounded p-1 hover:bg-muted"
            title={t('pdf.search.open')}
          >
            <Search className="h-4 w-4" />
          </button>

          {/* Outline button */}
          <button
            onClick={() => setOutlineOpen((p) => !p)}
            className={`rounded p-1 hover:bg-muted ${outlineOpen ? 'bg-muted' : ''}`}
            title={t('pdf.outline.toggle')}
          >
            <List className="h-4 w-4" />
          </button>

          {canAnnotate ? (
            <button
              type="button"
              onClick={onRequestAnnotationMode}
              className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors ${
                hasPersistedAnnotations
                  ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                  : "border-border bg-background hover:bg-muted"
              }`}
              title={t('pdf.sidebar.show')}
              data-testid={paneId ? `pdf-annotate-trigger-${paneId}` : "pdf-annotate-trigger"}
            >
              <Highlighter className="h-3.5 w-3.5" />
              <span>{t('pdf.workspace.note.annotation')}</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Content area with optional outline sidebar */}
      <div className="flex flex-1 overflow-hidden">
        <PdfOutlineSidebar
          pdfDocument={pdfDoc}
          onNavigateToPage={jumpToPage}
          isOpen={outlineOpen}
          onClose={() => setOutlineOpen(false)}
        />

        {/* PDF Content - Virtualized continuous scroll */}
        <div
          ref={scrollContainerRef}
          className="relative flex-1 overflow-auto bg-muted/30 p-4"
          data-testid={paneId ? `pdf-viewer-container-${paneId}` : undefined}
        >
          <PdfSearchOverlay
            key={`${documentKey}:${searchOpen ? "open" : "closed"}`}
            pdfDocument={pdfDoc}
            fileHandle={fileHandle}
            numPages={numPages}
            onNavigateToPage={jumpToPage}
            isOpen={searchOpen}
            onClose={() => setSearchOpen(false)}
          />
          <Document
            key={documentKey}
            file={fileData}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Loading PDF...</span>
              </div>
            }
          >
            <div className="flex min-w-full flex-col items-center gap-4">
              {Array.from({ length: numPages }, (_, index) => {
                const pageNum = index + 1;
                const dims = pageDimensions.get(pageNum);
                return (
                  <VirtualPage
                    key={pageNum}
                    pageNumber={pageNum}
                    scale={scale}
                    devicePixelRatio={pageDevicePixelRatio}
                    isVisible={renderedPages.has(pageNum)}
                    measuredHeight={dims?.h ?? null}
                    measuredWidth={dims?.w ?? null}
                    onMeasure={handlePageMeasure}
                    observer={pageObserver}
                  />
                );
              })}
            </div>
          </Document>
        </div>
      </div>
    </div>
  );
}
