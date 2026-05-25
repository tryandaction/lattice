/**
 * @vitest-environment jsdom
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  choosePreferredNativeSelection,
  resolvePdfSelectionFromNativeRange,
  type PdfRenderedPageContext,
  type PdfResolvedSelection,
} from "../pdf-selection-reconciler";
import type { PdfTextQuoteSource } from "@/types/universal-annotation";

const originalRangeGetBoundingClientRect = Range.prototype.getBoundingClientRect;
const originalRangeGetClientRects = Range.prototype.getClientRects;

function createMockRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function createMockRectList(rects: DOMRect[]): DOMRectList {
  const list = rects as unknown as DOMRectList & DOMRect[];
  Object.defineProperty(list, "item", {
    configurable: true,
    value: (index: number) => rects[index] ?? null,
  });
  return list;
}

function createFragmentSelectionRect(textNode: Text, startOffset: number, endOffset: number): DOMRect | null {
  const parentElement = textNode.parentElement;
  if (parentElement?.dataset.pdfFragment !== "true") {
    return null;
  }
  const fullText = textNode.textContent ?? "";
  const totalLength = Math.max(1, fullText.length);
  const left = Number(parentElement.dataset.left ?? 0);
  const top = Number(parentElement.dataset.top ?? 0);
  const width = Number(parentElement.dataset.width ?? 0);
  const height = Number(parentElement.dataset.height ?? 0);
  const startRatio = startOffset / totalLength;
  const endRatio = endOffset / totalLength;
  return createMockRect(
    left + width * startRatio,
    top,
    Math.max(0, width * (endRatio - startRatio)),
    height,
  );
}

function getMockRangeClientRects(range: Range): DOMRect[] {
  if (range.startContainer === range.endContainer && range.startContainer instanceof Text) {
    const rect = createFragmentSelectionRect(range.startContainer, range.startOffset, range.endOffset);
    return rect ? [rect] : [];
  }

  const rects: DOMRect[] = [];
  const fragments = Array.from(document.querySelectorAll<HTMLElement>('[data-pdf-fragment="true"]'));
  fragments.forEach((fragment) => {
    const textNode = fragment.firstChild;
    if (!(textNode instanceof Text) || !range.intersectsNode(fragment)) {
      return;
    }
    const startOffset = textNode === range.startContainer ? range.startOffset : 0;
    const endOffset = textNode === range.endContainer ? range.endOffset : (textNode.textContent?.length ?? 0);
    if (endOffset <= startOffset) {
      return;
    }
    const rect = createFragmentSelectionRect(textNode, startOffset, endOffset);
    if (rect) {
      rects.push(rect);
    }
  });

  return rects;
}

function createPageContext(input: {
  pageNumber?: number;
  top?: number;
  fragments: Array<{
    text: string;
    left: number;
    top: number;
    width: number;
    height: number;
  }>;
}): PdfRenderedPageContext {
  const pageNumber = input.pageNumber ?? 1;
  const pageTop = input.top ?? 0;
  const pageElement = document.createElement("div");
  pageElement.dataset.pageNumber = String(pageNumber);
  Object.defineProperty(pageElement, "getBoundingClientRect", {
    configurable: true,
    value: () => createMockRect(0, pageTop, 640, 960),
  });

  const textLayer = document.createElement("div");
  textLayer.className = "textLayer";
  pageElement.appendChild(textLayer);

  input.fragments.forEach((fragment) => {
    const span = document.createElement("span");
    span.dataset.pdfFragment = "true";
    span.dataset.left = String(fragment.left);
    span.dataset.top = String(pageTop + fragment.top);
    span.dataset.width = String(fragment.width);
    span.dataset.height = String(fragment.height);
    span.textContent = fragment.text;
    Object.defineProperty(span, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(fragment.left, pageTop + fragment.top, fragment.width, fragment.height),
    });
    textLayer.appendChild(span);
  });

  document.body.appendChild(pageElement);

  return {
    pageNumber,
    width: 640,
    height: 960,
    element: pageElement,
  };
}

function getFragmentTextNode(fragmentText: string, index = 0): Text {
  const matches = Array.from(document.querySelectorAll("span"))
    .filter((span) => span.textContent === fragmentText);
  const match = matches[index];
  const textNode = match?.firstChild;
  if (!(textNode instanceof Text)) {
    throw new Error(`Missing text node for fragment: ${fragmentText}`);
  }
  return textNode;
}

function createRangeWithinFragment(fragmentText: string, selectedText: string, index = 0): Range {
  const textNode = getFragmentTextNode(fragmentText, index);
  const start = textNode.textContent?.indexOf(selectedText) ?? -1;
  if (start < 0) {
    throw new Error(`Selected text "${selectedText}" not found in fragment "${fragmentText}"`);
  }
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + selectedText.length);
  return range;
}

function createRangeAcrossFragments(input: {
  startFragment: string;
  startOffset?: number;
  endFragment: string;
  endOffset?: number;
  startIndex?: number;
  endIndex?: number;
}): Range {
  const startNode = getFragmentTextNode(input.startFragment, input.startIndex ?? 0);
  const endNode = getFragmentTextNode(input.endFragment, input.endIndex ?? 0);
  const range = document.createRange();
  range.setStart(startNode, input.startOffset ?? 0);
  range.setEnd(endNode, input.endOffset ?? (endNode.textContent?.length ?? 0));
  return range;
}

function createResolvedSelection(input: {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  source?: PdfTextQuoteSource;
}): PdfResolvedSelection {
  const viewportRect = {
    left: input.left,
    top: input.top,
    width: input.width,
    height: input.height,
    pageNumber: 1,
  };
  return {
    pageNumber: 1,
    startOffset: 0,
    endOffset: input.text.length,
    text: input.text,
    textQuote: {
      exact: input.text,
      prefix: "",
      suffix: "",
      source: input.source ?? "pdfium-native",
      confidence: "validated-native",
    },
    pageRects: [{
      x1: input.left / 640,
      y1: input.top / 960,
      x2: (input.left + input.width) / 640,
      y2: (input.top + input.height) / 960,
    }],
    viewportRects: [viewportRect],
  };
}

beforeAll(() => {
  Range.prototype.getBoundingClientRect = function mockGetBoundingClientRect() {
    const rects = getMockRangeClientRects(this);
    if (rects.length > 0) {
      const left = Math.min(...rects.map((rect) => rect.left));
      const top = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      return createMockRect(left, top, right - left, bottom - top);
    }

    return createMockRect(0, 0, 0, 0);
  };

  Range.prototype.getClientRects = function mockGetClientRects() {
    const rects = getMockRangeClientRects(this);
    if (rects.length === 0) {
      return createMockRectList([]);
    }
    return createMockRectList(rects);
  };
});

afterAll(() => {
  Range.prototype.getBoundingClientRect = originalRangeGetBoundingClientRect;
  Range.prototype.getClientRects = originalRangeGetClientRects;
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("pdf-selection-reconciler", () => {
  it("extracts the exact selected word from a large text item", () => {
    const page = createPageContext({
      fragments: [
        { text: "quantum computation.", left: 20, top: 24, width: 520, height: 24 },
      ],
    });
    const range = createRangeWithinFragment("quantum computation.", "computation.");

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: range.toString(),
      pages: [page],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.text).toBe("computation.");
      expect(result.selection.textQuote.exact).toBe("computation.");
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(228 / 640, 3);
      expect(result.selection.pageRects[0]?.x2).toBeCloseTo(540 / 640, 3);
    }
  });

  it("uses substring geometry instead of the whole text-layer span", () => {
    const page = createPageContext({
      fragments: [
        { text: "Here we demonstrate a new neutral atom qubit", left: 40, top: 24, width: 420, height: 24 },
      ],
    });
    const range = createRangeWithinFragment(
      "Here we demonstrate a new neutral atom qubit",
      "new neutral atom qubit",
    );

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: range.toString(),
      pages: [page],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const fullText = "Here we demonstrate a new neutral atom qubit";
      const selectedText = "new neutral atom qubit";
      const startRatio = fullText.indexOf(selectedText) / fullText.length;
      const expectedLeft = (40 + (420 * startRatio)) / 640;
      const expectedWidth = (420 * (selectedText.length / fullText.length)) / 640;

      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(expectedLeft, 3);
      expect(result.selection.pageRects[0] ? result.selection.pageRects[0].x2 - result.selection.pageRects[0].x1 : 0)
        .toBeCloseTo(expectedWidth, 3);
      expect(result.selection.pageRects[0]?.x1).toBeGreaterThan(40 / 640);
      expect(result.selection.pageRects[0] ? result.selection.pageRects[0].x2 - result.selection.pageRects[0].x1 : 1)
        .toBeLessThan(420 / 640);
    }
  });

  it("clips stored highlight geometry to text offsets when browser selection rect is overwide", () => {
    const line = "In our system, it is experimentally feasible to increase the system size";
    const selectedText = "In our system, it is experimentally feasible";
    const lineLeft = 48;
    const lineTop = 88;
    const lineWidth = 560;
    const page = createPageContext({
      fragments: [
        { text: line, left: lineLeft, top: lineTop, width: lineWidth, height: 24 },
      ],
    });
    const range = createRangeWithinFragment(line, selectedText);
    const expectedRight = lineLeft + (lineWidth * (selectedText.length / line.length));

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: selectedText,
      pages: [page],
      clientRects: [{
        left: lineLeft,
        right: lineLeft + lineWidth,
        top: lineTop,
        bottom: lineTop + 24,
      }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const rect = result.selection.pageRects[0];
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(rect?.x1).toBeCloseTo(lineLeft / 640, 3);
      expect(rect?.x2).toBeCloseTo(expectedRight / 640, 3);
      expect(rect?.x2).toBeLessThan((lineLeft + lineWidth) / 640 - 0.1);
    }
  });

  it("keeps author-line geometry text when live DOM selection drifts to affiliations", () => {
    const authorLine = "Dolev Bluvstein, Simon J. Evered, Alexandra A. Geim";
    const selectedText = "Simon J. Evered";
    const wrongLiveText = ", Massachusetts Institute of Technology";
    const lineLeft = 154;
    const lineTop = 104;
    const lineWidth = 690;
    const charWidth = lineWidth / authorLine.length;
    const selectedStart = authorLine.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);
    const page = createPageContext({
      fragments: [
        { text: authorLine, left: lineLeft, top: lineTop, width: lineWidth, height: 24 },
        { text: wrongLiveText, left: 220, top: 156, width: 520, height: 18 },
      ],
    });
    const range = createRangeWithinFragment(authorLine, selectedText);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: wrongLiveText,
      pages: [page],
      clientRects: [{
        left: selectedLeft,
        right: selectedRight,
        top: lineTop,
        bottom: lineTop + 24,
      }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.text).toBe(selectedText);
      expect(result.selection.textQuote.exact).not.toContain("Massachusetts");
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(selectedLeft / 640, 3);
      expect(result.selection.pageRects[0]?.x2).toBeCloseTo(selectedRight / 640, 3);
    }
  });

  it("uses pointer-local author text on complex article mastheads when DOM text drifts", () => {
    const authorLine = "Dolev Bluvstein, Simon J. Evered, Alexandra A. Geim, Sophie H. Li";
    const selectedText = "Simon J. Evered";
    const wrongLiveText = "Received: 21 October 2023 Accepted: 1 December 2023";
    const lineLeft = 250;
    const lineTop = 168;
    const lineWidth = 720;
    const charWidth = lineWidth / authorLine.length;
    const selectedStart = authorLine.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);
    const page = createPageContext({
      fragments: [
        { text: "https://doi.org/10.1038/s41586-023-06927-3", left: 40, top: 168, width: 360, height: 20 },
        { text: "Received: 21 October 2023", left: 40, top: 206, width: 260, height: 20 },
        { text: authorLine, left: lineLeft, top: lineTop, width: lineWidth, height: 22 },
        { text: wrongLiveText, left: 40, top: 240, width: 420, height: 20 },
      ],
    });
    const range = createRangeWithinFragment("Received: 21 October 2023", "Received: 21 October 2023");

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: wrongLiveText,
      pages: [page],
      clientRects: [{
        left: selectedLeft,
        right: selectedRight,
        top: lineTop,
        bottom: lineTop + 22,
      }],
      dragStartPoint: { x: selectedLeft + 1, y: lineTop + 11 },
      dragEndPoint: { x: selectedRight - 1, y: lineTop + 11 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.textQuote.exact).not.toContain("Received");
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(selectedLeft / 640, 3);
      expect(result.selection.pageRects[0]?.x2).toBeCloseTo(selectedRight / 640, 3);
    }
  });

  it("keeps dense body text selection on the visually selected row", () => {
    const firstLine = "the overhead in the realization of error-corrected logical qubits";
    const secondLine = "information is encoded across many physical qubits for redundancy";
    const selectedText = "many physical qubits";
    const lineLeft = 210;
    const firstTop = 320;
    const secondTop = 346;
    const lineWidth = 560;
    const charWidth = lineWidth / secondLine.length;
    const selectedStart = secondLine.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);
    const page = createPageContext({
      fragments: [
        { text: firstLine, left: lineLeft, top: firstTop, width: lineWidth, height: 24 },
        { text: secondLine, left: lineLeft, top: secondTop, width: lineWidth, height: 24 },
      ],
    });
    const range = createRangeWithinFragment(firstLine, "logical qubits");

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "logical qubits",
      pages: [page],
      clientRects: [{
        left: selectedLeft,
        right: selectedRight,
        top: secondTop + 1,
        bottom: secondTop + 23,
      }],
      dragStartPoint: { x: selectedLeft + 1, y: secondTop + 12 },
      dragEndPoint: { x: selectedRight - 1, y: secondTop + 12 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.textQuote.exact).not.toContain("logical qubits");
      expect(result.selection.pageRects[0]?.y1).toBeCloseTo((secondTop + 1) / 960, 2);
    }
  });

  it("keeps table-like selections inside the visually selected column block", () => {
    const page = createPageContext({
      fragments: [
        { text: "Feature", left: 40, top: 120, width: 120, height: 22 },
        { text: "Description", left: 260, top: 120, width: 180, height: 22 },
        { text: "alpha", left: 40, top: 152, width: 90, height: 22 },
        { text: "robust anomaly detection", left: 260, top: 152, width: 240, height: 22 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: "alpha",
      endFragment: "robust anomaly detection",
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "robust anomaly detection",
      pages: [page],
      clientRects: [{
        left: 260,
        right: 500,
        top: 152,
        bottom: 174,
      }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe("robust anomaly detection");
      expect(result.selection.textQuote.exact).not.toContain("alpha");
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(260 / 640, 3);
    }
  });

  it("keeps mixed Chinese-English inline text aligned to the selected formatted span", () => {
    const page = createPageContext({
      fragments: [
        { text: "模型输出 y_pred 必须对应 test_complex.csv", left: 60, top: 220, width: 420, height: 24 },
        { text: "附加说明", left: 500, top: 220, width: 100, height: 24 },
      ],
    });
    const selectedText = "y_pred";
    const range = createRangeWithinFragment("模型输出 y_pred 必须对应 test_complex.csv", selectedText);
    const line = "模型输出 y_pred 必须对应 test_complex.csv";
    const start = line.indexOf(selectedText);
    const charWidth = 420 / line.length;
    const selectedLeft = 60 + (start * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: selectedText,
      pages: [page],
      clientRects: [{
        left: selectedLeft,
        right: selectedRight,
        top: 220,
        bottom: 244,
      }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.textQuote.exact).not.toContain("附加说明");
    }
  });

  it("keeps inline formula selections aligned when superscripts and subscripts are split across fragments", () => {
    const selectedText = "T2* = 3.7(4) s";
    const page = createPageContext({
      fragments: [
        { text: "The coherence time ", left: 80, top: 120, width: 150, height: 24 },
        { text: "T", left: 232, top: 120, width: 14, height: 24 },
        { text: "2", left: 246, top: 130, width: 8, height: 12 },
        { text: "*", left: 255, top: 112, width: 8, height: 12 },
        { text: " = 3.7(4) s", left: 264, top: 120, width: 96, height: 24 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: "T",
      endFragment: " = 3.7(4) s",
      endOffset: " = 3.7(4) s".length,
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: selectedText,
      pages: [page],
      clientRects: [{
        left: 232,
        right: 360,
        top: 112,
        bottom: 144,
      }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(232 / 640, 3);
      expect(result.selection.pageRects[0]?.x2).toBeCloseTo(360 / 640, 3);
    }
  });

  it("keeps display equation selections inside the equation block instead of drifting to surrounding prose", () => {
    const prose = "We estimate the dephasing rate from the Hamiltonian below.";
    const selectedText = "\u03a9 = \u221a(\u03942 + g2)";
    const page = createPageContext({
      fragments: [
        { text: prose, left: 60, top: 120, width: 420, height: 24 },
        { text: "\u03a9 = ", left: 180, top: 186, width: 44, height: 28 },
        { text: "\u221a(", left: 224, top: 180, width: 18, height: 34 },
        { text: "\u0394", left: 242, top: 186, width: 16, height: 28 },
        { text: "2", left: 258, top: 176, width: 8, height: 12 },
        { text: " + ", left: 266, top: 186, width: 24, height: 28 },
        { text: "g", left: 290, top: 186, width: 14, height: 28 },
        { text: "2", left: 304, top: 176, width: 8, height: 12 },
        { text: ")", left: 312, top: 180, width: 10, height: 34 },
        { text: "where g is the coupling strength.", left: 60, top: 250, width: 320, height: 24 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: "\u03a9 = ",
      endFragment: ")",
      endOffset: 1,
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: selectedText,
      pages: [page],
      clientRects: [{
        left: 180,
        right: 322,
        top: 176,
        bottom: 214,
      }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.textQuote.exact).not.toContain("Hamiltonian");
      expect(result.selection.textQuote.exact).not.toContain("coupling strength");
      expect(result.selection.pageRects[0]?.y1).toBeCloseTo(176 / 960, 3);
      expect(result.selection.pageRects[0]?.y2).toBeCloseTo(214 / 960, 3);
    }
  });

  it("expands short pointer selections to the visual word instead of accepting a stray digit", () => {
    const line = "a single lattice site. Furthermore, we show how a Mott insulator";
    const selectedText = "Furthermore";
    const lineLeft = 130;
    const lineTop = 288;
    const lineWidth = 620;
    const charWidth = lineWidth / line.length;
    const selectedStart = line.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);
    const page = createPageContext({
      fragments: [
        { text: "0", left: 540, top: 214, width: 12, height: 12 },
        { text: line, left: lineLeft, top: lineTop, width: lineWidth, height: 24 },
      ],
    });
    const range = createRangeWithinFragment("0", "0");

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "0",
      pages: [page],
      clientRects: [{
        left: selectedLeft,
        right: selectedRight,
        top: lineTop,
        bottom: lineTop + 24,
      }],
      dragStartPoint: { x: selectedLeft + (charWidth * 2), y: lineTop + 12 },
      dragEndPoint: { x: selectedLeft + (charWidth * 2.4), y: lineTop + 12 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.textQuote.exact).not.toBe("0");
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(selectedLeft / 640, 2);
      expect(result.selection.pageRects[0]?.x2).toBeCloseTo(selectedRight / 640, 2);
    }
  });

  it("uses pointer-local word even when the DOM selection rect also drifts to a stray digit", () => {
    const line = "a single lattice site. Furthermore, we show how a Mott insulator";
    const selectedText = "Furthermore";
    const lineLeft = 130;
    const lineTop = 288;
    const lineWidth = 620;
    const charWidth = lineWidth / line.length;
    const selectedStart = line.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);
    const page = createPageContext({
      fragments: [
        { text: "0", left: 540, top: 214, width: 12, height: 12 },
        { text: line, left: lineLeft, top: lineTop, width: lineWidth, height: 24 },
      ],
    });
    const range = createRangeWithinFragment("0", "0");

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "0",
      pages: [page],
      clientRects: [{
        left: 540,
        right: 552,
        top: 214,
        bottom: 226,
      }],
      dragStartPoint: { x: selectedLeft + (charWidth * 2), y: lineTop + 12 },
      dragEndPoint: { x: selectedLeft + (charWidth * 2.4), y: lineTop + 12 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.textQuote.exact).not.toBe("0");
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(selectedLeft / 640, 2);
      expect(result.selection.pageRects[0]?.x2).toBeCloseTo(selectedRight / 640, 2);
    }
  });

  it("extracts multi-fragment text as a single canonical phrase", () => {
    const page = createPageContext({
      fragments: [
        { text: "These", left: 20, top: 24, width: 60, height: 24 },
        { text: "were", left: 96, top: 24, width: 56, height: 24 },
        { text: "enumerated", left: 168, top: 24, width: 124, height: 24 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: "These",
      endFragment: "enumerated",
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: range.toString(),
      pages: [page],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.text).toBe("These were enumerated");
      expect(result.selection.textQuote.exact).toBe("These were enumerated");
    }
  });

  it("does not cross into the other column when the range only covers one column", () => {
    const page = createPageContext({
      fragments: [
        { text: "left column", left: 20, top: 24, width: 140, height: 24 },
        { text: "right column", left: 340, top: 24, width: 160, height: 24 },
      ],
    });
    const range = createRangeWithinFragment("right column", "right column");

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: range.toString(),
      pages: [page],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.text).toBe("right column");
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(340 / 640, 3);
    }
  });

  it("prefers the candidate that overlaps the selected geometry when text distance ties", () => {
    const domSelectedText = "repeat phrase";
    const referenceRects = [{
      left: 300,
      top: 120,
      width: 160,
      height: 24,
      pageNumber: 1,
    }];
    const geometrySelection = createResolvedSelection({
      text: domSelectedText,
      left: 300,
      top: 120,
      width: 160,
      height: 24,
    });
    const offsetSelection = createResolvedSelection({
      text: domSelectedText,
      left: 24,
      top: 720,
      width: 160,
      height: 24,
    });

    const result = choosePreferredNativeSelection({
      offsetSelection,
      geometrySelection,
      textSearchSelection: null,
      domSelectedText,
      viewportRectCount: referenceRects.length,
      viewportRects: referenceRects,
    });

    expect(result).toBe(geometrySelection);
  });

  it("uses frozen selection geometry when the DOM range drifts to later text on the same line", () => {
    const line = "fast, high-fidelity excitation to the Rydberg state21 and mid-circuit";
    const lineLeft = 40;
    const lineTop = 120;
    const charWidth = 8;
    const page = createPageContext({
      fragments: [
        { text: line, left: lineLeft, top: lineTop, width: line.length * charWidth, height: 24 },
      ],
    });
    const wrongDomText = "o the Rydberg state21";
    const intendedText = "high-fidelity exci";
    const range = createRangeWithinFragment(line, wrongDomText);
    const intendedStart = line.indexOf(intendedText);
    const intendedLeft = lineLeft + (intendedStart * charWidth);
    const intendedRight = intendedLeft + (intendedText.length * charWidth);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: wrongDomText,
      pages: [page],
      clientRects: [{
        left: intendedLeft,
        right: intendedRight,
        top: lineTop,
        bottom: lineTop + 24,
      }],
      nativeLayout: {
        source: "pdfium",
        pageNumber: 1,
        width: 640,
        height: 960,
        text: line,
        chars: Array.from(line).map((character, index) => ({
          charIndex: index,
          text: character,
          x1: lineLeft + (index * charWidth),
          y1: lineTop,
          x2: lineLeft + ((index + 1) * charWidth),
          y2: lineTop + 24,
          fontSize: 24,
        })),
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(intendedText);
      expect(["pdfium-native", "pdfjs-text-model"]).toContain(result.selection.textQuote.source);
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(intendedLeft / 640, 3);
    }
  });

  it("uses frozen selection geometry as a rendered-text fallback without a native layout", () => {
    const line = "fast, high-fidelity excitation to the Rydberg state21 and mid-circuit";
    const lineLeft = 40;
    const lineTop = 120;
    const charWidth = 8;
    const page = createPageContext({
      fragments: [
        { text: line, left: lineLeft, top: lineTop, width: line.length * charWidth, height: 24 },
      ],
    });
    const wrongDomText = "o the Rydberg state21";
    const intendedText = "high-fidelity exci";
    const range = createRangeWithinFragment(line, wrongDomText);
    const intendedStart = line.indexOf(intendedText);
    const intendedLeft = lineLeft + (intendedStart * charWidth);
    const intendedRight = intendedLeft + (intendedText.length * charWidth);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: wrongDomText,
      pages: [page],
      clientRects: [{
        left: intendedLeft,
        right: intendedRight,
        top: lineTop,
        bottom: lineTop + 24,
      }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(intendedText);
      expect(result.selection.textQuote.source).toBe("pdfjs-text-model");
    }
  });

  it("uses rendered pointer bounds when a short literature selection drifts later on the same line", () => {
    const line = "The development of scalable, high-fidelity qubits is a key challenge in quantum";
    const lineLeft = 80;
    const lineTop = 560;
    const charWidth = 7.5;
    const page = createPageContext({
      fragments: [
        { text: line, left: lineLeft, top: lineTop, width: line.length * charWidth, height: 22 },
      ],
    });
    const intendedText = "development";
    const wrongDomText = "able, high-fid";
    const range = createRangeWithinFragment(line, wrongDomText);
    const intendedStart = line.indexOf(intendedText);
    const intendedEnd = intendedStart + intendedText.length;
    const intendedLeft = lineLeft + (intendedStart * charWidth);
    const intendedRight = lineLeft + (intendedEnd * charWidth);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: wrongDomText,
      pages: [page],
      dragStartPoint: { x: intendedLeft + 1, y: lineTop + 11 },
      dragEndPoint: { x: intendedRight - 1, y: lineTop + 11 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.text).toBe(intendedText);
      expect(result.selection.textQuote.exact).toBe(intendedText);
      expect(result.selection.textQuote.source).toBe("pdfjs-text-model");
      expect(result.selection.textQuote.exact).not.toContain("able");
      expect(result.selection.textQuote.exact).not.toContain("high-fid");
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(intendedLeft / 640, 3);
      expect(result.selection.pageRects[0]?.x2).toBeCloseTo(intendedRight / 640, 3);
    }
  });

  it("keeps the live DOM quote when PDF offsets drift to later Rydberg text", () => {
    const line = "fast, high-fidelity excitation to the Rydberg state21 and mid-circuit";
    const lineLeft = 40;
    const lineTop = 120;
    const charWidth = 8;
    const page = createPageContext({
      fragments: [
        { text: line, left: lineLeft, top: lineTop, width: line.length * charWidth, height: 24 },
      ],
    });
    const wrongOffsetText = "to the Rydberg state21";
    const liveSelectedText = "high-fidelity excitation";
    const range = createRangeWithinFragment(line, wrongOffsetText);
    const intendedStart = line.indexOf(liveSelectedText);
    const intendedLeft = lineLeft + (intendedStart * charWidth);
    const intendedRight = intendedLeft + (liveSelectedText.length * charWidth);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: liveSelectedText,
      pages: [page],
      clientRects: [{
        left: intendedLeft,
        right: intendedRight,
        top: lineTop,
        bottom: lineTop + 24,
      }],
      nativeLayout: {
        source: "pdfium",
        pageNumber: 1,
        width: 640,
        height: 960,
        text: line,
        chars: Array.from(line).map((character, index) => ({
          charIndex: index,
          text: character,
          x1: lineLeft + (index * charWidth),
          y1: lineTop,
          x2: lineLeft + ((index + 1) * charWidth),
          y2: lineTop + 24,
          fontSize: 24,
        })),
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.text).toBe(liveSelectedText);
      expect(result.selection.textQuote.exact).toBe(liveSelectedText);
      expect(result.selection.textQuote.source).toBe("dom-selection");
      expect(result.selection.textQuote.exact).not.toContain("Rydberg");
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(intendedLeft / 640, 3);
      expect(result.selection.pageRects[0]?.x2).toBeCloseTo(intendedRight / 640, 3);
    }
  });

  it("rejects desktop native rects that drift before the browser selection geometry", () => {
    const line = "The development of scalable, high-fidelity qubits is a key challenge in quantum";
    const lineLeft = 80;
    const lineTop = 560;
    const charWidth = 7.5;
    const page = createPageContext({
      fragments: [
        { text: line, left: lineLeft, top: lineTop, width: line.length * charWidth, height: 22 },
      ],
    });
    const selectedText = "scalable, high-fidelity";
    const range = createRangeWithinFragment(line, selectedText);
    const selectedStart = line.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);
    const nativeDriftLeft = lineLeft - (selectedStart * charWidth);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: selectedText,
      pages: [page],
      clientRects: [{
        left: selectedLeft,
        right: selectedRight,
        top: lineTop,
        bottom: lineTop + 22,
      }],
      nativeLayout: {
        source: "pdfium",
        pageNumber: 1,
        width: 640,
        height: 960,
        text: line,
        chars: Array.from(line).map((character, index) => ({
          charIndex: index,
          text: character,
          x1: nativeDriftLeft + (index * charWidth),
          y1: lineTop,
          x2: nativeDriftLeft + ((index + 1) * charWidth),
          y2: lineTop + 22,
          fontSize: 22,
        })),
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.textQuote.source).not.toBe("pdfium-native");
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(selectedLeft / 640, 3);
      expect(result.selection.pageRects[0]?.x2).toBeCloseTo(selectedRight / 640, 3);
      expect(result.selection.pageRects[0]?.x1).toBeGreaterThan((nativeDriftLeft + 60) / 640);
    }
  });

  it("keeps multi-line DOM client rects narrower than full text-layer spans", () => {
    const firstLine = "We discuss theoretical and formal perspectives on";
    const secondLine = "algorithmic bias, connect those perspectives to the machine learning pipeline, and";
    const page = createPageContext({
      fragments: [
        { text: firstLine, left: 240, top: 200, width: 420, height: 24 },
        { text: secondLine, left: 80, top: 236, width: 620, height: 24 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: firstLine,
      startOffset: 3,
      endFragment: secondLine,
      endOffset: 32,
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "discuss theoretical and formal perspectives on algorithmic bias, connect",
      pages: [page],
      clientRects: [
        { left: 272, right: 638, top: 200, bottom: 224 },
        { left: 80, right: 392, top: 236, bottom: 260 },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.pageRects).toHaveLength(2);
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(266 / 640, 3);
      expect(result.selection.pageRects[0]?.x2).toBeCloseTo(1, 3);
      expect(result.selection.pageRects[1]?.x1).toBeCloseTo(80 / 640, 3);
      expect(result.selection.pageRects[1]?.x2).toBeCloseTo(322 / 640, 3);
    }
  });

  it("does not pull a superscript citation into the selected quote", () => {
    const page = createPageContext({
      fragments: [
        { text: "high-fidelity excitation", left: 80, top: 120, width: 216, height: 24 },
        { text: "21", left: 300, top: 108, width: 18, height: 10 },
        { text: "to the Rydberg state", left: 324, top: 120, width: 190, height: 24 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: "high-fidelity excitation",
      endFragment: "21",
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "high-fidelity excitation",
      pages: [page],
      clientRects: [{
        left: 80,
        right: 296,
        top: 120,
        bottom: 144,
      }],
      nativeLayout: {
        source: "pdfium",
        pageNumber: 1,
        width: 640,
        height: 960,
        text: "high-fidelity excitation21 to the Rydberg state",
        chars: [
          ...Array.from("high-fidelity excitation").map((character, index) => ({
            charIndex: index,
            text: character,
            x1: 80 + (index * 9),
            y1: 120,
            x2: 87 + (index * 9),
            y2: 144,
            fontSize: 24,
          })),
          { charIndex: 24, text: "2", x1: 300, y1: 108, x2: 308, y2: 118, fontSize: 10 },
          { charIndex: 25, text: "1", x1: 310, y1: 108, x2: 318, y2: 118, fontSize: 10 },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe("high-fidelity excitation");
      expect(result.selection.textQuote.exact).not.toContain("21");
      expect(result.selection.pageRects[0]?.x2).toBeLessThan(300 / 640);
    }
  });

  it("keeps cross-span selections aligned when browser text is authoritative", () => {
    const page = createPageContext({
      fragments: [
        { text: "high-", left: 80, top: 120, width: 45, height: 24 },
        { text: "fidelity", left: 126, top: 120, width: 68, height: 24 },
        { text: "excitation", left: 204, top: 120, width: 90, height: 24 },
        { text: "to the Rydberg state", left: 320, top: 120, width: 180, height: 24 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: "high-",
      endFragment: "excitation",
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "high-fidelity excitation",
      pages: [page],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe("high-fidelity excitation");
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(80 / 640, 3);
      const rightEdge = Math.max(...result.selection.pageRects.map((rect) => rect.x2));
      expect(rightEdge).toBeCloseTo(294 / 640, 3);
    }
  });

  it("uses geometry to disambiguate duplicate text in a two-column layout", () => {
    const page = createPageContext({
      fragments: [
        { text: "high-fidelity excitation", left: 60, top: 160, width: 220, height: 24 },
        { text: "high-fidelity excitation", left: 360, top: 160, width: 220, height: 24 },
      ],
    });
    const range = createRangeWithinFragment("high-fidelity excitation", "high-fidelity excitation", 0);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "high-fidelity excitation",
      pages: [page],
      clientRects: [{
        left: 360,
        right: 580,
        top: 160,
        bottom: 184,
      }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe("high-fidelity excitation");
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(360 / 640, 3);
      expect(result.selection.pageRects[0]?.x1).toBeGreaterThan(0.5);
    }
  });

  it("keeps right-column paper text independent from figure captions and left-column graphics", () => {
    const page = createPageContext({
      fragments: [
        { text: "A", left: 92, top: 96, width: 14, height: 18 },
        { text: "852 nm", left: 112, top: 214, width: 46, height: 14 },
        { text: "FIG. 1. Hong-Ou-Mandel atom analog and experimental setup.", left: 78, top: 344, width: 300, height: 18 },
        { text: "traps is rapidly increased to freeze the atom distribution,", left: 360, top: 112, width: 346, height: 24 },
        { text: "the traps are pulled apart, and the single-atom location", left: 360, top: 140, width: 338, height: 24 },
        { text: "is imaged.", left: 360, top: 168, width: 90, height: 24 },
        { text: "Figure 2B demonstrates resonant coherent", left: 360, top: 218, width: 320, height: 24 },
        { text: "tunneling as measured by recording the likelihood of ob-", left: 360, top: 246, width: 350, height: 24 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: "Figure 2B demonstrates resonant coherent",
      endFragment: "tunneling as measured by recording the likelihood of ob-",
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "Figure 2B demonstrates resonant coherent tunneling as measured by recording the likelihood of ob-",
      pages: [page],
      clientRects: [
        { left: 360, right: 680, top: 218, bottom: 242 },
        { left: 360, right: 710, top: 246, bottom: 270 },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe("Figure 2B demonstrates resonant coherent tunneling as measured by recording the likelihood of ob-");
      expect(result.selection.textQuote.exact).not.toContain("FIG. 1");
      expect(result.selection.textQuote.exact).not.toContain("852 nm");
      expect(result.selection.pageRects).toHaveLength(2);
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(360 / 640, 3);
    }
  });

  it("ignores a left-edge vertical sidebar code when the selection geometry and pointer target main body text", () => {
    const bodyText = "We propose several schemes for implementing a fast two-qubit quantum gate";
    const page = createPageContext({
      fragments: [
        { text: "4", left: 36, top: 460, width: 24, height: 180 },
        { text: bodyText, left: 160, top: 452, width: 420, height: 28 },
      ],
    });
    const selectedText = "fast two-qubit quantum gate";
    const selectedStart = bodyText.indexOf(selectedText);
    const charWidth = 420 / bodyText.length;
    const selectedLeft = 160 + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);
    const range = createRangeWithinFragment("4", "4");

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "4",
      pages: [page],
      clientRects: [{
        left: selectedLeft,
        right: selectedRight,
        top: 452,
        bottom: 480,
      }],
      dragStartPoint: { x: selectedLeft + 2, y: 466 },
      dragEndPoint: { x: selectedRight - 2, y: 466 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.textQuote.exact).not.toBe("4");
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(selectedLeft / 640, 3);
    }
  });

  it("does not include compact citation markers outside the selected prose rect", () => {
    const page = createPageContext({
      fragments: [
        { text: "damping improve with increasing J", left: 360, top: 520, width: 250, height: 24 },
        { text: "[25]", left: 612, top: 523, width: 28, height: 16 },
        { text: "We now consider the theoretical expectation", left: 360, top: 552, width: 330, height: 24 },
      ],
    });
    const range = createRangeWithinFragment("damping improve with increasing J", "damping improve with increasing J");

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "damping improve with increasing J",
      pages: [page],
      clientRects: [
        { left: 360, right: 610, top: 520, bottom: 544 },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe("damping improve with increasing J");
      expect(result.selection.textQuote.exact).not.toContain("[25]");
    }
  });

  it("projects scaled and scrolled DOM rects back to stable page-relative rects", () => {
    const pageTop = 520;
    const page = createPageContext({
      top: pageTop,
      fragments: [
        { text: "scaled high-fidelity excitation", left: 96, top: 180, width: 280, height: 30 },
      ],
    });
    const range = createRangeWithinFragment("scaled high-fidelity excitation", "high-fidelity");
    const fullText = "scaled high-fidelity excitation";
    const selectedText = "high-fidelity";
    const startRatio = fullText.indexOf(selectedText) / fullText.length;
    const expectedLeft = 96 + (280 * startRatio);
    const expectedRight = expectedLeft + (280 * (selectedText.length / fullText.length));

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: range.toString(),
      pages: [page],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.viewportRects[0]?.top).toBeCloseTo(180, 3);
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(expectedLeft / 640, 3);
      expect(result.selection.pageRects[0]?.x2).toBeCloseTo(expectedRight / 640, 3);
    }
  });

  it("resolves the information regression from a long text span", () => {
    const page = createPageContext({
      fragments: [
        { text: "quantum information can be found", left: 20, top: 24, width: 360, height: 24 },
      ],
    });
    const range = createRangeWithinFragment("quantum information can be found", "information");

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: range.toString(),
      pages: [page],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.text).toBe("information");
      expect(result.selection.textQuote.exact).toBe("information");
    }
  });

  it("keeps attracting great interest aligned to the actual visual selection", () => {
    const page = createPageContext({
      fragments: [
        { text: "Quantum", left: 20, top: 24, width: 76, height: 24 },
        { text: "computing", left: 110, top: 24, width: 110, height: 24 },
        { text: "is", left: 234, top: 24, width: 28, height: 24 },
        { text: "attracting", left: 276, top: 24, width: 112, height: 24 },
        { text: "great", left: 402, top: 24, width: 72, height: 24 },
        { text: "interest", left: 488, top: 24, width: 96, height: 24 },
        { text: "due", left: 598, top: 24, width: 42, height: 24 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: "attracting",
      endFragment: "interest",
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: range.toString(),
      pages: [page],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.text).toBe("attracting great interest");
      expect(result.selection.textQuote.exact).toBe("attracting great interest");
    }
  });

  it("keeps computation based on neutral aligned to the selected fragments", () => {
    const page = createPageContext({
      fragments: [
        { text: "quantum", left: 20, top: 24, width: 90, height: 24 },
        { text: "computation", left: 124, top: 24, width: 150, height: 24 },
        { text: "based", left: 288, top: 24, width: 72, height: 24 },
        { text: "on", left: 374, top: 24, width: 30, height: 24 },
        { text: "neutral", left: 418, top: 24, width: 92, height: 24 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: "computation",
      endFragment: "neutral",
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: range.toString(),
      pages: [page],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.text).toBe("computation based on neutral");
      expect(result.selection.textQuote.exact).toBe("computation based on neutral");
    }
  });

  it("supports same-page cross-line selections without truncating the trailing line", () => {
    const page = createPageContext({
      fragments: [
        { text: "In this review we", left: 20, top: 24, width: 180, height: 24 },
        { text: "take a critical look", left: 210, top: 24, width: 200, height: 24 },
        { text: "at the prospects for", left: 20, top: 60, width: 220, height: 24 },
        { text: "developing scalable", left: 250, top: 60, width: 190, height: 24 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: "take a critical look",
      endFragment: "developing scalable",
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: range.toString(),
      pages: [page],
      nativeLayout: {
        source: "pdfium",
        pageNumber: 1,
        width: 640,
        height: 960,
        text: "In this review we take a critical look at the prospects for developing scalable",
        chars: Array.from("In this review we take a critical look at the prospects for developing scalable").map((character, index) => ({
          charIndex: index,
          text: character,
          x1: index < 39 ? 20 + (index * 7) : 20 + ((index - 39) * 7),
          y1: index < 39 ? 24 : 60,
          x2: index < 39 ? 26 + (index * 7) : 26 + ((index - 39) * 7),
          y2: index < 39 ? 48 : 84,
          fontSize: 24,
        })),
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe("take a critical look at the prospects for developing scalable");
      expect(result.selection.viewportRects.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("prefers live DOM selection text as the exact quote when boundary offsets drift", () => {
    const page = createPageContext({
      fragments: [
        { text: "Figure 3.", left: 20, top: 24, width: 100, height: 24 },
        { text: "Fluorescence images of atoms in a 100 site 2D optical trap array", left: 130, top: 24, width: 520, height: 24 },
        { text: "Publishing).", left: 660, top: 24, width: 120, height: 24 },
      ],
    });
    const textLayer = page.element.querySelector(".textLayer");
    const endNode = getFragmentTextNode("Publishing).");
    if (!(textLayer instanceof HTMLElement)) {
      throw new Error("Missing text layer");
    }

    const range = document.createRange();
    range.setStart(textLayer, 0);
    range.setEnd(endNode, "Publishing).".length);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "Publishing).",
      pages: [page],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.text).toBe("Publishing).");
      expect(result.selection.textQuote.exact).toBe("Publishing).");
      expect(result.selection.textQuote.source).toBe("dom-selection");
    }
  });

  it("prefers pdfium native text when browser selection drops spaces across fragments", () => {
    const page = createPageContext({
      fragments: [
        { text: "attracting", left: 276, top: 24, width: 112, height: 24 },
        { text: "great", left: 402, top: 24, width: 72, height: 24 },
        { text: "interest", left: 488, top: 24, width: 96, height: 24 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: "attracting",
      endFragment: "interest",
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "attractinggreatinterest",
      pages: [page],
      nativeLayout: {
        source: "pdfium",
        pageNumber: 1,
        width: 640,
        height: 960,
        text: "attracting great interest",
        chars: [
          { charIndex: 0, text: "a", x1: 276, y1: 24, x2: 286, y2: 48, fontSize: 24 },
          { charIndex: 11, text: "g", x1: 402, y1: 24, x2: 412, y2: 48, fontSize: 24 },
          { charIndex: 17, text: "i", x1: 488, y1: 24, x2: 494, y2: 48, fontSize: 24 },
          { charIndex: 24, text: "t", x1: 578, y1: 24, x2: 584, y2: 48, fontSize: 24 },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.text).toBe("attracting great interest");
      expect(result.selection.textQuote.exact).toBe("attracting great interest");
      expect(result.selection.textQuote.source).toBe("pdfium-native");
    }
  });

  it("prefers pointer-grounded native selection when the DOM range drifts to earlier text", () => {
    const page = createPageContext({
      fragments: [
        { text: "quantum computation", left: 20, top: 24, width: 180, height: 24 },
        { text: "information can be found", left: 20, top: 60, width: 220, height: 24 },
      ],
    });
    const range = createRangeWithinFragment("information can be found", "tion can be f");

    const firstLine = "quantum computation";
    const secondLine = "information can be found";
    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: range.toString(),
      pages: [page],
      dragStartPoint: { x: 86, y: 36 },
      dragEndPoint: { x: 170, y: 36 },
      nativeLayout: {
        source: "pdfium",
        pageNumber: 1,
        width: 640,
        height: 960,
        text: `${firstLine} ${secondLine}`,
        chars: [
          ...Array.from(firstLine).map((character, index) => ({
            charIndex: index,
            text: character,
            x1: 20 + (index * 8),
            y1: 24,
            x2: 26 + (index * 8),
            y2: 48,
            fontSize: 24,
          })),
          ...Array.from(secondLine).map((character, index) => ({
            charIndex: firstLine.length + 1 + index,
            text: character,
            x1: 20 + (index * 8),
            y1: 60,
            x2: 26 + (index * 8),
            y2: 84,
            fontSize: 24,
          })),
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.text).toBe("computation");
      expect(result.selection.textQuote.exact).toBe("computation");
      expect(result.selection.textQuote.source).toBe("pdfium-native");
    }
  });

  it("keeps the full DOM quote when native text recognition only resolves an inner substring", () => {
    const selectedText = "Here we demonstrate a new neutral atom qubit using the nuclear spin";
    const innerText = "new neutral atom qubit using the nuclear spin";
    const page = createPageContext({
      fragments: [
        { text: "Here we demonstrate a", left: 80, top: 120, width: 210, height: 24 },
        { text: "new neutral atom qubit using the nuclear spin", left: 306, top: 120, width: 360, height: 24 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: "Here we demonstrate a",
      endFragment: "new neutral atom qubit using the nuclear spin",
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: selectedText,
      pages: [page],
      nativeLayout: {
        source: "pdfium",
        pageNumber: 1,
        width: 640,
        height: 960,
        text: innerText,
        chars: Array.from(innerText).map((character, index) => ({
          charIndex: index,
          text: character,
          x1: 306 + (index * 8),
          y1: 120,
          x2: 312 + (index * 8),
          y2: 144,
          fontSize: 24,
        })),
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.textQuote.source).toBe("dom-selection");
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(80 / 640, 3);
    }
  });

  it("keeps large-title pointer selections aligned even when a nearby citation-sized line drifts", () => {
    const page = createPageContext({
      fragments: [
        { text: "[57]", left: 20, top: 600, width: 40, height: 16 },
        { text: "acousto-optic modulators", left: 76, top: 584, width: 300, height: 36 },
      ],
    });
    const range = createRangeWithinFragment("[57]", "57");

    const title = "acousto-optic modulators";
    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: range.toString(),
      pages: [page],
      dragStartPoint: { x: 84, y: 602 },
      dragEndPoint: { x: 360, y: 602 },
      nativeLayout: {
        source: "pdfium",
        pageNumber: 1,
        width: 640,
        height: 960,
        text: `[57] ${title}`,
        chars: [
          { charIndex: 0, text: "[", x1: 20, y1: 600, x2: 26, y2: 616, fontSize: 16 },
          { charIndex: 1, text: "5", x1: 26, y1: 600, x2: 34, y2: 616, fontSize: 16 },
          { charIndex: 2, text: "7", x1: 34, y1: 600, x2: 42, y2: 616, fontSize: 16 },
          { charIndex: 3, text: "]", x1: 42, y1: 600, x2: 48, y2: 616, fontSize: 16 },
          { charIndex: 4, text: " ", x1: 48, y1: 600, x2: 56, y2: 616, fontSize: 16 },
          ...Array.from(title).map((character, index) => ({
            charIndex: 5 + index,
            text: character,
            x1: 76 + (index * 12),
            y1: 584,
            x2: 84 + (index * 12),
            y2: 620,
            fontSize: 36,
          })),
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe("acousto-optic modulators");
      expect(result.selection.textQuote.source).toBe("pdfium-native");
    }
  });

  it("uses native UTF-16 text offsets after superscript citations and ligature glyphs", () => {
    const selectedText = "high-fidelity excitation";
    const page = createPageContext({
      fragments: [
        { text: "state21 and mid-circuit fast, high-fidelity excitation to the Rydberg", left: 40, top: 96, width: 620, height: 24 },
      ],
    });
    const range = createRangeWithinFragment(
      "state21 and mid-circuit fast, high-fidelity excitation to the Rydberg",
      selectedText,
    );
    const pageText = "state²¹ and mid-circuit fast, high-fidelity excitation to the Rydberg";
    const highStart = pageText.indexOf(selectedText);
    const highEnd = highStart + selectedText.length;
    const chars = [
      ...Array.from(pageText.slice(0, highStart)).map((character, index) => ({
        charIndex: index,
        charEndIndex: index + character.length,
        text: character,
        x1: 40 + (index * 8),
        y1: 96,
        x2: 46 + (index * 8),
        y2: 120,
        fontSize: 24,
      })),
      { charIndex: highStart, charEndIndex: highStart + 1, text: "h", x1: 280, y1: 96, x2: 287, y2: 120, fontSize: 24 },
      { charIndex: highStart + 1, charEndIndex: highStart + 2, text: "i", x1: 288, y1: 96, x2: 292, y2: 120, fontSize: 24 },
      { charIndex: highStart + 2, charEndIndex: highStart + 3, text: "g", x1: 294, y1: 96, x2: 301, y2: 120, fontSize: 24 },
      { charIndex: highStart + 3, charEndIndex: highStart + 4, text: "h", x1: 302, y1: 96, x2: 309, y2: 120, fontSize: 24 },
      { charIndex: highStart + 4, charEndIndex: highStart + 5, text: "-", x1: 310, y1: 96, x2: 316, y2: 120, fontSize: 24 },
      { charIndex: highStart + 5, charEndIndex: highStart + 7, text: "ﬁ", x1: 318, y1: 96, x2: 329, y2: 120, fontSize: 24 },
      ...Array.from(pageText.slice(highStart + 7, highEnd)).map((character, index) => ({
        charIndex: highStart + 7 + index,
        charEndIndex: highStart + 8 + index,
        text: character,
        x1: 330 + (index * 8),
        y1: 96,
        x2: 337 + (index * 8),
        y2: 120,
        fontSize: 24,
      })),
      ...Array.from(pageText.slice(highEnd)).map((character, index) => ({
        charIndex: highEnd + index,
        charEndIndex: highEnd + index + character.length,
        text: character,
        x1: 500 + (index * 8),
        y1: 96,
        x2: 506 + (index * 8),
        y2: 120,
        fontSize: 24,
      })),
    ];

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: selectedText,
      pages: [page],
      nativeLayout: {
        source: "pdfium",
        pageNumber: 1,
        width: 640,
        height: 960,
        text: pageText,
        chars,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.text).toBe(selectedText);
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.textQuote.source).toBe("dom-selection");
      expect(result.selection.startOffset).toBe(highStart);
      expect(result.selection.endOffset).toBe(highEnd);
      expect(result.selection.viewportRects[0]?.left).toBeGreaterThanOrEqual(280);
      expect(result.selection.viewportRects[0]?.left).toBeLessThan(330);
    }
  });

  it("rejects cross-page selections", () => {
    const page1 = createPageContext({
      pageNumber: 1,
      top: 0,
      fragments: [
        { text: "page one", left: 20, top: 24, width: 80, height: 24 },
      ],
    });
    const page2 = createPageContext({
      pageNumber: 2,
      top: 1000,
      fragments: [
        { text: "page two", left: 20, top: 24, width: 80, height: 24 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: "page one",
      endFragment: "page two",
      endIndex: 0,
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: range.toString(),
      pages: [page1, page2],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cross-page");
    }
  });
});
