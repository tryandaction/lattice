import { describe, expect, it, vi } from "vitest";
import {
  applyPixelAdjustment,
  exportEditedImageBlob,
  renderEditedImageToCanvas,
  type CanvasFactory,
} from "../image-editor";

class MockCanvas {
  width = 1;
  height = 1;
  readonly context = new MockCanvasContext(this);

  getContext(type: string) {
    return type === "2d" ? this.context : null;
  }

  toBlob(callback: (blob: Blob | null) => void, mimeType?: string) {
    callback(new Blob(["mock"], { type: mimeType ?? "image/png" }));
  }
}

class MockCanvasContext {
  readonly drawImage = vi.fn();
  readonly translate = vi.fn();
  readonly rotate = vi.fn();
  readonly scale = vi.fn();
  readonly putImageData = vi.fn();

  constructor(private readonly canvas: MockCanvas) {}

  getImageData(_x: number, _y: number, width: number, height: number) {
    return {
      data: new Uint8ClampedArray(width * height * 4).fill(128),
      width,
      height,
    };
  }
}

function createMockCanvasFactory(): { factory: CanvasFactory; canvases: MockCanvas[] } {
  const canvases: MockCanvas[] = [];
  return {
    canvases,
    factory: {
      createCanvas(width, height) {
        const canvas = new MockCanvas();
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        canvases.push(canvas);
        return canvas as unknown as HTMLCanvasElement;
      },
    },
  };
}

describe("image editor canvas pipeline", () => {
  it("renders crop, rotate, flip, resize, and adjust operations through canvas", () => {
    const { factory, canvases } = createMockCanvasFactory();
    const source = { width: 100, height: 80 } as CanvasImageSource;

    const output = renderEditedImageToCanvas({
      source,
      sourceDimensions: { width: 100, height: 80 },
      operations: [
        { type: "crop", rect: { x: 10, y: 10, width: 50, height: 50 } },
        { type: "rotate", degrees: 90 },
        { type: "flip", axis: "horizontal" },
        { type: "resize", width: 30, height: 20 },
        { type: "adjust", brightness: 0.1, contrast: 0.2 },
      ],
      canvasFactory: factory,
    });

    expect(output.width).toBe(30);
    expect(output.height).toBe(20);
    expect(canvases.map((canvas) => [canvas.width, canvas.height])).toEqual([
      [100, 80],
      [50, 40],
      [40, 50],
      [40, 50],
      [30, 20],
    ]);
    expect(canvases[3].context.scale).toHaveBeenCalledWith(-1, 1);
    expect(canvases[4].context.putImageData).toHaveBeenCalled();
  });

  it("exports edited image blobs with requested mime type", async () => {
    const { factory } = createMockCanvasFactory();
    const blob = await exportEditedImageBlob({
      source: { width: 10, height: 10 } as CanvasImageSource,
      sourceDimensions: { width: 10, height: 10 },
      operations: [{ type: "resize", width: 5, height: 5 }],
      mimeType: "image/jpeg",
      quality: 0.9,
      canvasFactory: factory,
    });

    expect(blob.type).toBe("image/jpeg");
  });

  it("applies brightness, grayscale, invert, and saturation to pixel data", () => {
    const data = new Uint8ClampedArray([
      100, 150, 200, 255,
      20, 40, 60, 255,
    ]);
    const before = Array.from(data);

    applyPixelAdjustment(data, {
      type: "adjust",
      brightness: 0.1,
      contrast: 0,
      saturation: -0.5,
      grayscale: false,
      invert: false,
    });

    expect(Array.from(data.slice(0, 3))).not.toEqual(before.slice(0, 3));
    expect(data[3]).toBe(255);

    applyPixelAdjustment(data, {
      type: "adjust",
      grayscale: true,
      invert: true,
    });

    expect(data[0]).toBe(data[1]);
    expect(data[1]).toBe(data[2]);
  });
});
