import { describe, expect, it } from "vitest";
import {
  beginPdfSelectionSession,
  createPdfSelectionSnapshot,
  projectPdfScaledSelectionToViewportRects,
  resolvePdfCopySelectionText,
  isDuplicatePdfSelection,
  projectPdfSelectionRectsToPages,
  updatePdfSelectionSession,
} from "../pdf-selection-session";

describe("pdf-selection-session", () => {
  const snapshot = createPdfSelectionSnapshot({
    text: "Selected PDF text",
    scaledPosition: {
      boundingRect: {
        x1: 10,
        y1: 20,
        x2: 110,
        y2: 40,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [{
        x1: 10,
        y1: 20,
        x2: 110,
        y2: 40,
        width: 640,
        height: 960,
        pageNumber: 1,
      }],
      pageNumber: 1,
    },
    overlayRects: [{
      left: 12,
      top: 24,
      width: 100,
      height: 20,
      pageNumber: 1,
    }],
    sourceTrust: "native",
    signature: "sig-1",
  });

  it("tracks selection phases with a monotonic token", () => {
    const started = beginPdfSelectionSession(null, 100);
    expect(started).toEqual({
      token: 1,
      phase: "native_dragging",
      timestamp: 100,
      snapshot: null,
    });

    const promoted = updatePdfSelectionSession(started, {
      phase: "frozen",
      snapshot,
      now: 120,
    });
    expect(promoted).toEqual({
      token: 1,
      phase: "frozen",
      timestamp: 120,
      snapshot,
    });

    const restarted = beginPdfSelectionSession(promoted, 200);
    expect(restarted.token).toBe(2);
    expect(restarted.phase).toBe("native_dragging");
    expect(restarted.snapshot).toBeNull();
  });

  it("suppresses duplicate selection replays only within the same token window", () => {
    const settled = updatePdfSelectionSession(beginPdfSelectionSession(null, 10), {
      phase: "frozen",
      snapshot,
      now: 20,
    });

    expect(isDuplicatePdfSelection(settled, {
      signature: "sig-1",
      token: 1,
      now: 40,
    })).toBe(true);

    expect(isDuplicatePdfSelection(settled, {
      signature: "sig-1",
      token: 2,
      now: 40,
    })).toBe(false);

    const cancelled = updatePdfSelectionSession(settled, {
      phase: "cancelled",
      now: 50,
    });
    expect(isDuplicatePdfSelection(cancelled, {
      signature: "sig-1",
      token: 1,
      now: 60,
    })).toBe(false);
  });

  it("clips client rects to page bounds and sorts them by page and position", () => {
    const rects = projectPdfSelectionRectsToPages({
      clientRects: [
        { left: 12, right: 120, top: 24, bottom: 48 },
        { left: 10, right: 160, top: 1010, bottom: 1040 },
        { left: -50, right: 50, top: 20, bottom: 40 },
      ],
      pages: [
        { pageNumber: 2, left: 0, top: 1000, width: 640, height: 960 },
        { pageNumber: 1, left: 0, top: 0, width: 100, height: 80 },
      ],
    });

    expect(rects).toEqual([
      { left: 0, top: 20, width: 50, height: 20, pageNumber: 1 },
      { left: 12, top: 24, width: 88, height: 24, pageNumber: 1 },
      { left: 10, top: 10, width: 150, height: 30, pageNumber: 2 },
    ]);
  });

  it("projects scaled selection rects into rendered page viewport coordinates", () => {
    const rects = projectPdfScaledSelectionToViewportRects({
      scaledPosition: {
        boundingRect: {
          x1: 0,
          y1: 0,
          x2: 0,
          y2: 0,
          width: 640,
          height: 960,
          pageNumber: 1,
        },
        rects: [
          { x1: 64, y1: 96, x2: 192, y2: 144, width: 640, height: 960, pageNumber: 1 },
          { x1: 32, y1: 48, x2: 96, y2: 96, width: 320, height: 640, pageNumber: 2 },
        ],
        pageNumber: 1,
      },
      pages: [
        { pageNumber: 1, width: 800, height: 1200 },
        { pageNumber: 2, width: 400, height: 800 },
      ],
    });

    expect(rects).toEqual([
      { left: 80, top: 120, width: 160, height: 60, pageNumber: 1 },
      { left: 40, top: 60, width: 80, height: 60, pageNumber: 2 },
    ]);
  });

  it("resolves copy text with credible native selection first and frozen snapshot second", () => {
    expect(resolvePdfCopySelectionText({
      nativeText: " Native PDF text ",
      frozenSnapshot: snapshot,
    })).toBe("Native PDF text");

    expect(resolvePdfCopySelectionText({
      nativeText: "",
      frozenSnapshot: snapshot,
    })).toBe("Selected PDF text");
  });
});
