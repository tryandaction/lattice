/**
 * Quantum Keyboard HUD Components
 * Export all HUD-related components and utilities
 */

export { KeyboardHUD, type KeyboardHUDProps } from './keyboard-hud';
export { ShadowKeyboard, getKeycapPosition, type ShadowKeyboardProps } from './shadow-keyboard';
export { Keycap, computeKeycapDisplay, type KeycapProps, type KeycapDisplayData } from './keycap';
export { SymbolSelector, type SymbolSelectorProps } from './symbol-selector';
export { HUDProvider, registerTiptapEditor, getGlobalTiptapEditor, getLastKnownCursorPosition, type HUDProviderProps } from './hud-provider';
export { handleKeySelection, isMappedKey, getMappedKeyCodes, shouldCloseHUD } from './hud-logic';

// Legacy export for compatibility
export { VariantMenu, navigateVariantIndex, isValidVariantIndex, type VariantMenuProps } from './variant-menu';
