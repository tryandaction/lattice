import type { BoundingBox } from "@/types/universal-annotation";

export interface PdfTextOverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
  pageNumber?: number;
}

export interface PdfMergedTextOverlaySegment {
  left: number;
  top: number;
  width: number;
  height: number;
  baselineTop: number;
  baselineHeight: number;
}

export const PDF_TEXT_RECT_ROW_TOLERANCE_PX = 3;
export const PDF_TEXT_RECT_HORIZONTAL_GAP_PX = 3;
export const PDF_TEXT_RECT_MAX_HORIZONTAL_GAP_PX = 96;
export const PDF_TEXT_RECT_ROW_TOLERANCE_RATIO = 0.003;
export const PDF_TEXT_RECT_HORIZONTAL_GAP_RATIO = 0.008;
export const PDF_TEXT_RECT_MAX_HORIZONTAL_GAP_RATIO = 0.08;
const PDF_TEXT_RECT_MIN_SEGMENT_HEIGHT_RATIO = 0.82;

interface NormalizedPdfTextRect extends PdfTextOverlayRect {
  right: number;
  bottom: number;
  centerY: number;
}

interface PdfTextRectRow {
  rects: NormalizedPdfTextRect[];
  top: number;
  bottom: number;
  centerY: number;
}

interface PdfTextRectMergeOptions {
  rowTolerance?: number;
  horizontalGap?: number;
  maxHorizontalGap?: number;
  inlineGapMultiplier?: number;
}

function normalizePdfOverlayRect(rect: PdfTextOverlayRect): NormalizedPdfTextRect | null {
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
    return null;
  }

  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return {
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    centerY: rect.top + rect.height / 2,
  };
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function getVerticalOverlap(left: { top: number; bottom: number }, right: { top: number; bottom: number }): number {
  return Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
}

function isSameTextRow(row: PdfTextRectRow, rect: NormalizedPdfTextRect, rowTolerance: number): boolean {
  const rowHeight = Math.max(Number.EPSILON, row.bottom - row.top);
  const rectHeight = Math.max(Number.EPSILON, rect.height);
  const minHeight = Math.min(rowHeight, rectHeight);
  const verticalOverlap = getVerticalOverlap(row, rect);
  const centerTolerance = Math.max(rowTolerance, minHeight * 0.62);

  return verticalOverlap >= minHeight * 0.42 || Math.abs(row.centerY - rect.centerY) <= centerTolerance;
}

function addRectToRow(row: PdfTextRectRow, rect: NormalizedPdfTextRect): void {
  row.rects.push(rect);
  row.top = Math.min(row.top, rect.top);
  row.bottom = Math.max(row.bottom, rect.bottom);
  row.centerY = (row.top + row.bottom) / 2;
}

function buildTextRectRows(rects: NormalizedPdfTextRect[], rowTolerance: number): PdfTextRectRow[] {
  const rows: PdfTextRectRow[] = [];

  for (const rect of rects) {
    let bestRow: PdfTextRectRow | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const row of rows) {
      if (!isSameTextRow(row, rect, rowTolerance)) {
        continue;
      }

      const distance = Math.abs(row.centerY - rect.centerY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestRow = row;
      }
    }

    if (bestRow) {
      addRectToRow(bestRow, rect);
    } else {
      rows.push({
        rects: [rect],
        top: rect.top,
        bottom: rect.bottom,
        centerY: rect.centerY,
      });
    }
  }

  return rows.sort((left, right) => left.top - right.top || left.rects[0].left - right.rects[0].left);
}

function buildRowSegment(rects: NormalizedPdfTextRect[]): PdfMergedTextOverlaySegment {
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const medianHeight = Math.max(Number.EPSILON, median(rects.map((rect) => rect.height)));
  const medianCenterY = median(rects.map((rect) => rect.centerY));
  const rawTop = Math.min(...rects.map((rect) => rect.top));
  const rawBottom = Math.max(...rects.map((rect) => rect.bottom));
  const normalizedHeight = Math.max(
    rawBottom - rawTop,
    medianHeight * PDF_TEXT_RECT_MIN_SEGMENT_HEIGHT_RATIO,
  );
  const top = Math.max(0, medianCenterY - normalizedHeight / 2);
  const bottom = top + normalizedHeight;
  const baselineHeight = Math.min(bottom - top, medianHeight);

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    baselineTop: bottom - baselineHeight,
    baselineHeight,
  };
}

export function mergePdfTextOverlayRects(
  rects: PdfTextOverlayRect[],
  options?: PdfTextRectMergeOptions,
): PdfMergedTextOverlaySegment[] {
  const normalized = rects
    .map(normalizePdfOverlayRect)
    .filter((rect): rect is NormalizedPdfTextRect => rect !== null)
    .sort((left, right) => left.top - right.top || left.left - right.left);

  if (normalized.length === 0) {
    return [];
  }

  const rowTolerance = options?.rowTolerance ?? PDF_TEXT_RECT_ROW_TOLERANCE_PX;
  const baseHorizontalGap = options?.horizontalGap ?? PDF_TEXT_RECT_HORIZONTAL_GAP_PX;
  const maxHorizontalGap = options?.maxHorizontalGap ?? PDF_TEXT_RECT_MAX_HORIZONTAL_GAP_PX;
  const inlineGapMultiplier = options?.inlineGapMultiplier ?? 2.6;
  const rows = buildTextRectRows(normalized, rowTolerance);
  const merged: PdfMergedTextOverlaySegment[] = [];

  for (const row of rows) {
    const rowRects = row.rects.sort((left, right) => left.left - right.left || left.top - right.top);
    const medianHeight = Math.max(Number.EPSILON, median(rowRects.map((rect) => rect.height)));
    const allowedGap = Math.min(
      Math.max(baseHorizontalGap, medianHeight * inlineGapMultiplier),
      maxHorizontalGap,
    );
    let currentRun: NormalizedPdfTextRect[] = [];
    let currentRight = Number.NEGATIVE_INFINITY;

    for (const rect of rowRects) {
      if (currentRun.length === 0) {
        currentRun.push(rect);
        currentRight = rect.right;
        continue;
      }

      const gap = rect.left - currentRight;
      if (gap > allowedGap) {
        merged.push(buildRowSegment(currentRun));
        currentRun = [rect];
        currentRight = rect.right;
        continue;
      }

      currentRun.push(rect);
      currentRight = Math.max(currentRight, rect.right);
    }

    if (currentRun.length > 0) {
      merged.push(buildRowSegment(currentRun));
    }
  }

  return merged.sort((left, right) => left.top - right.top || left.left - right.left);
}

export function mergePdfTargetRectsForTextMarkup(rects: BoundingBox[]): BoundingBox[] {
  return mergePdfTextOverlayRects(
    rects.map((rect) => ({
      left: rect.x1 * 100,
      top: rect.y1 * 100,
      width: Math.max(0, rect.x2 - rect.x1) * 100,
      height: Math.max(0, rect.y2 - rect.y1) * 100,
    })),
    {
      rowTolerance: PDF_TEXT_RECT_ROW_TOLERANCE_RATIO * 100,
      horizontalGap: PDF_TEXT_RECT_HORIZONTAL_GAP_RATIO * 100,
      maxHorizontalGap: PDF_TEXT_RECT_MAX_HORIZONTAL_GAP_RATIO * 100,
    },
  ).map((segment) => ({
    x1: segment.left / 100,
    y1: segment.top / 100,
    x2: (segment.left + segment.width) / 100,
    y2: (segment.top + segment.height) / 100,
  }));
}

export function mergePageRelativePdfTargetRects(rects: BoundingBox[]): PdfMergedTextOverlaySegment[] {
  return mergePdfTextOverlayRects(
    rects.map((rect) => ({
      left: rect.x1 * 100,
      top: rect.y1 * 100,
      width: Math.max(0, rect.x2 - rect.x1) * 100,
      height: Math.max(0, rect.y2 - rect.y1) * 100,
    })),
    {
      rowTolerance: PDF_TEXT_RECT_ROW_TOLERANCE_RATIO * 100,
      horizontalGap: PDF_TEXT_RECT_HORIZONTAL_GAP_RATIO * 100,
      maxHorizontalGap: PDF_TEXT_RECT_MAX_HORIZONTAL_GAP_RATIO * 100,
    },
  );
}
