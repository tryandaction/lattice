import type { BoundingBox, PdfTarget } from "@/types/universal-annotation";
import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";
import {
  buildPdfCanonicalChars,
  buildPdfTextAnchorFromOffsets,
  resolvePdfExactQuoteOffsets,
  resolvePdfPointerBoundary,
} from "@/lib/pdf-canonical-text-anchoring";
import { isLikelyCoarseTextMarkupGeometry, isPlausibleTextMarkupBox } from "@/lib/pdf-text-rects";

export interface PdfAnnotationTextAnchor {
  startOffset: number;
  endOffset: number;
  pageText: string;
  textQuote: NonNullable<PdfTarget["textQuote"]>;
  rects: BoundingBox[];
}

function computeRectOverlap(left: BoundingBox, right: BoundingBox): number {
  const overlapWidth = Math.max(0, Math.min(left.x2, right.x2) - Math.max(left.x1, right.x1));
  const overlapHeight = Math.max(0, Math.min(left.y2, right.y2) - Math.max(left.y1, right.y1));
  return overlapWidth * overlapHeight;
}

function resolveAnchorByRects(model: PdfPageTextModel, rects: BoundingBox[]): PdfAnnotationTextAnchor | null {
  if (rects.length === 0) {
    return null;
  }

  const chars = buildPdfCanonicalChars(model);
  const intersected = chars.filter((char) => rects.some((rect) => computeRectOverlap(rect, {
    x1: char.left / model.viewportWidth,
    y1: char.top / model.viewportHeight,
    x2: char.right / model.viewportWidth,
    y2: char.bottom / model.viewportHeight,
  }) > 0));
  if (intersected.length === 0) {
    return null;
  }

  const startOffset = Math.min(...intersected.map((char) => char.normalizedStart));
  const endOffset = Math.max(...intersected.map((char) => char.normalizedEnd));
  return buildPdfTextAnchorFromOffsets({
    model,
    startOffset,
    endOffset,
  });
}

function normalizeAnchorText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function isSingleLegacyTextMarkupBlock(target: PdfTarget): boolean {
  if (target.rects.length !== 1) {
    return false;
  }

  const rect = target.rects[0];
  const width = Math.max(0, rect.x2 - rect.x1);
  const height = Math.max(0, rect.y2 - rect.y1);
  return width >= 0.12 && height >= 0.045;
}

function canReuseTargetRectsForTextMarkup(target: PdfTarget): boolean {
  return target.rects.length > 0 &&
    target.rects.every(isPlausibleTextMarkupBox) &&
    !isSingleLegacyTextMarkupBlock(target) &&
    !isLikelyCoarseTextMarkupGeometry(target.rects, target.textQuote?.exact);
}

function getReusableTargetRects(target: PdfTarget): BoundingBox[] | undefined {
  return canReuseTargetRectsForTextMarkup(target) ? target.rects : undefined;
}

function getBoundingRectForBoxes(rects: BoundingBox[]): BoundingBox | null {
  if (rects.length === 0) {
    return null;
  }

  return {
    x1: Math.min(...rects.map((rect) => rect.x1)),
    y1: Math.min(...rects.map((rect) => rect.y1)),
    x2: Math.max(...rects.map((rect) => rect.x2)),
    y2: Math.max(...rects.map((rect) => rect.y2)),
  };
}

function arePdfTextMarkupRectsEquivalent(leftRects: BoundingBox[], rightRects: BoundingBox[]): boolean {
  if (leftRects.length !== rightRects.length || leftRects.length === 0) {
    return false;
  }

  const maxEdgeDelta = leftRects.reduce((maxDelta, leftRect, index) => {
    const rightRect = rightRects[index];
    if (!rightRect) {
      return Number.POSITIVE_INFINITY;
    }

    return Math.max(
      maxDelta,
      Math.abs(leftRect.x1 - rightRect.x1),
      Math.abs(leftRect.y1 - rightRect.y1),
      Math.abs(leftRect.x2 - rightRect.x2),
      Math.abs(leftRect.y2 - rightRect.y2),
    );
  }, 0);
  if (maxEdgeDelta <= 0.004) {
    return true;
  }

  const leftBounds = getBoundingRectForBoxes(leftRects);
  const rightBounds = getBoundingRectForBoxes(rightRects);
  if (!leftBounds || !rightBounds) {
    return false;
  }

  return Math.abs(leftBounds.x1 - rightBounds.x1) <= 0.006 &&
    Math.abs(leftBounds.y1 - rightBounds.y1) <= 0.006 &&
    Math.abs(leftBounds.x2 - rightBounds.x2) <= 0.006 &&
    Math.abs(leftBounds.y2 - rightBounds.y2) <= 0.006;
}

function withOriginalTargetRects(anchor: PdfAnnotationTextAnchor, target: PdfTarget): PdfAnnotationTextAnchor {
  return canReuseTargetRectsForTextMarkup(target) &&
    arePdfTextMarkupRectsEquivalent(anchor.rects, target.rects)
    ? { ...anchor, rects: target.rects }
    : anchor;
}

function resolveAnchorByCharRange(model: PdfPageTextModel, target: PdfTarget): PdfAnnotationTextAnchor | null {
  if (
    !Number.isInteger(target.startCharIndex) ||
    !Number.isInteger(target.endCharIndex) ||
    target.startCharIndex === undefined ||
    target.endCharIndex === undefined ||
    target.startCharIndex < 0 ||
    target.endCharIndex <= target.startCharIndex ||
    target.endCharIndex > model.normalizedText.length
  ) {
    return null;
  }

  const anchor = buildPdfTextAnchorFromOffsets({
    model,
    startOffset: target.startCharIndex,
    endOffset: target.endCharIndex,
    source: target.textQuote?.source ?? "pdfjs-text-model",
    fallbackRects: getReusableTargetRects(target),
  });
  if (!anchor) {
    return null;
  }

  const expected = normalizeAnchorText(target.textQuote?.exact);
  if (!expected) {
    return anchor;
  }

  const actual = normalizeAnchorText(anchor.textQuote.exact);
  if (actual === expected) {
    return anchor;
  }

  return null;
}

export function resolvePdfAnnotationTextAnchor(model: PdfPageTextModel, target: PdfTarget): PdfAnnotationTextAnchor | null {
  const charRangeAnchor = resolveAnchorByCharRange(model, target);
  if (charRangeAnchor) {
    return charRangeAnchor;
  }

  const exactAnchor = resolvePdfExactQuoteOffsets({
    model,
    exact: target.textQuote?.exact,
    preferredRects: target.rects,
  });
  if (exactAnchor) {
    return buildPdfTextAnchorFromOffsets({
      model,
      startOffset: exactAnchor.startOffset,
      endOffset: exactAnchor.endOffset,
      fallbackRects: getReusableTargetRects(target),
    });
  }

  return resolveAnchorByRects(model, target.rects);
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

  const nextStartOffset = input.nextStartOffset ?? currentAnchor.startOffset;
  const nextEndOffset = input.nextEndOffset ?? currentAnchor.endOffset;
  if (nextEndOffset <= nextStartOffset) {
    return null;
  }

  const adjusted = buildPdfTextAnchorFromOffsets({
    model: input.model,
    startOffset: nextStartOffset,
    endOffset: nextEndOffset,
  });
  if (!adjusted) {
    return null;
  }

  if (
    adjusted.startOffset === currentAnchor.startOffset &&
    adjusted.endOffset === currentAnchor.endOffset
  ) {
    return withOriginalTargetRects(currentAnchor, input.target);
  }

  return adjusted;
}

export function adjustPdfAnnotationAnchorFromPointer(input: {
  model: PdfPageTextModel;
  target: PdfTarget;
  currentAnchor: PdfAnnotationTextAnchor;
  point: { x: number; y: number };
  pageRect: DOMRect;
  side: "start" | "end";
}): PdfAnnotationTextAnchor | null {
  const anchorChars = buildPdfCanonicalChars(input.model).filter((char) => (
    char.normalizedEnd > input.currentAnchor.startOffset &&
    char.normalizedStart < input.currentAnchor.endOffset
  ));
  const originalAnchor = resolvePdfAnnotationTextAnchor(input.model, input.target);
  const preferredChar = input.side === "start"
    ? anchorChars[0]
    : anchorChars[anchorChars.length - 1];
  const preferredLayoutClass = preferredChar?.layoutClass;
  const preferredBlockIndex = preferredChar?.blockIndex;
  const preferredColumnIndex = preferredChar?.columnIndex;
  const boundary = resolvePdfPointerBoundary({
    model: input.model,
    point: input.point,
    pageRect: input.pageRect,
    side: input.side,
    currentAnchor: input.currentAnchor,
    preferredLayoutClass,
    preferredBlockIndex,
    preferredColumnIndex,
  });
  if (!boundary) {
    return null;
  }

  if (originalAnchor) {
    const returnedToOriginal = input.side === "end"
      ? boundary.offset === originalAnchor.endOffset
      : boundary.offset === originalAnchor.startOffset;
    if (returnedToOriginal) {
      return withOriginalTargetRects(originalAnchor, input.target);
    }
  }

  const nextStartOffset = input.side === "start"
    ? Math.min(boundary.offset, input.currentAnchor.endOffset - 1)
    : input.currentAnchor.startOffset;
  const nextEndOffset = input.side === "end"
    ? Math.max(boundary.offset, input.currentAnchor.startOffset + 1)
    : input.currentAnchor.endOffset;

  return adjustPdfAnnotationAnchor({
    model: input.model,
    target: input.target,
    currentAnchor: input.currentAnchor,
    nextStartOffset,
    nextEndOffset,
  });
}
