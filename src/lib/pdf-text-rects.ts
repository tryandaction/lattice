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
export const PDF_TEXT_RECT_HORIZONTAL_GAP_RATIO = 0.0035;
export const PDF_TEXT_RECT_MAX_HORIZONTAL_GAP_RATIO = 0.16;
const PDF_TEXT_RECT_MIN_SEGMENT_HEIGHT_RATIO = 0.46;
const PDF_TEXT_RECT_TARGET_SEGMENT_HEIGHT_RATIO = 0.72;
const PDF_TEXT_RECT_MAX_SEGMENT_HEIGHT_RATIO = 0.84;
const PDF_TEXT_MARKUP_MAX_RECT_HEIGHT_RATIO = 0.12;
const PDF_TEXT_MARKUP_MAX_RECT_AREA_RATIO = 0.18;
const PDF_TEXT_MARKUP_COARSE_RECT_WIDTH_RATIO = 0.18;
const PDF_TEXT_MARKUP_STRICT_ROW_OVERLAP_RATIO = 0.55;
const PDF_TEXT_MARKUP_STRICT_ROW_CENTER_RATIO = 0.52;
const PDF_TEXT_MARKUP_STRICT_ROW_MAX_UNION_RATIO = 1.42;
const PDF_TEXT_MARKUP_STRICT_ROW_GAP_RATIO = 0.16;

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
  pageWidth?: number;
  allowWideSameColumnGaps?: boolean;
  strictRows?: boolean;
  targetSegmentHeightRatio?: number;
  minSegmentHeightRatio?: number;
  maxSegmentHeightRatio?: number;
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

export function isPlausibleTextMarkupBox(rect: BoundingBox): boolean {
  if (
    !Number.isFinite(rect.x1) ||
    !Number.isFinite(rect.y1) ||
    !Number.isFinite(rect.x2) ||
    !Number.isFinite(rect.y2)
  ) {
    return false;
  }

  const width = Math.max(0, rect.x2 - rect.x1);
  const height = Math.max(0, rect.y2 - rect.y1);
  if (width <= 0 || height <= 0) {
    return false;
  }

  if (height > PDF_TEXT_MARKUP_MAX_RECT_HEIGHT_RATIO) {
    return false;
  }

  return width * height <= PDF_TEXT_MARKUP_MAX_RECT_AREA_RATIO;
}

function filterTextMarkupBoxes(rects: BoundingBox[]): BoundingBox[] {
  return rects.filter(isPlausibleTextMarkupBox);
}

function countReadableWords(text: string): number {
  return (text.match(/[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

export function isLikelyCoarseTextMarkupGeometry(
  rects: BoundingBox[],
  text?: string | null,
): boolean {
  const normalizedText = (text ?? "").replace(/\s+/g, " ").trim();
  if (rects.length === 0 || !normalizedText) {
    return false;
  }

  const compactLength = normalizedText.replace(/\s+/g, "").length;
  const wordCount = countReadableWords(normalizedText);
  if (compactLength < 24 && wordCount < 5) {
    return false;
  }

  const rawWideOrTallRects = rects.filter((rect) => {
    const width = Math.max(0, rect.x2 - rect.x1);
    const height = Math.max(0, rect.y2 - rect.y1);
    return height > PDF_TEXT_MARKUP_MAX_RECT_HEIGHT_RATIO ||
      width * height > PDF_TEXT_MARKUP_MAX_RECT_AREA_RATIO ||
      (height >= 0.04 && compactLength >= 24 && rects.length <= 2) ||
      (height >= 0.03 && width >= PDF_TEXT_MARKUP_COARSE_RECT_WIDTH_RATIO && wordCount >= 6 && rects.length === 1);
  });
  if (rawWideOrTallRects.length > 0) {
    return true;
  }

  const boxes = filterTextMarkupBoxes(rects);
  if (boxes.length === 0) {
    return true;
  }

  const verticalCoverage = Math.max(...boxes.map((rect) => rect.y2)) - Math.min(...boxes.map((rect) => rect.y1));
  const maxRectHeight = Math.max(...boxes.map((rect) => Math.max(0, rect.y2 - rect.y1)));
  const likelySingleBlockForMultipleLines = (
    boxes.length <= 2 &&
    compactLength >= 48 &&
    verticalCoverage >= 0.075 &&
    maxRectHeight >= 0.04
  );

  return likelySingleBlockForMultipleLines;
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

function isSameTextRow(
  row: PdfTextRectRow,
  rect: NormalizedPdfTextRect,
  rowTolerance: number,
  strictRows: boolean,
): boolean {
  const rowHeight = Math.max(Number.EPSILON, row.bottom - row.top);
  const rectHeight = Math.max(Number.EPSILON, rect.height);
  const minHeight = Math.min(rowHeight, rectHeight);
  const maxHeight = Math.max(rowHeight, rectHeight);
  const verticalOverlap = getVerticalOverlap(row, rect);
  const centerDistance = Math.abs(row.centerY - rect.centerY);

  if (strictRows) {
    const unionHeight = Math.max(row.bottom, rect.bottom) - Math.min(row.top, rect.top);
    const centerTolerance = Math.max(rowTolerance, minHeight * PDF_TEXT_MARKUP_STRICT_ROW_CENTER_RATIO);

    return verticalOverlap >= minHeight * PDF_TEXT_MARKUP_STRICT_ROW_OVERLAP_RATIO &&
      centerDistance <= centerTolerance &&
      unionHeight <= maxHeight * PDF_TEXT_MARKUP_STRICT_ROW_MAX_UNION_RATIO;
  }

  const centerTolerance = Math.max(rowTolerance, minHeight * 0.62);
  return verticalOverlap >= minHeight * 0.42 || centerDistance <= centerTolerance;
}

function addRectToRow(row: PdfTextRectRow, rect: NormalizedPdfTextRect): void {
  row.rects.push(rect);
  row.top = Math.min(row.top, rect.top);
  row.bottom = Math.max(row.bottom, rect.bottom);
  row.centerY = (row.top + row.bottom) / 2;
}

function buildTextRectRows(
  rects: NormalizedPdfTextRect[],
  rowTolerance: number,
  strictRows: boolean,
): PdfTextRectRow[] {
  const rows: PdfTextRectRow[] = [];

  for (const rect of rects) {
    let bestRow: PdfTextRectRow | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const row of rows) {
      if (!isSameTextRow(row, rect, rowTolerance, strictRows)) {
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

function buildRowSegment(
  rects: NormalizedPdfTextRect[],
  options?: Pick<
    PdfTextRectMergeOptions,
    "targetSegmentHeightRatio" | "minSegmentHeightRatio" | "maxSegmentHeightRatio"
  >,
): PdfMergedTextOverlaySegment {
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const medianHeight = Math.max(Number.EPSILON, median(rects.map((rect) => rect.height)));
  const medianCenterY = median(rects.map((rect) => rect.centerY));
  const rawTop = Math.min(...rects.map((rect) => rect.top));
  const rawBottom = Math.max(...rects.map((rect) => rect.bottom));
  const rawHeight = rawBottom - rawTop;
  const targetRatio = options?.targetSegmentHeightRatio ?? PDF_TEXT_RECT_TARGET_SEGMENT_HEIGHT_RATIO;
  const minRatio = options?.minSegmentHeightRatio ?? PDF_TEXT_RECT_MIN_SEGMENT_HEIGHT_RATIO;
  const maxRatio = options?.maxSegmentHeightRatio ?? PDF_TEXT_RECT_MAX_SEGMENT_HEIGHT_RATIO;
  const targetHeight = medianHeight * targetRatio;
  const normalizedHeight = Math.min(
    Math.max(
      targetHeight,
      medianHeight * minRatio,
    ),
    Math.min(rawHeight, medianHeight * maxRatio),
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

function enforceStrictSegmentRowGaps(segments: PdfMergedTextOverlaySegment[]): PdfMergedTextOverlaySegment[] {
  if (segments.length <= 1) {
    return segments;
  }

  const ordered = [...segments].sort((left, right) => left.top - right.top || left.left - right.left);
  return ordered.map((segment, index) => {
    const previous = ordered[index - 1] ?? null;
    const next = ordered[index + 1] ?? null;
    const currentCenter = segment.top + (segment.height / 2);
    const previousCenter = previous ? previous.top + (previous.height / 2) : null;
    const nextCenter = next ? next.top + (next.height / 2) : null;
    const nearestCenterGap = Math.min(
      previousCenter === null ? Number.POSITIVE_INFINITY : Math.max(0, currentCenter - previousCenter),
      nextCenter === null ? Number.POSITIVE_INFINITY : Math.max(0, nextCenter - currentCenter),
    );
    if (!Number.isFinite(nearestCenterGap) || nearestCenterGap <= 0) {
      return segment;
    }

    const reservedGap = Math.max(1, nearestCenterGap * PDF_TEXT_MARKUP_STRICT_ROW_GAP_RATIO);
    const maxHeight = Math.max(1, nearestCenterGap - reservedGap);
    if (segment.height <= maxHeight) {
      return segment;
    }

    const nextHeight = maxHeight;
    const nextTop = Math.max(0, currentCenter - nextHeight / 2);
    const baselineHeight = Math.min(nextHeight, segment.baselineHeight);
    return {
      ...segment,
      top: nextTop,
      height: nextHeight,
      baselineTop: nextTop + nextHeight - baselineHeight,
      baselineHeight,
    };
  });
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
  const inlineGapMultiplier = options?.inlineGapMultiplier ?? 4.5;
  const pageWidth = options?.pageWidth;
  const leftColumnBoundary = pageWidth ? pageWidth * 0.48 : null;
  const rightColumnBoundary = pageWidth ? pageWidth * 0.52 : null;
  const rows = buildTextRectRows(normalized, rowTolerance, Boolean(options?.strictRows));
  const merged: PdfMergedTextOverlaySegment[] = [];

  for (const row of rows) {
    const rowRects = row.rects.sort((left, right) => left.left - right.left || left.top - right.top);
    const medianHeight = Math.max(Number.EPSILON, median(rowRects.map((rect) => rect.height)));
    const allowedGap = Math.min(
      Math.max(baseHorizontalGap, medianHeight * inlineGapMultiplier),
      maxHorizontalGap,
    );
    const sameColumnAllowedGap = options?.allowWideSameColumnGaps && pageWidth
      ? Math.max(allowedGap, pageWidth * 0.075)
      : allowedGap;
    let currentRun: NormalizedPdfTextRect[] = [];
    let currentRight = Number.NEGATIVE_INFINITY;

    for (const rect of rowRects) {
      if (currentRun.length === 0) {
        currentRun.push(rect);
        currentRight = rect.right;
        continue;
      }

      const gap = rect.left - currentRight;
      const crossesColumnGutter = (
        leftColumnBoundary !== null &&
        rightColumnBoundary !== null &&
        currentRight <= leftColumnBoundary &&
        rect.left >= rightColumnBoundary
      );
      if (crossesColumnGutter || gap > sameColumnAllowedGap) {
        merged.push(buildRowSegment(currentRun, options));
        currentRun = [rect];
        currentRight = rect.right;
        continue;
      }

      currentRun.push(rect);
      currentRight = Math.max(currentRight, rect.right);
    }

    if (currentRun.length > 0) {
      merged.push(buildRowSegment(currentRun, options));
    }
  }

  return options?.strictRows ? enforceStrictSegmentRowGaps(merged) : merged;
}

export function mergePdfTargetRectsForTextMarkup(rects: BoundingBox[]): BoundingBox[] {
  return filterTextMarkupBoxes(rects)
    .map((rect) => ({
      x1: Math.max(0, Math.min(1, Math.min(rect.x1, rect.x2))),
      y1: Math.max(0, Math.min(1, Math.min(rect.y1, rect.y2))),
      x2: Math.max(0, Math.min(1, Math.max(rect.x1, rect.x2))),
      y2: Math.max(0, Math.min(1, Math.max(rect.y1, rect.y2))),
    }))
    .filter((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1)
    .sort((left, right) => left.y1 - right.y1 || left.x1 - right.x1);
}

export function mergePageRelativePdfTargetRects(rects: BoundingBox[]): PdfMergedTextOverlaySegment[] {
  const textRects = filterTextMarkupBoxes(rects);
  return mergePdfTextOverlayRects(
    textRects.map((rect) => ({
      left: rect.x1 * 100,
      top: rect.y1 * 100,
      width: Math.max(0, rect.x2 - rect.x1) * 100,
      height: Math.max(0, rect.y2 - rect.y1) * 100,
    })),
    {
      rowTolerance: PDF_TEXT_RECT_ROW_TOLERANCE_RATIO * 100,
      horizontalGap: PDF_TEXT_RECT_HORIZONTAL_GAP_RATIO * 100,
      maxHorizontalGap: 7.5,
      inlineGapMultiplier: 2.25,
      pageWidth: 100,
      allowWideSameColumnGaps: false,
    },
  );
}

export function mergePageRelativePdfTextMarkupRects(rects: BoundingBox[]): PdfMergedTextOverlaySegment[] {
  const textRects = filterTextMarkupBoxes(rects);
  return mergePdfTextOverlayRects(
    textRects.map((rect) => ({
      left: rect.x1 * 100,
      top: rect.y1 * 100,
      width: Math.max(0, rect.x2 - rect.x1) * 100,
      height: Math.max(0, rect.y2 - rect.y1) * 100,
    })),
    {
      rowTolerance: PDF_TEXT_RECT_ROW_TOLERANCE_RATIO * 100,
      horizontalGap: PDF_TEXT_RECT_HORIZONTAL_GAP_RATIO * 100,
      maxHorizontalGap: 7.5,
      inlineGapMultiplier: 2.25,
      pageWidth: 100,
      allowWideSameColumnGaps: false,
      strictRows: true,
      targetSegmentHeightRatio: 0.46,
      minSegmentHeightRatio: 0.34,
      maxSegmentHeightRatio: 0.52,
    },
  );
}
