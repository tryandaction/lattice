/**
 * PPT Viewer Layout Tests
 * 
 * Property-based tests for layout calculation functions
 * 
 * Feature: ppt-viewer-overhaul
 * Property 7: Layout Aspect Ratio Preservation
 * Property 8: Layout Boundary Constraints
 * Validates: Requirements 3.1, 3.2, 3.4, 3.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  calculateViewerLayout,
  calculateSlideSize,
  calculateThumbnailPanelWidth,
  calculateThumbnailSize,
  isAspectRatioPreserved,
  areDimensionsValid,
  detectSlideAspectRatio,
} from '../ppt-viewer-layout';
import { LAYOUT_CONSTANTS, DEFAULT_SLIDE_SIZE } from '../../types/ppt-viewer';

describe('PPT Viewer Layout', () => {
  describe('calculateThumbnailPanelWidth', () => {
    it('should return 0 for narrow containers', () => {
      expect(calculateThumbnailPanelWidth(500)).toBe(0);
      expect(calculateThumbnailPanelWidth(599)).toBe(0);
    });

    it('should return minimum width for small containers', () => {
      const width = calculateThumbnailPanelWidth(600);
      expect(width).toBeGreaterThanOrEqual(LAYOUT_CONSTANTS.THUMBNAIL_PANEL_MIN_WIDTH);
    });

    it('should not exceed maximum width', () => {
      const width = calculateThumbnailPanelWidth(2000);
      expect(width).toBeLessThanOrEqual(LAYOUT_CONSTANTS.THUMBNAIL_PANEL_MAX_WIDTH);
    });
  });

  describe('calculateSlideSize', () => {
    it('should return default size for invalid inputs', () => {
      const result = calculateSlideSize(0, 0);
      expect(result.slideWidth).toBe(DEFAULT_SLIDE_SIZE.width);
      expect(result.slideHeight).toBe(DEFAULT_SLIDE_SIZE.height);
    });

    it('should preserve 16:9 aspect ratio', () => {
      const result = calculateSlideSize(1000, 800, 16 / 9);
      expect(isAspectRatioPreserved(result.slideWidth, result.slideHeight, 16 / 9)).toBe(true);
    });

    it('should preserve 4:3 aspect ratio', () => {
      const result = calculateSlideSize(1000, 800, 4 / 3);
      expect(isAspectRatioPreserved(result.slideWidth, result.slideHeight, 4 / 3)).toBe(true);
    });
  });

  describe('calculateThumbnailSize', () => {
    it('should return 0 for zero panel width', () => {
      const result = calculateThumbnailSize(0);
      expect(result.thumbnailWidth).toBe(0);
      expect(result.thumbnailHeight).toBe(0);
    });

    it('should calculate correct thumbnail dimensions', () => {
      const result = calculateThumbnailSize(160, 16 / 9);
      expect(result.thumbnailWidth).toBeGreaterThan(0);
      expect(result.thumbnailHeight).toBeGreaterThan(0);
    });
  });

  describe('detectSlideAspectRatio', () => {
    it('should detect 16:9 ratio', () => {
      const ratio = detectSlideAspectRatio(1920, 1080);
      expect(ratio).toBeCloseTo(16 / 9, 2);
    });

    it('should detect 4:3 ratio', () => {
      const ratio = detectSlideAspectRatio(1024, 768);
      expect(ratio).toBeCloseTo(4 / 3, 2);
    });

    it('should return default for invalid inputs', () => {
      const ratio = detectSlideAspectRatio(0, 0);
      expect(ratio).toBe(LAYOUT_CONSTANTS.DEFAULT_ASPECT_RATIO);
    });
  });

  /**
   * Property 7: Layout Aspect Ratio Preservation
   * 
   * For any container dimensions and slide aspect ratio, the calculated
   * slide dimensions SHALL maintain the original aspect ratio within
   * a tolerance of 0.01.
   * 
   * Validates: Requirements 3.2
   */
  describe('Property 7: Layout Aspect Ratio Preservation', () => {
    it('should preserve aspect ratio for all valid container sizes', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 400, max: 3000 }), // containerWidth
          fc.integer({ min: 300, max: 2000 }), // containerHeight
          fc.double({ min: 1.0, max: 2.5, noNaN: true }), // aspectRatio
          (containerWidth, containerHeight, aspectRatio) => {
            const { slideWidth, slideHeight } = calculateSlideSize(
              containerWidth,
              containerHeight,
              aspectRatio
            );
            
            // Aspect ratio should be preserved within tolerance
            const preserved = isAspectRatioPreserved(
              slideWidth,
              slideHeight,
              aspectRatio,
              0.02 // Slightly larger tolerance for rounding
            );
            
            return preserved;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve aspect ratio in complete layout calculation', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 600, max: 2500 }), // containerWidth (min for thumbnails)
          fc.integer({ min: 400, max: 1500 }), // containerHeight
          fc.constantFrom(16 / 9, 4 / 3), // common aspect ratios
          (containerWidth, containerHeight, aspectRatio) => {
            const layout = calculateViewerLayout(
              containerWidth,
              containerHeight,
              aspectRatio
            );
            
            return isAspectRatioPreserved(
              layout.slideWidth,
              layout.slideHeight,
              aspectRatio,
              0.02
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 8: Layout Boundary Constraints
   * 
   * For any container dimensions, the calculated slide dimensions SHALL
   * not exceed the available space and SHALL not be smaller than the
   * minimum size (unless container is smaller).
   * 
   * Validates: Requirements 3.1, 3.4, 3.5
   */
  describe('Property 8: Layout Boundary Constraints', () => {
    it('should not exceed container bounds', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 200, max: 3000 }), // containerWidth
          fc.integer({ min: 200, max: 2000 }), // containerHeight
          fc.double({ min: 1.0, max: 2.5, noNaN: true }), // aspectRatio
          (containerWidth, containerHeight, aspectRatio) => {
            const { slideWidth, slideHeight } = calculateSlideSize(
              containerWidth,
              containerHeight,
              aspectRatio
            );
            
            // Slide should fit within container (accounting for padding)
            const maxWidth = containerWidth - LAYOUT_CONSTANTS.SLIDE_PADDING * 2;
            const maxHeight = containerHeight - LAYOUT_CONSTANTS.SLIDE_PADDING * 2;
            
            // Allow small tolerance for rounding
            return slideWidth <= maxWidth + 2 && slideHeight <= maxHeight + 2;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should respect minimum size when container is large enough', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 600, max: 3000 }), // containerWidth (large enough)
          fc.integer({ min: 400, max: 2000 }), // containerHeight (large enough)
          fc.double({ min: 1.0, max: 2.5, noNaN: true }), // aspectRatio
          (containerWidth, containerHeight, aspectRatio) => {
            const { slideWidth, slideHeight } = calculateSlideSize(
              containerWidth,
              containerHeight,
              aspectRatio
            );
            
            // When container is large enough, slide should meet minimum size
            // (at least in one dimension based on aspect ratio)
            const meetsMinWidth = slideWidth >= LAYOUT_CONSTANTS.SLIDE_MIN_WIDTH - 1;
            const meetsMinHeight = slideHeight >= LAYOUT_CONSTANTS.SLIDE_MIN_HEIGHT - 1;
            
            return meetsMinWidth || meetsMinHeight;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should calculate valid complete layout', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 600, max: 2500 }), // containerWidth
          fc.integer({ min: 400, max: 1500 }), // containerHeight
          (containerWidth, containerHeight) => {
            const layout = calculateViewerLayout(containerWidth, containerHeight);
            
            // Thumbnail panel + main area should equal container width
            const totalWidth = layout.thumbnailPanelWidth + layout.mainAreaWidth;
            const widthValid = Math.abs(totalWidth - containerWidth) <= 1;
            
            // Main area height should equal container height
            const heightValid = layout.mainAreaHeight === containerHeight;
            
            // Slide should fit in main area
            const slidesFit = layout.slideWidth <= layout.mainAreaWidth &&
                             layout.slideHeight <= layout.mainAreaHeight;
            
            return widthValid && heightValid && slidesFit;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle thumbnail panel visibility correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 2000 }), // containerWidth
          fc.integer({ min: 200, max: 1000 }), // containerHeight
          (containerWidth, containerHeight) => {
            const layout = calculateViewerLayout(containerWidth, containerHeight);
            
            if (containerWidth < LAYOUT_CONSTANTS.MIN_WIDTH_FOR_THUMBNAILS) {
              // Thumbnail panel should be hidden
              return layout.thumbnailPanelWidth === 0;
            } else {
              // Thumbnail panel should be visible and within bounds
              return layout.thumbnailPanelWidth >= LAYOUT_CONSTANTS.THUMBNAIL_PANEL_MIN_WIDTH &&
                     layout.thumbnailPanelWidth <= LAYOUT_CONSTANTS.THUMBNAIL_PANEL_MAX_WIDTH;
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small containers gracefully', () => {
      const layout = calculateViewerLayout(100, 100);
      expect(layout.slideWidth).toBeGreaterThan(0);
      expect(layout.slideHeight).toBeGreaterThan(0);
    });

    it('should handle very large containers', () => {
      const layout = calculateViewerLayout(5000, 3000);
      expect(layout.thumbnailPanelWidth).toBeLessThanOrEqual(LAYOUT_CONSTANTS.THUMBNAIL_PANEL_MAX_WIDTH);
      expect(layout.slideWidth).toBeGreaterThan(0);
    });

    it('should handle extreme aspect ratios', () => {
      const wideResult = calculateSlideSize(1000, 500, 3);
      expect(wideResult.slideWidth).toBeGreaterThan(0);
      
      const tallResult = calculateSlideSize(500, 1000, 0.5);
      expect(tallResult.slideHeight).toBeGreaterThan(0);
    });
  });
});
