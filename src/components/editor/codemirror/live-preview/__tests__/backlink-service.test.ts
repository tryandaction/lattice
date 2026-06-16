import { describe, expect, it } from "vitest";
import { createBacklinkIndex, extractWikiLinks, type FileContentProvider } from "../backlink-service";

function createProvider(files: Record<string, string>): FileContentProvider {
  return {
    getFiles: () => Object.keys(files),
    getContent: (filePath: string) => files[filePath] ?? null,
  };
}

describe("live-preview backlink service", () => {
  it("extracts wiki links through the shared markdown parser", () => {
    expect(extractWikiLinks("See [[Daily Note#Deep Heading|daily]] and ![[image.png]]")).toEqual([
      expect.objectContaining({
        target: "Daily Note",
        heading: "Deep Heading",
        alias: "daily",
      }),
    ]);
  });

  it("uses the shared markdown link index for backlinks and outgoing wiki links", () => {
    const index = createBacklinkIndex();
    index.build(createProvider({
      "notes/index.md": [
        "# Index",
        "See [[Daily Note#Deep Heading|daily]] and [Guide](../refs/guide.md#API).",
      ].join("\n"),
      "notes/Daily Note.md": "# Deep Heading",
      "refs/guide.md": "# API",
    }));

    expect(index.getBacklinks("notes/Daily Note.md")).toEqual([
      {
        sourceFile: "notes/index.md",
        sourceLine: 2,
        context: "See [[Daily Note#Deep Heading|daily]] and [Guide](../refs/guide.md#API).",
        linkText: "daily",
      },
    ]);
    expect(index.getBacklinks("refs/guide.md")).toEqual([
      expect.objectContaining({
        sourceFile: "notes/index.md",
        sourceLine: 2,
        linkText: "Guide",
      }),
    ]);
    expect(index.getOutgoingLinks("notes/index.md")).toEqual([
      expect.objectContaining({
        target: "Daily Note",
        heading: "Deep Heading",
        alias: "daily",
      }),
    ]);
  });

  it("rebuilds consistently after updating and removing files", () => {
    const index = createBacklinkIndex();
    index.build(createProvider({
      "index.md": "[[Target]]",
      "Target.md": "# Target",
    }));

    expect(index.getBacklinks("Target.md")).toHaveLength(1);

    index.updateFile("index.md", "[Guide](guide.md)", ["index.md", "Target.md", "guide.md"]);

    expect(index.getBacklinks("Target.md")).toHaveLength(0);
    expect(index.getBacklinks("guide.md")).toEqual([
      expect.objectContaining({
        sourceFile: "index.md",
        linkText: "Guide",
      }),
    ]);

    index.removeFile("index.md");

    expect(index.getBacklinks("guide.md")).toHaveLength(0);
  });
});
