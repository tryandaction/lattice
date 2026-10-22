import { describe, expect, it } from "vitest";
import {
  buildPdfReferencePreviewIndex,
  selectPdfReferencePreviewPageNumbers,
} from "@/lib/pdf-reference-preview";
import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";

function createTextModel(pageNumber: number, lines: string[]): PdfPageTextModel {
  let normalizedText = "";
  const segments: PdfPageTextModel["segments"] = [];
  const itemRects: PdfPageTextModel["itemRects"] = [];
  const items: PdfPageTextModel["items"] = [];

  lines.forEach((line, lineIndex) => {
    if (normalizedText && !normalizedText.endsWith(" ")) {
      normalizedText += " ";
    }
    const start = normalizedText.length;
    normalizedText += line;
    const end = normalizedText.length;
    segments.push({
      itemIndex: lineIndex,
      text: line,
      normalizedText: line,
      hasEOL: true,
      pageTextStart: start,
      pageTextEnd: end,
      lineIndex,
      blockIndex: 0,
      columnIndex: 0,
      rawToNormalizedOffsets: Array.from({ length: line.length + 1 }, (_, index) => index),
    });
    itemRects.push({
      itemIndex: lineIndex,
      left: 40,
      top: 40 + lineIndex * 18,
      width: Math.max(24, line.length * 6),
      height: 12,
    });
    items.push({
      str: line,
      dir: "ltr",
      transform: [1, 0, 0, 12, 40, 40 + lineIndex * 18],
      width: Math.max(24, line.length * 6),
      height: 12,
      fontName: "f1",
      hasEOL: true,
    });
  });

  return {
    modelVersion: 1,
    pageNumber,
    viewportWidth: 600,
    viewportHeight: 800,
    textContent: {
      items,
      styles: {},
      lang: null,
    },
    items,
    segments,
    itemRects,
    normalizedText,
  } as PdfPageTextModel;
}

describe("pdf-reference-preview", () => {
  it("bounds initial reference extraction to visible pages and a short tail window", () => {
    const pages = selectPdfReferencePreviewPageNumbers({
      numPages: 120,
      renderedPageNumbers: [1, 2, 60],
      tailPageLimit: 12,
    });

    expect(pages).toEqual([1, 2, 60, ...Array.from({ length: 12 }, (_, index) => 109 + index)]);
    expect(pages).toHaveLength(15);
    expect(pages).not.toContain(50);
  });

  it("supports demand-driven extraction without an automatic tail scan", () => {
    const pages = selectPdfReferencePreviewPageNumbers({
      numPages: 120,
      renderedPageNumbers: [1, 2, 60],
      tailPageLimit: 0,
    });

    expect(pages).toEqual([1, 2, 60]);
  });

  it("builds Zotero-style citation hotspots from numbered references", () => {
    const index = buildPdfReferencePreviewIndex([
      createTextModel(1, [
        "Scalar light shifts are discussed in refs. 1,2 and a related result appears in ref. 3.",
        "The excited levels4 are also relevant for the experiment.",
      ]),
      createTextModel(2, [
        "References",
        "[1] Alpha Author, First paper, Journal 1.",
        "[2] Beta Author, Second paper, Journal 2.",
        "[3] Gamma Author, Third paper, Journal 3.",
        "[4] Delta Author, Fourth paper, Journal 4.",
      ]),
    ]);

    expect(index.referenceStart).toEqual({ page: 2, offset: 0 });
    expect(index.entries.map((entry) => entry.number)).toEqual([1, 2, 3, 4]);
    expect(index.hotspots.map((hotspot) => hotspot.referenceNumbers)).toEqual([[1, 2], [3], [4]]);
    expect(index.hotspots[0]?.context).toContain("refs. 1,2");
    expect(index.entriesByNumber[3]?.preview).toContain("Gamma Author");
    expect(index.hotspots.every((hotspot) => hotspot.rects.length > 0)).toBe(true);
  });

  it("keeps ordinary numbers out of citation hotspots when no matching reference exists", () => {
    const index = buildPdfReferencePreviewIndex([
      createTextModel(1, [
        "The apparatus was upgraded in 2024 and used 88 traps before ref. 2 was tested.",
      ]),
      createTextModel(2, [
        "References",
        "1. Alpha Author, First paper.",
        "2. Beta Author, Second paper.",
      ]),
    ]);

    expect(index.hotspots.map((hotspot) => hotspot.referenceNumbers)).toEqual([[2]]);
    expect(index.hotspots[0]?.label).toBe("2");
  });

  it("detects single, grouped, ranged, superscript-style, and labeled citations", () => {
    const index = buildPdfReferencePreviewIndex([
      createTextModel(1, [
        "Single [1], grouped [1,2], ranged [1-3], attached result7, ref. 77, and refs. 29,44,45,47.",
      ]),
      createTextModel(2, [
        "References",
        "[1] First reference entry.",
        "[2] Second reference entry.",
        "[3] Third reference entry.",
        "[7] Seventh reference entry.",
        "[29] Twenty ninth reference entry.",
        "[44] Forty fourth reference entry.",
        "[45] Forty fifth reference entry.",
        "[47] Forty seventh reference entry.",
        "[77] Seventy seventh reference entry.",
      ]),
    ]);

    expect(index.hotspots.map((hotspot) => hotspot.referenceNumbers)).toEqual([
      [1],
      [1, 2],
      [1, 2, 3],
      [7],
      [77],
      [29, 44, 45, 47],
    ]);
    expect(index.hotspots[0]?.label).toBe("1");
    expect(index.hotspots[0]?.rects).toHaveLength(1);
    expect(index.hotspots[0]?.rects[0]?.width).toBeCloseTo(6 / 600, 5);
  });
});
