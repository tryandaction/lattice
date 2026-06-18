/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CalloutWidget } from "../widgets";

describe("CalloutWidget DOM", () => {
  it("extracts the rendered callout body back to a plain quote", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const view = new EditorView({
      state: EditorState.create({ doc: "> [!note] Original\n> Body\n> More\n\nAfter" }),
      parent: host,
    });

    try {
      const widget = new CalloutWidget(
        "note",
        "Original",
        ["Body", "More"],
        0,
        31,
        false,
        "",
      );

      const dom = widget.toDOM(view);
      const extract = dom.querySelector<HTMLButtonElement>(".cm-callout-extract");

      expect(extract).toBeTruthy();
      extract?.click();

      expect(view.state.doc.toString()).toBe("> Body\n> More\n\nAfter");
    } finally {
      view.destroy();
      host.remove();
    }
  });
});
