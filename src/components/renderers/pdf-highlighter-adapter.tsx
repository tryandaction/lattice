"use client";

/**
 * PDF Highlighter Adapter
 * 
 * Integrates the PDF annotation runtime with the Universal Annotation Manager.
 * Provides text selection highlighting and Pin Mode for sticky notes.
 */

import React, { memo, useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import ReactDOM from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import type { CSSProperties } from "react";
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
  Copy,
  Search,
  PanelLeft,
  ArrowLeftRight,
  Maximize2,
  RotateCcw,
  FileOutput,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnnotationSystem, type AnnotationUpdates } from "@/hooks/use-annotation-system";
import { useAnnotationNavigation } from "@/hooks/use-annotation-navigation";
import { useInkAnnotation, type MergedInkAnnotation, type InkStroke } from "@/hooks/use-ink-annotation";
import { HIGHLIGHT_COLORS, BACKGROUND_COLORS, TEXT_COLORS, TEXT_FONT_SIZES, DEFAULT_TEXT_STYLE, DEFAULT_HIGHLIGHT_COLOR, hexToRGB, resolveHighlightColor } from "@/lib/annotation-colors";
import { exportPdfWithAnnotations } from "./pdf-export-button";
import { PdfAnnotationSidebar } from "./pdf-annotation-sidebar";
import { PdfItemWorkspacePanel } from "./pdf-item-workspace-panel";
import { InkWidthPicker } from "./ink-color-picker";
import { PdfSearchOverlay } from "./pdf-search-overlay";
import { DEFAULT_INK_STYLE } from "@/types/ink-annotation";
import { adjustPopupPosition, type PopupSize } from "@/lib/coordinate-adapter";
import type { AnnotationItem, BoundingBox, PdfTarget, UniversalAnnotationFile } from "@/types/universal-annotation";
import { useInkAnnotationStore } from "@/stores/ink-annotation-store";
import { SelectionContextMenu } from "@/components/ai/selection-context-menu";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";
import type { CommandBarState, PaneId } from "@/types/layout";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import type { PendingPaneNavigation } from "@/stores/link-navigation-store";
import { isSameWorkspacePath } from "@/lib/link-router/path-utils";
import { createSelectionContext, type SelectionAiMode, type SelectionContext } from "@/lib/ai/selection-context";
import { useSelectionContextMenu } from "@/hooks/use-selection-context-menu";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useFileSystem } from "@/hooks/use-file-system";
import { useI18n } from "@/hooks/use-i18n";
import type { TranslationKey } from "@/lib/i18n";
import { usePaneCommandBar } from "@/hooks/use-pane-command-bar";
import { getDesktopPreviewPath, readDesktopFileBytesRaw } from "@/lib/desktop-preview";
import {
  clearDesktopPdfPageTextLayoutCache,
  getDesktopPdfPath,
  peekDesktopPdfPageTextLayout,
  prefetchDesktopPdfPageTextLayout,
} from "@/lib/pdf-native-text-engine";
import {
  peekDesktopPdfOcrPageTextLayout,
  prefetchDesktopPdfOcrPageTextLayout,
  shouldUsePdfOcrFallback,
} from "@/lib/pdf-ocr-text-engine";
import { createLatestRunGuard, withTimeout } from "@/lib/async-task-guard";
import { loadPdfJsDocument, pdfJsWorkerUrl } from "@/lib/pdf-js-document-loader";
import { resolvePdfDocumentBinding, type ResolvedPdfDocumentBinding } from "@/lib/pdf-document-binding";
import {
  ensurePdfItemWorkspace,
  ensurePdfItemWorkspaceForBinding,
  loadPdfItemManifest,
  loadPdfItemManifestForBinding,
  readPdfItemAnnotationMarkdown,
  removeResolvedPdfItemAnnotationMarkdownDrafts,
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
  DEFAULT_PDF_ANNOTATION_SIDEBAR_VIEW_STATE,
  DEFAULT_PDF_ANNOTATION_TOOLBAR_VIEW_STATE,
  DEFAULT_PDF_VIEWPORT_ANCHOR,
  findPrimaryVisiblePdfPage,
  getPdfWheelZoomDelta,
  isPdfInteractionActive,
  normalizePdfAnnotationSidebarViewState,
  normalizePdfAnnotationToolbarViewState,
  readCachedPdfViewState,
  resolvePdfAnchorScrollTarget,
  restoreRelativeScrollPosition,
  setScopedPdfPaneId,
  type PdfAnnotationSidebarViewState,
  type PdfAnnotationToolbarViewState,
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
import {
  buildRenderedPdfPageTextModel,
  getPdfPageTextModel,
  normalizePdfText,
  type PdfPageTextModel,
} from "@/lib/pdf-page-text-cache";
import {
  buildPdfTextAnchorFromOffsets,
  resolvePdfExactQuoteOffsets,
} from "@/lib/pdf-canonical-text-anchoring";
import { buildPersistedFileViewStateKey, loadPersistedFileViewState, savePersistedFileViewState, type PersistedFileViewState } from "@/lib/file-view-state";
import { logger } from "@/lib/logger";
import {
  createPinAnnotation as createPdfPinAnnotation,
  isPinAnnotation,
} from "@/lib/pdf-highlight-mapping";
import {
  adjustPdfAnnotationAnchorFromPointer,
  resolvePdfAnnotationTextAnchor,
  type PdfAnnotationTextAnchor,
} from "@/lib/pdf-annotation-adjustment";
import {
  buildCanonicalPdfTextMarkupAnnotationFromExact,
  canonicalizePdfTextAnnotationFromModel,
  repairPdfTextAnnotationFromModel,
} from "@/lib/pdf-annotation-text-repair";
import { parsePdfAnnotationMarkdownDrafts } from "@/lib/pdf-annotation-markdown-drafts";
import {
  upsertCanonicalPdfTextMarkupAnnotationInFile,
} from "@/lib/pdf-annotation-sidecar-canonical";
import type { BinaryViewerContent } from "@/types/viewer-content";
import { getCanonicalPdfAnnotationText } from "@/types/universal-annotation";
import type { UnderlineStyleType } from "@/types/universal-annotation";
import {
  resolvePdfSelectionFromNativeRange,
  type PdfResolvedSelection,
} from "@/lib/pdf-selection-reconciler";
import {
  buildPdfTextKernelAnchor,
  buildPdfTextKernelPage,
  buildPdfTextKernelRunRects,
  type PdfTextKernelPage,
} from "@/lib/pdf-text-kernel";
import type { PdfSearchMatch } from "@/lib/pdf-search";
import {
  isLikelyCoarseTextMarkupGeometry,
  isPlausibleTextMarkupBox,
  mergePdfTextOverlayRects,
  mergePageRelativePdfTextMarkupRects,
  type PdfMergedTextOverlaySegment,
} from "@/lib/pdf-text-rects";
import {
  DEFAULT_PDF_INK_ERASER_SIZE,
  DEFAULT_PDF_INK_WIDTH,
  getPdfInkBoundingBox,
  isPointNearPdfInkPath,
  parsePdfInkContent,
  serializePdfInkContent,
  updatePdfInkAnnotationAfterErase,
  type PdfInkEraserMode,
  type PdfInkPath,
} from "@/lib/pdf-ink";
import {
  buildPdfPreviewRect,
  buildPdfSelectionRects,
  buildPdfSelectionRectsFromSnapshot,
  dedupeAnnotationsById,
  findPdfPageElementInScope,
  pdfSearchRectsToTargetRects,
  resolveSidebarSelectionTarget,
  shouldPreserveExistingPdfSelectionText,
  shouldClearSelectedAnnotationAfterDelete,
} from "@/lib/pdf-highlighter-adapter-utils";
import { normalizePdfReadableText } from "@/lib/pdf-readable-text";

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
  preloadedPdfDocument?: PDFDocumentProxy | null;
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

interface PdfRepairedAnnotationEntry {
  sourceSignature: string;
  repairedSignature: string;
  annotation: AnnotationItem;
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

interface PdfSelectionPointerEndEvent {
  clientX: number;
  clientY: number;
  target: EventTarget | null;
}

interface PdfSelectionPointerEvent extends PdfSelectionPointerEndEvent {
  pointerId?: number;
}

type PdfSelectionNativeEvent = Event & {
  __latticePdfSelectionPointerDownHandled?: boolean;
};

function getReactNativePdfSelectionEvent(event: unknown): PdfSelectionNativeEvent | null {
  if (!event || typeof event !== "object" || !("nativeEvent" in event)) {
    return null;
  }

  const nativeEvent = (event as { nativeEvent?: Event }).nativeEvent;
  return nativeEvent ? nativeEvent as PdfSelectionNativeEvent : null;
}

function getNativePdfSelectionSnapshotGeometryScore(snapshot: NativePdfSelectionSnapshot): number {
  const rectArea = snapshot.clientRects.reduce((sum, rect) => (
    sum + Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top)
  ), 0);
  return (snapshot.clientRects.length * 100000) + rectArea;
}

function getPdfNativeSelectionSnapshotPriority(input: {
  snapshot: NativePdfSelectionSnapshot;
  frozenSnapshot: NativePdfSelectionSnapshot | null;
  currentSnapshot: NativePdfSelectionSnapshot | null;
}): number {
  if (input.snapshot === input.currentSnapshot) {
    return 3;
  }
  if (input.snapshot === input.frozenSnapshot) {
    return 2;
  }
  return 1;
}

function chooseNativePdfSelectionSnapshot(input: {
  candidates: NativePdfSelectionSnapshot[];
  frozenSnapshot: NativePdfSelectionSnapshot | null;
  currentSnapshot: NativePdfSelectionSnapshot | null;
}): NativePdfSelectionSnapshot | null {
  if (input.candidates.length === 0) {
    return null;
  }

  return [...input.candidates]
    .sort((left, right) => (
      getPdfNativeSelectionSnapshotPriority({
        snapshot: right,
        frozenSnapshot: input.frozenSnapshot,
        currentSnapshot: input.currentSnapshot,
      }) -
      getPdfNativeSelectionSnapshotPriority({
        snapshot: left,
        frozenSnapshot: input.frozenSnapshot,
        currentSnapshot: input.currentSnapshot,
      }) ||
      right.capturedAt - left.capturedAt ||
      getNativePdfSelectionSnapshotGeometryScore(right) - getNativePdfSelectionSnapshotGeometryScore(left)
    ))[0] ?? null;
}

function isPdfSelectionReferenceTextTrustworthy(text: string): boolean {
  const compact = compactPdfKernelText(normalizePdfReadableReferenceText(text));
  return compact.length >= 3 && !isSuspiciousPdfNativeSelectionText(text);
}

function isPdfSelectionExpandedBeyondReference(input: {
  selection: PdfResolvedSelection;
  referenceText: string;
}): boolean {
  const referenceCompact = compactPdfKernelText(normalizePdfReadableReferenceText(input.referenceText));
  const selectionCompact = compactPdfKernelText(
    normalizePdfReadableReferenceText(input.selection.textQuote.exact || input.selection.text),
  );
  return Boolean(
    referenceCompact &&
    selectionCompact &&
    selectionCompact.includes(referenceCompact) &&
    selectionCompact.length > referenceCompact.length + Math.max(16, Math.ceil(referenceCompact.length * 0.18))
  );
}

interface PdfDiagnosticSelectionResult {
  ok: boolean;
  text: string;
  source: string;
  annotationCount: number;
  rectCount: number;
  rectMinX1: number;
  rectMaxX2: number;
  annotationId?: string | null;
}

interface PdfDiagnosticsBridge {
  runSelection: (mode: "copy" | "highlight") => boolean | Promise<PdfDiagnosticSelectionResult | false>;
  runSelectionOnPage?: (pageNumber: number, mode: "copy" | "highlight", targetPhrase?: string) => boolean | Promise<PdfDiagnosticSelectionResult | false>;
  createTextMarkupOnPage?: (
    pageNumber: number,
    exact: string,
    styleType?: "highlight" | "underline",
    color?: string,
  ) => boolean | Promise<PdfDiagnosticSelectionResult | false>;
  hasTextLayer: () => boolean;
  scrollToPage?: (pageNumber: number) => boolean;
}

interface PdfAnnotationAdjustmentDraft {
  annotationId: string;
  page: number;
  anchor: PdfAnnotationTextAnchor;
  source: "start" | "end";
}

type PdfAreaAdjustmentHandle = "move" | "nw" | "ne" | "sw" | "se";

interface PdfAreaAdjustmentDraft {
  annotationId: string;
  page: number;
  rect: BoundingBox;
  handle: PdfAreaAdjustmentHandle;
}

interface PdfPointerGestureState {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
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

function isPdfLinkAnnotationTarget(target: EventTarget | null | undefined): target is HTMLElement {
  return target instanceof HTMLElement &&
    Boolean(target.closest(".annotationLayer a, .annotationLayer [role='link'], .linkAnnotation"));
}

function isPdfAnnotationAdjustHandleTarget(target: EventTarget | null | undefined): target is HTMLElement {
  return target instanceof HTMLElement &&
    Boolean(target.closest("[data-pdf-annotation-adjust-handle]"));
}

function isPdfAnnotationAreaHandleTarget(target: EventTarget | null | undefined): target is HTMLElement {
  return target instanceof HTMLElement &&
    Boolean(target.closest("[data-pdf-annotation-area-handle]"));
}

function getPdfAnnotationAreaHandleFromTarget(target: EventTarget | null | undefined): PdfAreaAdjustmentHandle | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  const element = target.closest<HTMLElement>("[data-pdf-annotation-area-handle]");
  const handle = element?.dataset.pdfAnnotationAreaHandle;
  if (
    handle === "move" ||
    handle === "nw" ||
    handle === "ne" ||
    handle === "sw" ||
    handle === "se"
  ) {
    return handle;
  }
  return null;
}

function getPdfStoredAnnotationIdFromTarget(target: EventTarget | null | undefined): string | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  return target.closest<HTMLElement>("[data-pdf-stored-annotation-id]")?.dataset.pdfStoredAnnotationId ?? null;
}

function isPdfAnnotationResizeHandleTarget(target: EventTarget | null | undefined): target is HTMLElement {
  return isPdfAnnotationAdjustHandleTarget(target) || isPdfAnnotationAreaHandleTarget(target);
}

function isPdfSearchOverlayTarget(target: EventTarget | null | undefined): target is HTMLElement {
  return target instanceof HTMLElement &&
    Boolean(target.closest("[data-pdf-search-overlay='true']"));
}

function isPdfTextItem(item: TextContent["items"][number]): item is TextItem {
  return typeof (item as TextItem).str === "string";
}

function normalizePdfKernelComparableText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizePdfReadableReferenceText(text: string): string {
  return normalizePdfReadableText(text);
}

function compactPdfKernelText(text: string): string {
  return normalizePdfKernelComparableText(text).replace(/\s+/g, "");
}

function isSuspiciousPdfNativeSelectionText(text: string): boolean {
  const compact = compactPdfKernelText(text);
  if (!compact) {
    return true;
  }
  if (compact.length <= 2) {
    return true;
  }
  return /^[`'"“”‘’.,;:!?()[\]{}<>|/\\+\-=_*^~0]+$/u.test(compact);
}

function isPdfReadableWordCharacter(character: string): boolean {
  return /[\p{L}\p{N}]/u.test(character);
}

function isPdfLowercaseReadableLetter(character: string): boolean {
  return /^\p{Ll}$/u.test(character);
}

function shouldAvoidPdfReadableSpaceBefore(character: string): boolean {
  return !character || /^[)\]\},.;:!?%]$/u.test(character) || /^[\u0300-\u036f]$/u.test(character);
}

function shouldAvoidPdfReadableSpaceAfter(character: string): boolean {
  return /^[([\{/$]$/u.test(character);
}

function shouldInsertPdfReadableSpaceForGeometryGap(
  previousCharacter: string,
  nextCharacter: string,
): boolean {
  if (!previousCharacter || /\s/.test(previousCharacter) || /\s/.test(nextCharacter)) {
    return false;
  }
  if (shouldAvoidPdfReadableSpaceBefore(nextCharacter) || shouldAvoidPdfReadableSpaceAfter(previousCharacter)) {
    return false;
  }

  return /[\p{L}\p{N}=+\-*/<>≤≥√|)\]]/u.test(previousCharacter) &&
    /[\p{L}\p{N}=+\-*/<>≤≥√|([{\u0394\u03a9]/u.test(nextCharacter);
}

function appendPdfReadableSpace(output: string, nextCharacter: string): string {
  if (!output || /\s$/.test(output) || shouldAvoidPdfReadableSpaceBefore(nextCharacter)) {
    return output;
  }

  const previousCharacter = output[output.length - 1] ?? "";
  if (shouldAvoidPdfReadableSpaceAfter(previousCharacter)) {
    return output;
  }

  return `${output} `;
}

function getPdfPageNumberFromElement(pageElement: Element | null | undefined): number | null {
  if (!(pageElement instanceof HTMLElement)) {
    return null;
  }

  const rawPageNumber = pageElement.dataset.pageNumber ?? pageElement.getAttribute("data-page-number");
  const pageNumber = Number.parseInt(rawPageNumber ?? "", 10);
  return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : null;
}

function findPdfPageElementFromEventTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const explicitPageElement = target.closest<HTMLElement>('[data-page-number]');
  if (explicitPageElement && getPdfPageNumberFromElement(explicitPageElement) !== null) {
    return explicitPageElement;
  }

  const reactPdfPage = target.closest<HTMLElement>('.react-pdf__Page');
  if (reactPdfPage && getPdfPageNumberFromElement(reactPdfPage) !== null) {
    return reactPdfPage;
  }

  const parentPageElement = reactPdfPage?.parentElement?.closest<HTMLElement>('[data-page-number]') ?? null;
  if (parentPageElement && getPdfPageNumberFromElement(parentPageElement) !== null) {
    return parentPageElement;
  }

  return null;
}

function findPdfPageElementAtClientPoint(
  scope: HTMLElement | null | undefined,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  if (!scope || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }

  const pages = Array.from(scope.querySelectorAll<HTMLElement>('[data-page-number]'))
    .filter((pageElement) => getPdfPageNumberFromElement(pageElement) !== null)
    .map((pageElement) => {
      const rect = pageElement.getBoundingClientRect();
      return { pageElement, rect };
    })
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)
    .filter(({ rect }) => (
      clientX >= rect.left - 1 &&
      clientX <= rect.right + 1 &&
      clientY >= rect.top - 1 &&
      clientY <= rect.bottom + 1
    ))
    .sort((left, right) => (
      (left.rect.width * left.rect.height) - (right.rect.width * right.rect.height)
    ));

  return pages[0]?.pageElement ?? null;
}

function hasMeaningfulPdfSelectionDragPoints(
  start: { x: number; y: number } | null | undefined,
  end: { x: number; y: number } | null | undefined,
): boolean {
  if (!start || !end) {
    return false;
  }

  return Math.hypot(end.x - start.x, end.y - start.y) >= 3;
}

function createCollapsedPdfPageRange(pageElement: HTMLElement | null): Range | null {
  if (!pageElement || typeof document === "undefined") {
    return null;
  }

  const scope = pageElement.querySelector<HTMLElement>(".textLayer") ?? pageElement;
  const showText = typeof NodeFilter !== "undefined" ? NodeFilter.SHOW_TEXT : 4;
  const walker = document.createTreeWalker(scope, showText);
  let textNode = walker.nextNode();
  while (textNode && (!(textNode instanceof Text) || !(textNode.textContent ?? "").length)) {
    textNode = walker.nextNode();
  }

  try {
    const range = document.createRange();
    if (textNode instanceof Text) {
      range.setStart(textNode, 0);
      range.setEnd(textNode, 0);
      return range;
    }

    range.selectNodeContents(scope);
    range.collapse(true);
    return range;
  } catch {
    return null;
  }
}

function resolvePdfSelectionReferenceOffsets(input: {
  model: PdfPageTextModel;
  selection: PdfResolvedSelection;
  referenceText: string;
}): { startOffset: number; endOffset: number } | null {
  const compactNeedle = compactPdfKernelText(normalizePdfReadableReferenceText(input.referenceText));
  if (!compactNeedle) {
    return null;
  }

  const selectionStart = Math.max(0, Math.min(input.model.normalizedText.length, input.selection.startOffset));
  const selectionEnd = Math.max(selectionStart, Math.min(input.model.normalizedText.length, input.selection.endOffset));
  const scopeStart = selectionEnd > selectionStart ? selectionStart : 0;
  const scopeEnd = selectionEnd > selectionStart ? selectionEnd : input.model.normalizedText.length;
  const scopeText = input.model.normalizedText.slice(scopeStart, scopeEnd);
  const compactOffsets: number[] = [];
  let compactScope = "";

  for (let index = 0; index < scopeText.length; index += 1) {
    const character = scopeText[index] ?? "";
    if (/\s/.test(character)) {
      continue;
    }
    compactOffsets.push(scopeStart + index);
    compactScope += character;
  }

  const compactIndex = compactScope.indexOf(compactNeedle);
  if (compactIndex < 0) {
    return null;
  }

  const rawStart = compactOffsets[compactIndex] ?? -1;
  const rawEnd = (compactOffsets[compactIndex + compactNeedle.length - 1] ?? -1) + 1;
  if (rawStart < 0 || rawEnd <= rawStart) {
    return null;
  }

  return { startOffset: rawStart, endOffset: rawEnd };
}

function trimPdfSelectionToReferenceText(
  selection: PdfResolvedSelection,
  referenceText: string,
  model?: PdfPageTextModel | null,
): PdfResolvedSelection {
  const normalizedReference = normalizePdfReadableReferenceText(referenceText);
  const referenceCompact = compactPdfKernelText(normalizedReference);
  const selectionCompact = compactPdfKernelText(normalizePdfReadableReferenceText(selection.textQuote.exact || selection.text));
  if (
    !referenceCompact ||
    !selectionCompact ||
    !selectionCompact.includes(referenceCompact) ||
    selectionCompact.length <= referenceCompact.length + Math.max(8, Math.ceil(referenceCompact.length * 0.08))
  ) {
    return selection;
  }

  if (model && model.pageNumber === selection.pageNumber) {
    const offsets = resolvePdfSelectionReferenceOffsets({
      model,
      selection,
      referenceText: normalizedReference,
    });
    const anchor = offsets
      ? buildPdfTextAnchorFromOffsets({
          model,
          startOffset: offsets.startOffset,
          endOffset: offsets.endOffset,
          source: "pdfjs-text-model",
        })
      : null;
    const pageRects = anchor?.rects.filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1) ?? [];
    if (anchor && pageRects.length > 0) {
      const viewportRects = pageRects.map((rect) => ({
        pageNumber: selection.pageNumber,
        left: rect.x1 * model.viewportWidth,
        top: rect.y1 * model.viewportHeight,
        width: Math.max(0, (rect.x2 - rect.x1) * model.viewportWidth),
        height: Math.max(0, (rect.y2 - rect.y1) * model.viewportHeight),
      })).filter((rect) => rect.width > 0 && rect.height > 0);

      return {
        ...selection,
        startOffset: anchor.startOffset,
        endOffset: anchor.endOffset,
        text: anchor.textQuote.exact,
        textQuote: anchor.textQuote,
        pageRects,
        viewportRects,
        quads: pageRects.map(pdfPageRectToQuad),
        textKernelVersion: selection.textKernelVersion ?? 1,
        textSource: "pdfjs-text-model",
        textConfidence: Math.max(selection.textConfidence ?? 1, 1),
      };
    }
  }

  return selection;
}

function getViewportRectArea(rect: { left: number; top: number; width: number; height: number }): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function isImplausiblePdfTextViewportRect(input: {
  rect: { left: number; top: number; width: number; height: number };
  pageWidth: number;
  pageHeight: number;
}): boolean {
  const width = Math.max(0, input.rect.width);
  const height = Math.max(0, input.rect.height);
  if (width <= 0 || height <= 0 || input.pageWidth <= 0 || input.pageHeight <= 0) {
    return true;
  }

  return (
    height > input.pageHeight * 0.12 ||
    width * height > input.pageWidth * input.pageHeight * 0.18
  );
}

function selectionHasImplausiblePdfTextViewportRects(input: {
  selection: PdfResolvedSelection;
  pageWidth: number;
  pageHeight: number;
}): boolean {
  const pageRects = input.selection.viewportRects.filter((rect) => rect.pageNumber === input.selection.pageNumber);
  return pageRects.some((rect) => isImplausiblePdfTextViewportRect({
    rect,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
  }));
}

function filterImplausiblePdfTextViewportRects(input: {
  viewportRects: PdfResolvedSelection["viewportRects"];
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}): PdfResolvedSelection["viewportRects"] {
  return input.viewportRects.filter((rect) => {
    if (rect.pageNumber !== input.pageNumber) {
      return true;
    }
    return !isImplausiblePdfTextViewportRect({
      rect,
      pageWidth: input.pageWidth,
      pageHeight: input.pageHeight,
    });
  });
}

function pdfPageRectsToViewportRects(input: {
  rects: PdfResolvedSelection["pageRects"];
  pageNumber: number;
  page: Pick<PdfTextKernelPage, "viewportWidth" | "viewportHeight">;
}): PdfResolvedSelection["viewportRects"] {
  return input.rects
    .map((rect) => ({
      pageNumber: input.pageNumber,
      left: rect.x1 * input.page.viewportWidth,
      top: rect.y1 * input.page.viewportHeight,
      width: Math.max(0, (rect.x2 - rect.x1) * input.page.viewportWidth),
      height: Math.max(0, (rect.y2 - rect.y1) * input.page.viewportHeight),
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

function getViewportRectOverlapArea(
  left: { left: number; top: number; width: number; height: number },
  right: { left: number; top: number; width: number; height: number },
): number {
  const x1 = Math.max(left.left, right.left);
  const y1 = Math.max(left.top, right.top);
  const x2 = Math.min(left.left + left.width, right.left + right.width);
  const y2 = Math.min(left.top + left.height, right.top + right.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function getViewportRectCenter(rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
  return {
    x: rect.left + (rect.width / 2),
    y: rect.top + (rect.height / 2),
  };
}

function getViewportRectCenterDistance(
  left: { left: number; top: number; width: number; height: number },
  right: { left: number; top: number; width: number; height: number },
): number {
  const leftCenter = getViewportRectCenter(left);
  const rightCenter = getViewportRectCenter(right);
  return Math.abs(leftCenter.x - rightCenter.x) + (Math.abs(leftCenter.y - rightCenter.y) * 0.35);
}

type PdfTextKernelChar = PdfTextKernelPage["chars"][number];

function getPdfKernelCharCenterY(char: PdfTextKernelChar): number {
  return char.viewportRect.top + (char.viewportRect.height / 2);
}

function getPdfKernelReadableLineTolerance(left: PdfTextKernelChar, right: PdfTextKernelChar): number {
  return Math.max(2.5, Math.min(left.viewportRect.height, right.viewportRect.height) * 0.6);
}

function arePdfKernelCharsOnSameVisualLine(left: PdfTextKernelChar, right: PdfTextKernelChar): boolean {
  if ((left.columnIndex ?? 0) !== (right.columnIndex ?? 0)) {
    return false;
  }

  if (
    typeof left.lineIndex === "number" &&
    typeof right.lineIndex === "number" &&
    left.lineIndex === right.lineIndex
  ) {
    return true;
  }

  return Math.abs(getPdfKernelCharCenterY(left) - getPdfKernelCharCenterY(right)) <= getPdfKernelReadableLineTolerance(left, right);
}

function comparePdfKernelCharsByTextOrder(left: PdfTextKernelChar, right: PdfTextKernelChar): number {
  return (
    left.charIndex - right.charIndex ||
    left.itemIndex - right.itemIndex ||
    left.viewportRect.left - right.viewportRect.left ||
    left.viewportRect.top - right.viewportRect.top
  );
}

function buildPdfReadableTextFromKernelChars(chars: PdfTextKernelChar[], pageText?: string): string {
  const orderedChars = [...chars]
    .filter((char) => char.normalizedText.length > 0)
    .sort(comparePdfKernelCharsByTextOrder);
  let output = "";
  let previousChar: PdfTextKernelChar | null = null;

  for (const char of orderedChars) {
    const character = char.normalizedText;
    if (/\s/.test(character)) {
      output = output && !/\s$/.test(output) ? `${output} ` : output;
      previousChar = char;
      continue;
    }

    if (previousChar) {
      const sameVisualLine = arePdfKernelCharsOnSameVisualLine(previousChar, char);
      const newVisualLine = !sameVisualLine;
      const previousRight = previousChar.viewportRect.left + previousChar.viewportRect.width;
      const horizontalGap = char.viewportRect.left - previousRight;
      const gapThreshold = Math.max(2.5, Math.min(previousChar.viewportRect.height, char.viewportRect.height) * 0.24);
      const previousOutputChar = output[output.length - 1] ?? "";
      const hasTextGapWhitespace = Boolean(
        pageText &&
        previousChar.charIndex + previousChar.normalizedText.length < char.charIndex &&
        /\s/.test(pageText.slice(previousChar.charIndex + previousChar.normalizedText.length, char.charIndex)),
      );

      if ((newVisualLine || /\s/.test(previousChar.normalizedText)) && previousOutputChar === "-" && isPdfLowercaseReadableLetter(character)) {
        output = output.slice(0, -1);
      } else if (
        (hasTextGapWhitespace && shouldInsertPdfReadableSpaceForGeometryGap(previousOutputChar, character)) ||
        (newVisualLine && !pageText) ||
        (
          sameVisualLine &&
          horizontalGap > gapThreshold &&
          shouldInsertPdfReadableSpaceForGeometryGap(previousOutputChar, character)
        )
      ) {
        output = appendPdfReadableSpace(output, character);
      }
    }

    output += character;
    previousChar = char;
  }

  return normalizePdfReadableReferenceText(output);
}

function pdfPageRectToQuad(rect: PdfResolvedSelection["pageRects"][number]) {
  return {
    x1: rect.x1,
    y1: rect.y1,
    x2: rect.x2,
    y2: rect.y1,
    x3: rect.x2,
    y3: rect.y2,
    x4: rect.x1,
    y4: rect.y2,
  };
}

function pdfTargetRectsToOverlaySegments(rects: PdfTarget["rects"]): PdfMergedTextOverlaySegment[] {
  return rects
    .map((rect) => {
      const left = Math.max(0, Math.min(100, Math.min(rect.x1, rect.x2) * 100));
      const right = Math.max(0, Math.min(100, Math.max(rect.x1, rect.x2) * 100));
      const top = Math.max(0, Math.min(100, Math.min(rect.y1, rect.y2) * 100));
      const bottom = Math.max(0, Math.min(100, Math.max(rect.y1, rect.y2) * 100));
      const height = Math.max(0, bottom - top);
      return {
        left,
        top,
        width: Math.max(0, right - left),
        height,
        baselineTop: top,
        baselineHeight: height,
      };
    })
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

function mergePdfTextMarkupRenderRectsToOverlaySegments(rects: PdfTarget["rects"]): PdfMergedTextOverlaySegment[] {
  return mergePageRelativePdfTextMarkupRects(rects).filter((segment) => segment.width > 0 && segment.height > 0);
}

function overlaySegmentsToPdfTargetRects(segments: PdfMergedTextOverlaySegment[]): PdfTarget["rects"] {
  return segments.map((segment) => ({
    x1: segment.left / 100,
    y1: segment.top / 100,
    x2: (segment.left + segment.width) / 100,
    y2: (segment.top + segment.height) / 100,
  }));
}

function normalizePdfTextMarkupRenderRects(rects: PdfTarget["rects"]): PdfTarget["rects"] {
  return rects
    .filter(isPlausibleTextMarkupBox)
    .map((rect) => ({
      x1: Math.max(0, Math.min(1, Math.min(rect.x1, rect.x2))),
      y1: Math.max(0, Math.min(1, Math.min(rect.y1, rect.y2))),
      x2: Math.max(0, Math.min(1, Math.max(rect.x1, rect.x2))),
      y2: Math.max(0, Math.min(1, Math.max(rect.y1, rect.y2))),
    }))
    .filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1)
    .sort((left, right) => left.y1 - right.y1 || left.x1 - right.x1);
}

interface PdfTextMarkupView {
  annotation: AnnotationItem & { target: PdfTarget };
  rects: PdfTarget["rects"];
  segments: PdfMergedTextOverlaySegment[];
}

function withResolvedPdfTextMarkupRects(annotation: AnnotationItem, rects: PdfTarget["rects"]): AnnotationItem & { target: PdfTarget } {
  const target = annotation.target as PdfTarget;
  return {
    ...annotation,
    target: {
      ...target,
      rects,
      quads: rects.map(pdfPageRectToQuad),
    },
  } as AnnotationItem & { target: PdfTarget };
}

function buildPdfTextMarkupAnnotationFromAnchor(
  annotation: AnnotationItem,
  anchor: {
    startOffset: number;
    endOffset: number;
    textQuote: NonNullable<PdfTarget["textQuote"]>;
    rects: PdfTarget["rects"];
  },
): AnnotationItem & { target: PdfTarget } {
  const next = withResolvedPdfTextMarkupRects(annotation, anchor.rects);
  next.content = anchor.textQuote.exact;
  next.target = {
    ...next.target,
    textQuote: anchor.textQuote,
    startCharIndex: anchor.startOffset,
    endCharIndex: anchor.endOffset,
    textSource: anchor.textQuote.source,
    textConfidence: 1,
  };
  return next;
}

function buildPdfTextMarkupViewFromRects(
  annotation: AnnotationItem,
  rects: PdfTarget["rects"],
): PdfTextMarkupView | null {
  const normalizedRects = normalizePdfTextMarkupRenderRects(rects);
  if (normalizedRects.length === 0) {
    return null;
  }

  const segments = mergePdfTextMarkupRenderRectsToOverlaySegments(normalizedRects);
  if (segments.length === 0) {
    return null;
  }

  return {
    annotation: withResolvedPdfTextMarkupRects(annotation, normalizedRects),
    rects: normalizedRects,
    segments,
  };
}

function hasBlockLikeTextMarkupGeometry(rects: PdfTarget["rects"]): boolean {
  const normalized = normalizePdfTextMarkupRenderRects(rects);
  if (normalized.length !== 1) {
    return false;
  }

  const rect = normalized[0];
  const width = rect.x2 - rect.x1;
  const height = rect.y2 - rect.y1;
  return width >= 0.12 && height >= 0.045;
}

function hasOnlyThinTextLineGeometry(rects: PdfTarget["rects"]): boolean {
  const normalized = normalizePdfTextMarkupRenderRects(rects);
  return normalized.length > 0 && normalized.every((rect) => (rect.y2 - rect.y1) < 0.045);
}

function getSafePdfTextMarkupFallbackRects(
  rects: PdfTarget["rects"],
  text?: string | null,
): PdfTarget["rects"] {
  const normalized = normalizePdfTextMarkupRenderRects(rects);
  if (
    hasBlockLikeTextMarkupGeometry(normalized) ||
    (
      isLikelyCoarseTextMarkupGeometry(normalized, text) &&
      !hasOnlyThinTextLineGeometry(normalized)
    )
  ) {
    return [];
  }

  return normalized;
}

function hasPdfTextMarkupRects(rects: PdfTarget["rects"]): boolean {
  return rects.some((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1);
}

function buildDirectPdfTextMarkupView(
  annotation: AnnotationItem,
  rects: PdfTarget["rects"],
): PdfTextMarkupView | null {
  const target = annotation.target as PdfTarget;
  const quote = target.textQuote?.exact ?? annotation.content;
  if (
    hasBlockLikeTextMarkupGeometry(rects) ||
    (isLikelyCoarseTextMarkupGeometry(rects, quote) && !hasOnlyThinTextLineGeometry(rects))
  ) {
    return null;
  }

  return buildPdfTextMarkupViewFromRects(annotation, rects);
}

function resolvePdfTextMarkupView(
  annotation: AnnotationItem,
  model?: PdfPageTextModel | null,
): PdfTextMarkupView | null {
  if (!isPdfTextMarkupAnnotation(annotation)) {
    return null;
  }

  const modelResolvedAnnotation = model
    ? repairPdfTextAnnotationFromModel(annotation, model) ??
      canonicalizePdfTextAnnotationFromModel(annotation, model) ??
      annotation
    : annotation;
  const originalTarget = annotation.target as PdfTarget;
  const modelResolvedTarget = modelResolvedAnnotation.target as PdfTarget;
  if (model) {
    const anchorCandidates = [
      resolvePdfAnnotationTextAnchor(model, modelResolvedTarget),
      modelResolvedTarget === originalTarget ? null : resolvePdfAnnotationTextAnchor(model, originalTarget),
    ];
    for (const anchor of anchorCandidates) {
      if (!anchor) {
        continue;
      }
      const anchorAnnotation = buildPdfTextMarkupAnnotationFromAnchor(modelResolvedAnnotation, anchor);
      const anchorView = buildPdfTextMarkupViewFromRects(anchorAnnotation, anchor.rects);
      if (anchorView) {
        return anchorView;
      }
    }

    return buildDirectPdfTextMarkupView(modelResolvedAnnotation, modelResolvedTarget.rects) ??
      buildDirectPdfTextMarkupView(annotation, originalTarget.rects);
  }

  return buildDirectPdfTextMarkupView(annotation, originalTarget.rects);
}

function buildPdfTextRepairSignature(annotation: AnnotationItem | null | undefined): string | null {
  if (!annotation || annotation.target.type !== "pdf") {
    return null;
  }

  const target = annotation.target as PdfTarget;
  const rectSignature = target.rects
    .map((rect) => [
      rect.x1.toFixed(6),
      rect.y1.toFixed(6),
      rect.x2.toFixed(6),
      rect.y2.toFixed(6),
    ].join(","))
    .join("|");
  const quadSignature = (target.quads ?? [])
    .map((quad) => [
      quad.x1.toFixed(6),
      quad.y1.toFixed(6),
      quad.x2.toFixed(6),
      quad.y2.toFixed(6),
      quad.x3.toFixed(6),
      quad.y3.toFixed(6),
      quad.x4.toFixed(6),
      quad.y4.toFixed(6),
    ].join(","))
    .join("|");

  return [
    annotation.style.type,
    resolveHighlightColor(annotation.style.color),
    annotation.style.underlineStyle ?? "",
    annotation.content,
    target.page,
    target.textQuote?.exact ?? "",
    target.textQuote?.prefix ?? "",
    target.textQuote?.suffix ?? "",
    target.textQuote?.source ?? "",
    target.startCharIndex ?? "",
    target.endCharIndex ?? "",
    target.textSource ?? "",
    target.textConfidence ?? "",
    target.textKernelVersion ?? "",
    rectSignature,
    quadSignature,
  ].join("::");
}

function mergeAnnotationUpdatesForDisplay(
  annotation: AnnotationItem,
  updates: AnnotationUpdates,
): AnnotationItem {
  return {
    ...annotation,
    content: updates.content !== undefined ? updates.content : annotation.content,
    comment: updates.comment !== undefined ? updates.comment : annotation.comment,
    preview: updates.preview !== undefined ? updates.preview : annotation.preview,
    author: updates.author !== undefined ? updates.author : annotation.author,
    createdAt: updates.createdAt !== undefined ? updates.createdAt : annotation.createdAt,
    style: updates.style
      ? { ...annotation.style, ...updates.style }
      : annotation.style,
    target: updates.target
      ? { ...annotation.target, ...updates.target } as AnnotationItem["target"]
      : annotation.target,
  };
}

function buildPdfTextMarkupViewCacheKey(
  annotation: AnnotationItem,
  model?: PdfPageTextModel | null,
): string {
  const repairSignature = buildPdfTextRepairSignature(annotation) ?? annotation.id;
  const modelSignature = model
    ? [
        model.pageNumber,
        model.viewportWidth.toFixed(2),
        model.viewportHeight.toFixed(2),
        model.normalizedText.length,
      ].join(":")
    : "no-model";
  return `${annotation.id}::${repairSignature}::${modelSignature}`;
}

function shouldAttemptPdfTextRepair(annotation: AnnotationItem): boolean {
  if (annotation.target.type !== "pdf") {
    return false;
  }
  return annotation.style.type === "highlight" || annotation.style.type === "underline";
}

function getCompactPdfAnnotationText(annotation: AnnotationItem): string {
  const target = annotation.target.type === "pdf" ? annotation.target as PdfTarget : null;
  return normalizePdfReadableReferenceText(target?.textQuote?.exact ?? annotation.content ?? "")
    .replace(/\s+/g, "");
}

function getPdfTargetRectsArea(rects: PdfTarget["rects"]): number {
  return rects.reduce((sum, rect) => (
    sum + Math.max(0, rect.x2 - rect.x1) * Math.max(0, rect.y2 - rect.y1)
  ), 0);
}

function isSafePdfTextRepairWriteback(source: AnnotationItem, repaired: AnnotationItem): boolean {
  if (source.target.type !== "pdf" || repaired.target.type !== "pdf") {
    return false;
  }
  if (source.style.type !== "highlight" && source.style.type !== "underline") {
    return false;
  }
  if (repaired.style.type !== "highlight" && repaired.style.type !== "underline") {
    return false;
  }

  const sourceTarget = source.target as PdfTarget;
  const repairedTarget = repaired.target as PdfTarget;
  const sourceText = getCompactPdfAnnotationText(source);
  const repairedText = getCompactPdfAnnotationText(repaired);
  if (!sourceText || !repairedText) {
    return false;
  }
  const sourceIsBrokenBoundary =
    sourceText.length <= 3 ||
    /^(?:\W*)?5,thattend/i.test(sourceText) ||
    /direcns/i.test(sourceText) ||
    /arkshifts/i.test(sourceText);
  if (sourceText !== repairedText) {
    const isTinySafeBoundaryRepair =
      sourceIsBrokenBoundary &&
      repairedText.includes(sourceText.replace(/^\W+/, "")) &&
      repairedText.length <= sourceText.length + Math.max(24, Math.ceil(sourceText.length * 0.28));
    if (!isTinySafeBoundaryRepair) {
      return false;
    }
  }

  if (
    Number.isInteger(sourceTarget.startCharIndex) &&
    Number.isInteger(sourceTarget.endCharIndex) &&
    typeof sourceTarget.startCharIndex === "number" &&
    typeof sourceTarget.endCharIndex === "number" &&
    Number.isInteger(repairedTarget.startCharIndex) &&
    Number.isInteger(repairedTarget.endCharIndex) &&
    typeof repairedTarget.startCharIndex === "number" &&
    typeof repairedTarget.endCharIndex === "number"
  ) {
    const sourceSpan = sourceTarget.endCharIndex - sourceTarget.startCharIndex;
    const repairedSpan = repairedTarget.endCharIndex - repairedTarget.startCharIndex;
    if (repairedSpan > sourceSpan + Math.max(8, Math.ceil(sourceSpan * 0.08))) {
      return false;
    }
  }

  const sourceArea = getPdfTargetRectsArea(sourceTarget.rects);
  const repairedArea = getPdfTargetRectsArea(repairedTarget.rects);
  if (!sourceIsBrokenBoundary && sourceArea > 0 && repairedArea > sourceArea * 1.08) {
    return false;
  }

  return repairedTarget.rects.length > 0;
}

function isPdfTextMarkupAnnotation(annotation: AnnotationItem): annotation is AnnotationItem & { target: PdfTarget } {
  return annotation.target.type === "pdf" &&
    (annotation.style.type === "highlight" || annotation.style.type === "underline");
}

function buildPdfKernelLinePageRects(input: {
  page: PdfTextKernelPage;
  chars: PdfTextKernelChar[];
}): PdfResolvedSelection["pageRects"] {
  return buildPdfTextKernelRunRects(input.page, input.chars);
}

function buildPdfKernelSelectionFromViewportGeometry(input: {
  selection: PdfResolvedSelection;
  model: PdfPageTextModel;
  page: PdfTextKernelPage;
  viewportRects?: PdfResolvedSelection["viewportRects"];
}): PdfResolvedSelection | null {
  const referenceRects = getSelectionViewportReferenceRects({
    pageNumber: input.selection.pageNumber,
    viewportRects: input.viewportRects,
  });
  if (referenceRects.length === 0) {
    return null;
  }

  const toleranceX = Math.max(2, input.page.viewportWidth * 0.0025);
  const toleranceY = Math.max(2, input.page.viewportHeight * 0.0025);
  const selectedCharSet = new Set<PdfTextKernelChar>();
  input.page.chars.forEach((char) => {
    if (!char.normalizedText) {
      return;
    }

    const selected = referenceRects.some((referenceRect) => {
      const inflated = {
        left: referenceRect.left - toleranceX,
        top: referenceRect.top - toleranceY,
        width: referenceRect.width + (toleranceX * 2),
        height: referenceRect.height + (toleranceY * 2),
      };
      const center = getViewportRectCenter(char.viewportRect);
      return (
        getViewportRectOverlapArea(char.viewportRect, inflated) > 0 ||
        (
          center.x >= inflated.left &&
          center.x <= inflated.left + inflated.width &&
          center.y >= inflated.top &&
          center.y <= inflated.top + inflated.height
        )
      );
    });

    if (selected) {
      selectedCharSet.add(char);
    }
  });
  const selectedChars = input.page.chars.filter((char, index) => {
    if (selectedCharSet.has(char)) {
      return true;
    }
    if (!/^\s$/.test(char.normalizedText)) {
      return false;
    }

    const previousChar = input.page.chars[index - 1] ?? null;
    const nextChar = input.page.chars[index + 1] ?? null;
    return Boolean(
      previousChar &&
      nextChar &&
      selectedCharSet.has(previousChar) &&
      selectedCharSet.has(nextChar) &&
      previousChar.lineIndex === nextChar.lineIndex &&
      previousChar.columnIndex === nextChar.columnIndex,
    );
  });
  const visibleChars = selectedChars.filter((char) => !/^\s$/.test(char.normalizedText));
  if (visibleChars.length === 0) {
    return null;
  }

  const text = buildPdfReadableTextFromKernelChars(selectedChars, input.model.normalizedText);
  if (!text) {
    return null;
  }

  const startOffset = Math.min(...visibleChars.map((char) => char.charIndex));
  const endOffset = Math.max(...visibleChars.map((char) => char.charIndex + char.normalizedText.length));
  if (endOffset <= startOffset) {
    return null;
  }

  const pageRects = buildPdfKernelLinePageRects({
    page: input.page,
    chars: selectedChars,
  });
  if (pageRects.length === 0) {
    return null;
  }

  const viewportRects = pageRects.map((rect) => ({
    pageNumber: input.selection.pageNumber,
    left: rect.x1 * input.page.viewportWidth,
    top: rect.y1 * input.page.viewportHeight,
    width: Math.max(0, (rect.x2 - rect.x1) * input.page.viewportWidth),
    height: Math.max(0, (rect.y2 - rect.y1) * input.page.viewportHeight),
  }));
  const confidence = visibleChars.reduce((sum, char) => sum + char.confidence, 0) / visibleChars.length;

  return {
    ...input.selection,
    startOffset,
    endOffset,
    text,
    textQuote: {
      exact: text,
      prefix: input.model.normalizedText.slice(Math.max(0, startOffset - 32), startOffset),
      suffix: input.model.normalizedText.slice(endOffset, endOffset + 32),
      source: "pdfjs-text-model",
      confidence: "exact",
    },
    pageRects,
    viewportRects,
    textKernelVersion: input.page.modelVersion,
    quads: pageRects.map(pdfPageRectToQuad),
    textSource: "pdfjs-text-model",
    textConfidence: confidence,
  };
}

function buildKernelViewportRectsForOffsets(input: {
  page: PdfTextKernelPage;
  startOffset: number;
  endOffset: number;
}): Array<{ left: number; top: number; width: number; height: number }> {
  const selectedChars = input.page.chars.filter((char) => (
    char.charIndex >= input.startOffset &&
    char.charIndex < input.endOffset &&
    !/\s/.test(char.normalizedText)
  ));
  if (selectedChars.length === 0) {
    return [];
  }

  return buildPdfTextKernelRunRects(input.page, selectedChars).map((rect) => ({
    left: rect.x1 * input.page.viewportWidth,
    top: rect.y1 * input.page.viewportHeight,
    width: Math.max(0, (rect.x2 - rect.x1) * input.page.viewportWidth),
    height: Math.max(0, (rect.y2 - rect.y1) * input.page.viewportHeight),
  }));
}

function getSelectionViewportReferenceRects(input: {
  pageNumber: number;
  viewportRects?: PdfResolvedSelection["viewportRects"];
}): Array<{ left: number; top: number; width: number; height: number }> {
  return (input.viewportRects ?? [])
    .filter((rect) => rect.pageNumber === input.pageNumber)
    .map((rect) => ({
      left: rect.left,
      top: rect.top,
      width: Math.max(0, rect.width),
      height: Math.max(0, rect.height),
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

function rebuildPdfSelectionViewportRectsFromPageRects(
  selection: PdfResolvedSelection,
  page: PdfTextKernelPage,
): PdfResolvedSelection {
  if (selection.pageRects.length === 0) {
    return selection;
  }

  const viewportRects = selection.pageRects
    .map((rect) => ({
      left: rect.x1 * page.viewportWidth,
      top: rect.y1 * page.viewportHeight,
      width: Math.max(0, (rect.x2 - rect.x1) * page.viewportWidth),
      height: Math.max(0, (rect.y2 - rect.y1) * page.viewportHeight),
      pageNumber: selection.pageNumber,
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0);
  if (viewportRects.length === 0) {
    return selection;
  }

  return {
    ...selection,
    viewportRects,
  };
}

function scoreKernelQuoteGeometry(input: {
  candidateRects: Array<{ left: number; top: number; width: number; height: number }>;
  referenceRects: Array<{ left: number; top: number; width: number; height: number }>;
  page: PdfTextKernelPage;
}): { overlapRatio: number; distance: number; horizontalDistance: number; acceptable: boolean } {
  if (input.referenceRects.length === 0 || input.candidateRects.length === 0) {
    return {
      overlapRatio: 0,
      distance: 0,
      horizontalDistance: 0,
      acceptable: true,
    };
  }

  const referenceArea = input.referenceRects.reduce((sum, rect) => sum + getViewportRectArea(rect), 0);
  const overlapArea = input.candidateRects.reduce((sum, candidateRect) => (
    sum + input.referenceRects.reduce((innerSum, referenceRect) => (
      innerSum + getViewportRectOverlapArea(candidateRect, referenceRect)
    ), 0)
  ), 0);
  const overlapRatio = referenceArea > 0 ? overlapArea / referenceArea : 0;

  const distance = input.candidateRects.reduce((best, candidateRect) => {
    const candidateBest = input.referenceRects.reduce((rectBest, referenceRect) => (
      Math.min(rectBest, getViewportRectCenterDistance(candidateRect, referenceRect))
    ), Number.POSITIVE_INFINITY);
    return Math.min(best, candidateBest);
  }, Number.POSITIVE_INFINITY);

  const candidateCenterX = input.candidateRects.reduce((sum, rect) => sum + getViewportRectCenter(rect).x, 0) / input.candidateRects.length;
  const referenceCenterX = input.referenceRects.reduce((sum, rect) => sum + getViewportRectCenter(rect).x, 0) / input.referenceRects.length;
  const horizontalDistance = Math.abs(candidateCenterX - referenceCenterX);
  const pageWidth = Math.max(1, input.page.viewportWidth);
  const pageHeight = Math.max(1, input.page.viewportHeight);
  const acceptable =
    overlapRatio >= 0.08 ||
    (
      distance <= Math.max(28, pageHeight * 0.045) &&
      horizontalDistance <= Math.max(36, pageWidth * 0.09)
    );

  return {
    overlapRatio,
    distance,
    horizontalDistance,
    acceptable,
  };
}

function resolvePdfKernelOffsetsFromViewportGeometry(input: {
  page: PdfTextKernelPage;
  viewportRects?: PdfResolvedSelection["viewportRects"];
}): { startOffset: number; endOffset: number } | null {
  const referenceRects = getSelectionViewportReferenceRects({
    pageNumber: input.page.pageNumber,
    viewportRects: input.viewportRects,
  });
  if (referenceRects.length === 0) {
    return null;
  }

  const toleranceX = Math.max(2, input.page.viewportWidth * 0.0025);
  const toleranceY = Math.max(2, input.page.viewportHeight * 0.0025);
  const selectedChars = input.page.chars.filter((char) => {
    if (!char.normalizedText || /^\s$/.test(char.normalizedText)) {
      return false;
    }

    const charRect = char.viewportRect;
    return referenceRects.some((referenceRect) => {
      const inflated = {
        left: referenceRect.left - toleranceX,
        top: referenceRect.top - toleranceY,
        width: referenceRect.width + (toleranceX * 2),
        height: referenceRect.height + (toleranceY * 2),
      };
      const center = getViewportRectCenter(charRect);
      return (
        getViewportRectOverlapArea(charRect, inflated) > 0 ||
        (
          center.x >= inflated.left &&
          center.x <= inflated.left + inflated.width &&
          center.y >= inflated.top &&
          center.y <= inflated.top + inflated.height
        )
      );
    });
  });

  if (selectedChars.length === 0) {
    return null;
  }

  const startOffset = Math.min(...selectedChars.map((char) => char.charIndex));
  const endOffset = Math.max(...selectedChars.map((char) => char.charIndex + char.normalizedText.length));
  return endOffset > startOffset ? { startOffset, endOffset } : null;
}

function resolveNearestPdfKernelQuoteOffsets(input: {
  model: PdfPageTextModel;
  page: PdfTextKernelPage;
  quote: string;
  viewportRects?: PdfResolvedSelection["viewportRects"];
  requireGeometryMatch?: boolean;
}): { startOffset: number; endOffset: number } | null {
  const compactQuote = compactPdfKernelText(input.quote);
  if (!compactQuote) {
    return null;
  }

  const normalizedText = normalizePdfKernelComparableText(input.model.normalizedText);
  const compactToNormalized: number[] = [];
  let compactText = "";
  for (let index = 0; index < normalizedText.length; index += 1) {
    const character = normalizedText[index] ?? "";
    if (/\s/.test(character)) {
      continue;
    }
    compactToNormalized[compactText.length] = index;
    compactText += character;
  }

  const referenceRects = getSelectionViewportReferenceRects({
    pageNumber: input.model.pageNumber,
    viewportRects: input.viewportRects,
  });

  const matches: Array<{
    startOffset: number;
    endOffset: number;
    overlapRatio: number;
    distance: number;
    horizontalDistance: number;
    acceptable: boolean;
  }> = [];
  let compactIndex = compactText.indexOf(compactQuote);
  while (compactIndex >= 0) {
    const startOffset = compactToNormalized[compactIndex];
    const endOffset = (compactToNormalized[compactIndex + compactQuote.length - 1] ?? startOffset) + 1;
    if (typeof startOffset === "number" && endOffset > startOffset) {
      const candidateRects = buildKernelViewportRectsForOffsets({
        page: input.page,
        startOffset,
        endOffset,
      });
      const geometry = scoreKernelQuoteGeometry({
        candidateRects,
        referenceRects,
        page: input.page,
      });
      matches.push({
        startOffset,
        endOffset,
        overlapRatio: geometry.overlapRatio,
        distance: geometry.distance,
        horizontalDistance: geometry.horizontalDistance,
        acceptable: geometry.acceptable,
      });
    }
    compactIndex = compactText.indexOf(compactQuote, compactIndex + 1);
  }

  const candidates = input.requireGeometryMatch && referenceRects.length > 0
    ? matches.filter((match) => match.acceptable)
    : matches;

  return candidates
    .sort((left, right) => {
      if (Math.abs(right.overlapRatio - left.overlapRatio) > 0.001) {
        return right.overlapRatio - left.overlapRatio;
      }
      if (Math.abs(left.horizontalDistance - right.horizontalDistance) > 0.001) {
        return left.horizontalDistance - right.horizontalDistance;
      }
      return left.distance - right.distance;
    })[0] ?? null;
}

function ensurePdfTextLayerReadable(input: {
  textLayerElement: HTMLElement;
  textContent: TextContent;
  viewport: { transform: number[] };
  pdfjsModule: typeof import("pdfjs-dist/build/pdf.mjs");
}) {
  const textItems = input.textContent.items.filter(isPdfTextItem);
  const textLength = textItems.reduce((sum, item) => sum + item.str.replace(/\s+/g, "").length, 0);
  const needsOcr = shouldUsePdfOcrFallback({
    textLength,
    textItemCount: textItems.length,
    minTextLength: 24,
    minTextItemCount: 2,
  });
  const pageElement = input.textLayerElement.closest<HTMLElement>("[data-page-number]");
  const textSource = needsOcr ? "low-text" : "pdfjs";
  input.textLayerElement.dataset.pdfTextLayerSource = textSource;
  input.textLayerElement.dataset.pdfTextLayerChars = String(textLength);
  pageElement?.setAttribute("data-pdf-text-layer-source", textSource);
  pageElement?.setAttribute("data-pdf-text-layer-chars", String(textLength));

  if (input.textLayerElement.textContent?.trim()) {
    return;
  }

  if (textItems.length === 0) {
    input.textLayerElement.dataset.pdfTextLayerSource = "empty";
    input.textLayerElement.dataset.pdfTextLayerChars = "0";
    pageElement?.setAttribute("data-pdf-text-layer-source", "empty");
    pageElement?.setAttribute("data-pdf-text-layer-chars", "0");
    return;
  }

  input.textLayerElement.innerHTML = "";
  const fragment = document.createDocumentFragment();

  textItems.forEach((item, itemIndex) => {
    if (!item.str.trim()) {
      return;
    }

    const transform = input.pdfjsModule.Util.transform(
      input.viewport.transform,
      item.transform as number[],
    );
    const fontHeight = Math.max(1, Math.hypot(transform[2], transform[3]) || item.height || 1);
    const span = document.createElement("span");
    span.textContent = item.str;
    span.dataset.pdfTextItemIndex = String(itemIndex);
    span.style.position = "absolute";
    span.style.left = `${transform[4]}px`;
    span.style.top = `${transform[5] - fontHeight}px`;
    span.style.width = `${Math.max(1, Math.abs(item.width))}px`;
    span.style.height = `${fontHeight}px`;
    span.style.fontSize = `${fontHeight}px`;
    span.style.lineHeight = "1";
    span.style.whiteSpace = "pre";
    span.style.color = "transparent";
    span.style.cursor = "text";
    span.style.transformOrigin = "0% 0%";

    fragment.append(span);
  });

  input.textLayerElement.append(fragment);
  input.textLayerElement.dataset.pdfTextLayerSource = "fallback";
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

function buildPdfAnnotationPreviewFromPageElement(
  pageElement: HTMLElement | null,
  rects: PdfTarget["rects"],
  options?: {
    paddingRatio?: number;
    minCssWidth?: number;
    minCssHeight?: number;
    ink?: {
      paths: PdfInkPath[];
      color: string;
      width: number;
    };
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

  if (options?.ink && options.ink.paths.length > 0) {
    const scaleX = canvas.width;
    const scaleY = canvas.height;
    const deviceScale = pageRect.width > 0 ? canvas.width / pageRect.width : 1;
    const lineWidth = Math.max(3 * deviceScale, options.ink.width * deviceScale);

    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = resolveHighlightColor(options.ink.color);
    context.lineWidth = lineWidth;
    context.shadowColor = "rgba(0, 0, 0, 0.18)";
    context.shadowBlur = Math.max(1, lineWidth * 0.25);

    for (const path of options.ink.paths) {
      if (path.length < 2) {
        continue;
      }

      context.beginPath();
      path.forEach((point, index) => {
        const x = (point.x * scaleX) - cropX;
        const y = (point.y * scaleY) - cropY;
        if (index === 0) {
          context.moveTo(x, y);
          return;
        }
        context.lineTo(x, y);
      });
      context.stroke();
    }

    context.restore();
  }

  return buildPdfAreaPreview({
    dataUrl: previewCanvas.toDataURL("image/png"),
    width: cropWidth,
    height: cropHeight,
  }) ?? undefined;
}

function toHighlightFillColor(color: string): string {
  const resolved = resolveHighlightColor(color);
  if (resolved === "transparent") {
    return "transparent";
  }
  const rgb = hexToRGB(resolved);
  return `rgba(${Math.round(rgb.r * 255)}, ${Math.round(rgb.g * 255)}, ${Math.round(rgb.b * 255)}, 0.28)`;
}

function escapeCssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
    let attemptsLeft = 90;

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

      if (!disposed) {
        setContainer((current) => (current === attached.overlay ? current : attached.overlay));
      }
      return true;
    };

    const scheduleRetryAttach = () => {
      if (frameId || attemptsLeft <= 0) {
        return;
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        attemptsLeft -= 1;
        if (!disposed && !tryAttach()) {
          scheduleRetryAttach();
        }
      });
    };

    if (!tryAttach()) {
      scheduleRetryAttach();
    }

    return () => {
      disposed = true;
      if (frameId) {
        window.cancelAnimationFrame(frameId);
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

function rectIntersectionArea(left: DOMRect, right: DOMRect): number {
  const leftRight = left.left + left.width;
  const leftBottom = left.top + left.height;
  const rightRight = right.left + right.width;
  const rightBottom = right.top + right.height;
  const width = Math.max(0, Math.min(leftRight, rightRight) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(leftBottom, rightBottom) - Math.max(left.top, right.top));
  return width * height;
}

function getAnchoredPopupPosition(
  anchorRect: DOMRect,
  popupSize: PopupSize,
  options?: {
    gap?: number;
    horizontalAlign?: PopupHorizontalAlign;
    preferredPlacement?: PopupPreferredPlacement;
    avoidRect?: DOMRect | null;
    avoidRects?: DOMRect[];
  },
): { x: number; y: number } {
  const gap = options?.gap ?? 6;
  const horizontalAlign = options?.horizontalAlign ?? "center";
  const preferredPlacement = options?.preferredPlacement ?? "below";
  const avoidRects = [
    ...(options?.avoidRects ?? []),
    options?.avoidRect ?? null,
  ].filter((rect): rect is DOMRect => Boolean(rect));

  const alignedX = horizontalAlign === "start"
    ? anchorRect.left
    : horizontalAlign === "end"
      ? anchorRect.right - popupSize.width
      : anchorRect.left + (anchorRect.width / 2) - (popupSize.width / 2);

  const candidates: Array<{
    placement: PopupPreferredPlacement;
    position: { x: number; y: number };
    rect: DOMRect;
    overlapsAvoid: boolean;
    avoidOverlapArea: number;
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
    const avoidOverlapArea = avoidRects.reduce((total, avoidRect) => total + rectIntersectionArea(avoidRect, rect), 0);
    const rectBottom = rect.top + rect.height;
    const distance = placement === "below"
      ? Math.abs(rect.top - (anchorRect.bottom + gap))
      : placement === "above"
        ? Math.abs(rectBottom - (anchorRect.top - gap))
        : placement === "right"
          ? Math.abs(rect.left - (anchorRect.left + anchorRect.width + gap))
          : Math.abs(rect.right - (anchorRect.left - gap));
    candidates.push({
      placement,
      position: adjusted,
      rect,
      overlapsAvoid: avoidOverlapArea > 0,
      avoidOverlapArea,
      distance,
      priority: placementOrder.indexOf(placement),
    });
  };

  addCandidate("below", alignedX, anchorRect.bottom + gap);
  addCandidate("above", alignedX, anchorRect.top - popupSize.height - gap);
  addCandidate("right", anchorRect.right + gap, anchorRect.top);
  addCandidate("left", anchorRect.left - popupSize.width - gap, anchorRect.top);

  const clearCandidates = candidates.filter((candidate) => candidate.avoidOverlapArea <= 0);
  if (clearCandidates.length > 0) {
    const preferredClearCandidate = placementOrder
      .map((placement) => clearCandidates.find((candidate) => candidate.placement === placement))
      .find((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
    if (preferredClearCandidate) {
      return preferredClearCandidate.position;
    }

    clearCandidates.sort((left, right) => (
      left.priority - right.priority ||
      left.distance - right.distance
    ));
    return clearCandidates[0]?.position ?? adjustPopupPosition({ x: alignedX, y: anchorRect.bottom + gap }, popupSize, 8);
  }

  candidates.sort((left, right) => (
    left.avoidOverlapArea - right.avoidOverlapArea ||
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
type AnnotationTool = 'select' | 'highlight' | 'underline' | 'note' | 'text' | 'area' | 'ink' | 'eraser';
type PdfAnnotationDefaultTool = Exclude<AnnotationTool, 'select'>;

interface PdfAnnotationDefaultsMenuState {
  tool: PdfAnnotationDefaultTool;
  position: { x: number; y: number };
}

const DEFAULT_UNDERLINE_STYLE: UnderlineStyleType = "solid";

const MIN_INK_POINT_DELTA_SQUARED = 0.000004;
const MIN_SCROLL_OVERFLOW_PX = 24;
const DOM_SELECTION_SETTLE_WINDOW_MS = 140;
const PDF_DOCUMENT_LOAD_TIMEOUT_MS = 30000;
const USE_REACT_PDF_DOCUMENT_OWNER = false;
const PAGE_BUFFER = 2;
const ESTIMATED_PAGE_HEIGHT = 842;
const ESTIMATED_PAGE_WIDTH = 595;
const UNDERLINE_STYLE_OPTIONS: Array<{ value: UnderlineStyleType; labelKey: TranslationKey }> = [
  { value: "solid", labelKey: "pdf.underline.style.solid" },
  { value: "wavy", labelKey: "pdf.underline.style.wavy" },
  { value: "double", labelKey: "pdf.underline.style.double" },
  { value: "dashed", labelKey: "pdf.underline.style.dashed" },
];

const reactPdfWorkerUrl = pdfJsWorkerUrl;

function buildPdfUnderlineDecorationStyle(input: {
  color: string;
  underlineStyle: UnderlineStyleType;
  isActive: boolean;
  segment: PdfMergedTextOverlaySegment;
}): CSSProperties {
  const baseColor = input.color;
  const opacity = 1;
  const baselineHeight = Math.max(2, Math.min(3.5, input.segment.baselineHeight * 0.16));
  const baselineTop = Math.max(0, input.segment.baselineTop - input.segment.top + input.segment.baselineHeight - baselineHeight);
  const cssBaselineHeight = `${baselineHeight}px`;
  const cssBaselineTop = `${baselineTop}px`;

  if (input.underlineStyle === "wavy") {
    const waveHeight = Math.max(4, Math.min(8, input.segment.baselineHeight * 0.28));
    const strokeWidth = Math.max(1.5, Math.min(2.5, input.segment.baselineHeight * 0.08));
    const waveY = waveHeight / 2;
    const wavePath = `M0 ${waveY} Q 4 0 8 ${waveY} T 16 ${waveY}`;
    const encoded = encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="${waveHeight}" viewBox="0 0 16 ${waveHeight}"><path d="${wavePath}" fill="none" stroke="${baseColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    );

    return {
      backgroundColor: "transparent",
      backgroundImage: `url("data:image/svg+xml,${encoded}")`,
      backgroundRepeat: "repeat-x",
      backgroundPosition: `left ${baselineTop}px`,
      backgroundSize: `16px ${waveHeight}px`,
      opacity,
    };
  }

  if (input.underlineStyle === "double") {
    const lineGap = Math.max(1.8, baselineHeight * 1.8);
    const lowerTop = Math.min(Math.max(0, input.segment.height - baselineHeight), baselineTop + lineGap);
    const upperTop = Math.max(0, Math.min(baselineTop, lowerTop - lineGap));
    return {
      backgroundColor: "transparent",
      backgroundImage: `linear-gradient(${baseColor}, ${baseColor}), linear-gradient(${baseColor}, ${baseColor})`,
      backgroundPosition: `left ${upperTop}px, left ${lowerTop}px`,
      backgroundRepeat: "repeat-x",
      backgroundSize: `100% ${cssBaselineHeight}, 100% ${cssBaselineHeight}`,
      opacity,
    };
  }

  if (input.underlineStyle === "dashed") {
    const dashWidth = Math.max(5, input.segment.baselineHeight * 0.5);
    const dashGap = Math.max(3, input.segment.baselineHeight * 0.24);
    return {
      backgroundColor: "transparent",
      backgroundImage: `repeating-linear-gradient(to right, ${baseColor} 0 ${dashWidth}px, transparent ${dashWidth}px ${dashWidth + dashGap}px)`,
      backgroundPosition: `left ${cssBaselineTop}`,
      backgroundRepeat: "repeat-x",
      backgroundSize: `auto ${cssBaselineHeight}`,
      opacity,
    };
  }

  return {
    backgroundColor: "transparent",
    backgroundImage: `linear-gradient(${baseColor}, ${baseColor})`,
    backgroundPosition: `left ${cssBaselineTop}`,
    backgroundRepeat: "repeat-x",
    backgroundSize: `100% ${cssBaselineHeight}`,
    opacity,
  };
}

interface AdapterVirtualPageProps {
  pdfDocument: PDFDocumentProxy;
  pageNumber: number;
  paneId: PaneId;
  scale: number;
  devicePixelRatio?: number;
  isVisible: boolean;
  renderCanvasLayer: boolean;
  renderAnnotationLayer: boolean;
  transientSelection: PdfSelectionSnapshot | null;
  transientSelectionColor: string;
  transientSelectionStyleType: "highlight" | "underline";
  transientSelectionUnderlineStyle: UnderlineStyleType;
  measuredHeight: number | null;
  measuredWidth: number | null;
  onMeasure: (pageNumber: number, width: number, height: number) => void;
  onTextLayerReady: (pageNumber: number) => void;
  observer: IntersectionObserver | null;
}

const AdapterVirtualPage = memo(function AdapterVirtualPage({
  pdfDocument,
  pageNumber,
  paneId,
  scale,
  devicePixelRatio,
  isVisible,
  renderCanvasLayer,
  renderAnnotationLayer,
  transientSelection,
  transientSelectionColor,
  transientSelectionStyleType,
  transientSelectionUnderlineStyle,
  measuredHeight,
  measuredWidth,
  onMeasure,
  onTextLayerReady,
  observer,
}: AdapterVirtualPageProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;

    const renderPage = async () => {
      const canvas = canvasRef.current;
      const textLayerElement = textLayerRef.current;
      if (!canvas || !textLayerElement) {
        return;
      }

      const pdfjsModule = await import("pdfjs-dist/build/pdf.mjs");
      if (cancelled) {
        return;
      }

      const page = await pdfDocument.getPage(pageNumber);
      if (cancelled) {
        return;
      }

      const baseViewport = page.getViewport({ scale: 1 });
      onMeasure(pageNumber, baseViewport.width, baseViewport.height);
      const viewport = page.getViewport({ scale });
      const outputScale = Math.max(1, devicePixelRatio ?? window.devicePixelRatio ?? 1);
      const canvasWidth = Math.floor(viewport.width * outputScale);
      const canvasHeight = Math.floor(viewport.height * outputScale);

      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      if (renderCanvasLayer) {
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
      } else {
        canvas.width = 1;
        canvas.height = 1;
      }
      textLayerElement.style.width = `${viewport.width}px`;
      textLayerElement.style.height = `${viewport.height}px`;
      textLayerElement.style.setProperty("--scale-factor", String(scale));
      textLayerElement.dataset.pdfTextLayerReady = "false";
      textLayerElement.innerHTML = "";

      const textContent = await withTimeout(
        page.getTextContent(),
        5000,
        `PDF text content page ${pageNumber}`,
      );
      if (cancelled) {
        return;
      }

      ensurePdfTextLayerReadable({
        textLayerElement,
        textContent,
        viewport,
        pdfjsModule,
      });
      textLayerElement.dataset.pdfTextLayerReady = "true";
      onTextLayerReady(pageNumber);

      if (!renderCanvasLayer) {
        return;
      }

      const canvasContext = canvas.getContext("2d");
      if (!canvasContext) {
        return;
      }

      renderTask = page.render({
        canvas,
        canvasContext,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      });
      void renderTask.promise.catch((error: unknown) => {
        const name = error instanceof Error ? error.name : "";
        if (!cancelled && name !== "RenderingCancelledException") {
          logger.warn("[PDF] Canvas page render failed:", error);
        }
      });
    };

    void renderPage().catch((error) => {
      const name = error instanceof Error ? error.name : "";
      if (!cancelled && name !== "RenderingCancelledException") {
        logger.warn("[PDF] Page render failed:", error);
      }
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [devicePixelRatio, handlePageLoad, isVisible, onMeasure, onTextLayerReady, pageNumber, pdfDocument, renderCanvasLayer, scale]);

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
        <div
          className="react-pdf__Page relative bg-white shadow-lg"
          style={{ width: placeholderWidth, height: placeholderHeight }}
        >
          <canvas ref={canvasRef} className="block" />
          <div ref={textLayerRef} className="textLayer absolute left-0 top-0" />
          {renderAnnotationLayer ? <div className="annotationLayer absolute left-0 top-0" /> : null}
        </div>
      ) : (
        <div
          className="flex items-center justify-center bg-white/60 shadow-lg"
          style={{ width: placeholderWidth, height: placeholderHeight }}
        />
      )}
      {transientSelection ? (
        <PdfTransientSelectionOverlay
          selection={transientSelection}
          paneId={paneId}
          page={pageNumber}
          color={transientSelectionColor}
          styleType={transientSelectionStyleType}
          underlineStyle={transientSelectionUnderlineStyle}
        />
      ) : null}
    </div>
  );
});

function resolvedTextSelectionToAnnotationData(input: {
  selection: PdfResolvedSelection;
  color: string;
  author: string;
  styleType: 'highlight' | 'underline';
  underlineStyle?: UnderlineStyleType;
  model?: PdfPageTextModel | null;
}): Omit<AnnotationItem, 'id' | 'createdAt'> {
  const selection = normalizePdfTextMarkupSelectionForPersistence(input.selection, input.model);
  return {
    target: {
      type: 'pdf',
      page: selection.pageNumber,
      rects: selection.pageRects,
      textQuote: selection.textQuote,
      textKernelVersion: selection.textKernelVersion,
      startCharIndex: selection.startOffset,
      endCharIndex: selection.endOffset,
      quads: selection.quads,
      textSource: selection.textSource ?? selection.textQuote.source,
      textConfidence: selection.textConfidence,
    },
    style: {
      color: resolveHighlightColor(input.color),
      type: input.styleType,
      underlineStyle: input.styleType === "underline" ? (input.underlineStyle ?? "solid") : undefined,
    },
    content: selection.textQuote.exact,
    author: input.author,
  };
}

function normalizePdfTextMarkupSelectionForPersistence(
  selection: PdfResolvedSelection,
  model?: PdfPageTextModel | null,
): PdfResolvedSelection {
  const fallbackPageRects = selection.pageRects
    .filter(isPlausibleTextMarkupBox)
    .filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1);
  const safeFallbackPageRects = getSafePdfTextMarkupFallbackRects(
    fallbackPageRects,
    selection.textQuote.exact || selection.text,
  );
  const hasCoarseSelectionGeometry = isLikelyCoarseTextMarkupGeometry(
    selection.pageRects,
    selection.textQuote.exact || selection.text,
  );
  if (
    !model ||
    model.pageNumber !== selection.pageNumber ||
    selection.endOffset <= selection.startOffset
  ) {
    return {
      ...selection,
      pageRects: safeFallbackPageRects,
    };
  }

  const anchor = buildPdfTextAnchorFromOffsets({
    model,
    startOffset: selection.startOffset,
    endOffset: selection.endOffset,
    source: "pdfjs-text-model",
    fallbackRects: safeFallbackPageRects.length > 0 ? safeFallbackPageRects : undefined,
  });
  if (!anchor || anchor.rects.length === 0) {
    return {
      ...selection,
      pageRects: safeFallbackPageRects,
    };
  }

  const selectionCompact = compactPdfKernelText(
    normalizePdfReadableReferenceText(selection.textQuote.exact || selection.text),
  );
  const anchorCompact = compactPdfKernelText(
    normalizePdfReadableReferenceText(anchor.textQuote.exact),
  );
  const substantialExtraTextLimit = Math.max(8, Math.ceil(selectionCompact.length * 0.12));
  const anchorAddsSubstantialText = Boolean(
    selectionCompact &&
    anchorCompact.includes(selectionCompact) &&
    anchorCompact.length > selectionCompact.length + substantialExtraTextLimit,
  );
  const hasCompatibleAnchorText = Boolean(
    selectionCompact &&
    anchorCompact &&
    (
      hasCoarseSelectionGeometry ||
      selectionCompact === anchorCompact ||
      (anchorCompact.includes(selectionCompact) && !anchorAddsSubstantialText) ||
      selectionCompact.includes(anchorCompact) ||
      (
        hasCoarseSelectionGeometry &&
        selectionCompact.length >= 8 &&
        anchorCompact.includes(selectionCompact.slice(0, Math.min(selectionCompact.length, 24))) &&
        !anchorAddsSubstantialText
      )
    ),
  );
  if (!hasCompatibleAnchorText) {
    return {
      ...selection,
      pageRects: safeFallbackPageRects,
    };
  }

  const pageRects = anchor.rects.filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1);
  if (pageRects.length === 0) {
    return {
      ...selection,
      pageRects: safeFallbackPageRects,
    };
  }

  const viewportRects = pageRects.map((rect) => ({
    pageNumber: selection.pageNumber,
    left: rect.x1 * model.viewportWidth,
    top: rect.y1 * model.viewportHeight,
    width: Math.max(0, (rect.x2 - rect.x1) * model.viewportWidth),
    height: Math.max(0, (rect.y2 - rect.y1) * model.viewportHeight),
  })).filter((rect) => rect.width > 0 && rect.height > 0);

  return {
    ...selection,
    startOffset: anchor.startOffset,
    endOffset: anchor.endOffset,
    text: anchor.textQuote.exact,
    textQuote: anchor.textQuote,
    pageRects,
    viewportRects,
    quads: pageRects.map(pdfPageRectToQuad),
    textKernelVersion: selection.textKernelVersion ?? 1,
    textSource: "pdfjs-text-model",
    textConfidence: Math.max(selection.textConfidence ?? 1, 1),
  };
}

function selectionAlreadyHasPreciseTextMarkupGeometry(selection: PdfResolvedSelection): boolean {
  const pageRects = selection.pageRects
    .filter(isPlausibleTextMarkupBox)
    .filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1);
  if (pageRects.length === 0 || pageRects.length !== selection.pageRects.length) {
    return false;
  }
  if (
    hasBlockLikeTextMarkupGeometry(pageRects) ||
    (
      isLikelyCoarseTextMarkupGeometry(pageRects, selection.textQuote.exact || selection.text) &&
      !hasOnlyThinTextLineGeometry(pageRects)
    )
  ) {
    return false;
  }

  return pageRects.every((rect) => (rect.y2 - rect.y1) < 0.045);
}

function selectionAlreadyHasMultiLineTextMarkupGeometry(selection: PdfResolvedSelection): boolean {
  const pageRects = selection.pageRects
    .filter(isPlausibleTextMarkupBox)
    .filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1);
  if (pageRects.length < 2) {
    return false;
  }

  return pageRects.every((rect) => (rect.y2 - rect.y1) < 0.045);
}

function normalizePdfSelectionViewportRectsFromPageRects(
  selection: PdfResolvedSelection,
  pageWidth: number,
  pageHeight: number,
): PdfResolvedSelection {
  const pageRects = normalizePdfTextMarkupRenderRects(selection.pageRects);
  const viewportRects = pageRects.map((rect) => ({
    pageNumber: selection.pageNumber,
    left: rect.x1 * pageWidth,
    top: rect.y1 * pageHeight,
    width: Math.max(0, (rect.x2 - rect.x1) * pageWidth),
    height: Math.max(0, (rect.y2 - rect.y1) * pageHeight),
  })).filter((rect) => rect.width > 0 && rect.height > 0);

  return {
    ...selection,
    pageRects,
    viewportRects,
    quads: pageRects.map(pdfPageRectToQuad),
  };
}

function normalizePdfResolvedSelectionViewportGeometry(
  selection: PdfResolvedSelection,
  pageElement: HTMLElement | null | undefined,
): PdfResolvedSelection {
  const initialPageRect = pageElement?.getBoundingClientRect();
  if (
    initialPageRect &&
    initialPageRect.width > 0 &&
    initialPageRect.height > 0 &&
    selectionAlreadyHasPreciseTextMarkupGeometry(selection)
  ) {
    return normalizePdfSelectionViewportRectsFromPageRects(selection, initialPageRect.width, initialPageRect.height);
  }

  const textModel = pageElement ? buildRenderedPdfPageTextModel(pageElement) : null;
  const textModelSelection = normalizePdfTextMarkupSelectionForPersistence(selection, textModel);
  if (!pageElement || selection.pageRects.length === 0) {
    return textModelSelection;
  }

  const pageRect = pageElement.getBoundingClientRect();
  if (pageRect.width <= 0 || pageRect.height <= 0) {
    return textModelSelection;
  }

  const pageRects = textModelSelection.pageRects
    .filter(isPlausibleTextMarkupBox)
    .filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1);
  if (pageRects.length === 0) {
    return textModelSelection;
  }

  const viewportRects = pageRects.map((rect) => ({
    pageNumber: selection.pageNumber,
    left: rect.x1 * pageRect.width,
    top: rect.y1 * pageRect.height,
    width: Math.max(0, (rect.x2 - rect.x1) * pageRect.width),
    height: Math.max(0, (rect.y2 - rect.y1) * pageRect.height),
  })).filter((rect) => rect.width > 0 && rect.height > 0);
  if (viewportRects.length === 0) {
    return selection;
  }

  return {
    ...textModelSelection,
    pageRects,
    viewportRects,
    quads: pageRects.map(pdfPageRectToQuad),
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

function normalizePdfPopupPreviewText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function getPdfResolvedSelectionExactText(selection: Pick<PdfResolvedSelection, "text" | "textQuote"> | null | undefined): string {
  return normalizePdfPopupPreviewText(selection?.textQuote?.exact || selection?.text);
}

interface PdfSelectionDraftMenuProps {
  selection: PdfResolvedSelection;
  position: { x: number; y: number };
  anchorRect?: DOMRect | null;
  avoidRect?: DOMRect | null;
  onColorSelect: (color: string) => void;
  onCancel: () => void;
}

function PdfSelectionDraftMenu({ selection, position, anchorRect, avoidRect, onColorSelect, onCancel }: PdfSelectionDraftMenuProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const exactText = getPdfResolvedSelectionExactText(selection);
  const popupSize = useMeasuredPopupSize(
    popupRef,
    { width: 184, height: 360 },
    `${exactText}:${anchorRect?.left ?? 0}:${anchorRect?.top ?? 0}:${anchorRect?.width ?? 0}:${anchorRect?.height ?? 0}:${avoidRect?.left ?? 0}:${avoidRect?.top ?? 0}:${avoidRect?.width ?? 0}:${avoidRect?.height ?? 0}`,
  );
  const adjustedPosition = anchorRect
    ? getAnchoredPopupPosition(anchorRect, popupSize, {
        gap: 4,
        horizontalAlign: "start",
        preferredPlacement: "below",
        avoidRect,
      })
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
        selectedText={exactText}
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
  const fullPreviewText = normalizePdfPopupPreviewText(selectedText);
  return (
    <div className="pdf-selection-color-picker bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[160px] text-sm">
      {/* Selected text preview */}
      {fullPreviewText && (
        <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border max-w-[280px]" title={fullPreviewText}>
          <div className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words">
            &ldquo;{fullPreviewText}&rdquo;
          </div>
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
      {HIGHLIGHT_COLORS.map((color) => {
        const resolvedColor = resolveHighlightColor(color.hex);
        const selected = resolveHighlightColor(currentColor) === resolvedColor;
        return (
          <button
            key={color.value}
            onClick={() => onColorSelect(resolvedColor)}
            className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2"
          >
            <div className="relative">
              <div
                className="w-4 h-4 rounded-sm border border-black/10"
                style={{ backgroundColor: resolvedColor }}
              />
              {selected && (
                <Check className="absolute -top-0.5 -right-0.5 h-3 w-3 text-foreground" />
              )}
            </div>
            <span>{color.nameCN}</span>
          </button>
        );
      })}
      
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
  activeInkWidth: number;
  activeEraserMode: PdfInkEraserMode;
  activeEraserSize: number;
  activeUnderlineStyle: UnderlineStyleType;
  onSelectColor: (color: string) => void;
  onSelectInkWidth: (width: number) => void;
  onSelectEraserMode: (mode: PdfInkEraserMode) => void;
  onSelectEraserSize: (size: number) => void;
  onSelectUnderlineStyle: (style: UnderlineStyleType) => void;
  onClose: () => void;
}

function PdfAnnotationDefaultsMenu({
  state,
  activeColor,
  activeInkWidth,
  activeEraserMode,
  activeEraserSize,
  activeUnderlineStyle,
  onSelectColor,
  onSelectInkWidth,
  onSelectEraserMode,
  onSelectEraserSize,
  onSelectUnderlineStyle,
  onClose,
}: PdfAnnotationDefaultsMenuProps) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const adjustedPosition = adjustPopupPosition(
    state.position,
    { width: 248, height: state.tool === "eraser" ? 220 : state.tool === "ink" ? 432 : 360 },
    12,
  );

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
        {state.tool !== "eraser" ? (
          <>
            <div className="px-1 py-1 text-xs text-muted-foreground">{t("pdf.color.default")}</div>
            {HIGHLIGHT_COLORS.map((color) => {
              const resolvedColor = resolveHighlightColor(color.hex);
              const selected = resolveHighlightColor(activeColor) === resolvedColor;
              return (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => {
                    onSelectColor(resolvedColor);
                    onClose();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                  role="menuitemradio"
                  aria-checked={selected}
                >
                  <span
                    className="h-4 w-4 rounded-sm border border-black/10"
                    style={{ backgroundColor: resolvedColor }}
                  />
                  <span className="flex-1">{color.name}</span>
                  {selected ? <Check className="h-3.5 w-3.5" /> : null}
                </button>
              );
            })}
          </>
        ) : null}
        {state.tool === "ink" ? (
          <div className="mt-2 border-t border-border px-1 pt-2">
            <div className="px-1 pb-2 text-xs text-muted-foreground">{t("pdf.draw.width")}</div>
            <InkWidthPicker
              currentWidth={activeInkWidth}
              onWidthChange={onSelectInkWidth}
            />
            <div className="px-1 pt-2 text-[11px] text-muted-foreground">
              {t("pdf.draw.widthHint")}
            </div>
          </div>
        ) : null}
        {state.tool === "eraser" ? (
          <div className="px-1 pt-1">
            <div className="px-1 pb-2 text-xs text-muted-foreground">{t("pdf.eraser.mode")}</div>
            {([
              { value: "stroke", label: t("pdf.eraser.mode.stroke") },
              { value: "partial", label: t("pdf.eraser.mode.partial") },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onSelectEraserMode(option.value)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                role="menuitemradio"
                aria-checked={activeEraserMode === option.value}
              >
                <span className="flex-1">{option.label}</span>
                {activeEraserMode === option.value ? <Check className="h-3.5 w-3.5" /> : null}
              </button>
            ))}
            <div className="mt-3 px-1 pb-2 text-xs text-muted-foreground">{t("pdf.eraser.size")}</div>
            <div className="flex items-center gap-3 px-1 pb-1">
              <input
                type="range"
                min={8}
                max={64}
                step={2}
                value={activeEraserSize}
                onChange={(event) => onSelectEraserSize(Number(event.currentTarget.value))}
                className="w-full accent-primary"
                aria-label={t("pdf.eraser.size")}
              />
              <span className="min-w-8 text-right text-xs text-muted-foreground">{Math.round(activeEraserSize)}px</span>
            </div>
          </div>
        ) : null}
        {state.tool === "underline" ? (
          <div className="mt-2 border-t border-border px-1 pt-2">
            <div className="px-1 pb-2 text-xs text-muted-foreground">{t("pdf.underline.style")}</div>
            {UNDERLINE_STYLE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onSelectUnderlineStyle(option.value);
                  onClose();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                role="menuitemradio"
                aria-checked={activeUnderlineStyle === option.value}
              >
                <span className="flex-1">{t(option.labelKey)}</span>
                {activeUnderlineStyle === option.value ? <Check className="h-3.5 w-3.5" /> : null}
              </button>
            ))}
          </div>
        ) : null}
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
  onChangeUnderlineStyle?: (style: UnderlineStyleType) => void;
  currentColor?: string;
  currentUnderlineStyle?: UnderlineStyleType;
  styleType?: 'highlight' | 'underline' | 'area' | 'ink' | 'text';
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
  onChangeUnderlineStyle,
  currentColor,
  currentUnderlineStyle = DEFAULT_UNDERLINE_STYLE,
  styleType = 'highlight',
  highlightText,
}: HighlightPopupProps) {
  const { t } = useI18n();
  const resolvedCommentText = comment?.text ?? "";
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState(resolvedCommentText);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const fullPreviewText = normalizePdfPopupPreviewText(highlightText);
  const runMenuAction = useCallback((event: React.MouseEvent<HTMLElement>, action: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  }, []);

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
          <Button size="sm" variant="ghost" onClick={(event) => runMenuAction(event, () => setShowCommentInput(false))}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={(event) => runMenuAction(event, handleSaveComment)}>
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
          onClick={(event) => runMenuAction(event, () => {
            onChangeColor('transparent');
            setShowColorPicker(false);
          })}
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
        {HIGHLIGHT_COLORS.map((color) => {
          const resolvedColor = resolveHighlightColor(color.hex);
          const selected = resolveHighlightColor(currentColor) === resolvedColor;
          return (
            <button
              key={color.value}
              onClick={(event) => runMenuAction(event, () => {
                onChangeColor(resolvedColor);
                setShowColorPicker(false);
              })}
              className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2 text-sm"
            >
              <div className="relative">
                <div
                  className="w-4 h-4 rounded-sm border border-black/10"
                  style={{ backgroundColor: resolvedColor }}
                />
                {selected && (
                  <Check className="absolute -top-0.5 -right-0.5 h-3 w-3 text-foreground" />
                )}
              </div>
              <span>{color.nameCN}</span>
            </button>
          );
        })}
        <div className="border-t border-border my-1" />
        <button
          onClick={(event) => runMenuAction(event, () => setShowColorPicker(false))}
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
      {fullPreviewText && (
        <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border">
          <div
            className="max-h-32 max-w-[280px] overflow-y-auto whitespace-pre-wrap break-words"
            title={fullPreviewText}
            style={{
              backgroundColor: currentColor && currentColor !== 'transparent' ? `${currentColor}40` : 'transparent',
              border: currentColor === 'transparent' ? '1px dashed var(--border)' : 'none',
              padding: '2px 4px',
              borderRadius: '2px',
            }}
          >
            &ldquo;{fullPreviewText}&rdquo;
          </div>
        </div>
      )}
      
      {/* Add/Edit comment */}
      <button
        onClick={(event) => runMenuAction(event, () => setShowCommentInput(true))}
        className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2"
      >
        <MessageSquare className="h-4 w-4" />
        <span>{resolvedCommentText ? t("pdf.comment.edit") : t("pdf.comment.add")}</span>
      </button>
      
      {/* Change color */}
      {onChangeColor && (
        <button
          onClick={(event) => runMenuAction(event, () => setShowColorPicker(true))}
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
          onClick={(event) => runMenuAction(event, onConvertToUnderline)}
          className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2"
        >
          <Underline className="h-4 w-4" />
          <span>{t("pdf.convert.underline")}</span>
        </button>
      )}
      
      {/* Convert to highlight (only for underlines) */}
      {styleType === 'underline' && onConvertToUnderline && (
        <>
          <button
            onClick={(event) => runMenuAction(event, onConvertToUnderline)}
            className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2"
          >
            <Highlighter className="h-4 w-4" />
            <span>{t("pdf.convert.highlight")}</span>
          </button>
          {onChangeUnderlineStyle ? (
            <>
              <div className="px-3 pt-1 text-[11px] text-muted-foreground">{t("pdf.underline.style")}</div>
              {UNDERLINE_STYLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={(event) => runMenuAction(event, () => onChangeUnderlineStyle(option.value))}
                  className="w-full px-3 py-1.5 text-left hover:bg-muted flex items-center gap-2"
                >
                  <span className="flex-1">{t(option.labelKey)}</span>
                  {currentUnderlineStyle === option.value ? <Check className="h-3.5 w-3.5" /> : null}
                </button>
              ))}
            </>
          ) : null}
        </>
      )}
      
      <div className="border-t border-border my-1" />
      
      {/* Delete */}
      <button
        onClick={(event) => runMenuAction(event, onDelete)}
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
  const popupRef = useRef<HTMLDivElement>(null);
  
  // Use coordinate adapter to adjust popup position
  const popupSize: PopupSize = { width: 280, height: 180 };
  const adjustedPosition = adjustPopupPosition(position, popupSize, 10);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && popupRef.current?.contains(target)) {
        return;
      }
      onCancel();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onCancel]);

  return (
    <div
      ref={popupRef}
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
  const popupRef = useRef<HTMLDivElement>(null);
  
  // Use coordinate adapter to adjust popup position
  const popupSize: PopupSize = { width: 320, height: 280 };
  const adjustedPosition = adjustPopupPosition(position, popupSize, 10);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && popupRef.current?.contains(target)) {
        return;
      }
      onCancel();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onCancel]);

  return (
    <div
      ref={popupRef}
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
  onClick?: () => void;
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
      data-pdf-text-annotation-content="true"
      data-pdf-text-annotation-id={annotation.id}
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

function InkAnnotationOverlay({ annotation, scale, onClick }: InkAnnotationOverlayProps) {
  if (annotation.style.type !== 'ink' || annotation.target.type !== 'pdf') {
    return null;
  }

  const parsed = parsePdfInkContent(annotation.content);
  if (!parsed) {
    return null;
  }

  // Filter out paths with less than 2 points
  const validPaths = parsed.paths.filter(path => path.length >= 2);
  if (validPaths.length === 0) return null;
  const inkHitBox = getPdfInkBoundingBox(validPaths, Math.max(parsed.width / 1000, 0.006));
  const handleInkClick = (event: React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onClick?.();
  };
  const handleInkHtmlClick = (event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onClick?.();
  };

  return (
    <>
      {inkHitBox ? (
        <div
          data-pdf-ink-annotation-bounds-hit-area="true"
          data-pdf-ink-annotation-id={annotation.id}
          className="absolute"
          style={{
            left: `${inkHitBox.x1 * 100}%`,
            top: `${inkHitBox.y1 * 100}%`,
            width: `${(inkHitBox.x2 - inkHitBox.x1) * 100}%`,
            height: `${(inkHitBox.y2 - inkHitBox.y1) * 100}%`,
            pointerEvents: 'auto',
            cursor: 'pointer',
            zIndex: 1,
          }}
          onPointerDown={handleInkHtmlClick}
          onMouseDown={handleInkHtmlClick}
          onClick={handleInkHtmlClick}
        />
      ) : null}
      <svg
        className="absolute inset-0"
        data-pdf-ink-annotation-content="true"
        data-pdf-ink-annotation-id={annotation.id}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        {validPaths.map((path, pathIndex) => {
          // Create SVG path data from normalized coordinates
          const pathData = path.map((point, i) => {
            const cmd = i === 0 ? 'M' : 'L';
            // Convert normalized (0-1) to percentage for SVG viewBox
            return `${cmd} ${point.x * 100} ${point.y * 100}`;
          }).join(' ');
          const hitStrokeWidth = Math.max(parsed.width / scale, 14 / scale);

          return (
            <React.Fragment key={pathIndex}>
              <path
                data-pdf-ink-annotation-hit-area="true"
                data-pdf-ink-annotation-id={annotation.id}
                d={pathData}
                fill="none"
                stroke="transparent"
                strokeWidth={hitStrokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'none' }}
              />
              <path
                data-pdf-ink-annotation-segment="true"
                data-pdf-ink-annotation-id={annotation.id}
                d={pathData}
                fill="none"
                stroke={annotation.style.color}
                strokeWidth={parsed.width / scale}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'none' }}
              />
            </React.Fragment>
          );
        })}
      </svg>
    </>
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
  onClick?: () => void;
}

function InkAnnotationPortal({ annotation, page, scale, paneRootRef, onClick }: InkAnnotationPortalProps) {
  const container = usePdfPageOverlayContainer({
    paneRootRef,
    page,
    overlayClassName: `ink-overlay-${annotation.id}`,
    overlayStyle: 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;',
    dependencyKey: `${annotation.id}:${page}`,
  });

  if (!container) return null;

  return ReactDOM.createPortal(
    <InkAnnotationOverlay annotation={annotation} scale={scale} onClick={onClick} />,
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
  strokeWidth: number;
}

function CurrentInkPathOverlay({ path, color, scale, strokeWidth }: CurrentInkPathOverlayProps) {
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
        strokeWidth={strokeWidth / scale}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

interface PendingInkStrokesOverlayProps {
  strokes: InkStroke[];
  scale: number;
}

function PendingInkStrokesOverlay({ strokes, scale }: PendingInkStrokesOverlayProps) {
  const visibleStrokes = strokes.filter((stroke) => stroke.points.length >= 2);
  if (visibleStrokes.length === 0) {
    return null;
  }

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-19"
      data-testid="pdf-pending-ink-strokes"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%' }}
    >
      {visibleStrokes.map((stroke, index) => {
        const pathData = stroke.points.map((point, pointIndex) => {
          const cmd = pointIndex === 0 ? 'M' : 'L';
          return `${cmd} ${point.x * 100} ${point.y * 100}`;
        }).join(' ');

        return (
          <path
            key={`${stroke.page}-${index}-${stroke.points.length}`}
            d={pathData}
            fill="none"
            stroke={stroke.color}
            strokeWidth={(stroke.width ?? DEFAULT_PDF_INK_WIDTH) / scale}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}

interface PendingInkStrokesPortalProps {
  strokes: InkStroke[];
  page: number;
  scale: number;
  paneRootRef: React.RefObject<HTMLElement | null>;
}

function PendingInkStrokesPortal({ strokes, page, scale, paneRootRef }: PendingInkStrokesPortalProps) {
  const pageStrokes = strokes.filter((stroke) => stroke.page === page);
  const container = usePdfPageOverlayContainer({
    paneRootRef,
    page,
    overlayClassName: `pending-ink-overlay-${page}`,
    overlayStyle: 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:19;',
    dependencyKey: `${page}:${pageStrokes.length}:${pageStrokes.map((stroke) => stroke.points.length).join(":")}`,
  });

  if (!container || pageStrokes.length === 0) return null;

  return ReactDOM.createPortal(
    <PendingInkStrokesOverlay strokes={pageStrokes} scale={scale} />,
    container,
  );
}

interface InkEraserCursorOverlayProps {
  point: {
    x: number;
    y: number;
    radius: number;
  };
}

function InkEraserCursorOverlay({ point }: InkEraserCursorOverlayProps) {
  const radius = Math.max(0.5, point.radius * 100);

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-30"
      data-testid="pdf-ink-eraser-cursor"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%' }}
    >
      <circle
        cx={point.x * 100}
        cy={point.y * 100}
        r={radius}
        fill="rgba(255, 255, 255, 0.25)"
        stroke="rgba(15, 23, 42, 0.75)"
        strokeWidth={1.5}
        strokeDasharray="3 2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

interface InkEraserCursorPortalProps {
  point: {
    page: number;
    x: number;
    y: number;
    radius: number;
  } | null;
  paneRootRef: React.RefObject<HTMLElement | null>;
}

function InkEraserCursorPortal({ point, paneRootRef }: InkEraserCursorPortalProps) {
  const container = usePdfPageOverlayContainer({
    paneRootRef,
    page: point?.page ?? 0,
    overlayClassName: `ink-eraser-cursor-overlay-${point?.page ?? 0}`,
    overlayStyle: 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:30;',
    dependencyKey: point ? `${point.page}:${point.x}:${point.y}:${point.radius}` : "none",
  });

  if (!container || !point) {
    return null;
  }

  return ReactDOM.createPortal(
    <InkEraserCursorOverlay point={point} />,
    container,
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
  strokeWidth: number;
  paneRootRef: React.RefObject<HTMLElement | null>;
}

function CurrentInkPathPortal({ path, page, color, scale, strokeWidth, paneRootRef }: CurrentInkPathPortalProps) {
  const container = usePdfPageOverlayContainer({
    paneRootRef,
    page,
    overlayClassName: 'current-ink-overlay',
    overlayStyle: 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:20;',
    dependencyKey: `${page}:${path.length}:${color}`,
  });

  if (!container) return null;

  return ReactDOM.createPortal(
    <CurrentInkPathOverlay path={path} color={color} scale={scale} strokeWidth={strokeWidth} />,
    container
  );
}

interface PdfTransientSelectionOverlayProps {
  selection: PdfSelectionSnapshot;
  paneId: PaneId;
  page: number;
  color: string;
  styleType: 'highlight' | 'underline';
  underlineStyle: UnderlineStyleType;
}

function PdfTransientSelectionOverlay({ selection, paneId, page, color, styleType, underlineStyle }: PdfTransientSelectionOverlayProps) {
  const rects = selection.viewportRects.filter((rect) => rect.pageNumber === page);
  if (rects.length === 0) {
    return null;
  }

  const mergedRects = mergePdfTextOverlayRects(rects, {
    horizontalGap: 1.5,
    maxHorizontalGap: 4,
    inlineGapMultiplier: 0.18,
    allowWideSameColumnGaps: false,
    strictRows: true,
    targetSegmentHeightRatio: 0.46,
    minSegmentHeightRatio: 0.34,
    maxSegmentHeightRatio: 0.52,
  });

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      data-pdf-transient-selection-overlay="true"
      data-testid={`pdf-transient-selection-${paneId}-page-${page}`}
      style={{ zIndex: 12 }}
    >
      {mergedRects.map((rect, index) => (
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
                ...buildPdfUnderlineDecorationStyle({
                  color,
                  underlineStyle,
                  isActive: true,
                  segment: rect,
                }),
              }
            : {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                backgroundColor: `${color}26`,
                boxShadow: `inset 0 0 0 1px ${color}24`,
                opacity: 0.95,
              }}
        />
      ))}
    </div>
  );
}

interface PdfSearchMatchOverlayProps {
  match: PdfSearchMatch;
}

function PdfSearchMatchOverlay({ match }: PdfSearchMatchOverlayProps) {
  if (match.rects.length === 0) {
    return null;
  }

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 11 }}>
      {match.rects.map((rect, index) => (
        <div
          key={`${match.page}-${match.index}-${index}`}
          className="absolute rounded-sm"
          style={{
            left: `${rect.left * 100}%`,
            top: `${rect.top * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
            backgroundColor: "rgba(59, 130, 246, 0.18)",
            boxShadow: "inset 0 0 0 1px rgba(59, 130, 246, 0.45)",
          }}
        />
      ))}
    </div>
  );
}

interface PdfSearchMatchPortalProps {
  match: PdfSearchMatch;
  paneRootRef: React.RefObject<HTMLElement | null>;
}

function PdfSearchMatchPortal({ match, paneRootRef }: PdfSearchMatchPortalProps) {
  const container = usePdfPageOverlayContainer({
    paneRootRef,
    page: match.page,
    overlayClassName: `pdf-search-match-overlay-${match.page}`,
    overlayStyle: 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:11;',
    dependencyKey: `${match.page}:${match.index}:${match.preview}`,
  });

  if (!container) {
    return null;
  }

  return ReactDOM.createPortal(
    <PdfSearchMatchOverlay match={match} />,
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
  onChangeUnderlineStyle?: (style: UnderlineStyleType) => void;
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
  onChangeUnderlineStyle,
  onConvertStyle,
}: PdfStoredAnnotationMenuProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const stopMenuEventPropagation = useCallback((event: React.SyntheticEvent<HTMLDivElement>) => {
    event.stopPropagation();
  }, []);
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
      if (target?.closest("[data-pdf-annotation-adjust-handle]")) {
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
      onPointerDown={stopMenuEventPropagation}
      onMouseDown={stopMenuEventPropagation}
      onClick={stopMenuEventPropagation}
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
        styleType={annotation.style.type}
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
        onChangeUnderlineStyle={annotation.style.type === "underline" ? onChangeUnderlineStyle : undefined}
        currentUnderlineStyle={annotation.style.underlineStyle ?? DEFAULT_UNDERLINE_STYLE}
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

interface PdfViewerContextMenuState {
  position: { x: number; y: number };
  pageNumber: number | null;
  selectedText: string;
}

interface PdfViewerContextMenuAction {
  id: string;
  label: string;
  icon: typeof Copy;
  disabled?: boolean;
  onSelect: () => void;
}

interface PdfViewerContextMenuProps {
  state: PdfViewerContextMenuState;
  showSidebar: boolean;
  zoomMode: PdfZoomMode;
  onClose: () => void;
  onCopySelection: () => void;
  onCopyPageReference: () => void;
  onOpenSearch: () => void;
  onToggleSidebar: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  onResetZoom: () => void;
  onExportPdf: () => void;
}

function PdfViewerContextMenu({
  state,
  showSidebar,
  zoomMode,
  onClose,
  onCopySelection,
  onCopyPageReference,
  onOpenSearch,
  onToggleSidebar,
  onFitWidth,
  onFitPage,
  onResetZoom,
  onExportPdf,
}: PdfViewerContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const popupSize = useMeasuredPopupSize(
    menuRef,
    { width: 272, height: 390 },
    `${state.position.x}:${state.position.y}:${state.pageNumber ?? 0}:${state.selectedText.length}:${showSidebar}:${zoomMode}`,
  );
  const adjustedPosition = adjustPopupPosition(state.position, popupSize, 12);
  const hasSelection = state.selectedText.trim().length > 0;
  const snippet = hasSelection
    ? state.selectedText.trim().replace(/\s+/g, " ").slice(0, 180)
    : null;
  const stopMenuEventPropagation = useCallback((event: React.SyntheticEvent<HTMLDivElement>) => {
    event.stopPropagation();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  const runAction = (action: PdfViewerContextMenuAction) => {
    if (action.disabled) {
      return;
    }
    action.onSelect();
    onClose();
  };

  const primaryActions: PdfViewerContextMenuAction[] = [
    hasSelection ? {
      id: "copy-selection",
      label: "复制选中文本",
      icon: Copy,
      onSelect: onCopySelection,
    } : null,
    {
      id: "copy-page-reference",
      label: state.pageNumber ? `复制页引用：Page ${state.pageNumber}` : "复制页引用",
      icon: FileText,
      disabled: !state.pageNumber,
      onSelect: onCopyPageReference,
    },
    {
      id: "open-search",
      label: "在 PDF 内搜索",
      icon: Search,
      onSelect: onOpenSearch,
    },
    {
      id: "export-pdf",
      label: "导出带批注 PDF",
      icon: FileOutput,
      onSelect: onExportPdf,
    },
  ].filter((action): action is PdfViewerContextMenuAction => Boolean(action));

  const viewActions: PdfViewerContextMenuAction[] = [
    {
      id: "toggle-sidebar",
      label: showSidebar ? "隐藏批注栏" : "显示批注栏",
      icon: PanelLeft,
      onSelect: onToggleSidebar,
    },
    {
      id: "fit-width",
      label: "适宽显示",
      icon: ArrowLeftRight,
      disabled: zoomMode === "fit-width",
      onSelect: onFitWidth,
    },
    {
      id: "fit-page",
      label: "适页显示",
      icon: Maximize2,
      disabled: zoomMode === "fit-page",
      onSelect: onFitPage,
    },
    {
      id: "reset-zoom",
      label: "重置缩放",
      icon: RotateCcw,
      onSelect: onResetZoom,
    },
  ];

  const renderAction = (action: PdfViewerContextMenuAction) => {
    const Icon = action.icon;
    return (
      <button
        key={action.id}
        type="button"
        role="menuitem"
        disabled={action.disabled}
        data-testid={`pdf-context-menu-action-${action.id}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          runAction(action);
        }}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:text-muted-foreground/55 disabled:hover:bg-transparent"
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{action.label}</span>
      </button>
    );
  };

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="PDF context menu"
      data-testid="pdf-viewer-context-menu"
      className="fixed z-[130] w-[17rem] rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={stopMenuEventPropagation}
      onMouseDown={stopMenuEventPropagation}
      onClick={stopMenuEventPropagation}
    >
      <div className="px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          PDF 工具
        </div>
        {snippet ? (
          <div className="mt-1 line-clamp-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
            “{snippet}”
          </div>
        ) : null}
      </div>
      <div className="space-y-0.5">
        {primaryActions.map(renderAction)}
      </div>
      <div className="my-1 border-t border-border" />
      <div className="space-y-0.5">
        {viewActions.map(renderAction)}
      </div>
    </div>,
    document.body,
  );
}

interface PdfStoredAnnotationOverlayProps {
  annotation: AnnotationItem;
  activeTool: AnnotationTool;
  isActive: boolean;
  onClick: () => void;
  onHoverChange: (isHovered: boolean) => void;
  textMarkupView?: PdfTextMarkupView | null;
  adjustmentDraft?: PdfAnnotationAdjustmentDraft | null;
  areaAdjustmentDraft?: PdfAreaAdjustmentDraft | null;
  showAreaAdjustmentHandles?: boolean;
  onAdjustPointerDown?: (side: "start" | "end", event: React.PointerEvent<HTMLButtonElement>) => void;
  onAreaAdjustPointerDown?: (handle: PdfAreaAdjustmentHandle, event: React.PointerEvent<HTMLElement>) => void;
}

function PdfStoredAnnotationOverlay({
  annotation,
  activeTool,
  isActive,
  onClick,
  onHoverChange,
  textMarkupView,
  adjustmentDraft,
  areaAdjustmentDraft,
  showAreaAdjustmentHandles = false,
  onAdjustPointerDown,
  onAreaAdjustPointerDown,
}: PdfStoredAnnotationOverlayProps) {
  if (annotation.target.type !== "pdf" || annotation.target.rects.length === 0) {
    return null;
  }

  const target = annotation.target as PdfTarget;
  const resolvedColor = resolveHighlightColor(annotation.style.color);
  const isTransparent = resolvedColor === "transparent";
  const isPin = isPinAnnotation(annotation);
  const isTextMarkup = annotation.style.type === "highlight" || annotation.style.type === "underline";
  const shouldCapturePointer = activeTool !== "area";
  const activeDraft = adjustmentDraft?.annotationId === annotation.id ? adjustmentDraft : null;
  const activeAreaDraft = areaAdjustmentDraft?.annotationId === annotation.id ? areaAdjustmentDraft : null;
  if (isTextMarkup && !activeDraft && !textMarkupView) {
    return null;
  }

  const effectiveRects = isTextMarkup
    ? activeDraft?.anchor.rects ?? textMarkupView?.rects ?? []
    : activeAreaDraft ? [activeAreaDraft.rect] : target.rects;
  const renderRects = isTextMarkup
    ? normalizePdfTextMarkupRenderRects(effectiveRects)
    : effectiveRects;
  const overlaySegments = isTextMarkup
    ? activeDraft
      ? mergePdfTextMarkupRenderRectsToOverlaySegments(renderRects)
      : textMarkupView?.segments ?? []
    : pdfTargetRectsToOverlaySegments(renderRects);
  const capturesTextSelectionStart = activeTool === "highlight" ||
    activeTool === "underline" ||
    activeTool === "select";
  const isArea = annotation.style.type === "area";

  if (isPin) {
    const rect = target.rects[0];
    const pinComment = annotation.comment?.trim();
    const pinX = ((rect.x1 + rect.x2) / 2) * 100;
    const pinY = rect.y1 * 100;

    return (
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 18 }}>
        <div
          className={`absolute cursor-pointer transition-transform ${isActive ? "animate-pulse scale-110" : ""}`}
          data-pdf-stored-annotation-id={annotation.id}
          data-pdf-stored-annotation-segment="true"
          data-pdf-stored-annotation-type="pin"
          style={{
            left: `${pinX}%`,
            top: `${pinY}%`,
            transform: "translate(-50%, -100%)",
            pointerEvents: shouldCapturePointer ? "auto" : "none",
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

  if (isTextMarkup && overlaySegments.length === 0) {
    return null;
  }

  const boxShadow = isActive
    ? `inset 0 0 0 2px ${resolvedColor === "transparent" ? "#4b5563" : resolvedColor}66`
    : "none";

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 24 }}>
      {overlaySegments.map((rect, index) => {
        const style: React.CSSProperties = {
          position: "absolute",
          left: `${rect.left}%`,
          top: `${rect.top}%`,
          width: `${rect.width}%`,
          height: `${rect.height}%`,
          pointerEvents: shouldCapturePointer ? "auto" : "none",
          cursor: shouldCapturePointer ? "pointer" : "crosshair",
          transition: "opacity 0.2s ease-in-out, box-shadow 0.2s ease-in-out, border-color 0.2s ease-in-out",
          boxSizing: "border-box",
          boxShadow,
        };

        if (annotation.style.type === "underline") {
          Object.assign(style, buildPdfUnderlineDecorationStyle({
            color: isTransparent ? "#666666" : resolvedColor,
            underlineStyle: annotation.style.underlineStyle ?? "solid",
            isActive,
            segment: rect,
          }));
        } else if (isArea) {
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
          style.opacity = 1;
          style.borderRadius = 2;
        }

        return (
          <div
            key={`${annotation.id}-${index}`}
            data-testid={`pdf-stored-annotation-segment-${annotation.id}-${index}`}
            data-pdf-stored-annotation-id={annotation.id}
            data-pdf-stored-annotation-segment="true"
            data-pdf-stored-annotation-type={annotation.style.type}
            data-pdf-annotation-area-handle={isArea && showAreaAdjustmentHandles ? "move" : undefined}
            style={style}
            onPointerDown={(event) => {
              if (isArea && showAreaAdjustmentHandles && onAreaAdjustPointerDown) {
                onAreaAdjustPointerDown("move", event);
                return;
              }
              if (isPdfAnnotationResizeHandleTarget(event.target)) {
                return;
              }
              if (isTextMarkup && capturesTextSelectionStart) {
                return;
              }
              if (isArea && activeTool === "area") {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClick();
            }}
          />
        );
      })}
      {isTextMarkup && isActive && overlaySegments.length > 0 && onAdjustPointerDown ? (
        (() => {
          const firstRect = overlaySegments[0];
          const lastRect = overlaySegments[overlaySegments.length - 1];
          const handleStyle = {
            position: "absolute",
            width: 28,
            height: 34,
            marginLeft: -14,
            marginTop: -17,
            borderRadius: 9999,
            border: 0,
            backgroundColor: "transparent",
            padding: 0,
            pointerEvents: "auto" as const,
            cursor: "ew-resize",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            touchAction: "none",
            zIndex: 5,
          } satisfies React.CSSProperties;
          const handlePillStyle = {
            width: 8,
            height: 20,
            borderRadius: 9999,
            border: "1px solid rgba(15, 23, 42, 0.18)",
            backgroundColor: "rgba(255,255,255,0.94)",
            boxShadow: "0 2px 6px rgba(15, 23, 42, 0.16)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none" as const,
          } satisfies React.CSSProperties;
          const handleGripStyle = {
            width: 1,
            height: 10,
            backgroundColor: "#111827",
            borderRadius: 9999,
          } satisfies React.CSSProperties;

          return (
            <>
              <button
                type="button"
                aria-label="Adjust annotation start"
                data-testid={`pdf-annotation-adjust-start-${annotation.id}`}
                data-pdf-annotation-adjust-handle="start"
                style={{
                  ...handleStyle,
                  left: `${firstRect.left}%`,
                  top: `${firstRect.top + (firstRect.height / 2)}%`,
                  opacity: activeDraft?.source === "start" ? 1 : 0.92,
                }}
                onPointerDown={(event) => onAdjustPointerDown("start", event)}
              >
                <span style={handlePillStyle}>
                  <span style={handleGripStyle} />
                </span>
              </button>
              <button
                type="button"
                aria-label="Adjust annotation end"
                data-testid={`pdf-annotation-adjust-end-${annotation.id}`}
                data-pdf-annotation-adjust-handle="end"
                style={{
                  ...handleStyle,
                  left: `${lastRect.left + lastRect.width}%`,
                  top: `${lastRect.top + (lastRect.height / 2)}%`,
                  opacity: activeDraft?.source === "end" ? 1 : 0.92,
                }}
                onPointerDown={(event) => onAdjustPointerDown("end", event)}
              >
                <span style={handlePillStyle}>
                  <span style={handleGripStyle} />
                </span>
              </button>
            </>
          );
        })()
      ) : null}
      {isArea && showAreaAdjustmentHandles && overlaySegments.length > 0 && onAreaAdjustPointerDown ? (
        (() => {
          const rect = overlaySegments[0];
          const handleStyle = {
            position: "absolute",
            width: 18,
            height: 18,
            marginLeft: -9,
            marginTop: -9,
            borderRadius: 9999,
            border: "1px solid rgba(15, 23, 42, 0.20)",
            backgroundColor: "rgba(255,255,255,0.96)",
            boxShadow: "0 1px 4px rgba(15, 23, 42, 0.16)",
            pointerEvents: "auto" as const,
            touchAction: "none",
            zIndex: 6,
          } satisfies React.CSSProperties;

          const handleButton = (
            handle: Exclude<PdfAreaAdjustmentHandle, "move">,
            left: string,
            top: string,
            cursor: React.CSSProperties["cursor"],
          ) => (
            <button
              key={handle}
              type="button"
              aria-label={`Adjust area ${handle}`}
              data-pdf-stored-annotation-id={annotation.id}
              data-pdf-annotation-area-handle={handle}
              style={{
                ...handleStyle,
                left,
                top,
                cursor,
              }}
              onPointerDown={(event) => onAreaAdjustPointerDown(handle, event)}
            />
          );

          return (
            <>
              <button
                type="button"
                aria-label="Move area"
                data-pdf-stored-annotation-id={annotation.id}
                data-pdf-annotation-area-handle="move"
                style={{
                  position: "absolute",
                  left: `${rect.left}%`,
                  top: `${rect.top}%`,
                  width: `${rect.width}%`,
                  height: `${rect.height}%`,
                  backgroundColor: "transparent",
                  border: "none",
                  pointerEvents: "auto",
                  cursor: "move",
                  touchAction: "none",
                  zIndex: 5,
                }}
                onPointerDown={(event) => onAreaAdjustPointerDown("move", event)}
              />
              {handleButton("nw", `${rect.left}%`, `${rect.top}%`, "nwse-resize")}
              {handleButton("ne", `${rect.left + rect.width}%`, `${rect.top}%`, "nesw-resize")}
              {handleButton("sw", `${rect.left}%`, `${rect.top + rect.height}%`, "nesw-resize")}
              {handleButton("se", `${rect.left + rect.width}%`, `${rect.top + rect.height}%`, "nwse-resize")}
            </>
          );
        })()
      ) : null}
    </div>
  );
}

interface PdfStoredAnnotationPortalProps {
  annotation: AnnotationItem;
  activeTool: AnnotationTool;
  page: number;
  paneRootRef: React.RefObject<HTMLElement | null>;
  isActive: boolean;
  onClick: (annotation: AnnotationItem) => void;
  onHoverChange: (isHovered: boolean) => void;
  getTextModelForPage: (pageNumber: number) => PdfPageTextModel | null;
  getTextMarkupView: (annotation: AnnotationItem, model?: PdfPageTextModel | null) => PdfTextMarkupView | null;
  adjustmentDraft?: PdfAnnotationAdjustmentDraft | null;
  areaAdjustmentDraft?: PdfAreaAdjustmentDraft | null;
  showAreaAdjustmentHandles?: boolean;
  onAdjustPointerDown?: (side: "start" | "end", event: React.PointerEvent<HTMLButtonElement>) => void;
  onAreaAdjustPointerDown?: (handle: PdfAreaAdjustmentHandle, event: React.PointerEvent<HTMLElement>) => void;
}

function PdfStoredAnnotationPortal({
  annotation,
  activeTool,
  page,
  paneRootRef,
  isActive,
  onClick,
  onHoverChange,
  getTextModelForPage,
  getTextMarkupView,
  adjustmentDraft,
  areaAdjustmentDraft,
  showAreaAdjustmentHandles = false,
  onAdjustPointerDown,
  onAreaAdjustPointerDown,
}: PdfStoredAnnotationPortalProps) {
  const container = usePdfPageOverlayContainer({
    paneRootRef,
    page,
    overlayClassName: `pdf-stored-annotation-overlay-${annotation.id}`,
    overlayStyle: "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:24;",
    dependencyKey: `${annotation.id}:${page}`,
  });
  const textModel = getTextModelForPage(page);

  const textMarkupView = useMemo(() => {
    if (!container || !isPdfTextMarkupAnnotation(annotation)) {
      return null;
    }

    return getTextMarkupView(annotation, textModel);
  }, [annotation, container, getTextMarkupView, textModel]);
  const renderAnnotation = textMarkupView?.annotation ?? annotation;

  if (!container) {
    return null;
  }

  return ReactDOM.createPortal(
    <PdfStoredAnnotationOverlay
      annotation={renderAnnotation}
      activeTool={activeTool}
      isActive={isActive}
      onClick={() => onClick(renderAnnotation)}
      onHoverChange={onHoverChange}
      textMarkupView={textMarkupView}
      adjustmentDraft={adjustmentDraft}
      areaAdjustmentDraft={areaAdjustmentDraft}
      showAreaAdjustmentHandles={showAreaAdjustmentHandles}
      onAdjustPointerDown={onAdjustPointerDown}
      onAreaAdjustPointerDown={onAreaAdjustPointerDown}
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
  rootHandle: propRootHandle,
  paneId,
  fileId,
  filePath,
  binding = null,
  preloadedPdfDocument = null,
}: PDFHighlighterAdapterProps) {
  const { t } = useI18n();
  // Use workspaceRootHandle if available, otherwise fall back to prop rootHandle
  // This ensures .lattice data is always read from the true workspace root
  const workspaceRootHandle = useWorkspaceStore((state) => state.workspaceRootHandle);
  const rootHandle = workspaceRootHandle ?? propRootHandle;

  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const workspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isDiagnosticsMode = pathname?.includes("/diagnostics") ?? false;
  const shouldIsolateDiagnosticViewState = isDiagnosticsMode &&
    searchParams.has("directHighlighter") &&
    !searchParams.has("stableState");
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
    if (shouldIsolateDiagnosticViewState) {
      return null;
    }
    return readCachedPdfViewState(useContentCacheStore.getState().getEditorState(fileId));
  }, [fileId, shouldIsolateDiagnosticViewState]);
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
    isLoading: annotationsLoading,
    error: annotationsError,
    addAnnotation,
    upsertAnnotation,
    upsertAnnotations,
    updateAnnotation: commitAnnotationUpdate,
    deleteAnnotation,
  } = useAnnotationSystem({
    fileHandle,
    filePath,
    storageFileId: effectiveBinding?.canonicalStorageFileId ?? null,
    binding: effectiveBinding,
    rootHandle,
    fileType: 'pdf',
    author: 'user',
    saveDelay: isDiagnosticsMode ? 300000 : undefined,
  });

  const cachedToolbarState = cachedPdfViewState?.toolbarState ?? DEFAULT_PDF_ANNOTATION_TOOLBAR_VIEW_STATE;
  const [scale, setScale] = useState(cachedPdfViewState?.scale ?? 1.2);
  const [zoomMode, setZoomMode] = useState<PdfZoomMode>(cachedPdfViewState?.zoomMode ?? 'fit-width');
  const [activeTool, setActiveTool] = useState<AnnotationTool>(cachedToolbarState.activeTool as AnnotationTool);
  const [activeColor, setActiveColor] = useState(resolveHighlightColor(cachedToolbarState.activeColor));
  const [activeUnderlineStyle, setActiveUnderlineStyle] = useState<UnderlineStyleType>(cachedToolbarState.activeUnderlineStyle as UnderlineStyleType);
  const [activeEraserMode, setActiveEraserMode] = useState<PdfInkEraserMode>(cachedToolbarState.activeEraserMode as PdfInkEraserMode);
  const [activeEraserSize, setActiveEraserSize] = useState(cachedToolbarState.activeEraserSize ?? DEFAULT_PDF_INK_ERASER_SIZE);
  const activeInkWidth = useInkAnnotationStore((state) => state.currentStyle.width);
  const setInkCurrentStyle = useInkAnnotationStore((state) => state.setCurrentStyle);
  const [annotationDefaultsMenu, setAnnotationDefaultsMenu] = useState<PdfAnnotationDefaultsMenuState | null>(null);
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number; page: number } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [searchOpen, setSearchOpen] = useState(cachedToolbarState.searchOpen);
  const [sidebarSize, setSidebarSize] = useState(cachedPdfViewState?.sidebarSize ?? 28);
  const [pdfSidebarViewState, setPdfSidebarViewState] = useState<PdfAnnotationSidebarViewState>(
    cachedPdfViewState?.sidebarState ?? DEFAULT_PDF_ANNOTATION_SIDEBAR_VIEW_STATE,
  );
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [annotationAdjustmentDraft, setAnnotationAdjustmentDraft] = useState<PdfAnnotationAdjustmentDraft | null>(null);
  const [areaAdjustmentDraft, setAreaAdjustmentDraft] = useState<PdfAreaAdjustmentDraft | null>(null);
  const [diagnosticSelectionResult, setDiagnosticSelectionResult] = useState<PdfDiagnosticSelectionResult | null>(null);
  const [annotationMenuState, setAnnotationMenuState] = useState<{
    annotationId: string;
    position: { x: number; y: number };
    anchorRect: DOMRect | null;
  } | null>(null);
  const suppressPdfSurfaceClickUntilRef = useRef(0);
  const clearActiveAnnotationUi = useCallback(() => {
    setSelectedAnnotationId(null);
    setHighlightedId(null);
    setHoveredAnnotationId(null);
    setAnnotationAdjustmentDraft(null);
    setAreaAdjustmentDraft(null);
  }, []);
  const closeAnnotationMenu = useCallback(() => {
    setAnnotationMenuState(null);
    clearActiveAnnotationUi();
  }, [clearActiveAnnotationUi]);
  const handlePdfSidebarViewStateChange = useCallback((nextState: PdfAnnotationSidebarViewState) => {
    setPdfSidebarViewState(normalizePdfAnnotationSidebarViewState(nextState));
  }, []);
  const [currentAnchorDebug, setCurrentAnchorDebug] = useState<PdfViewAnchor | null>(cachedPdfViewState?.anchor ?? null);
  const [persistedPdfViewState, setPersistedPdfViewState] = useState(() => cachedPdfViewState ?? null);
  const [persistedPdfEditorState, setPersistedPdfEditorState] = useState<PersistedFileViewState | null>(null);
  const [persistedPdfEditorStateLoaded, setPersistedPdfEditorStateLoaded] = useState(!persistedPdfViewStateKey);
  const dedupedAnnotations = useMemo(
    () => dedupeAnnotationsById(annotations),
    [annotations],
  );
  const dedupedAnnotationsRef = useRef<AnnotationItem[]>(dedupedAnnotations);
  const [repairedAnnotationsById, setRepairedAnnotationsById] = useState<Record<string, PdfRepairedAnnotationEntry>>({});
  const [optimisticAnnotationsById, setOptimisticAnnotationsById] = useState<Record<string, AnnotationItem>>({});
  const [pdfTextLayerRevision, setPdfTextLayerRevision] = useState(0);
  const pageTextLayerRevisionRef = useRef<Map<number, number>>(new Map());
  const repairedAnnotationUpdateSignatureRef = useRef<Record<string, string>>({});
  const processedMarkdownDraftSignatureRef = useRef<string | null>(null);
  const renderedPageTextModelCacheRef = useRef<Map<number, { revision: number; model: PdfPageTextModel | null }>>(new Map());
  const pdfTextMarkupViewCacheRef = useRef<Map<string, PdfTextMarkupView | null>>(new Map());
  const updateAnnotation = useCallback((
    annotationId: string,
    updates: AnnotationUpdates,
  ) => {
    setRepairedAnnotationsById((previous) => {
      if (!previous[annotationId]) {
        return previous;
      }
      const next = { ...previous };
      delete next[annotationId];
      return next;
    });
    repairedAnnotationUpdateSignatureRef.current[annotationId] = "";
    for (const key of Array.from(pdfTextMarkupViewCacheRef.current.keys())) {
      if (key.startsWith(`${annotationId}::`)) {
        pdfTextMarkupViewCacheRef.current.delete(key);
      }
    }
    const baseAnnotation = dedupedAnnotationsRef.current.find((annotation) => annotation.id === annotationId);
    if (baseAnnotation) {
      setOptimisticAnnotationsById((previous) => ({
        ...previous,
        [annotationId]: mergeAnnotationUpdatesForDisplay(
          previous[annotationId] ?? baseAnnotation,
          updates,
        ),
      }));
    }
    return commitAnnotationUpdate(annotationId, updates);
  }, [commitAnnotationUpdate]);
  useEffect(() => {
    setOptimisticAnnotationsById((previous) => {
      let changed = false;
      const next = { ...previous };
      dedupedAnnotations.forEach((annotation) => {
        const optimistic = next[annotation.id];
        if (!optimistic) {
          return;
        }
        if (buildPdfTextRepairSignature(annotation) === buildPdfTextRepairSignature(optimistic)) {
          delete next[annotation.id];
          changed = true;
        }
      });
      return changed ? next : previous;
    });
  }, [dedupedAnnotations]);
  const displayAnnotations = useMemo(() => (
    dedupedAnnotations.map((annotation) => {
      const optimistic = optimisticAnnotationsById[annotation.id];
      const baseAnnotation = optimistic ?? annotation;
      const repaired = repairedAnnotationsById[annotation.id];
      if (!repaired) {
        return baseAnnotation;
      }
      return !optimistic && repaired.sourceSignature === buildPdfTextRepairSignature(annotation)
        ? repaired.annotation
        : baseAnnotation;
    })
  ), [dedupedAnnotations, optimisticAnnotationsById, repairedAnnotationsById]);
  const manifestSeedId = useMemo(() => generateFileId(filePath), [filePath]);
  const annotationMirrorTimeoutRef = useRef<number | null>(null);
  const pdfAnnotationCount = useMemo(() => (
    displayAnnotations.filter((annotation) => annotation.target.type === "pdf").length
  ), [displayAnnotations]);
  const initialVisiblePdfPageSet = useMemo(() => {
    const next = new Set<number>([1]);
    const restoredPage = cachedPdfViewState?.anchor?.pageNumber;
    if (typeof restoredPage === "number" && Number.isInteger(restoredPage) && restoredPage > 0) {
      next.add(restoredPage);
      for (let candidate = restoredPage - PAGE_BUFFER; candidate <= restoredPage + PAGE_BUFFER; candidate += 1) {
        if (candidate > 0) {
          next.add(candidate);
        }
      }
    }
    return next;
  }, [cachedPdfViewState?.anchor?.pageNumber]);
  const pdfManifestSyncKey = (
    pdfItemManifest
      ? `${pdfItemManifest.itemId}:${pdfItemManifest.itemFolderPath}:${pdfItemManifest.annotationIndexPath ?? ""}`
      : null
  );
  const canManagePdfItemWorkspace = useMemo(() => {
    const candidate = rootHandle as Partial<FileSystemDirectoryHandle> | null;
    return Boolean(candidate && typeof candidate.getDirectoryHandle === "function" && typeof candidate.values === "function");
  }, [rootHandle]);
  const inkWidthInitializedRef = useRef(false);
  useEffect(() => {
    dedupedAnnotationsRef.current = dedupedAnnotations;
  }, [dedupedAnnotations]);

  const handleTextLayerReady = useCallback((pageNumber: number) => {
    pageTextLayerRevisionRef.current.set(
      pageNumber,
      (pageTextLayerRevisionRef.current.get(pageNumber) ?? 0) + 1,
    );
    renderedPageTextModelCacheRef.current.delete(pageNumber);
    setPdfTextLayerRevision((revision) => revision + 1);
  }, []);

  const getRenderedPdfPageTextModelForPage = useCallback((pageNumber: number): PdfPageTextModel | null => {
    const pageRevision = pageTextLayerRevisionRef.current.get(pageNumber) ?? 0;
    const cached = renderedPageTextModelCacheRef.current.get(pageNumber);
    if (cached?.revision === pageRevision) {
      return cached.model;
    }

    const pageElement = findPdfPageElementInScope(containerRef.current, pageNumber);
    const model = pageElement ? buildRenderedPdfPageTextModel(pageElement) : null;
    renderedPageTextModelCacheRef.current.set(pageNumber, {
      revision: pageRevision,
      model,
    });
    return model;
  }, []);

  const getPdfTextMarkupView = useCallback((
    annotation: AnnotationItem,
    model?: PdfPageTextModel | null,
  ): PdfTextMarkupView | null => {
    const cacheKey = buildPdfTextMarkupViewCacheKey(annotation, model);
    if (pdfTextMarkupViewCacheRef.current.has(cacheKey)) {
      return pdfTextMarkupViewCacheRef.current.get(cacheKey) ?? null;
    }

    const view = resolvePdfTextMarkupView(annotation, model);
    pdfTextMarkupViewCacheRef.current.set(cacheKey, view);
    if (pdfTextMarkupViewCacheRef.current.size > 600) {
      const oldestKey = pdfTextMarkupViewCacheRef.current.keys().next().value;
      if (oldestKey) {
        pdfTextMarkupViewCacheRef.current.delete(oldestKey);
      }
    }
    return view;
  }, []);

  const handlePdfDocumentReady = useCallback((pdfDocument: PDFDocumentProxy, loadKey: string) => {
    setPdfLoadStage("ready");
    setPdfLoadRunState("resolved");
    setPdfLoadError(null);
    setPdfSourceError(null);
    setPdfLoadProgress("");
    setPdfDocument(pdfDocument);
    loadedPdfDocumentKeyRef.current = loadKey;
    setNumPages(pdfDocument.numPages);
  }, []);

  useEffect(() => {
    if (!inkWidthInitializedRef.current && activeInkWidth <= DEFAULT_INK_STYLE.width) {
      inkWidthInitializedRef.current = true;
      setInkCurrentStyle({ width: DEFAULT_PDF_INK_WIDTH });
      return;
    }
    inkWidthInitializedRef.current = true;
  }, [activeInkWidth, setInkCurrentStyle]);

  const handlePdfDocumentError = useCallback((error: Error) => {
    setPdfLoadStage("error");
    setPdfLoadRunState("rejected");
    setPdfLoadError(error.message || "Failed to load PDF");
    setPdfDocument(null);
    loadedPdfDocumentKeyRef.current = null;
    setNumPages(0);
  }, []);

  const handlePdfLoadProgress = useCallback((progress: { loaded?: number; total?: number }) => {
    setPdfLoadStage((current) => current === "ready" || current === "error" ? current : "loading");
    setPdfLoadRunState((current) => current === "resolved" || current === "rejected" ? current : "loading-progress");
    setPdfLoadWorkerState((current) => current === "ready" || current === "error" ? current : "loading");
    const loaded = Number.isFinite(progress.loaded) ? Math.round(progress.loaded ?? 0) : 0;
    const total = Number.isFinite(progress.total) ? Math.round(progress.total ?? 0) : 0;
    setPdfLoadProgress(`${loaded}/${total}`);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
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
    setPersistedPdfEditorState(null);
    setPersistedPdfEditorStateLoaded(false);
    if (shouldIsolateDiagnosticViewState || !persistedPdfViewStateKey) {
      setPersistedPdfEditorStateLoaded(true);
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

      setPersistedPdfEditorState(persistedState);
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
    }).finally(() => {
      if (!cancelled) {
        setPersistedPdfEditorStateLoaded(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [cachedPdfViewState, fileId, persistedPdfViewStateKey, saveEditorState, shouldIsolateDiagnosticViewState]);

  useEffect(() => {
    if (cachedPdfViewState || !persistedPdfViewState) {
      return;
    }

    setScale(persistedPdfViewState.scale);
    setFitScale(persistedPdfViewState.scale);
    setZoomMode(persistedPdfViewState.zoomMode);
    setShowSidebar(persistedPdfViewState.showSidebar);
    setSidebarSize(persistedPdfViewState.sidebarSize ?? 28);
    setPdfSidebarViewState(persistedPdfViewState.sidebarState ?? DEFAULT_PDF_ANNOTATION_SIDEBAR_VIEW_STATE);
    const toolbarState = persistedPdfViewState.toolbarState ?? DEFAULT_PDF_ANNOTATION_TOOLBAR_VIEW_STATE;
    setActiveTool(toolbarState.activeTool as AnnotationTool);
    setActiveColor(resolveHighlightColor(toolbarState.activeColor));
    setActiveUnderlineStyle(toolbarState.activeUnderlineStyle as UnderlineStyleType);
    setActiveEraserMode(toolbarState.activeEraserMode as PdfInkEraserMode);
    setActiveEraserSize(toolbarState.activeEraserSize ?? DEFAULT_PDF_INK_ERASER_SIZE);
    setSearchOpen(toolbarState.searchOpen);
    setCurrentAnchorDebug(persistedPdfViewState.anchor ?? null);
  }, [cachedPdfViewState, persistedPdfViewState]);

  useEffect(() => {
    if (isDiagnosticsMode || !pdfItemManifest || !canManagePdfItemWorkspace) {
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
  }, [canManagePdfItemWorkspace, dedupedAnnotations, effectiveBinding, fileName, filePath, hydrateBacklinksFromIndex, isDiagnosticsMode, manifestSeedId, pdfAnnotationCount, pdfItemManifest, pdfManifestSyncKey, refreshDirectory, rootHandle, scheduleBacklinkRefresh, showSidebar]);

  const [restoreDebugState, setRestoreDebugState] = useState<PdfRestoreDebugState>(createIdleRestoreDebugState);
  
  // Current stroke state (for real-time drawing preview)
  const [currentInkPath, setCurrentInkPath] = useState<{ x: number; y: number }[]>([]);
  const [currentInkPage, setCurrentInkPage] = useState<number | null>(null);
  const [isDrawingStroke, setIsDrawingStroke] = useState(false);
  const [isErasingInk, setIsErasingInk] = useState(false);
  const [inkEraserCursor, setInkEraserCursor] = useState<{
    page: number;
    x: number;
    y: number;
    radius: number;
  } | null>(null);
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
  const [pdfSourceError, setPdfSourceError] = useState<string | null>(null);
  const [pdfLoadStage, setPdfLoadStage] = useState<"idle" | "source-ready" | "source-error" | "loading" | "ready" | "error">("idle");
  const [pdfLoadProgress, setPdfLoadProgress] = useState("");
  const [pdfResetCount, setPdfResetCount] = useState(0);
  const [pdfDirectProbeStage, setPdfDirectProbeStage] = useState<"idle" | "running" | "ready" | "error" | "timeout" | "skipped">("idle");
  const [pdfDirectProbePages, setPdfDirectProbePages] = useState(0);
  const [pdfDirectProbeError, setPdfDirectProbeError] = useState("");
  const pdfDirectProbeAttempt = 0;
  const [pdfDirectProbeRunState, setPdfDirectProbeRunState] = useState("idle");
  const [pdfLoadRunState, setPdfLoadRunState] = useState("idle");
  const [pdfLoadWorkerState, setPdfLoadWorkerState] = useState("idle");
  const [numPages, setNumPages] = useState<number>(0);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const loadedPdfDocumentKeyRef = useRef<string | null>(null);
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);
  const [fitScale, setFitScale] = useState<number>(cachedPdfViewState?.scale ?? 1.2);
  const [pageDimensions, setPageDimensions] = useState<Map<number, { width: number; height: number }>>(new Map());
  const [visiblePages, setVisiblePages] = useState<Set<number>>(() => new Set(initialVisiblePdfPageSet));
  const [diagnosticPinnedPages, setDiagnosticPinnedPages] = useState<Set<number>>(() => new Set());
  const [pdfSelectionSession, setPdfSelectionSession] = useState<PdfSelectionSessionState>(() => createIdlePdfSelectionSession());
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const [activeSearchMatch, setActiveSearchMatch] = useState<PdfSearchMatch | null>(null);
  const [pendingSelectionDraft, setPendingSelectionDraft] = useState<{
    selection: PdfResolvedSelection;
    position: { x: number; y: number };
    anchorRect: DOMRect | null;
    avoidRect: DOMRect | null;
    token: number;
  } | null>(null);
  const [pdfContextMenu, setPdfContextMenu] = useState<PdfViewerContextMenuState | null>(null);
  const [deferredNavigation, setDeferredNavigation] = useState<PendingPaneNavigation | null>(null);
  const isJsdomRuntime = typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);
  const isDesktopUrlSource = source.kind === "desktop-url";
  const pdfSourceUrl = isDesktopUrlSource ? source.url : null;
  const pdfSourceBuffer = source.kind === "buffer" ? source.data : null;
  const pdfFileByteLength = pdfSourceBuffer?.byteLength ?? 0;
  const pdfFileInputKind = isDesktopUrlSource ? "url" : pdfSourceBuffer ? "native-byte-data" : "pending-data";
  const pdfLoadKey = isDesktopUrlSource
    ? `url:${pdfSourceUrl ?? ""}`
    : `buffer:${fileId}:${filePath}:${pdfFileByteLength}`;
  const hasPdfFile = Boolean(pdfSourceUrl || pdfSourceBuffer);
  const desktopPdfPath = useMemo(() => getDesktopPdfPath(fileHandle), [fileHandle]);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const [pageObserver, setPageObserver] = useState<IntersectionObserver | null>(null);
  const hasRestoredScrollRef = useRef(false);
  const timeoutIdsRef = useRef<number[]>([]);
  const persistTimeoutRef = useRef<number | null>(null);
  const persistIdleRef = useRef<number | null>(null);
  const repairWritebackIdleRef = useRef<number | null>(null);
  const repairWritebackQueueRef = useRef<Map<string, AnnotationItem>>(new Map());
  const lastPersistSignatureRef = useRef<string | null>(null);
  const lastPersistedEditorStateRef = useRef<{
    fileId: string;
    persistedKey: string | null;
    state: ReturnType<typeof buildPdfEditorState>;
  } | null>(null);
  const anchorCaptureRevisionRef = useRef(0);
  const pendingAreaPreviewBackfillRef = useRef<Set<string>>(new Set());
  const currentInkPathRef = useRef<{ x: number; y: number }[]>([]);
  const currentInkPageRef = useRef<number | null>(null);
  const currentInkPageElementRef = useRef<HTMLElement | null>(null);
  const isErasingInkRef = useRef(false);
  const areaSelectionDraftRef = useRef<{
    page: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const areaSelectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const areaSelectionPageElementRef = useRef<HTMLElement | null>(null);
  const areaSelectionLastClientPointRef = useRef<{ x: number; y: number } | null>(null);
  const areaSelectionDocumentCleanupRef = useRef<(() => void) | null>(null);
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
  const diagnosticScrollToPageRef = useRef<((pageNumber: number) => boolean) | null>(null);

  useEffect(() => {
    if (
      isDiagnosticsMode ||
      annotationsLoading ||
      !pdfDocument ||
      !pdfItemManifest ||
      !canManagePdfItemWorkspace
    ) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const markdown = await withTimeout(
          readPdfItemAnnotationMarkdown(rootHandle, pdfItemManifest),
          8000,
          "PDF annotation markdown draft read",
        );
        if (cancelled || !markdown) {
          return;
        }

        const drafts = parsePdfAnnotationMarkdownDrafts(markdown);
        if (drafts.length === 0) {
          return;
        }

        const signature = `${pdfItemManifest.itemId}:${drafts.map((draft) => [
          draft.id,
          draft.page,
          draft.styleType,
          draft.color,
          draft.exact,
          draft.comment ?? "",
          draft.tags.join(","),
        ].join("|")).join("::")}`;
        if (processedMarkdownDraftSignatureRef.current === signature) {
          return;
        }

        let virtualFile: UniversalAnnotationFile = {
          version: 3,
          documentId: pdfItemManifest.itemId,
          fileId: effectiveBinding?.canonicalStorageFileId ?? pdfItemManifest.itemId,
          fileType: "pdf",
          annotations: dedupedAnnotationsRef.current,
          lastModified: Date.now(),
        };
        const imported: AnnotationItem[] = [];
        for (const draft of drafts) {
          if (cancelled) {
            return;
          }

          const model = await getPdfPageTextModel(pdfDocument, draft.page);
          if (cancelled) {
            return;
          }

          const result = upsertCanonicalPdfTextMarkupAnnotationInFile({
            annotationFile: virtualFile,
            model,
            exact: draft.exact,
            prefix: draft.prefix,
            suffix: draft.suffix,
            styleType: draft.styleType,
            color: resolveHighlightColor(draft.color),
            author: draft.author ?? "lattice-ai",
            id: draft.id,
            comment: draft.comment,
            tags: draft.tags,
            underlineStyle: draft.underlineStyle,
          });
          if (!result.ok || !result.annotation) {
            logger.warn("[PDF] Markdown annotation draft could not be resolved:", {
              id: draft.id,
              page: draft.page,
              reason: result.reason,
            });
            continue;
          }

          virtualFile = result.annotationFile;
          imported.push(result.annotation);
        }

        if (cancelled || imported.length === 0) {
          return;
        }

        processedMarkdownDraftSignatureRef.current = signature;
        upsertAnnotations(imported);
        removeResolvedPdfItemAnnotationMarkdownDrafts(
          rootHandle,
          pdfItemManifest,
          imported.map((annotation) => annotation.id),
        ).catch((error) => {
          logger.warn("[PDF] Imported markdown annotation drafts could not be cleared:", error);
        });
      } catch (error) {
        logger.warn("[PDF] Markdown annotation draft import skipped:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    annotationsLoading,
    canManagePdfItemWorkspace,
    effectiveBinding?.canonicalStorageFileId,
    isDiagnosticsMode,
    pdfDocument,
    pdfItemManifest,
    rootHandle,
    upsertAnnotations,
  ]);

  useEffect(() => {
    if (!hasPdfFile) {
      setPdfLoadStage("idle");
      setPdfLoadError(null);
      setPdfSourceError(null);
      setPdfLoadProgress("");
      setPdfLoadRunState("idle");
      setPdfLoadWorkerState("idle");
      setPdfDocument(null);
      loadedPdfDocumentKeyRef.current = null;
      setNumPages(0);
      return;
    }

    setPdfLoadStage("loading");
    setPdfLoadError(null);
    setPdfSourceError(null);
    setPdfLoadProgress("");
    setPdfLoadRunState("queued");
    setPdfLoadWorkerState("idle");
    setPdfDocument(null);
    loadedPdfDocumentKeyRef.current = null;
    setNumPages(0);
  }, [hasPdfFile, pdfLoadKey]);

  useEffect(() => {
    if (!pdfSourceBuffer) {
      setPdfObjectUrl(null);
      return;
    }

    const blob = new Blob([pdfSourceBuffer.slice(0)], { type: "application/pdf" });
    const objectUrl = window.URL.createObjectURL(blob);
    setPdfObjectUrl(objectUrl);
    return () => {
      window.URL.revokeObjectURL(objectUrl);
    };
  }, [pdfLoadKey, pdfSourceBuffer]);

  useEffect(() => {
    setPdfDirectProbeStage(pdfSourceBuffer ? "running" : "idle");
    setPdfDirectProbePages(0);
    setPdfDirectProbeError("");
    setPdfDirectProbeRunState(pdfSourceBuffer ? "queued" : "disabled");
  }, [pdfSourceBuffer]);

  useEffect(() => {
    if (!preloadedPdfDocument) {
      return;
    }

    setPdfDirectProbeStage("ready");
    setPdfDirectProbePages(preloadedPdfDocument.numPages);
    setPdfDirectProbeError("");
    setPdfDirectProbeRunState("preloaded-ready");
    setPdfLoadWorkerState("preloaded-ready");
    handlePdfDocumentReady(preloadedPdfDocument, pdfLoadKey);
  }, [handlePdfDocumentReady, pdfLoadKey, preloadedPdfDocument]);

  useEffect(() => {
    if (!hasPdfFile || preloadedPdfDocument || USE_REACT_PDF_DOCUMENT_OWNER) {
      return;
    }

    let disposed = false;
    const loadDocument = async () => {
      try {
        setPdfLoadStage("loading");
        setPdfLoadRunState("native-loading");
        setPdfLoadWorkerState("native-loading");
        setPdfDirectProbeStage("running");
        setPdfDirectProbeRunState("native-loading");

        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });
        if (disposed) {
          return;
        }
        const loadedDocument = await loadPdfJsDocument({
          data: pdfSourceBuffer,
          url: pdfSourceUrl,
          label: `PDF highlighter ${paneId} ${pdfLoadKey}`,
          timeoutMs: 20000,
          onProgress: handlePdfLoadProgress,
        });
        if (disposed) {
          return;
        }

        setPdfDirectProbeStage("ready");
        setPdfDirectProbePages(loadedDocument.numPages);
        setPdfDirectProbeRunState("native-ready");
        handlePdfDocumentReady(loadedDocument as unknown as PDFDocumentProxy, pdfLoadKey);
      } catch (error) {
        if (disposed) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setPdfDirectProbeStage("error");
        setPdfDirectProbePages(0);
        setPdfDirectProbeError(message);
        setPdfDirectProbeRunState("native-error");
        handlePdfDocumentError(error instanceof Error ? error : new Error(message));
      }
    };

    void loadDocument();

    return () => {
      disposed = true;
    };
  }, [handlePdfDocumentError, handlePdfDocumentReady, handlePdfLoadProgress, hasPdfFile, paneId, pdfLoadKey, pdfSourceBuffer, pdfSourceUrl, preloadedPdfDocument]);

  useEffect(() => {
    if (!hasPdfFile || pdfLoadStage === "ready" || pdfLoadStage === "error") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPdfLoadStage((current) => current === "ready" || current === "error" ? current : "error");
      setPdfLoadRunState((current) => current === "resolved" || current === "rejected" ? current : "document-timeout");
      setPdfLoadError((current) => current ?? `PDF loading did not finish within ${PDF_DOCUMENT_LOAD_TIMEOUT_MS / 1000}s.`);
      setPdfDocument(null);
      setNumPages(0);
    }, PDF_DOCUMENT_LOAD_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [hasPdfFile, paneId, pdfLoadStage]);

  const textSelectionDragPointRef = useRef<{
    token: number;
    start: { x: number; y: number } | null;
    end: { x: number; y: number } | null;
  } | null>(null);
  const pointerGestureRef = useRef<PdfPointerGestureState | null>(null);
  const suppressNextLinkClickRef = useRef(false);
  const renderedPdfPagesRef = useRef<HTMLElement[]>([]);
  const nativeLayoutPrefetchKeysRef = useRef<Set<string>>(new Set());
  const nativeLayoutPrefetchFrameRef = useRef<number | null>(null);
  const bindingRunGuardRef = useRef(createLatestRunGuard());
  const manifestRunGuardRef = useRef(createLatestRunGuard());
  const backlinkRunGuardRef = useRef(createLatestRunGuard());
  const annotationSyncRunGuardRef = useRef(createLatestRunGuard());
  const pendingAnnotationScrollFrameRef = useRef<number | null>(null);
  const backlinkRefreshIdleHandleRef = useRef<number | null>(null);
  const pendingFitPageNumberRef = useRef<number | null>(null);
  const pdfSelectionSessionRef = useRef<PdfSelectionSessionState>(pdfSelectionSession);
  const committedSelectionAnnotationIdRef = useRef<string | null>(null);
  const visiblePdfSelection = (
    pdfSelectionSession.phase === "frozen" ||
    pdfSelectionSession.phase === "committed"
  )
    ? pdfSelectionSession.snapshot
    : null;
  const frozenPdfSelection = pdfSelectionSession.phase === "frozen" ? visiblePdfSelection : null;
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
      const frozenContext = buildPdfSelectionRectsFromSnapshot(visiblePdfSelection, containerRef.current);
      const sourceElement = eventTarget instanceof HTMLElement ? eventTarget : eventTarget instanceof Node ? eventTarget.parentElement : null;
      const pageElement = sourceElement?.closest<HTMLElement>('[data-page-number]');
      const pageNumber = Number(pageElement?.dataset.pageNumber ?? '');

      return createSelectionContext({
        sourceKind: 'pdf',
        paneId,
        fileName,
        filePath,
        selectedText: getPdfResolvedSelectionExactText(visiblePdfSelection) || text,
        pdfPage: frozenContext.pageNumber ?? (Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : undefined),
        pdfRects: frozenContext.rects ?? buildPdfSelectionRects(domRange, pageElement ?? null),
      });
    },
    {
      getSelectionSnapshot: () => buildPdfSelectionMenuSnapshot(visiblePdfSelection, containerRef.current),
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
    const text = selection.toString();
    const fallbackText = range.toString();
    const resolvedText = text.trim() || fallbackText.trim();
    if (!resolvedText && clientRects.length === 0) {
      return null;
    }

    return {
      text: resolvedText,
      range,
      clientRects,
    };
  }, []);

  const captureNativePdfSelectionSnapshot = useCallback((): NativePdfSelectionSnapshot | null => {
    const dragState = textSelectionDragPointRef.current?.token === pdfSelectionSessionRef.current.token
      ? textSelectionDragPointRef.current
      : null;
    const hasMeaningfulDrag = hasMeaningfulPdfSelectionDragPoints(dragState?.start, dragState?.end);
    const currentSelection = readCurrentNativePdfSelection() ?? (() => {
      if (!hasMeaningfulDrag || !dragState?.start || !dragState.end) {
        return null;
      }

      const dragPageElement =
        findPdfPageElementAtClientPoint(containerRef.current, dragState.start.x, dragState.start.y) ??
        findPdfPageElementAtClientPoint(containerRef.current, dragState.end.x, dragState.end.y);
      const dragRange = createCollapsedPdfPageRange(dragPageElement);
      return dragRange
        ? {
            text: "",
            range: dragRange,
            clientRects: [],
          }
        : null;
    })();
    if (!currentSelection || (currentSelection.clientRects.length === 0 && !hasMeaningfulDrag)) {
      return null;
    }

    const snapshot: NativePdfSelectionSnapshot = {
      text: currentSelection.text,
      range: currentSelection.range,
      clientRects: currentSelection.clientRects,
      dragStartPoint: dragState?.start ?? null,
      dragEndPoint: dragState?.end ?? null,
      capturedAt: Date.now(),
      token: pdfSelectionSessionRef.current.token,
    };

    nativePdfSelectionSnapshotRef.current = snapshot;

    const pendingSettle = pendingNativePdfSelectionSettleRef.current;
    if (
      pendingSettle &&
      pendingSettle.token === snapshot.token &&
      snapshot.capturedAt >= pendingSettle.pointerUpAt &&
      snapshot.capturedAt - pendingSettle.pointerUpAt <= DOM_SELECTION_SETTLE_WINDOW_MS &&
      !frozenNativePdfSelectionSnapshotRef.current
    ) {
      frozenNativePdfSelectionSnapshotRef.current = snapshot;
    }

    return snapshot;
  }, [readCurrentNativePdfSelection]);

  const freezeNativePdfSelectionSnapshot = useCallback((event?: PdfSelectionPointerEndEvent) => {
    if (activeTool === 'note' || activeTool === 'text' || activeTool === 'ink' || activeTool === 'eraser' || activeTool === 'area') {
      return;
    }
    if (isPdfAnnotationResizeHandleTarget(event?.target)) {
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

  useEffect(() => {
    const handleWindowPointerUp = (event: PointerEvent) => {
      const dragState = textSelectionDragPointRef.current;
      const container = containerRef.current;
      if (!dragState?.start || dragState.token !== pdfSelectionSessionRef.current.token || !container) {
        return;
      }

      const startedOnPage = findPdfPageElementAtClientPoint(container, dragState.start.x, dragState.start.y);
      const endedOnPage = findPdfPageElementAtClientPoint(container, event.clientX, event.clientY);
      const targetInsideViewer = event.target instanceof Node && container.contains(event.target);
      if (!startedOnPage && !endedOnPage && !targetInsideViewer) {
        return;
      }

      freezeNativePdfSelectionSnapshot({
        clientX: event.clientX,
        clientY: event.clientY,
        target: event.target,
      });
    };

    window.addEventListener("pointerup", handleWindowPointerUp, true);
    return () => window.removeEventListener("pointerup", handleWindowPointerUp, true);
  }, [freezeNativePdfSelectionSnapshot]);

  const getActivePdfSelectionText = useCallback(() => {
    const currentSession = pdfSelectionSessionRef.current;
    const activeSnapshot = (
      currentSession.phase === "frozen" ||
      currentSession.phase === "committed"
    )
      ? currentSession.snapshot
      : visiblePdfSelection;

    return resolvePdfCopySelectionText({
      frozenSnapshot: activeSnapshot,
      nativeText: activeSnapshot ? "" : readCurrentNativePdfSelection()?.text ?? "",
    });
  }, [readCurrentNativePdfSelection, visiblePdfSelection]);
  const diagnosticCopyPayload = useMemo(() => (
    getActivePdfSelectionText() || diagnosticSelectionResult?.text || ""
  ), [diagnosticSelectionResult?.text, getActivePdfSelectionText]);

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
    pointerGestureRef.current = null;
    suppressNextLinkClickRef.current = false;
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

  const commitTextMarkupSelection = useCallback((input: {
    snapshot: PdfSelectionSnapshot;
    token?: number;
    annotationId: string | null;
  }) => {
    transientSelectionDismissRef.current = null;
    committedSelectionAnnotationIdRef.current = input.annotationId;
    if (input.annotationId) {
      commitPdfSelectionSession(updatePdfSelectionSession(pdfSelectionSessionRef.current, {
        phase: "idle",
        snapshot: null,
        token: input.token,
      }));
      committedSelectionAnnotationIdRef.current = null;
      return;
    }

    commitPdfSelectionSession(updatePdfSelectionSession(pdfSelectionSessionRef.current, {
      phase: "committed",
      snapshot: input.snapshot,
      token: input.token,
    }));

    const timeoutId = window.setTimeout(() => {
      timeoutIdsRef.current = timeoutIdsRef.current.filter((id) => id !== timeoutId);
      const current = pdfSelectionSessionRef.current;
      if (
        current.phase === "committed" &&
        current.snapshot?.signature === input.snapshot.signature
      ) {
        commitPdfSelectionSession(updatePdfSelectionSession(current, {
          phase: "idle",
          snapshot: null,
        }));
        committedSelectionAnnotationIdRef.current = null;
      }
    }, input.annotationId ? 8000 : 1800);
    timeoutIdsRef.current.push(timeoutId);
  }, [commitPdfSelectionSession]);

  const buildSelectionDraftMenuPosition = useCallback((selection: PdfResolvedSelection): { position: { x: number; y: number }; anchorRect: DOMRect; avoidRect: DOMRect } | null => {
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
    const selectionLeft = Math.min(...pageRects.map((rect) => rect.left));
    const selectionTop = Math.min(...pageRects.map((rect) => rect.top));
    const selectionRight = Math.max(...pageRects.map((rect) => rect.left + rect.width));
    const selectionBottom = Math.max(...pageRects.map((rect) => rect.top + rect.height));
    const avoidRect = new DOMRect(
      pageRect.left + selectionLeft,
      pageRect.top + selectionTop,
      Math.max(1, selectionRight - selectionLeft),
      Math.max(1, selectionBottom - selectionTop),
    );

    return {
      position: {
        x: anchorRect.left,
        y: anchorRect.bottom + 4,
      },
      anchorRect,
      avoidRect,
    };
  }, []);

  const reconcileSelectionWithPdfTextKernel = useCallback((
    selection: PdfResolvedSelection,
    options?: { strictGeometry?: boolean },
  ): PdfResolvedSelection => {
    const pageElement = findPdfPageElementInScope(containerRef.current, selection.pageNumber);
    if (!pageElement) {
      return selection;
    }

    const model = buildRenderedPdfPageTextModel(pageElement);
    if (!model) {
      return selection;
    }

    const page = buildPdfTextKernelPage({ model });
    const hasImplausibleSelectionRects = selectionHasImplausiblePdfTextViewportRects({
      selection,
      pageWidth: page.viewportWidth,
      pageHeight: page.viewportHeight,
    });
    const filteredSelectionViewportRects = hasImplausibleSelectionRects
      ? filterImplausiblePdfTextViewportRects({
          viewportRects: selection.viewportRects,
          pageNumber: selection.pageNumber,
          pageWidth: page.viewportWidth,
          pageHeight: page.viewportHeight,
        })
      : selection.viewportRects;
    const plausibleSelectionPageRects = hasImplausibleSelectionRects
      ? selection.pageRects.filter(isPlausibleTextMarkupBox)
      : selection.pageRects;
    const baseSelection = hasImplausibleSelectionRects
      ? {
          ...selection,
          pageRects: plausibleSelectionPageRects,
          viewportRects: filteredSelectionViewportRects,
        }
      : selection;
    const geometrySelection = rebuildPdfSelectionViewportRectsFromPageRects(baseSelection, page);
    const safeGeometryFallbackRects = getSafePdfTextMarkupFallbackRects(
      geometrySelection.pageRects,
      geometrySelection.textQuote.exact || geometrySelection.text,
    );
    const safeGeometrySelection = safeGeometryFallbackRects.length !== geometrySelection.pageRects.length
      ? normalizePdfSelectionViewportRectsFromPageRects({
          ...geometrySelection,
          pageRects: safeGeometryFallbackRects,
        }, page.viewportWidth, page.viewportHeight)
      : geometrySelection;
    const pageRectViewportRects = pdfPageRectsToViewportRects({
      rects: safeGeometryFallbackRects.length > 0 ? safeGeometryFallbackRects : geometrySelection.pageRects,
      pageNumber: geometrySelection.pageNumber,
      page,
    });
    const constrainedViewportRects = (() => {
      const filteredGeometryViewportRects = hasImplausibleSelectionRects
        ? filterImplausiblePdfTextViewportRects({
            viewportRects: geometrySelection.viewportRects,
            pageNumber: geometrySelection.pageNumber,
            pageWidth: page.viewportWidth,
            pageHeight: page.viewportHeight,
          })
        : geometrySelection.viewportRects;
      if (pageRectViewportRects.length === 0) {
        return filteredGeometryViewportRects;
      }

      const pageTargetRects = pageRectViewportRects
        .map((rect) => ({
          left: rect.left,
          right: rect.left + rect.width,
        }));
      if (pageTargetRects.length === 0) {
        return filteredGeometryViewportRects;
      }

      const targetLeft = Math.min(...pageTargetRects.map((rect) => rect.left));
      const targetRight = Math.max(...pageTargetRects.map((rect) => rect.right));
      const tolerance = Math.max(8, page.viewportWidth * 0.025);
      const filtered = pageRectViewportRects.filter((rect) => {
        if (rect.pageNumber !== geometrySelection.pageNumber) {
          return true;
        }
        const rectLeft = rect.left;
        const rectRight = rect.left + rect.width;
        const rectCenterX = (rectLeft + rectRight) / 2;
        const overlap = Math.max(0, Math.min(rectRight, targetRight + tolerance) - Math.max(rectLeft, targetLeft - tolerance));
        const minWidth = Math.max(1, Math.min(rect.width, targetRight - targetLeft));
        return (
          rectCenterX >= targetLeft - tolerance &&
          rectCenterX <= targetRight + tolerance
        ) || overlap / minWidth >= 0.25;
      });

      return filtered.length > 0 ? filtered : pageRectViewportRects;
    })();
    const geometryCharSelection = buildPdfKernelSelectionFromViewportGeometry({
      selection: geometrySelection,
      model,
      page,
      viewportRects: constrainedViewportRects,
    });
    const selectionCompact = compactPdfKernelText(geometrySelection.textQuote.exact || geometrySelection.text);
    const geometryCharCompact = geometryCharSelection
      ? compactPdfKernelText(geometryCharSelection.textQuote.exact || geometryCharSelection.text)
      : "";
    const candidateExceedsStrictGeometry = (candidateText: string): boolean => {
      if (!options?.strictGeometry || !geometryCharCompact) {
        return false;
      }
      const candidateCompact = compactPdfKernelText(candidateText);
      if (!candidateCompact || candidateCompact === geometryCharCompact) {
        return false;
      }
      return candidateCompact.includes(geometryCharCompact) &&
        candidateCompact.length > geometryCharCompact.length + Math.max(6, Math.ceil(geometryCharCompact.length * 0.04));
    };
    const anchorMatchesSelectionText = (candidate: NonNullable<ReturnType<typeof buildPdfTextKernelAnchor>>): boolean => (
      !selectionCompact || compactPdfKernelText(candidate.text) === selectionCompact
    );
    const anchorIsSafeTextExpansion = (candidate: NonNullable<ReturnType<typeof buildPdfTextKernelAnchor>>): boolean => {
      const candidateCompact = compactPdfKernelText(candidate.text);
      if (!selectionCompact || !candidateCompact || candidateCompact === selectionCompact) {
        return true;
      }
      if (!candidateCompact.includes(selectionCompact)) {
        return false;
      }
      if (candidate.rects.length > Math.max(2, geometrySelection.pageRects.length + 1)) {
        return false;
      }
      const selectionMaxX2 = geometrySelection.pageRects.length > 0
        ? Math.max(...geometrySelection.pageRects.map((rect) => rect.x2))
        : 1;
      const candidateMaxX2 = candidate.rects.length > 0
        ? Math.max(...candidate.rects.map((rect) => rect.x2))
        : 1;
      return candidateMaxX2 <= Math.max(selectionMaxX2 + 0.04, 0.55);
    };
    let anchor = buildPdfTextKernelAnchor({
      page,
      model,
      startCharIndex: geometrySelection.startOffset,
      endCharIndex: geometrySelection.endOffset,
      fallbackRects: safeGeometryFallbackRects.length > 0 ? safeGeometryFallbackRects : undefined,
    });
    if (anchor && candidateExceedsStrictGeometry(anchor.text)) {
      return geometryCharSelection ?? safeGeometrySelection;
    }
    if (anchor && selectionCompact) {
      const anchorCompact = compactPdfKernelText(anchor.text);
      const anchorIsContaminatedSuperset = (
        anchorCompact.includes(selectionCompact) &&
        anchorCompact.length > selectionCompact.length + Math.max(8, Math.ceil(selectionCompact.length * 0.08))
      );
      if (anchorIsContaminatedSuperset) {
        const quoteOffsets = resolveNearestPdfKernelQuoteOffsets({
          model,
          page,
          quote: geometrySelection.textQuote.exact,
          viewportRects: constrainedViewportRects,
          requireGeometryMatch: true,
        });
        if (quoteOffsets) {
          const quoteAnchor = buildPdfTextKernelAnchor({
            page,
            model,
            startCharIndex: quoteOffsets.startOffset,
            endCharIndex: quoteOffsets.endOffset,
            fallbackRects: safeGeometryFallbackRects.length > 0 ? safeGeometryFallbackRects : undefined,
          });
          if (quoteAnchor && !candidateExceedsStrictGeometry(quoteAnchor.text)) {
            anchor = quoteAnchor;
          }
        }
        if (geometryCharSelection) {
          const geometryCharCompact = compactPdfKernelText(geometryCharSelection.textQuote.exact || geometryCharSelection.text);
          if (
            geometryCharCompact &&
            anchorCompact.includes(geometryCharCompact) &&
            anchorCompact.length > geometryCharCompact.length + Math.max(8, Math.ceil(geometryCharCompact.length * 0.08))
          ) {
            return geometryCharSelection;
          }
        }
        if (compactPdfKernelText(anchor.text).includes(selectionCompact) && compactPdfKernelText(anchor.text).length > selectionCompact.length + Math.max(8, Math.ceil(selectionCompact.length * 0.08))) {
          return geometryCharSelection ?? safeGeometrySelection;
        }
      }
    }
    const geometryOffsets = resolvePdfKernelOffsetsFromViewportGeometry({
      page,
      viewportRects: constrainedViewportRects,
    });
    if (anchor && geometryOffsets) {
      const anchorGeometry = scoreKernelQuoteGeometry({
        candidateRects: buildKernelViewportRectsForOffsets({
          page,
          startOffset: anchor.startCharIndex,
          endOffset: anchor.endCharIndex,
        }),
        referenceRects: getSelectionViewportReferenceRects({
          pageNumber: geometrySelection.pageNumber,
          viewportRects: constrainedViewportRects,
        }),
        page,
      });
      if (!anchorGeometry.acceptable) {
        anchor = buildPdfTextKernelAnchor({
          page,
          model,
          startCharIndex: geometryOffsets.startOffset,
          endCharIndex: geometryOffsets.endOffset,
          fallbackRects: safeGeometryFallbackRects.length > 0 ? safeGeometryFallbackRects : undefined,
        }) ?? anchor;
      }
    }
    if (
      anchor &&
      !anchorMatchesSelectionText(anchor)
    ) {
        const quoteOffsets = resolveNearestPdfKernelQuoteOffsets({
        model,
        page,
        quote: geometrySelection.textQuote.exact,
        viewportRects: constrainedViewportRects,
        requireGeometryMatch: true,
      });
      if (quoteOffsets) {
        const quoteAnchor = buildPdfTextKernelAnchor({
          page,
          model,
          startCharIndex: quoteOffsets.startOffset,
          endCharIndex: quoteOffsets.endOffset,
          fallbackRects: safeGeometryFallbackRects.length > 0 ? safeGeometryFallbackRects : undefined,
        });
        if (quoteAnchor && anchorMatchesSelectionText(quoteAnchor) && !candidateExceedsStrictGeometry(quoteAnchor.text)) {
          anchor = quoteAnchor;
        }
      } else if (geometryOffsets) {
        const geometryAnchor = buildPdfTextKernelAnchor({
          page,
          model,
          startCharIndex: geometryOffsets.startOffset,
          endCharIndex: geometryOffsets.endOffset,
          fallbackRects: safeGeometryFallbackRects.length > 0 ? safeGeometryFallbackRects : undefined,
        });
        if (geometryAnchor && anchorMatchesSelectionText(geometryAnchor) && !candidateExceedsStrictGeometry(geometryAnchor.text)) {
          anchor = geometryAnchor;
        }
      }
    }
    if (!anchor) {
      return geometryCharSelection ?? safeGeometrySelection;
    }
    if (candidateExceedsStrictGeometry(anchor.text)) {
      return geometryCharSelection ?? safeGeometrySelection;
    }
    if (shouldPreserveExistingPdfSelectionText({
      selection: geometrySelection,
      candidate: {
        text: anchor.text,
        quote: anchor.quote,
        rects: anchor.rects,
      },
    })) {
      return geometryCharSelection ?? safeGeometrySelection;
    }
    if (!anchorMatchesSelectionText(anchor) && !anchorIsSafeTextExpansion(anchor)) {
      return geometryCharSelection ?? safeGeometrySelection;
    }

    const resolvedAnchorRects = hasPdfTextMarkupRects(anchor.rects) ? anchor.rects : safeGeometryFallbackRects;
    const anchorViewportRects = pdfPageRectsToViewportRects({
      rects: resolvedAnchorRects,
      pageNumber: geometrySelection.pageNumber,
      page,
    });

    return {
      ...geometrySelection,
      startOffset: anchor.startCharIndex,
      endOffset: anchor.endCharIndex,
      text: anchor.text,
      textQuote: anchor.quote,
      pageRects: resolvedAnchorRects,
      viewportRects: anchorViewportRects,
      textKernelVersion: anchor.modelVersion,
      quads: resolvedAnchorRects.map(pdfPageRectToQuad),
      textSource: anchor.quote.source,
      textConfidence: anchor.confidence,
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
        (
          candidate.clientRects.length > 0 ||
          Boolean(candidate.dragStartPoint && candidate.dragEndPoint)
        ) &&
        (
          candidate.text.trim().length > 0 ||
          Boolean(candidate.dragStartPoint && candidate.dragEndPoint)
        )
      );
    });
    const frozenSelectionSnapshot = selectionSnapshotCandidates.find(
      (candidate) => candidate === frozenNativePdfSelectionSnapshotRef.current,
    ) ?? null;
    const selectionSnapshot = chooseNativePdfSelectionSnapshot({
      candidates: selectionSnapshotCandidates,
      frozenSnapshot: frozenSelectionSnapshot,
      currentSnapshot: currentSelectionSnapshot,
    });

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

    // Determine the page number from the selection range
    const startContainer = selectionSnapshot.range.startContainer;
    const pageElement = startContainer instanceof Element
      ? startContainer.closest<HTMLElement>("[data-page-number]")
      : startContainer.parentElement?.closest<HTMLElement>("[data-page-number]") ?? null;
    const selectionPageNumber = pageElement ? Number(pageElement.dataset.pageNumber ?? 0) : 0;
    const selectionTextLayerSource = pageElement?.dataset.pdfTextLayerSource
      ?? pageElement?.querySelector<HTMLElement>(".textLayer")?.dataset.pdfTextLayerSource
      ?? "unknown";
    const emptyTextLayer = selectionTextLayerSource === "empty";
    const lowConfidenceTextLayer = emptyTextLayer || selectionTextLayerSource === "low-text";

    // Get native layout for desktop PDF text extraction (only when on desktop and valid page)
    const nativeLayout = (
      Number.isInteger(selectionPageNumber) &&
      selectionPageNumber > 0 &&
      desktopPdfPath
    ) ? peekDesktopPdfPageTextLayout({
      fileHandle,
      pageNumber: selectionPageNumber,
    }) : null;
    const ocrLayoutAvailable = Boolean((
      Number.isInteger(selectionPageNumber) &&
      selectionPageNumber > 0 &&
      lowConfidenceTextLayer
    ) ? peekDesktopPdfOcrPageTextLayout({
      fileHandle,
      pageNumber: selectionPageNumber,
      options: {
        language: "eng+chi_sim",
        psm: 6,
      },
    }) : null);
    if (emptyTextLayer && !nativeLayout) {
      logger.warn("[PDF] Text selection skipped on low-text page until native/OCR text is available:", {
        pageNumber: selectionPageNumber,
        textLayerSource: selectionTextLayerSource,
        ocrLayoutAvailable,
      });
      options?.hideTipAndSelection?.();
      clearTransientSelection({ nextPhase: 'cancelled' });
      return null;
    }

    const frozenSessionSnapshot = pdfSelectionSessionRef.current.phase === 'frozen'
      ? pdfSelectionSessionRef.current.snapshot
      : null;
    const clientRectLeft = selectionSnapshot.clientRects.length > 0
      ? Math.min(...selectionSnapshot.clientRects.map((rect) => rect.left))
      : 0;
    const clientRectRight = selectionSnapshot.clientRects.length > 0
      ? Math.max(...selectionSnapshot.clientRects.map((rect) => rect.right))
      : 0;
    const pageRect = pageElement?.getBoundingClientRect();
    const selectionSpansWidePageRegion = Boolean(
      pageRect &&
      selectionSnapshot.clientRects.length > 1 &&
      clientRectLeft < pageRect.left + (pageRect.width * 0.45) &&
      clientRectRight > pageRect.left + (pageRect.width * 0.55),
    );
    const selectionHasMeaningfulDrag = Boolean(
      selectionSnapshot.dragStartPoint &&
      selectionSnapshot.dragEndPoint &&
      Math.hypot(
        selectionSnapshot.dragEndPoint.x - selectionSnapshot.dragStartPoint.x,
        selectionSnapshot.dragEndPoint.y - selectionSnapshot.dragStartPoint.y,
      ) >= 3,
    );
    const rawSelectionReferenceText =
      frozenSessionSnapshot?.textQuote?.exact?.trim() ||
      frozenSessionSnapshot?.text?.trim() ||
      selectionSnapshot.text;
    const selectionHasExplicitRects = selectionSnapshot.clientRects.length > 0;
    const nativeSelectionTextLooksSuspicious = selectionHasExplicitRects &&
      isSuspiciousPdfNativeSelectionText(rawSelectionReferenceText);
    const shouldTrustGeometryOverNativeText = Boolean(
      selectionHasMeaningfulDrag ||
      nativeSelectionTextLooksSuspicious
    );
    const resolvedClientRects = (() => {
      if (
        !shouldTrustGeometryOverNativeText ||
        !pageRect ||
        !selectionSnapshot.dragStartPoint ||
        selectionSnapshot.clientRects.length <= 1
      ) {
        return selectionSnapshot.clientRects;
      }

      const pageMidX = pageRect.left + (pageRect.width / 2);
      const gutterTolerance = Math.max(12, pageRect.width * 0.025);
      const hasSingleColumnWideLineRect = selectionSnapshot.clientRects.some((rect) => (
        rect.left < pageMidX - gutterTolerance &&
        rect.right > pageMidX + gutterTolerance &&
        (rect.right - rect.left) >= pageRect.width * 0.42
      ));
      if (selectionSpansWidePageRegion && hasSingleColumnWideLineRect) {
        return selectionSnapshot.clientRects;
      }

      const dragStartsLeftColumn = selectionSnapshot.dragStartPoint.x < pageMidX;
      const dragTop = Math.min(selectionSnapshot.dragStartPoint.y, selectionSnapshot.dragEndPoint?.y ?? selectionSnapshot.dragStartPoint.y);
      const dragBottom = Math.max(selectionSnapshot.dragStartPoint.y, selectionSnapshot.dragEndPoint?.y ?? selectionSnapshot.dragStartPoint.y);
      const verticalTolerance = Math.max(8, pageRect.height * 0.01);
      const filtered = selectionSnapshot.clientRects.filter((rect) => {
        const rectCenterX = (rect.left + rect.right) / 2;
        const rectCenterY = (rect.top + rect.bottom) / 2;
        const inDragColumn = dragStartsLeftColumn ? rectCenterX < pageMidX : rectCenterX >= pageMidX;
        const inDragRows = (
          rectCenterY >= dragTop - verticalTolerance &&
          rectCenterY <= dragBottom + verticalTolerance
        );
        return inDragColumn && inDragRows;
      });

      return filtered.length > 0 ? filtered : selectionSnapshot.clientRects;
    })();
    const selectionReferenceText = shouldTrustGeometryOverNativeText ? "" : rawSelectionReferenceText;
    const selectionTrimReferenceText = !shouldTrustGeometryOverNativeText && isPdfSelectionReferenceTextTrustworthy(rawSelectionReferenceText)
      ? rawSelectionReferenceText
      : "";

    const resolvedSelectionResult = resolvePdfSelectionFromNativeRange({
      range: selectionSnapshot.range,
      text: selectionReferenceText,
      pages: renderedPages,
      clientRects: resolvedClientRects,
      dragStartPoint: selectionSnapshot.dragStartPoint ?? undefined,
      dragEndPoint: selectionSnapshot.dragEndPoint ?? undefined,
      nativeLayout,
      ignoreDomText: shouldTrustGeometryOverNativeText,
    });

    if (!resolvedSelectionResult.ok) {
      logger.warn("[PDF] Selection resolution skipped:", resolvedSelectionResult.reason);
      options?.hideTipAndSelection?.();
      clearTransientSelection({ nextPhase: 'cancelled' });
      return null;
    }

    const reconciledBaseSelection = reconcileSelectionWithPdfTextKernel(resolvedSelectionResult.selection, {
      strictGeometry: shouldTrustGeometryOverNativeText || selectionHasMeaningfulDrag,
    });
    const trimPageElement = findPdfPageElementInScope(containerRef.current, reconciledBaseSelection.pageNumber) ?? pageElement;
    const trimModel = trimPageElement ? buildRenderedPdfPageTextModel(trimPageElement) : null;
    const reconciledSelection = trimPdfSelectionToReferenceText(
      reconciledBaseSelection,
      selectionTrimReferenceText,
      trimModel,
    );
    if (
      selectionTrimReferenceText &&
      isPdfSelectionExpandedBeyondReference({
        selection: reconciledSelection,
        referenceText: selectionTrimReferenceText,
      })
    ) {
      logger.warn("[PDF] Selection resolution rejected because it expanded beyond the user's selected text:", {
        pageNumber: reconciledSelection.pageNumber,
        selectionLength: compactPdfKernelText(normalizePdfReadableReferenceText(reconciledSelection.textQuote.exact || reconciledSelection.text)).length,
        referenceLength: compactPdfKernelText(normalizePdfReadableReferenceText(selectionTrimReferenceText)).length,
      });
      options?.hideTipAndSelection?.();
      clearTransientSelection({ nextPhase: 'cancelled' });
      return null;
    }
    const normalizedSelection = normalizePdfResolvedSelectionViewportGeometry(
      reconciledSelection,
      findPdfPageElementInScope(containerRef.current, reconciledSelection.pageNumber) ?? pageElement,
    );
    const normalizedTool = activeTool === 'underline'
      ? 'underline'
      : activeTool === 'highlight'
        ? 'highlight'
        : 'select';
    const signature = buildPdfSelectionSignature({
      tool: normalizedTool,
      selection: normalizedSelection,
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
      selection: normalizedSelection,
      signature,
    });

    if (activeTool === 'highlight' || activeTool === 'underline') {
      const styleType = activeTool === 'underline' ? 'underline' : 'highlight';
      handledPdfSelectionTokenRef.current = selectionToken;
      const persistencePageElement = findPdfPageElementInScope(containerRef.current, normalizedSelection.pageNumber) ?? pageElement;
      const persistenceModel = persistencePageElement
        ? buildRenderedPdfPageTextModel(persistencePageElement)
        : null;
      const annotationData = resolvedTextSelectionToAnnotationData({
        selection: normalizedSelection,
        color: activeColor,
        author: 'user',
        styleType,
        underlineStyle: activeUnderlineStyle,
        model: persistenceModel,
      });
      const annotationId = addAnnotation(annotationData);
      commitTextMarkupSelection({
        snapshot: nextSnapshot,
        token: selectionToken,
        annotationId,
      });
      clearNativePdfSelectionLater();
      options?.hideTipAndSelection?.();
      return normalizedSelection;
    }

    handledPdfSelectionTokenRef.current = selectionToken;
    activateTransientSelection(nextSnapshot);
    const menuPlacement = buildSelectionDraftMenuPosition(normalizedSelection);
    if (menuPlacement) {
      setPendingSelectionDraft({
        selection: normalizedSelection,
        position: menuPlacement.position,
        anchorRect: menuPlacement.anchorRect,
        avoidRect: menuPlacement.avoidRect,
        token: selectionToken,
      });
    } else {
      setPendingSelectionDraft(null);
    }
    clearNativePdfSelectionLater(2);
    options?.hideTipAndSelection?.();
    return normalizedSelection;
  }, [
    activeColor,
    activeTool,
    activeUnderlineStyle,
    activateTransientSelection,
    addAnnotation,
    buildSelectionDraftMenuPosition,
    captureNativePdfSelectionSnapshot,
    clearNativePdfSelectionLater,
    clearTransientSelection,
    commitPdfSelectionSession,
    commitTextMarkupSelection,
    desktopPdfPath,
    fileHandle,
    reconcileSelectionWithPdfTextKernel,
  ]);

  useEffect(() => {
    finalizePdfSelectionFromSnapshotRef.current = finalizePdfSelectionFromSnapshot;
  }, [finalizePdfSelectionFromSnapshot]);

  const getDiagnosticTextLayerCandidates = useCallback((): HTMLElement[] => {
    const selector = ".textLayer[data-pdf-text-layer-ready='true']";
    const shellTestId = paneId === "pdf-left-pane"
      ? "pdf-left-shell"
      : paneId === "pdf-right-pane"
        ? "pdf-right-shell"
        : null;
    const candidates = [
      ...Array.from(viewerContainerRef.current?.querySelectorAll<HTMLElement>(selector) ?? []),
      ...Array.from(containerRef.current?.querySelectorAll<HTMLElement>(selector) ?? []),
      ...(shellTestId
        ? Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${shellTestId}"] ${selector}`))
        : []),
      ...Array.from(document.querySelectorAll<HTMLElement>(selector)),
    ];

    return candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
  }, [paneId]);

  const buildDiagnosticSelectionFromModel = useCallback((
    model: PdfPageTextModel,
    targetPhrase: string,
  ): PdfResolvedSelection | null => {
    const offsets = resolvePdfExactQuoteOffsets({
      model,
      exact: targetPhrase,
    });
    if (!offsets) {
      return null;
    }

    const kernelPage = buildPdfTextKernelPage({ model });
    const kernelAnchor = buildPdfTextKernelAnchor({
      page: kernelPage,
      model,
      startCharIndex: offsets.startOffset,
      endCharIndex: offsets.endOffset,
    });
    const textAnchor = kernelAnchor
      ? null
      : buildPdfTextAnchorFromOffsets({
          model,
          startOffset: offsets.startOffset,
          endOffset: offsets.endOffset,
          source: "pdfjs-text-model",
        });
    if (!kernelAnchor && !textAnchor) {
      return null;
    }

    const pageRects = kernelAnchor?.rects ?? textAnchor?.rects ?? [];
    const startOffset = kernelAnchor?.startCharIndex ?? textAnchor?.startOffset ?? offsets.startOffset;
    const endOffset = kernelAnchor?.endCharIndex ?? textAnchor?.endOffset ?? offsets.endOffset;
    const textQuote = kernelAnchor?.quote ?? textAnchor?.textQuote;
    const text = kernelAnchor?.text ?? textAnchor?.pageText.slice(startOffset, endOffset) ?? targetPhrase;
    if (!textQuote || pageRects.length === 0) {
      return null;
    }

    return {
      pageNumber: model.pageNumber,
      text,
      textQuote,
      pageRects,
      textKernelVersion: kernelAnchor?.modelVersion,
      quads: kernelAnchor?.quads,
      textSource: textQuote.source,
      textConfidence: kernelAnchor?.confidence ?? 1,
      viewportRects: pageRects.map((rect) => ({
        pageNumber: model.pageNumber,
        left: rect.x1 * model.viewportWidth,
        top: rect.y1 * model.viewportHeight,
        width: Math.max(0, (rect.x2 - rect.x1) * model.viewportWidth),
        height: Math.max(0, (rect.y2 - rect.y1) * model.viewportHeight),
      })).filter((rect) => rect.width > 0 && rect.height > 0),
      startOffset,
      endOffset,
    };
  }, []);

  const commitDiagnosticSelectionResult = useCallback((input: {
    mode: "copy" | "highlight";
    selection: PdfResolvedSelection;
  }): PdfDiagnosticSelectionResult => {
    const diagnosticPageElement = findPdfPageElementInScope(containerRef.current, input.selection.pageNumber);
    const normalizedSelection = normalizePdfResolvedSelectionViewportGeometry(input.selection, diagnosticPageElement);
    const snapshot = createPdfSelectionSnapshot({
      selection: normalizedSelection,
      signature: `diagnostic:${input.mode}:${normalizedSelection.pageNumber}:${normalizedSelection.startOffset}:${normalizedSelection.endOffset}`,
    });
    activateTransientSelection(snapshot);
    const diagnosticModel = diagnosticPageElement
      ? buildRenderedPdfPageTextModel(diagnosticPageElement)
      : null;
    const annotationId = input.mode === "highlight"
      ? addAnnotation(resolvedTextSelectionToAnnotationData({
          selection: normalizedSelection,
          color: activeColor,
          author: "diagnostics",
          styleType: "highlight",
          model: selectionAlreadyHasPreciseTextMarkupGeometry(normalizedSelection) ||
            selectionAlreadyHasMultiLineTextMarkupGeometry(normalizedSelection)
            ? null
            : diagnosticModel,
        }))
      : null;
    const result = {
      ok: true,
      text: normalizedSelection.text,
      source: normalizedSelection.textQuote.source,
      annotationCount: annotations.length + (annotationId ? 1 : 0),
      rectCount: normalizedSelection.pageRects.length,
      rectMinX1: normalizedSelection.pageRects.length > 0
        ? Math.min(...normalizedSelection.pageRects.map((rect) => rect.x1))
        : -1,
      rectMaxX2: normalizedSelection.pageRects.length > 0
        ? Math.max(...normalizedSelection.pageRects.map((rect) => rect.x2))
        : -1,
      annotationId,
    };
    setDiagnosticSelectionResult(result);
    if (input.mode === "highlight") {
      commitTextMarkupSelection({ snapshot, annotationId });
    }
    return result;
  }, [
    activateTransientSelection,
    activeColor,
    addAnnotation,
    annotations.length,
    commitTextMarkupSelection,
  ]);

  const createDiagnosticTextMarkupOnPage = useCallback(async (
    pageNumber: number,
    exact: string,
    styleType: "highlight" | "underline" = "highlight",
    color: string = activeColor,
  ): Promise<PdfDiagnosticSelectionResult | false> => {
    if (!pdfDocument || !Number.isInteger(pageNumber) || pageNumber <= 0 || !exact.trim()) {
      return false;
    }

    try {
      const model = await getPdfPageTextModel(pdfDocument, pageNumber);
      const annotationData = buildCanonicalPdfTextMarkupAnnotationFromExact({
        model,
        exact,
        page: pageNumber,
        styleType,
        color: resolveHighlightColor(color),
        author: "diagnostics",
        underlineStyle: styleType === "underline" ? activeUnderlineStyle : undefined,
      });
      if (!annotationData || annotationData.target.type !== "pdf") {
        const result = {
          ok: false,
          text: model.normalizedText.slice(0, 160),
          source: model.normalizedText.includes(normalizePdfText(exact)) ? "missing-programmatic-anchor" : "missing-programmatic-target",
          annotationCount: annotations.length,
          rectCount: 0,
          rectMinX1: -1,
          rectMaxX2: -1,
          annotationId: null,
        };
        setDiagnosticSelectionResult(result);
        return result;
      }

      const annotationId = addAnnotation(annotationData);
      const target = annotationData.target;
      const rects = target.rects;
      const result = {
        ok: true,
        text: target.textQuote?.exact ?? annotationData.content ?? exact,
        source: target.textSource ?? target.textQuote?.source ?? "pdfjs-text-model",
        annotationCount: annotations.length + (annotationId ? 1 : 0),
        rectCount: rects.length,
        rectMinX1: rects.length > 0 ? Math.min(...rects.map((rect) => rect.x1)) : -1,
        rectMaxX2: rects.length > 0 ? Math.max(...rects.map((rect) => rect.x2)) : -1,
        annotationId,
      };
      setDiagnosticSelectionResult(result);
      return result;
    } catch (error) {
      logger.warn("[pdf] Programmatic PDF text-markup creation failed", {
        paneId,
        pageNumber,
        exact,
        error,
      });
      const result = {
        ok: false,
        text: "",
        source: "programmatic-create-error",
        annotationCount: annotations.length,
        rectCount: 0,
        rectMinX1: -1,
        rectMaxX2: -1,
        annotationId: null,
      };
      setDiagnosticSelectionResult(result);
      return result;
    }
  }, [
    activeColor,
    activeUnderlineStyle,
    addAnnotation,
    annotations.length,
    paneId,
    pdfDocument,
  ]);

  const runDiagnosticPdfSelection = useCallback(async (mode: "copy" | "highlight", pageNumberOverride?: number, targetPhraseOverride?: string) => {
    const diagnosticParams = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
    const targetPhrase = targetPhraseOverride?.trim() ||
      diagnosticParams.get("diagnosticSelectionTarget")?.trim() ||
      "Rydberg states are extremely sensitive";
    const normalizedTargetPhrase = normalizePdfText(targetPhrase);
    const targetPageNumber = pageNumberOverride ?? Number(diagnosticParams.get("diagnosticSelectionPage") ?? "");
    if (pdfDocument && Number.isInteger(targetPageNumber) && targetPageNumber > 0) {
      try {
        const model = await getPdfPageTextModel(pdfDocument, targetPageNumber);
        const resolvedSelection = buildDiagnosticSelectionFromModel(model, targetPhrase);
        if (resolvedSelection) {
          return commitDiagnosticSelectionResult({
            mode,
            selection: resolvedSelection,
          });
        }
      } catch (error) {
        logger.warn("[pdf] Diagnostic PDF.js page model selection failed", {
          paneId,
          pageNumber: targetPageNumber,
          error,
        });
      }
    }
    const viewerRootCandidates = [
      viewerContainerRef.current,
      ...Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="pdf-viewer-container-${paneId}"]`)),
      containerRef.current,
    ].filter((root, index, roots): root is HTMLElement => (
      root instanceof HTMLElement && roots.indexOf(root) === index
    ));
    const diagnosticRoot =
      viewerRootCandidates.find((root) => normalizePdfText(root.textContent).includes(normalizedTargetPhrase)) ??
      viewerRootCandidates[0] ??
      null;
    const rootTextLayerCandidates = Array.from(
      diagnosticRoot?.querySelectorAll<HTMLElement>(".textLayer[data-pdf-text-layer-ready='true']") ?? []
    );
    const allGlobalTextLayerCandidates = getDiagnosticTextLayerCandidates();
    const globalTextLayerCandidates = allGlobalTextLayerCandidates.filter((textLayer) => (
      textLayer.closest<HTMLElement>(`[data-testid="pdf-pane-${paneId}"]`) !== null
    ));
    const textLayerCandidates = rootTextLayerCandidates.length > 0
      ? rootTextLayerCandidates
      : globalTextLayerCandidates.length > 0
        ? globalTextLayerCandidates
        : allGlobalTextLayerCandidates;
    const pageCandidates = textLayerCandidates
      .map((textLayer) => {
        const page = textLayer.closest<HTMLElement>("[data-page-number]");
        return page && getPdfPageNumberFromElement(page) !== null ? page : null;
      })
      .filter((page): page is HTMLElement => page instanceof HTMLElement);
    const getPageLayerText = (page: HTMLElement | null): string => (
      normalizePdfText(page?.querySelector<HTMLElement>(".textLayer")?.textContent)
    );
    const pageElement =
      (Number.isInteger(targetPageNumber) && targetPageNumber > 0
        ? pageCandidates.find((page) => page.dataset.pageNumber === String(targetPageNumber) && getPageLayerText(page).includes(normalizedTargetPhrase))
        : null) ??
      pageCandidates.find((page) => getPageLayerText(page).includes(normalizedTargetPhrase)) ??
      pageCandidates[0] ??
      null;
    const model = pageElement ? buildRenderedPdfPageTextModel(pageElement) : null;
    if (!model) {
      const result = {
        ok: false,
        text: "",
        source: `missing-text-model:${textLayerCandidates.length}:${pageCandidates.length}:${getPageLayerText(pageElement).slice(0, 80)}`,
        annotationCount: annotations.length,
        rectCount: 0,
        rectMinX1: -1,
        rectMaxX2: -1,
      };
      setDiagnosticSelectionResult(result);
      return result;
    }

    const resolvedSelection = buildDiagnosticSelectionFromModel(model, targetPhrase);
    if (!resolvedSelection) {
      const result = {
        ok: false,
        text: model.normalizedText.slice(0, 160),
        source: model.normalizedText.includes(normalizedTargetPhrase) ? "missing-anchor" : "missing-target-phrase",
        annotationCount: annotations.length,
        rectCount: 0,
        rectMinX1: -1,
        rectMaxX2: -1,
      };
      setDiagnosticSelectionResult(result);
      return result;
    }

    return commitDiagnosticSelectionResult({
      mode,
      selection: resolvedSelection,
    });
  }, [
    annotations.length,
    buildDiagnosticSelectionFromModel,
    commitDiagnosticSelectionResult,
    getDiagnosticTextLayerCandidates,
    paneId,
    pdfDocument,
  ]);

  const isProductSmokeBridgeEnabled = typeof window !== "undefined" &&
    window.localStorage?.getItem("lattice-pdf-product-smoke-bridge") === "1";

  const scheduleDiagnosticPdfSelection = useCallback((mode: "copy" | "highlight"): Promise<PdfDiagnosticSelectionResult | false> | false => {
    if (!isDiagnosticsMode && !isProductSmokeBridgeEnabled) {
      return false;
    }

    return runDiagnosticPdfSelection(mode);
  }, [isDiagnosticsMode, isProductSmokeBridgeEnabled, runDiagnosticPdfSelection]);

  const scheduleDiagnosticPdfSelectionOnPage = useCallback((pageNumber: number, mode: "copy" | "highlight", targetPhrase?: string): Promise<PdfDiagnosticSelectionResult | false> | false => {
    if ((!isDiagnosticsMode && !isProductSmokeBridgeEnabled) || !Number.isInteger(pageNumber) || pageNumber <= 0) {
      return false;
    }

    return runDiagnosticPdfSelection(mode, pageNumber, targetPhrase);
  }, [isDiagnosticsMode, isProductSmokeBridgeEnabled, runDiagnosticPdfSelection]);

  const scheduleDiagnosticTextMarkupOnPage = useCallback((
    pageNumber: number,
    exact: string,
    styleType: "highlight" | "underline" = "highlight",
    color?: string,
  ): Promise<PdfDiagnosticSelectionResult | false> | false => {
    if ((!isDiagnosticsMode && !isProductSmokeBridgeEnabled) || !Number.isInteger(pageNumber) || pageNumber <= 0) {
      return false;
    }

    return createDiagnosticTextMarkupOnPage(pageNumber, exact, styleType, color);
  }, [createDiagnosticTextMarkupOnPage, isDiagnosticsMode, isProductSmokeBridgeEnabled]);

  const hasDiagnosticTextLayer = useCallback((): boolean => {
    return getDiagnosticTextLayerCandidates().length > 0;
  }, [getDiagnosticTextLayerCandidates]);

  useEffect(() => {
    if (!isDiagnosticsMode && !isProductSmokeBridgeEnabled) {
      return;
    }

    const diagnosticsWindow = window as Window & {
      __latticePdfDiagnostics?: Record<string, PdfDiagnosticsBridge>;
    };
    const registry = diagnosticsWindow.__latticePdfDiagnostics ?? {};
    diagnosticsWindow.__latticePdfDiagnostics = registry;
    const nextBridge: PdfDiagnosticsBridge = {
      runSelection: scheduleDiagnosticPdfSelection,
      runSelectionOnPage: scheduleDiagnosticPdfSelectionOnPage,
      createTextMarkupOnPage: scheduleDiagnosticTextMarkupOnPage,
      hasTextLayer: hasDiagnosticTextLayer,
      scrollToPage: (pageNumber: number) => diagnosticScrollToPageRef.current?.(pageNumber) === true,
    };
    const currentBridge = registry[paneId];
    if (!currentBridge || !currentBridge.hasTextLayer() || nextBridge.hasTextLayer()) {
      registry[paneId] = nextBridge;
    }

    return () => {
      if (diagnosticsWindow.__latticePdfDiagnostics?.[paneId]?.runSelection === scheduleDiagnosticPdfSelection) {
        delete diagnosticsWindow.__latticePdfDiagnostics[paneId];
      }
    };
  }, [
    hasDiagnosticTextLayer,
    isDiagnosticsMode,
    isProductSmokeBridgeEnabled,
    paneId,
    scheduleDiagnosticPdfSelection,
    scheduleDiagnosticPdfSelectionOnPage,
    scheduleDiagnosticTextMarkupOnPage,
  ]);

  const beginNativePdfSelectionInteraction = useCallback((event?: PdfSelectionPointerEvent) => {
    if (activeTool === 'note' || activeTool === 'text' || activeTool === 'ink' || activeTool === 'eraser' || activeTool === 'area') {
      return;
    }
    if (isPdfAnnotationResizeHandleTarget(event?.target)) {
      return;
    }
    if (event) {
      pointerGestureRef.current = {
        pointerId: event.pointerId ?? 0,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      suppressNextLinkClickRef.current = false;
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

  const updateNativePdfSelectionDragPoint = useCallback((event?: PdfSelectionPointerEvent) => {
    if (!event || !textSelectionDragPointRef.current) {
      return;
    }
    if (isPdfAnnotationResizeHandleTarget(event.target)) {
      return;
    }
    const pointerGesture = pointerGestureRef.current;
    if (pointerGesture && pointerGesture.pointerId === (event.pointerId ?? 0)) {
      const dragDistance = Math.hypot(
        event.clientX - pointerGesture.startX,
        event.clientY - pointerGesture.startY,
      );
      if (dragDistance >= 4 && !pointerGesture.moved) {
        pointerGestureRef.current = {
          ...pointerGesture,
          moved: true,
        };
        suppressNextLinkClickRef.current = true;
      }
    }
    const token = pdfSelectionSessionRef.current.token;
    if (textSelectionDragPointRef.current.token !== token) {
      return;
    }
    textSelectionDragPointRef.current = {
      ...textSelectionDragPointRef.current,
      end: { x: event.clientX, y: event.clientY },
    };
  }, []);

  const handlePdfSurfaceClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() <= suppressPdfSurfaceClickUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressPdfSurfaceClickUntilRef.current = 0;
      return;
    }
    if (!suppressNextLinkClickRef.current) {
      return;
    }
    if (isPdfLinkAnnotationTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
    }
    suppressNextLinkClickRef.current = false;
  }, []);

  const handlePdfSurfaceDragStartCapture = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!suppressNextLinkClickRef.current) {
      return;
    }
    if (isPdfLinkAnnotationTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  useEffect(() => {
    const handleSelectionChange = () => {
      if (annotationAdjustmentDraft) {
        return;
      }
      captureNativePdfSelectionSnapshot();
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [annotationAdjustmentDraft, captureNativePdfSelectionSnapshot]);

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

    const currentFileHandle = fileHandle;
    const fileKey = desktopPdfPath;
    getRenderedPdfPages().forEach((pageElement) => {
      const pageNumber = Number(pageElement.dataset.pageNumber ?? "");
      if (Number.isInteger(pageNumber) && pageNumber > 0) {
        const nativeKey = `${fileKey}:native:${pageNumber}`;
        if (!nativeLayoutPrefetchKeysRef.current.has(nativeKey)) {
          nativeLayoutPrefetchKeysRef.current.add(nativeKey);
          prefetchDesktopPdfPageTextLayout({
            fileHandle: currentFileHandle,
            pageNumber,
          });
        }
        const textLayerSource = pageElement.dataset.pdfTextLayerSource
          ?? pageElement.querySelector<HTMLElement>(".textLayer")?.dataset.pdfTextLayerSource;
        if (textLayerSource === "empty" || textLayerSource === "low-text") {
          const ocrKey = `${fileKey}:ocr:${pageNumber}`;
          if (!nativeLayoutPrefetchKeysRef.current.has(ocrKey)) {
            nativeLayoutPrefetchKeysRef.current.add(ocrKey);
            prefetchDesktopPdfOcrPageTextLayout({
              fileHandle: currentFileHandle,
              pageNumber,
              options: {
                language: "eng+chi_sim",
                psm: 6,
              },
            });
          }
        }
      }
    });
  }, [desktopPdfPath, fileHandle, getRenderedPdfPages]);

  useEffect(() => {
    if (!desktopPdfPath || !containerRef.current) {
      return;
    }

    nativeLayoutPrefetchKeysRef.current.clear();
    prefetchNativeLayoutsForRenderedPages();
    const schedulePrefetch = () => {
      if (nativeLayoutPrefetchFrameRef.current !== null) {
        return;
      }
      nativeLayoutPrefetchFrameRef.current = window.requestAnimationFrame(() => {
        nativeLayoutPrefetchFrameRef.current = null;
        prefetchNativeLayoutsForRenderedPages();
      });
    };
    const observer = new MutationObserver(() => {
      schedulePrefetch();
    });

    observer.observe(containerRef.current, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      if (nativeLayoutPrefetchFrameRef.current !== null) {
        window.cancelAnimationFrame(nativeLayoutPrefetchFrameRef.current);
        nativeLayoutPrefetchFrameRef.current = null;
      }
    };
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
    let completed = false;

    const commitFallback = () => {
      if (completed) {
        return;
      }
      completed = true;
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
      if (completed) {
        return;
      }
      attemptsLeft -= 1;
      const pageElement = containerRef.current?.querySelector<HTMLElement>(`[data-page-number="${targetAnchor.pageNumber}"]`);
      if (!pageElement) {
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
        if (completed) {
          return;
        }
        const actualAnchor = captureCurrentPdfAnchor(targetAnchor.captureRevision);
        const comparison = compareAnchorPair(targetAnchor, actualAnchor);
        updateCurrentAnchorDebug(actualAnchor);

        if (comparison.ok || attemptsLeft <= 1) {
          if (!comparison.ok && (input.fallbackScrollState || typeof input.fallbackScrollTop === 'number' || typeof input.fallbackScrollLeft === 'number')) {
            commitFallback();
            return;
          }

          completed = true;
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

        frameId = window.requestAnimationFrame(restore);
      });
    };

    frameId = window.requestAnimationFrame(() => {
      frameId = window.requestAnimationFrame(restore);
    });

    return () => {
      completed = true;
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

  useLayoutEffect(() => {
    hasRestoredScrollRef.current = false;
    lastPersistSignatureRef.current = null;
    if (lastPersistedEditorStateRef.current?.fileId !== fileId) {
      lastPersistedEditorStateRef.current = null;
    }
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
    setPdfLoadStage("idle");
    setPdfLoadError(null);
    setPdfSourceError(null);
    setPdfLoadProgress("");
    setPdfResetCount((count) => count + 1);
    setPdfDocument(null);
    setNumPages(0);
    setScale(cachedPdfViewState?.scale ?? 1.2);
    setZoomMode(cachedPdfViewState?.zoomMode ?? "fit-width");
    setShowSidebar(cachedPdfViewState?.showSidebar ?? false);
    setSidebarSize(cachedPdfViewState?.sidebarSize ?? 28);
    setPdfSidebarViewState(cachedPdfViewState?.sidebarState ?? DEFAULT_PDF_ANNOTATION_SIDEBAR_VIEW_STATE);
    const nextToolbarState = cachedPdfViewState?.toolbarState ?? DEFAULT_PDF_ANNOTATION_TOOLBAR_VIEW_STATE;
    setActiveTool(nextToolbarState.activeTool as AnnotationTool);
    setActiveColor(resolveHighlightColor(nextToolbarState.activeColor));
    setActiveUnderlineStyle(nextToolbarState.activeUnderlineStyle as UnderlineStyleType);
    setActiveEraserMode(nextToolbarState.activeEraserMode as PdfInkEraserMode);
    setActiveEraserSize(nextToolbarState.activeEraserSize ?? DEFAULT_PDF_INK_ERASER_SIZE);
    setSearchOpen(nextToolbarState.searchOpen);
    setFitScale(cachedPdfViewState?.scale ?? 1.2);
    setPageDimensions(new Map());
    setVisiblePages(new Set(initialVisiblePdfPageSet));
    setDiagnosticPinnedPages(new Set());
    setPendingPin(null);
    setHighlightedId(null);
    setHoveredAnnotationId(null);
    setSelectedAnnotationId(null);
    setAnnotationMenuState(null);
    transientSelectionDismissRef.current = null;
    setPdfSelectionSession(createIdlePdfSelectionSession());
    clearScheduledPersist();
  }, [
    cachedPdfViewState,
    clearScheduledPersist,
    fileId,
    initialVisiblePdfPageSet,
    updateCurrentAnchorDebug,
    updateRestoreDebugState,
  ]);

  useEffect(() => {
    const viewerContainer = viewerContainerRef.current;
    if (!viewerContainer) {
      setPageObserver(null);
      return;
    }

    setVisiblePages((previous) => {
      const next = new Set<number>(isDiagnosticsMode && !isJsdomRuntime ? [1] : [1, 2, 3]);
      previous.forEach((pageNumber) => {
        if (pageNumber > 0) {
          next.add(pageNumber);
        }
      });
      return next;
    });
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
  }, [fileId, isDiagnosticsMode, isJsdomRuntime, showSidebar]);

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
    sidebarState: PdfAnnotationSidebarViewState;
    toolbarState: PdfAnnotationToolbarViewState;
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
      input.sidebarState.searchQuery.trim(),
      input.sidebarState.typeFilter,
      input.sidebarState.colorFilter,
      input.sidebarState.tagFilter,
      input.toolbarState.activeTool,
      input.toolbarState.activeColor,
      input.toolbarState.activeUnderlineStyle,
      input.toolbarState.activeEraserMode,
      Math.round(input.toolbarState.activeEraserSize),
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
    const toolbarState = normalizePdfAnnotationToolbarViewState({
      activeTool,
      activeColor,
      activeUnderlineStyle,
      activeEraserMode,
      activeEraserSize,
      searchOpen,
    });
    const editorState = buildPdfEditorState({
      scale: persistedScale,
      zoomMode,
      showSidebar,
      sidebarSize,
      selectedAnnotationId,
      sidebarState: pdfSidebarViewState,
      toolbarState,
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
      sidebarState: pdfSidebarViewState,
      toolbarState,
      scrollTop: editorState.scrollTop,
      scrollLeft: editorState.scrollLeft ?? 0,
      anchor,
    });

    return {
      editorState,
      anchor,
      signature,
    };
  }, [activeColor, activeEraserMode, activeEraserSize, activeTool, activeUnderlineStyle, buildPersistSignature, captureCurrentPdfAnchor, fitScale, getViewerScrollContainer, pdfSidebarViewState, scale, searchOpen, selectedAnnotationId, showSidebar, sidebarSize, zoomMode]);

  const persistPdfViewStateNow = useCallback(() => {
    clearScheduledPersist();
    if (!hasRestoredScrollRef.current) {
      return;
    }
    const snapshot = buildCurrentPdfEditorStateSnapshot();
    if (!snapshot && lastPersistedEditorStateRef.current?.fileId === fileId) {
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
    lastPersistedEditorStateRef.current = {
      fileId,
      persistedKey: persistedPdfViewStateKey,
      state: nextState,
    };
    updateCurrentAnchorDebug(anchor);
    saveEditorState(fileId, nextState);
    void savePersistedFileViewState(persistedPdfViewStateKey, nextState);
  }, [buildCurrentPdfEditorStateSnapshot, clearScheduledPersist, fileId, persistedPdfViewStateKey, saveEditorState, updateCurrentAnchorDebug]);

  const persistLastKnownPdfViewState = useCallback(() => {
    const lastKnown = lastPersistedEditorStateRef.current;
    if (!lastKnown || lastKnown.fileId !== fileId) {
      return;
    }

    saveEditorState(lastKnown.fileId, lastKnown.state);
    void savePersistedFileViewState(lastKnown.persistedKey, lastKnown.state);
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

  const flushPdfRepairWritebacks = useCallback(() => {
    repairWritebackIdleRef.current = null;
    const queued = Array.from(repairWritebackQueueRef.current.values());
    repairWritebackQueueRef.current.clear();
    queued.forEach((annotation) => {
      if (annotation.target.type !== "pdf") {
        return;
      }
      const target = annotation.target as PdfTarget;
      commitAnnotationUpdate(annotation.id, {
        content: annotation.content,
        target: {
          rects: target.rects,
          textQuote: target.textQuote,
          startCharIndex: target.startCharIndex,
          endCharIndex: target.endCharIndex,
          quads: target.quads,
          textKernelVersion: target.textKernelVersion,
          textSource: target.textSource,
          textConfidence: target.textConfidence,
        },
      });
    });
  }, [commitAnnotationUpdate]);

  const queuePdfRepairWritebacks = useCallback((annotationsToWrite: AnnotationItem[]) => {
    if (annotationsToWrite.length === 0) {
      return;
    }
    annotationsToWrite.forEach((annotation) => {
      repairWritebackQueueRef.current.set(annotation.id, annotation);
    });
    if (repairWritebackIdleRef.current !== null) {
      return;
    }

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    if (idleWindow.requestIdleCallback) {
      repairWritebackIdleRef.current = idleWindow.requestIdleCallback(flushPdfRepairWritebacks, { timeout: 2500 });
      return;
    }

    repairWritebackIdleRef.current = window.setTimeout(flushPdfRepairWritebacks, 900);
  }, [flushPdfRepairWritebacks]);

  useEffect(() => {
    const viewerContainer = getViewerScrollContainer();
    if (!viewerContainer) {
      return;
    }

    let scrollRafId = 0;
    const handleScroll = () => {
      if (!hasRestoredScrollRef.current) {
        return;
      }
      // Throttle to one snapshot per animation frame to avoid jank during fast scrolling
      if (scrollRafId) return;
      scrollRafId = window.requestAnimationFrame(() => {
        scrollRafId = 0;
        const snapshot = buildCurrentPdfEditorStateSnapshot();
        if (snapshot) {
          lastPersistedEditorStateRef.current = {
            fileId,
            persistedKey: persistedPdfViewStateKey,
            state: snapshot.editorState,
          };
        }
        schedulePersistPdfViewState();
      });
    };

    viewerContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      viewerContainer.removeEventListener('scroll', handleScroll);
      if (scrollRafId) window.cancelAnimationFrame(scrollRafId);
      if (lastPersistedEditorStateRef.current?.fileId === fileId) {
        persistLastKnownPdfViewState();
      } else {
        persistPdfViewStateNow();
      }
    };
  }, [buildCurrentPdfEditorStateSnapshot, fileId, getViewerScrollContainer, persistLastKnownPdfViewState, persistPdfViewStateNow, persistedPdfViewStateKey, schedulePersistPdfViewState, showSidebar, sidebarSize]);

  useEffect(() => {
    const flushPersist = () => {
      if (lastPersistedEditorStateRef.current?.fileId === fileId) {
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
  }, [
    activeColor,
    activeEraserMode,
    activeEraserSize,
    activeTool,
    activeUnderlineStyle,
    pdfSidebarViewState,
    scale,
    schedulePersistPdfViewState,
    selectedAnnotationId,
    showSidebar,
    sidebarSize,
    zoomMode,
  ]);

  useEffect(() => {
    if (hasRestoredScrollRef.current) {
      return;
    }

    if (shouldIsolateDiagnosticViewState) {
      hasRestoredScrollRef.current = true;
      updateRestoreDebugState(createIdleRestoreDebugState());
      return;
    }

    const cachedState = getEditorState(fileId) ?? persistedPdfEditorState;
    if (!cachedState) {
      if (!persistedPdfEditorStateLoaded) {
        return;
      }
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
  }, [
    fileId,
    getEditorState,
    getViewerScrollContainer,
    persistedPdfEditorState,
    persistedPdfEditorStateLoaded,
    restorePdfAnchor,
    shouldIsolateDiagnosticViewState,
    updateRestoreDebugState,
  ]);

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
    const paths = merged.strokes
      .map((stroke) => stroke.points)
      .filter((path) => path.length >= 2);
    const strokeWidth = merged.strokes[merged.strokes.length - 1]?.width ?? activeInkWidth;
    const boundingBox = getPdfInkBoundingBox(paths, strokeWidth / 1000) ?? {
      x1: merged.boundingBox.x1,
      y1: merged.boundingBox.y1,
      x2: merged.boundingBox.x2,
      y2: merged.boundingBox.y2,
    };
    const inkAnnotation: Omit<AnnotationItem, 'id' | 'createdAt'> = {
      target: {
        type: 'pdf',
        page: merged.page,
        rects: [{
          x1: Math.max(0, boundingBox.x1),
          y1: Math.max(0, boundingBox.y1),
          x2: Math.min(1, boundingBox.x2),
          y2: Math.min(1, boundingBox.y2),
        }],
      } as PdfTarget,
      style: {
        color: merged.color,
        type: 'ink',
      },
      // Store stroke geometry plus width so rendering and export stay stable.
      content: serializePdfInkContent({
        paths,
        width: strokeWidth,
      }),
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
        ink: {
          paths,
          color: merged.color,
          width: strokeWidth,
        },
      },
    );
    if (preview) {
      inkAnnotation.preview = preview;
    }

    addAnnotation(inkAnnotation);
  }, [activeInkWidth, addAnnotation]);

  // Use ink annotation merge hook
  const {
    addStroke: addInkStroke,
    pendingStrokes: pendingInkStrokes,
    finalizeNow: finalizeInkNow,
  } = useInkAnnotation({
    onCreateAnnotation: handleCreateMergedInkAnnotation,
    mergeCriteria: {
      timeThreshold: 2000,
      distanceThreshold: 0.1,
    },
  });

  useEffect(() => {
    if (activeTool === "eraser") {
      finalizeInkNow();
    }
  }, [activeTool, finalizeInkNow]);

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
      if (repairWritebackIdleRef.current !== null) {
        const idleWindow = window as Window & {
          cancelIdleCallback?: (handle: number) => void;
        };
        idleWindow.cancelIdleCallback?.(repairWritebackIdleRef.current);
        window.clearTimeout(repairWritebackIdleRef.current);
        repairWritebackIdleRef.current = null;
      }
      repairWritebackQueueRef.current.clear();
      timeoutIdsRef.current.forEach((id) => window.clearTimeout(id));
      timeoutIdsRef.current = [];
    };
  }, [cancelScheduledNativePdfSelectionClear, clearScheduledPersist]);

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
    const pageBuffer = isDiagnosticsMode ? 0 : PAGE_BUFFER;
    visiblePages.forEach((pageNumber) => {
      for (let candidate = pageNumber - pageBuffer; candidate <= pageNumber + pageBuffer; candidate += 1) {
        if (candidate >= 1 && candidate <= numPages) {
          next.add(candidate);
        }
      }
    });
    if (isDiagnosticsMode) {
      diagnosticPinnedPages.forEach((pageNumber) => {
        if (pageNumber >= 1 && pageNumber <= numPages) {
          next.add(pageNumber);
        }
      });
    }
    return next;
  }, [diagnosticPinnedPages, isDiagnosticsMode, numPages, visiblePages]);
  const renderScale = zoomMode === "manual" ? scale : fitScale;

  useEffect(() => {
    pdfTextMarkupViewCacheRef.current.clear();
  }, [pdfTextLayerRevision, renderScale, fileId]);

  useEffect(() => {
    if (annotationsLoading || dedupedAnnotations.length === 0 || renderedPages.size === 0) {
      return;
    }

    const nextRepaired: Record<string, PdfRepairedAnnotationEntry> = {};
    const updates: AnnotationItem[] = [];

    dedupedAnnotations.forEach((annotation) => {
      if (
        annotation.target.type !== "pdf" ||
        !shouldAttemptPdfTextRepair(annotation) ||
        !renderedPages.has(annotation.target.page)
      ) {
        return;
      }

      const pageElement = findPdfPageElementInScope(containerRef.current, annotation.target.page);
      if (!pageElement) {
        return;
      }
      const model = getRenderedPdfPageTextModelForPage(annotation.target.page);
      if (!model) {
        return;
      }

      const resolvedView = getPdfTextMarkupView(annotation, model);
      const repaired = resolvedView?.annotation;
      if (!repaired) {
        return;
      }

      const repairedSignature = buildPdfTextRepairSignature(repaired);
      const currentSignature = buildPdfTextRepairSignature(annotation);
      const displayedEntry = repairedAnnotationsById[annotation.id];
      if (!repairedSignature || repairedSignature === currentSignature) {
        return;
      }

      if (
        displayedEntry?.sourceSignature !== currentSignature ||
        displayedEntry.repairedSignature !== repairedSignature
      ) {
        nextRepaired[annotation.id] = {
          sourceSignature: currentSignature ?? "",
          repairedSignature,
          annotation: repaired,
        };
      }
      if (
        repairedAnnotationUpdateSignatureRef.current[annotation.id] !== repairedSignature &&
        isSafePdfTextRepairWriteback(annotation, repaired)
      ) {
        repairedAnnotationUpdateSignatureRef.current[annotation.id] = repairedSignature;
        updates.push(repaired);
      }
    });

    if (Object.keys(nextRepaired).length > 0) {
      setRepairedAnnotationsById((previous) => {
        let changed = false;
        const merged = { ...previous };
        Object.entries(nextRepaired).forEach(([annotationId, entry]) => {
          const previousEntry = previous[annotationId];
          if (
            previousEntry?.sourceSignature !== entry.sourceSignature ||
            previousEntry?.repairedSignature !== entry.repairedSignature
          ) {
            merged[annotationId] = entry;
            changed = true;
          }
        });
        return changed ? merged : previous;
      });
    }

    queuePdfRepairWritebacks(updates);
  }, [annotationsLoading, dedupedAnnotations, getPdfTextMarkupView, getRenderedPdfPageTextModelForPage, pdfTextLayerRevision, queuePdfRepairWritebacks, renderedPages, repairedAnnotationsById]);

  useEffect(() => {
    if (!isDiagnosticsMode || numPages <= 0) {
      return;
    }

    setVisiblePages((previous) => {
      const next = new Set(previous);
      let changed = false;
      for (let pageNumber = 1; pageNumber <= Math.min(numPages, 2); pageNumber += 1) {
        if (!next.has(pageNumber)) {
          next.add(pageNumber);
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [isDiagnosticsMode, numPages]);

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
      const pageBuffer = isDiagnosticsMode ? 0 : PAGE_BUFFER;

      for (let candidate = pageNumber - pageBuffer; candidate <= pageNumber + pageBuffer; candidate += 1) {
        if (candidate >= 1 && candidate <= numPages && !next.has(candidate)) {
          next.add(candidate);
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [isDiagnosticsMode, numPages]);

  useEffect(() => {
    const restoredPage = (cachedPdfViewState ?? persistedPdfViewState)?.anchor?.pageNumber;
    if (typeof restoredPage !== "number" || !Number.isInteger(restoredPage) || restoredPage <= 0) {
      return;
    }

    warmVisiblePages(restoredPage);
  }, [cachedPdfViewState, persistedPdfViewState, warmVisiblePages]);

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

  const preserveCurrentPdfAnchorForViewportChange = useCallback(() => {
    pendingViewportRestoreAnchorRef.current = captureCurrentPdfAnchor();
  }, [captureCurrentPdfAnchor]);

  const setShowSidebarPreservingPdfAnchor = useCallback((updater: boolean | ((current: boolean) => boolean)) => {
    preserveCurrentPdfAnchorForViewportChange();
    setShowSidebar(updater);
  }, [preserveCurrentPdfAnchorForViewportChange]);

  const setSidebarSizePreservingPdfAnchor = useCallback((nextSize: number) => {
    preserveCurrentPdfAnchorForViewportChange();
    setSidebarSize(nextSize);
  }, [preserveCurrentPdfAnchorForViewportChange]);

  // Keyboard shortcut: Ctrl+Shift+A to toggle sidebar.
  useEffect(() => {
    const handleSidebarShortcut = (e: KeyboardEvent) => {
      if (!isPdfInteractionActive({ paneId, isPaneActive })) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setShowSidebarPreservingPdfAnchor((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleSidebarShortcut);
    return () => window.removeEventListener('keydown', handleSidebarShortcut);
  }, [isPaneActive, paneId, setShowSidebarPreservingPdfAnchor]);

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

    await exportPdfWithAnnotations(pdfBytes, displayAnnotations, fileName);
  }, [displayAnnotations, fileHandle, fileName, source]);

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
          onTrigger: () => setShowSidebarPreservingPdfAnchor((value) => !value),
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
          id: "tool-eraser",
          label: t("pdf.command.eraser"),
          icon: "eraser",
          active: activeTool === "eraser",
          priority: 22,
          group: "secondary",
          onTrigger: () => setActiveTool((value) => (value === "eraser" ? "select" : "eraser")),
          onContextMenu: (position) => openAnnotationDefaultsMenu("eraser", position),
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
          group: "overflow",
          onTrigger: zoomIn,
        },
        {
          id: "zoom-out",
          label: t("pdf.zoomOut"),
          icon: "zoom-out",
          priority: 33,
          group: "overflow",
          onTrigger: zoomOut,
        },
        {
          id: "search",
          label: t("pdf.search.open"),
          icon: "search",
          active: searchOpen,
          priority: 6,
          group: "utility",
          onTrigger: () => setSearchOpen(true),
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
    searchOpen,
    setShowSidebarPreservingPdfAnchor,
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

  const closePdfContextMenu = useCallback(() => {
    setPdfContextMenu(null);
  }, []);

  const handlePdfContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (!isPdfInteractionActive({ paneId, isPaneActive })) {
      return;
    }

    setAnnotationDefaultsMenu(null);
    setPdfContextMenu({
      position: { x: event.clientX, y: event.clientY },
      pageNumber: getPrimaryVisiblePageState()?.pageNumber ?? null,
      selectedText: getActivePdfSelectionText(),
    });
  }, [getActivePdfSelectionText, getPrimaryVisiblePageState, isPaneActive, paneId]);

  const copyPdfPageReference = useCallback(() => {
    const pageNumber = pdfContextMenu?.pageNumber ?? getPrimaryVisiblePageState()?.pageNumber ?? null;
    const reference = pageNumber ? `${fileName}#page=${pageNumber}` : fileName;
    void copyToClipboard(reference);
  }, [fileName, getPrimaryVisiblePageState, pdfContextMenu?.pageNumber]);

  const openPdfSearchFromContextMenu = useCallback(() => {
    setSearchOpen(true);
  }, []);

  const toggleSidebarFromContextMenu = useCallback(() => {
    setShowSidebarPreservingPdfAnchor((value) => !value);
  }, [setShowSidebarPreservingPdfAnchor]);

  const annotationById = useMemo(() => {
    return new Map(displayAnnotations.map((annotation) => [annotation.id, annotation] as const));
  }, [displayAnnotations]);

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

    const textMarkupView = isPdfTextMarkupAnnotation(annotation)
      ? getPdfTextMarkupView(annotation, getRenderedPdfPageTextModelForPage(target.page))
      : null;
    let positionRects = textMarkupView?.rects ?? target.rects;
    if (isPdfTextMarkupAnnotation(annotation) && positionRects.length === 0) {
      positionRects = normalizePdfTextMarkupRenderRects(target.rects);
    }
    if (positionRects.length === 0) {
      return null;
    }

    const pageRect = pageElement.getBoundingClientRect();
    const sortedRects = [...positionRects].sort((left, right) => left.y1 - right.y1 || left.x1 - right.x1);
    const trailingRect = sortedRects[sortedRects.length - 1];
    const unionLeft = Math.min(...positionRects.map((rect) => rect.x1));
    const unionTop = Math.min(...positionRects.map((rect) => rect.y1));
    const unionRight = Math.max(...positionRects.map((rect) => rect.x2));
    const unionBottom = Math.max(...positionRects.map((rect) => rect.y2));
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
  }, [getPdfTextMarkupView, getRenderedPdfPageTextModelForPage]);

  const openAnnotationMenu = useCallback((annotation: AnnotationItem) => {
    const placement = buildAnnotationMenuPosition(annotation);
    if (!placement) {
      return;
    }

    setAnnotationAdjustmentDraft(null);
    setAreaAdjustmentDraft(null);
    setSelectedAnnotationId(annotation.id);
    setHighlightedId(annotation.id);
    setAnnotationMenuState({
      annotationId: annotation.id,
      position: placement.position,
      anchorRect: placement.anchorRect,
    });
  }, [buildAnnotationMenuPosition]);

  const openTextAnnotationEditor = useCallback((annotation: AnnotationItem): boolean => {
    if (annotation.style.type !== "text" || annotation.target.type !== "pdf") {
      return false;
    }

    const target = annotation.target as PdfTarget;
    const rect = target.rects[0];
    const pageElement = findPdfPageElementInScope(containerRef.current, target.page);
    if (!pageElement || !rect) {
      return false;
    }

    const pageRect = pageElement.getBoundingClientRect();
    const x = pageRect.left + (((rect.x1 + rect.x2) / 2) * pageRect.width);
    const y = pageRect.top + (rect.y1 * pageRect.height);

    setAnnotationAdjustmentDraft(null);
    setAreaAdjustmentDraft(null);
    setAnnotationMenuState(null);
    setSelectedAnnotationId(annotation.id);
    setHighlightedId(annotation.id);
    setEditingTextAnnotation({
      annotation,
      position: { x, y },
    });
    return true;
  }, []);

  const updatePdfTextMarkupAnnotation = useCallback((annotationId: string, anchor: PdfAnnotationTextAnchor) => {
    const annotation = annotationById.get(annotationId);
    if (!annotation || annotation.target.type !== "pdf") {
      return;
    }

    const target = annotation.target as PdfTarget;
    const rects = anchor.rects.filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1);
    const nextRects = rects.length > 0 ? rects : anchor.rects;
    const pageElement = findPdfPageElementInScope(containerRef.current, target.page);
    const preview = pageElement
      ? buildPdfAnnotationPreviewFromPageElement(pageElement, nextRects, {
          paddingRatio: 0.035,
          minCssWidth: 180,
          minCssHeight: 120,
        })
      : undefined;

    updateAnnotation(annotationId, {
      target: {
        ...target,
        rects: nextRects,
        textQuote: anchor.textQuote,
        startCharIndex: anchor.startOffset,
        endCharIndex: anchor.endOffset,
        quads: nextRects.map(pdfPageRectToQuad),
        textKernelVersion: target.textKernelVersion ?? 1,
        textSource: anchor.textQuote.source,
        textConfidence: target.textConfidence ?? 1,
      },
      content: anchor.textQuote.exact,
      ...(preview ? { preview } : {}),
    });
  }, [annotationById, updateAnnotation]);

  const beginAnnotationBoundaryAdjustment = useCallback((annotation: AnnotationItem, side: "start" | "end", event: React.PointerEvent<HTMLButtonElement>) => {
    if (annotation.target.type !== "pdf") {
      return;
    }

    const target = annotation.target as PdfTarget;
    const pageElement = findPdfPageElementInScope(containerRef.current, target.page);
    if (!pageElement) {
      return;
    }

    const model = getRenderedPdfPageTextModelForPage(target.page);
    if (!model) {
      return;
    }

    const resolvedAnchor = resolvePdfAnnotationTextAnchor(model, target);
    if (!resolvedAnchor) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    closeAnnotationMenu();
    setSelectedAnnotationId(annotation.id);
    setAnnotationAdjustmentDraft({
      annotationId: annotation.id,
      page: target.page,
      anchor: resolvedAnchor,
      source: side,
    });
    let currentAnchor = resolvedAnchor;
    let dragActivated = false;
    let latestPoint: { x: number; y: number } | null = null;
    let frameId: number | null = null;
    const initialDraftKey = `${resolvedAnchor.startOffset}:${resolvedAnchor.endOffset}`;
    let lastDraftKey = initialDraftKey;

    const pointerId = event.pointerId;
    const initialClientX = event.clientX;
    const initialClientY = event.clientY;
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(pointerId);
    }

    const applyBoundaryAdjustment = (point: { x: number; y: number }): void => {
      const livePageElement = findPdfPageElementInScope(containerRef.current, target.page);
      if (!livePageElement) {
        return;
      }
      const liveModel = getRenderedPdfPageTextModelForPage(target.page) ?? model;

      const pageRect = livePageElement.getBoundingClientRect();
      if (pageRect.width <= 0 || pageRect.height <= 0) {
        return;
      }

      const adjusted = adjustPdfAnnotationAnchorFromPointer({
        model: liveModel,
        target,
        currentAnchor,
        pageRect,
        point,
        side,
      });
      if (!adjusted) {
        return;
      }

      const nextDraftKey = `${adjusted.startOffset}:${adjusted.endOffset}`;
      if (nextDraftKey !== lastDraftKey) {
        setAnnotationAdjustmentDraft({
          annotationId: annotation.id,
          page: target.page,
          anchor: adjusted,
          source: side,
        });
        lastDraftKey = nextDraftKey;
      }
      currentAnchor = adjusted;
    };

    const flushPendingPoint = (): void => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
      const point = latestPoint;
      latestPoint = null;
      if (point) {
        applyBoundaryAdjustment(point);
      }
    };

    const scheduleBoundaryAdjustment = (point: { x: number; y: number }): void => {
      latestPoint = point;
      if (frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const nextPoint = latestPoint;
        latestPoint = null;
        if (nextPoint) {
          applyBoundaryAdjustment(nextPoint);
        }
      });
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      moveEvent.preventDefault();
      const dragDistance = Math.hypot(
        moveEvent.clientX - initialClientX,
        moveEvent.clientY - initialClientY,
      );
      if (!dragActivated && dragDistance < 2) {
        return;
      }
      dragActivated = true;
      scheduleBoundaryAdjustment({ x: moveEvent.clientX, y: moveEvent.clientY });
    };

    const finish = (commit: boolean) => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp, true);
      document.removeEventListener("pointercancel", handlePointerCancel, true);
      flushPendingPoint();
      suppressPdfSurfaceClickUntilRef.current = Date.now() + 250;
      const currentDraftKey = `${currentAnchor.startOffset}:${currentAnchor.endOffset}`;
      if (commit && (dragActivated || currentDraftKey !== initialDraftKey)) {
        updatePdfTextMarkupAnnotation(annotation.id, currentAnchor);
      }
      setAnnotationAdjustmentDraft((current) => (
        !current || current.annotationId !== annotation.id ? current : null
      ));
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      if (dragActivated) {
        latestPoint = { x: upEvent.clientX, y: upEvent.clientY };
      }
      finish(true);
    };

    const handlePointerCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) {
        return;
      }
      finish(false);
    };

    document.addEventListener("pointermove", handlePointerMove, { passive: false });
    document.addEventListener("pointerup", handlePointerUp, true);
    document.addEventListener("pointercancel", handlePointerCancel, true);
  }, [closeAnnotationMenu, getRenderedPdfPageTextModelForPage, updatePdfTextMarkupAnnotation]);

  const updatePdfAreaAnnotationRect = useCallback((annotation: AnnotationItem, rect: BoundingBox) => {
    if (annotation.target.type !== "pdf") {
      return;
    }

    const target = annotation.target as PdfTarget;
    const pageElement = findPdfPageElementInScope(containerRef.current, target.page);
    const normalizedRect = {
      x1: Math.max(0, Math.min(1, Math.min(rect.x1, rect.x2))),
      y1: Math.max(0, Math.min(1, Math.min(rect.y1, rect.y2))),
      x2: Math.max(0, Math.min(1, Math.max(rect.x1, rect.x2))),
      y2: Math.max(0, Math.min(1, Math.max(rect.y1, rect.y2))),
    };
    const preview = pageElement
      ? buildPdfAnnotationPreviewFromPageElement(pageElement, [normalizedRect], {
          paddingRatio: 0.012,
          minCssWidth: 96,
          minCssHeight: 72,
        })
      : undefined;

    updateAnnotation(annotation.id, {
      target: {
        ...target,
        rects: [normalizedRect],
      },
      ...(preview ? { preview } : {}),
    });
  }, [updateAnnotation]);

  const beginAreaAdjustment = useCallback((annotation: AnnotationItem, handle: PdfAreaAdjustmentHandle, event: React.PointerEvent<HTMLElement>) => {
    if (annotation.style.type !== "area" || annotation.target.type !== "pdf") {
      return;
    }

    const target = annotation.target as PdfTarget;
    const initialRect = target.rects[0];
    const pageElement = findPdfPageElementInScope(containerRef.current, target.page);
    if (!initialRect || !pageElement) {
      return;
    }

    const pageRect = pageElement.getBoundingClientRect();
    if (pageRect.width <= 0 || pageRect.height <= 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    closeAnnotationMenu();
    setSelectedAnnotationId(annotation.id);
    setHighlightedId(annotation.id);

    const initialPoint = {
      x: Math.max(0, Math.min(1, (event.clientX - pageRect.left) / pageRect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - pageRect.top) / pageRect.height)),
    };
    let currentRect = { ...initialRect };
    setAreaAdjustmentDraft({
      annotationId: annotation.id,
      page: target.page,
      rect: currentRect,
      handle,
    });

    const minSize = 0.008;
    const pointerId = event.pointerId;
    let latestPoint: { clientX: number; clientY: number } | null = null;
    let frameId: number | null = null;
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(pointerId);
    }

    const buildNextRect = (point: { x: number; y: number }): BoundingBox => {
      const dx = point.x - initialPoint.x;
      const dy = point.y - initialPoint.y;
      if (handle === "move") {
        const width = initialRect.x2 - initialRect.x1;
        const height = initialRect.y2 - initialRect.y1;
        const nextX1 = Math.max(0, Math.min(1 - width, initialRect.x1 + dx));
        const nextY1 = Math.max(0, Math.min(1 - height, initialRect.y1 + dy));
        return {
          x1: nextX1,
          y1: nextY1,
          x2: nextX1 + width,
          y2: nextY1 + height,
        };
      }

      const next = { ...initialRect };
      if (handle.includes("w")) {
        next.x1 = Math.max(0, Math.min(initialRect.x2 - minSize, initialRect.x1 + dx));
      }
      if (handle.includes("e")) {
        next.x2 = Math.min(1, Math.max(initialRect.x1 + minSize, initialRect.x2 + dx));
      }
      if (handle.includes("n")) {
        next.y1 = Math.max(0, Math.min(initialRect.y2 - minSize, initialRect.y1 + dy));
      }
      if (handle.includes("s")) {
        next.y2 = Math.min(1, Math.max(initialRect.y1 + minSize, initialRect.y2 + dy));
      }
      return next;
    };

    const applyAreaAdjustment = (point: { clientX: number; clientY: number }): void => {
      const livePageElement = findPdfPageElementInScope(containerRef.current, target.page) ?? pageElement;
      const livePageRect = livePageElement.getBoundingClientRect();
      if (livePageRect.width <= 0 || livePageRect.height <= 0) {
        return;
      }
      const normalizedPoint = {
        x: Math.max(0, Math.min(1, (point.clientX - livePageRect.left) / livePageRect.width)),
        y: Math.max(0, Math.min(1, (point.clientY - livePageRect.top) / livePageRect.height)),
      };
      currentRect = buildNextRect(normalizedPoint);
      setAreaAdjustmentDraft({
        annotationId: annotation.id,
        page: target.page,
        rect: currentRect,
        handle,
      });
    };

    const flushPendingPoint = (): void => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
      const point = latestPoint;
      latestPoint = null;
      if (point) {
        applyAreaAdjustment(point);
      }
    };

    const scheduleAreaAdjustment = (point: { clientX: number; clientY: number }): void => {
      latestPoint = point;
      if (frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const nextPoint = latestPoint;
        latestPoint = null;
        if (nextPoint) {
          applyAreaAdjustment(nextPoint);
        }
      });
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      scheduleAreaAdjustment({ clientX: moveEvent.clientX, clientY: moveEvent.clientY });
    };

    const finish = (commit: boolean) => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp, true);
      document.removeEventListener("pointercancel", handlePointerCancel, true);
      flushPendingPoint();
      suppressPdfSurfaceClickUntilRef.current = Date.now() + 250;
      setAreaAdjustmentDraft(null);
      if (commit) {
        updatePdfAreaAnnotationRect(annotation, currentRect);
      }
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      latestPoint = { clientX: upEvent.clientX, clientY: upEvent.clientY };
      finish(true);
    };
    const handlePointerCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) {
        return;
      }
      finish(false);
    };

    document.addEventListener("pointermove", handlePointerMove, { passive: false });
    document.addEventListener("pointerup", handlePointerUp, true);
    document.addEventListener("pointercancel", handlePointerCancel, true);
  }, [closeAnnotationMenu, updatePdfAreaAnnotationRect]);

  const resolvePdfPageElementFromMouseEvent = useCallback((event: { target: EventTarget; clientX: number; clientY: number }): HTMLElement | null => (
    findPdfPageElementFromEventTarget(event.target) ??
    findPdfPageElementAtClientPoint(containerRef.current, event.clientX, event.clientY)
  ), []);

  const findPdfAnnotationAtClientPoint = useCallback((event: { target: EventTarget; clientX: number; clientY: number }): AnnotationItem | null => {
    const pageElement = resolvePdfPageElementFromMouseEvent(event);
    if (!(pageElement instanceof HTMLElement)) {
      return null;
    }

    const pageNumber = getPdfPageNumberFromElement(pageElement);
    if (pageNumber === null) {
      return null;
    }

    const pageRect = pageElement.getBoundingClientRect();
    if (pageRect.width <= 0 || pageRect.height <= 0) {
      return null;
    }

    const normalizedX = (event.clientX - pageRect.left) / pageRect.width;
    const normalizedY = (event.clientY - pageRect.top) / pageRect.height;
    const clickPoint = { x: normalizedX, y: normalizedY };
    const baseToleranceX = Math.max(4 / pageRect.width, 0.003);
    const baseToleranceY = Math.max(6 / pageRect.height, 0.004);
    const getHitTolerance = (annotation: AnnotationItem) => {
      if (isPinAnnotation(annotation)) {
        return {
          x: Math.max(16 / pageRect.width, 0.012),
          y: Math.max(18 / pageRect.height, 0.014),
        };
      }
      if (annotation.style.type === 'ink') {
        return {
          x: Math.max(10 / pageRect.width, 0.006),
          y: Math.max(10 / pageRect.height, 0.006),
        };
      }
      if (annotation.style.type === 'text') {
        return {
          x: Math.max(8 / pageRect.width, 0.006),
          y: Math.max(8 / pageRect.height, 0.006),
        };
      }
      if (annotation.style.type === 'area') {
        return {
          x: Math.max(5 / pageRect.width, 0.004),
          y: Math.max(5 / pageRect.height, 0.004),
        };
      }
      if (annotation.style.type === 'underline') {
        return {
          x: Math.max(baseToleranceX, 0.004),
          y: Math.max(10 / pageRect.height, 0.007),
        };
      }
      if (annotation.style.type === 'highlight') {
        return {
          x: Math.max(baseToleranceX, 0.004),
          y: Math.max(baseToleranceY, 0.005),
        };
      }
      return { x: baseToleranceX, y: baseToleranceY };
    };
    const getHitStyleRank = (annotation: AnnotationItem): number => {
      if (isPinAnnotation(annotation) || annotation.style.type === 'text') {
        return 0;
      }
      if (annotation.style.type === 'ink') {
        return 1;
      }
      if (annotation.style.type === 'highlight' || annotation.style.type === 'underline') {
        return 2;
      }
      if (annotation.style.type === 'area') {
        return 3;
      }
      return 4;
    };
    const getAnnotationCreatedAt = (annotation: AnnotationItem): number => {
      const value = new Date(annotation.createdAt).getTime();
      return Number.isFinite(value) ? value : 0;
    };
    const getEffectiveHitRects = (annotation: AnnotationItem, target: PdfTarget): PdfTarget["rects"] => {
      if (!isPdfTextMarkupAnnotation(annotation)) {
        return target.rects;
      }

      const targetRects = target.rects;
      if (targetRects.length === 0) {
        return [];
      }
      const safeRects = getSafePdfTextMarkupFallbackRects(targetRects, target.textQuote?.exact ?? annotation.content);
      if (safeRects.length > 0) {
        return safeRects;
      }
      return getPdfTextMarkupView(annotation, getRenderedPdfPageTextModelForPage(pageNumber))?.rects ?? [];
    };

    const hitCandidates = displayAnnotations
      .map((annotation) => {
        if (annotation.target.type !== 'pdf') {
          return null;
        }
        const pdfTarget = annotation.target as PdfTarget;
        if (pdfTarget.page !== pageNumber) {
          return null;
        }
        const effectiveHitRects = getEffectiveHitRects(annotation, pdfTarget);
        if (effectiveHitRects.length === 0) {
          return null;
        }

        const tolerance = getHitTolerance(annotation);
        if (annotation.style.type === 'ink') {
          const parsed = parsePdfInkContent(annotation.content);
          if (parsed) {
            const radius = Math.max(
              tolerance.x,
              (Math.max(parsed.width, DEFAULT_PDF_INK_WIDTH) / 2 + 8) / pageRect.width,
            );
            const yScale = pageRect.height / Math.max(1, pageRect.width);
            const pathHit = parsed.paths.some((path) => isPointNearPdfInkPath(clickPoint, path, radius, yScale));
            if (pathHit) {
              return {
                annotation,
                totalArea: effectiveHitRects.reduce((sum, rect) => sum + Math.max(0, rect.x2 - rect.x1) * Math.max(0, rect.y2 - rect.y1), 0),
                hitRectArea: 0,
                distance: 0,
                pathHit: true,
                styleRank: getHitStyleRank(annotation),
                createdAt: getAnnotationCreatedAt(annotation),
              };
            }
          }
        }

        const hitRect = effectiveHitRects.find((rect) => (
          normalizedX >= rect.x1 - tolerance.x &&
          normalizedX <= rect.x2 + tolerance.x &&
          normalizedY >= rect.y1 - tolerance.y &&
          normalizedY <= rect.y2 + tolerance.y
        ));
        if (!hitRect) {
          return null;
        }

        const rectCenterX = (hitRect.x1 + hitRect.x2) / 2;
        const rectCenterY = (hitRect.y1 + hitRect.y2) / 2;
        const distance = Math.abs(normalizedX - rectCenterX) + (Math.abs(normalizedY - rectCenterY) * 0.5);
        const totalArea = effectiveHitRects.reduce((sum, rect) => sum + Math.max(0, rect.x2 - rect.x1) * Math.max(0, rect.y2 - rect.y1), 0);
        const hitRectArea = Math.max(0, hitRect.x2 - hitRect.x1) * Math.max(0, hitRect.y2 - hitRect.y1);
        return {
          annotation,
          totalArea,
          hitRectArea,
          distance,
          pathHit: false,
          styleRank: getHitStyleRank(annotation),
          createdAt: getAnnotationCreatedAt(annotation),
        };
      })
      .filter((candidate): candidate is { annotation: AnnotationItem; totalArea: number; hitRectArea: number; distance: number; pathHit: boolean; styleRank: number; createdAt: number } => Boolean(candidate))
      .sort((left, right) => {
        if (left.pathHit !== right.pathHit) {
          return left.pathHit ? -1 : 1;
        }
        if (Math.abs(left.distance - right.distance) > 0.000001) {
          return left.distance - right.distance;
        }
        if (left.styleRank !== right.styleRank) {
          return left.styleRank - right.styleRank;
        }
        if (Math.abs(left.hitRectArea - right.hitRectArea) > 0.000001) {
          return left.hitRectArea - right.hitRectArea;
        }
        if (right.createdAt !== left.createdAt) {
          return right.createdAt - left.createdAt;
        }
        return left.totalArea - right.totalArea;
      });

    return hitCandidates[0]?.annotation ?? null;
  }, [displayAnnotations, getPdfTextMarkupView, getRenderedPdfPageTextModelForPage, resolvePdfPageElementFromMouseEvent]);

  const handlePdfSurfacePointerDownCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const nativeEvent = getReactNativePdfSelectionEvent(event);
    if (nativeEvent?.__latticePdfSelectionPointerDownHandled) {
      return;
    }
    if (nativeEvent) {
      nativeEvent.__latticePdfSelectionPointerDownHandled = true;
    }

    if (isPdfSearchOverlayTarget(event.target)) {
      return;
    }

    const areaHandle = getPdfAnnotationAreaHandleFromTarget(event.target);
    if (areaHandle) {
      const annotationId = getPdfStoredAnnotationIdFromTarget(event.target);
      const annotation = annotationId ? annotationById.get(annotationId) : null;
      if (annotation?.style.type === "area" && annotation.target.type === "pdf") {
        beginAreaAdjustment(annotation, areaHandle, event);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (isPdfAnnotationResizeHandleTarget(event.target)) {
      event.preventDefault();
      return;
    }

    if (activeTool === "area") {
      return;
    }

    const annotation = findPdfAnnotationAtClientPoint(event);
    const textSelectionToolActive = activeTool === "select" ||
      activeTool === "highlight" ||
      activeTool === "underline";
    if (annotation && textSelectionToolActive) {
      beginNativePdfSelectionInteraction(event);
      return;
    }
    if (annotation && !(activeTool === "eraser" && annotation.style.type === "ink")) {
      event.preventDefault();
      event.stopPropagation();
      clearTransientSelection({ nextPhase: "cancelled" });
      if (annotation.style.type === "text") {
        clearActiveAnnotationUi();
        openTextAnnotationEditor(annotation);
      } else {
        clearActiveAnnotationUi();
        openAnnotationMenu(annotation);
      }
      suppressPdfSurfaceClickUntilRef.current = Date.now() + 250;
      return;
    }

    beginNativePdfSelectionInteraction(event);
  }, [
    activeTool,
    annotationById,
    beginAreaAdjustment,
    beginNativePdfSelectionInteraction,
    clearActiveAnnotationUi,
    clearTransientSelection,
    findPdfAnnotationAtClientPoint,
    openAnnotationMenu,
    openTextAnnotationEditor,
  ]);

  useEffect(() => {
    const shell = scrollContainerRef.current;
    if (!shell) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const container = containerRef.current;
      if (!container || !(event.target instanceof Node) || !container.contains(event.target)) {
        return;
      }
      const nativeEvent = event as PdfSelectionNativeEvent;
      if (nativeEvent.__latticePdfSelectionPointerDownHandled) {
        return;
      }
      nativeEvent.__latticePdfSelectionPointerDownHandled = true;
      handlePdfSurfacePointerDownCapture(event as unknown as React.PointerEvent<HTMLDivElement>);
    };
    const handlePointerMove = (event: PointerEvent) => {
      updateNativePdfSelectionDragPoint(event);
    };
    const handlePointerUp = (event: PointerEvent) => {
      freezeNativePdfSelectionSnapshot(event);
    };

    shell.addEventListener("pointerdown", handlePointerDown, true);
    shell.addEventListener("pointermove", handlePointerMove, true);
    shell.addEventListener("pointerup", handlePointerUp, true);
    return () => {
      shell.removeEventListener("pointerdown", handlePointerDown, true);
      shell.removeEventListener("pointermove", handlePointerMove, true);
      shell.removeEventListener("pointerup", handlePointerUp, true);
    };
  }, [
    freezeNativePdfSelectionSnapshot,
    handlePdfSurfacePointerDownCapture,
    updateNativePdfSelectionDragPoint,
  ]);

  useEffect(() => {
    if (!annotationMenuState) {
      return;
    }

    const annotation = annotationById.get(annotationMenuState.annotationId);
    if (!annotation) {
      closeAnnotationMenu();
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
  }, [annotationById, annotationMenuState, buildAnnotationMenuPosition, closeAnnotationMenu, renderScale, zoomMode]);

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
          closeAnnotationMenu();
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
                  avoidRect: placement.avoidRect,
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
    closeAnnotationMenu,
    buildSelectionDraftMenuPosition,
    getViewerScrollContainer,
    pendingSelectionDraft,
  ]);

  useEffect(() => {
    if (!pdfContextMenu) {
      return;
    }

    const viewerContainer = getViewerScrollContainer();
    if (!viewerContainer) {
      return;
    }

    const close = () => {
      setPdfContextMenu(null);
    };

    viewerContainer.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close, { passive: true });
    return () => {
      viewerContainer.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, [getViewerScrollContainer, pdfContextMenu]);

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
          case 'e':
            setActiveTool(t => t === 'eraser' ? 'select' : 'eraser');
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
    return displayAnnotations.filter((annotation) => (
      annotation.target.type === "pdf" &&
      annotation.style.type !== "ink" &&
      annotation.style.type !== "text"
    ));
  }, [displayAnnotations]);

  useEffect(() => {
    if (pdfSelectionSession.phase !== "committed") {
      return;
    }

    const committedAnnotationId = committedSelectionAnnotationIdRef.current;
    if (!committedAnnotationId) {
      return;
    }

    const annotation = storedPdfAnnotations.find((candidate) => candidate.id === committedAnnotationId);
    if (!annotation || annotation.target.type !== "pdf") {
      return;
    }

    const target = annotation.target as PdfTarget;
    if (!renderedPages.has(target.page)) {
      return;
    }

    const paneRoot = containerRef.current?.closest<HTMLElement>(`[data-testid="pdf-pane-${paneId}"]`)
      ?? containerRef.current
      ?? viewerContainerRef.current;
    if (!paneRoot) {
      return;
    }
    const pageElement = findPdfPageElementInScope(containerRef.current, target.page)
      ?? findPdfPageElementInScope(paneRoot, target.page);
    const observeRoot = pageElement ?? paneRoot;
    const storedSegmentSelector = `[data-pdf-stored-annotation-id="${escapeCssAttributeValue(committedAnnotationId)}"][data-pdf-stored-annotation-segment="true"]`;

    let disposed = false;
    let didHandoff = false;
    let observer: MutationObserver | null = null;

    const hasStoredSegmentMounted = () => observeRoot.querySelector(storedSegmentSelector) !== null;

    const handoffIfReady = () => {
      if (disposed || didHandoff || !hasStoredSegmentMounted()) {
        return false;
      }
      didHandoff = true;
      commitPdfSelectionSession(updatePdfSelectionSession(pdfSelectionSessionRef.current, {
        phase: "idle",
        snapshot: null,
      }));
      committedSelectionAnnotationIdRef.current = null;
      return true;
    };

    if (handoffIfReady()) {
      return;
    }

    observer = new MutationObserver(() => {
      handoffIfReady();
    });
    observer.observe(observeRoot, {
      childList: true,
      subtree: true,
    });

    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [commitPdfSelectionSession, paneId, pdfSelectionSession.phase, renderedPages, storedPdfAnnotations]);

  // Get ink annotations for custom rendering
  const inkAnnotations = useMemo(() => {
    return displayAnnotations.filter((annotation) => (
      annotation.target.type === 'pdf' &&
      annotation.style.type === 'ink'
    ));
  }, [displayAnnotations]);
  const pendingInkPages = useMemo(
    () => Array.from(new Set(pendingInkStrokes.map((stroke) => stroke.page))).sort((left, right) => left - right),
    [pendingInkStrokes],
  );

  useEffect(() => {
    if (activeTool !== "eraser") {
      isErasingInkRef.current = false;
      setIsErasingInk(false);
      setInkEraserCursor(null);
    }
  }, [activeTool]);

  // Get text annotations for custom rendering
  const textAnnotations = useMemo(() => {
    return displayAnnotations.filter((annotation) => (
      annotation.target.type === 'pdf' &&
      annotation.style.type === 'text'
    ));
  }, [displayAnnotations]);

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

  const getInkPointFromMouseEvent = useCallback((event: React.MouseEvent) => {
    const pageElement = resolvePdfPageElementFromMouseEvent(event);
    if (!(pageElement instanceof HTMLElement)) {
      return null;
    }

    const pageNumber = getPdfPageNumberFromElement(pageElement);
    const pageRect = pageElement.getBoundingClientRect();
    if (pageNumber === null || pageRect.width <= 0 || pageRect.height <= 0) {
      return null;
    }

    const x = Math.max(0, Math.min(1, (event.clientX - pageRect.left) / pageRect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - pageRect.top) / pageRect.height));
    const radius = Math.max(1, activeEraserSize) / pageRect.width;

    return {
      pageElement,
      pageNumber,
      pageRect,
      point: { x, y },
      radius,
      yScale: pageRect.height / pageRect.width,
    };
  }, [activeEraserSize, resolvePdfPageElementFromMouseEvent]);

  const eraseInkAtPoint = useCallback((input: {
    pageElement: HTMLElement;
    pageNumber: number;
    point: { x: number; y: number };
    radius: number;
    yScale: number;
  }) => {
    let changed = false;

    for (const annotation of inkAnnotations) {
      if (annotation.target.type !== "pdf") {
        continue;
      }

      const target = annotation.target as PdfTarget;
      if (target.page !== input.pageNumber) {
        continue;
      }

      const updated = updatePdfInkAnnotationAfterErase({
        annotation,
        point: input.point,
        radius: input.radius,
        yScale: input.yScale,
        mode: activeEraserMode,
      });

      if (!updated) {
        continue;
      }

      changed = true;

      if (updated.rects.length === 0) {
        deleteAnnotation(annotation.id);
        continue;
      }

      const parsed = parsePdfInkContent(updated.content);
      const preview = parsed
        ? buildPdfAnnotationPreviewFromPageElement(input.pageElement, updated.rects, {
            paddingRatio: 0.035,
            minCssWidth: 180,
            minCssHeight: 120,
            ink: {
              paths: parsed.paths,
              color: annotation.style.color,
              width: parsed.width,
            },
          })
        : undefined;

      updateAnnotation(annotation.id, {
        content: updated.content,
        target: {
          ...(annotation.target as PdfTarget),
          rects: updated.rects,
        },
        ...(preview ? { preview } : {}),
      });
    }

    return changed;
  }, [activeEraserMode, deleteAnnotation, inkAnnotations, updateAnnotation]);

  // Handle PDF click in note/text mode
  const handlePdfClick = useCallback(
    (event: React.MouseEvent) => {
      // Find the page element that was clicked
      const pageElement = resolvePdfPageElementFromMouseEvent(event);
      
      if (!pageElement) return;
      
      const pageNumber = getPdfPageNumberFromElement(pageElement);
      if (pageNumber === null) return;

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
    [activeTool, resolvePdfPageElementFromMouseEvent]
  );

  const handlePdfSurfaceClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    const annotation = findPdfAnnotationAtClientPoint(event);
    const clickFollowsTextDrag = Boolean(pointerGestureRef.current?.moved);
    const annotationShouldWinSingleClick = Boolean(
      annotation &&
      !clickFollowsTextDrag &&
      annotation.style.type !== "highlight" &&
      annotation.style.type !== "underline",
    );
    if (selection && !selection.isCollapsed && !annotationShouldWinSingleClick && (!annotation || clickFollowsTextDrag)) {
      return;
    }

    if (annotation) {
      if (activeTool === "eraser" && annotation.style.type === "ink") {
        if (annotationMenuState) {
          closeAnnotationMenu();
        }
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      clearTransientSelection({ nextPhase: "cancelled" });
      if (annotation.style.type === "text") {
        clearActiveAnnotationUi();
        openTextAnnotationEditor(annotation);
      } else {
        openAnnotationMenu(annotation);
      }
      return;
    }

    if (activeTool === 'note' || activeTool === 'text') {
      if (annotationMenuState) {
        closeAnnotationMenu();
      }
      handlePdfClick(event);
      return;
    }

    if (activeTool !== 'select' && activeTool !== 'highlight' && activeTool !== 'underline') {
      if (annotationMenuState) {
        closeAnnotationMenu();
      }
      return;
    }

    if (selectedAnnotationId) {
      if (annotationMenuState) {
        closeAnnotationMenu();
      } else {
        clearActiveAnnotationUi();
      }
      return;
    }

    if (selectedAnnotationId || highlightedId || hoveredAnnotationId || annotationAdjustmentDraft) {
      clearActiveAnnotationUi();
    }
    if (annotationMenuState) {
      closeAnnotationMenu();
    }
  }, [activeTool, annotationAdjustmentDraft, annotationMenuState, clearActiveAnnotationUi, clearTransientSelection, closeAnnotationMenu, findPdfAnnotationAtClientPoint, handlePdfClick, highlightedId, hoveredAnnotationId, openAnnotationMenu, openTextAnnotationEditor, selectedAnnotationId]);

  const resetAreaSelectionDraft = useCallback(() => {
    areaSelectionDocumentCleanupRef.current?.();
    areaSelectionDocumentCleanupRef.current = null;
    areaSelectionDraftRef.current = null;
    areaSelectionStartRef.current = null;
    areaSelectionPageElementRef.current = null;
    areaSelectionLastClientPointRef.current = null;
    setAreaSelectionDraft(null);
  }, []);

  const updateAreaSelectionDraftFromPoint = useCallback((clientX: number, clientY: number): boolean => {
    if (activeTool !== 'area') return false;
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
    const start = areaSelectionStartRef.current;
    const pageElement = areaSelectionPageElementRef.current;
    if (!start || !pageElement) return false;

    const pageNumber = getPdfPageNumberFromElement(pageElement);
    if (pageNumber === null) return false;
    const pageRect = pageElement.getBoundingClientRect();
    if (pageRect.width <= 0 || pageRect.height <= 0) return false;
    const currentX = Math.max(0, Math.min(pageRect.width, clientX - pageRect.left));
    const currentY = Math.max(0, Math.min(pageRect.height, clientY - pageRect.top));
    const draft = {
      page: pageNumber,
      left: Math.min(start.x, currentX),
      top: Math.min(start.y, currentY),
      width: Math.abs(currentX - start.x),
      height: Math.abs(currentY - start.y),
    };
    areaSelectionDraftRef.current = draft;
    areaSelectionLastClientPointRef.current = { x: clientX, y: clientY };
    setAreaSelectionDraft(draft);
    return true;
  }, [activeTool]);

  const commitAreaSelectionDraft = useCallback(() => {
    if (activeTool !== 'area') {
      resetAreaSelectionDraft();
      return;
    }
    const draft = areaSelectionDraftRef.current;
    const pageElement = areaSelectionPageElementRef.current;
    if (!draft || !pageElement) {
      resetAreaSelectionDraft();
      return;
    }

    const pageNumber = getPdfPageNumberFromElement(pageElement);
    if (pageNumber === null || pageNumber !== draft.page) {
      resetAreaSelectionDraft();
      return;
    }
    const pageRect = pageElement.getBoundingClientRect();
    const minimumSize = 4;
    if (pageRect.width <= 0 || pageRect.height <= 0 || draft.width < minimumSize || draft.height < minimumSize) {
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

  const handleAreaMouseDown = useCallback((event: React.MouseEvent) => {
    if (activeTool !== 'area') return;
    if (event.button !== 0) return;

    const pageElement = resolvePdfPageElementFromMouseEvent(event);
    if (!(pageElement instanceof HTMLElement)) return;

    const pageNumber = getPdfPageNumberFromElement(pageElement);
    if (pageNumber === null) return;
    const pageRect = pageElement.getBoundingClientRect();
    if (pageRect.width <= 0 || pageRect.height <= 0) return;
    const startX = Math.max(0, Math.min(pageRect.width, event.clientX - pageRect.left));
    const startY = Math.max(0, Math.min(pageRect.height, event.clientY - pageRect.top));

    areaSelectionPageElementRef.current = pageElement;
    areaSelectionStartRef.current = { x: startX, y: startY };
    areaSelectionLastClientPointRef.current = { x: event.clientX, y: event.clientY };
    areaSelectionDraftRef.current = {
      page: pageNumber,
      left: startX,
      top: startY,
      width: 0,
      height: 0,
    };
    setAreaSelectionDraft(areaSelectionDraftRef.current);

    areaSelectionDocumentCleanupRef.current?.();
    const handleDocumentMouseMove = (moveEvent: MouseEvent) => {
      if (updateAreaSelectionDraftFromPoint(moveEvent.clientX, moveEvent.clientY)) {
        moveEvent.preventDefault();
      }
    };
    const handleDocumentMouseUp = (upEvent: MouseEvent) => {
      const currentDraft = areaSelectionDraftRef.current;
      const start = areaSelectionStartRef.current;
      const lastPoint = areaSelectionLastClientPointRef.current;
      const hasNonZeroDraft = Boolean(currentDraft && currentDraft.width > 0 && currentDraft.height > 0);
      const hasMovedUpPoint = Boolean(
        start &&
        Number.isFinite(upEvent.clientX) &&
        Number.isFinite(upEvent.clientY) &&
        (upEvent.clientX !== 0 || upEvent.clientY !== 0) &&
        (!lastPoint || upEvent.clientX !== lastPoint.x || upEvent.clientY !== lastPoint.y),
      );
      if (!hasNonZeroDraft || hasMovedUpPoint) {
        handleDocumentMouseMove(upEvent);
      }
      commitAreaSelectionDraft();
    };
    const handleDocumentCancel = () => {
      resetAreaSelectionDraft();
    };
    document.addEventListener("mousemove", handleDocumentMouseMove, true);
    document.addEventListener("mouseup", handleDocumentMouseUp, true);
    window.addEventListener("blur", handleDocumentCancel, true);
    areaSelectionDocumentCleanupRef.current = () => {
      document.removeEventListener("mousemove", handleDocumentMouseMove, true);
      document.removeEventListener("mouseup", handleDocumentMouseUp, true);
      window.removeEventListener("blur", handleDocumentCancel, true);
    };

    event.preventDefault();
    event.stopPropagation();
  }, [
    activeTool,
    commitAreaSelectionDraft,
    resetAreaSelectionDraft,
    resolvePdfPageElementFromMouseEvent,
    updateAreaSelectionDraftFromPoint,
  ]);

  const handleAreaMouseMove = useCallback((event: React.MouseEvent) => {
    if (updateAreaSelectionDraftFromPoint(event.clientX, event.clientY)) {
      event.preventDefault();
    }
  }, [updateAreaSelectionDraftFromPoint]);

  const handleAreaMouseUp = useCallback(() => {
    commitAreaSelectionDraft();
  }, [commitAreaSelectionDraft]);

  useEffect(() => {
    if (activeTool !== 'area') {
      resetAreaSelectionDraft();
    }
  }, [activeTool, resetAreaSelectionDraft]);

  useEffect(() => () => {
    areaSelectionDocumentCleanupRef.current?.();
    areaSelectionDocumentCleanupRef.current = null;
  }, []);

  // Handle ink drawing start
  const handleInkMouseDown = useCallback((event: React.MouseEvent) => {
    if (activeTool !== 'ink') return;
    if (findPdfAnnotationAtClientPoint(event)) return;
    
    // Find the page element that was clicked
    const pageElement = resolvePdfPageElementFromMouseEvent(event);
    if (!pageElement) return;

    const pageNumber = getPdfPageNumberFromElement(pageElement);
    if (pageNumber === null) return;
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
  }, [activeTool, findPdfAnnotationAtClientPoint, resolvePdfPageElementFromMouseEvent]);

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
      width: activeInkWidth,
    };
    
    addInkStroke(stroke);
    
    // Clear current stroke state
    currentInkPageElementRef.current = null;
    currentInkPageRef.current = null;
    currentInkPathRef.current = [];
    setIsDrawingStroke(false);
    setCurrentInkPath([]);
    setCurrentInkPage(null);
  }, [isDrawingStroke, activeColor, activeInkWidth, addInkStroke]);

  const handleInkEraserMouseDown = useCallback((event: React.MouseEvent) => {
    if (activeTool !== "eraser") {
      return;
    }
    const annotation = findPdfAnnotationAtClientPoint(event);
    if (annotation && annotation.style.type !== "ink") {
      return;
    }

    const inkPoint = getInkPointFromMouseEvent(event);
    if (!inkPoint) {
      return;
    }

    isErasingInkRef.current = true;
    setIsErasingInk(true);
    setInkEraserCursor({
      page: inkPoint.pageNumber,
      x: inkPoint.point.x,
      y: inkPoint.point.y,
      radius: inkPoint.radius,
    });
    eraseInkAtPoint({
      pageElement: inkPoint.pageElement,
      pageNumber: inkPoint.pageNumber,
      point: inkPoint.point,
      radius: inkPoint.radius,
      yScale: inkPoint.yScale,
    });

    event.preventDefault();
    event.stopPropagation();
  }, [activeTool, eraseInkAtPoint, findPdfAnnotationAtClientPoint, getInkPointFromMouseEvent]);

  const handleInkEraserMouseMove = useCallback((event: React.MouseEvent) => {
    if (activeTool !== "eraser" && !isErasingInkRef.current) {
      return;
    }

    const inkPoint = getInkPointFromMouseEvent(event);
    if (!inkPoint) {
      return;
    }

    setInkEraserCursor({
      page: inkPoint.pageNumber,
      x: inkPoint.point.x,
      y: inkPoint.point.y,
      radius: inkPoint.radius,
    });

    if (isErasingInkRef.current) {
      eraseInkAtPoint({
        pageElement: inkPoint.pageElement,
        pageNumber: inkPoint.pageNumber,
        point: inkPoint.point,
        radius: inkPoint.radius,
        yScale: inkPoint.yScale,
      });
      event.preventDefault();
    }
  }, [activeTool, eraseInkAtPoint, getInkPointFromMouseEvent]);

  const handleInkEraserMouseUp = useCallback(() => {
    isErasingInkRef.current = false;
    setIsErasingInk(false);
  }, []);

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
        const container = getViewerScrollContainer();
        const firstPageElement = findPdfPageElementInScope(containerRef.current, 1);
        if (container && firstPageElement) {
          const firstPageRect = firstPageElement.getBoundingClientRect();
          const estimatedGap = Math.max(16, firstPageRect.height * 0.025);
          const estimatedPageStep = Math.max(1, firstPageRect.height + estimatedGap);
          container.scrollTo({
            top: Math.max(0, estimatedPageStep * (input.page - 1)),
            behavior: "auto",
          });
        }
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
  }, [buildPdfNavigationScrollTarget, cancelPendingAnnotationScroll, flashPdfElement, getViewerScrollContainer, scheduleTimeout, warmVisiblePages]);

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

  const jumpToPdfPage = useCallback((pageNumber: number, rects?: PdfSearchMatch["rects"]) => {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > numPages) {
      return;
    }

    schedulePdfTargetIntoViewAfterLayout({
      page: pageNumber,
      rects: pdfSearchRectsToTargetRects(rects),
      flashPage: true,
    });
  }, [numPages, schedulePdfTargetIntoViewAfterLayout]);

  useEffect(() => {
    if (!isDiagnosticsMode) {
      diagnosticScrollToPageRef.current = null;
      return;
    }

    diagnosticScrollToPageRef.current = (pageNumber: number) => {
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > numPages) {
        return false;
      }
      window.setTimeout(() => {
        setDiagnosticPinnedPages(new Set([pageNumber]));
        warmVisiblePages(pageNumber);
        const container = getViewerScrollContainer();
        if (!container) {
          return;
        }

        const targetPageElement = findPdfPageElementInScope(containerRef.current, pageNumber);
        const firstPageElement = findPdfPageElementInScope(containerRef.current, 1);
        if (targetPageElement) {
          const containerRect = container.getBoundingClientRect();
          const pageRect = targetPageElement.getBoundingClientRect();
          const targetTop = container.scrollTop +
            (pageRect.top - containerRect.top) -
            Math.max(0, (container.clientHeight - pageRect.height) / 2);
          container.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
          return;
        }

        if (firstPageElement) {
          const firstPageRect = firstPageElement.getBoundingClientRect();
          const estimatedPageStep = Math.max(1, firstPageRect.height + Math.max(16, firstPageRect.height * 0.025));
          container.scrollTo({
            top: Math.max(0, estimatedPageStep * (pageNumber - 1)),
            behavior: "auto",
          });
        }
      }, 0);
      return true;
    };

    return () => {
      diagnosticScrollToPageRef.current = null;
    };
  }, [getViewerScrollContainer, isDiagnosticsMode, numPages, warmVisiblePages]);

  // Handle sidebar annotation selection - scroll to exact annotation position
  const handleSidebarSelect = useCallback((annotation: AnnotationItem) => {
    const { annotationId, pdfTarget } = resolveSidebarSelectionTarget(annotation);
    setShowSidebar(true);
    setSelectedAnnotationId(annotationId);
    setHighlightedId(annotationId);

    if (pdfTarget) {
      schedulePdfTargetIntoViewAfterLayout({
        page: pdfTarget.page,
        rects: pdfTarget.rects,
      });
    }

    scheduleTimeout(() => setHighlightedId(null), 2500);
  }, [schedulePdfTargetIntoViewAfterLayout, scheduleTimeout]);

  // Handle sidebar delete
  const handleSidebarDelete = useCallback((id: string) => {
    deleteAnnotation(id);
    if (shouldClearSelectedAnnotationAfterDelete(selectedAnnotationId, id)) {
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
      onPointerDownCapture={handlePdfSurfacePointerDownCapture}
      onPointerMoveCapture={updateNativePdfSelectionDragPoint}
      onPointerUp={freezeNativePdfSelectionSnapshot}
      onDragStartCapture={handlePdfSurfaceDragStartCapture}
      onContextMenuCapture={handlePdfContextMenu}
      onClickCapture={handlePdfSurfaceClickCapture}
      onClick={handlePdfSurfaceClick}
      onMouseDown={
        activeTool === 'area'
          ? handleAreaMouseDown
          : activeTool === 'ink'
            ? handleInkMouseDown
            : activeTool === 'eraser'
              ? handleInkEraserMouseDown
              : undefined
      }
      onMouseMove={
        activeTool === 'area'
          ? handleAreaMouseMove
          : activeTool === 'ink' || isDrawingStroke
            ? handleInkMouseMove
            : activeTool === 'eraser' || isErasingInk
              ? handleInkEraserMouseMove
              : undefined
      }
      onMouseUp={
        activeTool === 'area'
          ? handleAreaMouseUp
          : activeTool === 'ink' || isDrawingStroke
            ? handleInkMouseUp
            : activeTool === 'eraser' || isErasingInk
              ? handleInkEraserMouseUp
              : undefined
      }
      onMouseLeave={
        activeTool === 'area'
          ? undefined
          : activeTool === 'ink' || isDrawingStroke
            ? handleInkMouseUp
            : activeTool === 'eraser' || isErasingInk
              ? handleInkEraserMouseUp
              : undefined
      }
      style={{
        cursor: activeTool === 'note'
          ? 'crosshair'
          : activeTool === 'area'
            ? 'crosshair'
            : activeTool === 'ink'
              ? 'crosshair'
              : activeTool === 'eraser'
                ? 'none'
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
          <PdfSearchOverlay
            key={`${paneId}:${searchOpen ? "open" : "closed"}`}
            pdfDocument={pdfDocument}
            fileHandle={fileHandle}
            numPages={numPages}
            onNavigateToPage={jumpToPdfPage}
            onActiveMatchChange={setActiveSearchMatch}
            isOpen={searchOpen}
            onClose={() => {
              setSearchOpen(false);
              setActiveSearchMatch(null);
            }}
          />
          {pdfDocument && numPages > 0 ? (
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
                      pdfDocument={pdfDocument}
                      pageNumber={pageNumber}
                      paneId={paneId}
                      scale={renderScale}
                      devicePixelRatio={pageDevicePixelRatio}
                      isVisible={renderedPages.has(pageNumber)}
                      renderCanvasLayer={!isDiagnosticsMode || isJsdomRuntime || pageNumber <= 2 || diagnosticPinnedPages.has(pageNumber)}
                      renderAnnotationLayer={!isDiagnosticsMode || isJsdomRuntime || diagnosticPinnedPages.has(pageNumber)}
                      transientSelection={visiblePdfSelection}
                      transientSelectionColor={transientSelectionColor}
                      transientSelectionStyleType={transientSelectionStyleType}
                      transientSelectionUnderlineStyle={activeUnderlineStyle}
                      measuredHeight={dimensions?.height ?? null}
                      measuredWidth={dimensions?.width ?? null}
                      onMeasure={handlePageMeasure}
                      onTextLayerReady={handleTextLayerReady}
                      observer={pageObserver}
                    />
                  );
                })}
              </div>
          ) : hasPdfFile ? (
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">{t("pdf.loading")}</span>
            </div>
          ) : null}
        </div>
      )}

      {storedPdfAnnotations.map((annotation) => {
        const target = annotation.target as PdfTarget;
        if (!renderedPages.has(target.page)) {
          return null;
        }
        return (
          <PdfStoredAnnotationPortal
            key={annotation.id}
            annotation={annotation}
            activeTool={activeTool}
            page={target.page}
            paneRootRef={containerRef}
            isActive={highlightedId === annotation.id || hoveredAnnotationId === annotation.id || selectedAnnotationId === annotation.id}
            onHoverChange={(isHovered) => setHoveredAnnotationId(isHovered ? annotation.id : null)}
            onClick={(effectiveAnnotation) => openAnnotationMenu(effectiveAnnotation)}
            getTextModelForPage={getRenderedPdfPageTextModelForPage}
            getTextMarkupView={getPdfTextMarkupView}
            adjustmentDraft={annotationAdjustmentDraft}
            areaAdjustmentDraft={areaAdjustmentDraft}
            showAreaAdjustmentHandles={selectedAnnotationId === annotation.id}
            onAdjustPointerDown={(side, event) => beginAnnotationBoundaryAdjustment(annotation, side, event)}
            onAreaAdjustPointerDown={(handle, event) => beginAreaAdjustment(annotation, handle, event)}
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
              onClose={closeAnnotationMenu}
              onDelete={() => {
                deleteAnnotation(annotation.id);
                if (selectedAnnotationId === annotation.id) {
                  setSelectedAnnotationId(null);
                }
              }}
              onAddComment={(comment) => updateAnnotation(annotation.id, { comment })}
              onChangeColor={(color) => updateAnnotation(annotation.id, { style: { color } })}
              onChangeUnderlineStyle={(style) => updateAnnotation(annotation.id, { style: { underlineStyle: style } })}
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

      {!hasPdfFile ? (
        <div className="flex items-center justify-center gap-2 py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">{t("pdf.loading")}</span>
        </div>
      ) : null}

      {activeSearchMatch ? (
        <PdfSearchMatchPortal
          match={activeSearchMatch}
          paneRootRef={containerRef}
        />
      ) : null}

      {inkAnnotations.map((ann) => {
        if (ann.target.type !== 'pdf') return null;
        const target = ann.target as PdfTarget;
        if (!renderedPages.has(target.page)) {
          return null;
        }
        return (
          <InkAnnotationPortal
            key={ann.id}
            annotation={ann}
            page={target.page}
            scale={renderScale}
            paneRootRef={containerRef}
            onClick={() => openAnnotationMenu(ann)}
          />
        );
      })}

      {pendingInkPages.map((page) => (
        renderedPages.has(page) ? (
          <PendingInkStrokesPortal
            key={`pending-ink-${page}`}
            strokes={pendingInkStrokes}
            page={page}
            scale={renderScale}
            paneRootRef={containerRef}
          />
        ) : null
      ))}

      {textAnnotations.map((ann) => {
        if (ann.target.type !== 'pdf') return null;
        const target = ann.target as PdfTarget;
        if (!renderedPages.has(target.page)) {
          return null;
        }
        return (
          <TextAnnotationPortal
            key={ann.id}
            annotation={ann}
            page={target.page}
            scale={renderScale}
            paneRootRef={containerRef}
            isHighlighted={highlightedId === ann.id || hoveredAnnotationId === ann.id || selectedAnnotationId === ann.id}
            onClick={() => {
              openTextAnnotationEditor(ann);
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
          strokeWidth={activeInkWidth}
          paneRootRef={containerRef}
        />
      )}

      <InkEraserCursorPortal
        point={activeTool === "eraser" ? inkEraserCursor : null}
        paneRootRef={containerRef}
      />

    </div>
  );

  return (
    <div
      ref={containerRef}
      className="lattice-pdf-viewer relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      data-file-id={fileId}
      data-pane-id={paneId}
      data-transient-selection-active={visiblePdfSelection ? "true" : "false"}
      data-testid={`pdf-pane-${paneId}`}
    >
      <SelectionContextMenu
        state={selectionMenuState}
        onClose={closeSelectionMenu}
        onOpenHub={(context, mode, returnFocusTo) => setSelectionHubState({ context, mode, returnFocusTo })}
      />

      {pdfContextMenu ? (
        <PdfViewerContextMenu
          state={pdfContextMenu}
          showSidebar={showSidebar}
          zoomMode={zoomMode}
          onClose={closePdfContextMenu}
          onCopySelection={() => {
            handlePdfCopy();
          }}
          onCopyPageReference={copyPdfPageReference}
          onOpenSearch={openPdfSearchFromContextMenu}
          onToggleSidebar={toggleSidebarFromContextMenu}
          onFitWidth={() => applyZoomMode("fit-width")}
          onFitPage={() => applyZoomMode("fit-page")}
          onResetZoom={resetZoom}
          onExportPdf={() => {
            void handleExportPdf();
          }}
        />
      ) : null}

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
          activeInkWidth={activeInkWidth}
          activeEraserMode={activeEraserMode}
          activeEraserSize={activeEraserSize}
          activeUnderlineStyle={activeUnderlineStyle}
          onSelectColor={setActiveColor}
          onSelectInkWidth={(width) => setInkCurrentStyle({ width })}
          onSelectEraserMode={setActiveEraserMode}
          onSelectEraserSize={setActiveEraserSize}
          onSelectUnderlineStyle={setActiveUnderlineStyle}
          onClose={() => setAnnotationDefaultsMenu(null)}
        />
      ) : null}

      {pendingSelectionDraft ? (
        <PdfSelectionDraftMenu
          selection={pendingSelectionDraft.selection}
          position={pendingSelectionDraft.position}
          anchorRect={pendingSelectionDraft.anchorRect}
          avoidRect={pendingSelectionDraft.avoidRect}
          onColorSelect={(color) => {
            const pageElement = findPdfPageElementInScope(containerRef.current, pendingSelectionDraft.selection.pageNumber);
            const normalizedSelection = normalizePdfResolvedSelectionViewportGeometry(
              pendingSelectionDraft.selection,
              pageElement,
            );
            const signature = buildPdfSelectionSignature({
              tool: "highlight",
              selection: normalizedSelection,
            });
            const snapshot = createPdfSelectionSnapshot({
              selection: normalizedSelection,
              signature,
            });
            const model = pageElement ? buildRenderedPdfPageTextModel(pageElement) : null;
            const annotationData = resolvedTextSelectionToAnnotationData({
              selection: normalizedSelection,
              color,
              author: 'user',
              styleType: 'highlight',
              model: selectionAlreadyHasPreciseTextMarkupGeometry(normalizedSelection) ||
                selectionAlreadyHasMultiLineTextMarkupGeometry(normalizedSelection)
                ? null
                : model,
            });
            const annotationId = addAnnotation(annotationData);
            setPendingSelectionDraft(null);
            dismissTransientSelectionTip();
            commitTextMarkupSelection({ snapshot, annotationId });
            clearNativePdfSelectionLater();
          }}
          onCancel={() => {
            clearTransientSelection({ nextPhase: 'cancelled' });
            clearNativePdfSelectionLater();
          }}
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
                      : activeTool === 'eraser'
                        ? t("pdf.eraserHint")
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
          <span data-testid={`pdf-selection-source-${paneId}`}>{visiblePdfSelection?.textQuote?.source ?? "none"}</span>
          <span data-testid={`pdf-selection-preview-${paneId}`}>{getPdfResolvedSelectionExactText(visiblePdfSelection)}</span>
          <span data-testid={`pdf-selection-page-count-${paneId}`}>{visiblePdfSelection?.pageNumbers.length ?? 0}</span>
          <span data-testid={`pdf-selection-viewport-rect-count-${paneId}`}>{visiblePdfSelection?.viewportRects.length ?? 0}</span>
          <span data-testid={`pdf-selection-overlay-rect-count-${paneId}`}>
            {visiblePdfSelection ? Object.values(visiblePdfSelection.overlayRectsByPage).reduce((count, rects) => count + rects.length, 0) : 0}
          </span>
          <span data-testid={`pdf-copy-payload-${paneId}`}>{diagnosticCopyPayload}</span>
          <button
            type="button"
            data-testid={`pdf-diagnostic-select-copy-${paneId}`}
            onClick={() => {
              scheduleDiagnosticPdfSelection("copy");
            }}
          >
            Diagnostic select copy
          </button>
          <button
            type="button"
            data-testid={`pdf-diagnostic-highlight-save-${paneId}`}
            onClick={() => {
              scheduleDiagnosticPdfSelection("highlight");
            }}
          >
            Diagnostic highlight save
          </button>
          <span data-testid={`pdf-diagnostic-selection-ok-${paneId}`}>{diagnosticSelectionResult?.ok ? "true" : "false"}</span>
          <span data-testid={`pdf-diagnostic-selection-text-${paneId}`}>{diagnosticSelectionResult?.text ?? ""}</span>
          <span data-testid={`pdf-diagnostic-selection-source-${paneId}`}>{diagnosticSelectionResult?.source ?? "none"}</span>
          <span data-testid={`pdf-diagnostic-selection-annotation-count-${paneId}`}>{diagnosticSelectionResult?.annotationCount ?? annotations.length}</span>
          <span data-testid={`pdf-diagnostic-selection-rect-count-${paneId}`}>{diagnosticSelectionResult?.rectCount ?? 0}</span>
          <span data-testid={`pdf-diagnostic-selection-rect-min-x1-${paneId}`}>{diagnosticSelectionResult?.rectMinX1 ?? -1}</span>
          <span data-testid={`pdf-diagnostic-selection-rect-max-x2-${paneId}`}>{diagnosticSelectionResult?.rectMaxX2 ?? -1}</span>
          <span data-testid={`pdf-file-ready-${paneId}`}>{hasPdfFile ? "true" : "false"}</span>
          <span data-testid={`pdf-file-source-${paneId}`}>{isDesktopUrlSource ? "desktop-url" : "buffer"}</span>
          <span data-testid={`pdf-file-input-kind-${paneId}`}>{pdfFileInputKind}</span>
          <span data-testid={`pdf-file-byte-length-${paneId}`}>{pdfFileByteLength}</span>
          <span data-testid={`pdf-worker-src-${paneId}`}>{reactPdfWorkerUrl}</span>
          <span data-testid={`pdf-blob-size-${paneId}`}>{pdfFileByteLength}</span>
          <span data-testid={`pdf-object-url-ready-${paneId}`}>{pdfSourceUrl || pdfObjectUrl ? "true" : "false"}</span>
          <span data-testid={`pdf-load-stage-${paneId}`}>{pdfLoadStage}</span>
          <span data-testid={`pdf-load-run-state-${paneId}`}>{pdfLoadRunState}</span>
          <span data-testid={`pdf-load-worker-state-${paneId}`}>{pdfLoadWorkerState}</span>
          <span data-testid={`pdf-load-progress-${paneId}`}>{pdfLoadProgress}</span>
          <span data-testid={`pdf-source-error-${paneId}`}>{pdfSourceError ?? ""}</span>
          <span data-testid={`pdf-reset-count-${paneId}`}>{pdfResetCount}</span>
          <span data-testid={`pdf-direct-probe-stage-${paneId}`}>{pdfDirectProbeStage}</span>
          <span data-testid={`pdf-direct-probe-pages-${paneId}`}>{pdfDirectProbePages}</span>
          <span data-testid={`pdf-direct-probe-error-${paneId}`}>{pdfDirectProbeError}</span>
          <span data-testid={`pdf-direct-probe-attempt-${paneId}`}>{pdfDirectProbeAttempt}</span>
          <span data-testid={`pdf-direct-probe-run-state-${paneId}`}>{pdfDirectProbeRunState}</span>
          <span data-testid={`pdf-num-pages-${paneId}`}>{numPages}</span>
          <span data-testid={`pdf-load-error-${paneId}`}>{pdfLoadError ?? ""}</span>
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
                setSidebarSizePreservingPdfAnchor(Math.min(42, Math.max(18, sizes[0])));
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
                  annotations={displayAnnotations}
                  isAnnotationsLoading={annotationsLoading}
                  manifest={pdfItemManifest}
                  pdfDocument={pdfDocument}
                />
                <div className="min-h-0 flex-1 overflow-hidden">
                  <PdfAnnotationSidebar
                    annotations={displayAnnotations}
                    isLoading={annotationsLoading}
                    viewState={pdfSidebarViewState}
                    onViewStateChange={handlePdfSidebarViewStateChange}
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
