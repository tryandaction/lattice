import { describe, expect, it } from "vitest";
import { resolveQuantumInputAction, entryNeedsFilling } from "../input-policy";

const key = (code: string, patch = {}) => ({ code, key: code.startsWith("Key") ? code.slice(3).toLowerCase() : code, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...patch });
describe("physical formula input method", () => {
  it("keeps uppercase variables native while filling", () => {
    expect(resolveQuantumInputAction(key("KeyX", { key: "X", shiftKey: true }), "variables", "base", null, null)).toEqual({ kind: "pass" });
    expect(resolveQuantumInputAction(key("KeyX", { key: "X", altKey: true }), "variables", "base", null, null))
      .toEqual({ kind: "choose-key", keyCode: "KeyX", layer: "base" });
    expect(resolveQuantumInputAction(key("KeyX", { key: "X", altKey: true, shiftKey: true }), "variables", "base", null, null))
      .toEqual({ kind: "choose-key", keyCode: "KeyX", layer: "ctrl" });
  });
  it("locks a physical key until its visible number is selected", () => {
    expect(resolveQuantumInputAction(key("KeyF"), "symbols", "base", null, null)).toMatchObject({ kind: "choose-key", keyCode: "KeyF", layer: "base" });
    expect(resolveQuantumInputAction(key("Digit1"), "symbols", "base", null, "KeyF")).toMatchObject({ kind: "insert", keyCode: "KeyF", index: 1 });
    expect(resolveQuantumInputAction(key("KeyX"), "variables", "base", null, null)).toEqual({ kind: "pass" });
  });
  it("locks Shift-selected keys to the extended layer for numbered choices", () => {
    const selected = resolveQuantumInputAction(key("KeyI", { shiftKey: true }), "symbols", "base", null, null);
    expect(selected).toEqual({ kind: "choose-key", keyCode: "KeyI", layer: "ctrl" });
    expect(resolveQuantumInputAction(key("Digit2", { shiftKey: true }), "symbols", "base", null, "KeyI", "ctrl"))
      .toEqual({ kind: "insert", keyCode: "KeyI", layer: "ctrl", index: 2 });
  });
  it("selects a base candidate with letter then taps its visible number", () => {
    expect(resolveQuantumInputAction(key("KeyS"), "symbols", "base", null, null))
      .toEqual({ kind: "choose-key", keyCode: "KeyS", layer: "base" });
    expect(resolveQuantumInputAction(key("Digit1"), "symbols", "base", null, "KeyS", "base"))
      .toEqual({ kind: "insert", keyCode: "KeyS", layer: "base", index: 1 });
  });
  it("uses Alt plus a letter to select base candidates while filling variables", () => {
    expect(resolveQuantumInputAction(key("KeyM", { altKey: true }), "variables", "base", null, null))
      .toEqual({ kind: "choose-key", keyCode: "KeyM", layer: "base" });
    expect(resolveQuantumInputAction(key("KeyM", { altKey: true, shiftKey: true }), "variables", "base", null, null))
      .toEqual({ kind: "choose-key", keyCode: "KeyM", layer: "ctrl" });
  });
  it("keeps a selected layer fixed after Shift has been released", () => {
    expect(resolveQuantumInputAction(key("Digit2"), "symbols", "base", null, "KeyI", "ctrl"))
      .toEqual({ kind: "insert", keyCode: "KeyI", layer: "ctrl", index: 2 });
    expect(resolveQuantumInputAction(key("Digit2"), "symbols", "base", null, "KeyI", "base"))
      .toEqual({ kind: "insert", keyCode: "KeyI", layer: "base", index: 2 });
  });
  it("locks a nested physical key in fill mode and inserts its numbered meaning", () => {
    expect(resolveQuantumInputAction(key("KeyF", { altKey: true }), "variables", "base", null, null)).toEqual({ kind: "choose-key", keyCode: "KeyF", layer: "base" });
    expect(resolveQuantumInputAction(key("Digit2", { altKey: true }), "variables", "base", null, "KeyF", "base")).toMatchObject({ kind: "insert", keyCode: "KeyF", index: 2 });
  });
  it("supports direct numbered choices and Shift-letter then visible number", () => {
    expect(resolveQuantumInputAction(key("Digit3", { shiftKey: true }), "symbols", "base", null, null)).toEqual({ kind: "pass" });
    expect(resolveQuantumInputAction(key("KeyI"), "symbols", "base", { layer: "base", index: 3 }, null)).toMatchObject({ kind: "insert", keyCode: "KeyI", index: 3 });
    expect(resolveQuantumInputAction(key("KeyS"), "symbols", "base", null, null)).toEqual({ kind: "choose-key", keyCode: "KeyS", layer: "base" });
    expect(resolveQuantumInputAction(key("Digit6"), "symbols", "base", null, "KeyS")).toMatchObject({ kind: "insert", keyCode: "KeyS", index: 6 });
    expect(resolveQuantumInputAction(key("Digit2", { shiftKey: true }), "symbols", "base", null, "KeyI", "ctrl"))
      .toMatchObject({ kind: "insert", keyCode: "KeyI", layer: "ctrl", index: 2 });
  });
  it("preserves IME composition and system shortcuts", () => {
    expect(resolveQuantumInputAction(key("KeyX", { isComposing: true }), "symbols", "base", null, null)).toEqual({ kind: "pass" });
    expect(resolveQuantumInputAction(key("KeyZ", { ctrlKey: true }), "symbols", "base", null, null)).toEqual({ kind: "pass" });
    expect(resolveQuantumInputAction(key("Digit3", { ctrlKey: true }), "symbols", "base", null, null)).toEqual({ kind: "pass" });
    expect(resolveQuantumInputAction(key("KeyZ", { ctrlKey: true }), "symbols", "base", { layer: "base", index: 2 }, null)).toEqual({ kind: "pass" });
    expect(resolveQuantumInputAction(key("KeyQ", { ctrlKey: true, altKey: true }), "symbols", "base", null, null)).toEqual({ kind: "pass" });
  });
  it("preserves normal key entry on keydown/keyup chord paths and keeps modifiers", () => {
    expect(resolveQuantumInputAction(key("KeyM", { ctrlKey: true }), "variables", "base", null, null).kind).toBe("pass");
    expect(resolveQuantumInputAction(key("Digit4", { ctrlKey: true }), "variables", "base", null, null).kind).toBe("pass");
    expect(resolveQuantumInputAction(key("Digit4", { key: "4" }), "symbols", "base", null, "KeyM")).toMatchObject({ kind: "insert", keyCode: "KeyM", index: 4 });
  });
  it("keeps Shift punctuation available while filling variables", () => {
    expect(resolveQuantumInputAction(key("Digit6", { key: "^", shiftKey: true }), "variables", "base", null, null)).toEqual({ kind: "pass" });
    expect(resolveQuantumInputAction(key("Digit1", { key: "!", shiftKey: true }), "variables", "base", null, null)).toEqual({ kind: "pass" });
    expect(resolveQuantumInputAction(key("Digit2", { altKey: true }), "variables", "base", null, null)).toEqual({ kind: "prefix", prefix: { layer: "base", index: 2 } });
  });
  it("opens visible choices while filling with Alt Shift letter and supports numpad selection", () => {
    expect(resolveQuantumInputAction(key("KeyI", { altKey: true, shiftKey: true }), "variables", "base", null, null)).toEqual({ kind: "choose-key", keyCode: "KeyI", layer: "ctrl" });
    expect(resolveQuantumInputAction(key("Numpad6", { key: "6" }), "variables", "base", null, "KeyI")).toMatchObject({ kind: "insert", index: 6 });
  });
  it("supports finding formulas without a mouse and browsing selected candidates", () => {
    expect(resolveQuantumInputAction(key("Slash", { key: "/" }), "symbols", "base", null, null)).toEqual({ kind: "lookup" });
    expect(resolveQuantumInputAction(key("Slash", { key: "/" }), "variables", "base", null, null)).toEqual({ kind: "pass" });
    expect(resolveQuantumInputAction(key("Slash", { key: "/", altKey: true }), "variables", "base", null, null)).toEqual({ kind: "lookup" });
    expect(resolveQuantumInputAction(key("ArrowRight"), "symbols", "base", null, "KeyS")).toEqual({ kind: "candidate-step", delta: 1 });
    expect(resolveQuantumInputAction(key("Enter"), "symbols", "base", null, "KeyS")).toEqual({ kind: "candidate-confirm" });
    expect(resolveQuantumInputAction(key("ArrowRight", { repeat: true }), "symbols", "base", null, "KeyS")).toEqual({ kind: "candidate-step", delta: 1 });
  });
  it("makes mode, layer, configuration and completion available from the keyboard", () => {
    expect(resolveQuantumInputAction(key("F2"), "symbols", "base", null, null).kind).toBe("toggle-mode");
    expect(resolveQuantumInputAction(key("F3"), "symbols", "base", null, null).kind).toBe("toggle-layer");
    expect(resolveQuantumInputAction(key("F4"), "symbols", "base", null, null).kind).toBe("configure");
    expect(resolveQuantumInputAction(key("Enter", { ctrlKey: true }), "variables", "base", null, null).kind).toBe("finish");
    expect(entryNeedsFilling({ latex: "\\frac{}{}" })).toBe(true);
    expect(entryNeedsFilling({ latex: "\\alpha" })).toBe(false);
  });
});
