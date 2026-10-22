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

  it("selects the image on normal click without selecting markdown source", () => {
    const doc = "![Chart](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB)";
    const view = createView(doc);
    try {
      const widget = new ImageWidget("Chart", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", undefined, 2, 7, 0, doc.length);
      const dom = widget.toDOM(view);

      dom.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));

      expect((dom as HTMLElement).dataset.selected).toBe("true");
      expect(view.state.selection.main.empty).toBe(true);
      expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("");
      expect(view.state.doc.toString()).toBe(doc);
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("dispatches markdown image edit requests from the inline control", () => {
    const doc = "![Chart|320](assets/chart.png)";
    const view = createView(doc);
    try {
      const widget = new ImageWidget("Chart", "assets/chart.png", 320, 2, 7, 0, doc.length);
      const dom = widget.toDOM(view);
      const handler = vi.fn();
      dom.addEventListener("lattice-markdown-image-edit", handler);

      (dom.querySelector('button[aria-label="Edit image"]') as HTMLButtonElement).click();

      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toMatchObject({
        url: "assets/chart.png",
        alt: "Chart",
        width: 320,
        syntax: "markdown",
        elementFrom: 0,
        elementTo: doc.length,
      });
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
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
