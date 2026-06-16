import { describe, expect, it } from "vitest";
import {
  buildPdfRectsForOffsets,
  resolvePdfExactQuoteOffsets,
  resolvePdfPointerBoundary,
} from "@/lib/pdf-canonical-text-anchoring";
import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";

function createMultiRunLineModel(): PdfPageTextModel {
  const line1a = "The applicability of ";
  const line1b = "Rydberg atoms";
  const line2 = "to quantum information remains promising.";
  const normalizedText = `${line1a}${line1b} ${line2}`;
  const line2Start = line1a.length + line1b.length + 1;

  return {
    pageNumber: 1,
    viewportWidth: 600,
    viewportHeight: 800,
    textContent: { items: [], styles: {}, lang: null },
    items: [],
    normalizedText,
    itemRects: [
      { itemIndex: 0, left: 80, top: 120, width: 190, height: 20 },
      { itemIndex: 1, left: 270, top: 120, width: 120, height: 20 },
      { itemIndex: 2, left: 80, top: 150, width: 330, height: 20 },
    ],
    segments: [
      {
        itemIndex: 0,
        text: line1a,
        normalizedText: line1a,
        hasEOL: false,
        pageTextStart: 0,
        pageTextEnd: line1a.length,
        lineIndex: 0,
        blockIndex: 0,
        columnIndex: 0,
        layoutClass: "main",
      },
      {
        itemIndex: 1,
        text: line1b,
        normalizedText: line1b,
        hasEOL: true,
        pageTextStart: line1a.length,
        pageTextEnd: line1a.length + line1b.length,
        lineIndex: 0,
        blockIndex: 0,
        columnIndex: 0,
        layoutClass: "main",
      },
      {
        itemIndex: 2,
        text: line2,
        normalizedText: line2,
        hasEOL: false,
        pageTextStart: line2Start,
        pageTextEnd: normalizedText.length,
        lineIndex: 1,
        blockIndex: 0,
        columnIndex: 0,
        layoutClass: "main",
      },
    ],
  };
}

describe("pdf-canonical-text-anchoring", () => {
  it("builds one tight Zotero-style rect per visual line from character offsets", () => {
    const model = createMultiRunLineModel();
    const rects = buildPdfRectsForOffsets(model, 4, model.normalizedText.indexOf(" remains"));

    expect(rects).toHaveLength(2);
    expect(rects[0].x1).toBeGreaterThan(80 / 600);
    expect(rects[0].x1).toBeLessThan(140 / 600);
    expect(rects[0].y1).toBeCloseTo(120 / 800);
    expect(rects[0].x2).toBeCloseTo(390 / 600);
    expect(rects[0].y2).toBeCloseTo(140 / 800);
    expect(rects[1]).toMatchObject({
      x1: 80 / 600,
      y1: 150 / 800,
    });
    expect(rects[1].x2).toBeLessThan(0.55);
    expect(rects.every((rect) => rect.y2 - rect.y1 <= 20 / 800)).toBe(true);
  });

  it("does not collapse adjacent visual lines into one block when line indexes are missing", () => {
    const model = createMultiRunLineModel();
    const modelWithoutLineIndexes: PdfPageTextModel = {
      ...model,
      segments: model.segments.map((segment) => ({
        ...segment,
        lineIndex: undefined,
      })),
    };

    const rects = buildPdfRectsForOffsets(modelWithoutLineIndexes, 0, model.normalizedText.length);

    expect(rects).toHaveLength(2);
    expect(rects[0].y2).toBeLessThan(rects[1].y1);
    expect(rects.every((rect) => rect.y2 - rect.y1 <= 20 / 800)).toBe(true);
  });

  it("does not trust stale line indexes that span multiple visual rows", () => {
    const model = createMultiRunLineModel();
    const staleLineIndexModel: PdfPageTextModel = {
      ...model,
      segments: model.segments.map((segment) => ({
        ...segment,
        lineIndex: 0,
      })),
    };

    const rects = buildPdfRectsForOffsets(staleLineIndexModel, 0, model.normalizedText.length);

    expect(rects).toHaveLength(2);
    expect(rects[0].y2).toBeLessThan(rects[1].y1);
    expect(rects.every((rect) => rect.y2 - rect.y1 <= 20 / 800)).toBe(true);
  });

  it("flushes separate Zotero-style rows whenever explicit line indexes differ", () => {
    const model = createMultiRunLineModel();
    const closeLineModel: PdfPageTextModel = {
      ...model,
      itemRects: [
        { itemIndex: 0, left: 80, top: 120, width: 190, height: 24 },
        { itemIndex: 1, left: 270, top: 120, width: 120, height: 24 },
        { itemIndex: 2, left: 80, top: 139, width: 330, height: 24 },
      ],
    };

    const rects = buildPdfRectsForOffsets(closeLineModel, 0, closeLineModel.normalizedText.length);

    expect(rects).toHaveLength(2);
    expect(rects[0].y1).toBeCloseTo(120 / 800);
    expect(rects[1].y1).toBeCloseTo(139 / 800);
    expect(rects.every((rect) => rect.y2 - rect.y1 <= 24 / 800)).toBe(true);
  });

  it("resolves readable exact quotes across PDF hyphenated line breaks", () => {
    const line1 = "from Fig. 5, that tend to cause shifts in opposite direc-";
    const line2 = "tions. Even so, the electric field stability";
    const model: PdfPageTextModel = {
      pageNumber: 7,
      viewportWidth: 640,
      viewportHeight: 960,
      textContent: { items: [], styles: {}, lang: null },
      items: [],
      normalizedText: `${line1} ${line2}`,
      itemRects: [
        { itemIndex: 0, left: 80, top: 282, width: 420, height: 24 },
        { itemIndex: 1, left: 80, top: 314, width: 360, height: 24 },
      ],
      segments: [
        {
          itemIndex: 0,
          text: line1,
          normalizedText: line1,
          hasEOL: true,
          pageTextStart: 0,
          pageTextEnd: line1.length,
          lineIndex: 0,
          blockIndex: 0,
          columnIndex: 0,
          layoutClass: "main",
        },
        {
          itemIndex: 1,
          text: line2,
          normalizedText: line2,
          hasEOL: false,
          pageTextStart: line1.length + 1,
          pageTextEnd: line1.length + 1 + line2.length,
          lineIndex: 1,
          blockIndex: 0,
          columnIndex: 0,
          layoutClass: "main",
        },
      ],
    };

    const offsets = resolvePdfExactQuoteOffsets({
      model,
      exact: "from Fig. 5, that tend to cause shifts in opposite directions. Even so",
    });

    expect(offsets).toEqual({
      startOffset: 0,
      endOffset: model.normalizedText.indexOf("Even so") + "Even so".length,
    });
    expect(buildPdfRectsForOffsets(model, offsets!.startOffset, offsets!.endOffset)).toHaveLength(2);
  });

  it("resolves readable exponent exact quotes against raw PDF exponent text", () => {
    const text = "Stark shifts below 1 MHz is typically of order 0.01(100/n)7/2 V/cm.";
    const model: PdfPageTextModel = {
      pageNumber: 7,
      viewportWidth: 640,
      viewportHeight: 960,
      textContent: { items: [], styles: {}, lang: null },
      items: [],
      normalizedText: text,
      itemRects: [
        { itemIndex: 0, left: 80, top: 346, width: 520, height: 24 },
      ],
      segments: [
        {
          itemIndex: 0,
          text,
          normalizedText: text,
          hasEOL: false,
          pageTextStart: 0,
          pageTextEnd: text.length,
          lineIndex: 0,
          blockIndex: 0,
          columnIndex: 0,
          layoutClass: "main",
        },
      ],
    };

    const offsets = resolvePdfExactQuoteOffsets({
      model,
      exact: "Stark shifts below 1 MHz is typically of order 0.01(100/n)^(7/2) V/cm.",
    });

    expect(offsets).toEqual({
      startOffset: 0,
      endOffset: text.length,
    });
  });

  it("resolves exact quotes when PDF control characters split mathematical tokens in the page text", () => {
    const text = "from Fig. 5, that tend to cause shifts in opposite directions. Even so, the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01 \u0001 100/ n \u0002 7/2 V / cm.";
    const model: PdfPageTextModel = {
      pageNumber: 7,
      viewportWidth: 640,
      viewportHeight: 960,
      textContent: { items: [], styles: {}, lang: null },
      items: [],
      normalizedText: text,
      itemRects: [
        { itemIndex: 0, left: 80, top: 346, width: 520, height: 24 },
      ],
      segments: [
        {
          itemIndex: 0,
          text,
          normalizedText: text,
          hasEOL: false,
          pageTextStart: 0,
          pageTextEnd: text.length,
          lineIndex: 0,
          blockIndex: 0,
          columnIndex: 0,
          layoutClass: "main",
        },
      ],
    };

    const offsets = resolvePdfExactQuoteOffsets({
      model,
      exact: "Fig. 5, that tend to cause shifts in opposite directions. Even so, the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01(100/n)^(7/2) V/cm.",
    });

    expect(offsets).toEqual({
      startOffset: text.indexOf("Fig. 5"),
      endOffset: text.length,
    });
  });

  it("resolves pointer boundaries by the nearest character midpoint", () => {
    const model = createMultiRunLineModel();
    const targetIndex = model.normalizedText.indexOf("Rydberg");
    const pageRect = {
      left: 0,
      top: 0,
      width: 600,
      height: 800,
      right: 600,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;

    const beforeBoundary = resolvePdfPointerBoundary({
      model,
      pageRect,
      point: { x: 272, y: 130 },
      side: "end",
      currentAnchor: { startOffset: targetIndex, endOffset: targetIndex + 3 },
      preferredLayoutClass: "main",
      preferredBlockIndex: 0,
      preferredColumnIndex: 0,
    });
    const afterBoundary = resolvePdfPointerBoundary({
      model,
      pageRect,
      point: { x: 278, y: 130 },
      side: "end",
      currentAnchor: { startOffset: targetIndex, endOffset: targetIndex + 3 },
      preferredLayoutClass: "main",
      preferredBlockIndex: 0,
      preferredColumnIndex: 0,
    });

    expect(beforeBoundary?.offset).toBe(targetIndex);
    expect(afterBoundary?.offset).toBe(targetIndex + 1);
  });
});
