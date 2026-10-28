import { describe, expect, it } from "vitest";
import { buildQuantumCatalog } from "../catalog";
import { quantumShortcut } from "../formula-card";
import { localizeQuantumKeyboardCommand } from "../localization";

describe("visible formula keyboard shortcuts", () => {
  it("shows the actual base, extended, and extended-index selection paths", () => {
    const catalog = buildQuantumCatalog({}, {
      KeyS: { customSymbols: Array.from({ length: 10 }, (_, index) => "\\mathcal{S}_{" + (index + 1) + "}"), hiddenSymbols: ["\\Sigma"] },
    });
    expect(quantumShortcut(catalog.find(entry => entry.keyCode === "KeyI" && entry.layer === "base" && entry.index === 1)!)).toBe("I → 1");
    expect(quantumShortcut(catalog.find(entry => entry.keyCode === "KeyI" && entry.layer === "base" && entry.index === 2)!)).toBe("I → 2");
    const extended = catalog.find(entry => entry.keyCode === "KeyI" && entry.layer === "ctrl" && entry.index === 2)!;
    expect(quantumShortcut(extended)).toBe("Shift+I → 2");
    expect(quantumShortcut({ ...extended, index: 10 })).toBe("Shift+I · ← → Enter");
    expect(quantumShortcut(catalog.find(entry => entry.keyCode === "KeyS" && entry.layer === "base" && entry.index === 15)!)).toBe("S · ← → Enter");
  });
  it("localizes official plugin command titles", () => {
    expect(localizeQuantumKeyboardCommand("quantum-keyboard.open", "zh-CN", "Open Quantum Keyboard")).toBe("打开量子键盘");
    expect(localizeQuantumKeyboardCommand("quantum-keyboard.configure", "en-US", "Configure Quantum Keyboard")).toBe("Configure Quantum Keyboard");
  });
});
