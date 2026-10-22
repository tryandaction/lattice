import { describe, expect, it } from "vitest";
import {
  buildCanonicalPdfTextMarkupAnnotationFromExact,
  repairPdfTextAnnotationFromModel,
} from "@/lib/pdf-annotation-text-repair";
import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";
import { buildPdfCanonicalChars, resolvePdfVisualColumnScope } from "@/lib/pdf-canonical-text-anchoring";
import { normalizePdfReadableText } from "@/lib/pdf-readable-text";
import type { AnnotationItem } from "@/types/universal-annotation";

const HUIE_EXACT_CAPTION = "(a) The experimental system consists of a glass vacuum cell with one microscope objective on either side. Atoms are illuminated with two retro-reflected probe beams that each have an angle with respect to the xy- and yz-planes. The tweezer array lies parallel to the y-axis. The DC magnetic field and the tweezer electric field point in the y-direction.";

function createExactCaptionModel(text: string): PdfPageTextModel {
  return {
    pageNumber: 2, viewportWidth: 640, viewportHeight: 960,
    textContent: { items: [], styles: {}, lang: null }, items: [], normalizedText: text,
    itemRects: [{ itemIndex: 0, left: 60, top: 120, width: 500, height: 16 }],
    segments: [{ itemIndex: 0, text, normalizedText: text, hasEOL: false, pageTextStart: 0, pageTextEnd: text.length, lineIndex: 0, blockIndex: 0, columnIndex: 0, layoutClass: "main" }],
  };
}

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

function createJenkinsTwoColumnModel(): PdfPageTextModel {
  const leftLines = [
    "at 90 degrees and a 0.6 NA microscope objective. To reach favorable",
    "conditions for loading the tweezers, the atoms are first",
    "captured in a 3D magneto-optical trap (MOT) operating on",
    "the broad, Gamma_b/(2 pi) = 29 MHz, 399 nm P1 transition,",
    "loaded from a 2D MOT [58,59]. The atoms are then",
    "transferred to a narrow MOT that uses the 556 nm P1",
    "transition with linewidth Gamma_g/(2 pi) = 183 kHz. From the",
  ];
  const rightLines = [
    "III. NEAR-DETERMINISTIC LOADING",
    "Reliable assembly of large defect-free patterns of qubits",
    "is a major pursuit for the neutral-atom tweezer array",
    "platform. While the number of atoms loaded from the",
    "MOT into a tweezer follows a Poisson distribution",
  ];
  const viewportWidth = 612;
  const viewportHeight = 792;
  const lineHeight = 12;
  const lineTops = [202, 218, 234, 250, 266, 282, 298];
  const source = [
    ...leftLines.map((text, index) => ({ text, left: 52, top: lineTops[index], width: 245, columnIndex: 0 })),
    ...rightLines.map((text, index) => ({ text, left: index === 0 ? 342 : 326, top: lineTops[index], width: index === 0 ? 191 : 235, columnIndex: 1 })),
  ];
  let offset = 0;
  const segments = source.map((item, itemIndex) => {
    const pageTextStart = offset;
    const pageTextEnd = pageTextStart + item.text.length;
    offset = pageTextEnd + 1;
    return {
      itemIndex,
      text: item.text,
      normalizedText: item.text,
      hasEOL: true,
      pageTextStart,
      pageTextEnd,
      lineIndex: itemIndex < leftLines.length ? itemIndex : itemIndex - leftLines.length,
      blockIndex: item.columnIndex,
      columnIndex: item.columnIndex,
      layoutClass: "main" as const,
    };
  });

  return {
    pageNumber: 3,
    viewportWidth,
    viewportHeight,
    textContent: { items: [], styles: {}, lang: null },
    items: [],
    normalizedText: source.map((item) => item.text).join(" "),
    itemRects: source.map((item, itemIndex) => ({
      itemIndex,
      left: item.left,
      top: item.top,
      width: item.width,
      height: lineHeight,
    })),
    segments,
  };
}

describe("pdf-annotation-text-repair", () => {
  it("preserves all 353 verified Huie caption characters including xy- and when saving exact evidence", () => {
    const model = createExactCaptionModel("FIG. 1. Overview. " + HUIE_EXACT_CAPTION + " An AC magnetic field follows.");
    const annotation = buildCanonicalPdfTextMarkupAnnotationFromExact({ model, exact: HUIE_EXACT_CAPTION,
      styleType: "highlight", color: "#FFD400", author: "ai", preserveExact: true });
    expect(HUIE_EXACT_CAPTION).toHaveLength(353);
    expect(annotation?.content).toBe(HUIE_EXACT_CAPTION);
    expect(annotation?.content).toHaveLength(353);
    expect(annotation?.target.type).toBe("pdf");
    if (annotation?.target.type === "pdf") {
      expect(annotation.target.textQuote?.exact).toBe(HUIE_EXACT_CAPTION);
      expect(model.normalizedText.slice(annotation.target.startCharIndex, annotation.target.endCharIndex)).toBe(HUIE_EXACT_CAPTION);
      expect(annotation.target.rects.length).toBeGreaterThan(0);
      expect(annotation.target.quads).toHaveLength(annotation.target.rects.length);
    }
  });

  it.each([
    { exact: HUIE_EXACT_CAPTION.replace("xy- and", "xyand"), source: HUIE_EXACT_CAPTION },
    { exact: HUIE_EXACT_CAPTION.replace("one microscope", "two microscopes"), source: HUIE_EXACT_CAPTION },
    { exact: HUIE_EXACT_CAPTION, source: HUIE_EXACT_CAPTION + " " + HUIE_EXACT_CAPTION },
  ])("rejects altered or non-unique text in the verified exact save path", ({ exact, source }) => {
    const annotation = buildCanonicalPdfTextMarkupAnnotationFromExact({ model: createExactCaptionModel(source), exact,
      styleType: "highlight", color: "#FFD400", author: "ai", preserveExact: true });
    expect(annotation).toBeNull();
  });

  it("repairs a Jenkins left-column annotation whose stored quote and rects leak into the right column", () => {
    const model = createJenkinsTwoColumnModel();
    const expectedStart = model.normalizedText.indexOf("To reach favorable");
    const expectedEnd = model.normalizedText.indexOf("183 kHz") + "183 kHz".length;
    const staleStart = model.normalizedText.indexOf("ctive. To reach");
    const staleEnd = model.normalizedText.indexOf("183 kHz");
    const annotation: AnnotationItem = {
      id: "ann-jenkins-stale-column",
      target: {
        type: "pdf",
        page: 3,
        rects: [
          { x1: 224 / 612, y1: 202 / 792, x2: 365 / 612, y2: 214 / 792 },
          { x1: 52 / 612, y1: 218 / 792, x2: 362 / 612, y2: 230 / 792 },
          { x1: 52 / 612, y1: 234 / 792, x2: 350 / 612, y2: 246 / 792 },
          { x1: 52 / 612, y1: 250 / 792, x2: 345 / 612, y2: 262 / 792 },
          { x1: 52 / 612, y1: 266 / 792, x2: 356 / 612, y2: 278 / 792 },
          { x1: 52 / 612, y1: 282 / 792, x2: 342 / 612, y2: 294 / 792 },
          { x1: 52 / 612, y1: 298 / 792, x2: 251 / 612, y2: 310 / 792 },
        ],
        textQuote: {
          exact: model.normalizedText.slice(staleStart, staleEnd),
          prefix: "90 degrees and a 0.6 NA microscope obje",
          suffix: "183 kHz. From the narrow green MOT",
          source: "pdfjs-text-model",
          confidence: "exact",
        },
        startCharIndex: staleStart,
        endCharIndex: staleEnd,
        textSource: "pdfjs-text-model",
        textConfidence: 1,
      },
      style: { color: "#E56EEE", type: "highlight" },
      content: model.normalizedText.slice(staleStart, staleEnd),
      author: "user",
      createdAt: 1,
    };

    const canonicalChars = buildPdfCanonicalChars(model);
    const visualScope = resolvePdfVisualColumnScope({
      chars: canonicalChars,
      viewportWidth: model.viewportWidth,
      verticalRange: { top: 202, bottom: 310 },
      startX: 52,
      endX: 52,
    });
    expect(visualScope).not.toBeNull();

    const repaired = repairPdfTextAnnotationFromModel(annotation, model);

    expect(repaired).not.toBeNull();
    expect(repaired?.content).toBe(normalizePdfReadableText(model.normalizedText.slice(expectedStart, expectedEnd)));
    expect(repaired?.content).not.toContain("NEAR-DETERMINISTIC");
    expect(repaired?.target.type).toBe("pdf");
    if (repaired?.target.type === "pdf") {
      expect(repaired.target.startCharIndex).toBe(expectedStart);
      expect(repaired.target.endCharIndex).toBe(expectedEnd);
      expect(Math.max(...repaired.target.rects.map((rect) => rect.x2))).toBeLessThan(0.5);
    }
  });

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
