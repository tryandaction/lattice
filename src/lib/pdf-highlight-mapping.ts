/**
 * PDF Highlight Mapping Utilities
 *
 * Converts persisted PDF annotation geometry into viewport highlight geometry.
 * Selection creation and reverse mapping are intentionally not supported here.
 */

import type {
  AnnotationItem,
  PdfTarget,
  BoundingBox,
} from "../types/universal-annotation";
import { getCanonicalPdfAnnotationText } from "../types/universal-annotation";
import { HIGHLIGHT_COLORS, resolveHighlightColor } from "./annotation-colors";

export interface PdfPageDimensions {
  width: number;
  height: number;
}

export type PdfPageDimensionsMap = Map<number, PdfPageDimensions>;

const DEFAULT_PAGE_DIMENSIONS: PdfPageDimensions = {
  width: 612,
  height: 792,
};

// ============================================================================
// Viewport highlight geometry types
// ============================================================================

/**
 * Viewport highlight geometry derived from persisted PDF rects
 */
export interface ScaledPosition {
  boundingRect: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    width: number;
    height: number;
    pageNumber?: number;
  };
  rects: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    width: number;
    height: number;
    pageNumber?: number;
  }>;
  pageNumber: number;
}

/**
 * Highlight format consumed by the PDF annotation renderer
 */
export interface PDFHighlight {
  id: string;
  position: ScaledPosition;
  content: {
    text?: string;
    image?: string;
  };
  comment?: {
    text: string;
    emoji?: string;
  };
  color?: string;
}

function resolvePageDimensions(
  pageNumber: number,
  pageDimensions?: PdfPageDimensionsMap,
): PdfPageDimensions {
  const dimensions = pageDimensions?.get(pageNumber);
  if (dimensions && dimensions.width > 0 && dimensions.height > 0) {
    return dimensions;
  }

  return DEFAULT_PAGE_DIMENSIONS;
}

function toNormalizedCoordinate(value: number, dimension: number): number {
  if (!Number.isFinite(value) || dimension <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, value / dimension));
}

export function scaledPositionToBoundingBoxes(position: ScaledPosition): BoundingBox[] {
  const boundingRect = position.boundingRect;
  return position.rects
    .map((rect) => {
      const width = rect.width || boundingRect.width;
      const height = rect.height || boundingRect.height;
      const x1 = toNormalizedCoordinate(Math.min(rect.x1, rect.x2), width);
      const y1 = toNormalizedCoordinate(Math.min(rect.y1, rect.y2), height);
      const x2 = toNormalizedCoordinate(Math.max(rect.x1, rect.x2), width);
      const y2 = toNormalizedCoordinate(Math.max(rect.y1, rect.y2), height);
      return { x1, y1, x2, y2 };
    })
    .filter((rect) => (
      rect.x2 > rect.x1 &&
      rect.y2 > rect.y1 &&
      (rect.x2 - rect.x1) > 0.001 &&
      (rect.y2 - rect.y1) > 0.001
    ));
}

export function boundingBoxesToScaledPosition(
  target: PdfTarget,
  pageDimensions?: PdfPageDimensionsMap,
): ScaledPosition {
  const dimensions = resolvePageDimensions(target.page, pageDimensions);
  const rects = target.rects.map((rect) => ({
    x1: rect.x1 * dimensions.width,
    y1: rect.y1 * dimensions.height,
    x2: rect.x2 * dimensions.width,
    y2: rect.y2 * dimensions.height,
    width: dimensions.width,
    height: dimensions.height,
    pageNumber: target.page,
  }));

  const x1 = Math.min(...rects.map((rect) => rect.x1));
  const y1 = Math.min(...rects.map((rect) => rect.y1));
  const x2 = Math.max(...rects.map((rect) => rect.x2));
  const y2 = Math.max(...rects.map((rect) => rect.y2));

  return {
    boundingRect: {
      x1,
      y1,
      x2,
      y2,
      width: dimensions.width,
      height: dimensions.height,
      pageNumber: target.page,
    },
    rects,
    pageNumber: target.page,
  };
}

// ============================================================================
// Annotation to Highlight Conversion
// ============================================================================

export function annotationToHighlight(
  annotation: AnnotationItem,
  pageDimensions?: PdfPageDimensionsMap,
): PDFHighlight | null {
  if (annotation.target.type !== "pdf") {
    return null;
  }

  const target = annotation.target as PdfTarget;
  if (target.rects.length === 0) {
    return null;
  }

  const highlight: PDFHighlight = {
    id: annotation.id,
    position: boundingBoxesToScaledPosition(target, pageDimensions),
    content: {
      text: getCanonicalPdfAnnotationText(annotation),
      image: annotation.preview?.type === "image" ? annotation.preview.dataUrl : undefined,
    },
    color: resolveHighlightColor(annotation.style.color),
  };

  if (annotation.comment) {
    highlight.comment = {
      text: annotation.comment,
    };
  }

  return highlight;
}

export function annotationsToHighlights(
  annotations: AnnotationItem[],
  pageDimensions?: PdfPageDimensionsMap,
): PDFHighlight[] {
  return annotations
    .map((annotation) => annotationToHighlight(annotation, pageDimensions))
    .filter((highlight): highlight is PDFHighlight => highlight !== null);
}

export function createPinAnnotation(
  page: number,
  x: number,
  y: number,
  comment: string | undefined,
  author: string,
  color: string = "#FFC107",
): Omit<AnnotationItem, "id" | "createdAt"> {
  const pinSize = 0.02;

  const target: PdfTarget = {
    type: "pdf",
    page,
    rects: [{
      x1: Math.max(0, x - pinSize / 2),
      y1: Math.max(0, y - pinSize / 2),
      x2: Math.min(1, x + pinSize / 2),
      y2: Math.min(1, y + pinSize / 2),
    }],
  };

  return {
    target,
    style: {
      color: resolveHighlightColor(color),
      type: "area",
    },
    comment,
    author,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

export function isPinAnnotation(annotation: AnnotationItem): boolean {
  if (annotation.target.type !== "pdf") return false;
  if (annotation.style.type !== "area") return false;

  const target = annotation.target as PdfTarget;
  if (target.rects.length !== 1) return false;

  const rect = target.rects[0];
  const width = rect.x2 - rect.x1;
  const height = rect.y2 - rect.y1;

  return width < 0.05 && height < 0.05;
}

export function getPinCenter(annotation: AnnotationItem): { x: number; y: number } | null {
  if (!isPinAnnotation(annotation)) return null;

  const target = annotation.target as PdfTarget;
  const rect = target.rects[0];

  return {
    x: (rect.x1 + rect.x2) / 2,
    y: (rect.y1 + rect.y2) / 2,
  };
}

export function getColorName(color: string): string {
  const found = HIGHLIGHT_COLORS.find((candidate) => candidate.hex === color || candidate.value === color);
  return found?.name || "Custom";
}

export function isValidHighlight(highlight: unknown): highlight is PDFHighlight {
  if (!highlight || typeof highlight !== "object") return false;

  const candidate = highlight as Record<string, unknown>;

  return (
    typeof candidate.id === "string" &&
    candidate.position !== null &&
    typeof candidate.position === "object" &&
    typeof (candidate.position as Record<string, unknown>).pageNumber === "number"
  );
}
