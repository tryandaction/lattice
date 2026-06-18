import { describe, expect, it } from "vitest";
import { getFileName, rankWikiLinkCompletion } from "../wiki-link-autocomplete";

describe("wiki link autocomplete ranking", () => {
  it("extracts extensionless markdown file names", () => {
    expect(getFileName("notes/Daily Note.md")).toBe("Daily Note");
    expect(getFileName("attachments/chart.png")).toBe("chart.png");
  });

  it("prioritizes exact and prefix matches", () => {
    const exact = rankWikiLinkCompletion("notes/Research.md", "Research");
    const fuzzy = rankWikiLinkCompletion("notes/Deep Research.md", "Research");

    expect(exact).toBeGreaterThan(fuzzy);
  });

  it("prioritizes files near the current note and recent files", () => {
    const context = {
      currentFilePath: "projects/alpha/Index.md",
      recentFiles: ["archive/Alpha Plan.md"],
    };

    const sameFolder = rankWikiLinkCompletion("projects/alpha/Alpha Plan.md", "Alpha", context);
    const otherFolder = rankWikiLinkCompletion("projects/beta/Alpha Plan.md", "Alpha", context);
    const recent = rankWikiLinkCompletion("archive/Alpha Plan.md", "Alpha", context);

    expect(sameFolder).toBeGreaterThan(otherFolder);
    expect(recent).toBeGreaterThan(otherFolder);
  });
});
