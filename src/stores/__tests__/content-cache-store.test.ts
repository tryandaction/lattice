/**
 * Content Cache Store Tests
 * 
 * Tests for the content cache store that preserves unsaved changes
 * when switching between tabs.
 * 
 * Feature: editor-content-preservation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { useContentCacheStore } from '../content-cache-store';

describe('Content Cache Store', () => {
  beforeEach(() => {
    // Reset the store before each test
    useContentCacheStore.getState().clearCache();
  });

  describe('Unit Tests', () => {
    it('should store and retrieve content by tab ID', () => {
      const store = useContentCacheStore.getState();
      const tabId = 'tab-1';
      const content = 'Hello, World!';
      
      store.setContent(tabId, content, content);
      const cached = store.getContent(tabId);
      
      expect(cached).toBeDefined();
      expect(cached?.content).toBe(content);
      expect(cached?.originalContent).toBe(content);
      expect(cached?.isDirty).toBe(false);
    });

    it('should mark content as dirty when different from original', () => {
      const store = useContentCacheStore.getState();
      const tabId = 'tab-1';
      const originalContent = 'Original';
      const newContent = 'Modified';
      
      store.setContent(tabId, originalContent, originalContent);
      store.setContent(tabId, newContent);
      
      const cached = store.getContent(tabId);
      expect(cached?.isDirty).toBe(true);
      expect(cached?.content).toBe(newContent);
      expect(cached?.originalContent).toBe(originalContent);
    });

    it('should clear dirty state when markAsSaved is called', () => {
      const store = useContentCacheStore.getState();
      const tabId = 'tab-1';
      
      store.setContent(tabId, 'Original', 'Original');
      store.setContent(tabId, 'Modified');
      expect(store.hasUnsavedChanges(tabId)).toBe(true);
      
      store.markAsSaved(tabId, 'Modified');
      expect(store.hasUnsavedChanges(tabId)).toBe(false);
    });

    it('should discard changes and restore original content', () => {
      const store = useContentCacheStore.getState();
      const tabId = 'tab-1';
      const originalContent = 'Original';
      
      store.setContent(tabId, originalContent, originalContent);
      store.setContent(tabId, 'Modified');
      store.discardChanges(tabId);
      
      const cached = store.getContent(tabId);
      expect(cached?.content).toBe(originalContent);
      expect(cached?.isDirty).toBe(false);
    });

    it('should return all tabs with unsaved changes', () => {
      const store = useContentCacheStore.getState();
      
      store.setContent('tab-1', 'Content 1', 'Content 1');
      store.setContent('tab-2', 'Content 2', 'Original 2');
      store.setContent('tab-3', 'Content 3', 'Original 3');
      
      const unsaved = store.getUnsavedTabs();
      expect(unsaved).toContain('tab-2');
      expect(unsaved).toContain('tab-3');
      expect(unsaved).not.toContain('tab-1');
    });
  });

  describe('Property-Based Tests', () => {
    /**
     * Property 1: Content Cache Round-Trip
     * 
     * For any content string stored in the cache, retrieving it by the same
     * tab ID SHALL return the exact same content string.
     * 
     * Feature: editor-content-preservation, Property 1: Content Cache Round-Trip
     * Validates: Requirements 1.1, 1.2, 6.1
     */
    it('Property 1: Content stored should be retrievable unchanged', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 10000 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          (content, tabId) => {
            const store = useContentCacheStore.getState();
            store.clearCache();
            
            // Store content
            store.setContent(tabId, content, content);
            
            // Retrieve content
            const cached = store.getContent(tabId);
            
            // Verify round-trip
            return cached !== undefined && cached.content === content;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 2: Dirty State Consistency
     * 
     * For any cached content, the isDirty flag SHALL be true if and only if
     * the current content differs from the original content.
     * 
     * Feature: editor-content-preservation, Property 2: Dirty State Consistency
     * Validates: Requirements 1.3, 1.5
     */
    it('Property 2: isDirty should be true iff content differs from original', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 1000 }),
          fc.string({ minLength: 0, maxLength: 1000 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          (content, originalContent, tabId) => {
            const store = useContentCacheStore.getState();
            store.clearCache();
            
            // Store with original content
            store.setContent(tabId, content, originalContent);
            
            // Check dirty state
            const cached = store.getContent(tabId);
            const expectedDirty = content !== originalContent;
            
            return cached !== undefined && cached.isDirty === expectedDirty;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 3: Tab ID Isolation
     * 
     * For any two different tab IDs, setting content for one tab SHALL NOT
     * affect the content of the other tab.
     * 
     * Feature: editor-content-preservation, Property 3: Tab ID Isolation
     * Validates: Requirements 1.4
     */
    it('Property 3: Different tab IDs should have isolated content', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 1000 }),
          fc.string({ minLength: 0, maxLength: 1000 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          (content1, content2, tabId1, tabId2) => {
            // Ensure different tab IDs
            if (tabId1 === tabId2) return true;
            
            const store = useContentCacheStore.getState();
            store.clearCache();
            
            // Store content for both tabs
            store.setContent(tabId1, content1, content1);
            store.setContent(tabId2, content2, content2);
            
            // Verify isolation
            const cached1 = store.getContent(tabId1);
            const cached2 = store.getContent(tabId2);
            
            return (
              cached1 !== undefined &&
              cached2 !== undefined &&
              cached1.content === content1 &&
              cached2.content === content2
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: markAsSaved clears dirty state
     * 
     * After calling markAsSaved, the isDirty flag should be false.
     */
    it('Property: markAsSaved should clear dirty state', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 1000 }),
          fc.string({ minLength: 0, maxLength: 1000 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          (content, originalContent, tabId) => {
            const store = useContentCacheStore.getState();
            store.clearCache();
            
            // Store with different content to make it dirty
            store.setContent(tabId, content, originalContent);
            
            // Mark as saved
            store.markAsSaved(tabId, content);
            
            // Verify dirty state is cleared
            const cached = store.getContent(tabId);
            return cached !== undefined && cached.isDirty === false;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
