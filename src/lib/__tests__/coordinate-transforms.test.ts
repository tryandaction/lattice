/**
 * Coordinate Transforms Tests
 * 
 * Property-based tests for coordinate conversion round-trips.
 * Feature: visual-adapters-exporter, Property 4: Coordinate Conversion Round-Trip
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  absoluteToPercentage,
  percentageToAbsolute,
  absoluteRectToPercentage,
  percentageRectToAbsolute,
  normalizedToPoints,
  pointsToNormalized,
  pointsApproxEqual,
  rectsApproxEqual,
  approxEqual,
  type PercentagePoint,
  type AbsolutePoint,
  type PercentageRect,
  type AbsoluteRect,
} from '../coordinate-transforms';
import type { BoundingBox } from '../../types/universal-annotation';

describe('Coordinate Transforms', () => {
  // Arbitraries for generating test data
  const positiveNumber = fc.double({ min: 1, max: 10000, noNaN: true });
  const percentageValue = fc.double({ min: 0, max: 100, noNaN: true });
  const normalizedValue = fc.double({ min: 0, max: 1, noNaN: true });
  
  const absolutePointArb = fc.record({
    x: fc.double({ min: 0, max: 10000, noNaN: true }),
    y: fc.double({ min: 0, max: 10000, noNaN: true }),
  });
  
  const percentagePointArb = fc.record({
    x: percentageValue,
    y: percentageValue,
  });
  
  const canvasDimensionsArb = fc.record({
    width: positiveNumber,
    height: positiveNumber,
  });

  describe('Point Coordinate Conversion', () => {
    /**
     * Property 4: Coordinate Conversion Round-Trip
     * For any absolute point and canvas dimensions, converting to percentage
     * and back should produce coordinates within 0.01% tolerance.
     * Validates: Requirements 4.3, 4.4
     */
    it('absolute -> percentage -> absolute round-trip preserves coordinates', () => {
      fc.assert(
        fc.property(
          absolutePointArb,
          canvasDimensionsArb,
          (point, canvas) => {
            // Clamp point to canvas bounds for valid input
            const clampedPoint: AbsolutePoint = {
              x: Math.min(point.x, canvas.width),
              y: Math.min(point.y, canvas.height),
            };
            
            const percentage = absoluteToPercentage(clampedPoint, canvas.width, canvas.height);
            const restored = percentageToAbsolute(percentage, canvas.width, canvas.height);
            
            // Should be within 0.01% tolerance (relative to canvas size)
            const tolerance = Math.max(canvas.width, canvas.height) * 0.0001;
            return pointsApproxEqual(clampedPoint, restored, tolerance);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 4: Coordinate Conversion Round-Trip (reverse direction)
     * For any percentage point and canvas dimensions, converting to absolute
     * and back should produce coordinates within 0.01% tolerance.
     * Validates: Requirements 4.3, 4.4
     */
    it('percentage -> absolute -> percentage round-trip preserves coordinates', () => {
      fc.assert(
        fc.property(
          percentagePointArb,
          canvasDimensionsArb,
          (point, canvas) => {
            const absolute = percentageToAbsolute(point, canvas.width, canvas.height);
            const restored = absoluteToPercentage(absolute, canvas.width, canvas.height);
            
            // Should be within 0.01% tolerance
            return pointsApproxEqual(point, restored, 0.01);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Rectangle Coordinate Conversion', () => {
    const absoluteRectArb = (maxWidth: number, maxHeight: number) => 
      fc.record({
        x: fc.double({ min: 0, max: maxWidth * 0.9, noNaN: true }),
        y: fc.double({ min: 0, max: maxHeight * 0.9, noNaN: true }),
        width: fc.double({ min: 1, max: maxWidth * 0.5, noNaN: true }),
        height: fc.double({ min: 1, max: maxHeight * 0.5, noNaN: true }),
      });

    const percentageRectArb = fc.record({
      x: fc.double({ min: 0, max: 90, noNaN: true }),
      y: fc.double({ min: 0, max: 90, noNaN: true }),
      width: fc.double({ min: 1, max: 50, noNaN: true }),
      height: fc.double({ min: 1, max: 50, noNaN: true }),
    });

    /**
     * Property 4: Coordinate Conversion Round-Trip for rectangles
     * Validates: Requirements 4.3, 4.4
     */
    it('absolute rect -> percentage -> absolute round-trip preserves dimensions', () => {
      fc.assert(
        fc.property(
          canvasDimensionsArb,
          fc.double({ min: 0, max: 0.9, noNaN: true }),
          fc.double({ min: 0, max: 0.9, noNaN: true }),
          fc.double({ min: 0.01, max: 0.5, noNaN: true }),
          fc.double({ min: 0.01, max: 0.5, noNaN: true }),
          (canvas, xRatio, yRatio, wRatio, hRatio) => {
            const rect: AbsoluteRect = {
              x: xRatio * canvas.width,
              y: yRatio * canvas.height,
              width: wRatio * canvas.width,
              height: hRatio * canvas.height,
            };
            
            const percentage = absoluteRectToPercentage(rect, canvas.width, canvas.height);
            const restored = percentageRectToAbsolute(percentage, canvas.width, canvas.height);
            
            const tolerance = Math.max(canvas.width, canvas.height) * 0.0001;
            return rectsApproxEqual(rect, restored, tolerance);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 4: Coordinate Conversion Round-Trip for rectangles (reverse)
     * Validates: Requirements 4.3, 4.4
     */
    it('percentage rect -> absolute -> percentage round-trip preserves dimensions', () => {
      fc.assert(
        fc.property(
          percentageRectArb,
          canvasDimensionsArb,
          (rect, canvas) => {
            const absolute = percentageRectToAbsolute(rect, canvas.width, canvas.height);
            const restored = absoluteRectToPercentage(absolute, canvas.width, canvas.height);
            
            return rectsApproxEqual(rect, restored, 0.01);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('PDF Coordinate Conversion', () => {
    const boundingBoxArb: fc.Arbitrary<BoundingBox> = fc.tuple(
      normalizedValue,
      normalizedValue,
      normalizedValue,
      normalizedValue
    ).map(([a, b, c, d]) => ({
      // Ensure x1 < x2 and y1 < y2
      x1: Math.min(a, c),
      y1: Math.min(b, d),
      x2: Math.max(a, c),
      y2: Math.max(b, d),
    })).filter(box => box.x2 > box.x1 && box.y2 > box.y1);

    const pageDimensionsArb = fc.record({
      width: fc.double({ min: 100, max: 2000, noNaN: true }),
      height: fc.double({ min: 100, max: 2000, noNaN: true }),
    });

    /**
     * PDF coordinate round-trip: normalized -> points -> normalized
     */
    it('normalized -> points -> normalized round-trip preserves coordinates', () => {
      fc.assert(
        fc.property(
          boundingBoxArb,
          pageDimensionsArb,
          (box, page) => {
            const points = normalizedToPoints(box, page.width, page.height);
            const restored = pointsToNormalized(points, page.width, page.height);
            
            return (
              approxEqual(box.x1, restored.x1, 0.0001) &&
              approxEqual(box.y1, restored.y1, 0.0001) &&
              approxEqual(box.x2, restored.x2, 0.0001) &&
              approxEqual(box.y2, restored.y2, 0.0001)
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * PDF Y-axis flip: top of page in normalized should be bottom in points
     */
    it('correctly flips Y-axis for PDF coordinate system', () => {
      const box: BoundingBox = { x1: 0, y1: 0, x2: 0.5, y2: 0.1 };
      const pageWidth = 612; // Letter size
      const pageHeight = 792;
      
      const points = normalizedToPoints(box, pageWidth, pageHeight);
      
      // Top of page (y1=0 in normalized) should map to near top in points
      // y2=0.1 means bottom of rect is at 10% from top
      // In PDF coords, this should be near the top (high y value)
      expect(points.y).toBeGreaterThan(pageHeight * 0.8);
    });
  });

  describe('Edge Cases', () => {
    it('throws on zero canvas dimensions', () => {
      expect(() => absoluteToPercentage({ x: 50, y: 50 }, 0, 100)).toThrow();
      expect(() => absoluteToPercentage({ x: 50, y: 50 }, 100, 0)).toThrow();
      expect(() => percentageToAbsolute({ x: 50, y: 50 }, 0, 100)).toThrow();
      expect(() => percentageToAbsolute({ x: 50, y: 50 }, 100, 0)).toThrow();
    });

    it('handles origin point correctly', () => {
      const origin: AbsolutePoint = { x: 0, y: 0 };
      const percentage = absoluteToPercentage(origin, 1000, 1000);
      
      expect(percentage.x).toBe(0);
      expect(percentage.y).toBe(0);
    });

    it('handles max point correctly', () => {
      const maxPoint: AbsolutePoint = { x: 1000, y: 1000 };
      const percentage = absoluteToPercentage(maxPoint, 1000, 1000);
      
      expect(percentage.x).toBe(100);
      expect(percentage.y).toBe(100);
    });

    it('handles center point correctly', () => {
      const center: AbsolutePoint = { x: 500, y: 500 };
      const percentage = absoluteToPercentage(center, 1000, 1000);
      
      expect(percentage.x).toBe(50);
      expect(percentage.y).toBe(50);
    });
  });
});
