import { describe, expect, it } from "vitest";
import {
  buildEmptyPdfAnnotationDraftsSection,
  mergePdfAnnotationDraftsSection,
  parsePdfAnnotationMarkdownDrafts,
  PDF_ANNOTATION_DRAFTS_BEGIN,
  PDF_ANNOTATION_DRAFTS_END,
  removeResolvedPdfAnnotationMarkdownDrafts,
} from "@/lib/pdf-annotation-markdown-drafts";

describe("pdf-annotation-markdown-drafts", () => {
  it("parses AI exact-quote PDF annotation drafts with default AI tags", () => {
    const markdown = [
      PDF_ANNOTATION_DRAFTS_BEGIN,
      '<!-- lattice-pdf-annotation id="ai-key-claim" page="7" type="underline" color="#2196F3" -->',
      "- Quote: Fig. 5, that tend to cause shifts in opposite directions. Even so",
      "- Comment: Check this claim against Fig. 5.",
      "- Tags: key-claim, rydberg",
      "",
      PDF_ANNOTATION_DRAFTS_END,
    ].join("\n");

    const drafts = parsePdfAnnotationMarkdownDrafts(markdown);

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      id: "ann-ai-key-claim",
      page: 7,
      styleType: "underline",
      color: "#2196F3",
      exact: "Fig. 5, that tend to cause shifts in opposite directions. Even so",
      comment: "Check this claim against Fig. 5.",
      author: "lattice-ai",
    });
    expect(drafts[0].tags).toEqual(["AI", "AI批注", "pdf-text-markup", "key-claim", "rydberg"]);
  });

  it("keeps existing AI draft sections when regenerating the annotation index", () => {
    const previous = [
      "# old annotations",
      "",
      PDF_ANNOTATION_DRAFTS_BEGIN,
      '<!-- lattice-pdf-annotation id="ann-ai-1" page="3" type="highlight" color="#FFD400" -->',
      "- Quote: exact text",
      "",
      PDF_ANNOTATION_DRAFTS_END,
    ].join("\n");
    const merged = mergePdfAnnotationDraftsSection("# new annotations", previous);

    expect(merged).toContain("# new annotations");
    expect(merged).toContain('id="ann-ai-1"');
    expect(merged).toContain("- Quote: exact text");
  });

  it("creates an empty draft section for new annotation indexes", () => {
    const section = buildEmptyPdfAnnotationDraftsSection();
    const merged = mergePdfAnnotationDraftsSection("# annotations", null);

    expect(section).toContain(PDF_ANNOTATION_DRAFTS_BEGIN);
    expect(section).toContain(PDF_ANNOTATION_DRAFTS_END);
    expect(merged).toContain("Lattice AI and users can append exact-quote PDF text markup drafts here.");
    expect(merged).toContain("Do not write PDF coordinates here");
    expect(parsePdfAnnotationMarkdownDrafts(section)).toHaveLength(0);
  });

  it("removes only resolved drafts and keeps unresolved drafts plus instructions", () => {
    const markdown = [
      "# annotations",
      "",
      PDF_ANNOTATION_DRAFTS_BEGIN,
      "<!--",
      '<!-- lattice-pdf-annotation id="ann-example" page="1" type="highlight" color="#FFD400" -->',
      "- Quote: example only",
      "-->",
      "",
      '<!-- lattice-pdf-annotation id="ann-done" page="7" type="highlight" color="#FFD400" -->',
      "- Quote: resolved quote",
      "- Tags: key-claim",
      "",
      '<!-- lattice-pdf-annotation id="ann-open" page="8" type="underline" color="#2196F3" -->',
      "- Quote: unresolved quote",
      "",
      PDF_ANNOTATION_DRAFTS_END,
      "",
    ].join("\n");

    const next = removeResolvedPdfAnnotationMarkdownDrafts(markdown, ["ann-done"]);

    expect(next).toContain('id="ann-example"');
    expect(next).not.toContain('id="ann-done"');
    expect(next).not.toContain("- Quote: resolved quote");
    expect(next).toContain('id="ann-open"');
    expect(next).toContain("- Quote: unresolved quote");
    expect(parsePdfAnnotationMarkdownDrafts(next).map((draft) => draft.id)).toEqual(["ann-open"]);
  });
});
