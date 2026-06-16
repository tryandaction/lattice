import { describe, expect, it } from "vitest";
import {
  buildEditPreviewState,
  buildExportOperationsFromPreview,
  type ImageEditOperation,
} from "../image-editor";

describe("image editor preview", () => {
  it("normalizes repeated view edits into a compact preview state", () => {
    const operations: ImageEditOperation[] = [
      { type: "crop", rect: { x: 10, y: 5, width: 80, height: 70 } },
      { type: "rotate", degrees: 90 },
      { type: "rotate", degrees: 270 },
      { type: "flip", axis: "horizontal" },
      { type: "flip", axis: "horizontal" },
      { type: "flip", axis: "vertical" },
      { type: "adjust", brightness: 0.25, contrast: -0.2 },
    ];

    expect(buildEditPreviewState(operations)).toEqual({
      crop: {
        top: 5,
        right: 10,
        bottom: 25,
        left: 10,
      },
      rotation: 0,
      flipX: false,
      flipY: true,
      brightness: 0.25,
      contrast: -0.2,
    });
  });

  it("builds export operations from the same compact state used by the UI preview", () => {
    const preview = buildEditPreviewState([
      { type: "crop", rect: { x: 8, y: 6, width: 70, height: 60 } },
      { type: "rotate", degrees: 90 },
      { type: "rotate", degrees: 90 },
      { type: "flip", axis: "horizontal" },
      { type: "flip", axis: "vertical" },
      { type: "adjust", brightness: 0.1, contrast: 0.4 },
    ]);

    expect(buildExportOperationsFromPreview(preview)).toEqual([
      { type: "crop", rect: { x: 8, y: 6, width: 70, height: 60 } },
      { type: "rotate", degrees: 180 },
      { type: "flip", axis: "horizontal" },
      { type: "flip", axis: "vertical" },
      { type: "adjust", brightness: 0.1, contrast: 0.4 },
    ]);
  });

  it("omits no-op edits from export operations", () => {
    expect(buildExportOperationsFromPreview(buildEditPreviewState([
      { type: "rotate", degrees: 90 },
      { type: "rotate", degrees: 270 },
      { type: "flip", axis: "horizontal" },
      { type: "flip", axis: "horizontal" },
      { type: "adjust", brightness: 0, contrast: 0 },
    ]))).toEqual([]);
  });
});
