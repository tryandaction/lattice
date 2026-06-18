/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { markdownSmartInputExtension } from "../markdown-smart-input";
import { slashCommandCompletions } from "../markdown-smart-input";

function createView(doc: string): EditorView {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: markdownSmartInputExtension,
    }),
    parent: host,
  });
}

describe("markdown smart input", () => {
  it("wraps the current selection when pasting a URL", () => {
    const view = createView("OpenAI docs");
    try {
      view.dispatch({
        selection: EditorSelection.range(0, view.state.doc.length),
      });

      const event = new Event("paste", {
        bubbles: true,
        cancelable: true,
      }) as ClipboardEvent;
      Object.defineProperty(event, "clipboardData", {
        value: {
          getData: (type: string) => type === "text/plain" ? "https://platform.openai.com/docs" : "",
        },
      });

      view.contentDOM.dispatchEvent(event);

      expect(view.state.doc.toString()).toBe("[OpenAI docs](https://platform.openai.com/docs)");
      expect(event.defaultPrevented).toBe(true);
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("matches slash commands by aliases", () => {
    const view = createView("/todo");
    try {
      const completion = slashCommandCompletions({
        state: view.state,
        pos: view.state.doc.length,
        explicit: false,
        matchBefore: (expression: RegExp) => {
          const text = view.state.doc.toString();
          const match = expression.exec(text);
          return match ? { from: match.index, to: text.length, text: match[0] } : null;
        },
      } as Parameters<typeof slashCommandCompletions>[0]);

      expect(completion?.options.map((option) => option.label)).toContain("task list");
      expect(completion?.options.find((option) => option.label === "task list")?.detail).toContain("todo");
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it.each([
    ["#", "# "],
    [">", "> "],
    ["-[]", "- [ ] "],
  ])("normalizes markdown shortcut %s on Space", (input, expected) => {
    const view = createView(input);
    try {
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
      const event = new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      });

      view.contentDOM.dispatchEvent(event);

      expect(view.state.doc.toString()).toBe(expected);
      expect(event.defaultPrevented).toBe(true);
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });

  it("normalizes a table shortcut into a markdown table skeleton", () => {
    const view = createView("|");
    try {
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
      const event = new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      });

      view.contentDOM.dispatchEvent(event);

      expect(view.state.doc.toString()).toBe("| Column 1 | Column 2 |\n| --- | --- |\n|  |  |");
      expect(event.defaultPrevented).toBe(true);
    } finally {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });
});
