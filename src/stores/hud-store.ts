/**
 * HUD State Store
 * Manages the global state for the Quantum Keyboard HUD
 * 
 * Smart Positioning:
 * - Tracks cursor/math field position in viewport
 * - Automatically positions keyboard to avoid blocking input
 * - Supports user drag customization
 */

import { create } from 'zustand';
import { quantumKeymap, getVariants } from '../config/quantum-keymap';
import { useQuantumCustomStore, getAllSymbolsForKey } from './quantum-custom-store';

// ============================================================================
// Types
// ============================================================================

export type HUDMode = 'closed' | 'standard' | 'symbol-selector';
export type HUDPosition = 'top' | 'bottom' | 'auto';

export interface HUDCoordinates {
  x: number;
  y: number;
}

/** Simplified cursor position info (serializable) */
export interface CursorPosition {
  top: number;
  bottom: number;
  left: number;
  right: number;
  centerY: number;
}

export interface HUDState {
  // State
  isOpen: boolean;
  activeSymbolKey: string | null;
  highlightedIndex: number;
  activeMathFieldId: string | null;
  flashingKey: string | null;
  isEditMode: boolean;
  
  // Position state
  position: HUDPosition;
  customOffset: HUDCoordinates | null;
  isDragging: boolean;
  cursorPosition: CursorPosition | null;
  
  // Computed
  mode: HUDMode;
  
  // Actions
  openHUD: (mathFieldId: string) => void;
  closeHUD: () => void;
  openSymbolSelector: (keyCode: string) => void;
  closeSymbolSelector: () => void;
  navigateSymbol: (direction: 'up' | 'down') => void;
  selectSymbol: () => string | null;
  flashKey: (key: string) => void;
  clearFlash: () => void;
  setEditMode: (editMode: boolean) => void;
  toggleEditMode: () => void;
  
  // Position actions
  setPosition: (position: HUDPosition) => void;
  setCustomOffset: (offset: HUDCoordinates | null) => void;
  setIsDragging: (isDragging: boolean) => void;
  updateCursorPosition: (rect: DOMRect | null) => void;
  resetPosition: () => void;
  
  // Utility
  getCurrentSymbols: () => string[];
  getHighlightedSymbol: () => string | null;
  getTotalItems: () => number;
  computeOptimalPosition: () => 'top' | 'bottom';
}

// ============================================================================
// Constants
// ============================================================================

const HUD_HEIGHT = 320; // Approximate height of the keyboard HUD (including drag handle)
const _HUD_WIDTH = 480;  // Approximate width of the keyboard HUD (reserved for future use)
const HUD_MARGIN = 20;  // Margin between cursor and HUD (reduced for better positioning)
const VIEWPORT_PADDING = 20; // Padding from viewport edges
const BOTTOM_THRESHOLD = 0.55; // If cursor is below this % of viewport, show HUD on top


// ============================================================================
// Helper to get all symbols for a key
// ============================================================================

function getSymbolsForKey(keyCode: string): string[] {
  const mapping = quantumKeymap[keyCode];
  if (!mapping) return [];
  
  const customStore = useQuantumCustomStore.getState();
  const customSymbols = customStore.getCustomSymbols(keyCode);
  const hiddenSymbols = customStore.getHiddenSymbols(keyCode);
  const variants = getVariants(keyCode);
  
  return getAllSymbolsForKey(
    keyCode,
    mapping.default,
    mapping.shift,
    variants,
    customSymbols,
    hiddenSymbols
  );
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useHUDStore = create<HUDState>((set, get) => ({
  // Initial state
  isOpen: false,
  activeSymbolKey: null,
  highlightedIndex: 0,
  activeMathFieldId: null,
  flashingKey: null,
  isEditMode: false,
  
  // Position state
  position: 'auto',
  customOffset: null,
  isDragging: false,
  cursorPosition: null,
  
  // Computed mode
  get mode(): HUDMode {
    const state = get();
    if (!state.isOpen) return 'closed';
    if (state.activeSymbolKey !== null) return 'symbol-selector';
    return 'standard';
  },
  
  // Actions
  openHUD: (mathFieldId: string) => {
    set({
      isOpen: true,
      activeSymbolKey: null,
      highlightedIndex: 0,
      activeMathFieldId: mathFieldId,
      flashingKey: null,
      isEditMode: false,
    });
  },
  
  closeHUD: () => {
    set({
      isOpen: false,
      activeSymbolKey: null,
      highlightedIndex: 0,
      activeMathFieldId: null,
      flashingKey: null,
      isEditMode: false,
      isDragging: false,
    });
  },
  
  openSymbolSelector: (keyCode: string) => {
    const state = get();
    if (!state.isOpen) return;
    
    const symbols = getSymbolsForKey(keyCode);
    if (symbols.length === 0) return;
    
    set({
      activeSymbolKey: keyCode,
      highlightedIndex: 0,
      isEditMode: false,
    });
  },
  
  closeSymbolSelector: () => {
    set({
      activeSymbolKey: null,
      highlightedIndex: 0,
      isEditMode: false,
    });
  },
  
  navigateSymbol: (direction: 'up' | 'down') => {
    const state = get();
    if (state.activeSymbolKey === null) return;
    
    const totalItems = state.getTotalItems();
    if (totalItems === 0) return;
    
    let newIndex = state.highlightedIndex;
    if (direction === 'down') {
      newIndex = (newIndex + 1) % totalItems;
    } else {
      newIndex = (newIndex - 1 + totalItems) % totalItems;
    }
    
    set({ highlightedIndex: newIndex });
  },
  
  selectSymbol: () => {
    const state = get();
    if (state.activeSymbolKey === null) return null;
    
    const symbols = getSymbolsForKey(state.activeSymbolKey);
    if (state.highlightedIndex >= symbols.length) {
      return null;
    }
    
    return symbols[state.highlightedIndex] ?? null;
  },
  
  flashKey: (key: string) => {
    set({ flashingKey: key });
    setTimeout(() => {
      const currentState = get();
      if (currentState.flashingKey === key) {
        set({ flashingKey: null });
      }
    }, 200);
  },
  
  clearFlash: () => {
    set({ flashingKey: null });
  },
  
  setEditMode: (editMode: boolean) => {
    set({ isEditMode: editMode });
  },
  
  toggleEditMode: () => {
    set((state) => ({ isEditMode: !state.isEditMode }));
  },
  
  // Position actions
  setPosition: (position: HUDPosition) => {
    set({ position, customOffset: null });
  },
  
  setCustomOffset: (offset: HUDCoordinates | null) => {
    set({ customOffset: offset });
  },
  
  setIsDragging: (isDragging: boolean) => {
    set({ isDragging });
  },
  
  updateCursorPosition: (rect: DOMRect | null) => {
    if (!rect) {
      set({ cursorPosition: null });
      return;
    }
    
    // Convert DOMRect to serializable object
    set({
      cursorPosition: {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        centerY: rect.top + rect.height / 2,
      },
    });
  },
  
  resetPosition: () => {
    set({ position: 'auto', customOffset: null });
  },
  
  // Utility methods
  getCurrentSymbols: () => {
    const state = get();
    if (state.activeSymbolKey === null) return [];
    return getSymbolsForKey(state.activeSymbolKey);
  },
  
  getHighlightedSymbol: () => {
    const state = get();
    if (state.activeSymbolKey === null) return null;
    
    const symbols = getSymbolsForKey(state.activeSymbolKey);
    if (state.highlightedIndex >= symbols.length) return null;
    
    return symbols[state.highlightedIndex] ?? null;
  },
  
  getTotalItems: () => {
    const state = get();
    if (state.activeSymbolKey === null) return 0;
    const symbols = getSymbolsForKey(state.activeSymbolKey);
    return symbols.length + 2;
  },
  
  /**
   * Compute optimal position based on cursor location
   * Returns 'top' if keyboard should appear above cursor, 'bottom' otherwise
   * 
   * Decision logic (Bug 5 fix - ensure keyboard never blocks formula):
   * 1. If user has set a fixed position (not 'auto'), use it
   * 2. If user has dragged to a custom offset, maintain current position
   * 3. Calculate if keyboard would overlap with the math field
   * 4. If cursor is in bottom half of screen -> show on top
   * 5. If not enough space below cursor -> show on top (if space above)
   * 6. Default to bottom
   */
  computeOptimalPosition: () => {
    const state = get();
    
    // If user has set a fixed position, use it
    if (state.position !== 'auto') {
      return state.position;
    }
    
    // If user has dragged to a custom position, don't auto-switch
    // This prevents jarring position changes while user is adjusting
    if (state.customOffset && (Math.abs(state.customOffset.x) > 10 || Math.abs(state.customOffset.y) > 10)) {
      // Keep current position based on offset direction
      // If dragged upward (negative y), likely wants top; if downward, likely wants bottom
      // But we'll just maintain the last computed position by returning based on cursor
    }
    
    // If no cursor position, default to bottom
    if (!state.cursorPosition) {
      return 'bottom';
    }
    
    // Get viewport height (with SSR safety)
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
    
    const { top: cursorTop, bottom: cursorBottom, centerY } = state.cursorPosition;
    
    // Calculate available space above and below cursor
    const spaceAbove = cursorTop - VIEWPORT_PADDING;
    const spaceBelow = viewportHeight - cursorBottom - VIEWPORT_PADDING;
    
    // Calculate the threshold position (where cursor is considered "in bottom part")
    const thresholdY = viewportHeight * BOTTOM_THRESHOLD;
    
    // Check if keyboard would overlap with the math field when positioned at bottom
    // The keyboard is centered horizontally and positioned at bottom: 20px
    const keyboardBottomPosition = viewportHeight - 20; // bottom edge of keyboard
    const keyboardTopPosition = keyboardBottomPosition - HUD_HEIGHT; // top edge of keyboard
    
    // Would the keyboard overlap with the cursor/math field?
    const wouldOverlapAtBottom = cursorBottom > keyboardTopPosition - HUD_MARGIN;
    
    // Check if keyboard would overlap when positioned at top
    const keyboardTopAtTop = 20; // top edge when positioned at top
    const keyboardBottomAtTop = keyboardTopAtTop + HUD_HEIGHT; // bottom edge when at top
    const wouldOverlapAtTop = cursorTop < keyboardBottomAtTop + HUD_MARGIN;
    
    // Decision logic:
    // 1. If cursor center is below threshold -> show on top (if it won't overlap)
    // 2. If keyboard would overlap at bottom but not at top -> show on top
    // 3. If not enough space below but enough above -> show on top
    // 4. Otherwise -> show on bottom
    
    const cursorInBottomPart = centerY > thresholdY;
    const notEnoughSpaceBelow = spaceBelow < HUD_HEIGHT + HUD_MARGIN;
    const enoughSpaceAbove = spaceAbove >= HUD_HEIGHT + HUD_MARGIN;
    
    // Prefer position that doesn't overlap
    if (wouldOverlapAtBottom && !wouldOverlapAtTop) {
      return 'top';
    }
    
    if (!wouldOverlapAtBottom && wouldOverlapAtTop) {
      return 'bottom';
    }
    
    // If both would overlap or neither would, use traditional logic
    if (cursorInBottomPart || (notEnoughSpaceBelow && enoughSpaceAbove)) {
      return 'top';
    }
    
    return 'bottom';
  },
}));


// ============================================================================
// Selectors
// ============================================================================

export const selectIsOpen = (state: HUDState) => state.isOpen;
export const selectActiveSymbolKey = (state: HUDState) => state.activeSymbolKey;
export const selectHighlightedIndex = (state: HUDState) => state.highlightedIndex;
export const selectFlashingKey = (state: HUDState) => state.flashingKey;
export const selectActiveMathFieldId = (state: HUDState) => state.activeMathFieldId;
export const selectIsEditMode = (state: HUDState) => state.isEditMode;
export const selectPosition = (state: HUDState) => state.position;
export const selectCustomOffset = (state: HUDState) => state.customOffset;
export const selectIsDragging = (state: HUDState) => state.isDragging;
export const selectCursorPosition = (state: HUDState) => state.cursorPosition;

/**
 * Compute the current HUD mode from state
 */
export function computeMode(state: Pick<HUDState, 'isOpen' | 'activeSymbolKey'>): HUDMode {
  if (!state.isOpen) return 'closed';
  if (state.activeSymbolKey !== null) return 'symbol-selector';
  return 'standard';
}

/**
 * Check if state is internally consistent
 */
export function isStateConsistent(state: Pick<HUDState, 'isOpen' | 'activeSymbolKey' | 'highlightedIndex'>): boolean {
  if (state.activeSymbolKey !== null && !state.isOpen) {
    return false;
  }
  return true;
}
