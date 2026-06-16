import { describe, expect, it } from "vitest";
import {
  hideObsidianBlockIds,
  hideObsidianComments,
  normalizeObsidianHighlights,
  prepareMarkdownForReading,
} from "../markdown-reading";

describe("markdown reading normalization", () => {
  it("converts Obsidian highlights outside inline code and fenced code", () => {
    expect(normalizeObsidianHighlights("==mark== and `==code==`")).toBe("<mark>mark</mark> and `==code==`");
    expect(
      normalizeObsidianHighlights(["```md", "==not mark==", "```", "==mark=="].join("\n")),
    ).toBe(["```md", "==not mark==", "```", "<mark>mark</mark>"].join("\n"));
  });

  it("hides Obsidian comments outside inline code and fenced code", () => {
    expect(hideObsidianComments("Visible %%hidden%% text and `%%code%%`")).toBe("Visible  text and `%%code%%`");
    expect(
      hideObsidianComments([
        "Before %%hidden",
        "still hidden%% after",
        "```md",
        "%%not hidden in code%%",
        "```",
      ].join("\n")),
    ).toBe(["Before", "after", "```md", "%%not hidden in code%%", "```"].join("\n"));
  });

  it("hides Obsidian block ids at line endings without touching inline code", () => {
    expect(hideObsidianBlockIds("Paragraph text ^block-id")).toBe("Paragraph text");
    expect(hideObsidianBlockIds("Keep `^code-id` but hide ^block-id")).toBe("Keep `^code-id` but hide");
    expect(
      hideObsidianBlockIds(["```md", "code ^block-id", "```", "Visible ^real-id"].join("\n")),
    ).toBe(["```md", "code ^block-id", "```", "Visible"].join("\n"));
  });

  it("prepares mixed Obsidian reading syntax without exposing frontmatter", () => {
    expect(
      prepareMarkdownForReading([
        "---",
        "title: Demo",
        "---",
        "Important ==mark==",
        "---",
        "%%reading comment%%",
        "Block target ^abc-123",
        "Plain [[Wiki Link]] stays available for link conversion",
      ].join("\n")),
    ).toBe([
      "Important <mark>mark</mark>",
      "<hr />",
      "",
      "Block target",
      "Plain [[Wiki Link]] stays available for link conversion",
    ].join("\n"));
  });
});
