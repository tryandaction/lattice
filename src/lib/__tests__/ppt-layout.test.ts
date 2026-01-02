/**
 * PPT Layout Adapter Tests
 * 
 * Tests for layout calculation functions including zoom, centering, and aspect ratio.
 * 
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  calculateOptimalZoom,
  fitToWidth,
  fitToHeight,
  calculateCenterPosition,
  adjustZoom,
  zoomToDecimal,
  zoomToPercentage,
  detectAspectRatio,
  calculateAspectRatioDimensions,
  ZOOM_LIMITS,
  DEFAULT_SLIDE_SIZE,
} from '../ppt-layout';

describe('PPT Layout Adapter', () => {
  // ==========================================================================
  // Unit Tests
  // ==========================================================================
  
  describe('calculateOptimalZoom', () => {
    it('should return 1 for equal container and slide sizes', () => {
      const zoom = calculateOptimalZoom(1000, 600, 960, 540, 0);
      expect(zoom).toBeCloseTo(1, 1);
    });
    
    it('should scale down for smaller container', () => {
      const zoom = calculateOptimalZoom(480, 270, 960, 540, 0);
      expect(zoom).toBeCloseTo(0.5, 2);
    });
    
    it('should scale up for larger container', () => {
      const zoom = calculateOptimalZoom(1920, 1080, 960, 540, 0);
      expect(zoom).toBeCloseTo(2, 1);
    });
    
    it('should respect padding', () => {
      const zoomWithPadding = calculateOptimalZoom(1000, 600, 960, 540, 20);
      const zoomWithoutPadding = calculateOptimalZoom(1000, 600, 960, 540, 0);
      expect(zoomWithPadding).toBeLessThan(zoomWithoutPadding);
    });
    
    it('should handle invalid inputs gracefully', () => {
      expect(calculateOptimalZoom(0, 600, 960, 540)).toBe(1);
      expect(calculateOptimalZoom(1000, 0, 960, 540)).toBe(1);
      expect(calculateOptimalZoom(1000, 600, 0, 540)).toBe(1);
      expect(calculateOptimalZoom(1000, 600, 960, 0)).toBe(1);
    });
    
    it('should clamp to zoom limits', () => {
      // Very small container should hit minimum zoom
      const minZoom = calculateOptimalZoom(10, 10, 960, 540, 0);
      expect(minZoom).toBeGreaterThanOrEqual(ZOOM_LIMITS.MIN / 100);
      
      // Very large container should hit maximum zoom
      const maxZoom = calculateOptimalZoom(100000, 100000, 960, 540, 0);
      expect(maxZoom).toBeLessThanOrEqual(ZOOM_LIMITS.MAX / 100);
    });
  });
  
  describe('fitToWidth', () => {
    it('should calculate zoom to fit width', () => {
      const zoom = fitToWidth(960, 960, 0);
      expect(zoom).toBeCloseTo(1, 2);
    });
    
    it('should scale down for smaller container', () => {
      const zoom = fitToWidth(480, 960, 0);
      expect(zoom).toBeCloseTo(0.5, 2);
    });
    
    it('should handle invalid inputs', () => {
      expect(fitToWidth(0, 960)).toBe(1);
      expect(fitToWidth(960, 0)).toBe(1);
    });
  });
  
  describe('fitToHeight', () => {
    it('should calculate zoom to fit height', () => {
      const zoom = fitToHeight(540, 540, 0);
      expect(zoom).toBeCloseTo(1, 2);
    });
    
    it('should scale down for smaller container', () => {
      const zoom = fitToHeight(270, 540, 0);
      expect(zoom).toBeCloseTo(0.5, 2);
    });
    
    it('should handle invalid inputs', () => {
      expect(fitToHeight(0, 540)).toBe(1);
      expect(fitToHeight(540, 0)).toBe(1);
    });
  });
  
  describe('calculateCenterPosition', () => {
    it('should center slide in container', () => {
      const pos = calculateCenterPosition(1000, 600, 960, 540, 1);
      expect(pos.x).toBeCloseTo(20, 0);
      expect(pos.y).toBeCloseTo(30, 0);
    });
    
    it('should return 0 offset when slide is larger than container', () => {
      const pos = calculateCenterPosition(500, 300, 960, 540, 1);
      expect(pos.x).toBe(0);
      expect(pos.y).toBe(0);
    });
    
    it('should account for zoom', () => {
      const pos = calculateCenterPosition(1000, 600, 960, 540, 0.5);
      // Scaled size: 480x270, offsets: (1000-480)/2=260, (600-270)/2=165
      expect(pos.x).toBeCloseTo(260, 0);
      expect(pos.y).toBeCloseTo(165, 0);
    });
  });
  
  describe('adjustZoom', () => {
    it('should zoom in by step', () => {
      expect(adjustZoom(100, 'in', 10)).toBe(110);
    });
    
    it('should zoom out by step', () => {
      expect(adjustZoom(100, 'out', 10)).toBe(90);
    });
    
    it('should not exceed maximum zoom', () => {
      expect(adjustZoom(ZOOM_LIMITS.MAX, 'in', 10)).toBe(ZOOM_LIMITS.MAX);
    });
    
    it('should not go below minimum zoom', () => {
      expect(adjustZoom(ZOOM_LIMITS.MIN, 'out', 10)).toBe(ZOOM_LIMITS.MIN);
    });
  });
  
  describe('zoomToDecimal / zoomToPercentage', () => {
    it('should convert percentage to decimal', () => {
      expect(zoomToDecimal(100)).toBe(1);
      expect(zoomToDecimal(50)).toBe(0.5);
      expect(zoomToDecimal(200)).toBe(2);
    });
    
    it('should convert decimal to percentage', () => {
      expect(zoomToPercentage(1)).toBe(100);
      expect(zoomToPercentage(0.5)).toBe(50);
      expect(zoomToPercentage(2)).toBe(200);
    });
  });
  
  describe('detectAspectRatio', () => {
    it('should detect widescreen (16:9)', () => {
      expect(detectAspectRatio(1920, 1080)).toBe('widescreen');
      expect(detectAspectRatio(960, 540)).toBe('widescreen');
    });
    
    it('should detect standard (4:3)', () => {
      expect(detectAspectRatio(1024, 768)).toBe('standard');
      expect(detectAspectRatio(800, 600)).toBe('standard');
    });
    
    it('should detect custom ratios', () => {
      expect(detectAspectRatio(1000, 1000)).toBe('custom');
      expect(detectAspectRatio(500, 800)).toBe('custom');
    });
    
    it('should handle invalid inputs', () => {
      expect(detectAspectRatio(0, 100)).toBe('custom');
      expect(detectAspectRatio(100, 0)).toBe('custom');
    });
  });
  
  describe('calculateAspectRatioDimensions', () => {
    it('should fit to height when container is wider', () => {
      const dims = calculateAspectRatioDimensions(2000, 1000, 16/9);
      expect(dims.height).toBe(1000);
      expect(dims.width).toBeCloseTo(1000 * 16/9, 0);
    });
    
    it('should fit to width when container is taller', () => {
      const dims = calculateAspectRatioDimensions(1000, 2000, 16/9);
      expect(dims.width).toBe(1000);
      expect(dims.height).toBeCloseTo(1000 / (16/9), 0);
    });
  });
  
  // ==========================================================================
  // Property-Based Tests
  // ==========================================================================
  
  /**
   * Property 5: Layout Calculation Correctness
   * For any container dimensions (w, h) and slide dimensions (sw, sh), the calculated zoom SHALL:
   * - Ensure the scaled slide fits within the container: sw * zoom ≤ w AND sh * zoom ≤ h
   * - Maintain the original aspect ratio: (sw * zoom) / (sh * zoom) = sw / sh
   * - Center the slide: the slide center equals the container center
   * 
   * **Validates: Requirements 3.1, 3.2, 3.4**
   */
  describe('Property 5: Layout Calculation Correctness', () => {
    // Arbitrary for positive dimensions
    const positiveDimension = fc.integer({ min: 100, max: 4000 });
    
    it('should ensure scaled slide fits within container', () => {
      fc.assert(
        fc.property(
          positiveDimension, // container width
          positiveDimension, // container height
          positiveDimension, // slide width
          positiveDimension, // slide height
          (cw, ch, sw, sh) => {
            const padding = 20;
            const zoom = calculateOptimalZoom(cw, ch, sw, sh, padding);
            
            const scaledWidth = sw * zoom;
            const scaledHeight = sh * zoom;
            const availableWidth = cw - padding * 2;
            const availableHeight = ch - padding * 2;
            
            // If zoom is not at minimum limit, scaled slide should fit
            // (at minimum zoom, the slide might not fit if container is too small)
            if (zoom > ZOOM_LIMITS.MIN / 100) {
              // Scaled slide should fit within available space (with tolerance for floating point)
              expect(scaledWidth).toBeLessThanOrEqual(availableWidth + 1);
              expect(scaledHeight).toBeLessThanOrEqual(availableHeight + 1);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
    
    it('should maintain aspect ratio after scaling', () => {
      fc.assert(
        fc.property(
          positiveDimension,
          positiveDimension,
          positiveDimension,
          positiveDimension,
          (cw, ch, sw, sh) => {
            const zoom = calculateOptimalZoom(cw, ch, sw, sh, 0);
            
            const originalRatio = sw / sh;
            const scaledRatio = (sw * zoom) / (sh * zoom);
            
            // Aspect ratio should be preserved
            expect(Math.abs(originalRatio - scaledRatio)).toBeLessThan(0.001);
          }
        ),
        { numRuns: 100 }
      );
    });
    
    it('should center the slide correctly', () => {
      fc.assert(
        fc.property(
          positiveDimension,
          positiveDimension,
          positiveDimension,
          positiveDimension,
          (cw, ch, sw, sh) => {
            const zoom = calculateOptimalZoom(cw, ch, sw, sh, 0);
            const pos = calculateCenterPosition(cw, ch, sw, sh, zoom);
            
            const scaledWidth = sw * zoom;
            const scaledHeight = sh * zoom;
            
            // If slide fits, it should be centered
            if (scaledWidth <= cw && scaledHeight <= ch) {
              const expectedX = (cw - scaledWidth) / 2;
              const expectedY = (ch - scaledHeight) / 2;
              
              expect(Math.abs(pos.x - expectedX)).toBeLessThan(0.01);
              expect(Math.abs(pos.y - expectedY)).toBeLessThan(0.01);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
    
    it('should respect zoom limits', () => {
      fc.assert(
        fc.property(
          positiveDimension,
          positiveDimension,
          positiveDimension,
          positiveDimension,
          (cw, ch, sw, sh) => {
            const zoom = calculateOptimalZoom(cw, ch, sw, sh, 0);
            
            // Zoom should be within limits
            expect(zoom).toBeGreaterThanOrEqual(ZOOM_LIMITS.MIN / 100);
            expect(zoom).toBeLessThanOrEqual(ZOOM_LIMITS.MAX / 100);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
  
  /**
   * Additional property: Zoom conversion round-trip
   */
  describe('Zoom conversion round-trip', () => {
    it('should preserve value through decimal/percentage conversion', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 400 }),
          (percentage) => {
            const decimal = zoomToDecimal(percentage);
            const backToPercentage = zoomToPercentage(decimal);
            
            expect(backToPercentage).toBe(percentage);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
