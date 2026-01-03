/**
 * Tldraw Serialization Utilities
 * 
 * Converts between Tldraw store format and annotation-compatible JSON.
 * Handles coordinate conversion between absolute pixels and percentages.
 */

import { type PercentageRect } from './coordinate-transforms';

// ============================================================================
// Types
// ============================================================================

/**
 * Simplified shape data for serialization
 * We store only the essential properties needed to restore shapes
 */
export interface SerializedShape {
  id: string;
  type: string;
  x: number;  // Percentage (0-100)
  y: number;  // Percentage (0-100)
  props: Record<string, unknown>;
  rotation?: number;
  isLocked?: boolean;
  opacity?: number;
}

/**
 * Serialized Tldraw store data
 */
export interface TldrawShapeData {
  version: 1;
  shapes: SerializedShape[];
  imageWidth: number;
  imageHeight: number;
}

/**
 * Tldraw shape from the store (simplified interface)
 */
export interface TldrawShape {
  id: string;
  type: string;
  x: number;
  y: number;
  props: Record<string, unknown>;
  rotation?: number;
  isLocked?: boolean;
  opacity?: number;
}

// ============================================================================
// Serialization Functions
// ============================================================================

/**
 * Converts a Tldraw shape's absolute coordinates to percentages
 */
export function shapeToPercentage(
  shape: TldrawShape,
  imageWidth: number,
  imageHeight: number
): SerializedShape {
  // Convert position to percentage
  const xPercent = (shape.x / imageWidth) * 100;
  const yPercent = (shape.y / imageHeight) * 100;

  // Clone props and convert any dimension properties
  const props = { ...shape.props };
  
  // Convert width/height in props if present
  if (typeof props.w === 'number') {
    props.w = (props.w as number / imageWidth) * 100;
  }
  if (typeof props.h === 'number') {
    props.h = (props.h as number / imageHeight) * 100;
  }

  return {
    id: shape.id,
    type: shape.type,
    x: xPercent,
    y: yPercent,
    props,
    rotation: shape.rotation,
    isLocked: shape.isLocked,
    opacity: shape.opacity,
  };
}

/**
 * Converts a serialized shape's percentage coordinates to absolute pixels
 */
export function shapeToAbsolute(
  shape: SerializedShape,
  canvasWidth: number,
  canvasHeight: number
): TldrawShape {
  // Convert position from percentage to absolute
  const x = (shape.x / 100) * canvasWidth;
  const y = (shape.y / 100) * canvasHeight;

  // Clone props and convert dimension properties back
  const props = { ...shape.props };
  
  if (typeof props.w === 'number') {
    props.w = (props.w as number / 100) * canvasWidth;
  }
  if (typeof props.h === 'number') {
    props.h = (props.h as number / 100) * canvasHeight;
  }

  return {
    id: shape.id,
    type: shape.type,
    x,
    y,
    props,
    rotation: shape.rotation,
    isLocked: shape.isLocked,
    opacity: shape.opacity,
  };
}

/**
 * Serializes an array of Tldraw shapes to percentage-based format
 */
export function serializeShapes(
  shapes: TldrawShape[],
  imageWidth: number,
  imageHeight: number
): TldrawShapeData {
  if (imageWidth <= 0 || imageHeight <= 0) {
    throw new Error('Image dimensions must be positive');
  }

  return {
    version: 1,
    shapes: shapes.map(shape => shapeToPercentage(shape, imageWidth, imageHeight)),
    imageWidth,
    imageHeight,
  };
}

/**
 * Deserializes shapes from percentage-based format to absolute coordinates
 */
export function deserializeShapes(
  data: TldrawShapeData,
  canvasWidth: number,
  canvasHeight: number
): TldrawShape[] {
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    throw new Error('Canvas dimensions must be positive');
  }

  return data.shapes.map(shape => shapeToAbsolute(shape, canvasWidth, canvasHeight));
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validates serialized shape data
 */
export function isValidTldrawShapeData(data: unknown): data is TldrawShapeData {
  if (!data || typeof data !== 'object') return false;
  
  const d = data as Record<string, unknown>;
  
  if (d.version !== 1) return false;
  if (!Array.isArray(d.shapes)) return false;
  if (typeof d.imageWidth !== 'number' || d.imageWidth <= 0) return false;
  if (typeof d.imageHeight !== 'number' || d.imageHeight <= 0) return false;
  
  return d.shapes.every(isValidSerializedShape);
}

/**
 * Validates a single serialized shape
 */
export function isValidSerializedShape(shape: unknown): shape is SerializedShape {
  if (!shape || typeof shape !== 'object') return false;
  
  const s = shape as Record<string, unknown>;
  
  return (
    typeof s.id === 'string' &&
    typeof s.type === 'string' &&
    typeof s.x === 'number' &&
    typeof s.y === 'number' &&
    s.x >= 0 && s.x <= 100 &&
    s.y >= 0 && s.y <= 100 &&
    typeof s.props === 'object' && s.props !== null
  );
}

// ============================================================================
// JSON Conversion
// ============================================================================

/**
 * Converts Tldraw shapes to JSON string for storage
 */
export function shapesToJSON(
  shapes: TldrawShape[],
  imageWidth: number,
  imageHeight: number
): string {
  const data = serializeShapes(shapes, imageWidth, imageHeight);
  return JSON.stringify(data);
}

/**
 * Parses JSON string to Tldraw shapes
 * Returns null if parsing fails or data is invalid
 */
export function jsonToShapes(
  json: string,
  canvasWidth: number,
  canvasHeight: number
): TldrawShape[] | null {
  try {
    const data = JSON.parse(json);
    
    if (!isValidTldrawShapeData(data)) {
      console.warn('Invalid Tldraw shape data');
      return null;
    }
    
    return deserializeShapes(data, canvasWidth, canvasHeight);
  } catch (error) {
    console.error('Failed to parse Tldraw shapes:', error);
    return null;
  }
}

// ============================================================================
// Annotation Integration
// ============================================================================

/**
 * Converts Tldraw shapes to annotation content string
 * This is stored in the annotation's content field
 */
export function shapesToAnnotationContent(
  shapes: TldrawShape[],
  imageWidth: number,
  imageHeight: number
): string {
  return shapesToJSON(shapes, imageWidth, imageHeight);
}

/**
 * Extracts Tldraw shapes from annotation content
 */
export function annotationContentToShapes(
  content: string | undefined,
  canvasWidth: number,
  canvasHeight: number
): TldrawShape[] {
  if (!content) return [];
  return jsonToShapes(content, canvasWidth, canvasHeight) || [];
}

/**
 * Calculates the bounding box of all shapes in percentage coordinates
 */
export function calculateShapesBoundingBox(
  shapes: SerializedShape[]
): PercentageRect | null {
  if (shapes.length === 0) return null;
  
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  
  for (const shape of shapes) {
    const w = typeof shape.props.w === 'number' ? shape.props.w : 10;
    const h = typeof shape.props.h === 'number' ? shape.props.h : 10;
    
    minX = Math.min(minX, shape.x);
    minY = Math.min(minY, shape.y);
    maxX = Math.max(maxX, shape.x + w);
    maxY = Math.max(maxY, shape.y + h);
  }
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
