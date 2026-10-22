import { describe, expect, it } from "vitest";
import {
  findPdfTextLinkMatches,
  parsePdfAnnotationIdFromTarget,
  parsePdfExplicitDestinationFromTarget,
  parsePdfLinkTarget,
  parsePdfLinkTargetFromElement,
  parsePdfNamedActionFromTarget,
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

  it("parses explicit PDF destination arrays and named actions", () => {
    const destination = [{ num: 3, gen: 0 }, { name: "XYZ" }, 72, 144, null];
    const encoded = `#explicitDest=${encodeURIComponent(JSON.stringify(destination))}`;

    expect(parsePdfExplicitDestinationFromTarget(encoded)).toEqual(destination);
    expect(parsePdfLinkTarget(encoded)).toEqual({
      type: "explicitDestination",
      destination,
    });
    expect(parsePdfNamedActionFromTarget("#action=NextPage")).toBe("NextPage");
    expect(parsePdfLinkTarget("#action=PrevPage")).toEqual({
      type: "namedAction",
      action: "PrevPage",
    });
  });

  it("prefers Lattice-enriched link target metadata over empty generated hrefs", () => {
    const section = document.createElement("section");
    section.className = "linkAnnotation";
    section.dataset.pdfLinkTarget = "https://example.com/full-paper";
    const anchor = document.createElement("a");
    anchor.href = "#";
    section.appendChild(anchor);

    expect(parsePdfLinkTargetFromElement(section)).toEqual({
      type: "external",
      url: "https://example.com/full-paper",
    });
  });

  it("detects scholarly text links from PDF text layer content", () => {
    expect(findPdfTextLinkMatches("Check for updates at www.nature.com/articles/s41586-026-00001-2.")[0]).toMatchObject({
      target: {
        type: "external",
        url: "https://www.nature.com/articles/s41586-026-00001-2",
      },
    });
    expect(findPdfTextLinkMatches("doi: 10.1145/1234567.8901234")[0]).toMatchObject({
      target: {
        type: "external",
        url: "https://doi.org/10.1145/1234567.8901234",
      },
    });
    expect(findPdfTextLinkMatches("arXiv:2401.01234v2")[0]).toMatchObject({
      target: {
        type: "external",
        url: "https://arxiv.org/abs/2401.01234v2",
      },
    });
  });

  it("normalizes zero-width split scholarly identifiers and trims trailing punctuation", () => {
    const doi = findPdfTextLinkMatches("See doi: 10.1038/\u200bs41586-026-00001-2). next")[0];
    const arxiv = findPdfTextLinkMatches("Preprint arXiv:\u200b2401.01234v2, revised")[0];

    expect(doi).toMatchObject({
      target: { type: "external", url: "https://doi.org/10.1038/s41586-026-00001-2" },
      rawText: "doi: 10.1038/\u200bs41586-026-00001-2",
    });
    expect(arxiv).toMatchObject({
      target: { type: "external", url: "https://arxiv.org/abs/2401.01234v2" },
      rawText: "arXiv:\u200b2401.01234v2",
    });
  });

  it("uses modifiers and settings to decide browser opening", () => {
    expect(shouldOpenPdfExternalLinkInBrowser({ ctrlKey: false, metaKey: false, shiftKey: false }, "internal")).toBe(false);
    expect(shouldOpenPdfExternalLinkInBrowser({ ctrlKey: true, metaKey: false, shiftKey: false }, "internal")).toBe(true);
    expect(shouldOpenPdfExternalLinkInBrowser({ ctrlKey: false, metaKey: false, shiftKey: false }, "browser")).toBe(true);
  });
});
