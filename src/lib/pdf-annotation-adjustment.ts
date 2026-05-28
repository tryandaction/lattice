import type { BoundingBox, PdfTarget } from "@/types/universal-annotation";
import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";
import {
  buildPdfCanonicalChars,
  buildPdfTextAnchorFromOffsets,
  resolvePdfExactQuoteOffsets,
  resolvePdfPointerBoundary,
} from "@/lib/pdf-canonical-text-anchoring";

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

export function resolvePdfAnnotationTextAnchor(model: PdfPageTextModel, target: PdfTarget): PdfAnnotationTextAnchor | null {
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
      fallbackRects: target.rects,
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
    return currentAnchor;
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
  const currentBoundaryOffset = input.side === "start"
    ? input.currentAnchor.startOffset
    : input.currentAnchor.endOffset;
  const currentBoundaryRect = input.side === "start"
    ? input.currentAnchor.rects[0]
    : input.currentAnchor.rects[input.currentAnchor.rects.length - 1];
  if (currentBoundaryRect) {
    const boundaryX = (
      input.side === "start"
        ? currentBoundaryRect.x1
        : currentBoundaryRect.x2
    ) * input.model.viewportWidth;
    const localX = input.point.x - input.pageRect.left;
    if (Math.abs(localX - boundaryX) <= 3) {
      return adjustPdfAnnotationAnchor({
        model: input.model,
        target: input.target,
        currentAnchor: input.currentAnchor,
        nextStartOffset: input.side === "start" ? currentBoundaryOffset : input.currentAnchor.startOffset,
        nextEndOffset: input.side === "end" ? currentBoundaryOffset : input.currentAnchor.endOffset,
      });
    }
  }
  const originalBoundaryRect = originalAnchor
    ? (
        input.side === "start"
          ? originalAnchor.rects[0]
          : originalAnchor.rects[originalAnchor.rects.length - 1]
      )
    : null;
  if (originalAnchor && originalBoundaryRect) {
    const originalBoundaryX = (
      input.side === "start"
        ? originalBoundaryRect.x1
        : originalBoundaryRect.x2
    ) * input.model.viewportWidth;
    const localX = input.point.x - input.pageRect.left;
    if (Math.abs(localX - originalBoundaryX) <= 4) {
      return originalAnchor;
    }
  }
  const preferredLayoutClass = anchorChars[0]?.layoutClass;
  const preferredBlockIndex = anchorChars[0]?.blockIndex;
  const preferredColumnIndex = anchorChars[0]?.columnIndex;
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
    if (input.side === "end") {
      const movingBackNearOriginal = (
        boundary.offset >= originalAnchor.endOffset &&
        boundary.offset <= originalAnchor.endOffset + 2 &&
        input.currentAnchor.endOffset >= boundary.offset
      );
      if (movingBackNearOriginal) {
        return originalAnchor;
      }
    } else {
      const movingBackNearOriginal = (
        boundary.offset <= originalAnchor.startOffset &&
        boundary.offset >= originalAnchor.startOffset - 2 &&
        input.currentAnchor.startOffset <= boundary.offset
      );
      if (movingBackNearOriginal) {
        return originalAnchor;
      }
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
