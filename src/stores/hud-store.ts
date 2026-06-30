/**
 * HUD State Store
 * Manages the global state for the Quantum Keyboard HUD
 * 
 * Stable positioning:
 * - Opens near top or bottom center based on the last focus/click point
 * - Does not chase the caret while open
 * - Supports persisted user drag customization
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

export interface HUDSize {
  width: number;
  height: number;
}

/** Simplified cursor position info (serializable) */
export interface CursorPosition {
  top: number;
  bottom: number;
  left: number;
  right: number;
  centerX: number;
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
  hudSize: HUDSize;
  
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
  updateHUDSize: (size: HUDSize) => void;
  resetPosition: () => void;
  
  // Utility
  getCurrentSymbols: () => string[];
  getHighlightedSymbol: () => string | null;
  getTotalItems: () => number;
  computeOptimalPosition: () => SafeHUDPosition;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_HUD_SIZE: HUDSize = { width: 500, height: 178 };
const HUD_MAX_WIDTH = 500;
const HUD_MIN_WIDTH = 320;
const HUD_MARGIN = 8;
const VIEWPORT_PADDING = 12;
const POSITION_STORAGE_KEY = 'lattice-quantum-keyboard-position';

export interface HUDViewport {
  width: number;
  height: number;
}

export interface SafeHUDPosition {
  side: 'top' | 'bottom';
  topPx: number;
  leftPx: number;
  widthPx: number;
  heightPx: number;
  maxHeightPx: number;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(value, max));
}

export function getSafeHUDWidth(viewportWidth: number): number {
  const available = Math.max(HUD_MIN_WIDTH, viewportWidth - VIEWPORT_PADDING * 2);
  return Math.min(HUD_MAX_WIDTH, available, DEFAULT_HUD_SIZE.width);
}

export function computeSafeHUDPosition({
  cursorPosition,
  hudSize,
  viewport,
  position,
}: {
  cursorPosition: CursorPosition | null;
  hudSize: HUDSize;
  viewport: HUDViewport;
  position: HUDPosition;
}): SafeHUDPosition {
  const widthPx = getSafeHUDWidth(viewport.width);
  const maxHeightPx = Math.max(DEFAULT_HUD_SIZE.height, viewport.height - VIEWPORT_PADDING * 2);
  const heightPx = Math.min(Math.max(40, hudSize.height || DEFAULT_HUD_SIZE.height), maxHeightPx);
  const clampTop = (top: number) => clamp(top, VIEWPORT_PADDING, viewport.height - heightPx - VIEWPORT_PADDING);
  const clampLeft = (left: number) => clamp(left, VIEWPORT_PADDING, viewport.width - widthPx - VIEWPORT_PADDING);
  const centerLeft = clampLeft((viewport.width - widthPx) / 2);
  const topDock = VIEWPORT_PADDING;
  const bottomDock = viewport.height - heightPx - VIEWPORT_PADDING;

  if (!cursorPosition) {
    const fallbackTop = position === 'top' ? topDock : bottomDock;
    return {
      side: position === 'top' ? 'top' : 'bottom',
      topPx: clampTop(fallbackTop),
      leftPx: centerLeft,
      widthPx,
      heightPx,
      maxHeightPx,
    };
  }

  if (position === 'top') {
    return {
      side: 'top',
      topPx: clampTop(topDock),
      leftPx: centerLeft,
      widthPx,
      heightPx,
      maxHeightPx,
    };
  }

  if (position === 'bottom') {
    return {
      side: 'bottom',
      topPx: clampTop(bottomDock),
      leftPx: centerLeft,
      widthPx,
      heightPx,
      maxHeightPx,
    };
  }

  const topDockBottom = topDock + heightPx;
  const wouldCoverCursorFromTop = cursorPosition.top < topDockBottom + VIEWPORT_PADDING * 2;
  const side = wouldCoverCursorFromTop ? 'bottom' : 'top';
  return {
    side,
    topPx: clampTop(side === 'top' ? topDock : bottomDock),
    leftPx: centerLeft,
    widthPx,
    heightPx,
    maxHeightPx,
  };
}

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
  
  // Position state
  position: 'auto',
  customOffset: loadSavedPosition(),  // Load saved position on init
  isDragging: false,
  cursorPosition: null,
  hudSize: DEFAULT_HUD_SIZE,
  
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
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
      },
    });
  },

  updateHUDSize: (size: HUDSize) => {
    const nextWidth = Number.isFinite(size.width) && size.width > 0 ? size.width : DEFAULT_HUD_SIZE.width;
    const nextHeight = Number.isFinite(size.height) && size.height > 0 ? size.height : DEFAULT_HUD_SIZE.height;
    set({
      hudSize: {
        width: nextWidth,
        height: nextHeight,
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
   * Compute a stable top/bottom dock. It intentionally does not follow the caret
   * after the keyboard is open; user drag controls the custom final position.
   */
  computeOptimalPosition: () => {
    const state = get();
    return computeSafeHUDPosition({
      cursorPosition: state.cursorPosition,
      hudSize: state.hudSize,
      viewport: {
        width: typeof window !== 'undefined' ? window.innerWidth : 1024,
        height: typeof window !== 'undefined' ? window.innerHeight : 800,
      },
      position: state.position,
    });
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
