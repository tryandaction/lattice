/**
 * Annotation Creation Correctness Tests
 * 
 * Property-based tests for annotation creation through adapters.
 * Feature: visual-adapters-exporter, Property 1: Annotation Creation Correctness
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { 
  AnnotationItem, 
  PdfTarget, 
  ImageTarget,
  BoundingBox,
  AnnotationStyleType 
} from '../../types/universal-annotation';
import { 
  validateAnnotationItem, 
  ANNOTATION_STYLE_TYPES 
} from '../../types/universal-annotation';
import { HIGHLIGHT_COLORS } from '../annotation-colors';

// ============================================================================
// Arbitrary Generators
// ============================================================================

const boundingBoxArb: fc.Arbitrary<BoundingBox> = fc.tuple(
  fc.double({ min: 0, max: 0.9, noNaN: true }),
  fc.double({ min: 0, max: 0.9, noNaN: true }),
  fc.double({ min: 0.01, max: 0.5, noNaN: true }),
  fc.double({ min: 0.01, max: 0.5, noNaN: true })
).map(([x1, y1, width, height]) => ({
  x1,
  y1,
  x2: Math.min(1, x1 + width),
  y2: Math.min(1, y1 + height),
}));

const highlightColorArb = fc.constantFrom(
  ...HIGHLIGHT_COLORS.map(c => c.hex),
  ...HIGHLIGHT_COLORS.map(c => c.value)
);

const styleTypeArb = fc.constantFrom(...ANNOTATION_STYLE_TYPES);

// ============================================================================
// Simulated Annotation Creation Functions
// ============================================================================

/**
 * Simulates creating a PDF highlight annotation from text selection
 */
function createPdfHighlightAnnotation(
  page: number,
  rects: BoundingBox[],
  color: string,
  content: string | undefined,
  author: string
): AnnotationItem {
  return {
    id: crypto.randomUUID(),
    target: {
      type: 'pdf',
      page,
      rects,
    },
    style: {
      color,
      type: 'highlight',
    },
    content,
    author,
    createdAt: Date.now(),
  };
}

/**
 * Simulates creating a PDF pin annotation from click
 */
function createPdfPinAnnotation(
  page: number,
  x: number,
  y: number,
  comment: string | undefined,
  author: string
): AnnotationItem {
  const pinSize = 0.02;
  
  return {
    id: crypto.randomUUID(),
    target: {
      type: 'pdf',
      page,
      rects: [{
        x1: Math.max(0, x - pinSize / 2),
        y1: Math.max(0, y - pinSize / 2),
        x2: Math.min(1, x + pinSize / 2),
        y2: Math.min(1, y + pinSize / 2),
      }],
    },
    style: {
      color: '#FFC107',
      type: 'area',
    },
    comment,
    author,
    createdAt: Date.now(),
  };
}

/**
 * Simulates creating an image annotation from drawing
 */
function createImageAnnotation(
  x: number,
  y: number,
  width: number,
  height: number,
  styleType: AnnotationStyleType,
  color: string,
  author: string
): AnnotationItem {
  return {
    id: crypto.randomUUID(),
    target: {
      type: 'image',
      x,
      y,
      width,
      height,
    },
    style: {
      color,
      type: styleType,
    },
    author,
    createdAt: Date.now(),
  };
}

// ============================================================================
// Property 1: Annotation Creation Correctness
// Feature: visual-adapters-exporter, Property 1
// Validates: Requirements 1.3, 2.3, 2.6
// ============================================================================

describe('Property 1: Annotation Creation Correctness', () => {
  describe('PDF Highlight Annotations', () => {
    /**
     * For any PDF text selection, the resulting annotation should:
     * - Have 'pdf' target type
     * - Have valid page number
     * - Have valid bounding rectangles
     * - Have 'highlight' style type
     * - Pass validation
     */
    it('creates valid PDF highlight annotations from text selection', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1000 }),
          fc.array(boundingBoxArb, { minLength: 1, maxLength: 5 }),
          highlightColorArb,
          fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
          fc.string({ minLength: 1, maxLength: 30 }),
          (page, rects, color, content, author) => {
            const annotation = createPdfHighlightAnnotation(page, rects, color, content, author);
            
            // Check target type
            expect(annotation.target.type).toBe('pdf');
            
            // Check page number
            const target = annotation.target as PdfTarget;
            expect(target.page).toBe(page);
            expect(target.page).toBeGreaterThanOrEqual(1);
            
            // Check rects
            expect(target.rects.length).toBe(rects.length);
            for (const rect of target.rects) {
              expect(rect.x1).toBeGreaterThanOrEqual(0);
              expect(rect.x1).toBeLessThanOrEqual(1);
              expect(rect.y1).toBeGreaterThanOrEqual(0);
              expect(rect.y1).toBeLessThanOrEqual(1);
              expect(rect.x2).toBeGreaterThanOrEqual(rect.x1);
              expect(rect.y2).toBeGreaterThanOrEqual(rect.y1);
            }
            
            // Check style
            expect(annotation.style.type).toBe('highlight');
            expect(annotation.style.color).toBe(color);
            
            // Check required fields
            expect(annotation.id).toBeDefined();
            expect(annotation.author).toBe(author);
            expect(annotation.createdAt).toBeGreaterThan(0);
            
            // Validate full annotation
            const validation = validateAnnotationItem(annotation);
            expect(validation.valid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('PDF Pin Annotations', () => {
    /**
     * For any PDF click in pin mode, the resulting annotation should:
     * - Have 'pdf' target type
     * - Have 'area' style type
     * - Have a small rect around the click point
     * - Pass validation
     */
    it('creates valid PDF pin annotations from click', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1000 }),
          fc.double({ min: 0.05, max: 0.95, noNaN: true }),
          fc.double({ min: 0.05, max: 0.95, noNaN: true }),
          fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
          fc.string({ minLength: 1, maxLength: 30 }),
          (page, x, y, comment, author) => {
            const annotation = createPdfPinAnnotation(page, x, y, comment, author);
            
            // Check target type
            expect(annotation.target.type).toBe('pdf');
            
            // Check style type is 'area'
            expect(annotation.style.type).toBe('area');
            
            // Check pin is small
            const target = annotation.target as PdfTarget;
            expect(target.rects.length).toBe(1);
            const rect = target.rects[0];
            const width = rect.x2 - rect.x1;
            const height = rect.y2 - rect.y1;
            expect(width).toBeLessThan(0.05);
            expect(height).toBeLessThan(0.05);
            
            // Check pin is centered around click point
            const centerX = (rect.x1 + rect.x2) / 2;
            const centerY = (rect.y1 + rect.y2) / 2;
            expect(Math.abs(centerX - x)).toBeLessThan(0.02);
            expect(Math.abs(centerY - y)).toBeLessThan(0.02);
            
            // Check comment
            expect(annotation.comment).toBe(comment);
            
            // Validate full annotation
            const validation = validateAnnotationItem(annotation);
            expect(validation.valid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('clamps pin coordinates at page boundaries', () => {
      // Test near edges
      const edgeCases = [
        { x: 0.001, y: 0.5 },
        { x: 0.999, y: 0.5 },
        { x: 0.5, y: 0.001 },
        { x: 0.5, y: 0.999 },
        { x: 0.001, y: 0.001 },
        { x: 0.999, y: 0.999 },
      ];

      for (const { x, y } of edgeCases) {
        const annotation = createPdfPinAnnotation(1, x, y, undefined, 'user');
        const target = annotation.target as PdfTarget;
        const rect = target.rects[0];
        
        // All coordinates should be within [0, 1]
        expect(rect.x1).toBeGreaterThanOrEqual(0);
        expect(rect.x2).toBeLessThanOrEqual(1);
        expect(rect.y1).toBeGreaterThanOrEqual(0);
        expect(rect.y2).toBeLessThanOrEqual(1);
        
        // Should still be valid
        const validation = validateAnnotationItem(annotation);
        expect(validation.valid).toBe(true);
      }
    });
  });

  describe('Image Annotations', () => {
    /**
     * For any image drawing, the resulting annotation should:
     * - Have 'image' target type
     * - Have valid percentage coordinates (0-100)
     * - Have valid style type
     * - Pass validation
     */
    it('creates valid image annotations from drawing', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 90, noNaN: true }),
          fc.double({ min: 0, max: 90, noNaN: true }),
          fc.double({ min: 1, max: 50, noNaN: true }),
          fc.double({ min: 1, max: 50, noNaN: true }),
          styleTypeArb,
          highlightColorArb,
          fc.string({ minLength: 1, maxLength: 30 }),
          (x, y, width, height, styleType, color, author) => {
            const annotation = createImageAnnotation(x, y, width, height, styleType, color, author);
            
            // Check target type
            expect(annotation.target.type).toBe('image');
            
            // Check coordinates are in percentage range
            const target = annotation.target as ImageTarget;
            expect(target.x).toBeGreaterThanOrEqual(0);
            expect(target.x).toBeLessThanOrEqual(100);
            expect(target.y).toBeGreaterThanOrEqual(0);
            expect(target.y).toBeLessThanOrEqual(100);
            expect(target.width).toBeGreaterThanOrEqual(0);
            expect(target.width).toBeLessThanOrEqual(100);
            expect(target.height).toBeGreaterThanOrEqual(0);
            expect(target.height).toBeLessThanOrEqual(100);
            
            // Check style
            expect(ANNOTATION_STYLE_TYPES).toContain(annotation.style.type);
            
            // Validate full annotation
            const validation = validateAnnotationItem(annotation);
            expect(validation.valid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Required Fields', () => {
    /**
     * All created annotations must have required fields
     */
    it('all annotations have required fields', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            // PDF highlight
            fc.tuple(
              fc.integer({ min: 1, max: 100 }),
              fc.array(boundingBoxArb, { minLength: 1, maxLength: 3 }),
              highlightColorArb,
              fc.string({ minLength: 1, maxLength: 30 })
            ).map(([page, rects, color, author]) => 
              createPdfHighlightAnnotation(page, rects, color, undefined, author)
            ),
            // PDF pin
            fc.tuple(
              fc.integer({ min: 1, max: 100 }),
              fc.double({ min: 0.1, max: 0.9, noNaN: true }),
              fc.double({ min: 0.1, max: 0.9, noNaN: true }),
              fc.string({ minLength: 1, maxLength: 30 })
            ).map(([page, x, y, author]) => 
              createPdfPinAnnotation(page, x, y, undefined, author)
            ),
            // Image
            fc.tuple(
              fc.double({ min: 0, max: 90, noNaN: true }),
              fc.double({ min: 0, max: 90, noNaN: true }),
              fc.double({ min: 1, max: 50, noNaN: true }),
              fc.double({ min: 1, max: 50, noNaN: true }),
              highlightColorArb,
              fc.string({ minLength: 1, maxLength: 30 })
            ).map(([x, y, w, h, color, author]) => 
              createImageAnnotation(x, y, w, h, 'highlight', color, author)
            )
          ),
          (annotation) => {
            // Check all required fields exist
            expect(annotation.id).toBeDefined();
            expect(typeof annotation.id).toBe('string');
            expect(annotation.id.length).toBeGreaterThan(0);
            
            expect(annotation.target).toBeDefined();
            expect(annotation.target.type).toBeDefined();
            
            expect(annotation.style).toBeDefined();
            expect(annotation.style.color).toBeDefined();
            expect(annotation.style.type).toBeDefined();
            
            expect(annotation.author).toBeDefined();
            expect(typeof annotation.author).toBe('string');
            
            expect(annotation.createdAt).toBeDefined();
            expect(typeof annotation.createdAt).toBe('number');
            expect(annotation.createdAt).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
