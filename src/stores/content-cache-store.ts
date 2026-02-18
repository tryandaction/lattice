/**
 * Content Cache Store
 *
 * Caches edited content for files to prevent data loss when switching tabs.
 * Content is stored by tab ID and persisted until explicitly saved or discarded.
 *
 * CRITICAL: Includes switch locking mechanism to prevent race conditions
 * when rapidly switching between tabs.
 */

import { create } from "zustand";

/**
 * Editor state to preserve when switching tabs
 */
interface EditorState {
  cursorPosition: number;
  scrollTop: number;
  selection?: { from: number; to: number };
}

interface CachedContent {
  content: string | ArrayBuffer;
  originalContent: string | ArrayBuffer;
  isDirty: boolean;
  lastModified: number;
  editorState?: EditorState;
}

interface ContentCacheState {
  // Map of tabId -> cached content
  cache: Map<string, CachedContent>;

  // Switch lock to prevent race conditions
  switchingLock: boolean;
  currentSwitchId: string | null;

  // Actions
  setContent: (tabId: string, content: string | ArrayBuffer, originalContent?: string | ArrayBuffer) => void;
  getContent: (tabId: string) => CachedContent | undefined;
  hasUnsavedChanges: (tabId: string) => boolean;
  markAsSaved: (tabId: string, newOriginalContent: string | ArrayBuffer) => void;
  discardChanges: (tabId: string) => void;
  removeFromCache: (tabId: string) => void;
  clearCache: () => void;

  // Get all tabs with unsaved changes
  getUnsavedTabs: () => string[];

  // Editor state management
  saveEditorState: (tabId: string, editorState: EditorState) => void;
  getEditorState: (tabId: string) => EditorState | undefined;

  // Switch lock management
  acquireSwitchLock: (switchId: string) => boolean;
  releaseSwitchLock: (switchId: string) => void;
  isSwitchLocked: () => boolean;
}

export const useContentCacheStore = create<ContentCacheState>((set, get) => ({
  cache: new Map(),
  switchingLock: false,
  currentSwitchId: null,

  setContent: (tabId, content, originalContent) => {
    set((state) => {
      const newCache = new Map(state.cache);
      const existing = newCache.get(tabId);

      const original = originalContent ?? existing?.originalContent ?? content;
      // Binary content (ArrayBuffer) is not editable, so never dirty
      const isDirty = content instanceof ArrayBuffer ? false : content !== original;

      newCache.set(tabId, {
        content,
        originalContent: original,
        isDirty,
        lastModified: Date.now(),
        editorState: existing?.editorState,
      });

      return { cache: newCache };
    });
  },

  getContent: (tabId) => {
    return get().cache.get(tabId);
  },

  hasUnsavedChanges: (tabId) => {
    const cached = get().cache.get(tabId);
    return cached?.isDirty ?? false;
  },

  markAsSaved: (tabId, newOriginalContent) => {
    set((state) => {
      const newCache = new Map(state.cache);
      const existing = newCache.get(tabId);

      if (existing) {
        newCache.set(tabId, {
          ...existing,
          originalContent: newOriginalContent,
          isDirty: false,
        });
      }

      return { cache: newCache };
    });
  },

  discardChanges: (tabId) => {
    set((state) => {
      const newCache = new Map(state.cache);
      const existing = newCache.get(tabId);

      if (existing) {
        newCache.set(tabId, {
          ...existing,
          content: existing.originalContent,
          isDirty: false,
        });
      }

      return { cache: newCache };
    });
  },

  removeFromCache: (tabId) => {
    set((state) => {
      const newCache = new Map(state.cache);
      newCache.delete(tabId);
      return { cache: newCache };
    });
  },

  clearCache: () => {
    set({ cache: new Map() });
  },

  getUnsavedTabs: () => {
    const cache = get().cache;
    const unsaved: string[] = [];
    cache.forEach((value, key) => {
      if (value.isDirty) {
        unsaved.push(key);
      }
    });
    return unsaved;
  },

  // Editor state management
  saveEditorState: (tabId, editorState) => {
    set((state) => {
      const newCache = new Map(state.cache);
      const existing = newCache.get(tabId);

      if (existing) {
        newCache.set(tabId, {
          ...existing,
          editorState,
        });
      } else {
        // Create a placeholder entry for editor state
        newCache.set(tabId, {
          content: '',
          originalContent: '',
          isDirty: false,
          lastModified: Date.now(),
          editorState,
        });
      }

      return { cache: newCache };
    });
  },

  getEditorState: (tabId) => {
    return get().cache.get(tabId)?.editorState;
  },

  // Switch lock management to prevent race conditions
  acquireSwitchLock: (switchId) => {
    const state = get();
    if (state.switchingLock) {
      // Lock already held by another switch operation
      return false;
    }
    set({ switchingLock: true, currentSwitchId: switchId });
    return true;
  },

  releaseSwitchLock: (switchId) => {
    const state = get();
    // Only release if we hold the lock
    if (state.currentSwitchId === switchId) {
      set({ switchingLock: false, currentSwitchId: null });
    }
  },

  isSwitchLocked: () => {
    return get().switchingLock;
  },
}));
