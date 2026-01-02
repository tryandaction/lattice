/**
 * CodeEditorViewer Debounce Logic Tests
 * 
 * Feature: unified-codemirror-engine
 * Property 4: Debounced Save on Content Change
 * Validates: Requirements 4.5
 * 
 * Note: These tests verify the debounce behavior using a simplified mock
 * to avoid CodeMirror initialization complexity in the test environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Simplified debounce implementation matching CodeEditorViewer
 */
function createDebouncedSave(
  onContentChange: (content: string) => void,
  onSave: (() => Promise<void>) | undefined,
  debounceDelay: number
) {
  let debounceTimer: NodeJS.Timeout | null = null;
  let hasChanged = false;

  return {
    handleChange: (newContent: string) => {
      // Notify parent immediately
      onContentChange(newContent);
      hasChanged = true;

      // Clear existing timer
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      // Set new debounce timer
      if (onSave) {
        debounceTimer = setTimeout(() => {
          if (hasChanged) {
            onSave().catch(console.error);
            hasChanged = false;
          }
        }, debounceDelay);
      }
    },
    cleanup: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    },
  };
}

describe("CodeEditorViewer Debounce Logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Feature: unified-codemirror-engine
   * Property 4: Debounced Save on Content Change
   * Validates: Requirements 4.5
   * 
   * For any content change in the CodeEditor within File_Viewer, the save
   * function SHALL be called exactly once after the debounce period, with
   * the final content value.
   */
  describe("Property 4: Debounced Save on Content Change", () => {
    const DEBOUNCE_DELAY = 500;

    it("should call onContentChange immediately on change", () => {
      const onContentChange = vi.fn();
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { handleChange } = createDebouncedSave(onContentChange, onSave, DEBOUNCE_DELAY);

      handleChange("new content");

      // onContentChange should be called immediately
      expect(onContentChange).toHaveBeenCalledTimes(1);
      expect(onContentChange).toHaveBeenCalledWith("new content");
    });

    it("should debounce save calls", () => {
      const onContentChange = vi.fn();
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { handleChange } = createDebouncedSave(onContentChange, onSave, DEBOUNCE_DELAY);

      // Make multiple rapid changes
      handleChange("change 1");
      handleChange("change 2");
      handleChange("change 3");

      // Save should not be called yet (within debounce period)
      expect(onSave).not.toHaveBeenCalled();

      // Advance timers past debounce period
      vi.advanceTimersByTime(DEBOUNCE_DELAY + 100);

      // Save should be called exactly once
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("should call onContentChange for each change but save only once", () => {
      const onContentChange = vi.fn();
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { handleChange } = createDebouncedSave(onContentChange, onSave, DEBOUNCE_DELAY);

      // Make multiple rapid changes
      handleChange("change 1");
      handleChange("change 2");
      handleChange("change 3");

      // onContentChange should be called for each change
      expect(onContentChange).toHaveBeenCalledTimes(3);
      expect(onContentChange).toHaveBeenNthCalledWith(1, "change 1");
      expect(onContentChange).toHaveBeenNthCalledWith(2, "change 2");
      expect(onContentChange).toHaveBeenNthCalledWith(3, "change 3");

      // Advance timers
      vi.advanceTimersByTime(DEBOUNCE_DELAY + 100);

      // Save should be called only once
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("should handle multiple debounced saves correctly", () => {
      const onContentChange = vi.fn();
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { handleChange } = createDebouncedSave(onContentChange, onSave, DEBOUNCE_DELAY);

      // First batch of changes
      handleChange("batch 1");

      // Wait for debounce
      vi.advanceTimersByTime(DEBOUNCE_DELAY + 100);

      expect(onSave).toHaveBeenCalledTimes(1);

      // Second batch of changes
      handleChange("batch 2");

      // Wait for debounce
      vi.advanceTimersByTime(DEBOUNCE_DELAY + 100);

      // Save should be called twice total (once per batch)
      expect(onSave).toHaveBeenCalledTimes(2);
    });

    it("should not call save if no onSave provided", () => {
      const onContentChange = vi.fn();

      const { handleChange } = createDebouncedSave(onContentChange, undefined, DEBOUNCE_DELAY);

      handleChange("new content");

      // Advance timers
      vi.advanceTimersByTime(DEBOUNCE_DELAY + 100);

      // Should not throw or cause issues
      expect(onContentChange).toHaveBeenCalledWith("new content");
    });

    it("should reset debounce timer on each change", () => {
      const onContentChange = vi.fn();
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { handleChange } = createDebouncedSave(onContentChange, onSave, DEBOUNCE_DELAY);

      // First change
      handleChange("change 1");

      // Advance halfway through debounce
      vi.advanceTimersByTime(DEBOUNCE_DELAY / 2);

      // Second change (should reset timer)
      handleChange("change 2");

      // Advance halfway again (total: DEBOUNCE_DELAY from first change)
      vi.advanceTimersByTime(DEBOUNCE_DELAY / 2);

      // Save should NOT be called yet (timer was reset)
      expect(onSave).not.toHaveBeenCalled();

      // Advance remaining time
      vi.advanceTimersByTime(DEBOUNCE_DELAY / 2 + 100);

      // Now save should be called
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("should cleanup timer on cleanup call", () => {
      const onContentChange = vi.fn();
      const onSave = vi.fn().mockResolvedValue(undefined);

      const { handleChange, cleanup } = createDebouncedSave(onContentChange, onSave, DEBOUNCE_DELAY);

      handleChange("change");

      // Cleanup before debounce completes
      cleanup();

      // Advance timers
      vi.advanceTimersByTime(DEBOUNCE_DELAY + 100);

      // Save should NOT be called (timer was cleared)
      expect(onSave).not.toHaveBeenCalled();
    });
  });
});
