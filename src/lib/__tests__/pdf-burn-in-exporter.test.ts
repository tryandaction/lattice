/**
 * PDF Burn-In Exporter Tests
 * 
 * Property-based tests for PDF export rendering correctness.
 * Feature: visual-adapters-exporter, Property 5: PDF Export Rendering Correctness
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  normalizedToPoints,
  getColorRgb,
  countHighlightRects,
  countAnnotationsWithComments,
  HIGHLIGHT_OPACITY,
  PDF_HIGHLIGHT_COLORS,
} from '../pdf-burn-in-exporter';
import type { AnnotationItem, PdfTarget, BoundingBox } from '@/types/universal-annotation';

// ============================================================================
// Arbitrary Generators
// ============================================================================

const boundingBoxArb: fc.Arbitrary<BoundingBox> = fc.record({
  x1: fc.double({ min: 0, max: 0.5, noNaN: true }),
  y1: fc.double({ min: 0, max: 0.5, noNaN: true }),
  x2: fc.double({ min: 0.5, max: 1, noNaN: true }),
  y2: fc.double({ min: 0.5, max: 1, noNaN: true }),
});

const pdfTargetArb = (page: number): fc.Arbitrary<PdfTarget> => 
  fc.array(boundingBoxArb, { minLength: 1, maxLength: 5 }).map(rects => ({
    type: 'pdf' as const,
    page,
    rects,
  }));

const colorArb = fc.constantFrom(
  '#FFEB3B', '#4CAF50', '#2196F3', '#E91E63', '#FF9800',
  'yellow', 'green', 'blue', 'pink', 'orange'
);

const pdfAnnotationArb = (page: number): fc.Arbitrary<AnnotationItem> =>
  fc.record({
    id: fc.uuid(),
    target: pdfTargetArb(page),
    style: fc.record({
      color: colorArb,
      type: fc.constantFrom('highlight' as const, 'underline' as const, 'area' as const),
    }),
    content: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
    comment: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
    author: fc.string({ minLength: 1, maxLength: 50 }),
    createdAt: fc.integer({ min: 0 }),
  });

// ============================================================================
// Property 5: PDF Export Rendering Correctness
// Feature: visual-adapters-exporter, Property 5
// Validates: Requirements 5.3, 5.4, 5.5, 6.1, 6.3, 6.4
// ============================================================================

describe('Property 5: PDF Export Rendering Correctness', () => {
  describe('Coordinate Conversion', () => {
    /**
     * Normalized coordinates should convert to valid PDF points
     */
    it('converts normalized coordinates to PDF points correctly', () => {
      fc.assert(
        fc.property(
          boundingBoxArb,
          fc.double({ min: 100, max: 1000, noNaN: true }),
          fc.double({ min: 100, max: 1000, noNaN: true }),
          (rect, pageWidth, pageHeight) => {
            const points = normalizedToPoints(rect, pageWidth, pageHeight);
            
            // X should be in range [0, pageWidth]
            expect(points.x).toBeGreaterThanOrEqual(0);
            expect(points.x).toBeLessThanOrEqual(pageWidth);
            
            // Y should be in range [0, pageHeight] (flipped)
            expect(points.y).toBeGreaterThanOrEqual(0);
            expect(points.y).toBeLessThanOrEqual(pageHeight);
            
            // Width and height should be positive
            expect(points.width).toBeGreaterThan(0);
            expect(points.height).toBeGreaterThan(0);
            
            // Width should not exceed page width
            expect(points.x + points.width).toBeLessThanOrEqual(pageWidth * 1.001); // Small tolerance
            
            // Height should not exceed page height
            expect(points.y + points.height).toBeLessThanOrEqual(pageHeight * 1.001);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Y-axis should be flipped (PDF origin is bottom-left)
     */
    it('flips Y-axis correctly for PDF coordinate system', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 100, max: 1000, noNaN: true }),
          (normalizedY, pageHeight) => {
            const rect: BoundingBox = { x1: 0, y1: normalizedY, x2: 0.1, y2: normalizedY + 0.1 };
            const points = normalizedToPoints(rect, 100, pageHeight);
            
            // Higher normalized Y (lower on page visually) should result in lower PDF Y
            // PDF Y = pageHeight - (normalizedY2 * pageHeight)
            const expectedY = pageHeight - ((normalizedY + 0.1) * pageHeight);
            expect(Math.abs(points.y - expectedY)).toBeLessThan(0.001);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Color Mapping', () => {
    /**
     * All predefined colors should map to valid RGB values
     */
    it('maps predefined colors to valid RGB', () => {
      const colors = Object.keys(PDF_HIGHLIGHT_COLORS);
      
      for (const color of colors) {
        const rgb = getColorRgb(color);
        
        expect(rgb.r).toBeGreaterThanOrEqual(0);
        expect(rgb.r).toBeLessThanOrEqual(1);
        expect(rgb.g).toBeGreaterThanOrEqual(0);
        expect(rgb.g).toBeLessThanOrEqual(1);
        expect(rgb.b).toBeGreaterThanOrEqual(0);
        expect(rgb.b).toBeLessThanOrEqual(1);
      }
    });

    /**
     * Hex colors should be parsed correctly
     */
    it('parses hex colors to RGB', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          (r, g, b) => {
            const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
            const rgb = getColorRgb(hex);
            
            // Should be in 0-1 range
            expect(rgb.r).toBeGreaterThanOrEqual(0);
            expect(rgb.r).toBeLessThanOrEqual(1);
            expect(rgb.g).toBeGreaterThanOrEqual(0);
            expect(rgb.g).toBeLessThanOrEqual(1);
            expect(rgb.b).toBeGreaterThanOrEqual(0);
            expect(rgb.b).toBeLessThanOrEqual(1);
            
            // Should match input values (normalized)
            // Use toBeCloseTo for floating point comparison
            expect(rgb.r).toBeCloseTo(r / 255, 2);
            expect(rgb.g).toBeCloseTo(g / 255, 2);
            expect(rgb.b).toBeCloseTo(b / 255, 2);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Unknown colors should default to yellow
     */
    it('defaults unknown colors to yellow', () => {
      const unknownColors = ['unknown', 'invalid', 'notacolor', 'rgb(255,0,0)'];
      
      for (const color of unknownColors) {
        const rgb = getColorRgb(color);
        expect(rgb).toEqual(PDF_HIGHLIGHT_COLORS.yellow);
      }
    });
  });

  describe('Rectangle Counting', () => {
    /**
     * Total rectangles should equal sum of all annotation rects
     */
    it('counts total rectangles correctly', () => {
      fc.assert(
        fc.property(
          fc.array(pdfAnnotationArb(1), { minLength: 0, maxLength: 10 }),
          (annotations) => {
            const count = countHighlightRects(annotations);
            
            // Calculate expected count
            const expected = annotations.reduce((sum, a) => {
              if (a.target.type === 'pdf') {
                return sum + (a.target as PdfTarget).rects.length;
              }
              return sum;
            }, 0);
            
            expect(count).toBe(expected);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Empty annotations should result in zero rectangles
     */
    it('returns zero for empty annotations', () => {
      expect(countHighlightRects([])).toBe(0);
    });

    /**
     * Non-PDF annotations should not be counted
     */
    it('ignores non-PDF annotations', () => {
      const imageAnnotation: AnnotationItem = {
        id: 'test',
        target: { type: 'image', x: 0, y: 0, width: 10, height: 10 },
        style: { color: 'yellow', type: 'highlight' },
        author: 'user',
        createdAt: Date.now(),
      };
      
      expect(countHighlightRects([imageAnnotation])).toBe(0);
    });
  });

  describe('Comment Counting', () => {
    /**
     * Should count only annotations with comments
     */
    it('counts annotations with comments correctly', () => {
      fc.assert(
        fc.property(
          fc.array(pdfAnnotationArb(1), { minLength: 0, maxLength: 10 }),
          (annotations) => {
            const count = countAnnotationsWithComments(annotations);
            
            // Calculate expected count
            const expected = annotations.filter(
              a => a.target.type === 'pdf' && a.comment !== undefined
            ).length;
            
            expect(count).toBe(expected);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Opacity', () => {
    /**
     * Default opacity should be 0.35
     */
    it('has correct default opacity', () => {
      expect(HIGHLIGHT_OPACITY).toBe(0.35);
    });
  });

  describe('Multi-Page Annotations', () => {
    /**
     * Annotations on different pages should be counted separately
     */
    it('handles multi-page annotations', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 1, maxLength: 20 }),
          (numPages, pageNumbers) => {
            // Create annotations on various pages
            const annotations: AnnotationItem[] = pageNumbers.map((page, i) => ({
              id: `ann-${i}`,
              target: {
                type: 'pdf' as const,
                page,
                rects: [{ x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 }],
              },
              style: { color: 'yellow', type: 'highlight' as const },
              author: 'user',
              createdAt: Date.now(),
            }));
            
            // Count should equal number of annotations (each has 1 rect)
            expect(countHighlightRects(annotations)).toBe(pageNumbers.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Multi-Rect Annotations', () => {
    /**
     * Multi-line selections should have multiple rects counted
     */
    it('counts all rects in multi-rect annotations', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.integer({ min: 1, max: 10 }),
            { minLength: 1, maxLength: 5 }
          ),
          (rectCounts) => {
            // Create annotations with varying rect counts
            const annotations: AnnotationItem[] = rectCounts.map((numRects, i) => ({
              id: `ann-${i}`,
              target: {
                type: 'pdf' as const,
                page: 1,
                rects: Array.from({ length: numRects }, (_, j) => ({
                  x1: 0.1 + j * 0.1,
                  y1: 0.1,
                  x2: 0.2 + j * 0.1,
                  y2: 0.2,
                })),
              },
              style: { color: 'yellow', type: 'highlight' as const },
              author: 'user',
              createdAt: Date.now(),
            }));
            
            // Total rects should be sum of all rect counts
            const expectedTotal = rectCounts.reduce((sum, n) => sum + n, 0);
            expect(countHighlightRects(annotations)).toBe(expectedTotal);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

// ============================================================================
// Unit Tests for Edge Cases
// ============================================================================

describe('PDF Export Edge Cases', () => {
  it('handles annotations at page boundaries', () => {
    const rect: BoundingBox = { x1: 0, y1: 0, x2: 1, y2: 1 };
    const points = normalizedToPoints(rect, 612, 792); // Letter size
    
    expect(points.x).toBe(0);
    expect(points.y).toBe(0);
    expect(points.width).toBe(612);
    expect(points.height).toBe(792);
  });

  it('handles very small annotations', () => {
    const rect: BoundingBox = { x1: 0.5, y1: 0.5, x2: 0.501, y2: 0.501 };
    const points = normalizedToPoints(rect, 612, 792);
    
    expect(points.width).toBeGreaterThan(0);
    expect(points.height).toBeGreaterThan(0);
  });

  it('handles case-insensitive color names', () => {
    expect(getColorRgb('YELLOW')).toEqual(PDF_HIGHLIGHT_COLORS.yellow);
    expect(getColorRgb('Yellow')).toEqual(PDF_HIGHLIGHT_COLORS.yellow);
    expect(getColorRgb('yellow')).toEqual(PDF_HIGHLIGHT_COLORS.yellow);
  });
});
