import { describe, expect, it } from "vitest";
import {
  beginPdfSelectionSession,
  isDuplicatePdfSelection,
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
});
