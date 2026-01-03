"use client";

/**
 * PDF Highlighter Adapter
 * 
 * Integrates react-pdf-highlighter with the Universal Annotation Manager.
 * Provides text selection highlighting and Pin Mode for sticky notes.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import ReactDOM from "react-dom";
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
  PanelRightOpen,
  PanelRightClose,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnnotationSystem } from "@/hooks/use-annotation-system";
import { useAnnotationNavigation } from "@/hooks/use-annotation-navigation";
import { HIGHLIGHT_COLORS } from "@/lib/annotation-colors";
import { PDFExportButton } from "./pdf-export-button";
import { PdfAnnotationSidebar } from "./pdf-annotation-sidebar";
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
 * Note: We store normalized 0-1 coordinates, need to convert back to PDF points
 * The react-pdf-highlighter library handles scaling internally based on pdfScaleValue
 */
function annotationToHighlight(annotation: AnnotationItem, pdfPageDimensions?: Map<number, { width: number; height: number }>): IHighlight | null {
  if (annotation.target.type !== 'pdf') return null;
  
  const target = annotation.target as PdfTarget;
  
  // Get actual page dimensions if available, otherwise use US Letter defaults
  const pageDims = pdfPageDimensions?.get(target.page);
  const pageWidth = pageDims?.width || 612;
  const pageHeight = pageDims?.height || 792;
  
  // Convert normalized coordinates (0-1) back to PDF points
  // react-pdf-highlighter expects coordinates in PDF points (not scaled)
  const rects = target.rects.map(rect => ({
    x1: rect.x1 * pageWidth,
    y1: rect.y1 * pageHeight,
    x2: rect.x2 * pageWidth,
    y2: rect.y2 * pageHeight,
    width: pageWidth,
    height: pageHeight,
    pageNumber: target.page,
  }));

  // Handle empty rects (e.g., for ink annotations)
  if (rects.length === 0) {
    return null;
  }

  // Calculate bounding rect from converted coordinates
  const x1 = Math.min(...rects.map(r => r.x1));
  const y1 = Math.min(...rects.map(r => r.y1));
  const x2 = Math.max(...rects.map(r => r.x2));
  const y2 = Math.max(...rects.map(r => r.y2));

  return {
    id: annotation.id,
    position: {
      boundingRect: {
        x1, y1, x2, y2,
        width: pageWidth,
        height: pageHeight,
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
 * Note: react-pdf-highlighter returns PDF coordinates (points), we need to normalize to 0-1
 */
function highlightToAnnotationData(
  highlight: NewHighlight,
  color: string,
  author: string,
  styleType: 'highlight' | 'underline' | 'area' = 'highlight'
): Omit<AnnotationItem, 'id' | 'createdAt'> {
  // Get page dimensions from boundingRect (more reliable than individual rects)
  const boundingRect = highlight.position.boundingRect;
  const pageWidth = boundingRect.width || 612;  // Default to US Letter
  const pageHeight = boundingRect.height || 792;
  
  // Normalize coordinates from PDF points to 0-1 range
  // Ensure coordinates are properly ordered (x1 < x2, y1 < y2)
  const rects: BoundingBox[] = highlight.position.rects.map(rect => {
    const x1 = Math.max(0, Math.min(1, Math.min(rect.x1, rect.x2) / pageWidth));
    const y1 = Math.max(0, Math.min(1, Math.min(rect.y1, rect.y2) / pageHeight));
    const x2 = Math.max(0, Math.min(1, Math.max(rect.x1, rect.x2) / pageWidth));
    const y2 = Math.max(0, Math.min(1, Math.max(rect.y1, rect.y2) / pageHeight));
    return { x1, y1, x2, y2 };
  });

  // Filter out invalid/empty rects
  const validRects = rects.filter(r => 
    r.x2 > r.x1 && r.y2 > r.y1 && 
    (r.x2 - r.x1) > 0.001 && (r.y2 - r.y1) > 0.001
  );

  // If no valid rects, create one from bounding rect
  const finalRects = validRects.length > 0 ? validRects : [{
    x1: Math.max(0, Math.min(1, boundingRect.x1 / pageWidth)),
    y1: Math.max(0, Math.min(1, boundingRect.y1 / pageHeight)),
    x2: Math.max(0, Math.min(1, boundingRect.x2 / pageWidth)),
    y2: Math.max(0, Math.min(1, boundingRect.y2 / pageHeight)),
  }];

  return {
    target: {
      type: 'pdf',
      page: highlight.position.pageNumber,
      rects: finalRects,
    } as PdfTarget,
    style: {
      color,
      type: styleType,
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
  onAddNote?: () => void;
  onAddComment?: () => void;
  currentColor?: string;
}

/**
 * Zotero-style context menu color picker
 * Features: Chinese labels, checkmark for selected color, add note/comment options
 */
function ColorPicker({ 
  onColorSelect, 
  onCancel, 
  selectedText, 
  onAddNote,
  onAddComment,
  currentColor 
}: ColorPickerProps) {
  return (
    <div className="bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[160px] text-sm">
      {/* Selected text preview */}
      {selectedText && (
        <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border truncate max-w-[200px]">
          "{selectedText.slice(0, 40)}{selectedText.length > 40 ? '...' : ''}"
        </div>
      )}
      
      {/* Add note option */}
      {onAddNote && (
        <button
          onClick={onAddNote}
          className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2"
        >
          <StickyNote className="h-4 w-4 text-amber-500" />
          <span>添加笔记</span>
        </button>
      )}
      
      {/* Add comment option */}
      {onAddComment && (
        <button
          onClick={onAddComment}
          className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2"
        >
          <MessageSquare className="h-4 w-4" />
          <span>添加评论</span>
        </button>
      )}
      
      {(onAddNote || onAddComment) && <div className="border-t border-border my-1" />}
      
      {/* Color options - Zotero style with Chinese names */}
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color.value}
          onClick={() => onColorSelect(color.hex)}
          className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2"
        >
          <div className="relative">
            <div 
              className="w-4 h-4 rounded-sm border border-black/10"
              style={{ backgroundColor: color.hex }}
            />
            {currentColor === color.hex && (
              <Check className="absolute -top-0.5 -right-0.5 h-3 w-3 text-foreground" />
            )}
          </div>
          <span>{color.nameCN}</span>
        </button>
      ))}
      
      <div className="border-t border-border my-1" />
      
      <button
        onClick={onCancel}
        className="w-full px-3 py-1.5 text-left hover:bg-muted text-muted-foreground"
      >
        取消
      </button>
    </div>
  );
}

interface HighlightPopupProps {
  comment: { text: string; emoji: string };
  onDelete: () => void;
  onAddComment: (comment: string) => void;
  onChangeColor?: (color: string) => void;
  onConvertToUnderline?: () => void;
  currentColor?: string;
  styleType?: 'highlight' | 'underline' | 'area' | 'ink';
  highlightText?: string;
}

/**
 * Zotero-style highlight context menu
 * Features: Add note, change color, convert to underline, delete
 */
function HighlightPopupContent({ 
  comment, 
  onDelete, 
  onAddComment,
  onChangeColor,
  onConvertToUnderline,
  currentColor,
  styleType = 'highlight',
  highlightText,
}: HighlightPopupProps) {
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState(comment.text || "");
  const [showColorPicker, setShowColorPicker] = useState(false);

  const handleSaveComment = () => {
    onAddComment(commentText);
    setShowCommentInput(false);
  };

  // Show comment input mode
  if (showCommentInput) {
    return (
      <div className="bg-popover border border-border rounded-lg shadow-xl p-3 min-w-[280px]">
        <div className="text-xs font-medium mb-2 text-muted-foreground">添加评论</div>
        <textarea
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder="输入评论..."
          className="w-full p-2 text-sm border border-border rounded bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          rows={3}
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-2">
          <Button size="sm" variant="ghost" onClick={() => setShowCommentInput(false)}>
            取消
          </Button>
          <Button size="sm" onClick={handleSaveComment}>
            保存
          </Button>
        </div>
      </div>
    );
  }

  // Show color picker mode
  if (showColorPicker && onChangeColor) {
    return (
      <div className="bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[160px]">
        <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground border-b border-border">
          选择颜色
        </div>
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color.value}
            onClick={() => {
              onChangeColor(color.hex);
              setShowColorPicker(false);
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2 text-sm"
          >
            <div className="relative">
              <div 
                className="w-4 h-4 rounded-sm border border-black/10"
                style={{ backgroundColor: color.hex }}
              />
              {currentColor === color.hex && (
                <Check className="absolute -top-0.5 -right-0.5 h-3 w-3 text-foreground" />
              )}
            </div>
            <span>{color.nameCN}</span>
          </button>
        ))}
        <div className="border-t border-border my-1" />
        <button
          onClick={() => setShowColorPicker(false)}
          className="w-full px-3 py-1.5 text-left hover:bg-muted text-sm text-muted-foreground"
        >
          返回
        </button>
      </div>
    );
  }

  // Main context menu - Zotero style
  return (
    <div className="bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[180px] text-sm">
      {/* Show highlighted text preview if available */}
      {highlightText && (
        <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border">
          <div className="truncate max-w-[200px]" style={{ backgroundColor: `${currentColor}40` }}>
            "{highlightText.slice(0, 50)}{highlightText.length > 50 ? '...' : ''}"
          </div>
        </div>
      )}
      
      {/* Show existing comment */}
      {comment.text && (
        <div className="px-3 py-2 border-b border-border">
          <div className="text-xs text-muted-foreground mb-1">评论:</div>
          <div className="text-sm bg-muted rounded p-1.5">{comment.text}</div>
        </div>
      )}
      
      {/* Add/Edit comment */}
      <button
        onClick={() => setShowCommentInput(true)}
        className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2"
      >
        <MessageSquare className="h-4 w-4" />
        <span>{comment.text ? '编辑评论' : '添加评论'}</span>
      </button>
      
      {/* Change color */}
      {onChangeColor && (
        <button
          onClick={() => setShowColorPicker(true)}
          className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2"
        >
          <div 
            className="w-4 h-4 rounded-sm border border-black/10"
            style={{ backgroundColor: currentColor || '#FFD400' }}
          />
          <span>更改颜色</span>
          <ChevronDown className="h-3 w-3 ml-auto" />
        </button>
      )}
      
      {/* Convert to underline (only for highlights) */}
      {styleType === 'highlight' && onConvertToUnderline && (
        <button
          onClick={onConvertToUnderline}
          className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2"
        >
          <Underline className="h-4 w-4" />
          <span>转换为下划线</span>
        </button>
      )}
      
      {/* Convert to highlight (only for underlines) */}
      {styleType === 'underline' && onConvertToUnderline && (
        <button
          onClick={onConvertToUnderline}
          className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2"
        >
          <Highlighter className="h-4 w-4" />
          <span>转换为高亮</span>
        </button>
      )}
      
      <div className="border-t border-border my-1" />
      
      {/* Delete */}
      <button
        onClick={onDelete}
        className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2 text-destructive"
      >
        <X className="h-4 w-4" />
        <span>删除</span>
      </button>
    </div>
  );
}

interface PinCommentPopupProps {
  position: { x: number; y: number };
  onSave: (comment: string) => void;
  onCancel: () => void;
}

/**
 * Zotero-style sticky note popup
 */
function PinCommentPopup({ position, onSave, onCancel }: PinCommentPopupProps) {
  const [comment, setComment] = useState("");

  return (
    <div
      className="fixed bg-popover border border-border rounded-lg shadow-xl p-3 z-50 min-w-[280px]"
      style={{ left: position.x, top: position.y }}
    >
      <div className="flex items-center gap-2 mb-2">
        <StickyNote className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-medium">添加笔记</span>
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="输入笔记内容..."
        className="w-full p-2 text-sm border border-border rounded bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
        rows={4}
        autoFocus
      />
      <div className="flex justify-end gap-2 mt-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button size="sm" onClick={() => onSave(comment)}>
          保存
        </Button>
      </div>
    </div>
  );
}

interface TextAnnotationPopupProps {
  position: { x: number; y: number };
  onSave: (text: string) => void;
  onCancel: () => void;
}

/**
 * Zotero-style text annotation popup
 */
function TextAnnotationPopup({ position, onSave, onCancel }: TextAnnotationPopupProps) {
  const [text, setText] = useState("");

  return (
    <div
      className="fixed bg-popover border border-border rounded-lg shadow-xl p-3 z-50 min-w-[280px]"
      style={{ left: position.x, top: position.y }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Type className="h-4 w-4" />
        <span className="text-sm font-medium">添加文本</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="输入文本..."
        className="w-full p-2 text-sm border border-border rounded bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
        rows={3}
        autoFocus
      />
      <div className="flex justify-end gap-2 mt-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button size="sm" onClick={() => onSave(text)} disabled={!text.trim()}>
          添加
        </Button>
      </div>
    </div>
  );
}

/**
 * Renders ink annotation paths as SVG overlay on each page
 * This approach is more reliable than canvas as it follows the page element
 */
interface InkAnnotationOverlayProps {
  annotation: AnnotationItem;
  scale: number;
}

function InkAnnotationOverlay({ annotation, scale }: InkAnnotationOverlayProps) {
  if (annotation.style.type !== 'ink' || annotation.target.type !== 'pdf') {
    return null;
  }

  try {
    const path = JSON.parse(annotation.content || '[]') as { x: number; y: number }[];
    if (path.length < 2) return null;

    // Create SVG path data from normalized coordinates
    const pathData = path.map((point, i) => {
      const cmd = i === 0 ? 'M' : 'L';
      // Convert normalized (0-1) to percentage for SVG viewBox
      return `${cmd} ${point.x * 100} ${point.y * 100}`;
    }).join(' ');

    return (
      <svg
        className="absolute inset-0 pointer-events-none"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%' }}
      >
        <path
          d={pathData}
          fill="none"
          stroke={annotation.style.color}
          strokeWidth={0.3 / scale}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  } catch (e) {
    return null;
  }
}

/**
 * Portal component to render ink annotation on the correct page
 */
interface InkAnnotationPortalProps {
  annotation: AnnotationItem;
  page: number;
  scale: number;
}

function InkAnnotationPortal({ annotation, page, scale }: InkAnnotationPortalProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Find the page element and create/find overlay container
    const pageElement = document.querySelector(`[data-page-number="${page}"]`) as HTMLElement;
    if (!pageElement) return;

    // Ensure the page element has relative positioning for absolute children
    const computedStyle = window.getComputedStyle(pageElement);
    if (computedStyle.position === 'static') {
      pageElement.style.position = 'relative';
    }

    // Look for existing overlay or create one
    let overlay = pageElement.querySelector(`.ink-overlay-${annotation.id}`) as HTMLElement;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = `ink-overlay-${annotation.id}`;
      overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
      pageElement.appendChild(overlay);
    }
    
    setContainer(overlay);

    return () => {
      // Clean up when annotation changes or unmounts
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    };
  }, [page, annotation.id]);

  if (!container) return null;

  return ReactDOM.createPortal(
    <InkAnnotationOverlay annotation={annotation} scale={scale} />,
    container
  );
}

/**
 * Current drawing path overlay (while user is drawing)
 */
interface CurrentInkPathOverlayProps {
  path: { x: number; y: number }[];
  color: string;
  scale: number;
}

function CurrentInkPathOverlay({ path, color, scale }: CurrentInkPathOverlayProps) {
  if (path.length < 2) return null;

  const pathData = path.map((point, i) => {
    const cmd = i === 0 ? 'M' : 'L';
    return `${cmd} ${point.x * 100} ${point.y * 100}`;
  }).join(' ');

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-20"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%' }}
    >
      <path
        d={pathData}
        fill="none"
        stroke={color}
        strokeWidth={0.3 / scale}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Portal component to render current ink path on the correct page
 */
interface CurrentInkPathPortalProps {
  path: { x: number; y: number }[];
  page: number;
  color: string;
  scale: number;
}

function CurrentInkPathPortal({ path, page, color, scale }: CurrentInkPathPortalProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const pageElement = document.querySelector(`[data-page-number="${page}"]`) as HTMLElement;
    if (!pageElement) return;

    // Ensure the page element has relative positioning
    const computedStyle = window.getComputedStyle(pageElement);
    if (computedStyle.position === 'static') {
      pageElement.style.position = 'relative';
    }

    let overlay = pageElement.querySelector('.current-ink-overlay') as HTMLElement;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'current-ink-overlay';
      overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:20;';
      pageElement.appendChild(overlay);
    }
    
    setContainer(overlay);

    return () => {
      // Clean up the overlay when unmounting
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    };
  }, [page]);

  if (!container) return null;

  return ReactDOM.createPortal(
    <CurrentInkPathOverlay path={path} color={color} scale={scale} />,
    container
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
  const [showSidebar, setShowSidebar] = useState(true); // Show sidebar by default
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentInkPath, setCurrentInkPath] = useState<{ x: number; y: number }[]>([]);
  const [currentInkPage, setCurrentInkPage] = useState<number | null>(null);
  const [textAnnotationPosition, setTextAnnotationPosition] = useState<{ x: number; y: number; page: number } | null>(null);
  const [pdfPageDimensions, setPdfPageDimensions] = useState<Map<number, { width: number; height: number }>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Zoom limits
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 4.0;
  const ZOOM_STEP = 0.25;

  // Get the pdfScaleValue string for PdfHighlighter
  // Can be a number string or special values: "page-width", "page-fit", "auto"
  const pdfScaleValue = useMemo(() => {
    if (zoomMode === 'fit-width') return 'page-width';
    if (zoomMode === 'fit-page') return 'page-fit';
    return String(scale);
  }, [scale, zoomMode]);

  // Apply zoom mode
  const applyZoomMode = useCallback((mode: 'manual' | 'fit-width' | 'fit-page') => {
    setZoomMode(mode);
    // For special modes, we don't need to calculate scale - pdfjs handles it
  }, []);

  // Simple zoom functions
  const zoomIn = useCallback(() => {
    setScale(s => Math.min(s + ZOOM_STEP, ZOOM_MAX));
    setZoomMode('manual');
  }, []);

  const zoomOut = useCallback(() => {
    setScale(s => Math.max(s - ZOOM_STEP, ZOOM_MIN));
    setZoomMode('manual');
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1.0);
    setZoomMode('manual');
  }, []);

  // Handle Ctrl+Wheel zoom - use native event on document to ensure capture
  useEffect(() => {
    const handleWheelZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        setScale(s => {
          const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, s + delta));
          return newScale;
        });
        setZoomMode('manual');
      }
    };

    // Add to document to capture all wheel events with ctrl
    document.addEventListener('wheel', handleWheelZoom, { passive: false });
    
    return () => {
      document.removeEventListener('wheel', handleWheelZoom);
    };
  }, []);

  // Handle keyboard shortcuts for zoom and tools
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

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
            setActiveTool(t => t === 'highlight' ? 'select' : 'highlight');
            break;
          case 'u':
            setActiveTool(t => t === 'underline' ? 'select' : 'underline');
            break;
          case 'n':
            setActiveTool(t => t === 'note' ? 'select' : 'note');
            break;
          case 't':
            setActiveTool(t => t === 'text' ? 'select' : 'text');
            break;
          case 'a':
            setActiveTool(t => t === 'area' ? 'select' : 'area');
            break;
          case 'd':
            setActiveTool(t => t === 'ink' ? 'select' : 'ink');
            break;
          case 'escape':
            setActiveTool('select');
            setShowColorPicker(false);
            break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [zoomIn, zoomOut, resetZoom]);

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
      .filter(a => a.style.type !== 'ink') // Ink annotations are rendered separately
      .map(a => annotationToHighlight(a, pdfPageDimensions))
      .filter((h): h is IHighlight => h !== null);
  }, [annotations, pdfPageDimensions]);

  // Get ink annotations for custom rendering
  const inkAnnotations = useMemo(() => {
    return annotations.filter(a => a.style.type === 'ink');
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

  // Handle PDF click in note/text mode
  const handlePdfClick = useCallback(
    (event: React.MouseEvent) => {
      // Find the page element that was clicked
      const target = event.target as HTMLElement;
      const pageElement = target.closest('.react-pdf__Page') || target.closest('[data-page-number]');
      
      if (!pageElement) return;
      
      const pageNumber = parseInt(pageElement.getAttribute('data-page-number') || '1', 10);
      if (isNaN(pageNumber) || pageNumber < 1) return;

      // Handle text annotation mode
      if (activeTool === 'text') {
        setTextAnnotationPosition({
          x: event.clientX,
          y: event.clientY,
          page: pageNumber,
        });
        return;
      }

      // Handle note/pin mode
      if (activeTool === 'note') {
        setPendingPin({
          x: event.clientX,
          y: event.clientY,
          page: pageNumber,
        });
        return;
      }
    },
    [activeTool]
  );

  // Handle ink drawing start
  const handleInkMouseDown = useCallback((event: React.MouseEvent) => {
    if (activeTool !== 'ink') return;
    
    // Find the page element that was clicked
    const target = event.target as HTMLElement;
    // Look for the actual PDF page canvas/text layer
    const pageElement = target.closest('.react-pdf__Page') || target.closest('[data-page-number]');
    if (!pageElement) return;

    const pageNumber = parseInt(pageElement.getAttribute('data-page-number') || '1', 10);
    const pageRect = pageElement.getBoundingClientRect();
    
    // Calculate normalized coordinates (0-1) relative to the page
    const x = (event.clientX - pageRect.left) / pageRect.width;
    const y = (event.clientY - pageRect.top) / pageRect.height;
    
    // Clamp to valid range
    const clampedX = Math.max(0, Math.min(1, x));
    const clampedY = Math.max(0, Math.min(1, y));
    
    setIsDrawing(true);
    setCurrentInkPage(pageNumber);
    setCurrentInkPath([{ x: clampedX, y: clampedY }]);
    
    event.preventDefault();
    event.stopPropagation();
  }, [activeTool]);

  // Handle ink drawing move
  const handleInkMouseMove = useCallback((event: React.MouseEvent) => {
    if (!isDrawing || activeTool !== 'ink' || currentInkPage === null) return;
    
    // Find the page element
    const pageElement = document.querySelector(`[data-page-number="${currentInkPage}"]`);
    if (!pageElement) return;

    const pageRect = pageElement.getBoundingClientRect();
    
    // Calculate normalized coordinates relative to the page
    const x = (event.clientX - pageRect.left) / pageRect.width;
    const y = (event.clientY - pageRect.top) / pageRect.height;
    
    // Clamp to valid range
    const clampedX = Math.max(0, Math.min(1, x));
    const clampedY = Math.max(0, Math.min(1, y));
    
    setCurrentInkPath(prev => [...prev, { x: clampedX, y: clampedY }]);
    
    event.preventDefault();
  }, [isDrawing, activeTool, currentInkPage]);

  // Handle ink drawing end
  const handleInkMouseUp = useCallback(() => {
    if (!isDrawing || currentInkPage === null || currentInkPath.length < 2) {
      setIsDrawing(false);
      setCurrentInkPath([]);
      setCurrentInkPage(null);
      return;
    }

    // Create ink annotation from path
    // Convert path to bounding box for storage
    const xs = currentInkPath.map(p => p.x);
    const ys = currentInkPath.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const inkAnnotation: Omit<AnnotationItem, 'id' | 'createdAt'> = {
      target: {
        type: 'pdf',
        page: currentInkPage,
        rects: [{
          x1: Math.max(0, minX),
          y1: Math.max(0, minY),
          x2: Math.min(1, maxX),
          y2: Math.min(1, maxY),
        }],
      } as PdfTarget,
      style: {
        color: activeColor,
        type: 'ink',
      },
      // Store the path as JSON in content for later rendering
      content: JSON.stringify(currentInkPath),
      author: 'user',
    };

    addAnnotation(inkAnnotation);
    
    setIsDrawing(false);
    setCurrentInkPath([]);
    setCurrentInkPage(null);
  }, [isDrawing, currentInkPage, currentInkPath, activeColor, addAnnotation]);

  // Handle text annotation save
  const handleSaveTextAnnotation = useCallback((text: string) => {
    if (!textAnnotationPosition || !text.trim()) {
      setTextAnnotationPosition(null);
      return;
    }

    const pageElement = document.querySelector(`[data-page-number="${textAnnotationPosition.page}"]`);
    if (!pageElement) {
      setTextAnnotationPosition(null);
      return;
    }

    const pageRect = pageElement.getBoundingClientRect();
    
    // Calculate normalized coordinates (0-1) from the stored client coordinates
    const x = Math.max(0, Math.min(1, (textAnnotationPosition.x - pageRect.left) / pageRect.width));
    const y = Math.max(0, Math.min(1, (textAnnotationPosition.y - pageRect.top) / pageRect.height));

    const textAnnotation: Omit<AnnotationItem, 'id' | 'createdAt'> = {
      target: {
        type: 'pdf',
        page: textAnnotationPosition.page,
        rects: [{
          x1: Math.max(0, x - 0.005),
          y1: Math.max(0, y - 0.005),
          x2: Math.min(1, x + 0.1),
          y2: Math.min(1, y + 0.02),
        }],
      } as PdfTarget,
      style: {
        color: activeColor,
        type: 'highlight',
      },
      content: text,
      comment: text,
      author: 'user',
    };

    addAnnotation(textAnnotation);
    setTextAnnotationPosition(null);
  }, [textAnnotationPosition, activeColor, addAnnotation]);

  // Save pin with correct coordinate calculation
  const handleSavePin = useCallback(
    (comment: string) => {
      if (!pendingPin) return;

      const pageElement = document.querySelector(`[data-page-number="${pendingPin.page}"]`);
      if (!pageElement) {
        setPendingPin(null);
        return;
      }

      const pageRect = pageElement.getBoundingClientRect();
      
      // Calculate normalized coordinates (0-1) from the stored client coordinates
      const x = Math.max(0, Math.min(1, (pendingPin.x - pageRect.left) / pageRect.width));
      const y = Math.max(0, Math.min(1, (pendingPin.y - pageRect.top) / pageRect.height));

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

  // Handle sidebar annotation selection - scroll to exact annotation position
  const handleSidebarSelect = useCallback((annotation: AnnotationItem) => {
    setSelectedAnnotationId(annotation.id);
    setHighlightedId(annotation.id);
    
    if (annotation.target.type === 'pdf') {
      const target = annotation.target as PdfTarget;
      const pageElement = document.querySelector(`[data-page-number="${target.page}"]`);
      
      if (pageElement && target.rects.length > 0) {
        const pageRect = pageElement.getBoundingClientRect();
        const container = scrollContainerRef.current;
        
        if (container) {
          // Get the first rect of the annotation (normalized 0-1 coordinates)
          const firstRect = target.rects[0];
          
          // Calculate the center of the annotation in page coordinates
          const annotationCenterX = (firstRect.x1 + firstRect.x2) / 2;
          const annotationCenterY = (firstRect.y1 + firstRect.y2) / 2;
          
          // Convert to pixel position within the page
          const annotationPixelX = annotationCenterX * pageRect.width;
          const annotationPixelY = annotationCenterY * pageRect.height;
          
          // Get page position relative to container
          const containerRect = container.getBoundingClientRect();
          const pageOffsetTop = pageRect.top - containerRect.top + container.scrollTop;
          const pageOffsetLeft = pageRect.left - containerRect.left + container.scrollLeft;
          
          // Calculate target scroll position to center the annotation
          const targetScrollTop = pageOffsetTop + annotationPixelY - container.clientHeight / 2;
          const targetScrollLeft = pageOffsetLeft + annotationPixelX - container.clientWidth / 2;
          
          // Smooth scroll to the annotation
          container.scrollTo({
            top: Math.max(0, targetScrollTop),
            left: Math.max(0, targetScrollLeft),
            behavior: 'smooth'
          });
        }
      } else if (pageElement) {
        // Fallback: just scroll to the page
        pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    
    // Clear highlight after animation
    setTimeout(() => setHighlightedId(null), 2000);
  }, []);

  // Handle sidebar delete
  const handleSidebarDelete = useCallback((id: string) => {
    deleteAnnotation(id);
    if (selectedAnnotationId === id) {
      setSelectedAnnotationId(null);
    }
  }, [deleteAnnotation, selectedAnnotationId]);

  if (annotationsError) {
    console.error('Annotation error:', annotationsError);
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col">
      {/* Error banner */}
      {annotationsError && (
        <div className="bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          错误: {annotationsError}
        </div>
      )}
      
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
              title="高亮 (H)"
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
              <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[140px]">
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color.value}
                    onClick={() => {
                      setActiveColor(color.hex);
                      setShowColorPicker(false);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2 text-sm"
                  >
                    <div className="relative">
                      <div 
                        className="w-4 h-4 rounded-sm border border-black/10"
                        style={{ backgroundColor: color.hex }}
                      />
                      {activeColor === color.hex && (
                        <Check className="absolute -top-0.5 -right-0.5 h-3 w-3 text-foreground" />
                      )}
                    </div>
                    <span>{color.nameCN}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Underline tool */}
          <Button
            variant={activeTool === 'underline' ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setActiveTool(activeTool === 'underline' ? 'select' : 'underline')}
            title="下划线 (U)"
          >
            <Underline className="h-4 w-4" style={{ color: activeTool === 'underline' ? activeColor : undefined }} />
          </Button>

          {/* Sticky Note tool */}
          <Button
            variant={activeTool === 'note' ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setActiveTool(activeTool === 'note' ? 'select' : 'note')}
            title="便签 (N)"
          >
            <StickyNote className="h-4 w-4 text-amber-500" />
          </Button>

          {/* Text tool */}
          <Button
            variant={activeTool === 'text' ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setActiveTool(activeTool === 'text' ? 'select' : 'text')}
            title="文本 (T)"
          >
            <Type className="h-4 w-4" />
          </Button>

          {/* Area selection tool */}
          <Button
            variant={activeTool === 'area' ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setActiveTool(activeTool === 'area' ? 'select' : 'area')}
            title="区域选择 (A)"
          >
            <Square className="h-4 w-4" />
          </Button>

          {/* Ink/Draw tool */}
          <Button
            variant={activeTool === 'ink' ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setActiveTool(activeTool === 'ink' ? 'select' : 'ink')}
            title="绘图 (D)"
          >
            <Pencil className="h-4 w-4" style={{ color: activeTool === 'ink' ? activeColor : undefined }} />
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
            title="缩小 (Ctrl+-)"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          
          <span className="min-w-[3.5rem] text-center text-sm tabular-nums">
            {zoomMode === 'fit-width' ? '适宽' : zoomMode === 'fit-page' ? '适页' : `${Math.round(scale * 100)}%`}
          </span>
          
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={zoomIn}
            disabled={scale >= ZOOM_MAX}
            title="放大 (Ctrl++)"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>

          {/* Fit width button (Zotero style) */}
          <Button
            variant={zoomMode === 'fit-width' ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => applyZoomMode(zoomMode === 'fit-width' ? 'manual' : 'fit-width')}
            title="适应宽度"
          >
            <FitWidthIcon className="h-4 w-4" />
          </Button>

          <div className="mx-1 h-4 w-px bg-border" />

          <PDFExportButton
            originalContent={content}
            annotations={annotations}
            fileName={fileName}
          />

          <Button
            variant={showSidebar ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setShowSidebar(!showSidebar)}
            title={showSidebar ? "隐藏批注面板" : "显示批注面板"}
          >
            {showSidebar ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Tool hint bar */}
      {activeTool !== 'select' && (
        <div className="bg-blue-50 dark:bg-blue-950 border-b border-blue-200 dark:border-blue-800 px-4 py-1 text-xs text-blue-700 dark:text-blue-300 flex items-center gap-2">
          {activeTool === 'highlight' && (
            <>
              <Highlighter className="h-3 w-3" />
              选择文本以添加高亮
            </>
          )}
          {activeTool === 'underline' && (
            <>
              <Underline className="h-3 w-3" />
              选择文本以添加下划线
            </>
          )}
          {activeTool === 'note' && (
            <>
              <StickyNote className="h-3 w-3" />
              点击任意位置添加便签
            </>
          )}
          {activeTool === 'text' && (
            <>
              <Type className="h-3 w-3" />
              点击添加文本批注
            </>
          )}
          {activeTool === 'area' && (
            <>
              <Square className="h-3 w-3" />
              拖动选择区域
            </>
          )}
          {activeTool === 'ink' && (
            <>
              <Pencil className="h-3 w-3" />
              在PDF上绘制
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

      {/* Main content area with PDF and sidebar */}
      <div className="flex flex-1 overflow-hidden">
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto bg-muted/30 relative"
          onClick={handlePdfClick}
          onMouseDown={handleInkMouseDown}
          onMouseMove={handleInkMouseMove}
          onMouseUp={handleInkMouseUp}
          onMouseLeave={handleInkMouseUp}
          style={{ 
            cursor: activeTool === 'note' ? 'crosshair' : 
                    activeTool === 'area' ? 'crosshair' :
                    activeTool === 'ink' ? 'crosshair' :
                    activeTool === 'text' ? 'text' : 'default' 
          }}
        >
        <PdfLoader
          url={pdfUrl}
          beforeLoad={
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">正在加载PDF...</span>
            </div>
          }
        >
          {(pdfDocument) => (
            <PdfHighlighter
              key={`pdf-scale-${pdfScaleValue}`}
              pdfDocument={pdfDocument}
              enableAreaSelection={(event) => event.altKey || activeTool === 'area'}
              onSelectionFinished={(
                position,
                content,
                hideTipAndSelection,
                transformSelection
              ) => {
                // Check if this is an area selection (has image but no text)
                const isAreaSelection = content.image && !content.text;
                
                // If area tool is active or this is an area selection
                if (activeTool === 'area' || isAreaSelection) {
                  const newHighlight: NewHighlight = {
                    position,
                    content,
                    comment: { text: '', emoji: '' },
                  };
                  // Create area annotation with current color
                  const annotationData = highlightToAnnotationData(newHighlight, activeColor, 'user', 'area');
                  addAnnotation(annotationData);
                  hideTipAndSelection();
                  return null;
                }
                
                // If highlight or underline tool is active, use activeColor directly
                if (activeTool === 'highlight' || activeTool === 'underline') {
                  const newHighlight: NewHighlight = {
                    position,
                    content,
                    comment: { text: '', emoji: '' },
                  };
                  const styleType = activeTool === 'underline' ? 'underline' : 'highlight';
                  const annotationData = highlightToAnnotationData(newHighlight, activeColor, 'user', styleType);
                  addAnnotation(annotationData);
                  hideTipAndSelection();
                  return null;
                }
                
                // Otherwise show color picker for text selection
                return (
                  <ColorPicker
                    selectedText={content.text}
                    onColorSelect={(color) => {
                      const newHighlight: NewHighlight = {
                        position,
                        content,
                        comment: { text: '', emoji: '' },
                      };
                      const annotationData = highlightToAnnotationData(newHighlight, color, 'user', 'highlight');
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

                // Handler for changing color
                const handleChangeColor = (color: string) => {
                  if (annotation) {
                    updateAnnotation(highlight.id, { style: { ...annotation.style, color } });
                  }
                  hideTip();
                };

                // Handler for converting highlight to underline or vice versa
                const handleConvertStyle = () => {
                  if (annotation) {
                    const newType = annotation.style.type === 'highlight' ? 'underline' : 'highlight';
                    updateAnnotation(highlight.id, { style: { ...annotation.style, type: newType } });
                    hideTip();
                  }
                };

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
                            highlightText={highlight.content?.text}
                            currentColor={annotation?.style.color}
                            styleType={annotation?.style.type as 'highlight' | 'underline' | 'area' | 'ink'}
                            onDelete={() => {
                              deleteAnnotation(highlight.id);
                              hideTip();
                            }}
                            onAddComment={(comment) => {
                              updateAnnotation(highlight.id, { comment });
                              hideTip();
                            }}
                            onChangeColor={handleChangeColor}
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
                        highlightText={highlight.content?.text}
                        currentColor={annotation?.style.color}
                        styleType={annotation?.style.type as 'highlight' | 'underline' | 'area' | 'ink'}
                        onDelete={() => {
                          deleteAnnotation(highlight.id);
                          hideTip();
                        }}
                        onAddComment={(comment) => {
                          updateAnnotation(highlight.id, { comment });
                          hideTip();
                        }}
                        onChangeColor={handleChangeColor}
                        onConvertToUnderline={handleConvertStyle}
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
                            highlightText={highlight.content?.text}
                            currentColor={annotation?.style.color}
                            styleType={annotation?.style.type as 'highlight' | 'underline' | 'area' | 'ink'}
                            onDelete={() => {
                              deleteAnnotation(highlight.id);
                              hideTip();
                            }}
                            onAddComment={(comment) => {
                              updateAnnotation(highlight.id, { comment });
                              hideTip();
                            }}
                            onChangeColor={handleChangeColor}
                            onConvertToUnderline={handleConvertStyle}
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
              pdfScaleValue={pdfScaleValue}
              onScrollChange={() => {}}
              scrollRef={() => {}}
            />
          )}
        </PdfLoader>

          {/* Ink annotations - rendered using portals to each page */}
          {inkAnnotations.map(ann => {
            if (ann.target.type !== 'pdf') return null;
            const target = ann.target as PdfTarget;
            return (
              <InkAnnotationPortal
                key={ann.id}
                annotation={ann}
                page={target.page}
                scale={scale}
              />
            );
          })}
          
          {/* Current drawing path */}
          {currentInkPage !== null && currentInkPath.length > 0 && (
            <CurrentInkPathPortal
              path={currentInkPath}
              page={currentInkPage}
              color={activeColor}
              scale={scale}
            />
          )}
        </div>

        {/* Annotation Sidebar */}
        {showSidebar && (
          <div className="w-72 border-l border-border bg-background flex-shrink-0 overflow-hidden">
            <PdfAnnotationSidebar
              annotations={annotations}
              selectedId={selectedAnnotationId}
              onSelect={handleSidebarSelect}
              onDelete={handleSidebarDelete}
              onUpdateColor={(id, color) => {
                const ann = annotations.find(a => a.id === id);
                if (ann) {
                  updateAnnotation(id, { style: { ...ann.style, color } });
                }
              }}
              onUpdateComment={(id, comment) => updateAnnotation(id, { comment })}
              onConvertToUnderline={(id) => {
                const ann = annotations.find(a => a.id === id);
                if (ann) {
                  const newType = ann.style.type === 'highlight' ? 'underline' : 'highlight';
                  updateAnnotation(id, { style: { ...ann.style, type: newType } });
                }
              }}
            />
          </div>
        )}
      </div>

      {pendingPin && (
        <PinCommentPopup
          position={{ x: pendingPin.x, y: pendingPin.y }}
          onSave={handleSavePin}
          onCancel={() => setPendingPin(null)}
        />
      )}

      {textAnnotationPosition && (
        <TextAnnotationPopup
          position={{ x: textAnnotationPosition.x, y: textAnnotationPosition.y }}
          onSave={handleSaveTextAnnotation}
          onCancel={() => setTextAnnotationPosition(null)}
        />
      )}
    </div>
  );
}

export default PDFHighlighterAdapter;
