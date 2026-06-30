import { describe, expect, it } from "vitest";
import {
  buildMarkdownLinkIndex,
  getMarkdownBacklinks,
  getMarkdownOutgoingLinks,
} from "../link-index";

describe("buildMarkdownLinkIndex", () => {
  it("indexes outgoing links, backlinks, embeds and broken links across markdown notes", () => {
    const index = buildMarkdownLinkIndex([
      {
        path: "notes/index.md",
        content: [
          "# Index",
          "See [[Daily Note#Deep Heading|daily]] and [Guide](../refs/guide.md#API).",
          "![[assets/chart.png|Chart]]",
          "[Missing](missing.md)",
          "[Annotation](papers/math.pdf#ann-123)",
        ].join("\n"),
      },
      {
        path: "notes/Daily Note.md",
        content: "# Deep Heading",
      },
      {
        path: "refs/guide.md",
        content: "# API",
      },
      {
        path: "notes/assets/chart.png",
        content: "",
      },
      {
        path: "notes/papers/math.pdf",
        content: "",
      },
    ]);

    const outgoing = getMarkdownOutgoingLinks(index, "notes/index.md");
    expect(outgoing.map((link) => ({
      rawTarget: link.rawTarget,
      displayText: link.displayText,
      embedded: link.embedded,
      resolvedPath: link.resolvedPath,
      broken: link.broken,
      type: link.parsedTarget?.type,
    }))).toEqual([
      {
        rawTarget: "Daily Note#Deep Heading",
        displayText: "daily",
        embedded: false,
        resolvedPath: "notes/Daily Note.md",
        broken: false,
        type: "workspace_heading",
      },
      {
        rawTarget: "../refs/guide.md#API",
        displayText: "Guide",
        embedded: false,
        resolvedPath: "refs/guide.md",
        broken: false,
        type: "workspace_heading",
      },
      {
        rawTarget: "assets/chart.png",
        displayText: "Chart",
        embedded: true,
        resolvedPath: "notes/assets/chart.png",
        broken: false,
        type: "workspace_file",
      },
      {
        rawTarget: "missing.md",
        displayText: "Missing",
        embedded: false,
        resolvedPath: undefined,
        broken: true,
        type: "workspace_file",
      },
      {
        rawTarget: "papers/math.pdf#ann-123",
        displayText: "Annotation",
        embedded: false,
        resolvedPath: "notes/papers/math.pdf",
        broken: false,
        type: "pdf_annotation",
      },
    ]);

    expect(getMarkdownBacklinks(index, "notes/Daily Note.md")).toEqual([
      expect.objectContaining({
        sourceFile: "notes/index.md",
        sourceLine: 2,
        displayText: "daily",
        rawTarget: "Daily Note#Deep Heading",
      }),
    ]);
    expect(getMarkdownBacklinks(index, "refs/guide.md")).toEqual([
      expect.objectContaining({
        sourceFile: "notes/index.md",
        sourceLine: 2,
        displayText: "Guide",
      }),
    ]);
    expect(index.brokenLinks.map((link) => link.rawTarget)).toEqual(["missing.md"]);
  });

  it("matches extensionless note links by filename", () => {
    const index = buildMarkdownLinkIndex([
      { path: "folder/source.md", content: "[[Target]]" },
      { path: "other/Target.md", content: "# Target" },
    ]);

    expect(getMarkdownOutgoingLinks(index, "folder/source.md")[0]).toEqual(
      expect.objectContaining({
        resolvedPath: "other/Target.md",
        broken: false,
      }),
    );
    expect(getMarkdownBacklinks(index, "other/Target.md")).toHaveLength(1);
  });

  it("records link health resolution strategies and repair candidates", () => {
    const index = buildMarkdownLinkIndex([
      {
        path: "notes/source.md",
        content: [
          "[Exact](../refs/exact.md)",
          "[Extensionless](../refs/guide)",
          "[Basename](Target)",
          "[Relative extensionless](Old Target)",
          "[Missing exact](../refs/missing.md)",
          "[Old Target](missing.md)",
          "[Web](https://example.com)",
        ].join("\n"),
      },
      { path: "refs/exact.md", content: "# Exact" },
      { path: "refs/guide.md", content: "# Guide" },
      { path: "archive/Target.md", content: "# Target" },
      { path: "notes/Old Target.md", content: "# Renamed" },
    ]);

    const byLabel = new Map(
      getMarkdownOutgoingLinks(index, "notes/source.md").map((link) => [link.displayText, link]),
    );

    expect(byLabel.get("Exact")?.resolution).toMatchObject({
      kind: "exact",
      resolvedPath: "refs/exact.md",
      repairCandidates: [],
    });
    expect(byLabel.get("Extensionless")?.resolution).toMatchObject({
      kind: "extensionless",
      resolvedPath: "refs/guide.md",
      repairCandidates: ["refs/guide.md"],
    });
    expect(byLabel.get("Basename")?.resolution).toMatchObject({
      kind: "basename",
      resolvedPath: "archive/Target.md",
      repairCandidates: ["archive/Target.md"],
    });
    expect(byLabel.get("Relative extensionless")?.resolution).toMatchObject({
      kind: "extensionless",
      resolvedPath: "notes/Old Target.md",
      repairCandidates: ["notes/Old Target.md"],
    });
    expect(byLabel.get("Missing exact")?.resolution).toMatchObject({
      kind: "unresolved",
      repairCandidates: [],
    });
    expect(byLabel.get("Old Target")?.resolution).toMatchObject({
      kind: "unresolved",
      repairCandidates: ["notes/Old Target.md"],
    });
    expect(byLabel.get("Web")?.resolution).toMatchObject({
      kind: "external",
      repairCandidates: [],
    });
  });
});
