/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  buildMarkdownImageSource,
  getCurrentMarkdownBlock,
  getMarkdownEditorContext,
  getPropertiesYaml,
  markdownBlockToHtml,
  runMarkdownEditingCommand,
} from "../markdown-editing-commands";

function createView(doc: string): EditorView {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EditorView({
    state: EditorState.create({ doc }),
    parent: host,
  });
}

describe("markdown editing commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects table context and copies the current markdown block", () => {
    const view = createView("Intro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nEnd");
    try {
      const tablePos = view.state.doc.toString().indexOf("| 1 |");
      view.dispatch({ selection: { anchor: tablePos } });

      const context = getMarkdownEditorContext(view);

      expect(context.kind).toBe("table");
      expect(getCurrentMarkdownBlock(view)).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("inserts a clean markdown table template", () => {
    const view = createView("");
    try {
      runMarkdownEditingCommand(view, "insert.table", { rows: 2, columns: 2 });

      expect(view.state.doc.toString()).toBe("| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("inserts emoji and GIF markdown at the cursor", () => {
    const view = createView("Hello ");
    try {
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      runMarkdownEditingCommand(view, "insert.emoji", { text: "ok" });
      runMarkdownEditingCommand(view, "insert.gif", { alt: "demo", url: "https://example.com/demo.gif" });

      expect(view.state.doc.toString()).toBe("Hello ok![demo](https://example.com/demo.gif)");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("renders a markdown table block as simple HTML for clipboard export", () => {
    const html = markdownBlockToHtml("| A | B |\n| --- | --- |\n| 1 | 2 |");

    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>2</td>");
  });

  it("inserts and updates YAML properties frontmatter", () => {
    const view = createView("# Note\n");
    try {
      runMarkdownEditingCommand(view, "insert.properties", { propertyKey: "status", propertyValue: "draft" });
      expect(view.state.doc.toString()).toBe("---\nstatus: \"draft\"\n---\n\n# Note\n");

      runMarkdownEditingCommand(view, "properties.set", { propertyKey: "priority", propertyValue: "1" });
      expect(view.state.doc.toString()).toBe("---\nstatus: \"draft\"\npriority: 1\n---\n\n# Note\n");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("converts the current line into a YAML property", () => {
    const view = createView("status draft\n# Note\n");
    try {
      view.dispatch({ selection: { anchor: 0 } });
      runMarkdownEditingCommand(view, "properties.convertLine");

      expect(view.state.doc.toString()).toBe("---\nstatus: \"draft\"\n---\n\n# Note\n");
      expect(getPropertiesYaml(view)).toBe("---\nstatus: \"draft\"\n---");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("converts selected text into an existing YAML property", () => {
    const view = createView("---\nstatus: draft\n---\n\npriority: 2\nBody\n");
    try {
      const from = view.state.doc.toString().indexOf("priority");
      const to = from + "priority: 2".length;
      view.dispatch({ selection: { anchor: from, head: to } });
      runMarkdownEditingCommand(view, "properties.convertLine");

      expect(view.state.doc.toString()).toBe("---\nstatus: draft\npriority: 2\n---\n\n\nBody\n");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("detects and updates callout type and title", () => {
    const view = createView("> [!note] Original\n> Body\n\nEnd");
    try {
      view.dispatch({ selection: { anchor: 5 } });
      expect(getMarkdownEditorContext(view)).toMatchObject({
        kind: "callout",
        calloutType: "note",
        calloutTitle: "Original",
      });

      runMarkdownEditingCommand(view, "callout.update", { calloutType: "warning", calloutTitle: "Check this" });
      expect(view.state.doc.toString()).toBe("> [!warning] Check this\n> Body\n\nEnd");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("preserves callout fold markers when updating type and title", () => {
    const view = createView("> [!note-] Original\n> Body\n\nEnd");
    try {
      view.dispatch({ selection: { anchor: 5 } });

      runMarkdownEditingCommand(view, "callout.update", { calloutType: "warning", calloutTitle: "Check this" });

      expect(view.state.doc.toString()).toBe("> [!warning-] Check this\n> Body\n\nEnd");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("copies callout body without the callout header or quote markers", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });
    const view = createView("> [!note] Original\n> Body\n> More\n\nEnd");
    try {
      view.dispatch({ selection: { anchor: 5 } });

      expect(runMarkdownEditingCommand(view, "callout.copyBody")).toBe(true);
      expect(writeText).toHaveBeenCalledWith("Body\nMore");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("duplicates the current callout block below itself", () => {
    const view = createView("> [!note] Original\n> Body\n\nEnd");
    try {
      view.dispatch({ selection: { anchor: 5 } });

      expect(runMarkdownEditingCommand(view, "callout.duplicate")).toBe(true);
      expect(view.state.doc.toString()).toBe("> [!note] Original\n> Body\n\n> [!note] Original\n> Body\n\nEnd");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("converts the current selection into a callout body", () => {
    const view = createView("Alpha\nBeta");
    try {
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });

      expect(runMarkdownEditingCommand(view, "callout.selectionToBody", {
        calloutType: "tip",
        calloutTitle: "Heads up",
      })).toBe(true);
      expect(view.state.doc.toString()).toBe("> [!tip] Heads up\n> Alpha\n> Beta");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("extracts a callout body as a plain quote", () => {
    const view = createView("> [!note] Original\n> Body\n>\n> More\n\nEnd");
    try {
      view.dispatch({ selection: { anchor: 5 } });

      expect(runMarkdownEditingCommand(view, "callout.extractBody")).toBe(true);
      expect(view.state.doc.toString()).toBe("> Body\n>\n> More\n\nEnd");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("splits a callout at the current body line", () => {
    const view = createView("> [!warning-] Original\n> First\n> Second\n> Third\n\nEnd");
    try {
      const secondLine = view.state.doc.toString().indexOf("Second");
      view.dispatch({ selection: { anchor: secondLine } });

      expect(runMarkdownEditingCommand(view, "callout.splitAtBodyLine")).toBe(true);
      expect(view.state.doc.toString()).toBe(
        "> [!warning-] Original\n> First\n\n> [!warning-] Original\n> Second\n> Third\n\nEnd",
      );
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("inserts headings, wiki links, and embeds through shared commands", () => {
    const view = createView("Title\n\n");
    try {
      view.dispatch({ selection: { anchor: 0, head: 5 } });
      runMarkdownEditingCommand(view, "insert.heading", { headingLevel: 2 });
      expect(view.state.doc.toString()).toBe("## Title\n\n");

      view.dispatch({ selection: { anchor: view.state.doc.length } });
      runMarkdownEditingCommand(view, "insert.wikiLink", { target: "Daily Note", alias: "daily" });
      runMarkdownEditingCommand(view, "insert.embed", { target: "assets/chart.png" });
      expect(view.state.doc.toString()).toBe("## Title\n\n[[Daily Note|daily]]![[assets/chart.png]]");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("inserts wiki aliases plus heading and block anchors", () => {
    const view = createView("Deep note");
    try {
      view.dispatch({ selection: { anchor: 0, head: 9 } });
      runMarkdownEditingCommand(view, "insert.wikiAlias", { target: "Daily Note" });
      expect(view.state.doc.toString()).toBe("[[Daily Note|Deep note]]");

      view.dispatch({ selection: { anchor: view.state.doc.length } });
      runMarkdownEditingCommand(view, "insert.text", { text: "\n" });
      runMarkdownEditingCommand(view, "insert.headingAnchorLink", {
        target: "Daily Note",
        heading: "Research Log",
        alias: "log",
      });
      runMarkdownEditingCommand(view, "insert.text", { text: "\n" });
      runMarkdownEditingCommand(view, "insert.blockAnchorLink", {
        target: "Daily Note",
        blockId: "^abc123",
      });

      expect(view.state.doc.toString()).toBe(
        "[[Daily Note|Deep note]]\n[[Daily Note#Research Log|log]]\n[[Daily Note#^abc123]]",
      );
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("converts markdown links and image embeds to wiki syntax at the cursor", () => {
    const view = createView("See [Guide](docs/guide.md#API) and ![Chart](assets/chart.png).");
    try {
      const guidePos = view.state.doc.toString().indexOf("Guide");
      view.dispatch({ selection: { anchor: guidePos } });
      expect(runMarkdownEditingCommand(view, "link.convertMarkdownToWiki")).toBe(true);
      expect(view.state.doc.toString()).toBe("See [[docs/guide#API|Guide]] and ![Chart](assets/chart.png).");

      const chartPos = view.state.doc.toString().indexOf("Chart");
      view.dispatch({ selection: { anchor: chartPos } });
      expect(runMarkdownEditingCommand(view, "link.convertMarkdownToWiki")).toBe(true);
      expect(view.state.doc.toString()).toBe("See [[docs/guide#API|Guide]] and ![[assets/chart.png|Chart]].");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("rewrites standard markdown image width, path, alt, and source selection", () => {
    const view = createView("![Chart](assets/chart.png)");
    try {
      const chartPos = view.state.doc.toString().indexOf("Chart");
      view.dispatch({ selection: { anchor: chartPos } });
      expect(getMarkdownEditorContext(view)).toMatchObject({
        kind: "image",
        imageUrl: "assets/chart.png",
        imageAlt: "Chart",
        imageSyntax: "markdown",
      });

      expect(runMarkdownEditingCommand(view, "image.setWidth", { width: 320 })).toBe(true);
      expect(view.state.doc.toString()).toBe("![Chart|320](assets/chart.png)");

      view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("chart.png") } });
      expect(runMarkdownEditingCommand(view, "image.replacePath", { url: "assets/plot.png" })).toBe(true);
      expect(view.state.doc.toString()).toBe("![Chart|320](assets/plot.png)");

      view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("Chart") } });
      expect(runMarkdownEditingCommand(view, "image.setAlt", { alt: "Plot" })).toBe(true);
      expect(view.state.doc.toString()).toBe("![Plot|320](assets/plot.png)");

      expect(runMarkdownEditingCommand(view, "image.openSource")).toBe(true);
      expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
        "![Plot|320](assets/plot.png)",
      );
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("rewrites Obsidian wiki image width and path", () => {
    const view = createView("![[assets/chart.png|300]]");
    try {
      view.dispatch({ selection: { anchor: 4 } });
      expect(getMarkdownEditorContext(view)).toMatchObject({
        kind: "image",
        imageUrl: "assets/chart.png",
        imageWidth: 300,
        imageSyntax: "wiki",
      });

      expect(runMarkdownEditingCommand(view, "image.clearWidth")).toBe(true);
      expect(view.state.doc.toString()).toBe("![[assets/chart.png]]");

      view.dispatch({ selection: { anchor: 4 } });
      expect(runMarkdownEditingCommand(view, "image.setWidth", { width: 180 })).toBe(true);
      expect(view.state.doc.toString()).toBe("![[assets/chart.png|180]]");

      view.dispatch({ selection: { anchor: 4 } });
      expect(runMarkdownEditingCommand(view, "image.replacePath", { target: "assets/new-chart.png" })).toBe(true);
      expect(view.state.doc.toString()).toBe("![[assets/new-chart.png|180]]");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("serializes image sources for standard and wiki syntax", () => {
    expect(buildMarkdownImageSource({
      syntax: "markdown",
      alt: "Chart",
      url: "assets/chart.png",
      width: 240,
    })).toBe("![Chart|240](assets/chart.png)");
    expect(buildMarkdownImageSource({
      syntax: "wiki",
      alt: "Chart",
      url: "assets/chart.png",
    })).toBe("![[assets/chart.png|Chart]]");
  });
});
