/**
 * Annotation Utilities for Lattice PDF Annotations
 * 
 * Provides validation, creation, and manipulation functions for annotations.
 */

import type {
  LatticeAnnotation,
  AnnotationPosition,
  AnnotationContent,
  AnnotationColor,
  AnnotationType,
  AnnotationFile,
} from '../types/annotation';
import {
  isBoundingRect,
  isAnnotationPosition,
  isAnnotationContent,
  isAnnotationColor,
  isAnnotationType,
  isLatticeAnnotation,
  isAnnotationFile,
} from '../types/annotation';

// ============================================================================
// Validation Functions
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a BoundingRect with detailed error messages
 */
export function validateBoundingRect(value: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (typeof value !== 'object' || value === null) {
    return { valid: false, errors: ['BoundingRect must be an object'] };
  }
  
  const rect = value as Record<string, unknown>;
  
  // Check required fields exist and are numbers
  const requiredFields = ['x1', 'y1', 'x2', 'y2', 'width', 'height'];
  for (const field of requiredFields) {
    if (typeof rect[field] !== 'number') {
      errors.push(`BoundingRect.${field} must be a number`);
    }
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  // Check coordinate ranges (0-1 normalized)
  const coordFields = ['x1', 'y1', 'x2', 'y2'] as const;
  for (const field of coordFields) {
    const val = rect[field] as number;
    if (val < 0 || val > 1) {
      errors.push(`BoundingRect.${field} must be in range [0, 1], got ${val}`);
    }
  }
  
  // Check dimensions are non-negative
  if ((rect.width as number) < 0) {
    errors.push('BoundingRect.width must be non-negative');
  }
  if ((rect.height as number) < 0) {
    errors.push('BoundingRect.height must be non-negative');
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validates an AnnotationPosition with detailed error messages
 */
export function validateAnnotationPosition(value: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (typeof value !== 'object' || value === null) {
    return { valid: false, errors: ['AnnotationPosition must be an object'] };
  }
  
  const pos = value as Record<string, unknown>;
  
  // Validate boundingRect
  const boundingRectResult = validateBoundingRect(pos.boundingRect);
  if (!boundingRectResult.valid) {
    errors.push(...boundingRectResult.errors.map(e => `position.${e}`));
  }
  
  // Validate rects array
  if (!Array.isArray(pos.rects)) {
    errors.push('AnnotationPosition.rects must be an array');
  } else {
    pos.rects.forEach((rect, index) => {
      const rectResult = validateBoundingRect(rect);
      if (!rectResult.valid) {
        errors.push(...rectResult.errors.map(e => `position.rects[${index}].${e}`));
      }
    });
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validates an AnnotationContent with detailed error messages
 */
export function validateAnnotationContent(value: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (typeof value !== 'object' || value === null) {
    return { valid: false, errors: ['AnnotationContent must be an object'] };
  }
  
  const content = value as Record<string, unknown>;
  
  if (content.text !== undefined && typeof content.text !== 'string') {
    errors.push('AnnotationContent.text must be a string if provided');
  }
  
  if (content.image !== undefined && typeof content.image !== 'string') {
    errors.push('AnnotationContent.image must be a string if provided');
  }
  
  if (content.displayText !== undefined && typeof content.displayText !== 'string') {
    errors.push('AnnotationContent.displayText must be a string if provided');
  }
  
  if (content.backgroundColor !== undefined && typeof content.backgroundColor !== 'string') {
    errors.push('AnnotationContent.backgroundColor must be a string if provided');
  }
  
  // Validate textStyle if present
  if (content.textStyle !== undefined) {
    if (typeof content.textStyle !== 'object' || content.textStyle === null) {
      errors.push('AnnotationContent.textStyle must be an object if provided');
    } else {
      const style = content.textStyle as Record<string, unknown>;
      if (typeof style.textColor !== 'string') {
        errors.push('AnnotationContent.textStyle.textColor must be a string');
      }
      if (typeof style.fontSize !== 'number') {
        errors.push('AnnotationContent.textStyle.fontSize must be a number');
      }
    }
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validates a LatticeAnnotation with detailed error messages
 */
export function validateAnnotation(value: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (typeof value !== 'object' || value === null) {
    return { valid: false, errors: ['Annotation must be an object'] };
  }
  
  const ann = value as Record<string, unknown>;
  
  // Validate id
  if (typeof ann.id !== 'string') {
    errors.push('Annotation.id must be a string');
  } else if (ann.id.length === 0) {
    errors.push('Annotation.id must not be empty');
  }
  
  // Validate fileId
  if (typeof ann.fileId !== 'string') {
    errors.push('Annotation.fileId must be a string');
  } else if (ann.fileId.length === 0) {
    errors.push('Annotation.fileId must not be empty');
  }
  
  // Validate page
  if (typeof ann.page !== 'number') {
    errors.push('Annotation.page must be a number');
  } else if (!Number.isInteger(ann.page) || ann.page < 1) {
    errors.push('Annotation.page must be a positive integer');
  }
  
  // Validate position
  const positionResult = validateAnnotationPosition(ann.position);
  if (!positionResult.valid) {
    errors.push(...positionResult.errors);
  }
  
  // Validate content
  const contentResult = validateAnnotationContent(ann.content);
  if (!contentResult.valid) {
    errors.push(...contentResult.errors);
  }
  
  // Validate comment
  if (typeof ann.comment !== 'string') {
    errors.push('Annotation.comment must be a string');
  }
  
  // Validate color - now accepts hex colors and 'transparent' as well
  if (!isAnnotationColor(ann.color)) {
    errors.push(`Annotation.color must be a valid color (yellow, red, green, blue, hex color, or transparent)`);
  }
  
  // Validate timestamp
  if (typeof ann.timestamp !== 'number') {
    errors.push('Annotation.timestamp must be a number');
  }
  
  // Validate type
  if (!isAnnotationType(ann.type)) {
    errors.push('Annotation.type must be one of: text, area, textNote');
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validates an AnnotationFile with detailed error messages
 */
export function validateAnnotationFile(value: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (typeof value !== 'object' || value === null) {
    return { valid: false, errors: ['AnnotationFile must be an object'] };
  }
  
  const file = value as Record<string, unknown>;
  
  // Validate version
  if (file.version !== 1) {
    errors.push('AnnotationFile.version must be 1');
  }
  
  // Validate fileId
  if (typeof file.fileId !== 'string') {
    errors.push('AnnotationFile.fileId must be a string');
  }
  
  // Validate lastModified
  if (typeof file.lastModified !== 'number') {
    errors.push('AnnotationFile.lastModified must be a number');
  }
  
  // Validate annotations array
  if (!Array.isArray(file.annotations)) {
    errors.push('AnnotationFile.annotations must be an array');
  } else {
    file.annotations.forEach((ann, index) => {
      const annResult = validateAnnotation(ann);
      if (!annResult.valid) {
        errors.push(...annResult.errors.map(e => `annotations[${index}].${e}`));
      }
    });
  }
  
  return { valid: errors.length === 0, errors };
}

// ============================================================================
// UUID Generation
// ============================================================================

/**
 * Generates a unique annotation ID using UUID v4
 */
export function generateAnnotationId(): string {
  return crypto.randomUUID();
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Creates a new annotation with default values
 */
export function createAnnotation(
  params: {
    fileId: string;
    page: number;
    position: AnnotationPosition;
    content: AnnotationContent;
    color: AnnotationColor;
    type: AnnotationType;
    comment?: string;
  }
): LatticeAnnotation {
  return {
    id: generateAnnotationId(),
    fileId: params.fileId,
    page: params.page,
    position: params.position,
    content: params.content,
    comment: params.comment ?? '',
    color: params.color,
    timestamp: Date.now(),
    type: params.type,
  };
}

/**
 * Creates an empty annotation file
 */
export function createAnnotationFile(fileId: string): AnnotationFile {
  return {
    version: 1,
    fileId,
    annotations: [],
    lastModified: Date.now(),
  };
}

// Re-export type guards for convenience
export {
  isBoundingRect,
  isAnnotationPosition,
  isAnnotationContent,
  isAnnotationColor,
  isAnnotationType,
  isLatticeAnnotation,
  isAnnotationFile,
};
