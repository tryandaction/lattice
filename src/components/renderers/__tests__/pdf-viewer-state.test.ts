import { describe, expect, it } from "vitest";
import {
  buildViewerVisiblePageSeed,
  getPdfViewerViewStateKey,
  readPdfViewerViewState,
} from "@/lib/pdf-viewer-position-state";

describe("pdf viewer view state helpers", () => {
  it("scopes in-memory view state by pane and document", () => {
    expect(getPdfViewerViewStateKey("left-pane", "paper-a.pdf")).toBe("left-pane:paper-a.pdf");
    expect(getPdfViewerViewStateKey("left-pane", "paper-b.pdf")).toBe("left-pane:paper-b.pdf");
    expect(getPdfViewerViewStateKey(undefined, "paper-a.pdf")).toBe("document:paper-a.pdf");
  });

  it("reads valid persisted viewer position state", () => {
    expect(readPdfViewerViewState({
      scale: 1.5,
      fitMode: "manual",
      scrollTop: 2400,
      scrollLeft: 12,
      currentPage: 7,
      relativeScroll: { topRatio: 0.42, leftRatio: 0.1 },
    })).toEqual({
      scale: 1.5,
      fitMode: "manual",
      scrollTop: 2400,
      scrollLeft: 12,
      currentPage: 7,
      relativeScroll: { topRatio: 0.42, leftRatio: 0.1 },
    });
  });

  it("rejects invalid persisted viewer position state", () => {
    expect(readPdfViewerViewState(null)).toBeNull();
    expect(readPdfViewerViewState({ scale: "1.5", fitMode: "manual" })).toBeNull();
    expect(readPdfViewerViewState({ scale: 1.5, fitMode: "fit-width" })).toBeNull();
  });

  it("seeds virtual rendering around the restored page", () => {
    expect(Array.from(buildViewerVisiblePageSeed(1))).toEqual([1, 2, 3]);
    expect(Array.from(buildViewerVisiblePageSeed(8))).toEqual([6, 7, 8, 9, 10]);
  });
});
