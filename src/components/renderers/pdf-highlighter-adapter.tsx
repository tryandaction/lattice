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
  AreaHighlight,
} from "react-pdf-highlighter";
import type { 
  IHighlight, 
  NewHighlight, 
  ScaledPosition, 
  Content,
  LTWHP,
} from "react-pdf-highlighter";
import { 
  ZoomIn, 
  ZoomOut, 
  Loader2, 
  Pin, 
  MessageSquare,
  X,
  Check,
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
    isLoading: annotationsLoading,
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
  const [pinMode, setPinMode] = useState(false);
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number; page: number } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Handle PDF click in pin mode
  const handlePdfClick = useCallback(
    (event: React.MouseEvent) => {
      if (!pinMode) return;

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
    [pinMode]
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

  const zoomIn = () => setScale((s) => Math.min(s + 0.25, 3.0));
  const zoomOut = () => setScale((s) => Math.max(s - 0.25, 0.5));

  const getHighlightById = useCallback(
    (id: string) => highlights.find((h) => h.id === id),
    [highlights]
  );

  if (annotationsError) {
    console.error('Annotation error:', annotationsError);
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
        <span className="text-sm text-muted-foreground truncate max-w-xs">
          {fileName}
        </span>

        <div className="flex items-center gap-2">
          <Button
            variant={pinMode ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setPinMode(!pinMode)}
            title={pinMode ? "Exit Pin Mode" : "Enter Pin Mode"}
            className="gap-1"
          >
            <Pin className="h-4 w-4" />
            {pinMode && <span className="text-xs">Pin Mode</span>}
          </Button>

          <div className="mx-2 h-4 w-px bg-border" />

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={zoomOut}
            disabled={scale <= 0.5}
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="min-w-[4rem] text-center text-sm">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={zoomIn}
            disabled={scale >= 3.0}
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>

          <div className="mx-2 h-4 w-px bg-border" />

          <PDFExportButton
            originalContent={content}
            annotations={annotations}
            fileName={fileName}
          />
        </div>
      </div>

      {pinMode && (
        <div className="bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-800 px-4 py-1 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
          <Pin className="h-3 w-3" />
          Click anywhere on the PDF to add a sticky note
        </div>
      )}

      <div
        className="flex-1 overflow-auto bg-muted/30"
        onClick={handlePdfClick}
        style={{ cursor: pinMode ? 'crosshair' : 'default' }}
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
              enableAreaSelection={(event) => event.altKey}
              onSelectionFinished={(
                position,
                content,
                hideTipAndSelection,
                transformSelection
              ) => (
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
              )}
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
                  return (
                    <div
                      key={highlight.id}
                      className={`absolute cursor-pointer transition-transform ${
                        isHighlighted ? 'animate-pulse scale-125' : ''
                      }`}
                      style={{
                        left: position.boundingRect.left,
                        top: position.boundingRect.top,
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
                      <Pin
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
                    <Highlight
                      isScrolledTo={isScrolledTo || isHighlighted}
                      position={highlight.position}
                      comment={highlight.comment}
                    />
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
