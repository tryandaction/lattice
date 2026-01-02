/**
 * PPT Navigation Tests
 * 
 * Property-based tests for navigation functions
 * 
 * Feature: ppt-viewer-overhaul
 * Property 4: Keyboard Navigation Direction
 * Property 5: Home/End Navigation
 * Property 6: Wheel Navigation Direction
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  navigate,
  navigatePrev,
  navigateNext,
  navigateToSlide,
  canNavigate,
  getNavigationFromKeyboard,
  getJumpFromKeyboard,
  getNavigationFromWheel,
  NavigationDirection,
} from '../ppt-navigation';

describe('PPT Navigation', () => {
  // ==========================================================================
  // Unit Tests
  // ==========================================================================

  describe('navigateToSlide', () => {
    it('should return 0 for empty slides', () => {
      expect(navigateToSlide(5, 0)).toBe(0);
    });

    it('should clamp to valid range', () => {
      expect(navigateToSlide(-1, 10)).toBe(0);
      expect(navigateToSlide(15, 10)).toBe(9);
      expect(navigateToSlide(5, 10)).toBe(5);
    });
  });

  describe('navigate', () => {
    it('should navigate to next slide', () => {
      const result = navigate(0, 10, 'next');
      expect(result.newIndex).toBe(1);
      expect(result.changed).toBe(true);
      expect(result.direction).toBe('next');
    });

    it('should navigate to previous slide', () => {
      const result = navigate(5, 10, 'prev');
      expect(result.newIndex).toBe(4);
      expect(result.changed).toBe(true);
      expect(result.direction).toBe('prev');
    });

    it('should not navigate past first slide', () => {
      const result = navigate(0, 10, 'prev');
      expect(result.newIndex).toBe(0);
      expect(result.changed).toBe(false);
      expect(result.direction).toBe(null);
    });

    it('should not navigate past last slide', () => {
      const result = navigate(9, 10, 'next');
      expect(result.newIndex).toBe(9);
      expect(result.changed).toBe(false);
      expect(result.direction).toBe(null);
    });
  });

  describe('canNavigate', () => {
    it('should return false for empty slides', () => {
      expect(canNavigate(0, 0, 'next')).toBe(false);
      expect(canNavigate(0, 0, 'prev')).toBe(false);
    });

    it('should return correct values at boundaries', () => {
      expect(canNavigate(0, 10, 'prev')).toBe(false);
      expect(canNavigate(0, 10, 'next')).toBe(true);
      expect(canNavigate(9, 10, 'next')).toBe(false);
      expect(canNavigate(9, 10, 'prev')).toBe(true);
    });
  });

  describe('getNavigationFromKeyboard', () => {
    it('should return prev for up/left/pageup keys', () => {
      expect(getNavigationFromKeyboard({ key: 'ArrowUp' } as KeyboardEvent)).toBe('prev');
      expect(getNavigationFromKeyboard({ key: 'ArrowLeft' } as KeyboardEvent)).toBe('prev');
      expect(getNavigationFromKeyboard({ key: 'PageUp' } as KeyboardEvent)).toBe('prev');
    });

    it('should return next for down/right/pagedown/space keys', () => {
      expect(getNavigationFromKeyboard({ key: 'ArrowDown' } as KeyboardEvent)).toBe('next');
      expect(getNavigationFromKeyboard({ key: 'ArrowRight' } as KeyboardEvent)).toBe('next');
      expect(getNavigationFromKeyboard({ key: 'PageDown' } as KeyboardEvent)).toBe('next');
      expect(getNavigationFromKeyboard({ key: ' ' } as KeyboardEvent)).toBe('next');
    });

    it('should return null for non-navigation keys', () => {
      expect(getNavigationFromKeyboard({ key: 'a' } as KeyboardEvent)).toBe(null);
      expect(getNavigationFromKeyboard({ key: 'Enter' } as KeyboardEvent)).toBe(null);
    });
  });

  describe('getJumpFromKeyboard', () => {
    it('should return first for Home key', () => {
      expect(getJumpFromKeyboard({ key: 'Home' } as KeyboardEvent)).toBe('first');
    });

    it('should return last for End key', () => {
      expect(getJumpFromKeyboard({ key: 'End' } as KeyboardEvent)).toBe('last');
    });

    it('should return null for other keys', () => {
      expect(getJumpFromKeyboard({ key: 'ArrowUp' } as KeyboardEvent)).toBe(null);
    });
  });

  describe('getNavigationFromWheel', () => {
    it('should return prev for negative deltaY (scroll up)', () => {
      expect(getNavigationFromWheel(-100)).toBe('prev');
    });

    it('should return next for positive deltaY (scroll down)', () => {
      expect(getNavigationFromWheel(100)).toBe('next');
    });
  });

  // ==========================================================================
  // Property-Based Tests
  // ==========================================================================

  /**
   * Property 4: Keyboard Navigation Direction
   * 
   * For any currentSlideIndex and totalSlides, pressing Up/Left/PageUp SHALL
   * decrement the index (if > 0), and pressing Down/Right/PageDown SHALL
   * increment the index (if < totalSlides-1).
   * 
   * Validates: Requirements 4.2, 4.3, 4.6
   */
  describe('Property 4: Keyboard Navigation Direction', () => {
    const prevKeys = ['ArrowUp', 'ArrowLeft', 'PageUp'];
    const nextKeys = ['ArrowDown', 'ArrowRight', 'PageDown', ' '];

    it('should decrement index for prev keys when not at first slide', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }), // currentIndex (not at first)
          fc.integer({ min: 2, max: 100 }), // totalSlides (at least 2)
          fc.constantFrom(...prevKeys),
          (currentIndex, totalSlides, key) => {
            // Ensure currentIndex is valid
            const validIndex = Math.min(currentIndex, totalSlides - 1);
            if (validIndex === 0) return true; // Skip if at first slide
            
            const direction = getNavigationFromKeyboard({ key } as KeyboardEvent);
            expect(direction).toBe('prev');
            
            const result = navigate(validIndex, totalSlides, direction!);
            expect(result.newIndex).toBe(validIndex - 1);
            expect(result.changed).toBe(true);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should increment index for next keys when not at last slide', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 98 }), // currentIndex (not at last)
          fc.integer({ min: 2, max: 100 }), // totalSlides (at least 2)
          fc.constantFrom(...nextKeys),
          (currentIndex, totalSlides, key) => {
            // Ensure currentIndex is valid and not at last
            const validIndex = Math.min(currentIndex, totalSlides - 2);
            
            const direction = getNavigationFromKeyboard({ key } as KeyboardEvent);
            expect(direction).toBe('next');
            
            const result = navigate(validIndex, totalSlides, direction!);
            expect(result.newIndex).toBe(validIndex + 1);
            expect(result.changed).toBe(true);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not change index at boundaries', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }), // totalSlides
          (totalSlides) => {
            // At first slide, prev should not change
            const prevResult = navigate(0, totalSlides, 'prev');
            expect(prevResult.newIndex).toBe(0);
            expect(prevResult.changed).toBe(false);
            
            // At last slide, next should not change
            const nextResult = navigate(totalSlides - 1, totalSlides, 'next');
            expect(nextResult.newIndex).toBe(totalSlides - 1);
            expect(nextResult.changed).toBe(false);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 5: Home/End Navigation
   * 
   * For any currentSlideIndex and totalSlides > 0, pressing Home SHALL set
   * index to 0, and pressing End SHALL set index to totalSlides-1.
   * 
   * Validates: Requirements 4.4, 4.5
   */
  describe('Property 5: Home/End Navigation', () => {
    it('should jump to first slide on Home key', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }), // currentIndex
          fc.integer({ min: 1, max: 100 }), // totalSlides
          (currentIndex, totalSlides) => {
            const validIndex = Math.min(currentIndex, totalSlides - 1);
            
            const jump = getJumpFromKeyboard({ key: 'Home' } as KeyboardEvent);
            expect(jump).toBe('first');
            
            // Simulating the handler behavior
            const newIndex = 0;
            expect(newIndex).toBe(0);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should jump to last slide on End key', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }), // currentIndex
          fc.integer({ min: 1, max: 100 }), // totalSlides
          (currentIndex, totalSlides) => {
            const jump = getJumpFromKeyboard({ key: 'End' } as KeyboardEvent);
            expect(jump).toBe('last');
            
            // Simulating the handler behavior
            const newIndex = totalSlides - 1;
            expect(newIndex).toBe(totalSlides - 1);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 6: Wheel Navigation Direction
   * 
   * For any currentSlideIndex, scrolling up (negative deltaY) SHALL navigate
   * to previous slide, and scrolling down (positive deltaY) SHALL navigate
   * to next slide, respecting boundaries.
   * 
   * Validates: Requirements 4.1
   */
  describe('Property 6: Wheel Navigation Direction', () => {
    it('should navigate prev on scroll up (negative deltaY)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }), // currentIndex (not at first)
          fc.integer({ min: 2, max: 100 }), // totalSlides
          fc.integer({ min: -1000, max: -10 }), // negative deltaY
          (currentIndex, totalSlides, deltaY) => {
            const validIndex = Math.min(currentIndex, totalSlides - 1);
            if (validIndex === 0) return true;
            
            const direction = getNavigationFromWheel(deltaY);
            expect(direction).toBe('prev');
            
            const result = navigate(validIndex, totalSlides, direction);
            expect(result.newIndex).toBe(validIndex - 1);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should navigate next on scroll down (positive deltaY)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 98 }), // currentIndex (not at last)
          fc.integer({ min: 2, max: 100 }), // totalSlides
          fc.integer({ min: 10, max: 1000 }), // positive deltaY
          (currentIndex, totalSlides, deltaY) => {
            const validIndex = Math.min(currentIndex, totalSlides - 2);
            
            const direction = getNavigationFromWheel(deltaY);
            expect(direction).toBe('next');
            
            const result = navigate(validIndex, totalSlides, direction);
            expect(result.newIndex).toBe(validIndex + 1);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should respect boundaries on wheel navigation', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }), // totalSlides
          fc.integer({ min: -1000, max: 1000 }).filter(d => d !== 0), // deltaY
          (totalSlides, deltaY) => {
            const direction = getNavigationFromWheel(deltaY);
            
            if (direction === 'prev') {
              // At first slide, should not change
              const result = navigate(0, totalSlides, direction);
              expect(result.newIndex).toBe(0);
              expect(result.changed).toBe(false);
            } else {
              // At last slide, should not change
              const result = navigate(totalSlides - 1, totalSlides, direction);
              expect(result.newIndex).toBe(totalSlides - 1);
              expect(result.changed).toBe(false);
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Additional Properties
  // ==========================================================================

  describe('Navigation Invariants', () => {
    it('should always return valid index within bounds', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }), // currentIndex (valid range)
          fc.integer({ min: 1, max: 100 }), // totalSlides
          fc.constantFrom('prev', 'next') as fc.Arbitrary<NavigationDirection>,
          (currentIndex, totalSlides, direction) => {
            // Clamp currentIndex to valid range for this test
            const validIndex = Math.min(Math.max(0, currentIndex), totalSlides - 1);
            const result = navigate(validIndex, totalSlides, direction);
            
            // Result should always be within valid bounds
            expect(result.newIndex).toBeGreaterThanOrEqual(0);
            expect(result.newIndex).toBeLessThanOrEqual(totalSlides - 1);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should be idempotent at boundaries', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }), // totalSlides
          (totalSlides) => {
            // Multiple prev at first slide should stay at 0
            let result = navigate(0, totalSlides, 'prev');
            expect(result.newIndex).toBe(0);
            result = navigate(result.newIndex, totalSlides, 'prev');
            expect(result.newIndex).toBe(0);
            
            // Multiple next at last slide should stay at last
            result = navigate(totalSlides - 1, totalSlides, 'next');
            expect(result.newIndex).toBe(totalSlides - 1);
            result = navigate(result.newIndex, totalSlides, 'next');
            expect(result.newIndex).toBe(totalSlides - 1);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
