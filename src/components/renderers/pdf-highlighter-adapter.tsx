"use client";

/**
 * PDF Highlighter Adapter
 * 
 * Integrates the PDF annotation runtime with the Universal Annotation Manager.
 * Provides text selection highlighting and Pin Mode for sticky notes.
 */

import React, { memo, useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import ReactDOM from "react-dom";
import { usePathname } from "next/navigation";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Document, Page, pdfjs } from "react-pdf";
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
import { HIGHLIGHT_COLORS, BACKGROUND_COLORS, TEXT_COLORS, TEXT_FONT_SIZES, DEFAULT_TEXT_STYLE, DEFAULT_HIGHLIGHT_COLOR, hexToRGB, resolveHighlightColor } from "@/lib/annotation-colors";
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
import type { PendingPaneNavigation } from "@/stores/link-navigation-store";
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
import { getDesktopPreviewPath, readDesktopFileBytesRaw } from "@/lib/desktop-preview";
import {
  clearDesktopPdfPageTextLayoutCache,
  getDesktopPdfPageTextLayout,
  getDesktopPdfPath,
  peekDesktopPdfPageTextLayout,
  prefetchDesktopPdfPageTextLayout,
} from "@/lib/pdf-native-text-engine";
import { createLatestRunGuard, withTimeout } from "@/lib/async-task-guard";
import { resolvePdfDocumentBinding, type ResolvedPdfDocumentBinding } from "@/lib/pdf-document-binding";
import {
  ensurePdfItemWorkspace,
  ensurePdfItemWorkspaceForBinding,
  loadPdfItemManifest,
  loadPdfItemManifestForBinding,
  syncPdfManagedFiles,
  syncPdfAnnotationsMarkdown,
  type PdfItemManifest,
} from "@/lib/pdf-item";
import { generateFileId } from "@/lib/universal-annotation-storage";
import {
  buildBacklinkNavigationTarget,
  getBacklinkIndex,
  getBacklinksForAnnotation,
  scanWorkspaceMarkdownBacklinks,
  type AnnotationBacklink,
} from "@/lib/annotation-backlinks";
import { navigateLink } from "@/lib/link-router/navigate-link";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { copyToClipboard } from "@/lib/clipboard";
import {
  buildPdfEditorState,
  calculatePdfFitScale,
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
  resolvePdfCopySelectionText,
  type PdfSelectionSnapshot,
  type PdfSelectionSessionState,
  updatePdfSelectionSession,
} from "@/lib/pdf-selection-session";
import { buildPersistedFileViewStateKey, loadPersistedFileViewState, savePersistedFileViewState } from "@/lib/file-view-state";
import { logger } from "@/lib/logger";
import {
  createPinAnnotation as createPdfPinAnnotation,
  isPinAnnotation,
} from "@/lib/pdf-highlight-mapping";
import type { BinaryViewerContent } from "@/types/viewer-content";
import { getCanonicalPdfAnnotationText } from "@/types/universal-annotation";
import {
  resolvePdfSelectionFromNativeRange,
  type PdfResolvedSelection,
} from "@/lib/pdf-selection-reconciler";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import "./pdf-highlighter-adapter.css";

// ============================================================================
// Types
// ============================================================================

interface PDFHighlighterAdapterProps {
  source: BinaryViewerContent;
  fileName: string;
  fileHandle: FileSystemFileHandle;
  rootHandle: FileSystemDirectoryHandle;
  paneId: PaneId;
  fileId: string;
  filePath: string;
  binding?: ResolvedPdfDocumentBinding | null;
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

interface NativePdfSelectionSnapshot {
  text: string;
  range: Range;
  clientRects: Array<{ left: number; right: number; top: number; bottom: number }>;
  dragStartPoint?: { x: number; y: number } | null;
  dragEndPoint?: { x: number; y: number } | null;
  capturedAt: number;
  token: number;
}

function dedupeAnnotationsById<T extends AnnotationItem>(annotations: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index];
    if (seen.has(annotation.id)) {
      continue;
    }
    seen.add(annotation.id);
    deduped.unshift(annotation);
  }

  return deduped;
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

function buildPdfPreviewRect(input: {
  rects: PdfTarget["rects"];
  pageWidth: number;
  pageHeight: number;
  paddingRatio: number;
  minCssWidth: number;
  minCssHeight: number;
}): PdfTarget["rects"][number] | null {
  const validRects = input.rects.filter((rect) => (
    Number.isFinite(rect.x1) &&
    Number.isFinite(rect.y1) &&
    Number.isFinite(rect.x2) &&
    Number.isFinite(rect.y2) &&
    rect.x2 > rect.x1 &&
    rect.y2 > rect.y1
  ));

  if (validRects.length === 0 || input.pageWidth <= 0 || input.pageHeight <= 0) {
    return null;
  }

  const unionLeft = Math.max(0, Math.min(...validRects.map((rect) => rect.x1)));
  const unionTop = Math.max(0, Math.min(...validRects.map((rect) => rect.y1)));
  const unionRight = Math.min(1, Math.max(...validRects.map((rect) => rect.x2)));
  const unionBottom = Math.min(1, Math.max(...validRects.map((rect) => rect.y2)));
  if (unionRight <= unionLeft || unionBottom <= unionTop) {
    return null;
  }

  const minWidth = Math.min(1, input.minCssWidth / input.pageWidth);
  const minHeight = Math.min(1, input.minCssHeight / input.pageHeight);
  const centerX = (unionLeft + unionRight) / 2;
  const centerY = (unionTop + unionBottom) / 2;
  const halfWidth = Math.max((unionRight - unionLeft) / 2 + input.paddingRatio, minWidth / 2);
  const halfHeight = Math.max((unionBottom - unionTop) / 2 + input.paddingRatio, minHeight / 2);

  let x1 = centerX - halfWidth;
  let x2 = centerX + halfWidth;
  let y1 = centerY - halfHeight;
  let y2 = centerY + halfHeight;

  if (x1 < 0) {
    x2 = Math.min(1, x2 - x1);
    x1 = 0;
  }
  if (x2 > 1) {
    x1 = Math.max(0, x1 - (x2 - 1));
    x2 = 1;
  }
  if (y1 < 0) {
    y2 = Math.min(1, y2 - y1);
    y1 = 0;
  }
  if (y2 > 1) {
    y1 = Math.max(0, y1 - (y2 - 1));
    y2 = 1;
  }

  return { x1, y1, x2, y2 };
}

function buildPdfAnnotationPreviewFromPageElement(
  pageElement: HTMLElement | null,
  rects: PdfTarget["rects"],
  options?: {
    paddingRatio?: number;
    minCssWidth?: number;
    minCssHeight?: number;
  },
): AnnotationItem["preview"] | undefined {
  if (!pageElement) {
    return undefined;
  }

  const canvas = pageElement.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    return undefined;
  }

  const pageRect = pageElement.getBoundingClientRect();
  const previewRect = buildPdfPreviewRect({
    rects,
    pageWidth: pageRect.width,
    pageHeight: pageRect.height,
    paddingRatio: options?.paddingRatio ?? 0.012,
    minCssWidth: options?.minCssWidth ?? 96,
    minCssHeight: options?.minCssHeight ?? 72,
  });
  if (!previewRect) {
    return undefined;
  }

  const cropX = Math.max(0, Math.floor(previewRect.x1 * canvas.width));
  const cropY = Math.max(0, Math.floor(previewRect.y1 * canvas.height));
  const cropRight = Math.min(canvas.width, Math.ceil(previewRect.x2 * canvas.width));
  const cropBottom = Math.min(canvas.height, Math.ceil(previewRect.y2 * canvas.height));
  const cropWidth = Math.max(1, cropRight - cropX);
  const cropHeight = Math.max(1, cropBottom - cropY);
  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = cropWidth;
  previewCanvas.height = cropHeight;
  const context = previewCanvas.getContext("2d");

  if (!context) {
    return undefined;
  }

  context.drawImage(
    canvas,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight,
  );

  return buildPdfAreaPreview({
    dataUrl: previewCanvas.toDataURL("image/png"),
    width: cropWidth,
    height: cropHeight,
  }) ?? undefined;
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

function toHighlightFillColor(color: string): string {
  const resolved = resolveHighlightColor(color);
  if (resolved === "transparent") {
    return "transparent";
  }
  const rgb = hexToRGB(resolved);
  return `rgba(${Math.round(rgb.r * 255)}, ${Math.round(rgb.g * 255)}, ${Math.round(rgb.b * 255)}, 0.36)`;
}

function ensurePdfPageOverlayContainer(input: {
  paneRootRef: React.RefObject<HTMLElement | null>;
  page: number;
  overlayClassName: string;
  overlayStyle: string;
}): { pageElement: HTMLElement; overlay: HTMLElement } | null {
  const pageElement = findPdfPageElementInScope(input.paneRootRef.current, input.page);
  if (!pageElement) {
    return null;
  }

  const computedStyle = window.getComputedStyle(pageElement);
  if (computedStyle.position === 'static') {
    pageElement.style.position = 'relative';
  }

  let overlay = pageElement.querySelector(`.${input.overlayClassName}`) as HTMLElement | null;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = input.overlayClassName;
    overlay.style.cssText = input.overlayStyle;
    pageElement.appendChild(overlay);
  }

  return { pageElement, overlay };
}

function usePdfPageOverlayContainer(input: {
  paneRootRef: React.RefObject<HTMLElement | null>;
  page: number;
  overlayClassName: string;
  overlayStyle: string;
  dependencyKey?: string;
}): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const {
    paneRootRef,
    page,
    overlayClassName,
    overlayStyle,
    dependencyKey,
  } = input;

  useEffect(() => {
    let disposed = false;
    let frameId = 0;
    let observer: MutationObserver | null = null;
    let mountedOverlay: HTMLElement | null = null;

    const tryAttach = () => {
      const attached = ensurePdfPageOverlayContainer({
        paneRootRef,
        page,
        overlayClassName,
        overlayStyle,
      });
      if (!attached) {
        return false;
      }

      mountedOverlay = attached.overlay;
      if (!disposed) {
        setContainer(attached.overlay);
      }
      return true;
    };

    if (!tryAttach()) {
      const root = paneRootRef.current;
      if (root) {
        observer = new MutationObserver(() => {
          if (tryAttach()) {
            observer?.disconnect();
            observer = null;
          }
        });
        observer.observe(root, { childList: true, subtree: true });
      }

      const retryAttach = () => {
        if (disposed) {
          return;
        }
        if (tryAttach()) {
          return;
        }
        frameId = window.requestAnimationFrame(retryAttach);
      };
      frameId = window.requestAnimationFrame(retryAttach);
    }

    return () => {
      disposed = true;
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      observer?.disconnect();
      if (mountedOverlay?.parentNode) {
        mountedOverlay.parentNode.removeChild(mountedOverlay);
      }
      setContainer(null);
    };
  }, [dependencyKey, overlayClassName, overlayStyle, page, paneRootRef]);

  return container;
}

function buildAbsoluteClientRectsFromRange(range: Range): DOMRect[] {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  if (rects.length > 0) {
    return rects;
  }

  const boundingRect = range.getBoundingClientRect();
  if (boundingRect.width > 0 && boundingRect.height > 0) {
    return [boundingRect];
  }

  return [];
}

type PopupHorizontalAlign = "start" | "center" | "end";
type PopupPreferredPlacement = "below" | "above" | "right" | "left";

function buildPopupRect(x: number, y: number, popupSize: PopupSize): DOMRect {
  return new DOMRect(x, y, popupSize.width, popupSize.height);
}

function rectsOverlap(left: DOMRect, right: DOMRect): boolean {
  return !(
    left.right <= right.left ||
    right.right <= left.left ||
    left.bottom <= right.top ||
    right.bottom <= left.top
  );
}

function getAnchoredPopupPosition(
  anchorRect: DOMRect,
  popupSize: PopupSize,
  options?: {
    gap?: number;
    horizontalAlign?: PopupHorizontalAlign;
    preferredPlacement?: PopupPreferredPlacement;
  },
): { x: number; y: number } {
  const gap = options?.gap ?? 6;
  const horizontalAlign = options?.horizontalAlign ?? "center";
  const preferredPlacement = options?.preferredPlacement ?? "below";

  const alignedX = horizontalAlign === "start"
    ? anchorRect.left
    : horizontalAlign === "end"
      ? anchorRect.right - popupSize.width
      : anchorRect.left + (anchorRect.width / 2) - (popupSize.width / 2);

  const candidates: Array<{
    placement: PopupPreferredPlacement;
    position: { x: number; y: number };
    rect: DOMRect;
    overlapsAnchor: boolean;
    distance: number;
    priority: number;
  }> = [];

  const placementOrder: PopupPreferredPlacement[] = (() => {
    switch (preferredPlacement) {
      case "above":
        return ["above", "right", "left", "below"];
      case "right":
        return ["right", "below", "above", "left"];
      case "left":
        return ["left", "below", "above", "right"];
      case "below":
      default:
        return ["below", "right", "left", "above"];
    }
  })();

  const addCandidate = (placement: PopupPreferredPlacement, desiredX: number, desiredY: number) => {
    const adjusted = adjustPopupPosition({ x: desiredX, y: desiredY }, popupSize, 8);
    const rect = buildPopupRect(adjusted.x, adjusted.y, popupSize);
    const overlapsAnchor = rectsOverlap(anchorRect, rect);
    const distance = placement === "below"
      ? Math.abs(rect.top - (anchorRect.bottom + gap))
      : placement === "above"
        ? Math.abs(rect.bottom - (anchorRect.top - gap))
        : placement === "right"
          ? Math.abs(rect.left - (anchorRect.right + gap))
          : Math.abs(rect.right - (anchorRect.left - gap));
    candidates.push({
      placement,
      position: adjusted,
      rect,
      overlapsAnchor,
      distance,
      priority: placementOrder.indexOf(placement),
    });
  };

  addCandidate("below", alignedX, anchorRect.bottom + gap);
  addCandidate("above", alignedX, anchorRect.top - popupSize.height - gap);
  addCandidate("right", anchorRect.right + gap, anchorRect.top);
  addCandidate("left", anchorRect.left - popupSize.width - gap, anchorRect.top);

  candidates.sort((left, right) => (
    Number(left.overlapsAnchor) - Number(right.overlapsAnchor) ||
    left.priority - right.priority ||
    left.distance - right.distance
  ));

  return candidates[0]?.position ?? adjustPopupPosition({ x: alignedX, y: anchorRect.bottom + gap }, popupSize, 8);
}

function useMeasuredPopupSize(
  popupRef: React.RefObject<HTMLDivElement | null>,
  fallback: PopupSize,
  dependencyKey: string,
): PopupSize {
  const [popupSize, setPopupSize] = useState<PopupSize>(fallback);

  useLayoutEffect(() => {
    const element = popupRef.current;
    if (!element) {
      return;
    }

    const update = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }
      setPopupSize((current) => (
        Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
          ? current
          : { width: rect.width, height: rect.height }
      ));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [dependencyKey, popupRef]);

  return popupSize;
}

// Annotation tool types (Zotero-style)
type AnnotationTool = 'select' | 'highlight' | 'underline' | 'note' | 'text' | 'area' | 'ink';
type PdfAnnotationDefaultTool = Exclude<AnnotationTool, 'select'>;

interface PdfAnnotationDefaultsMenuState {
  tool: PdfAnnotationDefaultTool;
  position: { x: number; y: number };
}

const MIN_INK_POINT_DELTA_SQUARED = 0.000004;
const MIN_SCROLL_OVERFLOW_PX = 24;
const DOM_SELECTION_SETTLE_WINDOW_MS = 140;
const PAGE_BUFFER = 2;
const ESTIMATED_PAGE_HEIGHT = 842;
const ESTIMATED_PAGE_WIDTH = 595;

const reactPdfWorkerUrl = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
pdfjs.GlobalWorkerOptions.workerSrc = reactPdfWorkerUrl;

interface AdapterVirtualPageProps {
  pageNumber: number;
  scale: number;
  devicePixelRatio?: number;
  isVisible: boolean;
  measuredHeight: number | null;
  measuredWidth: number | null;
  onMeasure: (pageNumber: number, width: number, height: number) => void;
  observer: IntersectionObserver | null;
}

const AdapterVirtualPage = memo(function AdapterVirtualPage({
  pageNumber,
  scale,
  devicePixelRatio,
  isVisible,
  measuredHeight,
  measuredWidth,
  onMeasure,
  observer,
}: AdapterVirtualPageProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = sentinelRef.current;
    if (!element || !observer) {
      return;
    }

    observer.observe(element);
    return () => observer.unobserve(element);
  }, [observer]);

  const placeholderWidth = measuredWidth ? measuredWidth * scale : ESTIMATED_PAGE_WIDTH * scale;
  const placeholderHeight = measuredHeight ? measuredHeight * scale : ESTIMATED_PAGE_HEIGHT * scale;

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
      data-pdf-page-visible={isVisible ? "true" : "false"}
      data-pdf-page-measured={measuredHeight && measuredWidth ? "true" : "false"}
      className="relative"
      style={{ minHeight: placeholderHeight, minWidth: placeholderWidth }}
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
              style={{ width: placeholderWidth, height: placeholderHeight }}
            >
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          }
        />
      ) : (
        <div
          className="flex items-center justify-center bg-white/60 shadow-lg"
          style={{ width: placeholderWidth, height: placeholderHeight }}
        />
      )}
    </div>
  );
});

function resolvedTextSelectionToAnnotationData(input: {
  selection: PdfResolvedSelection;
  color: string;
  author: string;
  styleType: 'highlight' | 'underline';
}): Omit<AnnotationItem, 'id' | 'createdAt'> {
  return {
    target: {
      type: 'pdf',
      page: input.selection.pageNumber,
      rects: input.selection.pageRects,
      textQuote: input.selection.textQuote,
    },
    style: {
      color: resolveHighlightColor(input.color),
      type: input.styleType,
    },
    content: input.selection.textQuote.exact,
    author: input.author,
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

interface PdfSelectionDraftMenuProps {
  selection: PdfResolvedSelection;
  position: { x: number; y: number };
  anchorRect?: DOMRect | null;
  onColorSelect: (color: string) => void;
  onCancel: () => void;
}

function PdfSelectionDraftMenu({ selection, position, anchorRect, onColorSelect, onCancel }: PdfSelectionDraftMenuProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const popupSize = useMeasuredPopupSize(
    popupRef,
    { width: 184, height: 360 },
    `${selection.text}:${anchorRect?.left ?? 0}:${anchorRect?.top ?? 0}:${anchorRect?.width ?? 0}:${anchorRect?.height ?? 0}`,
  );
  const adjustedPosition = anchorRect
    ? getAnchoredPopupPosition(anchorRect, popupSize, { gap: 4, horizontalAlign: "start", preferredPlacement: "below" })
    : adjustPopupPosition(position, popupSize, 20);

  return ReactDOM.createPortal(
    <div
      ref={popupRef}
      className="pointer-events-auto"
      style={{
        position: "fixed",
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        zIndex: 80,
      }}
    >
      <ColorPicker
        selectedText={selection.text}
        onColorSelect={onColorSelect}
        onCancel={onCancel}
      />
    </div>,
    document.body,
  );
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

interface PdfAnnotationDefaultsMenuProps {
  state: PdfAnnotationDefaultsMenuState;
  activeColor: string;
  onSelectColor: (color: string) => void;
  onClose: () => void;
}

function PdfAnnotationDefaultsMenu({
  state,
  activeColor,
  onSelectColor,
  onClose,
}: PdfAnnotationDefaultsMenuProps) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const adjustedPosition = adjustPopupPosition(state.position, { width: 224, height: 360 }, 12);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && menuRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      className="rounded-lg border border-border bg-popover py-1 text-sm shadow-xl"
      style={{
        position: "fixed",
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        zIndex: 150,
        minWidth: 208,
      }}
      role="menu"
      data-testid="pdf-annotation-defaults-menu"
    >
      <div className="border-b border-border px-3 py-2">
        <div className="text-xs font-medium text-foreground">{t("pdf.annotationDefaults.title")}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{t(`pdf.command.${state.tool}`)}</div>
      </div>
      <div className="px-2 py-1">
        <div className="px-1 py-1 text-xs text-muted-foreground">{t("pdf.color.default")}</div>
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color.value}
            type="button"
            onClick={() => {
              onSelectColor(color.hex);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
            role="menuitemradio"
            aria-checked={resolveHighlightColor(activeColor) === color.hex}
          >
            <span
              className="h-4 w-4 rounded-sm border border-black/10"
              style={{ backgroundColor: color.hex }}
            />
            <span className="flex-1">{color.name}</span>
            {resolveHighlightColor(activeColor) === color.hex ? <Check className="h-3.5 w-3.5" /> : null}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

interface HighlightPopupProps {
  comment?: { text?: string; emoji?: string } | null;
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
  const resolvedCommentText = comment?.text ?? "";
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState(resolvedCommentText);
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
        <span>{resolvedCommentText ? t("pdf.comment.edit") : t("pdf.comment.add")}</span>
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
  const container = usePdfPageOverlayContainer({
    paneRootRef,
    page,
    overlayClassName: `text-overlay-${annotation.id}`,
    overlayStyle: 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:15;',
    dependencyKey: `${annotation.id}:${page}`,
  });

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
  const container = usePdfPageOverlayContainer({
    paneRootRef,
    page,
    overlayClassName: `ink-overlay-${annotation.id}`,
    overlayStyle: 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;',
    dependencyKey: `${annotation.id}:${page}`,
  });

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
  const container = usePdfPageOverlayContainer({
    paneRootRef,
    page,
    overlayClassName: 'current-ink-overlay',
    overlayStyle: 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:20;',
    dependencyKey: `${page}:${path.length}:${color}`,
  });

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
  const container = usePdfPageOverlayContainer({
    paneRootRef,
    page,
    overlayClassName: `pdf-transient-selection-overlay-${paneId}-${page}`,
    overlayStyle: 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:12;',
    dependencyKey: `${paneId}:${page}:${selection.signature}`,
  });

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

interface PdfAreaSelectionDraftPortalProps {
  draft: {
    page: number;
    left: number;
    top: number;
    width: number;
    height: number;
  };
  paneRootRef: React.RefObject<HTMLElement | null>;
  color: string;
}

function PdfAreaSelectionDraftPortal({ draft, paneRootRef, color }: PdfAreaSelectionDraftPortalProps) {
  const container = usePdfPageOverlayContainer({
    paneRootRef,
    page: draft.page,
    overlayClassName: `pdf-area-draft-overlay-${draft.page}`,
    overlayStyle: "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:13;",
    dependencyKey: `${draft.page}:${draft.left}:${draft.top}:${draft.width}:${draft.height}:${color}`,
  });

  if (!container) {
    return null;
  }

  return ReactDOM.createPortal(
    <div
      className="absolute pointer-events-none rounded-md"
      data-testid={`pdf-area-selection-draft-page-${draft.page}`}
      style={{
        left: draft.left,
        top: draft.top,
        width: draft.width,
        height: draft.height,
        border: `2px solid ${resolveHighlightColor(color)}`,
        backgroundColor: `${resolveHighlightColor(color)}22`,
        boxSizing: "border-box",
      }}
    />,
    container,
  );
}

interface PdfStoredAnnotationMenuProps {
  annotation: AnnotationItem;
  position: { x: number; y: number };
  anchorRect?: DOMRect | null;
  onClose: () => void;
  onDelete: () => void;
  onAddComment: (comment: string) => void;
  onChangeColor: (color: string) => void;
  onConvertStyle?: () => void;
}

function PdfStoredAnnotationMenu({
  annotation,
  position,
  anchorRect,
  onClose,
  onDelete,
  onAddComment,
  onChangeColor,
  onConvertStyle,
}: PdfStoredAnnotationMenuProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const popupSize = useMeasuredPopupSize(
    popupRef,
    { width: 320, height: 420 },
    `${annotation.id}:${annotation.comment ?? ""}:${annotation.style.color}:${annotation.style.type}:${anchorRect?.left ?? 0}:${anchorRect?.top ?? 0}:${anchorRect?.width ?? 0}:${anchorRect?.height ?? 0}`,
  );
  const adjustedPosition = anchorRect
    ? getAnchoredPopupPosition(anchorRect, popupSize, {
        gap: 6,
        horizontalAlign: isPinAnnotation(annotation) ? "center" : "start",
        preferredPlacement: isPinAnnotation(annotation) ? "above" : "below",
      })
    : adjustPopupPosition(position, popupSize, 20);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(`[data-pdf-annotation-menu="${annotation.id}"]`)) {
        return;
      }
      onClose();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [annotation.id, onClose]);

  return ReactDOM.createPortal(
    <div
      ref={popupRef}
      role="dialog"
      data-pdf-annotation-menu={annotation.id}
      className="pointer-events-auto"
      style={{
        position: "fixed",
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        zIndex: 90,
      }}
    >
      <HighlightPopupContent
        comment={annotation.comment ? { text: annotation.comment } : null}
        highlightText={getCanonicalPdfAnnotationText(annotation)}
        currentColor={annotation.style.color}
        styleType={annotation.style.type as "highlight" | "underline" | "area" | "ink"}
        onDelete={() => {
          onDelete();
          onClose();
        }}
        onAddComment={(comment) => {
          onAddComment(comment);
          onClose();
        }}
        onChangeColor={(color) => {
          onChangeColor(color);
          onClose();
        }}
        onConvertToUnderline={onConvertStyle
          ? () => {
              onConvertStyle();
              onClose();
            }
          : undefined}
      />
    </div>,
    document.body,
  );
}

interface PdfStoredAnnotationOverlayProps {
  annotation: AnnotationItem;
  isActive: boolean;
  onClick: () => void;
  onHoverChange: (isHovered: boolean) => void;
}

function PdfStoredAnnotationOverlay({
  annotation,
  isActive,
  onClick,
  onHoverChange,
}: PdfStoredAnnotationOverlayProps) {
  if (annotation.target.type !== "pdf" || annotation.target.rects.length === 0) {
    return null;
  }

  const target = annotation.target as PdfTarget;
  const resolvedColor = resolveHighlightColor(annotation.style.color);
  const isTransparent = resolvedColor === "transparent";
  const isPin = isPinAnnotation(annotation);

  if (isPin) {
    const rect = target.rects[0];
    const pinComment = annotation.comment?.trim();
    const pinX = ((rect.x1 + rect.x2) / 2) * 100;
    const pinY = rect.y1 * 100;

    return (
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 18 }}>
        <div
          className={`absolute cursor-pointer transition-transform ${isActive ? "animate-pulse scale-110" : ""}`}
          style={{
            left: `${pinX}%`,
            top: `${pinY}%`,
            transform: "translate(-50%, -100%)",
            pointerEvents: "auto",
          }}
          onMouseEnter={() => onHoverChange(true)}
          onMouseLeave={() => onHoverChange(false)}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
        >
          <div className="flex flex-col items-center">
            <StickyNote
              className="h-5 w-5 text-amber-500 drop-shadow-md"
              fill="currentColor"
            />
            {pinComment ? (
              <div
                className="mt-1 max-w-[150px] whitespace-pre-wrap break-words rounded border border-amber-300 bg-amber-100 px-2 py-1 text-xs text-amber-900 shadow-sm dark:border-amber-700 dark:bg-amber-900/80 dark:text-amber-100"
                style={{ transform: "translateX(50%)" }}
              >
                {pinComment}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const boxShadow = isActive
    ? `inset 0 0 0 2px ${resolvedColor === "transparent" ? "#4b5563" : resolvedColor}66`
    : "none";

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 14 }}>
      {target.rects.map((rect, index) => {
        const style: React.CSSProperties = {
          position: "absolute",
          left: `${rect.x1 * 100}%`,
          top: `${rect.y1 * 100}%`,
          width: `${Math.max(0, rect.x2 - rect.x1) * 100}%`,
          height: `${Math.max(0, rect.y2 - rect.y1) * 100}%`,
          pointerEvents: "none",
          cursor: "default",
          transition: "opacity 0.2s ease-in-out, box-shadow 0.2s ease-in-out, border-color 0.2s ease-in-out",
          boxSizing: "border-box",
          boxShadow,
        };

        if (annotation.style.type === "underline") {
          style.backgroundColor = "transparent";
          style.borderBottom = `2px solid ${isTransparent ? "#666666" : resolvedColor}`;
          style.opacity = isActive ? 1 : 0.9;
        } else if (annotation.style.type === "area") {
          style.backgroundColor = isTransparent ? "transparent" : `${resolvedColor}${isActive ? "24" : "18"}`;
          style.border = `${isActive ? 3 : 2}px solid ${isTransparent ? "#666666" : resolvedColor}`;
          style.borderRadius = 6;
          style.opacity = isActive ? 1 : 0.9;
        } else if (isTransparent) {
          style.backgroundColor = "transparent";
          style.border = "1px dashed #999999";
          style.opacity = isActive ? 1 : 0.85;
        } else {
          style.backgroundColor = toHighlightFillColor(resolvedColor);
          style.mixBlendMode = "multiply";
          style.opacity = isActive ? 1 : 0.82;
          style.borderRadius = 2;
        }

        return (
          <div
            key={`${annotation.id}-${index}`}
            style={style}
          />
        );
      })}
    </div>
  );
}

interface PdfStoredAnnotationPortalProps {
  annotation: AnnotationItem;
  page: number;
  paneRootRef: React.RefObject<HTMLElement | null>;
  isActive: boolean;
  onClick: () => void;
  onHoverChange: (isHovered: boolean) => void;
}

function PdfStoredAnnotationPortal({
  annotation,
  page,
  paneRootRef,
  isActive,
  onClick,
  onHoverChange,
}: PdfStoredAnnotationPortalProps) {
  const container = usePdfPageOverlayContainer({
    paneRootRef,
    page,
    overlayClassName: `pdf-stored-annotation-overlay-${annotation.id}`,
    overlayStyle: "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:14;",
    dependencyKey: `${annotation.id}:${page}`,
  });

  if (!container) {
    return null;
  }

  return ReactDOM.createPortal(
    <PdfStoredAnnotationOverlay
      annotation={annotation}
      isActive={isActive}
      onClick={onClick}
      onHoverChange={onHoverChange}
    />,
    container,
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function PDFHighlighterAdapter({
  source,
  fileName,
  fileHandle,
  rootHandle,
  paneId,
  fileId,
  filePath,
  binding = null,
}: PDFHighlighterAdapterProps) {
  const { t } = useI18n();
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const workspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const persistedPdfViewStateKey = useMemo(
    () => buildPersistedFileViewStateKey({
      kind: "pdf",
      workspaceKey,
      workspaceRootPath,
      filePath,
      fallbackName: fileName,
    }),
    [fileName, filePath, workspaceKey, workspaceRootPath],
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
  const [resolvedBinding, setResolvedBinding] = useState<ResolvedPdfDocumentBinding | null>(binding);
  const [backlinksByAnnotation, setBacklinksByAnnotation] = useState<Record<string, AnnotationBacklink[]>>({});
  const effectiveBinding = binding ?? resolvedBinding;
  const {
    annotations,
    error: annotationsError,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
  } = useAnnotationSystem({
    fileHandle,
    filePath,
    storageFileId: effectiveBinding?.canonicalStorageFileId ?? null,
    binding: effectiveBinding,
    rootHandle,
    fileType: 'pdf',
    author: 'user',
  });

  const [scale, setScale] = useState(cachedPdfViewState?.scale ?? 1.2);
  const [zoomMode, setZoomMode] = useState<PdfZoomMode>(cachedPdfViewState?.zoomMode ?? 'fit-width');
  const [activeTool, setActiveTool] = useState<AnnotationTool>('select');
  const [activeColor, setActiveColor] = useState(DEFAULT_HIGHLIGHT_COLOR.hex);
  const [annotationDefaultsMenu, setAnnotationDefaultsMenu] = useState<PdfAnnotationDefaultsMenuState | null>(null);
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number; page: number } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [sidebarSize, setSidebarSize] = useState(cachedPdfViewState?.sidebarSize ?? 28);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [annotationMenuState, setAnnotationMenuState] = useState<{
    annotationId: string;
    position: { x: number; y: number };
    anchorRect: DOMRect | null;
  } | null>(null);
  const [currentAnchorDebug, setCurrentAnchorDebug] = useState<PdfViewAnchor | null>(cachedPdfViewState?.anchor ?? null);
  const [persistedPdfViewState, setPersistedPdfViewState] = useState(() => cachedPdfViewState ?? null);
  const dedupedAnnotations = useMemo(
    () => dedupeAnnotationsById(annotations),
    [annotations],
  );
  const manifestSeedId = useMemo(() => generateFileId(filePath), [filePath]);
  const annotationMirrorTimeoutRef = useRef<number | null>(null);
  const pdfAnnotationCount = useMemo(() => (
    dedupedAnnotations.filter((annotation) => annotation.target.type === "pdf").length
  ), [dedupedAnnotations]);
  const pdfManifestSyncKey = (
    pdfItemManifest
      ? `${pdfItemManifest.itemId}:${pdfItemManifest.itemFolderPath}:${pdfItemManifest.annotationIndexPath ?? ""}`
      : null
  );
  const canManagePdfItemWorkspace = useMemo(() => {
    const candidate = rootHandle as Partial<FileSystemDirectoryHandle> | null;
    return Boolean(candidate && typeof candidate.getDirectoryHandle === "function" && typeof candidate.values === "function");
  }, [rootHandle]);

  const handlePdfDocumentReady = useCallback((pdfDocument: PDFDocumentProxy) => {
    setPdfLoadError(null);
    setNumPages(pdfDocument.numPages);
  }, []);

  const handlePdfDocumentError = useCallback((error: Error) => {
    setPdfLoadError(error.message || "Failed to load PDF");
  }, []);

  const handlePageMeasure = useCallback((pageNumber: number, width: number, height: number) => {
    setPageDimensions((previous) => {
      const existing = previous.get(pageNumber);
      if (
        existing &&
        Math.abs(existing.width - width) < 0.5 &&
        Math.abs(existing.height - height) < 0.5
      ) {
        return previous;
      }

      const next = new Map(previous);
      next.set(pageNumber, { width, height });
      return next;
    });
  }, []);

  useEffect(() => {
    if (binding) {
      setResolvedBinding(binding);
      return;
    }

    let cancelled = false;
    const bindingRunGuard = bindingRunGuardRef.current;
    const runId = bindingRunGuard.begin();
    void withTimeout(resolvePdfDocumentBinding({
      rootHandle,
      fileHandle,
      fileName,
      filePath,
      workspaceIdentity: useWorkspaceStore.getState().workspaceIdentity,
      fileType: "pdf",
    }), 8000, "PDF document binding").then((nextBinding) => {
      if (!cancelled && bindingRunGuard.isCurrent(runId)) {
        setResolvedBinding(nextBinding);
      }
    }).catch(() => {
      if (!cancelled && bindingRunGuard.isCurrent(runId)) {
        setResolvedBinding(null);
      }
    });

    return () => {
      cancelled = true;
      bindingRunGuard.invalidate();
    };
  }, [binding, fileHandle, fileName, filePath, rootHandle]);

  const hydrateBacklinksFromIndex = useCallback((): Record<string, AnnotationBacklink[]> => {
    const nextBacklinks: Record<string, AnnotationBacklink[]> = {};
    dedupedAnnotations.forEach((annotation) => {
      if (annotation.target.type !== "pdf") {
        return;
      }
      nextBacklinks[annotation.id] = getBacklinksForAnnotation(annotation.id);
    });
    setBacklinksByAnnotation(nextBacklinks);
    return nextBacklinks;
  }, [dedupedAnnotations]);

  const refreshAnnotationBacklinks = useCallback(async (): Promise<Record<string, AnnotationBacklink[]>> => {
    if (!pdfItemManifest || !canManagePdfItemWorkspace || !showSidebar || pdfAnnotationCount === 0) {
      return {};
    }

    if (Date.now() - getBacklinkIndex().lastScan < 30_000) {
      return hydrateBacklinksFromIndex();
    }

    const runId = backlinkRunGuardRef.current.begin();
    try {
      await withTimeout(
        scanWorkspaceMarkdownBacklinks(rootHandle),
        15000,
        "PDF annotation backlink scan",
      );
    } catch (error) {
      logger.warn("[PDF] Backlink refresh skipped:", error);
      return {};
    }
    if (!backlinkRunGuardRef.current.isCurrent(runId)) {
      return {};
    }

    const nextBacklinks = hydrateBacklinksFromIndex();
    if (!backlinkRunGuardRef.current.isCurrent(runId)) {
      return {};
    }
    return nextBacklinks;
  }, [canManagePdfItemWorkspace, hydrateBacklinksFromIndex, pdfAnnotationCount, pdfItemManifest, rootHandle, showSidebar]);

  const scheduleBacklinkRefresh = useCallback(() => {
    if (!showSidebar || !pdfItemManifest || !canManagePdfItemWorkspace || pdfAnnotationCount === 0) {
      return;
    }
    if (backlinkRefreshIdleHandleRef.current !== null) {
      return;
    }

    hydrateBacklinksFromIndex();
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const runRefresh = () => {
      backlinkRefreshIdleHandleRef.current = null;
      void refreshAnnotationBacklinks();
    };

    backlinkRefreshIdleHandleRef.current = idleWindow.requestIdleCallback
      ? idleWindow.requestIdleCallback(runRefresh, { timeout: 2000 })
      : window.setTimeout(runRefresh, 180);
  }, [canManagePdfItemWorkspace, hydrateBacklinksFromIndex, pdfAnnotationCount, pdfItemManifest, refreshAnnotationBacklinks, showSidebar]);

  useEffect(() => {
    if (!canManagePdfItemWorkspace) {
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;
    const manifestRunGuard = manifestRunGuardRef.current;
    const runId = manifestRunGuard.begin();

    const loadWorkspaceManifest = async () => {
      try {
        setPdfItemError(null);
        const manifest = await withTimeout(
          effectiveBinding
            ? loadPdfItemManifestForBinding(rootHandle, effectiveBinding)
            : loadPdfItemManifest(rootHandle, manifestSeedId, filePath),
          20000,
          "PDF item manifest load",
        );
        if (cancelled || !manifestRunGuard.isCurrent(runId)) {
          return;
        }
        setPdfItemManifest(manifest);
        void withTimeout(syncPdfManagedFiles(rootHandle, manifest), 20000, "PDF managed file sync")
          .catch((error) => {
            logger.warn("[PDF] Managed file sync skipped:", error);
          });
      } catch (error) {
        if (!cancelled && manifestRunGuard.isCurrent(runId)) {
          logger.warn("[PDF] PDF item manifest load skipped:", error);
          setPdfItemError(null);
        }
      }
    };

    timerId = window.setTimeout(() => {
      void loadWorkspaceManifest();
    }, 250);

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      manifestRunGuard.invalidate();
    };
  }, [canManagePdfItemWorkspace, effectiveBinding, filePath, manifestSeedId, rootHandle]);

  useEffect(() => {
    if (!showSidebar || !pdfItemManifest || !canManagePdfItemWorkspace) {
      return;
    }

    scheduleBacklinkRefresh();
    const handleWindowFocus = () => {
      scheduleBacklinkRefresh();
    };

    window.addEventListener("focus", handleWindowFocus);
    return () => {
      if (backlinkRefreshIdleHandleRef.current !== null) {
        const idleWindow = window as Window & {
          cancelIdleCallback?: (handle: number) => void;
        };
        idleWindow.cancelIdleCallback?.(backlinkRefreshIdleHandleRef.current);
        window.clearTimeout(backlinkRefreshIdleHandleRef.current);
        backlinkRefreshIdleHandleRef.current = null;
      }
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [canManagePdfItemWorkspace, pdfItemManifest, scheduleBacklinkRefresh, showSidebar]);

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
    setFitScale(persistedPdfViewState.scale);
    setZoomMode(persistedPdfViewState.zoomMode);
    setShowSidebar(persistedPdfViewState.showSidebar);
    setSidebarSize(persistedPdfViewState.sidebarSize ?? 28);
    setCurrentAnchorDebug(persistedPdfViewState.anchor ?? null);
  }, [cachedPdfViewState, persistedPdfViewState]);

  useEffect(() => {
    if (!pdfItemManifest || !canManagePdfItemWorkspace) {
      return;
    }
    const annotationSyncRunGuard = annotationSyncRunGuardRef.current;

    if (annotationMirrorTimeoutRef.current) {
      window.clearTimeout(annotationMirrorTimeoutRef.current);
    }

    annotationMirrorTimeoutRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          const runId = annotationSyncRunGuard.begin();
          const hasPdfAnnotations = pdfAnnotationCount > 0;
          if (!hasPdfAnnotations && !pdfItemManifest.annotationIndexPath) {
            return;
          }

          const nextBacklinks = hasPdfAnnotations && showSidebar
            ? hydrateBacklinksFromIndex()
            : {};
          if (hasPdfAnnotations && showSidebar) {
            scheduleBacklinkRefresh();
          }
          if (!annotationSyncRunGuard.isCurrent(runId)) {
            return;
          }
          const resolvedManifest = hasPdfAnnotations
            ? await withTimeout(
                effectiveBinding
                  ? ensurePdfItemWorkspaceForBinding(rootHandle, effectiveBinding)
                  : ensurePdfItemWorkspace(rootHandle, manifestSeedId, filePath),
                15000,
                "PDF item workspace ensure",
              )
            : pdfItemManifest;
          if (!annotationSyncRunGuard.isCurrent(runId)) {
            return;
          }
          const annotationResult = await withTimeout(
            syncPdfAnnotationsMarkdown(
              rootHandle,
              resolvedManifest,
              fileName,
              dedupedAnnotations,
              nextBacklinks,
            ),
            15000,
            "PDF annotation markdown sync",
          );
          if (!annotationSyncRunGuard.isCurrent(runId)) {
            return;
          }

          const nextManifest = annotationResult.manifest;
          const shouldRefreshDirectory = (
            nextManifest.itemFolderPath !== pdfItemManifest.itemFolderPath ||
            (nextManifest.annotationIndexPath ?? null) !== (pdfItemManifest.annotationIndexPath ?? null)
          );

          setPdfItemManifest((current) => {
            if (!current) {
              return nextManifest;
            }

            return (
              current.itemId === nextManifest.itemId &&
              current.itemFolderPath === nextManifest.itemFolderPath &&
              (current.annotationIndexPath ?? null) === (nextManifest.annotationIndexPath ?? null)
            ) ? current : nextManifest;
          });

          if (shouldRefreshDirectory) {
            await withTimeout(refreshDirectory({ silent: true }), 20000, "PDF workspace refresh");
          }
        } catch (error) {
          logger.warn("[PDF] Annotation workspace sync skipped:", error);
        }
      })();
    }, 450);

    return () => {
      if (annotationMirrorTimeoutRef.current) {
        window.clearTimeout(annotationMirrorTimeoutRef.current);
        annotationMirrorTimeoutRef.current = null;
      }
      annotationSyncRunGuard.invalidate();
    };
  }, [canManagePdfItemWorkspace, dedupedAnnotations, effectiveBinding, fileName, filePath, hydrateBacklinksFromIndex, manifestSeedId, pdfAnnotationCount, pdfItemManifest, pdfManifestSyncKey, refreshDirectory, rootHandle, scheduleBacklinkRefresh, showSidebar]);
  const [restoreDebugState, setRestoreDebugState] = useState<PdfRestoreDebugState>(createIdleRestoreDebugState);
  
  // Current stroke state (for real-time drawing preview)
  const [currentInkPath, setCurrentInkPath] = useState<{ x: number; y: number }[]>([]);
  const [currentInkPage, setCurrentInkPage] = useState<number | null>(null);
  const [isDrawingStroke, setIsDrawingStroke] = useState(false);
  const [areaSelectionDraft, setAreaSelectionDraft] = useState<{
    page: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  
  const [textAnnotationPosition, setTextAnnotationPosition] = useState<{ x: number; y: number; page: number } | null>(null);
  const [editingTextAnnotation, setEditingTextAnnotation] = useState<{ annotation: AnnotationItem; position: { x: number; y: number } } | null>(null);
  const [pdfLoadError, setPdfLoadError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [fitScale, setFitScale] = useState<number>(cachedPdfViewState?.scale ?? 1.2);
  const [pageDimensions, setPageDimensions] = useState<Map<number, { width: number; height: number }>>(new Map());
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([1, 2, 3]));
  const [pdfSelectionSession, setPdfSelectionSession] = useState<PdfSelectionSessionState>(() => createIdlePdfSelectionSession());
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const [pendingSelectionDraft, setPendingSelectionDraft] = useState<{
    selection: PdfResolvedSelection;
    position: { x: number; y: number };
    anchorRect: DOMRect | null;
    token: number;
  } | null>(null);
  const [deferredNavigation, setDeferredNavigation] = useState<PendingPaneNavigation | null>(null);
  const pathname = usePathname();
  const isDiagnosticsMode = pathname?.startsWith("/diagnostics") ?? false;
  const isDesktopUrlSource = source.kind === "desktop-url";
  const pdfFileDataSource = isDesktopUrlSource ? source.url : source.data;
  const pdfBlob = useMemo(() => (
    isDesktopUrlSource ? null : new Blob([(pdfFileDataSource as ArrayBuffer).slice(0)], { type: "application/pdf" })
  ), [isDesktopUrlSource, pdfFileDataSource]);
  const pdfObjectUrl = useObjectUrl(pdfBlob);
  const pdfFileData = useMemo(() => (
    isDesktopUrlSource
      ? pdfFileDataSource
      : pdfObjectUrl
  ), [isDesktopUrlSource, pdfFileDataSource, pdfObjectUrl]);
  const desktopPdfPath = useMemo(() => getDesktopPdfPath(fileHandle), [fileHandle]);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const [pageObserver, setPageObserver] = useState<IntersectionObserver | null>(null);
  const hasRestoredScrollRef = useRef(false);
  const timeoutIdsRef = useRef<number[]>([]);
  const persistTimeoutRef = useRef<number | null>(null);
  const persistIdleRef = useRef<number | null>(null);
  const lastPersistSignatureRef = useRef<string | null>(null);
  const lastPersistedEditorStateRef = useRef<ReturnType<typeof buildPdfEditorState> | null>(null);
  const anchorCaptureRevisionRef = useRef(0);
  const pendingAreaPreviewBackfillRef = useRef<Set<string>>(new Set());
  const currentInkPathRef = useRef<{ x: number; y: number }[]>([]);
  const currentInkPageRef = useRef<number | null>(null);
  const currentInkPageElementRef = useRef<HTMLElement | null>(null);
  const areaSelectionDraftRef = useRef<{
    page: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const areaSelectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const areaSelectionPageElementRef = useRef<HTMLElement | null>(null);
  const inkPreviewFrameRef = useRef<number | null>(null);
  const transientSelectionDismissRef = useRef<(() => void) | null>(null);
  const finalizePdfSelectionFromSnapshotRef = useRef<((options?: {
    token?: number;
    hideTipAndSelection?: () => void;
  }) => Promise<PdfResolvedSelection | null>) | null>(null);
  const nativePdfSelectionSnapshotRef = useRef<NativePdfSelectionSnapshot | null>(null);
  const frozenNativePdfSelectionSnapshotRef = useRef<NativePdfSelectionSnapshot | null>(null);
  const pendingNativePdfSelectionSettleRef = useRef<{ token: number; pointerUpAt: number } | null>(null);
  const handledPdfSelectionTokenRef = useRef<number | null>(null);
  const nativeSelectionClearAnimationFrameRef = useRef<number | null>(null);
  const nativeSelectionClearTokenRef = useRef(0);
  const textSelectionDragPointRef = useRef<{
    token: number;
    start: { x: number; y: number } | null;
    end: { x: number; y: number } | null;
  } | null>(null);
  const renderedPdfPagesRef = useRef<HTMLElement[]>([]);
  const bindingRunGuardRef = useRef(createLatestRunGuard());
  const manifestRunGuardRef = useRef(createLatestRunGuard());
  const backlinkRunGuardRef = useRef(createLatestRunGuard());
  const annotationSyncRunGuardRef = useRef(createLatestRunGuard());
  const pendingAnnotationScrollFrameRef = useRef<number | null>(null);
  const backlinkRefreshIdleHandleRef = useRef<number | null>(null);
  const pendingFitPageNumberRef = useRef<number | null>(null);
  const pdfSelectionSessionRef = useRef<PdfSelectionSessionState>(pdfSelectionSession);
  const frozenPdfSelection = pdfSelectionSession.phase === "frozen" ? pdfSelectionSession.snapshot : null;
  const measuredPageDimensions = useMemo(() => (
    Array.from(pageDimensions.entries())
      .map(([pageNumber, dimensions]) => ({
        pageNumber,
        width: dimensions.width,
        height: dimensions.height,
      }))
      .sort((left, right) => left.pageNumber - right.pageNumber)
  ), [pageDimensions]);
  const widestMeasuredPageWidth = useMemo(() => {
    const widest = measuredPageDimensions.reduce((maxWidth, page) => (
      page.width > maxWidth ? page.width : maxWidth
    ), 0);
    return widest > 0 ? widest : ESTIMATED_PAGE_WIDTH;
  }, [measuredPageDimensions]);
  const pageDevicePixelRatio = useMemo(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const runtimeDpr = window.devicePixelRatio || 1;
    return desktopPdfPath ? Math.min(runtimeDpr, 2) : runtimeDpr;
  }, [desktopPdfPath]);
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
  const pendingNavigation = useLinkNavigationStore((state) => state.pendingByPane[paneId]);
  const consumePendingNavigation = useLinkNavigationStore((state) => state.consumePendingNavigation);
  const commitPdfSelectionSession = useCallback((nextState: PdfSelectionSessionState) => {
    pdfSelectionSessionRef.current = nextState;
    setPdfSelectionSession(nextState);
  }, []);

  const resolveViewerScrollContainer = useCallback((): HTMLDivElement | null => {
    return viewerContainerRef.current;
  }, []);


  const getViewerScrollContainer = useCallback((): HTMLDivElement | null => {
    return resolveViewerScrollContainer();
  }, [resolveViewerScrollContainer]);

  const readCurrentNativePdfSelection = useCallback((): { text: string; range: Range; clientRects: Array<{ left: number; right: number; top: number; bottom: number }> } | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const text = selection.toString();
    if (!text.trim()) {
      return null;
    }

    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    const container = containerRef.current;
    const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement ?? null;
    const focusElement = focusNode instanceof Element ? focusNode : focusNode?.parentElement ?? null;

    if (!container || !anchorElement || !focusElement) {
      return null;
    }

    if (!container.contains(anchorElement) || !container.contains(focusElement)) {
      return null;
    }

    const range = selection.getRangeAt(0).cloneRange();
    const clientRects = buildAbsoluteClientRectsFromRange(range).map((rect) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    }));

    return {
      text,
      range,
      clientRects,
    };
  }, []);

  const captureNativePdfSelectionSnapshot = useCallback((): NativePdfSelectionSnapshot | null => {
    const currentSelection = readCurrentNativePdfSelection();
    if (!currentSelection || currentSelection.clientRects.length === 0) {
      return null;
    }

    const snapshot: NativePdfSelectionSnapshot = {
      text: currentSelection.text,
      range: currentSelection.range,
      clientRects: currentSelection.clientRects,
      dragStartPoint: textSelectionDragPointRef.current?.token === pdfSelectionSessionRef.current.token
        ? textSelectionDragPointRef.current.start
        : null,
      dragEndPoint: textSelectionDragPointRef.current?.token === pdfSelectionSessionRef.current.token
        ? textSelectionDragPointRef.current.end
        : null,
      capturedAt: Date.now(),
      token: pdfSelectionSessionRef.current.token,
    };

    nativePdfSelectionSnapshotRef.current = snapshot;

    const pendingSettle = pendingNativePdfSelectionSettleRef.current;
    if (
      pendingSettle &&
      pendingSettle.token === snapshot.token &&
      snapshot.capturedAt >= pendingSettle.pointerUpAt &&
      snapshot.capturedAt - pendingSettle.pointerUpAt <= DOM_SELECTION_SETTLE_WINDOW_MS
    ) {
      frozenNativePdfSelectionSnapshotRef.current = snapshot;
    }

    return snapshot;
  }, [readCurrentNativePdfSelection]);

  const freezeNativePdfSelectionSnapshot = useCallback((event?: React.PointerEvent<HTMLDivElement>) => {
    if (activeTool === 'note' || activeTool === 'text' || activeTool === 'ink' || activeTool === 'area') {
      return;
    }

    const token = pdfSelectionSessionRef.current.token;
    if (textSelectionDragPointRef.current?.token === token && event) {
      textSelectionDragPointRef.current = {
        ...textSelectionDragPointRef.current,
        end: { x: event.clientX, y: event.clientY },
      };
    }
    const pointerUpAt = Date.now();
    pendingNativePdfSelectionSettleRef.current = {
      token,
      pointerUpAt,
    };
    const timeoutId = window.setTimeout(() => {
      if (
        pendingNativePdfSelectionSettleRef.current?.token === token &&
        pendingNativePdfSelectionSettleRef.current.pointerUpAt === pointerUpAt
      ) {
        pendingNativePdfSelectionSettleRef.current = null;
      }
      timeoutIdsRef.current = timeoutIdsRef.current.filter((id) => id !== timeoutId);
    }, DOM_SELECTION_SETTLE_WINDOW_MS);
    timeoutIdsRef.current.push(timeoutId);

    const snapshot = captureNativePdfSelectionSnapshot();
    if (snapshot) {
      frozenNativePdfSelectionSnapshotRef.current = snapshot;
    } else if (nativePdfSelectionSnapshotRef.current?.token === token) {
      frozenNativePdfSelectionSnapshotRef.current = nativePdfSelectionSnapshotRef.current;
    }

    const finalizeTimeoutId = window.setTimeout(() => {
      if (pdfSelectionSessionRef.current.token !== token) {
        return;
      }
      void finalizePdfSelectionFromSnapshotRef.current?.({ token });
      timeoutIdsRef.current = timeoutIdsRef.current.filter((id) => id !== finalizeTimeoutId);
    }, DOM_SELECTION_SETTLE_WINDOW_MS + 8);
    timeoutIdsRef.current.push(finalizeTimeoutId);
  }, [activeTool, captureNativePdfSelectionSnapshot]);

  const getActivePdfSelectionText = useCallback(() => {
    return resolvePdfCopySelectionText({
      nativeText: readCurrentNativePdfSelection()?.text ?? "",
      frozenSnapshot: frozenPdfSelection,
    });
  }, [frozenPdfSelection, readCurrentNativePdfSelection]);

  const cancelScheduledNativePdfSelectionClear = useCallback(() => {
    nativeSelectionClearTokenRef.current += 1;
    if (nativeSelectionClearAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(nativeSelectionClearAnimationFrameRef.current);
      nativeSelectionClearAnimationFrameRef.current = null;
    }
  }, []);

  const clearNativePdfSelection = useCallback(() => {
    cancelScheduledNativePdfSelectionClear();
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      selection.removeAllRanges();
    }
    nativePdfSelectionSnapshotRef.current = null;
    frozenNativePdfSelectionSnapshotRef.current = null;
    pendingNativePdfSelectionSettleRef.current = null;
    textSelectionDragPointRef.current = null;
  }, [cancelScheduledNativePdfSelectionClear]);

  const clearNativePdfSelectionLater = useCallback((frameCount = 1) => {
    cancelScheduledNativePdfSelectionClear();
    const clearToken = nativeSelectionClearTokenRef.current;
    let framesRemaining = Math.max(1, frameCount);
    const tick = () => {
      if (clearToken !== nativeSelectionClearTokenRef.current) {
        return;
      }
      framesRemaining -= 1;
      if (framesRemaining <= 0) {
        nativeSelectionClearAnimationFrameRef.current = null;
        clearNativePdfSelection();
        return;
      }
      nativeSelectionClearAnimationFrameRef.current = window.requestAnimationFrame(tick);
    };
    nativeSelectionClearAnimationFrameRef.current = window.requestAnimationFrame(tick);
  }, [cancelScheduledNativePdfSelectionClear, clearNativePdfSelection]);

  const dismissTransientSelectionTip = useCallback(() => {
    transientSelectionDismissRef.current?.();
    transientSelectionDismissRef.current = null;
  }, []);

  const clearTransientSelection = useCallback((options?: {
    hideTip?: boolean;
    clearNative?: boolean;
    nextPhase?: 'committed' | 'cancelled';
  }) => {
    setPendingSelectionDraft(null);
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

  const buildSelectionDraftMenuPosition = useCallback((selection: PdfResolvedSelection): { position: { x: number; y: number }; anchorRect: DOMRect } | null => {
    const pageElement = findPdfPageElementInScope(containerRef.current, selection.pageNumber);
    const pageRects = selection.viewportRects.filter((rect) => rect.pageNumber === selection.pageNumber);
    if (!pageElement || pageRects.length === 0) {
      return null;
    }

    const pageRect = pageElement.getBoundingClientRect();
    const sortedPageRects = [...pageRects].sort((left, right) => left.top - right.top || left.left - right.left);
    const trailingRect = sortedPageRects[sortedPageRects.length - 1];
    const anchorLeft = pageRect.left + trailingRect.left + trailingRect.width - 1;
    const anchorTop = pageRect.top + trailingRect.top;
    const anchorRect = new DOMRect(
      anchorLeft,
      anchorTop,
      1,
      Math.max(1, trailingRect.height),
    );

    return {
      position: {
        x: anchorRect.left,
        y: anchorRect.bottom + 4,
      },
      anchorRect,
    };
  }, []);

  const finalizePdfSelectionFromSnapshot = useCallback(async (options?: {
    token?: number;
    hideTipAndSelection?: () => void;
  }): Promise<PdfResolvedSelection | null> => {
    const selectionToken = options?.token ?? pdfSelectionSessionRef.current.token;
    if (handledPdfSelectionTokenRef.current === selectionToken) {
      options?.hideTipAndSelection?.();
      return null;
    }
    const currentSelectionSnapshot = captureNativePdfSelectionSnapshot();
    const selectionSnapshotCandidates = [
      frozenNativePdfSelectionSnapshotRef.current,
      nativePdfSelectionSnapshotRef.current,
      currentSelectionSnapshot,
    ].filter((candidate): candidate is NativePdfSelectionSnapshot => {
      if (!candidate) {
        return false;
      }

      return (
        candidate.token === selectionToken &&
        candidate.clientRects.length > 0 &&
        candidate.text.trim().length > 0
      );
    });
    const selectionSnapshot = selectionSnapshotCandidates
      .sort((left, right) => right.capturedAt - left.capturedAt)[0] ?? null;

    if (!selectionSnapshot) {
      options?.hideTipAndSelection?.();
      clearTransientSelection({ nextPhase: 'cancelled' });
      return null;
    }

    const renderedPages = (() => {
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

      const nextPages = Array.from(containerRef.current?.querySelectorAll<HTMLElement>("[data-page-number]") ?? []);
      renderedPdfPagesRef.current = nextPages;
      return nextPages;
    })()
      .map((pageElement) => {
        const pageRect = pageElement.getBoundingClientRect();
        return {
          pageNumber: Number(pageElement.dataset.pageNumber ?? ""),
          width: pageRect.width,
          height: pageRect.height,
          element: pageElement,
        };
      })
      .filter((page) => Number.isInteger(page.pageNumber) && page.pageNumber > 0 && page.width > 0 && page.height > 0);

    const selectionPageElement = selectionSnapshot.range.startContainer instanceof Element
      ? selectionSnapshot.range.startContainer.closest<HTMLElement>("[data-page-number]")
      : selectionSnapshot.range.startContainer.parentElement?.closest<HTMLElement>("[data-page-number]") ?? null;
    const selectionPageNumber = Number(selectionPageElement?.dataset.pageNumber ?? "");
    const nativeLayout = Number.isInteger(selectionPageNumber) && selectionPageNumber > 0
      ? (
        peekDesktopPdfPageTextLayout({
          fileHandle,
          pageNumber: selectionPageNumber,
        }) ?? await getDesktopPdfPageTextLayout({
          fileHandle,
          pageNumber: selectionPageNumber,
        })
      )
      : null;

    const resolvedSelectionResult = resolvePdfSelectionFromNativeRange({
      range: selectionSnapshot.range,
      text: selectionSnapshot.text,
      pages: renderedPages,
      nativeLayout,
      dragStartPoint: selectionSnapshot.dragStartPoint ?? undefined,
      dragEndPoint: selectionSnapshot.dragEndPoint ?? undefined,
    });

    if (!resolvedSelectionResult.ok) {
      logger.warn("[PDF] Selection resolution skipped:", resolvedSelectionResult.reason);
      options?.hideTipAndSelection?.();
      clearTransientSelection({ nextPhase: 'cancelled' });
      return null;
    }

    const resolvedSelection = resolvedSelectionResult.selection;
    const normalizedTool = activeTool === 'underline'
      ? 'underline'
      : activeTool === 'highlight'
        ? 'highlight'
        : 'select';
    const signature = buildPdfSelectionSignature({
      tool: normalizedTool,
      selection: resolvedSelection,
    });

    if (isDuplicatePdfSelection(pdfSelectionSessionRef.current, {
      signature,
      token: selectionToken,
    })) {
      handledPdfSelectionTokenRef.current = selectionToken;
      options?.hideTipAndSelection?.();
      return null;
    }

    const nextSnapshot = createPdfSelectionSnapshot({
      selection: resolvedSelection,
      signature,
    });

    if (activeTool === 'highlight' || activeTool === 'underline') {
      const styleType = activeTool === 'underline' ? 'underline' : 'highlight';
      handledPdfSelectionTokenRef.current = selectionToken;
      commitPdfSelectionSession(updatePdfSelectionSession(pdfSelectionSessionRef.current, {
        phase: 'committed',
        snapshot: null,
        token: selectionToken,
      }));
      const annotationData = resolvedTextSelectionToAnnotationData({
        selection: resolvedSelection,
        color: activeColor,
        author: 'user',
        styleType,
      });
      addAnnotation(annotationData);
      clearNativePdfSelectionLater();
      options?.hideTipAndSelection?.();
      return resolvedSelection;
    }

    handledPdfSelectionTokenRef.current = selectionToken;
    activateTransientSelection(nextSnapshot);
    const menuPlacement = buildSelectionDraftMenuPosition(resolvedSelection);
    if (menuPlacement) {
      setPendingSelectionDraft({
        selection: resolvedSelection,
        position: menuPlacement.position,
        anchorRect: menuPlacement.anchorRect,
        token: selectionToken,
      });
    } else {
      setPendingSelectionDraft(null);
    }
    clearNativePdfSelectionLater(2);
    options?.hideTipAndSelection?.();
    return resolvedSelection;
  }, [
    activeColor,
    activeTool,
    activateTransientSelection,
    addAnnotation,
    buildSelectionDraftMenuPosition,
    captureNativePdfSelectionSnapshot,
    clearNativePdfSelectionLater,
    clearTransientSelection,
    commitPdfSelectionSession,
    fileHandle,
  ]);

  useEffect(() => {
    finalizePdfSelectionFromSnapshotRef.current = finalizePdfSelectionFromSnapshot;
  }, [finalizePdfSelectionFromSnapshot]);

  const beginNativePdfSelectionInteraction = useCallback((event?: React.PointerEvent<HTMLDivElement>) => {
    if (activeTool === 'note' || activeTool === 'text' || activeTool === 'ink' || activeTool === 'area') {
      return;
    }

    cancelScheduledNativePdfSelectionClear();
    handledPdfSelectionTokenRef.current = null;
    setPendingSelectionDraft(null);
    nativePdfSelectionSnapshotRef.current = null;
    frozenNativePdfSelectionSnapshotRef.current = null;
    pendingNativePdfSelectionSettleRef.current = null;
    textSelectionDragPointRef.current = {
      token: (pdfSelectionSessionRef.current.token ?? 0) + 1,
      start: event ? { x: event.clientX, y: event.clientY } : null,
      end: null,
    };
    const nextState = beginPdfSelectionSession(pdfSelectionSessionRef.current);
    textSelectionDragPointRef.current.token = nextState.token;
    commitPdfSelectionSession(nextState);
  }, [activeTool, cancelScheduledNativePdfSelectionClear, commitPdfSelectionSession]);

  useEffect(() => {
    const handleSelectionChange = () => {
      captureNativePdfSelectionSnapshot();
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [captureNativePdfSelectionSnapshot]);

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

  const prefetchNativeLayoutsForRenderedPages = useCallback(() => {
    if (!desktopPdfPath) {
      return;
    }

    getRenderedPdfPages().forEach((pageElement) => {
      const pageNumber = Number(pageElement.dataset.pageNumber ?? "");
      if (Number.isInteger(pageNumber) && pageNumber > 0) {
        prefetchDesktopPdfPageTextLayout({
          fileHandle,
          pageNumber,
        });
      }
    });
  }, [desktopPdfPath, fileHandle, getRenderedPdfPages]);

  useEffect(() => {
    if (!desktopPdfPath || !containerRef.current) {
      return;
    }

    prefetchNativeLayoutsForRenderedPages();
    const observer = new MutationObserver(() => {
      prefetchNativeLayoutsForRenderedPages();
    });

    observer.observe(containerRef.current, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [desktopPdfPath, prefetchNativeLayoutsForRenderedPages]);

  useEffect(() => {
    return () => {
      if (desktopPdfPath) {
        clearDesktopPdfPageTextLayoutCache(desktopPdfPath);
      }
    };
  }, [desktopPdfPath]);

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

    if (persistIdleRef.current !== null) {
      const idleWindow = window as Window & {
        cancelIdleCallback?: (handle: number) => void;
      };
      idleWindow.cancelIdleCallback?.(persistIdleRef.current);
      persistIdleRef.current = null;
    }
  }, []);

  useEffect(() => {
    hasRestoredScrollRef.current = false;
    lastPersistSignatureRef.current = null;
    lastPersistedEditorStateRef.current = null;
    currentInkPathRef.current = [];
    currentInkPageRef.current = null;
    currentInkPageElementRef.current = null;
    areaSelectionDraftRef.current = null;
    areaSelectionStartRef.current = null;
    areaSelectionPageElementRef.current = null;
    pdfSelectionSessionRef.current = createIdlePdfSelectionSession();
    updateCurrentAnchorDebug(cachedPdfViewState?.anchor ?? null);
    updateRestoreDebugState(createIdleRestoreDebugState());
    setCurrentInkPath([]);
    setCurrentInkPage(null);
    setAreaSelectionDraft(null);
    setPdfLoadError(null);
    setNumPages(0);
    setScale(cachedPdfViewState?.scale ?? 1.2);
    setZoomMode(cachedPdfViewState?.zoomMode ?? "fit-width");
    setShowSidebar(cachedPdfViewState?.showSidebar ?? false);
    setSidebarSize(cachedPdfViewState?.sidebarSize ?? 28);
    setFitScale(cachedPdfViewState?.scale ?? 1.2);
    setPageDimensions(new Map());
    setVisiblePages(new Set([1, 2, 3]));
    setPendingPin(null);
    setHighlightedId(null);
    setHoveredAnnotationId(null);
    setSelectedAnnotationId(null);
    setAnnotationMenuState(null);
    transientSelectionDismissRef.current = null;
    setPdfSelectionSession(createIdlePdfSelectionSession());
    clearScheduledPersist();
  }, [
    cachedPdfViewState?.anchor,
    cachedPdfViewState?.scale,
    cachedPdfViewState?.showSidebar,
    cachedPdfViewState?.sidebarSize,
    cachedPdfViewState?.zoomMode,
    clearScheduledPersist,
    fileId,
    updateCurrentAnchorDebug,
    updateRestoreDebugState,
  ]);

  useEffect(() => {
    const viewerContainer = viewerContainerRef.current;
    if (!viewerContainer) {
      setPageObserver(null);
      return;
    }

    setVisiblePages(new Set([1, 2, 3]));
    const observer = new IntersectionObserver((entries) => {
      setVisiblePages((previous) => {
        let changed = false;
        const next = new Set(previous);

        entries.forEach((entry) => {
          const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber ?? "");
          if (!Number.isInteger(pageNumber) || pageNumber < 1) {
            return;
          }

          if (entry.isIntersecting) {
            if (!next.has(pageNumber)) {
              next.add(pageNumber);
              changed = true;
            }
            return;
          }

          if (next.delete(pageNumber)) {
            changed = true;
          }
        });

        return changed ? next : previous;
      });
    }, {
      root: viewerContainer,
      rootMargin: "1500px 0px 1500px 0px",
      threshold: 0,
    });

    setPageObserver(observer);
    return () => {
      observer.disconnect();
      setPageObserver((current) => (current === observer ? null : current));
    };
  }, [fileId, showSidebar]);

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
    const persistedScale = zoomMode === "manual" ? scale : fitScale;
    const editorState = buildPdfEditorState({
      scale: persistedScale,
      zoomMode,
      showSidebar,
      sidebarSize,
      selectedAnnotationId,
      anchor: anchor ?? undefined,
      scrollTop: viewerContainer?.scrollTop ?? 0,
      scrollLeft: viewerContainer?.scrollLeft ?? 0,
    });

    const signature = buildPersistSignature({
      scale: persistedScale,
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
  }, [buildPersistSignature, captureCurrentPdfAnchor, fitScale, getViewerScrollContainer, scale, selectedAnnotationId, showSidebar, sidebarSize, zoomMode]);

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

  const schedulePersistPdfViewState = useCallback((delay = 320) => {
    clearScheduledPersist();
    persistTimeoutRef.current = window.setTimeout(() => {
      persistTimeoutRef.current = null;
      const idleWindow = window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      };
      if (idleWindow.requestIdleCallback) {
        persistIdleRef.current = idleWindow.requestIdleCallback(() => {
          persistIdleRef.current = null;
          persistPdfViewStateNow();
        }, { timeout: 1000 });
        return;
      }

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
  }, [buildCurrentPdfEditorStateSnapshot, getViewerScrollContainer, persistLastKnownPdfViewState, persistPdfViewStateNow, schedulePersistPdfViewState, showSidebar, sidebarSize]);

  useEffect(() => {
    const flushPersist = () => {
      if (lastPersistedEditorStateRef.current) {
        persistLastKnownPdfViewState();
        return;
      }

      persistPdfViewStateNow();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPersist();
      }
    };

    window.addEventListener("blur", flushPersist);
    window.addEventListener("pagehide", flushPersist);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", flushPersist);
      window.removeEventListener("pagehide", flushPersist);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [persistLastKnownPdfViewState, persistPdfViewStateNow]);

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
    const pageElement = findPdfPageElementInScope(containerRef.current, merged.page);
    const preview = buildPdfAnnotationPreviewFromPageElement(
      pageElement,
      (inkAnnotation.target as PdfTarget).rects,
      {
        paddingRatio: 0.035,
        minCssWidth: 180,
        minCssHeight: 120,
      },
    );
    if (preview) {
      inkAnnotation.preview = preview;
    }

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
      cancelScheduledNativePdfSelectionClear();
      clearScheduledPersist();
      if (pendingAnnotationScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingAnnotationScrollFrameRef.current);
        pendingAnnotationScrollFrameRef.current = null;
      }
      if (inkPreviewFrameRef.current !== null) {
        window.cancelAnimationFrame(inkPreviewFrameRef.current);
        inkPreviewFrameRef.current = null;
      }
      timeoutIdsRef.current.forEach((id) => window.clearTimeout(id));
      timeoutIdsRef.current = [];
    };
  }, [cancelScheduledNativePdfSelectionClear, clearScheduledPersist]);

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
  const pendingViewportRestoreAnchorRef = useRef<PdfViewAnchor | null>(null);
  const renderedPages = useMemo(() => {
    const next = new Set<number>();
    visiblePages.forEach((pageNumber) => {
      for (let candidate = pageNumber - PAGE_BUFFER; candidate <= pageNumber + PAGE_BUFFER; candidate += 1) {
        if (candidate >= 1 && candidate <= numPages) {
          next.add(candidate);
        }
      }
    });
    return next;
  }, [numPages, visiblePages]);
  const renderScale = zoomMode === "manual" ? scale : fitScale;

  useEffect(() => {
    if (!isDiagnosticsMode) {
      return;
    }

    scrollContainerRef.current?.setAttribute("data-pane-id", paneId);
    viewerContainerRef.current?.setAttribute("data-pane-id", paneId);
    viewerContainerRef.current?.setAttribute("data-testid", `pdf-viewer-container-${paneId}`);
  }, [getViewerScrollContainer, isDiagnosticsMode, paneId]);

  const warmVisiblePages = useCallback((pageNumber: number) => {
    setVisiblePages((previous) => {
      const next = new Set(previous);
      let changed = false;

      for (let candidate = pageNumber - PAGE_BUFFER; candidate <= pageNumber + PAGE_BUFFER; candidate += 1) {
        if (candidate >= 1 && candidate <= numPages && !next.has(candidate)) {
          next.add(candidate);
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [numPages]);

  const updateManualScale = useCallback((updater: number | ((current: number) => number)) => {
    pendingViewportRestoreAnchorRef.current = captureCurrentPdfAnchor();
    setScale((current) => {
      const resolved = typeof updater === "function"
        ? (updater as (current: number) => number)(current)
        : updater;
      const nextScale = clampPdfScale(resolved, ZOOM_MIN, ZOOM_MAX);
      setFitScale(nextScale);
      return nextScale;
    });
    setZoomMode("manual");
  }, [captureCurrentPdfAnchor]);

  const applyZoomMode = useCallback((mode: 'manual' | 'fit-width' | 'fit-page') => {
    pendingViewportRestoreAnchorRef.current = captureCurrentPdfAnchor();
    setZoomMode(mode);
  }, [captureCurrentPdfAnchor]);

  const updateFitScaleForLayout = useCallback((overridePageNumber?: number | null) => {
    if (zoomMode === "manual") {
      return;
    }

    const viewerContainer = getViewerScrollContainer();
    if (!viewerContainer || measuredPageDimensions.length === 0) {
      return;
    }

    const targetPageNumber = zoomMode === "fit-page"
      ? (overridePageNumber ?? getPrimaryVisiblePageState()?.pageNumber ?? measuredPageDimensions[0]?.pageNumber ?? null)
      : null;
    const nextScale = calculatePdfFitScale({
      zoomMode,
      containerWidth: viewerContainer.clientWidth,
      containerHeight: viewerContainer.clientHeight,
      pageDimensions: measuredPageDimensions,
      targetPageNumber,
      minScale: ZOOM_MIN,
      maxScale: ZOOM_MAX,
    });

    if (nextScale === null) {
      return;
    }

    const fitScaleChanged = Math.abs(fitScale - nextScale) >= 0.01;
    const scaleChanged = Math.abs(scale - nextScale) >= 0.01;
    if (!fitScaleChanged && !scaleChanged) {
      if (zoomMode === "fit-page") {
        pendingFitPageNumberRef.current = targetPageNumber ?? null;
      }
      return;
    }

    pendingViewportRestoreAnchorRef.current = captureCurrentPdfAnchor();
    if (zoomMode === "fit-page") {
      pendingFitPageNumberRef.current = targetPageNumber ?? null;
    }
    setFitScale((previous) => Math.abs(previous - nextScale) < 0.01 ? previous : nextScale);
    setScale((previous) => Math.abs(previous - nextScale) < 0.01 ? previous : nextScale);
  }, [
    captureCurrentPdfAnchor,
    fitScale,
    getPrimaryVisiblePageState,
    getViewerScrollContainer,
    measuredPageDimensions,
    scale,
    zoomMode,
  ]);

  useEffect(() => {
    if (zoomMode === "manual") {
      return;
    }

    const viewerContainer = getViewerScrollContainer();
    if (!viewerContainer) {
      return;
    }

    updateFitScaleForLayout();

    let frameId = 0;
    const observer = new ResizeObserver(() => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        updateFitScaleForLayout();
      });
    });
    observer.observe(viewerContainer);
    return () => {
      observer.disconnect();
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [getViewerScrollContainer, showSidebar, sidebarSize, updateFitScaleForLayout, zoomMode]);

  useEffect(() => {
    const viewerContainer = getViewerScrollContainer();
    const anchor = pendingViewportRestoreAnchorRef.current;
    if (!viewerContainer || !anchor) {
      return;
    }

    let cleanupRestore: (() => void) | undefined;
    const scrollState = captureRelativeScrollPosition(viewerContainer);
    const frameId = window.requestAnimationFrame(() => {
      cleanupRestore = restorePdfAnchor({
        viewerContainer,
        anchor,
        fallbackScrollState: scrollState,
      });
      pendingViewportRestoreAnchorRef.current = null;
    });
    return () => {
      window.cancelAnimationFrame(frameId);
      cleanupRestore?.();
    };
  }, [fileId, fitScale, getViewerScrollContainer, restorePdfAnchor, scale, showSidebar, sidebarSize, zoomMode]);

  useEffect(() => {
    if (zoomMode !== "fit-page") {
      return;
    }

    const viewerContainer = getViewerScrollContainer();
    if (!viewerContainer) {
      return;
    }

    let frameId = 0;
    const handleScroll = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        const currentPageNumber = getPrimaryVisiblePageState()?.pageNumber ?? null;
        if (currentPageNumber === pendingFitPageNumberRef.current) {
          return;
        }
        pendingFitPageNumberRef.current = currentPageNumber;
        updateFitScaleForLayout(currentPageNumber);
      });
    };

    viewerContainer.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      viewerContainer.removeEventListener("scroll", handleScroll);
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [getPrimaryVisiblePageState, getViewerScrollContainer, updateFitScaleForLayout, zoomMode]);

  // Simple zoom functions
  const zoomIn = useCallback(() => {
    updateManualScale((current) => current + ZOOM_STEP);
  }, [updateManualScale]);

  const zoomOut = useCallback(() => {
    updateManualScale((current) => current - ZOOM_STEP);
  }, [updateManualScale]);

  const resetZoom = useCallback(() => {
    updateManualScale(1.0);
  }, [updateManualScale]);

  const openAnnotationDefaultsMenu = useCallback((tool: PdfAnnotationDefaultTool, position: { x: number; y: number }) => {
    setAnnotationDefaultsMenu({ tool, position });
  }, []);

  const handleExportPdf = useCallback(async () => {
    const pdfBytes = source.kind === "buffer"
      ? source.data
      : await (async () => {
          const desktopPath = getDesktopPreviewPath(fileHandle);
          if (!desktopPath) {
            const file = await fileHandle.getFile();
            return file.arrayBuffer();
          }

          const rawBytes = await readDesktopFileBytesRaw(desktopPath);
          return rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength) as ArrayBuffer;
        })();

    await exportPdfWithAnnotations(pdfBytes, dedupedAnnotations, fileName);
  }, [dedupedAnnotations, fileHandle, fileName, source]);

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
          onContextMenu: (position) => openAnnotationDefaultsMenu("highlight", position),
        },
        {
          id: "tool-underline",
          label: t("pdf.command.underline"),
          icon: "underline",
          active: activeTool === "underline",
          priority: 11,
          group: "primary",
          onTrigger: () => setActiveTool((value) => (value === "underline" ? "select" : "underline")),
          onContextMenu: (position) => openAnnotationDefaultsMenu("underline", position),
        },
        {
          id: "tool-note",
          label: t("pdf.command.note"),
          icon: "sticky-note",
          active: activeTool === "note",
          priority: 20,
          group: "secondary",
          onTrigger: () => setActiveTool((value) => (value === "note" ? "select" : "note")),
          onContextMenu: (position) => openAnnotationDefaultsMenu("note", position),
        },
        {
          id: "tool-text",
          label: t("pdf.command.text"),
          icon: "type",
          active: activeTool === "text",
          priority: 13,
          group: "primary",
          onTrigger: () => setActiveTool((value) => (value === "text" ? "select" : "text")),
          onContextMenu: (position) => openAnnotationDefaultsMenu("text", position),
        },
        {
          id: "tool-area",
          label: t("pdf.command.area"),
          icon: "square",
          active: activeTool === "area",
          priority: 14,
          group: "primary",
          onTrigger: () => setActiveTool((value) => (value === "area" ? "select" : "area")),
          onContextMenu: (position) => openAnnotationDefaultsMenu("area", position),
        },
        {
          id: "tool-draw",
          label: t("pdf.command.draw"),
          icon: "pencil",
          active: activeTool === "ink",
          priority: 21,
          group: "secondary",
          onTrigger: () => setActiveTool((value) => (value === "ink" ? "select" : "ink")),
          onContextMenu: (position) => openAnnotationDefaultsMenu("ink", position),
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
            void handleExportPdf();
          },
        },
      ],
    };
  }, [
    activeTool,
    applyZoomMode,
    filePath,
    handleExportPdf,
    openAnnotationDefaultsMenu,
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
    return new Map(dedupedAnnotations.map((annotation) => [annotation.id, annotation] as const));
  }, [dedupedAnnotations]);

  const transientSelectionPages = useMemo(() => (
    frozenPdfSelection
      ? frozenPdfSelection.pageNumbers
      : []
  ), [frozenPdfSelection]);
  const transientSelectionStyleType = activeTool === "underline" ? "underline" : "highlight";
  const transientSelectionColor = activeColor;

  const buildAnnotationMenuPosition = useCallback((annotation: AnnotationItem): { position: { x: number; y: number }; anchorRect: DOMRect } | null => {
    if (annotation.target.type !== "pdf" || annotation.target.rects.length === 0) {
      return null;
    }

    const target = annotation.target as PdfTarget;
    const pageElement = findPdfPageElementInScope(containerRef.current, target.page);
    if (!pageElement) {
      return null;
    }

    const pageRect = pageElement.getBoundingClientRect();
    const sortedRects = [...target.rects].sort((left, right) => left.y1 - right.y1 || left.x1 - right.x1);
    const trailingRect = sortedRects[sortedRects.length - 1];
    const unionLeft = Math.min(...target.rects.map((rect) => rect.x1));
    const unionTop = Math.min(...target.rects.map((rect) => rect.y1));
    const unionRight = Math.max(...target.rects.map((rect) => rect.x2));
    const unionBottom = Math.max(...target.rects.map((rect) => rect.y2));
    const centerX = pageRect.left + (((unionLeft + unionRight) / 2) * pageRect.width);
    const bottomY = pageRect.top + (unionBottom * pageRect.height);
    const topY = pageRect.top + (unionTop * pageRect.height);
    const anchorRect = new DOMRect(
      isPinAnnotation(annotation)
        ? pageRect.left + (unionLeft * pageRect.width)
        : pageRect.left + (trailingRect.x2 * pageRect.width) - 1,
      isPinAnnotation(annotation)
        ? pageRect.top + (unionTop * pageRect.height)
        : pageRect.top + (trailingRect.y1 * pageRect.height),
      isPinAnnotation(annotation)
        ? Math.max(1, (unionRight - unionLeft) * pageRect.width)
        : 1,
      isPinAnnotation(annotation)
        ? Math.max(1, (unionBottom - unionTop) * pageRect.height)
        : Math.max(1, (trailingRect.y2 - trailingRect.y1) * pageRect.height),
    );

    return {
      position: {
        x: isPinAnnotation(annotation) ? centerX : anchorRect.left,
        y: isPinAnnotation(annotation) ? topY - 8 : bottomY + 6,
      },
      anchorRect,
    };
  }, []);

  const openAnnotationMenu = useCallback((annotation: AnnotationItem) => {
    const placement = buildAnnotationMenuPosition(annotation);
    if (!placement) {
      return;
    }

    setSelectedAnnotationId(annotation.id);
    setHighlightedId(annotation.id);
    setAnnotationMenuState({
      annotationId: annotation.id,
      position: placement.position,
      anchorRect: placement.anchorRect,
    });
  }, [buildAnnotationMenuPosition]);

  const findPdfAnnotationAtClientPoint = useCallback((event: React.MouseEvent): AnnotationItem | null => {
    const target = event.target as HTMLElement;
    const pageElement = target.closest('.react-pdf__Page') || target.closest('[data-page-number]');
    if (!(pageElement instanceof HTMLElement)) {
      return null;
    }

    const pageNumber = parseInt(pageElement.getAttribute('data-page-number') || '1', 10);
    if (Number.isNaN(pageNumber) || pageNumber < 1) {
      return null;
    }

    const pageRect = pageElement.getBoundingClientRect();
    if (pageRect.width <= 0 || pageRect.height <= 0) {
      return null;
    }

    const normalizedX = (event.clientX - pageRect.left) / pageRect.width;
    const normalizedY = (event.clientY - pageRect.top) / pageRect.height;

    const hitCandidates = dedupedAnnotations
      .filter((annotation) => {
        if (annotation.target.type !== 'pdf') {
          return false;
        }
        const pdfTarget = annotation.target as PdfTarget;
        if (pdfTarget.page !== pageNumber) {
          return false;
        }

        return pdfTarget.rects.some((rect) => (
          normalizedX >= rect.x1 &&
          normalizedX <= rect.x2 &&
          normalizedY >= rect.y1 &&
          normalizedY <= rect.y2
        ));
      })
      .sort((left, right) => {
        const leftTarget = left.target as PdfTarget;
        const rightTarget = right.target as PdfTarget;
        const leftArea = leftTarget.rects.reduce((sum, rect) => sum + Math.max(0, rect.x2 - rect.x1) * Math.max(0, rect.y2 - rect.y1), 0);
        const rightArea = rightTarget.rects.reduce((sum, rect) => sum + Math.max(0, rect.x2 - rect.x1) * Math.max(0, rect.y2 - rect.y1), 0);
        return leftArea - rightArea;
      });

    return hitCandidates[0] ?? null;
  }, [dedupedAnnotations]);

  useEffect(() => {
    if (!annotationMenuState) {
      return;
    }

    const annotation = annotationById.get(annotationMenuState.annotationId);
    if (!annotation) {
      setAnnotationMenuState(null);
      return;
    }

    const nextPlacement = buildAnnotationMenuPosition(annotation);
    if (!nextPlacement) {
      return;
    }

    setAnnotationMenuState((current) => (
      current && current.annotationId === annotation.id
        ? (
          Math.abs(current.position.x - nextPlacement.position.x) < 0.5 &&
          Math.abs(current.position.y - nextPlacement.position.y) < 0.5
        )
          ? current
          : {
              annotationId: current.annotationId,
              position: nextPlacement.position,
              anchorRect: nextPlacement.anchorRect,
            }
        : current
    ));
  }, [annotationById, annotationMenuState, buildAnnotationMenuPosition, renderScale, zoomMode]);

  useEffect(() => {
    const viewerContainer = getViewerScrollContainer();
    const hasFloatingMenus = Boolean(annotationMenuState || pendingSelectionDraft);
    if (!viewerContainer || !hasFloatingMenus) {
      return;
    }

    let frameId = 0;
    const syncFloatingMenus = () => {
      frameId = 0;

      if (annotationMenuState) {
        const annotation = annotationById.get(annotationMenuState.annotationId);
        if (!annotation) {
          return;
        }
        const placement = annotation ? buildAnnotationMenuPosition(annotation) : null;
        if (placement) {
          setAnnotationMenuState((current) => (
            current && current.annotationId === annotation.id
              ? {
                  annotationId: current.annotationId,
                  position: placement.position,
                  anchorRect: placement.anchorRect,
                }
              : current
          ));
        }
      }

      if (pendingSelectionDraft) {
        const placement = buildSelectionDraftMenuPosition(pendingSelectionDraft.selection);
        if (placement) {
          setPendingSelectionDraft((current) => (
            current && current.token === pendingSelectionDraft.token
              ? {
                  ...current,
                  position: placement.position,
                  anchorRect: placement.anchorRect,
                }
              : current
          ));
        }
      }
    };

    const scheduleSync = () => {
      if (frameId !== 0) {
        return;
      }
      frameId = window.requestAnimationFrame(syncFloatingMenus);
    };

    viewerContainer.addEventListener("scroll", scheduleSync, { passive: true });
    window.addEventListener("resize", scheduleSync, { passive: true });
    return () => {
      viewerContainer.removeEventListener("scroll", scheduleSync);
      window.removeEventListener("resize", scheduleSync);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [
    annotationById,
    annotationMenuState,
    buildAnnotationMenuPosition,
    buildSelectionDraftMenuPosition,
    getViewerScrollContainer,
    pendingSelectionDraft,
  ]);

  useEffect(() => {
    dedupedAnnotations.forEach((annotation) => {
      if (
        annotation.target.type !== "pdf" ||
        (annotation.style.type !== "area" && annotation.style.type !== "ink") ||
        annotation.preview ||
        isPinAnnotation(annotation) ||
        pendingAreaPreviewBackfillRef.current.has(annotation.id)
      ) {
        return;
      }

      const target = annotation.target as PdfTarget;
      const rect = target.rects[0];
      const pageElement = findPdfPageElementInScope(containerRef.current, target.page);
      if (!(pageElement instanceof HTMLElement) || !rect) {
        return;
      }

      pendingAreaPreviewBackfillRef.current.add(annotation.id);
      window.requestAnimationFrame(() => {
        try {
          const preview = buildPdfAnnotationPreviewFromPageElement(
            pageElement,
            [rect],
            annotation.style.type === "ink"
              ? { paddingRatio: 0.035, minCssWidth: 180, minCssHeight: 120 }
              : { paddingRatio: 0.012, minCssWidth: 96, minCssHeight: 72 },
          );
          if (preview) {
            updateAnnotation(annotation.id, { preview });
          }
        } finally {
          pendingAreaPreviewBackfillRef.current.delete(annotation.id);
        }
      });
    });
  }, [dedupedAnnotations, renderScale, updateAnnotation, visiblePages]);

  // Handle Ctrl+Wheel zoom only inside the current pane.
  // CRITICAL for scroll performance: we only register a non-passive wheel handler
  // while Ctrl/Meta is held. When no modifier is pressed, the browser can scroll
  // natively without waiting for JS, which eliminates scroll jank.
  useEffect(() => {
    const handleWheelZoom = (e: WheelEvent) => {
      const viewerScope = scrollContainerRef.current;
      const target = e.target instanceof Node ? e.target : null;
      if (!viewerScope || !target || !viewerScope.contains(target)) {
        return;
      }
      e.preventDefault();
      const delta = getPdfWheelZoomDelta(e.deltaY, ZOOM_STEP);
      updateManualScale((current) => current + delta);
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
  }, [updateManualScale]);

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

  const storedPdfAnnotations = useMemo(() => {
    return dedupedAnnotations.filter((annotation) => (
      annotation.target.type === "pdf" &&
      annotation.style.type !== "ink" &&
      annotation.style.type !== "text"
    ));
  }, [dedupedAnnotations]);

  // Get ink annotations for custom rendering
  const inkAnnotations = useMemo(() => {
    return dedupedAnnotations.filter((annotation) => (
      annotation.target.type === 'pdf' &&
      annotation.style.type === 'ink'
    ));
  }, [dedupedAnnotations]);

  // Get text annotations for custom rendering
  const textAnnotations = useMemo(() => {
    return dedupedAnnotations.filter((annotation) => (
      annotation.target.type === 'pdf' &&
      annotation.style.type === 'text'
    ));
  }, [dedupedAnnotations]);

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

  const handlePdfSurfaceClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool === 'note' || activeTool === 'text') {
      handlePdfClick(event);
      return;
    }

    if (activeTool !== 'select' && activeTool !== 'highlight' && activeTool !== 'underline') {
      return;
    }

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      return;
    }

    const annotation = findPdfAnnotationAtClientPoint(event);
    if (!annotation) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openAnnotationMenu(annotation);
  }, [activeTool, findPdfAnnotationAtClientPoint, handlePdfClick, openAnnotationMenu]);

  const handleAreaMouseDown = useCallback((event: React.MouseEvent) => {
    if (activeTool !== 'area') return;

    const target = event.target as HTMLElement;
    const pageElement = target.closest('.react-pdf__Page') || target.closest('[data-page-number]');
    if (!(pageElement instanceof HTMLElement)) return;

    const pageNumber = parseInt(pageElement.getAttribute('data-page-number') || '1', 10);
    const pageRect = pageElement.getBoundingClientRect();
    const startX = Math.max(0, Math.min(pageRect.width, event.clientX - pageRect.left));
    const startY = Math.max(0, Math.min(pageRect.height, event.clientY - pageRect.top));

    areaSelectionPageElementRef.current = pageElement;
    areaSelectionStartRef.current = { x: startX, y: startY };
    areaSelectionDraftRef.current = {
      page: pageNumber,
      left: startX,
      top: startY,
      width: 0,
      height: 0,
    };
    setAreaSelectionDraft(areaSelectionDraftRef.current);

    event.preventDefault();
    event.stopPropagation();
  }, [activeTool]);

  const handleAreaMouseMove = useCallback((event: React.MouseEvent) => {
    if (activeTool !== 'area') return;
    const start = areaSelectionStartRef.current;
    const pageElement = areaSelectionPageElementRef.current;
    if (!start || !pageElement) return;

    const pageRect = pageElement.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(pageRect.width, event.clientX - pageRect.left));
    const currentY = Math.max(0, Math.min(pageRect.height, event.clientY - pageRect.top));
    const draft = {
      page: parseInt(pageElement.getAttribute('data-page-number') || '1', 10),
      left: Math.min(start.x, currentX),
      top: Math.min(start.y, currentY),
      width: Math.abs(currentX - start.x),
      height: Math.abs(currentY - start.y),
    };
    areaSelectionDraftRef.current = draft;
    setAreaSelectionDraft(draft);
    event.preventDefault();
  }, [activeTool]);

  const resetAreaSelectionDraft = useCallback(() => {
    areaSelectionDraftRef.current = null;
    areaSelectionStartRef.current = null;
    areaSelectionPageElementRef.current = null;
    setAreaSelectionDraft(null);
  }, []);

  useEffect(() => {
    if (activeTool !== 'area') {
      resetAreaSelectionDraft();
    }
  }, [activeTool, resetAreaSelectionDraft]);

  const handleAreaMouseUp = useCallback(() => {
    if (activeTool !== 'area') return;
    const draft = areaSelectionDraftRef.current;
    const pageElement = areaSelectionPageElementRef.current;
    if (!draft || !pageElement) {
      resetAreaSelectionDraft();
      return;
    }

    const pageRect = pageElement.getBoundingClientRect();
    const minimumSize = 4;
    if (draft.width < minimumSize || draft.height < minimumSize) {
      resetAreaSelectionDraft();
      return;
    }

    const rect = {
      x1: Math.max(0, Math.min(1, draft.left / pageRect.width)),
      y1: Math.max(0, Math.min(1, draft.top / pageRect.height)),
      x2: Math.max(0, Math.min(1, (draft.left + draft.width) / pageRect.width)),
      y2: Math.max(0, Math.min(1, (draft.top + draft.height) / pageRect.height)),
    };

    const annotation: Omit<AnnotationItem, 'id' | 'createdAt'> = {
      target: {
        type: 'pdf',
        page: draft.page,
        rects: [rect],
      },
      style: {
        color: activeColor,
        type: 'area',
      },
      author: 'user',
    };

    const preview = buildPdfAnnotationPreviewFromPageElement(pageElement, [rect], {
      paddingRatio: 0.012,
      minCssWidth: 96,
      minCssHeight: 72,
    });
    if (preview) {
      annotation.preview = preview;
    }

    addAnnotation(annotation);
    resetAreaSelectionDraft();
  }, [activeColor, activeTool, addAnnotation, resetAreaSelectionDraft]);

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

  const cancelPendingAnnotationScroll = useCallback(() => {
    if (pendingAnnotationScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingAnnotationScrollFrameRef.current);
      pendingAnnotationScrollFrameRef.current = null;
    }
  }, []);

  const buildPdfNavigationScrollTarget = useCallback((page: number, rects: PdfTarget["rects"] = []) => {
    const container = getViewerScrollContainer();
    const pageElement = findPdfPageElementInScope(containerRef.current, page);
    if (!container || !pageElement) {
      return null;
    }

    const pageRect = pageElement.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const pageOffsetTop = pageRect.top - containerRect.top + container.scrollTop;
    const pageOffsetLeft = pageRect.left - containerRect.left + container.scrollLeft;

    let targetScrollTop = pageOffsetTop + Math.max(0, (pageRect.height - container.clientHeight) / 2);
    let targetScrollLeft = pageOffsetLeft + Math.max(0, (pageRect.width - container.clientWidth) / 2);
    const hasRectTarget = rects.length > 0;

    if (hasRectTarget) {
      const unionLeft = Math.min(...rects.map((rect) => rect.x1));
      const unionTop = Math.min(...rects.map((rect) => rect.y1));
      const unionRight = Math.max(...rects.map((rect) => rect.x2));
      const unionBottom = Math.max(...rects.map((rect) => rect.y2));
      const centerX = ((unionLeft + unionRight) / 2) * pageRect.width;
      const centerY = ((unionTop + unionBottom) / 2) * pageRect.height;
      targetScrollTop = pageOffsetTop + centerY - (container.clientHeight / 2);
      targetScrollLeft = pageOffsetLeft + centerX - (container.clientWidth / 2);
    }

    return {
      container,
      pageElement,
      top: Math.max(0, Math.min(targetScrollTop, Math.max(0, container.scrollHeight - container.clientHeight))),
      left: Math.max(0, Math.min(targetScrollLeft, Math.max(0, container.scrollWidth - container.clientWidth))),
      hasRectTarget,
      isMeasured: pageElement.dataset.pdfPageMeasured === "true" || pageDimensions.has(page),
      isVisible: pageElement.dataset.pdfPageVisible === "true",
    };
  }, [getViewerScrollContainer, pageDimensions]);

  const scrollPdfTargetIntoView = useCallback((input: {
    page: number;
    rects?: PdfTarget["rects"];
    flashPage?: boolean;
  }) => {
    cancelPendingAnnotationScroll();
    warmVisiblePages(input.page);

    let attemptsLeft = 180;
    let settledFrames = 0;
    const attemptScroll = () => {
      const target = buildPdfNavigationScrollTarget(input.page, input.rects ?? []);
      if (!target) {
        attemptsLeft -= 1;
        if (attemptsLeft <= 0) {
          pendingAnnotationScrollFrameRef.current = null;
          return;
        }
        pendingAnnotationScrollFrameRef.current = window.requestAnimationFrame(attemptScroll);
        return;
      }

      const isReadyForPreciseScroll = target.isVisible && target.isMeasured;
      const animateIntoPosition = () => {
        const startTop = target.container.scrollTop;
        const startLeft = target.container.scrollLeft;
        const deltaTop = target.top - startTop;
        const deltaLeft = target.left - startLeft;
        const shouldAnimate = Math.abs(deltaTop) > 24 || Math.abs(deltaLeft) > 24;

        if (!shouldAnimate) {
          target.container.scrollTo({
            top: target.top,
            left: target.left,
            behavior: "auto",
          });
          if (input.flashPage && !target.hasRectTarget) {
            scheduleTimeout(() => flashPdfElement(target.pageElement), 120);
          }
          pendingAnnotationScrollFrameRef.current = null;
          return;
        }

        const durationMs = 180;
        let startTime: number | null = null;
        const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);
        const animate = (timestamp: number) => {
          if (startTime === null) {
            startTime = timestamp;
          }
          const progress = Math.min(1, (timestamp - startTime) / durationMs);
          const eased = easeOutCubic(progress);
          target.container.scrollTo({
            top: startTop + (deltaTop * eased),
            left: startLeft + (deltaLeft * eased),
            behavior: "auto",
          });
          if (progress < 1) {
            pendingAnnotationScrollFrameRef.current = window.requestAnimationFrame(animate);
            return;
          }
          target.container.scrollTo({
            top: target.top,
            left: target.left,
            behavior: "auto",
          });
          if (input.flashPage && !target.hasRectTarget) {
            scheduleTimeout(() => flashPdfElement(target.pageElement), 120);
          }
          pendingAnnotationScrollFrameRef.current = null;
        };

        pendingAnnotationScrollFrameRef.current = window.requestAnimationFrame(animate);
      };

      if (isReadyForPreciseScroll && settledFrames >= 2) {
        animateIntoPosition();
        return;
      }

      target.container.scrollTo({
        top: target.top,
        left: target.left,
        behavior: "auto",
      });

      if (!isReadyForPreciseScroll || settledFrames < 2) {
        attemptsLeft -= 1;
        settledFrames = isReadyForPreciseScroll ? settledFrames + 1 : 0;
        if (attemptsLeft > 0) {
          pendingAnnotationScrollFrameRef.current = window.requestAnimationFrame(attemptScroll);
          return;
        }
      }

      animateIntoPosition();
    };

    attemptScroll();
  }, [buildPdfNavigationScrollTarget, cancelPendingAnnotationScroll, flashPdfElement, scheduleTimeout, warmVisiblePages]);

  const schedulePdfTargetIntoViewAfterLayout = useCallback((input: {
    page: number;
    rects?: PdfTarget["rects"];
    flashPage?: boolean;
  }) => {
    cancelPendingAnnotationScroll();

    let framesLeft = 2;
    const run = () => {
      if (framesLeft > 0) {
        framesLeft -= 1;
        pendingAnnotationScrollFrameRef.current = window.requestAnimationFrame(run);
        return;
      }

      pendingAnnotationScrollFrameRef.current = null;
      scrollPdfTargetIntoView(input);
    };

    pendingAnnotationScrollFrameRef.current = window.requestAnimationFrame(run);
  }, [cancelPendingAnnotationScroll, scrollPdfTargetIntoView]);

  // Handle sidebar annotation selection - scroll to exact annotation position
  const handleSidebarSelect = useCallback((annotation: AnnotationItem) => {
    setShowSidebar(true);
    setSelectedAnnotationId(annotation.id);
    setHighlightedId(annotation.id);

    if (annotation.target.type === 'pdf') {
      const target = annotation.target as PdfTarget;
      schedulePdfTargetIntoViewAfterLayout({
        page: target.page,
        rects: target.rects,
      });
    }

    scheduleTimeout(() => setHighlightedId(null), 2500);
  }, [schedulePdfTargetIntoViewAfterLayout, scheduleTimeout]);

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

        setSelectedAnnotationId(annotationId);
        setHighlightedId(annotationId);
        schedulePdfTargetIntoViewAfterLayout({
          page,
          flashPage: true,
        });
        scheduleTimeout(() => setHighlightedId(null), 2000);
      },
    },
  });

  useEffect(() => {
    if (!pendingNavigation || !isSameWorkspacePath(pendingNavigation.filePath, filePath)) {
      return;
    }

    const consumed = consumePendingNavigation(paneId, filePath);
    if (consumed) {
      setDeferredNavigation(consumed);
    }
  }, [consumePendingNavigation, filePath, paneId, pendingNavigation]);

  useEffect(() => {
    if (!deferredNavigation || !isSameWorkspacePath(deferredNavigation.filePath, filePath)) {
      return;
    }

    const pendingTarget = deferredNavigation.target;
    let frameId = 0;

    const finish = () => {
      setDeferredNavigation((current) => (
        current?.requestedAt === deferredNavigation.requestedAt ? null : current
      ));
    };

    const attemptNavigation = () => {
      if (pendingTarget.type === "pdf_page") {
        schedulePdfTargetIntoViewAfterLayout({
          page: pendingTarget.page,
          flashPage: true,
        });
        finish();
        return true;
      }

      if (pendingTarget.type === "pdf_annotation") {
        const annotation = annotationById.get(pendingTarget.annotationId);
        if (!annotation) {
          if (Date.now() - deferredNavigation.requestedAt > 15000) {
            setShowSidebar(true);
            setSelectedAnnotationId(pendingTarget.annotationId);
            setHighlightedId(pendingTarget.annotationId);
            scheduleTimeout(() => setHighlightedId(null), 2000);
            finish();
            return true;
          }
          return false;
        }
        handleSidebarSelect(annotation);
        finish();
        return true;
      }

      return false;
    };

    if (attemptNavigation()) {
      return;
    }

    const retry = () => {
      if (attemptNavigation()) {
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
  }, [annotationById, deferredNavigation, filePath, handleSidebarSelect, schedulePdfTargetIntoViewAfterLayout, scheduleTimeout]);

  if (annotationsError) {
    console.error('Annotation error:', annotationsError);
  }
  if (pdfItemError) {
    console.error("PDF item workspace error:", pdfItemError);
  }

  const renderPdfViewport = (fillHeight: boolean) => (
    <div
      ref={scrollContainerRef}
      className={`relative flex-1 min-h-0 min-w-0 overflow-hidden bg-muted/30${fillHeight ? " h-full" : ""}`}
      data-testid={`pdf-scroll-container-${paneId}`}
      onPointerDownCapture={beginNativePdfSelectionInteraction}
      onPointerUp={freezeNativePdfSelectionSnapshot}
      onClick={handlePdfSurfaceClick}
      onMouseDown={
        activeTool === 'area'
          ? handleAreaMouseDown
          : activeTool === 'ink'
            ? handleInkMouseDown
            : undefined
      }
      onMouseMove={
        activeTool === 'area'
          ? handleAreaMouseMove
          : activeTool === 'ink' || isDrawingStroke
            ? handleInkMouseMove
            : undefined
      }
      onMouseUp={
        activeTool === 'area'
          ? handleAreaMouseUp
          : activeTool === 'ink' || isDrawingStroke
            ? handleInkMouseUp
            : undefined
      }
      onMouseLeave={
        activeTool === 'area'
          ? handleAreaMouseUp
          : activeTool === 'ink' || isDrawingStroke
            ? handleInkMouseUp
            : undefined
      }
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
      {pdfLoadError ? (
        <div className="flex items-center justify-center gap-2 py-8">
          <span className="text-sm text-destructive">{pdfLoadError}</span>
        </div>
      ) : (
        <div
          ref={viewerContainerRef}
          className="relative h-full w-full min-w-0 overflow-auto bg-muted/30 p-4"
          data-testid={isDiagnosticsMode ? `pdf-viewer-container-${paneId}` : undefined}
        >
          <Document
            key={`${paneId}:${fileId}`}
            file={pdfFileData}
            onLoadSuccess={(pdf) => handlePdfDocumentReady(pdf as unknown as PDFDocumentProxy)}
            onLoadError={handlePdfDocumentError}
            loading={
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">{t("pdf.loading")}</span>
              </div>
            }
          >
            <div
              className="flex min-w-full flex-col items-center gap-4"
              style={{ minWidth: `${widestMeasuredPageWidth * renderScale}px` }}
            >
              {Array.from({ length: numPages }, (_, index) => {
                const pageNumber = index + 1;
                const dimensions = pageDimensions.get(pageNumber);
                return (
                  <AdapterVirtualPage
                    key={pageNumber}
                    pageNumber={pageNumber}
                    scale={renderScale}
                    devicePixelRatio={pageDevicePixelRatio}
                    isVisible={renderedPages.has(pageNumber)}
                    measuredHeight={dimensions?.height ?? null}
                    measuredWidth={dimensions?.width ?? null}
                    onMeasure={handlePageMeasure}
                    observer={pageObserver}
                  />
                );
              })}
            </div>
          </Document>
        </div>
      )}

      {storedPdfAnnotations.map((annotation) => {
        const target = annotation.target as PdfTarget;
        return (
          <PdfStoredAnnotationPortal
            key={annotation.id}
            annotation={annotation}
            page={target.page}
            paneRootRef={containerRef}
            isActive={highlightedId === annotation.id || hoveredAnnotationId === annotation.id || selectedAnnotationId === annotation.id}
            onHoverChange={(isHovered) => setHoveredAnnotationId(isHovered ? annotation.id : null)}
            onClick={() => openAnnotationMenu(annotation)}
          />
        );
      })}

      {annotationMenuState ? (
        (() => {
          const annotation = annotationById.get(annotationMenuState.annotationId);
          if (!annotation) {
            return null;
          }

          return (
            <PdfStoredAnnotationMenu
              annotation={annotation}
              position={annotationMenuState.position}
              anchorRect={annotationMenuState.anchorRect}
              onClose={() => setAnnotationMenuState(null)}
              onDelete={() => {
                deleteAnnotation(annotation.id);
                if (selectedAnnotationId === annotation.id) {
                  setSelectedAnnotationId(null);
                }
              }}
              onAddComment={(comment) => updateAnnotation(annotation.id, { comment })}
              onChangeColor={(color) => updateAnnotation(annotation.id, { style: { color } })}
              onConvertStyle={annotation.style.type === "highlight" || annotation.style.type === "underline"
                ? () => {
                    const nextType = annotation.style.type === "highlight" ? "underline" : "highlight";
                    updateAnnotation(annotation.id, { style: { type: nextType } });
                  }
                : undefined}
            />
          );
        })()
      ) : null}

      {!pdfFileData ? (
        <div className="flex items-center justify-center gap-2 py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">{t("pdf.loading")}</span>
        </div>
      ) : null}

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
            scale={renderScale}
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
            scale={renderScale}
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

      {areaSelectionDraft && (
        <PdfAreaSelectionDraftPortal
          draft={areaSelectionDraft}
          paneRootRef={containerRef}
          color={activeColor}
        />
      )}

      {currentInkPage !== null && currentInkPath.length > 0 && (
        <CurrentInkPathPortal
          path={currentInkPath}
          page={currentInkPage}
          color={activeColor}
          scale={renderScale}
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

      {annotationDefaultsMenu ? (
        <PdfAnnotationDefaultsMenu
          state={annotationDefaultsMenu}
          activeColor={activeColor}
          onSelectColor={setActiveColor}
          onClose={() => setAnnotationDefaultsMenu(null)}
        />
      ) : null}

      {pendingSelectionDraft ? (
        <PdfSelectionDraftMenu
          selection={pendingSelectionDraft.selection}
          position={pendingSelectionDraft.position}
          anchorRect={pendingSelectionDraft.anchorRect}
          onColorSelect={(color) => {
            const annotationData = resolvedTextSelectionToAnnotationData({
              selection: pendingSelectionDraft.selection,
              color,
              author: 'user',
              styleType: 'highlight',
            });
            addAnnotation(annotationData);
            clearTransientSelection({ nextPhase: 'committed' });
          }}
          onCancel={() => clearTransientSelection({ nextPhase: 'cancelled' })}
        />
      ) : null}

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
          <span data-testid={`pdf-selection-source-${paneId}`}>{frozenPdfSelection?.textQuote?.source ?? "none"}</span>
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
                  documentId={effectiveBinding?.documentId ?? pdfItemManifest?.itemId ?? null}
                  fileName={fileName}
                  filePath={filePath}
                  paneId={paneId}
                  annotations={dedupedAnnotations}
                  manifest={pdfItemManifest}
                />
                <div className="min-h-0 flex-1 overflow-hidden">
                  <PdfAnnotationSidebar
                    annotations={dedupedAnnotations}
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
