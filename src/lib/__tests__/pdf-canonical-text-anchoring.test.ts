import { describe, expect, it } from "vitest";
import {
  buildPdfCanonicalChars,
  buildPdfRectsForOffsets,
  recoverCanonicalPdfTextAnchor,
  resolvePdfExactQuoteOffsets,
  resolvePdfPointerBoundary,
  resolvePdfVisualColumnScope,
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

function createRecoveryModel(): PdfPageTextModel {
  const first = "alpha repeated phrase omega";
  const second = "beta repeated phrase gamma";
  const normalizedText = `${first} ${second}`;
  return {
    pageNumber: 4,
    viewportWidth: 600,
    viewportHeight: 800,
    textContent: { items: [], styles: {}, lang: null },
    items: [],
    normalizedText,
    itemRects: [
      { itemIndex: 0, left: 60, top: 120, width: 300, height: 20 },
      { itemIndex: 1, left: 60, top: 180, width: 290, height: 20 },
    ],
    segments: [
      {
        itemIndex: 0,
        text: first,
        normalizedText: first,
        hasEOL: true,
        pageTextStart: 0,
        pageTextEnd: first.length,
        lineIndex: 0,
        blockIndex: 0,
        columnIndex: 0,
        layoutClass: "main",
      },
      {
        itemIndex: 1,
        text: second,
        normalizedText: second,
        hasEOL: false,
        pageTextStart: first.length + 1,
        pageTextEnd: normalizedText.length,
        lineIndex: 1,
        blockIndex: 0,
        columnIndex: 0,
        layoutClass: "main",
      },
    ],
  };
}

function createTwoColumnModelWithIndependentLineIndexes(): PdfPageTextModel {
  const lines = [
    { text: "left column first visual line", left: 50, top: 100, lineIndex: 0, columnIndex: 0 },
    { text: "left column second visual line", left: 50, top: 130, lineIndex: 1, columnIndex: 0 },
    { text: "right column first visual line", left: 350, top: 100, lineIndex: 10, columnIndex: 1 },
    { text: "right column second visual line", left: 350, top: 130, lineIndex: 11, columnIndex: 1 },
  ];
  let cursor = 0;
  const segments = lines.map((line, itemIndex) => {
    const pageTextStart = cursor;
    cursor += line.text.length;
    const pageTextEnd = cursor;
    cursor += 1;
    return {
      itemIndex,
      text: line.text,
      normalizedText: line.text,
      hasEOL: true,
      pageTextStart,
      pageTextEnd,
      lineIndex: line.lineIndex,
      blockIndex: line.columnIndex,
      columnIndex: line.columnIndex,
      layoutClass: "main" as const,
    };
  });

  return {
    pageNumber: 3,
    viewportWidth: 640,
    viewportHeight: 900,
    textContent: { items: [], styles: {}, lang: null },
    items: [],
    normalizedText: lines.map((line) => line.text).join(" "),
    itemRects: lines.map((line, itemIndex) => ({
      itemIndex,
      left: line.left,
      top: line.top,
      width: 240,
      height: 20,
    })),
    segments,
  };
}

describe("pdf-canonical-text-anchoring", () => {
  it("detects a visual gutter when aligned PDF columns use independent line indexes", () => {
    const model = createTwoColumnModelWithIndependentLineIndexes();
    const scope = resolvePdfVisualColumnScope({
      chars: buildPdfCanonicalChars(model),
      viewportWidth: model.viewportWidth,
      verticalRange: { top: 95, bottom: 155 },
      startX: 80,
      endX: 220,
    });

    expect(scope).toEqual({
      boundaryX: expect.any(Number),
      side: "left",
    });
    expect(scope?.boundaryX).toBeGreaterThan(290);
    expect(scope?.boundaryX).toBeLessThan(350);
  });

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

  it("keeps a lowered inline formula subscript inside one canonical text-markup rect", () => {
    const parts = [
      { text: "transition with linewidth ", left: 80, top: 120, width: 190, height: 24 },
      { text: "Γ", left: 270, top: 120, width: 14, height: 24 },
      { text: "g", left: 284, top: 138, width: 8, height: 10 },
      { text: "/(2π) = 183 kHz.", left: 293, top: 120, width: 150, height: 24 },
    ];
    let offset = 0;
    const segments = parts.map((part, itemIndex) => {
      const pageTextStart = offset;
      offset += part.text.length;
      return {
        itemIndex,
        text: part.text,
        normalizedText: part.text,
        hasEOL: false,
        pageTextStart,
        pageTextEnd: offset,
        lineIndex: 0,
        blockIndex: 0,
        columnIndex: 0,
        layoutClass: "main" as const,
      };
    });
    const model: PdfPageTextModel = {
      pageNumber: 3,
      viewportWidth: 612,
      viewportHeight: 792,
      textContent: { items: [], styles: {}, lang: null },
      items: [],
      normalizedText: parts.map((part) => part.text).join(""),
      itemRects: parts.map((part, itemIndex) => ({ itemIndex, ...part })),
      segments,
    };
    const startOffset = model.normalizedText.indexOf("Γ");
    const rects = buildPdfRectsForOffsets(model, startOffset, model.normalizedText.length);

    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({
      x1: 270 / 612,
      x2: 443 / 612,
      y1: 120 / 792,
      y2: 144 / 792,
    });
  });

  it("keeps shifted equal-height math glyphs on the body row without reaching the next line", () => {
    const parts = [
      { text: "\u0393", left: 164.12636744, top: 285.6757, width: 6.1215583, height: 10.5001 },
      { text: "g", left: 170.2488, top: 282.75325, width: 3.4398, height: 7.35 },
      { text: " =", left: 173.6886, top: 278.5041317, width: 5.72205, height: 10.5001 },
      { text: "\u00f02\u03c0\u00de \u00bc", left: 179.37599967, top: 285.6757, width: 30.025036, height: 10.5001 },
      { text: " 183", left: 209.40103567, top: 285.6757, width: 18.663928, height: 10.5001 },
      { text: " kHz.", left: 228.06496367, top: 278.5041317, width: 23.598107, height: 10.5001 },
    ];
    let offset = 0;
    const segments = parts.map((part, itemIndex) => {
      const pageTextStart = offset;
      offset += part.text.length;
      return {
        itemIndex,
        text: part.text,
        normalizedText: part.text,
        hasEOL: false,
        pageTextStart,
        pageTextEnd: offset,
        lineIndex: 0,
        blockIndex: 0,
        columnIndex: 0,
        layoutClass: "main" as const,
      };
    });
    const model: PdfPageTextModel = {
      pageNumber: 3,
      viewportWidth: 612,
      viewportHeight: 792,
      textContent: { items: [], styles: {}, lang: null },
      items: [],
      normalizedText: parts.map((part) => part.text).join(""),
      itemRects: parts.map((part, itemIndex) => ({ itemIndex, ...part })),
      segments,
    };

    const rects = buildPdfRectsForOffsets(model, 0, model.normalizedText.length);

    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({
      x1: 164.12636744 / 612,
      y1: 278.5041317 / 792,
      x2: 251.66307067 / 612,
      y2: (278.5041317 + 10.5001) / 792,
    });
    expect(rects[0].y2).toBeLessThan(291.4297548 / 792);
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

  it("recovers duplicate exact quotes with prefix and suffix context", () => {
    const model = createRecoveryModel();
    const expectedStart = model.normalizedText.lastIndexOf("repeated phrase");
    const result = recoverCanonicalPdfTextAnchor({
      model,
      exact: "repeated phrase",
      prefix: "beta ",
      suffix: " gamma",
      startOffset: 0,
      endOffset: 4,
      rects: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe("exact-context");
      expect(result.startOffset).toBe(expectedStart);
      expect(result.endOffset).toBe(expectedStart + "repeated phrase".length);
    }
  });

  it("corrects stale offsets from the exact quote", () => {
    const model = createRecoveryModel();
    const expectedStart = model.normalizedText.indexOf("alpha");
    const result = recoverCanonicalPdfTextAnchor({
      model,
      exact: "alpha repeated phrase",
      prefix: "",
      suffix: " omega",
      startOffset: model.normalizedText.indexOf("beta"),
      endOffset: model.normalizedText.length,
      rects: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.startOffset).toBe(expectedStart);
      expect(result.textQuote.exact).toBe("alpha repeated phrase");
    }
  });

  it("recovers a damaged exact quote from surrounding context", () => {
    const model = createRecoveryModel();
    const expectedStart = model.normalizedText.lastIndexOf("repeated phrase");
    const result = recoverCanonicalPdfTextAnchor({
      model,
      exact: "repeated phxase",
      prefix: "beta ",
      suffix: " gamma",
      rects: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe("context-recovery");
      expect(result.startOffset).toBe(expectedStart);
      expect(result.textQuote.exact).toBe("repeated phrase");
    }
  });

  it("falls back to stored geometry when quote recovery fails", () => {
    const model = createRecoveryModel();
    const expectedStart = model.normalizedText.lastIndexOf("repeated phrase");
    const expectedEnd = expectedStart + "repeated phrase".length;
    const rects = buildPdfRectsForOffsets(model, expectedStart, expectedEnd);
    const result = recoverCanonicalPdfTextAnchor({
      model,
      exact: "not present anywhere",
      prefix: "missing",
      suffix: "context",
      rects,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe("geometry-recovery");
      expect(result.startOffset).toBe(expectedStart);
      expect(result.endOffset).toBe(expectedEnd);
    }
  });

  it("leaves precise stored geometry unchanged when offsets and quote still agree", () => {
    const model = createRecoveryModel();
    const startOffset = model.normalizedText.indexOf("alpha repeated phrase");
    const endOffset = startOffset + "alpha repeated phrase".length;
    const rects = buildPdfRectsForOffsets(model, startOffset, endOffset);
    const result = recoverCanonicalPdfTextAnchor({
      model,
      exact: "alpha repeated phrase",
      startOffset,
      endOffset,
      rects,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe("stored-offsets-and-geometry");
      expect(result.rects).toBe(rects);
      expect(result.confidence).toBe(1);
    }
  });
});
