/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ImageWidget } from "../widgets";

function createView(doc: string): EditorView {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EditorView({
    state: EditorState.create({ doc }),
    parent: host,
  });
}

describe("ImageWidget DOM controls", () => {
  it("writes resized image markdown back through widget controls", () => {
    const doc = "![Chart](assets/chart.png)";
    const view = createView(doc);
    try {
      const widget = new ImageWidget("Chart", "assets/chart.png", undefined, 2, 7, 0, doc.length);
      const dom = widget.toDOM(view);

      const widen = dom.querySelector('button[aria-label="Widen image"]') as HTMLButtonElement;
      widen.click();

      expect(view.state.doc.toString()).toBe("![Chart|360](assets/chart.png)");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("copies path and selects source without changing image markdown", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });

    const doc = "![Chart|320](assets/chart.png)";
    const view = createView(doc);
    try {
      const widget = new ImageWidget("Chart", "assets/chart.png", 320, 2, 7, 0, doc.length);
      const dom = widget.toDOM(view);

      (dom.querySelector('button[aria-label="Copy image path"]') as HTMLButtonElement).click();
      expect(writeText).toHaveBeenCalledWith("assets/chart.png");

      (dom.querySelector('button[aria-label="Select image source"]') as HTMLButtonElement).click();
      expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(doc);
      expect(view.state.doc.toString()).toBe(doc);
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
      vi.unstubAllGlobals();
    }
  });

  it("writes Obsidian wiki image width syntax from widget controls", () => {
    const doc = "![[assets/chart.png|300]]";
    const view = createView(doc);
    try {
      const widget = new ImageWidget("Chart", "assets/chart.png", 300, 3, 23, 0, doc.length, "wiki");
      const dom = widget.toDOM(view);

      const narrow = dom.querySelector('button[aria-label="Narrow image"]') as HTMLButtonElement;
      narrow.click();

      expect(view.state.doc.toString()).toBe("![[assets/chart.png|260]]");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });
});
