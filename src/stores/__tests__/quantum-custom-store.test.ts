import { beforeEach, describe, expect, it } from "vitest";
import { useQuantumCustomStore } from "../quantum-custom-store";

beforeEach(() => {
  useQuantumCustomStore.getState().resetAll();
  localStorage.clear();
});

describe("custom symbol persistence", () => {
  it("trims symbols and ignores empty or duplicate entries", () => {
    useQuantumCustomStore.getState().addCustomSymbol("KeyI", "  \\iint  ");
    useQuantumCustomStore.getState().addCustomSymbol("KeyI", "\\iint");
    useQuantumCustomStore.getState().addCustomSymbol("KeyI", "   ");
    expect(useQuantumCustomStore.getState().getCustomSymbols("KeyI")).toEqual(["\\iint"]);
  });

  it("keeps every existing candidate and repairs partial legacy mappings", async () => {
    const symbols = Array.from({ length: 12 }, (_, index) => `x_{${index}}`);
    localStorage.setItem("quantum-keyboard-custom", JSON.stringify({ version: 0, state: {
      customMappings: { KeyI: { customSymbols: symbols }, KeyA: null },
    } }));
    await useQuantumCustomStore.persist.rehydrate();
    expect(useQuantumCustomStore.getState().getCustomSymbols("KeyI")).toEqual(symbols);
    expect(useQuantumCustomStore.getState().getHiddenSymbols("KeyI")).toEqual([]);
    expect(useQuantumCustomStore.getState().customMappings.KeyA).toBeUndefined();
  });

  it("edits an existing candidate without introducing duplicates", () => {
    const store = useQuantumCustomStore.getState();
    store.addCustomSymbol("KeyI", "\\alpha");
    store.addCustomSymbol("KeyI", "\\beta");
    store.updateCustomSymbol("KeyI", "\\alpha", "  \\gamma  ");
    store.updateCustomSymbol("KeyI", "\\gamma", "\\beta");
    expect(useQuantumCustomStore.getState().getCustomSymbols("KeyI")).toEqual(["\\gamma", "\\beta"]);
  });
});
