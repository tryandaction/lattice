/**
 * Property-based tests for Variant Menu Component
 * Feature: quantum-keyboard-hud, Property 10: Variant Navigation Bounds
 * Validates: Requirements 5.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { navigateVariantIndex, isValidVariantIndex } from '../variant-menu';

describe('VariantMenu', () => {
  describe('Property 10: Variant Navigation Bounds', () => {
    /**
     * Property: For any Variant Menu with N variants, navigating with Arrow Down
     * SHALL increment the highlighted index (wrapping from N-1 to 0)
     */
    it('arrow down increments and wraps correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }), // totalVariants
          fc.integer({ min: 0, max: 19 }), // currentIndex (will be clamped)
          (totalVariants, rawIndex) => {
            const currentIndex = rawIndex % totalVariants;
            const newIndex = navigateVariantIndex(currentIndex, 'down', totalVariants);
            
            // Should wrap from N-1 to 0
            if (currentIndex === totalVariants - 1) {
              return newIndex === 0;
            }
            // Otherwise should increment
            return newIndex === currentIndex + 1;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Arrow Up SHALL decrement (wrapping from 0 to N-1)
     */
    it('arrow up decrements and wraps correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }), // totalVariants
          fc.integer({ min: 0, max: 19 }), // currentIndex (will be clamped)
          (totalVariants, rawIndex) => {
            const currentIndex = rawIndex % totalVariants;
            const newIndex = navigateVariantIndex(currentIndex, 'up', totalVariants);
            
            // Should wrap from 0 to N-1
            if (currentIndex === 0) {
              return newIndex === totalVariants - 1;
            }
            // Otherwise should decrement
            return newIndex === currentIndex - 1;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The index always remains in bounds [0, N-1]
     */
    it('index always stays in bounds after any navigation', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }), // totalVariants
          fc.integer({ min: 0, max: 19 }), // startIndex (will be clamped)
          fc.array(fc.constantFrom('up', 'down'), { minLength: 1, maxLength: 50 }), // navigation sequence
          (totalVariants, rawStartIndex, directions) => {
            let currentIndex = rawStartIndex % totalVariants;
            
            for (const direction of directions) {
              currentIndex = navigateVariantIndex(currentIndex, direction as 'up' | 'down', totalVariants);
              
              // Check bounds after each navigation
              if (currentIndex < 0 || currentIndex >= totalVariants) {
                return false;
              }
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Navigation is cyclic - going down N times returns to start
     */
    it('navigating down N times returns to start', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }), // totalVariants
          fc.integer({ min: 0, max: 19 }), // startIndex (will be clamped)
          (totalVariants, rawStartIndex) => {
            const startIndex = rawStartIndex % totalVariants;
            let currentIndex = startIndex;
            
            // Navigate down N times
            for (let i = 0; i < totalVariants; i++) {
              currentIndex = navigateVariantIndex(currentIndex, 'down', totalVariants);
            }
            
            return currentIndex === startIndex;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Navigation is cyclic - going up N times returns to start
     */
    it('navigating up N times returns to start', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }), // totalVariants
          fc.integer({ min: 0, max: 19 }), // startIndex (will be clamped)
          (totalVariants, rawStartIndex) => {
            const startIndex = rawStartIndex % totalVariants;
            let currentIndex = startIndex;
            
            // Navigate up N times
            for (let i = 0; i < totalVariants; i++) {
              currentIndex = navigateVariantIndex(currentIndex, 'up', totalVariants);
            }
            
            return currentIndex === startIndex;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('navigateVariantIndex', () => {
    it('handles single variant', () => {
      expect(navigateVariantIndex(0, 'down', 1)).toBe(0);
      expect(navigateVariantIndex(0, 'up', 1)).toBe(0);
    });

    it('handles two variants', () => {
      expect(navigateVariantIndex(0, 'down', 2)).toBe(1);
      expect(navigateVariantIndex(1, 'down', 2)).toBe(0);
      expect(navigateVariantIndex(0, 'up', 2)).toBe(1);
      expect(navigateVariantIndex(1, 'up', 2)).toBe(0);
    });

    it('handles empty variants', () => {
      expect(navigateVariantIndex(0, 'down', 0)).toBe(0);
      expect(navigateVariantIndex(0, 'up', 0)).toBe(0);
    });
  });

  describe('isValidVariantIndex', () => {
    it('returns true for valid indices', () => {
      expect(isValidVariantIndex(0, 5)).toBe(true);
      expect(isValidVariantIndex(4, 5)).toBe(true);
      expect(isValidVariantIndex(2, 5)).toBe(true);
    });

    it('returns false for out-of-bounds indices', () => {
      expect(isValidVariantIndex(-1, 5)).toBe(false);
      expect(isValidVariantIndex(5, 5)).toBe(false);
      expect(isValidVariantIndex(10, 5)).toBe(false);
    });

    it('handles empty variants', () => {
      expect(isValidVariantIndex(0, 0)).toBe(true); // Edge case: 0 is valid for empty
      expect(isValidVariantIndex(1, 0)).toBe(false);
    });
  });
});
