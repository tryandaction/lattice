import type { ImageEditOperation } from "./types";

export interface ImageEditPreviewState {
  crop: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  } | null;
  rotation: 0 | 90 | 180 | 270;
  flipX: boolean;
  flipY: boolean;
  brightness: number;
  contrast: number;
}

export function buildEditPreviewState(operations: ImageEditOperation[]): ImageEditPreviewState {
  return operations.reduce<ImageEditPreviewState>(
    (preview, operation) => {
      if (operation.type === "crop") {
        return {
          ...preview,
          crop: {
            top: operation.rect.y,
            right: 100 - operation.rect.x - operation.rect.width,
            bottom: 100 - operation.rect.y - operation.rect.height,
            left: operation.rect.x,
          },
        };
      }
      if (operation.type === "rotate") {
        return {
          ...preview,
          rotation: ((preview.rotation + operation.degrees) % 360) as ImageEditPreviewState["rotation"],
        };
      }
      if (operation.type === "flip") {
        return operation.axis === "horizontal"
          ? { ...preview, flipX: !preview.flipX }
          : { ...preview, flipY: !preview.flipY };
      }
      if (operation.type === "adjust") {
        return {
          ...preview,
          brightness: operation.brightness ?? preview.brightness,
          contrast: operation.contrast ?? preview.contrast,
        };
      }
      return preview;
    },
    {
      crop: null,
      rotation: 0,
      flipX: false,
      flipY: false,
      brightness: 0,
      contrast: 0,
    },
  );
}

export function buildExportOperationsFromPreview(preview: ImageEditPreviewState): ImageEditOperation[] {
  const operations: ImageEditOperation[] = [];
  if (preview.crop) {
    operations.push({
      type: "crop",
      rect: {
        x: preview.crop.left,
        y: preview.crop.top,
        width: Math.max(1, 100 - preview.crop.left - preview.crop.right),
        height: Math.max(1, 100 - preview.crop.top - preview.crop.bottom),
      },
    });
  }
  if (preview.rotation !== 0) {
    operations.push({ type: "rotate", degrees: preview.rotation });
  }
  if (preview.flipX) {
    operations.push({ type: "flip", axis: "horizontal" });
  }
  if (preview.flipY) {
    operations.push({ type: "flip", axis: "vertical" });
  }
  if (preview.brightness !== 0 || preview.contrast !== 0) {
    operations.push({
      type: "adjust",
      brightness: preview.brightness,
      contrast: preview.contrast,
    });
  }
  return operations;
}
