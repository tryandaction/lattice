/**
 * Property-based tests for annotation utilities
 * 
 * Feature: pdf-annotation-engine
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  validateBoundingRect,
  validateAnnotation,
  validateAnnotationFile,
  generateAnnotationId,
  createAnnotation,
  createAnnotationFile,
  isBoundingRect,
  isLatticeAnnotation,
  isAnnotationFile,
} from '../annotation-utils';
import type {
  BoundingRect,
  LatticeAnnotation,
  AnnotationColor,
  AnnotationType,
  AnnotationFile,
} from '../../types/annotation';
import { ANNOTATION_COLORS, ANNOTATION_TYPES } from '../../types/annotation';

// ============================================================================
// Arbitrary Generators
// ============================================================================

/**
 * Generator for valid normalized coordinates (0-1 range)
 */
const normalizedCoord = fc.double({ min: 0, max: 1, noNaN: true });

/**
 * Generator for valid page dimensions (positive numbers)
 */
const pageDimension = fc.double({ min: 1, max: 10000, noNaN: true });

/**
 * Generator for valid BoundingRect
 */
const boundingRectArb: fc.Arbitrary<BoundingRect> = fc.record({
  x1: normalizedCoord,
  y1: normalizedCoord,
  x2: normalizedCoord,
  y2: normalizedCoord,
  width: pageDimension,
  height: pageDimension,
});

/**
 * Generator for valid AnnotationColor
 */
const annotationColorArb: fc.Arbitrary<AnnotationColor> = fc.constantFrom(...ANNOTATION_COLORS);

/**
 * Generator for valid AnnotationType
 */
const annotationTypeArb: fc.Arbitrary<AnnotationType> = fc.constantFrom(...ANNOTATION_TYPES);

/**
 * Generator for valid LatticeAnnotation
 */
const latticeAnnotationArb: fc.Arbitrary<LatticeAnnotation> = fc.record({
  id: fc.uuid(),
  fileId: fc.string({ minLength: 1 }),
  page: fc.integer({ min: 1, max: 10000 }),
  position: fc.record({
    boundingRect: boundingRectArb,
    rects: fc.array(boundingRectArb, { minLength: 0, maxLength: 10 }),
  }),
  content: fc.record({
    text: fc.option(fc.string(), { nil: undefined }),
    image: fc.option(fc.string(), { nil: undefined }),
  }),
  comment: fc.string(),
  color: annotationColorArb,
  timestamp: fc.integer({ min: 0 }),
  type: annotationTypeArb,
});

/**
 * Generator for valid AnnotationFile
 */
const annotationFileArb: fc.Arbitrary<AnnotationFile> = fc.record({
  version: fc.constant(1 as const),
  fileId: fc.string({ minLength: 1 }),
  annotations: fc.array(latticeAnnotationArb, { minLength: 0, maxLength: 20 }),
  lastModified: fc.integer({ min: 0 }),
});

// ============================================================================
// Property 1: Annotation Structure Validation
// Feature: pdf-annotation-engine, Property 1: Annotation Structure Validation
// Validates: Requirements 1.1, 1.2, 1.3, 7.1
// ============================================================================

describe('Property 1: Annotation Structure Validation', () => {
  it('valid BoundingRect objects pass validation', () => {
    fc.assert(
      fc.property(boundingRectArb, (rect) => {
        const result = validateBoundingRect(rect);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(isBoundingRect(rect)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('BoundingRect coordinates must be in 0-1 range', () => {
    fc.assert(
      fc.property(
        fc.record({
          x1: fc.double({ min: 1.01, max: 100, noNaN: true }),
          y1: normalizedCoord,
          x2: normalizedCoord,
          y2: normalizedCoord,
          width: pageDimension,
          height: pageDimension,
        }),
        (rect) => {
          const result = validateBoundingRect(rect);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.includes('x1'))).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('valid LatticeAnnotation objects pass validation', () => {
    fc.assert(
      fc.property(latticeAnnotationArb, (annotation) => {
        const result = validateAnnotation(annotation);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(isLatticeAnnotation(annotation)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('LatticeAnnotation must have all required fields', () => {
    fc.assert(
      fc.property(latticeAnnotationArb, (annotation) => {
        // Remove a required field
        const { id, ...withoutId } = annotation;
        const result = validateAnnotation(withoutId);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('id'))).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('LatticeAnnotation page must be positive integer', () => {
    fc.assert(
      fc.property(
        latticeAnnotationArb,
        fc.integer({ min: -1000, max: 0 }),
        (annotation, invalidPage) => {
          const invalid = { ...annotation, page: invalidPage };
          const result = validateAnnotation(invalid);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.includes('page'))).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('LatticeAnnotation color must be valid enum value', () => {
    fc.assert(
      fc.property(
        latticeAnnotationArb,
        fc.string().filter(s => !ANNOTATION_COLORS.includes(s as AnnotationColor)),
        (annotation, invalidColor) => {
          const invalid = { ...annotation, color: invalidColor };
          const result = validateAnnotation(invalid);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.includes('color'))).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('valid AnnotationFile objects pass validation', () => {
    fc.assert(
      fc.property(annotationFileArb, (file) => {
        const result = validateAnnotationFile(file);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(isAnnotationFile(file)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 2: UUID Generation Uniqueness
// Feature: pdf-annotation-engine, Property 2: UUID Generation Uniqueness
// Validates: Requirements 1.5
// ============================================================================

describe('Property 2: UUID Generation Uniqueness', () => {
  it('generated IDs are unique', () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 100 }), (count) => {
        const ids = new Set<string>();
        for (let i = 0; i < count; i++) {
          ids.add(generateAnnotationId());
        }
        expect(ids.size).toBe(count);
      }),
      { numRuns: 100 }
    );
  });

  it('generated IDs match UUID v4 format', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (count) => {
        const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        for (let i = 0; i < count; i++) {
          const id = generateAnnotationId();
          expect(id).toMatch(uuidV4Regex);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('Factory Functions', () => {
  it('createAnnotation produces valid annotations', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.record({
          boundingRect: boundingRectArb,
          rects: fc.array(boundingRectArb),
        }),
        annotationColorArb,
        annotationTypeArb,
        (fileId, page, position, color, type) => {
          const annotation = createAnnotation({
            fileId,
            page,
            position,
            content: { text: 'test' },
            color,
            type,
          });
          
          expect(isLatticeAnnotation(annotation)).toBe(true);
          expect(annotation.fileId).toBe(fileId);
          expect(annotation.page).toBe(page);
          expect(annotation.color).toBe(color);
          expect(annotation.type).toBe(type);
          expect(annotation.comment).toBe('');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('createAnnotationFile produces valid files', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (fileId) => {
        const file = createAnnotationFile(fileId);
        
        expect(isAnnotationFile(file)).toBe(true);
        expect(file.fileId).toBe(fileId);
        expect(file.version).toBe(1);
        expect(file.annotations).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });
});
