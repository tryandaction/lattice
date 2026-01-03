/**
 * Property-based tests for coordinate transformation utilities
 * 
 * Feature: pdf-annotation-engine
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  normalizeRect,
  denormalizeRect,
  normalizeRects,
  denormalizeRects,
  normalizePosition,
  denormalizePosition,
  calculateBoundingBox,
  isPointInRect,
  areRectsEqual,
  type PixelRect,
} from '../annotation-coordinates';

// ============================================================================
// Arbitrary Generators
// ============================================================================

/**
 * Generator for valid page dimensions (positive numbers)
 */
const pageDimensionArb = fc.double({ min: 100, max: 5000, noNaN: true });

/**
 * Generator for valid scale factors
 */
const scaleArb = fc.double({ min: 0.1, max: 5.0, noNaN: true });

/**
 * Generator for pixel rectangles within page bounds
 */
const pixelRectArb = (maxWidth: number, maxHeight: number): fc.Arbitrary<PixelRect> =>
  fc.record({
    x: fc.double({ min: 0, max: maxWidth * 0.4, noNaN: true }),
    y: fc.double({ min: 0, max: maxHeight * 0.4, noNaN: true }),
    width: fc.double({ min: 1, max: maxWidth * 0.3, noNaN: true }),
    height: fc.double({ min: 1, max: maxHeight * 0.3, noNaN: true }),
  });

/**
 * Generator for pixel rectangles with fixed page dimensions
 * Ensures rect stays within page bounds to avoid clamping
 */
const pixelRectWithDimensionsArb = fc.tuple(
  pageDimensionArb,
  pageDimensionArb
).chain(([pageWidth, pageHeight]) =>
  fc.tuple(
    pixelRectArb(pageWidth, pageHeight),
    fc.constant(pageWidth),
    fc.constant(pageHeight)
  )
);

// ============================================================================
// Property 5: Coordinate Normalization Round-Trip
// Feature: pdf-annotation-engine, Property 5: Coordinate Normalization Round-Trip
// Validates: Requirements 3.5, 7.2
// ============================================================================

describe('Property 5: Coordinate Normalization Round-Trip', () => {
  it('normalizing then denormalizing at scale 1.0 preserves coordinates', () => {
    fc.assert(
      fc.property(
        pixelRectWithDimensionsArb,
        ([rect, pageWidth, pageHeight]) => {
          const normalized = normalizeRect(rect, pageWidth, pageHeight);
          const denormalized = denormalizeRect(normalized, 1.0);
          
          // Should be approximately equal (within floating-point tolerance)
          // Use relative tolerance for larger values
          const tolerance = Math.max(0.1, Math.max(rect.width, rect.height) * 0.001);
          expect(areRectsEqual(rect, denormalized, tolerance)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('normalizing then denormalizing at any scale preserves relative position', () => {
    fc.assert(
      fc.property(
        pixelRectWithDimensionsArb,
        scaleArb,
        ([rect, pageWidth, pageHeight], scale) => {
          const normalized = normalizeRect(rect, pageWidth, pageHeight);
          const denormalized = denormalizeRect(normalized, scale);
          
          // The relative position should be preserved
          // At scale S, the denormalized coordinates should be S times the original
          const expectedX = rect.x * scale;
          const expectedY = rect.y * scale;
          const expectedWidth = rect.width * scale;
          const expectedHeight = rect.height * scale;
          
          // Use relative tolerance based on the magnitude of values
          const tolerance = Math.max(0.1, Math.max(expectedWidth, expectedHeight) * 0.001);
          expect(Math.abs(denormalized.x - expectedX)).toBeLessThan(tolerance);
          expect(Math.abs(denormalized.y - expectedY)).toBeLessThan(tolerance);
          expect(Math.abs(denormalized.width - expectedWidth)).toBeLessThan(tolerance);
          expect(Math.abs(denormalized.height - expectedHeight)).toBeLessThan(tolerance);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('normalized coordinates are always in 0-1 range', () => {
    fc.assert(
      fc.property(
        pixelRectWithDimensionsArb,
        ([rect, pageWidth, pageHeight]) => {
          const normalized = normalizeRect(rect, pageWidth, pageHeight);
          
          expect(normalized.x1).toBeGreaterThanOrEqual(0);
          expect(normalized.x1).toBeLessThanOrEqual(1);
          expect(normalized.y1).toBeGreaterThanOrEqual(0);
          expect(normalized.y1).toBeLessThanOrEqual(1);
          expect(normalized.x2).toBeGreaterThanOrEqual(0);
          expect(normalized.x2).toBeLessThanOrEqual(1);
          expect(normalized.y2).toBeGreaterThanOrEqual(0);
          expect(normalized.y2).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('normalizing multiple rects then denormalizing preserves all', () => {
    fc.assert(
      fc.property(
        pageDimensionArb,
        pageDimensionArb,
        fc.integer({ min: 1, max: 10 }),
        (pageWidth, pageHeight, count) => {
          // Generate random rects
          const rects: PixelRect[] = [];
          for (let i = 0; i < count; i++) {
            rects.push({
              x: Math.random() * pageWidth * 0.8,
              y: Math.random() * pageHeight * 0.8,
              width: Math.random() * pageWidth * 0.2 + 1,
              height: Math.random() * pageHeight * 0.2 + 1,
            });
          }
          
          const normalized = normalizeRects(rects, pageWidth, pageHeight);
          const denormalized = denormalizeRects(normalized, 1.0);
          
          expect(denormalized.length).toBe(rects.length);
          
          for (let i = 0; i < rects.length; i++) {
            expect(areRectsEqual(rects[i], denormalized[i], 0.01)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('position round-trip preserves both boundingRect and rects', () => {
    fc.assert(
      fc.property(
        pageDimensionArb,
        pageDimensionArb,
        scaleArb,
        (pageWidth, pageHeight, scale) => {
          const boundingRect: PixelRect = {
            x: Math.random() * pageWidth * 0.5,
            y: Math.random() * pageHeight * 0.5,
            width: Math.random() * pageWidth * 0.3 + 10,
            height: Math.random() * pageHeight * 0.3 + 10,
          };
          
          const rects: PixelRect[] = [
            { x: boundingRect.x, y: boundingRect.y, width: boundingRect.width / 2, height: boundingRect.height / 3 },
            { x: boundingRect.x, y: boundingRect.y + boundingRect.height / 3, width: boundingRect.width, height: boundingRect.height / 3 },
          ];
          
          const normalized = normalizePosition(boundingRect, rects, pageWidth, pageHeight);
          const denormalized = denormalizePosition(normalized, scale);
          
          // Check boundingRect
          const expectedBounding: PixelRect = {
            x: boundingRect.x * scale,
            y: boundingRect.y * scale,
            width: boundingRect.width * scale,
            height: boundingRect.height * scale,
          };
          expect(areRectsEqual(denormalized.boundingRect, expectedBounding, 0.01)).toBe(true);
          
          // Check rects count
          expect(denormalized.rects.length).toBe(rects.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Additional Coordinate Tests
// ============================================================================

describe('Coordinate Utilities', () => {
  describe('calculateBoundingBox', () => {
    it('returns correct bounding box for multiple rects', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              x: fc.double({ min: 0, max: 1000, noNaN: true }),
              y: fc.double({ min: 0, max: 1000, noNaN: true }),
              width: fc.double({ min: 1, max: 100, noNaN: true }),
              height: fc.double({ min: 1, max: 100, noNaN: true }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (rects) => {
            const bbox = calculateBoundingBox(rects);
            
            // All rects should be contained within the bounding box
            for (const rect of rects) {
              expect(rect.x).toBeGreaterThanOrEqual(bbox.x);
              expect(rect.y).toBeGreaterThanOrEqual(bbox.y);
              expect(rect.x + rect.width).toBeLessThanOrEqual(bbox.x + bbox.width + 0.001);
              expect(rect.y + rect.height).toBeLessThanOrEqual(bbox.y + bbox.height + 0.001);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns zero rect for empty array', () => {
      const bbox = calculateBoundingBox([]);
      expect(bbox).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });
  });

  describe('isPointInRect', () => {
    it('points inside rect return true', () => {
      fc.assert(
        fc.property(
          fc.record({
            x: fc.double({ min: 0, max: 100, noNaN: true }),
            y: fc.double({ min: 0, max: 100, noNaN: true }),
            width: fc.double({ min: 10, max: 100, noNaN: true }),
            height: fc.double({ min: 10, max: 100, noNaN: true }),
          }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          (rect, xRatio, yRatio) => {
            const point = {
              x: rect.x + rect.width * xRatio,
              y: rect.y + rect.height * yRatio,
            };
            expect(isPointInRect(point, rect)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('points outside rect return false', () => {
      fc.assert(
        fc.property(
          fc.record({
            x: fc.double({ min: 100, max: 200, noNaN: true }),
            y: fc.double({ min: 100, max: 200, noNaN: true }),
            width: fc.double({ min: 10, max: 50, noNaN: true }),
            height: fc.double({ min: 10, max: 50, noNaN: true }),
          }),
          (rect) => {
            // Point clearly outside (to the left)
            const pointOutside = { x: rect.x - 50, y: rect.y + rect.height / 2 };
            expect(isPointInRect(pointOutside, rect)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Error handling', () => {
    it('normalizeRect throws for non-positive page dimensions', () => {
      const rect: PixelRect = { x: 10, y: 10, width: 50, height: 50 };
      
      expect(() => normalizeRect(rect, 0, 100)).toThrow('Page dimensions must be positive');
      expect(() => normalizeRect(rect, 100, 0)).toThrow('Page dimensions must be positive');
      expect(() => normalizeRect(rect, -100, 100)).toThrow('Page dimensions must be positive');
    });

    it('denormalizeRect throws for non-positive scale', () => {
      const rect = { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5, width: 100, height: 100 };
      
      expect(() => denormalizeRect(rect, 0)).toThrow('Scale must be positive');
      expect(() => denormalizeRect(rect, -1)).toThrow('Scale must be positive');
    });
  });
});
