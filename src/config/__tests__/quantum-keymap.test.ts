/**
 * Property-based tests for Quantum Keymap
 * Feature: quantum-keyboard-hud, Property 11: Keymap Schema Validation
 * Validates: Requirements 6.2, 6.3, 6.4, 6.6
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  quantumKeymap,
  validateKeymap,
  isValidLatexCommand,
  getDisplaySymbol,
  hasVariants,
  getVariants,
  KEY_LABELS,
  QWERTY_LAYOUT,
  type KeyMapping,
  type QuantumKeymap,
} from '../quantum-keymap';

describe('Quantum Keymap', () => {
  describe('Property 11: Keymap Schema Validation', () => {
    /**
     * Property: For any entry in the Quantum Keymap, the `default` property
     * SHALL be a non-empty string starting with `\` or `^` or `_`
     */
    it('all default symbols are valid LaTeX commands', () => {
      const errors = validateKeymap(quantumKeymap);
      const defaultErrors = errors.filter(e => e.field === 'default');
      expect(defaultErrors).toHaveLength(0);
      
      // Also verify each entry directly
      for (const [keyCode, mapping] of Object.entries(quantumKeymap)) {
        expect(mapping.default).toBeTruthy();
        expect(isValidLatexCommand(mapping.default)).toBe(true);
      }
    });

    /**
     * Property: If `shift` is defined, it SHALL be a valid LaTeX command
     */
    it('all shift symbols (when defined) are valid LaTeX commands', () => {
      const errors = validateKeymap(quantumKeymap);
      const shiftErrors = errors.filter(e => e.field === 'shift');
      expect(shiftErrors).toHaveLength(0);
      
      for (const [keyCode, mapping] of Object.entries(quantumKeymap)) {
        if (mapping.shift !== undefined) {
          expect(isValidLatexCommand(mapping.shift)).toBe(true);
        }
      }
    });

    /**
     * Property: If `variants` is defined, it SHALL be an array where each
     * element is a valid LaTeX command
     */
    it('all variant symbols (when defined) are valid LaTeX commands', () => {
      const errors = validateKeymap(quantumKeymap);
      const variantErrors = errors.filter(e => e.field.startsWith('variants'));
      expect(variantErrors).toHaveLength(0);
      
      for (const [keyCode, mapping] of Object.entries(quantumKeymap)) {
        if (mapping.variants !== undefined) {
          expect(Array.isArray(mapping.variants)).toBe(true);
          for (const variant of mapping.variants) {
            expect(isValidLatexCommand(variant)).toBe(true);
          }
        }
      }
    });

    /**
     * Property-based test: For any randomly generated valid keymap entry,
     * validation should pass
     */
    it('validates correctly for any valid keymap entry', () => {
      const validLatexCommand = fc.oneof(
        fc.constantFrom('\\alpha', '\\beta', '\\gamma', '\\int', '\\sum'),
        fc.string({ minLength: 1, maxLength: 10 }).map(s => `\\${s.replace(/[^a-zA-Z]/g, 'x')}`),
        fc.constantFrom('^{1}', '^{2}', '_{1}', '_{n}')
      );

      const validKeyMapping = fc.record({
        default: validLatexCommand,
        shift: fc.option(validLatexCommand, { nil: undefined }),
        variants: fc.option(fc.array(validLatexCommand, { minLength: 0, maxLength: 5 }), { nil: undefined }),
      }) as fc.Arbitrary<KeyMapping>;

      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[A-Za-z0-9]+$/.test(s)),
          validKeyMapping,
          (keyCode, mapping) => {
            const testKeymap: QuantumKeymap = { [keyCode]: mapping };
            const errors = validateKeymap(testKeymap);
            return errors.length === 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property-based test: For any randomly generated invalid keymap entry,
     * validation should fail
     */
    it('rejects invalid LaTeX commands', () => {
      const invalidLatexCommand = fc.string({ minLength: 1, maxLength: 10 })
        .filter(s => !s.startsWith('\\') && !s.startsWith('^') && !s.startsWith('_'));

      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[A-Za-z0-9]+$/.test(s)),
          invalidLatexCommand,
          (keyCode, invalidDefault) => {
            const testKeymap: QuantumKeymap = {
              [keyCode]: { default: invalidDefault }
            };
            const errors = validateKeymap(testKeymap);
            return errors.length > 0;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('isValidLatexCommand', () => {
    it('accepts commands starting with backslash', () => {
      expect(isValidLatexCommand('\\alpha')).toBe(true);
      expect(isValidLatexCommand('\\int')).toBe(true);
      expect(isValidLatexCommand('\\frac{}{}')).toBe(true);
    });

    it('accepts superscript and subscript expressions', () => {
      expect(isValidLatexCommand('^{1}')).toBe(true);
      expect(isValidLatexCommand('_{n}')).toBe(true);
      expect(isValidLatexCommand('^{2}')).toBe(true);
    });

    it('rejects invalid commands', () => {
      expect(isValidLatexCommand('')).toBe(false);
      expect(isValidLatexCommand('alpha')).toBe(false);
      expect(isValidLatexCommand('123')).toBe(false);
    });
  });

  describe('getDisplaySymbol', () => {
    it('returns default symbol when shift is not held', () => {
      expect(getDisplaySymbol('KeyI', false)).toBe('\\int');
      expect(getDisplaySymbol('KeyP', false)).toBe('\\pi');
    });

    it('returns shift symbol when shift is held and shift is defined', () => {
      expect(getDisplaySymbol('KeyI', true)).toBe('\\infty');
      expect(getDisplaySymbol('KeyP', true)).toBe('\\prod');
    });

    it('returns default symbol when shift is held but no shift variant exists', () => {
      // Find a key without shift variant or test with a key that has no shift
      const keyWithoutShift = Object.entries(quantumKeymap).find(
        ([_, mapping]) => mapping.shift === undefined
      );
      if (keyWithoutShift) {
        const [keyCode, mapping] = keyWithoutShift;
        expect(getDisplaySymbol(keyCode, true)).toBe(mapping.default);
      }
    });

    it('returns null for unmapped keys', () => {
      expect(getDisplaySymbol('KeyUnknown', false)).toBeNull();
      expect(getDisplaySymbol('F1', false)).toBeNull();
    });
  });

  describe('hasVariants', () => {
    it('returns true for keys with variants', () => {
      expect(hasVariants('KeyI')).toBe(true); // Has iint, iiint, oint, imath
      expect(hasVariants('KeyP')).toBe(true); // Has Pi, phi, Phi, partial
    });

    it('returns false for keys without variants', () => {
      // Find a key without variants
      const keyWithoutVariants = Object.entries(quantumKeymap).find(
        ([_, mapping]) => !mapping.variants || mapping.variants.length === 0
      );
      if (keyWithoutVariants) {
        expect(hasVariants(keyWithoutVariants[0])).toBe(false);
      }
    });

    it('returns false for unmapped keys', () => {
      expect(hasVariants('KeyUnknown')).toBe(false);
    });
  });

  describe('getVariants', () => {
    it('returns variants array for keys with variants', () => {
      const variants = getVariants('KeyI');
      expect(variants).toContain('\\iint');
      expect(variants).toContain('\\oint');
    });

    it('returns empty array for keys without variants', () => {
      expect(getVariants('KeyUnknown')).toEqual([]);
    });
  });

  describe('Keyboard Layout', () => {
    it('QWERTY_LAYOUT covers all mapped keys', () => {
      const layoutKeys = QWERTY_LAYOUT.flatMap(row => row.keys);
      const keymapKeys = Object.keys(quantumKeymap);
      
      for (const key of keymapKeys) {
        expect(layoutKeys).toContain(key);
      }
    });

    it('KEY_LABELS has labels for all layout keys', () => {
      const layoutKeys = QWERTY_LAYOUT.flatMap(row => row.keys);
      
      for (const key of layoutKeys) {
        expect(KEY_LABELS[key]).toBeDefined();
        expect(KEY_LABELS[key].length).toBeGreaterThan(0);
      }
    });
  });
});
