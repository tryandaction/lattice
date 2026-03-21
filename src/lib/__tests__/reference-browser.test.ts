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
});
