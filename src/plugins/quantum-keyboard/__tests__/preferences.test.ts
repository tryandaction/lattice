import { beforeEach, describe, expect, it } from "vitest";
import { useQuantumPreferences } from "../preferences";

beforeEach(() => {
  useQuantumPreferences.setState(useQuantumPreferences.getInitialState());
  localStorage.clear();
});

describe("quantum preferences compatibility", () => {
  it("preserves an explicit official mapping selection during migration", async () => {
    localStorage.setItem("quantum-keyboard-preferences-v1", JSON.stringify({
      version: 1, state: { mappingSource: "official", favorites: ["base-KeyI-1"] },
    }));
    await useQuantumPreferences.persist.rehydrate();
    expect(useQuantumPreferences.getState().mappingSource).toBe("official");
    expect(useQuantumPreferences.getState().favorites).toEqual(["base-KeyI-1"]);
  });

  it("keeps legacy custom mapping behavior when no source selection existed", async () => {
    localStorage.setItem("quantum-keyboard-preferences-v1", JSON.stringify({ version: 0, state: { selectedKey: "KeyI" } }));
    await useQuantumPreferences.persist.rehydrate();
    expect(useQuantumPreferences.getState().mappingSource).toBe("custom");
    expect(useQuantumPreferences.getState().selectedKey).toBe("KeyI");
  });

  it("restores the chemistry category after restarting", async () => {
    localStorage.setItem("quantum-keyboard-preferences-v1", JSON.stringify({ version: 2, state: { section: "chemistry" } }));
    await useQuantumPreferences.persist.rehydrate();
    expect(useQuantumPreferences.getState().section).toBe("chemistry");
  });

  it("restores the engineering category after restarting", async () => {
    localStorage.setItem("quantum-keyboard-preferences-v1", JSON.stringify({ version: 2, state: { section: "engineering" } }));
    await useQuantumPreferences.persist.rehydrate();
    expect(useQuantumPreferences.getState().section).toBe("engineering");
  });

  it("recovers invalid persisted fields without replacing store actions", async () => {
    localStorage.setItem("quantum-keyboard-preferences-v1", JSON.stringify({
      version: 2,
      state: { favorites: null, recent: ["saved:1", null, "saved:1"], selectedKey: "KeyUnknown", layer: "bad", toggleFavorite: null },
    }));
    await useQuantumPreferences.persist.rehydrate();
    expect(useQuantumPreferences.getState().favorites).toEqual([]);
    expect(useQuantumPreferences.getState().recent).toEqual(["saved:1"]);
    expect(useQuantumPreferences.getState().selectedKey).toBe("KeyF");
    expect(useQuantumPreferences.getState().layer).toBe("base");
    useQuantumPreferences.getState().toggleFavorite("valid");
    expect(useQuantumPreferences.getState().favorites).toEqual(["valid"]);
  });
});
