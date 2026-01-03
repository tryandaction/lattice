/**
 * Coordinate Transformation Utilities for PDF Annotations
 * 
 * Handles conversion between pixel coordinates and normalized (0-1) coordinates
 * to ensure annotations remain accurate at any zoom level.
 */

import type { BoundingRect, AnnotationPosition } from '../types/annotation';

/**
 * Pixel-based rectangle (used for UI interactions)
 */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Normalizes a pixel rectangle to 0-1 range relative to page dimensions
 * 
 * @param rect - Pixel-based rectangle
 * @param pageWidth - Page width in pixels
 * @param pageHeight - Page height in pixels
 * @returns Normalized BoundingRect
 */
export function normalizeRect(
  rect: PixelRect,
  pageWidth: number,
  pageHeight: number
): BoundingRect {
  if (pageWidth <= 0 || pageHeight <= 0) {
    throw new Error('Page dimensions must be positive');
  }

  const x1 = Math.max(0, Math.min(1, rect.x / pageWidth));
  const y1 = Math.max(0, Math.min(1, rect.y / pageHeight));
  const x2 = Math.max(0, Math.min(1, (rect.x + rect.width) / pageWidth));
  const y2 = Math.max(0, Math.min(1, (rect.y + rect.height) / pageHeight));

  return {
    x1,
    y1,
    x2,
    y2,
    width: pageWidth,
    height: pageHeight,
  };
}

/**
 * Denormalizes a BoundingRect to pixel coordinates at a given scale
 * 
 * @param rect - Normalized BoundingRect
 * @param scale - Current zoom scale (1.0 = 100%)
 * @returns Pixel-based rectangle
 */
export function denormalizeRect(
  rect: BoundingRect,
  scale: number = 1.0
): PixelRect {
  if (scale <= 0) {
    throw new Error('Scale must be positive');
  }

  const scaledWidth = rect.width * scale;
  const scaledHeight = rect.height * scale;

  return {
    x: rect.x1 * scaledWidth,
    y: rect.y1 * scaledHeight,
    width: (rect.x2 - rect.x1) * scaledWidth,
    height: (rect.y2 - rect.y1) * scaledHeight,
  };
}

/**
 * Normalizes an array of pixel rectangles (for multi-line text selections)
 * 
 * @param rects - Array of pixel-based rectangles
 * @param pageWidth - Page width in pixels
 * @param pageHeight - Page height in pixels
 * @returns Array of normalized BoundingRects
 */
export function normalizeRects(
  rects: PixelRect[],
  pageWidth: number,
  pageHeight: number
): BoundingRect[] {
  return rects.map(rect => normalizeRect(rect, pageWidth, pageHeight));
}

/**
 * Denormalizes an array of BoundingRects to pixel coordinates
 * 
 * @param rects - Array of normalized BoundingRects
 * @param scale - Current zoom scale
 * @returns Array of pixel-based rectangles
 */
export function denormalizeRects(
  rects: BoundingRect[],
  scale: number = 1.0
): PixelRect[] {
  return rects.map(rect => denormalizeRect(rect, scale));
}

/**
 * Creates a normalized AnnotationPosition from pixel coordinates
 * 
 * @param boundingRect - Overall bounding box in pixels
 * @param rects - Individual rectangles for multi-line selections
 * @param pageWidth - Page width in pixels
 * @param pageHeight - Page height in pixels
 * @returns Normalized AnnotationPosition
 */
export function normalizePosition(
  boundingRect: PixelRect,
  rects: PixelRect[],
  pageWidth: number,
  pageHeight: number
): AnnotationPosition {
  return {
    boundingRect: normalizeRect(boundingRect, pageWidth, pageHeight),
    rects: normalizeRects(rects, pageWidth, pageHeight),
  };
}

/**
 * Denormalizes an AnnotationPosition to pixel coordinates
 * 
 * @param position - Normalized AnnotationPosition
 * @param scale - Current zoom scale
 * @returns Object with denormalized boundingRect and rects
 */
export function denormalizePosition(
  position: AnnotationPosition,
  scale: number = 1.0
): { boundingRect: PixelRect; rects: PixelRect[] } {
  return {
    boundingRect: denormalizeRect(position.boundingRect, scale),
    rects: denormalizeRects(position.rects, scale),
  };
}

/**
 * Calculates the bounding box that encompasses all given rectangles
 * 
 * @param rects - Array of pixel rectangles
 * @returns Single bounding rectangle containing all input rectangles
 */
export function calculateBoundingBox(rects: PixelRect[]): PixelRect {
  if (rects.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Checks if a point is inside a pixel rectangle
 * 
 * @param point - Point coordinates
 * @param rect - Pixel rectangle
 * @returns True if point is inside rectangle
 */
export function isPointInRect(
  point: { x: number; y: number },
  rect: PixelRect
): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * Checks if a point is inside a normalized BoundingRect at a given scale
 * 
 * @param point - Point coordinates in pixels
 * @param rect - Normalized BoundingRect
 * @param scale - Current zoom scale
 * @returns True if point is inside rectangle
 */
export function isPointInNormalizedRect(
  point: { x: number; y: number },
  rect: BoundingRect,
  scale: number = 1.0
): boolean {
  const pixelRect = denormalizeRect(rect, scale);
  return isPointInRect(point, pixelRect);
}

/**
 * Compares two pixel rectangles for approximate equality
 * (within floating-point tolerance)
 * 
 * @param a - First rectangle
 * @param b - Second rectangle
 * @param tolerance - Maximum allowed difference (default: 0.001)
 * @returns True if rectangles are approximately equal
 */
export function areRectsEqual(
  a: PixelRect,
  b: PixelRect,
  tolerance: number = 0.001
): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}
