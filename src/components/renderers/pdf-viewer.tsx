"use client";

import { useState, useCallback, useMemo, useRef, useEffect, memo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ZoomIn, ZoomOut, Loader2, Search, List, Maximize2, ArrowLeftRight, Highlighter } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PdfSearchOverlay } from "./pdf-search-overlay";
import { PdfOutlineSidebar } from "./pdf-outline-sidebar";
import { useI18n } from "@/hooks/use-i18n";
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
  content: ArrayBuffer;
  fileName: string;
  paneId?: string;
  canAnnotate?: boolean;
  hasPersistedAnnotations?: boolean;
  onRequestAnnotationMode?: () => void;
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

// --- Virtualized page wrapper ---------------------------------------------------

interface VirtualPageProps {
  pageNumber: number;
  scale: number;
  isVisible: boolean;
  measuredHeight: number | null;
  measuredWidth: number | null;
  onMeasure: (pageNumber: number, width: number, height: number) => void;
  observerRef: React.RefObject<IntersectionObserver | null>;
}

/**
 * Renders a single PDF page only when it's near the viewport.
 * When off-screen, renders a lightweight placeholder of the correct size.
 */
const VirtualPage = memo(function VirtualPage({
  pageNumber,
  scale,
  isVisible,
  measuredHeight,
  measuredWidth,
  onMeasure,
  observerRef,
}: VirtualPageProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Register with IntersectionObserver
  useEffect(() => {
    const el = sentinelRef.current;
    const observer = observerRef.current;
    if (!el || !observer) return;
    observer.observe(el);
    return () => observer.unobserve(el);
  }, [observerRef]);

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
export function PDFViewer({
  content,
  fileName,
  paneId,
  canAnnotate = false,
  hasPersistedAnnotations = false,
  onRequestAnnotationMode,
}: PDFViewerProps) {
  const { t } = useI18n();
  const documentKey = useMemo(
    () => `${paneId ?? "default"}:${fileName}:${content.byteLength}`,
    [content.byteLength, fileName, paneId],
  );

  // ── Diagnostic: log mount time and worker status ──
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.2);
  const [error, setError] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState<string>("1");
  const [searchOpen, setSearchOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [fitMode, setFitMode] = useState<'manual' | 'width' | 'page'>('width');
  const [pageWidth, setPageWidth] = useState(612);
  const [pageHeight, setPageHeight] = useState(792);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Track which pages are near the viewport
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([1, 2, 3]));
  // Track measured page dimensions (unscaled) — use state so render can read it
  const [pageDimensions, setPageDimensions] = useState<Map<number, { w: number; h: number }>>(new Map());

  // IntersectionObserver: marks pages as visible when within rootMargin
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    setNumPages(0);
    setPdfDoc(null);
    setError(null);
    setPageInput("1");
    setVisiblePages(new Set([1, 2, 3]));
    setPageDimensions(new Map());
  }, [documentKey]);

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
    observerRef.current = observer;
    return () => observer.disconnect();
  }, []);

  // Memoize the file data to prevent unnecessary reloads
  const fileData = useMemo(() => {
    const copy = new Uint8Array(content).slice();
    return { data: copy };
  }, [content]);

  const onDocumentLoadSuccess = useCallback((pdf: { numPages: number }) => {
    setNumPages(pdf.numPages);
    setError(null);
    setPdfDoc(pdf as unknown as PDFDocumentProxy);
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(err.message || "Failed to load PDF");
  }, []);

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
    setScale((prev) => Math.min(prev + 0.25, 3.0));
  };

  const zoomOut = () => {
    setFitMode('manual');
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  };

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
        <div ref={scrollContainerRef} className="relative flex-1 overflow-auto bg-muted/30 p-4">
          <PdfSearchOverlay
            pdfDocument={pdfDoc}
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
            <div className="flex flex-col items-center gap-4">
              {Array.from({ length: numPages }, (_, index) => {
                const pageNum = index + 1;
                const dims = pageDimensions.get(pageNum);
                return (
                  <VirtualPage
                    key={pageNum}
                    pageNumber={pageNum}
                    scale={scale}
                    isVisible={renderedPages.has(pageNum)}
                    measuredHeight={dims?.h ?? null}
                    measuredWidth={dims?.w ?? null}
                    onMeasure={handlePageMeasure}
                    observerRef={observerRef}
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
