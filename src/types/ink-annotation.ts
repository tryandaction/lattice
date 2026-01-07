/**
 * Ink Annotation Types for Stylus/Pen Input
 * 
 * Defines data structures for storing and rendering handwritten annotations.
 */

import type { StylusPoint } from '../hooks/use-stylus-input';

// ============================================================================
// Stroke Types
// ============================================================================

/**
 * A single point in a stroke with all stylus data
 */
export interface InkPoint {
  /** X coordinate (relative to canvas, 0-1 normalized) */
  x: number;
  /** Y coordinate (relative to canvas, 0-1 normalized) */
  y: number;
  /** Pressure value (0-1) */
  pressure: number;
  /** Tilt X angle in degrees (-90 to 90) */
  tiltX?: number;
  /** Tilt Y angle in degrees (-90 to 90) */
  tiltY?: number;
  /** Time offset from stroke start in milliseconds */
  timeOffset: number;
}

/**
 * Stroke style configuration
 */
export interface InkStrokeStyle {
  /** Stroke color (hex) */
  color: string;
  /** Base stroke width in pixels */
  width: number;
  /** Opacity (0-1) */
  opacity: number;
  /** Whether to apply pressure sensitivity to width */
  pressureSensitivity: boolean;
  /** Smoothing level (0-1, higher = smoother) */
  smoothing: number;
}

/**
 * Default stroke style
 */
export const DEFAULT_INK_STYLE: InkStrokeStyle = {
  color: '#000000',
  width: 3,
  opacity: 1,
  pressureSensitivity: true,
  smoothing: 0.5,
};

/**
 * A single stroke (continuous pen movement)
 */
export interface InkStroke {
  /** Unique stroke ID */
  id: string;
  /** Points in the stroke */
  points: InkPoint[];
  /** Stroke style */
  style: InkStrokeStyle;
  /** Timestamp when stroke was created */
  createdAt: number;
  /** Bounding box (normalized 0-1 coordinates) */
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

// ============================================================================
// Ink Annotation Types
// ============================================================================

/**
 * Tool types for ink annotations
 */
export type InkToolType = 'pen' | 'highlighter' | 'eraser';

/**
 * Ink annotation containing multiple strokes
 */
export interface InkAnnotation {
  /** Unique annotation ID */
  id: string;
  /** File ID this annotation belongs to */
  fileId: string;
  /** Page number (for multi-page documents) */
  page: number;
  /** All strokes in this annotation */
  strokes: InkStroke[];
  /** Tool used to create this annotation */
  tool: InkToolType;
  /** Author identifier */
  author: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last modified timestamp */
  lastModified: number;
}

/**
 * Ink annotation file structure
 */
export interface InkAnnotationFile {
  /** Version number */
  version: 1;
  /** File ID */
  fileId: string;
  /** All ink annotations */
  annotations: InkAnnotation[];
  /** Last modified timestamp */
  lastModified: number;
}

// ============================================================================
// Conversion Utilities
// ============================================================================

/**
 * Convert StylusPoint to InkPoint with normalization
 */
export function stylusPointToInkPoint(
  point: StylusPoint,
  canvasWidth: number,
  canvasHeight: number,
  strokeStartTime: number
): InkPoint {
  return {
    x: point.x / canvasWidth,
    y: point.y / canvasHeight,
    pressure: point.pressure,
    tiltX: point.tiltX,
    tiltY: point.tiltY,
    timeOffset: point.timestamp - strokeStartTime,
  };
}

/**
 * Convert InkPoint back to pixel coordinates
 */
export function inkPointToPixel(
  point: InkPoint,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number; pressure: number } {
  return {
    x: point.x * canvasWidth,
    y: point.y * canvasHeight,
    pressure: point.pressure,
  };
}

/**
 * Calculate bounding box for a set of points
 */
export function calculateStrokeBounds(points: InkPoint[]): InkStroke['bounds'] {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Check if a point is within a stroke's bounding box (with padding)
 */
export function isPointInStrokeBounds(
  x: number,
  y: number,
  bounds: InkStroke['bounds'],
  padding: number = 0.01
): boolean {
  return (
    x >= bounds.minX - padding &&
    x <= bounds.maxX + padding &&
    y >= bounds.minY - padding &&
    y <= bounds.maxY + padding
  );
}

/**
 * Check if two bounding boxes intersect
 */
export function doBoundsIntersect(
  a: InkStroke['bounds'],
  b: InkStroke['bounds']
): boolean {
  return !(
    a.maxX < b.minX ||
    a.minX > b.maxX ||
    a.maxY < b.minY ||
    a.minY > b.maxY
  );
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for InkPoint
 */
export function isInkPoint(value: unknown): value is InkPoint {
  if (typeof value !== 'object' || value === null) return false;
  const point = value as Record<string, unknown>;
  
  return (
    typeof point.x === 'number' &&
    typeof point.y === 'number' &&
    typeof point.pressure === 'number' &&
    typeof point.timeOffset === 'number' &&
    point.x >= 0 && point.x <= 1 &&
    point.y >= 0 && point.y <= 1 &&
    point.pressure >= 0 && point.pressure <= 1
  );
}

/**
 * Type guard for InkStrokeStyle
 */
export function isInkStrokeStyle(value: unknown): value is InkStrokeStyle {
  if (typeof value !== 'object' || value === null) return false;
  const style = value as Record<string, unknown>;
  
  return (
    typeof style.color === 'string' &&
    typeof style.width === 'number' &&
    typeof style.opacity === 'number' &&
    typeof style.pressureSensitivity === 'boolean' &&
    typeof style.smoothing === 'number'
  );
}

/**
 * Type guard for InkStroke
 */
export function isInkStroke(value: unknown): value is InkStroke {
  if (typeof value !== 'object' || value === null) return false;
  const stroke = value as Record<string, unknown>;
  
  if (typeof stroke.id !== 'string') return false;
  if (!Array.isArray(stroke.points)) return false;
  if (!isInkStrokeStyle(stroke.style)) return false;
  if (typeof stroke.createdAt !== 'number') return false;
  if (typeof stroke.bounds !== 'object' || stroke.bounds === null) return false;
  
  return stroke.points.every(isInkPoint);
}

/**
 * Type guard for InkAnnotation
 */
export function isInkAnnotation(value: unknown): value is InkAnnotation {
  if (typeof value !== 'object' || value === null) return false;
  const annotation = value as Record<string, unknown>;
  
  if (typeof annotation.id !== 'string') return false;
  if (typeof annotation.fileId !== 'string') return false;
  if (typeof annotation.page !== 'number') return false;
  if (!Array.isArray(annotation.strokes)) return false;
  if (!['pen', 'highlighter', 'eraser'].includes(annotation.tool as string)) return false;
  if (typeof annotation.author !== 'string') return false;
  if (typeof annotation.createdAt !== 'number') return false;
  if (typeof annotation.lastModified !== 'number') return false;
  
  return annotation.strokes.every(isInkStroke);
}

/**
 * Type guard for InkAnnotationFile
 */
export function isInkAnnotationFile(value: unknown): value is InkAnnotationFile {
  if (typeof value !== 'object' || value === null) return false;
  const file = value as Record<string, unknown>;
  
  if (file.version !== 1) return false;
  if (typeof file.fileId !== 'string') return false;
  if (typeof file.lastModified !== 'number') return false;
  if (!Array.isArray(file.annotations)) return false;
  
  return file.annotations.every(isInkAnnotation);
}

// ============================================================================
// Preset Styles
// ============================================================================

/**
 * Preset pen styles
 */
export const INK_PRESETS = {
  pen: {
    color: '#000000',
    width: 2,
    opacity: 1,
    pressureSensitivity: true,
    smoothing: 0.5,
  },
  finePen: {
    color: '#000000',
    width: 1,
    opacity: 1,
    pressureSensitivity: true,
    smoothing: 0.3,
  },
  marker: {
    color: '#000000',
    width: 6,
    opacity: 1,
    pressureSensitivity: true,
    smoothing: 0.7,
  },
  highlighter: {
    color: '#FFEB3B',
    width: 20,
    opacity: 0.4,
    pressureSensitivity: false,
    smoothing: 0.8,
  },
  brush: {
    color: '#000000',
    width: 8,
    opacity: 0.8,
    pressureSensitivity: true,
    smoothing: 0.6,
  },
} as const satisfies Record<string, InkStrokeStyle>;

/**
 * Available ink colors
 */
export const INK_COLORS = [
  '#000000', // Black
  '#FF0000', // Red
  '#00AA00', // Green
  '#0066FF', // Blue
  '#9933FF', // Purple
  '#FF6600', // Orange
  '#FF00FF', // Magenta
  '#666666', // Gray
] as const;
