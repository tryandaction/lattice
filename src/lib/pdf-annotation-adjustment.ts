import type { BoundingBox, PdfTarget, PdfTextQuote } from "@/types/universal-annotation";
import type { PdfPageTextItemRect, PdfPageTextModel } from "@/lib/pdf-page-text-cache";

const PDF_TEXT_CONTEXT_RADIUS = 32;

export interface PdfAnnotationTextAnchor {
  startOffset: number;
  endOffset: number;
  pageText: string;
  textQuote: PdfTextQuote;
  rects: BoundingBox[];
}

interface PdfRenderedAnchorChar {
  normalizedStart: number;
  normalizedEnd: number;
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

interface PdfTextRectSlice {
  itemIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

function clampOffset(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function normalizeText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function compactText(text: string): string {
  return normalizeText(text).replace(/\s+/g, "");
}

function buildTextQuote(pageText: string, startOffset: number, endOffset: number, exact: string, source: PdfTextQuote["source"]): PdfTextQuote {
  return {
    exact,
    prefix: pageText.slice(Math.max(0, startOffset - PDF_TEXT_CONTEXT_RADIUS), startOffset),
    suffix: pageText.slice(endOffset, endOffset + PDF_TEXT_CONTEXT_RADIUS),
    source,
    confidence: "exact",
  };
}

function trimOffsetsToText(pageText: string, startOffset: number, endOffset: number): { startOffset: number; endOffset: number } | null {
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

function measureRenderedAnchorCharRect(input: {
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

function buildRenderedAnchorChars(model: PdfPageTextModel): PdfRenderedAnchorChar[] {
  const itemRectMap = getItemRectMap(model);
  const chars: PdfRenderedAnchorChar[] = [];

  model.segments.forEach((segment) => {
    const itemRect = itemRectMap.get(segment.itemIndex);
    const segmentLength = segment.pageTextEnd - segment.pageTextStart;
    if (!itemRect || itemRect.width <= 0 || itemRect.height <= 0 || segmentLength <= 0) {
      return;
    }

    for (let offset = segment.pageTextStart; offset < segment.pageTextEnd; offset += 1) {
      const character = model.normalizedText[offset] ?? "";
      if (!character || /\s/.test(character)) {
        continue;
      }

      const localStart = offset - segment.pageTextStart;
      const localEnd = localStart + 1;
      const measuredRect = measureRenderedAnchorCharRect({
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
      if (width <= 0) {
        continue;
      }

      chars.push({
        normalizedStart: offset,
        normalizedEnd: offset + 1,
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

  return chars;
}

function getVerticalDistanceToAnchorChar(char: PdfRenderedAnchorChar, localY: number): number {
  if (localY >= char.top && localY <= char.bottom) {
    return 0;
  }
  return Math.min(
    Math.abs(localY - char.top),
    Math.abs(localY - char.bottom),
  );
}

function computeRectOverlap(left: BoundingBox, right: BoundingBox): number {
  const overlapWidth = Math.max(0, Math.min(left.x2, right.x2) - Math.max(left.x1, right.x1));
  const overlapHeight = Math.max(0, Math.min(left.y2, right.y2) - Math.max(left.y1, right.y1));
  return overlapWidth * overlapHeight;
}

function getItemRectMap(model: PdfPageTextModel): Map<number, PdfPageTextItemRect> {
  return new Map(model.itemRects.map((rect) => [rect.itemIndex, rect]));
}

function buildRectsForOffsets(model: PdfPageTextModel, startOffset: number, endOffset: number): BoundingBox[] {
  const itemRectMap = getItemRectMap(model);
  const slices: PdfTextRectSlice[] = [];

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
      itemIndex: segment.itemIndex,
      left,
      top: itemRect.top,
      width,
      height: itemRect.height,
    });
  }

  return slices
    .sort((left, right) => left.top - right.top || left.left - right.left)
    .map((slice) => ({
      x1: slice.left / model.viewportWidth,
      y1: slice.top / model.viewportHeight,
      x2: (slice.left + slice.width) / model.viewportWidth,
      y2: (slice.top + slice.height) / model.viewportHeight,
    }))
    .filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1);
}

function findAnchorByExactQuote(
  model: PdfPageTextModel,
  quote: PdfTextQuote | undefined,
  fallbackRects?: BoundingBox[],
): PdfAnnotationTextAnchor | null {
  const exact = normalizeText(quote?.exact);
  if (!exact) {
    return null;
  }

  const compactNeedle = compactText(exact);
  if (!compactNeedle) {
    return null;
  }

  const compactPage = compactText(model.normalizedText);
  const compactIndex = compactPage.indexOf(compactNeedle);
  if (compactIndex < 0) {
    return null;
  }

  let matchedCompact = 0;
  let startOffset = -1;
  let endOffset = -1;

  for (let index = 0; index < model.normalizedText.length; index += 1) {
    const character = model.normalizedText[index];
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
    endOffset = model.normalizedText.length;
  }

  const trimmed = trimOffsetsToText(model.normalizedText, startOffset, endOffset);
  if (!trimmed) {
    return null;
  }

  startOffset = trimmed.startOffset;
  endOffset = trimmed.endOffset;

  const exactText = model.normalizedText.slice(startOffset, endOffset);
  return {
    startOffset,
    endOffset,
    pageText: model.normalizedText,
    textQuote: buildTextQuote(model.normalizedText, startOffset, endOffset, exactText, "pdfjs-text-model"),
    rects: fallbackRects && fallbackRects.length > 0
      ? fallbackRects
      : buildRectsForOffsets(model, startOffset, endOffset),
  };
}

function findAnchorByRects(model: PdfPageTextModel, rects: BoundingBox[]): PdfAnnotationTextAnchor | null {
  if (rects.length === 0) {
    return null;
  }

  const itemRectMap = getItemRectMap(model);
  let startOffset = Number.POSITIVE_INFINITY;
  let endOffset = Number.NEGATIVE_INFINITY;

  for (const segment of model.segments) {
    const itemRect = itemRectMap.get(segment.itemIndex);
    if (!itemRect || itemRect.width <= 0 || itemRect.height <= 0) {
      continue;
    }
    const itemBox: BoundingBox = {
      x1: itemRect.left / model.viewportWidth,
      y1: itemRect.top / model.viewportHeight,
      x2: (itemRect.left + itemRect.width) / model.viewportWidth,
      y2: (itemRect.top + itemRect.height) / model.viewportHeight,
    };
    const overlap = rects.some((rect) => computeRectOverlap(rect, itemBox) > 0);
    if (!overlap) {
      continue;
    }
    startOffset = Math.min(startOffset, segment.pageTextStart);
    endOffset = Math.max(endOffset, segment.pageTextEnd);
  }

  if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset) || endOffset <= startOffset) {
    return null;
  }

  const exactText = model.normalizedText.slice(startOffset, endOffset);
  return {
    startOffset,
    endOffset,
    pageText: model.normalizedText,
    textQuote: buildTextQuote(model.normalizedText, startOffset, endOffset, exactText, "pdfjs-text-model"),
    rects: buildRectsForOffsets(model, startOffset, endOffset),
  };
}

export function resolvePdfAnnotationTextAnchor(model: PdfPageTextModel, target: PdfTarget): PdfAnnotationTextAnchor | null {
  return findAnchorByExactQuote(model, target.textQuote, target.rects) ?? findAnchorByRects(model, target.rects);
}

export function adjustPdfAnnotationAnchor(input: {
  model: PdfPageTextModel;
  target: PdfTarget;
  nextStartOffset?: number;
  nextEndOffset?: number;
  currentAnchor?: PdfAnnotationTextAnchor | null;
}): PdfAnnotationTextAnchor | null {
  const currentAnchor = input.currentAnchor ?? resolvePdfAnnotationTextAnchor(input.model, input.target);
  if (!currentAnchor) {
    return null;
  }

  const startOffset = clampOffset(input.nextStartOffset ?? currentAnchor.startOffset, input.model.normalizedText.length);
  const endOffset = clampOffset(input.nextEndOffset ?? currentAnchor.endOffset, input.model.normalizedText.length);
  const trimmed = trimOffsetsToText(input.model.normalizedText, startOffset, endOffset);
  if (!trimmed) {
    return null;
  }

  const exact = input.model.normalizedText.slice(trimmed.startOffset, trimmed.endOffset);
  if (!normalizeText(exact)) {
    return null;
  }

  if (
    trimmed.startOffset === currentAnchor.startOffset &&
    trimmed.endOffset === currentAnchor.endOffset
  ) {
    return currentAnchor;
  }

  return {
    startOffset: trimmed.startOffset,
    endOffset: trimmed.endOffset,
    pageText: input.model.normalizedText,
    textQuote: buildTextQuote(input.model.normalizedText, trimmed.startOffset, trimmed.endOffset, exact, "pdfjs-text-model"),
    rects: buildRectsForOffsets(input.model, trimmed.startOffset, trimmed.endOffset),
  };
}

export function adjustPdfAnnotationAnchorFromPointer(input: {
  model: PdfPageTextModel;
  target: PdfTarget;
  currentAnchor: PdfAnnotationTextAnchor;
  point: { x: number; y: number };
  pageRect: DOMRect;
  side: "start" | "end";
}): PdfAnnotationTextAnchor | null {
  const chars = buildRenderedAnchorChars(input.model);
  if (chars.length === 0) {
    return null;
  }

  const localX = input.point.x - input.pageRect.left;
  const localY = input.point.y - input.pageRect.top;
  const currentBoundaryOffset = input.side === "start"
    ? input.currentAnchor.startOffset
    : input.currentAnchor.endOffset;
  const otherBoundaryOffset = input.side === "start"
    ? input.currentAnchor.endOffset
    : input.currentAnchor.startOffset;
  const currentSelectionWidthPx = input.currentAnchor.rects.reduce((sum, rect) => (
    sum + Math.max(0, (rect.x2 - rect.x1) * input.model.viewportWidth)
  ), 0);
  const averageCharWidth = currentSelectionWidthPx > 0
    ? currentSelectionWidthPx / Math.max(1, input.currentAnchor.endOffset - input.currentAnchor.startOffset)
    : 1;

  const bestChar = chars.reduce((best, char) => {
    const bestDistance = getVerticalDistanceToAnchorChar(best, localY);
    const currentDistance = getVerticalDistanceToAnchorChar(char, localY);
    if (currentDistance === bestDistance) {
      return Math.abs(char.centerY - localY) < Math.abs(best.centerY - localY) ? char : best;
    }
    return currentDistance < bestDistance ? char : best;
  });
  const lineTolerance = Math.max(4, Math.min(18, bestChar.height * 0.7));
  const scopedChars = chars.filter((char) => (
    Math.abs(char.centerY - bestChar.centerY) <= lineTolerance
  ));

  const boundaryCandidates = scopedChars
    .map((char) => ({
      offset: input.side === "start" ? char.normalizedStart : char.normalizedEnd,
      boundaryX: input.side === "start" ? char.left : char.right,
    }))
    .filter((candidate) => (
      input.side === "start"
        ? candidate.offset < otherBoundaryOffset
        : candidate.offset > otherBoundaryOffset
    ));
  if (boundaryCandidates.length === 0) {
    return null;
  }

  const bestBoundary = boundaryCandidates.reduce((best, candidate) => {
    const bestScore = Math.abs(best.boundaryX - localX) + (Math.abs(best.offset - currentBoundaryOffset) * averageCharWidth * 0.2);
    const currentScore = Math.abs(candidate.boundaryX - localX) + (Math.abs(candidate.offset - currentBoundaryOffset) * averageCharWidth * 0.2);
    if (currentScore === bestScore) {
      return input.side === "start"
        ? (candidate.offset < best.offset ? candidate : best)
        : (candidate.offset > best.offset ? candidate : best);
    }
    return currentScore < bestScore ? candidate : best;
  });

  return adjustPdfAnnotationAnchor({
    model: input.model,
    target: input.target,
    currentAnchor: input.currentAnchor,
    nextStartOffset: input.side === "start" ? bestBoundary.offset : input.currentAnchor.startOffset,
    nextEndOffset: input.side === "end" ? bestBoundary.offset : input.currentAnchor.endOffset,
  });
}
