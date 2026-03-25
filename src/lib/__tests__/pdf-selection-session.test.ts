import { describe, expect, it } from "vitest";
import {
  beginPdfSelectionSession,
  isDuplicatePdfSelection,
  projectPdfSelectionRectsToPages,
  updatePdfSelectionSession,
} from "../pdf-selection-session";

describe("pdf-selection-session", () => {
  it("tracks selection phases with a monotonic token", () => {
    const started = beginPdfSelectionSession(null, 100);
    expect(started).toEqual({
      token: 1,
      phase: "native_dragging",
      signature: null,
      timestamp: 100,
    });

    const promoted = updatePdfSelectionSession(started, {
      phase: "native_settled",
      signature: "sig-1",
      now: 120,
    });
    expect(promoted).toEqual({
      token: 1,
      phase: "native_settled",
      signature: "sig-1",
      timestamp: 120,
    });

    const restarted = beginPdfSelectionSession(promoted, 200);
    expect(restarted.token).toBe(2);
    expect(restarted.phase).toBe("native_dragging");
    expect(restarted.signature).toBeNull();
  });

  it("suppresses duplicate selection replays only within the same token window", () => {
    const settled = updatePdfSelectionSession(beginPdfSelectionSession(null, 10), {
      phase: "native_settled",
      signature: "sig-1",
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
});
