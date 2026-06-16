import { describe, expect, it } from "vitest";
import { extractMarkdownDocument } from "../extract";

describe("extractMarkdownDocument", () => {
  it("extracts frontmatter, headings, links, embeds, tags, tasks, callouts and code blocks", () => {
    const document = extractMarkdownDocument(`---
title: Quantum Notes
tags:
  - physics
  - lattice
---
# Hamiltonian

See [[Daily Note#Deep Heading|daily]] and [paper](papers/review.pdf#page=2).
![[assets/chart 1.png|Chart]]

> [!warning]- Be careful
> Details

- [x] Checked task
- [ ] Open task #research/topic

\`\`\`python
print("hello")
\`\`\`
`);

    expect(document.frontmatter).toEqual({
      title: "Quantum Notes",
      tags: ["physics", "lattice"],
    });
    expect(document.body).not.toContain("title: Quantum Notes");
    expect(document.headings.map((heading) => [heading.level, heading.text])).toEqual([
      [1, "Hamiltonian"],
    ]);
    expect(document.links.map((link) => ({
      kind: link.kind,
      target: link.target,
      label: link.label,
      embedded: link.embedded,
    }))).toEqual([
      { kind: "wiki", target: "Daily Note#Deep Heading", label: "daily", embedded: false },
      { kind: "markdown", target: "papers/review.pdf#page=2", label: "paper", embedded: false },
      { kind: "wiki", target: "assets/chart 1.png", label: "Chart", embedded: true },
    ]);
    expect(document.embeds.map((embed) => embed.target)).toEqual(["assets/chart 1.png"]);
    expect(document.callouts).toEqual([
      expect.objectContaining({ type: "warning", fold: "-", title: "Be careful" }),
    ]);
    expect(document.tasks.map((task) => ({ checked: task.checked, text: task.text }))).toEqual([
      { checked: true, text: "Checked task" },
      { checked: false, text: "Open task #research/topic" },
    ]);
    expect(document.tags.map((tag) => tag.tag)).toEqual(["research/topic"]);
    expect(document.codeBlocks).toEqual([
      expect.objectContaining({ language: "python", code: 'print("hello")' }),
    ]);
  });

  it("ignores markdown syntax inside fenced code blocks", () => {
    const document = extractMarkdownDocument(`\`\`\`md
# Not a heading
[[Not a link]]
#notatag
\`\`\`

# Real Heading
`);

    expect(document.headings.map((heading) => heading.text)).toEqual(["Real Heading"]);
    expect(document.links).toHaveLength(0);
    expect(document.tags).toHaveLength(0);
  });
});
