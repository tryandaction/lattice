import type { BoundingBox } from "@/types/universal-annotation";
import type { PdfTextKernelAnchor, PdfTextKernelPage } from "@/lib/pdf-text-kernel";

export interface PdfTextKernelQualityCase {
  id: string;
  expectedText: string;
  expectedRects?: BoundingBox[];
  minTextScore?: number;
  minGeometryScore?: number;
  maxBoundaryDriftChars?: number;
}

export interface PdfTextKernelQualityResult {
  id: string;
  ok: boolean;
  textScore: number;
  geometryScore: number;
  boundaryDriftChars: number;
  source: PdfTextKernelAnchor["quote"]["source"];
  confidence: number;
  expectedText: string;
  actualText: string;
  failures: string[];
}

export interface PdfTextKernelQualitySummary {
  ok: boolean;
  total: number;
  passed: number;
  failed: number;
  meanTextScore: number;
  meanGeometryScore: number;
  minConfidence: number;
  results: PdfTextKernelQualityResult[];
}

function normalizeQualityText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function compactQualityText(text: string): string {
  return normalizeQualityText(text).replace(/\s+/g, "");
}

function boundedEditDistance(left: string, right: string, maxDistance: number): number {
  if (Math.abs(left.length - right.length) > maxDistance) {
    return maxDistance + 1;
  }

  const previous = new Array(right.length + 1).fill(0);
  const current = new Array(right.length + 1).fill(0);
  for (let index = 0; index <= right.length; index += 1) {
    previous[index] = index;
  }

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    let rowMin = current[0];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + cost,
      );
      rowMin = Math.min(rowMin, current[rightIndex]);
    }
    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }
    for (let index = 0; index <= right.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length] ?? maxDistance + 1;
}

export function scorePdfKernelText(actualText: string, expectedText: string): number {
  const actual = compactQualityText(actualText);
  const expected = compactQualityText(expectedText);
  if (!actual && !expected) {
    return 1;
  }
  if (!actual || !expected) {
    return 0;
  }
  if (actual === expected) {
    return 1;
  }

  const maxLength = Math.max(actual.length, expected.length);
  const distance = boundedEditDistance(actual, expected, Math.ceil(maxLength * 0.5));
  return Math.max(0, 1 - (distance / maxLength));
}

function rectArea(rect: BoundingBox): number {
  return Math.max(0, rect.x2 - rect.x1) * Math.max(0, rect.y2 - rect.y1);
}

function rectIntersectionArea(left: BoundingBox, right: BoundingBox): number {
  const x1 = Math.max(left.x1, right.x1);
  const y1 = Math.max(left.y1, right.y1);
  const x2 = Math.min(left.x2, right.x2);
  const y2 = Math.min(left.y2, right.y2);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

export function scorePdfKernelGeometry(actualRects: BoundingBox[], expectedRects: BoundingBox[] | undefined): number {
  if (!expectedRects || expectedRects.length === 0) {
    return actualRects.length > 0 ? 1 : 0;
  }
  if (actualRects.length === 0) {
    return 0;
  }

  const expectedArea = expectedRects.reduce((sum, rect) => sum + rectArea(rect), 0);
  if (expectedArea <= 0) {
    return 0;
  }

  const overlap = expectedRects.reduce((sum, expectedRect) => (
    sum + actualRects.reduce((rectSum, actualRect) => (
      rectSum + rectIntersectionArea(actualRect, expectedRect)
    ), 0)
  ), 0);
  return Math.max(0, Math.min(1, overlap / expectedArea));
}

export function measurePdfKernelBoundaryDrift(input: {
  page: PdfTextKernelPage;
  anchor: PdfTextKernelAnchor;
  expectedText: string;
}): number {
  const expected = normalizeQualityText(input.expectedText);
  if (!expected) {
    return 0;
  }

  const expectedStart = normalizeQualityText(input.page.normalizedText).indexOf(expected);
  if (expectedStart < 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(input.anchor.startCharIndex - expectedStart);
}

export function evaluatePdfTextKernelAnchor(input: {
  page: PdfTextKernelPage;
  anchor: PdfTextKernelAnchor;
  testCase: PdfTextKernelQualityCase;
}): PdfTextKernelQualityResult {
  const textScore = scorePdfKernelText(input.anchor.text, input.testCase.expectedText);
  const geometryScore = scorePdfKernelGeometry(input.anchor.rects, input.testCase.expectedRects);
  const boundaryDriftChars = measurePdfKernelBoundaryDrift({
    page: input.page,
    anchor: input.anchor,
    expectedText: input.testCase.expectedText,
  });
  const minTextScore = input.testCase.minTextScore ?? 1;
  const minGeometryScore = input.testCase.minGeometryScore ?? 0.85;
  const maxBoundaryDriftChars = input.testCase.maxBoundaryDriftChars ?? 0;
  const failures: string[] = [];

  if (textScore < minTextScore) {
    failures.push(`text-score:${textScore.toFixed(3)}<${minTextScore}`);
  }
  if (geometryScore < minGeometryScore) {
    failures.push(`geometry-score:${geometryScore.toFixed(3)}<${minGeometryScore}`);
  }
  if (boundaryDriftChars > maxBoundaryDriftChars) {
    failures.push(`boundary-drift:${boundaryDriftChars}>${maxBoundaryDriftChars}`);
  }

  return {
    id: input.testCase.id,
    ok: failures.length === 0,
    textScore,
    geometryScore,
    boundaryDriftChars,
    source: input.anchor.quote.source,
    confidence: input.anchor.confidence,
    expectedText: input.testCase.expectedText,
    actualText: input.anchor.text,
    failures,
  };
}

export function summarizePdfTextKernelQuality(results: PdfTextKernelQualityResult[]): PdfTextKernelQualitySummary {
  const total = results.length;
  const passed = results.filter((result) => result.ok).length;
  const mean = (values: number[]): number => (
    values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  );

  return {
    ok: total > 0 && passed === total,
    total,
    passed,
    failed: total - passed,
    meanTextScore: mean(results.map((result) => result.textScore)),
    meanGeometryScore: mean(results.map((result) => result.geometryScore)),
    minConfidence: results.length > 0 ? Math.min(...results.map((result) => result.confidence)) : 0,
    results,
  };
}
