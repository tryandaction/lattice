import { describe, expect, it } from "vitest";
import {
  adjustPdfAnnotationAnchor,
  adjustPdfAnnotationAnchorFromPointer,
  resolvePdfAnnotationTextAnchor,
} from "../pdf-annotation-adjustment";
import type { PdfPageTextModel } from "../pdf-page-text-cache";
import type { PdfTarget } from "@/types/universal-annotation";

function createModel(): PdfPageTextModel {
  return {
    pageNumber: 1,
    viewportWidth: 640,
    viewportHeight: 960,
    textContent: { items: [], styles: {}, lang: null },
    items: [],
    segments: [
      {
        itemIndex: 0,
        text: "This phenomenon,",
        normalizedText: "This phenomenon,",
        hasEOL: false,
        pageTextStart: 0,
        pageTextEnd: 16,
      },
      {
        itemIndex: 1,
        text: "which we call algorithm aversion,",
        normalizedText: "which we call algorithm aversion,",
        hasEOL: false,
        pageTextStart: 17,
        pageTextEnd: 50,
      },
      {
        itemIndex: 2,
        text: "is costly,",
        normalizedText: "is costly,",
        hasEOL: false,
        pageTextStart: 51,
        pageTextEnd: 61,
      },
    ],
    itemRects: [
      { itemIndex: 0, left: 80, top: 120, width: 120, height: 24 },
      { itemIndex: 1, left: 208, top: 120, width: 250, height: 24 },
      { itemIndex: 2, left: 466, top: 120, width: 76, height: 24 },
    ],
    normalizedText: "This phenomenon, which we call algorithm aversion, is costly,",
  };
}

describe("pdf-annotation-adjustment", () => {
  it("resolves an existing text markup annotation back to normalized offsets", () => {
    const model = createModel();
    const target: PdfTarget = {
      type: "pdf",
      page: 1,
      rects: [
        { x1: 80 / 640, y1: 120 / 960, x2: 200 / 640, y2: 144 / 960 },
        { x1: 208 / 640, y1: 120 / 960, x2: 278 / 640, y2: 144 / 960 },
      ],
      textQuote: {
        exact: "phenomenon, which we",
        prefix: "This ",
        suffix: " call algorithm",
        source: "pdfjs-text-model",
        confidence: "exact",
      },
    };

    const anchor = resolvePdfAnnotationTextAnchor(model, target);

    expect(anchor).not.toBeNull();
    expect(anchor?.pageText.slice(anchor!.startOffset, anchor!.endOffset)).toBe("phenomenon, which we");
  });

  it("expands the annotation by dragging the right boundary", () => {
    const model = createModel();
    const target: PdfTarget = {
      type: "pdf",
      page: 1,
      rects: [
        { x1: 116 / 640, y1: 120 / 960, x2: 200 / 640, y2: 144 / 960 },
        { x1: 208 / 640, y1: 120 / 960, x2: 260 / 640, y2: 144 / 960 },
      ],
      textQuote: {
        exact: "phenomenon, which",
        prefix: "This ",
        suffix: " we call",
        source: "pdfjs-text-model",
        confidence: "exact",
      },
    };

    const current = resolvePdfAnnotationTextAnchor(model, target);
    const adjusted = adjustPdfAnnotationAnchor({
      model,
      target,
      nextEndOffset: (current?.endOffset ?? 0) + 3,
    });

    expect(adjusted).not.toBeNull();
    expect(adjusted?.textQuote.exact).toBe("phenomenon, which we");
    expect(adjusted?.rects.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps a single-word anchor stable inside a long text span when offsets do not materially change", () => {
    const model: PdfPageTextModel = {
      pageNumber: 1,
      viewportWidth: 768,
      viewportHeight: 960,
      textContent: { items: [], styles: {}, lang: null },
      items: [],
      segments: [
        {
          itemIndex: 0,
          text: "These were enumerated by DiVincenzo some years ago",
          normalizedText: "These were enumerated by DiVincenzo some years ago",
          hasEOL: false,
          pageTextStart: 0,
          pageTextEnd: 50,
        },
      ],
      itemRects: [
        { itemIndex: 0, left: 20, top: 24, width: 600, height: 26 },
      ],
      normalizedText: "These were enumerated by DiVincenzo some years ago",
    };

    const target: PdfTarget = {
      type: "pdf",
      page: 1,
      rects: [
        { x1: 320 / 640, y1: 24 / 960, x2: 440 / 640, y2: 50 / 960 },
      ],
      textQuote: {
        exact: "DiVincenzo",
        prefix: "enumerated by ",
        suffix: " some years ago",
        source: "pdfjs-text-model",
        confidence: "exact",
      },
    };

    const anchor = resolvePdfAnnotationTextAnchor(model, target);
    expect(anchor).not.toBeNull();
    expect(anchor?.textQuote.exact).toBe("DiVincenzo");

    const adjusted = adjustPdfAnnotationAnchor({
      model,
      target,
      nextStartOffset: anchor?.startOffset,
      nextEndOffset: anchor?.endOffset,
    });

    expect(adjusted).not.toBeNull();
    expect(adjusted?.textQuote.exact).toBe("DiVincenzo");
    expect(adjusted?.rects).toEqual(target.rects);
  });

  it("restores the original quote after dragging a boundary out and back to the same place", () => {
    const model = createModel();
    const target: PdfTarget = {
      type: "pdf",
      page: 1,
      rects: [
        { x1: 116 / 640, y1: 120 / 960, x2: 200 / 640, y2: 144 / 960 },
        { x1: 208 / 640, y1: 120 / 960, x2: 260 / 640, y2: 144 / 960 },
      ],
      textQuote: {
        exact: "phenomenon, which",
        prefix: "This ",
        suffix: " we call",
        source: "pdfjs-text-model",
        confidence: "exact",
      },
    };

    const currentAnchor = resolvePdfAnnotationTextAnchor(model, target);
    expect(currentAnchor).not.toBeNull();
    if (!currentAnchor) {
      throw new Error("Missing current anchor");
    }

    const pageRect = {
      left: 0,
      top: 0,
      width: 640,
      height: 960,
      right: 640,
      bottom: 960,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;

    const expanded = adjustPdfAnnotationAnchorFromPointer({
      model,
      target,
      currentAnchor,
      pageRect,
      point: { x: 276, y: 132 },
      side: "end",
    });
    expect(expanded?.textQuote.exact).toBe("phenomenon, which we");

    const restored = adjustPdfAnnotationAnchorFromPointer({
      model,
      target,
      currentAnchor: expanded ?? currentAnchor,
      pageRect,
      point: { x: 260, y: 132 },
      side: "end",
    });

    expect(restored).not.toBeNull();
    expect(restored?.textQuote.exact).toBe("phenomenon, which");
    expect(restored?.rects).toEqual(target.rects);
  });
});
