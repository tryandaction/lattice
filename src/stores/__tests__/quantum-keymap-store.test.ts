import { beforeEach, describe, expect, it } from "vitest";
import {
  getEffectiveQuantumLayerMeanings,
  getEffectiveQuantumMeaning,
  useQuantumKeymapStore,
  type QuantumKeymapOverrides,
} from "../quantum-keymap-store";

describe("quantum-keymap-store", () => {
  beforeEach(() => {
    localStorage.clear();
    useQuantumKeymapStore.getState().resetAll();
  });

  it("applies label and latex overrides without mutating the official map", () => {
    const overrides: QuantumKeymapOverrides = {
      KeyI: {
        base: {
          "base-KeyI-2": {
            label: "surface integral",
            latex: "\\iint_S",
          },
        },
      },
    };

    const meanings = getEffectiveQuantumLayerMeanings("KeyI", "base", overrides);

    expect(meanings[1]?.label).toBe("surface integral");
    expect(meanings[1]?.latex).toBe("\\iint_S");
    expect(getEffectiveQuantumLayerMeanings("KeyI", "base")[1]?.latex).toBe("\\iint");
  });

  it("resolves customized candidates by one-based index", () => {
    const overrides: QuantumKeymapOverrides = {
      KeyI: {
        ctrl: {
          "ctrl-KeyI-1": {
            label: "current density",
            latex: "\\mathbf{J}",
          },
        },
      },
    };

    expect(getEffectiveQuantumMeaning("KeyI", "ctrl", 1, overrides)?.latex).toBe("\\mathbf{J}");
  });

  it("persists and resets user key overrides", () => {
    useQuantumKeymapStore.getState().updateMeaning("KeyI", "base", "base-KeyI-1", {
      label: "custom integral",
      latex: "\\int_0^1",
    });

    expect(useQuantumKeymapStore.getState().overrides.KeyI?.base?.["base-KeyI-1"]?.latex).toBe("\\int_0^1");

    useQuantumKeymapStore.getState().resetMeaning("KeyI", "base", "base-KeyI-1");
    expect(useQuantumKeymapStore.getState().overrides.KeyI).toBeUndefined();
  });
});
