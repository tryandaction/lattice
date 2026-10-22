import { describe, expect, it } from "vitest";

import {
  choosePdfSelectionCandidate,
  reconcilePdfSelectionLineBreakText,
  type PdfSelectionResolutionCandidate,
} from "@/lib/pdf-selection-resolution";
import type { PdfTextQuoteSource } from "@/types/universal-annotation";
import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";

describe("reconcilePdfSelectionLineBreakText", () => {
  const first = "171Yb at Δ = −2 MHz shifts in opposite direc-";
  const second = "tions through a state-of-the-art trap";
  const model: PdfPageTextModel = {
    pageNumber: 7, viewportWidth: 640, viewportHeight: 960,
    items: [], itemRects: [], textContent: { items: [], styles: {}, lang: null },
    normalizedText: `${first} ${second}`,
    segments: [
      { itemIndex: 0, text: first, normalizedText: first, pageTextStart: 0, pageTextEnd: first.length, hasEOL: true, lineIndex: 0, columnIndex: 0 },
      { itemIndex: 1, text: second, normalizedText: second, pageTextStart: first.length + 1, pageTextEnd: first.length + 1 + second.length, hasEOL: false, lineIndex: 1, columnIndex: 0 },
    ],
  };
  const text = "171Yb at Δ = −2 MHz shifts in opposite direc tions through a state-of-the-art trap";
  const canonicalText = "171 Yb at Δ = -2 MHz shifts in opposite directions through a state-of-the-art trap";

  it("joins only model-proven line-break words while preserving scientific symbols and normal spacing", () => {
    expect(reconcilePdfSelectionLineBreakText({
      text, canonicalText, model, startOffset: 0, endOffset: model.normalizedText.length,
    })).toBe("171Yb at Δ = −2 MHz shifts in opposite directions through a state-of-the-art trap");
  });

  it.each(["other-column", "same-line", "unselected-next-line", "canonical-mismatch"])("does not infer a word join from %s", (caseName) => {
    const modifiedModel = {
      ...model,
      segments: model.segments.map((segment, index) => ({
        ...segment,
        columnIndex: caseName === "other-column" ? index : segment.columnIndex,
        lineIndex: caseName === "same-line" ? 0 : segment.lineIndex,
        hasEOL: caseName === "same-line" ? false : segment.hasEOL,
      })),
    };
    expect(reconcilePdfSelectionLineBreakText({
      text, model: modifiedModel,
      canonicalText: caseName === "canonical-mismatch" ? text : canonicalText,
      startOffset: 0,
      endOffset: caseName === "unselected-next-line" ? first.length : model.normalizedText.length,
    })).toBe(text);
  });
});

function candidate(input: {
  source: PdfTextQuoteSource;
  text: string;
  pageNumber?: number;
  startOffset?: number;
  geometryAgreement: number;
  pointerAgreement: number;
  x1?: number;
}): PdfSelectionResolutionCandidate {
  const pageNumber = input.pageNumber ?? 1;
  const startOffset = input.startOffset ?? 10;
  const x1 = input.x1 ?? 0.1;
  return {
    source: input.source,
    geometryAgreement: input.geometryAgreement,
    pointerAgreement: input.pointerAgreement,
    pageNumber,
    startOffset,
    endOffset: startOffset + input.text.length,
    text: input.text,
    textQuote: {
      exact: input.text,
      prefix: "before ",
      suffix: " after",
      source: input.source,
      confidence: input.source === "pdfium-native" ? "validated-native" : "exact",
    },
    pageRects: [{ x1, y1: 0.2, x2: x1 + 0.3, y2: 0.23 }],
    viewportRects: [{ left: x1 * 1000, top: 200, width: 300, height: 30, pageNumber }],
    textSource: input.source,
  };
}

describe("choosePdfSelectionCandidate", () => {
  it("prefers a complete geometry-matching PDFium candidate over unrelated DOM text", () => {
    const dom = candidate({
      source: "dom-selection",
      text: "unrelated right-column sentence",
      geometryAgreement: 0.36,
      pointerAgreement: 0.42,
      x1: 0.58,
    });
    const native = candidate({
      source: "pdfium-native",
      text: "selected left-column sentence",
      geometryAgreement: 0.97,
      pointerAgreement: 0.94,
      x1: 0.08,
    });

    const result = choosePdfSelectionCandidate({
      candidates: [dom, native],
      pointerIntent: { pageNumber: 1, meaningful: true },
    });

    expect(result).toBe(native);
    expect(result?.source).toBe("pdfium-native");
    expect(result?.textQuote.exact).toBe("selected left-column sentence");
  });

  it("rejects a PDFium candidate from another column instead of splicing its text into DOM geometry", () => {
    const dom = candidate({
      source: "dom-selection",
      text: "selected left-column sentence",
      geometryAgreement: 0.93,
      pointerAgreement: 0.9,
      x1: 0.08,
    });
    const wrongColumnNative = candidate({
      source: "pdfium-native",
      text: "wrong right-column sentence",
      geometryAgreement: 0.08,
      pointerAgreement: 0.04,
      x1: 0.6,
    });

    const result = choosePdfSelectionCandidate({
      candidates: [wrongColumnNative, dom],
      pointerIntent: { pageNumber: 1, meaningful: true },
    });

    expect(result).toBe(dom);
    expect(result?.textQuote.exact).toBe("selected left-column sentence");
    expect(result?.pageRects).toBe(dom.pageRects);
  });

  it("filters candidates from a different page when pointer intent is known", () => {
    const wrongPage = candidate({
      source: "pdfium-native",
      text: "wrong page",
      pageNumber: 2,
      geometryAgreement: 1,
      pointerAgreement: 1,
    });
    const currentPage = candidate({
      source: "pdfjs-text-model",
      text: "current page",
      geometryAgreement: 0.8,
      pointerAgreement: 0.8,
    });

    expect(choosePdfSelectionCandidate({
      candidates: [wrongPage, currentPage],
      pointerIntent: { pageNumber: 1, meaningful: true },
    })).toBe(currentPage);
  });

  it("rejects incomplete candidates without mutating the input list", () => {
    const incomplete = candidate({
      source: "pdfium-native",
      text: "",
      geometryAgreement: 1,
      pointerAgreement: 1,
    });
    const candidates = [incomplete];

    expect(choosePdfSelectionCandidate({ candidates })).toBeNull();
    expect(candidates).toEqual([incomplete]);
  });
});
