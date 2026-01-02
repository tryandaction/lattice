/**
 * HUD Logic - Pure functions for testing
 * Separates business logic from React components
 */

import { quantumKeymap, getDisplaySymbol, hasVariants } from '../../config/quantum-keymap';

export interface KeySelectionResult {
  action: 'insert' | 'open-variant-menu' | 'ignore';
  symbol?: string;
  keyCode?: string;
}

/**
 * Determine what action to take when a key is selected
 * Property 5: Symbol Insertion Correctness
 * Property 7: Unmapped Keys Ignored
 */
export function handleKeySelection(
  keyCode: string,
  isShiftHeld: boolean
): KeySelectionResult {
  const mapping = quantumKeymap[keyCode];
  
  // Unmapped keys are ignored
  if (!mapping) {
    return { action: 'ignore' };
  }

  // If shift is held and key has variants, open variant menu
  if (isShiftHeld && hasVariants(keyCode)) {
    return { action: 'open-variant-menu', keyCode };
  }

  // Get the symbol to insert
  const symbol = getDisplaySymbol(keyCode, isShiftHeld);
  if (!symbol) {
    return { action: 'ignore' };
  }

  return { action: 'insert', symbol };
}

/**
 * Check if a key code is mapped in the keymap
 */
export function isMappedKey(keyCode: string): boolean {
  return keyCode in quantumKeymap;
}

/**
 * Get all mapped key codes
 */
export function getMappedKeyCodes(): string[] {
  return Object.keys(quantumKeymap);
}

/**
 * Determine if HUD should close after an action
 * Property 6: Insertion Closes HUD
 */
export function shouldCloseHUD(action: KeySelectionResult['action']): boolean {
  return action === 'insert';
}


/**
 * Determine what happens when Escape is pressed
 * Property 3: Escape Universal Close
 */
export type EscapeResult = 'close-hud' | 'close-variant-menu';

export function handleEscape(isVariantMenuOpen: boolean): EscapeResult {
  if (isVariantMenuOpen) {
    return 'close-variant-menu';
  }
  return 'close-hud';
}
