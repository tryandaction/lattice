import { describe, expect, it } from "vitest";
import {
  buildReferenceBrowserNodesFromEvidence,
  buildReferenceBrowserNodesFromMentionSuggestions,
  collectReferenceBrowserLeaves,
} from "@/lib/ai/reference-browser";

describe("reference browser helpers", () => {
  it("builds nodes from mention suggestions", () => {
    const nodes = buildReferenceBrowserNodesFromMentionSuggestions([
      {
        type: "file",
        label: "paper.md",
        value: "@notes/paper.md",
        description: "notes/paper.md",
      },
    ]);

    expect(nodes).toEqual([
      expect.objectContaining({
        kind: "file",
        label: "paper.md",
        value: "@notes/paper.md",
      }),
    ]);
  });

  it("groups evidence references by locator path", () => {
    const nodes = buildReferenceBrowserNodesFromEvidence([
      {
        kind: "heading",
        label: "Method",
        locator: "notes/paper.md#Method",
      },
      {
        kind: "code_line",
        label: "Line 10",
        locator: "notes/paper.md#line=10",
      },
    ]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.kind).toBe("group");
    expect(nodes[0]?.children).toHaveLength(2);
    expect(collectReferenceBrowserLeaves(nodes)).toHaveLength(2);
  });

  it("deduplicates repeated evidence locations even when display labels differ", () => {
    const nodes = buildReferenceBrowserNodesFromEvidence([
      {
        kind: "pdf_page",
        label: "paper.pdf",
        locator: "papers/paper.pdf#page=3",
      },
      {
        kind: "pdf_page",
        label: "Current PDF evidence",
        locator: "papers/paper.pdf#page=3",
      },
    ]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.children).toHaveLength(1);
  });

  it("keeps twelve PDF passages under one stable source group", () => {
    const nodes = buildReferenceBrowserNodesFromEvidence(
      Array.from({ length: 12 }, (_, index) => ({
        kind: "pdf_page" as const,
        label: "papers/quantum.pdf",
        locator: `papers/quantum.pdf#page=${index + 1}`,
        preview: `Passage ${index + 1}`,
        anchor: { page: index + 1, snippet: `Passage ${index + 1}` },
      })),
    );

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: expect.stringMatching(/^source-/),
      label: "quantum.pdf",
      description: "papers/quantum.pdf",
    });
    expect(nodes[0]?.children).toHaveLength(12);
    expect(nodes[0]?.children?.[0]?.id).toMatch(/^citation-/);
  });
});
