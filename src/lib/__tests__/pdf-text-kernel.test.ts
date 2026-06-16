import { describe, expect, it } from "vitest";
import {
  buildPdfTextKernelAnchor,
  buildPdfTextKernelPage,
  clearPdfTextKernelPageCache,
  getPdfTextKernelRangeText,
} from "../pdf-text-kernel";
import {
  buildPdfReadableTextForOffsets,
} from "../pdf-canonical-text-anchoring";
import type { PdfPageTextModel } from "../pdf-page-text-cache";

function createModel(): PdfPageTextModel {
  return {
    pageNumber: 1,
    viewportWidth: 200,
    viewportHeight: 100,
    textContent: { items: [], styles: {}, lang: null },
    items: [],
    normalizedText: "alpha beta",
    itemRects: [
      { itemIndex: 0, left: 20, top: 10, width: 100, height: 20 },
    ],
    segments: [
      {
        itemIndex: 0,
        text: "alpha beta",
        normalizedText: "alpha beta",
        hasEOL: false,
        pageTextStart: 0,
        pageTextEnd: 10,
        lineIndex: 0,
        blockIndex: 0,
        columnIndex: 0,
        layoutClass: "main",
      },
    ],
  };
}

function createSaffmanFig7Model(): PdfPageTextModel {
  const line1 = "To illustrate, Fig. 7 shows the energy";
  const line2 = "level structure centered around the |60p3/2 60p3/2> state of Rb at zero relative energy. If we";
  const normalizedText = `${line1} ${line2}`;
  const line2Start = line1.length + 1;

  const segments = [
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
      layoutClass: "main" as const,
    },
    {
      itemIndex: 1,
      text: "level structure centered around the |60p",
      normalizedText: "level structure centered around the |60p",
      hasEOL: false,
      pageTextStart: line2Start,
      pageTextEnd: line2Start + "level structure centered around the |60p".length,
      lineIndex: 1,
      blockIndex: 0,
      columnIndex: 0,
      layoutClass: "main" as const,
    },
    {
      itemIndex: 2,
      text: "3/2",
      normalizedText: "3/2",
      hasEOL: false,
      pageTextStart: line2Start + "level structure centered around the |60p".length,
      pageTextEnd: line2Start + "level structure centered around the |60p3/2".length,
      lineIndex: 1,
      blockIndex: 0,
      columnIndex: 0,
      layoutClass: "main" as const,
    },
    {
      itemIndex: 3,
      text: " 60p",
      normalizedText: " 60p",
      hasEOL: false,
      pageTextStart: line2Start + "level structure centered around the |60p3/2".length,
      pageTextEnd: line2Start + "level structure centered around the |60p3/2 60p".length,
      lineIndex: 1,
      blockIndex: 0,
      columnIndex: 0,
      layoutClass: "main" as const,
    },
    {
      itemIndex: 4,
      text: "3/2",
      normalizedText: "3/2",
      hasEOL: false,
      pageTextStart: line2Start + "level structure centered around the |60p3/2 60p".length,
      pageTextEnd: line2Start + "level structure centered around the |60p3/2 60p3/2".length,
      lineIndex: 1,
      blockIndex: 0,
      columnIndex: 0,
      layoutClass: "main" as const,
    },
    {
      itemIndex: 5,
      text: "> state of Rb at zero relative energy. If we",
      normalizedText: "> state of Rb at zero relative energy. If we",
      hasEOL: false,
      pageTextStart: line2Start + "level structure centered around the |60p3/2 60p3/2".length,
      pageTextEnd: normalizedText.length,
      lineIndex: 1,
      blockIndex: 0,
      columnIndex: 0,
      layoutClass: "main" as const,
    },
  ];

  return {
    pageNumber: 8,
    viewportWidth: 640,
    viewportHeight: 960,
    textContent: { items: [], styles: {}, lang: null },
    items: [],
    normalizedText,
    itemRects: [
      { itemIndex: 0, left: 80, top: 120, width: 300, height: 24 },
      { itemIndex: 1, left: 80, top: 152, width: 260, height: 24 },
      { itemIndex: 2, left: 340, top: 144, width: 24, height: 12 },
      { itemIndex: 3, left: 364, top: 152, width: 36, height: 24 },
      { itemIndex: 4, left: 400, top: 144, width: 24, height: 12 },
      { itemIndex: 5, left: 424, top: 152, width: 260, height: 24 },
    ],
    segments,
  };
}

describe("pdf-text-kernel", () => {
  it("builds a character-level kernel from the page text model", () => {
    const model = createModel();
    const page = buildPdfTextKernelPage({ model });

    expect(page.modelVersion).toBe(1);
    expect(page.pageNumber).toBe(1);
    expect(page.chars).toHaveLength(10);
    expect(page.chars[0]).toMatchObject({
      charIndex: 0,
      text: "a",
      normalizedText: "a",
      source: "pdfjs",
      confidence: 1,
      itemIndex: 0,
      lineIndex: 0,
      wordIndex: 0,
      columnIndex: 0,
    });
    expect(page.chars[0].pdfRect).toMatchObject({
      x1: 0.1,
      y1: 0.1,
      x2: 0.15,
      y2: 0.3,
    });
    expect(page.chars[4].spaceAfter).toBe(true);
    expect(page.chars[5]).toMatchObject({
      text: " ",
      wordIndex: undefined,
    });
    expect(page.chars[6]).toMatchObject({
      text: "b",
      wordIndex: 1,
    });
  });

  it("copies text from kernel offsets instead of DOM selection", () => {
    const page = buildPdfTextKernelPage({ model: createModel() });

    expect(getPdfTextKernelRangeText(page, 0, 5)).toBe("alpha");
    expect(getPdfTextKernelRangeText(page, 10, 6)).toBe("beta");
  });

  it("reuses cached kernel pages for the same text model", () => {
    const model = createModel();
    const first = buildPdfTextKernelPage({ model });
    const second = buildPdfTextKernelPage({ model });

    expect(second).toBe(first);
    clearPdfTextKernelPageCache(model);
    expect(buildPdfTextKernelPage({ model })).not.toBe(first);
  });

  it("builds stable quote and page-space rect anchors", () => {
    const model = createModel();
    const page = buildPdfTextKernelPage({ model });
    const anchor = buildPdfTextKernelAnchor({
      page,
      model,
      startCharIndex: 0,
      endCharIndex: 5,
    });

    expect(anchor).not.toBeNull();
    expect(anchor?.text).toBe("alpha");
    expect(anchor?.quote).toMatchObject({
      exact: "alpha",
      prefix: "",
      suffix: " beta",
      source: "pdfjs-text-model",
      confidence: "exact",
    });
    expect(anchor?.rects[0]).toMatchObject({
      x1: 0.1,
      y1: 0.1,
      x2: 0.35,
      y2: 0.3,
    });
    expect(anchor?.quads[0]).toMatchObject({
      x1: 0.1,
      y1: 0.1,
      x2: 0.35,
      y2: 0.1,
      x3: 0.35,
      y3: 0.3,
      x4: 0.1,
      y4: 0.3,
    });
  });

  it("keeps Saffman-style inline formula fragments in character-stream order", () => {
    const model = createSaffmanFig7Model();
    const page = buildPdfTextKernelPage({ model });
    const start = model.normalizedText.indexOf("Fig. 7");
    const end = model.normalizedText.indexOf("If we") + "If we".length;
    const anchor = buildPdfTextKernelAnchor({
      page,
      model,
      startCharIndex: start,
      endCharIndex: end,
    });

    expect(anchor).not.toBeNull();
    expect(anchor?.text).toBe(
      "Fig. 7 shows the energy level structure centered around the |60p3/2 60p3/2> state of Rb at zero relative energy. If we",
    );
    expect(anchor?.text).toContain("|60p3/2 60p3/2>");
    expect(anchor?.text).not.toContain("p 3/2 p 3/2");
    expect(anchor?.rects.length).toBeGreaterThanOrEqual(2);
    expect(anchor?.rects.every((rect) => rect.y2 - rect.y1 < 0.04)).toBe(true);
  });

  it("does not insert spaces inside words solely from measured geometry gaps", () => {
    const model: PdfPageTextModel = {
      pageNumber: 1,
      viewportWidth: 400,
      viewportHeight: 200,
      textContent: { items: [], styles: {}, lang: null },
      items: [],
      normalizedText: "Rydberg states",
      itemRects: [
        { itemIndex: 0, left: 20, top: 20, width: 96, height: 18 },
        { itemIndex: 1, left: 150, top: 20, width: 72, height: 18 },
      ],
      segments: [
        {
          itemIndex: 0,
          text: "Rydberg",
          normalizedText: "Rydberg",
          hasEOL: false,
          pageTextStart: 0,
          pageTextEnd: 7,
          lineIndex: 0,
          blockIndex: 0,
          columnIndex: 0,
          layoutClass: "main",
        },
        {
          itemIndex: 1,
          text: "states",
          normalizedText: "states",
          hasEOL: false,
          pageTextStart: 8,
          pageTextEnd: 14,
          lineIndex: 0,
          blockIndex: 0,
          columnIndex: 0,
          layoutClass: "main",
        },
      ],
    };

    expect(buildPdfReadableTextForOffsets(model, 0, model.normalizedText.length)).toBe("Rydberg states");
  });
});
