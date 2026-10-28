/**
 * @vitest-environment jsdom
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { MathWidget, renderInlineMarkdownHtml } from "../widgets";
import { quantumMathEditingExtension, quantumMathEditField } from "@/plugins/quantum-keyboard/editor-extension";

describe("live preview math rendering output", () => {
  it("preserves the rendered widget until a double click can open the plugin editor", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({ state: EditorState.create({ doc: "$x^2$", extensions: quantumMathEditingExtension }), parent: host });
    const dom = new MathWidget("x^2", false, 0, 5).toDOM(view);
    view.dom.appendChild(dom);
    try {
      dom.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, detail: 1 }));
      expect(view.state.selection.main.head).toBe(0);
      dom.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }));
      expect(view.state.field(quantumMathEditField)).toMatchObject({ from: 0, to: 5, latex: "x^2", displayMode: false });
    } finally {
      view.destroy(); host.remove();
    }
  });

  it("does not enter source mode on right mousedown before the native copy menu", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({ state: EditorState.create({ doc: "$x^2$" }), parent: host });
    const dom = new MathWidget("x^2", false, 0, 5).toDOM(view);
    view.dom.appendChild(dom);
    try {
      dom.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 2 }));
      expect(view.state.selection.main.head).toBe(0);
    } finally {
      view.destroy(); host.remove();
    }
  });
  it("renders inline math without embedding MathML fallback text in table HTML", () => {
    const html = renderInlineMarkdownHtml("$a^2 + b^2 = c^2$");
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelector(".katex")).toBeTruthy();
    expect(container.innerHTML.toLowerCase()).not.toContain("mathml");
    expect(container.textContent).not.toContain("a2+b2=c2a^2 + b^2 = c^2a2+b2=c2");
  });

  it("opens a formula copy menu with Markdown and LaTeX actions on right click", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({ doc: "$x^2$" }),
      parent: host,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const dom = new MathWidget("x^2", false, 0, 5).toDOM(view);
    document.body.appendChild(dom);
    dom.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 24,
      clientY: 32,
    }));

    const menu = document.querySelector(".cm-math-copy-menu");
    expect(menu).toBeTruthy();
    const buttons = Array.from(menu?.querySelectorAll("button") ?? []);
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Copy Markdown formula",
      "Copy LaTeX formula",
    ]);

    buttons[0].click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith("$x^2$");

    view.destroy();
    host.remove();
    dom.remove();
  });
});
