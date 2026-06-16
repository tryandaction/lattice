import {
  clamp,
  percentageRectToAbsolute,
  type AbsoluteRect,
} from "@/lib/coordinate-transforms";
import type {
  AdjustOperation,
  CropOperation,
  FlipOperation,
  ImageDimensions,
  ImageEditHistory,
  ImageEditOperation,
  ResizeOperation,
  RotateOperation,
} from "./types";

export function createEmptyEditHistory(): ImageEditHistory {
  return {
    past: [],
    present: [],
    future: [],
  };
}

export function appendOperation(history: ImageEditHistory, operation: ImageEditOperation): ImageEditHistory {
  return {
    past: [...history.past, ...history.present],
    present: [operation],
    future: [],
  };
}

export function undoOperation(history: ImageEditHistory): ImageEditHistory {
  if (history.present.length === 0 && history.past.length === 0) {
    return history;
  }

  const previous = history.past[history.past.length - 1];
  if (!previous) {
    return {
      past: [],
      present: [],
      future: [...history.present, ...history.future],
    };
  }

  return {
    past: history.past.slice(0, -1),
    present: [previous],
    future: [...history.present, ...history.future],
  };
}

export function redoOperation(history: ImageEditHistory): ImageEditHistory {
  const next = history.future[0];
  if (!next) {
    return history;
  }

  return {
    past: [...history.past, ...history.present],
    present: [next],
    future: history.future.slice(1),
  };
}

export function resetOperations(): ImageEditHistory {
  return createEmptyEditHistory();
}

export function flattenHistory(history: ImageEditHistory): ImageEditOperation[] {
  return [...history.past, ...history.present];
}

export function normalizeCropOperation(operation: CropOperation): CropOperation {
  const x = clamp(operation.rect.x, 0, 100);
  const y = clamp(operation.rect.y, 0, 100);

  return {
    type: "crop",
    rect: {
      x,
      y,
      width: clamp(operation.rect.width, 0, 100 - x),
      height: clamp(operation.rect.height, 0, 100 - y),
    },
  };
}

export function normalizeRotateOperation(operation: RotateOperation): RotateOperation {
  const normalized = ((operation.degrees % 360) + 360) % 360;
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) {
    return { type: "rotate", degrees: normalized };
  }
  throw new Error("Rotate operation must use 0, 90, 180, or 270 degrees");
}

export function normalizeFlipOperation(operation: FlipOperation): FlipOperation {
  if (operation.axis !== "horizontal" && operation.axis !== "vertical") {
    throw new Error("Flip operation axis must be horizontal or vertical");
  }
  return operation;
}

export function normalizeResizeOperation(operation: ResizeOperation): ResizeOperation {
  if (operation.width <= 0 || operation.height <= 0) {
    throw new Error("Resize dimensions must be positive");
  }
  return {
    type: "resize",
    width: Math.round(operation.width),
    height: Math.round(operation.height),
  };
}

export function normalizeAdjustOperation(operation: AdjustOperation): AdjustOperation {
  return {
    type: "adjust",
    brightness: operation.brightness === undefined ? undefined : clamp(operation.brightness, -1, 1),
    contrast: operation.contrast === undefined ? undefined : clamp(operation.contrast, -1, 1),
    exposure: operation.exposure === undefined ? undefined : clamp(operation.exposure, -5, 5),
    saturation: operation.saturation === undefined ? undefined : clamp(operation.saturation, -1, 1),
    grayscale: operation.grayscale || undefined,
    invert: operation.invert || undefined,
  };
}

export function normalizeOperation(operation: ImageEditOperation): ImageEditOperation {
  switch (operation.type) {
    case "crop":
      return normalizeCropOperation(operation);
    case "rotate":
      return normalizeRotateOperation(operation);
    case "flip":
      return normalizeFlipOperation(operation);
    case "resize":
      return normalizeResizeOperation(operation);
    case "adjust":
      return normalizeAdjustOperation(operation);
  }
}

export function getCropRectInPixels(operation: CropOperation, dimensions: ImageDimensions): AbsoluteRect {
  return percentageRectToAbsolute(normalizeCropOperation(operation).rect, dimensions.width, dimensions.height);
}

export function projectDimensions(dimensions: ImageDimensions, operations: ImageEditOperation[]): ImageDimensions {
  return operations.reduce<ImageDimensions>((current, operation) => {
    const normalized = normalizeOperation(operation);

    switch (normalized.type) {
      case "crop": {
        const rect = getCropRectInPixels(normalized, current);
        return {
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        };
      }
      case "rotate":
        return normalized.degrees === 90 || normalized.degrees === 270
          ? { width: current.height, height: current.width }
          : current;
      case "resize":
        return {
          width: normalized.width,
          height: normalized.height,
        };
      case "flip":
      case "adjust":
        return current;
    }
  }, dimensions);
}
