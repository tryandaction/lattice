/**
 * Quantum Custom Store
 * Manages user-customized symbol mappings for the Quantum Keyboard
 * Persists to localStorage for cross-session retention
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createSafeJSONStorage } from '@/lib/persist-storage';

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
  updateCustomSymbol: (keyCode: string, symbol: string, replacement: string) => void;
  removeCustomSymbol: (keyCode: string, symbol: string) => void;
  hideDefaultSymbol: (keyCode: string, symbol: string) => void;
  unhideDefaultSymbol: (keyCode: string, symbol: string) => void;
  getCustomSymbols: (keyCode: string) => string[];
  getHiddenSymbols: (keyCode: string) => string[];
  resetKey: (keyCode: string) => void;
  resetAll: () => void;
}

function restoreSymbols(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.flatMap(symbol => typeof symbol === 'string' && symbol.trim() ? [symbol.trim()] : []))] : [];
}

function restoreMappings(value: unknown): Record<string, CustomKeyMapping> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, mapping]) => {
    if (!mapping || typeof mapping !== 'object') return [];
    const saved = mapping as Partial<CustomKeyMapping>;
    return [[key, { customSymbols: restoreSymbols(saved.customSymbols), hiddenSymbols: restoreSymbols(saved.hiddenSymbols) }]];
  }));
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useQuantumCustomStore = create<QuantumCustomState>()(
  persist(
    (set, get) => ({
      customMappings: {},
      
      addCustomSymbol: (keyCode: string, symbol: string) => {
        symbol = symbol.trim();
        if (!symbol) return;
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

      updateCustomSymbol: (keyCode, symbol, replacement) => {
        replacement = replacement.trim();
        if (!replacement || replacement === symbol) return;
        set(state => {
          const existing = state.customMappings[keyCode];
          if (!existing?.customSymbols.includes(symbol) || existing.customSymbols.includes(replacement)) return state;
          return { customMappings: { ...state.customMappings, [keyCode]: {
            ...existing, customSymbols: existing.customSymbols.map(value => value === symbol ? replacement : value),
          } } };
        });
      },
      
      hideDefaultSymbol: (keyCode: string, symbol: string) => {
        symbol = symbol.trim();
        if (!symbol) return;
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
      storage: createSafeJSONStorage<QuantumCustomState>(),
      partialize: state => ({ customMappings: state.customMappings }) as QuantumCustomState,
      merge: (value, current) => ({
        ...current,
        customMappings: restoreMappings((value as Partial<QuantumCustomState> | null)?.customMappings),
      }),
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
