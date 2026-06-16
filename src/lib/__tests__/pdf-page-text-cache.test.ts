/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRenderedPdfPageTextModel,
  clearPdfPageTextCache,
  resolvePdfPageTextOffset,
} from "../pdf-page-text-cache";

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

describe("pdf-page-text-cache", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    clearPdfPageTextCache();
    vi.restoreAllMocks();
  });

  it("rebuilds rendered text rects when zoom changes without text changes", () => {
    const pageElement = document.createElement("div");
    pageElement.dataset.pageNumber = "1";
    let pageRect = createMockRect(0, 0, 640, 960);
    Object.defineProperty(pageElement, "getBoundingClientRect", {
      configurable: true,
      value: () => pageRect,
    });

    const pageShell = document.createElement("div");
    pageShell.dataset.scale = "1";
    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    let textRect = createMockRect(40, 120, 200, 24);
    const span = document.createElement("span");
    span.textContent = "coherent tunneling";
    Object.defineProperty(span, "getBoundingClientRect", {
      configurable: true,
      value: () => textRect,
    });
    textLayer.appendChild(span);
    pageShell.appendChild(textLayer);
    pageElement.appendChild(pageShell);
    document.body.appendChild(pageElement);

    const firstModel = buildRenderedPdfPageTextModel(pageElement);
    expect(firstModel?.itemRects[0]).toMatchObject({
      left: 40,
      top: 120,
      width: 200,
      height: 24,
    });

    pageShell.dataset.scale = "1.5";
    pageRect = createMockRect(0, 0, 960, 1440);
    textRect = createMockRect(60, 180, 300, 36);

    const secondModel = buildRenderedPdfPageTextModel(pageElement);
    expect(secondModel?.itemRects[0]).toMatchObject({
      left: 60,
      top: 180,
      width: 300,
      height: 36,
    });
  });

  it("uses the rendered text-node range rect before a widened parent span rect", () => {
    const pageElement = document.createElement("div");
    pageElement.dataset.pageNumber = "1";
    Object.defineProperty(pageElement, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(0, 0, 640, 960),
    });

    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    const span = document.createElement("span");
    span.textContent = "from Fig. 5, that tend";
    Object.defineProperty(span, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(80, 120, 480, 24),
    });
    textLayer.appendChild(span);
    pageElement.appendChild(textLayer);
    document.body.appendChild(pageElement);

    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: vi.fn(() => createMockRect(80, 120, 170, 24)),
    });

    const model = buildRenderedPdfPageTextModel(pageElement);

    expect(model?.itemRects[0]).toMatchObject({
      left: 80,
      top: 120,
      width: 170,
      height: 24,
    });
  });

  it("resolves offsets within nested inline formatting without falling back to the whole text layer", () => {
    const pageElement = document.createElement("div");
    pageElement.dataset.pageNumber = "1";
    Object.defineProperty(pageElement, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(0, 0, 640, 960),
    });

    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    const span = document.createElement("span");
    Object.defineProperty(span, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(80, 120, 320, 24),
    });
    span.append("pred_complex.csv, ");
    const strong = document.createElement("strong");
    strong.textContent = "containing a single column";
    span.appendChild(strong);
    textLayer.appendChild(span);
    pageElement.appendChild(textLayer);
    document.body.appendChild(pageElement);

    const model = buildRenderedPdfPageTextModel(pageElement);
    expect(model).toBeTruthy();
    if (!model) {
      throw new Error("Missing rendered model");
    }

    const startOffset = resolvePdfPageTextOffset({
      model,
      container: strong,
      offset: 0,
      affinity: "start",
    });
    const endOffset = resolvePdfPageTextOffset({
      model,
      container: strong,
      offset: strong.childNodes.length,
      affinity: "end",
    });

    expect(startOffset).not.toBeNull();
    expect(endOffset).not.toBeNull();
    expect(model.normalizedText.slice(startOffset ?? 0, endOffset ?? 0)).toBe("containing a single column");
  });

  it("keeps inline formula fragments attached to the same visual line without inserting synthetic spaces", () => {
    const pageElement = document.createElement("div");
    pageElement.dataset.pageNumber = "1";
    Object.defineProperty(pageElement, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(0, 0, 640, 960),
    });

    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";

    const fragments = [
      { text: "The coherence time ", left: 80, top: 120, width: 150, height: 24 },
      { text: "T", left: 232, top: 120, width: 14, height: 24 },
      { text: "2", left: 246, top: 130, width: 8, height: 12 },
      { text: "*", left: 255, top: 112, width: 8, height: 12 },
      { text: " = 3.7(4) s", left: 264, top: 120, width: 96, height: 24 },
    ];

    fragments.forEach((fragment) => {
      const span = document.createElement("span");
      span.textContent = fragment.text;
      Object.defineProperty(span, "getBoundingClientRect", {
        configurable: true,
        value: () => createMockRect(fragment.left, fragment.top, fragment.width, fragment.height),
      });
      textLayer.appendChild(span);
    });

    pageElement.appendChild(textLayer);
    document.body.appendChild(pageElement);

    const model = buildRenderedPdfPageTextModel(pageElement);
    expect(model).toBeTruthy();
    if (!model) {
      throw new Error("Missing rendered model");
    }

    expect(model.normalizedText).toBe("The coherence time T2* = 3.7(4) s");

    const formulaSegments = model.segments.filter((segment) => (
      segment.text === "T" ||
      segment.text === "2" ||
      segment.text === "*"
    ));
    expect(formulaSegments).toHaveLength(3);
    expect(new Set(formulaSegments.map((segment) => segment.lineIndex))).toHaveLength(1);
    expect(new Set(formulaSegments.map((segment) => segment.blockIndex))).toHaveLength(1);
  });

  it("keeps centered display equations in a separate block from the prose below", () => {
    const pageElement = document.createElement("div");
    pageElement.dataset.pageNumber = "1";
    Object.defineProperty(pageElement, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(0, 0, 640, 960),
    });

    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";

    const fragments = [
      { text: "Show that the structure factor is given by", left: 40, top: 120, width: 340, height: 24 },
      { text: "S(hkl) = fBa + (-1)^l fTi + [1 + 2(-1)^l] fO", left: 140, top: 190, width: 360, height: 30 },
      { text: "where fBa is the atomic form factor for Ba.", left: 60, top: 252, width: 320, height: 24 },
    ];

    fragments.forEach((fragment) => {
      const span = document.createElement("span");
      span.textContent = fragment.text;
      Object.defineProperty(span, "getBoundingClientRect", {
        configurable: true,
        value: () => createMockRect(fragment.left, fragment.top, fragment.width, fragment.height),
      });
      textLayer.appendChild(span);
    });

    pageElement.appendChild(textLayer);
    document.body.appendChild(pageElement);

    const model = buildRenderedPdfPageTextModel(pageElement);
    expect(model).toBeTruthy();
    if (!model) {
      throw new Error("Missing rendered model");
    }

    const equationSegment = model.segments.find((segment) => segment.text.includes("S(hkl)"));
    const proseSegment = model.segments.find((segment) => segment.text.includes("where fBa"));

    expect(equationSegment).toBeTruthy();
    expect(proseSegment).toBeTruthy();
    expect(equationSegment?.blockIndex).not.toBe(proseSegment?.blockIndex);
  });

  it("keeps a left-edge vertical sidebar in a separate block from nearby body text", () => {
    const pageElement = document.createElement("div");
    pageElement.dataset.pageNumber = "1";
    Object.defineProperty(pageElement, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(0, 0, 640, 960),
    });

    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";

    const sidebar = document.createElement("span");
    sidebar.textContent = "4";
    Object.defineProperty(sidebar, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(36, 460, 24, 180),
    });
    textLayer.appendChild(sidebar);

    const body = document.createElement("span");
    body.textContent = "We propose several schemes for implementing a fast two-qubit quantum gate";
    Object.defineProperty(body, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(160, 452, 420, 28),
    });
    textLayer.appendChild(body);

    pageElement.appendChild(textLayer);
    document.body.appendChild(pageElement);

    const model = buildRenderedPdfPageTextModel(pageElement);
    expect(model).toBeTruthy();
    if (!model) {
      throw new Error("Missing rendered model");
    }

    const sidebarSegment = model.segments.find((segment) => segment.text === "4");
    const bodySegment = model.segments.find((segment) => segment.text.includes("fast two-qubit"));

    expect(sidebarSegment).toBeTruthy();
    expect(bodySegment).toBeTruthy();
    expect(sidebarSegment?.blockIndex).not.toBe(bodySegment?.blockIndex);
    expect(sidebarSegment?.layoutClass).toBe("sidebar");
    expect(bodySegment?.layoutClass).toBe("main");
  });

  it("classifies footnote-style years and citation markers away from main prose", () => {
    const pageElement = document.createElement("div");
    pageElement.dataset.pageNumber = "1";
    Object.defineProperty(pageElement, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(0, 0, 640, 960),
    });

    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";

    const prose = document.createElement("span");
    prose.textContent = "The trapped-ion platform has shown rapid progress";
    Object.defineProperty(prose, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(120, 620, 360, 24),
    });
    textLayer.appendChild(prose);

    const citation = document.createElement("span");
    citation.textContent = "[25]";
    Object.defineProperty(citation, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(492, 623, 30, 16),
    });
    textLayer.appendChild(citation);

    const footnote = document.createElement("span");
    footnote.textContent = "2023";
    Object.defineProperty(footnote, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(72, 820, 38, 14),
    });
    textLayer.appendChild(footnote);

    pageElement.appendChild(textLayer);
    document.body.appendChild(pageElement);

    const model = buildRenderedPdfPageTextModel(pageElement);
    expect(model).toBeTruthy();
    if (!model) {
      throw new Error("Missing rendered model");
    }

    expect(model.segments.find((segment) => segment.text.includes("rapid progress"))?.layoutClass).toBe("main");
    expect(model.segments.find((segment) => segment.text === "[25]")?.layoutClass).toBe("auxiliary");
    expect(model.segments.find((segment) => segment.text === "2023")?.layoutClass).toBe("footnote");
  });

  it("assigns separate columns to left and right prose blocks in a two-column layout", () => {
    const pageElement = document.createElement("div");
    pageElement.dataset.pageNumber = "1";
    Object.defineProperty(pageElement, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(0, 0, 640, 960),
    });

    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";

    [
      { text: "Left column opening paragraph", left: 56, top: 140, width: 210, height: 22 },
      { text: "Left column second line", left: 56, top: 170, width: 206, height: 22 },
      { text: "Right column opening paragraph", left: 358, top: 140, width: 214, height: 22 },
      { text: "Right column second line", left: 358, top: 170, width: 208, height: 22 },
    ].forEach((fragment) => {
      const span = document.createElement("span");
      span.textContent = fragment.text;
      Object.defineProperty(span, "getBoundingClientRect", {
        configurable: true,
        value: () => createMockRect(fragment.left, fragment.top, fragment.width, fragment.height),
      });
      textLayer.appendChild(span);
    });

    pageElement.appendChild(textLayer);
    document.body.appendChild(pageElement);

    const model = buildRenderedPdfPageTextModel(pageElement);
    expect(model).toBeTruthy();
    if (!model) {
      throw new Error("Missing rendered model");
    }

    const leftSegment = model.segments.find((segment) => segment.text.includes("Left column opening"));
    const rightSegment = model.segments.find((segment) => segment.text.includes("Right column opening"));
    expect(leftSegment?.layoutClass).toBe("main");
    expect(rightSegment?.layoutClass).toBe("main");
    expect(leftSegment?.columnIndex).toBe(0);
    expect(rightSegment?.columnIndex).toBe(1);
  });

  it("classifies top-of-page author and DOI fragments away from body prose", () => {
    const pageElement = document.createElement("div");
    pageElement.dataset.pageNumber = "1";
    Object.defineProperty(pageElement, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(0, 0, 614, 803),
    });

    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";

    [
      { text: "Demon-like algorithmic quantum cooling and its", left: 49, top: 40, width: 493, height: 24 },
      { text: "realization with quantum optics", left: 49, top: 70, width: 324, height: 24 },
      { text: "Jin-Shi Xu, Man-Hong Yung, Xiao-Ye Xu", left: 49, top: 102, width: 260, height: 12 },
      { text: "1†", left: 312, top: 105, width: 6, height: 7 },
      { text: "2,3†", left: 325, top: 105, width: 13, height: 7 },
      { text: "PUBLISHED ONLINE: 19 JANUARY 2014 | DOI: 10.1038/NPHOTON.2013.354", left: 287, top: 20, width: 264, height: 8 },
      { text: "In the following, we report a proof-of-principle demonstration of", left: 49, top: 260, width: 250, height: 9 },
      { text: "the quantum cooling method with an all-optical set-up.", left: 49, top: 271, width: 240, height: 9 },
      { text: "that is, ref. 25 for a recent review of photonic quantum simulation.", left: 314, top: 260, width: 240, height: 9 },
    ].forEach((fragment) => {
      const span = document.createElement("span");
      span.textContent = fragment.text;
      Object.defineProperty(span, "getBoundingClientRect", {
        configurable: true,
        value: () => createMockRect(fragment.left, fragment.top, fragment.width, fragment.height),
      });
      textLayer.appendChild(span);
    });

    pageElement.appendChild(textLayer);
    document.body.appendChild(pageElement);

    const model = buildRenderedPdfPageTextModel(pageElement);
    expect(model).toBeTruthy();
    if (!model) {
      throw new Error("Missing rendered model");
    }

    expect(model.segments.find((segment) => segment.text.includes("Jin-Shi Xu"))?.layoutClass).toBe("metadata");
    expect(model.segments.find((segment) => segment.text === "1†")?.layoutClass).toBe("auxiliary");
    expect(model.segments.find((segment) => segment.text.includes("DOI: 10.1038"))?.layoutClass).toBe("metadata");
    expect(model.segments.find((segment) => segment.text.includes("proof-of-principle"))?.layoutClass).toBe("main");
  });
});
