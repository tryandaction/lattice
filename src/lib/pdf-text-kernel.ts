import type { BoundingBox, PdfTextQuote } from "@/types/universal-annotation";
import type { PdfCanonicalChar } from "@/lib/pdf-canonical-text-anchoring";
import {
  buildPdfCanonicalChars,
  buildPdfTextAnchorFromOffsets,
} from "@/lib/pdf-canonical-text-anchoring";
import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";

export const PDF_TEXT_KERNEL_MODEL_VERSION = 1;

export type PdfTextKernelSource = "pdfjs" | "pdfium" | "ocr";

export interface PdfTextKernelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PdfTextKernelQuad {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
  x4: number;
  y4: number;
}

export interface PdfTextKernelChar {
  charIndex: number;
  text: string;
  normalizedText: string;
  pdfRect: BoundingBox;
  pdfQuad: PdfTextKernelQuad;
  viewportRect: PdfTextKernelRect;
  source: PdfTextKernelSource;
  confidence: number;
  itemIndex: number;
  lineIndex?: number;
  wordIndex?: number;
  columnIndex?: number;
  spaceAfter: boolean;
  lineBreakAfter: boolean;
  wordBreakAfter: boolean;
  paragraphBreakAfter: boolean;
  fontSize?: number;
  baseline?: number;
}

export interface PdfTextKernelPage {
  modelVersion: number;
  pageNumber: number;
  pageText: string;
  normalizedText: string;
  viewportWidth: number;
  viewportHeight: number;
  source: PdfTextKernelSource;
  confidence: number;
  chars: PdfTextKernelChar[];
}

export interface PdfTextKernelAnchor {
  modelVersion: number;
  pageNumber: number;
  startCharIndex: number;
  endCharIndex: number;
  text: string;
  quote: PdfTextQuote;
  rects: BoundingBox[];
  quads: PdfTextKernelQuad[];
  source: PdfTextKernelSource;
  confidence: number;
}

interface PdfTextKernelPageCacheEntry {
  source: PdfTextKernelSource;
  confidence: number;
  page: PdfTextKernelPage;
}

let pdfTextKernelPageCache = new WeakMap<PdfPageTextModel, PdfTextKernelPageCacheEntry>();

function clampOffset(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function rectToPdfQuad(rect: BoundingBox): PdfTextKernelQuad {
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

function getKernelCharCenterY(char: PdfTextKernelChar): number {
  return char.viewportRect.top + (char.viewportRect.height / 2);
}

function areKernelCharsGeometricallyOnSameLine(left: PdfTextKernelChar, right: PdfTextKernelChar): boolean {
  const leftBottom = left.viewportRect.top + left.viewportRect.height;
  const rightBottom = right.viewportRect.top + right.viewportRect.height;
  const minHeight = Math.max(1, Math.min(left.viewportRect.height, right.viewportRect.height));
  const verticalOverlap = Math.min(leftBottom, rightBottom) - Math.max(left.viewportRect.top, right.viewportRect.top);
  const centerDistance = Math.abs(getKernelCharCenterY(left) - getKernelCharCenterY(right));
  if (verticalOverlap >= minHeight * 0.52 && centerDistance <= minHeight * 0.58) {
    return true;
  }

  const tolerance = Math.max(2.5, minHeight * 0.58);
  return centerDistance <= tolerance;
}

function areKernelCharsTooFarForSameLine(left: PdfTextKernelChar, right: PdfTextKernelChar): boolean {
  const leftBottom = left.viewportRect.top + left.viewportRect.height;
  const rightBottom = right.viewportRect.top + right.viewportRect.height;
  const maxHeight = Math.max(1, Math.max(left.viewportRect.height, right.viewportRect.height));
  const minHeight = Math.max(1, Math.min(left.viewportRect.height, right.viewportRect.height));
  const verticalGap = Math.max(0, Math.max(left.viewportRect.top, right.viewportRect.top) - Math.min(leftBottom, rightBottom));
  const centerDistance = Math.abs(getKernelCharCenterY(left) - getKernelCharCenterY(right));
  return verticalGap > maxHeight * 0.45 || centerDistance > maxHeight + minHeight * 0.5;
}

function areKernelCharsOnSameVisualLine(left: PdfTextKernelChar, right: PdfTextKernelChar): boolean {
  if ((left.columnIndex ?? 0) !== (right.columnIndex ?? 0)) {
    return false;
  }

  if (
    typeof left.lineIndex === "number" &&
    typeof right.lineIndex === "number"
  ) {
    return left.lineIndex === right.lineIndex &&
      !areKernelCharsTooFarForSameLine(left, right) &&
      areKernelCharsGeometricallyOnSameLine(left, right);
  }

  return areKernelCharsGeometricallyOnSameLine(left, right);
}

function compareKernelCharsByVisualOrder(left: PdfTextKernelChar, right: PdfTextKernelChar): number {
  if (areKernelCharsOnSameVisualLine(left, right)) {
    return (
      (left.wordIndex ?? 0) - (right.wordIndex ?? 0) ||
      left.charIndex - right.charIndex ||
      left.viewportRect.left - right.viewportRect.left
    );
  }

  const columnDiff = (left.columnIndex ?? 0) - (right.columnIndex ?? 0);
  if (columnDiff !== 0) {
    return columnDiff;
  }

  const centerDiff = getKernelCharCenterY(left) - getKernelCharCenterY(right);
  if (Math.abs(centerDiff) > Math.max(2.5, Math.min(left.viewportRect.height, right.viewportRect.height) * 0.6)) {
    return centerDiff;
  }

  return (
    (left.lineIndex ?? 0) - (right.lineIndex ?? 0) ||
    left.charIndex - right.charIndex ||
    left.viewportRect.left - right.viewportRect.left
  );
}

function groupKernelCharsByVisualLine(chars: PdfTextKernelChar[]): PdfTextKernelChar[][] {
  const groups: PdfTextKernelChar[][] = [];
  const visibleChars = [...chars]
    .filter((char) => char.normalizedText.length > 0 && !/^\s$/.test(char.normalizedText))
    .sort(compareKernelCharsByVisualOrder);

  for (const char of visibleChars) {
    const lastGroup = groups[groups.length - 1] ?? null;
    const lastChar = lastGroup?.[lastGroup.length - 1] ?? null;
    if (lastGroup && lastChar && areKernelCharsOnSameVisualLine(lastChar, char)) {
      lastGroup.push(char);
      continue;
    }

    groups.push([char]);
  }

  return groups;
}

export function buildPdfTextKernelRunRects(
  page: Pick<PdfTextKernelPage, "viewportWidth" | "viewportHeight">,
  chars: PdfTextKernelChar[],
): BoundingBox[] {
  const groups = groupKernelCharsByVisualLine(chars);
  const rects: BoundingBox[] = [];

  for (const group of groups) {
    const left = Math.min(...group.map((char) => char.viewportRect.left));
    const top = Math.min(...group.map((char) => char.viewportRect.top));
    const right = Math.max(...group.map((char) => char.viewportRect.left + char.viewportRect.width));
    const bottom = Math.max(...group.map((char) => char.viewportRect.top + char.viewportRect.height));
    const rect = {
      x1: Math.max(0, Math.min(1, left / page.viewportWidth)),
      y1: Math.max(0, Math.min(1, top / page.viewportHeight)),
      x2: Math.max(0, Math.min(1, right / page.viewportWidth)),
      y2: Math.max(0, Math.min(1, bottom / page.viewportHeight)),
    };

    if (rect.x2 > rect.x1 && rect.y2 > rect.y1) {
      rects.push(rect);
    }
  }

  return rects;
}

function resolveKernelQuoteSource(source: PdfTextKernelSource): PdfTextQuote["source"] {
  if (source === "pdfium") {
    return "pdfium-native";
  }
  if (source === "ocr") {
    return "ocr-text-model";
  }
  return "pdfjs-text-model";
}

function canonicalCharToKernelChar(input: {
  char: PdfCanonicalChar;
  chars: PdfCanonicalChar[];
  index: number;
  model: PdfPageTextModel;
  source: PdfTextKernelSource;
  confidence: number;
  wordIndex?: number;
}): PdfTextKernelChar {
  const nextChar = input.chars[input.index + 1] ?? null;
  const pdfRect = {
    x1: input.char.left / input.model.viewportWidth,
    y1: input.char.top / input.model.viewportHeight,
    x2: input.char.right / input.model.viewportWidth,
    y2: input.char.bottom / input.model.viewportHeight,
  };
  const nextText = nextChar?.text ?? "";
  const lineBreakAfter = Boolean(nextChar && input.char.lineIndex !== nextChar.lineIndex);
  const wordBreakAfter = /\s/.test(nextText) || lineBreakAfter;

  return {
    charIndex: input.char.normalizedStart,
    text: input.char.text,
    normalizedText: input.char.text,
    pdfRect,
    pdfQuad: rectToPdfQuad(pdfRect),
    viewportRect: {
      left: input.char.left,
      top: input.char.top,
      width: input.char.width,
      height: input.char.height,
    },
    source: input.source,
    confidence: input.confidence,
    itemIndex: input.char.itemIndex,
    lineIndex: input.char.lineIndex,
    wordIndex: input.wordIndex,
    columnIndex: input.char.columnIndex,
    spaceAfter: nextText === " ",
    lineBreakAfter,
    wordBreakAfter,
    paragraphBreakAfter: Boolean(nextChar && input.char.blockIndex !== nextChar.blockIndex),
    fontSize: input.char.height,
    baseline: input.char.bottom,
  };
}

function buildPdfKernelWordIndexMap(chars: PdfCanonicalChar[]): Map<number, number> {
  const wordIndexes = new Map<number, number>();
  let currentWordIndex = -1;
  let inWord = false;

  chars.forEach((char) => {
    if (/\s/.test(char.text)) {
      inWord = false;
      return;
    }

    if (!inWord) {
      currentWordIndex += 1;
      inWord = true;
    }

    wordIndexes.set(char.normalizedStart, currentWordIndex);
  });

  return wordIndexes;
}

export function buildPdfTextKernelPage(input: {
  model: PdfPageTextModel;
  source?: PdfTextKernelSource;
  confidence?: number;
}): PdfTextKernelPage {
  const source = input.source ?? "pdfjs";
  const confidence = input.confidence ?? 1;
  const cached = pdfTextKernelPageCache.get(input.model);
  if (cached && cached.source === source && cached.confidence === confidence) {
    return cached.page;
  }

  const canonicalChars = buildPdfCanonicalChars(input.model);
  const wordIndexes = buildPdfKernelWordIndexMap(canonicalChars);
  const chars = canonicalChars.map((char, index) => canonicalCharToKernelChar({
    char,
    chars: canonicalChars,
    index,
    model: input.model,
    source,
    confidence,
    wordIndex: wordIndexes.get(char.normalizedStart),
  }));

  const page = {
    modelVersion: PDF_TEXT_KERNEL_MODEL_VERSION,
    pageNumber: input.model.pageNumber,
    pageText: input.model.normalizedText,
    normalizedText: input.model.normalizedText,
    viewportWidth: input.model.viewportWidth,
    viewportHeight: input.model.viewportHeight,
    source,
    confidence,
    chars,
  };
  pdfTextKernelPageCache.set(input.model, {
    source,
    confidence,
    page,
  });
  return page;
}

export function clearPdfTextKernelPageCache(model?: PdfPageTextModel): void {
  if (model) {
    pdfTextKernelPageCache.delete(model);
    return;
  }
  pdfTextKernelPageCache = new WeakMap<PdfPageTextModel, PdfTextKernelPageCacheEntry>();
}

export function getPdfTextKernelRangeText(
  page: PdfTextKernelPage,
  startCharIndex: number,
  endCharIndex: number,
): string {
  const start = clampOffset(Math.min(startCharIndex, endCharIndex), page.normalizedText.length);
  const end = clampOffset(Math.max(startCharIndex, endCharIndex), page.normalizedText.length);
  return page.normalizedText.slice(start, end);
}

export function buildPdfTextKernelAnchor(input: {
  page: PdfTextKernelPage;
  model: PdfPageTextModel;
  startCharIndex: number;
  endCharIndex: number;
  fallbackRects?: BoundingBox[];
}): PdfTextKernelAnchor | null {
  const anchor = buildPdfTextAnchorFromOffsets({
    model: input.model,
    startOffset: input.startCharIndex,
    endOffset: input.endCharIndex,
    source: resolveKernelQuoteSource(input.page.source),
    fallbackRects: input.fallbackRects,
  });
  if (!anchor) {
    return null;
  }

  const selectedChars = input.page.chars.filter((char) => (
    char.charIndex >= anchor.startOffset && char.charIndex < anchor.endOffset
  ));
  const rebuiltRects = buildPdfTextKernelRunRects(input.page, selectedChars);
  const rects = rebuiltRects.length > 0 ? rebuiltRects : anchor.rects;
  const confidence = selectedChars.length > 0
    ? selectedChars.reduce((sum, char) => sum + char.confidence, 0) / selectedChars.length
    : input.page.confidence;

  return {
    modelVersion: input.page.modelVersion,
    pageNumber: input.page.pageNumber,
    startCharIndex: anchor.startOffset,
    endCharIndex: anchor.endOffset,
    text: anchor.textQuote.exact,
    quote: anchor.textQuote,
    rects,
    quads: rects.map(rectToPdfQuad),
    source: input.page.source,
    confidence,
  };
}
