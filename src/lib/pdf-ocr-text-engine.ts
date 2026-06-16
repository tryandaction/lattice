import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import { getDesktopPdfPath } from "@/lib/pdf-native-text-engine";
import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";
import { buildPdfTextKernelPage, type PdfTextKernelPage } from "@/lib/pdf-text-kernel";
import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";

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
    return cached;
  }

  const request = invokeTauriCommand<PdfOcrPageTextLayout>("desktop_ocr_pdf_page_text_layout", {
    path,
    pageNumber: input.pageNumber,
    options: {
      dpi: input.options?.dpi,
      language: input.options?.language,
      psm: input.options?.psm,
    },
  }, {
    timeoutMs: input.options?.timeoutMs ?? 90000,
  }).then((layout) => {
    const resolvedLayout = {
      ...layout,
      source: "ocr" as const,
    };
    desktopResolvedOcrPageLayoutCache.set(cacheKey, resolvedLayout);
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
  return desktopResolvedOcrPageLayoutCache.get(buildDesktopOcrCacheKey(path, input.pageNumber, input.options)) ?? null;
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
      left.top - right.top ||
      left.left - right.left
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
