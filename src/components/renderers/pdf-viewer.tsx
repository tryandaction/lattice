"use client";

import { useState, useCallback, useMemo, useRef, useEffect, memo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ZoomIn, ZoomOut, Loader2, Search, List, Maximize2, ArrowLeftRight, Highlighter } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PdfSearchOverlay } from "./pdf-search-overlay";
import { PdfOutlineSidebar } from "./pdf-outline-sidebar";
import { DesktopPdfReaderShell } from "./desktop-pdf-reader-shell";
import { useI18n } from "@/hooks/use-i18n";
import { isTauriHost } from "@/lib/storage-adapter";
import type { PdfRuntimeProfile } from "@/types/pdf-runtime";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface PDFViewerProps {
  content: ArrayBuffer;
  fileName: string;
  paneId?: string;
  fileId?: string;
  filePath?: string;
  fileHandle?: FileSystemFileHandle;
  rootHandle?: FileSystemDirectoryHandle | null;
  runtimeProfile?: PdfRuntimeProfile;
  canAnnotate?: boolean;
  hasPersistedAnnotations?: boolean;
  onRequestAnnotationMode?: () => void;
}

const PAGE_GAP = 16;
const WEB_PAGE_BUFFER_PX = 1200;
const DESKTOP_PAGE_BUFFER_PX = 560;
const DESKTOP_HEAVY_PAGE_BUFFER_PX = 280;
const ESTIMATED_PAGE_HEIGHT = 842;
const ESTIMATED_PAGE_WIDTH = 595;
const DESKTOP_HEAVY_DOCUMENT_PAGE_THRESHOLD = 200;

interface VirtualPageProps {
  pageNumber: number;
  scale: number;
  measuredHeight: number | null;
  measuredWidth: number | null;
  onMeasure: (pageNumber: number, width: number, height: number) => void;
  renderTextLayer: boolean;
  renderAnnotationLayer: boolean;
  devicePixelRatio?: number;
}

const VirtualPage = memo(function VirtualPage({
  pageNumber,
  scale,
  measuredHeight,
  measuredWidth,
  onMeasure,
  renderTextLayer,
  renderAnnotationLayer,
  devicePixelRatio,
}: VirtualPageProps) {
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
      data-page-number={pageNumber}
      style={{
        minHeight: placeholderH,
        minWidth: placeholderW,
        marginBottom: PAGE_GAP,
      }}
    >
      <Page
        pageNumber={pageNumber}
        scale={scale}
        renderMode="canvas"
        className="shadow-lg"
        renderTextLayer={renderTextLayer}
        renderAnnotationLayer={renderAnnotationLayer}
        devicePixelRatio={devicePixelRatio}
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
    </div>
  );
});

function getDefaultFitMode(isDesktopRuntime: boolean): "manual" | "width" | "page" {
  return isDesktopRuntime ? "page" : "width";
}

function getDefaultScale(isDesktopRuntime: boolean): number {
  return isDesktopRuntime ? 1.0 : 1.2;
}

function clampAutoScale(input: {
  requestedScale: number;
  fitMode: "manual" | "width" | "page";
  isDesktopRuntime: boolean;
  numPages: number;
}): number {
  const { requestedScale, fitMode, isDesktopRuntime, numPages } = input;
  if (!isDesktopRuntime) {
    return Math.max(0.5, Math.min(3.0, requestedScale));
  }

  const isHeavyDocument = numPages >= DESKTOP_HEAVY_DOCUMENT_PAGE_THRESHOLD;
  const desktopMax = fitMode === "page"
    ? 1.35
    : isHeavyDocument
      ? 1.5
      : 2.0;

  return Math.max(0.5, Math.min(desktopMax, requestedScale));
}

function getMaxManualScale(isDesktopRuntime: boolean, numPages: number): number {
  if (!isDesktopRuntime) {
    return 3.0;
  }

  if (numPages >= DESKTOP_HEAVY_DOCUMENT_PAGE_THRESHOLD) {
    return 1.35;
  }

  return 1.8;
}

function getPageBufferPx(isDesktopRuntime: boolean, numPages: number): number {
  if (!isDesktopRuntime) {
    return WEB_PAGE_BUFFER_PX;
  }

  return numPages >= DESKTOP_HEAVY_DOCUMENT_PAGE_THRESHOLD
    ? DESKTOP_HEAVY_PAGE_BUFFER_PX
    : DESKTOP_PAGE_BUFFER_PX;
}

function WebPdfViewer({
  content,
  fileName,
  paneId,
  canAnnotate = false,
  hasPersistedAnnotations = false,
  onRequestAnnotationMode,
}: Pick<PDFViewerProps, "content" | "fileName" | "paneId" | "canAnnotate" | "hasPersistedAnnotations" | "onRequestAnnotationMode">) {
  const { t } = useI18n();
  const isDesktopRuntime = isTauriHost();
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(() => getDefaultScale(isDesktopRuntime));
  const [error, setError] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState<string>("1");
  const [isPageInputFocused, setIsPageInputFocused] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [fitMode, setFitMode] = useState<"manual" | "width" | "page">(() => getDefaultFitMode(isDesktopRuntime));
  const [pageWidth, setPageWidth] = useState(612);
  const [pageHeight, setPageHeight] = useState(792);
  const [pageDimensions, setPageDimensions] = useState<Map<number, { w: number; h: number }>>(new Map());
  const [scrollState, setScrollState] = useState({ top: 0, height: 0 });
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (scrollEndTimerRef.current) {
      clearTimeout(scrollEndTimerRef.current);
    }
  }, []);

  const fileData = useMemo(() => {
    return { data: new Uint8Array(content) };
  }, [content]);

  const onDocumentLoadSuccess = useCallback((pdf: { numPages: number }) => {
    setNumPages(pdf.numPages);
    setError(null);
    setPdfDoc(pdf as unknown as PDFDocumentProxy);
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(err.message || "Failed to load PDF");
  }, []);

  const updateScrollMetrics = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    setScrollState((previous) => {
      const next = {
        top: container.scrollTop,
        height: container.clientHeight,
      };
      return previous.top === next.top && previous.height === next.height ? previous : next;
    });
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    let frame = 0;
    const scheduleUpdate = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateScrollMetrics();
      });
    };

    const handleScroll = () => {
      setIsScrolling(true);
      if (scrollEndTimerRef.current) {
        clearTimeout(scrollEndTimerRef.current);
      }
      scrollEndTimerRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 140);
      scheduleUpdate();
    };

    const resizeObserver = new ResizeObserver(() => {
      scheduleUpdate();
    });

    resizeObserver.observe(container);
    scheduleUpdate();
    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      if (scrollEndTimerRef.current) {
        clearTimeout(scrollEndTimerRef.current);
        scrollEndTimerRef.current = null;
      }
    };
  }, [updateScrollMetrics]);

  useEffect(() => {
    if (fitMode === "manual" || !scrollContainerRef.current || pageWidth === 0) {
      return;
    }

    const container = scrollContainerRef.current;
    const update = () => {
      const cw = Math.max(0, container.clientWidth - 32);
      const ch = Math.max(0, container.clientHeight - 32);
      const requestedScale = fitMode === "width"
        ? cw / pageWidth
        : Math.min(cw / pageWidth, ch / pageHeight);

      const nextScale = clampAutoScale({
        requestedScale,
        fitMode,
        isDesktopRuntime,
        numPages,
      });

      setScale((previous) => Math.abs(previous - nextScale) < 0.01 ? previous : nextScale);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitMode, isDesktopRuntime, numPages, pageHeight, pageWidth]);

  const handlePageMeasure = useCallback((pageNumber: number, w: number, h: number) => {
    setPageDimensions((prev) => {
      const existing = prev.get(pageNumber);
      if (existing && Math.abs(existing.w - w) < 0.5 && Math.abs(existing.h - h) < 0.5) {
        return prev;
      }
      const next = new Map(prev);
      next.set(pageNumber, { w, h });
      return next;
    });
    if (pageNumber === 1) {
      setPageWidth(w);
      setPageHeight(h);
    }
  }, []);

  const pageHeights = useMemo(() => {
    const baseHeight = pageHeight || ESTIMATED_PAGE_HEIGHT;
    return Array.from({ length: numPages }, (_, index) => {
      const measured = pageDimensions.get(index + 1);
      return ((measured?.h ?? baseHeight) * scale) + PAGE_GAP;
    });
  }, [numPages, pageDimensions, pageHeight, scale]);

  const pageOffsets = useMemo(() => {
    const offsets = new Array<number>(numPages + 1).fill(0);
    let running = 0;
    for (let index = 0; index < numPages; index += 1) {
      offsets[index] = running;
      running += pageHeights[index] ?? ((pageHeight || ESTIMATED_PAGE_HEIGHT) * scale) + PAGE_GAP;
    }
    offsets[numPages] = running;
    return offsets;
  }, [numPages, pageHeights, pageHeight, scale]);

  const totalContentHeight = pageOffsets[numPages] ?? 0;

  const visibleRange = useMemo(() => {
    if (numPages === 0) {
      return { start: 0, end: 0 };
    }

    const pageBufferPx = getPageBufferPx(isDesktopRuntime, numPages);
    const viewportStart = Math.max(0, scrollState.top - pageBufferPx);
    const viewportEnd = scrollState.top + scrollState.height + pageBufferPx;

    let start = 0;
    while (start < numPages - 1 && (pageOffsets[start] + (pageHeights[start] ?? 0)) < viewportStart) {
      start += 1;
    }

    let end = start;
    while (end < numPages && (pageOffsets[end] ?? 0) < viewportEnd) {
      end += 1;
    }

    return {
      start,
      end: Math.min(numPages, Math.max(end, start + 1)),
    };
  }, [isDesktopRuntime, numPages, pageHeights, pageOffsets, scrollState.height, scrollState.top]);

  const visiblePageNumbers = useMemo(
    () => Array.from({ length: Math.max(0, visibleRange.end - visibleRange.start) }, (_, index) => visibleRange.start + index + 1),
    [visibleRange.end, visibleRange.start],
  );

  const currentPage = useMemo(() => {
    if (numPages === 0) {
      return 1;
    }

    const anchor = scrollState.top + Math.max(scrollState.height * 0.25, 1);
    let index = visibleRange.start;
    while (index < numPages - 1 && (pageOffsets[index + 1] ?? Number.POSITIVE_INFINITY) <= anchor) {
      index += 1;
    }
    return index + 1;
  }, [numPages, pageOffsets, scrollState.height, scrollState.top, visibleRange.start]);

  const enableTextLayer = !isDesktopRuntime && !isScrolling;
  const enableAnnotationLayer = !isDesktopRuntime && !isScrolling && numPages <= 120;
  const devicePixelRatio = isDesktopRuntime ? 1 : undefined;
  const maxManualScale = getMaxManualScale(isDesktopRuntime, numPages);

  const zoomIn = () => {
    setFitMode("manual");
    setScale((prev) => Math.min(prev + 0.25, maxManualScale));
  };

  const zoomOut = () => {
    setFitMode("manual");
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  };

  const jumpToPage = useCallback((pageNum: number) => {
    if (pageNum < 1 || pageNum > numPages) {
      return;
    }
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: pageOffsets[pageNum - 1] ?? 0,
      behavior: "smooth",
    });
    setPageInput(String(pageNum));
  }, [numPages, pageOffsets]);

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value);
  };

  const handlePageInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const pageNum = parseInt(pageInput, 10);
      if (!Number.isNaN(pageNum)) {
        jumpToPage(pageNum);
      }
    }
  };

  const handlePageInputFocus = () => {
    setIsPageInputFocused(true);
  };

  const handlePageInputBlur = () => {
    setIsPageInputFocused(false);
    const pageNum = parseInt(pageInput, 10);
    if (Number.isNaN(pageNum) || pageNum < 1) {
      setPageInput(String(currentPage));
    } else if (pageNum > numPages && numPages > 0) {
      setPageInput(String(numPages));
    } else {
      setPageInput(String(pageNum));
    }
  };

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
      data-testid={paneId ? `pdf-viewer-${paneId}` : "pdf-viewer"}
    >
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
        <span className="text-sm text-muted-foreground truncate max-w-xs">
          {fileName}
        </span>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">Page</span>
            <input
              type="text"
              value={isPageInputFocused ? pageInput : String(currentPage)}
              onChange={handlePageInputChange}
              onKeyDown={handlePageInputKeyDown}
              onFocus={handlePageInputFocus}
              onBlur={handlePageInputBlur}
              className="w-12 rounded border border-border bg-background px-2 py-0.5 text-center text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              title="Enter page number and press Enter to jump"
            />
            <span className="text-sm text-muted-foreground">of {numPages}</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={zoomOut}
              disabled={scale <= 0.5}
              className="rounded p-1 hover:bg-muted disabled:opacity-50"
              title={t("pdf.zoomOut")}
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="min-w-[4rem] text-center text-sm">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={zoomIn}
              disabled={scale >= maxManualScale}
              className="rounded p-1 hover:bg-muted disabled:opacity-50"
              title={t("pdf.zoomIn")}
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              onClick={() => setFitMode((prev) => prev === "width" ? "manual" : "width")}
              className={`rounded p-1 hover:bg-muted ${fitMode === "width" ? "bg-muted" : ""}`}
              title={t("pdf.fitWidth")}
            >
              <ArrowLeftRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => setFitMode((prev) => prev === "page" ? "manual" : "page")}
              className={`rounded p-1 hover:bg-muted ${fitMode === "page" ? "bg-muted" : ""}`}
              title={t("pdf.fitPage")}
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={() => setSearchOpen(true)}
            className="rounded p-1 hover:bg-muted"
            title={t("pdf.search.open")}
          >
            <Search className="h-4 w-4" />
          </button>

          <button
            onClick={() => setOutlineOpen((prev) => !prev)}
            className={`rounded p-1 hover:bg-muted ${outlineOpen ? "bg-muted" : ""}`}
            title={t("pdf.outline.toggle")}
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
              title={t("pdf.sidebar.show")}
              data-testid={paneId ? `pdf-annotate-trigger-${paneId}` : "pdf-annotate-trigger"}
            >
              <Highlighter className="h-3.5 w-3.5" />
              <span>{t("pdf.workspace.note.annotation")}</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <PdfOutlineSidebar
          pdfDocument={pdfDoc}
          onNavigateToPage={jumpToPage}
          isOpen={outlineOpen}
          onClose={() => setOutlineOpen(false)}
        />

        <div ref={scrollContainerRef} className="relative flex-1 overflow-auto bg-muted/30 p-4">
          <PdfSearchOverlay
            pdfDocument={pdfDoc}
            numPages={numPages}
            onNavigateToPage={jumpToPage}
            isOpen={searchOpen}
            onClose={() => setSearchOpen(false)}
          />
          <Document
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
            <div className="flex flex-col items-center">
              <div style={{ height: pageOffsets[visibleRange.start] ?? 0, width: "100%" }} />
              {visiblePageNumbers.map((pageNum) => {
                const dims = pageDimensions.get(pageNum);
                return (
                  <VirtualPage
                    key={`${pageNum}:${Math.round(scale * 100)}`}
                    pageNumber={pageNum}
                    scale={scale}
                    measuredHeight={dims?.h ?? null}
                    measuredWidth={dims?.w ?? null}
                    onMeasure={handlePageMeasure}
                    renderTextLayer={enableTextLayer}
                    renderAnnotationLayer={enableAnnotationLayer}
                    devicePixelRatio={devicePixelRatio}
                  />
                );
              })}
              <div
                style={{
                  height: Math.max(0, totalContentHeight - (pageOffsets[visibleRange.end] ?? totalContentHeight)),
                  width: "100%",
                }}
              />
            </div>
          </Document>
        </div>
      </div>
    </div>
  );
}

export function PDFViewer(props: PDFViewerProps) {
  const runtimeProfile = props.runtimeProfile ?? (isTauriHost() ? "desktop-performance" : "web-rich");

  if (runtimeProfile === "desktop-performance") {
    return (
      <DesktopPdfReaderShell
        content={props.content}
        fileName={props.fileName}
        paneId={props.paneId}
        fileId={props.fileId ?? props.fileName}
        filePath={props.filePath ?? props.fileName}
        fileHandle={props.fileHandle}
        rootHandle={props.rootHandle}
        canAnnotate={props.canAnnotate}
        hasPersistedAnnotations={props.hasPersistedAnnotations}
      />
    );
  }

  return (
    <WebPdfViewer
      content={props.content}
      fileName={props.fileName}
      paneId={props.paneId}
      canAnnotate={props.canAnnotate}
      hasPersistedAnnotations={props.hasPersistedAnnotations}
      onRequestAnnotationMode={props.onRequestAnnotationMode}
    />
  );
}
