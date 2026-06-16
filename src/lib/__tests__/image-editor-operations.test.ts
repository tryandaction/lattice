import { describe, expect, it } from "vitest";
import {
  appendOperation,
  createEmptyEditHistory,
  flattenHistory,
  normalizeOperation,
  projectDimensions,
  redoOperation,
  resetOperations,
  undoOperation,
} from "../image-editor";

describe("image editor operations", () => {
  it("keeps pixel edits as serializable non-destructive operations", () => {
    const history = appendOperation(createEmptyEditHistory(), {
      type: "adjust",
      brightness: 2,
      contrast: -2,
      grayscale: false,
    });

    expect(flattenHistory(history)).toEqual([
      {
        type: "adjust",
        brightness: 2,
        contrast: -2,
        grayscale: false,
      },
    ]);

    expect(normalizeOperation(flattenHistory(history)[0])).toEqual({
      type: "adjust",
      brightness: 1,
      contrast: -1,
      grayscale: undefined,
      invert: undefined,
      exposure: undefined,
      saturation: undefined,
    });
  });

  it("supports undo, redo, and reset without mutating source dimensions", () => {
    const original = { width: 1200, height: 800 };
    const withCrop = appendOperation(createEmptyEditHistory(), {
      type: "crop",
      rect: { x: 10, y: 10, width: 50, height: 50 },
    });
    const withRotate = appendOperation(withCrop, { type: "rotate", degrees: 90 });

    expect(projectDimensions(original, flattenHistory(withRotate))).toEqual({
      width: 400,
      height: 600,
    });
    expect(original).toEqual({ width: 1200, height: 800 });

    const undone = undoOperation(withRotate);
    expect(projectDimensions(original, flattenHistory(undone))).toEqual({
      width: 600,
      height: 400,
    });

    const redone = redoOperation(undone);
    expect(projectDimensions(original, flattenHistory(redone))).toEqual({
      width: 400,
      height: 600,
    });

    expect(resetOperations()).toEqual(createEmptyEditHistory());
  });

  it("normalizes crop, rotate, and resize constraints", () => {
    expect(normalizeOperation({
      type: "crop",
      rect: { x: -10, y: 20, width: 120, height: 90 },
    })).toEqual({
      type: "crop",
      rect: { x: 0, y: 20, width: 100, height: 80 },
    });

    expect(normalizeOperation({ type: "rotate", degrees: 450 as 90 })).toEqual({
      type: "rotate",
      degrees: 90,
    });

    expect(normalizeOperation({ type: "resize", width: 100.4, height: 80.6 })).toEqual({
      type: "resize",
      width: 100,
      height: 81,
    });
  });
});
