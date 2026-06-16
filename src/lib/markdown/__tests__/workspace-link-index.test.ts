import { afterEach, describe, expect, it } from "vitest";
import {
  clearWorkspaceMarkdownLinkIndex,
  clearWorkspaceMarkdownUnlinkedMentionIgnores,
  getWorkspaceMarkdownBacklinks,
  getWorkspaceMarkdownBrokenLinks,
  getWorkspaceMarkdownLinkIndex,
  getWorkspaceMarkdownOutgoingLinks,
  getWorkspaceMarkdownRenameLinkUpdates,
  getWorkspaceMarkdownUnlinkedMentions,
  ignoreWorkspaceMarkdownUnlinkedMention,
  removeWorkspaceMarkdownFile,
  renameWorkspaceMarkdownFile,
  scanWorkspaceMarkdownLinkIndex,
  subscribeWorkspaceMarkdownLinkIndex,
  upsertWorkspaceMarkdownFile,
} from "../workspace-link-index";

function createFileHandle(name: string, content: string): FileSystemFileHandle {
  return {
    kind: "file",
    name,
    getFile: async () => ({
      name,
      size: content.length,
      lastModified: 1,
      text: async () => content,
    }),
  } as unknown as FileSystemFileHandle;
}

function createDirectoryHandle(
  name: string,
  entries: Array<FileSystemDirectoryHandle | FileSystemFileHandle>,
): FileSystemDirectoryHandle {
  return {
    kind: "directory",
    name,
    async *values() {
      for (const entry of entries) {
        yield entry;
      }
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe("workspace markdown link index", () => {
  afterEach(() => {
    clearWorkspaceMarkdownLinkIndex();
  });

  it("scans markdown files recursively and exposes outgoing links, backlinks and broken links", async () => {
    const root = createDirectoryHandle("vault", [
      createFileHandle(
        "index.md",
        [
          "# Index",
          "See [[Daily Note#Deep Heading|daily]] and [Guide](refs/guide.md#API).",
          "[Missing](missing.md)",
        ].join("\n"),
      ),
      createDirectoryHandle("notes", [
        createFileHandle("Daily Note.md", "# Deep Heading"),
      ]),
      createDirectoryHandle("refs", [
        createFileHandle("guide.md", "# API"),
      ]),
      createDirectoryHandle("node_modules", [
        createFileHandle("ignored.md", "[[index]]"),
      ]),
      createFileHandle("image.png", "not markdown"),
    ]);

    const notifications: number[] = [];
    const unsubscribe = subscribeWorkspaceMarkdownLinkIndex(() => {
      notifications.push(getWorkspaceMarkdownLinkIndex().noteCount);
    });

    const snapshot = await scanWorkspaceMarkdownLinkIndex(root);
    unsubscribe();

    expect(snapshot.noteCount).toBe(3);
    expect(snapshot.isScanning).toBe(false);
    expect(notifications.length).toBeGreaterThanOrEqual(2);

    expect(getWorkspaceMarkdownOutgoingLinks("index.md").map((link) => ({
      rawTarget: link.rawTarget,
      resolvedPath: link.resolvedPath,
      broken: link.broken,
    }))).toEqual([
      {
        rawTarget: "Daily Note#Deep Heading",
        resolvedPath: "notes/Daily Note.md",
        broken: false,
      },
      {
        rawTarget: "refs/guide.md#API",
        resolvedPath: "refs/guide.md",
        broken: false,
      },
      {
        rawTarget: "missing.md",
        resolvedPath: undefined,
        broken: true,
      },
    ]);
    expect(getWorkspaceMarkdownBacklinks("notes/Daily Note.md")).toEqual([
      expect.objectContaining({
        sourceFile: "index.md",
        displayText: "daily",
        rawTarget: "Daily Note#Deep Heading",
      }),
    ]);
    expect(getWorkspaceMarkdownBrokenLinks().map((link) => link.rawTarget)).toEqual(["missing.md"]);
    expect(getWorkspaceMarkdownBacklinks("ignored.md")).toHaveLength(0);
  });

  it("updates the index incrementally when markdown files are saved, renamed and removed", () => {
    upsertWorkspaceMarkdownFile("index.md", "[[Target]]");
    upsertWorkspaceMarkdownFile("Target.md", "# Target");

    expect(getWorkspaceMarkdownLinkIndex().noteCount).toBe(2);
    expect(getWorkspaceMarkdownBacklinks("Target.md")).toEqual([
      expect.objectContaining({
        sourceFile: "index.md",
        rawTarget: "Target",
      }),
    ]);

    upsertWorkspaceMarkdownFile("index.md", "[Guide](docs/guide.md)");
    upsertWorkspaceMarkdownFile("docs/guide.md", "# Guide");

    expect(getWorkspaceMarkdownBacklinks("Target.md")).toHaveLength(0);
    expect(getWorkspaceMarkdownBacklinks("docs/guide.md")).toEqual([
      expect.objectContaining({
        sourceFile: "index.md",
        rawTarget: "docs/guide.md",
      }),
    ]);

    renameWorkspaceMarkdownFile("docs/guide.md", "docs/Guide Renamed.md");

    expect(getWorkspaceMarkdownLinkIndex().noteCount).toBe(3);
    expect(getWorkspaceMarkdownBacklinks("docs/Guide Renamed.md")).toEqual([
      expect.objectContaining({
        sourceFile: "index.md",
        rawTarget: "docs/Guide%20Renamed.md",
      }),
    ]);
    expect(getWorkspaceMarkdownOutgoingLinks("index.md")).toEqual([
      expect.objectContaining({
        rawTarget: "docs/Guide%20Renamed.md",
        resolvedPath: "docs/Guide Renamed.md",
      }),
    ]);

    removeWorkspaceMarkdownFile("index.md");

    expect(getWorkspaceMarkdownLinkIndex().noteCount).toBe(2);
    expect(getWorkspaceMarkdownBacklinks("docs/Guide Renamed.md")).toHaveLength(0);
  });

  it("plans disk link updates for renamed markdown targets", () => {
    upsertWorkspaceMarkdownFile("index.md", "See [Guide](docs/guide.md) and [[docs/guide#API|api]].");
    upsertWorkspaceMarkdownFile("other.md", "No guide link here.");
    upsertWorkspaceMarkdownFile("docs/guide.md", "# API");

    expect(getWorkspaceMarkdownRenameLinkUpdates("docs/guide.md", "docs/Guide Renamed.md")).toEqual([
      {
        sourceFile: "index.md",
        content: "See [Guide](docs/Guide%20Renamed.md) and [[docs/Guide Renamed.md#API|api]].",
      },
    ]);
  });

  it("can rename a markdown file in the index without rewriting references", () => {
    upsertWorkspaceMarkdownFile("index.md", "[Guide](docs/guide.md)");
    upsertWorkspaceMarkdownFile("docs/guide.md", "# Guide");

    renameWorkspaceMarkdownFile("docs/guide.md", "docs/Guide Renamed.md", { rewriteReferences: false });

    expect(getWorkspaceMarkdownOutgoingLinks("index.md")).toEqual([
      expect.objectContaining({
        rawTarget: "docs/guide.md",
        broken: true,
      }),
    ]);
    expect(getWorkspaceMarkdownBacklinks("docs/Guide Renamed.md")).toHaveLength(0);
  });

  it("finds unlinked mentions while excluding existing backlinks and inline links", () => {
    upsertWorkspaceMarkdownFile("notes/Quantum Field.md", "# Quantum Field");
    upsertWorkspaceMarkdownFile("daily.md", "Today I studied Quantum Field in detail.");
    upsertWorkspaceMarkdownFile("linked.md", "See [[Quantum Field]] for the actual note.");
    upsertWorkspaceMarkdownFile("markdown-linked.md", "See [Quantum Field](notes/Quantum%20Field.md).");

    expect(getWorkspaceMarkdownUnlinkedMentions("notes/Quantum Field.md")).toEqual([
      {
        targetFile: "notes/Quantum Field.md",
        sourceFile: "daily.md",
        sourceLine: 1,
        context: "Today I studied Quantum Field in detail.",
        mention: "Quantum Field",
      },
    ]);
  });

  it("can ignore individual unlinked mentions", () => {
    upsertWorkspaceMarkdownFile("notes/Quantum Field.md", "# Quantum Field");
    upsertWorkspaceMarkdownFile("daily.md", "Quantum Field came up.");

    const mentions = getWorkspaceMarkdownUnlinkedMentions("notes/Quantum Field.md");
    expect(mentions).toHaveLength(1);

    ignoreWorkspaceMarkdownUnlinkedMention(mentions[0]);
    expect(getWorkspaceMarkdownUnlinkedMentions("notes/Quantum Field.md")).toHaveLength(0);

    clearWorkspaceMarkdownUnlinkedMentionIgnores();
    expect(getWorkspaceMarkdownUnlinkedMentions("notes/Quantum Field.md")).toHaveLength(1);
  });
});
