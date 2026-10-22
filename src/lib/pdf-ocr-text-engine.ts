import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import { getDesktopPdfPath } from "@/lib/pdf-native-text-engine";
import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";
import {
  buildPdfTextKernelAnchor,
  buildPdfTextKernelPage,
  type PdfTextKernelPage,
} from "@/lib/pdf-text-kernel";
import {
  resolvePdfPointerBoundary,
  trimPdfOffsetsToText,
} from "@/lib/pdf-canonical-text-anchoring";
import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";
import type { BoundingBox, PdfTextQuote } from "@/types/universal-annotation";

export interface PdfOcrWord {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
  lineIndex?: number;
  wordIndex?: number;
}

export interface PdfOcrPageTextLayout {
  source: "ocr";
  pageNumber: number;
  width: number;
  height: number;
  text: string;
  words: PdfOcrWord[];
  confidence: number;
}

export interface PdfOcrPageRequest {
  pageNumber: number;
  width: number;
  height: number;
  image: Blob | ImageData | HTMLCanvasElement;
}

export interface PdfOcrPointerSelection {
  pageNumber: number;
  startOffset: number;
  endOffset: number;
  text: string;
  textQuote: PdfTextQuote;
  pageRects: BoundingBox[];
  viewportRects: Array<{
    pageNumber: number;
    left: number;
    top: number;
    width: number;
    height: number;
  }>;
  textKernelVersion: number;
  textSource: "ocr-text-model";
  textConfidence: number;
}

export type PdfOcrPageProvider = (request: PdfOcrPageRequest) => Promise<PdfOcrPageTextLayout | null>;

export interface DesktopPdfOcrOptions {
  dpi?: number;
  language?: string;
  psm?: number;
  timeoutMs?: number;
}

let ocrPageProvider: PdfOcrPageProvider | null = null;
const desktopOcrPageLayoutCache = new Map<string, Promise<PdfOcrPageTextLayout | null>>();
const desktopResolvedOcrPageLayoutCache = new Map<string, PdfOcrPageTextLayout>();
const desktopOcrTaskQueue: Array<() => void> = [];
const MAX_CONCURRENT_DESKTOP_OCR_TASKS = 2;
const MAX_RESOLVED_DESKTOP_OCR_PAGES = 24;
let activeDesktopOcrTaskCount = 0;

function scheduleDesktopOcrTask<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeDesktopOcrTaskCount += 1;
      void task()
        .then(resolve, reject)
        .finally(() => {
          activeDesktopOcrTaskCount = Math.max(0, activeDesktopOcrTaskCount - 1);
          desktopOcrTaskQueue.shift()?.();
        });
    };

    if (activeDesktopOcrTaskCount < MAX_CONCURRENT_DESKTOP_OCR_TASKS) {
      run();
    } else {
      desktopOcrTaskQueue.push(run);
    }
  });
}

function touchDesktopOcrCacheEntry(cacheKey: string): void {
  const request = desktopOcrPageLayoutCache.get(cacheKey);
  if (request) {
    desktopOcrPageLayoutCache.delete(cacheKey);
    desktopOcrPageLayoutCache.set(cacheKey, request);
  }
  const resolved = desktopResolvedOcrPageLayoutCache.get(cacheKey);
  if (resolved) {
    desktopResolvedOcrPageLayoutCache.delete(cacheKey);
    desktopResolvedOcrPageLayoutCache.set(cacheKey, resolved);
  }
}

function trimResolvedDesktopOcrCache(): void {
  while (desktopResolvedOcrPageLayoutCache.size > MAX_RESOLVED_DESKTOP_OCR_PAGES) {
    const oldestKey = desktopResolvedOcrPageLayoutCache.keys().next().value as string | undefined;
    if (!oldestKey) {
      return;
    }
    desktopResolvedOcrPageLayoutCache.delete(oldestKey);
    desktopOcrPageLayoutCache.delete(oldestKey);
  }
}

function normalizeDesktopPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function buildDesktopOcrCacheKey(path: string, pageNumber: number, options?: DesktopPdfOcrOptions): string {
  return JSON.stringify({
    path: normalizeDesktopPath(path),
    pageNumber,
    dpi: options?.dpi ?? 220,
    language: options?.language ?? "eng",
    psm: options?.psm ?? 6,
  });
}

export function registerPdfOcrPageProvider(provider: PdfOcrPageProvider | null): void {
  ocrPageProvider = provider;
}

export function hasPdfOcrPageProvider(): boolean {
  return ocrPageProvider !== null;
}

export function shouldUsePdfOcrFallback(input: {
  textLength: number;
  textItemCount: number;
  minTextLength?: number;
  minTextItemCount?: number;
}): boolean {
  return (
    input.textLength < (input.minTextLength ?? 12) ||
    input.textItemCount < (input.minTextItemCount ?? 2)
  );
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export async function getDesktopPdfOcrPageTextLayout(input: {
  fileHandle: FileSystemFileHandle | null | undefined;
  pageNumber: number;
  options?: DesktopPdfOcrOptions;
  forceRefresh?: boolean;
}): Promise<PdfOcrPageTextLayout | null> {
  if (!isTauriHost() || input.pageNumber < 1) {
    return null;
  }

  const path = getDesktopPdfPath(input.fileHandle);
  if (!path) {
    return null;
  }

  const cacheKey = buildDesktopOcrCacheKey(path, input.pageNumber, input.options);
  if (input.forceRefresh) {
    desktopOcrPageLayoutCache.delete(cacheKey);
  }

  const cached = desktopOcrPageLayoutCache.get(cacheKey);
  if (cached) {
    touchDesktopOcrCacheEntry(cacheKey);
    return cached;
  }

  const request = scheduleDesktopOcrTask(() => invokeTauriCommand<PdfOcrPageTextLayout>("desktop_ocr_pdf_page_text_layout", {
      path,
      pageNumber: input.pageNumber,
      options: {
        dpi: input.options?.dpi,
        language: input.options?.language,
        psm: input.options?.psm,
      },
    }, {
      timeoutMs: input.options?.timeoutMs ?? 90000,
    })).then((layout) => {
    const resolvedLayout = {
      ...layout,
      source: "ocr" as const,
    };
    desktopResolvedOcrPageLayoutCache.set(cacheKey, resolvedLayout);
    touchDesktopOcrCacheEntry(cacheKey);
    trimResolvedDesktopOcrCache();
    return resolvedLayout;
  }).catch((error) => {
    desktopOcrPageLayoutCache.delete(cacheKey);
    desktopResolvedOcrPageLayoutCache.delete(cacheKey);
    console.warn("Desktop PDF OCR fallback failed", error);
    return null;
  });

  desktopOcrPageLayoutCache.set(cacheKey, request);
  return request;
}

export function createDesktopPdfOcrPageProvider(
  fileHandle: FileSystemFileHandle | null | undefined,
  options?: DesktopPdfOcrOptions,
): PdfOcrPageProvider {
  return async (request) => getDesktopPdfOcrPageTextLayout({
    fileHandle,
    pageNumber: request.pageNumber,
    options,
  });
}

export function peekDesktopPdfOcrPageTextLayout(input: {
  fileHandle: FileSystemFileHandle | null | undefined;
  pageNumber: number;
  options?: DesktopPdfOcrOptions;
}): PdfOcrPageTextLayout | null {
  const path = getDesktopPdfPath(input.fileHandle);
  if (!path || input.pageNumber < 1) {
    return null;
  }
  const cacheKey = buildDesktopOcrCacheKey(path, input.pageNumber, input.options);
  const layout = desktopResolvedOcrPageLayoutCache.get(cacheKey) ?? null;
  if (layout) {
    touchDesktopOcrCacheEntry(cacheKey);
  }
  return layout;
}

export function prefetchDesktopPdfOcrPageTextLayout(input: {
  fileHandle: FileSystemFileHandle | null | undefined;
  pageNumber: number;
  options?: DesktopPdfOcrOptions;
}): void {
  void getDesktopPdfOcrPageTextLayout(input).catch(() => undefined);
}

export function clearDesktopPdfOcrPageTextLayoutCache(): void {
  desktopOcrPageLayoutCache.clear();
  desktopResolvedOcrPageLayoutCache.clear();
}

export function buildPdfPageTextModelFromOcrLayout(layout: PdfOcrPageTextLayout): PdfPageTextModel | null {
  const validWords = layout.words
    .filter((word) => word.text.trim().length > 0 && word.width > 0 && word.height > 0)
    .sort((left, right) => (
      (left.lineIndex ?? 0) - (right.lineIndex ?? 0) ||
      left.left - right.left ||
      left.top - right.top ||
      (left.wordIndex ?? 0) - (right.wordIndex ?? 0)
    ));
  if (validWords.length === 0 || layout.width <= 0 || layout.height <= 0) {
    return null;
  }

  let normalizedText = "";
  const items: TextItem[] = [];
  const segments: PdfPageTextModel["segments"] = [];
  const itemRects: PdfPageTextModel["itemRects"] = [];
  validWords.forEach((word, itemIndex) => {
    const lineBreak = itemIndex > 0 && (word.lineIndex ?? itemIndex) !== (validWords[itemIndex - 1].lineIndex ?? itemIndex - 1);
    if (normalizedText.length > 0) {
      normalizedText += " ";
    }
    const pageTextStart = normalizedText.length;
    normalizedText += word.text.trim();
    const pageTextEnd = normalizedText.length;
    const fontSize = Math.max(1, word.height);
    items.push({
      str: word.text.trim(),
      dir: "ltr",
      transform: [fontSize, 0, 0, fontSize, word.left, word.top + word.height],
      width: word.width,
      height: word.height,
      fontName: "ocr",
      hasEOL: lineBreak,
    } as TextItem);
    segments.push({
      itemIndex,
      text: word.text.trim(),
      normalizedText: word.text.trim(),
      hasEOL: lineBreak,
      pageTextStart,
      pageTextEnd,
      lineIndex: word.lineIndex,
      layoutClass: "main",
    });
    itemRects.push({
      itemIndex,
      left: word.left,
      top: word.top,
      width: word.width,
      height: word.height,
    });
  });

  return {
    pageNumber: layout.pageNumber,
    viewportWidth: layout.width,
    viewportHeight: layout.height,
    textContent: {
      items,
      styles: {},
      lang: null,
    } as TextContent,
    items,
    segments,
    itemRects,
    normalizedText,
  };
}

export function resolvePdfOcrSelectionFromPointer(input: {
  layout: PdfOcrPageTextLayout;
  pageRect: DOMRect;
  dragStartPoint: { x: number; y: number };
  dragEndPoint: { x: number; y: number };
}): PdfOcrPointerSelection | null {
  const model = buildPdfPageTextModelFromOcrLayout(input.layout);
  if (!model || input.pageRect.width <= 0 || input.pageRect.height <= 0) {
    return null;
  }

  const toModelPoint = (point: { x: number; y: number }) => ({
    x: ((point.x - input.pageRect.left) / input.pageRect.width) * model.viewportWidth,
    y: ((point.y - input.pageRect.top) / input.pageRect.height) * model.viewportHeight,
  });
  const modelPageRect = new DOMRect(0, 0, model.viewportWidth, model.viewportHeight);
  const modelStartPoint = toModelPoint(input.dragStartPoint);
  const modelEndPoint = toModelPoint(input.dragEndPoint);
  const startBoundary = resolvePdfPointerBoundary({
    model,
    point: modelStartPoint,
    pageRect: modelPageRect,
    side: "start",
  });
  if (!startBoundary) {
    return null;
  }
  const sortedWordHeights = input.layout.words
    .map((word) => word.height)
    .filter((height) => Number.isFinite(height) && height > 0)
    .sort((left, right) => left - right);
  const typicalWordHeight = sortedWordHeights[Math.floor(sortedWordHeights.length / 2)] ?? 12;
  const isNearHorizontalDrag = Math.abs(modelEndPoint.y - modelStartPoint.y) <= Math.max(4, typicalWordHeight * 0.75);
  const endBoundary = resolvePdfPointerBoundary({
    model,
    point: modelEndPoint,
    pageRect: modelPageRect,
    side: "end",
    preferredLayoutClass: startBoundary.layoutClass,
    preferredLineIndex: isNearHorizontalDrag ? startBoundary.lineIndex : undefined,
    preferredBlockIndex: startBoundary.blockIndex,
    preferredColumnIndex: startBoundary.columnIndex,
  });
  if (!endBoundary) {
    return null;
  }

  const offsets = trimPdfOffsetsToText(
    model.normalizedText,
    Math.min(startBoundary.offset, endBoundary.offset),
    Math.max(startBoundary.offset, endBoundary.offset),
  );
  if (!offsets) {
    return null;
  }

  const page = buildPdfTextKernelPage({
    model,
    source: "ocr",
    confidence: clampConfidence(input.layout.confidence),
  });
  const anchor = buildPdfTextKernelAnchor({
    page,
    model,
    startCharIndex: offsets.startOffset,
    endCharIndex: offsets.endOffset,
  });
  if (!anchor || anchor.rects.length === 0) {
    return null;
  }

  const viewportRects = anchor.rects.map((rect) => ({
    pageNumber: input.layout.pageNumber,
    left: rect.x1 * input.pageRect.width,
    top: rect.y1 * input.pageRect.height,
    width: Math.max(0, (rect.x2 - rect.x1) * input.pageRect.width),
    height: Math.max(0, (rect.y2 - rect.y1) * input.pageRect.height),
  }));

  return {
    pageNumber: input.layout.pageNumber,
    startOffset: anchor.startCharIndex,
    endOffset: anchor.endCharIndex,
    text: anchor.text,
    textQuote: anchor.quote,
    pageRects: anchor.rects,
    viewportRects,
    textKernelVersion: anchor.modelVersion,
    textSource: "ocr-text-model",
    textConfidence: anchor.confidence,
  };
}

export async function getPdfOcrPageTextKernel(input: PdfOcrPageRequest): Promise<PdfTextKernelPage | null> {
  if (!ocrPageProvider) {
    return null;
  }

  const layout = await ocrPageProvider(input);
  if (!layout) {
    return null;
  }

  const model = buildPdfPageTextModelFromOcrLayout({
    ...layout,
    confidence: clampConfidence(layout.confidence),
    words: layout.words.map((word) => ({
      ...word,
      confidence: clampConfidence(word.confidence),
    })),
  });
  if (!model) {
    return null;
  }

  return buildPdfTextKernelPage({
    model,
    source: "ocr",
    confidence: clampConfidence(layout.confidence),
  });
}
