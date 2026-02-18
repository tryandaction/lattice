"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ZoomIn, ZoomOut, Loader2, Search, List, Maximize2, ArrowLeftRight } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PdfSearchOverlay } from "./pdf-search-overlay";
import { PdfOutlineSidebar } from "./pdf-outline-sidebar";
import { useI18n } from "@/hooks/use-i18n";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  content: ArrayBuffer;
  fileName: string;
}

/**
 * PDF Document Viewer component
 * Renders all PDF pages in continuous scroll mode for seamless reading
 */
export function PDFViewer({ content, fileName }: PDFViewerProps) {
  const { t } = useI18n();
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.2);
  const [error, setError] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState<string>("1");
  const [searchOpen, setSearchOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [fitMode, setFitMode] = useState<'manual' | 'width' | 'page'>('manual');
  const [pageWidth, setPageWidth] = useState(612);
  const [pageHeight, setPageHeight] = useState(792);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Memoize the file data to prevent unnecessary reloads
  // Copy the ArrayBuffer to avoid detached buffer issues
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
      if (fitMode === 'width') {
        setScale(Math.max(0.5, Math.min(3.0, cw / pageWidth)));
      } else {
        setScale(Math.max(0.5, Math.min(3.0, Math.min(cw / pageWidth, ch / pageHeight))));
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, [fitMode, pageWidth, pageHeight]);

  const onPageLoadSuccess = useCallback((page: { width: number; height: number }) => {
    setPageWidth(page.width);
    setPageHeight(page.height);
  }, []);

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
    const pageElement = pageRefs.current.get(pageNum);
    if (pageElement) {
      pageElement.scrollIntoView({ behavior: "smooth", block: "start" });
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
    <div className="flex h-full flex-col">
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

        {/* PDF Content - Continuous scroll mode */}
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
          <div className="flex flex-col items-center gap-4">
            {Array.from({ length: numPages }, (_, index) => (
              <div
                key={`page_${index + 1}`}
                ref={(el) => {
                  if (el) pageRefs.current.set(index + 1, el);
                }}
              >
                <Page
                  pageNumber={index + 1}
                  scale={scale}
                  className="shadow-lg"
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                  onLoadSuccess={onPageLoadSuccess}
                  loading={
                    <div className="flex h-[800px] w-[600px] items-center justify-center bg-white shadow-lg">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  }
                />
              </div>
            ))}
          </div>
        </Document>
        </div>
      </div>
    </div>
  );
}
