/**
 * Universal Annotation Types for Lattice
 * 
 * Polymorphic annotation schema supporting PDF, Image, PPTX, Code, and HTML files.
 * Uses discriminated union types for type-safe target handling.
 */

// ============================================================================
// Bounding Box Types
// ============================================================================

/**
 * Bounding box for PDF annotations (normalized 0-1 coordinates)
 */
export interface BoundingBox {
  x1: number;  // Left edge (0-1)
  y1: number;  // Top edge (0-1)
  x2: number;  // Right edge (0-1)
  y2: number;  // Bottom edge (0-1)
}

// ============================================================================
// Annotation Target Types (Discriminated Union)
// ============================================================================

/**
 * PDF annotation target - anchors to page and rectangles
 */
export interface PdfTarget {
  type: 'pdf';
  page: number;           // 1-indexed page number
  rects: BoundingBox[];   // Selection rectangles
}

/**
 * Image annotation target - anchors to relative coordinates (0-100%)
 */
export interface ImageTarget {
  type: 'image';
  x: number;       // Left position (0-100%)
  y: number;       // Top position (0-100%)
  width: number;   // Width (0-100%)
  height: number;  // Height (0-100%)
}

/**
 * Text anchor target - for PPTX/HTML element anchoring
 */
export interface TextAnchorTarget {
  type: 'text_anchor';
  elementId: string;   // DOM element or slide element ID
  offset: number;      // Character offset within element
}

/**
 * Code line target - anchors to source code line
 */
export interface CodeLineTarget {
  type: 'code_line';
  line: number;  // 1-indexed line number
}

/**
 * Discriminated union of all annotation target types
 */
export type AnnotationTarget = 
  | PdfTarget 
  | ImageTarget 
  | TextAnchorTarget 
  | CodeLineTarget;

// ============================================================================
// Annotation Style Types
// ============================================================================

/**
 * Valid annotation style types
 */
export type AnnotationStyleType = 'highlight' | 'underline' | 'area' | 'ink' | 'text';

/**
 * Text annotation style configuration
 */
export interface TextAnnotationStyle {
  textColor: string;     // Text color (hex), default: '#000000'
  fontSize: number;      // Font size in pixels (default: 14)
  fontWeight?: 'normal' | 'bold';  // Font weight
  fontStyle?: 'normal' | 'italic'; // Font style
}

/**
 * Default text annotation style
 */
export const DEFAULT_TEXT_STYLE: TextAnnotationStyle = {
  textColor: '#000000',
  fontSize: 14,
  fontWeight: 'normal',
  fontStyle: 'normal',
};

/**
 * Available text colors for annotations
 */
export const TEXT_COLORS = [
  { value: '#000000', label: '黑色' },
  { value: '#FF0000', label: '红色' },
  { value: '#00AA00', label: '绿色' },
  { value: '#0066FF', label: '蓝色' },
  { value: '#9933FF', label: '紫色' },
  { value: '#FF6600', label: '橙色' },
  { value: '#FF00FF', label: '洋红色' },
  { value: '#666666', label: '灰色' },
] as const;

/**
 * Available background colors for annotations (including transparent)
 */
export const BACKGROUND_COLORS = [
  { value: 'transparent', label: '无背景', isTransparent: true },
  { value: '#FFEB3B', label: '黄色' },
  { value: '#FF5252', label: '红色' },
  { value: '#4CAF50', label: '绿色' },
  { value: '#2196F3', label: '蓝色' },
  { value: '#9C27B0', label: '紫色' },
  { value: '#FF4081', label: '洋红色' },
  { value: '#FF9800', label: '橙色' },
  { value: '#9E9E9E', label: '灰色' },
] as const;

/**
 * Available font sizes for text annotations
 */
export const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48] as const;

/**
 * Annotation style configuration
 */
export interface AnnotationStyle {
  color: string;  // Hex color or named color (background color, 'transparent' for no background)
  type: AnnotationStyleType;
  textStyle?: TextAnnotationStyle;  // Optional text styling for text annotations
}

/**
 * Valid style types array for validation
 */
export const ANNOTATION_STYLE_TYPES: readonly AnnotationStyleType[] = [
  'highlight', 'underline', 'area', 'ink', 'text'
] as const;

// ============================================================================
// Annotation Item Types
// ============================================================================

/**
 * Universal annotation item
 */
export interface AnnotationItem {
  id: string;                    // UUID v4
  target: AnnotationTarget;      // Polymorphic target
  style: AnnotationStyle;
  content?: string;              // Extracted text content
  comment?: string;              // User's note
  author: string;                // Author identifier
  createdAt: number;             // Unix timestamp (ms)
}

/**
 * File types supported by the annotation system
 */
export type AnnotationFileType = 'pdf' | 'image' | 'pptx' | 'code' | 'html' | 'unknown';

/**
 * Annotation file structure for sidecar JSON (Version 2)
 */
export interface UniversalAnnotationFile {
  version: 2;                    // Version 2 for universal format
  fileId: string;
  fileType: AnnotationFileType;
  annotations: AnnotationItem[];
  lastModified: number;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for BoundingBox
 * More lenient to handle floating point precision issues
 */
export function isBoundingBox(value: unknown): value is BoundingBox {
  if (typeof value !== 'object' || value === null) return false;
  const box = value as Record<string, unknown>;
  
  // Check that all required fields are numbers
  if (typeof box.x1 !== 'number' || typeof box.y1 !== 'number' ||
      typeof box.x2 !== 'number' || typeof box.y2 !== 'number') {
    return false;
  }
  
  // Allow small tolerance for floating point precision
  const tolerance = 0.001;
  return (
    box.x1 >= -tolerance && box.x1 <= 1 + tolerance &&
    box.y1 >= -tolerance && box.y1 <= 1 + tolerance &&
    box.x2 >= -tolerance && box.x2 <= 1 + tolerance &&
    box.y2 >= -tolerance && box.y2 <= 1 + tolerance
  );
}

/**
 * Type guard for PdfTarget
 */
export function isPdfTarget(value: unknown): value is PdfTarget {
  if (typeof value !== 'object' || value === null) return false;
  const target = value as Record<string, unknown>;
  
  if (target.type !== 'pdf') return false;
  if (typeof target.page !== 'number' || !Number.isInteger(target.page) || target.page < 1) return false;
  if (!Array.isArray(target.rects)) return false;
  
  return target.rects.every(isBoundingBox);
}

/**
 * Type guard for ImageTarget
 */
export function isImageTarget(value: unknown): value is ImageTarget {
  if (typeof value !== 'object' || value === null) return false;
  const target = value as Record<string, unknown>;
  
  if (target.type !== 'image') return false;
  
  return (
    typeof target.x === 'number' && target.x >= 0 && target.x <= 100 &&
    typeof target.y === 'number' && target.y >= 0 && target.y <= 100 &&
    typeof target.width === 'number' && target.width >= 0 && target.width <= 100 &&
    typeof target.height === 'number' && target.height >= 0 && target.height <= 100
  );
}

/**
 * Type guard for TextAnchorTarget
 */
export function isTextAnchorTarget(value: unknown): value is TextAnchorTarget {
  if (typeof value !== 'object' || value === null) return false;
  const target = value as Record<string, unknown>;
  
  if (target.type !== 'text_anchor') return false;
  
  return (
    typeof target.elementId === 'string' &&
    typeof target.offset === 'number' &&
    Number.isInteger(target.offset) &&
    target.offset >= 0
  );
}

/**
 * Type guard for CodeLineTarget
 */
export function isCodeLineTarget(value: unknown): value is CodeLineTarget {
  if (typeof value !== 'object' || value === null) return false;
  const target = value as Record<string, unknown>;
  
  if (target.type !== 'code_line') return false;
  
  return (
    typeof target.line === 'number' &&
    Number.isInteger(target.line) &&
    target.line >= 1
  );
}

/**
 * Type guard for AnnotationTarget (any valid target type)
 */
export function isAnnotationTarget(value: unknown): value is AnnotationTarget {
  return (
    isPdfTarget(value) ||
    isImageTarget(value) ||
    isTextAnchorTarget(value) ||
    isCodeLineTarget(value)
  );
}

/**
 * Type guard for AnnotationStyleType
 */
export function isAnnotationStyleType(value: unknown): value is AnnotationStyleType {
  return typeof value === 'string' && ANNOTATION_STYLE_TYPES.includes(value as AnnotationStyleType);
}

/**
 * Type guard for AnnotationStyle
 */
export function isAnnotationStyle(value: unknown): value is AnnotationStyle {
  if (typeof value !== 'object' || value === null) return false;
  const style = value as Record<string, unknown>;
  
  return (
    typeof style.color === 'string' &&
    style.color.length > 0 &&
    isAnnotationStyleType(style.type)
  );
}

/**
 * Type guard for AnnotationItem
 * More lenient to handle various annotation types
 */
export function isAnnotationItem(value: unknown): value is AnnotationItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  
  // Required fields
  if (typeof item.id !== 'string' || item.id.length === 0) return false;
  if (!isAnnotationTarget(item.target)) return false;
  if (!isAnnotationStyle(item.style)) return false;
  if (typeof item.author !== 'string') return false;
  if (typeof item.createdAt !== 'number') return false;
  
  // Optional fields - allow undefined, null, or correct type
  if (item.content !== undefined && item.content !== null && typeof item.content !== 'string') return false;
  if (item.comment !== undefined && item.comment !== null && typeof item.comment !== 'string') return false;
  
  return true;
}

/**
 * Type guard for AnnotationFileType
 */
export function isAnnotationFileType(value: unknown): value is AnnotationFileType {
  return (
    value === 'pdf' ||
    value === 'image' ||
    value === 'pptx' ||
    value === 'code' ||
    value === 'html' ||
    value === 'unknown'
  );
}

/**
 * Type guard for UniversalAnnotationFile
 */
export function isUniversalAnnotationFile(value: unknown): value is UniversalAnnotationFile {
  if (typeof value !== 'object' || value === null) return false;
  const file = value as Record<string, unknown>;
  
  if (file.version !== 2) return false;
  if (typeof file.fileId !== 'string') return false;
  if (!isAnnotationFileType(file.fileType)) return false;
  if (typeof file.lastModified !== 'number') return false;
  if (!Array.isArray(file.annotations)) return false;
  
  return file.annotations.every(isAnnotationItem);
}

// ============================================================================
// Validation Functions (with detailed error messages)
// ============================================================================

/**
 * Validation result with detailed errors
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates an AnnotationTarget with detailed error messages
 */
export function validateAnnotationTarget(value: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (typeof value !== 'object' || value === null) {
    return { valid: false, errors: ['Target must be an object'] };
  }
  
  const target = value as Record<string, unknown>;
  
  if (!['pdf', 'image', 'text_anchor', 'code_line'].includes(target.type as string)) {
    errors.push(`Invalid target type: ${target.type}. Must be 'pdf', 'image', 'text_anchor', or 'code_line'`);
    return { valid: false, errors };
  }
  
  switch (target.type) {
    case 'pdf':
      if (typeof target.page !== 'number' || !Number.isInteger(target.page) || target.page < 1) {
        errors.push('PDF target page must be a positive integer');
      }
      if (!Array.isArray(target.rects)) {
        errors.push('PDF target rects must be an array');
      } else {
        target.rects.forEach((rect, i) => {
          if (!isBoundingBox(rect)) {
            errors.push(`PDF target rects[${i}] is invalid: coordinates must be numbers in range 0-1`);
          }
        });
      }
      break;
      
    case 'image':
      if (typeof target.x !== 'number' || target.x < 0 || target.x > 100) {
        errors.push('Image target x must be a number in range 0-100');
      }
      if (typeof target.y !== 'number' || target.y < 0 || target.y > 100) {
        errors.push('Image target y must be a number in range 0-100');
      }
      if (typeof target.width !== 'number' || target.width < 0 || target.width > 100) {
        errors.push('Image target width must be a number in range 0-100');
      }
      if (typeof target.height !== 'number' || target.height < 0 || target.height > 100) {
        errors.push('Image target height must be a number in range 0-100');
      }
      break;
      
    case 'text_anchor':
      if (typeof target.elementId !== 'string') {
        errors.push('Text anchor target elementId must be a string');
      }
      if (typeof target.offset !== 'number' || !Number.isInteger(target.offset) || target.offset < 0) {
        errors.push('Text anchor target offset must be a non-negative integer');
      }
      break;
      
    case 'code_line':
      if (typeof target.line !== 'number' || !Number.isInteger(target.line) || target.line < 1) {
        errors.push('Code line target line must be a positive integer');
      }
      break;
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validates an AnnotationStyle with detailed error messages
 */
export function validateAnnotationStyle(value: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (typeof value !== 'object' || value === null) {
    return { valid: false, errors: ['Style must be an object'] };
  }
  
  const style = value as Record<string, unknown>;
  
  if (typeof style.color !== 'string' || style.color.length === 0) {
    errors.push('Style color must be a non-empty string');
  }
  
  if (!isAnnotationStyleType(style.type)) {
    errors.push(`Style type must be one of: ${ANNOTATION_STYLE_TYPES.join(', ')}`);
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validates an AnnotationItem with detailed error messages
 * More lenient validation to allow various annotation types
 */
export function validateAnnotationItem(value: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (typeof value !== 'object' || value === null) {
    return { valid: false, errors: ['Annotation must be an object'] };
  }
  
  const item = value as Record<string, unknown>;
  
  // Validate required fields
  if (typeof item.id !== 'string' || item.id.length === 0) {
    errors.push('Annotation id must be a non-empty string');
  }
  
  if (typeof item.author !== 'string') {
    errors.push('Annotation author must be a string');
  }
  
  if (typeof item.createdAt !== 'number') {
    errors.push('Annotation createdAt must be a number (timestamp)');
  }
  
  // Validate target - more lenient for edge cases
  if (item.target === undefined || item.target === null) {
    errors.push('Annotation target is required');
  } else {
    const targetResult = validateAnnotationTarget(item.target);
    if (!targetResult.valid) {
      errors.push(...targetResult.errors.map(e => `target: ${e}`));
    }
  }
  
  // Validate style - more lenient
  if (item.style === undefined || item.style === null) {
    errors.push('Annotation style is required');
  } else {
    const styleResult = validateAnnotationStyle(item.style);
    if (!styleResult.valid) {
      errors.push(...styleResult.errors.map(e => `style: ${e}`));
    }
  }
  
  // Validate optional fields - allow undefined, null, or string
  if (item.content !== undefined && item.content !== null && typeof item.content !== 'string') {
    errors.push('Annotation content must be a string if provided');
  }
  
  if (item.comment !== undefined && item.comment !== null && typeof item.comment !== 'string') {
    errors.push('Annotation comment must be a string if provided');
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validates a UniversalAnnotationFile with detailed error messages
 */
export function validateUniversalAnnotationFile(value: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (typeof value !== 'object' || value === null) {
    return { valid: false, errors: ['Annotation file must be an object'] };
  }
  
  const file = value as Record<string, unknown>;
  
  if (file.version !== 2) {
    errors.push('Annotation file version must be 2');
  }
  
  if (typeof file.fileId !== 'string') {
    errors.push('Annotation file fileId must be a string');
  }
  
  if (!isAnnotationFileType(file.fileType)) {
    errors.push('Annotation file fileType must be one of: pdf, image, pptx, code, html, unknown');
  }
  
  if (typeof file.lastModified !== 'number') {
    errors.push('Annotation file lastModified must be a number (timestamp)');
  }
  
  if (!Array.isArray(file.annotations)) {
    errors.push('Annotation file annotations must be an array');
  } else {
    file.annotations.forEach((ann, i) => {
      const result = validateAnnotationItem(ann);
      if (!result.valid) {
        errors.push(...result.errors.map(e => `annotations[${i}]: ${e}`));
      }
    });
  }
  
  return { valid: errors.length === 0, errors };
}
