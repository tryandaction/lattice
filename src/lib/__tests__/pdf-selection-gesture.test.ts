import { describe, expect, it } from "vitest";

import {
  PDF_SELECTION_DRAG_THRESHOLD_PX,
  beginPdfSelectionGesture,
  cancelPdfSelectionGesture,
  finishPdfSelectionGesture,
  projectPdfSelectionPageAnchor,
  shouldSuppressPdfLinkClick,
  updatePdfSelectionGesture,
} from "@/lib/pdf-selection-gesture";

describe("pdf selection gesture", () => {
  it("anchors the starting glyph to its page across scroll and zoom", () => {
    const gesture = beginPdfSelectionGesture({
      token: 1, pageNumber: 2, point: { x: 160, y: 440 },
      pageRect: { left: 100, top: 200, width: 600, height: 800 },
    });
    expect(gesture.startAnchor).toEqual({ pageNumber: 2, x: 0.1, y: 0.3 });
    expect(projectPdfSelectionPageAnchor(gesture.startAnchor!, {
      left: 100, top: -600, width: 600, height: 800,
    })).toEqual({ x: 160, y: -360 });
    expect(projectPdfSelectionPageAnchor(gesture.startAnchor!, {
      left: 80, top: -400, width: 900, height: 1200,
    })).toEqual({ x: 170, y: -40 });
    expect(gesture.start).toEqual({ x: 160, y: 440 });
  });

  it("does not manufacture page anchors from invalid page geometry", () => {
    const gesture = beginPdfSelectionGesture({
      token: 1, pageNumber: null, point: { x: 20, y: 20 },
      pageRect: { left: 0, top: 0, width: 0, height: 0 },
    });
    expect(gesture.startAnchor).toBeUndefined();
  });

  it("promotes a pointer candidate to a text drag at the shared threshold", () => {
    let gesture = beginPdfSelectionGesture({
      token: 4,
      pageNumber: 2,
      pointerId: 7,
      point: { x: 10, y: 10 },
    });

    gesture = updatePdfSelectionGesture(gesture, {
      point: { x: 10 + PDF_SELECTION_DRAG_THRESHOLD_PX, y: 10 },
      pointerId: 7,
      token: 4,
    });

    expect(gesture.kind).toBe("text_drag");
    expect(gesture.end).toEqual({ x: 13, y: 10 });
    expect(shouldSuppressPdfLinkClick(gesture)).toBe(true);
  });

  it("keeps a two-pixel pointer movement as a click candidate", () => {
    const gesture = updatePdfSelectionGesture(
      beginPdfSelectionGesture({
        token: 1,
        pageNumber: 3,
        point: { x: 20, y: 20 },
      }),
      { point: { x: 22, y: 20 }, token: 1 },
    );

    expect(gesture.kind).toBe("pointer_candidate");
    expect(shouldSuppressPdfLinkClick(gesture)).toBe(false);
  });

  it("ignores stale tokens and unrelated pointers", () => {
    const gesture = beginPdfSelectionGesture({
      token: 9,
      pageNumber: 1,
      pointerId: 3,
      point: { x: 0, y: 0 },
    });

    expect(updatePdfSelectionGesture(gesture, {
      point: { x: 20, y: 0 },
      pointerId: 3,
      token: 8,
    })).toBe(gesture);
    expect(updatePdfSelectionGesture(gesture, {
      point: { x: 20, y: 0 },
      pointerId: 4,
      token: 9,
    })).toBe(gesture);
  });

  it("cancels the gesture atomically", () => {
    const cancelled = cancelPdfSelectionGesture(beginPdfSelectionGesture({
      token: 2,
      pageNumber: 5,
      point: { x: 4, y: 5 },
    }));

    expect(cancelled.kind).toBe("cancelled");
    expect(shouldSuppressPdfLinkClick(cancelled)).toBe(false);
    expect(updatePdfSelectionGesture(cancelled, {
      point: { x: 40, y: 50 },
      token: 2,
    })).toBe(cancelled);
  });

  it("suppresses link activation when text dragging starts on a link", () => {
    const gesture = finishPdfSelectionGesture(
      updatePdfSelectionGesture(
        beginPdfSelectionGesture({
          token: 12,
          pageNumber: 6,
          pointerId: 11,
          point: { x: 100, y: 200 },
          startedOnLink: true,
        }),
        { point: { x: 118, y: 202 }, pointerId: 11, token: 12 },
      ),
      { point: { x: 120, y: 202 }, pointerId: 11, token: 12 },
    );

    expect(gesture.kind).toBe("text_drag");
    expect(gesture.finished).toBe(true);
    expect(gesture.startedOnLink).toBe(true);
    expect(shouldSuppressPdfLinkClick(gesture)).toBe(true);
  });
});
