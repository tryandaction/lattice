/**
 * Property-based tests for Keycap Component
 * Feature: quantum-keyboard-hud, Property 4: Keycap Rendering Correctness
 * Validates: Requirements 2.4, 2.5, 2.6
 * 
 * Updated: Keycap now always shows default symbol (shift opens symbol selector)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { computeKeycapDisplay, type KeycapDisplayData } from '../keycap';

describe('Keycap', () => {
  describe('Property 4: Keycap Rendering Correctness', () => {
    /**
     * Property: For any key in the Quantum Keymap, the rendered Keycap SHALL
     * display the physical key label in the top-left
     */
    it('always displays physical label', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 5 }), // physicalLabel
          fc.string({ minLength: 1, maxLength: 20 }).map(s => `\\${s}`), // defaultSymbol
          fc.option(fc.string({ minLength: 1, maxLength: 20 }).map(s => `\\${s}`), { nil: undefined }), // shiftSymbol
          fc.boolean(), // hasVariants
          fc.boolean(), // isShiftHeld
          (physicalLabel, defaultSymbol, shiftSymbol, hasVariants, isShiftHeld) => {
            const result = computeKeycapDisplay(
              physicalLabel,
              defaultSymbol,
              shiftSymbol,
              hasVariants,
              isShiftHeld
            );
            return result.physicalLabel === physicalLabel;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: The keycap SHALL always display the default symbol
     * (shift now opens symbol selector instead of changing display)
     */
    it('always displays default symbol regardless of shift state', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 5 }), // physicalLabel
          fc.string({ minLength: 1, maxLength: 20 }).map(s => `\\${s}`), // defaultSymbol
          fc.string({ minLength: 1, maxLength: 20 }).map(s => `\\${s}`), // shiftSymbol
          fc.boolean(), // hasVariants
          fc.boolean(), // isShiftHeld
          (physicalLabel, defaultSymbol, shiftSymbol, hasVariants, isShiftHeld) => {
            const result = computeKeycapDisplay(
              physicalLabel,
              defaultSymbol,
              shiftSymbol,
              hasVariants,
              isShiftHeld
            );
            // Always shows default symbol now
            return result.displaySymbol === defaultSymbol;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Variant indicator SHALL be shown if hasVariants OR shiftSymbol exists
     */
    it('shows variant indicator when hasVariants or shiftSymbol exists', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 5 }), // physicalLabel
          fc.string({ minLength: 1, maxLength: 20 }).map(s => `\\${s}`), // defaultSymbol
          fc.option(fc.string({ minLength: 1, maxLength: 20 }).map(s => `\\${s}`), { nil: undefined }), // shiftSymbol
          fc.boolean(), // hasVariants
          fc.boolean(), // isShiftHeld
          (physicalLabel, defaultSymbol, shiftSymbol, hasVariants, isShiftHeld) => {
            const result = computeKeycapDisplay(
              physicalLabel,
              defaultSymbol,
              shiftSymbol,
              hasVariants,
              isShiftHeld
            );
            // Indicator shows if hasVariants OR shiftSymbol exists
            const expectedIndicator = hasVariants || !!shiftSymbol;
            return result.hasVariantIndicator === expectedIndicator;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('computeKeycapDisplay', () => {
    it('returns correct data for default state', () => {
      const result = computeKeycapDisplay('I', '\\int', '\\infty', true, false);
      
      expect(result).toEqual({
        physicalLabel: 'I',
        displaySymbol: '\\int',
        hasVariantIndicator: true,
      });
    });

    it('returns default symbol even when shift is held', () => {
      const result = computeKeycapDisplay('I', '\\int', '\\infty', true, true);
      
      expect(result).toEqual({
        physicalLabel: 'I',
        displaySymbol: '\\int', // Always default now
        hasVariantIndicator: true,
      });
    });

    it('shows indicator when shift symbol exists even without variants', () => {
      const result = computeKeycapDisplay('J', '\\jmath', '\\mathbb{J}', false, false);
      
      expect(result).toEqual({
        physicalLabel: 'J',
        displaySymbol: '\\jmath',
        hasVariantIndicator: true, // Because shiftSymbol exists
      });
    });

    it('handles keys without variants or shift symbol', () => {
      const result = computeKeycapDisplay('Z', '\\zeta', undefined, false, false);
      
      expect(result).toEqual({
        physicalLabel: 'Z',
        displaySymbol: '\\zeta',
        hasVariantIndicator: false,
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles empty physical label', () => {
      const result = computeKeycapDisplay('', '\\alpha', undefined, false, false);
      expect(result.physicalLabel).toBe('');
    });

    it('handles complex LaTeX symbols', () => {
      const result = computeKeycapDisplay('F', '\\frac{}{}', '\\phi', true, false);
      expect(result.displaySymbol).toBe('\\frac{}{}');
    });

    it('handles superscript/subscript symbols', () => {
      const result = computeKeycapDisplay('1', '^{1}', '_{1}', false, true);
      expect(result.displaySymbol).toBe('^{1}'); // Always default now
    });
  });
});
