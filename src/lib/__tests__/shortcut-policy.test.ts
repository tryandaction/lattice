import { describe, expect, it } from "vitest";
import {
  findShortcutConflicts,
  isReservedShortcut,
  normalizeShortcutKey,
  type ShortcutSpec,
} from "../shortcut-policy";

describe("shortcut-policy", () => {
  it("normalizes modifier aliases into a stable key", () => {
    expect(normalizeShortcutKey("Cmd-Shift-F")).toBe("mod-shift-f");
    expect(normalizeShortcutKey("Command-Option-P")).toBe("mod-alt-p");
    expect(normalizeShortcutKey("Ctrl-Alt-M")).toBe("ctrl-alt-m");
  });

  it("marks common browser/system shortcuts as reserved", () => {
    expect(isReservedShortcut("Ctrl-Shift-R")).toBe(true);
    expect(isReservedShortcut("Cmd-Shift-V")).toBe(true);
    expect(isReservedShortcut("Ctrl-Shift-M")).toBe(false);
  });

  it("finds reserved and duplicate enabled shortcuts", () => {
    const shortcuts: ShortcutSpec[] = [
      { id: "a", scope: "markdown-editor", key: "Ctrl-Shift-R", enabledByDefault: true },
      { id: "b", scope: "markdown-editor", key: "Ctrl-Shift-M", enabledByDefault: true },
      { id: "c", scope: "markdown-editor", key: "Ctrl-Shift-M", enabledByDefault: true },
      { id: "d", scope: "markdown-editor", key: "Ctrl-Shift-V", enabledByDefault: false },
    ];

    expect(findShortcutConflicts(shortcuts)).toEqual([
      { shortcutId: "a", key: "Ctrl-Shift-R", type: "reserved" },
      { shortcutId: "c", key: "Ctrl-Shift-M", type: "duplicate", conflictsWith: "b" },
    ]);
  });
});
