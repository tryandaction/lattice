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

  it("keeps a right-column selection inside the right column of a two-column layout", () => {
    const leftText = "Left column discusses control hardware and initialization";
    const rightText = "Right column explains the readout calibration sequence";
    const selectedText = "readout calibration";
    const rightStart = rightText.indexOf(selectedText);
    const rightLeft = 352;
    const rightWidth = 220;
    const charWidth = rightWidth / rightText.length;
    const selectedLeft = rightLeft + (rightStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);
    const page = createPageContext({
      fragments: [
        { text: leftText, left: 56, top: 180, width: 220, height: 22 },
        { text: rightText, left: rightLeft, top: 180, width: rightWidth, height: 22 },
      ],
    });
    const range = createRangeWithinFragment(leftText, "control");

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: selectedText,
      pages: [page],
      clientRects: [{
        left: selectedLeft,
        right: selectedRight,
        top: 180,
        bottom: 202,
      }],
      dragStartPoint: { x: selectedLeft + 1, y: 191 },
      dragEndPoint: { x: selectedRight - 1, y: 191 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.textQuote.exact).not.toContain("control");
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(selectedLeft / 640, 3);
    }
  });

  it("keeps a dragged right-column paper selection out of interleaved left-column DOM text", () => {
    const leftLine1 = "The large dipole matrix elements also imply that";
    const rightLine1 = "possible interactions in the absence of applied fields.";
    const leftLine2 = "Rydberg states are extremely sensitive to small low-";
    const rightLine2 = "this section we discuss the properties of dipole-dipole";
    const selectedText = `${rightLine1} ${rightLine2}`;
    const page = createPageContext({
      fragments: [
        { text: leftLine1, left: 70, top: 104, width: 230, height: 24 },
        { text: rightLine1, left: 340, top: 104, width: 240, height: 24 },
        { text: leftLine2, left: 70, top: 132, width: 230, height: 24 },
        { text: rightLine2, left: 340, top: 132, width: 242, height: 24 },
        { text: "0", left: 300, top: 214, width: 10, height: 12 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: rightLine1,
      endFragment: rightLine2,
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: `${rightLine1} ${leftLine2} ${rightLine2}`,
      pages: [page],
      dragStartPoint: { x: 342, y: 116 },
      dragEndPoint: { x: 580, y: 144 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.textQuote.exact).not.toContain(leftLine2);
      expect(result.selection.textQuote.exact).not.toBe("0");
      expect(result.selection.pageRects).toHaveLength(2);
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(340 / 640, 3);
    }
  });

  it("uses explicit visual geometry when a math-heavy left-column selection collapses to a stray zero", () => {
    const beforeFormula = "Even so, the electric field stability required to hold";
    const afterFormula = "Stark shifts below 1 MHz is typically of order";
    const selectedText = `${beforeFormula} ${afterFormula}`;
    const page = createPageContext({
      fragments: [
        { text: "0", left: 546, top: 212, width: 10, height: 12 },
        { text: beforeFormula, left: 70, top: 516, width: 530, height: 24 },
        { text: "ΔE ∼ ℏ6n7E2/m3e6.", left: 70, top: 544, width: 210, height: 24 },
        { text: afterFormula, left: 70, top: 572, width: 520, height: 24 },
        { text: "possible interactions in the absence of applied fields.", left: 624, top: 516, width: 505, height: 24 },
      ],
    });
    const range = createRangeWithinFragment("0", "0");

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "0",
      pages: [page],
      clientRects: [
        { left: 70, right: 600, top: 516, bottom: 540 },
        { left: 70, right: 590, top: 572, bottom: 596 },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.textQuote.exact).not.toBe("0");
      expect(result.selection.textQuote.exact).not.toContain("possible interactions");
      expect(result.selection.pageRects).toHaveLength(2);
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(70 / 640, 3);
    }
  });

  it("preserves explicit line edges when desktop drag metadata starts inside the first selected word", () => {
    const firstLine = "Even so, the electric field stability required to hold";
    const secondLine = "Stark shifts below 1 MHz is typically of order";
    const page = createPageContext({
      fragments: [
        { text: "0", left: 540, top: 212, width: 10, height: 12 },
        { text: firstLine, left: 70, top: 516, width: 530, height: 24 },
        { text: secondLine, left: 70, top: 548, width: 520, height: 24 },
      ],
    });
    const range = createRangeWithinFragment("0", "0");
    const charWidth = 530 / firstLine.length;

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "0",
      pages: [page],
      clientRects: [
        { left: 70, right: 600, top: 516, bottom: 540 },
        { left: 70, right: 590, top: 548, bottom: 572 },
      ],
      dragStartPoint: { x: 70 + charWidth * 3.5, y: 528 },
      dragEndPoint: { x: 588, y: 560 },
      ignoreDomText: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(`${firstLine} ${secondLine}`);
      expect(result.selection.textQuote.exact.startsWith("Even so")).toBe(true);
      expect(result.selection.textQuote.exact).not.toMatch(/^n so/);
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(70 / 640, 3);
    }
  });

  it("does not treat a pointer inside the first selected word as a single-line text boundary", () => {
    const line = "Even so, the electric field stability required to hold";
    const page = createPageContext({
      fragments: [
        { text: "0", left: 540, top: 212, width: 10, height: 12 },
        { text: line, left: 70, top: 516, width: 530, height: 24 },
      ],
    });
    const range = createRangeWithinFragment("0", "0");
    const charWidth = 530 / line.length;

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "0",
      pages: [page],
      clientRects: [
        { left: 70, right: 600, top: 516, bottom: 540 },
      ],
      dragStartPoint: { x: 70 + charWidth * 3.5, y: 528 },
      dragEndPoint: { x: 598, y: 528 },
      ignoreDomText: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(line);
      expect(result.selection.textQuote.exact.startsWith("Even so")).toBe(true);
      expect(result.selection.textQuote.exact).not.toMatch(/^n so/);
    }
  });

  it("clips geometry-first single-line selections to the actual drag bounds", () => {
    const line = "prefixABCDEFGHIJsuffix";
    const selectedText = "CDEFGH";
    const lineLeft = 80;
    const lineTop = 300;
    const lineWidth = 440;
    const page = createPageContext({
      fragments: [
        { text: "0", left: 540, top: 212, width: 10, height: 12 },
        { text: line, left: lineLeft, top: lineTop, width: lineWidth, height: 24 },
      ],
    });
    const range = createRangeWithinFragment("0", "0");
    const charWidth = lineWidth / line.length;
    const selectedStart = line.indexOf(selectedText);
    const selectedEnd = selectedStart + selectedText.length;
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = lineLeft + (selectedEnd * charWidth);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "0",
      pages: [page],
      clientRects: [
        { left: lineLeft, right: lineLeft + lineWidth, top: lineTop, bottom: lineTop + 24 },
      ],
      dragStartPoint: { x: selectedLeft + 1, y: lineTop + 12 },
      dragEndPoint: { x: selectedRight - 1, y: lineTop + 12 },
      ignoreDomText: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.textQuote.exact).not.toContain("prefix");
      expect(result.selection.textQuote.exact).not.toContain("suffix");
      expect(result.selection.pageRects[0]?.x1).toBeGreaterThan((lineLeft + charWidth) / 640);
      expect(result.selection.pageRects[0]?.x2).toBeLessThan((lineLeft + lineWidth - charWidth) / 640);
    }
  });

  it("rejects a masthead vertical strip and rebuilds the text quote from pointer boundaries", () => {
    const abstractLine = "Rydberg atoms with principal quantum number n have exaggerated atomic properties including";
    const selectedText = "Rydberg atoms with principal quantum number";
    const lineLeft = 88;
    const lineTop = 340;
    const lineWidth = 560;
    const charWidth = lineWidth / abstractLine.length;
    const selectedLeft = lineLeft;
    const selectedRight = lineLeft + (selectedText.length * charWidth);
    const page = createPageContext({
      fragments: [
        { text: "REVIEWS OF MODERN PHYSICS, VOLUME 82", left: 250, top: 92, width: 260, height: 22 },
        { text: "Quantum information with Rydberg atoms", left: 80, top: 150, width: 560, height: 36 },
        { text: "M. Saffman and T. G. Walker", left: 180, top: 230, width: 320, height: 28 },
        { text: "Department of Physics, University of Wisconsin, 1150 University Avenue", left: 150, top: 278, width: 520, height: 22 },
        { text: abstractLine, left: lineLeft, top: lineTop, width: lineWidth, height: 24 },
      ],
    });
    const range = createRangeWithinFragment("Quantum information with Rydberg atoms", "Rydberg atoms");

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "g atoms consin, 1150 University A for Quantum System",
      pages: [page],
      clientRects: [{
        left: 260,
        right: 380,
        top: 92,
        bottom: 720,
      }],
      dragStartPoint: { x: selectedLeft + 1, y: lineTop + 12 },
      dragEndPoint: { x: selectedRight - 1, y: lineTop + 12 },
      ignoreDomText: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.textQuote.exact).not.toContain("Wisconsin");
      expect(result.selection.textQuote.exact).not.toContain("Quantum information");
      expect(result.selection.pageRects).toHaveLength(1);
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(selectedLeft / 640, 3);
      expect(result.selection.pageRects[0]?.x2).toBeCloseTo(selectedRight / 640, 3);
      expect(result.selection.pageRects[0] ? result.selection.pageRects[0].y2 - result.selection.pageRects[0].y1 : 1)
        .toBeLessThan(0.04);
    }
  });

  it("uses drag-only geometry when the native DOM selection collapses without client rects", () => {
    const firstLine = "The applicability of Rydberg atoms for quantum infor-";
    const secondLine = "mation processing, which is the central topic of this re-";
    const selectedText = "The applicability of Rydberg atoms for quantum information processing, which is the central topic of this re-";
    const lineLeft = 70;
    const firstLineWidth = 236;
    const secondLineWidth = 246;
    const page = createPageContext({
      fragments: [
        { text: firstLine, left: lineLeft, top: 104, width: firstLineWidth, height: 24 },
        { text: secondLine, left: lineLeft, top: 132, width: secondLineWidth, height: 24 },
        { text: "two-atom blockade shift B due to the Rydberg interaction", left: 340, top: 104, width: 260, height: 24 },
      ],
    });
    const anchorNode = getFragmentTextNode(firstLine);
    const collapsedRange = document.createRange();
    collapsedRange.setStart(anchorNode, 0);
    collapsedRange.setEnd(anchorNode, 0);

    const result = resolvePdfSelectionFromNativeRange({
      range: collapsedRange,
      text: "",
      pages: [page],
      clientRects: [],
      dragStartPoint: { x: lineLeft + 2, y: 116 },
      dragEndPoint: { x: lineLeft + secondLineWidth - 2, y: 144 },
      ignoreDomText: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.textQuote.exact).not.toContain("two-atom blockade");
      expect(result.selection.pageRects.length).toBeGreaterThanOrEqual(2);
      expect(Math.max(...result.selection.pageRects.map((rect) => rect.x2 - rect.x1))).toBeLessThan(0.75);
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

  it("uses CJK visual geometry when a DOM range shifts one character left on the same line", () => {
    const line = "例（肝炎病毒检测）：设每个人血清中含有肝炎病毒的概率为 0.4%，求";
    const selectedText = "含有肝炎";
    const wrongDomText = "中含有肝";
    const lineLeft = 40;
    const lineTop = 96;
    const charWidth = 18;
    const page = createPageContext({
      fragments: [
        { text: line, left: lineLeft, top: lineTop, width: line.length * charWidth, height: 48 },
      ],
    });
    const range = createRangeWithinFragment(line, wrongDomText);
    const selectedStart = line.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: wrongDomText,
      pages: [page],
      clientRects: [{
        left: selectedLeft,
        right: selectedRight,
        top: lineTop,
        bottom: lineTop + 48,
      }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.text).toBe(selectedText);
      expect(result.selection.textQuote.exact).toBe(selectedText);
      expect(result.selection.textQuote.source).toBe("pdfjs-text-model");
      expect(result.selection.textQuote.exact).not.toBe(wrongDomText);
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(selectedLeft / 640, 3);
      expect(result.selection.pageRects[0]?.x2).toBeCloseTo(selectedRight / 640, 3);
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

  it("keeps frozen geometry when identical repeated text drifts to a later occurrence", () => {
    const repeatedText = "repeat phrase";
    const line = `alpha ${repeatedText} beta ${repeatedText} gamma`;
    const lineLeft = 40;
    const lineTop = 120;
    const charWidth = 8;
    const page = createPageContext({
      fragments: [
        { text: line, left: lineLeft, top: lineTop, width: line.length * charWidth, height: 24 },
      ],
    });
    const firstStart = line.indexOf(repeatedText);
    const secondStart = line.lastIndexOf(repeatedText);
    const intendedLeft = lineLeft + (firstStart * charWidth);
    const intendedRight = intendedLeft + (repeatedText.length * charWidth);
    const range = createRangeAcrossFragments({
      startFragment: line,
      startOffset: secondStart,
      endFragment: line,
      endOffset: secondStart + repeatedText.length,
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: repeatedText,
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
      expect(result.selection.textQuote.exact).toBe(repeatedText);
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(intendedLeft / 640, 3);
      expect(result.selection.pageRects[0]?.x2).toBeCloseTo(intendedRight / 640, 3);
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

  it("uses explicit rendered geometry when a Rydberg DOM range drifts later without native layout", () => {
    const line = "fast, high-fidelity excitation to the Rydberg state21 and mid-circuit";
    const lineLeft = 40;
    const lineTop = 120;
    const charWidth = 8;
    const page = createPageContext({
      fragments: [
        { text: line, left: lineLeft, top: lineTop, width: line.length * charWidth, height: 24 },
      ],
    });
    const selectedText = "high-fidelity excitation";
    const wrongOffsetText = "to the Rydberg state21";
    const range = createRangeWithinFragment(line, wrongOffsetText);
    const selectedStart = line.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: wrongOffsetText,
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
      expect(result.selection.textQuote.source).toBe("pdfjs-text-model");
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(selectedLeft / 640, 3);
      expect(result.selection.pageRects[0]?.x2).toBeCloseTo(selectedRight / 640, 3);
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

  it("uses pointer bounds to trim a Saffman-style cross-line selection that starts after earlier prose", () => {
    const previousLine = "of states with equal and opposite ΔE, as can be inferred";
    const firstSelectedLine = "from Fig. 5, that tend to cause shifts in opposite direc-";
    const secondSelectedLine = "tions. Even so, the electric field stability required to hold";
    const thirdSelectedLine = "Stark shifts below 1 MHz is typically of order";
    const page = createPageContext({
      fragments: [
        { text: previousLine, left: 60, top: 420, width: 520, height: 24 },
        { text: firstSelectedLine, left: 60, top: 452, width: 520, height: 24 },
        { text: secondSelectedLine, left: 60, top: 484, width: 520, height: 24 },
        { text: thirdSelectedLine, left: 60, top: 516, width: 480, height: 24 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: previousLine,
      startOffset: previousLine.indexOf("with equal"),
      endFragment: thirdSelectedLine,
    });
    const figStart = firstSelectedLine.indexOf("Fig. 5");
    const charWidth = 520 / firstSelectedLine.length;
    const dragStartX = 60 + (figStart * charWidth);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "with equal and opposite ΔE, as can be inferred from Fig. 5, that tend to cause shifts in opposite direc- tions. Even so, the electric field stability required to hold Stark shifts below 1 MHz is typically of order",
      pages: [page],
      clientRects: [
        { left: 138, right: 580, top: 420, bottom: 444 },
        { left: 60, right: 580, top: 452, bottom: 476 },
        { left: 60, right: 580, top: 484, bottom: 508 },
        { left: 60, right: 540, top: 516, bottom: 540 },
      ],
      dragStartPoint: { x: dragStartX + 2, y: 464 },
      dragEndPoint: { x: 540 - 2, y: 528 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toContain("Fig. 5, that tend");
      expect(result.selection.textQuote.exact).toContain("opposite directions. Even so");
      expect(result.selection.textQuote.exact).not.toContain("direc-");
      expect(result.selection.textQuote.exact).not.toContain("with equal and opposite");
      expect(result.selection.textQuote.exact.startsWith("Fig. 5")).toBe(true);
    }
  });

  it("keeps the exact Saffman Fig. 5 sentence when the DOM range expands into surrounding paragraphs", () => {
    const left = 52;
    const lineWidth = 500;
    const lineHeight = 22;
    const top = 260;
    const gap = 30;
    const lines = [
      "feature for coherent optical manipulation. On the one",
      "hand, this sensitivity requires that electric fields be well",
      "controlled to avoid frequency fluctuations. On the other",
      "hand, it also makes it possible to tune the strength and",
      "angular dependence of Rydberg-Rydberg interactions",
      "using such fields.",
      "For small dc electric fields E such that the dipole cou-",
      "plings e<r>E are much less than the energy difference ΔE",
      "of the nearest opposite parity state, the Stark effect is",
      "quadratic and the shift is at most of order",
      "-(e<r>E)2/ΔE ~ hbar6n7E2/m3e6. In fact the shift is often",
      "substantially smaller than this due to partial cancellation",
      "of states with equal and opposite ΔE, as can be inferred",
      "from Fig. 5, that tend to cause shifts in opposite direc-",
      "tions. Even so, the electric field stability required to hold",
      "Stark shifts below 1 MHz is typically of order",
      "0.01(100/n)7/2 V/cm.",
      "In higher electric fields, mixing of opposite parity",
      "states gives the atom an electric dipole moment of order",
      "n2ea0 and hence a linear Stark effect. This may be desirable",
    ];
    const page = createPageContext({
      fragments: lines.map((text, index) => ({
        text,
        left,
        top: top + (index * gap),
        width: index === 16 ? 160 : lineWidth,
        height: lineHeight,
      })),
    });
    const range = createRangeAcrossFragments({
      startFragment: lines[0],
      endFragment: lines[19],
    });
    const firstTargetLine = lines[13];
    const lastTargetLine = lines[16];
    const figStart = firstTargetLine.indexOf("Fig. 5");
    const firstTargetCharWidth = lineWidth / firstTargetLine.length;
    const lastTargetCharWidth = 160 / lastTargetLine.length;
    const targetStartX = left + (figStart * firstTargetCharWidth);
    const targetEndX = left + (lastTargetLine.length * lastTargetCharWidth);
    const targetStartY = top + (13 * gap) + (lineHeight / 2);
    const targetEndY = top + (16 * gap) + (lineHeight / 2);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "",
      pages: [page],
      ignoreDomText: true,
      clientRects: lines.map((text, index) => ({
        left,
        right: left + (index === 16 ? 160 : lineWidth),
        top: top + (index * gap),
        bottom: top + (index * gap) + lineHeight,
      })),
      dragStartPoint: { x: targetStartX + 1, y: targetStartY },
      dragEndPoint: { x: targetEndX - 1, y: targetEndY },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(
        "Fig. 5, that tend to cause shifts in opposite directions. Even so, the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01(100/n)^(7/2) V/cm.",
      );
      expect(result.selection.textQuote.exact).not.toContain("feature for coherent");
      expect(result.selection.textQuote.exact).not.toContain("In higher electric fields");
      expect(result.selection.pageRects.length).toBe(4);
      expect(result.selection.pageRects[0]?.x1).toBeGreaterThan(left / 640);
      expect(result.selection.pageRects[3]?.x2).toBeCloseTo((left + 160) / 640, 2);
    }
  });

  it("does not let polluted browser client rects expand a user drag from Fig. 5 to V/cm", () => {
    const left = 52;
    const fullWidth = 500;
    const shortWidth = 160;
    const lineHeight = 22;
    const top = 260;
    const gap = 30;
    const lines = [
      "feature for coherent optical manipulation. On the one",
      "hand, this sensitivity requires that electric fields be well",
      "controlled to avoid frequency fluctuations. On the other",
      "hand, it also makes it possible to tune the strength and",
      "angular dependence of Rydberg-Rydberg interactions",
      "using such fields.",
      "For small dc electric fields E such that the dipole cou-",
      "plings e<r>E are much less than the energy difference Delta E",
      "of the nearest opposite parity state, the Stark effect is",
      "quadratic and the shift is at most of order",
      "-(e<r>E)2/Delta E ~ hbar6n7E2/m3e6. In fact the shift is often",
      "substantially smaller than this due to partial cancellation",
      "of states with equal and opposite Delta E, as can be inferred",
      "from Fig. 5, that tend to cause shifts in opposite direc-",
      "tions. Even so, the electric field stability required to hold",
      "Stark shifts below 1 MHz is typically of order",
      "0.01(100/n)7/2 V/cm.",
      "In higher electric fields, mixing of opposite parity",
      "states gives the atom an electric dipole moment of order",
      "n2ea0 and hence a linear Stark effect. This may be desirable",
    ];
    const page = createPageContext({
      fragments: lines.map((text, index) => ({
        text,
        left,
        top: top + (index * gap),
        width: index === 16 ? shortWidth : fullWidth,
        height: lineHeight,
      })),
    });
    const range = createRangeAcrossFragments({
      startFragment: lines[0],
      endFragment: lines[19],
    });
    const firstTargetLine = lines[13];
    const lastTargetLine = lines[16];
    const figStart = firstTargetLine.indexOf("Fig. 5");
    const targetStartX = left + (figStart * (fullWidth / firstTargetLine.length));
    const targetEndX = left + shortWidth;
    const targetStartY = top + (13 * gap) + (lineHeight / 2);
    const targetEndY = top + (16 * gap) + (lineHeight / 2);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: lines.join(" "),
      pages: [page],
      clientRects: lines.map((text, index) => ({
        left,
        right: left + (index === 16 ? shortWidth : fullWidth),
        top: top + (index * gap),
        bottom: top + (index * gap) + lineHeight,
      })),
      dragStartPoint: { x: targetStartX + 1, y: targetStartY },
      dragEndPoint: { x: targetEndX - 1, y: targetEndY },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(
        "Fig. 5, that tend to cause shifts in opposite directions. Even so, the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01(100/n)^(7/2) V/cm.",
      );
      expect(result.selection.textQuote.exact).not.toContain("feature for coherent");
      expect(result.selection.textQuote.exact).not.toContain("with equal and opposite");
      expect(result.selection.textQuote.exact).not.toContain("In higher electric fields");
      expect(result.selection.pageRects).toHaveLength(4);
    }
  });

  it("keeps a widened Fig. 5 to V/cm drag on the intended four-line sentence instead of expanding earlier prose", () => {
    const left = 52;
    const fullWidth = 250;
    const shortWidth = 160;
    const lineHeight = 22;
    const top = 260;
    const gap = 30;
    const lines = [
      "feature for coherent optical manipulation. On the one",
      "hand, this sensitivity requires that electric fields be well",
      "controlled to avoid frequency fluctuations. On the other",
      "hand, it also makes it possible to tune the strength and",
      "angular dependence of Rydberg-Rydberg interactions",
      "using such fields.",
      "For small dc electric fields E such that the dipole cou-",
      "plings e<r>E are much less than the energy difference Delta E",
      "of the nearest opposite parity state, the Stark effect is",
      "quadratic and the shift is at most of order",
      "-(e<r>E)2/Delta E ~ hbar6n7E2/m3e6. In fact the shift is often",
      "substantially smaller than this due to partial cancellation",
      "of states with equal and opposite Delta E, as can be inferred",
      "from Fig. 5, that tend to cause shifts in opposite direc-",
      "tions. Even so, the electric field stability required to hold",
      "Stark shifts below 1 MHz is typically of order",
      "0.01(100/n)7/2 V/cm.",
      "In higher electric fields, mixing of opposite parity",
      "states gives the atom an electric dipole moment of order",
      "n2ea0 and hence a linear Stark effect. This may be desirable",
    ];
    const page = createPageContext({
      fragments: lines.map((text, index) => ({
        text,
        left,
        top: top + (index * gap),
        width: index === 16 ? shortWidth : fullWidth,
        height: lineHeight,
      })),
    });
    const range = createRangeAcrossFragments({
      startFragment: lines[0],
      endFragment: lines[19],
    });
    const firstTargetLine = lines[13];
    const lastTargetLine = lines[16];
    const figStart = firstTargetLine.indexOf("Fig. 5");
    const firstTargetCharWidth = fullWidth / firstTargetLine.length;
    const lastTargetCharWidth = shortWidth / lastTargetLine.length;
    const targetStartX = left + (figStart * firstTargetCharWidth);
    const targetEndX = left + (lastTargetLine.length * lastTargetCharWidth);
    const targetStartY = top + (13 * gap) + (lineHeight / 2);
    const targetEndY = top + (16 * gap) + (lineHeight / 2);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: lines.join(" "),
      pages: [page],
      clientRects: lines.map((text, index) => ({
        left,
        right: left + (index === 16 ? shortWidth : fullWidth),
        top: top + (index * gap),
        bottom: top + (index * gap) + lineHeight,
      })),
      dragStartPoint: { x: targetStartX + 1, y: targetStartY },
      dragEndPoint: { x: targetEndX - 1, y: targetEndY },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toBe(
        "Fig. 5, that tend to cause shifts in opposite directions. Even so, the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01(100/n)^(7/2) V/cm.",
      );
      expect(result.selection.textQuote.exact).not.toContain("feature for coherent");
      expect(result.selection.textQuote.exact).not.toContain("with equal and opposite");
      expect(result.selection.textQuote.exact).not.toContain("In higher electric fields");
      expect(result.selection.pageRects).toHaveLength(4);
      expect(Math.max(...result.selection.pageRects.map((rect) => rect.x2))).toBeLessThan(0.55);
    }
  });

  it("normalizes Saffman-style cross-line hyphenation and numeric spacing in the quote", () => {
    const firstLine = "The applicability of Rydberg atoms for quantum infor-";
    const secondLine = "mation processing, which is the central topic of this re-";
    const thirdLine = "view, can be traced to the fact that the two-atom inter-";
    const fourthLine = "action can be turned on and off with a contrast of 12orders";
    const fifthLine = "of magnitude. The ability to control the interaction strength over such a wide range";
    const page = createPageContext({
      fragments: [
        { text: firstLine, left: 52, top: 180, width: 520, height: 24 },
        { text: secondLine, left: 52, top: 212, width: 520, height: 24 },
        { text: thirdLine, left: 52, top: 244, width: 520, height: 24 },
        { text: fourthLine, left: 52, top: 276, width: 520, height: 24 },
        { text: fifthLine, left: 52, top: 308, width: 620, height: 24 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: firstLine,
      endFragment: fifthLine,
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: [
        firstLine,
        secondLine,
        thirdLine,
        fourthLine,
        fifthLine,
      ].join(" "),
      pages: [page],
      clientRects: [
        { left: 52, right: 572, top: 180, bottom: 204 },
        { left: 52, right: 572, top: 212, bottom: 236 },
        { left: 52, right: 572, top: 244, bottom: 268 },
        { left: 52, right: 572, top: 276, bottom: 300 },
        { left: 52, right: 672, top: 308, bottom: 332 },
      ],
      dragStartPoint: { x: 54, y: 192 },
      dragEndPoint: { x: 670, y: 320 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toContain("quantum information processing");
      expect(result.selection.textQuote.exact).toContain("topic of this review");
      expect(result.selection.textQuote.exact).toContain("two-atom interaction");
      expect(result.selection.textQuote.exact).toContain("12 orders of magnitude");
      expect(result.selection.textQuote.exact).not.toContain("infor-");
      expect(result.selection.textQuote.exact).not.toContain("12orders");
    }
  });

  it("persists Saffman-style text markup as character-derived row rects instead of a drag block", () => {
    const firstLine = "The applicability of Rydberg atoms for quantum infor-";
    const secondLine = "mation processing, which is the central topic of this re-";
    const thirdLine = "view, can be traced to the fact that the two-atom inter-";
    const fourthLine = "action can be turned on and off with a contrast of 12";
    const fifthLine = "orders of magnitude. The ability to control the interac-";
    const left = 52;
    const lineWidth = 520;
    const lineHeight = 24;
    const page = createPageContext({
      fragments: [
        { text: firstLine, left, top: 180, width: lineWidth, height: lineHeight },
        { text: secondLine, left, top: 212, width: lineWidth, height: lineHeight },
        { text: thirdLine, left, top: 244, width: lineWidth, height: lineHeight },
        { text: fourthLine, left, top: 276, width: lineWidth, height: lineHeight },
        { text: fifthLine, left, top: 308, width: lineWidth, height: lineHeight },
      ],
    });
    const endText = "The ability to";
    const endOffset = fifthLine.indexOf(endText) + endText.length;
    const expectedLastRightPx = left + (lineWidth * endOffset / fifthLine.length);
    const range = createRangeAcrossFragments({
      startFragment: firstLine,
      endFragment: fifthLine,
      endOffset,
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: [
        firstLine,
        secondLine,
        thirdLine,
        fourthLine,
        fifthLine.slice(0, endOffset),
      ].join(" "),
      pages: [page],
      clientRects: [
        { left, right: left + lineWidth, top: 180, bottom: 332 },
      ],
      dragStartPoint: { x: left + 2, y: 192 },
      dragEndPoint: { x: expectedLastRightPx - 1, y: 320 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toContain("quantum information processing");
      expect(result.selection.textQuote.exact).toContain("12 orders of magnitude. The ability to");
      expect(result.selection.pageRects.length).toBeGreaterThanOrEqual(5);
      expect(Math.max(...result.selection.pageRects.map((rect) => rect.y2 - rect.y1))).toBeLessThan(0.04);
      expect(result.selection.pageRects[0]?.x1).toBeCloseTo(left / 640, 3);
      expect(result.selection.pageRects[0]?.x2).toBeCloseTo((left + lineWidth) / 640, 2);
      const lastRect = result.selection.pageRects[result.selection.pageRects.length - 1];
      const expectedLastRight = expectedLastRightPx / 640;
      expect(lastRect?.x1).toBeCloseTo(left / 640, 3);
      expect(lastRect?.x2).toBeCloseTo(expectedLastRight, 2);
      expect(lastRect?.x2).toBeLessThan((left + lineWidth - 80) / 640);
    }
  });

  it("keeps Saffman-style multi-line left-column selection rects out of the right column", () => {
    const previousLine = "of states with equal and opposite Delta E, as can be inferred";
    const firstSelectedLine = "from Fig. 5, that tend to cause shifts in opposite direc-";
    const secondSelectedLine = "tions. Even so, the electric field stability required to hold";
    const thirdSelectedLine = "Stark shifts below 1 MHz is typically of order";
    const fourthSelectedLine = "0.01(100/n)7/2 V/cm.";
    const rightLineA = "where j is the total";
    const rightLineB = "dipole-dipole interaction";
    const leftLineLeft = 52;
    const leftLineRight = 302;
    const rightLineLeft = 356;
    const rightLineRight = 616;
    const page = createPageContext({
      fragments: [
        { text: previousLine, left: leftLineLeft, top: 420, width: leftLineRight - leftLineLeft, height: 24 },
        { text: firstSelectedLine, left: leftLineLeft, top: 452, width: leftLineRight - leftLineLeft, height: 24 },
        { text: secondSelectedLine, left: leftLineLeft, top: 484, width: leftLineRight - leftLineLeft, height: 24 },
        { text: thirdSelectedLine, left: leftLineLeft, top: 516, width: leftLineRight - leftLineLeft - 24, height: 24 },
        { text: fourthSelectedLine, left: leftLineLeft, top: 548, width: 122, height: 24 },
        { text: rightLineA, left: rightLineLeft, top: 484, width: rightLineRight - rightLineLeft, height: 24 },
        { text: rightLineB, left: rightLineLeft, top: 516, width: rightLineRight - rightLineLeft, height: 24 },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: previousLine,
      startOffset: previousLine.indexOf("with equal"),
      endFragment: fourthSelectedLine,
    });
    const figStart = firstSelectedLine.indexOf("Fig. 5");
    const firstLineCharWidth = (leftLineRight - leftLineLeft) / firstSelectedLine.length;
    const dragStartX = leftLineLeft + (figStart * firstLineCharWidth);
    const dragEndX = leftLineLeft + 122;

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: [
        "with equal and opposite Delta E, as can be inferred",
        firstSelectedLine,
        secondSelectedLine,
        thirdSelectedLine,
        fourthSelectedLine,
      ].join(" "),
      pages: [page],
      clientRects: [
        { left: 138, right: leftLineRight, top: 420, bottom: 444 },
        { left: leftLineLeft, right: leftLineRight, top: 452, bottom: 476 },
        { left: leftLineLeft, right: leftLineRight, top: 484, bottom: 508 },
        { left: rightLineLeft, right: rightLineRight, top: 484, bottom: 508 },
        { left: leftLineLeft, right: leftLineRight - 24, top: 516, bottom: 540 },
        { left: rightLineLeft, right: rightLineRight, top: 516, bottom: 540 },
        { left: leftLineLeft, right: dragEndX, top: 548, bottom: 572 },
      ],
      dragStartPoint: { x: dragStartX + 2, y: 464 },
      dragEndPoint: { x: dragEndX - 2, y: 560 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toContain("Fig. 5, that tend");
      expect(result.selection.textQuote.exact).toContain("opposite directions. Even so");
      expect(result.selection.textQuote.exact).not.toContain("direc-");
      expect(result.selection.textQuote.exact).not.toContain("where j");
      expect(result.selection.textQuote.exact).not.toContain("dipole-dipole");
      expect(Math.max(...result.selection.pageRects.map((rect) => rect.x2))).toBeLessThan(0.55);
    }
  });

  it("uses pointer visual boundaries when DOM order interleaves right-column text into a Saffman selection", () => {
    const previousLine = "of states with equal and opposite Delta E, as can be inferred";
    const firstSelectedLine = "from Fig. 5, that tend to cause shifts in opposite direc-";
    const secondSelectedLine = "tions. Even so, the electric field stability required to hold";
    const thirdSelectedLine = "Stark shifts below 1 MHz is typically of order";
    const fourthSelectedLine = "0.01(100/n)7/2 V/cm.";
    const rightLineA = "where j is the total angular momentum";
    const rightLineB = "dipole-dipole interaction of atom states";
    const leftLineLeft = 52;
    const leftLineRight = 302;
    const rightLineLeft = 356;
    const rightLineRight = 616;
    const lineHeight = 22;
    const firstLineTop = 452;
    const page = createPageContext({
      fragments: [
        { text: previousLine, left: leftLineLeft, top: 420, width: leftLineRight - leftLineLeft, height: lineHeight },
        { text: firstSelectedLine, left: leftLineLeft, top: firstLineTop, width: leftLineRight - leftLineLeft, height: lineHeight },
        { text: secondSelectedLine, left: leftLineLeft, top: firstLineTop + 32, width: leftLineRight - leftLineLeft, height: lineHeight },
        { text: rightLineA, left: rightLineLeft, top: firstLineTop + 32, width: rightLineRight - rightLineLeft, height: lineHeight },
        { text: thirdSelectedLine, left: leftLineLeft, top: firstLineTop + 64, width: leftLineRight - leftLineLeft - 24, height: lineHeight },
        { text: rightLineB, left: rightLineLeft, top: firstLineTop + 64, width: rightLineRight - rightLineLeft, height: lineHeight },
        { text: fourthSelectedLine, left: leftLineLeft, top: firstLineTop + 96, width: 122, height: lineHeight },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: previousLine,
      startOffset: previousLine.indexOf("with equal"),
      endFragment: fourthSelectedLine,
    });
    const figStart = firstSelectedLine.indexOf("Fig. 5");
    const firstLineCharWidth = (leftLineRight - leftLineLeft) / firstSelectedLine.length;
    const dragStartX = leftLineLeft + (figStart * firstLineCharWidth);
    const dragEndX = leftLineLeft + 122;

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: [
        "with equal and opposite Delta E, as can be inferred",
        firstSelectedLine,
        secondSelectedLine,
        rightLineA,
        thirdSelectedLine,
        rightLineB,
        fourthSelectedLine,
      ].join(" "),
      pages: [page],
      clientRects: [
        { left: 138, right: leftLineRight, top: 420, bottom: 420 + lineHeight },
        { left: dragStartX, right: leftLineRight, top: firstLineTop, bottom: firstLineTop + lineHeight },
        { left: leftLineLeft, right: leftLineRight, top: firstLineTop + 32, bottom: firstLineTop + 32 + lineHeight },
        { left: rightLineLeft, right: rightLineRight, top: firstLineTop + 32, bottom: firstLineTop + 32 + lineHeight },
        { left: leftLineLeft, right: leftLineRight - 24, top: firstLineTop + 64, bottom: firstLineTop + 64 + lineHeight },
        { left: rightLineLeft, right: rightLineRight, top: firstLineTop + 64, bottom: firstLineTop + 64 + lineHeight },
        { left: leftLineLeft, right: dragEndX, top: firstLineTop + 96, bottom: firstLineTop + 96 + lineHeight },
      ],
      dragStartPoint: { x: dragStartX + 2, y: firstLineTop + (lineHeight / 2) },
      dragEndPoint: { x: dragEndX - 2, y: firstLineTop + 96 + (lineHeight / 2) },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toContain("Fig. 5, that tend");
      expect(result.selection.textQuote.exact).toContain("opposite directions. Even so");
      expect(result.selection.textQuote.exact).not.toContain("direc-");
      expect(result.selection.textQuote.exact).not.toContain("with equal and opposite");
      expect(result.selection.textQuote.exact).not.toContain("where j");
      expect(result.selection.textQuote.exact).not.toContain("dipole-dipole");
      expect(Math.max(...result.selection.pageRects.map((rect) => rect.x2))).toBeLessThan(0.55);
    }
  });

  it("matches the component Saffman regression data without keeping right-column prose", () => {
    const previousLine = "of states with equal and opposite Delta E, as can be inferred";
    const firstSelectedLine = "from Fig. 5, that tend to cause shifts in opposite direc-";
    const secondSelectedLine = "tions. Even so, the electric field stability required to hold";
    const thirdSelectedLine = "Stark shifts below 1 MHz is typically of order";
    const fourthSelectedLine = "0.01(100/n)7/2 V/cm.";
    const rightLineA = "where j is the total angular momentum";
    const rightLineB = "dipole-dipole interaction of atom states";
    const leftLineLeft = 52;
    const leftLineRight = 302;
    const rightLineLeft = 356;
    const rightLineRight = 616;
    const lineHeight = 22;
    const firstLineTop = 452;
    const figStart = firstSelectedLine.indexOf("Fig. 5");
    const firstLineCharWidth = (leftLineRight - leftLineLeft) / firstSelectedLine.length;
    const selectedLeft = leftLineLeft + (figStart * firstLineCharWidth);
    const selectedEndX = leftLineLeft + 122;
    const selectedText = [
      "Fig. 5, that tend to cause shifts in opposite direc-",
      "tions. Even so, the electric field stability required to hold",
      "Stark shifts below 1 MHz is typically of order",
      fourthSelectedLine,
    ].join(" ");
    const page = createPageContext({
      fragments: [
        { text: previousLine, left: leftLineLeft, top: 420, width: leftLineRight - leftLineLeft, height: lineHeight },
        { text: firstSelectedLine, left: leftLineLeft, top: firstLineTop, width: leftLineRight - leftLineLeft, height: lineHeight },
        { text: secondSelectedLine, left: leftLineLeft, top: firstLineTop + 32, width: leftLineRight - leftLineLeft, height: lineHeight },
        { text: rightLineA, left: rightLineLeft, top: firstLineTop + 32, width: rightLineRight - rightLineLeft, height: lineHeight },
        { text: thirdSelectedLine, left: leftLineLeft, top: firstLineTop + 64, width: leftLineRight - leftLineLeft - 24, height: lineHeight },
        { text: rightLineB, left: rightLineLeft, top: firstLineTop + 64, width: rightLineRight - rightLineLeft, height: lineHeight },
        { text: fourthSelectedLine, left: leftLineLeft, top: firstLineTop + 96, width: selectedEndX - leftLineLeft, height: lineHeight },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: previousLine,
      endFragment: fourthSelectedLine,
      startOffset: previousLine.indexOf("with equal"),
      endOffset: fourthSelectedLine.length,
    });

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: selectedText,
      pages: [page],
      clientRects: [
        { left: 138, right: leftLineRight, top: 420, bottom: 420 + lineHeight },
        { left: selectedLeft, right: leftLineRight, top: firstLineTop, bottom: firstLineTop + lineHeight },
        { left: leftLineLeft, right: leftLineRight, top: firstLineTop + 32, bottom: firstLineTop + 32 + lineHeight },
        { left: rightLineLeft, right: rightLineRight, top: firstLineTop + 32, bottom: firstLineTop + 32 + lineHeight },
        { left: leftLineLeft, right: leftLineRight - 24, top: firstLineTop + 64, bottom: firstLineTop + 64 + lineHeight },
        { left: rightLineLeft, right: rightLineRight, top: firstLineTop + 64, bottom: firstLineTop + 64 + lineHeight },
        { left: leftLineLeft, right: selectedEndX, top: firstLineTop + 96, bottom: firstLineTop + 96 + lineHeight },
      ],
      dragStartPoint: { x: selectedLeft + 1, y: firstLineTop + (lineHeight / 2) },
      dragEndPoint: { x: selectedEndX - 1, y: firstLineTop + 96 + (lineHeight / 2) },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toContain("Fig. 5, that tend");
      expect(result.selection.textQuote.exact).toContain("opposite directions. Even so");
      expect(result.selection.textQuote.exact).not.toContain("direc-");
      expect(result.selection.textQuote.exact).not.toContain("where j");
      expect(result.selection.textQuote.exact).not.toContain("dipole-dipole");
      expect(Math.max(...result.selection.pageRects.map((rect) => rect.x2))).toBeLessThan(0.55);
    }
  });

  it("keeps a Saffman Fig. 7 paragraph selection in order with inline quantum-state fragments", () => {
    const lineA = "states of this type. To illustrate, Fig. 7 shows the energy";
    const lineBPrefix = "level structure centered around the |60p";
    const lineBSupA = "3/2";
    const lineBMid = "60p";
    const lineBSupB = "3/2";
    const lineBSuffix = "> state of";
    const lineC = "Rb at zero relative energy. If we restrict changes in the";
    const lineD = "principal quantum numbers to at most \u00b18, there are 18";
    const lineE = "two-atom states within \u00b14 GHz of the initial state.";
    const selectedText = [
      "Fig. 7 shows the energy",
      "level structure centered around the |60p3/2 60p3/2> state of",
      lineC,
      lineD,
      lineE,
    ].join(" ");
    const left = 64;
    const right = 560;
    const lineHeight = 24;
    const page = createPageContext({
      fragments: [
        { text: lineA, left, top: 210, width: right - left, height: lineHeight },
        { text: lineBPrefix, left, top: 242, width: 270, height: lineHeight },
        { text: lineBSupA, left: 334, top: 234, width: 24, height: 12 },
        { text: " ", left: 358, top: 242, width: 8, height: lineHeight },
        { text: lineBMid, left: 366, top: 242, width: 34, height: lineHeight },
        { text: lineBSupB, left: 400, top: 234, width: 24, height: 12 },
        { text: lineBSuffix, left: 424, top: 242, width: 110, height: lineHeight },
        { text: lineC, left, top: 274, width: right - left - 20, height: lineHeight },
        { text: lineD, left, top: 306, width: right - left - 35, height: lineHeight },
        { text: lineE, left, top: 338, width: right - left - 80, height: lineHeight },
      ],
    });
    const range = createRangeAcrossFragments({
      startFragment: lineA,
      startOffset: lineA.indexOf("Fig. 7"),
      endFragment: lineE,
      endOffset: lineE.length,
    });
    const firstLineCharWidth = (right - left) / lineA.length;
    const selectedLeft = left + (lineA.indexOf("Fig. 7") * firstLineCharWidth);
    const selectedEndX = left + (right - left - 80);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: selectedText,
      pages: [page],
      clientRects: [
        { left: selectedLeft, right, top: 210, bottom: 210 + lineHeight },
        { left, right: 534, top: 234, bottom: 266 },
        { left, right: right - 20, top: 274, bottom: 274 + lineHeight },
        { left, right: right - 35, top: 306, bottom: 306 + lineHeight },
        { left, right: selectedEndX, top: 338, bottom: 338 + lineHeight },
      ],
      dragStartPoint: { x: selectedLeft + 2, y: 222 },
      dragEndPoint: { x: selectedEndX - 2, y: 350 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toContain("Fig. 7 shows the energy");
      expect(result.selection.textQuote.exact).toContain("|60p3/2 60p3/2> state");
      expect(result.selection.textQuote.exact).toContain("two-atom states within \u00b14 GHz");
      expect(result.selection.textQuote.exact).not.toContain("p 3/2 p 3/2");
      expect(result.selection.textQuote.exact).not.toBe("0");
      expect(result.selection.pageRects).toHaveLength(5);
    }
  });

  it("keeps a Saffman right-column prose selection from resolving to a stray zero", () => {
    const leftStray = "0";
    const rightLineA = "where a and b are the positions of the two Rydberg";
    const rightLineB = "electrons measured from their respective nuclei. At such";
    const rightLineC = "large distances, overlap between the atoms can be ne-";
    const rightLineD = "glected.";
    const selectedText = [
      rightLineA,
      rightLineB,
      rightLineC,
      rightLineD,
    ].join(" ");
    const page = createPageContext({
      fragments: [
        { text: leftStray, left: 96, top: 250, width: 10, height: 12 },
        { text: rightLineA, left: 340, top: 210, width: 260, height: 22 },
        { text: rightLineB, left: 340, top: 240, width: 270, height: 22 },
        { text: rightLineC, left: 340, top: 270, width: 270, height: 22 },
        { text: rightLineD, left: 340, top: 300, width: 80, height: 22 },
      ],
    });
    const range = createRangeWithinFragment(leftStray, leftStray);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "0",
      pages: [page],
      clientRects: [
        { left: 340, right: 600, top: 210, bottom: 232 },
        { left: 340, right: 610, top: 240, bottom: 262 },
        { left: 340, right: 610, top: 270, bottom: 292 },
        { left: 340, right: 420, top: 300, bottom: 322 },
      ],
      dragStartPoint: { x: 342, y: 221 },
      dragEndPoint: { x: 418, y: 311 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toContain("where a and b are the positions");
      expect(result.selection.textQuote.exact).toContain("large distances");
      expect(result.selection.textQuote.exact).not.toBe("0");
      expect(Math.min(...result.selection.pageRects.map((rect) => rect.x1))).toBeGreaterThan(0.5);
    }
  });

  it("uses explicit right-column geometry even when desktop pointer metadata is missing", () => {
    const leftStray = "0";
    const rightLineA = "where a and b are the positions of the two Rydberg";
    const rightLineB = "electrons measured from their respective nuclei. At such";
    const rightLineC = "large distances, overlap between the atoms can be ne-";
    const rightLineD = "glected.";
    const page = createPageContext({
      fragments: [
        { text: leftStray, left: 96, top: 250, width: 10, height: 12 },
        { text: rightLineA, left: 340, top: 210, width: 260, height: 22 },
        { text: rightLineB, left: 340, top: 240, width: 270, height: 22 },
        { text: rightLineC, left: 340, top: 270, width: 270, height: 22 },
        { text: rightLineD, left: 340, top: 300, width: 80, height: 22 },
      ],
    });
    const range = createRangeWithinFragment(leftStray, leftStray);

    const result = resolvePdfSelectionFromNativeRange({
      range,
      text: "0",
      pages: [page],
      clientRects: [
        { left: 340, right: 600, top: 210, bottom: 232 },
        { left: 340, right: 610, top: 240, bottom: 262 },
        { left: 340, right: 610, top: 270, bottom: 292 },
        { left: 340, right: 420, top: 300, bottom: 322 },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.textQuote.exact).toContain("where a and b are the positions");
      expect(result.selection.textQuote.exact).toContain("large distances");
      expect(result.selection.textQuote.exact).not.toBe("0");
      expect(Math.min(...result.selection.pageRects.map((rect) => rect.x1))).toBeGreaterThan(0.5);
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
