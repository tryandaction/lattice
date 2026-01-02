/**
 * Tests for fast save utilities
 */

import { describe, it, expect, vi } from "vitest";
import { debounce, throttle, serializeNotebookFast } from "../fast-save";

describe("debounce", () => {
  it("should delay function execution", async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    
    debounced();
    expect(fn).not.toHaveBeenCalled();
    
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();
    
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
    
    vi.useRealTimers();
  });

  it("should reset timer on subsequent calls", async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    
    debounced();
    vi.advanceTimersByTime(50);
    debounced(); // Reset timer
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();
    
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
    
    vi.useRealTimers();
  });
});

describe("throttle", () => {
  it("should execute immediately on first call", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
    
    vi.useRealTimers();
  });

  it("should throttle subsequent calls", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    
    throttled();
    throttled();
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
    
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2); // Last queued call
    
    vi.useRealTimers();
  });
});

describe("serializeNotebookFast", () => {
  it("should serialize notebook correctly", () => {
    const state = {
      cells: [
        {
          cell_type: "code",
          source: "print('hello')",
          metadata: {},
          outputs: [],
          execution_count: 1,
        },
        {
          cell_type: "markdown",
          source: "# Title",
          metadata: {},
        },
      ],
      metadata: {
        kernelspec: {
          display_name: "Python 3",
          language: "python",
          name: "python3",
        },
      },
      nbformat: 4,
      nbformat_minor: 5,
    };
    
    const result = serializeNotebookFast(state);
    const parsed = JSON.parse(result);
    
    expect(parsed.cells).toHaveLength(2);
    expect(parsed.cells[0].cell_type).toBe("code");
    expect(parsed.cells[0].execution_count).toBe(1);
    expect(parsed.cells[1].cell_type).toBe("markdown");
    expect(parsed.nbformat).toBe(4);
  });

  it("should handle multi-line source", () => {
    const state = {
      cells: [
        {
          cell_type: "code",
          source: "line1\nline2\nline3",
          metadata: {},
          outputs: [],
          execution_count: null,
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    };
    
    const result = serializeNotebookFast(state);
    const parsed = JSON.parse(result);
    
    expect(parsed.cells[0].source).toEqual(["line1\n", "line2\n", "line3"]);
  });

  it("should handle empty source", () => {
    const state = {
      cells: [
        {
          cell_type: "code",
          source: "",
          metadata: {},
          outputs: [],
          execution_count: null,
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    };
    
    const result = serializeNotebookFast(state);
    const parsed = JSON.parse(result);
    
    expect(parsed.cells[0].source).toEqual([]);
  });
});
