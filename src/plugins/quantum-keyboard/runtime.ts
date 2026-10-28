import { create } from "zustand";
import { useQuantumPreferences } from "./preferences";
import { useHUDStore } from "@/stores/hud-store";
import { getActiveInputTarget } from "@/lib/unified-input-handler";

interface QuantumPluginRuntime { active: boolean; doubleTab: boolean; tab: "input" | "settings" }
export const useQuantumPluginRuntime = create<QuantumPluginRuntime>(() => ({ active: false, doubleTab: true, tab: "input" }));
export function openQuantumKeyboard(tab: QuantumPluginRuntime["tab"] = "input"): void {
  if (!useQuantumPluginRuntime.getState().active) return;
  const target = getActiveInputTarget();
  if (target?.element.isConnected) {
    const cursor = target.element.querySelector('.cm-cursor');
    const caret = cursor?.getBoundingClientRect();
    useHUDStore.getState().updateCursorPosition(caret && caret.height > 0 ? caret : target.element.getBoundingClientRect());
  }
  useQuantumPluginRuntime.setState({ tab });
  useQuantumPreferences.setState({ view: "keys", shortcutMode: true });
  useHUDStore.getState().openHUD("quantum-keyboard-plugin");
  if (tab === "input") queueMicrotask(() => {
    if (useQuantumPluginRuntime.getState().active && useHUDStore.getState().isOpen) target?.focus();
  });
}
