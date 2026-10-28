import type { QuantumLayerId } from "@/config/quantum-keymap";
import type { QuantumCatalogEntry } from "./catalog";

export type QuantumInputMode = "symbols" | "variables";
export interface CandidatePrefix { index: number; layer: QuantumLayerId }
export interface KeyboardInputEvent {
  key: string; code: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing?: boolean; repeat?: boolean;
}
export type QuantumInputAction =
  | { kind: "pass" }
  | { kind: "close" | "toggle-mode" | "toggle-layer" | "configure" | "finish" | "cancel" | "lookup" | "candidate-confirm" }
  | { kind: "candidate-step"; delta: number }
  | { kind: "prefix"; prefix: CandidatePrefix }
  | { kind: "choose-key"; keyCode: string; layer: QuantumLayerId }
  | { kind: "insert"; keyCode: string; layer: QuantumLayerId; index: number }
  | { kind: "navigate"; direction: "next" | "previous" }
  | { kind: "matrix"; command: "addRowAfter" | "addColumnAfter" };

export function resolveQuantumInputAction(
  event: KeyboardInputEvent,
  mode: QuantumInputMode,
  layer: QuantumLayerId,
  prefix: CandidatePrefix | null,
  choosingKey: string | null,
  choosingLayer: QuantumLayerId = layer,
): QuantumInputAction {
  if (event.isComposing || (event.repeat && !(choosingKey && event.key.startsWith("Arrow")))) return { kind: "pass" };
  if (event.ctrlKey && event.altKey) return { kind: "pass" }; // AltGr belongs to the keyboard layout.
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) return { kind: "finish" };
  if (event.metaKey || event.ctrlKey) return { kind: "pass" };
  if (event.key === "Escape") return { kind: choosingKey || prefix ? "cancel" : "close" };
  if (event.key === "F2") return { kind: "toggle-mode" };
  if (event.key === "F3") return { kind: "toggle-layer" };
  if (event.key === "F4") return { kind: "configure" };
  if (choosingKey && event.key === "Enter") return { kind: "candidate-confirm" };
  if (choosingKey && ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
    return { kind: "candidate-step", delta: event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1 };
  }
  if (event.key === "/" && !event.shiftKey && (mode === "symbols" || event.altKey)) return { kind: "lookup" };
  if (event.altKey && event.key === "Enter") return { kind: "matrix", command: "addRowAfter" };
  if (event.altKey && event.key === "ArrowRight") return { kind: "matrix", command: "addColumnAfter" };
  if (event.key === "Tab") return { kind: "navigate", direction: event.shiftKey ? "previous" : "next" };
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
  if (digit && !choosingKey && event.altKey) {
    return { kind: "prefix", prefix: { index: Number(digit[1]), layer } };
  }
  if (digit && choosingKey) return { kind: "insert", keyCode: choosingKey, layer: choosingLayer, index: Number(digit[1]) };
  if (/^Key[A-Z]$/.test(event.code)) {
    if (mode === "variables" && !event.altKey && !prefix) return { kind: "pass" };
    if (event.altKey && !event.shiftKey && !prefix) return { kind: "choose-key", keyCode: event.code, layer: "base" };
    if (event.altKey && event.shiftKey && !prefix) return { kind: "choose-key", keyCode: event.code, layer: "ctrl" };
    if (!prefix) return { kind: "choose-key", keyCode: event.code, layer: event.shiftKey ? "ctrl" : layer };
    return { kind: "insert", keyCode: event.code, layer: prefix?.layer ?? layer, index: prefix?.index ?? 1 };
  }
  return { kind: "pass" };
}
export function entryNeedsFilling(entry: Pick<QuantumCatalogEntry, "latex" | "mathlive">): boolean {
  return /\{\s*\}|\[\s*\]|\\placeholder\{/.test(entry.mathlive ?? entry.latex);
}
