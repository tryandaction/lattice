import { describe, expect, it } from "vitest";
import { normalizePdfSearchText, searchPdfPageTextModel } from "@/lib/pdf-search";
import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";

function createSearchModel(text: string): PdfPageTextModel {
  return {
    pageNumber: 4,
    viewportWidth: 600,
    viewportHeight: 800,
    textContent: { items: [], styles: {}, lang: null },
    items: [],
    normalizedText: text,
    itemRects: [
      { itemIndex: 0, left: 60, top: 120, width: 480, height: 24 },
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
}

describe("pdf-search", () => {
  it("normalizes case and ignores whitespace for PDF text search", () => {
    expect(normalizePdfSearchText(" Coulomb   interaction\n").text).toBe("coulombinteraction");

    const model = createSearchModel("The strong Coulomb   interaction is beneficial.");
    const matches = searchPdfPageTextModel(model, "coulombinteraction");

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      page: 4,
      index: "The strong ".length,
      normalizedIndex: "thestrong".length,
    });
    expect(matches[0].preview).toContain("Coulomb   interaction");
    expect(matches[0].rects).toHaveLength(1);
  });

  it("matches phrases across PDF line-break whitespace without requiring exact spacing", () => {
    const model = createSearchModel("field stability required to hold\nStark shifts below 1 MHz");
    const matches = searchPdfPageTextModel(model, "required to hold Stark shifts");

    expect(matches).toHaveLength(1);
    expect(matches[0].index).toBe(model.normalizedText.indexOf("required"));
    expect(matches[0].preview).toContain("required to hold\nStark shifts");
  });
});
