import { describe, expect, it } from "vitest";
import { findShortcutConflicts } from "@/lib/shortcut-policy";
import {
  getDefaultMarkdownShortcutSpecs,
  markdownShortcutSpecs,
} from "../keyboard-shortcuts";

describe("markdown keyboard shortcuts", () => {
  it("does not enable reserved or duplicate shortcuts by default", () => {
    expect(findShortcutConflicts(getDefaultMarkdownShortcutSpecs())).toEqual([]);
  });

  it("keeps high-conflict formula shortcuts disabled by default", () => {
    const disabledFormulaIds = new Set([
      "math.fraction",
      "math.sqrt",
      "math.integral",
      "math.sum",
      "math.limit",
      "math.matrix",
      "math.vector",
      "math.partial",
      "math.superscript",
      "math.subscript",
    ]);

    for (const shortcut of markdownShortcutSpecs) {
      if (disabledFormulaIds.has(shortcut.id)) {
        expect(shortcut.enabledByDefault, shortcut.id).toBe(false);
      }
    }
  });

  it("keeps only low-conflict math entry points enabled", () => {
    expect(getDefaultMarkdownShortcutSpecs().filter((shortcut) => shortcut.id.startsWith("math."))).toEqual([
      {
        id: "math.inline",
        scope: "markdown-editor",
        key: "Ctrl-Shift-m",
        mac: "Cmd-Shift-m",
        enabledByDefault: true,
      },
      {
        id: "math.block",
        scope: "markdown-editor",
        key: "Ctrl-Alt-m",
        mac: "Cmd-Alt-m",
        enabledByDefault: true,
      },
    ]);
  });
});
