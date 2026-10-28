import type { PluginModule } from "@/lib/plugins/types";
import { QUANTUM_KEYBOARD_PLUGIN_ID } from "@/lib/plugins/defaults";
import { useHUDStore } from "@/stores/hud-store";
import { openQuantumKeyboard, useQuantumPluginRuntime } from "./runtime";

let disposeSetting: (() => void) | null = null;
let disposeEditor: (() => void) | null = null;
export const quantumKeyboardPlugin: PluginModule = {
  manifest: {
    id: QUANTUM_KEYBOARD_PLUGIN_ID, name: "Quantum Keyboard", version: "2.0.0",
    description: "See, find and insert formulas without memorizing commands. Visual templates, searchable symbols and optional physical key mappings.",
    author: "Lattice", category: "official", entry: "builtin:quantum-keyboard",
    recommended: true, defaultEnabled: true, permissions: ["ui:commands", "ui:toolbar", "storage", "editor:extensions"],
    activationEvents: ["onStartupFinished", "onCommand:quantum-keyboard.open"],
    settings: [{ id: "doubleTab", type: "boolean", label: "Double Tab to open", description: "Open from an editor with two taps of Tab.", default: true }],
    contributes: {
      commands: [
        { id: "quantum-keyboard.open", title: "Open Quantum Keyboard" },
        { id: "quantum-keyboard.configure", title: "Configure Quantum Keyboard" },
        { id: "quantum-keyboard.close", title: "Close Quantum Keyboard" },
      ],
      toolbar: [{ id: "quantum-keyboard.open", title: "Quantum Keyboard", icon: "keyboard", group: "editor" }],
    },
  },
  async activate(ctx) {
    const { quantumMathEditingExtension, finishQuantumMathEdits } = await import("./editor-extension");
    disposeEditor = finishQuantumMathEdits;
    ctx.editor.registerExtension("formula-editor", quantumMathEditingExtension);
    disposeSetting?.();
    useQuantumPluginRuntime.setState({ active: true, doubleTab: ctx.settings.get("doubleTab") !== false });
    disposeSetting = ctx.settings.onChange("doubleTab", value => useQuantumPluginRuntime.setState({ doubleTab: value !== false }));
    ctx.commands.register({ id: "quantum-keyboard.open", title: "Open Quantum Keyboard", run: () => openQuantumKeyboard() });
    ctx.commands.register({ id: "quantum-keyboard.configure", title: "Configure Quantum Keyboard", run: () => openQuantumKeyboard("settings") });
    ctx.commands.register({ id: "quantum-keyboard.close", title: "Close Quantum Keyboard", run: () => useHUDStore.getState().closeHUD() });
    ctx.toolbar.register({ id: "quantum-keyboard.open", title: "Quantum Keyboard", icon: "keyboard", group: "editor", run: () => openQuantumKeyboard() });
  },
  deactivate() {
    disposeEditor?.(); disposeEditor = null;
    disposeSetting?.(); disposeSetting = null;
    useHUDStore.getState().closeHUD();
    useQuantumPluginRuntime.setState({ active: false, tab: "input" });
  },
};
