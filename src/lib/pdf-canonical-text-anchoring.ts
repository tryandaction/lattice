import type { BoundingBox, PdfTextQuote } from "@/types/universal-annotation";
import type {
  PdfPageTextItemRect,
  PdfPageTextLayoutClass,
  PdfPageTextModel,
} from "@/lib/pdf-page-text-cache";

const PDF_TEXT_CONTEXT_RADIUS = 32;
const MAIN_LAYOUT_PRIORITY: Record<PdfPageTextLayoutClass, number> = {
  main: 0,
  list: 1,
  caption: 2,
  footnote: 3,
  metadata: 4,
  auxiliary: 5,
  equation: 6,
  sidebar: 7,
};

export interface PdfCanonicalChar {
  normalizedStart: number;
  normalizedEnd: number;
  text: string;
  itemIndex: number;
  lineIndex?: number;
  blockIndex?: number;
  columnIndex?: number;
  layoutClass: PdfPageTextLayoutClass;
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

export interface PdfCanonicalBoundary {
  offset: number;
  x: number;
  y: number;
  height: number;
  lineIndex?: number;
  blockIndex?: number;
  columnIndex?: number;
  layoutClass: PdfPageTextLayoutClass;
}

export interface PdfCanonicalPointerBoundaryResult {
  offset: number;
  layoutClass: PdfPageTextLayoutClass;
  lineIndex?: number;
  blockIndex?: number;
  columnIndex?: number;
}

function normalizeText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function compactText(text: string): string {
  return normalizeText(text).replace(/\s+/g, "");
}

function clampOffset(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function buildTextQuote(
  pageText: string,
  startOffset: number,
  endOffset: number,
  exact: string,
  source: PdfTextQuote["source"],
): PdfTextQuote {
  return {
    exact,
    prefix: pageText.slice(Math.max(0, startOffset - PDF_TEXT_CONTEXT_RADIUS), startOffset),
    suffix: pageText.slice(endOffset, endOffset + PDF_TEXT_CONTEXT_RADIUS),
    source,
    confidence: "exact",
  };
}

function resolveRawRangeForNormalizedOffsets(input: {
  rawToNormalizedOffsets?: number[];
  localStart: number;
  localEnd: number;
}): { rawStart: number; rawEnd: number } | null {
  const offsets = input.rawToNormalizedOffsets;
  if (!offsets || offsets.length === 0) {
    return null;
  }

  let rawStart = -1;
  for (let index = 0; index < offsets.length - 1; index += 1) {
    if (offsets[index] === input.localStart && offsets[index + 1] > offsets[index]) {
      rawStart = index;
      break;
    }
  }
  if (rawStart < 0) {
    return null;
  }

  let rawEnd = rawStart + 1;
  while (rawEnd < offsets.length && offsets[rawEnd] < input.localEnd) {
    rawEnd += 1;
  }
  if (rawEnd <= rawStart) {
    return null;
  }

  return { rawStart, rawEnd };
}

function measureRenderedCharRect(input: {
  model: PdfPageTextModel;
  segment: PdfPageTextModel["segments"][number];
  itemRect: PdfPageTextItemRect;
  localStart: number;
  localEnd: number;
}): { left: number; top: number; width: number; height: number } | null {
  if (!(input.segment.textNode instanceof Text) || !input.segment.textNode.parentElement) {
    return null;
  }

  const rawRange = resolveRawRangeForNormalizedOffsets({
    rawToNormalizedOffsets: input.segment.rawToNormalizedOffsets,
    localStart: input.localStart,
    localEnd: input.localEnd,
  });
  if (!rawRange) {
    return null;
  }

  const range = document.createRange();
  range.setStart(input.segment.textNode, rawRange.rawStart);
  range.setEnd(input.segment.textNode, rawRange.rawEnd);
  const parentRect = input.segment.textNode.parentElement.getBoundingClientRect();
  const measuredRect = Array.from(range.getClientRects()).find((rect) => rect.width > 0 && rect.height > 0)
    ?? range.getBoundingClientRect();
  if (measuredRect.width <= 0 || measuredRect.height <= 0) {
    return null;
  }

  return {
    left: input.itemRect.left + (measuredRect.left - parentRect.left),
    top: input.itemRect.top + (measuredRect.top - parentRect.top),
    width: measuredRect.width,
    height: measuredRect.height,
  };
}

function getItemRectMap(model: PdfPageTextModel): Map<number, PdfPageTextItemRect> {
  return new Map(model.itemRects.map((rect) => [rect.itemIndex, rect]));
}

function getSegmentLayoutClass(segment: PdfPageTextModel["segments"][number]): PdfPageTextLayoutClass {
  return segment.layoutClass ?? "main";
}

export function buildPdfCanonicalChars(model: PdfPageTextModel): PdfCanonicalChar[] {
  const itemRectMap = getItemRectMap(model);
  const chars: PdfCanonicalChar[] = [];

  model.segments.forEach((segment) => {
    const itemRect = itemRectMap.get(segment.itemIndex);
    const segmentLength = segment.pageTextEnd - segment.pageTextStart;
    if (!itemRect || itemRect.width <= 0 || itemRect.height <= 0 || segmentLength <= 0) {
      return;
    }

    for (let offset = segment.pageTextStart; offset < segment.pageTextEnd; offset += 1) {
      const character = model.normalizedText[offset] ?? "";
      if (!character) {
        continue;
      }

      const localStart = offset - segment.pageTextStart;
      const localEnd = localStart + 1;
      const measuredRect = measureRenderedCharRect({
        model,
        segment,
        itemRect,
        localStart,
        localEnd,
      });
      const startRatio = localStart / segmentLength;
      const endRatio = localEnd / segmentLength;
      const left = measuredRect?.left ?? (itemRect.left + (itemRect.width * startRatio));
      const width = measuredRect?.width ?? Math.max(0, itemRect.width * (endRatio - startRatio));
      const top = measuredRect?.top ?? itemRect.top;
      const height = measuredRect?.height ?? itemRect.height;
      if (width <= 0 || height <= 0) {
        continue;
      }

      chars.push({
        normalizedStart: offset,
        normalizedEnd: offset + 1,
        text: character,
        itemIndex: segment.itemIndex,
        lineIndex: segment.lineIndex,
        blockIndex: segment.blockIndex,
        columnIndex: segment.columnIndex,
        layoutClass: getSegmentLayoutClass(segment),
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        centerX: left + (width / 2),
        centerY: top + (height / 2),
      });
    }
  });

  return chars.sort((left, right) => left.normalizedStart - right.normalizedStart);
}

export function buildPdfCanonicalBoundaries(chars: PdfCanonicalChar[]): PdfCanonicalBoundary[] {
  const boundaries = new Map<string, PdfCanonicalBoundary>();

  chars.forEach((char) => {
    const startKey = `${char.normalizedStart}:start`;
    if (!boundaries.has(startKey)) {
      boundaries.set(startKey, {
        offset: char.normalizedStart,
        x: char.left,
        y: char.top,
        height: char.height,
        lineIndex: char.lineIndex,
        blockIndex: char.blockIndex,
        columnIndex: char.columnIndex,
        layoutClass: char.layoutClass,
      });
    }

    const endKey = `${char.normalizedEnd}:end`;
    boundaries.set(endKey, {
      offset: char.normalizedEnd,
      x: char.right,
      y: char.top,
      height: char.height,
      lineIndex: char.lineIndex,
      blockIndex: char.blockIndex,
      layoutClass: char.layoutClass,
    });
  });

  return [...boundaries.values()].sort((left, right) => left.offset - right.offset || left.x - right.x);
}

function getVerticalDistance(char: Pick<PdfCanonicalChar, "top" | "bottom">, localY: number): number {
  if (localY >= char.top && localY <= char.bottom) {
    return 0;
  }

  return Math.min(
    Math.abs(localY - char.top),
    Math.abs(localY - char.bottom),
  );
}

function choosePreferredLayoutClass(chars: PdfCanonicalChar[]): PdfPageTextLayoutClass {
  const counts = new Map<PdfPageTextLayoutClass, number>();
  chars.forEach((char) => {
    counts.set(char.layoutClass, (counts.get(char.layoutClass) ?? 0) + 1);
  });

  return [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return MAIN_LAYOUT_PRIORITY[left[0]] - MAIN_LAYOUT_PRIORITY[right[0]];
  })[0]?.[0] ?? "main";
}

function filterCharsByLayoutPriority(input: {
  chars: PdfCanonicalChar[];
  preferredLayoutClass?: PdfPageTextLayoutClass;
  preferredBlockIndex?: number;
  preferredColumnIndex?: number;
  fallbackRange?: { startOffset: number; endOffset: number };
}): PdfCanonicalChar[] {
  if (input.chars.length === 0) {
    return input.chars;
  }

  const byRange = input.fallbackRange
    ? input.chars.filter((char) => (
        char.normalizedEnd > input.fallbackRange!.startOffset &&
        char.normalizedStart < input.fallbackRange!.endOffset
      ))
    : input.chars;

  const preferredLayoutClass = input.preferredLayoutClass
    ?? choosePreferredLayoutClass(byRange.length > 0 ? byRange : input.chars);
  const sameLayout = input.chars.filter((char) => char.layoutClass === preferredLayoutClass);
  if (sameLayout.length === 0) {
    return input.chars;
  }

  if (typeof input.preferredColumnIndex === "number") {
    const sameColumn = sameLayout.filter((char) => char.columnIndex === input.preferredColumnIndex);
    if (sameColumn.length > 0) {
      if (typeof input.preferredBlockIndex === "number") {
        const sameBlock = sameColumn.filter((char) => char.blockIndex === input.preferredBlockIndex);
        if (sameBlock.length > 0) {
          return sameBlock;
        }
      }
      return sameColumn;
    }
  }

  if (typeof input.preferredBlockIndex === "number") {
    const sameBlock = sameLayout.filter((char) => char.blockIndex === input.preferredBlockIndex);
    if (sameBlock.length > 0) {
      return sameBlock;
    }
  }

  return sameLayout;
}

export function resolvePdfPointerBoundary(input: {
  model: PdfPageTextModel;
  point: { x: number; y: number };
  pageRect: DOMRect;
  side: "start" | "end";
  currentAnchor?: { startOffset: number; endOffset: number } | null;
  preferredLayoutClass?: PdfPageTextLayoutClass;
  preferredBlockIndex?: number;
  preferredColumnIndex?: number;
}): PdfCanonicalPointerBoundaryResult | null {
  const chars = buildPdfCanonicalChars(input.model);
  if (chars.length === 0) {
    return null;
  }
  const boundaries = buildPdfCanonicalBoundaries(chars);
  if (boundaries.length === 0) {
    return null;
  }

  const localX = input.point.x - input.pageRect.left;
  const localY = input.point.y - input.pageRect.top;
  const scopedChars = filterCharsByLayoutPriority({
    chars,
    preferredLayoutClass: input.preferredLayoutClass,
    preferredBlockIndex: input.preferredBlockIndex,
    preferredColumnIndex: input.preferredColumnIndex,
    fallbackRange: input.currentAnchor
      ? { startOffset: input.currentAnchor.startOffset, endOffset: input.currentAnchor.endOffset }
      : undefined,
  });
  const allowedOffsets = new Set<number>(scopedChars.flatMap((char) => [char.normalizedStart, char.normalizedEnd]));
  const scopedBoundaries = boundaries.filter((boundary) => {
    if (!allowedOffsets.has(boundary.offset)) {
      return false;
    }
    if (input.preferredColumnIndex !== undefined && boundary.columnIndex !== undefined && boundary.columnIndex !== input.preferredColumnIndex) {
      return false;
    }
    if (input.preferredLayoutClass && boundary.layoutClass !== input.preferredLayoutClass) {
      return false;
    }
    if (input.preferredBlockIndex !== undefined && boundary.blockIndex !== undefined && boundary.blockIndex !== input.preferredBlockIndex) {
      return false;
    }
    return true;
  });
  const activeBoundaries = scopedBoundaries.length > 0 ? scopedBoundaries : boundaries.filter((boundary) => allowedOffsets.has(boundary.offset));
  if (activeBoundaries.length === 0) {
    return null;
  }

  const verticalBest = scopedChars.reduce((best, char) => {
    if (!best) {
      return char;
    }
    const bestDistance = getVerticalDistance(best, localY);
    const currentDistance = getVerticalDistance(char, localY);
    if (currentDistance === bestDistance) {
      return Math.abs(char.centerY - localY) < Math.abs(best.centerY - localY) ? char : best;
    }
    return currentDistance < bestDistance ? char : best;
  }, scopedChars[0] ?? null);
  if (!verticalBest) {
    return null;
  }

  const lineTolerance = Math.max(4, Math.min(18, verticalBest.height * 0.72));
  const lineScopedBoundaries = activeBoundaries.filter((boundary) => (
    Math.abs((boundary.y + (boundary.height / 2)) - verticalBest.centerY) <= lineTolerance
  ));
  const candidateBoundaries = lineScopedBoundaries.length > 0 ? lineScopedBoundaries : activeBoundaries;
  const currentBoundaryOffset = input.side === "start"
    ? input.currentAnchor?.startOffset
    : input.currentAnchor?.endOffset;

  const bestBoundary = candidateBoundaries.reduce((best, boundary) => {
    const horizontalDistance = Math.abs(boundary.x - localX);
    const currentOffsetPenalty = typeof currentBoundaryOffset === "number"
      ? Math.abs(boundary.offset - currentBoundaryOffset) * Math.max(1, boundary.height * 0.06)
      : 0;
    const score = horizontalDistance + currentOffsetPenalty;

    if (!best || score < best.score) {
      return {
        offset: boundary.offset,
        layoutClass: boundary.layoutClass,
        lineIndex: boundary.lineIndex,
        blockIndex: boundary.blockIndex,
        columnIndex: boundary.columnIndex,
        score,
      };
    }

    if (score === best.score) {
      if (input.side === "start") {
        return boundary.offset < best.offset ? { ...best, offset: boundary.offset, layoutClass: boundary.layoutClass, lineIndex: boundary.lineIndex, blockIndex: boundary.blockIndex, columnIndex: boundary.columnIndex } : best;
      }
      return boundary.offset > best.offset ? { ...best, offset: boundary.offset, layoutClass: boundary.layoutClass, lineIndex: boundary.lineIndex, blockIndex: boundary.blockIndex, columnIndex: boundary.columnIndex } : best;
    }

    return best;
  }, null as (PdfCanonicalPointerBoundaryResult & { score: number }) | null);

  if (!bestBoundary) {
    return null;
  }

  return {
    offset: bestBoundary.offset,
    layoutClass: bestBoundary.layoutClass,
    lineIndex: bestBoundary.lineIndex,
    blockIndex: bestBoundary.blockIndex,
    columnIndex: bestBoundary.columnIndex,
  };
}

export function trimPdfOffsetsToText(
  pageText: string,
  startOffset: number,
  endOffset: number,
): { startOffset: number; endOffset: number } | null {
  let nextStart = startOffset;
  let nextEnd = endOffset;

  while (nextStart < nextEnd && /\s/.test(pageText[nextStart] ?? "")) {
    nextStart += 1;
  }
  while (nextEnd > nextStart && /\s/.test(pageText[nextEnd - 1] ?? "")) {
    nextEnd -= 1;
  }

  if (nextEnd <= nextStart) {
    return null;
  }

  return {
    startOffset: nextStart,
    endOffset: nextEnd,
  };
}

export function buildPdfRectsForOffsets(
  model: PdfPageTextModel,
  startOffset: number,
  endOffset: number,
): BoundingBox[] {
  const itemRectMap = getItemRectMap(model);
  const slices: Array<{ left: number; top: number; width: number; height: number; lineIndex?: number; blockIndex?: number }> = [];

  for (const segment of model.segments) {
    if (segment.pageTextEnd <= startOffset || segment.pageTextStart >= endOffset) {
      continue;
    }

    const itemRect = itemRectMap.get(segment.itemIndex);
    if (!itemRect || itemRect.width <= 0 || itemRect.height <= 0) {
      continue;
    }

    const segmentStart = Math.max(startOffset, segment.pageTextStart);
    const segmentEnd = Math.min(endOffset, segment.pageTextEnd);
    if (segmentEnd <= segmentStart) {
      continue;
    }

    const segmentLength = Math.max(1, segment.pageTextEnd - segment.pageTextStart);
    const startRatio = (segmentStart - segment.pageTextStart) / segmentLength;
    const endRatio = (segmentEnd - segment.pageTextStart) / segmentLength;
    const left = itemRect.left + itemRect.width * startRatio;
    const width = itemRect.width * (endRatio - startRatio);
    if (width <= 0) {
      continue;
    }

    slices.push({
      left,
      top: itemRect.top,
      width,
      height: itemRect.height,
      lineIndex: segment.lineIndex,
      blockIndex: segment.blockIndex,
    });
  }

  return slices
    .sort((left, right) => (
      (left.blockIndex ?? 0) - (right.blockIndex ?? 0) ||
      (left.lineIndex ?? 0) - (right.lineIndex ?? 0) ||
      left.top - right.top ||
      left.left - right.left
    ))
    .map((slice) => ({
      x1: slice.left / model.viewportWidth,
      y1: slice.top / model.viewportHeight,
      x2: (slice.left + slice.width) / model.viewportWidth,
      y2: (slice.top + slice.height) / model.viewportHeight,
    }))
    .filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1);
}

export function resolvePdfExactQuoteOffsets(input: {
  model: PdfPageTextModel;
  exact: string | null | undefined;
  preferredRects?: BoundingBox[];
}): { startOffset: number; endOffset: number } | null {
  const compactNeedle = compactText(input.exact ?? "");
  if (!compactNeedle) {
    return null;
  }

  const compactPage = compactText(input.model.normalizedText);
  const compactIndex = compactPage.indexOf(compactNeedle);
  if (compactIndex < 0) {
    return null;
  }

  let matchedCompact = 0;
  let startOffset = -1;
  let endOffset = -1;
  for (let index = 0; index < input.model.normalizedText.length; index += 1) {
    const character = input.model.normalizedText[index];
    if (/\s/.test(character)) {
      continue;
    }
    if (matchedCompact === compactIndex) {
      startOffset = index;
    }
    if (matchedCompact === compactIndex + compactNeedle.length) {
      endOffset = index;
      break;
    }
    matchedCompact += 1;
  }

  if (startOffset < 0) {
    return null;
  }
  if (endOffset < 0) {
    endOffset = input.model.normalizedText.length;
  }

  const trimmed = trimPdfOffsetsToText(input.model.normalizedText, startOffset, endOffset);
  return trimmed ?? null;
}

export function buildPdfTextAnchorFromOffsets(input: {
  model: PdfPageTextModel;
  startOffset: number;
  endOffset: number;
  source?: PdfTextQuote["source"];
  fallbackRects?: BoundingBox[];
}): {
  startOffset: number;
  endOffset: number;
  pageText: string;
  textQuote: PdfTextQuote;
  rects: BoundingBox[];
} | null {
  const clampedStart = clampOffset(input.startOffset, input.model.normalizedText.length);
  const clampedEnd = clampOffset(input.endOffset, input.model.normalizedText.length);
  const trimmed = trimPdfOffsetsToText(input.model.normalizedText, clampedStart, clampedEnd);
  if (!trimmed) {
    return null;
  }

  const exact = input.model.normalizedText.slice(trimmed.startOffset, trimmed.endOffset);
  if (!normalizeText(exact)) {
    return null;
  }

  return {
    startOffset: trimmed.startOffset,
    endOffset: trimmed.endOffset,
    pageText: input.model.normalizedText,
    textQuote: buildTextQuote(
      input.model.normalizedText,
      trimmed.startOffset,
      trimmed.endOffset,
      exact,
      input.source ?? "pdfjs-text-model",
    ),
    rects: input.fallbackRects && input.fallbackRects.length > 0
      ? input.fallbackRects
      : buildPdfRectsForOffsets(input.model, trimmed.startOffset, trimmed.endOffset),
  };
}
