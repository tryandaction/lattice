import type { AbsoluteRect } from "@/lib/coordinate-transforms";
import {
  getCropRectInPixels,
  normalizeAdjustOperation,
  normalizeOperation,
} from "./operations";
import type {
  AdjustOperation,
  ImageDimensions,
  ImageEditOperation,
} from "./types";

export interface CanvasFactory {
  createCanvas(width: number, height: number): HTMLCanvasElement;
}

export interface RenderEditedImageOptions {
  source: CanvasImageSource;
  sourceDimensions: ImageDimensions;
  operations: ImageEditOperation[];
  canvasFactory?: CanvasFactory;
}

export interface ExportEditedImageOptions extends RenderEditedImageOptions {
  mimeType?: "image/png" | "image/jpeg" | "image/webp";
  quality?: number;
}

export function createDomCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function renderEditedImageToCanvas(options: RenderEditedImageOptions): HTMLCanvasElement {
  const factory = options.canvasFactory ?? { createCanvas: createDomCanvas };
  let current = factory.createCanvas(options.sourceDimensions.width, options.sourceDimensions.height);
  const initialContext = get2dContext(current);
  initialContext.drawImage(options.source, 0, 0, current.width, current.height);

  for (const operation of options.operations) {
    const normalized = normalizeOperation(operation);

    switch (normalized.type) {
      case "crop":
        current = cropCanvas(current, getCropRectInPixels(normalized, {
          width: current.width,
          height: current.height,
        }), factory);
        break;
      case "rotate":
        current = rotateCanvas(current, normalized.degrees, factory);
        break;
      case "flip":
        current = flipCanvas(current, normalized.axis, factory);
        break;
      case "resize":
        current = resizeCanvas(current, normalized.width, normalized.height, factory);
        break;
      case "adjust":
        applyAdjustOperation(current, normalized);
        break;
    }
  }

  return current;
}

export async function exportEditedImageBlob(options: ExportEditedImageOptions): Promise<Blob> {
  const canvas = renderEditedImageToCanvas(options);
  return canvasToBlob(canvas, options.mimeType ?? "image/png", options.quality);
}

export async function decodeImageBlob(blob: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return bitmap;
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to decode image blob"));
    };
    image.src = url;
  });
}

export async function exportEditedBlobFromSourceBlob(input: {
  sourceBlob: Blob;
  operations: ImageEditOperation[];
  mimeType?: "image/png" | "image/jpeg" | "image/webp";
  quality?: number;
}): Promise<Blob> {
  const image = await decodeImageBlob(input.sourceBlob);
  return exportEditedImageBlob({
    source: image,
    sourceDimensions: {
      width: image.width,
      height: image.height,
    },
    operations: input.operations,
    mimeType: input.mimeType,
    quality: input.quality,
  });
}

export function applyAdjustOperation(canvas: HTMLCanvasElement, operation: AdjustOperation): void {
  const context = get2dContext(canvas);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  applyPixelAdjustment(imageData.data, normalizeAdjustOperation(operation));
  context.putImageData(imageData, 0, 0);
}

export function applyPixelAdjustment(data: Uint8ClampedArray, operation: AdjustOperation): Uint8ClampedArray {
  const brightness = operation.brightness ?? 0;
  const contrast = operation.contrast ?? 0;
  const exposure = operation.exposure ?? 0;
  const saturation = operation.saturation ?? 0;
  const exposureFactor = Math.pow(2, exposure);
  const contrastFactor = contrast === 1
    ? Number.POSITIVE_INFINITY
    : (1 + contrast) / (1 - contrast);
  const saturationFactor = 1 + saturation;

  for (let index = 0; index < data.length; index += 4) {
    let red = data[index];
    let green = data[index + 1];
    let blue = data[index + 2];

    red = adjustChannel(red, brightness, contrastFactor, exposureFactor);
    green = adjustChannel(green, brightness, contrastFactor, exposureFactor);
    blue = adjustChannel(blue, brightness, contrastFactor, exposureFactor);

    if (operation.grayscale) {
      const gray = luminance(red, green, blue);
      red = gray;
      green = gray;
      blue = gray;
    } else if (saturation !== 0) {
      const gray = luminance(red, green, blue);
      red = gray + (red - gray) * saturationFactor;
      green = gray + (green - gray) * saturationFactor;
      blue = gray + (blue - gray) * saturationFactor;
    }

    if (operation.invert) {
      red = 255 - red;
      green = 255 - green;
      blue = 255 - blue;
    }

    data[index] = clampByte(red);
    data[index + 1] = clampByte(green);
    data[index + 2] = clampByte(blue);
  }

  return data;
}

function cropCanvas(canvas: HTMLCanvasElement, rect: AbsoluteRect, factory: CanvasFactory): HTMLCanvasElement {
  const cropX = Math.max(0, Math.min(canvas.width - 1, Math.round(rect.x)));
  const cropY = Math.max(0, Math.min(canvas.height - 1, Math.round(rect.y)));
  const cropWidth = Math.max(1, Math.min(canvas.width - cropX, Math.round(rect.width)));
  const cropHeight = Math.max(1, Math.min(canvas.height - cropY, Math.round(rect.height)));
  const output = factory.createCanvas(cropWidth, cropHeight);
  get2dContext(output).drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return output;
}

function rotateCanvas(canvas: HTMLCanvasElement, degrees: 0 | 90 | 180 | 270, factory: CanvasFactory): HTMLCanvasElement {
  if (degrees === 0) {
    return canvas;
  }

  const swap = degrees === 90 || degrees === 270;
  const output = factory.createCanvas(swap ? canvas.height : canvas.width, swap ? canvas.width : canvas.height);
  const context = get2dContext(output);

  switch (degrees) {
    case 90:
      context.translate(output.width, 0);
      break;
    case 180:
      context.translate(output.width, output.height);
      break;
    case 270:
      context.translate(0, output.height);
      break;
  }

  context.rotate((degrees * Math.PI) / 180);
  context.drawImage(canvas, 0, 0);
  return output;
}

function flipCanvas(canvas: HTMLCanvasElement, axis: "horizontal" | "vertical", factory: CanvasFactory): HTMLCanvasElement {
  const output = factory.createCanvas(canvas.width, canvas.height);
  const context = get2dContext(output);

  if (axis === "horizontal") {
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
  } else {
    context.translate(0, canvas.height);
    context.scale(1, -1);
  }

  context.drawImage(canvas, 0, 0);
  return output;
}

function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number, factory: CanvasFactory): HTMLCanvasElement {
  const output = factory.createCanvas(width, height);
  get2dContext(output).drawImage(canvas, 0, 0, output.width, output.height);
  return output;
}

function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context is unavailable");
  }
  return context;
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to export image blob"));
        return;
      }
      resolve(blob);
    }, mimeType, quality);
  });
}

function adjustChannel(value: number, brightness: number, contrastFactor: number, exposureFactor: number): number {
  return ((value - 128) * contrastFactor + 128 + brightness * 255) * exposureFactor;
}

function luminance(red: number, green: number, blue: number): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
