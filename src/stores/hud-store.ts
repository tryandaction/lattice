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
export type InsertMode = 'inline' | 'block';
export type InsertFormat = 'markdown' | 'latex';

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
  insertMode: InsertMode;
  insertFormat: InsertFormat;
  
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
  setInsertMode: (mode: InsertMode) => void;
  toggleInsertMode: () => void;
  setInsertFormat: (format: InsertFormat) => void;
  toggleInsertFormat: () => void;
  
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
  computeOptimalPosition: () => { side: 'top' | 'bottom'; topPx: number };
}

// ============================================================================
// Constants
// ============================================================================

const HUD_HEIGHT = 320;
const _HUD_WIDTH = 480;
const HUD_MARGIN = 20;
const VIEWPORT_PADDING = 20;
const POSITION_STORAGE_KEY = 'lattice-quantum-keyboard-position';

// ============================================================================
// Position Persistence Helpers
// ============================================================================

function loadSavedPosition(): HUDCoordinates | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(POSITION_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return parsed;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

function savePosition(offset: HUDCoordinates | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (offset) {
      localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(offset));
    } else {
      localStorage.removeItem(POSITION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}


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
  insertMode: 'inline',
  insertFormat: 'markdown',
  
  // Position state
  position: 'auto',
  customOffset: loadSavedPosition(),  // Load saved position on init
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

  setInsertMode: (mode) => {
    set({ insertMode: mode });
  },

  toggleInsertMode: () => {
    set((state) => ({ insertMode: state.insertMode === 'inline' ? 'block' : 'inline' }));
  },

  setInsertFormat: (format) => {
    set({ insertFormat: format });
  },

  toggleInsertFormat: () => {
    set((state) => ({ insertFormat: state.insertFormat === 'markdown' ? 'latex' : 'markdown' }));
  },
  
  // Position actions
  setPosition: (position: HUDPosition) => {
    set({ position, customOffset: null });
  },
  
  setCustomOffset: (offset: HUDCoordinates | null) => {
    set({ customOffset: offset });
    // Persist position to localStorage for memory across sessions
    savePosition(offset);
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
    // Clear saved position
    savePosition(null);
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
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

    // Helper to clamp topPx within viewport
    const clampTop = (t: number) =>
      Math.max(VIEWPORT_PADDING, Math.min(t, viewportHeight - HUD_HEIGHT - VIEWPORT_PADDING));

    // No cursor info — fall back to fixed edges
    if (!state.cursorPosition) {
      if (state.position === 'top') return { side: 'top', topPx: clampTop(VIEWPORT_PADDING) };
      return { side: 'bottom', topPx: clampTop(viewportHeight - HUD_HEIGHT - VIEWPORT_PADDING) };
    }

    const { top: cursorTop, bottom: cursorBottom } = state.cursorPosition;

    // Preferred: place HUD just below the math-field
    const belowTop = cursorBottom + HUD_MARGIN;
    const aboveTop = cursorTop - HUD_HEIGHT - HUD_MARGIN;

    const fitsBelow = belowTop + HUD_HEIGHT + VIEWPORT_PADDING <= viewportHeight;
    const fitsAbove = aboveTop >= VIEWPORT_PADDING;

    // If user set a fixed side, honour it but still use computed pixel position
    if (state.position === 'top') {
      return { side: 'top', topPx: clampTop(fitsAbove ? aboveTop : VIEWPORT_PADDING) };
    }
    if (state.position === 'bottom') {
      return { side: 'bottom', topPx: clampTop(fitsBelow ? belowTop : viewportHeight - HUD_HEIGHT - VIEWPORT_PADDING) };
    }

    // Auto: prefer below, fall back to above, last resort centre
    if (fitsBelow) {
      return { side: 'bottom', topPx: clampTop(belowTop) };
    }
    if (fitsAbove) {
      return { side: 'top', topPx: clampTop(aboveTop) };
    }
    // Neither fits cleanly — centre vertically
    const centred = clampTop((viewportHeight - HUD_HEIGHT) / 2);
    return { side: 'bottom', topPx: centred };
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
