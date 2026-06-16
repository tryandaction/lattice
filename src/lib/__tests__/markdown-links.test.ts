import { describe, expect, it } from "vitest";
import { convertWikiLinksToMarkdown } from "../markdown-links";

describe("convertWikiLinksToMarkdown", () => {
  it("converts wiki links with aliases and headings into markdown links", () => {
    expect(convertWikiLinksToMarkdown("[[Notes/My Page#Deep Heading|Readable Label]]")).toBe(
      "[Readable Label](Notes/My%20Page#Deep%20Heading)",
    );
  });

  it("keeps extensionless note targets navigable after conversion", () => {
    expect(convertWikiLinksToMarkdown("See [[Daily Note]]")).toBe("See [Daily Note](Daily%20Note)");
  });

  it("converts embedded image wiki links into markdown images", () => {
    expect(convertWikiLinksToMarkdown("![[assets/chart 1.png|Chart]]")).toBe(
      "![Chart](assets/chart%201.png)",
    );
  });

  it("preserves Obsidian image size aliases for image rendering", () => {
    expect(convertWikiLinksToMarkdown("![[assets/chart.png|160]]")).toBe(
      "![|160](assets/chart.png)",
    );
    expect(convertWikiLinksToMarkdown("![[assets/chart.png|160x90]]")).toBe(
      "![|160x90](assets/chart.png)",
    );
  });

  it("falls back to a normal link for non-image embeds", () => {
    expect(convertWikiLinksToMarkdown("![[notes/demo.pdf#page=2|PDF page]]")).toBe(
      "[PDF page](notes/demo.pdf#page=2)",
    );
  });
});
