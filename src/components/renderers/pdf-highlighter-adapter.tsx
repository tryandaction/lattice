"use client";

/**
 * PDF Highlighter Adapter
 * 
 * Integrates react-pdf-highlighter with the Universal Annotation Manager.
 * Provides text selection highlighting and Pin Mode for sticky notes.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import ReactDOM from "react-dom";
import { usePathname } from "next/navigation";
import {
  PdfLoader,
  PdfHighlighter,
  Popup,
} from "react-pdf-highlighter";
import type { 
  IHighlight, 
  NewHighlight, 
  Content as PdfHighlightContent,
  ScaledPosition as PdfHighlighterScaledPosition,
} from "react-pdf-highlighter";
import {
  Loader2,
  StickyNote,
  MessageSquare,
  X,
  Check,
  Highlighter,
  Underline,
  Type,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnnotationSystem } from "@/hooks/use-annotation-system";
import { useAnnotationNavigation } from "@/hooks/use-annotation-navigation";
import { useInkAnnotation, type MergedInkAnnotation, type InkStroke } from "@/hooks/use-ink-annotation";
import { HIGHLIGHT_COLORS, BACKGROUND_COLORS, TEXT_COLORS, TEXT_FONT_SIZES, DEFAULT_TEXT_STYLE } from "@/lib/annotation-colors";
import { exportPdfWithAnnotations } from "./pdf-export-button";
import { PdfAnnotationSidebar } from "./pdf-annotation-sidebar";
import { PdfItemWorkspacePanel } from "./pdf-item-workspace-panel";
import { InkSessionIndicator } from "./ink-session-indicator";
import { adjustPopupPosition, type PopupSize } from "@/lib/coordinate-adapter";
import type { AnnotationItem, PdfTarget } from "@/types/universal-annotation";
import { useInkAnnotationStore } from "@/stores/ink-annotation-store";
import { SelectionContextMenu } from "@/components/ai/selection-context-menu";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";
import type { CommandBarState, PaneId } from "@/types/layout";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import { isSameWorkspacePath } from "@/lib/link-router/path-utils";
import { createSelectionContext, type SelectionAiMode, type SelectionContext } from "@/lib/ai/selection-context";
import { useSelectionContextMenu } from "@/hooks/use-selection-context-menu";
import type { EvidenceAnchorRect } from "@/lib/ai/types";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useObjectUrl } from "@/hooks/use-object-url";
import { useFileSystem } from "@/hooks/use-file-system";
import { useI18n } from "@/hooks/use-i18n";
import { usePaneCommandBar } from "@/hooks/use-pane-command-bar";
import {
  ensurePdfItemWorkspace,
  loadPdfItemManifest,
  syncPdfAnnotationsMarkdown,
  type PdfItemManifest,
} from "@/lib/pdf-item";
import { generateFileId } from "@/lib/universal-annotation-storage";
import {
  buildBacklinkNavigationTarget,
  getBacklinksForAnnotation,
  scanWorkspaceMarkdownBacklinks,
  type AnnotationBacklink,
} from "@/lib/annotation-backlinks";
import { navigateLink } from "@/lib/link-router/navigate-link";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { copyToClipboard } from "@/lib/clipboard";
import {
  buildPdfEditorState,
  capturePdfViewAnchor,
  clearScopedPdfPaneId,
  comparePdfViewAnchor,
  captureRelativeScrollPosition,
  clampPdfScale,
  DEFAULT_PDF_VIEWPORT_ANCHOR,
  findPrimaryVisiblePdfPage,
  getPdfWheelZoomDelta,
  isPdfInteractionActive,
  readCachedPdfViewState,
  resolvePdfAnchorScrollTarget,
  restoreRelativeScrollPosition,
  setScopedPdfPaneId,
  type PdfViewAnchor,
  type PdfAnchorComparison,
  type PdfVisiblePageCandidate,
  type PdfZoomMode,
} from "@/lib/pdf-view-state";
import {
  beginPdfSelectionSession,
  buildPdfAreaPreview,
  createIdlePdfSelectionSession,
  createPdfSelectionSnapshot,
  buildPdfSelectionSignature,
  isDuplicatePdfSelection,
  projectPdfSelectionRectsToPages,
  projectPdfScaledSelectionToViewportRects,
  resolvePdfCopySelectionText,
  type PdfSelectionSnapshot,
  type PdfSelectionSessionState,
  type PdfTransientSelectionRect,
  updatePdfSelectionSession,
} from "@/lib/pdf-selection-session";
import { buildPersistedFileViewStateKey, loadPersistedFileViewState, savePersistedFileViewState } from "@/lib/file-view-state";
import {
  annotationToHighlight as mapPdfAnnotationToHighlight,
  createPinAnnotation as createPdfPinAnnotation,
  isPinAnnotation,
  selectionToAnnotation,
  type PdfPageDimensionsMap,
} from "@/lib/pdf-highlight-mapping";

import "react-pdf-highlighter/dist/style.css";
import "./pdf-highlighter-adapter.css";

// ============================================================================
// Types
// ============================================================================

interface PDFHighlighterAdapterProps {
  content: ArrayBuffer;
  fileName: string;
  fileHandle: FileSystemFileHandle;
  rootHandle: FileSystemDirectoryHandle;
  paneId: PaneId;
  fileId: string;
  filePath: string;
}

interface PdfRestoreDebugState {
  status: 'idle' | 'restoring' | 'restored' | 'fallback';
  ok: boolean;
  expectedPage: number | null;
  actualPage: number | null;
  deltaTopRatio: number | null;
  deltaLeftRatio: number | null;
  captureRevision: number | null;
}

function createIdleRestoreDebugState(): PdfRestoreDebugState {
  return {
    status: 'idle',
    ok: true,
    expectedPage: null,
    actualPage: null,
    deltaTopRatio: null,
    deltaLeftRatio: null,
    captureRevision: null,
  };
}

function buildVisiblePageCandidates(pages: HTMLElement[]): PdfVisiblePageCandidate[] {
  const candidates: PdfVisiblePageCandidate[] = [];

  pages.forEach((page) => {
    const pageNumber = Number(page.dataset.pageNumber ?? '');
    const rect = page.getBoundingClientRect();
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || rect.width <= 0 || rect.height <= 0) {
      return;
    }

    candidates.push({
      pageNumber,
      rect,
    });
  });

  return candidates;
}

function getScrollContainerOverflowScore(element: HTMLElement | null | undefined): number {
  if (!(element instanceof HTMLElement)) {
    return -1;
  }

  return (element.scrollHeight - element.clientHeight) + (element.scrollWidth - element.clientWidth);
}

function hasMeaningfulScrollOverflow(element: HTMLElement | null | undefined): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  return (
    (element.scrollHeight - element.clientHeight) > MIN_SCROLL_OVERFLOW_PX ||
    (element.scrollWidth - element.clientWidth) > MIN_SCROLL_OVERFLOW_PX
  );
}

function compareAnchorPair(
  expected: PdfViewAnchor | null | undefined,
  actual: PdfViewAnchor | null | undefined,
): PdfAnchorComparison {
  return comparePdfViewAnchor(expected, actual);
}

function buildPdfSelectionRects(range: Range | undefined, pageElement: HTMLElement | null): EvidenceAnchorRect[] | undefined {
  if (!range || !pageElement) {
    return undefined;
  }

  const pageRect = pageElement.getBoundingClientRect();
  if (pageRect.width <= 0 || pageRect.height <= 0) {
    return undefined;
  }

  const rects = Array.from(range.getClientRects())
    .map((rect) => {
      const left = (rect.left - pageRect.left) / pageRect.width;
      const top = (rect.top - pageRect.top) / pageRect.height;
      const width = rect.width / pageRect.width;
      const height = rect.height / pageRect.height;
      return {
        left: Math.max(0, Math.min(1, left)),
        top: Math.max(0, Math.min(1, top)),
        width: Math.max(0, Math.min(1, width)),
        height: Math.max(0, Math.min(1, height)),
      };
    })
    .filter((rect) => rect.width > 0 && rect.height > 0);

  return rects.length > 0 ? rects : undefined;
}

function buildPdfSelectionRectsFromSnapshot(
  snapshot: PdfSelectionSnapshot | null | undefined,
  scopeRoot: ParentNode | null | undefined,
): { pageNumber: number | undefined; rects: EvidenceAnchorRect[] | undefined } {
  if (!snapshot) {
    return { pageNumber: undefined, rects: undefined };
  }

  const pageNumber = snapshot.pageNumbers[0];
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return { pageNumber: undefined, rects: undefined };
  }

  const pageElement = findPdfPageElementInScope(scopeRoot, pageNumber);
  if (!pageElement) {
    return { pageNumber, rects: undefined };
  }

  const pageRect = pageElement.getBoundingClientRect();
  if (pageRect.width <= 0 || pageRect.height <= 0) {
    return { pageNumber, rects: undefined };
  }

  const rects = (snapshot.overlayRectsByPage[pageNumber] ?? [])
    .map((rect) => ({
      left: Math.max(0, Math.min(1, rect.left / pageRect.width)),
      top: Math.max(0, Math.min(1, rect.top / pageRect.height)),
      width: Math.max(0, Math.min(1, rect.width / pageRect.width)),
      height: Math.max(0, Math.min(1, rect.height / pageRect.height)),
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0);

  return {
    pageNumber,
    rects: rects.length > 0 ? rects : undefined,
  };
}

function buildPdfSelectionMenuSnapshot(
  snapshot: PdfSelectionSnapshot | null | undefined,
  scopeRoot: ParentNode | null | undefined,
): Partial<import("@/hooks/use-selection-context-menu").SelectionSnapshot> | null {
  if (!snapshot) {
    return null;
  }

  const pageNumber = snapshot.pageNumbers[0];
  const pageElement = Number.isInteger(pageNumber) && pageNumber > 0
    ? findPdfPageElementInScope(scopeRoot, pageNumber)
    : null;
  const firstRect = pageNumber ? snapshot.overlayRectsByPage[pageNumber]?.[0] : undefined;

  let boundingRect: DOMRect | undefined;
  if (pageElement && firstRect) {
    const pageRect = pageElement.getBoundingClientRect();
    boundingRect = new DOMRect(
      pageRect.left + firstRect.left,
      pageRect.top + firstRect.top,
      firstRect.width,
      firstRect.height,
    );
  }

  return {
    text: snapshot.text,
    eventTarget: pageElement,
    boundingRect,
  };
}

function findPdfPageElementInScope(
  scopeRoot: ParentNode | null | undefined,
  pageNumber: number,
): HTMLElement | null {
  if (!scopeRoot || !Number.isInteger(pageNumber) || pageNumber < 1) {
    return null;
  }

  return scopeRoot.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`);
}

function buildPdfTransientSelectionRectsFromRange(
  range: Range | undefined,
  scopeRoot: ParentNode | null | undefined,
): PdfTransientSelectionRect[] | undefined {
  if (!range) {
    return undefined;
  }

  const pages = Array.from(scopeRoot?.querySelectorAll<HTMLElement>("[data-page-number]") ?? []);
  if (pages.length === 0) {
    return undefined;
  }

  const rects = projectPdfSelectionRectsToPages({
    clientRects: Array.from(range.getClientRects()).map((rect) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    })),
    pages: pages.map((pageElement) => {
      const pageRect = pageElement.getBoundingClientRect();
      return {
        pageNumber: Number(pageElement.dataset.pageNumber ?? ""),
        left: pageRect.left,
        top: pageRect.top,
        width: pageRect.width,
        height: pageRect.height,
      };
    }),
  });

  if (rects.length === 0) {
    return undefined;
  }

  return rects;
}

// Annotation tool types (Zotero-style)
type AnnotationTool = 'select' | 'highlight' | 'underline' | 'note' | 'text' | 'area' | 'ink';
const MIN_INK_POINT_DELTA_SQUARED = 0.000004;
const MIN_SCROLL_OVERFLOW_PX = 24;

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
  isActive?: boolean;
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
function CustomHighlight({ position, isScrolledTo, color, styleType, isActive = false, onClick }: CustomHighlightProps) {
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
                  left: rect.left - 6,
                  top: rect.top - 6,
                  width: rect.width + 12,
                  height: rect.height + 12,
                  backgroundColor: isTransparent ? 'transparent' : `${areaColor}${isActive ? '24' : '18'}`,
                  border: `${isActive ? 3 : 2}px solid ${areaColor}`,
                  boxShadow: isActive ? `0 0 0 2px ${areaColor}33` : 'none',
                  borderRadius: 6,
                  opacity,
                  transition: 'opacity 0.2s ease-in-out',
                  pointerEvents: 'auto',
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
  return mapPdfAnnotationToHighlight(annotation, pdfPageDimensions as PdfPageDimensionsMap | undefined) as IHighlight | null;
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
  const baseAnnotation = selectionToAnnotation({
    content: highlight.content,
    position: highlight.position,
    scaledPosition: highlight.position,
  }, color, author, styleType);

  return {
    ...baseAnnotation,
    comment: highlight.comment?.text || undefined,
    preview: styleType === 'area'
      ? buildPdfAreaPreview({
          dataUrl: highlight.content.image,
          width: highlight.position.boundingRect.width || 0,
          height: highlight.position.boundingRect.height || 0,
        })
      : undefined,
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
  return createPdfPinAnnotation(page, x, y, comment, author);
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
  const { t } = useI18n();
  return (
    <div className="pdf-selection-color-picker bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[160px] text-sm">
      {/* Selected text preview */}
      {selectedText && (
        <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border truncate max-w-[200px]">
          &ldquo;{selectedText.slice(0, 40)}{selectedText.length > 40 ? '...' : ''}&rdquo;
        </div>
      )}
      
      {/* Add note option */}
      {onAddNote && (
        <button
          onClick={onAddNote}
          className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2"
        >
          <StickyNote className="h-4 w-4 text-amber-500" />
          <span>{t("pdf.note.add")}</span>
        </button>
      )}
      
      {/* Add comment option */}
      {onAddComment && (
        <button
          onClick={onAddComment}
          className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2"
        >
          <MessageSquare className="h-4 w-4" />
          <span>{t("pdf.comment.add")}</span>
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
        {t("common.cancel")}
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
  const { t } = useI18n();
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
        <div className="text-xs font-medium mb-2 text-muted-foreground">{t("pdf.comment.add")}</div>
        <textarea
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder={t("pdf.comment.placeholder")}
          className="w-full p-2 text-sm border border-border rounded bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          rows={3}
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-2">
          <Button size="sm" variant="ghost" onClick={() => setShowCommentInput(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={handleSaveComment}>
            {t("common.save")}
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
          {t("pdf.color.change")}
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
          <span>{t("pdf.noBackground")}</span>
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
          {t("pdf.back")}
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
            &ldquo;{highlightText.slice(0, 50)}{highlightText.length > 50 ? '...' : ''}&rdquo;
          </div>
        </div>
      )}
      
      {/* Add/Edit comment */}
      <button
        onClick={() => setShowCommentInput(true)}
        className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2"
      >
        <MessageSquare className="h-4 w-4" />
        <span>{comment.text ? t("pdf.comment.edit") : t("pdf.comment.add")}</span>
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
          <span>{t("pdf.color.change")}</span>
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
          <span>{t("pdf.convert.underline")}</span>
        </button>
      )}
      
      {/* Convert to highlight (only for underlines) */}
      {styleType === 'underline' && onConvertToUnderline && (
        <button
          onClick={onConvertToUnderline}
          className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2"
        >
          <Highlighter className="h-4 w-4" />
          <span>{t("pdf.convert.highlight")}</span>
        </button>
      )}
      
      <div className="border-t border-border my-1" />
      
      {/* Delete */}
      <button
        onClick={onDelete}
        className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2 text-destructive"
      >
        <X className="h-4 w-4" />
        <span>{t("pdf.delete")}</span>
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
  const { t } = useI18n();
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
        <span className="text-sm font-medium">{t("pdf.note.add")}</span>
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t("pdf.note.placeholder")}
        className="w-full p-2 text-sm border border-border rounded bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
        rows={4}
        autoFocus
      />
      <div className="flex justify-end gap-2 mt-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" onClick={() => onSave(comment)}>
          {t("common.save")}
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
  const { t } = useI18n();
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
        <span className="text-sm font-medium">{initialText ? t("pdf.text.edit") : t("pdf.text.add")}</span>
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
            title={t("pdf.textColor")}
          >
            <span className="w-3 h-3 rounded-sm border border-black/20" style={{ backgroundColor: textColor }} />
            <span>{t("pdf.textColor")}</span>
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
            title={t("pdf.backgroundColor")}
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
            <span>{t("pdf.backgroundColor")}</span>
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
            title={t("pdf.fontSize")}
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
          {text || `${t("pdf.text.add")}...`}
        </span>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("pdf.text.placeholder")}
        className="w-full p-2 text-sm border border-border rounded bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
        rows={3}
        autoFocus
      />
      <div className="flex justify-end gap-2 mt-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" onClick={() => onSave(text, textColor, fontSize, bgColor)} disabled={!text.trim()}>
          {initialText ? t("common.save") : t("pdf.text.add")}
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
  const { t } = useI18n();
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
      title={t("pdf.text.editTitle")}
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
  paneRootRef: React.RefObject<HTMLElement | null>;
  onClick?: () => void;
  isHighlighted?: boolean;
}

function TextAnnotationPortal({ annotation, page, scale, paneRootRef, onClick, isHighlighted }: TextAnnotationPortalProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const pageElement = findPdfPageElementInScope(paneRootRef.current, page);
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
  }, [annotation.id, page, paneRootRef]);

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

  let paths: { x: number; y: number }[][] | null = null;
  try {
    const content = JSON.parse(annotation.content || '[]');

    if (Array.isArray(content) && content.length > 0) {
      // Check if it's the old format (array of points) or new format (array of arrays)
      if (typeof content[0].x === 'number') {
        // Old format: single path
        paths = [content as { x: number; y: number }[]];
      } else if (Array.isArray(content[0])) {
        // New format: array of paths
        paths = content as { x: number; y: number }[][];
      }
    }
  } catch {
    return null;
  }

  if (!paths || paths.length === 0) return null;

  // Filter out paths with less than 2 points
  const validPaths = paths.filter(path => path.length >= 2);
  if (validPaths.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%' }}
    >
      {validPaths.map((path, pathIndex) => {
        // Create SVG path data from normalized coordinates
        const pathData = path.map((point, i) => {
          const cmd = i === 0 ? 'M' : 'L';
          // Convert normalized (0-1) to percentage for SVG viewBox
          return `${cmd} ${point.x * 100} ${point.y * 100}`;
        }).join(' ');

        return (
          <path
            key={pathIndex}
            d={pathData}
            fill="none"
            stroke={annotation.style.color}
            strokeWidth={0.3 / scale}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}

/**
 * Portal component to render ink annotation on the correct page
 */
interface InkAnnotationPortalProps {
  annotation: AnnotationItem;
  page: number;
  scale: number;
  paneRootRef: React.RefObject<HTMLElement | null>;
}

function InkAnnotationPortal({ annotation, page, scale, paneRootRef }: InkAnnotationPortalProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Find the page element and create/find overlay container
    const pageElement = findPdfPageElementInScope(paneRootRef.current, page);
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
  }, [annotation.id, page, paneRootRef]);

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
  paneRootRef: React.RefObject<HTMLElement | null>;
}

function CurrentInkPathPortal({ path, page, color, scale, paneRootRef }: CurrentInkPathPortalProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const pageElement = findPdfPageElementInScope(paneRootRef.current, page);
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
  }, [page, paneRootRef]);

  if (!container) return null;

  return ReactDOM.createPortal(
    <CurrentInkPathOverlay path={path} color={color} scale={scale} />,
    container
  );
}

interface PdfTransientSelectionOverlayProps {
  selection: PdfSelectionSnapshot;
  paneId: PaneId;
  page: number;
  color: string;
  styleType: 'highlight' | 'underline';
}

function PdfTransientSelectionOverlay({ selection, paneId, page, color, styleType }: PdfTransientSelectionOverlayProps) {
  const rects = selection.overlayRectsByPage[page] ?? [];
  if (rects.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      data-testid={`pdf-transient-selection-${paneId}-page-${page}`}
      style={{ zIndex: 12 }}
    >
      {rects.map((rect, index) => (
        <div
          key={`${selection.signature}-${page}-${index}`}
          className="absolute rounded-sm"
          data-testid={index === 0 ? `pdf-transient-selection-first-rect-${paneId}` : undefined}
          style={styleType === 'underline'
            ? {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                borderBottom: `2px solid ${color}`,
                boxShadow: `inset 0 -1px 0 ${color}`,
                opacity: 0.95,
              }
            : {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                backgroundColor: `${color}33`,
                boxShadow: `inset 0 0 0 1px ${color}55`,
                opacity: 0.95,
              }}
        />
      ))}
    </div>
  );
}

interface PdfTransientSelectionPortalProps {
  selection: PdfSelectionSnapshot;
  paneId: PaneId;
  page: number;
  paneRootRef: React.RefObject<HTMLElement | null>;
  color: string;
  styleType: 'highlight' | 'underline';
}

function PdfTransientSelectionPortal({ selection, paneId, page, paneRootRef, color, styleType }: PdfTransientSelectionPortalProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const pageElement = findPdfPageElementInScope(paneRootRef.current, page);
    if (!pageElement) {
      return;
    }

    const computedStyle = window.getComputedStyle(pageElement);
    if (computedStyle.position === 'static') {
      pageElement.style.position = 'relative';
    }

    let overlay = pageElement.querySelector(`.pdf-transient-selection-overlay-${paneId}-${page}`) as HTMLElement | null;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = `pdf-transient-selection-overlay-${paneId}-${page}`;
      overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:12;';
      pageElement.appendChild(overlay);
    }

    const frameId = window.requestAnimationFrame(() => {
      setContainer(overlay);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    };
  }, [page, paneId, paneRootRef, selection.signature]);

  if (!container) {
    return null;
  }

  return ReactDOM.createPortal(
    <PdfTransientSelectionOverlay
      selection={selection}
      paneId={paneId}
      page={page}
      color={color}
      styleType={styleType}
    />,
    container,
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
  paneId,
  fileId,
  filePath,
}: PDFHighlighterAdapterProps) {
  const { t } = useI18n();
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const persistedPdfViewStateKey = useMemo(
    () => buildPersistedFileViewStateKey({
      kind: "pdf",
      workspaceRootPath,
      filePath,
      fallbackName: fileName,
    }),
    [fileName, filePath, workspaceRootPath],
  );
  const cachedPdfViewState = useMemo(() => {
    return readCachedPdfViewState(useContentCacheStore.getState().getEditorState(fileId));
  }, [fileId]);
  const { refreshDirectory } = useFileSystem();
  const isPaneActive = useWorkspaceStore((state) => state.layout.activePaneId === paneId);
  const saveEditorState = useContentCacheStore((state) => state.saveEditorState);
  const getEditorState = useContentCacheStore((state) => state.getEditorState);
  const [pdfItemManifest, setPdfItemManifest] = useState<PdfItemManifest | null>(null);
  const [pdfItemError, setPdfItemError] = useState<string | null>(null);
  const [backlinksByAnnotation, setBacklinksByAnnotation] = useState<Record<string, AnnotationBacklink[]>>({});
  const {
    annotations,
    error: annotationsError,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
  } = useAnnotationSystem({
    fileHandle,
    filePath,
    storageFileId: pdfItemManifest?.itemId ?? null,
    deferLoad: pdfItemManifest === null,
    rootHandle,
    fileType: 'pdf',
    author: 'user',
  });

  const [scale, setScale] = useState(cachedPdfViewState?.scale ?? 1.2);
  const [zoomMode, setZoomMode] = useState<PdfZoomMode>(cachedPdfViewState?.zoomMode ?? 'fit-width');
  const [activeTool, setActiveTool] = useState<AnnotationTool>('select');
  const [activeColor] = useState('#FFEB3B'); // Yellow default
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number; page: number } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(cachedPdfViewState?.showSidebar ?? false);
  const [sidebarSize, setSidebarSize] = useState(cachedPdfViewState?.sidebarSize ?? 28);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(cachedPdfViewState?.selectedAnnotationId ?? null);
  const [currentAnchorDebug, setCurrentAnchorDebug] = useState<PdfViewAnchor | null>(cachedPdfViewState?.anchor ?? null);
  const [persistedPdfViewState, setPersistedPdfViewState] = useState(() => cachedPdfViewState ?? null);
  const manifestSeedId = useMemo(() => generateFileId(filePath), [filePath]);
  const annotationMirrorTimeoutRef = useRef<number | null>(null);
  const canManagePdfItemWorkspace = useMemo(() => {
    const candidate = rootHandle as Partial<FileSystemDirectoryHandle> | null;
    return Boolean(candidate && typeof candidate.getDirectoryHandle === "function" && typeof candidate.values === "function");
  }, [rootHandle]);

  const refreshAnnotationBacklinks = useCallback(async (): Promise<Record<string, AnnotationBacklink[]>> => {
    if (!pdfItemManifest || !canManagePdfItemWorkspace) {
      return {};
    }

    await scanWorkspaceMarkdownBacklinks(rootHandle);
    const nextBacklinks: Record<string, AnnotationBacklink[]> = {};
    annotations.forEach((annotation) => {
      if (annotation.target.type !== "pdf") {
        return;
      }
      nextBacklinks[annotation.id] = getBacklinksForAnnotation(annotation.id);
    });
    setBacklinksByAnnotation(nextBacklinks);
    return nextBacklinks;
  }, [annotations, canManagePdfItemWorkspace, pdfItemManifest, rootHandle]);

  useEffect(() => {
    if (!canManagePdfItemWorkspace) {
      return;
    }

    let cancelled = false;

    const loadWorkspaceManifest = async () => {
      try {
        setPdfItemError(null);
        const manifest = await loadPdfItemManifest(rootHandle, manifestSeedId, filePath);
        if (cancelled) {
          return;
        }
        setPdfItemManifest(manifest);
      } catch (error) {
        if (!cancelled) {
          setPdfItemError(error instanceof Error ? error.message : String(error));
        }
      }
    };

    void loadWorkspaceManifest();

    return () => {
      cancelled = true;
    };
  }, [canManagePdfItemWorkspace, filePath, manifestSeedId, rootHandle]);

  useEffect(() => {
    if (!showSidebar || !pdfItemManifest || !canManagePdfItemWorkspace) {
      return;
    }

    void refreshAnnotationBacklinks();
    const handleWindowFocus = () => {
      void refreshAnnotationBacklinks();
    };

    window.addEventListener("focus", handleWindowFocus);
    return () => {
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [canManagePdfItemWorkspace, pdfItemManifest, refreshAnnotationBacklinks, showSidebar]);

  useEffect(() => {
    if (!persistedPdfViewStateKey) {
      return;
    }

    let cancelled = false;
    void loadPersistedFileViewState(persistedPdfViewStateKey).then((persistedState) => {
      if (
        cancelled ||
        !persistedState ||
        typeof persistedState.cursorPosition !== "number" ||
        typeof persistedState.scrollTop !== "number"
      ) {
        return;
      }

      const nextPdfViewState = readCachedPdfViewState(persistedState);
      if (!nextPdfViewState) {
        return;
      }

      setPersistedPdfViewState(nextPdfViewState);

      if (!cachedPdfViewState) {
        saveEditorState(fileId, persistedState as {
          cursorPosition: number;
          scrollTop: number;
          scrollLeft?: number;
          selection?: { from: number; to: number };
          viewState?: Record<string, unknown>;
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [cachedPdfViewState, fileId, persistedPdfViewStateKey, saveEditorState]);

  useEffect(() => {
    if (cachedPdfViewState || !persistedPdfViewState) {
      return;
    }

    setScale(persistedPdfViewState.scale);
    setZoomMode(persistedPdfViewState.zoomMode);
    setShowSidebar(persistedPdfViewState.showSidebar);
    setSidebarSize(persistedPdfViewState.sidebarSize ?? 28);
    setSelectedAnnotationId(persistedPdfViewState.selectedAnnotationId ?? null);
    setCurrentAnchorDebug(persistedPdfViewState.anchor ?? null);
  }, [cachedPdfViewState, persistedPdfViewState]);

  useEffect(() => {
    if (!pdfItemManifest || !canManagePdfItemWorkspace) {
      return;
    }

    if (annotationMirrorTimeoutRef.current) {
      window.clearTimeout(annotationMirrorTimeoutRef.current);
    }

    annotationMirrorTimeoutRef.current = window.setTimeout(() => {
      void (async () => {
        const nextBacklinks = await refreshAnnotationBacklinks();
        const resolvedManifest = annotations.some((annotation) => annotation.target.type === "pdf")
          ? await ensurePdfItemWorkspace(rootHandle, manifestSeedId, filePath)
          : pdfItemManifest;
        const annotationResult = await syncPdfAnnotationsMarkdown(
          rootHandle,
          resolvedManifest,
          fileName,
          annotations,
          nextBacklinks,
        );
        setPdfItemManifest(annotationResult.manifest);
        await refreshDirectory({ silent: true });
      })();
    }, 450);

    return () => {
      if (annotationMirrorTimeoutRef.current) {
        window.clearTimeout(annotationMirrorTimeoutRef.current);
        annotationMirrorTimeoutRef.current = null;
      }
    };
  }, [annotations, canManagePdfItemWorkspace, fileName, filePath, manifestSeedId, pdfItemManifest, refreshAnnotationBacklinks, refreshDirectory, rootHandle]);
  const [restoreDebugState, setRestoreDebugState] = useState<PdfRestoreDebugState>(createIdleRestoreDebugState);
  
  // Current stroke state (for real-time drawing preview)
  const [currentInkPath, setCurrentInkPath] = useState<{ x: number; y: number }[]>([]);
  const [currentInkPage, setCurrentInkPage] = useState<number | null>(null);
  const [isDrawingStroke, setIsDrawingStroke] = useState(false);
  
  const [textAnnotationPosition, setTextAnnotationPosition] = useState<{ x: number; y: number; page: number } | null>(null);
  const [editingTextAnnotation, setEditingTextAnnotation] = useState<{ annotation: AnnotationItem; position: { x: number; y: number } } | null>(null);
  const [pdfPageDimensions, setPdfPageDimensions] = useState<PdfPageDimensionsMap>(new Map());
  const [pdfSelectionSession, setPdfSelectionSession] = useState<PdfSelectionSessionState>(() => createIdlePdfSelectionSession());
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const pathname = usePathname();
  const isDiagnosticsMode = pathname?.startsWith("/diagnostics") ?? false;
  const pdfBlob = useMemo(() => new Blob([content], { type: 'application/pdf' }), [content]);
  const pdfUrl = useObjectUrl(pdfBlob);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const resolvedScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [viewerScrollContainer, setViewerScrollContainer] = useState<HTMLDivElement | null>(null);
  const hasRestoredScrollRef = useRef(false);
  const timeoutIdsRef = useRef<number[]>([]);
  const persistTimeoutRef = useRef<number | null>(null);
  const lastPersistSignatureRef = useRef<string | null>(null);
  const lastPersistedEditorStateRef = useRef<ReturnType<typeof buildPdfEditorState> | null>(null);
  const anchorCaptureRevisionRef = useRef(0);
  const pendingAreaPreviewBackfillRef = useRef<Set<string>>(new Set());
  const currentInkPathRef = useRef<{ x: number; y: number }[]>([]);
  const currentInkPageRef = useRef<number | null>(null);
  const currentInkPageElementRef = useRef<HTMLElement | null>(null);
  const inkPreviewFrameRef = useRef<number | null>(null);
  const transientSelectionDismissRef = useRef<(() => void) | null>(null);
  const lastScaleSyncRef = useRef<{ fileId: string; pdfScaleValue: string } | null>(null);
  const renderedPdfPagesRef = useRef<HTMLElement[]>([]);
  const pdfSelectionSessionRef = useRef<PdfSelectionSessionState>(pdfSelectionSession);
  const frozenPdfSelection = pdfSelectionSession.phase === "frozen" ? pdfSelectionSession.snapshot : null;
  const { menuState: selectionMenuState, closeMenu: closeSelectionMenu } = useSelectionContextMenu(
    scrollContainerRef,
    ({ text, eventTarget, domRange }) => {
      const frozenContext = buildPdfSelectionRectsFromSnapshot(frozenPdfSelection, containerRef.current);
      const sourceElement = eventTarget instanceof HTMLElement ? eventTarget : eventTarget instanceof Node ? eventTarget.parentElement : null;
      const pageElement = sourceElement?.closest<HTMLElement>('[data-page-number]');
      const pageNumber = Number(pageElement?.dataset.pageNumber ?? '');

      return createSelectionContext({
        sourceKind: 'pdf',
        paneId,
        fileName,
        filePath,
        selectedText: frozenPdfSelection?.text || text,
        pdfPage: frozenContext.pageNumber ?? (Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : undefined),
        pdfRects: frozenContext.rects ?? buildPdfSelectionRects(domRange, pageElement ?? null),
      });
    },
    {
      getSelectionSnapshot: () => buildPdfSelectionMenuSnapshot(frozenPdfSelection, containerRef.current),
    },
  );
  const pdfHighlighterRef = useRef<PdfHighlighter<IHighlight> | null>(null);
  const pendingNavigation = useLinkNavigationStore((state) => state.pendingByPane[paneId]);
  const consumePendingNavigation = useLinkNavigationStore((state) => state.consumePendingNavigation);
  const commitPdfSelectionSession = useCallback((nextState: PdfSelectionSessionState) => {
    pdfSelectionSessionRef.current = nextState;
    setPdfSelectionSession(nextState);
  }, []);

  const resolveViewerScrollContainer = useCallback((): HTMLDivElement | null => {
    // Fast path: return cached container if still valid
    const cached = resolvedScrollContainerRef.current;
    if (cached && cached.isConnected && hasMeaningfulScrollOverflow(cached)) {
      return cached;
    }

    const shellContainer = scrollContainerRef.current;
    const viewerContainer = pdfHighlighterRef.current?.viewer?.container;

    // Try the two most likely candidates first — avoids expensive querySelectorAll
    const quickCandidates = [viewerContainer, shellContainer].filter(
      (c): c is HTMLDivElement => c instanceof HTMLDivElement,
    );
    for (const candidate of quickCandidates) {
      if (hasMeaningfulScrollOverflow(candidate)) {
        resolvedScrollContainerRef.current = candidate;
        return candidate;
      }
    }

    // Fallback: search children, but limit depth to avoid scanning thousands of nodes
    const roots = quickCandidates;
    if (roots.length === 0) {
      return null;
    }

    const seen = new Set<HTMLDivElement>(roots);
    let best: HTMLDivElement | null = null;
    let bestScore = 0;

    for (const root of roots) {
      // Only check direct children and one level deeper — not the entire subtree
      const children = root.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!(child instanceof HTMLDivElement) || seen.has(child)) continue;
        seen.add(child);
        const score = getScrollContainerOverflowScore(child);
        if (score > bestScore) {
          bestScore = score;
          best = child;
        }
        // Check grandchildren
        const grandchildren = child.children;
        for (let j = 0; j < grandchildren.length; j++) {
          const gc = grandchildren[j];
          if (!(gc instanceof HTMLDivElement) || seen.has(gc)) continue;
          seen.add(gc);
          const gcScore = getScrollContainerOverflowScore(gc);
          if (gcScore > bestScore) {
            bestScore = gcScore;
            best = gc;
          }
        }
      }
    }

    resolvedScrollContainerRef.current = best && hasMeaningfulScrollOverflow(best) ? best : null;
    return best;
  }, []);

  const getViewerScrollContainer = useCallback((): HTMLDivElement | null => {
    return viewerScrollContainer ?? resolveViewerScrollContainer();
  }, [resolveViewerScrollContainer, viewerScrollContainer]);

  const getNativePdfSelectionText = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return "";
    }

    const text = selection.toString();
    if (!text.trim()) {
      return "";
    }

    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    const container = containerRef.current;
    const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement ?? null;
    const focusElement = focusNode instanceof Element ? focusNode : focusNode?.parentElement ?? null;

    if (!container || !anchorElement || !focusElement) {
      return "";
    }

    if (!container.contains(anchorElement) || !container.contains(focusElement)) {
      return "";
    }

    return text;
  }, []);

  const getNativePdfSelectionRange = useCallback((): Range | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const container = containerRef.current;
    const ancestor = range.commonAncestorContainer;
    const ancestorElement = ancestor instanceof Element ? ancestor : ancestor.parentElement;
    if (!container || !ancestorElement || !container.contains(ancestorElement)) {
      return null;
    }

    return range;
  }, []);

  const getActivePdfSelectionText = useCallback(() => {
    return resolvePdfCopySelectionText({
      nativeText: getNativePdfSelectionText(),
      frozenSnapshot: frozenPdfSelection,
    });
  }, [frozenPdfSelection, getNativePdfSelectionText]);

  const clearNativePdfSelection = useCallback(() => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      selection.removeAllRanges();
    }
  }, []);

  const clearNativePdfSelectionLater = useCallback((frameCount = 1) => {
    let framesRemaining = Math.max(1, frameCount);
    const tick = () => {
      framesRemaining -= 1;
      if (framesRemaining <= 0) {
        clearNativePdfSelection();
        return;
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  }, [clearNativePdfSelection]);

  const dismissTransientSelectionTip = useCallback(() => {
    transientSelectionDismissRef.current?.();
    transientSelectionDismissRef.current = null;
  }, []);

  const clearTransientSelection = useCallback((options?: {
    hideTip?: boolean;
    clearNative?: boolean;
    nextPhase?: 'committed' | 'cancelled';
  }) => {
    if (options?.hideTip !== false) {
      dismissTransientSelectionTip();
    }
    if (options?.clearNative !== false) {
      clearNativePdfSelection();
    }
    commitPdfSelectionSession(updatePdfSelectionSession(pdfSelectionSessionRef.current, {
      phase: options?.nextPhase ?? 'cancelled',
      snapshot: null,
    }));
  }, [clearNativePdfSelection, commitPdfSelectionSession, dismissTransientSelectionTip]);

  const activateTransientSelection = useCallback((
    selection: PdfSelectionSnapshot | null,
    dismissTip?: () => void,
  ) => {
    transientSelectionDismissRef.current = dismissTip ?? null;
    commitPdfSelectionSession(updatePdfSelectionSession(pdfSelectionSessionRef.current, {
      phase: selection ? 'frozen' : 'cancelled',
      snapshot: selection,
    }));
  }, [commitPdfSelectionSession]);

  const beginNativePdfSelectionInteraction = useCallback(() => {
    if (activeTool === 'note' || activeTool === 'text' || activeTool === 'ink') {
      return;
    }

    commitPdfSelectionSession(beginPdfSelectionSession(pdfSelectionSessionRef.current));
  }, [activeTool, commitPdfSelectionSession]);

  const updateCurrentAnchorDebug = useCallback((anchor: PdfViewAnchor | null) => {
    if (isDiagnosticsMode) {
      setCurrentAnchorDebug(anchor);
    }
  }, [isDiagnosticsMode]);

  const updateRestoreDebugState = useCallback((nextState: PdfRestoreDebugState) => {
    if (isDiagnosticsMode) {
      setRestoreDebugState(nextState);
    }
  }, [isDiagnosticsMode]);

  const refreshRenderedPdfPages = useCallback((): HTMLElement[] => {
    const nextPages = Array.from(containerRef.current?.querySelectorAll<HTMLElement>("[data-page-number]") ?? []);
    renderedPdfPagesRef.current = nextPages;
    return nextPages;
  }, []);

  const getRenderedPdfPages = useCallback((): HTMLElement[] => {
    const cachedPages = renderedPdfPagesRef.current;
    const container = containerRef.current;
    if (
      container &&
      cachedPages.length > 0 &&
      cachedPages[0]?.isConnected &&
      cachedPages[cachedPages.length - 1]?.isConnected &&
      container.contains(cachedPages[0]) &&
      container.contains(cachedPages[cachedPages.length - 1])
    ) {
      return cachedPages;
    }

    return refreshRenderedPdfPages();
  }, [refreshRenderedPdfPages]);

  const getPrimaryVisiblePageState = useCallback(() => {
    const shell = scrollContainerRef.current;
    const container = containerRef.current;
    if (!shell || !container || typeof document === "undefined") {
      return null;
    }

    const shellRect = shell.getBoundingClientRect();
    const anchorX = shellRect.left + (shellRect.width * DEFAULT_PDF_VIEWPORT_ANCHOR.x);
    const sampleYRatios = [
      DEFAULT_PDF_VIEWPORT_ANCHOR.y,
      0.2,
      0.5,
      0.8,
    ];

    if (typeof document.elementFromPoint === "function") {
      for (const ratio of sampleYRatios) {
        const anchorY = shellRect.top + (shellRect.height * ratio);
        const target = document.elementFromPoint(anchorX, anchorY);
        const pageElement = target instanceof Element
          ? target.closest<HTMLElement>("[data-page-number]")
          : null;
        if (!pageElement || !container.contains(pageElement)) {
          continue;
        }

        const pageNumber = Number(pageElement.dataset.pageNumber ?? "");
        const pageRect = pageElement.getBoundingClientRect();
        if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageRect.width <= 0 || pageRect.height <= 0) {
          continue;
        }

        return {
          pageNumber,
          pageElement,
          shellRect,
        };
      }
    }

    const pages = getRenderedPdfPages();
    const candidates = buildVisiblePageCandidates(pages);
    const pageNumber = findPrimaryVisiblePdfPage(candidates, shellRect);
    if (!pageNumber) {
      return null;
    }

    const pageElement = pages.find((page) => Number(page.dataset.pageNumber ?? "") === pageNumber) ?? null;
    if (!pageElement) {
      return null;
    }

    return {
      pageNumber,
      pageElement,
      shellRect,
    };
  }, [getRenderedPdfPages]);

  const captureCurrentPdfAnchor = useCallback((captureRevision?: number): PdfViewAnchor | null => {
    const visibleState = getPrimaryVisiblePageState();
    if (!visibleState) {
      return null;
    }

    const nextRevision = captureRevision ?? anchorCaptureRevisionRef.current + 1;
    if (captureRevision === undefined) {
      anchorCaptureRevisionRef.current = nextRevision;
    }

    return capturePdfViewAnchor({
      pageNumber: visibleState.pageNumber,
      pageRect: visibleState.pageElement.getBoundingClientRect(),
      shellRect: visibleState.shellRect,
      captureRevision: nextRevision,
      viewportAnchorX: DEFAULT_PDF_VIEWPORT_ANCHOR.x,
      viewportAnchorY: DEFAULT_PDF_VIEWPORT_ANCHOR.y,
    });
  }, [getPrimaryVisiblePageState]);

  const restorePdfAnchor = useCallback((input: {
    viewerContainer: HTMLDivElement;
    anchor: PdfViewAnchor | null | undefined;
    fallbackScrollState?: ReturnType<typeof captureRelativeScrollPosition>;
    fallbackScrollTop?: number;
    fallbackScrollLeft?: number;
  }) => {
    let frameId = 0;
    let attemptsLeft = input.anchor ? 60 : 0;

    const commitFallback = () => {
      if (input.fallbackScrollState) {
        restoreRelativeScrollPosition(input.viewerContainer, input.fallbackScrollState);
      } else if (typeof input.fallbackScrollTop === 'number' || typeof input.fallbackScrollLeft === 'number') {
        input.viewerContainer.scrollTo({
          top: input.fallbackScrollTop ?? 0,
          left: input.fallbackScrollLeft ?? 0,
          behavior: 'auto',
        });
      }

      const actualAnchor = captureCurrentPdfAnchor(input.anchor?.captureRevision);
      const comparison = compareAnchorPair(input.anchor, actualAnchor);
      updateCurrentAnchorDebug(actualAnchor);
      updateRestoreDebugState({
        status: 'fallback',
        ok: input.anchor ? comparison.ok : true,
        expectedPage: input.anchor?.pageNumber ?? null,
        actualPage: actualAnchor?.pageNumber ?? null,
        deltaTopRatio: comparison.deltaTopRatio,
        deltaLeftRatio: comparison.deltaLeftRatio,
        captureRevision: input.anchor?.captureRevision ?? actualAnchor?.captureRevision ?? null,
      });
    };

    if (!input.anchor) {
      commitFallback();
      return () => undefined;
    }

    const targetAnchor = input.anchor;

    updateRestoreDebugState({
      status: 'restoring',
      ok: false,
      expectedPage: targetAnchor.pageNumber,
      actualPage: null,
      deltaTopRatio: null,
      deltaLeftRatio: null,
      captureRevision: targetAnchor.captureRevision,
    });

    const restore = () => {
      const pageElement = containerRef.current?.querySelector<HTMLElement>(`[data-page-number="${targetAnchor.pageNumber}"]`);
      if (!pageElement) {
        attemptsLeft -= 1;
        if (attemptsLeft > 0) {
          frameId = window.requestAnimationFrame(restore);
          return;
        }
        commitFallback();
        return;
      }

      const containerRect = input.viewerContainer.getBoundingClientRect();
      const targetScroll = resolvePdfAnchorScrollTarget({
        anchor: targetAnchor,
        pageRect: pageElement.getBoundingClientRect(),
        containerRect,
        containerScrollTop: input.viewerContainer.scrollTop,
        containerScrollLeft: input.viewerContainer.scrollLeft,
        containerClientHeight: input.viewerContainer.clientHeight,
        containerClientWidth: input.viewerContainer.clientWidth,
      });

      input.viewerContainer.scrollTo({
        top: targetScroll.top,
        left: targetScroll.left,
        behavior: 'auto',
      });

      frameId = window.requestAnimationFrame(() => {
        const actualAnchor = captureCurrentPdfAnchor(targetAnchor.captureRevision);
        const comparison = compareAnchorPair(targetAnchor, actualAnchor);
        updateCurrentAnchorDebug(actualAnchor);

        if (comparison.ok || attemptsLeft <= 1) {
          if (!comparison.ok && (input.fallbackScrollState || typeof input.fallbackScrollTop === 'number' || typeof input.fallbackScrollLeft === 'number')) {
            commitFallback();
            return;
          }

          updateRestoreDebugState({
            status: 'restored',
            ok: comparison.ok,
            expectedPage: targetAnchor.pageNumber,
            actualPage: actualAnchor?.pageNumber ?? null,
            deltaTopRatio: comparison.deltaTopRatio,
            deltaLeftRatio: comparison.deltaLeftRatio,
            captureRevision: targetAnchor.captureRevision,
          });
          return;
        }

        attemptsLeft -= 1;
        frameId = window.requestAnimationFrame(restore);
      });
    };

    frameId = window.requestAnimationFrame(() => {
      frameId = window.requestAnimationFrame(restore);
    });

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [captureCurrentPdfAnchor, updateCurrentAnchorDebug, updateRestoreDebugState]);

  const scheduleTimeout = useCallback((callback: () => void, delay: number) => {
    const timeoutId = window.setTimeout(() => {
      timeoutIdsRef.current = timeoutIdsRef.current.filter((id) => id !== timeoutId);
      callback();
    }, delay);
    timeoutIdsRef.current.push(timeoutId);
    return timeoutId;
  }, []);

  const clearScheduledPersist = useCallback(() => {
    if (persistTimeoutRef.current !== null) {
      window.clearTimeout(persistTimeoutRef.current);
      persistTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    hasRestoredScrollRef.current = false;
    resolvedScrollContainerRef.current = null;
    lastPersistSignatureRef.current = null;
    lastPersistedEditorStateRef.current = null;
    currentInkPathRef.current = [];
    currentInkPageRef.current = null;
    currentInkPageElementRef.current = null;
    pdfSelectionSessionRef.current = createIdlePdfSelectionSession();
    setViewerScrollContainer(null);
    updateCurrentAnchorDebug(cachedPdfViewState?.anchor ?? null);
    updateRestoreDebugState(createIdleRestoreDebugState());
    setCurrentInkPath([]);
    setCurrentInkPage(null);
    setPendingPin(null);
    setHighlightedId(null);
    setHoveredAnnotationId(null);
    setSelectedAnnotationId(null);
    transientSelectionDismissRef.current = null;
    setPdfSelectionSession(createIdlePdfSelectionSession());
    clearScheduledPersist();
  }, [cachedPdfViewState?.anchor, clearScheduledPersist, fileId, updateCurrentAnchorDebug, updateRestoreDebugState]);

  useEffect(() => {
    clearTransientSelection({ nextPhase: 'cancelled' });
  }, [activeTool, clearTransientSelection]);

  useEffect(() => {
    if (!frozenPdfSelection) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.button === 2 ||
        target?.closest('.pdf-selection-color-picker') ||
        target?.closest('[role="menu"]') ||
        target?.closest('[role="dialog"]')
      ) {
        return;
      }
      clearTransientSelection({ nextPhase: 'cancelled' });
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [clearTransientSelection, frozenPdfSelection]);

  const buildPersistSignature = useCallback((input: {
    scale: number;
    zoomMode: PdfZoomMode;
    showSidebar: boolean;
    sidebarSize: number;
    selectedAnnotationId: string | null;
    scrollTop: number;
    scrollLeft: number;
    anchor: PdfViewAnchor | null;
  }) => {
    const anchor = input.anchor;
    return [
      input.scale.toFixed(4),
      input.zoomMode,
      input.showSidebar ? "1" : "0",
      Math.round(input.sidebarSize),
      input.selectedAnnotationId ?? "__none__",
      Math.round(input.scrollTop),
      Math.round(input.scrollLeft),
      anchor?.pageNumber ?? 0,
      anchor?.captureRevision ?? 0,
      anchor ? anchor.pageOffsetTopRatio.toFixed(4) : "-1",
      anchor ? anchor.pageOffsetLeftRatio.toFixed(4) : "-1",
    ].join("|");
  }, []);

  const buildCurrentPdfEditorStateSnapshot = useCallback(() => {
    const viewerContainer = getViewerScrollContainer();
    if (!hasMeaningfulScrollOverflow(viewerContainer)) {
      return null;
    }

    const anchor = captureCurrentPdfAnchor();
    const editorState = buildPdfEditorState({
      scale,
      zoomMode,
      showSidebar,
      sidebarSize,
      selectedAnnotationId,
      anchor: anchor ?? undefined,
      scrollTop: viewerContainer?.scrollTop ?? 0,
      scrollLeft: viewerContainer?.scrollLeft ?? 0,
    });

    const signature = buildPersistSignature({
      scale,
      zoomMode,
      showSidebar,
      sidebarSize,
      selectedAnnotationId,
      scrollTop: editorState.scrollTop,
      scrollLeft: editorState.scrollLeft ?? 0,
      anchor,
    });

    return {
      editorState,
      anchor,
      signature,
    };
  }, [buildPersistSignature, captureCurrentPdfAnchor, getViewerScrollContainer, scale, selectedAnnotationId, showSidebar, sidebarSize, zoomMode]);

  const persistPdfViewStateNow = useCallback(() => {
    clearScheduledPersist();
    const snapshot = buildCurrentPdfEditorStateSnapshot();
    if (!snapshot && lastPersistedEditorStateRef.current) {
      return;
    }

    if (!snapshot) {
      return;
    }

    const { editorState: nextState, anchor, signature } = snapshot;

    if (lastPersistSignatureRef.current === signature) {
      return;
    }

    lastPersistSignatureRef.current = signature;
    lastPersistedEditorStateRef.current = nextState;
    updateCurrentAnchorDebug(anchor);
    saveEditorState(fileId, nextState);
    void savePersistedFileViewState(persistedPdfViewStateKey, nextState);
  }, [buildCurrentPdfEditorStateSnapshot, clearScheduledPersist, fileId, persistedPdfViewStateKey, saveEditorState, updateCurrentAnchorDebug]);

  const persistLastKnownPdfViewState = useCallback(() => {
    const lastKnownState = lastPersistedEditorStateRef.current;
    if (!lastKnownState) {
      return;
    }

    saveEditorState(fileId, lastKnownState);
    void savePersistedFileViewState(persistedPdfViewStateKey, lastKnownState);
  }, [fileId, persistedPdfViewStateKey, saveEditorState]);

  const schedulePersistPdfViewState = useCallback((delay = 180) => {
    clearScheduledPersist();
    persistTimeoutRef.current = window.setTimeout(() => {
      persistTimeoutRef.current = null;
      persistPdfViewStateNow();
    }, delay);
  }, [clearScheduledPersist, persistPdfViewStateNow]);

  useEffect(() => {
    const viewerContainer = getViewerScrollContainer();
    if (!viewerContainer) {
      return;
    }

    let scrollRafId = 0;
    const handleScroll = () => {
      // Throttle to one snapshot per animation frame to avoid jank during fast scrolling
      if (scrollRafId) return;
      scrollRafId = window.requestAnimationFrame(() => {
        scrollRafId = 0;
        const snapshot = buildCurrentPdfEditorStateSnapshot();
        if (snapshot) {
          lastPersistedEditorStateRef.current = snapshot.editorState;
        }
        schedulePersistPdfViewState();
      });
    };

    viewerContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      viewerContainer.removeEventListener('scroll', handleScroll);
      if (scrollRafId) window.cancelAnimationFrame(scrollRafId);
      if (lastPersistedEditorStateRef.current) {
        persistLastKnownPdfViewState();
      } else {
        persistPdfViewStateNow();
      }
    };
  }, [buildCurrentPdfEditorStateSnapshot, getViewerScrollContainer, persistLastKnownPdfViewState, persistPdfViewStateNow, schedulePersistPdfViewState]);

  useEffect(() => {
    if (!hasRestoredScrollRef.current) {
      return;
    }

    schedulePersistPdfViewState(120);
  }, [scale, schedulePersistPdfViewState, selectedAnnotationId, showSidebar, sidebarSize, zoomMode]);

  useEffect(() => {
    if (hasRestoredScrollRef.current) {
      return;
    }

    const cachedState = getEditorState(fileId);
    if (!cachedState) {
      hasRestoredScrollRef.current = true;
      return;
    }

    const cachedPdfState = readCachedPdfViewState(cachedState);
    let frameId = 0;
    let cleanupRestore: (() => void) | undefined;
    let attemptsLeft = 60;

    const restore = () => {
      const viewerContainer = getViewerScrollContainer();
      if (!viewerContainer || !hasMeaningfulScrollOverflow(viewerContainer)) {
        attemptsLeft -= 1;
        if (attemptsLeft > 0) {
          frameId = window.requestAnimationFrame(restore);
        }
        return;
      }

      cleanupRestore = restorePdfAnchor({
        viewerContainer,
        anchor: cachedPdfState?.anchor,
        fallbackScrollTop: cachedState.scrollTop ?? 0,
        fallbackScrollLeft: cachedState.scrollLeft ?? 0,
      });
      hasRestoredScrollRef.current = true;
    };

    frameId = window.requestAnimationFrame(() => {
      frameId = window.requestAnimationFrame(restore);
    });

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      cleanupRestore?.();
    };
  }, [fileId, getEditorState, getViewerScrollContainer, restorePdfAnchor]);

  const flashPdfElement = useCallback((element: Element | null) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    element.animate(
      [
        { boxShadow: '0 0 0 0 rgba(59, 130, 246, 0.00)', backgroundColor: 'rgba(59, 130, 246, 0.00)' },
        { boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.20)', backgroundColor: 'rgba(59, 130, 246, 0.08)' },
        { boxShadow: '0 0 0 0 rgba(59, 130, 246, 0.00)', backgroundColor: 'rgba(59, 130, 246, 0.00)' },
      ],
      {
        duration: 1800,
        easing: 'ease-out',
      },
    );
  }, []);

  // Ink annotation merge callback - creates merged annotation from buffered strokes
  const handleCreateMergedInkAnnotation = useCallback((merged: MergedInkAnnotation) => {
    const inkAnnotation: Omit<AnnotationItem, 'id' | 'createdAt'> = {
      target: {
        type: 'pdf',
        page: merged.page,
        rects: [{
          x1: Math.max(0, merged.boundingBox.x1),
          y1: Math.max(0, merged.boundingBox.y1),
          x2: Math.min(1, merged.boundingBox.x2),
          y2: Math.min(1, merged.boundingBox.y2),
        }],
      } as PdfTarget,
      style: {
        color: merged.color,
        type: 'ink',
      },
      // Store all stroke paths as JSON for rendering
      content: merged.content,
      author: 'user',
    };
    addAnnotation(inkAnnotation);
  }, [addAnnotation]);

  // Use ink annotation merge hook
  const {
    addStroke: addInkStroke,
    isDrawing: isInkBuffering,
    strokeCount: inkStrokeCount,
    finalizeNow: finalizeInkNow,
    cancelDrawing: cancelInkDrawing,
  } = useInkAnnotation({
    onCreateAnnotation: handleCreateMergedInkAnnotation,
    mergeCriteria: {
      timeThreshold: 2000,
      distanceThreshold: 0.1,
    },
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handlePointerEnter = () => {
      setScopedPdfPaneId(paneId);
    };

    const handlePointerLeave = () => {
      clearScopedPdfPaneId(paneId);
    };

    const handleFocusIn = () => {
      setScopedPdfPaneId(paneId);
    };

    const handleFocusOut = (event: FocusEvent) => {
      const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (!nextTarget || !container.contains(nextTarget)) {
        clearScopedPdfPaneId(paneId);
      }
    };

    container.addEventListener('pointerenter', handlePointerEnter);
    container.addEventListener('pointerleave', handlePointerLeave);
    container.addEventListener('focusin', handleFocusIn);
    container.addEventListener('focusout', handleFocusOut);

    return () => {
      container.removeEventListener('pointerenter', handlePointerEnter);
      container.removeEventListener('pointerleave', handlePointerLeave);
      container.removeEventListener('focusin', handleFocusIn);
      container.removeEventListener('focusout', handleFocusOut);
      clearScopedPdfPaneId(paneId);
    };
  }, [paneId]);

  useEffect(() => {
    return () => {
      clearScheduledPersist();
      if (inkPreviewFrameRef.current !== null) {
        window.cancelAnimationFrame(inkPreviewFrameRef.current);
        inkPreviewFrameRef.current = null;
      }
      timeoutIdsRef.current.forEach((id) => window.clearTimeout(id));
      timeoutIdsRef.current = [];
    };
  }, [clearScheduledPersist]);

  // Keyboard shortcut: Ctrl+Shift+A to toggle sidebar
  useEffect(() => {
    const handleSidebarShortcut = (e: KeyboardEvent) => {
      if (!isPdfInteractionActive({ paneId, isPaneActive })) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setShowSidebar(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleSidebarShortcut);
    return () => window.removeEventListener('keydown', handleSidebarShortcut);
  }, [isPaneActive, paneId]);

  const handlePdfCopy = useCallback((clipboardData?: DataTransfer | null) => {
    const selectedText = getActivePdfSelectionText();
    if (!selectedText) {
      return false;
    }

    if (clipboardData) {
      clipboardData.setData("text/plain", selectedText);
    } else {
      void copyToClipboard(selectedText);
    }

    return true;
  }, [getActivePdfSelectionText]);

  useEffect(() => {
    const handleCopy = (event: ClipboardEvent) => {
      if (!isPdfInteractionActive({ paneId, isPaneActive })) {
        return;
      }

      if (!handlePdfCopy(event.clipboardData)) {
        return;
      }
      event.preventDefault();
    };

    document.addEventListener("copy", handleCopy, true);
    return () => document.removeEventListener("copy", handleCopy, true);
  }, [handlePdfCopy, isPaneActive, paneId]);

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

  useEffect(() => {
    let frameId = 0;
    let attemptsLeft = 30;

    const syncScrollContainer = () => {
      const nextContainer = resolveViewerScrollContainer();
      setViewerScrollContainer((current) => current === nextContainer ? current : nextContainer);

      if (hasMeaningfulScrollOverflow(nextContainer)) {
        return;
      }

      attemptsLeft -= 1;
      if (attemptsLeft > 0) {
        frameId = window.requestAnimationFrame(syncScrollContainer);
      }
    };

    frameId = window.requestAnimationFrame(syncScrollContainer);
    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [fileId, pdfScaleValue, resolveViewerScrollContainer, showSidebar]);

  useEffect(() => {
    if (!isDiagnosticsMode) {
      return;
    }

    let attemptsLeft = 24;
    let frameId = 0;

    const attachViewerAttributes = () => {
      const viewerContainer = getViewerScrollContainer();
      const shellContainer = scrollContainerRef.current;
      if (shellContainer) {
        shellContainer.setAttribute("data-pane-id", paneId);
      }

      if (viewerContainer) {
        if (viewerContainer === shellContainer && !hasMeaningfulScrollOverflow(viewerContainer)) {
          attemptsLeft -= 1;
          if (attemptsLeft > 0) {
            frameId = window.requestAnimationFrame(attachViewerAttributes);
          }
          return;
        }

        if (viewerContainer !== shellContainer) {
          viewerContainer.setAttribute("data-pane-id", paneId);
          viewerContainer.setAttribute("data-testid", `pdf-viewer-container-${paneId}`);
        }
        return;
      }

      attemptsLeft -= 1;
      if (attemptsLeft > 0) {
        frameId = window.requestAnimationFrame(attachViewerAttributes);
      }
    };

    frameId = window.requestAnimationFrame(attachViewerAttributes);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [getViewerScrollContainer, isDiagnosticsMode, paneId]);

  useEffect(() => {
    let frameId = 0;
    let attemptsLeft = 30;

    const syncPageDimensions = () => {
      const pages = getRenderedPdfPages();
      if (pages.length === 0) {
        attemptsLeft -= 1;
        if (attemptsLeft > 0) {
          frameId = window.requestAnimationFrame(syncPageDimensions);
        }
        return;
      }

      const nextDimensions: PdfPageDimensionsMap = new Map();
      pages.forEach((page) => {
        const pageNumber = Number(page.dataset.pageNumber ?? "");
        const pageRect = page.getBoundingClientRect();
        if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageRect.width <= 0 || pageRect.height <= 0) {
          return;
        }

        nextDimensions.set(pageNumber, {
          width: pageRect.width,
          height: pageRect.height,
        });
      });

      if (nextDimensions.size === 0) {
        attemptsLeft -= 1;
        if (attemptsLeft > 0) {
          frameId = window.requestAnimationFrame(syncPageDimensions);
        }
        return;
      }

      setPdfPageDimensions((previous) => {
        if (previous.size === nextDimensions.size) {
          const isSame = [...nextDimensions.entries()].every(([pageNumber, dimensions]) => {
            const previousDimensions = previous.get(pageNumber);
            return previousDimensions &&
              Math.abs(previousDimensions.width - dimensions.width) < 0.5 &&
              Math.abs(previousDimensions.height - dimensions.height) < 0.5;
          });
          if (isSame) {
            return previous;
          }
        }

        return nextDimensions;
      });
    };

    frameId = window.requestAnimationFrame(syncPageDimensions);
    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [getRenderedPdfPages, pdfScaleValue, showSidebar]);

  useEffect(() => {
    const pdfHighlighter = pdfHighlighterRef.current;
    if (!pdfHighlighter) {
      return;
    }

    let frameId = 0;
    let attemptsLeft = 60;
    let cleanupRestore: (() => void) | undefined;

    const shouldSyncScale = (() => {
      const previous = lastScaleSyncRef.current;
      lastScaleSyncRef.current = { fileId, pdfScaleValue };
      return previous?.fileId === fileId && previous.pdfScaleValue !== pdfScaleValue;
    })();

    const syncScaleAndRestore = () => {
      const viewerContainer = getViewerScrollContainer();
      const renderedPages = getRenderedPdfPages();
      if (!viewerContainer || !hasMeaningfulScrollOverflow(viewerContainer) || renderedPages.length === 0) {
        attemptsLeft -= 1;
        if (attemptsLeft > 0) {
          frameId = window.requestAnimationFrame(syncScaleAndRestore);
        }
        return;
      }

      const anchor = captureCurrentPdfAnchor();
      const scrollState = captureRelativeScrollPosition(viewerContainer);

      if (shouldSyncScale && hasRestoredScrollRef.current) {
        try {
          void Promise.resolve(pdfHighlighter.handleScaleValue()).catch(() => {
            // react-pdf-highlighter may reject while pages are being torn down during
            // rapid file/zoom transitions. Treat that as a transient restore race
            // instead of surfacing an unhandled rejection to the browser console.
          });
        } catch {
          // react-pdf-highlighter can also throw synchronously while the PDF viewer
          // is being re-created during file switches. Treat that the same way as an
          // async rejection and let the restore flow continue.
        }
      }

      cleanupRestore = restorePdfAnchor({
        viewerContainer,
        anchor,
        fallbackScrollState: scrollState,
      });
    };

    frameId = window.requestAnimationFrame(syncScaleAndRestore);
    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      cleanupRestore?.();
    };
  }, [captureCurrentPdfAnchor, fileId, getRenderedPdfPages, getViewerScrollContainer, pdfScaleValue, restorePdfAnchor]);

  useEffect(() => {
    if (zoomMode === "manual") {
      return;
    }

    const container = scrollContainerRef.current;
    const viewerContainer = getViewerScrollContainer();
    if (!container || !viewerContainer) {
      return;
    }

    let frameId = 0;
    const observer = new ResizeObserver(() => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        const anchor = captureCurrentPdfAnchor();
        const scrollState = captureRelativeScrollPosition(viewerContainer);
        restorePdfAnchor({
          viewerContainer,
          anchor,
          fallbackScrollState: scrollState,
        });
      });
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [captureCurrentPdfAnchor, getViewerScrollContainer, restorePdfAnchor, zoomMode]);

  // Apply zoom mode
  const applyZoomMode = useCallback((mode: 'manual' | 'fit-width' | 'fit-page') => {
    setZoomMode(mode);
    // For special modes, we don't need to calculate scale - pdfjs handles it
  }, []);

  // Simple zoom functions
  const zoomIn = useCallback(() => {
    setScale((s) => clampPdfScale(s + ZOOM_STEP, ZOOM_MIN, ZOOM_MAX));
    setZoomMode('manual');
  }, []);

  const zoomOut = useCallback(() => {
    setScale((s) => clampPdfScale(s - ZOOM_STEP, ZOOM_MIN, ZOOM_MAX));
    setZoomMode('manual');
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1.0);
    setZoomMode('manual');
  }, []);

  const commandBarState = useMemo<CommandBarState>(() => {
    const breadcrumbs = filePath.split("/").filter(Boolean).map((segment) => ({ label: segment }));
    return {
      breadcrumbs,
      actions: [
        {
          id: "toggle-sidebar",
          label: t("workbench.commandBar.sidebar"),
          icon: "panel-left",
          active: showSidebar,
          priority: 5,
          group: "utility",
          onTrigger: () => setShowSidebar((value) => !value),
        },
        {
          id: "tool-select",
          label: t("pdf.command.select"),
          icon: "mouse-pointer-2",
          active: activeTool === "select",
          priority: 9,
          group: "primary",
          onTrigger: () => setActiveTool("select"),
        },
        {
          id: "tool-highlight",
          label: t("pdf.command.highlight"),
          icon: "highlighter",
          active: activeTool === "highlight",
          priority: 10,
          group: "primary",
          onTrigger: () => setActiveTool((value) => (value === "highlight" ? "select" : "highlight")),
        },
        {
          id: "tool-underline",
          label: t("pdf.command.underline"),
          icon: "underline",
          active: activeTool === "underline",
          priority: 11,
          group: "primary",
          onTrigger: () => setActiveTool((value) => (value === "underline" ? "select" : "underline")),
        },
        {
          id: "tool-note",
          label: t("pdf.command.note"),
          icon: "sticky-note",
          active: activeTool === "note",
          priority: 20,
          group: "secondary",
          onTrigger: () => setActiveTool((value) => (value === "note" ? "select" : "note")),
        },
        {
          id: "tool-text",
          label: t("pdf.command.text"),
          icon: "type",
          active: activeTool === "text",
          priority: 13,
          group: "primary",
          onTrigger: () => setActiveTool((value) => (value === "text" ? "select" : "text")),
        },
        {
          id: "tool-area",
          label: t("pdf.command.area"),
          icon: "square",
          active: activeTool === "area",
          priority: 14,
          group: "primary",
          onTrigger: () => setActiveTool((value) => (value === "area" ? "select" : "area")),
        },
        {
          id: "tool-draw",
          label: t("pdf.command.draw"),
          icon: "pencil",
          active: activeTool === "ink",
          priority: 21,
          group: "secondary",
          onTrigger: () => setActiveTool((value) => (value === "ink" ? "select" : "ink")),
        },
        {
          id: "fit-width",
          label: t("pdf.fitWidth"),
          icon: "arrow-left-right",
          active: zoomMode === "fit-width",
          priority: 30,
          group: "secondary",
          disabled: zoomMode === "fit-width",
          onTrigger: () => applyZoomMode("fit-width"),
        },
        {
          id: "fit-page",
          label: t("pdf.fitPage"),
          icon: "maximize-2",
          active: zoomMode === "fit-page",
          priority: 31,
          group: "secondary",
          disabled: zoomMode === "fit-page",
          onTrigger: () => applyZoomMode("fit-page"),
        },
        {
          id: "zoom-in",
          label: t("pdf.zoomIn"),
          icon: "zoom-in",
          priority: 32,
          group: "secondary",
          onTrigger: zoomIn,
        },
        {
          id: "zoom-out",
          label: t("pdf.zoomOut"),
          icon: "zoom-out",
          priority: 33,
          group: "secondary",
          onTrigger: zoomOut,
        },
        {
          id: "export",
          label: t("workbench.commandBar.export"),
          icon: "file-output",
          priority: 40,
          group: "secondary",
          onTrigger: () => {
            void exportPdfWithAnnotations(content, annotations, fileName);
          },
        },
      ],
    };
  }, [
    activeTool,
    annotations,
    applyZoomMode,
    content,
    fileName,
    filePath,
    showSidebar,
    t,
    zoomIn,
    zoomMode,
    zoomOut,
  ]);

  usePaneCommandBar({
    paneId,
    state: commandBarState,
  });

  const annotationById = useMemo(() => {
    return new Map(annotations.map((annotation) => [annotation.id, annotation] as const));
  }, [annotations]);

  const transientSelectionPages = useMemo(() => (
    frozenPdfSelection
      ? frozenPdfSelection.pageNumbers
      : []
  ), [frozenPdfSelection]);
  const transientSelectionStyleType = activeTool === "underline" ? "underline" : "highlight";
  const transientSelectionColor = activeColor;

  // Handle Ctrl+Wheel zoom only inside the current pane.
  // CRITICAL for scroll performance: we only register a non-passive wheel handler
  // while Ctrl/Meta is held. When no modifier is pressed, the browser can scroll
  // natively without waiting for JS — this eliminates scroll jank.
  useEffect(() => {
    const handleWheelZoom = (e: WheelEvent) => {
      const viewerScope = scrollContainerRef.current;
      const target = e.target instanceof Node ? e.target : null;
      if (!viewerScope || !target || !viewerScope.contains(target)) {
        return;
      }
      e.preventDefault();
      const delta = getPdfWheelZoomDelta(e.deltaY, ZOOM_STEP);
      setScale((s) => clampPdfScale(s + delta, ZOOM_MIN, ZOOM_MAX));
      setZoomMode('manual');
    };

    let wheelAttached = false;

    const attachWheel = () => {
      if (!wheelAttached) {
        wheelAttached = true;
        document.addEventListener('wheel', handleWheelZoom, { passive: false });
      }
    };

    const detachWheel = () => {
      if (wheelAttached) {
        wheelAttached = false;
        document.removeEventListener('wheel', handleWheelZoom);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') attachWheel();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') detachWheel();
    };
    const onBlur = () => detachWheel();

    document.addEventListener('keydown', onKeyDown, { passive: true });
    document.addEventListener('keyup', onKeyUp, { passive: true });
    window.addEventListener('blur', onBlur, { passive: true });

    return () => {
      detachWheel();
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Handle keyboard shortcuts for zoom and tools
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPdfInteractionActive({ paneId, isPaneActive })) {
        return;
      }

      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Undo/Redo shortcuts (Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z)
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          // Use ink store's undo (it has its own undo stack)
          const inkStore = useInkAnnotationStore.getState();
          if (inkStore.canUndo()) {
            inkStore.undo();
          }
        } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
          e.preventDefault();
          // Use ink store's redo
          const inkStore = useInkAnnotationStore.getState();
          if (inkStore.canRedo()) {
            inkStore.redo();
          }
        } else if (e.key.toLowerCase() === 'c') {
          const copied = handlePdfCopy();
          if (!copied) {
            return;
          }
          e.preventDefault();
        }
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
            break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handlePdfCopy, isPaneActive, paneId, resetZoom, zoomIn, zoomOut]);

  const handlePdfSelectionFinished = useCallback((
    position: unknown,
    rawContent: PdfHighlightContent,
    hideTipAndSelection: () => void,
  ) => {
    const scaledPosition = position as PdfHighlighterScaledPosition;
    const nativeSelectionRange = getNativePdfSelectionRange();
    const rawSelectionText = (rawContent.text ?? "").replace(/\s+/g, " ").trim();
    const nativeSelectionText = (getNativePdfSelectionText() ?? "").replace(/\s+/g, " ").trim();
    const nativeTransientRects = nativeSelectionRange
      ? buildPdfTransientSelectionRectsFromRange(nativeSelectionRange, containerRef.current)
      : undefined;
    const renderedPages = getRenderedPdfPages().map((pageElement) => {
      const pageRect = pageElement.getBoundingClientRect();
      return {
        pageNumber: Number(pageElement.dataset.pageNumber ?? ""),
        width: pageRect.width,
        height: pageRect.height,
      };
    }).filter((page) => Number.isInteger(page.pageNumber) && page.pageNumber > 0 && page.width > 0 && page.height > 0);
    const useNativeSelectionSnapshot = Boolean(
      nativeSelectionRange &&
      nativeSelectionText &&
      nativeTransientRects?.length &&
      (!rawSelectionText || rawSelectionText === nativeSelectionText)
    );
    const selectionText = useNativeSelectionSnapshot
      ? nativeSelectionText
      : rawSelectionText || nativeSelectionText;
    const normalizedContent: PdfHighlightContent = {
      ...rawContent,
      text: selectionText,
    };
    const normalizedTool = activeTool === 'underline'
      ? 'underline'
      : activeTool === 'area'
        ? 'area'
        : activeTool === 'highlight'
          ? 'highlight'
          : 'select';
    const signature = buildPdfSelectionSignature({
      tool: normalizedTool,
      position: scaledPosition,
      content: normalizedContent,
    });
    const selectionToken = pdfSelectionSessionRef.current.token;
    const isAreaSelection = Boolean(rawContent.image && !selectionText.trim());
    const overlayRects = useNativeSelectionSnapshot
      ? nativeTransientRects ?? []
      : projectPdfScaledSelectionToViewportRects({
          scaledPosition,
          pages: renderedPages,
        });

    if (!isAreaSelection && (!selectionText.trim() || overlayRects.length === 0)) {
      hideTipAndSelection();
      clearTransientSelection({ nextPhase: 'cancelled' });
      return null;
    }

    if (isDuplicatePdfSelection(pdfSelectionSessionRef.current, {
      signature,
      token: selectionToken,
    })) {
      hideTipAndSelection();
      return null;
    }

    const nextSnapshot = !isAreaSelection
      ? createPdfSelectionSnapshot({
          text: selectionText,
          scaledPosition,
          overlayRects,
          sourceTrust: useNativeSelectionSnapshot ? "native" : "library",
          signature,
        })
      : null;
    const newHighlight: NewHighlight = {
      position: scaledPosition,
      content: normalizedContent,
      comment: { text: '', emoji: '' },
    };

    if (activeTool === 'area' || isAreaSelection) {
      dismissTransientSelectionTip();
      commitPdfSelectionSession(updatePdfSelectionSession(pdfSelectionSessionRef.current, {
        phase: 'committed',
        snapshot: null,
        token: selectionToken,
      }));
      const annotationData = highlightToAnnotationData(newHighlight, activeColor, 'user', 'area');
      addAnnotation(annotationData);
      clearNativePdfSelectionLater();
      hideTipAndSelection();
      return null;
    }

    if (activeTool === 'highlight' || activeTool === 'underline') {
      const styleType = activeTool === 'underline' ? 'underline' : 'highlight';
      commitPdfSelectionSession(updatePdfSelectionSession(pdfSelectionSessionRef.current, {
        phase: 'committed',
        snapshot: null,
        token: selectionToken,
      }));
      const annotationData = highlightToAnnotationData(newHighlight, activeColor, 'user', styleType);
      addAnnotation(annotationData);
      clearNativePdfSelectionLater();
      hideTipAndSelection();
      return null;
    }

    if (!nextSnapshot) {
      hideTipAndSelection();
      clearTransientSelection({ nextPhase: 'cancelled' });
      return null;
    }

    activateTransientSelection(nextSnapshot, hideTipAndSelection);
    clearNativePdfSelectionLater(2);

    return (
      <ColorPicker
        selectedText={selectionText}
        onColorSelect={(color) => {
          const annotationData = highlightToAnnotationData(newHighlight, color, 'user', 'highlight');
          addAnnotation(annotationData);
          clearTransientSelection({ nextPhase: 'committed' });
        }}
        onCancel={() => clearTransientSelection({ nextPhase: 'cancelled' })}
      />
    );
  }, [
    activeColor,
    activeTool,
    activateTransientSelection,
    addAnnotation,
    clearNativePdfSelectionLater,
    clearTransientSelection,
    commitPdfSelectionSession,
    dismissTransientSelectionTip,
    getNativePdfSelectionRange,
    getNativePdfSelectionText,
    getRenderedPdfPages,
  ]);

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

  const scheduleInkPreviewSync = useCallback(() => {
    if (inkPreviewFrameRef.current !== null) {
      return;
    }

    inkPreviewFrameRef.current = window.requestAnimationFrame(() => {
      inkPreviewFrameRef.current = null;
      setCurrentInkPath([...currentInkPathRef.current]);
      setCurrentInkPage(currentInkPageRef.current);
    });
  }, []);

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
    
    const initialPoint = { x: clampedX, y: clampedY };
    currentInkPageElementRef.current = pageElement instanceof HTMLElement ? pageElement : null;
    currentInkPageRef.current = pageNumber;
    currentInkPathRef.current = [initialPoint];
    setIsDrawingStroke(true);
    setCurrentInkPage(pageNumber);
    setCurrentInkPath([initialPoint]);
    
    event.preventDefault();
    event.stopPropagation();
  }, [activeTool]);

  // Handle ink drawing move
  const handleInkMouseMove = useCallback((event: React.MouseEvent) => {
    if (!isDrawingStroke || activeTool !== 'ink' || currentInkPage === null) return;
    
    const pageElement = currentInkPageElementRef.current;
    if (!pageElement) return;

    const pageRect = pageElement.getBoundingClientRect();
    
    // Calculate normalized coordinates relative to the page
    const x = (event.clientX - pageRect.left) / pageRect.width;
    const y = (event.clientY - pageRect.top) / pageRect.height;
    
    // Clamp to valid range
    const clampedX = Math.max(0, Math.min(1, x));
    const clampedY = Math.max(0, Math.min(1, y));

    const previousPoint = currentInkPathRef.current[currentInkPathRef.current.length - 1];
    if (previousPoint) {
      const deltaX = clampedX - previousPoint.x;
      const deltaY = clampedY - previousPoint.y;
      if ((deltaX * deltaX) + (deltaY * deltaY) < MIN_INK_POINT_DELTA_SQUARED) {
        event.preventDefault();
        return;
      }
    }

    currentInkPathRef.current.push({ x: clampedX, y: clampedY });
    scheduleInkPreviewSync();
    
    event.preventDefault();
  }, [isDrawingStroke, activeTool, currentInkPage, scheduleInkPreviewSync]);

  // Handle ink drawing end - now uses stroke buffer for merging
  const handleInkMouseUp = useCallback(() => {
    const inkPage = currentInkPageRef.current;
    const inkPath = currentInkPathRef.current;

    if (!isDrawingStroke || inkPage === null || inkPath.length < 2) {
      currentInkPageElementRef.current = null;
      currentInkPageRef.current = null;
      currentInkPathRef.current = [];
      setIsDrawingStroke(false);
      setCurrentInkPath([]);
      setCurrentInkPage(null);
      return;
    }

    // Add stroke to buffer instead of creating annotation immediately
    const stroke: InkStroke = {
      points: inkPath.map(p => ({ x: p.x, y: p.y })),
      page: inkPage,
      color: activeColor,
    };
    
    addInkStroke(stroke);
    
    // Clear current stroke state
    currentInkPageElementRef.current = null;
    currentInkPageRef.current = null;
    currentInkPathRef.current = [];
    setIsDrawingStroke(false);
    setCurrentInkPath([]);
    setCurrentInkPage(null);
  }, [isDrawingStroke, activeColor, addInkStroke]);

  // Handle text annotation save
  const handleSaveTextAnnotation = useCallback((text: string, textColor: string, fontSize: number, bgColor: string) => {
    if (!textAnnotationPosition || !text.trim()) {
      setTextAnnotationPosition(null);
      return;
    }

    const pageElement = findPdfPageElementInScope(containerRef.current, textAnnotationPosition.page);
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
        type: 'text', // Use 'text' type for text annotations
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
        type: 'text',
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

      const pageElement = findPdfPageElementInScope(containerRef.current, pendingPin.page);
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
    setShowSidebar(true);
    setSelectedAnnotationId(annotation.id);
    setHighlightedId(annotation.id);

    if (annotation.target.type === 'pdf') {
      const target = annotation.target as PdfTarget;
      const pageElement = findPdfPageElementInScope(containerRef.current, target.page);
      const container = getViewerScrollContainer();

      if (!pageElement || !container) {
        // Fallback: try scrolling to page later
        scheduleTimeout(() => {
          const retryPage = findPdfPageElementInScope(containerRef.current, target.page);
          if (retryPage) {
            retryPage.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 100);
        scheduleTimeout(() => setHighlightedId(null), 2000);
        return;
      }

      // Use IntersectionObserver for more reliable scroll completion detection
      const observer = new IntersectionObserver((entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && entry.intersectionRatio > 0.3) {
          observer.disconnect();

          // Wait a frame for rendering to stabilize
          requestAnimationFrame(() => {
            if (target.rects.length > 0) {
              const pageRect = pageElement.getBoundingClientRect();
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

              // Second scroll to fine-tune position after page is visible
              container.scrollTo({
                top: Math.max(0, targetScrollTop),
                left: Math.max(0, targetScrollLeft),
                behavior: 'smooth'
              });
            }
          });
        }
      }, { threshold: [0.3, 0.5, 0.8] });

      observer.observe(pageElement);

      // Initial scroll to bring page into view
      pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Timeout fallback to disconnect observer if page never becomes visible
      scheduleTimeout(() => {
        observer.disconnect();
      }, 3000);
    }

    // Clear highlight after animation
    scheduleTimeout(() => setHighlightedId(null), 2500);
  }, [getViewerScrollContainer, scheduleTimeout]);

  // Handle sidebar delete
  const handleSidebarDelete = useCallback((id: string) => {
    deleteAnnotation(id);
    if (selectedAnnotationId === id) {
      setSelectedAnnotationId(null);
    }
  }, [deleteAnnotation, selectedAnnotationId]);

  useAnnotationNavigation({
    handlers: {
      onPdfNavigate: (page, annotationId) => {
        setShowSidebar(true);
        const annotation = annotationById.get(annotationId);
        if (annotation) {
          handleSidebarSelect(annotation);
          return;
        }

        const pageElement = findPdfPageElementInScope(containerRef.current, page);
        if (pageElement) {
          setSelectedAnnotationId(annotationId);
          setHighlightedId(annotationId);
          pageElement.scrollIntoView({ behavior: "smooth", block: "center" });
          scheduleTimeout(() => flashPdfElement(pageElement), 120);
          scheduleTimeout(() => setHighlightedId(null), 2000);
        }
      },
    },
  });

  useEffect(() => {
    if (!pendingNavigation || !isSameWorkspacePath(pendingNavigation.filePath, filePath)) {
      return;
    }

    const attemptNavigation = () => {
      const pendingTarget = pendingNavigation.target;

      if (pendingTarget.type === "pdf_page") {
        const pageElement = findPdfPageElementInScope(containerRef.current, pendingTarget.page);
        if (!pageElement) return false;
        pageElement.scrollIntoView({ behavior: "smooth", block: "center" });
        scheduleTimeout(() => flashPdfElement(pageElement), 120);
        consumePendingNavigation(paneId, filePath);
        return true;
      }

      if (pendingTarget.type === "pdf_annotation") {
        const annotation = annotationById.get(pendingTarget.annotationId);
        if (!annotation) return false;
        handleSidebarSelect(annotation);
        consumePendingNavigation(paneId, filePath);
        return true;
      }

      return false;
    };

    if (attemptNavigation()) {
      return;
    }

    let attemptsLeft = 24;
    let frameId = 0;
    const retry = () => {
      attemptsLeft -= 1;
      if (attemptNavigation() || attemptsLeft <= 0) {
        return;
      }
      frameId = window.requestAnimationFrame(retry);
    };

    frameId = window.requestAnimationFrame(retry);
    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [annotationById, consumePendingNavigation, filePath, flashPdfElement, handleSidebarSelect, paneId, pendingNavigation, scheduleTimeout]);

  if (annotationsError) {
    console.error('Annotation error:', annotationsError);
  }
  if (pdfItemError) {
    console.error("PDF item workspace error:", pdfItemError);
  }

  const renderPdfViewport = (fillHeight: boolean) => (
    <div
      ref={scrollContainerRef}
      className={`relative flex-1 min-h-0 min-w-0 overflow-auto bg-muted/30${fillHeight ? " h-full" : ""}`}
      data-testid={`pdf-scroll-container-${paneId}`}
      onPointerDownCapture={beginNativePdfSelectionInteraction}
      onClick={activeTool === 'note' || activeTool === 'text' ? handlePdfClick : undefined}
      onMouseDown={activeTool === 'ink' ? handleInkMouseDown : undefined}
      onMouseMove={activeTool === 'ink' || isDrawingStroke ? handleInkMouseMove : undefined}
      onMouseUp={activeTool === 'ink' || isDrawingStroke ? handleInkMouseUp : undefined}
      onMouseLeave={activeTool === 'ink' || isDrawingStroke ? handleInkMouseUp : undefined}
      style={{
        cursor: activeTool === 'note'
          ? 'crosshair'
          : activeTool === 'area'
            ? 'crosshair'
            : activeTool === 'ink'
              ? 'crosshair'
              : activeTool === 'text'
                ? 'text'
                : 'default',
      }}
    >
      {pdfUrl ? (
        <PdfLoader
          url={pdfUrl}
          beforeLoad={
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">{t("pdf.loading")}</span>
            </div>
          }
        >
          {(pdfDocument) => (
            <PdfHighlighter
              ref={pdfHighlighterRef}
              pdfDocument={pdfDocument}
              enableAreaSelection={(event) => event.altKey || activeTool === 'area'}
              onSelectionFinished={handlePdfSelectionFinished}
              highlightTransform={(
                highlight,
                index,
                setTip,
                hideTip,
                viewportToScaled,
                screenshot,
                isScrolledTo
              ) => {
                const annotation = annotationById.get(highlight.id);
                const isPin = annotation && isPinAnnotation(annotation);
                const isHighlighted = highlightedId === highlight.id;
                const isActive = hoveredAnnotationId === highlight.id || selectedAnnotationId === highlight.id;

                if (
                  annotation?.style.type === 'area' &&
                  !annotation.preview &&
                  !pendingAreaPreviewBackfillRef.current.has(annotation.id)
                ) {
                  pendingAreaPreviewBackfillRef.current.add(annotation.id);
                  scheduleTimeout(() => {
                    const preview = buildPdfAreaPreview({
                      dataUrl: highlight.content.image || screenshot(highlight.position.boundingRect),
                      width: highlight.position.boundingRect.width || 0,
                      height: highlight.position.boundingRect.height || 0,
                    });

                    if (preview) {
                      updateAnnotation(annotation.id, { preview });
                    }
                    pendingAreaPreviewBackfillRef.current.delete(annotation.id);
                  }, 0);
                }

                const handleChangeColor = (color: string) => {
                  if (annotation) {
                    updateAnnotation(highlight.id, { style: { color } });
                  }
                  hideTip();
                };

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
                  return (
                    <div
                      key={highlight.id}
                      className={`absolute cursor-pointer transition-transform ${
                        isHighlighted ? 'animate-pulse scale-125' : isActive ? 'scale-110' : ''
                      }`}
                      style={{
                        left: position.boundingRect.left,
                        top: position.boundingRect.top,
                        transform: 'translate(-50%, -100%)',
                      }}
                      onClick={() => {
                        setSelectedAnnotationId(highlight.id);
                        setHighlightedId(highlight.id);
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
                        {pinComment && (
                          <div
                            className="mt-1 max-w-[150px] whitespace-pre-wrap break-words rounded border border-amber-300 bg-amber-100 px-2 py-1 text-xs text-amber-900 shadow-sm dark:border-amber-700 dark:bg-amber-900/80 dark:text-amber-100"
                            style={{ transform: 'translateX(50%)' }}
                          >
                            {pinComment}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

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
                    onMouseOut={() => {
                      setHoveredAnnotationId(null);
                      hideTip();
                    }}
                    key={highlight.id}
                  >
                    <div
                      onMouseEnter={() => setHoveredAnnotationId(highlight.id)}
                      onMouseLeave={() => setHoveredAnnotationId(null)}
                      onClick={() => {
                        setSelectedAnnotationId(highlight.id);
                        setHighlightedId(highlight.id);
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
                        isScrolledTo={isScrolledTo || isHighlighted || isActive}
                        position={highlight.position}
                        color={highlightColor}
                        styleType={highlightStyleType}
                        isActive={isActive || isHighlighted}
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
      ) : (
        <div className="flex items-center justify-center gap-2 py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">{t("pdf.loading")}</span>
        </div>
      )}

      {frozenPdfSelection && transientSelectionPages.map((page) => (
        <PdfTransientSelectionPortal
          key={`${frozenPdfSelection.signature}-${page}`}
          selection={frozenPdfSelection}
          paneId={paneId}
          page={page}
          paneRootRef={containerRef}
          color={transientSelectionColor}
          styleType={transientSelectionStyleType}
        />
      ))}

      {inkAnnotations.map((ann) => {
        if (ann.target.type !== 'pdf') return null;
        const target = ann.target as PdfTarget;
        return (
          <InkAnnotationPortal
            key={ann.id}
            annotation={ann}
            page={target.page}
            scale={scale}
            paneRootRef={containerRef}
          />
        );
      })}

      {textAnnotations.map((ann) => {
        if (ann.target.type !== 'pdf') return null;
        const target = ann.target as PdfTarget;
        return (
          <TextAnnotationPortal
            key={ann.id}
            annotation={ann}
            page={target.page}
            scale={scale}
            paneRootRef={containerRef}
            isHighlighted={highlightedId === ann.id || hoveredAnnotationId === ann.id || selectedAnnotationId === ann.id}
            onClick={() => {
              const pageElement = findPdfPageElementInScope(containerRef.current, target.page);
              if (pageElement && target.rects.length > 0) {
                const pageRect = pageElement.getBoundingClientRect();
                const rect = target.rects[0];
                const x = pageRect.left + ((rect.x1 + rect.x2) / 2 * pageRect.width);
                const y = pageRect.top + (rect.y1 * pageRect.height);

                setEditingTextAnnotation({
                  annotation: ann,
                  position: { x, y },
                });
                setSelectedAnnotationId(ann.id);
              }
            }}
          />
        );
      })}

      {currentInkPage !== null && currentInkPath.length > 0 && (
        <CurrentInkPathPortal
          path={currentInkPath}
          page={currentInkPage}
          color={activeColor}
          scale={scale}
          paneRootRef={containerRef}
        />
      )}

      <InkSessionIndicator
        isDrawing={isInkBuffering}
        strokeCount={inkStrokeCount}
        onFinalize={finalizeInkNow}
        onCancel={cancelInkDrawing}
      />
    </div>
  );

  return (
    <div
      ref={containerRef}
      className="lattice-pdf-viewer relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      data-file-id={fileId}
      data-pane-id={paneId}
      data-transient-selection-active={frozenPdfSelection ? "true" : "false"}
      data-testid={`pdf-pane-${paneId}`}
    >
      <SelectionContextMenu
        state={selectionMenuState}
        onClose={closeSelectionMenu}
        onOpenHub={(context, mode, returnFocusTo) => setSelectionHubState({ context, mode, returnFocusTo })}
      />

      <SelectionAiHub
        context={selectionHubState?.context ?? null}
        initialMode={selectionHubState?.mode ?? 'chat'}
        returnFocusTo={selectionHubState?.returnFocusTo}
        onClose={() => setSelectionHubState(null)}
      />

      {/* Error banner */}
      {annotationsError && (
        <div className="bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          {t("common.error")}: {annotationsError}
        </div>
      )}
      {activeTool !== 'select' ? (
        <div className="pointer-events-none absolute bottom-4 left-4 z-20 rounded-md border border-border bg-background/92 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
          <span className="font-medium text-foreground">
            {activeTool === 'highlight'
              ? t("pdf.highlightHint")
              : activeTool === 'underline'
                ? t("pdf.underlineHint")
                : activeTool === 'note'
                  ? t("pdf.noteHint")
                  : activeTool === 'text'
                    ? t("pdf.textAnnotation.addTitle")
                    : activeTool === 'area'
                      ? t("pdf.areaHint")
                      : t("pdf.drawHint")}
          </span>
        </div>
      ) : null}

      <span className="sr-only" data-testid={`pdf-zoom-label-${paneId}`}>
        {zoomMode === 'fit-width' ? t("pdf.fitWidth") : zoomMode === 'fit-page' ? t("pdf.fitPage") : `${Math.round(scale * 100)}%`}
      </span>

      {isDiagnosticsMode ? (
        <div className="sr-only" aria-hidden="true">
          <span data-testid={`pdf-anchor-page-${paneId}`}>{currentAnchorDebug?.pageNumber ?? 0}</span>
          <span data-testid={`pdf-anchor-top-ratio-${paneId}`}>{currentAnchorDebug?.pageOffsetTopRatio ?? -1}</span>
          <span data-testid={`pdf-anchor-left-ratio-${paneId}`}>{currentAnchorDebug?.pageOffsetLeftRatio ?? -1}</span>
          <span data-testid={`pdf-anchor-revision-${paneId}`}>{currentAnchorDebug?.captureRevision ?? 0}</span>
          <span data-testid={`pdf-restore-status-${paneId}`}>{restoreDebugState.status}</span>
          <span data-testid={`pdf-restore-ok-${paneId}`}>{restoreDebugState.ok ? 'true' : 'false'}</span>
          <span data-testid={`pdf-restore-expected-page-${paneId}`}>{restoreDebugState.expectedPage ?? 0}</span>
          <span data-testid={`pdf-restore-actual-page-${paneId}`}>{restoreDebugState.actualPage ?? 0}</span>
          <span data-testid={`pdf-restore-delta-top-${paneId}`}>{restoreDebugState.deltaTopRatio ?? -1}</span>
          <span data-testid={`pdf-restore-delta-left-${paneId}`}>{restoreDebugState.deltaLeftRatio ?? -1}</span>
          <span data-testid={`pdf-selection-phase-${paneId}`}>{pdfSelectionSession.phase}</span>
          <span data-testid={`pdf-selection-source-${paneId}`}>{frozenPdfSelection?.sourceTrust ?? "none"}</span>
          <span data-testid={`pdf-selection-preview-${paneId}`}>{frozenPdfSelection?.text ?? ""}</span>
          <span data-testid={`pdf-selection-page-count-${paneId}`}>{frozenPdfSelection?.pageNumbers.length ?? 0}</span>
          <span data-testid={`pdf-copy-payload-${paneId}`}>{getActivePdfSelectionText()}</span>
        </div>
      ) : null}

      {/* Main content area with PDF and sidebar */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {showSidebar ? (
          <ResizablePanelGroup
            direction="horizontal"
            className="min-h-0 min-w-0 flex-1"
            sizes={[sidebarSize, 100 - sidebarSize]}
            onSizesChange={(sizes) => {
              if (sizes[0]) {
                setSidebarSize(Math.min(42, Math.max(18, sizes[0])));
              }
            }}
          >
            <ResizablePanel index={0} defaultSize={sidebarSize} minSize={18} maxSize={42} className="min-h-0 overflow-hidden">
              <div className="h-full border-r border-border bg-background overflow-hidden flex flex-col">
                <PdfItemWorkspacePanel
                  rootHandle={rootHandle}
                  fileId={manifestSeedId}
                  fileName={fileName}
                  filePath={filePath}
                  paneId={paneId}
                  annotations={annotations}
                />
                <div className="min-h-0 flex-1 overflow-hidden">
                  <PdfAnnotationSidebar
                    annotations={annotations}
                    selectedId={selectedAnnotationId}
                    onSelect={handleSidebarSelect}
                    onHoverChange={(annotation) => setHoveredAnnotationId(annotation?.id ?? null)}
                    paneId={paneId}
                    rootHandle={rootHandle}
                    currentFilePath={filePath}
                    backlinksById={backlinksByAnnotation}
                    onNavigateBacklink={(backlink) => {
                      void navigateLink(buildBacklinkNavigationTarget(backlink), {
                        paneId,
                        rootHandle,
                        currentFilePath: filePath,
                      });
                    }}
                    onDelete={handleSidebarDelete}
                    onUpdateColor={(id, color) => {
                      updateAnnotation(id, { style: { color } });
                    }}
                    onUpdateComment={(id, comment) => updateAnnotation(id, { comment })}
                    onConvertToUnderline={(id) => {
                      const ann = annotationById.get(id);
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
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle index={0} />
            <ResizablePanel index={1} defaultSize={100 - sidebarSize} minSize={40} className="min-h-0 overflow-hidden">
              {renderPdfViewport(true)}
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          renderPdfViewport(false)
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
