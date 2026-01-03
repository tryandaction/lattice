/**
 * Property-based tests for universal annotation types
 * 
 * Feature: universal-annotation-manager
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  isPdfTarget,
  isImageTarget,
  isTextAnchorTarget,
  isCodeLineTarget,
  isAnnotationTarget,
  isAnnotationStyle,
  isAnnotationItem,
  isBoundingBox,
  validateAnnotationTarget,
  validateAnnotationStyle,
  validateAnnotationItem,
  ANNOTATION_STYLE_TYPES,
} from '../universal-annotation';
import type {
  PdfTarget,
  ImageTarget,
  TextAnchorTarget,
  CodeLineTarget,
  AnnotationTarget,
  AnnotationStyle,
  AnnotationItem,
  BoundingBox,
  AnnotationStyleType,
} from '../universal-annotation';

// ============================================================================
// Arbitrary Generators
// ============================================================================

/**
 * Generator for valid BoundingBox (0-1 range)
 */
const boundingBoxArb: fc.Arbitrary<BoundingBox> = fc.record({
  x1: fc.double({ min: 0, max: 1, noNaN: true }),
  y1: fc.double({ min: 0, max: 1, noNaN: true }),
  x2: fc.double({ min: 0, max: 1, noNaN: true }),
  y2: fc.double({ min: 0, max: 1, noNaN: true }),
});

/**
 * Generator for valid PdfTarget
 */
const pdfTargetArb: fc.Arbitrary<PdfTarget> = fc.record({
  type: fc.constant('pdf' as const),
  page: fc.integer({ min: 1, max: 10000 }),
  rects: fc.array(boundingBoxArb, { minLength: 0, maxLength: 10 }),
});

/**
 * Generator for valid ImageTarget (0-100 range)
 */
const imageTargetArb: fc.Arbitrary<ImageTarget> = fc.record({
  type: fc.constant('image' as const),
  x: fc.double({ min: 0, max: 100, noNaN: true }),
  y: fc.double({ min: 0, max: 100, noNaN: true }),
  width: fc.double({ min: 0, max: 100, noNaN: true }),
  height: fc.double({ min: 0, max: 100, noNaN: true }),
});

/**
 * Generator for valid TextAnchorTarget
 */
const textAnchorTargetArb: fc.Arbitrary<TextAnchorTarget> = fc.record({
  type: fc.constant('text_anchor' as const),
  elementId: fc.string({ minLength: 1, maxLength: 100 }),
  offset: fc.integer({ min: 0, max: 100000 }),
});

/**
 * Generator for valid CodeLineTarget
 */
const codeLineTargetArb: fc.Arbitrary<CodeLineTarget> = fc.record({
  type: fc.constant('code_line' as const),
  line: fc.integer({ min: 1, max: 100000 }),
});

/**
 * Generator for any valid AnnotationTarget
 */
const annotationTargetArb: fc.Arbitrary<AnnotationTarget> = fc.oneof(
  pdfTargetArb,
  imageTargetArb,
  textAnchorTargetArb,
  codeLineTargetArb
);

/**
 * Generator for valid AnnotationStyle
 */
const annotationStyleArb: fc.Arbitrary<AnnotationStyle> = fc.record({
  color: fc.oneof(
    fc.constantFrom('yellow', 'red', 'green', 'blue'),
    fc.hexaString({ minLength: 6, maxLength: 6 }).map(s => `#${s}`)
  ),
  type: fc.constantFrom(...ANNOTATION_STYLE_TYPES),
});

/**
 * Generator for valid AnnotationItem
 */
const annotationItemArb: fc.Arbitrary<AnnotationItem> = fc.record({
  id: fc.uuid(),
  target: annotationTargetArb,
  style: annotationStyleArb,
  content: fc.option(fc.string({ maxLength: 1000 }), { nil: undefined }),
  comment: fc.option(fc.string({ maxLength: 500 }), { nil: undefined }),
  author: fc.string({ minLength: 1, maxLength: 100 }),
  createdAt: fc.integer({ min: 0 }),
});

// ============================================================================
// Property 1: Annotation Structure Validation
// Feature: universal-annotation-manager, Property 1: Annotation Structure Validation
// Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
// ============================================================================

describe('Property 1: Annotation Structure Validation', () => {
  describe('BoundingBox validation', () => {
    it('valid BoundingBox passes type guard', () => {
      fc.assert(
        fc.property(boundingBoxArb, (box) => {
          expect(isBoundingBox(box)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('BoundingBox with out-of-range coordinates fails', () => {
      const invalidBoxes = [
        { x1: -0.1, y1: 0.5, x2: 0.8, y2: 0.9 },
        { x1: 0.1, y1: 1.1, x2: 0.8, y2: 0.9 },
        { x1: 0.1, y1: 0.5, x2: 1.5, y2: 0.9 },
        { x1: 0.1, y1: 0.5, x2: 0.8, y2: -0.1 },
      ];
      
      for (const box of invalidBoxes) {
        expect(isBoundingBox(box)).toBe(false);
      }
    });
  });

  describe('PdfTarget validation', () => {
    it('valid PdfTarget passes type guard', () => {
      fc.assert(
        fc.property(pdfTargetArb, (target) => {
          expect(isPdfTarget(target)).toBe(true);
          expect(isAnnotationTarget(target)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('PdfTarget requires page >= 1', () => {
      const invalidTarget = { type: 'pdf', page: 0, rects: [] };
      expect(isPdfTarget(invalidTarget)).toBe(false);
    });

    it('PdfTarget requires valid rects array', () => {
      const invalidTarget = { type: 'pdf', page: 1, rects: 'not-array' };
      expect(isPdfTarget(invalidTarget)).toBe(false);
    });
  });

  describe('ImageTarget validation', () => {
    it('valid ImageTarget passes type guard', () => {
      fc.assert(
        fc.property(imageTargetArb, (target) => {
          expect(isImageTarget(target)).toBe(true);
          expect(isAnnotationTarget(target)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('ImageTarget coordinates must be in 0-100 range', () => {
      const invalidTargets = [
        { type: 'image', x: -1, y: 50, width: 20, height: 20 },
        { type: 'image', x: 50, y: 101, width: 20, height: 20 },
        { type: 'image', x: 50, y: 50, width: -5, height: 20 },
        { type: 'image', x: 50, y: 50, width: 20, height: 150 },
      ];
      
      for (const target of invalidTargets) {
        expect(isImageTarget(target)).toBe(false);
      }
    });
  });

  describe('TextAnchorTarget validation', () => {
    it('valid TextAnchorTarget passes type guard', () => {
      fc.assert(
        fc.property(textAnchorTargetArb, (target) => {
          expect(isTextAnchorTarget(target)).toBe(true);
          expect(isAnnotationTarget(target)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('TextAnchorTarget requires non-negative offset', () => {
      const invalidTarget = { type: 'text_anchor', elementId: 'el1', offset: -1 };
      expect(isTextAnchorTarget(invalidTarget)).toBe(false);
    });
  });

  describe('CodeLineTarget validation', () => {
    it('valid CodeLineTarget passes type guard', () => {
      fc.assert(
        fc.property(codeLineTargetArb, (target) => {
          expect(isCodeLineTarget(target)).toBe(true);
          expect(isAnnotationTarget(target)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('CodeLineTarget requires line >= 1', () => {
      const invalidTarget = { type: 'code_line', line: 0 };
      expect(isCodeLineTarget(invalidTarget)).toBe(false);
    });
  });

  describe('AnnotationStyle validation', () => {
    it('valid AnnotationStyle passes type guard', () => {
      fc.assert(
        fc.property(annotationStyleArb, (style) => {
          expect(isAnnotationStyle(style)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('AnnotationStyle requires valid type', () => {
      const invalidStyle = { color: 'yellow', type: 'invalid' };
      expect(isAnnotationStyle(invalidStyle)).toBe(false);
    });

    it('AnnotationStyle requires non-empty color', () => {
      const invalidStyle = { color: '', type: 'highlight' };
      expect(isAnnotationStyle(invalidStyle)).toBe(false);
    });
  });

  describe('AnnotationItem validation', () => {
    it('valid AnnotationItem passes type guard', () => {
      fc.assert(
        fc.property(annotationItemArb, (item) => {
          expect(isAnnotationItem(item)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('AnnotationItem has all required fields', () => {
      fc.assert(
        fc.property(annotationItemArb, (item) => {
          expect(typeof item.id).toBe('string');
          expect(item.id.length).toBeGreaterThan(0);
          expect(isAnnotationTarget(item.target)).toBe(true);
          expect(isAnnotationStyle(item.style)).toBe(true);
          expect(typeof item.author).toBe('string');
          expect(typeof item.createdAt).toBe('number');
        }),
        { numRuns: 100 }
      );
    });

    it('AnnotationItem style type is one of valid types', () => {
      fc.assert(
        fc.property(annotationItemArb, (item) => {
          expect(ANNOTATION_STYLE_TYPES).toContain(item.style.type);
        }),
        { numRuns: 100 }
      );
    });
  });
});

// ============================================================================
// Property 6: Validation Rejection
// Feature: universal-annotation-manager, Property 6: Validation Rejection
// Validates: Requirements 3.4, 8.3, 8.4
// ============================================================================

describe('Property 6: Validation Rejection', () => {
  describe('validateAnnotationTarget', () => {
    it('rejects non-object values', () => {
      const invalidValues = [null, undefined, 'string', 123, [], true];
      
      for (const value of invalidValues) {
        const result = validateAnnotationTarget(value);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it('rejects invalid target type', () => {
      const result = validateAnnotationTarget({ type: 'invalid' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid target type'))).toBe(true);
    });

    it('provides specific errors for PDF target', () => {
      const result = validateAnnotationTarget({ type: 'pdf', page: 0, rects: 'invalid' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('page'))).toBe(true);
      expect(result.errors.some(e => e.includes('rects'))).toBe(true);
    });

    it('provides specific errors for image target', () => {
      const result = validateAnnotationTarget({ type: 'image', x: -1, y: 101, width: -5, height: 200 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('x'))).toBe(true);
      expect(result.errors.some(e => e.includes('y'))).toBe(true);
      expect(result.errors.some(e => e.includes('width'))).toBe(true);
      expect(result.errors.some(e => e.includes('height'))).toBe(true);
    });

    it('valid targets pass validation', () => {
      fc.assert(
        fc.property(annotationTargetArb, (target) => {
          const result = validateAnnotationTarget(target);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('validateAnnotationStyle', () => {
    it('rejects non-object values', () => {
      const result = validateAnnotationStyle('not-object');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects empty color', () => {
      const result = validateAnnotationStyle({ color: '', type: 'highlight' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('color'))).toBe(true);
    });

    it('rejects invalid style type', () => {
      const result = validateAnnotationStyle({ color: 'yellow', type: 'invalid' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('type'))).toBe(true);
    });

    it('valid styles pass validation', () => {
      fc.assert(
        fc.property(annotationStyleArb, (style) => {
          const result = validateAnnotationStyle(style);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('validateAnnotationItem', () => {
    it('rejects non-object values', () => {
      const result = validateAnnotationItem(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Annotation must be an object');
    });

    it('rejects missing required fields', () => {
      const result = validateAnnotationItem({});
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('id'))).toBe(true);
      expect(result.errors.some(e => e.includes('author'))).toBe(true);
      expect(result.errors.some(e => e.includes('createdAt'))).toBe(true);
    });

    it('rejects invalid nested target', () => {
      const result = validateAnnotationItem({
        id: 'test-id',
        target: { type: 'invalid' },
        style: { color: 'yellow', type: 'highlight' },
        author: 'user',
        createdAt: Date.now(),
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('target'))).toBe(true);
    });

    it('rejects invalid nested style', () => {
      const result = validateAnnotationItem({
        id: 'test-id',
        target: { type: 'pdf', page: 1, rects: [] },
        style: { color: '', type: 'invalid' },
        author: 'user',
        createdAt: Date.now(),
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('style'))).toBe(true);
    });

    it('valid items pass validation', () => {
      fc.assert(
        fc.property(annotationItemArb, (item) => {
          const result = validateAnnotationItem(item);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }),
        { numRuns: 100 }
      );
    });
  });
});
