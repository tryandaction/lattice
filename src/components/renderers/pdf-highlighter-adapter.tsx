"use client";

/**
 * PDF Highlighter Adapter
 * 
 * Integrates react-pdf-highlighter with the Universal Annotation Manager.
 * Provides text selection highlighting and Pin Mode for sticky notes.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  PdfLoader,
  PdfHighlighter,
  Highlight,
  Popup,
} from "react-pdf-highlighter";
import type { 
  IHighlight, 
  NewHighlight, 
} from "react-pdf-highlighter";
import { 
  ZoomIn, 
  ZoomOut, 
  Loader2, 
  StickyNote,
  MessageSquare,
  X,
  Check,
  Highlighter,
  Underline,
  Type,
  Square,
  Pencil,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnnotationSystem } from "@/hooks/use-annotation-system";
import { useAnnotationNavigation } from "@/hooks/use-annotation-navigation";
import { HIGHLIGHT_COLORS } from "@/lib/annotation-colors";
import { PDFExportButton } from "./pdf-export-button";
import type { AnnotationItem, PdfTarget, BoundingBox } from "@/types/universal-annotation";

import "react-pdf-highlighter/dist/style.css";

// ============================================================================
// Types
// ============================================================================

interface PDFHighlighterAdapterProps {
  content: ArrayBuffer;
  fileName: string;
  fileHandle: FileSystemFileHandle;
  rootHandle: FileSystemDirectoryHandle;
}

// Annotation tool types (Zotero-style)
type AnnotationTool = 'select' | 'highlight' | 'underline' | 'note' | 'text' | 'area' | 'ink';

// Fit width icon component (Zotero style)
function FitWidthIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 12h10M7 12l2-2M7 12l2 2M17 12l-2-2M17 12l-2 2" />
    </svg>
  );
}

// ============================================================================
// Conversion Utilities
// ============================================================================

/**
 * Converts Universal AnnotationItem to react-pdf-highlighter IHighlight
 */
function annotationToHighlight(annotation: AnnotationItem): IHighlight | null {
  if (annotation.target.type !== 'pdf') return null;
  
  const target = annotation.target as PdfTarget;
  
  // Convert BoundingBox[] to Scaled[] format
  const rects = target.rects.map(rect => ({
    x1: rect.x1,
    y1: rect.y1,
    x2: rect.x2,
    y2: rect.y2,
    width: rect.x2 - rect.x1,
    height: rect.y2 - rect.y1,
    pageNumber: target.page,
  }));

  // Calculate bounding rect
  const x1 = Math.min(...target.rects.map(r => r.x1));
  const y1 = Math.min(...target.rects.map(r => r.y1));
  const x2 = Math.max(...target.rects.map(r => r.x2));
  const y2 = Math.max(...target.rects.map(r => r.y2));

  return {
    id: annotation.id,
    position: {
      boundingRect: {
        x1, y1, x2, y2,
        width: x2 - x1,
        height: y2 - y1,
        pageNumber: target.page,
      },
      rects,
      pageNumber: target.page,
    },
    content: {
      text: annotation.content,
    },
    comment: {
      text: annotation.comment || '',
      emoji: '',
    },
  };
}

/**
 * Converts react-pdf-highlighter NewHighlight to annotation data
 */
function highlightToAnnotationData(
  highlight: NewHighlight,
  color: string,
  author: string
): Omit<AnnotationItem, 'id' | 'createdAt'> {
  const rects: BoundingBox[] = highlight.position.rects.map(rect => ({
    x1: rect.x1,
    y1: rect.y1,
    x2: rect.x2,
    y2: rect.y2,
  }));

  return {
    target: {
      type: 'pdf',
      page: highlight.position.pageNumber,
      rects,
    } as PdfTarget,
    style: {
      color,
      type: 'highlight',
    },
    content: highlight.content.text,
    comment: highlight.comment?.text || undefined,
    author,
  };
}

/**
 * Creates a pin annotation at specific coordinates
 */
function createPinAnnotationData(
  page: number,
  x: number,
  y: number,
  comment: string | undefined,
  author: string
): Omit<AnnotationItem, 'id' | 'createdAt'> {
  const pinSize = 0.02;
  
  return {
    target: {
      type: 'pdf',
      page,
      rects: [{
        x1: Math.max(0, x - pinSize / 2),
        y1: Math.max(0, y - pinSize / 2),
        x2: Math.min(1, x + pinSize / 2),
        y2: Math.min(1, y + pinSize / 2),
      }],
    } as PdfTarget,
    style: {
      color: '#FFC107',
      type: 'area',
    },
    comment,
    author,
  };
}

/**
 * Checks if an annotation is a pin
 */
function isPinAnnotation(annotation: AnnotationItem): boolean {
  if (annotation.target.type !== 'pdf') return false;
  if (annotation.style.type !== 'area') return false;
  
  const target = annotation.target as PdfTarget;
  if (target.rects.length !== 1) return false;
  
  const rect = target.rects[0];
  const width = rect.x2 - rect.x1;
  const height = rect.y2 - rect.y1;
  
  return width < 0.05 && height < 0.05;
}

// ============================================================================
// Sub-components
// ============================================================================

interface ColorPickerProps {
  onColorSelect: (color: string) => void;
  onCancel: () => void;
  selectedText?: string;
}

function ColorPicker({ onColorSelect, onCancel, selectedText }: ColorPickerProps) {
  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg p-2 min-w-[200px]">
      <div className="text-xs text-muted-foreground mb-2 truncate max-w-[180px]">
        {selectedText ? `"${selectedText.slice(0, 30)}${selectedText.length > 30 ? '...' : ''}"` : 'Select color'}
      </div>
      <div className="flex gap-1 mb-2">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color.value}
            onClick={() => onColorSelect(color.hex)}
            className="w-7 h-7 rounded-full border-2 border-transparent hover:border-foreground/50 transition-colors"
            style={{ backgroundColor: color.hex }}
            title={color.name}
          />
        ))}
      </div>
      <button
        onClick={onCancel}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  );
}

interface HighlightPopupProps {
  comment: { text: string; emoji: string };
  onDelete: () => void;
  onAddComment: (comment: string) => void;
}

function HighlightPopupContent({ comment, onDelete, onAddComment }: HighlightPopupProps) {
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState(comment.text || "");

  const handleSaveComment = () => {
    onAddComment(commentText);
    setShowCommentInput(false);
  };

  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg p-2 min-w-[200px]">
      {comment.text && !showCommentInput && (
        <div className="text-sm mb-2 p-2 bg-muted rounded">
          {comment.text}
        </div>
      )}

      {showCommentInput ? (
        <div className="space-y-2">
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment..."
            className="w-full p-2 text-sm border border-border rounded bg-background resize-none"
            rows={2}
            autoFocus
          />
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setShowCommentInput(false)}>
              <X className="h-3 w-3" />
            </Button>
            <Button size="sm" onClick={handleSaveComment}>
              <Check className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowCommentInput(true)}
            title="Add comment"
          >
            <MessageSquare className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            className="text-destructive hover:text-destructive"
            title="Delete highlight"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

interface PinCommentPopupProps {
  position: { x: number; y: number };
  onSave: (comment: string) => void;
  onCancel: () => void;
}

function PinCommentPopup({ position, onSave, onCancel }: PinCommentPopupProps) {
  const [comment, setComment] = useState("");

  return (
    <div
      className="fixed bg-popover border border-border rounded-lg shadow-lg p-3 z-50 min-w-[250px]"
      style={{ left: position.x, top: position.y }}
    >
      <div className="text-sm font-medium mb-2">Add Note</div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Enter your note..."
        className="w-full p-2 text-sm border border-border rounded bg-background resize-none mb-2"
        rows={3}
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSave(comment)}>
          Save
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function PDFHighlighterAdapter({
  content,
  fileName,
  fileHandle,
  rootHandle,
}: PDFHighlighterAdapterProps) {
  const {
    annotations,
    error: annotationsError,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
  } = useAnnotationSystem({
    fileHandle,
    rootHandle,
    fileType: 'pdf',
    author: 'user',
  });

  const [scale, setScale] = useState(1.2);
  const [zoomMode, setZoomMode] = useState<'manual' | 'fit-width' | 'fit-page'>('manual');
  const [activeTool, setActiveTool] = useState<AnnotationTool>('select');
  const [activeColor, setActiveColor] = useState('#FFEB3B'); // Yellow default
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number; page: number } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Zoom limits
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 4.0;
  const ZOOM_STEP = 0.25;

  // Calculate fit-width scale
  const calculateFitWidth = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return 1.0;
    
    // Assume standard PDF page width of 612 points (8.5 inches)
    const pageWidth = 612;
    const containerWidth = container.clientWidth - 48; // Account for padding
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, containerWidth / pageWidth));
  }, []);

  // Calculate fit-page scale
  const calculateFitPage = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return 1.0;
    
    // Assume standard PDF page dimensions (612 x 792 points)
    const pageWidth = 612;
    const pageHeight = 792;
    const containerWidth = container.clientWidth - 48;
    const containerHeight = container.clientHeight - 48;
    
    const scaleX = containerWidth / pageWidth;
    const scaleY = containerHeight / pageHeight;
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(scaleX, scaleY)));
  }, []);

  // Helper to preserve viewport center during zoom
  const preserveViewportCenter = useCallback((oldScale: number, newScale: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Get current scroll position and viewport dimensions
    const scrollLeft = container.scrollLeft;
    const scrollTop = container.scrollTop;
    const viewportWidth = container.clientWidth;
    const viewportHeight = container.clientHeight;

    // Calculate the center point in document coordinates (at old scale)
    const centerX = scrollLeft + viewportWidth / 2;
    const centerY = scrollTop + viewportHeight / 2;

    // Convert to normalized coordinates (independent of scale)
    const normalizedX = centerX / oldScale;
    const normalizedY = centerY / oldScale;

    // After scale change, restore the center point
    requestAnimationFrame(() => {
      // Calculate new scroll position to keep the same center
      const newCenterX = normalizedX * newScale;
      const newCenterY = normalizedY * newScale;
      
      container.scrollLeft = newCenterX - viewportWidth / 2;
      container.scrollTop = newCenterY - viewportHeight / 2;
    });
  }, []);

  // Apply zoom mode
  const applyZoomMode = useCallback((mode: 'manual' | 'fit-width' | 'fit-page') => {
    setZoomMode(mode);
    if (mode === 'fit-width') {
      const newScale = calculateFitWidth();
      setScale((s) => {
        if (s !== newScale) preserveViewportCenter(s, newScale);
        return newScale;
      });
    } else if (mode === 'fit-page') {
      const newScale = calculateFitPage();
      setScale((s) => {
        if (s !== newScale) preserveViewportCenter(s, newScale);
        return newScale;
      });
    }
  }, [calculateFitWidth, calculateFitPage, preserveViewportCenter]);

  // Zoom functions with proper bounds and viewport preservation
  const zoomIn = useCallback(() => {
    setScale((s) => {
      const newScale = Math.min(s + ZOOM_STEP, ZOOM_MAX);
      if (newScale !== s) {
        preserveViewportCenter(s, newScale);
      }
      return newScale;
    });
  }, [preserveViewportCenter]);

  const zoomOut = useCallback(() => {
    setScale((s) => {
      const newScale = Math.max(s - ZOOM_STEP, ZOOM_MIN);
      if (newScale !== s) {
        preserveViewportCenter(s, newScale);
      }
      return newScale;
    });
  }, [preserveViewportCenter]);

  const resetZoom = useCallback(() => {
    setScale((s) => {
      if (s !== 1.0) {
        preserveViewportCenter(s, 1.0);
      }
      return 1.0;
    });
  }, [preserveViewportCenter]);

  // Handle Ctrl+Wheel zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setScale((s) => {
        const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, s + delta));
        if (newScale !== s) {
          preserveViewportCenter(s, newScale);
        }
        return newScale;
      });
    }
  }, [preserveViewportCenter]);

  // Handle keyboard shortcuts for zoom and tools
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Zoom shortcuts
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        resetZoom();
      }
    }
    // Tool shortcuts (without modifiers)
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      switch (e.key.toLowerCase()) {
        case 'h':
          setActiveTool(activeTool === 'highlight' ? 'select' : 'highlight');
          break;
        case 'u':
          setActiveTool(activeTool === 'underline' ? 'select' : 'underline');
          break;
        case 'n':
          setActiveTool(activeTool === 'note' ? 'select' : 'note');
          break;
        case 't':
          setActiveTool(activeTool === 'text' ? 'select' : 'text');
          break;
        case 'a':
          setActiveTool(activeTool === 'area' ? 'select' : 'area');
          break;
        case 'd':
          setActiveTool(activeTool === 'ink' ? 'select' : 'ink');
          break;
        case 'escape':
          setActiveTool('select');
          setShowColorPicker(false);
          break;
      }
    }
  }, [zoomIn, zoomOut, resetZoom, activeTool]);

  // Set up wheel and keyboard event listeners
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      if (container) {
        container.removeEventListener('wheel', handleWheel);
      }
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleWheel, handleKeyDown]);

  // Create blob URL from ArrayBuffer
  const pdfUrl = useMemo(() => {
    const blob = new Blob([content], { type: 'application/pdf' });
    return URL.createObjectURL(blob);
  }, [content]);

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  // Convert annotations to highlights
  const highlights = useMemo(() => {
    return annotations
      .map(annotationToHighlight)
      .filter((h): h is IHighlight => h !== null);
  }, [annotations]);

  // Navigation handler
  useAnnotationNavigation({
    handlers: {
      onPdfNavigate: (page, annotationId) => {
        setHighlightedId(annotationId);
        setTimeout(() => setHighlightedId(null), 2000);
      },
    },
  });

  // Handle PDF click in note mode
  const handlePdfClick = useCallback(
    (event: React.MouseEvent) => {
      if (activeTool !== 'note') return;

      const target = event.target as HTMLElement;
      const pageElement = target.closest('[data-page-number]');
      if (!pageElement) return;

      const pageNumber = parseInt(pageElement.getAttribute('data-page-number') || '1', 10);
      
      setPendingPin({
        x: event.clientX,
        y: event.clientY,
        page: pageNumber,
      });
    },
    [activeTool]
  );

  // Save pin
  const handleSavePin = useCallback(
    (comment: string) => {
      if (!pendingPin) return;

      const pageElement = document.querySelector(`[data-page-number="${pendingPin.page}"]`);
      if (!pageElement) {
        setPendingPin(null);
        return;
      }

      const rect = pageElement.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (pendingPin.x - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (pendingPin.y - rect.top) / rect.height));

      const pinData = createPinAnnotationData(
        pendingPin.page,
        x,
        y,
        comment || undefined,
        'user'
      );
      addAnnotation(pinData);
      setPendingPin(null);
    },
    [pendingPin, addAnnotation]
  );

  if (annotationsError) {
    console.error('Annotation error:', annotationsError);
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col">
      {/* Zotero-style Toolbar */}
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-2 py-1.5">
        {/* Left: File name */}
        <span className="text-sm text-muted-foreground truncate max-w-[200px]">
          {fileName}
        </span>

        {/* Center: Annotation Tools (Zotero style) */}
        <div className="flex items-center gap-0.5">
          {/* Highlight tool with color picker */}
          <div className="relative">
            <Button
              variant={activeTool === 'highlight' ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setActiveTool(activeTool === 'highlight' ? 'select' : 'highlight')}
              title="Highlight (H)"
            >
              <Highlighter className="h-4 w-4" style={{ color: activeColor }} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-4 px-0"
              onClick={() => setShowColorPicker(!showColorPicker)}
            >
              <ChevronDown className="h-3 w-3" />
            </Button>
            {showColorPicker && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg p-2">
                <div className="flex gap-1">
                  {HIGHLIGHT_COLORS.map((color) => (
                    <button
                      key={color.value}
                      onClick={() => {
                        setActiveColor(color.hex);
                        setShowColorPicker(false);
                      }}
                      className={`w-6 h-6 rounded-full border-2 transition-colors ${
                        activeColor === color.hex ? 'border-foreground' : 'border-transparent hover:border-foreground/50'
                      }`}
                      style={{ backgroundColor: color.hex }}
                      title={color.name}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Underline tool */}
          <Button
            variant={activeTool === 'underline' ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setActiveTool(activeTool === 'underline' ? 'select' : 'underline')}
            title="Underline (U)"
          >
            <Underline className="h-4 w-4" />
          </Button>

          {/* Sticky Note tool */}
          <Button
            variant={activeTool === 'note' ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setActiveTool(activeTool === 'note' ? 'select' : 'note')}
            title="Sticky Note (N)"
          >
            <StickyNote className="h-4 w-4" />
          </Button>

          {/* Text tool */}
          <Button
            variant={activeTool === 'text' ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setActiveTool(activeTool === 'text' ? 'select' : 'text')}
            title="Text (T)"
          >
            <Type className="h-4 w-4" />
          </Button>

          {/* Area selection tool */}
          <Button
            variant={activeTool === 'area' ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setActiveTool(activeTool === 'area' ? 'select' : 'area')}
            title="Area Selection (A)"
          >
            <Square className="h-4 w-4" />
          </Button>

          {/* Ink/Draw tool */}
          <Button
            variant={activeTool === 'ink' ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setActiveTool(activeTool === 'ink' ? 'select' : 'ink')}
            title="Draw (D)"
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </div>

        {/* Right: Zoom Controls (Zotero style) */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={zoomOut}
            disabled={scale <= ZOOM_MIN}
            title="Zoom out (Ctrl+-)"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          
          <span className="min-w-[3.5rem] text-center text-sm tabular-nums">
            {Math.round(scale * 100)}%
          </span>
          
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={zoomIn}
            disabled={scale >= ZOOM_MAX}
            title="Zoom in (Ctrl++)"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>

          {/* Fit width button (Zotero style) */}
          <Button
            variant={zoomMode === 'fit-width' ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => applyZoomMode(zoomMode === 'fit-width' ? 'manual' : 'fit-width')}
            title="Fit width"
          >
            <FitWidthIcon className="h-4 w-4" />
          </Button>

          <div className="mx-1 h-4 w-px bg-border" />

          <PDFExportButton
            originalContent={content}
            annotations={annotations}
            fileName={fileName}
          />
        </div>
      </div>

      {/* Tool hint bar */}
      {activeTool !== 'select' && (
        <div className="bg-blue-50 dark:bg-blue-950 border-b border-blue-200 dark:border-blue-800 px-4 py-1 text-xs text-blue-700 dark:text-blue-300 flex items-center gap-2">
          {activeTool === 'highlight' && (
            <>
              <Highlighter className="h-3 w-3" />
              Select text to highlight
            </>
          )}
          {activeTool === 'underline' && (
            <>
              <Underline className="h-3 w-3" />
              Select text to underline
            </>
          )}
          {activeTool === 'note' && (
            <>
              <StickyNote className="h-3 w-3" />
              Click anywhere to add a sticky note
            </>
          )}
          {activeTool === 'text' && (
            <>
              <Type className="h-3 w-3" />
              Click to add text annotation
            </>
          )}
          {activeTool === 'area' && (
            <>
              <Square className="h-3 w-3" />
              Drag to select an area
            </>
          )}
          {activeTool === 'ink' && (
            <>
              <Pencil className="h-3 w-3" />
              Draw on the PDF
            </>
          )}
          <button 
            className="ml-auto text-blue-500 hover:text-blue-700"
            onClick={() => setActiveTool('select')}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto bg-muted/30"
        onClick={handlePdfClick}
        style={{ 
          cursor: activeTool === 'note' ? 'crosshair' : 
                  activeTool === 'area' ? 'crosshair' :
                  activeTool === 'ink' ? 'crosshair' : 'default' 
        }}
      >
        <PdfLoader
          url={pdfUrl}
          beforeLoad={
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Loading PDF...</span>
            </div>
          }
        >
          {(pdfDocument) => (
            <PdfHighlighter
              pdfDocument={pdfDocument}
              enableAreaSelection={(event) => event.altKey || activeTool === 'area'}
              onSelectionFinished={(
                position,
                content,
                hideTipAndSelection,
                transformSelection
              ) => {
                // If highlight or underline tool is active, use activeColor directly
                if (activeTool === 'highlight' || activeTool === 'underline') {
                  const newHighlight: NewHighlight = {
                    position,
                    content,
                    comment: { text: '', emoji: '' },
                  };
                  const annotationData = highlightToAnnotationData(newHighlight, activeColor, 'user');
                  addAnnotation(annotationData);
                  hideTipAndSelection();
                  return null;
                }
                // Otherwise show color picker
                return (
                  <ColorPicker
                    selectedText={content.text}
                    onColorSelect={(color) => {
                      const newHighlight: NewHighlight = {
                        position,
                        content,
                        comment: { text: '', emoji: '' },
                      };
                      const annotationData = highlightToAnnotationData(newHighlight, color, 'user');
                      addAnnotation(annotationData);
                      hideTipAndSelection();
                    }}
                    onCancel={hideTipAndSelection}
                  />
                );
              }}
              highlightTransform={(
                highlight,
                index,
                setTip,
                hideTip,
                viewportToScaled,
                screenshot,
                isScrolledTo
              ) => {
                const annotation = annotations.find(a => a.id === highlight.id);
                const isPin = annotation && isPinAnnotation(annotation);
                const isHighlighted = highlightedId === highlight.id;

                if (isPin) {
                  const position = highlight.position;
                  // Pin position uses viewport coordinates (left, top)
                  return (
                    <div
                      key={highlight.id}
                      className={`absolute cursor-pointer transition-transform ${
                        isHighlighted ? 'animate-pulse scale-125' : ''
                      }`}
                      style={{
                        left: position.boundingRect.left,
                        top: position.boundingRect.top,
                        // Offset to center the pin icon
                        transform: 'translate(-50%, -100%)',
                      }}
                      onClick={() => {
                        setTip(highlight, () => (
                          <HighlightPopupContent
                            comment={highlight.comment}
                            onDelete={() => {
                              deleteAnnotation(highlight.id);
                              hideTip();
                            }}
                            onAddComment={(comment) => {
                              updateAnnotation(highlight.id, { comment });
                              hideTip();
                            }}
                          />
                        ));
                      }}
                    >
                      <StickyNote
                        className="h-5 w-5 text-amber-500 drop-shadow-md"
                        fill="currentColor"
                      />
                    </div>
                  );
                }

                return (
                  <Popup
                    popupContent={
                      <HighlightPopupContent
                        comment={highlight.comment}
                        onDelete={() => {
                          deleteAnnotation(highlight.id);
                          hideTip();
                        }}
                        onAddComment={(comment) => {
                          updateAnnotation(highlight.id, { comment });
                          hideTip();
                        }}
                      />
                    }
                    onMouseOver={(popupContent) => setTip(highlight, () => popupContent)}
                    onMouseOut={hideTip}
                    key={highlight.id}
                  >
                    <div
                      onClick={() => {
                        setTip(highlight, () => (
                          <HighlightPopupContent
                            comment={highlight.comment}
                            onDelete={() => {
                              deleteAnnotation(highlight.id);
                              hideTip();
                            }}
                            onAddComment={(comment) => {
                              updateAnnotation(highlight.id, { comment });
                              hideTip();
                            }}
                          />
                        ));
                      }}
                    >
                      <Highlight
                        isScrolledTo={isScrolledTo || isHighlighted}
                        position={highlight.position}
                        comment={highlight.comment}
                      />
                    </div>
                  </Popup>
                );
              }}
              highlights={highlights}
              pdfScaleValue={String(scale)}
              onScrollChange={() => {}}
              scrollRef={() => {}}
            />
          )}
        </PdfLoader>
      </div>

      {pendingPin && (
        <PinCommentPopup
          position={{ x: pendingPin.x, y: pendingPin.y }}
          onSave={handleSavePin}
          onCancel={() => setPendingPin(null)}
        />
      )}
    </div>
  );
}

export default PDFHighlighterAdapter;
