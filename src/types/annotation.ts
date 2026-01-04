/**
 * PDF Annotation Types for Lattice
 * 
 * These types define the structure for PDF annotations stored in sidecar JSON files.
 * Coordinates are normalized (0-1 range) relative to page dimensions for zoom independence.
 */

/**
 * Bounding rectangle with normalized coordinates (0-1 range)
 */
export interface BoundingRect {
  x1: number;  // Left edge (0-1 normalized)
  y1: number;  // Top edge (0-1 normalized)
  x2: number;  // Right edge (0-1 normalized)
  y2: number;  // Bottom edge (0-1 normalized)
  width: number;   // Page width at time of creation (pixels)
  height: number;  // Page height at time of creation (pixels)
}

/**
 * Content captured from the highlighted region
 */
export interface AnnotationContent {
  text?: string;           // Selected text content (for text highlights)
  image?: string;          // Base64 thumbnail (for area highlights)
  displayText?: string;    // Display text for textNote annotations
  backgroundColor?: string; // Background color for textNote (hex or 'transparent')
  textStyle?: TextNoteStyle; // Text styling for textNote annotations
}

/**
 * Text annotation style for textNote type
 */
export interface TextNoteStyle {
  textColor: string;     // Text color (hex)
  fontSize: number;      // Font size in pixels
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
}

/**
 * Available highlight colors
 */
export type AnnotationColor = 'yellow' | 'red' | 'green' | 'blue' | string;

/**
 * Annotation type discriminator
 */
export type AnnotationType = 'text' | 'area' | 'textNote';

/**
 * Position data for an annotation
 */
export interface AnnotationPosition {
  boundingRect: BoundingRect;  // Overall bounding box
  rects: BoundingRect[];       // Individual rects for multi-line selections
}

/**
 * Core annotation interface
 */
export interface LatticeAnnotation {
  id: string;                    // UUID v4
  fileId: string;                // File path identifier
  page: number;                  // 1-indexed page number
  position: AnnotationPosition;
  content: AnnotationContent;
  comment: string;               // User's note (empty string if none)
  color: AnnotationColor;
  timestamp: number;             // Unix timestamp (ms)
  type: AnnotationType;          // Highlight type
}

/**
 * Annotation file structure for sidecar JSON
 */
export interface AnnotationFile {
  version: 1;
  fileId: string;
  annotations: LatticeAnnotation[];
  lastModified: number;          // Unix timestamp (ms)
}

/**
 * Valid annotation colors array for validation
 */
export const ANNOTATION_COLORS: readonly AnnotationColor[] = ['yellow', 'red', 'green', 'blue'] as const;

/**
 * Valid annotation types array for validation
 */
export const ANNOTATION_TYPES: readonly AnnotationType[] = ['text', 'area', 'textNote'] as const;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a valid AnnotationColor
 */
export function isAnnotationColor(value: unknown): value is AnnotationColor {
  // Accept standard colors or any hex color string
  if (typeof value !== 'string') return false;
  if (ANNOTATION_COLORS.includes(value as any)) return true;
  // Accept hex colors and 'transparent'
  return value === 'transparent' || /^#[0-9A-Fa-f]{6}$/.test(value);
}

/**
 * Type guard to check if a value is a valid AnnotationType
 */
export function isAnnotationType(value: unknown): value is AnnotationType {
  return typeof value === 'string' && ANNOTATION_TYPES.includes(value as AnnotationType);
}

/**
 * Type guard to check if a value is a valid BoundingRect
 */
export function isBoundingRect(value: unknown): value is BoundingRect {
  if (typeof value !== 'object' || value === null) return false;
  const rect = value as Record<string, unknown>;
  
  return (
    typeof rect.x1 === 'number' &&
    typeof rect.y1 === 'number' &&
    typeof rect.x2 === 'number' &&
    typeof rect.y2 === 'number' &&
    typeof rect.width === 'number' &&
    typeof rect.height === 'number' &&
    rect.x1 >= 0 && rect.x1 <= 1 &&
    rect.y1 >= 0 && rect.y1 <= 1 &&
    rect.x2 >= 0 && rect.x2 <= 1 &&
    rect.y2 >= 0 && rect.y2 <= 1 &&
    rect.width >= 0 &&
    rect.height >= 0
  );
}

/**
 * Type guard to check if a value is a valid AnnotationPosition
 */
export function isAnnotationPosition(value: unknown): value is AnnotationPosition {
  if (typeof value !== 'object' || value === null) return false;
  const pos = value as Record<string, unknown>;
  
  if (!isBoundingRect(pos.boundingRect)) return false;
  if (!Array.isArray(pos.rects)) return false;
  
  return pos.rects.every(isBoundingRect);
}

/**
 * Type guard to check if a value is a valid AnnotationContent
 */
export function isAnnotationContent(value: unknown): value is AnnotationContent {
  if (typeof value !== 'object' || value === null) return false;
  const content = value as Record<string, unknown>;
  
  // All fields are optional, but if present must be correct types
  if (content.text !== undefined && typeof content.text !== 'string') return false;
  if (content.image !== undefined && typeof content.image !== 'string') return false;
  if (content.displayText !== undefined && typeof content.displayText !== 'string') return false;
  if (content.backgroundColor !== undefined && typeof content.backgroundColor !== 'string') return false;
  
  // textStyle validation
  if (content.textStyle !== undefined) {
    if (typeof content.textStyle !== 'object' || content.textStyle === null) return false;
    const style = content.textStyle as Record<string, unknown>;
    if (typeof style.textColor !== 'string') return false;
    if (typeof style.fontSize !== 'number') return false;
  }
  
  return true;
}

/**
 * Type guard to check if a value is a valid LatticeAnnotation
 */
export function isLatticeAnnotation(value: unknown): value is LatticeAnnotation {
  if (typeof value !== 'object' || value === null) return false;
  const ann = value as Record<string, unknown>;
  
  return (
    typeof ann.id === 'string' &&
    typeof ann.fileId === 'string' &&
    typeof ann.page === 'number' &&
    Number.isInteger(ann.page) &&
    ann.page >= 1 &&
    isAnnotationPosition(ann.position) &&
    isAnnotationContent(ann.content) &&
    typeof ann.comment === 'string' &&
    isAnnotationColor(ann.color) &&
    typeof ann.timestamp === 'number' &&
    isAnnotationType(ann.type)
  );
}

/**
 * Type guard to check if a value is a valid AnnotationFile
 */
export function isAnnotationFile(value: unknown): value is AnnotationFile {
  if (typeof value !== 'object' || value === null) return false;
  const file = value as Record<string, unknown>;
  
  if (file.version !== 1) return false;
  if (typeof file.fileId !== 'string') return false;
  if (typeof file.lastModified !== 'number') return false;
  if (!Array.isArray(file.annotations)) return false;
  
  return file.annotations.every(isLatticeAnnotation);
}
