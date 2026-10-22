/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import {
  normalizePdfSearchText,
  resolvePdfSearchMatchCandidate,
  resolvePdfSearchMatchesForRenderedModel,
  searchPdfPageTextModel,
} from "@/lib/pdf-search";
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
  it("normalizes case while preserving searchable word boundaries", () => {
    expect(normalizePdfSearchText(" Coulomb   interaction\n").text).toBe("coulomb interaction");

    const model = createSearchModel("The strong Coulomb   interaction is beneficial.");
    const matches = searchPdfPageTextModel(model, "coulomb interaction");

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      page: 4,
      index: "The strong ".length,
      normalizedIndex: "the strong ".length,
    });
    expect(matches[0].preview).toContain("Coulomb   interaction");
    expect(matches[0].rects).toHaveLength(1);
  });

  it("does not merge unrelated words into false-positive compact matches", () => {
    const model = createSearchModel("Dark matter is not the same token as darkmatter.");

    expect(searchPdfPageTextModel(model, "darkmatter")).toHaveLength(1);
    expect(searchPdfPageTextModel(model, "dark matter")).toHaveLength(1);
    expect(searchPdfPageTextModel(createSearchModel("Dark matter only."), "darkmatter")).toHaveLength(0);
  });

  it("matches phrases across PDF line-break whitespace without requiring exact spacing", () => {
    const model = createSearchModel("field stability required to hold\nStark shifts below 1 MHz");
    const matches = searchPdfPageTextModel(model, "required to hold Stark shifts");

    expect(matches).toHaveLength(1);
    expect(matches[0].index).toBe(model.normalizedText.indexOf("required"));
    expect(matches[0].preview).toContain("required to hold\nStark shifts");
  });

  it("matches dehyphenated line-break words like professional PDF readers", () => {
    const model = createSearchModel("The super-\nconducting transition remains sharp.");
    const matches = searchPdfPageTextModel(model, "superconducting");

    expect(matches).toHaveLength(1);
    expect(matches[0].index).toBe(model.normalizedText.indexOf("super"));
    expect(matches[0].preview).toContain("super-\nconducting");
  });

  it("supports match case and whole word search options", () => {
    const model = createSearchModel("Atom atomic ATOM atom.");

    expect(searchPdfPageTextModel(model, "atom")).toHaveLength(4);
    expect(searchPdfPageTextModel(model, "atom", { caseSensitive: true })).toHaveLength(2);
    expect(searchPdfPageTextModel(model, "atom", { entireWord: true })).toHaveLength(3);
    expect(searchPdfPageTextModel(model, "ATOM", { caseSensitive: true, entireWord: true })).toHaveLength(1);
  });

  it("uses rendered glyph range geometry instead of equal-width character estimates", () => {
    const model = createSearchModel("0.375%");
    model.itemRects = [{ itemIndex: 0, left: 60, top: 120, width: 120, height: 24 }];

    const span = document.createElement("span");
    const textNode = document.createTextNode("0.375%");
    span.appendChild(textNode);
    document.body.appendChild(span);
    span.getBoundingClientRect = () => new DOMRect(100, 200, 120, 24);
    model.segments[0].textNode = textNode;
    model.segments[0].rawToNormalizedOffsets = [0, 1, 2, 3, 4, 5, 6];

    const glyphLefts = [0, 22, 30, 54, 72, 94];
    const glyphWidths = [22, 8, 24, 18, 22, 26];
    let rangeStart = 0;
    let rangeEnd = 0;
    const range = {
      setStart: vi.fn((_node: Node, offset: number) => {
        rangeStart = offset;
      }),
      setEnd: vi.fn((_node: Node, offset: number) => {
        rangeEnd = offset;
      }),
      getClientRects: vi.fn(() => [new DOMRect(
        100 + glyphLefts[rangeStart],
        200,
        glyphWidths[Math.max(rangeStart, rangeEnd - 1)],
        24,
      )]),
      getBoundingClientRect: vi.fn(() => new DOMRect()),
      detach: vi.fn(),
    } as unknown as Range;
    const createRangeSpy = vi.spyOn(document, "createRange").mockReturnValue(range);

    try {
      const [match] = searchPdfPageTextModel(model, "7");

      expect(match.rects).toHaveLength(1);
      expect(match.rects[0]).toMatchObject({
        left: (60 + 54) / 600,
        top: 120 / 800,
        width: 18 / 600,
        height: 24 / 800,
      });
    } finally {
      createRangeSpy.mockRestore();
      span.remove();
    }
  });

  it("rebinds an offscreen match to the same occurrence after the rendered text model shifts", () => {
    const indexedMatches = searchPdfPageTextModel(createSearchModel("7 alpha 7 beta 7 gamma"), "7");
    const renderedMatches = searchPdfPageTextModel(createSearchModel("preface 7 alpha 7 beta 7 gamma"), "7");

    const resolved = resolvePdfSearchMatchCandidate(indexedMatches[2], renderedMatches);

    expect(resolved?.pageMatchIndex).toBe(2);
    expect(resolved?.normalizedIndex).toBe(renderedMatches[2].normalizedIndex);
  });

  it("measures repeated rendered matches once per query while preserving search options", () => {
    const indexedMatches = searchPdfPageTextModel(createSearchModel("ATOM atom ATOM"), "ATOM", {
      caseSensitive: true,
      entireWord: true,
    });
    const renderedModel = createSearchModel("prefix ATOM atom ATOM");
    const span = document.createElement("span");
    const textNode = document.createTextNode(renderedModel.normalizedText);
    span.appendChild(textNode);
    document.body.appendChild(span);
    span.getBoundingClientRect = () => new DOMRect(100, 200, 240, 24);
    renderedModel.segments[0].textNode = textNode;
    renderedModel.segments[0].rawToNormalizedOffsets = Array.from(
      { length: renderedModel.normalizedText.length + 1 },
      (_, index) => index,
    );
    renderedModel.itemRects[0] = { itemIndex: 0, left: 60, top: 120, width: 240, height: 24 };

    let rangeStart = 0;
    let rangeEnd = 0;
    const range = {
      setStart: vi.fn((_node: Node, offset: number) => {
        rangeStart = offset;
      }),
      setEnd: vi.fn((_node: Node, offset: number) => {
        rangeEnd = offset;
      }),
      getClientRects: vi.fn(() => [new DOMRect(100 + rangeStart * 10, 200, (rangeEnd - rangeStart) * 10, 24)]),
      getBoundingClientRect: vi.fn(() => new DOMRect()),
      detach: vi.fn(),
    } as unknown as Range;
    const createRangeSpy = vi.spyOn(document, "createRange").mockReturnValue(range);

    try {
      const resolved = resolvePdfSearchMatchesForRenderedModel(renderedModel, indexedMatches);

      expect(resolved).toHaveLength(2);
      expect(resolved.map((match) => match.preview)).toEqual([
        expect.stringContaining("prefix ATOM"),
        expect.stringContaining("atom ATOM"),
      ]);
      expect(range.getClientRects).toHaveBeenCalledTimes(2);
    } finally {
      createRangeSpy.mockRestore();
      span.remove();
    }
  });
});
