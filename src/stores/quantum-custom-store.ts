/**
 * Quantum Custom Store
 * Manages user-customized symbol mappings for the Quantum Keyboard
 * Persists to localStorage for cross-session retention
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================================================
// Types
// ============================================================================

export interface CustomKeyMapping {
  /** User-added symbols for this key */
  customSymbols: string[];
  /** Symbols that user has hidden/deleted from defaults */
  hiddenSymbols: string[];
}

export interface QuantumCustomState {
  /** Custom mappings per key code */
  customMappings: Record<string, CustomKeyMapping>;
  
  // Actions
  addCustomSymbol: (keyCode: string, symbol: string) => void;
  removeCustomSymbol: (keyCode: string, symbol: string) => void;
  hideDefaultSymbol: (keyCode: string, symbol: string) => void;
  unhideDefaultSymbol: (keyCode: string, symbol: string) => void;
  getCustomSymbols: (keyCode: string) => string[];
  getHiddenSymbols: (keyCode: string) => string[];
  resetKey: (keyCode: string) => void;
  resetAll: () => void;
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useQuantumCustomStore = create<QuantumCustomState>()(
  persist(
    (set, get) => ({
      customMappings: {},
      
      addCustomSymbol: (keyCode: string, symbol: string) => {
        set((state) => {
          const existing = state.customMappings[keyCode] || { customSymbols: [], hiddenSymbols: [] };
          // Don't add duplicates
          if (existing.customSymbols.includes(symbol)) return state;
          
          return {
            customMappings: {
              ...state.customMappings,
              [keyCode]: {
                ...existing,
                customSymbols: [...existing.customSymbols, symbol],
              },
            },
          };
        });
      },
      
      removeCustomSymbol: (keyCode: string, symbol: string) => {
        set((state) => {
          const existing = state.customMappings[keyCode];
          if (!existing) return state;
          
          return {
            customMappings: {
              ...state.customMappings,
              [keyCode]: {
                ...existing,
                customSymbols: existing.customSymbols.filter(s => s !== symbol),
              },
            },
          };
        });
      },
      
      hideDefaultSymbol: (keyCode: string, symbol: string) => {
        set((state) => {
          const existing = state.customMappings[keyCode] || { customSymbols: [], hiddenSymbols: [] };
          if (existing.hiddenSymbols.includes(symbol)) return state;
          
          return {
            customMappings: {
              ...state.customMappings,
              [keyCode]: {
                ...existing,
                hiddenSymbols: [...existing.hiddenSymbols, symbol],
              },
            },
          };
        });
      },
      
      unhideDefaultSymbol: (keyCode: string, symbol: string) => {
        set((state) => {
          const existing = state.customMappings[keyCode];
          if (!existing) return state;
          
          return {
            customMappings: {
              ...state.customMappings,
              [keyCode]: {
                ...existing,
                hiddenSymbols: existing.hiddenSymbols.filter(s => s !== symbol),
              },
            },
          };
        });
      },
      
      getCustomSymbols: (keyCode: string) => {
        return get().customMappings[keyCode]?.customSymbols || [];
      },
      
      getHiddenSymbols: (keyCode: string) => {
        return get().customMappings[keyCode]?.hiddenSymbols || [];
      },
      
      resetKey: (keyCode: string) => {
        set((state) => {
          const { [keyCode]: _, ...rest } = state.customMappings;
          return { customMappings: rest };
        });
      },
      
      resetAll: () => {
        set({ customMappings: {} });
      },
    }),
    {
      name: 'quantum-keyboard-custom',
    }
  )
);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all symbols for a key (default + shift + variants + custom - hidden)
 */
export function getAllSymbolsForKey(
  keyCode: string,
  defaultSymbol: string,
  shiftSymbol: string | undefined,
  variants: string[],
  customSymbols: string[],
  hiddenSymbols: string[]
): string[] {
  const allSymbols: string[] = [];
  
  // Add default symbol first (always shown, can't be hidden)
  allSymbols.push(defaultSymbol);
  
  // Add shift symbol if different from default and not hidden
  if (shiftSymbol && shiftSymbol !== defaultSymbol && !hiddenSymbols.includes(shiftSymbol)) {
    allSymbols.push(shiftSymbol);
  }
  
  // Add variants that aren't hidden
  for (const variant of variants) {
    if (!hiddenSymbols.includes(variant) && !allSymbols.includes(variant)) {
      allSymbols.push(variant);
    }
  }
  
  // Add custom symbols
  for (const custom of customSymbols) {
    if (!allSymbols.includes(custom)) {
      allSymbols.push(custom);
    }
  }
  
  return allSymbols;
}
