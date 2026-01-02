/**
 * Property Tests for Editor Content Stability
 * 
 * Tests that verify content is preserved correctly during:
 * - Tab switching
 * - Rapid content updates
 * - Cache round-trips
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { useContentCacheStore } from "../../stores/content-cache-store";

describe("Editor Content Stability", () => {
  beforeEach(() => {
    // Reset store before each test
    useContentCacheStore.getState().clearCache();
  });

  /**
   * Property 1: Content should survive tab switching round-trip
   * 
   * For any content stored in cache:
   * - Switching away and back should preserve the content exactly
   */
  it("should preserve content through tab switching simulation", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 5000 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (content, tabId) => {
          const store = useContentCacheStore.getState();
          
          // Simulate opening a tab and editing content
          store.setContent(tabId, content, "original");
          
          // Simulate switching away (content stays in cache)
          // ... other operations ...
          
          // Simulate switching back - retrieve from cache
          const cached = store.getContent(tabId);
          
          // Content should be preserved exactly
          expect(cached?.content).toBe(content);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Rapid content updates should not lose data
   * 
   * Multiple rapid updates to the same tab should result in
   * the final content being preserved.
   */
  it("should handle rapid content updates without data loss", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 1000 }), { minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (contentUpdates, tabId) => {
          const store = useContentCacheStore.getState();
          
          // Simulate rapid content updates
          for (const content of contentUpdates) {
            store.setContent(tabId, content, "original");
          }
          
          // Final content should be the last update
          const cached = store.getContent(tabId);
          const lastContent = contentUpdates[contentUpdates.length - 1];
          
          expect(cached?.content).toBe(lastContent);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Multiple tabs should maintain independent content
   * 
   * Content in one tab should not affect content in another tab.
   */
  it("should maintain independent content across multiple tabs", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            tabId: fc.string({ minLength: 1, maxLength: 20 }),
            content: fc.string({ minLength: 0, maxLength: 1000 }),
          }),
          { minLength: 2, maxLength: 10 }
        ),
        (tabContents) => {
          const store = useContentCacheStore.getState();
          
          // Ensure unique tab IDs
          const uniqueTabs = new Map<string, string>();
          for (const { tabId, content } of tabContents) {
            uniqueTabs.set(tabId, content);
          }
          
          // Set content for all tabs
          for (const [tabId, content] of uniqueTabs) {
            store.setContent(tabId, content, "original");
          }
          
          // Verify each tab has its own content
          for (const [tabId, expectedContent] of uniqueTabs) {
            const cached = store.getContent(tabId);
            expect(cached?.content).toBe(expectedContent);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4: Dirty state should be correctly tracked
   * 
   * Content different from original should be marked as dirty.
   */
  it("should correctly track dirty state", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 1000 }),
        fc.string({ minLength: 0, maxLength: 1000 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (originalContent, newContent, tabId) => {
          const store = useContentCacheStore.getState();
          
          // Set content with original
          store.setContent(tabId, newContent, originalContent);
          
          // Check dirty state
          const isDirty = store.hasUnsavedChanges(tabId);
          const shouldBeDirty = newContent !== originalContent;
          
          expect(isDirty).toBe(shouldBeDirty);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5: markAsSaved should clear dirty state
   * 
   * After marking as saved, content should no longer be dirty.
   */
  it("should clear dirty state after markAsSaved", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 1000 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (content, tabId) => {
          const store = useContentCacheStore.getState();
          
          // Set content as dirty
          store.setContent(tabId, content, "different-original");
          
          // Mark as saved
          store.markAsSaved(tabId, content);
          
          // Should no longer be dirty
          expect(store.hasUnsavedChanges(tabId)).toBe(false);
          
          // Original content should now match current content
          const cached = store.getContent(tabId);
          expect(cached?.originalContent).toBe(content);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6: Content with special characters should be preserved
   * 
   * Unicode, newlines, and special characters should survive round-trips.
   */
  it("should preserve content with special characters", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        (tabId) => {
          const store = useContentCacheStore.getState();
          
          // Test various special content
          const specialContents = [
            "Hello\nWorld\n\n",
            "Unicode: 你好世界 🎉 αβγ",
            "Math: $E = mc^2$ and $$\\int_0^1 x dx$$",
            "Code: ```js\nconst x = 1;\n```",
            "Tabs:\t\tindented",
            "Mixed: <div>HTML</div> & entities",
            "Empty lines:\n\n\n\nend",
          ];
          
          for (const content of specialContents) {
            store.setContent(tabId, content, content);
            const cached = store.getContent(tabId);
            expect(cached?.content).toBe(content);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
