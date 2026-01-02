/**
 * Property-based tests for HUD Logic
 * Feature: quantum-keyboard-hud
 * Property 5: Symbol Insertion Correctness
 * Property 7: Unmapped Keys Ignored
 * Validates: Requirements 3.1, 3.4, 4.3, 4.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  handleKeySelection,
  isMappedKey,
  getMappedKeyCodes,
  shouldCloseHUD,
  handleEscape,
} from '../hud-logic';
import { quantumKeymap, getDisplaySymbol, hasVariants } from '../../../config/quantum-keymap';

describe('HUD Logic', () => {
  const mappedKeyCodes = getMappedKeyCodes();
  const unmappedKeyCodes = ['F1', 'F2', 'F12', 'Escape', 'Tab', 'CapsLock', 'Space', 'Backspace', 'Delete'];

  describe('Property 5: Symbol Insertion Correctness', () => {
    /**
     * Property: For any mapped key K, pressing K without Shift SHALL insert
     * keymap[K].default
     */
    it('inserts default symbol when shift is not held', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...mappedKeyCodes),
          (keyCode) => {
            const result = handleKeySelection(keyCode, false);
            const mapping = quantumKeymap[keyCode];
            
            // If key has variants and we're not holding shift, should insert default
            if (result.action === 'insert') {
              return result.symbol === mapping.default;
            }
            // Should never open variant menu without shift
            return result.action !== 'open-variant-menu';
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any mapped key K with shift variant, pressing K with Shift
     * SHALL insert keymap[K].shift
     */
    it('inserts shift symbol when shift is held (for keys without variants)', () => {
      const keysWithShiftNoVariants = mappedKeyCodes.filter(
        (k) => quantumKeymap[k].shift && !hasVariants(k)
      );

      if (keysWithShiftNoVariants.length === 0) {
        // Skip if no such keys exist
        return;
      }

      fc.assert(
        fc.property(
          fc.constantFrom(...keysWithShiftNoVariants),
          (keyCode) => {
            const result = handleKeySelection(keyCode, true);
            const mapping = quantumKeymap[keyCode];
            
            if (result.action === 'insert') {
              return result.symbol === mapping.shift;
            }
            return false;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For keys without shift variant, shift+key inserts default
     */
    it('falls back to default when no shift variant exists', () => {
      const keysWithoutShift = mappedKeyCodes.filter(
        (k) => !quantumKeymap[k].shift && !hasVariants(k)
      );

      if (keysWithoutShift.length === 0) {
        // Skip if no such keys exist
        return;
      }

      fc.assert(
        fc.property(
          fc.constantFrom(...keysWithoutShift),
          (keyCode) => {
            const result = handleKeySelection(keyCode, true);
            const mapping = quantumKeymap[keyCode];
            
            if (result.action === 'insert') {
              return result.symbol === mapping.default;
            }
            return false;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For keys with variants, shift+key opens variant menu
     */
    it('opens variant menu for keys with variants when shift is held', () => {
      const keysWithVariants = mappedKeyCodes.filter((k) => hasVariants(k));

      fc.assert(
        fc.property(
          fc.constantFrom(...keysWithVariants),
          (keyCode) => {
            const result = handleKeySelection(keyCode, true);
            return result.action === 'open-variant-menu' && result.keyCode === keyCode;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 7: Unmapped Keys Ignored', () => {
    /**
     * Property: For any key K that is NOT in the Quantum Keymap, pressing K
     * SHALL NOT change the HUD state or insert any symbol
     */
    it('ignores unmapped keys', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...unmappedKeyCodes),
          fc.boolean(), // isShiftHeld
          (keyCode, isShiftHeld) => {
            const result = handleKeySelection(keyCode, isShiftHeld);
            return result.action === 'ignore';
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Random strings that aren't key codes should be ignored
     */
    it('ignores random non-keycode strings', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }).filter(
            (s) => !mappedKeyCodes.includes(s)
          ),
          fc.boolean(),
          (randomString, isShiftHeld) => {
            const result = handleKeySelection(randomString, isShiftHeld);
            return result.action === 'ignore';
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('shouldCloseHUD', () => {
    it('returns true for insert action', () => {
      expect(shouldCloseHUD('insert')).toBe(true);
    });

    it('returns false for open-variant-menu action', () => {
      expect(shouldCloseHUD('open-variant-menu')).toBe(false);
    });

    it('returns false for ignore action', () => {
      expect(shouldCloseHUD('ignore')).toBe(false);
    });
  });

  describe('isMappedKey', () => {
    it('returns true for mapped keys', () => {
      expect(isMappedKey('KeyI')).toBe(true);
      expect(isMappedKey('KeyP')).toBe(true);
      expect(isMappedKey('KeyA')).toBe(true);
    });

    it('returns false for unmapped keys', () => {
      expect(isMappedKey('F1')).toBe(false);
      expect(isMappedKey('Escape')).toBe(false);
      expect(isMappedKey('RandomKey')).toBe(false);
    });
  });

  describe('handleKeySelection', () => {
    it('handles KeyI without shift', () => {
      const result = handleKeySelection('KeyI', false);
      expect(result.action).toBe('insert');
      expect(result.symbol).toBe('\\int');
    });

    it('handles KeyI with shift (has variants)', () => {
      const result = handleKeySelection('KeyI', true);
      expect(result.action).toBe('open-variant-menu');
      expect(result.keyCode).toBe('KeyI');
    });

    it('handles unmapped key', () => {
      const result = handleKeySelection('F1', false);
      expect(result.action).toBe('ignore');
    });
  });

  describe('Property 6: Insertion Closes HUD', () => {
    /**
     * Property: For any symbol insertion (via standard selection, shift selection,
     * or variant selection), the HUD SHALL transition to closed state
     */
    it('HUD closes after any successful insertion', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...mappedKeyCodes),
          fc.boolean(), // isShiftHeld
          (keyCode, isShiftHeld) => {
            const result = handleKeySelection(keyCode, isShiftHeld);
            
            // If action is insert, HUD should close
            if (result.action === 'insert') {
              return shouldCloseHUD(result.action) === true;
            }
            
            // If action is open-variant-menu, HUD should NOT close
            if (result.action === 'open-variant-menu') {
              return shouldCloseHUD(result.action) === false;
            }
            
            // If action is ignore, HUD should NOT close
            return shouldCloseHUD(result.action) === false;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Insert action always results in HUD closing
     */
    it('insert action always closes HUD', () => {
      expect(shouldCloseHUD('insert')).toBe(true);
    });

    /**
     * Property: Non-insert actions never close HUD
     */
    it('non-insert actions never close HUD', () => {
      expect(shouldCloseHUD('open-variant-menu')).toBe(false);
      expect(shouldCloseHUD('ignore')).toBe(false);
    });
  });
});


describe('Property 3: Escape Universal Close', () => {
  /**
   * Property: For any HUD state (standard, shift-held, or variant-menu),
   * pressing Escape SHALL transition appropriately
   */
  it('escape closes variant menu when open', () => {
    const result = handleEscape(true);
    expect(result).toBe('close-variant-menu');
  });

  it('escape closes HUD when variant menu is not open', () => {
    const result = handleEscape(false);
    expect(result).toBe('close-hud');
  });

  /**
   * Property: Escape from variant menu returns to standard mode (not closed)
   */
  it('escape from variant menu does not close HUD entirely', () => {
    const result = handleEscape(true);
    expect(result).not.toBe('close-hud');
  });

  /**
   * Property-based test: Escape behavior is deterministic
   */
  it('escape behavior is deterministic based on variant menu state', () => {
    fc.assert(
      fc.property(
        fc.boolean(), // isVariantMenuOpen
        (isVariantMenuOpen) => {
          const result = handleEscape(isVariantMenuOpen);
          
          if (isVariantMenuOpen) {
            return result === 'close-variant-menu';
          } else {
            return result === 'close-hud';
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
