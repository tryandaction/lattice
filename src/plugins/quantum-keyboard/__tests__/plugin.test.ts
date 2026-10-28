import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/types/settings";
import { getAvailablePlugins } from "@/lib/plugins/registry";
import { getRegisteredCommands, runPluginCommand, setPluginSetting, syncPlugins } from "@/lib/plugins/runtime";
import { useHUDStore } from "@/stores/hud-store";
import { useQuantumPluginRuntime } from "../runtime";
import { EditorState } from "@codemirror/state";
import { getPluginEditorExtensions } from "@/lib/plugins/runtime";
import { quantumMathEditField } from "@/components/editor/codemirror/live-preview/quantum-math-editing";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createPluginEditorExtensions } from "@/components/editor/codemirror/plugin-extensions";

afterEach(async () => { await syncPlugins({ pluginsEnabled: false, enabledPluginIds: [] }); });

describe("Quantum Keyboard official plugin", () => {
  it("is registered and enabled as an official plugin", () => {
    expect(getAvailablePlugins().find(plugin => plugin.id === "quantum-keyboard")).toMatchObject({
      category: "official", recommended: true, defaultEnabled: true,
    });
    expect(DEFAULT_SETTINGS.enabledPlugins).toContain("quantum-keyboard");
    expect(DEFAULT_SETTINGS.trustedPlugins).toContain("quantum-keyboard");
  });

  it("owns commands, panel visibility and its full lifetime", async () => {
    await syncPlugins({ pluginsEnabled: true, enabledPluginIds: ["quantum-keyboard"] });
    expect(useQuantumPluginRuntime.getState().active).toBe(true);
    expect(getRegisteredCommands().some(command => command.id === "quantum-keyboard.open")).toBe(true);
    await runPluginCommand("quantum-keyboard.open");
    expect(useHUDStore.getState().isOpen).toBe(true);
    await runPluginCommand("quantum-keyboard.configure");
    expect(useQuantumPluginRuntime.getState().tab).toBe("settings");
    await runPluginCommand("quantum-keyboard.close");
    expect(useHUDStore.getState().isOpen).toBe(false);
    await runPluginCommand("quantum-keyboard.open");
    expect(useQuantumPluginRuntime.getState().tab).toBe("input");
    await syncPlugins({ pluginsEnabled: false, enabledPluginIds: [] });
    expect(useQuantumPluginRuntime.getState().active).toBe(false);
    expect(useHUDStore.getState().isOpen).toBe(false);
    expect(getRegisteredCommands().some(command => command.id.startsWith("quantum-keyboard."))).toBe(false);
  });

  it("applies the double Tab setting live and retains it across plugin restarts", async () => {
    try {
      await setPluginSetting("quantum-keyboard", "doubleTab", false);
      await syncPlugins({ pluginsEnabled: true, enabledPluginIds: ["quantum-keyboard"] });
      expect(useQuantumPluginRuntime.getState().doubleTab).toBe(false);
      await setPluginSetting("quantum-keyboard", "doubleTab", true);
      expect(useQuantumPluginRuntime.getState().doubleTab).toBe(true);
      await setPluginSetting("quantum-keyboard", "doubleTab", false);
      await syncPlugins({ pluginsEnabled: false, enabledPluginIds: [] });
      await syncPlugins({ pluginsEnabled: true, enabledPluginIds: ["quantum-keyboard"] });
      expect(useQuantumPluginRuntime.getState().doubleTab).toBe(false);
    } finally {
      await setPluginSetting("quantum-keyboard", "doubleTab", true);
    }
  });

  it("provides its formula editor only during the plugin lifetime", async () => {
    await syncPlugins({ pluginsEnabled: true, enabledPluginIds: ["quantum-keyboard"] });
    const activeState = EditorState.create({
      extensions: Array.from(getPluginEditorExtensions().values()) as Extension[],
    });
    expect(activeState.field(quantumMathEditField, false)).toBe(null);

    await syncPlugins({ pluginsEnabled: false, enabledPluginIds: [] });
    const disabledState = EditorState.create({
      extensions: Array.from(getPluginEditorExtensions().values()) as Extension[],
    });
    expect(disabledState.field(quantumMathEditField, false)).toBeUndefined();
  });

  it("installs and removes formula editing in an already mounted editor", async () => {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc: "$x$", extensions: createPluginEditorExtensions() }),
    });
    const edit = () => view.dom.dispatchEvent(new CustomEvent("quantum-edit-formula", {
      cancelable: true, detail: { from: 0, to: 3, latex: "x", isBlock: false },
    }));
    try {
      expect(edit()).toBe(true);
      await syncPlugins({ pluginsEnabled: true, enabledPluginIds: ["quantum-keyboard"] });
      expect(edit()).toBe(false);
      expect(view.state.field(quantumMathEditField, false)).toMatchObject({ from: 0, to: 3 });

      await syncPlugins({ pluginsEnabled: false, enabledPluginIds: [] });
      expect(view.state.field(quantumMathEditField, false)).toBeUndefined();
      expect(view.dom.querySelector(".cm-quantum-math-editor")).toBeNull();
      expect(edit()).toBe(true);
      expect(view.state.doc.toString()).toBe("$x$");
    } finally { view.destroy(); }
  });
});
