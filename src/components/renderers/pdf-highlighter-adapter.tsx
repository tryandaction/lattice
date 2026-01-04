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
import { HIGHLIGHT_COLORS, BACKGROUND_COLORS, TEXT_COLORS, TEXT_FONT_SIZES, DEFAULT_TEXT_STYLE } from "@/lib/annotation-colors";
import { PDFExportButton } from "./pdf-export-button";
import { PdfAnnotationSidebar } from "./pdf-annotation-sidebar";
import { adjustPopupPosition, type PopupSize } from "@/lib/coordinate-adapter";
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
// Custom Highlight Component (supports colors and underline)
// ============================================================================

// Position type from react-pdf-highlighter (viewport coordinates)
interface ViewportPosition {
  boundingRect: { left: number; top: number; width: number; height: number; pageNumber?: number };
  rects: Array<{ left: number; top: number; width: number; height: number; pageNumber?: number }>;
  pageNumber: number;
}

interface CustomHighlightProps {
  position: ViewportPosition;
  isScrolledTo: boolean;
  color: string;
  styleType: 'highlight' | 'underline' | 'area';
  onClick?: () => void;
}

/**
 * Custom highlight component that supports:
 * - Custom colors (not just default yellow)
 * - Underline style (renders as underline instead of background)
 * - Area selection (renders as border box)
 * 
 * Note: react-pdf-highlighter passes position.rects with LTWHP format
 * (left, top, width, height, pageNumber) for viewport coordinates
 */
function CustomHighlight({ position, isScrolledTo, color, styleType, onClick }: CustomHighlightProps) {
  // The rects from react-pdf-highlighter are in viewport coordinates (LTWHP format)
  const rects = position.rects;
  
  // Calculate opacity based on scroll state
  const opacity = isScrolledTo ? 1 : 0.8;
  
  // Check if color is transparent
  const isTransparent = !color || color === 'transparent';
  
  return (
    <div className="Highlight" onClick={onClick}>
      <div className="Highlight__parts">
        {rects.map((rect, index) => {
          // Common styles for positioning
          const baseStyle: React.CSSProperties = {
            position: 'absolute',
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          };
          
          if (styleType === 'underline') {
            // Underline style: transparent background with colored bottom border
            const borderColor = isTransparent ? '#666666' : color;
            return (
              <div
                key={index}
                className="Highlight__part"
                style={{
                  ...baseStyle,
                  backgroundColor: 'transparent',
                  borderBottom: `2px solid ${borderColor}`,
                  opacity,
                  transition: 'opacity 0.2s ease-in-out',
                }}
              />
            );
          } else if (styleType === 'area') {
            // Area style: border box with light fill
            const areaColor = isTransparent ? '#666666' : color;
            return (
              <div
                key={index}
                className="Highlight__part"
                style={{
                  ...baseStyle,
                  backgroundColor: isTransparent ? 'transparent' : `${areaColor}20`,
                  border: `2px solid ${areaColor}`,
                  opacity,
                  transition: 'opacity 0.2s ease-in-out',
                }}
              />
            );
          } else {
            // Highlight style: colored background (or transparent with dashed border)
            if (isTransparent) {
              return (
                <div
                  key={index}
                  className="Highlight__part"
                  style={{
                    ...baseStyle,
                    backgroundColor: 'transparent',
                    border: '1px dashed #999999',
                    opacity,
                    transition: 'opacity 0.2s ease-in-out',
                  }}
                />
              );
            }
            return (
              <div
                key={index}
                className="Highlight__part"
                style={{
                  ...baseStyle,
                  backgroundColor: color,
                  opacity: opacity * 0.4, // Highlights should be semi-transparent
                  transition: 'opacity 0.2s ease-in-out',
                }}
              />
            );
          }
        })}
      </div>
      
      {/* Scroll indicator */}
      {isScrolledTo && rects.length > 0 && (
        <div
          className="Highlight__scroll-indicator"
          style={{
            position: 'absolute',
            left: rects[0].left,
            top: rects[0].top - 4,
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: color,
            animation: 'pulse 1s ease-in-out infinite',
          }}
        />
      )}
    </div>
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
        {/* Transparent option */}
        <button
          onClick={() => {
            onChangeColor('transparent');
            setShowColorPicker(false);
          }}
          className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2 text-sm"
        >
          <div className="relative">
            <div 
              className="w-4 h-4 rounded-sm border border-black/10"
              style={{ 
                backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
                backgroundSize: '4px 4px',
                backgroundPosition: '0 0, 0 2px, 2px -2px, -2px 0px'
              }}
            />
            {currentColor === 'transparent' && (
              <Check className="absolute -top-0.5 -right-0.5 h-3 w-3 text-foreground" />
            )}
          </div>
          <span>无背景</span>
        </button>
        <div className="h-px bg-border mx-2 my-1" />
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
          <div 
            className="truncate max-w-[200px]" 
            style={{ 
              backgroundColor: currentColor && currentColor !== 'transparent' ? `${currentColor}40` : 'transparent',
              border: currentColor === 'transparent' ? '1px dashed var(--border)' : 'none',
              padding: '2px 4px',
              borderRadius: '2px',
            }}
          >
            "{highlightText.slice(0, 50)}{highlightText.length > 50 ? '...' : ''}"
          </div>
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
            style={{ 
              backgroundColor: currentColor && currentColor !== 'transparent' ? currentColor : 'transparent',
              backgroundImage: currentColor === 'transparent' ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)' : 'none',
              backgroundSize: '4px 4px',
              backgroundPosition: '0 0, 0 2px, 2px -2px, -2px 0px'
            }}
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
  
  // Use coordinate adapter to adjust popup position
  const popupSize: PopupSize = { width: 280, height: 180 };
  const adjustedPosition = adjustPopupPosition(position, popupSize, 10);

  return (
    <div
      className="fixed bg-popover border border-border rounded-lg shadow-xl p-3 z-50 min-w-[280px]"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
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
  onSave: (text: string, textColor: string, fontSize: number, bgColor: string) => void;
  onCancel: () => void;
  initialColor?: string;
  initialText?: string;
  initialTextColor?: string;
  initialFontSize?: number;
}

/**
 * Zotero-style text annotation popup with color and size options
 */
function TextAnnotationPopup({ position, onSave, onCancel, initialColor, initialText, initialTextColor, initialFontSize }: TextAnnotationPopupProps) {
  const [text, setText] = useState(initialText || "");
  const [textColor, setTextColor] = useState<string>(initialTextColor || DEFAULT_TEXT_STYLE.textColor);
  const [fontSize, setFontSize] = useState<number>(initialFontSize || DEFAULT_TEXT_STYLE.fontSize);
  const [bgColor, setBgColor] = useState(initialColor || 'transparent');
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);
  const [showBgColorPicker, setShowBgColorPicker] = useState(false);
  const [showSizePicker, setShowSizePicker] = useState(false);
  
  // Use coordinate adapter to adjust popup position
  const popupSize: PopupSize = { width: 320, height: 280 };
  const adjustedPosition = adjustPopupPosition(position, popupSize, 10);

  return (
    <div
      className="fixed bg-popover border border-border rounded-lg shadow-xl p-3 z-50 min-w-[320px]"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Type className="h-4 w-4" />
        <span className="text-sm font-medium">{initialText ? '编辑文本' : '添加文本'}</span>
      </div>
      
      {/* Style options row */}
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
        {/* Text color picker */}
        <div className="relative">
          <button
            onClick={() => {
              setShowTextColorPicker(!showTextColorPicker);
              setShowBgColorPicker(false);
              setShowSizePicker(false);
            }}
            className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded hover:bg-muted"
            title="文字颜色"
          >
            <span className="w-3 h-3 rounded-sm border border-black/20" style={{ backgroundColor: textColor }} />
            <span>文字</span>
            <ChevronDown className="h-3 w-3" />
          </button>
          {showTextColorPicker && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[120px]">
              {TEXT_COLORS.map((color) => (
                <button
                  key={color.value}
                  onClick={() => {
                    setTextColor(color.hex);
                    setShowTextColorPicker(false);
                  }}
                  className="w-full px-2 py-1 text-left hover:bg-muted flex items-center gap-2 text-xs"
                >
                  <div className="relative">
                    <div 
                      className="w-3 h-3 rounded-sm border border-black/20"
                      style={{ backgroundColor: color.hex }}
                    />
                    {textColor === color.hex && (
                      <Check className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 text-foreground" />
                    )}
                  </div>
                  <span>{color.nameCN}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Background color picker */}
        <div className="relative">
          <button
            onClick={() => {
              setShowBgColorPicker(!showBgColorPicker);
              setShowTextColorPicker(false);
              setShowSizePicker(false);
            }}
            className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded hover:bg-muted"
            title="背景颜色"
          >
            <span 
              className="w-3 h-3 rounded-sm border border-black/20" 
              style={{ 
                backgroundColor: bgColor === 'transparent' ? 'transparent' : bgColor,
                backgroundImage: bgColor === 'transparent' ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)' : 'none',
                backgroundSize: '4px 4px',
                backgroundPosition: '0 0, 0 2px, 2px -2px, -2px 0px'
              }} 
            />
            <span>背景</span>
            <ChevronDown className="h-3 w-3" />
          </button>
          {showBgColorPicker && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[120px]">
              {BACKGROUND_COLORS.map((color) => (
                <button
                  key={color.value}
                  onClick={() => {
                    setBgColor(color.hex);
                    setShowBgColorPicker(false);
                  }}
                  className="w-full px-2 py-1 text-left hover:bg-muted flex items-center gap-2 text-xs"
                >
                  <div className="relative">
                    <div 
                      className="w-3 h-3 rounded-sm border border-black/20"
                      style={{ 
                        backgroundColor: color.hex === 'transparent' ? 'transparent' : color.hex,
                        backgroundImage: color.hex === 'transparent' ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)' : 'none',
                        backgroundSize: '4px 4px',
                        backgroundPosition: '0 0, 0 2px, 2px -2px, -2px 0px'
                      }}
                    />
                    {bgColor === color.hex && (
                      <Check className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 text-foreground" />
                    )}
                  </div>
                  <span>{color.nameCN}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Font size picker */}
        <div className="relative">
          <button
            onClick={() => {
              setShowSizePicker(!showSizePicker);
              setShowTextColorPicker(false);
              setShowBgColorPicker(false);
            }}
            className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded hover:bg-muted"
            title="字体大小"
          >
            <span>{fontSize}px</span>
            <ChevronDown className="h-3 w-3" />
          </button>
          {showSizePicker && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[80px]">
              {TEXT_FONT_SIZES.map((size) => (
                <button
                  key={size.value}
                  onClick={() => {
                    setFontSize(size.value);
                    setShowSizePicker(false);
                  }}
                  className="w-full px-2 py-1 text-left hover:bg-muted flex items-center gap-2 text-xs"
                >
                  {fontSize === size.value && <Check className="h-2.5 w-2.5" />}
                  <span className={fontSize !== size.value ? 'ml-4' : ''}>{size.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Preview */}
      <div 
        className="mb-2 p-2 rounded border border-dashed border-border min-h-[40px] flex items-center"
        style={{ 
          backgroundColor: bgColor === 'transparent' ? 'transparent' : `${bgColor}40`,
        }}
      >
        <span 
          style={{ 
            color: textColor, 
            fontSize: `${fontSize}px`,
            lineHeight: 1.4
          }}
        >
          {text || '预览文字...'}
        </span>
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
        <Button size="sm" onClick={() => onSave(text, textColor, fontSize, bgColor)} disabled={!text.trim()}>
          {initialText ? '保存' : '添加'}
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

/**
 * Text annotation overlay component - renders text directly on PDF page
 */
interface TextAnnotationOverlayProps {
  annotation: AnnotationItem;
  scale: number;
  onClick?: () => void;
  isHighlighted?: boolean;
}

function TextAnnotationOverlay({ annotation, scale, onClick, isHighlighted }: TextAnnotationOverlayProps) {
  if (annotation.style.type !== 'text' || annotation.target.type !== 'pdf') {
    return null;
  }

  const target = annotation.target as PdfTarget;
  if (target.rects.length === 0) return null;

  const rect = target.rects[0];
  const textStyle = annotation.style.textStyle || { textColor: '#000000', fontSize: 14 };
  const bgColor = annotation.style.color;
  const hasBackground = bgColor && bgColor !== 'transparent';

  return (
    <div
      className={`absolute cursor-pointer transition-all hover:ring-2 hover:ring-blue-400/50 ${isHighlighted ? 'ring-2 ring-primary ring-offset-1 animate-pulse' : ''}`}
      style={{
        left: `${rect.x1 * 100}%`,
        top: `${rect.y1 * 100}%`,
        backgroundColor: hasBackground ? `${bgColor}85` : 'rgba(255, 255, 255, 0.9)',
        padding: `${4 * scale}px ${6 * scale}px`,
        borderRadius: `${2 * scale}px`,
        border: hasBackground ? '1px solid rgba(0,0,0,0.1)' : '1px solid rgba(0,0,0,0.2)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        maxWidth: '50%',
        zIndex: 15,
        pointerEvents: 'auto',
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      title="点击编辑文字批注"
    >
      <span
        style={{
          color: textStyle.textColor || '#000000',
          fontSize: `${(textStyle.fontSize || 14) * scale}px`,
          lineHeight: 1.4,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontWeight: textStyle.fontWeight || 'normal',
          fontStyle: textStyle.fontStyle || 'normal',
        }}
      >
        {annotation.content}
      </span>
    </div>
  );
}

/**
 * Portal component to render text annotation on the correct page
 */
interface TextAnnotationPortalProps {
  annotation: AnnotationItem;
  page: number;
  scale: number;
  onClick?: () => void;
  isHighlighted?: boolean;
}

function TextAnnotationPortal({ annotation, page, scale, onClick, isHighlighted }: TextAnnotationPortalProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const pageElement = document.querySelector(`[data-page-number="${page}"]`) as HTMLElement;
    if (!pageElement) return;

    // Ensure the page element has relative positioning
    const computedStyle = window.getComputedStyle(pageElement);
    if (computedStyle.position === 'static') {
      pageElement.style.position = 'relative';
    }

    let overlay = pageElement.querySelector(`.text-overlay-${annotation.id}`) as HTMLElement;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = `text-overlay-${annotation.id}`;
      overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:15;';
      pageElement.appendChild(overlay);
    }
    
    // Enable pointer events for the text annotation
    overlay.style.pointerEvents = 'auto';
    
    setContainer(overlay);

    return () => {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    };
  }, [page, annotation.id]);

  if (!container) return null;

  return ReactDOM.createPortal(
    <TextAnnotationOverlay 
      annotation={annotation} 
      scale={scale} 
      onClick={onClick}
      isHighlighted={isHighlighted}
    />,
    container
  );
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
  const [editingTextAnnotation, setEditingTextAnnotation] = useState<{ annotation: AnnotationItem; position: { x: number; y: number } } | null>(null);
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
      .filter(a => a.style.type !== 'ink' && a.style.type !== 'text') // Ink and text annotations are rendered separately
      .map(a => annotationToHighlight(a, pdfPageDimensions))
      .filter((h): h is IHighlight => h !== null);
  }, [annotations, pdfPageDimensions]);

  // Get ink annotations for custom rendering
  const inkAnnotations = useMemo(() => {
    return annotations.filter(a => a.style.type === 'ink');
  }, [annotations]);

  // Get text annotations for custom rendering
  const textAnnotations = useMemo(() => {
    return annotations.filter(a => a.style.type === 'text');
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
  const handleSaveTextAnnotation = useCallback((text: string, textColor: string, fontSize: number, bgColor: string) => {
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
          x2: Math.min(1, x + 0.15),
          y2: Math.min(1, y + 0.03),
        }],
      } as PdfTarget,
      style: {
        color: bgColor,
        type: 'text' as any, // Use 'text' type for text annotations
        textStyle: {
          textColor,
          fontSize,
        },
      },
      content: text,
      author: 'user',
    };

    addAnnotation(textAnnotation);
    setTextAnnotationPosition(null);
  }, [textAnnotationPosition, addAnnotation]);

  // Handle editing existing text annotation
  const handleUpdateTextAnnotation = useCallback((text: string, textColor: string, fontSize: number, bgColor: string) => {
    if (!editingTextAnnotation) return;

    updateAnnotation(editingTextAnnotation.annotation.id, {
      content: text,
      style: {
        color: bgColor,
        type: 'text' as any,
        textStyle: {
          textColor,
          fontSize,
        },
      },
    });

    setEditingTextAnnotation(null);
  }, [editingTextAnnotation, updateAnnotation]);

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

                // Handler for changing color - only pass the color field
                const handleChangeColor = (color: string) => {
                  if (annotation) {
                    updateAnnotation(highlight.id, { style: { color } });
                  }
                  hideTip();
                };

                // Handler for converting highlight to underline or vice versa
                const handleConvertStyle = () => {
                  if (annotation) {
                    const newType = annotation.style.type === 'highlight' ? 'underline' : 'highlight';
                    updateAnnotation(highlight.id, { style: { type: newType } });
                    hideTip();
                  }
                };

                if (isPin) {
                  const position = highlight.position;
                  const pinComment = annotation?.comment || highlight.comment?.text;
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
                      <div className="flex flex-col items-center">
                        <StickyNote
                          className="h-5 w-5 text-amber-500 drop-shadow-md"
                          fill="currentColor"
                        />
                        {/* Display pin comment text below the icon */}
                        {pinComment && (
                          <div 
                            className="mt-1 px-2 py-1 bg-amber-100 dark:bg-amber-900/80 border border-amber-300 dark:border-amber-700 rounded shadow-sm text-xs text-amber-900 dark:text-amber-100 max-w-[150px] whitespace-pre-wrap break-words"
                            style={{ transform: 'translateX(50%)' }}
                          >
                            {pinComment}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                // Get the style type and color from annotation
                const highlightColor = annotation?.style.color || '#FFD400';
                const highlightStyleType = (annotation?.style.type || 'highlight') as 'highlight' | 'underline' | 'area';

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
                      <CustomHighlight
                        isScrolledTo={isScrolledTo || isHighlighted}
                        position={highlight.position}
                        color={highlightColor}
                        styleType={highlightStyleType}
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

          {/* Text annotations - rendered using portals to each page */}
          {textAnnotations.map(ann => {
            if (ann.target.type !== 'pdf') return null;
            const target = ann.target as PdfTarget;
            return (
              <TextAnnotationPortal
                key={ann.id}
                annotation={ann}
                page={target.page}
                scale={scale}
                isHighlighted={highlightedId === ann.id}
                onClick={() => {
                  // Open text annotation editor
                  const pageElement = document.querySelector(`[data-page-number="${target.page}"]`);
                  if (pageElement && target.rects.length > 0) {
                    const pageRect = pageElement.getBoundingClientRect();
                    const rect = target.rects[0];
                    
                    // Calculate position for editor popup (center of annotation)
                    const x = pageRect.left + ((rect.x1 + rect.x2) / 2 * pageRect.width);
                    const y = pageRect.top + (rect.y1 * pageRect.height);
                    
                    setEditingTextAnnotation({
                      annotation: ann,
                      position: { x, y }
                    });
                    setSelectedAnnotationId(ann.id);
                  }
                }}
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
                updateAnnotation(id, { style: { color } });
              }}
              onUpdateComment={(id, comment) => updateAnnotation(id, { comment })}
              onConvertToUnderline={(id) => {
                const ann = annotations.find(a => a.id === id);
                if (ann) {
                  const newType = ann.style.type === 'highlight' ? 'underline' : 'highlight';
                  updateAnnotation(id, { style: { type: newType } });
                }
              }}
              onUpdateTextStyle={(id, textColor, fontSize, bgColor) => {
                updateAnnotation(id, { 
                  style: { 
                    color: bgColor,
                    textStyle: { textColor, fontSize }
                  } 
                });
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
          initialColor={activeColor}
        />
      )}

      {editingTextAnnotation && (
        <TextAnnotationPopup
          position={{ x: editingTextAnnotation.position.x, y: editingTextAnnotation.position.y }}
          onSave={handleUpdateTextAnnotation}
          onCancel={() => setEditingTextAnnotation(null)}
          initialColor={editingTextAnnotation.annotation.style.color}
          initialText={editingTextAnnotation.annotation.content}
          initialTextColor={editingTextAnnotation.annotation.style.textStyle?.textColor}
          initialFontSize={editingTextAnnotation.annotation.style.textStyle?.fontSize}
        />
      )}
    </div>
  );
}

export default PDFHighlighterAdapter;
