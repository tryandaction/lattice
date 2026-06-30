import { describe, expect, it } from "vitest";
import {
  buildMarkdownLinkToWikiReplacement,
  buildWikiTarget,
  convertMarkdownLinkToWikiInContent,
  linkMentionInLine,
  linkUnlinkedMentionInContent,
  linkUnlinkedMentionsInContent,
  repairMarkdownLinkTargetInContent,
} from "../link-maintenance";
import type { IndexedMarkdownLink } from "../link-index";
import type { MarkdownUnlinkedMention } from "../workspace-link-index";

function mention(input: Partial<MarkdownUnlinkedMention> = {}): MarkdownUnlinkedMention {
  return {
    targetFile: "notes/Target Note.md",
    sourceFile: "daily.md",
    sourceLine: 1,
    context: "Target Note appeared today.",
    mention: "Target Note",
    ...input,
  };
}

function indexedLink(content: string, rawTarget: string, input: Partial<IndexedMarkdownLink> = {}): IndexedMarkdownLink {
  const start = content.indexOf(rawTarget);
  return {
    sourceFile: "daily/source.md",
    rawTarget,
    displayText: undefined,
    embedded: false,
    range: {
      start: { line: 0, col: start, offset: start },
      end: { line: 0, col: start + rawTarget.length, offset: start + rawTarget.length },
    },
    parsedTarget: null,
    resolution: {
      kind: "unresolved",
      repairCandidates: [],
    },
    broken: true,
    ...input,
  };
}

function indexedFullLink(
  content: string,
  linkSource: string,
  rawTarget: string,
  input: Partial<IndexedMarkdownLink> = {},
): IndexedMarkdownLink {
  const start = content.indexOf(linkSource);
  return {
    sourceFile: "daily/source.md",
    rawTarget,
    displayText: undefined,
    embedded: linkSource.startsWith("!"),
    range: {
      start: { line: 0, col: start, offset: start },
      end: { line: 0, col: start + linkSource.length, offset: start + linkSource.length },
    },
    parsedTarget: null,
    resolution: {
      kind: "exact",
      resolvedPath: rawTarget,
      repairCandidates: [],
    },
    broken: false,
    ...input,
  };
}

describe("markdown link maintenance", () => {
  it("builds workspace-relative wiki targets", () => {
    expect(buildWikiTarget("daily.md", "Target.md")).toBe("Target.md");
    expect(buildWikiTarget("notes/source.md", "notes/Target.md")).toBe("Target.md");
    expect(buildWikiTarget("daily/source.md", "notes/Target.md")).toBe("../notes/Target.md");
    expect(buildWikiTarget("daily/deep/source.md", "notes/Target.md")).toBe("../../notes/Target.md");
  });

  it("links a mention in a single line with an alias preserving original text", () => {
    expect(linkMentionInLine("Read Target Note today.", mention())).toBe(
      "Read [[notes/Target Note|Target Note]] today.",
    );
  });

  it("links a mention in content at the requested line", () => {
    const result = linkUnlinkedMentionInContent(
      ["Intro", "Target Note appeared today.", "Outro"].join("\n"),
      mention({ sourceLine: 2 }),
    );

    expect(result).toEqual({
      changed: true,
      content: ["Intro", "[[notes/Target Note|Target Note]] appeared today.", "Outro"].join("\n"),
    });
  });

  it("links multiple mentions in one content update", () => {
    const result = linkUnlinkedMentionsInContent(
      ["Target Note first.", "Middle", "Another Target Note mention."].join("\n"),
      [
        mention({ sourceLine: 1, context: "Target Note first." }),
        mention({ sourceLine: 3, context: "Another Target Note mention." }),
      ],
    );

    expect(result).toEqual({
      changed: true,
      linkedCount: 2,
      content: [
        "[[notes/Target Note|Target Note]] first.",
        "Middle",
        "Another [[notes/Target Note|Target Note]] mention.",
      ].join("\n"),
    });
  });

  it("returns unchanged content when line or mention no longer matches", () => {
    expect(linkUnlinkedMentionInContent("Only one line", mention({ sourceLine: 2 }))).toEqual({
      changed: false,
      content: "Only one line",
    });
    expect(linkUnlinkedMentionInContent("No target here", mention())).toEqual({
      changed: false,
      content: "No target here",
    });
  });

  it("repairs a broken wiki link target using extensionless wiki syntax", () => {
    const content = "See [[Missing|old note]].";
    expect(
      repairMarkdownLinkTargetInContent(content, indexedLink(content, "Missing"), "notes/Target Note.md"),
    ).toEqual({
      changed: true,
      content: "See [[../notes/Target Note|old note]].",
    });
  });

  it("repairs a broken markdown link target using encoded markdown syntax", () => {
    const content = "See [old note](missing.md).";
    expect(
      repairMarkdownLinkTargetInContent(content, indexedLink(content, "missing.md"), "notes/Target Note.md"),
    ).toEqual({
      changed: true,
      content: "See [old note](../notes/Target%20Note.md).",
    });
  });

  it("does not repair when the indexed range no longer matches the content", () => {
    const content = "See [old note](missing.md).";
    const staleLink = indexedLink(content, "missing.md", {
      range: {
        start: { line: 0, col: 0, offset: 0 },
        end: { line: 0, col: 3, offset: 3 },
      },
    });

    expect(repairMarkdownLinkTargetInContent(content, staleLink, "Target.md")).toEqual({
      changed: false,
      content,
    });
  });

  it("builds wiki replacements from markdown links and embeds", () => {
    expect(buildMarkdownLinkToWikiReplacement("[Guide](docs/Guide%20Note.md#API)")).toMatchObject({
      replacement: "[[docs/Guide Note#API|Guide]]",
      target: "docs/Guide Note#API",
      alias: "Guide",
      embedded: false,
    });

    expect(buildMarkdownLinkToWikiReplacement("![Chart](assets/chart.png)")).toMatchObject({
      replacement: "![[assets/chart.png|Chart]]",
      target: "assets/chart.png",
      alias: "Chart",
      embedded: true,
    });
  });

  it("converts a markdown link range to wiki syntax without touching wiki links", () => {
    const content = "See [old note](missing.md#Heading) and [[Existing]].";
    expect(
      convertMarkdownLinkToWikiInContent(
        content,
        indexedFullLink(content, "[old note](missing.md#Heading)", "missing.md#Heading"),
      ),
    ).toEqual({
      changed: true,
      content: "See [[missing#Heading|old note]] and [[Existing]].",
    });

    const wikiContent = "See [[Missing|old note]].";
    expect(convertMarkdownLinkToWikiInContent(wikiContent, indexedLink(wikiContent, "Missing"))).toEqual({
      changed: false,
      content: wikiContent,
    });
  });
});
