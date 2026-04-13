/**
 * PDF Highlight Mapping Tests
 * 
 * Property-based tests for annotation-to-highlight mapping round-trips.
 * Feature: visual-adapters-exporter, Property 2: Annotation-to-Highlight Mapping Round-Trip
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  annotationToHighlight,
  annotationsToHighlights,
  createPinAnnotation,
  isPinAnnotation,
  getPinCenter,
} from '../pdf-highlight-mapping';
import type { 
  AnnotationItem, 
  PdfTarget, 
  BoundingBox 
} from '../../types/universal-annotation';
import { HIGHLIGHT_COLORS, resolveHighlightColor } from '../annotation-colors';

// ============================================================================
// Arbitrary Generators
// ============================================================================

/**
 * Generator for valid BoundingBox (x1 < x2, y1 < y2)
 */
const boundingBoxArb: fc.Arbitrary<BoundingBox> = fc.tuple(
  fc.double({ min: 0, max: 0.9, noNaN: true }),
  fc.double({ min: 0, max: 0.9, noNaN: true }),
  fc.double({ min: 0.05, max: 0.5, noNaN: true }),
  fc.double({ min: 0.05, max: 0.5, noNaN: true })
).map(([x1, y1, width, height]) => ({
  x1,
  y1,
  x2: Math.min(1, x1 + width),
  y2: Math.min(1, y1 + height),
}));

/**
 * Generator for PdfTarget
 */
const pdfTargetArb: fc.Arbitrary<PdfTarget> = fc.record({
  type: fc.constant('pdf' as const),
  page: fc.integer({ min: 1, max: 1000 }),
  rects: fc.array(boundingBoxArb, { minLength: 1, maxLength: 5 }),
});

/**
 * Generator for highlight colors
 */
const highlightColorArb = fc.constantFrom(
  ...HIGHLIGHT_COLORS.map(c => c.hex),
  ...HIGHLIGHT_COLORS.map(c => c.value)
);

/**
 * Generator for PDF AnnotationItem
 */
const pdfAnnotationArb: fc.Arbitrary<AnnotationItem> = fc.record({
  id: fc.uuid(),
  target: pdfTargetArb,
  style: fc.record({
    color: highlightColorArb,
    type: fc.constantFrom('highlight' as const, 'underline' as const),
  }),
  content: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
  comment: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  author: fc.string({ minLength: 1, maxLength: 30 }),
  createdAt: fc.integer({ min: 0 }),
});

/**
 * Generator for non-PDF AnnotationItem (should be filtered out)
 */
const nonPdfAnnotationArb: fc.Arbitrary<AnnotationItem> = fc.record({
  id: fc.uuid(),
  target: fc.oneof(
    fc.record({
      type: fc.constant('image' as const),
      x: fc.double({ min: 0, max: 100, noNaN: true }),
      y: fc.double({ min: 0, max: 100, noNaN: true }),
      width: fc.double({ min: 1, max: 50, noNaN: true }),
      height: fc.double({ min: 1, max: 50, noNaN: true }),
    }),
    fc.record({
      type: fc.constant('code_line' as const),
      line: fc.integer({ min: 1, max: 1000 }),
    })
  ),
  style: fc.record({
    color: highlightColorArb,
    type: fc.constantFrom('highlight' as const, 'underline' as const),
  }),
  content: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
  comment: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  author: fc.string({ minLength: 1, maxLength: 30 }),
  createdAt: fc.integer({ min: 0 }),
});

// ============================================================================
// Property 2: Annotation-to-Highlight Mapping Round-Trip
// Feature: visual-adapters-exporter, Property 2
// Validates: Requirements 1.4, 1.5
// ============================================================================

describe('Property 2: Annotation-to-Highlight Mapping Round-Trip', () => {
  describe('annotationToHighlight', () => {
    /**
     * For any valid PDF annotation, mapping to highlight should preserve:
     * - Page number
     * - Bounding rectangles
     * - Color
     * - Content text
     */
    it('preserves page number in round-trip', () => {
      fc.assert(
        fc.property(pdfAnnotationArb, (annotation) => {
          const highlight = annotationToHighlight(annotation);
          expect(highlight).not.toBeNull();
          expect(highlight!.position.pageNumber).toBe((annotation.target as PdfTarget).page);
        }),
        { numRuns: 100 }
      );
    });

    it('preserves rectangle count in round-trip', () => {
      fc.assert(
        fc.property(pdfAnnotationArb, (annotation) => {
          const highlight = annotationToHighlight(annotation);
          expect(highlight).not.toBeNull();
          expect(highlight!.position.rects.length).toBe((annotation.target as PdfTarget).rects.length);
        }),
        { numRuns: 100 }
      );
    });

    it('maps rect coordinates into scaled page geometry', () => {
      fc.assert(
        fc.property(pdfAnnotationArb, (annotation) => {
          const highlight = annotationToHighlight(annotation);
          expect(highlight).not.toBeNull();
          const originalRects = (annotation.target as PdfTarget).rects;
          const mappedRects = highlight!.position.rects;

          for (let i = 0; i < originalRects.length; i++) {
            expect(mappedRects[i].x1 / mappedRects[i].width).toBeCloseTo(originalRects[i].x1, 5);
            expect(mappedRects[i].y1 / mappedRects[i].height).toBeCloseTo(originalRects[i].y1, 5);
            expect(mappedRects[i].x2 / mappedRects[i].width).toBeCloseTo(originalRects[i].x2, 5);
            expect(mappedRects[i].y2 / mappedRects[i].height).toBeCloseTo(originalRects[i].y2, 5);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('preserves color in round-trip', () => {
      fc.assert(
        fc.property(pdfAnnotationArb, (annotation) => {
          const highlight = annotationToHighlight(annotation);
          expect(highlight).not.toBeNull();
          expect(highlight!.color).toBe(resolveHighlightColor(annotation.style.color));
        }),
        { numRuns: 100 }
      );
    });

    it('preserves content text in round-trip', () => {
      fc.assert(
        fc.property(pdfAnnotationArb, (annotation) => {
          const highlight = annotationToHighlight(annotation);
          expect(highlight).not.toBeNull();
          expect(highlight!.content.text).toBe(annotation.content);
        }),
        { numRuns: 100 }
      );
    });

    it('preserves comment in round-trip', () => {
      fc.assert(
        fc.property(pdfAnnotationArb, (annotation) => {
          const highlight = annotationToHighlight(annotation);
          expect(highlight).not.toBeNull();
          
          if (annotation.comment) {
            expect(highlight!.comment?.text).toBe(annotation.comment);
          } else {
            expect(highlight!.comment).toBeUndefined();
          }
        }),
        { numRuns: 100 }
      );
    });

    it('returns null for non-PDF annotations', () => {
      fc.assert(
        fc.property(nonPdfAnnotationArb, (annotation) => {
          const highlight = annotationToHighlight(annotation);
          expect(highlight).toBeNull();
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('annotationsToHighlights', () => {
    it('filters out non-PDF annotations', () => {
      fc.assert(
        fc.property(
          fc.array(fc.oneof(pdfAnnotationArb, nonPdfAnnotationArb), { minLength: 1, maxLength: 10 }),
          (annotations) => {
            const highlights = annotationsToHighlights(annotations);
            const pdfCount = annotations.filter(a => a.target.type === 'pdf').length;
            expect(highlights.length).toBe(pdfCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('preserves order of PDF annotations', () => {
      fc.assert(
        fc.property(
          fc.array(pdfAnnotationArb, { minLength: 2, maxLength: 5 }),
          (annotations) => {
            const highlights = annotationsToHighlights(annotations);
            
            for (let i = 0; i < annotations.length; i++) {
              expect(highlights[i].id).toBe(annotations[i].id);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

// ============================================================================
// Pin Annotation Tests
// ============================================================================

describe('Pin Annotations', () => {
  describe('createPinAnnotation', () => {
    it('creates annotation with area style type', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          fc.double({ min: 0.1, max: 0.9, noNaN: true }),
          fc.double({ min: 0.1, max: 0.9, noNaN: true }),
          fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
          fc.string({ minLength: 1, maxLength: 20 }),
          (page, x, y, comment, author) => {
            const pin = createPinAnnotation(page, x, y, comment, author);
            
            expect(pin.style.type).toBe('area');
            expect(pin.target.type).toBe('pdf');
            expect((pin.target as PdfTarget).page).toBe(page);
            expect(pin.comment).toBe(comment);
            expect(pin.author).toBe(author);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('creates small rect around click point', () => {
      const pin = createPinAnnotation(1, 0.5, 0.5, undefined, 'user');
      const target = pin.target as PdfTarget;
      
      expect(target.rects.length).toBe(1);
      const rect = target.rects[0];
      
      // Should be centered around 0.5, 0.5
      expect(rect.x1).toBeLessThan(0.5);
      expect(rect.x2).toBeGreaterThan(0.5);
      expect(rect.y1).toBeLessThan(0.5);
      expect(rect.y2).toBeGreaterThan(0.5);
      
      // Should be small (< 5% of page)
      expect(rect.x2 - rect.x1).toBeLessThan(0.05);
      expect(rect.y2 - rect.y1).toBeLessThan(0.05);
    });

    it('clamps coordinates at page boundaries', () => {
      // Near left edge
      const pinLeft = createPinAnnotation(1, 0.001, 0.5, undefined, 'user');
      const rectLeft = (pinLeft.target as PdfTarget).rects[0];
      expect(rectLeft.x1).toBeGreaterThanOrEqual(0);
      
      // Near right edge
      const pinRight = createPinAnnotation(1, 0.999, 0.5, undefined, 'user');
      const rectRight = (pinRight.target as PdfTarget).rects[0];
      expect(rectRight.x2).toBeLessThanOrEqual(1);
    });
  });

  describe('isPinAnnotation', () => {
    it('returns true for pin annotations', () => {
      const pin = createPinAnnotation(1, 0.5, 0.5, 'test', 'user');
      const annotation: AnnotationItem = {
        ...pin,
        id: 'test-id',
        createdAt: Date.now(),
      };
      
      expect(isPinAnnotation(annotation)).toBe(true);
    });

    it('returns false for regular highlights', () => {
      fc.assert(
        fc.property(pdfAnnotationArb, (annotation) => {
          // Regular highlights have larger rects
          const target = annotation.target as PdfTarget;
          const hasLargeRect = target.rects.some(r => 
            (r.x2 - r.x1) >= 0.05 || (r.y2 - r.y1) >= 0.05
          );
          
          if (hasLargeRect || annotation.style.type !== 'area') {
            expect(isPinAnnotation(annotation)).toBe(false);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('returns false for non-PDF annotations', () => {
      fc.assert(
        fc.property(nonPdfAnnotationArb, (annotation) => {
          expect(isPinAnnotation(annotation)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('getPinCenter', () => {
    it('returns center coordinates for pin annotations', () => {
      const pin = createPinAnnotation(1, 0.5, 0.5, undefined, 'user');
      const annotation: AnnotationItem = {
        ...pin,
        id: 'test-id',
        createdAt: Date.now(),
      };
      
      const center = getPinCenter(annotation);
      expect(center).not.toBeNull();
      expect(center!.x).toBeCloseTo(0.5, 1);
      expect(center!.y).toBeCloseTo(0.5, 1);
    });

    it('returns null for non-pin annotations', () => {
      fc.assert(
        fc.property(pdfAnnotationArb, (annotation) => {
          if (!isPinAnnotation(annotation)) {
            expect(getPinCenter(annotation)).toBeNull();
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});

