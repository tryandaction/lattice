/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { waitFor } from "@testing-library/react";
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

  it("updates an existing React table root instead of remounting the widget DOM", async () => {
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

      const nextWidget = new TableWidget(
        [
          ["h1", "h2"],
          ["---", "---"],
          ["updated", "b1"],
        ],
        true,
        [null, null],
        0,
        34,
      );

      let reused = false;
      act(() => {
        reused = nextWidget.updateDOM(dom, view);
      });

      expect(reused).toBe(true);
      expect(dom.dataset.to).toBe("34");
      await waitFor(() => {
        expect(dom.textContent).toContain("updated");
      });

      act(() => {
        nextWidget.destroy(dom);
      });
    } finally {
      view.destroy();
      host.remove();
    }
  });
});
