import { describe, expect, it } from "vitest";
import {
  buildCanonicalPdfTextMarkupAnnotationFromExact,
  repairPdfTextAnnotationFromModel,
} from "@/lib/pdf-annotation-text-repair";
import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";
import type { AnnotationItem } from "@/types/universal-annotation";

function createSaffmanModel(): PdfPageTextModel {
  const line1 = "Even so, the electric field stability required to hold";
  const line2 = "Stark shifts below 1 MHz is typically of order";
  const line3 = "0.01(100/n)7/2 V/cm.";
  const normalizedText = `${line1} ${line2} ${line3}`;
  const viewportWidth = 640;
  const viewportHeight = 960;
  return {
    pageNumber: 7,
    viewportWidth,
    viewportHeight,
    textContent: { items: [], styles: {}, lang: null },
    items: [],
    normalizedText,
    itemRects: [
      { itemIndex: 0, left: 120, top: 430, width: 380, height: 24 },
      { itemIndex: 1, left: 80, top: 462, width: 360, height: 24 },
      { itemIndex: 2, left: 80, top: 494, width: 170, height: 24 },
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
        hasEOL: true,
        pageTextStart: line1.length + 1,
        pageTextEnd: line1.length + 1 + line2.length,
        lineIndex: 1,
        blockIndex: 0,
        columnIndex: 0,
        layoutClass: "main",
      },
      {
        itemIndex: 2,
        text: line3,
        normalizedText: line3,
        hasEOL: false,
        pageTextStart: line1.length + 1 + line2.length + 1,
        pageTextEnd: normalizedText.length,
        lineIndex: 2,
        blockIndex: 0,
        columnIndex: 0,
        layoutClass: "main",
      },
    ],
  };
}

function createSaffmanFigFiveModel(): PdfPageTextModel {
  const line0 = "of states with equal and opposite Delta E, as can be inferred";
  const line1 = "from Fig. 5, that tend to cause shifts in opposite direc-";
  const line2 = "tions. Even so, the electric field stability required to hold";
  const line3 = "Stark shifts below 1 MHz is typically of order";
  const line4 = "0.01(100/n)7/2 V/cm.";
  const normalizedText = [line0, line1, line2, line3, line4].join(" ");
  const viewportWidth = 640;
  const viewportHeight = 960;
  let offset = 0;
  const segments = [line0, line1, line2, line3, line4].map((line, index) => {
    const start = offset;
    const end = start + line.length;
    offset = end + 1;
    return {
      itemIndex: index,
      text: line,
      normalizedText: line,
      hasEOL: index < 4,
      pageTextStart: start,
      pageTextEnd: end,
      lineIndex: index,
      blockIndex: 0,
      columnIndex: 0,
      layoutClass: "main" as const,
    };
  });

  return {
    pageNumber: 7,
    viewportWidth,
    viewportHeight,
    textContent: { items: [], styles: {}, lang: null },
    items: [],
    normalizedText,
    itemRects: [
      { itemIndex: 0, left: 80, top: 250, width: 430, height: 24 },
      { itemIndex: 1, left: 80, top: 282, width: 420, height: 24 },
      { itemIndex: 2, left: 80, top: 314, width: 430, height: 24 },
      { itemIndex: 3, left: 80, top: 346, width: 360, height: 24 },
      { itemIndex: 4, left: 80, top: 378, width: 170, height: 24 },
    ],
    segments,
  };
}

describe("pdf-annotation-text-repair", () => {
  it("repairs a legacy Saffman annotation whose saved quote starts inside the first word", () => {
    const model = createSaffmanModel();
    const annotation: AnnotationItem = {
      id: "ann-saffman",
      target: {
        type: "pdf",
        page: 7,
        rects: [
          { x1: 120 / 640, y1: 430 / 960, x2: 500 / 640, y2: 454 / 960 },
          { x1: 80 / 640, y1: 462 / 960, x2: 440 / 640, y2: 486 / 960 },
          { x1: 80 / 640, y1: 494 / 960, x2: 250 / 640, y2: 518 / 960 },
        ],
        textQuote: {
          exact: "n so, the electric field stability required to hold Stark shifts...",
          prefix: "",
          suffix: "",
          source: "pdfjs-text-model",
          confidence: "exact",
        },
        startCharIndex: 3,
        endCharIndex: 80,
      },
      style: {
        color: "#ffd400",
        type: "highlight",
      },
      content: "n so, the electric field stability required to hold Stark shifts...",
      author: "user",
      createdAt: 1,
    };

    const repaired = repairPdfTextAnnotationFromModel(annotation, model);

    expect(repaired).not.toBeNull();
    expect(repaired?.target.type).toBe("pdf");
    if (repaired?.target.type === "pdf") {
      expect(repaired.target.textQuote?.exact).toBe(
        "Even so, the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01(100/n)^(7/2) V/cm.",
      );
      expect(repaired.target.startCharIndex).toBe(0);
    }
    expect(repaired?.content).toBe(
      "Even so, the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01(100/n)^(7/2) V/cm.",
    );
  });

  it("repairs a legacy Saffman Fig. 5 quote with dropped boundary characters and merged geometry", () => {
    const model = createSaffmanFigFiveModel();
    const start = model.normalizedText.indexOf("Fig. 5");
    const end = model.normalizedText.indexOf(" V/cm.") + " V/cm.".length;
    const annotation: AnnotationItem = {
      id: "ann-saffman-fig5",
      target: {
        type: "pdf",
        page: 7,
        rects: [
          { x1: 80 / 640, y1: 282 / 960, x2: 510 / 640, y2: 338 / 960 },
        ],
        textQuote: {
          exact: ". 5, that tend to cause shifts in opposite direcns. Even so, the electric field stability required to hold ark shifts below 1 MHz is typically of order 0.01(100",
          prefix: "",
          suffix: "",
          source: "pdfjs-text-model",
          confidence: "exact",
        },
        startCharIndex: start,
        endCharIndex: end,
        textSource: "pdfjs-text-model",
        textConfidence: 1,
      },
      style: {
        color: "#ffd400",
        type: "highlight",
      },
      content: ". 5, that tend to cause shifts in opposite direcns. Even so, the electric field stability required to hold ark shifts below 1 MHz is typically of order 0.01(100",
      author: "user",
      createdAt: 1,
    };

    const repaired = repairPdfTextAnnotationFromModel(annotation, model);

    expect(repaired?.content).toContain("Fig. 5, that tend");
    expect(repaired?.content).toContain("opposite directions. Even so");
    expect(repaired?.content).toContain("Stark shifts below 1 MHz");
    expect(repaired?.content).not.toContain("direcns");
    expect(repaired?.content).not.toMatch(/(^|\s)ark shifts/);
    expect(repaired?.target.type).toBe("pdf");
    if (repaired?.target.type === "pdf") {
      expect(repaired.target.rects.length).toBeGreaterThan(1);
      expect(repaired.target.rects.every((rect) => rect.y2 - rect.y1 < 0.04)).toBe(true);
    }
  });

  it("uses quote context instead of the legacy merged rectangle when the saved Fig. 5 exact starts at punctuation", () => {
    const model = createSaffmanFigFiveModel();
    const start = model.normalizedText.indexOf(". 5, that tend");
    const end = model.normalizedText.indexOf(" V/cm.") + " V/cm.".length;
    expect(start).toBeGreaterThan(0);

    const annotation: AnnotationItem = {
      id: "ann-real-sidecar-fig5",
      target: {
        type: "pdf",
        page: 7,
        rects: [
          { x1: 0.08180486037934669, y1: 0.2929662402432586, x2: 0.4691286880927292, y2: 0.3504093537490697 },
        ],
        textQuote: {
          exact: ". 5, that tend to cause shifts in opposite directions. Even so, the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01(100/n)7/2 V/cm.",
          prefix: " E, as can be inferred from Fig",
          suffix: " In higher electric fields, mixi",
          source: "pdfjs-text-model",
          confidence: "exact",
        },
        textKernelVersion: 1,
        startCharIndex: start,
        endCharIndex: end,
        textSource: "pdfjs-text-model",
        textConfidence: 1,
      },
      style: {
        color: "#FFD400",
        type: "highlight",
      },
      content: ". 5, that tend to cause shifts in opposite directions. Even so, the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01(100/n)7/2 V/cm.",
      author: "user",
      createdAt: 1,
    };

    const repaired = repairPdfTextAnnotationFromModel(annotation, model);

    expect(repaired?.content).toContain("Fig. 5, that tend");
    expect(repaired?.content).not.toMatch(/^\W*5,/);
    expect(repaired?.target.type).toBe("pdf");
    if (repaired?.target.type === "pdf") {
      expect(repaired.target.startCharIndex).toBe(model.normalizedText.indexOf("Fig. 5"));
      expect(repaired.target.rects.length).toBeGreaterThan(1);
      expect(repaired.target.rects.every((rect) => rect.y2 - rect.y1 < 0.04)).toBe(true);
    }
  });

  it("rebuilds rects from the exact quote when the saved quote is shorter than the stale geometry", () => {
    const model = createSaffmanFigFiveModel();
    const exact = "Fig. 5, that tend to cause shifts in opposite direc-";
    const start = model.normalizedText.indexOf(exact);
    const end = start + exact.length;
    expect(start).toBeGreaterThan(0);

    const annotation: AnnotationItem = {
      id: "ann-quote-shorter-than-rects",
      target: {
        type: "pdf",
        page: 7,
        rects: [
          { x1: 80 / 640, y1: 250 / 960, x2: 510 / 640, y2: 274 / 960 },
          { x1: 80 / 640, y1: 282 / 960, x2: 500 / 640, y2: 306 / 960 },
        ],
        textQuote: {
          exact,
          prefix: "of states with equal and opposite Delta E, as can be inferred from ",
          suffix: ". Even so, the electric field stability",
          source: "pdfjs-text-model",
          confidence: "exact",
        },
        startCharIndex: model.normalizedText.indexOf("of states"),
        endCharIndex: end,
        textSource: "pdfjs-text-model",
        textConfidence: 1,
      },
      style: {
        color: "#ffd400",
        type: "highlight",
      },
      content: exact,
      author: "user",
      createdAt: 1,
    };

    const repaired = repairPdfTextAnnotationFromModel(annotation, model);

    expect(repaired).not.toBeNull();
    expect(repaired?.content).toBe(exact);
    expect(repaired?.target.type).toBe("pdf");
    if (repaired?.target.type === "pdf") {
      expect(repaired.target.startCharIndex).toBe(start);
      expect(repaired.target.endCharIndex).toBe(end);
      expect(repaired.target.rects).toHaveLength(1);
      expect(repaired.target.rects[0].y1).toBeCloseTo(282 / 960);
      expect(repaired.target.rects[0].x1).toBeGreaterThan(80 / 640);
      expect(repaired.target.rects[0].x1).toBeLessThan(150 / 640);
      expect(repaired.target.rects[0].x2).toBeCloseTo(500 / 640);
    }
  });

  it("rebuilds ordinary coarse text markup from persisted character offsets", () => {
    const model = createSaffmanFigFiveModel();
    const start = model.normalizedText.indexOf("from Fig. 5");
    const end = model.normalizedText.indexOf(" V/cm.") + " V/cm.".length;
    expect(start).toBeGreaterThanOrEqual(0);

    const annotation: AnnotationItem = {
      id: "ann-ordinary-coarse",
      target: {
        type: "pdf",
        page: 7,
        rects: [
          { x1: 80 / 640, y1: 282 / 960, x2: 540 / 640, y2: 410 / 960 },
        ],
        textQuote: {
          exact: "from Fig. 5, that tend to cause shifts in opposite directions. Even so, the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01(100/n)7/2 V/cm.",
          prefix: "",
          suffix: "",
          source: "pdfjs-text-model",
          confidence: "exact",
        },
        startCharIndex: start,
        endCharIndex: end,
        textSource: "pdfjs-text-model",
        textConfidence: 1,
      },
      style: {
        color: "#ffd400",
        type: "highlight",
      },
      content: "from Fig. 5, that tend to cause shifts in opposite directions. Even so, the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01(100/n)7/2 V/cm.",
      author: "user",
      createdAt: 1,
    };

    const repaired = repairPdfTextAnnotationFromModel(annotation, model);

    expect(repaired).not.toBeNull();
    expect(repaired?.content).toContain("from Fig. 5, that tend");
    expect(repaired?.content).not.toContain("In higher electric fields");
    expect(repaired?.target.type).toBe("pdf");
    if (repaired?.target.type === "pdf") {
      expect(repaired.target.rects.length).toBeGreaterThan(2);
      expect(repaired.target.rects.every((rect) => rect.y2 - rect.y1 < 0.04)).toBe(true);
      expect(repaired.target.rects[0].x1).toBeCloseTo(80 / 640, 2);
      expect(repaired.target.rects.at(-1)?.x2).toBeLessThan(0.45);
      expect(repaired.target.startCharIndex).toBe(start);
      expect(repaired.target.endCharIndex).toBe(end);
    }
  });

  it("does not expand a precise Fig. 5 quote into a stale larger geometry range", () => {
    const model = createSaffmanFigFiveModel();
    const exact = "Fig. 5, that tend to cause shifts in opposite direc-";
    const start = model.normalizedText.indexOf(exact);
    expect(start).toBeGreaterThan(0);

    const annotation: AnnotationItem = {
      id: "ann-do-not-expand-short-fig5",
      target: {
        type: "pdf",
        page: 7,
        rects: [
          { x1: 80 / 640, y1: 250 / 960, x2: 510 / 640, y2: 274 / 960 },
          { x1: 80 / 640, y1: 282 / 960, x2: 500 / 640, y2: 306 / 960 },
          { x1: 80 / 640, y1: 314 / 960, x2: 510 / 640, y2: 338 / 960 },
          { x1: 80 / 640, y1: 346 / 960, x2: 440 / 640, y2: 370 / 960 },
          { x1: 80 / 640, y1: 378 / 960, x2: 250 / 640, y2: 402 / 960 },
        ],
        textQuote: {
          exact,
          prefix: "of states with equal and opposite Delta E, as can be inferred from ",
          suffix: "tions. Even so",
          source: "pdfjs-text-model",
          confidence: "exact",
        },
        startCharIndex: 0,
        endCharIndex: model.normalizedText.length,
        textSource: "pdfjs-text-model",
        textConfidence: 1,
      },
      style: {
        color: "#FFD400",
        type: "highlight",
      },
      content: exact,
      author: "user",
      createdAt: 1,
    };

    const repaired = repairPdfTextAnnotationFromModel(annotation, model);

    expect(repaired).not.toBeNull();
    expect(repaired?.content).toBe(exact);
    expect(repaired?.content).not.toContain("of states with equal");
    expect(repaired?.content).not.toContain("Even so, the electric field");
    expect(repaired?.target.type).toBe("pdf");
    if (repaired?.target.type === "pdf") {
      expect(repaired.target.startCharIndex).toBe(start);
      expect(repaired.target.endCharIndex).toBe(start + exact.length);
      expect(repaired.target.rects).toHaveLength(1);
      expect(repaired.target.rects[0].y1).toBeCloseTo(282 / 960);
    }
  });

  it("refuses a repair candidate that would turn a normal short quote into a multi-paragraph superset", () => {
    const model = createSaffmanFigFiveModel();
    const exact = "Fig. 5, that tend to cause shifts in opposite direc-";
    const annotation: AnnotationItem = {
      id: "ann-refuse-unsafe-expansion",
      target: {
        type: "pdf",
        page: 7,
        rects: [
          { x1: 80 / 640, y1: 250 / 960, x2: 510 / 640, y2: 274 / 960 },
          { x1: 80 / 640, y1: 282 / 960, x2: 500 / 640, y2: 306 / 960 },
          { x1: 80 / 640, y1: 314 / 960, x2: 510 / 640, y2: 338 / 960 },
          { x1: 80 / 640, y1: 346 / 960, x2: 440 / 640, y2: 370 / 960 },
          { x1: 80 / 640, y1: 378 / 960, x2: 250 / 640, y2: 402 / 960 },
        ],
        textQuote: {
          exact: "Fig. 5, that tend to cause shifts in opposite direction",
          prefix: "",
          suffix: "",
          source: "pdfjs-text-model",
          confidence: "exact",
        },
        textSource: "pdfjs-text-model",
        textConfidence: 0.7,
      },
      style: {
        color: "#FFD400",
        type: "highlight",
      },
      content: exact,
      author: "user",
      createdAt: 1,
    };

    const repaired = repairPdfTextAnnotationFromModel(annotation, model);

    expect(repaired).not.toBeNull();
    expect(repaired?.content).toBe("Fig. 5, that tend to cause shifts in opposite direction");
    expect(repaired?.content).not.toContain("of states with equal");
    expect(repaired?.content).not.toContain("Even so, the electric field");
  });

  it("builds a precise programmatic text-markup annotation from an exact PDF quote", () => {
    const model = createSaffmanFigFiveModel();
    const exact = "Fig. 5, that tend to cause shifts in opposite direc-";
    const expectedStart = model.normalizedText.indexOf(exact);
    const annotation = buildCanonicalPdfTextMarkupAnnotationFromExact({
      model,
      exact,
      styleType: "highlight",
      color: "#ffd400",
      author: "ai",
    });

    expect(annotation).not.toBeNull();
    expect(annotation?.content).toBe(exact);
    expect(annotation?.target.type).toBe("pdf");
    if (annotation?.target.type === "pdf") {
      expect(annotation.target.page).toBe(7);
      expect(annotation.target.startCharIndex).toBe(expectedStart);
      expect(annotation.target.endCharIndex).toBe(expectedStart + exact.length);
      expect(annotation.target.textQuote?.exact).toBe(exact);
      expect(annotation.target.rects).toHaveLength(1);
      expect(annotation.target.rects[0].y1).toBeCloseTo(282 / 960);
      expect(annotation.target.rects[0].x1).toBeGreaterThan(80 / 640);
      expect(annotation.target.quads).toHaveLength(annotation.target.rects.length);
      expect(annotation.target.textSource).toBe("pdfjs-text-model");
      expect(annotation.target.textConfidence).toBe(1);
    }
  });
});
