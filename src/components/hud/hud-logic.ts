/**
 * HUD Logic - Pure functions for testing
 * Separates business logic from React components
 */

import {
  quantumKeymap,
  getDisplaySymbol,
  hasVariants,
  type QuantumKeyMeaning,
  type QuantumLayerId,
} from '../../config/quantum-keymap';
import {
  getEffectiveQuantumLayerMeanings,
  getEffectiveQuantumMeaning,
  type QuantumKeymapOverrides,
} from '../../stores/quantum-keymap-store';

export interface KeySelectionResult {
  action: 'insert' | 'open-variant-menu' | 'ignore';
  symbol?: string;
  keyCode?: string;
}

export interface QuantumInputState {
  keyCode: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  candidatePrefix: number | null;
}

export interface QuantumInputResult {
  action: 'insert' | 'ignore';
  latex?: string;
  meaning?: QuantumKeyMeaning;
  keyCode?: string;
  layer?: QuantumLayerId;
  index?: number;
}

function resolveLayer(input: QuantumInputState): QuantumLayerId {
  return input.ctrlKey ? 'ctrl' : 'base';
}

function resolveCandidateIndex(
  input: QuantumInputState,
  layer: QuantumLayerId,
  overrides?: QuantumKeymapOverrides,
): number {
  const meanings = getEffectiveQuantumLayerMeanings(input.keyCode, layer, overrides);
  if (meanings.length === 0) return 1;
  const requested = input.candidatePrefix ?? 1;
  return Math.max(1, Math.min(Math.trunc(requested), meanings.length));
}

export function resolveQuantumKeyboardInput(
  input: QuantumInputState,
  overrides?: QuantumKeymapOverrides,
): QuantumInputResult {
  const layer = resolveLayer(input);
  const index = resolveCandidateIndex(input, layer, overrides);
  const meaning = getEffectiveQuantumMeaning(input.keyCode, layer, index, overrides);

  if (!meaning) {
    return { action: 'ignore' };
  }

  return {
    action: 'insert',
    latex: meaning.latex,
    meaning,
    keyCode: input.keyCode,
    layer,
    index,
  };
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
 * Determine if HUD should close after an action.
 * Quantum Keyboard 2.0 stays open after insertion to support fast chained input.
 */
export function shouldCloseHUD(_action: KeySelectionResult['action']): boolean {
  return false;
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
