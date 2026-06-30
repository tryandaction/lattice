import { describe, expect, it } from "vitest";
import {
  parsePdfAnnotationIdFromTarget,
  parsePdfLinkTarget,
  parsePdfNamedDestinationFromTarget,
  parsePdfPageFromTarget,
  shouldOpenPdfExternalLinkInBrowser,
} from "../pdf-link-navigation";

describe("pdf-link-navigation", () => {
  it("normalizes common external PDF link targets", () => {
    expect(parsePdfLinkTarget("https://example.com/paper")).toEqual({
      type: "external",
      url: "https://example.com/paper",
    });
    expect(parsePdfLinkTarget("doi:10.1038/test")).toEqual({
      type: "external",
      url: "https://doi.org/10.1038/test",
    });
    expect(parsePdfLinkTarget("www.example.com")).toEqual({
      type: "external",
      url: "https://www.example.com",
    });
  });

  it("parses internal page, annotation, and named destinations", () => {
    expect(parsePdfPageFromTarget("#page=12")).toBe(12);
    expect(parsePdfAnnotationIdFromTarget("paper.pdf#annotation=ann-1")).toBe("ann-1");
    expect(parsePdfNamedDestinationFromTarget("#nameddest=References")).toBe("References");
    expect(parsePdfNamedDestinationFromTarget("#section%201")).toBe("section 1");
  });

  it("uses modifiers and settings to decide browser opening", () => {
    expect(shouldOpenPdfExternalLinkInBrowser({ ctrlKey: false, metaKey: false, shiftKey: false }, "internal")).toBe(false);
    expect(shouldOpenPdfExternalLinkInBrowser({ ctrlKey: true, metaKey: false, shiftKey: false }, "internal")).toBe(true);
    expect(shouldOpenPdfExternalLinkInBrowser({ ctrlKey: false, metaKey: false, shiftKey: false }, "browser")).toBe(true);
  });
});
