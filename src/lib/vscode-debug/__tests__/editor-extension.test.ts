/**
 * @vitest-environment jsdom
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import {
  createDebugEditorExtension,
  type DebugEditorSnapshot,
} from "@/lib/vscode-debug/editor-extension";

describe("debug editor extension", () => {
  it("toggles exact gutter lines and updates markers without rebuilding the editor", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const onToggle = vi.fn();
    const unsubscribe = vi.fn();
    let notify = () => {};
    let snapshot: DebugEditorSnapshot = {
      breakpoints: [{ path: "C:/工作区/app.py", line: 3, verified: false }],
      activeLine: null,
    };
    const extension = createDebugEditorExtension({
      filePath: "C:/工作区/app.py",
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        notify = listener;
        return unsubscribe;
      },
      onToggle,
    });
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "first\nsecond\nthird\nfourth",
        extensions: [extension],
      }),
    });
    const originalView = view;

    const lineThree = parent.querySelector<HTMLElement>(
      '.cm-debug-gutter .cm-debug-breakpoint[data-line="3"]',
    );
    expect(lineThree).toBeTruthy();
    lineThree!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    expect(onToggle).toHaveBeenCalledWith("C:/工作区/app.py", 3);
    expect(parent.querySelector(".cm-debug-breakpoint-unverified")).toBeTruthy();

    snapshot = {
      breakpoints: [{ path: "C:/工作区/app.py", line: 3, verified: true }],
      activeLine: 4,
    };
    notify();

    expect(view).toBe(originalView);
    expect(parent.querySelector(".cm-debug-breakpoint-verified")).toBeTruthy();
    expect(parent.querySelector(".cm-debug-active-line")?.textContent).toContain("fourth");

    view.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    parent.remove();
  });
});
