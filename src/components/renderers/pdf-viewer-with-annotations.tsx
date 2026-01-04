"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ZoomIn, ZoomOut, Loader2, PanelLeftOpen, PanelLeftClose, Type, Highlighter, Square } from "lucide-react";
import "react-pdf/dist/Page/AnnotationLayer.css";

import { AnnotationLayer } from "./annotation-layer";
import { AnnotationColorPicker } from "./annotation-color-picker";
import { AnnotationCommentPopup, AnnotationCommentTooltip } from "./annotation-comment-popup";
import { AnnotationSidebar } from "./annotation-sidebar";
import { TextAnnotationPicker, type TextAnnotationData } from "./text-annotation-picker";
import { TextAnnotationEditor, type TextAnnotationEditData } from "./text-annotation-editor";
import { usePdfAnnotation, type TextNoteData } from "../../hooks/use-pdf-annotation";
import { useAnnotationStore, deriveFileId } from "../../stores/annotation-store";
import { useAnnotationNavigation } from "../../hooks/use-annotation-navigation";
import type { LatticeAnnotation, AnnotationColor } from "../../types/annotation";
import { denormalizePosition } from "../../lib/annotation-coordinates";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// ============================================================================
// Types
// ============================================================================

interface PDFViewerWithAnnotationsProps {
  content: ArrayBuffer;
  fileName: string;
  filePath: string;
  rootHandle?: FileSystemDirectoryHandle | null;
}

interface PageDimensions {
  width: number;
  height: number;
}

type AnnotationMode = 'select' | 'highlight' | 'area' | 'textNote';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PAGE_WIDTH = 612; // Standard US Letter width in points
const DEFAULT_PAGE_HEIGHT = 792; // Standard US Letter height in points
const DEFAULT_AREA_HIGHLIGHT_COLOR: AnnotationColor = 'yellow';

// ============================================================================
// Component
// ============================================================================

/**
 * PDF Document Viewer with Annotation Support
 * 
 * Features:
 * - Continuous scroll mode for seamless reading
 * - Text selection highlighting
 * - Area highlighting with Alt+drag
 * - Comment popup for annotation editing
 * - Annotation sidebar with navigation
 * - Persistent storage in .lattice/annotations/
 */
export function PDFViewerWithAnnotations({
  content,
  fileName,
  filePath,
  rootHandle,
}: PDFViewerWithAnnotationsProps) {
  // PDF state
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.2);
  const [error, setError] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState<string>("1");
  const [pageDimensions, setPageDimensions] = useState<PageDimensions>({
    width: DEFAULT_PAGE_WIDTH,
    height: DEFAULT_PAGE_HEIGHT,
  });
  
  // UI state
  const [showSidebar, setShowSidebar] = useState(false);
  const [selectedAnnotation, setSelectedAnnotation] = useState<LatticeAnnotation | null>(null);
  const [hoveredAnnotation, setHoveredAnnotation] = useState<LatticeAnnotation | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);
  const [commentPopupPosition, setCommentPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>('select');
  const [textNotePickerInfo, setTextNotePickerInfo] = useState<{
    position: { x: number; y: number };
    rect: { x: number; y: number; width: number; height: number };
    page: number;
  } | null>(null);
  const [textNoteEditorInfo, setTextNoteEditorInfo] = useState<{
    annotation: LatticeAnnotation;
    position: { x: number; y: number };
  } | null>(null);
  
  // Refs
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  // Derive fileId from path
  const fileId = useMemo(() => deriveFileId(filePath), [filePath]);

  // Annotation store
  const {
    annotations,
    loadAnnotations,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    setRootHandle,
  } = useAnnotationStore();

  // Get annotations for this file
  const fileAnnotations = useMemo(() => {
    return annotations.get(fileId) ?? [];
  }, [annotations, fileId]);

  // PDF annotation hook
  const {
    textSelection,
    areaSelection,
    isAreaSelecting,
    clearTextSelection,
    createTextHighlight,
    createAreaHighlight,
    createTextNote,
    handleAreaMouseDown,
    handleAreaMouseMove,
    handleAreaMouseUp,
    handleTextSelectionChange,
  } = usePdfAnnotation({
    fileId,
    scale,
    pageWidth: pageDimensions.width,
    pageHeight: pageDimensions.height,
    onAnnotationCreate: addAnnotation,
  });

  // Load annotations when component mounts or file changes
  useEffect(() => {
    if (rootHandle) {
      setRootHandle(rootHandle);
      loadAnnotations(fileId, rootHandle);
    }
  }, [fileId, rootHandle, loadAnnotations, setRootHandle]);

  // Universal annotation navigation support
  // Allows navigation from external sources (e.g., universal annotation sidebar)
  useAnnotationNavigation({
    handlers: {
      onPdfNavigate: (page, annotationId) => {
        jumpToPage(page);
        // Find and select the annotation if it exists in our file
        const annotation = fileAnnotations.find(a => a.id === annotationId);
        if (annotation) {
          setSelectedAnnotation(annotation);
        }
      },
    },
  });

  // Memoize the file data to prevent unnecessary reloads
  const fileData = useMemo(() => {
    const copy = new Uint8Array(content).slice();
    return { data: copy };
  }, [content]);

  // Document load handlers
  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setError(null);
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(err.message || "Failed to load PDF");
  }, []);

  // Page load handler to get dimensions
  const onPageLoadSuccess = useCallback((page: { width: number; height: number }) => {
    setPageDimensions({ width: page.width, height: page.height });
  }, []);

  // Zoom controls
  const zoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + 0.25, 3.0));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  }, []);

  // Page navigation
  const jumpToPage = useCallback((pageNum: number) => {
    if (pageNum < 1 || pageNum > numPages) return;
    const pageElement = pageRefs.current.get(pageNum);
    if (pageElement) {
      pageElement.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [numPages]);

  // Jump to annotation
  const jumpToAnnotation = useCallback((annotation: LatticeAnnotation) => {
    setSelectedAnnotation(annotation);
    jumpToPage(annotation.page);
    
    // Show comment popup after scrolling
    setTimeout(() => {
      const pageElement = pageRefs.current.get(annotation.page);
      if (pageElement) {
        const pageRect = pageElement.getBoundingClientRect();
        const { boundingRect } = denormalizePosition(annotation.position, scale);
        setCommentPopupPosition({
          x: pageRect.left + boundingRect.x + boundingRect.width / 2,
          y: pageRect.top + boundingRect.y,
        });
      }
    }, 300);
  }, [jumpToPage, scale]);

  // Handle page input
  const handlePageInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value);
  }, []);

  const handlePageInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const pageNum = parseInt(pageInput, 10);
      if (!isNaN(pageNum)) {
        jumpToPage(pageNum);
      }
    }
  }, [pageInput, jumpToPage]);

  const handlePageInputBlur = useCallback(() => {
    const pageNum = parseInt(pageInput, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      setPageInput("1");
    } else if (pageNum > numPages && numPages > 0) {
      setPageInput(String(numPages));
    }
  }, [pageInput, numPages]);

  // Handle color selection for text highlight
  const handleColorSelect = useCallback((color: AnnotationColor) => {
    createTextHighlight(color);
  }, [createTextHighlight]);

  // Handle annotation click
  const handleAnnotationClick = useCallback((annotation: LatticeAnnotation, event?: React.MouseEvent) => {
    // Prevent triggering when not in select mode
    if (annotationMode !== 'select') return;
    
    setSelectedAnnotation(annotation);
    
    const pageElement = pageRefs.current.get(annotation.page);
    if (pageElement) {
      const pageRect = pageElement.getBoundingClientRect();
      const { boundingRect } = denormalizePosition(annotation.position, scale);
      
      // For text annotations, show the editor
      if (annotation.type === 'textNote') {
        setTextNoteEditorInfo({
          annotation,
          position: {
            x: event?.clientX || (pageRect.left + boundingRect.x + boundingRect.width / 2),
            y: event?.clientY || (pageRect.top + boundingRect.y),
          },
        });
      } else {
        // For other annotations, show comment popup
        setCommentPopupPosition({
          x: pageRect.left + boundingRect.x + boundingRect.width / 2,
          y: pageRect.top + boundingRect.y + boundingRect.height,
        });
      }
    }
  }, [scale, annotationMode]);

  // Handle annotation hover
  const handleAnnotationHover = useCallback((annotation: LatticeAnnotation | null) => {
    setHoveredAnnotation(annotation);
    
    if (annotation && annotation.comment) {
      const pageElement = pageRefs.current.get(annotation.page);
      if (pageElement) {
        const pageRect = pageElement.getBoundingClientRect();
        const { boundingRect } = denormalizePosition(annotation.position, scale);
        setHoverPosition({
          x: pageRect.left + boundingRect.x + boundingRect.width / 2,
          y: pageRect.top + boundingRect.y,
        });
      }
    } else {
      setHoverPosition(null);
    }
  }, [scale]);

  // Handle comment save
  const handleCommentSave = useCallback((comment: string) => {
    if (selectedAnnotation) {
      updateAnnotation(selectedAnnotation.id, { comment });
    }
    setSelectedAnnotation(null);
    setCommentPopupPosition(null);
  }, [selectedAnnotation, updateAnnotation]);

  // Handle annotation delete
  const handleAnnotationDelete = useCallback(() => {
    if (selectedAnnotation) {
      deleteAnnotation(selectedAnnotation.id);
    }
    setSelectedAnnotation(null);
    setCommentPopupPosition(null);
  }, [selectedAnnotation, deleteAnnotation]);

  // Handle comment popup close
  const handleCommentPopupClose = useCallback(() => {
    setSelectedAnnotation(null);
    setCommentPopupPosition(null);
  }, []);

  // Handle text selection on page
  const handlePageMouseUp = useCallback((pageNum: number, e: React.MouseEvent) => {
    // Only handle text selection in highlight mode
    if (annotationMode !== 'highlight') return;
    
    const pageElement = pageRefs.current.get(pageNum);
    if (pageElement) {
      handleTextSelectionChange(pageNum, pageElement);
    }
  }, [handleTextSelectionChange, annotationMode]);

  // Handle area selection mouse up
  const handleAreaSelectionMouseUp = useCallback((e: React.MouseEvent) => {
    handleAreaMouseUp(e, DEFAULT_AREA_HIGHLIGHT_COLOR);
  }, [handleAreaMouseUp]);

  // Handle text note mode click
  const handleTextNoteClick = useCallback((e: React.MouseEvent, pageNum: number) => {
    if (annotationMode !== 'textNote') return;
    
    const pageElement = pageRefs.current.get(pageNum);
    if (!pageElement) return;
    
    const pageRect = pageElement.getBoundingClientRect();
    const x = (e.clientX - pageRect.left) / scale;
    const y = (e.clientY - pageRect.top) / scale;
    
    // Create a default size for the text note
    const defaultWidth = 150;
    const defaultHeight = 40;
    
    setTextNotePickerInfo({
      position: { x: e.clientX, y: e.clientY },
      rect: { x, y, width: defaultWidth, height: defaultHeight },
      page: pageNum,
    });
  }, [annotationMode, scale]);

  // Handle text note creation
  const handleTextNoteConfirm = useCallback((data: TextAnnotationData) => {
    if (!textNotePickerInfo) return;
    
    const textNoteData: TextNoteData = {
      displayText: data.text,
      backgroundColor: data.backgroundColor,
      textStyle: data.textStyle,
    };
    
    createTextNote(textNotePickerInfo.rect, textNotePickerInfo.page, textNoteData);
    setTextNotePickerInfo(null);
    setAnnotationMode('select');
  }, [textNotePickerInfo, createTextNote]);

  // Handle text note picker close
  const handleTextNotePickerClose = useCallback(() => {
    setTextNotePickerInfo(null);
  }, []);

  // Handle text note edit
  const handleTextNoteEdit = useCallback((data: TextAnnotationEditData) => {
    if (!textNoteEditorInfo) return;
    
    updateAnnotation(textNoteEditorInfo.annotation.id, {
      content: {
        ...textNoteEditorInfo.annotation.content,
        displayText: data.text,
        backgroundColor: data.backgroundColor,
        textStyle: data.textStyle,
      },
      color: data.backgroundColor === 'transparent' ? 'yellow' : data.backgroundColor,
    });
    
    setTextNoteEditorInfo(null);
    setSelectedAnnotation(null);
  }, [textNoteEditorInfo, updateAnnotation]);

  // Handle text note editor delete
  const handleTextNoteEditorDelete = useCallback(() => {
    if (!textNoteEditorInfo) return;
    
    deleteAnnotation(textNoteEditorInfo.annotation.id);
    setTextNoteEditorInfo(null);
    setSelectedAnnotation(null);
  }, [textNoteEditorInfo, deleteAnnotation]);

  // Handle text note editor close
  const handleTextNoteEditorClose = useCallback(() => {
    setTextNoteEditorInfo(null);
    setSelectedAnnotation(null);
  }, []);

  // Toggle sidebar
  const toggleSidebar = useCallback(() => {
    setShowSidebar((prev) => !prev);
  }, []);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <p className="text-destructive">Error loading PDF: {error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Annotation sidebar - moved to left */}
      {showSidebar && (
        <div className="w-64 border-r border-border bg-background">
          <AnnotationSidebar
            fileId={fileId}
            annotations={fileAnnotations}
            onAnnotationClick={jumpToAnnotation}
            selectedAnnotationId={selectedAnnotation?.id}
          />
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
          <span className="text-sm text-muted-foreground truncate max-w-xs">
            {fileName}
          </span>
          
          <div className="flex items-center gap-4">
            {/* Annotation mode buttons */}
            <div className="flex items-center gap-1 border-r border-border pr-4">
              <button
                onClick={() => setAnnotationMode('select')}
                className={`rounded p-1.5 ${
                  annotationMode === 'select' 
                    ? 'bg-primary text-primary-foreground' 
                    : 'hover:bg-muted'
                }`}
                title="选择模式"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                </svg>
              </button>
              <button
                onClick={() => setAnnotationMode('highlight')}
                className={`rounded p-1.5 ${
                  annotationMode === 'highlight' 
                    ? 'bg-primary text-primary-foreground' 
                    : 'hover:bg-muted'
                }`}
                title="高亮模式 - 选择文字后高亮"
              >
                <Highlighter className="h-4 w-4" />
              </button>
              <button
                onClick={() => setAnnotationMode('area')}
                className={`rounded p-1.5 ${
                  annotationMode === 'area' 
                    ? 'bg-primary text-primary-foreground' 
                    : 'hover:bg-muted'
                }`}
                title="区域高亮 - 按住Alt拖动"
              >
                <Square className="h-4 w-4" />
              </button>
              <button
                onClick={() => setAnnotationMode('textNote')}
                className={`rounded p-1.5 ${
                  annotationMode === 'textNote' 
                    ? 'bg-primary text-primary-foreground' 
                    : 'hover:bg-muted'
                }`}
                title="文字批注 - 点击添加文字"
              >
                <Type className="h-4 w-4" />
              </button>
            </div>

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
                title="Zoom out"
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
                title="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>

            {/* Sidebar toggle */}
            <button
              onClick={toggleSidebar}
              className="rounded p-1 hover:bg-muted"
              title={showSidebar ? "隐藏批注" : "显示批注"}
            >
              {showSidebar ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* PDF Content */}
        <div 
          ref={containerRef}
          className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-800 p-4"
        >
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
              {Array.from({ length: numPages }, (_, index) => {
                const pageNum = index + 1;
                return (
                  <div
                    key={`page_${pageNum}`}
                    ref={(el) => {
                      if (el) pageRefs.current.set(pageNum, el);
                    }}
                    className={`relative ${annotationMode === 'textNote' ? 'cursor-crosshair' : ''}`}
                    onMouseDown={(e) => {
                      if (annotationMode === 'area' || e.altKey) {
                        handleAreaMouseDown(e, pageNum);
                      }
                    }}
                    onMouseMove={handleAreaMouseMove}
                    onMouseUp={(e) => {
                      if (isAreaSelecting) {
                        handleAreaSelectionMouseUp(e);
                      } else if (annotationMode === 'textNote') {
                        handleTextNoteClick(e, pageNum);
                      } else {
                        handlePageMouseUp(pageNum, e);
                      }
                    }}
                    onClick={(e) => {
                      if (annotationMode === 'textNote' && !isAreaSelecting) {
                        handleTextNoteClick(e, pageNum);
                      }
                    }}
                  >
                    <Page
                      pageNumber={pageNum}
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
                    
                    {/* Annotation layer overlay */}
                    <AnnotationLayer
                      fileId={fileId}
                      page={pageNum}
                      scale={scale}
                      pageWidth={pageDimensions.width}
                      pageHeight={pageDimensions.height}
                      annotations={fileAnnotations}
                      onAnnotationClick={handleAnnotationClick}
                      onAnnotationHover={handleAnnotationHover}
                      selectedAnnotationId={selectedAnnotation?.id}
                    />

                    {/* Area selection preview */}
                    {isAreaSelecting && areaSelection && areaSelection.page === pageNum && (
                      <div
                        className="pointer-events-none absolute border-2 border-dashed border-primary bg-primary/20"
                        style={{
                          left: areaSelection.rect.x * scale,
                          top: areaSelection.rect.y * scale,
                          width: areaSelection.rect.width * scale,
                          height: areaSelection.rect.height * scale,
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </Document>
        </div>
      </div>

      {/* Color picker popover */}
      {textSelection && (
        <AnnotationColorPicker
          position={textSelection.pickerPosition}
          onColorSelect={handleColorSelect}
          onClose={clearTextSelection}
        />
      )}

      {/* Comment popup */}
      {selectedAnnotation && commentPopupPosition && (
        <AnnotationCommentPopup
          annotation={selectedAnnotation}
          position={commentPopupPosition}
          onSave={handleCommentSave}
          onDelete={handleAnnotationDelete}
          onClose={handleCommentPopupClose}
        />
      )}

      {/* Comment tooltip on hover */}
      {hoveredAnnotation && hoveredAnnotation.comment && hoverPosition && !selectedAnnotation && (
        <AnnotationCommentTooltip
          comment={hoveredAnnotation.comment}
          position={hoverPosition}
        />
      )}

      {/* Text note picker */}
      {textNotePickerInfo && (
        <TextAnnotationPicker
          position={textNotePickerInfo.position}
          onConfirm={handleTextNoteConfirm}
          onClose={handleTextNotePickerClose}
        />
      )}

      {/* Text note editor */}
      {textNoteEditorInfo && (
        <TextAnnotationEditor
          annotation={textNoteEditorInfo.annotation}
          position={textNoteEditorInfo.position}
          onUpdate={handleTextNoteEdit}
          onDelete={handleTextNoteEditorDelete}
          onClose={handleTextNoteEditorClose}
        />
      )}
    </div>
  );
}
