import { describe, expect, it } from "vitest";
import { extractFileIndexSummary } from "../ai/workspace-indexer";

describe("workspace-indexer markdown metadata", () => {
  it("extracts frontmatter, note links, tags and headings for markdown search/context", () => {
    const content = `---
title: Quantum Notes
tags: [physics, lattice]
---
# Hamiltonian

See [[Daily Note#Deep Heading|daily]] and [paper](papers/review.pdf#page=2).

#research`;

    const indexed = extractFileIndexSummary(content, ".md");

    expect(indexed.frontmatter).toEqual({ title: "Quantum Notes", tags: ["physics", "lattice"] });
    expect(indexed.headings).toEqual(["Hamiltonian"]);
    expect(indexed.links).toEqual(["Daily Note#Deep Heading", "papers/review.pdf#page=2"]);
    expect(indexed.tags).toEqual(["research"]);
    expect(indexed.summary).not.toContain("title: Quantum Notes");
  });
});
