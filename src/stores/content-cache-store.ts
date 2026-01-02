/**
 * Content Cache Store
 * 
 * Caches edited content for files to prevent data loss when switching tabs.
 * Content is stored by tab ID and persisted until explicitly saved or discarded.
 */

import { create } from "zustand";

interface CachedContent {
  content: string;
  originalContent: string;
  isDirty: boolean;
  lastModified: number;
}

interface ContentCacheState {
  // Map of tabId -> cached content
  cache: Map<string, CachedContent>;
  
  // Actions
  setContent: (tabId: string, content: string, originalContent?: string) => void;
  getContent: (tabId: string) => CachedContent | undefined;
  hasUnsavedChanges: (tabId: string) => boolean;
  markAsSaved: (tabId: string, newOriginalContent: string) => void;
  discardChanges: (tabId: string) => void;
  removeFromCache: (tabId: string) => void;
  clearCache: () => void;
  
  // Get all tabs with unsaved changes
  getUnsavedTabs: () => string[];
}

export const useContentCacheStore = create<ContentCacheState>((set, get) => ({
  cache: new Map(),

  setContent: (tabId, content, originalContent) => {
    set((state) => {
      const newCache = new Map(state.cache);
      const existing = newCache.get(tabId);
      
      const original = originalContent ?? existing?.originalContent ?? content;
      const isDirty = content !== original;
      
      newCache.set(tabId, {
        content,
        originalContent: original,
        isDirty,
        lastModified: Date.now(),
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
}));
