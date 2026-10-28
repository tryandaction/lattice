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
      KeyJ: {
        ctrl: {
          "ctrl-KeyJ-1": {
            label: "current density",
            latex: "\\mathbf{J}",
          },
        },
      },
    };

    expect(getEffectiveQuantumMeaning("KeyJ", "ctrl", 1, overrides)?.latex).toBe("\\mathbf{J}");
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

  it("repairs malformed persisted overrides while retaining valid edits", async () => {
    localStorage.setItem("quantum-keyboard-keymap", JSON.stringify({ version: 0, state: {
      overrides: { KeyI: { base: { "base-KeyI-1": { label: "Mine", latex: "\\int_0^1", displayMode: "yes" }, broken: null } }, KeyA: null },
    } }));
    await useQuantumKeymapStore.persist.rehydrate();
    expect(getEffectiveQuantumLayerMeanings("KeyI", "base", useQuantumKeymapStore.getState().overrides)[0]).toMatchObject({
      label: "Mine", latex: "\\int_0^1", displayMode: undefined,
    });
    expect(useQuantumKeymapStore.getState().overrides.KeyA).toBeUndefined();
  });

  it("discards stale insertion payloads when the formula changes", () => {
    useQuantumKeymapStore.getState().updateMeaning("KeyI", "base", "base-KeyI-1", { latex: "\\alpha", mathlive: "\\alpha", markdown: "$\\alpha$" });
    useQuantumKeymapStore.getState().updateMeaning("KeyI", "base", "base-KeyI-1", { latex: "\\beta" });
    const meaning = getEffectiveQuantumMeaning("KeyI", "base", 1, useQuantumKeymapStore.getState().overrides);
    expect(meaning?.latex).toBe("\\beta");
    expect(meaning?.mathlive).toBeUndefined();
    expect(meaning?.markdown).toBeUndefined();
  });

  it("updates archived overrides without moving them onto visible keys", async () => {
    useQuantumKeymapStore.getState().updateMeaning("KeyI", "ctrl", "ctrl-KeyI-1", { label: "Archived current", latex: "I_0" });
    useQuantumKeymapStore.getState().updateMeaning("KeyI", "ctrl", "ctrl-KeyI-1", { latex: "I_1" });
    expect(useQuantumKeymapStore.getState().overrides.KeyI?.ctrl?.["ctrl-KeyI-1"]).toMatchObject({ label: "Archived current", latex: "I_1" });
    await useQuantumKeymapStore.persist.rehydrate();
    expect(useQuantumKeymapStore.getState().overrides.KeyI?.ctrl?.["ctrl-KeyI-1"]?.latex).toBe("I_1");
    expect(getEffectiveQuantumLayerMeanings("KeyI", "ctrl", useQuantumKeymapStore.getState().overrides).some(meaning => meaning.id === "ctrl-KeyI-1")).toBe(false);
  });
});
