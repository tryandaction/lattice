/**
 * Mode Persistence Service
 * Persists view mode preferences per file
 * 
 * Requirements: 20.7
 */

import type { ViewMode } from './types';

const STORAGE_KEY = 'lattice-editor-mode-prefs';
const MAX_ENTRIES = 100; // Limit stored entries to prevent storage bloat

interface ModePreferences {
  [fileId: string]: {
    mode: ViewMode;
    timestamp: number;
  };
}

/**
 * Get stored mode preferences
 */
function getPreferences(): ModePreferences {
  if (typeof window === 'undefined') return {};
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    return JSON.parse(stored);
  } catch {
    return {};
  }
}

/**
 * Save mode preferences
 */
function savePreferences(prefs: ModePreferences): void {
  if (typeof window === 'undefined') return;
  
  try {
    // Prune old entries if too many
    const entries = Object.entries(prefs);
    if (entries.length > MAX_ENTRIES) {
      // Sort by timestamp and keep most recent
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      const pruned = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    }
  } catch {
    // Storage might be full or disabled
    console.warn('Failed to save mode preferences');
  }
}

/**
 * Get the saved mode for a file
 */
export function getSavedMode(fileId: string): ViewMode | null {
  const prefs = getPreferences();
  const pref = prefs[fileId];
  return pref?.mode ?? null;
}

/**
 * Save the mode for a file
 */
export function saveMode(fileId: string, mode: ViewMode): void {
  const prefs = getPreferences();
  prefs[fileId] = {
    mode,
    timestamp: Date.now(),
  };
  savePreferences(prefs);
}

/**
 * Clear saved mode for a file
 */
export function clearSavedMode(fileId: string): void {
  const prefs = getPreferences();
  delete prefs[fileId];
  savePreferences(prefs);
}

/**
 * Clear all saved mode preferences
 */
export function clearAllModePreferences(): void {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore errors
  }
}

/**
 * React hook for mode persistence
 */
export function useModePreference(
  fileId: string | undefined,
  defaultMode: ViewMode = 'live'
): [ViewMode, (mode: ViewMode) => void] {
  // This is a simple implementation - in a real app you'd use useState/useEffect
  // For now, just provide the functions
  const getMode = (): ViewMode => {
    if (!fileId) return defaultMode;
    return getSavedMode(fileId) ?? defaultMode;
  };
  
  const setMode = (mode: ViewMode): void => {
    if (fileId) {
      saveMode(fileId, mode);
    }
  };
  
  return [getMode(), setMode];
}
