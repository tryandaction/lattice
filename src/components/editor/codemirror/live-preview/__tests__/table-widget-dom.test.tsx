/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { TableWidget } from "../widgets";

describe("TableWidget DOM", () => {
  it("exposes both wrapper and widget classes for styling and diagnostics", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const view = new EditorView({
      state: EditorState.create({ doc: "| a | b |" }),
      parent: host,
    });

    try {
      const widget = new TableWidget(
        [
          ["h1", "h2"],
          ["---", "---"],
          ["a1", "b1"],
        ],
        true,
        [null, null],
        0,
        29,
      );

      let dom!: HTMLElement;
      act(() => {
        dom = widget.toDOM(view);
      });

      expect(dom.classList.contains("cm-table-widget-wrapper")).toBe(true);
      expect(dom.classList.contains("cm-table-widget")).toBe(true);

      act(() => {
        widget.destroy(dom);
      });
    } finally {
      view.destroy();
      host.remove();
    }
  });
});
