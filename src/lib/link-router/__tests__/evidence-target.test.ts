import { describe, expect, it } from "vitest";
import { attachEvidenceAnchor } from "../evidence-target";
import type { WorkspaceEvidenceAnchor } from "../types";

const anchor: WorkspaceEvidenceAnchor = {
  page: 12,
  snippet: "Text from page twelve",
  rects: [{ left: 0.2, top: 0.3, width: 0.4, height: 0.05 }],
};

describe("attachEvidenceAnchor", () => {
  it("keeps an explicit same-page quote without attaching another passage's geometry", () => {
    expect(attachEvidenceAnchor({ type: "pdf_page", path: "paper.pdf", page: 12, snippet: "A different sentence" }, anchor))
      .toEqual({ type: "pdf_page", path: "paper.pdf", page: 12, snippet: "A different sentence" });
  });

  it("does not reuse another page's quote or rectangles for an explicit page target", () => {
    expect(attachEvidenceAnchor({ type: "pdf_page", path: "paper.pdf", page: 3 }, anchor))
      .toEqual({ type: "pdf_page", path: "paper.pdf", page: 3 });
  });

  it("keeps the explicit target quote when an attached anchor belongs to another page", () => {
    expect(attachEvidenceAnchor({ type: "pdf_page", path: "paper.pdf", page: 3, snippet: "Text from page three" }, anchor))
      .toEqual({ type: "pdf_page", path: "paper.pdf", page: 3, snippet: "Text from page three" });
  });

  it("retains matching-page evidence geometry", () => {
    expect(attachEvidenceAnchor({ type: "pdf_page", path: "paper.pdf", page: 12 }, anchor))
      .toEqual({ type: "pdf_page", path: "paper.pdf", ...anchor });
  });

  it("uses the anchor page when the file link has no explicit page", () => {
    expect(attachEvidenceAnchor({ type: "workspace_file", path: "paper.pdf" }, anchor))
      .toEqual({ type: "pdf_page", path: "paper.pdf", ...anchor });
  });

  it("supports legacy evidence without a page when the target already has one", () => {
    expect(attachEvidenceAnchor({ type: "pdf_page", path: "paper.pdf", page: 3 }, { snippet: "Page three quote" }))
      .toEqual({ type: "pdf_page", path: "paper.pdf", page: 3, snippet: "Page three quote" });
  });
});
