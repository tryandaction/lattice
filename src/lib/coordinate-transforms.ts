/**
 * Coordinate Transformation Utilities
 * 
 * Provides coordinate conversion functions for:
 * - PDF: normalized (0-1) to pdf-lib points
 * - Image/Tldraw: absolute pixels to/from percentages (0-100)
 */

import type { BoundingBox } from '../types/universal-annotation';

// ============================================================================
// Types
// ============================================================================

/**
 * Rectangle in pdf-lib coordinate system (points from bottom-left)
 */
export interface PDFRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Rectangle in percentage coordinates (0-100)
 */
export interface PercentageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Rectangle in absolute pixel coordinates
 */
export interface AbsoluteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Point in percentage coordinates (0-100)
 */
export interface PercentagePoint {
  x: number;
  y: number;
}

/**
 * Point in absolute pixel coordinates
 */
export interface AbsolutePoint {
  x: number;
  y: number;
}

// ============================================================================
// PDF Coordinate Transforms
// ============================================================================

/**
 * Converts normalized PDF coordinates (0-1) to pdf-lib points
 * 
 * PDF coordinate system:
 * - Origin at bottom-left
 * - Units in points (72 points = 1 inch)
 * 
 * Normalized coordinates:
 * - Origin at top-left
 * - Range 0-1 relative to page dimensions
 * 
 * @param rect - Bounding box in normalized coordinates (0-1)
 * @param pageWidth - Page width in points
 * @param pageHeight - Page height in points
 * @returns Rectangle in pdf-lib coordinate system
 */
export function normalizedToPoints(
  rect: BoundingBox,
  pageWidth: number,
  pageHeight: number
): PDFRect {
  // Convert normalized (0-1) to points
  const x = rect.x1 * pageWidth;
  const width = (rect.x2 - rect.x1) * pageWidth;
  const height = (rect.y2 - rect.y1) * pageHeight;
  
  // Flip Y axis: PDF origin is bottom-left, normalized origin is top-left
  const y = pageHeight - (rect.y2 * pageHeight);
  
  return { x, y, width, height };
}

/**
 * Converts pdf-lib points to normalized coordinates (0-1)
 * 
 * @param rect - Rectangle in pdf-lib coordinate system
 * @param pageWidth - Page width in points
 * @param pageHeight - Page height in points
 * @returns Bounding box in normalized coordinates
 */
export function pointsToNormalized(
  rect: PDFRect,
  pageWidth: number,
  pageHeight: number
): BoundingBox {
  const x1 = rect.x / pageWidth;
  const x2 = (rect.x + rect.width) / pageWidth;
  
  // Flip Y axis back
  const y2 = (pageHeight - rect.y) / pageHeight;
  const y1 = y2 - (rect.height / pageHeight);
  
  return { x1, y1, x2, y2 };
}

// ============================================================================
// Image/Tldraw Coordinate Transforms
// ============================================================================

/**
 * Converts absolute pixel coordinates to percentage (0-100)
 * 
 * @param point - Point in absolute pixels
 * @param canvasWidth - Canvas width in pixels
 * @param canvasHeight - Canvas height in pixels
 * @returns Point in percentage coordinates
 */
export function absoluteToPercentage(
  point: AbsolutePoint,
  canvasWidth: number,
  canvasHeight: number
): PercentagePoint {
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    throw new Error('Canvas dimensions must be positive');
  }
  
  return {
    x: (point.x / canvasWidth) * 100,
    y: (point.y / canvasHeight) * 100,
  };
}

/**
 * Converts percentage coordinates (0-100) to absolute pixels
 * 
 * @param point - Point in percentage coordinates
 * @param canvasWidth - Canvas width in pixels
 * @param canvasHeight - Canvas height in pixels
 * @returns Point in absolute pixels
 */
export function percentageToAbsolute(
  point: PercentagePoint,
  canvasWidth: number,
  canvasHeight: number
): AbsolutePoint {
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    throw new Error('Canvas dimensions must be positive');
  }
  
  return {
    x: (point.x / 100) * canvasWidth,
    y: (point.y / 100) * canvasHeight,
  };
}

/**
 * Converts absolute pixel rectangle to percentage (0-100)
 * 
 * @param rect - Rectangle in absolute pixels
 * @param canvasWidth - Canvas width in pixels
 * @param canvasHeight - Canvas height in pixels
 * @returns Rectangle in percentage coordinates
 */
export function absoluteRectToPercentage(
  rect: AbsoluteRect,
  canvasWidth: number,
  canvasHeight: number
): PercentageRect {
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    throw new Error('Canvas dimensions must be positive');
  }
  
  return {
    x: (rect.x / canvasWidth) * 100,
    y: (rect.y / canvasHeight) * 100,
    width: (rect.width / canvasWidth) * 100,
    height: (rect.height / canvasHeight) * 100,
  };
}

/**
 * Converts percentage rectangle (0-100) to absolute pixels
 * 
 * @param rect - Rectangle in percentage coordinates
 * @param canvasWidth - Canvas width in pixels
 * @param canvasHeight - Canvas height in pixels
 * @returns Rectangle in absolute pixels
 */
export function percentageRectToAbsolute(
  rect: PercentageRect,
  canvasWidth: number,
  canvasHeight: number
): AbsoluteRect {
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    throw new Error('Canvas dimensions must be positive');
  }
  
  return {
    x: (rect.x / 100) * canvasWidth,
    y: (rect.y / 100) * canvasHeight,
    width: (rect.width / 100) * canvasWidth,
    height: (rect.height / 100) * canvasHeight,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Clamps a value to a range
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Clamps percentage coordinates to valid range (0-100)
 */
export function clampPercentage(point: PercentagePoint): PercentagePoint {
  return {
    x: clamp(point.x, 0, 100),
    y: clamp(point.y, 0, 100),
  };
}

/**
 * Clamps percentage rectangle to valid range (0-100)
 */
export function clampPercentageRect(rect: PercentageRect): PercentageRect {
  return {
    x: clamp(rect.x, 0, 100),
    y: clamp(rect.y, 0, 100),
    width: clamp(rect.width, 0, 100 - rect.x),
    height: clamp(rect.height, 0, 100 - rect.y),
  };
}

/**
 * Checks if two numbers are approximately equal within tolerance
 */
export function approxEqual(a: number, b: number, tolerance: number = 0.0001): boolean {
  return Math.abs(a - b) <= tolerance;
}

/**
 * Checks if two points are approximately equal within tolerance
 */
export function pointsApproxEqual(
  a: PercentagePoint | AbsolutePoint,
  b: PercentagePoint | AbsolutePoint,
  tolerance: number = 0.01
): boolean {
  return approxEqual(a.x, b.x, tolerance) && approxEqual(a.y, b.y, tolerance);
}

/**
 * Checks if two rectangles are approximately equal within tolerance
 */
export function rectsApproxEqual(
  a: PercentageRect | AbsoluteRect,
  b: PercentageRect | AbsoluteRect,
  tolerance: number = 0.01
): boolean {
  return (
    approxEqual(a.x, b.x, tolerance) &&
    approxEqual(a.y, b.y, tolerance) &&
    approxEqual(a.width, b.width, tolerance) &&
    approxEqual(a.height, b.height, tolerance)
  );
}
